"""
FastAPI model backend for the Urban Equity Dashboard.

Serves the per-neighbourhood data and runs the RQ1 (cycling propensity) and
RQ2 (elderly car-dependency) models for live "what-if" scenario evaluation.

Run:  uvicorn main:app --reload --port 8000
"""
from __future__ import annotations
import json
import math
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
MODELS = HERE.parent.parent / "data for topic 3" / "models"

ALGOS = {
    "random_forest": "random_forest",
    "logistic_regression": "logistic_regression",
    "xgboost": "xgboost",
}

# ----------------------------------------------------------------------------
# Load data + model artefacts once at startup
# ----------------------------------------------------------------------------
DF = pd.read_parquet(DATA / "neighborhoods.parquet")
DF = DF.set_index("buurtcode", drop=False)
FEAT = json.loads((DATA / "feature_order.json").read_text())
RQ1_FEATS, RQ2_FEATS = FEAT["rq1"], FEAT["rq2"]
AMENITY_GROUPS = FEAT["amenity_groups"]
CENTROIDS = json.loads((DATA / "centroids.json").read_text()) \
    if (DATA / "centroids.json").exists() else {}

# national reference values for quadrants / gaps
ACCESS_MED = float(DF["access_index"].median())
USAGE_MED = float(DF["usage_share"].median())
UTIL_MED = float(DF["bikeshed_utilitarian_amenities"].median())
# national reference levels for the additive accessibility lever (avoids
# multiplicative out-of-distribution blow-up on already-high-access buurten)
REF_UTIL_ACCESS = float(DF["pop_weighted_utilitarian_access"].median())
REF_LEIS_ACCESS = float(DF["pop_weighted_leisure_social_access"].median())


@lru_cache(maxsize=None)
def load_model(rq: str, algo: str):
    imp = joblib.load(MODELS / f"{rq}_imputer.joblib")
    model = joblib.load(MODELS / f"{rq}_{algo}.joblib")
    # The LogisticRegression pickles were trained on an older scikit-learn that
    # didn't persist `multi_class`; newer sklearn reads it in predict_proba.
    # For binary classifiers 'ovr' is equivalent, so backfill it.
    if not hasattr(model, "multi_class"):
        model.multi_class = "ovr"
    return imp, model


def predict(rq: str, feats: list[str], row: pd.Series, algo: str) -> float:
    imp, model = load_model(rq, algo)
    X = pd.DataFrame([row[feats].astype(float).values], columns=feats)
    Ximp = imp.transform(X)
    return float(model.predict_proba(Ximp)[:, 1][0])


# ----------------------------------------------------------------------------
# Scenario -> feature-delta logic (documented, heuristic facility->access map)
# ----------------------------------------------------------------------------
def apply_scenario(row: pd.Series, sc: "Scenario") -> tuple[pd.Series, dict]:
    """Translate planner-facing levers into the model's continuous inputs.

    Design note: the trained models show that Dutch cycling is only weakly
    access-elastic. The aggregate `pop_weighted_total_access` is strongly
    collinear with its utilitarian/leisure components and carries a perverse
    (negative) fitted coefficient — a statistical artefact, not a causal
    effect. We therefore move only the *interpretable* levers a planner
    actually controls (utilitarian / leisure access and the distance to the
    nearest supermarket) and hold the collinear aggregate fixed. Every
    transform is reported back in `assumptions` so nothing is hidden.
    """
    r = row.copy()
    notes = []

    def bump(col, amount):
        if col in r.index and pd.notna(r[col]):
            r[col] = r[col] + amount

    # New schools: utilitarian destinations -> +2 utilitarian-access units each
    if sc.add_schools:
        bump("pop_weighted_utilitarian_access", 2.0 * sc.add_schools)
        notes.append(f"+{sc.add_schools} school(s) → +{2*sc.add_schools:.0f} utilitarian-access units")

    # New grocery stores: nearer supermarket + utilitarian-access boost
    if sc.add_groceries:
        if pd.notna(r.get("avg_dist_super_km")):
            r["avg_dist_super_km"] = max(0.1, r["avg_dist_super_km"] * (0.8 ** sc.add_groceries))
        bump("pop_weighted_utilitarian_access", 3.0 * sc.add_groceries)
        notes.append(f"+{sc.add_groceries} grocery → supermarket distance −{(1-0.8**sc.add_groceries)*100:.0f}%, "
                     f"+{3*sc.add_groceries:.0f} utilitarian-access units")

    # New healthcare (GP/clinic/pharmacy): utilitarian-access boost
    if sc.add_healthcare:
        bump("pop_weighted_utilitarian_access", 2.0 * sc.add_healthcare)
        notes.append(f"+{sc.add_healthcare} healthcare facility(ies) → +{2*sc.add_healthcare:.0f} utilitarian-access units")

    # General accessibility / connectivity improvement (e.g. better bike lanes):
    # raise utilitarian + leisure access and shorten the supermarket trip.
    if sc.accessibility_pct:
        frac = sc.accessibility_pct / 100.0
        bump("pop_weighted_utilitarian_access", frac * REF_UTIL_ACCESS)
        bump("pop_weighted_leisure_social_access", frac * REF_LEIS_ACCESS)
        if pd.notna(r.get("avg_dist_super_km")):
            r["avg_dist_super_km"] = r["avg_dist_super_km"] * (1.0 - sc.accessibility_pct / 200.0)
        notes.append(f"accessibility +{sc.accessibility_pct}% → +{frac*REF_UTIL_ACCESS:.0f} utilitarian / "
                     f"+{frac*REF_LEIS_ACCESS:.0f} leisure-access units, supermarket distance reduced")

    return r, {"assumptions": notes}


# ----------------------------------------------------------------------------
# API models
# ----------------------------------------------------------------------------
class Scenario(BaseModel):
    add_schools: int = 0
    add_groceries: int = 0
    add_healthcare: int = 0
    accessibility_pct: int = 0
    # logistic regression is the default what-if engine: monotonic + explainable.
    # random_forest / xgboost are available but non-monotonic (tree step effects).
    model: str = "logistic_regression"


class PredictRequest(BaseModel):
    buurtcode: str
    scenario: Scenario = Scenario()


def quadrant(access, usage):
    hi_a, hi_u = access >= ACCESS_MED, usage >= USAGE_MED
    if hi_a and hi_u:
        return "success"          # good access, high local cycling
    if hi_a and not hi_u:
        return "opportunity"      # good access, low usage -> policy lever
    if not hi_a and hi_u:
        return "stretched"        # low access yet people still cycle
    return "underserved"          # low access, low usage


def nb_summary(code: str) -> dict:
    r = DF.loc[code]
    def fnum(x):
        try:
            v = float(x)
            return None if math.isnan(v) else round(v, 4)
        except Exception:
            return None
    return {
        "buurtcode": code,
        "name": r["buurtnaam"],
        "gemeente": r["gemeente"],
        "population": fnum(r.get("a_inw")),
        "elderly_share": fnum(r.get("elderly_share")),
        "neighbourhood_type": r.get("neighbourhood_type"),
        "access_index": fnum(r["access_index"]),
        "usage_share": fnum(r["usage_share"]),
        "p_bike": fnum(r["p_bike"]),
        "car_risk": fnum(r["p_car_elderly"]),
        "quadrant": quadrant(r["access_index"], r["usage_share"]),
        "bikeshed_utilitarian": fnum(r.get("bikeshed_utilitarian_amenities")),
        "bikeshed_leisure": fnum(r.get("bikeshed_leisure_social_amenities")),
        "amenities": {g: fnum(r.get(f"amen_{g}")) for g in AMENITY_GROUPS},
    }


# ----------------------------------------------------------------------------
app = FastAPI(title="Urban Equity Dashboard API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/api/meta")
def meta():
    return {
        "n_buurten": int(len(DF)),
        "access_median": ACCESS_MED,
        "usage_median": USAGE_MED,
        "util_median": UTIL_MED,
        "amenity_groups": AMENITY_GROUPS,
        "models": list(ALGOS),
    }


@app.get("/api/neighborhoods")
def neighborhoods():
    """Lightweight rows for the whole country (map colouring + audit)."""
    out = []
    for code, r in DF.iterrows():
        rec = {
            "buurtcode": code,
            "name": r["buurtnaam"],
            "gemeente": r["gemeente"],
            "access": None if pd.isna(r["access_index"]) else round(float(r["access_index"]), 1),
            "usage": None if pd.isna(r["usage_share"]) else round(float(r["usage_share"]), 4),
            "p_bike": None if pd.isna(r["p_bike"]) else round(float(r["p_bike"]), 4),
            "car_risk": None if pd.isna(r["p_car_elderly"]) else round(float(r["p_car_elderly"]), 4),
            "quadrant": quadrant(r["access_index"], r["usage_share"]),
        }
        for g in AMENITY_GROUPS:
            v = r.get(f"amen_{g}")
            rec[f"amen_{g}"] = None if pd.isna(v) else round(float(v), 2)
        out.append(rec)
    return out


@app.get("/api/search")
def search(q: str, limit: int = 8):
    """Fuzzy-ish lookup by buurt or gemeente name (for the AI agent)."""
    ql = q.strip().lower()
    if not ql:
        return []
    hay = (DF["buurtnaam"].str.lower() + " · " + DF["gemeente"].str.lower())
    mask = pd.Series(True, index=DF.index)
    for tok in ql.split():
        mask &= hay.str.contains(tok, na=False, regex=False)
    m = DF[mask]
    if m.empty:  # fall back to any-token match
        any_mask = pd.Series(False, index=DF.index)
        for tok in ql.split():
            any_mask |= hay.str.contains(tok, na=False, regex=False)
        m = DF[any_mask]
    # prefer exact-ish buurt-name matches, then larger neighbourhoods
    m = m.assign(_rank=m["buurtnaam"].str.lower().eq(ql).astype(int)) \
         .sort_values(["_rank", "a_inw"], ascending=[False, False])
    return [nb_summary(c) for c in m.index[:limit]]


@app.get("/api/neighborhood/{code}")
def neighborhood(code: str):
    if code not in DF.index:
        raise HTTPException(404, "unknown buurtcode")
    return nb_summary(code)


@app.get("/api/bikeshed/{code}")
def bikeshed(code: str, radius_km: float = 3.0):
    """Buurten whose centroid lies within `radius_km` (straight-line) — the
    10-minute bike-shed — plus aggregated access/usage inside it."""
    if code not in CENTROIDS:
        raise HTTPException(404, "no geometry for buurtcode")
    lon0, lat0 = CENTROIDS[code]
    members = []
    for c, (lon, lat) in CENTROIDS.items():
        dlat = (lat - lat0) * 111.0
        dlon = (lon - lon0) * 111.0 * math.cos(math.radians(lat0))
        if dlat * dlat + dlon * dlon <= radius_km * radius_km:
            members.append(c)
    sub = DF.loc[DF.index.intersection(members)]

    def safe_mean(series, nd):
        if sub.empty:
            return None
        v = series.mean()
        return None if (v is None or math.isnan(v)) else round(float(v), nd)

    return {
        "buurtcode": code,
        "center": [lon0, lat0],
        "radius_km": radius_km,
        "members": members,
        "n_members": len(members),
        "shed_avg_access": safe_mean(sub["access_index"], 1),
        "shed_avg_usage": safe_mean(sub["usage_share"], 4),
    }


@app.post("/api/predict")
def predict_scenario(req: PredictRequest):
    code = req.buurtcode
    if code not in DF.index:
        raise HTTPException(404, "unknown buurtcode")
    algo = req.scenario.model if req.scenario.model in ALGOS else "logistic_regression"
    base = DF.loc[code]

    base_bike = predict("rq1", RQ1_FEATS, base, algo)
    base_car = predict("rq2", RQ2_FEATS, base, algo)

    scen_row, info = apply_scenario(base, req.scenario)
    new_bike = predict("rq1", RQ1_FEATS, scen_row, algo)
    new_car = predict("rq2", RQ2_FEATS, scen_row, algo)

    # amenity gap vs national utilitarian median
    base_gap = max(0.0, UTIL_MED - float(base.get("bikeshed_utilitarian_amenities") or 0))
    access_gain = 0.0
    if pd.notna(scen_row.get("pop_weighted_utilitarian_access")) and pd.notna(base.get("pop_weighted_utilitarian_access")):
        access_gain = float(scen_row["pop_weighted_utilitarian_access"]) - float(base["pop_weighted_utilitarian_access"])

    return {
        "buurtcode": code,
        "name": base["buurtnaam"],
        "gemeente": base["gemeente"],
        "model": algo,
        "scenario": req.scenario.model_dump(),
        "assumptions": info["assumptions"],
        "baseline": {
            "p_bike": round(base_bike, 4),
            "car_risk": round(base_car, 4),
            "amenity_gap": round(base_gap, 2),
        },
        "scenario_result": {
            "p_bike": round(new_bike, 4),
            "car_risk": round(new_car, 4),
            "amenity_gap": round(max(0.0, base_gap - access_gain), 2),
        },
        "delta": {
            "p_bike": round(new_bike - base_bike, 4),
            "car_risk": round(new_car - base_car, 4),
            "access_gain": round(access_gain, 2),
        },
        "note": (
            "P(bike) is the modelled cycling propensity for a typical trip; car-risk "
            "is the RQ2 elderly car-dependency index (class-balanced, relative not "
            "absolute). Modelled effects of access interventions are deliberately "
            "modest — Dutch cycling is far less access-elastic than the 84% reported "
            "for US walking, a central finding of this project."
        ),
    }


@app.get("/")
def root():
    return {"status": "ok", "buurten": int(len(DF))}

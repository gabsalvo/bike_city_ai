"""
build_data.py
-------------
Assembles a per-neighbourhood (buurt) feature table that feeds the dashboard
and the RQ1 / RQ2 predictive models.

For every buurt we build the FULL feature vector each model expects
(RQ1 = 22 features, RQ2 = 13 features). Features that exist at neighbourhood
level (accessibility indices, distances, urbanity, household mix, gemeente type)
are filled from the CBS/ODiN outputs. Trip-/person-level behavioural features
(pct_has_car, life_stage, ...) are intentionally left as NaN: the trained
SimpleImputer (median strategy) fills them with the training median, i.e. the
"average Dutch trip". Scenario sensitivity therefore flows purely through the
spatial policy levers (access + distances), which is exactly what a planner can
influence.

Output: data/neighborhoods.parquet  (one row per buurt)
"""
from __future__ import annotations
import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent                      # .../q4/design
OUT = ROOT / "proyect" / "output"
MODELS = ROOT / "data for topic 3" / "models"
DATA_DIR = HERE / "data"
DATA_DIR.mkdir(exist_ok=True)

# Encoding used during training (from topic2_final notebook)
TYPE_ENC = {
    "VINEX-like gemeente": 0,
    "Mixed gemeente": 1,
    "High-density urban gemeente": 2,
}

# Per-category amenity columns (CBS proximity class; higher = better served).
# Used for the Essential Function Audit toggles. Grouped into planner categories.
AMENITY_GROUPS = {
    "schools": ["klasse_basisschool", "klasse_voortgezet_onderwijs"],
    "groceries": ["klasse_supermarkt"],
    "healthcare": ["klasse_huisarts", "klasse_ziekenhuis", "klasse_apotheek"],
    "childcare": ["klasse_kinderopvang"],
    "sports": ["klasse_sportterrein"],
    "dining": ["klasse_horeca", "klasse_restaurant", "klasse_fastfood"],
    "transport": ["klasse_treinstation", "klasse_bushalte"],
}


def load_feature_order():
    rq1 = joblib.load(MODELS / "rq1_random_forest.joblib")
    rq2 = joblib.load(MODELS / "rq2_random_forest.joblib")
    return list(rq1.feature_names_in_), list(rq2.feature_names_in_)


def main():
    print("Loading source tables ...")
    ctx = pd.read_csv(OUT / "05_accessibility_context_buurten.csv")
    gem = pd.read_csv(OUT / "05b_gemeente_accessibility_typology.csv")
    amen = pd.read_csv(OUT / "02_amenities_clean.csv")
    usage = pd.read_csv(OUT / "table_rq1_municipality_access_usage.csv")

    rq1_feats, rq2_feats = load_feature_order()
    print(f"RQ1 expects {len(rq1_feats)} features, RQ2 expects {len(rq2_feats)}")

    # --- gemeente-level access + type (join on gemeente code) --------------
    gem_small = gem[[
        "Wogem_DANS24", "dominant_type",
        "pop_weighted_total_access",
        "pop_weighted_utilitarian_access",
        "pop_weighted_leisure_social_access",
    ]].copy()
    gem_small["type_code"] = gem_small["dominant_type"].map(TYPE_ENC)

    df = ctx.merge(gem_small, left_on="gm_code_int", right_on="Wogem_DANS24", how="left")

    # --- municipality cycling usage (weighted mean across life stages) -----
    usage["w"] = usage["weighted_trips"].fillna(0)
    g = usage.groupby("Wogem_DANS24")
    muni_usage = pd.DataFrame({
        "cycling_share": g.apply(lambda x: np.average(
            x["cycling_share"], weights=x["w"]) if x["w"].sum() > 0
            else x["cycling_share"].mean()),
        "car_share": g.apply(lambda x: np.average(
            x["car_share"], weights=x["w"]) if x["w"].sum() > 0
            else x["car_share"].mean()),
    }).reset_index()
    df = df.merge(muni_usage, left_on="gm_code_int", right_on="Wogem_DANS24",
                  how="left", suffixes=("", "_u"))

    # --- per-category amenity proximity (the buurt's own access) -----------
    amen_cols = [c for cols in AMENITY_GROUPS.values() for c in cols]
    amen_cols = [c for c in amen_cols if c in amen.columns]
    df = df.merge(amen[["buurtcode"] + amen_cols], on="buurtcode", how="left")
    for grp, cols in AMENITY_GROUPS.items():
        present = [c for c in cols if c in df.columns]
        df[f"amen_{grp}"] = df[present].mean(axis=1) if present else np.nan

    # --- build the model feature columns -----------------------------------
    # Spatial features we can fill from CBS:
    df["avg_sted"] = df["ste_oad"]
    df["avg_dist_gp_km"] = df["g_afs_hp"]
    df["avg_dist_super_km"] = df["g_afs_gs"]
    df["pct_single_family"] = df["p_1gezw"] / 100.0

    # Everything the model expects but we can't derive per-buurt -> NaN
    # (the trained imputer fills the training median at inference time).
    for col in set(rq1_feats) | set(rq2_feats):
        if col not in df.columns:
            df[col] = np.nan
    # life-stage dummies: neutral (reference category) rather than median
    for col in [c for c in rq1_feats if c.startswith("ls_")]:
        df[col] = 0.0

    # --- baseline model predictions ----------------------------------------
    print("Computing baseline predictions ...")
    preds = {}
    for rq, feats in (("rq1", rq1_feats), ("rq2", rq2_feats)):
        imp = joblib.load(MODELS / f"{rq}_imputer.joblib")
        model = joblib.load(MODELS / f"{rq}_random_forest.joblib")
        X = df[feats].astype(float)
        Ximp = imp.transform(X)
        p = model.predict_proba(Ximp)[:, 1]
        preds[rq] = p
    df["p_bike"] = preds["rq1"]          # P(trip cycled)  -- higher = success
    df["p_car_elderly"] = preds["rq2"]   # P(elderly trip by car) -- higher = risk

    # --- access / usage convenience fields for the heatmap -----------------
    df["access_index"] = df["bikeshed_total_amenities"]
    df["usage_share"] = df["cycling_share"]

    # keep a tidy set of columns
    meta_cols = [
        "buurtcode", "buurtnaam", "gemeente", "gm_code_int",
        "a_inw", "bev_dich", "elderly_share", "children_share",
        "family_household_share", "neighbourhood_type", "dominant_type",
        "reachable_buurten_10min",
        "bikeshed_total_amenities", "bikeshed_utilitarian_amenities",
        "bikeshed_leisure_social_amenities",
        "access_index", "usage_share", "cycling_share", "car_share",
        "p_bike", "p_car_elderly",
    ]
    amen_meta = [f"amen_{g}" for g in AMENITY_GROUPS]
    keep = list(dict.fromkeys(meta_cols + amen_meta + rq1_feats + rq2_feats))
    keep = [c for c in keep if c in df.columns]
    out = df[keep].copy()

    out.to_parquet(DATA_DIR / "neighborhoods.parquet", index=False)
    # also drop a small feature-order manifest for the API
    (DATA_DIR / "feature_order.json").write_text(json.dumps(
        {"rq1": rq1_feats, "rq2": rq2_feats,
         "amenity_groups": list(AMENITY_GROUPS)}, indent=2))

    print(f"Wrote {len(out):,} buurten -> {DATA_DIR/'neighborhoods.parquet'}")
    print("Baseline P(bike):  mean={:.3f}  range[{:.3f},{:.3f}]".format(
        out.p_bike.mean(), out.p_bike.min(), out.p_bike.max()))
    print("Baseline P(car|elderly): mean={:.3f}  range[{:.3f},{:.3f}]".format(
        out.p_car_elderly.mean(), out.p_car_elderly.min(), out.p_car_elderly.max()))


if __name__ == "__main__":
    main()

"""
build_background.py
-------------------
Reconstructs the *trip-level* feature matrices the RQ1/RQ2 models were actually
trained on (topic2_final.ipynb, cells 6-13) and saves them as PDP "background"
samples for the dashboard.

Why this exists
---------------
The models were trained on individual ODiN trips. Each trip carries strong
trip-/person-level predictors (`KAfstV` trip distance, `life_stage`, and the
municipality behavioural features `pct_has_car`, `habit_bike_freq`, ...).
The dashboard has none of these per buurt, so `build_data.py` median-imputes
them to a *single* point. A Random Forest evaluated at that one frozen point
lands in an arbitrary leaf and responds to the access levers in non-monotone
steps. The fix (see `pdp.py`) is to evaluate the tree models over a realistic
sample of these trip-level features and average -- a Monte-Carlo partial
dependence -- which recovers a smooth, monotone response to the spatial levers.

This script produces that sample by replaying the notebook's feature assembly,
so the background is exactly the joint distribution the model learned on.

Output:
  data/rq1_background.parquet   (~14.6k trips x 22 features, median-imputed)
  data/rq2_background.parquet   (~1.2k elderly trips x 13 features)
"""
from __future__ import annotations
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent                       # .../q4/design
OUT = ROOT / "proyect" / "output"
RAW = ROOT / "proyect" / "data"
MODELS = ROOT / "data for topic 3" / "models"
DATA_DIR = HERE / "data"
DATA_DIR.mkdir(exist_ok=True)

ODIN_PATH = RAW / "odin2024_full.csv"
KWB_PATH = RAW / "kwb2025.xlsx"

# --- constants copied verbatim from topic2_final.ipynb (cell 2) -------------
TYPE_ENC = {"High-density urban gemeente": 2, "VINEX-like gemeente": 0, "Mixed gemeente": 1}
LIFE_ORDER = ["Child/Teen (<18)", "Young Adult (18-29)", "Family w/ Kids",
              "Mid-life No Kids (30-54)", "Older Adult (55-69)", "Senior (70+)"]
EINDHOVEN_CODES = [743, 753, 762, 770, 772, 794, 820, 823, 847, 848, 858, 861, 866,
                   1652, 1658, 1659, 1667, 1706, 1724, 1728, 1771]
ELDERLY_KLEEFT = [15, 16, 17, 18]


def to_number(s):
    return (s.astype(str).str.replace(",", ".", regex=False)
            .replace({".": np.nan, "nan": np.nan})
            .pipe(pd.to_numeric, errors="coerce"))


def kwb_municipality_aggregates() -> pd.DataFrame:
    """Cell 6: population-weighted municipality aggregates from KWB."""
    kwb_raw = pd.read_excel(KWB_PATH, sheet_name="KWB2025", dtype=str)
    kwb_brt = kwb_raw[kwb_raw["recs"] == "Buurt"].copy()
    for c in ["a_inw", "p_1gezw", "g_afs_hp", "g_afs_kv", "ste_oad"]:
        kwb_brt[c] = to_number(kwb_brt[c])
    kwb_brt["Wogem_DANS24"] = pd.to_numeric(
        kwb_brt["gwb_code_8"].str[:4], errors="coerce").astype("Int64")

    def pop_w(grp, col):
        v = grp[[col, "a_inw"]].dropna()
        return np.nan if v.empty or v["a_inw"].sum() == 0 else np.average(v[col], weights=v["a_inw"])

    return (kwb_brt.groupby("Wogem_DANS24")
            .apply(lambda g: pd.Series({
                "avg_dist_gp_km": pop_w(g, "g_afs_hp"),
                "avg_dist_super_km": pop_w(g, "g_afs_kv"),
                "pct_single_family": pop_w(g, "p_1gezw"),
                "avg_sted": pop_w(g, "ste_oad"),
            }), include_groups=False)
            .reset_index())


def odin_behavioural_features() -> pd.DataFrame:
    """Cells 7-8: per-municipality behavioural features (Brabant only)."""
    cols = ["Wogem_DANS24", "Prov", "KLeeft", "FactorV", "OPAuto_DANS24",
            "OPRijbewijsAu", "HHEFiets_DANS24", "FqNEFiets", "FqAutoB", "Dag", "Maand"]
    odin = pd.read_csv(ODIN_PATH, sep=";")
    odin = odin[[c for c in cols if c in odin.columns]].rename(columns={
        "OPAuto_DANS24": "HvAuto", "OPRijbewijsAu": "HvRijbewijs", "HHEFiets_DANS24": "HvEFiets"})
    for col in ["Wogem_DANS24", "Prov", "KLeeft", "HvAuto", "HvRijbewijs",
                "HvEFiets", "FqNEFiets", "FqAutoB", "Dag", "Maand"]:
        if col in odin.columns:
            odin[col] = pd.to_numeric(odin[col].astype(str).replace("#NULL!", np.nan), errors="coerce")
    odin["FactorV"] = (odin["FactorV"].astype(str).str.replace(".", "", regex=False)
                       .pipe(pd.to_numeric, errors="coerce").div(1e3))

    brab = odin[odin["Prov"] == 11].copy()
    w = brab["FactorV"]
    brab["weight_v"] = w / w.sum() * len(w)

    rows = []
    for muni, g in brab.groupby("Wogem_DANS24"):
        w, wsum = g["weight_v"], g["weight_v"].sum()
        if pd.isna(wsum) or wsum == 0:
            continue
        row = {"Wogem_DANS24": muni}
        for col, key in [("HvAuto", "pct_has_car"), ("HvRijbewijs", "pct_has_license"),
                         ("HvEFiets", "pct_has_ebike")]:
            if col in g.columns:
                row[key] = ((g[col] == 1) * w).sum() / wsum
        for col, key in [("FqNEFiets", "habit_bike_freq"), ("FqAutoB", "habit_car_freq")]:
            if col in g.columns and g[col].notna().any():
                v = g[col].notna()
                row[key] = (g.loc[v, col] * w[v]).sum() / w[v].sum()
        if "Maand" in g.columns:
            row["pct_cycling_season"] = (g["Maand"].between(4, 9) * w).sum() / wsum
        if "Dag" in g.columns:
            row["pct_weekend"] = (g["Dag"].isin([6, 7]) * w).sum() / wsum
        rows.append(row)
    return pd.DataFrame(rows)


def assemble_trip_features(trips: pd.DataFrame, kwb: pd.DataFrame, behav: pd.DataFrame,
                           feats: list[str]) -> pd.DataFrame:
    """Merge municipality features onto trips and project onto the model's
    feature columns (life-stage dummies built directly so the order matches)."""
    df = trips.copy()
    df["type_code"] = df["dominant_type"].map(TYPE_ENC)
    df["life_stage_code"] = df["life_stage"].map({ls: i for i, ls in enumerate(LIFE_ORDER)})
    df = df.merge(kwb, on="Wogem_DANS24", how="left").merge(behav, on="Wogem_DANS24", how="left")

    X = pd.DataFrame(index=df.index)
    for f in feats:
        if f.startswith("ls_"):
            X[f] = (df["life_stage"] == f[3:]).astype(float)
        elif f in df.columns:
            X[f] = pd.to_numeric(df[f], errors="coerce")
        else:
            X[f] = np.nan
    return X


def main():
    print("Loading sources ...")
    trips = pd.read_csv(OUT / "03b_brabant_cyclable_trips_with_access.csv")
    for col in ["KHvm", "KAfstV", "KLeeft", "Wogem_DANS24", "weight_v"]:
        if col in trips.columns:
            trips[col] = pd.to_numeric(trips[col].astype(str).replace("#NULL!", np.nan), errors="coerce")

    kwb = kwb_municipality_aggregates()
    behav = odin_behavioural_features()
    print(f"  KWB aggregates: {kwb.shape}   ODiN behavioural: {behav.shape}")

    feat = json.loads((DATA_DIR / "feature_order.json").read_text())

    # --- RQ1: all cyclable trips -------------------------------------------
    rq1 = trips.dropna(subset=["KHvm"]).copy()
    X1 = assemble_trip_features(rq1, kwb, behav, feat["rq1"])

    # --- RQ2: elderly trips in the Eindhoven region ------------------------
    rq2_trips = trips[trips["KLeeft"].isin(ELDERLY_KLEEFT)
                      & trips["Wogem_DANS24"].isin(EINDHOVEN_CODES)].copy()
    X2 = assemble_trip_features(rq2_trips, kwb, behav, feat["rq2"])

    for rq, X in (("rq1", X1), ("rq2", X2)):
        imp = joblib.load(MODELS / f"{rq}_imputer.joblib")
        Ximp = pd.DataFrame(imp.transform(X[feat[rq]]), columns=feat[rq])
        out = DATA_DIR / f"{rq}_background.parquet"
        Ximp.to_parquet(out, index=False)
        print(f"  {rq}: {len(Ximp):,} trips x {Ximp.shape[1]} feats -> {out.name}")
        # quick sanity: spread of the key marginalised predictors
        for c in ("KAfstV", "pct_single_family", "avg_dist_super_km"):
            if c in Ximp.columns:
                print(f"      {c:18s} median={Ximp[c].median():.3f} "
                      f"[{Ximp[c].min():.3f}, {Ximp[c].max():.3f}]")


if __name__ == "__main__":
    main()

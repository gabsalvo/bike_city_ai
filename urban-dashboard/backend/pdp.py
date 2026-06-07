"""
pdp.py
------
Monte-Carlo partial-dependence prediction shared by the API and the data build.

A buurt only knows its *spatial / morphological* features (accessibility,
urbanity, distances, single-family share). The trip-/person-level features the
models also use (`KAfstV`, `life_stage`, `pct_has_car`, habitual frequencies, …)
have no buurt-level value. Freezing them at a single median makes a tree model
respond to the spatial levers in arbitrary non-monotone steps.

`pdp_predict` instead evaluates the model over a *background sample* of real
trips (see build_background.py), with the buurt's spatial features overridden in
and the trip-level features left at their natural distribution, then averages the
probabilities. This is the partial dependence of P(y) on the spatial features,
marginalising out the rest — smooth and monotone for trees, and unchanged for the
linear model (averaging a linear score == scoring the average).
"""
from __future__ import annotations
import pandas as pd

# Features a buurt actually knows -> pinned to the buurt's value.
# Everything else in the model's feature list is marginalised over the
# background sample of trips.
OVERRIDE_COLS = [
    "pop_weighted_total_access",
    "pop_weighted_utilitarian_access",
    "pop_weighted_leisure_social_access",
    "type_code",
    "avg_sted",
    "avg_dist_gp_km",
    "avg_dist_super_km",
    "pct_single_family",
]


def pdp_predict(model, background: pd.DataFrame, feats: list[str], row: pd.Series) -> float:
    """Average P(class=1) over the background with `row`'s spatial features pinned in.

    `background` must already be in `feats` order and fully imputed (no NaN).
    Only the OVERRIDE_COLS present in `row` with a non-null value are pinned;
    a missing/NaN buurt value falls back to the background distribution.
    """
    B = background[feats].copy()
    for col in OVERRIDE_COLS:
        if col in B.columns and col in row.index and pd.notna(row[col]):
            B[col] = float(row[col])
    return float(model.predict_proba(B.values)[:, 1].mean())

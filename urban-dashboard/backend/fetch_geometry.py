"""
fetch_geometry.py
-----------------
Downloads CBS 'buurten' (neighbourhood) polygons from the public PDOK WFS,
simplifies them, computes centroids, keeps only buurten that exist in our
data table, and writes a slim GeoJSON the dashboard can render.

Output:
  ../public/buurten.geojson   (simplified polygons, prop: buurtcode)
  data/centroids.json         (buurtcode -> [lon, lat]) for the bike-shed ring
"""
from __future__ import annotations
import json
from pathlib import Path

import pandas as pd
import requests
from shapely.geometry import shape, mapping
from shapely.ops import transform

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public"
DATA = HERE / "data"

WFS = "https://service.pdok.nl/cbs/wijkenbuurten/2024/wfs/v1_0"
PAGE = 1000      # PDOK WFS hard-caps GetFeature at 1000 records per request
SIMPLIFY_TOL = 0.0010      # ~110 m in lon/lat degrees
PRECISION = 5              # decimal places for coordinates


def round_coords(geom, ndigits=PRECISION):
    return transform(lambda x, y, z=None: (round(x, ndigits), round(y, ndigits)), geom)


def fetch_all():
    feats = []
    start = 0
    while True:
        params = {
            "service": "WFS", "version": "2.0.0", "request": "GetFeature",
            "typeName": "buurten", "outputFormat": "application/json",
            "srsName": "EPSG:4326", "count": PAGE, "startIndex": start,
            "propertyName": "buurtcode,water,geom",
        }
        r = requests.get(WFS, params=params, timeout=180)
        r.raise_for_status()
        chunk = r.json().get("features", [])
        if not chunk:
            break
        feats.extend(chunk)
        print(f"  fetched {len(feats):,} ...")
        if len(chunk) < PAGE:
            break
        start += PAGE
    return feats


def main():
    keep_codes = set(
        pd.read_parquet(DATA / "neighborhoods.parquet")["buurtcode"].astype(str))
    print(f"Data has {len(keep_codes):,} buurten. Fetching geometry from PDOK ...")
    raw = fetch_all()
    print(f"Downloaded {len(raw):,} raw features. Simplifying ...")

    out_feats = []
    centroids = {}
    for f in raw:
        props = f.get("properties", {})
        code = props.get("buurtcode")
        if code not in keep_codes:
            continue
        if str(props.get("water", "")).upper() == "JA":
            continue
        geom = f.get("geometry")
        if not geom:
            continue
        try:
            g = shape(geom)
            if g.is_empty:
                continue
            gs = g.simplify(SIMPLIFY_TOL, preserve_topology=True)
            if gs.is_empty:
                gs = g
            gs = round_coords(gs)
            c = g.centroid
            centroids[code] = [round(c.x, PRECISION), round(c.y, PRECISION)]
            out_feats.append({
                "type": "Feature",
                "properties": {"buurtcode": code},
                "geometry": mapping(gs),
            })
        except Exception as e:
            print(f"  skip {code}: {e}")

    fc = {"type": "FeatureCollection", "features": out_feats}
    PUBLIC.mkdir(exist_ok=True)
    (PUBLIC / "buurten.geojson").write_text(json.dumps(fc), encoding="utf-8")
    (DATA / "centroids.json").write_text(json.dumps(centroids))

    size_mb = (PUBLIC / "buurten.geojson").stat().st_size / 1e6
    print(f"Wrote {len(out_feats):,} buurten -> public/buurten.geojson ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()

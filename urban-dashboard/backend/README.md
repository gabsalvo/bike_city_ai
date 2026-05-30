# Urban Equity Dashboard — Model Backend

A small FastAPI service that loads the trained RQ1/RQ2 models and serves
per-neighbourhood data + live "what-if" scenario predictions to the Next.js
dashboard.

## What the models predict
- **RQ1** – `p_bike`: probability a (cyclable) trip is made by bicycle — the
  *cycling-propensity* signal. 22 features.
- **RQ2** – `car_risk`: elderly (65+) car-dependency index for the Eindhoven
  region. Trained class-balanced on a small (5.8% positive) sample, so it is a
  **relative risk index, not a calibrated probability**. 13 features.

Per-neighbourhood feature vectors are built from CBS/ODiN outputs. Spatial
levers (accessibility indices, distance to supermarket/GP, household mix,
gemeente type, urbanity) are filled from the data; trip-/person-level
behavioural features are left blank and the model's own median imputer fills
them — i.e. "an average trip in this neighbourhood". Scenario sensitivity
therefore flows entirely through the spatial policy levers a planner controls.

> Key finding baked into the design: Dutch cycling is only **weakly
> access-elastic** (the aggregate access term is even collinear/negative),
> unlike the 84% access–usage link reported for US walking. The what-if engine
> defaults to **logistic regression** (monotonic + explainable) and reports
> deliberately modest effects.

## Setup
```bash
cd urban-dashboard/backend
pip install -r requirements.txt

# 1) build the per-neighbourhood feature table (-> data/neighborhoods.parquet)
python build_data.py

# 2) download + slim CBS buurt geometry from PDOK (-> ../public/buurten.geojson)
python fetch_geometry.py

# 3) run the API (http://127.0.0.1:8000)
uvicorn main:app --reload --port 8000
```

Then start the dashboard (`npm run dev` in `urban-dashboard/`). The frontend
reads `NEXT_PUBLIC_BACKEND_URL` / `BACKEND_URL` from `.env.local`.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | medians, model list, amenity groups |
| GET | `/api/neighborhoods` | lightweight rows for the whole country (map + audit) |
| GET | `/api/neighborhood/{code}` | full detail for one buurt |
| GET | `/api/search?q=` | name lookup (used by the AI agent) |
| GET | `/api/bikeshed/{code}` | 3 km bike-shed members + centroid |
| POST | `/api/predict` | run a scenario → baseline vs scenario `p_bike`, `car_risk`, amenity gap |

`verify_ui.py` is a Playwright smoke test for the rendered dashboard.

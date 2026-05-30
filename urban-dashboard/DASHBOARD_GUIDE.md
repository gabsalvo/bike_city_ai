# Urban Equity Dashboard — Guide & Reproduction

**Topic 3: The urban equity dashboard — AI-powered interface**

An interactive decision-support tool for policymakers that turns the Topic 1 (CBS/ODiN
analysis) and Topic 2 (predictive models) results into a live planning interface. A
policymaker can explore biking accessibility and mobility patterns across all ~14,700
Dutch neighbourhoods (*buurten*), simulate interventions, and get data-grounded
recommendations from an LLM agent that reads **real model output**.

- **Dashboard (frontend):** Next.js 16 + React 19 + Tailwind v4 + Leaflet — `urban-dashboard/`
- **Model API (backend):** FastAPI loading the trained RQ1/RQ2 `.joblib` models — `urban-dashboard/backend/`
- **AI agent:** Google Gemini (`gemini-2.5-flash`) with function-calling into the backend

---

## 1. Quick start (run it live in 4 steps)

> **Prerequisites:** Node.js 18+, Python 3.11+ (tested on 3.14), and the Gemini API key
> already in `urban-dashboard/.env.local`.

```bash
# ── 1. Backend deps ────────────────────────────────────────────────
cd urban-dashboard/backend
pip install -r requirements.txt

# ── 2. Build the data artefacts (only needed once) ─────────────────
python build_data.py        # -> data/neighborhoods.parquet  (model feature table)
python fetch_geometry.py     # -> ../public/buurten.geojson   (CBS map polygons, ~5 MB)

# ── 3. Start the model API (leave this terminal running) ───────────
uvicorn main:app --port 8000
#   API now at http://127.0.0.1:8000  (check http://127.0.0.1:8000/api/meta)

# ── 4. In a SECOND terminal, start the dashboard ───────────────────
cd urban-dashboard
npm install                  # first time only
npm run dev
#   Dashboard now at http://localhost:3000
```

Open **http://localhost:3000**, search for a neighbourhood (e.g. *Woensel-West*) or click
the map, and start moving the scenario sliders / chatting with the assistant.

> **Note:** steps 2 are already done — `data/neighborhoods.parquet` and
> `public/buurten.geojson` are committed, so you can skip straight to steps 3 & 4 unless you
> want to rebuild them.

---

## 2. How the requirements map to what was built

| Required feature | Where it lives | What it does |
|---|---|---|
| **Data Integration** | `backend/build_data.py` | Merges CBS access indices (`05_*`), ODiN usage (`table_rq1_municipality_access_usage`), per-category amenities (`02_*`) and the Topic-2 model outputs into one per-buurt table. |
| **Feature 1 — Access-Usage Heatmap** | map + `MapComponent.tsx` | National choropleth; click any buurt to draw its **3 km "10-minute bike-shed"** ring. Colours show where local living is high (success) vs good access but low usage (**policy opportunity**). |
| **Feature 2 — Essential Function Audit** | "Amenity audit" colour mode | Toggle between amenity categories (schools, groceries, healthcare, …) to see which neighbourhoods are well- vs under-served within a 10-minute bike ride. |
| **Feature 3 — "What-If" Scenario Builder** | sliders + `backend/main.py` `/api/predict` | Add schools/groceries/healthcare or boost accessibility → the **real RQ1/RQ2 models** re-run and report predicted changes in cycling propensity, elderly car-dependency risk, and amenity gap. |
| **Feature 5 — AI-Agent Policy Assistant** | `app/api/chat/route.ts` | Gemini agent with a function-calling loop. It explains patterns, runs scenarios through the backend, compares interventions, and gives concise recommendations — grounded in real numbers, never invented. |

---

## 3. Architecture & data flow

```
                     ┌─────────────────────────────────────────────┐
   Browser           │  Next.js dashboard (localhost:3000)         │
   ───────           │  app/page.tsx · components/MapComponent.tsx │
                     └───────────────┬──────────────┬──────────────┘
        click / sliders              │ fetch        │ POST /api/chat
                                     │              │
                                     ▼              ▼
              ┌──────────────────────────┐   ┌─────────────────────────┐
              │ FastAPI backend  :8000   │   │ Next route  /api/chat   │
              │ backend/main.py          │◄──┤ → Gemini (function-call)│
              │ loads .joblib models     │   │   runScenario /         │
              │ + neighborhoods.parquet  │   │   selectNeighborhood    │
              └──────────────────────────┘   └─────────────────────────┘
                         ▲
                         │ built once by
            build_data.py│  +  fetch_geometry.py (PDOK WFS)
```

**Why a separate Python backend?** The Topic-2 models are scikit-learn / XGBoost
`.joblib` files. Running them for live "what-if" inference needs Python, so the dashboard
talks to a thin FastAPI sidecar rather than trying to re-implement the models in JavaScript.

**Map geometry** comes from the public **PDOK CBS *wijken & buurten* WFS** (real Dutch
neighbourhood polygons), downloaded once, simplified (~110 m tolerance) and joined to our
data → `public/buurten.geojson` (14,494 buurten, 5.3 MB, rendered on a Leaflet canvas layer).

---

## 4. The models behind the scenario engine

Both models are **trip-level** classifiers from Topic 2:

| Model | Predicts | Target | Features | Shown as |
|---|---|---|---|---|
| **RQ1** | a trip is cycled | `is_bike` | 22 | **Cycling propensity** `p_bike` |
| **RQ2** | an elderly (65+) trip uses a car | `is_car` | 13 | **Elderly car-dependency risk** |

To predict at *neighbourhood* level, each buurt gets a feature vector where the **spatial
policy levers** (accessibility indices, distance to supermarket/GP, household mix, gemeente
type, urbanity) are filled from CBS/ODiN, while trip-/person-level behavioural features
(car ownership, life stage, …) are left blank and filled by the **model's own median
imputer** — i.e. *"an average trip in this neighbourhood."* This isolates scenario
sensitivity to the levers a planner can actually change.

A scenario lever is translated into concrete model-input changes, all reported back to the
user under **"Model assumptions"** (nothing hidden). Example:
`+2 grocery → supermarket distance −36%, +6 utilitarian-access units`.

---

## 5. Findings & caveats (useful for the written chapter)

These are real, defensible results that *strengthen* the consulting story — not bugs:

1. **Dutch cycling is only weakly access-elastic.** The logistic-regression coefficients
   show the aggregate `total_access` term is collinear with its components and even carries
   a small *negative* fitted weight (a statistical artefact). The clean signals are
   *distance to the nearest supermarket* (↓ → more cycling) and *utilitarian/leisure
   access* (↑ → more cycling). **Headline:** the strong **84% access–usage link found for
   US *walking* does not transfer to Dutch *cycling*** — so simply adding amenities yields
   only modest predicted gains. The bigger lever is targeting **"policy opportunity"**
   neighbourhoods (good access, low usage).

2. **Tree models are non-monotonic.** Random Forest / XGBoost sometimes predicted *less*
   cycling for a pro-cycling intervention (step effects + behavioural features dominating).
   The what-if therefore **defaults to logistic regression** (monotonic, explainable); RF
   and XGBoost remain selectable for comparison, but are flagged as non-monotonic.

3. **RQ2 car-risk is a *relative* index, not a probability.** RQ2 was class-balanced for a
   5.8%-positive sample, so its outputs centre around ~0.5. It ranks neighbourhoods by
   elderly car-dependency risk but should **never** be read as "X% chance of car use." The
   UI labels it accordingly.

4. **Usage data is sparse.** ODiN cycling-usage exists only for sampled municipalities, so
   many buurten have no usage value — these are drawn **grey** on the Access×Usage map
   (not mislabelled as "underserved").

5. **Accessibility lever is additive against the national median**, not multiplicative on a
   buurt's own value — otherwise already-high-access neighbourhoods would push the model's
   sigmoid to unrealistic extremes.

---

## 6. The dashboard, panel by panel

- **Access–Usage Heatmap (top):** the national map. Search box + click-to-select. Three
  colour modes via the top-right buttons:
  - *Access × Usage* — four quadrants: **success** (green), **policy opportunity** (amber),
    **stretched** (blue), **underserved** (red); grey = no ODiN sample.
  - *Amenity audit* — pick a category in the legend; red→green = under→well-served.
  - *Cycling propensity* — the RQ1 model output mapped spatially (the "intuitive visual marker").
  - The **dashed purple ring** is the selected buurt's 3 km / 10-minute bike-shed.
- **Neighbourhood & Function Audit (bottom-left):** selected buurt's access, usage, model
  propensity, car-risk, population, bike-shed size, and per-category amenity coverage chips;
  plus the most under-served neighbourhoods for the current audit category.
- **"What-If" Scenario Builder (bottom-middle):** sliders → live baseline→scenario deltas
  for cycling propensity, car-risk and amenity gap, with the model + assumptions shown.
- **Policy Assistant (right):** the Gemini agent. Try *"Explain this neighbourhood's
  access–usage gap"*, *"What if we add 3 grocery stores here?"*, *"Compare adding schools
  vs improving accessibility"*, *"Give me a policy recommendation."*

---

## 7. Backend API reference

Base URL `http://127.0.0.1:8000`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | national medians, model list, amenity groups |
| GET | `/api/neighborhoods` | lightweight rows for every buurt (map + audit) |
| GET | `/api/neighborhood/{code}` | full detail for one buurt |
| GET | `/api/search?q=` | name lookup (used by the AI agent) |
| GET | `/api/bikeshed/{code}` | 3 km bike-shed members + centroid |
| POST | `/api/predict` | run a scenario → baseline vs scenario `p_bike`, `car_risk`, amenity gap |

`POST /api/predict` body:
```json
{ "buurtcode": "BU07724210",
  "scenario": { "add_schools": 1, "add_groceries": 3, "add_healthcare": 0,
                "accessibility_pct": 40, "model": "logistic_regression" } }
```

---

## 8. File map

```
urban-dashboard/
├─ app/
│  ├─ page.tsx                 # the whole dashboard UI (Features 1–3)
│  └─ api/chat/route.ts        # Gemini agent + function-calling loop (Feature 5)
├─ components/MapComponent.tsx # Leaflet choropleth + bike-shed ring
├─ lib/api.ts                  # typed client for the backend
├─ public/buurten.geojson      # CBS map geometry (built by fetch_geometry.py)
├─ .env.local                  # GEMINI_API_KEY + NEXT_PUBLIC_BACKEND_URL
└─ backend/
   ├─ build_data.py            # builds the per-neighbourhood feature table
   ├─ fetch_geometry.py        # downloads + slims PDOK geometry
   ├─ main.py                  # FastAPI app (the model API)
   ├─ verify_ui.py             # Playwright smoke test of the rendered dashboard
   ├─ requirements.txt         # Python deps (reproducible)
   ├─ README.md                # backend-specific notes
   └─ data/                    # neighborhoods.parquet, centroids.json, feature_order.json
```

Source data consumed (read-only) from `../../proyect/output/` and the models from
`../../data for topic 3/models/`.

---

## 9. Verification done

- All backend endpoints return valid JSON; `/api/predict` gives directionally-correct,
  bounded deltas across low- and high-access buurten.
- Dashboard compiles and serves `200`; **Playwright smoke test passes with 0 console errors**
  (search → select → detail → bike-shed → live prediction all render).
- Agent end-to-end: a *"what-if 3 groceries + 40% accessibility"* question made Gemini call
  `runScenario`, hit the backend, and answer with real model numbers (Woensel-West
  `p_bike` 0.36 → 0.62) plus a recommendation.

---

## 10. Troubleshooting

- **Map is blank / data missing:** the backend isn't running or is on the wrong port. Check
  `http://127.0.0.1:8000/api/meta` and that `NEXT_PUBLIC_BACKEND_URL` in `.env.local` matches.
- **`AttributeError: multi_class`** when loading the LR model: handled automatically in
  `main.py` (the `.joblib` was trained on an older scikit-learn). Keep `scikit-learn==1.7.2`
  from `requirements.txt`.
- **Agent says "no neighbourhood selected":** select one on the map first — the agent runs
  scenarios on the active buurt.
- **Rebuilding geometry is slow:** `fetch_geometry.py` pages through PDOK (~15 requests);
  give it a minute. It's only needed once.

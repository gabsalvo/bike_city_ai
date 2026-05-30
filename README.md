# 🚲 Bike City AI — Urban Equity Dashboard

An AI-powered decision-support dashboard for the **10-minute biking city**. It turns CBS
neighbourhood data, ODiN mobility data, and trained machine-learning models into an
interactive planning tool: explore biking **access vs usage** across ~14,700 Dutch
neighbourhoods (*buurten*), simulate interventions, and get data-grounded recommendations
from an LLM policy assistant.

> Course project (Topics 1–3): Topic 1 — accessibility analysis · Topic 2 — predictive
> modelling (RQ1 cycling propensity, RQ2 elderly car-dependency) · **Topic 3 — this
> AI-powered dashboard.**

## What's inside

| Path | Description |
|---|---|
| `urban-dashboard/` | Next.js dashboard (the interface) + `backend/` FastAPI model API |
| `urban-dashboard/DASHBOARD_GUIDE.md` | **Full guide:** features, architecture, how to run, findings |
| `data for topic 3/models/` | Trained RQ1/RQ2 models (`.joblib`) + imputers |
| `proyect/` | Topic 1/2 notebooks and processed CBS/ODiN outputs |
| `topic2_final.ipynb` / `.html` | Topic 2 modelling notebook (run) |

## Quick start

```bash
# 1. Model backend (Python)
cd urban-dashboard/backend
pip install -r requirements.txt
python build_data.py        # build the neighbourhood feature table
python fetch_geometry.py    # download CBS map polygons from PDOK
uvicorn main:app --port 8000

# 2. Dashboard (Node) — in a second terminal
cd urban-dashboard
cp .env.example .env.local  # then add your GEMINI_API_KEY
npm install
npm run dev                 # http://localhost:3000
```

See **[`urban-dashboard/DASHBOARD_GUIDE.md`](urban-dashboard/DASHBOARD_GUIDE.md)** for the
full walkthrough, API reference, and the modelling caveats that matter for the report.

## Features

- **Access–Usage Heatmap** — national choropleth with the 3 km "10-minute bike-shed";
  highlights *policy-opportunity* neighbourhoods (good access, low cycling).
- **Essential Function Audit** — toggle amenity categories to see who's under-served.
- **"What-If" Scenario Builder** — add schools/groceries/healthcare or boost accessibility
  and the real RQ1/RQ2 models re-run live.
- **AI Policy Assistant** — a Gemini agent that calls the models and explains results,
  compares scenarios, and writes recommendations.

## Notes

- A 17 GB bike travel-time matrix (`proyect/data/buurt_to_buurt.csv`) is **excluded** from
  the repo by size; it's only needed to regenerate the bike-shed from scratch.
- Secrets live in `urban-dashboard/.env.local` (git-ignored). Never commit it.

🤖 Dashboard built with [Claude Code](https://claude.com/claude-code).

import sys
from playwright.sync_api import sync_playwright

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1500, "height": 950})
    pg.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error",) else None)
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    pg.goto("http://localhost:3000/", wait_until="networkidle", timeout=60000)
    pg.wait_for_timeout(4000)  # let geojson + leaflet render

    # try a search-driven selection
    try:
        pg.fill('input[placeholder*="Search"]', "Woensel")
        pg.wait_for_timeout(1200)
        pg.click("text=Woensel-West", timeout=4000)
        pg.wait_for_timeout(3500)  # detail + bikeshed + predict
    except Exception as e:
        errors.append(f"interaction: {e}")

    # move a scenario slider if present
    try:
        sliders = pg.query_selector_all('input[type=range]')
        print("sliders found:", len(sliders))
    except Exception as e:
        errors.append(f"slider: {e}")

    pg.screenshot(path="ui_check.png", full_page=True)
    # report what's on screen
    body = pg.inner_text("body")
    for kw in ["Woensel-West", "Cycling propensity", "What-If", "Policy Assistant", "bike-shed"]:
        print(f"  has '{kw}':", kw.lower() in body.lower())
    b.close()

print("CONSOLE ERRORS:", len(errors))
for e in errors[:15]:
    print("  -", e[:200])
sys.exit(0)

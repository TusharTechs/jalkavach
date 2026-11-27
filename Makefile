.PHONY: setup test demo demo-check app web dashboard replay physics eval report clean

setup:            ## install pinned environment
	uv sync --frozen

test:             ## run unit tests (offline, uses committed cache)
	uv run pytest

demo:             ## run the offline demo
	uv run python -m jalkavach

eval:             ## run the pre-registered evaluation (ward + Net3)
	uv run python -m harness.run
	uv run python -m harness.run --topology net3

report:           ## tables and figures from the last eval
	uv run python -m harness.report --tag ward --tag net3

demo-check:       ## pre-stage check: endpoints, story path, speech model, web build freshness
	uv run python scripts/demo_check.py

app:              ## JalKavach command centre at http://localhost:8036 (offline; uses committed web/dist)
	uv run uvicorn app.server:app --host 127.0.0.1 --port 8036

web:              ## rebuild the web front end (needs Node 22 + pnpm)
	cd web && pnpm install && pnpm build

dashboard:        ## legacy Streamlit dashboard (offline)
	uv run streamlit run app/dashboard.py

replay:           ## rebuild the dashboard replay scenario
	uv run python -m jalkavach.demo

physics:          ## rebuild OSM/elevation/hydraulics cache (needs network)
	rm -f data/cache/physics_*.npz
	uv run python -c "from jalkavach.context import build_context; build_context('demo_ward')"

clean:
	rm -rf .pytest_cache **/__pycache__

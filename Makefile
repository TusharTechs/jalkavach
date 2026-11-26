.PHONY: setup test demo dashboard replay physics eval report clean

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

dashboard:        ## Streamlit dashboard (offline)
	uv run streamlit run app/dashboard.py

replay:           ## rebuild the dashboard replay scenario
	uv run python -m jalkavach.demo

physics:          ## rebuild OSM/elevation/hydraulics cache (needs network)
	rm -f data/cache/physics_*.npz
	uv run python -c "from jalkavach.context import build_context; build_context('demo_ward')"

clean:
	rm -rf .pytest_cache **/__pycache__

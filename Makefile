.PHONY: setup test demo physics eval report clean

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

physics:          ## rebuild OSM/elevation/hydraulics cache (needs network)
	rm -f data/cache/physics_*.npz
	uv run python -c "from jalkavach.context import build_context; build_context('demo_ward')"

clean:
	rm -rf .pytest_cache **/__pycache__

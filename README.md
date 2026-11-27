# JalKavach

**Early warning and pipe-segment localisation for sewage ingress in intermittent urban water networks.**

Indian cities already collect warning signs that tap water is being contaminated: citizen complaints (311, CM Helpline 181, ward offices), field water tests, and pharmacy sales of ORS. These signals sit in separate places. They arrive as isolated tickets that no system clusters, locates or escalates.

JalKavach joins them into one ward-level alert. Each alert carries:

- the **most likely pipe segments**,
- a **clock the city sets**,
- an **owner**, and
- an **audit trail**.

> Status: hackathon prototype for BUILD 2036 (TiE Global Summit 2026), Frontier 06: The Rise of New India. Every result below is simulated, not field data.

![JalKavach architecture](docs/architecture.png)

**Docs:**
- [Impact case](docs/IMPACT_CASE.md)
- [Evaluation results](results/RESULTS.md)
- [Pre-registration](harness/PREREGISTRATION.md)
- [Escalation policy](configs/escalation.yaml)
- [Pilot pack: champion, request letter, stage Q&A](docs/PILOT_PACK.md)

## How it works

| Layer | What it does | Data provenance |
|---|---|---|
| Network twin | The demo ward is "Ward 00 · Demo Nagar": real streets from Nipania (Tulsi Nagar area), a post-2000 residential colony in east Indore not linked to any reported event. It builds the street graph from OpenStreetMap, then a pipe network along those streets, and runs EPANET 2.2 (via WNTR) with **pressure-dependent demand** and **intermittent supply windows**. | Streets: **real** (OSM). Elevation: **real** (Copernicus DEM via Open-Meteo). Pipes, sewers, ages: **synthetic**, seeded, constrained to the streets. Landmarks carry **generic labels only** ("Park", "Medical store B"); no business names, and places of worship are never used as landmarks. |
| Exposure prior | Scores each location by pipe age, sewer alongside, and *pressure-deficit hours*. The deficit is an exposure feature informed by Kumpel & Nelson's intermittent-supply field work, swept over 5/10/15 psi. | Derived |
| Reachability | Runs one EPANET source-trace simulation per candidate ingress location, giving the share of each node's consumed water that passed through it. | Derived |
| Bayesian engine | Computes a joint posterior over *(location × onset day × intensity)* plus an explicit **no-event** hypothesis. Complaints and pharmacy counts use negative-binomial likelihoods with delay and geocoding kernels. Field tests are kit-agnostic: chlorine (read instantly) or H2S (read the next day). Low chlorine at the network's tail ends is treated as normal and modelled, never assumed to mean contamination. | — |
| Escalation | The city sets owners, SLAs and the escalation chain (`configs/escalation.yaml`). JalKavach runs the clock, drafts the work order and the Hindi/English advisory (a human approves and sends them), and records everything in a hash-chained audit log. | — |
| Complaint intake | Local Hindi speech recognition (faster-whisper), offline extraction of colour, odour, symptoms and place that tolerates ASR spelling variants, and phonetic fuzzy geocoding to OSM landmarks and streets. | Demo voice clips: synthetic (TTS) |
| Field-test reader | A printable card with ArUco markers, white balance and the kit's colour scale. It screens a photo against the IS 10500 limit of 0.2 mg/L free chlorine, or flags H2S-vial blackening. Screening only. | Validated on synthetic photos only. **Lab validation pending.** |

Hospital admissions are **not** an input to the detector. They are the baseline that detection lead time is measured against.

## Results (simulated, held-out; full tables in [`results/RESULTS.md`](results/RESULTS.md))

The evaluation design was pre-registered before the first run: [`harness/PREREGISTRATION.md`](harness/PREREGISTRATION.md). Test scenarios use 10 perturbed networks, a clustered complaint process the engine does not assume, continuous intensities, and true ingress locations drawn from a risk model whose form differs from the engine's prior. The demo ward has 720 event and 400 no-event scenarios. 95% bootstrap CIs are in brackets.

| Question (demo ward, ≤1 false alarm per ward per quarter) | Result |
|---|---|
| Alarm lead over a hospital-admissions-only baseline (median, paired; its misses counted at day 21) | **7.0 [6.0–8.0] days** |
| Events detected within 21 days: fusion vs. hospital baseline | **90%** vs. 44% |
| Events detected: fusion minus complaint-count exceedance (paired) | **+22 [16–28] points** (at ≤1 false alarm per *month*: +2 [−2 to +5], not significant) |
| True junction (of 246) in the top 3 three days after the alarm: fusion vs. complaint-centroid baseline | **39%** vs. 6% |
| Fusion minus complaints-only, same metric (paired) | **+13 [6–19] points** |
| Coverage of the 90% credible set | 93% [89–96] |
| Robustness topology (EPANET Net3): lead over the hospital baseline; top-3 | 5.0 [4.0–6.0] days; 68% |

**The demo ward moved twice, for reasons unrelated to results** (see the change log in the pre-registration). Every ward is reported, not just the current one. Detection is stable; localisation gets harder as the ward grows:

| Demo ward (as reported at the time; see the change log for what changed between runs) | Junctions | Lead vs. hospital | Detected | vs. count alarm | Top-3 (centroid) |
|---|---|---|---|---|---|
| 1st: site of a real 2025–26 outbreak, withdrawn | 84 | 7.0 [6–8] d | 94% | +13 [8–18] | 67% (12%) |
| 2nd: old-city ward, withdrawn as politically sensitive | 146 | 5.0 [4–6] d | 85% | +16 [11–21] | 57% (13%) |
| **3rd: Nipania (current)** | 246 | **7.0 [6–8] d** | **90%** | **+22 [16–28]** | **39% (6%)** |

**What did not work as well, reported as measured:**
- **Detection timing.** It is driven by complaints. Fusion alarms no earlier than complaints alone or a simple complaint-count exceedance detector. Fusion also catches no **more** events than complaints alone (90% vs. 90%): the +22 points are the engine's complaint model vs. a simple count alarm. Fusion's own gain is **where**: 39% vs. 26% top-3.
- **Intermittent-supply prior vs. a 24×7-style prior.** +3.2 points of top-3 accuracy, with a CI of −0.9 to +7.4. **Not significant.** The informed prior beats a uniform one by only +3.7 [−1.4 to +8.3] points.
- **Ward size.** On this 246-junction ward, top-3 localisation is 39%; on the smaller EPANET Net3 it is 68%. Bigger wards need more field tests.
- **Information-gain field-test routing: mixed evidence, both runs reported.** In the pre-registered ablation (76 usable events) it was no better than random (median 6 vs. 6 tests; mean 8.9 vs. 9.4). A larger run, declared in the change log before it ran (fresh seeds, 280 usable events, unchanged code), found it ahead: the true junction reached the top 3 within 10 days in 66% of events vs. 55% for random taps (+11 points, 95% CI 6–16; tests to top 3: median 8 vs. 14, mean 11.2 vs. 12.9, with "never" counted as 21). Pooled over both runs (356 events): 68% vs. 59%, about +9 points. Random's own rate moved from 75% to 55% between samples, so sampling noise is large: read this as supportive, not definitive. The nearest-complaint baseline was not re-run. `results/routing_extension.json`.
- **Equity.** Where the exposed population reports less, fusion detects 84% of events, vs. 94% elsewhere.
- **Geocoding precision matters.** With 250 m geocoding error, top-3 localisation falls to 20% (60% at 60 m). Ambiguous landmarks are therefore never auto-pinned: the officer chooses.
- **Small exposures.** Ingress that reaches only a few dozen residents is rarely detectable from complaints.

Reproduce: `make eval` (about 3 minutes on 8 cores), then `make report`.

## Quick start

```bash
make setup   # uv sync --frozen (Python 3.12)
make test    # offline, uses committed cache in data/cache
make demo    # offline demo scenario (CLI)
make app         # command centre at http://localhost:8036 (offline; serves the committed web/dist)
make web         # rebuild the web front end (Node 22 + pnpm)
```

### Command centre

`make app` serves a React + deck.gl command centre on top of the engine. It has:

- **3D ward twin:**
  - extruded OSM buildings
  - pipes coloured by probability
  - simulated water flow during supply hours only
  - a low-pressure exposure layer when supply is off
  - the predicted plume if the #1 junction is the source
  - absolute probability columns
- **Alert:** calibrated to ≤1 false alarm per ward per quarter. Playback pauses when it opens, the camera flies to the likely pipes, and a "search area" metric shows how much pipe is left to test first (results are unconfirmed until field tests).
- **Intake:**
  - Hindi voice notes transcribed live on the laptop with faster-whisper (or recorded on the microphone)
  - extraction and ambiguity-aware landmark geocoding
  - the field-card photo reader
- **City escalation clock:** owners, SLAs and the escalation chain set in `configs/escalation.yaml`; drafts need human approval; a printable export pack.
- **Hash-chained audit trail:** with a live tamper test.
- **Evidence and 2036 views.**

All state is a pure function of (day, hour, recorded actions), so scrubbing the timeline is always consistent.

**Presenter controls:**
- Story mode (`P`): a hands-free, narrated walkthrough of about 75 seconds.
- `←`/`→` change the day; `space` plays or pauses.
- `1`–`6` switch views.
- `S` stage mode (larger type), `H` Hindi, `R` reveal the simulated truth.
- Fallback video: `make video` records story mode with narration to `media/jalkavach_story.mp4`.

Deep links: `/?view=command&day=7&hour=18`, `&stage`, `&lang=hi`, `&reset`.

The legacy Streamlit dashboard is still available: `make dashboard`.

## Honest limitations

- The pipe topology is synthetic. It is constrained to real streets but is not the utility's network. Given one ward's network map and complaint log, the synthetic layers can be replaced.
- Every performance number comes from simulated scenarios, not field data. The harness uses model mismatch and a complaint process different from the one the engine assumes, to avoid grading the model on its own assumptions. The scenario parameters (complaint rates, pharmacy response) are assumptions, documented in `src/jalkavach/signals.py` and swept where it matters.
- The second topology (EPANET Net3) is a standard benchmark used for robustness only. It is not an Indian network.
- EPANET is a full-pipe solver. We do not simulate pipes draining and refilling.
- "No alert" does not mean "safe". Ingress at dead-end lanes that reach only a few dozen residents produces too few complaints to detect; routine field tests are the only safeguard there.

## Prior work we build on

- The US EPA's Water Quality Surveillance and Response Systems piloted multi-signal contamination warning: customer complaints, public-health surveillance and online sensors. Their evaluations showed each signal alone is noisy.
- Bayesian contamination source identification on water networks is established in the literature.
- JalKavach adapts these ideas to **chronic ingress on intermittent Indian networks** and measures its contribution with ablations.

## License

Apache-2.0. No patents are filed or planned: the engine is meant to be reused by any city, toward the Digital Public Goods standard.

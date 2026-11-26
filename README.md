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

## How it works

| Layer | What it does | Data provenance |
|---|---|---|
| Network twin | Builds the street graph from OpenStreetMap, then a pipe network along those streets, and runs EPANET 2.2 (via WNTR) with **pressure-dependent demand** and **intermittent supply windows**. | Streets: **real** (OSM). Elevation: **real** (Copernicus DEM via Open-Meteo). Pipes, sewers, ages: **synthetic**, seeded, constrained to the streets. |
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
| Alarm lead over a hospital-admissions-only baseline (median, paired) | **7.0 [6.0–8.0] days** |
| Events detected within 21 days: fusion vs. hospital baseline | **94%** vs. 52% |
| Events detected: fusion minus complaint-count exceedance (paired) | **+13 [8–18] points** |
| Likely pipe in the top 3 three days after the alarm: fusion vs. complaint-centroid baseline | **67%** vs. 12% |
| Fusion minus complaints-only, same metric (paired) | **+13 [8–19] points** |
| Coverage of the 90% credible set | 95% [92–98] |
| Robustness topology (EPANET Net3): lead over the hospital baseline | 5.0 [4.0–6.0] days |

**What did not work as well, reported as measured:**
- **Detection timing.** It is driven by complaints. Fusion alarms no earlier than complaints alone or a simple complaint-count exceedance detector. Fusion's gains come in **how many** events are caught and **where** the problem is located, not in how early the alarm fires.
- **Intermittent-supply prior vs. a 24×7-style prior.** +2.7 points of top-3 accuracy, with a CI of −0.9 to +6.2. **Not significant.** Any informed prior beats a uniform one (+9.7 [4.4–15.0]) when ingress follows age, sewer and pressure risk. It costs −6.6 [−14.2–0.0] points when ingress is unrelated to those drivers.
- **Information-gain field-test routing.** It needed slightly fewer tests on average than random sampling (7.8 vs. 9.2), but the CIs overlap.
- **Equity.** Where the exposed population reports less, fusion detects 89% of events, vs. 96–98% elsewhere.
- **Geocoding precision matters.** With 250 m geocoding error, top-3 localisation falls to 34%.

Reproduce: `make eval` (about 3 minutes on 8 cores), then `make report`.

## Quick start

```bash
make setup   # uv sync --frozen (Python 3.12)
make test    # offline, uses committed cache in data/cache
make demo    # offline demo scenario (CLI)
make dashboard   # Streamlit dashboard at http://localhost:8501 (offline)
```

The dashboard has five tabs:
- **Ward map:** replay by day.
- **Alert & escalation:** the city clock, owners and drafts.
- **Intake:** voice notes and kit photos, which update the posterior live.
- **Results.**
- **Audit log:** includes a tamper test.

The replay scenario was chosen to be *typical*. Its detection delay and localisation match the harness medians (`src/jalkavach/demo.py`).

## Honest limitations

- The pipe topology is synthetic. It is constrained to real streets but is not the utility's network. Given one ward's network map and complaint log, the synthetic layers can be replaced.
- Every performance number comes from simulated scenarios, not field data. The harness uses model mismatch and a complaint process different from the one the engine assumes, to avoid grading the model on its own assumptions. The scenario parameters (complaint rates, pharmacy response) are assumptions, documented in `src/jalkavach/signals.py` and swept where it matters.
- The second topology (EPANET Net3) is a standard benchmark used for robustness only. It is not an Indian network.
- EPANET is a full-pipe solver. We do not simulate pipes draining and refilling.
- "No alert" does not mean "safe".

## Prior work we build on

- The US EPA's Water Quality Surveillance and Response Systems piloted multi-signal contamination warning: customer complaints, public-health surveillance and online sensors. Their evaluations showed each signal alone is noisy.
- Bayesian contamination source identification on water networks is established in the literature.
- JalKavach adapts these ideas to **chronic ingress on intermittent Indian networks** and measures its contribution with ablations.

## License

Apache-2.0

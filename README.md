# JalKavach

**Early warning and pipe-segment localisation for sewage ingress in intermittent urban water networks.**

Indian cities already collect warning signs that tap water is being contaminated: citizen complaints (311, CM Helpline 181, ward offices), field water tests, and pharmacy sales of ORS. These signals sit in separate places. They arrive as isolated tickets that no system clusters, locates or escalates.

JalKavach joins them into one ward-level alert. Each alert carries:

- the **most likely pipe segments**,
- a **clock the city sets**,
- an **owner**, and
- an **audit trail**.

> Status: hackathon prototype (BUILD 2036). The engine and the evaluation harness are under active development.

## How it works

| Layer | What it does | Data provenance |
|---|---|---|
| Network twin | Builds the street graph from OpenStreetMap, then a pipe network along those streets, and runs EPANET 2.2 (via WNTR) with **pressure-dependent demand** and **intermittent supply windows**. | Streets: **real** (OSM). Elevation: **real** (Copernicus DEM via Open-Meteo). Pipes, sewers, ages: **synthetic**, seeded, constrained to the streets. |
| Exposure prior | Scores each location by pipe age, sewer alongside, and *pressure-deficit hours*. The deficit is an exposure feature informed by Kumpel & Nelson's intermittent-supply field work, swept over 5/10/15 psi. | Derived |
| Reachability | Runs one EPANET source-trace simulation per candidate ingress location, giving the share of each node's consumed water that passed through it. | Derived |
| Bayesian engine | Computes a joint posterior over *(location × onset day × intensity)* plus an explicit **no-event** hypothesis. Complaints and pharmacy counts use negative-binomial likelihoods with delay and geocoding kernels. Field tests are kit-agnostic: chlorine (read instantly) or H2S (read the next day). Low chlorine at the network's tail ends is treated as normal and modelled, never assumed to mean contamination. | — |
| Escalation | Drafts work orders and advisories (a human approves and sends them), runs an SLA clock and keeps a hash-chained audit log. | *In progress* |

Hospital admissions are **not** an input to the detector. They are the baseline that detection lead time is measured against.

## Quick start

```bash
make setup   # uv sync --frozen (Python 3.12)
make test    # offline, uses committed cache in data/cache
make demo    # offline demo scenario
```

## Honest limitations

- The pipe topology is synthetic. It is constrained to real streets but is not the utility's network. Given one ward's network map and complaint log, the synthetic layers can be replaced.
- Every performance number comes from simulated scenarios. The harness uses model mismatch and a complaint process different from the one the engine assumes, to avoid grading the model on its own assumptions.
- EPANET is a full-pipe solver. We do not simulate pipes draining and refilling.
- "No alert" does not mean "safe".

## Prior work we build on

- The US EPA's Water Quality Surveillance and Response Systems piloted multi-signal contamination warning: customer complaints, public-health surveillance and online sensors. Their evaluations showed each signal alone is noisy.
- Bayesian contamination source identification on water networks is established in the literature.
- JalKavach adapts these ideas to **chronic ingress on intermittent Indian networks** and measures its contribution with ablations.

## License

Apache-2.0

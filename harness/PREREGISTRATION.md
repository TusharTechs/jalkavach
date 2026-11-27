# Evaluation pre-registration

Written **before** the first harness run (26 Nov 2026). It was committed in the same commit as the first results, so git alone cannot prove the order. The design below was not changed by those results, except where logged at the bottom with the reason.

## Questions
1. **Detection.** Does fusing complaints, field tests and pharmacy counts detect a sewage-ingress event earlier than a hospital-admissions-only baseline, at a fixed false-alarm budget?
2. **Fusion.** Does fusion beat the best single signal at the same false-alarm budget?
3. **Intermittent-supply prior (ablation 1).** Does an exposure prior that includes the pressure-deficit feature localise better than a 24×7-style prior (age + sewer only)? Does it beat a uniform prior?
4. **Routing (ablation 3).** After an alert, does information-gain test routing need fewer field tests to get the true location into the top 3 than random or nearest-complaint sampling?
5. **Calibration.** Do the 90% credible sets contain the true location about 90% of the time?

## Scenario distribution (held out from the engine)
- Horizon: 21 days. Onset day t0 ~ U{3..10}.
- **True ingress location.** Drawn from a *physical risk model* with a different functional form from the engine's prior:
  `risk ∝ sewer_share × sigmoid(pressure deficit) × (age/60)^0.5 + 0.02`
  The prior is additive in z-scores; this risk model is multiplicative. We also report results with locations drawn **uniformly**.
- **Intensity.** Continuous, I ~ U(0.03, 0.5). The engine only knows the grid {0.05, 0.15, 0.4}.
- **Ramp days.** U{1..5}. The engine assumes 3.
- **Complaint process.** Generated with the **clustered** model (Poisson × Gamma bursts), not the engine's negative binomial.
  - Rate × U(0.5, 2) relative to the engine.
  - Delay mean ~ U(0.5, 3) days. The engine assumes 1.5.
  - Geocode radius ~ U(60, 250) m. The engine assumes 120.
- **Reporting propensity.** The true per-node value is the engine's value × U(0.6, 1.4) noise (clipped).
- **Network mismatch (K = 10 perturbed networks).**
  - Roughness × U(0.7, 1.3) per pipe.
  - 20% of pipes get the wrong diameter tier.
  - Junction demand × U(0.7, 1.3).
  - Each perturbed network gets a recomputed trace tensor and chlorine baseline for the *generator*. The engine always uses the nominal network.
- **Pharmacy.** Lag ~ U(1, 4) days; rate × U(0.5, 2).
- **Field tests (chlorine kit, read immediately).**
  - Routine: 1 random tap per day per ward.
  - Complaint-triggered: next day, at the geocoded node of up to 2 complaints per day.
  - The same for every method.
- **No-event runs:** same distributions, no ingress. Used to calibrate alarm thresholds.

## Alarm calibration
- Each method gets its own threshold so that **≤1 false-alarm episode per ward per quarter** (90 days) on no-event runs. We also report results at ≤1 per ward per month.
- An episode is the first threshold crossing in a 21-day no-event run.
- The rate is scaled as `P(any alarm in run) × 90 / 21`.

## Methods
| ID | Method |
|---|---|
| F | Fusion posterior (complaints + tests + pharmacy), intermittent prior |
| C | Posterior, complaints only |
| T | Posterior, field tests only |
| S | Posterior, pharmacy only |
| H | **Baseline:** hospital admissions, EARS-C2-style exceedance on daily counts (7-day baseline, 2-day guard) |
| CC | **Baseline:** complaint count exceedance (EARS-C2) for detection; complaint-centroid for localisation |
| F-24x7 | F with the 24×7 prior (no pressure term) |
| F-unif | F with a uniform prior |

## Metrics (all with 95% bootstrap CIs, 2,000 resamples)
- **Headline:** median detection lead time of F over H (days), on paired scenarios at the quarterly false-alarm budget. A missed detection counts as detection at day 21 (censored); the censoring rate is reported.
- Detection delay (days after onset) per method, and the share detected within the horizon.
- Top-3 localisation accuracy at the detection day and at detection + 3 days.
- **Ablation 1:** top-3 accuracy, F vs F-24x7 vs F-unif, on (a) physical-risk truth and (b) uniform truth.
- **Ablation 3:** number of routed field tests (2 per day after the first alarm) until the truth enters the top 3. Info-gain vs random vs nearest-complaint.
- **Calibration:** coverage of the 90% credible set at the detection day, plus a reliability diagram over 10 bins of the predicted p(location).
- **Sensitivity sweeps:** complaint delay mean {0.5, 1.5, 3}, geocode radius {60, 120, 250} m, psi {5, 10, 15}.
- **Equity:** detection delay split by the reporting-propensity tercile of the population exposed.
- **Failure cases:** missed and mislocalised scenarios, with their parameters, published in `results/failures_ward.csv` and `results/failures_net3.csv`.

## Second topology (robustness only)
- EPANET example network Net3, 24×7 supply, uniform prior, same signal-mismatch distribution.
- Ingress scenarios on Net3 are ours. It is **not** an India-realism benchmark.

## Change log
- **26 Nov, after the development (quick) run, before the held-out run.**
  - **Calibration.** On development seeds, coverage of the 90% credible set was 74–82%, so the engine was overconfident under misspecification.
  - **Change.** Added complaint-likelihood tempering (`complaint_temper = 0.4`), chosen on development seeds 500–579 to bring coverage to about 0.89. It did not change top-3 accuracy (0.55–0.57 across the temper values tried).
  - **Seeds.** The held-out run now uses fresh seeds (base 100,000), disjoint from the development seeds (1,000–31,000 and 500–579).
  - **Metrics.** No metric, threshold or scenario distribution was changed.
- **26 Nov, ward relocation.**
  - The demo ward was moved from its first location, labelled "Ward 00 · Demo Nagar". The first location coincided with the site of a real 2025–26 outbreak, which was inappropriate for a public demonstration.
  - The new ward is larger: 146 junctions vs. 84. Its trunk mains gained a 300 mm diameter tier so that pressures stay physical.
  - The full pre-registered evaluation was re-run **unchanged** on the new ward with the same held-out seeds. All numbers reported now come from that run.
  - The escalation policy now notifies every 24 h (previously 12 h). This does not affect any metric.
- **27 Nov, second ward relocation and engine fixes (reviewer findings).**
  - The 26 Nov location was mis-described: its streets are in Indore's old city (Lalbagh / Moti Tabela), not Scheme No. 78. It was moved to Nipania (Tulsi Nagar area), a post-2000 residential colony, after checking reporting for any linked event. Places of worship were removed from the landmark gazetteer.
  - Causality fix in the web service only: evidence is admitted by its timestamp, so an action after a day's 18:00 run counts toward the next run. The harness never used the service, so no metric definition changed.
  - The full pre-registered evaluation was re-run **unchanged** on the new ward with the same held-out seeds. The ward is larger (246 junctions vs. 146): lead rose to 7.0 days and detection to 90%, while top-3 localisation fell to 39%. Both are reported as measured.
  - Bootstrap CIs now use a separate seeded stream per topology, so re-running one topology never shifts another's intervals.

- **27 Nov, routing power extension (declared before running).**
  - The held-out routing ablation (120 specs, 76 usable events) showed info-gain ≈ random (76% vs 75% reaching the top 3). Development seeds (56 usable events) showed info-gain ahead (82% vs 61%). Both samples are small.
  - **Plan, fixed now:** run `harness/route_extension.py` once on fresh seeds 300,000–300,399 (400 specs), policies info-gain and random, 2 routed tests/day for up to 10 days, unchanged engine and routing code. Primary measure: share reaching the top 3 within 10 days, paired difference with a 95% bootstrap CI; secondary: tests to top 3 (median, mean).
  - The result is reported in README and the app whatever it shows. The original ablation stays reported as it is.
  - A batch-aware variant was tried on development seeds only and did not beat plain info-gain (75% vs 82%); it is not used.
  - **Result (run once, as declared):** 280 usable events. Reached the top 3 within 10 days: info-gain 66%, random 55%; paired difference +11 points [6–16]. Tests to top 3: median 8 vs. 14, mean 11.2 vs. 12.9. `results/routing_extension.json`.

**Headline results on every demo ward used** (reported together so that no ward is selected for its numbers):

| Demo ward (as reported at the time; see the change log for what changed between runs) | Junctions | Lead vs. hospital | Detected | vs. count alarm | Top-3 (centroid) |
|---|---|---|---|---|---|
| 1st: site of a real 2025–26 outbreak, withdrawn | 84 | 7.0 [6–8] d | 94% | +13 [8–18] | 67% (12%) |
| 2nd: old-city ward, withdrawn as politically sensitive | 146 | 5.0 [4–6] d | 85% | +16 [11–21] | 57% (13%) |
| **3rd: Nipania (current)** | 246 | **7.0 [6–8] d** | **90%** | **+22 [16–28]** | **39% (6%)** |

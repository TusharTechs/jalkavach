# JalKavach: impact case

**Frontier 06, The Rise of New India.** Civic governance and clean urban infrastructure, starting with Indore and Madhya Pradesh.

## 1. The problem: the signal existed, the escalation didn't

- In December 2025, sewage entered a drinking-water line in a ward of Indore.
- Press reports describe weeks of foul-water complaints before the outbreak.¹ They arrived as isolated tickets on helplines and in ward offices. No system could cluster them, place them on a pipe map, or escalate them.
- Hundreds of people were hospitalised, and families lost people.²
- The same pattern recurs elsewhere:
  - Gandhinagar typhoid outbreak, January 2026: more than 100 cases, linked to new pipeline leaks near sewer lines.³
  - Pune Guillain-Barré syndrome outbreak, 2025: 202 cases, with contaminated water sources among the suspected routes.⁴
- Indian city networks run on **intermittent supply**. Pipes sit at low pressure for most of the day, often in the same trench as sewers, which is when ingress happens.⁵
- Urban networks have **no continuous water-quality sensing**.
  - Jal Jeevan Mission's quality system is rural and lab-sample based.⁶
  - After the outbreak, Madhya Pradesh's urban department sent testing kits to its cities. Its 9,801 trained Amrut Mitras ran 80,976 ward-level tests.⁷ We found no public digital record that pools these results.

## 2. What JalKavach does

JalKavach joins signals the city **already collects** into one ward-level alert:

- complaints (311, CM Helpline 181, Jal Sunwai, voice notes in Hindi)
- Amrut Mitra field tests
- aggregate ORS sales from partner pharmacies, where they agree to share them

Each alert carries:

- the **most likely pipe segments**, ranked
- **a clock the city sets**, with an owner for every stage and automatic escalation when a stage is overdue
- **suggested next test points** for the field team
- **draft** work orders and Hindi/English advisories, which an officer approves and sends
- a **tamper-evident audit trail**, which records that the engineer who acted, acted on time

## 3. Evidence (simulated, held-out, pre-registered)

The evaluation design was fixed before the first run (`harness/PREREGISTRATION.md`). The test scenarios use:

- perturbed pipe networks
- a complaint process the engine does not assume
- true ingress locations drawn from a different risk model than the engine's own

All results below are at **≤1 false alarm per ward per quarter**. Brackets are 95% bootstrap confidence intervals.

| | JalKavach | Baseline |
|---|---|---|
| Median alarm lead over hospital admissions (its misses counted at day 21) | **7.0 [6.0–8.0] days** | — |
| Events detected within 21 days | **90%** | 44% (hospital-only) |
| Events detected, vs. simple complaint-count alarm | **+22 [16–28] points** (monthly budget: +2, not significant) | — |
| True junction (of 246) in top 3, 3 days after alert | **39%** | 6% (complaint centroid); 26% (complaints only) |
| 90% credible sets that contain the truth | 93% | — |
| Robustness network (EPANET Net3): lead | 5.0 [4.0–6.0] days | — |

**Limits we report ourselves:**

- Fusion does not alarm *earlier* or catch *more* events than complaints alone (90% vs. 90%). Its own gain is *where*: 39% vs. 26% top-3. The +22 points are the engine vs. a simple count alarm.
- The intermittent-supply prior does not beat a 24×7 prior significantly: +3.2 points, CI −0.9 to +7.4.
- Localisation is harder in bigger wards: 39% top-3 on 246 junctions vs. 68% on EPANET Net3.
- The demo ward moved twice (first site matched a real outbreak; second was politically sensitive). Results on all three are in the README; top-3 went 67% → 57% → 39% as the ward grew from 84 to 246 junctions.
- Detection is lower where people report less: 84% vs. 94%.
- Ingress reaching only a few dozen residents is rarely detectable from complaints.
- All of these results are simulated. None is field data.

## 4. Cost and break-even

**Price**
- ₹12 lakh one-time city onboarding: GIS, calibration, field cards, 6 months of operations.
- Then **₹1.5–2 lakh per ward per year**.
- Indore's 85 wards: about ₹1.3–1.7 crore a year.

**Cost of one event.** Lower bound, counting published items only:

| Item | Basis | Range |
|---|---|---|
| Compensation | ₹2 lakh × 18–21 families² | ₹36–42 lakh |
| Hospital care | ~400 admissions⁸ × ₹6,000–15,000 per diarrhoeal admission⁹ | ₹24–60 lakh |
| Emergency pipe works, testing, lost wages | not published | not counted |
| **Total (lower bound)** | | **₹60 lakh – ₹1 crore** |

**Break-even.** One averted event of this scale pays for roughly **30–65 ward-years** of JalKavach. This is a lower bound, and it is not a promise. Detection is not prevention: an alert only helps if the clock is acted on.

## 5. Adoption path

| Stage | Who | How it is funded |
|---|---|---|
| Pilot (1 ward) | Indore Municipal Corporation water works, with the District Surveillance Officer as data partner | CSR. **No procurement needed.** |
| City (85 wards) | IMC / Indore Smart City command centre | AMRUT 2.0 operations and maintenance; 15th Finance Commission tied water grants |
| State | MP Urban Development (UADD), which already distributes kits to all ULBs | State rate contract (route to be confirmed) |
| India | AMRUT cities; mela and temporary networks; JJM villages, where field-test photos already exist | Open engine (Apache-2.0, built to the Digital Public Goods standard) plus a managed service |

**What we will not do:**
- sell through the pipe contractor, because that is a conflict of interest
- send any public message without an officer's approval
- publish ward-level "safety status" before the city chooses to

## 6. 2036

Tap-water safety becomes as visible to a city as its air quality index, published at the city's discretion. The path:

1. One ward in Indore.
2. When Ujjain hosts Simhastha 2028, the temporary networks are covered.
3. Every AMRUT city by 2036.

---

¹ Free Press Journal (2 Jan 2026), ThePrint and others report weeks of complaints before the outbreak; exact dates vary across reports.
² A one-member judicial commission reportedly linked more than twenty deaths to contaminated water (ThePrint, Deccan Chronicle, 2026). The state's figures differ. Relief payments were reported to 18 families (Collector, FPJ) and later to 21 (submission to the High Court, TOI).
³ The Wire / The Tribune, Jan 2026.
⁴ Lokmat Times, 2025. The NIV later also implicated food sources.
⁵ Kumpel & Nelson's work on intermittent supply in Hubli-Dharwad links low pressure to indicator bacteria.
⁶ CAG audit, 2026, chapter on water-quality monitoring and surveillance.
⁷ Millennium Post, 28 Jan 2026. The kit type was not specified.
⁸ Onmanorama / Outlook, Jan 2026: 398 hospitalised.
⁹ An assumption range. An Odisha teaching-hospital study reports a median out-of-pocket cost of ₹6,385 per under-five diarrhoea admission; adult and ICU stays cost more.

Sources are press and audit reports as cited; where reports disagree, the range is given. Field figures (cost, deaths, hospitalisations) are not ours and are not used anywhere in the evaluation.

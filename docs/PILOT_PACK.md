# Pilot pack: champion, request letter and stage Q&A

## 1. Champion and advisors (to be filled in by the team; no names are invented here)

A pilot needs one named person inside or close to the city. Approach in this order:

| Role | Why them | Status |
|---|---|---|
| Retired Executive / Superintending Engineer, IMC Water Works (Jalprada) | Knows the network map, the trench layout and how complaints reach the ward office | _name, date approached_ |
| District Surveillance Officer, IDSP Indore | Owns outbreak signals; is "informed" in our escalation policy | _name, date approached_ |
| Faculty in public health or environmental engineering (e.g. a local medical or engineering college) | Independent validation partner for the pilot evaluation | _name, date approached_ |
| Ward councillor (पार्षद) of the pilot ward | Residents' trust; an information copy of advisories (city decides) | _name, date approached_ |

Only list a person on a slide after they have agreed in writing.

## 2. Pilot request letter (template)

> To: The Commissioner, Indore Municipal Corporation
> Copy: Superintending Engineer, Water Works; District Surveillance Officer
>
> Subject: Request to name one ward for a 6-month pilot of JalKavach (early warning for sewage ingress)
>
> JalKavach joins signals the city already collects (helpline and ward complaints, Amrut Mitra field tests) into one ward-level alert with ranked pipe locations, a city-set response clock and a tamper-evident record. It sends nothing to the public: every advisory needs the Health Officer's approval.
>
> We ask the corporation to name one pilot ward and provide: that ward's pipe network map, an export of its water-quality complaints (311 / CM Helpline 181 / Jal Sunwai), and the SLA and escalation chain it wants enforced. Pharmacy data is optional.
>
> The pilot is CSR-funded and needs no procurement. The engine is open source (Apache-2.0). Results of the pilot will be published only at the city's discretion.
>
> _Name, contact, date_

## 3. Stage Q&A (answers from our own results; all simulated)

**"You moved the ward and the lead improved. Ward-shopping?"**
The ward moved twice for site sensitivity: the first site matched a real outbreak, the second was politically sensitive. All three results are published side by side in the README; top-3 localisation fell (67% → 57% → 39%) as the ward grew. Lead has stayed in the 5–7 day range.

**"The 7-day lead counts the hospital baseline's misses as day 21."**
Yes: the hospital-only baseline misses 56% of events within 21 days. Among the 98 events both methods catch, JalKavach's median lead is **4.0 days [3–5]**.

**"Why not a 311 dashboard plus a simple count alarm?"**
At the same false-alarm budget (≤1 per ward per quarter), JalKavach catches 22 [16–28] points more events than a count alarm. At a monthly budget the gain is +2 and not significant. It also says *where*: 39% top-3 vs 6% for a complaint centroid. It needs no hardware, only tickets the city already gets.

**"What if pharmacies won't share data?"**
Pharmacy data is optional. Complaints alone detect 90% of events (fusion 90%); fusion adds field tests and helps localisation (39% vs 26% top-3).

**"Isn't this the US EPA's contamination warning system?"**
It builds on that work (multi-signal warning; Bayesian source identification). What is new is the target: chronic ingress on intermittent Indian networks, a city-set escalation clock, Hindi intake, and an evaluation that reports what did not work.

**"Do your suggested test taps help?"**
Mixed, and we show both. On the pre-registered run (76 events) it was no better than random. A larger run declared in advance (280 events, fresh seeds, unchanged code) found it ahead: 66% vs 55% reach the top 3 (+11 points, CI 6–16; mean 11.2 vs 12.9 tests). Pooled over both runs: 68% vs 59%, about +9. Random itself moved 75% → 55% between samples, so treat it as supportive, not definitive. Day 9's top two pipes are a tie (27% each): say "tie".

**"Is the demo cherry-picked?"**
The scenario's detection delay matches the median. It is a successful localisation case, which happens in 39% of events; we say so on screen.

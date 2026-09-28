# MLFQ boost ordering: implementation and verification

Bogdan confirmed that an unfinished running process belongs at the end of Q0 when a boost coincides with allotment expiry. With A running and B, C, and D waiting in Q0, Q1, and Q2, the order before dispatch is **[B, C, D, A]**.

## Implemented order

At a boost boundary:

1. Remove the running process if it has completed its CPU service.
2. Collect waiting processes from Q0, Q1, and Q2 in head-to-tail order.
3. Append the unfinished running process, including when its quantum or allotment just expired.
4. Put the collected processes in Q0 and reset both usage counters. Preserve remaining service.
5. Admit same-time arrivals in input order.
6. Dispatch the head of Q0.

No intermediate demotion, rotation, or early-yield phase occurs at this boundary. The ordinary rules for boundaries without a boost are unchanged. FCFS, SJF, STCF, and Round Robin do not use this boost rule.

The UI explanation, typed animation phases, forward/reverse movement review, [MLFQ rules](MLFQ_RULES.md), and [shareable PDF](docs/rules/MLFQ_Rules.pdf) use this order.

## Exact example used in tests

This input reaches the professor's queue arrangement through ordinary execution, without injecting simulator state:

| Process | Arrival | Service |
| --- | ---: | ---: |
| D | 0 | 20 |
| C | 4 | 10 |
| A | 5 | 10 |
| B | 5 | 10 |
| E | 6 | 1 |

Both quantum and allotment are [1, 3, 8]. The boost interval is 6. At time 6, A has just exhausted its Q0 budgets and has nine service ticks left.

| Stage | CPU | Q0 | Q1 | Q2 |
| --- | --- | --- | --- | --- |
| Before handling time 6 | A | B | C | D |
| Boost | Free | B, C, D, A | Empty | Empty |
| Admit E | Free | B, C, D, A, E | Empty | Empty |
| Dispatch | B | C, D, A, E | Empty | Empty |

A moves directly from the CPU to Q0. Its service stays at nine ticks, and its quantum/allotment usage becomes zero. The animated browser test checks all three phases and their reverse order. The full walkthrough checks every boundary through completion and back to time zero.

## Verification scope

Focused engine tests cover simultaneous quantum expiry, allotment expiry partway through a quantum, both budgets expiring together, runners in Q0/Q1/Q2, completion at a boost, a lone runner, same-time arrivals, and engine-only early yield. The stress suite also checks the queue ordering and reset counters at every boost, independently of its reference scheduler.

Browser tests use visible controls to select policies, import processes, enter budgets, step forward/backward, and inspect rendered cards, queues, counters, metrics, explanations, and movement phases. Independent reference schedulers do not import production scheduling logic. Tests run against a local production Next.js build in Chromium at 1920×1080 and 1366×768.

| Policy | Full walkthroughs per viewport |
| --- | ---: |
| FCFS | 104 |
| SJF | 104 |
| STCF | 104 |
| Round Robin | 104 |
| MLFQ | 198 |

MLFQ includes 22 named cases, a complete 144-case finite matrix, and 32 seeded workloads. The matrix varies the second arrival over {0, 1}, each service over {1, 3}, Q0 quantum over {1, 2}, Q0 allotment over {1, 2, 3}, and boost interval over {1, 2, 5}. Other queue budgets remain fixed in that matrix. The other policies use 8 named cases, 64 two-process combinations, and 32 seeded workloads each. Their input domains are recorded in [the earlier all-policy audit](ALL_POLICIES_BROWSER_AUDIT.md).

The full walkthroughs total 1,228 executions and 21,044 forward/reverse boundary comparisons across both viewports. Additional tests cover supported limits of 50 processes and 2,000 ticks at selected checkpoints, validation/recovery, large counters, playback, layout, and animation.

## Results

Verified locally on September 28, 2026:

- 92 unit/component tests passed.
- Four stress tests passed, including 6,000 deterministic workloads across all five policies.
- ESLint, both production builds, and two built-server rendering tests passed.
- Every numerical example in the five rules documents was checked against the simulator. The revised five-page MLFQ PDF was rendered and visually inspected.

- All 282 distinct browser tests have passing final results across the retained reports below. No tests were skipped, and no automatic retries were needed to obtain the final passing results.
- The 1,228 complete UI walkthroughs cover 614 distinct policy/scenario combinations in two viewports. They compare 11,136 forward boundaries and 9,908 reverse boundaries, for 21,044 comparisons.
- The confirmed queue order and the corrected 50-process layout were also inspected visually in both viewport sizes.

| Report | Production target | Passed | Failed |
| --- | --- | ---: | ---: |
| `confirmed-boost-order` | Next.js, full audit before the layout fix | 279 | 3 |
| `confirmed-boost-rerun` | Next.js, complete animated desktop walkthrough with corrected timeout | 1 | 0 |
| `confirmed-final-vinext` | vinext, final layout/animation/limit regressions | 76 | 0 |
| `confirmed-final-next` | Fresh Next.js build, final layout/budget/boost checks | 12 | 0 |

Repeated checks are counted once in the 282-test total. The full workload matrix used the updated scheduler before the final event-panel CSS fix. All 76 presentation regressions then passed on the final vinext build, followed by 12 selected checks on a fresh Next.js build. The CSS fix does not change scheduling state. An intermediate retry terminated before writing its final report and is excluded from these totals.

The initial audit found a layout regression from the earlier CPU-label change: a long event list could determine the height of the top row and push the timeline below the viewport. The event panel now uses size containment so the CPU details determine row height and messages scroll inside the event panel. The accessibility regression uses 50 processes and explicitly checks that the timeline remains inside the viewport.

The 51-tick animated walkthrough initially exceeded the fixed three-minute test limit during reverse playback. Its timeout now scales with the number of boundaries; the workload and all forward/reverse assertions are preserved.

Local evidence is retained under `test-results/confirmed-boost-evidence/`: `summary.json` checks the totals, `final-outcomes.json` identifies the passing report for every test, and `walkthroughs.json` records the workloads and boundary counts. Raw reports are `test-results/<report-name>.json`; final screenshots and PDF page renders are under `outputs/confirmed-boost-order/`.

## Reproduce

```sh
npm run test:unit
npm run test:stress
npm run lint:ci
npm run build
npm run test:rendered
MLFQ_AUDIT_REPORT=confirmed-boost-order npm run test:e2e:audit
npm run docs:rules
```

The audit command builds the Next.js production target before launching the browser tests. Reports, traces, and screenshots are local artifacts ignored by Git; the PDF is tracked.

Coverage is exhaustive only within the stated finite matrices. These results do not establish coverage of every possible input, Firefox, Safari, mobile browsers, or the deployed site. Most matrix walkthroughs use reduced motion; dedicated cases check actual animation. Early yield is tested in the engine because the normal UI does not expose that option.

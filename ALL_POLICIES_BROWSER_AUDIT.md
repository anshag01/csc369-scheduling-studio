# Scheduling Studio: terminology and all-policy browser audit

Historical audit: the MLFQ expiry-before-boost ordering used in this run has since been superseded. See [BOOST_ORDER_VERIFICATION.md](BOOST_ORDER_VERIFICATION.md) for the confirmed ordering and its verification.

This audit covers the clarification of service, quantum (time slice), and allotment in the visualizer. Scheduling decisions are unchanged by this patch. Cards now say `N service left`, settings define the budgets, and boundary explanations identify whether a number measures CPU service, quantum usage, or allotment usage.

The new MLFQ teaching example loads two 10-tick processes with Q0 quantum 1 and allotment 4. Each takes four one-tick turns before demotion, retaining six service ticks. The ordinary defaults remain 2/4/8 for both budgets. The example sets boost to 100 so a boost does not interrupt the demonstration.

## Browser method

Tests run against a local production Next build in Chromium at 1920×1080 and 1366×768. They select policies, import workloads through the visible JSON editor, fill inputs, click Next/Previous, use playback and keyboard controls, and inspect the rendered UI. Browser evaluation reads DOM only; it does not call the production scheduler or inject React state.

Independent reference schedulers in `tests/support/policy-ui-oracle.ts` and `tests/support/mlfq-ui-oracle.ts` generate expected states. Neither imports production scheduling logic. Waiting time is derived from elapsed time minus delivered CPU service. This helps catch discrepancies in both scheduling decisions and accounting.

For each full walkthrough, assertions compare:

- CPU identity, ready-queue order, and the complete execution timeline.
- Every process's state, remaining service, waiting, response, and turnaround metrics.
- MLFQ remaining budgets and visible `Q: used/total · A: used/total` labels.
- Active card identities and absence of leftover animation elements.
- Every boundary forward to completion and backward to time zero.
- End/start control states and JavaScript runtime errors.

The new all-policy walkthroughs additionally check explicit service labels. For FCFS, SJF, STCF, and RR, they compare the meaning and order of every displayed boundary event against independent expectations. MLFQ boundary prose is covered by existing reasoning tests and targeted browser assertions for the new example; MLFQ state and budget comparisons apply throughout all walkthroughs.

## Workload coverage

| Policy | Full walkthrough scenarios per viewport | Composition |
| --- | ---: | --- |
| FCFS | 104 | 8 named edge cases + 64 two-process combinations + 32 seeded workloads |
| SJF | 104 | Same input domain, with independently calculated SJF outcomes |
| STCF | 104 | Same input domain, with independently calculated STCF outcomes |
| Round Robin | 104 | Same input domain, with quantum values 1–4 as described below |
| MLFQ | 196 | Existing 20 named + 144 matrix cases, plus 32 seeded workloads |

The new non-MLFQ matrix exhausts B's arrival in `{0,1,3,6}` and each process's service in `{1,2,3,5}`, with A arriving at zero: 64 combinations per policy. RR quantum cycles through `{1,2,4}` across that matrix; it is not a full cross-product over quantum too. The 32 seeded workloads use seed `3692026`, 3–5 processes, arrival times 0–8, service times 1–5, and RR quantum 1–4. Every fifth seeded workload has all arrivals at zero. IDs intentionally differ from alphabetical order.

The additional MLFQ workloads use those 32 process lists with independent quantum/allotment settings, including allotment smaller than, equal to, and larger than quantum; boost intervals are selected from `{1,2,3,5,7,11,100}`. The earlier complete 144-case MLFQ domain and 20 named cases are documented in [BROWSER_AUDIT.md](BROWSER_AUDIT.md).

Named non-MLFQ cases exercise:

1. Same-arrival, equal-service ties and input order.
2. Equal service at dispatch with differing arrival times.
3. Completion, quantum expiry, and multiple arrivals at one boundary.
4. An equal-remaining-time arrival followed by a strictly shorter arrival.
5. Repeated short arrivals and resumed long-running work.
6. Initial idle time, later idle gaps, and simultaneous arrivals.
7. A lone process renewing its quantum repeatedly.
8. Input order that differs from arrival order.

These distinguish FCFS/non-preemptive SJF behavior, SJF dispatch ties, STCF strict preemption and equal-time retention, and RR rotation with arrivals admitted before an expired runner. Existing MLFQ cases cover boost/expiry/arrival collisions, ongoing-runner boost placement, preservation of budgets on ordinary preemption, bottom-queue renewal, and unequal budgets.

## Additional UI checks

Every policy is tested with 50 processes and with a workload ending exactly at tick 2,000 after an initial idle gap. These large scenarios use selected start/middle/end checkpoints rather than full forward/backward walks. An import that would end at 2,001 must be rejected while preserving the current valid state.

Each policy also exercises keyboard stepping, autoplay/pause, reset, duplicate-ID validation and recovery, and export. The MLFQ example is checked at every boundary through t=8, including A's demotion at t=7 and its six remaining service ticks.

The existing production regressions cover full animation phases, reverse animation, motion review, rapid interaction, card geometry, scrolling, and compact layouts. Most workload-matrix tests use the browser's reduced-motion preference; the six existing named animated MLFQ cases per viewport and existing animation regressions run with animation enabled.

An additional layout probe found that valid 16-digit MLFQ budgets pushed the CPU details outside their panel. Large-budget layouts now give the CPU and boundary explanations separate full-width rows. Round Robin card sizing also accounts for its slice counter. Targeted regressions exercise budgets 2,000, 10,000, and `Number.MAX_SAFE_INTEGER`, including four-digit used counters, completion/reversal, and animated MLFQ boosts with very wide cards. Ordinary-size cards retain the compact layout.

## Results

Verified September 28, 2026:

- **276 distinct browser tests passed** across both viewport sizes. The four recorded production runs have no failed, skipped, or flaky tests.
- **612 distinct policy/scenario combinations**, run in both sizes, produced **1,224 complete UI walkthroughs**.
- Those walkthroughs compared **11,008 forward boundaries and 9,784 reverse boundaries: 20,792 total**. Limit checkpoints, control checks, teaching-example steps, and animation regressions are additional and are excluded from that count.
- Every FCFS/SJF/STCF/RR policy passed 104 workloads per viewport; MLFQ passed 196 per viewport. No scheduling, queue-order, service/accounting, or tested explanation mismatch was found.
- The large-budget layout probes found and fixed clipping in MLFQ and compact Round Robin. The initial targeted development run had two layout failures; all six targeted checks subsequently passed, including on both production targets.
- The final vinext production build passed all **74 selected layout, animation, example, and limit regressions**. A fresh Next production build then passed all **six large-budget regressions**. The full workload matrix used the clarified UI before the large-budget layout fix; the fix changes presentation for large cards and leaves the matrix's scheduling paths unchanged.
- **84 unit/component tests**, **four stress tests** (including 6,000 independent-model workloads), and **two built-server rendering tests** passed. Both production builds, TypeScript, ESLint, whitespace checks, and workflow YAML validation passed.
- The teaching example, ordinary compact layout, corrected large-budget RR/MLFQ layouts, and refreshed four-page rules PDF were visually inspected.

Recorded runs:

| Report name | Target | Tests passed |
| --- | --- | ---: |
| `clarity-smoke` | Next production | 32 |
| `clarity-matrix-regression` | Next production | 238 |
| `clarity-final-vinext` | vinext production, final layout | 74 |
| `clarity-final-next` | Next production, final layout | 6 |

These are 350 executions of 276 distinct tests; repeated regressions are not counted as additional distinct coverage. The 238-test run produced complete passing JSON/HTML reports with no reported errors, although its outer shell subsequently returned exit 143. The final Next run exited normally with code zero. An initial temporary vinext audit configuration also needed its server working directory corrected before the recorded run.

Local evidence, intentionally ignored by Git:

- `test-results/clarity-evidence/summary.json`: checked totals from the completed reports.
- `test-results/clarity-evidence/final-outcomes.json`: latest passing result and source report for each distinct browser test.
- `test-results/clarity-evidence/walkthroughs.json`: all 1,224 workload inputs, expected CPU traces, and verified boundary counts.
- `test-results/clarity-evidence/`: screenshots and verification logs.
- `playwright-report/<report-name>/index.html` and `test-results/<report-name>.json`: full reports for the four runs above.
- `outputs/MLFQ_Visualizer_Rules.pdf`: refreshed rules and examples with explicit service labels and the time-slice definition.

CI now runs each viewport in its own production-audit job and retains reports on success as well as failure. The workflow configuration was validated locally; these results are local runs, not a claim that the updated remote workflow has executed.

## Reproduce

```sh
# Entire production browser suite, including all policies and animation regressions
npm run test:e2e:audit

# Only the newly added all-policy audit
npm run test:e2e:audit -- tests/e2e/all-policies-audit.spec.ts
```

The audit config builds production, starts port 4174, and runs two workers. Reports are written to `playwright-report/<name>/index.html` and `test-results/<name>.json`; set `MLFQ_AUDIT_REPORT=<name>` to name a run. Generated reports and screenshots are ignored by Git. Shareable rules PDFs are tracked under `docs/rules/`.

## Limits and retained policy

This is exhaustive over the explicitly stated finite matrices, not every possible input or platform. The audit covers local production Chromium in two desktop sizes; it does not establish Firefox, Safari, mobile, or deployed-site coverage. Engine-only early yield is covered by engine tests because the normal UI does not expose it.

This historical run verified completion, expiry/requeue, boost, then arrivals. Bogdan has since confirmed that the unfinished runner belongs last even at simultaneous allotment expiry. Current MLFQ handles completion first, then boosts before either budget expiry, then admits arrivals and dispatches. See the verification report linked above for the updated tests.

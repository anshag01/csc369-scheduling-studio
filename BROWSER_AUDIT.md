# Production browser audit: MLFQ

Date: September 26, 2026 (America/Toronto). Application revision: `74a665a`.

Historical audit: this report records the earlier expiry-before-boost policy. The confirmed boost-first policy and its verification are documented in [BOOST_ORDER_VERIFICATION.md](BOOST_ORDER_VERIFICATION.md).

The audit uses real Chromium browsers against `next build` / `next start`, locally on port 4174, at 1920×1080 and 1366×768. It operates the public UI: selecting MLFQ, importing processes through the JSON editor, entering queue settings, clicking Next/Previous and timeline ticks, and editing/resetting/exporting scenarios. Expected results come from an independent reference model that does not import the production scheduler. Browser evaluation only reads rendered DOM; it does not inject simulation state.

## Results

- All 20 named scenarios and all 144 matrix combinations passed in each viewport: 328 complete forward/backward scenario runs.
- Those walkthroughs checked 1,952 forward boundaries and 1,624 reverse boundaries: **3,576 boundary comparisons**.
- Each boundary comparison covers CPU identity, queue ordering, process states, remaining service, remaining quantum/allotment, waiting/response/turnaround metrics, and active-card identities. The complete execution timeline is compared for each scenario. Start/end controls and absence of leftover animation travelers are also checked.
- The 50-process and 2,000-tick supported-limit scenarios passed in both viewports. These use selected start/middle/end timeline checkpoints, not every boundary.
- **136 distinct browser tests passed across the final checks:** 80 expanded audit tests plus 56 existing regressions. The second run passed all 58 selected tests (the two corrected validation tests and all 56 regressions), with no retries.
- Validation/editing/reset/export/recovery passed in both viewports. Existing regressions passed for playback, keyboard controls, timeline navigation, forward/reverse animation phases, rapid input, movement review, card geometry/overlap, reduced motion, scrolling, and all five scheduling policies.
- No application defects were found within this tested scope; the application code remained unchanged.
- TypeScript, ESLint, and whitespace checks passed.

The initial harness used an incorrect Speed selector, then a broad alert selector that also matched Next.js's hidden route announcer. Both were corrected. These were test-harness failures; no application changes were required by the completed checks.

## Named cases

Every tick is visited forward to completion and backward to zero. Full animation runs use the UI's Fast speed; the remaining walkthroughs use the browser's reduced-motion preference. Existing regression tests separately inspect individual animation phases and geometry.

| Scenario | Completion tick | Animation | Outcome |
| --- | ---: | --- | --- |
| four one-tick turns before demotion | 12 | Full | Passed both |
| allotment interrupts a partial quantum | 10 | Full | Passed both |
| boost interrupts Q0 and enqueues runner last | 8 | Full | Passed both |
| boost interrupts Q1 and enqueues runner last | 10 | Full | Passed both |
| boost interrupts Q2 and enqueues runner last | 11 | Full | Passed both |
| lone runner is boosted and immediately redispatched | 7 | Full | Passed both |
| boost with waiting processes from mixed levels | 28 | Reduced motion | Passed both |
| arrival follows ongoing-runner boost | 11 | Reduced motion | Passed both |
| expiry demotes before boost and runner need not be last | 11 | Reduced motion | Passed both |
| quantum expiry rotates before boost | 11 | Reduced motion | Passed both |
| completion beats expiry boost and arrivals | 7 | Reduced motion | Passed both |
| arrival precedes rotation without boost | 9 | Reduced motion | Passed both |
| higher-priority preemption preserves both counters | 14 | Reduced motion | Passed both |
| same-level arrival never preempts | 8 | Reduced motion | Passed both |
| bottom queue renews its exhausted budget | 17 | Reduced motion | Passed both |
| allotment smaller than quantum | 12 | Reduced motion | Passed both |
| input-order ties use unsorted IDs | 9 | Reduced motion | Passed both |
| idle gaps and boosts with no active processes | 11 | Reduced motion | Passed both |
| boost every tick and all one-tick budgets | 9 | Reduced motion | Passed both |
| repeated boosts keep cumulative service intact | 21 | Reduced motion | Passed both |

## Exhaustive matrix domain

Every combination of the following values is exercised, for 144 scenarios per viewport:

| Input | Values |
| --- | --- |
| A arrival | 0 |
| B arrival | 0, 1 |
| A service | 1, 3 |
| B service | 1, 3 |
| Q0 quantum | 1, 2 |
| Q0 allotment | 1, 2, 3 |
| Boost interval | 1, 2, 5 |
| Q1/Q2 quanta | 2 / 3 |
| Q1/Q2 allotments | 3 / 4 |

This matrix uses reduced motion. The named cases extend coverage to deeper queues, larger budgets, simultaneous events, idle periods, and longer processes.

## Policy and coverage limits

The version covered by this historical audit handled expiry/requeue before boost. That policy has since been superseded by Bogdan's confirmation: after completion handling, boost takes precedence over budget expiry and places the unfinished runner last. See the current rules and the boost-order verification report linked above.

Coverage is exhaustive within the stated finite matrix, not every possible process list or setting. It covers local production Chromium at two desktop viewport sizes, not a deployed website, Firefox, Safari, or mobile. The normal UI does not expose the engine's optional early-yield flag, so that behavior remains covered by engine tests rather than these UI walkthroughs.

## Reproduce and inspect

Run the complete production browser suite (new audit plus existing regressions):

```sh
npm run test:e2e:audit
```

Run just the expanded MLFQ audit:

```sh
npm run test:e2e:audit -- tests/e2e/mlfq-audit.spec.ts
```

The command builds production before starting the server. Install dependencies and Playwright Chromium first on a fresh machine.

Local evidence from this audit (generated files are intentionally ignored by Git):

- `playwright-report/mlfq-audit/index.html`: initial expanded audit, including the two superseded alert-selector failures.
- `playwright-report/production-regression/index.html`: corrected validation and existing production browser regressions.
- `test-results/mlfq-audit-evidence/final-outcomes.json`: the latest verified outcome for each of the 136 distinct browser tests, retaining the source report.
- `test-results/mlfq-audit-evidence/walkthroughs.json`: all 328 scenario inputs, CPU traces, and boundary counts.
- `test-results/mlfq-audit-evidence/`: 44 scenario screenshots plus two separately captured boost animation/settled screenshots.
- `test-results/mlfq-audit.json` and `test-results/production-regression.json`: machine-readable results.

The boost animation, settled compact layout, mixed-level boost at desktop size, and completed 2,000-tick compact layout were visually inspected as well as checked through DOM assertions.

## Follow-up: compact quantum/allotment labels

MLFQ CPU, ready-queue, and animated cards now display `Q: used/total · A: used/total`. A visible legend and tooltips explain the counters. Cards share a width sized for their configured budgets, including multi-digit values.

Validation for this UI change: 84 unit/component tests passed, along with TypeScript, ESLint, and whitespace checks. The 56 production browser regressions were run at both viewport sizes. A short-window scrolling regression was fixed by placing the legend beside the queue heading; screenshot review also caught and fixed clipped CPU details with larger budgets. All 16 affected layout and animation checks passed on the final version, leaving a passing latest result for all 56 distinct browser checks.

The browser assertions verify distinct used counters, demotion resets, forward/reverse boost and quantum-rotation labels, unclipped multi-digit labels and CPU details, queue/CPU card geometry, and short-window layout. Final screenshots were visually inspected. Local evidence is in `playwright-report/card-budgets-final/` and `test-results/card-budgets-evidence/`.

## Follow-up: service terminology and all-policy coverage

The next audit extends independent browser walkthroughs to FCFS, SJF, STCF, and Round Robin; adds seeded MLFQ workloads and the quantum/allotment teaching example; and checks exact large-budget counters. See [ALL_POLICIES_BROWSER_AUDIT.md](ALL_POLICIES_BROWSER_AUDIT.md) for the changes, finite test domains, results, and current evidence paths.

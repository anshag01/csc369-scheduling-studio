# Scheduling policy rules

Notes on the five scheduling policies implemented in the visualizer. Every rule has an explanation and a small example. Each document also includes boundary event ordering and a complete worked schedule, with queue tables and CPU timelines where useful.

| Policy | Read the source | Download PDF |
| --- | --- | --- |
| FCFS: First Come, First Served | [FCFS rules](../../FCFS_RULES.md) | [FCFS PDF](FCFS_Rules.pdf) |
| SJF: Shortest Job First | [SJF rules](../../SJF_RULES.md) | [SJF PDF](SJF_Rules.pdf) |
| STCF: Shortest Time to Completion First | [STCF rules](../../STCF_RULES.md) | [STCF PDF](STCF_Rules.pdf) |
| RR: Round Robin | [RR rules](../../RR_RULES.md) | [RR PDF](RR_Rules.pdf) |
| MLFQ: Multilevel Feedback Queue | [MLFQ rules](../../MLFQ_RULES.md) | [MLFQ PDF](MLFQ_Rules.pdf) |

The final FCFS, SJF, STCF, and RR schedules use the same input for comparison. The examples beneath individual rules are separate scenarios. MLFQ includes separate-budget examples, ordinary preemption, and boosts that coincide with budget expiry or completion.

## Regenerate

Edit the root `*_RULES.md` files, then run `npm run docs:rules`. The generator uses Playwright Chromium (`npx playwright install chromium` if needed). It uses TeX Gyre Pagella when installed, with system serif fallbacks. Tables headed `From`, `To`, and `CPU` render as timelines in the PDFs. Review pagination and figures after editing.

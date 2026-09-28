# Scheduling policy rules

Notes on the five scheduling policies implemented in the visualizer. Each document includes the rules, event ordering, and worked examples.

| Policy | Read the source | Download PDF |
| --- | --- | --- |
| FCFS: First Come, First Served | [FCFS rules](../../FCFS_RULES.md) | [FCFS PDF](FCFS_Rules.pdf) |
| SJF: Shortest Job First | [SJF rules](../../SJF_RULES.md) | [SJF PDF](SJF_Rules.pdf) |
| STCF: Shortest Time to Completion First | [STCF rules](../../STCF_RULES.md) | [STCF PDF](STCF_Rules.pdf) |
| RR: Round Robin | [RR rules](../../RR_RULES.md) | [RR PDF](RR_Rules.pdf) |
| MLFQ: Multilevel Feedback Queue | [MLFQ rules](../../MLFQ_RULES.md) | [MLFQ PDF](MLFQ_Rules.pdf) |

FCFS, SJF, STCF, and RR use the same input for comparison. MLFQ includes separate-budget and boost examples.

## Regenerate

Edit the root `*_RULES.md` files, then run `npm run docs:rules`. The generator uses Playwright Chromium (`npx playwright install chromium` if needed). It uses TeX Gyre Pagella when installed, with system serif fallbacks. Tables headed `From`, `To`, and `CPU` render as timelines in the PDFs. Review pagination and figures after editing.

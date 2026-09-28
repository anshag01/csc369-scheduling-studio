# Scheduling Studio: policy rules

Each document describes the policy implemented in Scheduling Studio, with rules, explanations, examples, boundary ordering, metrics, and supported input limits. The PDFs are standalone documents suitable for sharing.

| Policy | Read the source | Download PDF |
| --- | --- | --- |
| FCFS — First Come, First Served | [FCFS rules](../../FCFS_RULES.md) | [FCFS PDF](FCFS_Rules.pdf) |
| SJF — Shortest Job First | [SJF rules](../../SJF_RULES.md) | [SJF PDF](SJF_Rules.pdf) |
| STCF — Shortest Time to Completion First | [STCF rules](../../STCF_RULES.md) | [STCF PDF](STCF_Rules.pdf) |
| RR — Round Robin | [RR rules](../../RR_RULES.md) | [RR PDF](RR_Rules.pdf) |
| MLFQ — Multilevel Feedback Queue | [MLFQ rules](../../MLFQ_RULES.md) | [MLFQ PDF](MLFQ_Rules.pdf) |

FCFS, SJF, STCF, and RR use the same worked input so their behavior can be compared directly. MLFQ uses the loadable unequal-budget example to illustrate four one-tick turns before demotion. Worked CPU traces, completion boundaries, and final response/waiting/turnaround values were checked against `lib/simulator.ts`.

The documents describe current implementation choices. In particular, MLFQ handles expiry/requeue before a simultaneous boost. The source document retains the maintainer's clarification note; the shareable PDF contains the implemented rules without the instructor discussion.

## Regenerate the PDFs

Edit the root `*_RULES.md` sources, then run:

```sh
npm run docs:rules
```

The generator uses the project's existing Playwright dependency and requires Chromium (`npx playwright install chromium` on a fresh machine). It writes the five PDFs here and HTML previews under the ignored `outputs/policy-rules/` directory. Review the resulting pagination after changing a source document.

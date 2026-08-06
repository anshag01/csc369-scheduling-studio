# Scheduler verification

The test oracle follows the CSC369 scheduling lecture, the supplied CPU-scheduling notes, and the refined MLFQ rules in the supplied OSTEP excerpt. The product models one discrete-time CPU and CPU bursts only; it does not invent I/O or blocked states.

## Rule-to-test mapping

| Policy | Required behavior covered |
| --- | --- |
| FCFS | Stable FIFO arrival order; non-preemptive execution; simultaneous arrivals; idle gaps; completion/arrival collisions. |
| SJF | Select the shortest original service time only when the CPU is free; remain non-preemptive; preserve stable ties. |
| STCF | Select the shortest remaining time; preempt only for a strictly shorter remainder; do not preempt on equality. |
| RR | Run the queue head for one positive quantum; rotate unfinished work to the tail; place an arrival at an exact expiry boundary before the expired process; do not report expiry after exact completion. |
| MLFQ | Admit arrivals to Q0; always run the highest-priority non-empty queue; use FIFO/Round Robin within a level; accumulate CPU use across higher-priority preemption; demote after the full per-level allotment; keep bottom-level work at the bottom; periodically boost all active work to Q0 and reset allotments. |

All policies also verify response, waiting, and turnaround accounting; remaining service; lifecycle state; CPU/ready-queue exclusivity; process conservation; idle ticks; deterministic stable ties; and the final completed state.

## Test layers

- `npm run test:unit` runs 42 focused, exhaustive, independent-reference, edge-case, and server-rendered component tests. The generated/reference portion covers more than 20,000 workloads.
- `npm run test:stress` adds 6,000 deterministic independent-model workloads plus supported-limit, collision, and equivalence cases. It varies every policy across 1, 2, 3, 5, 8, 12, 20, 30, and 50 processes; arrivals from 0–60; services from 1–25; RR quantums from 1–20; one to five MLFQ queues; per-level allotments; and boost intervals from 1–100 or disabled. Dedicated cases reach exactly 2,000 ticks.
- `npm run test:e2e` runs Chromium at 1920×1080 and 1366×768. It traverses all 21 boundaries of the lecture workload for every policy, checks the exact CPU trace and derived lifecycle/queue state, verifies keyboard and playback controls, validates stale-state removal, and checks that large timelines, event lists, MLFQ maps, and optional metrics remain accessible without page-level vertical scrolling.
- `npm run build:vercel` and `npm run build` verify the native Vercel/Next.js and Sites/vinext production targets. `npm run test:rendered` checks the built server output.

## Cloud continuity

`.github/workflows/scheduler-verification.yml` runs the focused suite, independent stress suite, both production builds, and browser suite on every push to `main`, on pull requests, on manual dispatch, and nightly at 06:17 UTC. Once a commit has been pushed, that GitHub-hosted run continues independently of the development laptop.

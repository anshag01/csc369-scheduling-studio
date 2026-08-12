# Scheduler verification

The test oracle follows the CSC369 scheduling lecture, the supplied CPU-scheduling notes, and the refined MLFQ rules in the supplied OSTEP excerpt. The product models one discrete-time CPU and CPU bursts only; it does not invent I/O or blocked states.

## Rule-to-test mapping

| Policy | Required behavior covered |
| --- | --- |
| FCFS | Stable FIFO arrival order; non-preemptive execution; simultaneous arrivals; idle gaps; completion/arrival collisions. |
| SJF | Select the shortest original service time only when the CPU is free; remain non-preemptive; preserve stable ties. |
| STCF | Select the shortest remaining time; preempt only for a strictly shorter remainder; do not preempt on equality. |
| RR | Run the queue head for one positive quantum; rotate unfinished work to the tail; place an arrival at an exact expiry boundary before the expired process; do not report expiry after exact completion. |
| MLFQ | Admit arrivals to Q0; always run the highest-priority non-empty queue; use FIFO/Round Robin within a level; accumulate CPU use across higher-priority preemption; demote after the full per-level allotment; keep bottom-level work at the bottom; periodically boost waiting work to Q0 without interrupting or renewing the current CPU turn. |

All policies also verify response, waiting, and turnaround accounting; remaining service; lifecycle state; CPU/ready-queue exclusivity; process conservation; idle ticks; deterministic stable ties; and the final completed state.

## Visualizer-specific deterministic policies

The following choices make an otherwise underspecified discrete-time visualization reproducible. They are implementation policies for this visualizer, not additional rules claimed to come from the PDFs.

- **Queue value:** Each MLFQ queue value is both its Round Robin quantum and its total allotment before demotion. The UI labels this simplification as `Quantum (= allotment) per queue`.
- **Equal-value ties:** Equal SJF service times and equal STCF remaining times are resolved by earlier arrival and then input order. STCF does not preempt the current process on equality.
- **Same-time event ordering:** At boundary `t`, the visualizer records completion first; accounts for a due quantum/allotment expiry or yield and enqueues that process; applies a due MLFQ boost to waiting processes; admits arrivals; evaluates ordinary preemption; and finally dispatches. Thus an allotment that expires exactly at a boost boundary is demoted first and then boosted. This ordering defines collision cases deterministically.
- **Queue order after boosts:** Existing ready queues are flattened from highest to lowest priority, preserving head-to-tail order within each queue, and moved to Q0. A process enqueued by a same-boundary expiry or yield participates in that ordering. Same-boundary arrivals are appended afterward.
- **Running process at a boost:** A boost moves only waiting processes. A process already on the CPU remains at its current queue level with its accumulated allotment intact and finishes that current turn before boosted or newly arriving higher-priority work can preempt it.
- **Preemption reinsertion:** A lower-priority MLFQ process preempted by higher-priority work is put back at the head of its current queue with its accumulated allotment unchanged.
- **Animation semantics:** Each process card has a stable identity and exists in exactly one visible scheduler location: the CPU or one ready queue. Every adjacent dispatch, return, rotation, preemption, demotion, boost, arrival, completion, and reverse step is illustrated with a directional arrow, an action label, and a short live movement cue. Multi-event boundaries show their intermediate route in order. Direct timeline jumps are inspection-only so the UI never invents a route across skipped states. Step controls remain locked until the explanation finishes. Animation never changes scheduling state, and reduced-motion users receive the same final state without movement.

Boost boundaries are shown directly on the execution timeline with a `BOOST` marker. A marker at `t` means the boost is applied before the process shown for interval `[t, t + 1)` is selected.

## Test layers

- `npm run test:unit` runs 52 focused, exhaustive, independent-reference, edge-case, and server-rendered component tests. The generated/reference portion covers more than 20,000 workloads.
- `npm run test:stress` adds 6,000 deterministic independent-model workloads plus supported-limit, collision, and equivalence cases. It varies every policy across 1, 2, 3, 5, 8, 12, 20, 30, and 50 processes; arrivals from 0–60; services from 1–25; RR quantums from 1–20; one to five MLFQ queues; per-level allotments; and boost intervals from 1–100 or disabled. Dedicated cases reach exactly 2,000 ticks.
- `npm run test:e2e` runs Chromium at 1920×1080 and 1366×768. It traverses all 21 boundaries of the lecture workload for every policy, checks the exact CPU trace and derived lifecycle/queue state, verifies keyboard and playback controls, validates stale-state removal, and checks that large timelines, event lists, MLFQ maps, and optional metrics remain accessible without page-level vertical scrolling.
- `npm run build:vercel` and `npm run build` verify the native Vercel/Next.js and Sites/vinext production targets. `npm run test:rendered` checks the built server output.

## Cloud continuity

`.github/workflows/scheduler-verification.yml` runs the focused suite, independent stress suite, both production builds, and browser suite on every push to `main`, on pull requests, on manual dispatch, and nightly at 06:17 UTC. Once a commit has been pushed, that GitHub-hosted run continues independently of the development laptop.

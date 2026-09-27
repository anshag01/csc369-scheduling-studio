# MLFQ Visualizer: implemented rules

The simulator uses one CPU, discrete ticks, and CPU-only processes. The normal UI has three queues: Q0 (highest), Q1, and Q2 (lowest). The engine supports any nonempty queue configuration.

Each queue has two independent positive whole-number settings:

- **Quantum:** maximum CPU ticks in a turn before rotating within that queue.
- **Allotment:** cumulative CPU ticks at that priority before demotion.

Both settings default to Q0 = 2, Q1 = 4, Q2 = 8. The default boost interval is 10 ticks. Engine callers that omit `mlfqAllotments` use their quantum values as allotments for compatibility. Omitting the engine's boost interval disables boosts.

## 1. Highest priority runs first

Dispatch the head of the highest-priority nonempty queue. Higher-priority ready work preempts lower-priority running work. Return the preempted process to the front of its current queue, preserving its priority, partial quantum usage, and accumulated allotment. There is no boost protection.

## 2. Same priority uses Round Robin

A same-priority arrival does not interrupt the runner. When its quantum expires and it has allotment remaining, append it to the back of the same queue. Reset quantum usage only.

## 3. Arrivals join Q0

New processes enter the back of Q0 with both counters zero. Simultaneous arrivals retain input order.

## 4. Execution, completion, and demotion

Each CPU tick reduces total remaining CPU service by one and increases quantum and allotment usage by one. Remaining CPU service is the work still needed to finish, not the time remaining in a turn.

At the next boundary, completion is handled first. A completed process leaves, even if a quantum, allotment, or boost expires simultaneously.

For an unfinished process, allotment exhaustion takes precedence over quantum expiry. Reset both counters and append it to the next lower queue. At the lowest queue, append it to that queue's tail with fresh counters. Allotment exhaustion may interrupt a partly used quantum.

Example: quantum 1 and allotment 4 allow four one-tick turns before demotion, assuming no intervening boost or completion. Quantum 2 and allotment 3 allow a two-tick turn followed by a one-tick turn before demotion.

## 5. Waiting-process boost order

Boost at positive multiples of the interval, never at t=0. Collect waiting queues from highest to lowest priority, preserving head-to-tail order within each queue. Move these processes to Q0 and reset both usage counters.

## 6. Boost the ongoing runner too

If a process still has an ongoing turn after completion and expiry/yield handling, preempt it and append it after all waiting processes in Q0. Reset its quantum and allotment usage without changing remaining CPU service. Dispatch normally after same-time arrivals. With no other work, the same process can immediately run again.

Example: CPU A, Q1 B C, Q2 D E becomes Q0 B C D E A before dispatch; B runs next.

## 7. Expiry before boost: retained provisional policy

If an allotment expires at the boost boundary, demote and enqueue the process first. If only its quantum expires, rotate and enqueue it first. An early yield is also enqueued first. Then boost the queues.

Such a process participates in its queue's position in the flattened order; it is not necessarily last. For example, a runner demoted from Q0 to Q1 is boosted before existing Q2 work.

This retains the original collision ordering pending clarification from the instructor. It is a visualizer policy, not a claim that the feedback explicitly settled this case.

## 8. Arrivals and expiry without a boost

Admit arrivals before enqueuing a process whose quantum/allotment expired or that yielded. Check higher-priority preemption and dispatch afterward.

## 9. Complete boundary order

1. Remove a completed runner.
2. Detect allotment exhaustion, quantum expiry, or early yield, in that order.
3. On boost boundaries, enqueue expired/yielded work, boost waiting work, and append any ongoing runner with fresh budgets.
4. Admit new arrivals.
5. On ordinary boundaries, enqueue expired/yielded work.
6. Apply ordinary higher-priority preemption, preserving both counters.
7. Dispatch if the CPU is free.
8. Record the boundary state, then execute the next CPU tick.

The engine's optional `relinquishEarly` flag yields one tick before the current quantum expires, when that quantum is at least two ticks. It resets quantum usage, retains allotment usage, and appends to the same queue. It cannot avoid demotion by repeatedly yielding. The normal UI does not enable this flag.

Every movement is emitted as a typed transition, including CPU-to-Q0 boosts and same-queue rotations. Forward and reverse playback use those authoritative intermediate states.

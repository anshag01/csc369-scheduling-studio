# FCFS — First Come, First Served

One CPU, whole ticks, CPU-only processes. Service is the CPU work needed to finish. Switching processes costs no time.

## Rules

1. New arrivals join the back of the ready queue. Simultaneous arrivals keep input order.
2. When the CPU is free, run the queue head.
3. The running process keeps the CPU until it finishes. A new arrival cannot preempt it, even if the new process is shorter.
4. Each running tick reduces remaining service by one. At zero, the process leaves the system.
5. If no process is ready, the CPU stays idle until the next arrival. Stop when all processes have finished.

## At a time boundary

Complete the runner if finished → add arrivals → dispatch the queue head if the CPU is free.

A process already waiting stays ahead of a new arrival. Finishing and dispatching at the same boundary costs no extra tick.

## Example

Input order: A, B, C.

| Process | Arrival | Service |
| --- | --- | --- |
| A | 0 | 5 |
| B | 1 | 2 |
| C | 1 | 1 |

CPU: **A [0–5), B [5–7), C [7–8).**

A is not interrupted when B and C arrive. B runs before C because they arrived together and B came first in the input.

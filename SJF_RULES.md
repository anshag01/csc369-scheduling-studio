# SJF — Shortest Job First

One CPU, whole ticks, CPU-only processes. Service is the CPU work needed to finish. Switching processes costs no time.

## Rules

1. New arrivals join the ready queue. A process cannot run before its arrival time.
2. When the CPU is free, choose the ready process with the shortest original service time.
3. Break equal-service ties by earlier arrival, then input order. Process IDs do not break ties.
4. Once selected, a process runs until it finishes. A shorter arrival does not preempt it.
5. Each running tick reduces remaining service by one. At zero, the process leaves the system.
6. If no process is ready, wait for the next arrival. Do not leave the CPU idle to wait for a shorter future process. Stop when all processes finish.

The displayed ready queue keeps insertion order. The shortest process may be selected from the middle or back.

## At a time boundary

Complete the runner if finished → add arrivals → select the shortest ready service if the CPU is free.

A process arriving at the completion boundary is eligible immediately. Otherwise, the current runner continues.

## Example

Input order: A, B, C.

| Process | Arrival | Service |
| --- | --- | --- |
| A | 0 | 5 |
| B | 1 | 2 |
| C | 1 | 1 |

CPU: **A [0–5), C [5–6), B [6–8).**

A finishes before either arrival can run. At time 5, C is selected ahead of B because one service tick is shorter than two.

# RR — Round Robin

One CPU, whole ticks, CPU-only processes. Service is the CPU work needed to finish. Switching processes costs no time.

Quantum (time slice) is the maximum CPU time per turn. It must be a positive whole number; the default is 2 ticks.

## Rules

1. New arrivals join the back of one ready queue. Simultaneous arrivals keep input order.
2. Dispatch the queue head with a fresh quantum. Each running tick uses one service tick and one quantum tick.
3. A new arrival does not interrupt an ongoing turn.
4. If the process finishes, remove it. **Completion wins** if it coincides with quantum expiry.
5. If its quantum expires while unfinished, reset quantum usage and append it to the queue tail. Keep its remaining service.
6. At simultaneous arrival and expiry, admit arrivals before requeueing the expired process. Existing waiting processes remain ahead of both.
7. A lone process can expire and immediately run again with a fresh quantum. No tick is lost. If nobody is ready, wait for the next arrival; stop when all processes finish.

## At a time boundary

Complete the runner if finished → detect expiry → add arrivals → requeue expired work → dispatch if the CPU is free.

RR has no separate allotment, priority demotion, or boost.

## Example

Input order: A, B, C.

| Process | Arrival | Service |
| --- | --- | --- |
| A | 0 | 5 |
| B | 1 | 2 |
| C | 1 | 1 |

With quantum 2, CPU: **A [0–2), B [2–4), C [4–5), A [5–7), A [7–8).**

B finishes exactly at its quantum boundary. C finishes early. At time 7, A is alone and immediately starts a fresh turn.

**Arrival/expiry case:** A arrives at 0 needing four ticks; B arrives at 2 needing one. With quantum 2, the CPU sequence is `A A B A A`: B enters before A is requeued.

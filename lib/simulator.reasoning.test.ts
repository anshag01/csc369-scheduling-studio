import { describe, expect, it } from "vitest";
import { Algorithm, ProcessDefinition, SimulationConfig, simulate, validateSimulationConfig } from "./simulator";

const job = (id: string, arrivalTime: number, serviceTime: number): ProcessDefinition => ({ id, arrivalTime, serviceTime, color: "#4f6bed" });
const config = (algorithm: Algorithm, extra: Partial<SimulationConfig> = {}): SimulationConfig => ({ algorithm, quantum: 2, mlfqQuanta: [2, 4, 8], mlfqBoostInterval: 100, ...extra });

describe("decision explanations are grounded in the scheduling state", () => {
  it("explains the pictured arrival, demotion, and highest-priority choice with actual values", () => {
    const result = simulate([job("A", 0, 3), job("B", 2, 6), job("C", 4, 4)], config("mlfq"));
    expect(result.snapshots[4].events).toEqual([
      "C arrived and joined Q0.",
      "B used its full allotment and moved from Q0 to Q1. 2/2 ticks used; 4 service ticks remain.",
      "C was selected: it is first in Q0, the highest-priority non-empty queue. Lower-priority queues must wait.",
    ]);
    expect(result.snapshots[4].running).toBe("C");
    expect(result.snapshots[4].readyQueues).toEqual([[], ["A", "B"], []]);
  });

  it("distinguishes SJF input-order ties from earlier-arrival ties", () => {
    const simultaneous = simulate([job("C", 0, 2), job("A", 0, 2)], config("sjf"));
    expect(simultaneous.snapshots[0].events.at(-1)).toBe("C was selected: shortest service time among ready processes (2 ticks). Equal lengths and arrival times are resolved by input order.");
    const staggered = simulate([job("X", 0, 4), job("C", 2, 2), job("B", 1, 2)], config("sjf"));
    expect(staggered.snapshots[4].running).toBe("B");
    expect(staggered.snapshots[4].events.at(-1)).toBe("B was selected: shortest service time among ready processes (2 ticks). Equal lengths are resolved by earlier arrival, then input order.");
  });

  it("explains why STCF keeps an equal remainder and preempts a strictly longer one", () => {
    const equal = simulate([job("A", 0, 5), job("B", 2, 3)], config("stcf"));
    expect(equal.snapshots[2].events.at(-1)).toBe("A continues: it and B each have 3 ticks left. STCF keeps the current process on an equal-time tie.");
    expect(equal.snapshots[2].running).toBe("A");
    const shorter = simulate([job("A", 0, 5), job("B", 2, 2)], config("stcf"));
    expect(shorter.snapshots[2].events).toContain("B has less remaining time, so A was preempted. 2 < 3 ticks remaining.");
    expect(shorter.snapshots[2].events.at(-1)).toBe("B was selected: shortest remaining time among ready processes (2 ticks).");
  });

  it("explains non-preemption even when a shorter job arrives", () => {
    for (const algorithm of ["fcfs", "sjf"] as const) {
      const boundary = simulate([job("A", 0, 8), job("B", 1, 2)], config(algorithm)).snapshots[1];
      expect(boundary.running).toBe("A");
      expect(boundary.events.at(-1)).toBe(`A continues with 7 ticks left: ${algorithm.toUpperCase()} is non-preemptive, so ready processes must wait for it to finish.`);
    }
  });

  it("shows remaining RR budget and explains same-time arrival ordering", () => {
    const result = simulate([job("A", 0, 4), job("B", 2, 2)], config("rr"));
    expect(result.snapshots[1].events).toEqual(["A continues: 1/2 quantum ticks used; 1 remain in this turn."]);
    expect(result.snapshots[2].events[1]).toBe("A's quantum expired; it moved to the back of the ready queue. 2/2 ticks used; 2 service ticks remain. Same-time arrivals enter before the expired process.");
    expect(result.snapshots[2].events.at(-1)).toBe("B was selected: first in the Round Robin queue, with a fresh 2-tick quantum.");
  });

  it("names Q0 for a single-queue MLFQ and does not invent a lower level", () => {
    const result = simulate([job("A", 0, 3)], config("mlfq", { mlfqQuanta: [1] }));
    expect(result.snapshots[0].events[0]).toBe("A arrived and joined Q0.");
    expect(result.snapshots[1].events[0]).toBe("A used its full allotment and returned to Q0. 1/1 ticks used; it stays at the lowest priority with a fresh allotment.");
    expect(result.snapshots[1].events.join(" ")).not.toContain("Q1");
  });

  it("explains the protected running turn after a boost without resetting its budget", () => {
    const result = simulate([job("A", 0, 10), job("B", 0, 5)], config("mlfq", { mlfqQuanta: [1, 4, 8], mlfqBoostInterval: 4 }));
    const boundary = result.snapshots[4];
    expect(boundary.running).toBe("A");
    expect(boundary.readyQueues[0]).toEqual(["B"]);
    expect(boundary.events.at(-1)).toBe("A continues in Q1: the boost preserves its current CPU turn (2/4 allotment ticks used).");
    expect(result.snapshots[5].events.at(-1)).toBe("A continues in Q1: the boost preserves its current CPU turn (3/4 allotment ticks used).");
  });

  it("explains idle time immediately after completion and marks the final boundary", () => {
    const result = simulate([job("A", 0, 1), job("B", 4, 1)], config("rr"));
    expect(result.snapshots[1].events).toEqual([
      "A finished and left the system.",
      "The CPU is idle while the scheduler waits for the next arrival. No process is ready; next arrival at t=4.",
    ]);
    expect(result.snapshots.at(-1)?.events).toEqual(["B finished and left the system.", "All 2 processes have finished; the simulation is complete."]);
    expect(result.snapshots.every((snapshot) => snapshot.events.length > 0)).toBe(true);
  });

  it("rejects unknown policies and malformed queue configurations explicitly", () => {
    expect(() => validateSimulationConfig(config("unknown" as Algorithm))).toThrow("supported scheduling algorithm");
    expect(() => validateSimulationConfig(config("mlfq", { mlfqQuanta: null as unknown as number[] }))).toThrow("at least one queue");
  });
});

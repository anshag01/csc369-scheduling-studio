import { describe, expect, it } from "vitest";
import { ProcessDefinition, SimulationConfig, simulate } from "./simulator";

const process = (
  id: string,
  arrivalTime: number,
  serviceTime: number,
  relinquishEarly = false,
): ProcessDefinition => ({
  id,
  arrivalTime,
  serviceTime,
  color: "#4f6bed",
  relinquishEarly,
});

const config = (mlfqQuanta: number[], mlfqBoostInterval = 100): SimulationConfig => ({
  algorithm: "mlfq",
  quantum: 2,
  mlfqQuanta,
  mlfqBoostInterval,
});

describe("explicit MLFQ policy regressions", () => {
  it("admits every new job to Q0", () => {
    const result = simulate(
      [process("A", 0, 5), process("B", 1, 1)],
      config([2, 4, 8]),
    );

    const boundary = result.snapshots[1];
    expect(boundary.processes.find((item) => item.id === "B")?.queueLevel).toBe(0);
    expect(boundary.readyQueues[0]).toContain("B");
  });

  it("preempts a lower queue as soon as higher-priority work is ready", () => {
    const result = simulate(
      [process("A", 0, 8), process("B", 3, 1)],
      config([2, 4, 8]),
    );

    expect(result.timeline.slice(0, 4).map((slice) => slice.processId).join("")).toBe("AAAB");
    expect(result.snapshots[3].events).toContain(
      "A was preempted by a process in a higher-priority queue.",
    );
    expect(result.snapshots[3].readyQueues[1][0]).toBe("A");
  });

  it("uses Round Robin between jobs at the same level", () => {
    const result = simulate(
      [process("A", 0, 4), process("B", 0, 4)],
      config([2]),
    );

    expect(result.timeline.map((slice) => slice.processId).join("")).toBe("AABBAABB");
  });

  it("demotes after cumulative CPU use reaches the queue allotment", () => {
    const result = simulate(
      [process("A", 0, 8), process("B", 3, 1)],
      config([2, 4, 8]),
    );

    expect(result.snapshots[3].processes.find((item) => item.id === "A")?.allotmentUsed).toBe(1);
    expect(result.snapshots[7].events).toContain(
      "A used its full allotment and moved from Q1 to Q2.",
    );
  });

  it("does not reset accumulated allotment when a process yields", () => {
    const result = simulate(
      [process("A", 0, 6, true), process("B", 0, 4)],
      config([4, 8]),
    );

    expect(result.snapshots[3].events).toContain(
      "A gave up the CPU one tick early at Q0; 3/4 used ticks remain accounted.",
    );
    expect(result.snapshots[3].processes.find((item) => item.id === "A")?.allotmentUsed).toBe(3);
    expect(result.snapshots[8].events).toContain(
      "A used its full allotment and moved from Q0 to Q1.",
    );
  });

  it("moves every waiting unfinished job, but not finished or running jobs, to Q0 on a boost", () => {
    const result = simulate(
      [process("A", 0, 1), process("B", 0, 12), process("C", 2, 5)],
      config([1, 3, 6], 4),
    );

    const boundary = result.snapshots[4];
    expect(boundary.processes.find((item) => item.id === "A")?.state).toBe("finished");
    for (const unfinished of boundary.processes.filter((item) => item.state === "ready")) {
      expect(unfinished.queueLevel).toBe(0);
      expect(unfinished.allotmentUsed).toBe(0);
    }
    expect(boundary.events.some((event) => event.startsWith("Priority boost moved 1 waiting process to Q0"))).toBe(true);
  });
});

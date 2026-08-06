import { describe, expect, it } from "vitest";
import {
  Algorithm,
  MAX_PROCESSES,
  MAX_SIMULATION_TICKS,
  ProcessDefinition,
  SimulationConfig,
  simulate,
  validateProcesses,
  validateSimulationConfig,
} from "./simulator";

const process = (id: string, arrivalTime: number, serviceTime: number): ProcessDefinition => ({
  id,
  arrivalTime,
  serviceTime,
  color: "#4f6bed",
});

const config = (algorithm: Algorithm, overrides: Partial<SimulationConfig> = {}): SimulationConfig => ({
  algorithm,
  quantum: 2,
  mlfqQuanta: [2, 4, 8],
  mlfqBoostInterval: 100,
  ...overrides,
});

const trace = (algorithm: Algorithm, processes: ProcessDefinition[], overrides: Partial<SimulationConfig> = {}) =>
  simulate(processes, config(algorithm, overrides)).timeline.map((slice) => slice.processId ?? "-").join("");

describe("scheduler edge cases and failure containment", () => {
  it("rejects every malformed process shape that could corrupt a simulation", () => {
    expect(validateProcesses([])).toMatch(/at least one/i);
    expect(validateProcesses([process("", 0, 1)])).toMatch(/needs an ID/i);
    expect(validateProcesses([process("A", 0, 1), process(" a ", 1, 1)])).toMatch(/unique/i);
    expect(validateProcesses([process("A", -1, 1)])).toMatch(/arrival/i);
    expect(validateProcesses([process("A", 0.5, 1)])).toMatch(/arrival/i);
    expect(validateProcesses([process("A", Number.MAX_SAFE_INTEGER + 1, 1)])).toMatch(/arrival/i);
    expect(validateProcesses([process("A", 0, 0)])).toMatch(/service/i);
    expect(validateProcesses([process("A", 0, 1.5)])).toMatch(/service/i);
    expect(validateProcesses([process("A", 0, Number.POSITIVE_INFINITY)])).toMatch(/service/i);
    expect(validateProcesses(Array.from({ length: MAX_PROCESSES + 1 }, (_, index) => process(`P${index}`, 0, 1)))).toMatch(/no more than/i);
    expect(validateProcesses([process("A", MAX_SIMULATION_TICKS, 1)])).toMatch(/complete simulation/i);
    expect(validateProcesses([process("A", 0, 1000), process("B", 1000, 1000)])).toBeNull();
  });

  it("throws before running invalid direct API inputs or scheduler parameters", () => {
    expect(() => simulate([], config("fcfs"))).toThrow(/at least one/i);
    expect(() => validateSimulationConfig(config("rr", { quantum: 0 }))).toThrow(/quantum/i);
    expect(() => validateSimulationConfig(config("rr", { quantum: 1.5 }))).toThrow(/quantum/i);
    expect(() => validateSimulationConfig(config("mlfq", { mlfqQuanta: [] }))).toThrow(/at least one queue/i);
    expect(() => validateSimulationConfig(config("mlfq", { mlfqQuanta: [1, 0] }))).toThrow(/allotment/i);
    expect(() => validateSimulationConfig(config("mlfq", { mlfqQuanta: [1, 2.5] }))).toThrow(/allotment/i);
    expect(() => validateSimulationConfig(config("mlfq", { mlfqBoostInterval: 0 }))).toThrow(/boost interval/i);
    expect(() => validateSimulationConfig(config("mlfq", { mlfqBoostInterval: Number.NaN }))).toThrow(/boost interval/i);
  });

  it("handles a one-tick quantum and a one-tick MLFQ allotment", () => {
    const jobs = [process("A", 0, 2), process("B", 0, 2), process("C", 0, 2)];
    expect(trace("rr", jobs, { quantum: 1 })).toBe("ABCABC");

    const mlfq = simulate([process("A", 0, 4)], config("mlfq", {
      quantum: 1,
      mlfqQuanta: [1, 1, 1],
      mlfqBoostInterval: 100,
    }));
    expect(mlfq.timeline.map((slice) => slice.processId).join("")).toBe("AAAA");
    expect(mlfq.snapshots[1].events).toContain("A used its full allotment and moved from Q0 to Q1.");
    expect(mlfq.snapshots[2].events).toContain("A used its full allotment and moved from Q1 to Q2.");
    expect(mlfq.snapshots[3].events).toContain("A used its full allotment and returned to Q2.");
  });

  it("preserves original input order for every simultaneous stable tie", () => {
    const tied = [process("C", 0, 2), process("A", 0, 2), process("B", 0, 2)];
    expect(trace("fcfs", tied)).toBe("CCAABB");
    expect(trace("sjf", tied)).toBe("CCAABB");
    expect(trace("stcf", tied)).toBe("CCAABB");
    expect(trace("rr", tied, { quantum: 1 })).toBe("CABCAB");
    expect(trace("mlfq", tied, { mlfqQuanta: [1, 2], mlfqBoostInterval: 100 })).toBe("CABCAB");
  });

  it("keeps SJF non-preemptive and STCF preempts only for a strictly shorter remainder", () => {
    const equalRemainder = [process("A", 0, 5), process("B", 2, 3)];
    expect(trace("sjf", equalRemainder)).toBe("AAAAABBB");
    expect(trace("stcf", equalRemainder)).toBe("AAAAABBB");

    const strictlyShorter = [process("A", 0, 5), process("B", 2, 2)];
    expect(trace("stcf", strictlyShorter)).toBe("AABBAAA");
    const boundary = simulate(strictlyShorter, config("stcf")).snapshots[2];
    expect(boundary.events).toContain("B has less remaining time, so A was preempted.");
    expect(boundary.running).toBe("B");
    expect(boundary.readyQueues[0]).toEqual(["A"]);
  });

  it("applies the lecture RR arrival-before-expired-process rule even at quantum one", () => {
    const result = simulate(
      [process("A", 0, 2), process("B", 1, 1)],
      config("rr", { quantum: 1 }),
    );
    expect(result.timeline.map((slice) => slice.processId).join("")).toBe("ABA");
    expect(result.snapshots[1].events).toEqual([
      "B arrived and joined the ready queue.",
      "A's quantum expired; it moved to the back of the ready queue.",
      "B was selected as the process at the head of the Round Robin queue.",
    ]);
  });

  it("finishes a process before handling a same-boundary arrival without a false expiry", () => {
    for (const algorithm of ["fcfs", "sjf", "stcf", "rr", "mlfq"] as const) {
      const result = simulate(
        [process("A", 0, 2), process("B", 2, 1)],
        config(algorithm, algorithm === "mlfq" ? { mlfqQuanta: [2, 4] } : {}),
      );
      expect(result.timeline.map((slice) => slice.processId).join("")).toBe("AAB");
      const boundary = result.snapshots[2];
      expect(boundary.processes.find((item) => item.id === "A")?.state).toBe("finished");
      expect(boundary.running).toBe("B");
      expect(boundary.events[0]).toBe("A finished and left the system.");
      expect(boundary.events.some((event) => /quantum expired|full allotment/.test(event))).toBe(false);
    }
  });

  it("shows every idle tick and dispatches immediately at the arrival boundary", () => {
    for (const algorithm of ["fcfs", "sjf", "stcf", "rr", "mlfq"] as const) {
      const result = simulate([process("A", 5, 2)], config(algorithm));
      expect(result.timeline.map((slice) => slice.processId ?? "-").join("")).toBe("-----AA");
      for (let time = 0; time < 5; time += 1) {
        expect(result.snapshots[time].running).toBeNull();
        expect(result.snapshots[time].events).toContain("The CPU is idle while the scheduler waits for the next arrival.");
      }
      expect(result.snapshots[5].running).toBe("A");
    }
  });

  it("does not preempt MLFQ for a same-level arrival but does for a higher-level arrival", () => {
    const result = simulate(
      [process("A", 0, 8), process("B", 1, 1), process("C", 4, 1)],
      config("mlfq", { mlfqQuanta: [2, 4, 8], mlfqBoostInterval: 100 }),
    );
    expect(result.snapshots[1].running).toBe("A");
    expect(result.snapshots[1].events.some((event) => event.includes("preempted"))).toBe(false);
    expect(result.snapshots[4].running).toBe("C");
    expect(result.snapshots[4].events).toContain("A was preempted by a process in a higher-priority queue.");
    expect(result.snapshots[4].processes.find((item) => item.id === "A")?.allotmentUsed).toBe(1);
  });

  it("boosts only unfinished work and resets every active MLFQ allotment", () => {
    const result = simulate(
      [process("A", 0, 1), process("B", 0, 12), process("C", 2, 5)],
      config("mlfq", { mlfqQuanta: [1, 3, 6], mlfqBoostInterval: 4 }),
    );
    const boost = result.snapshots[4];
    expect(boost.processes.find((item) => item.id === "A")?.state).toBe("finished");
    for (const active of boost.processes.filter((item) => item.state !== "finished")) {
      expect(active.queueLevel).toBe(0);
      expect(active.allotmentUsed).toBe(0);
    }
    expect(new Set(boost.readyQueues.flat()).size).toBe(boost.readyQueues.flat().length);
  });

  it("does not mutate caller-owned process definitions and is deterministic", () => {
    const jobs = [process("B", 2, 3), process("A", 0, 4)];
    const before = structuredClone(jobs);
    const first = simulate(jobs, config("stcf"));
    const second = simulate(jobs, config("stcf"));
    expect(jobs).toEqual(before);
    expect(second).toEqual(first);
  });
});

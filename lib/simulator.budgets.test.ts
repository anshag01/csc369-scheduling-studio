import { describe, expect, it } from "vitest";
import { ProcessDefinition, SimulationConfig, simulate, validateSimulationConfig } from "./simulator";

const job = (id: string, arrivalTime = 0, serviceTime = 10): ProcessDefinition => ({ id, arrivalTime, serviceTime, color: "#456" });
const config = (mlfqQuanta: number[], mlfqAllotments: number[], mlfqBoostInterval?: number): SimulationConfig =>
  ({ algorithm: "mlfq", quantum: 2, mlfqQuanta, mlfqAllotments, mlfqBoostInterval });

describe("independent MLFQ turn and priority budgets", () => {
  it("gives four one-tick turns before demotion with quantum 1 and allotment 4", () => {
    const result = simulate([job("A"), job("B")], config([1, 2], [4, 8]));
    expect(result.timeline.slice(0, 8).map((tick) => tick.processId).join("")).toBe("ABABABAB");
    for (const time of [1, 3, 5]) {
      expect(result.snapshots[time].processes.find((p) => p.id === "A")).toMatchObject({
        queueLevel: 0, quantumUsed: 0, allotmentUsed: (time + 1) / 2,
      });
      expect(result.snapshots[time].transitions[0].action).toBe("rotate");
    }
    expect(result.snapshots[7].processes.find((p) => p.id === "A")).toMatchObject({ queueLevel: 1, quantumUsed: 0, allotmentUsed: 0 });
    expect(result.snapshots[7].transitions[0].action).toBe("demote");
  });

  it("demotes midway through the second turn with quantum 2 and allotment 3", () => {
    const result = simulate([job("A"), job("B")], config([2, 4], [3, 8]));
    expect(result.timeline.slice(0, 6).map((tick) => tick.processId).join("")).toBe("AABBAB");
    expect(result.snapshots[4].processes.find((p) => p.id === "A")).toMatchObject({ quantumUsed: 0, allotmentUsed: 2 });
    expect(result.snapshots[5].transitionStart.processes.find((p) => p.id === "A")).toMatchObject({ quantumUsed: 1, allotmentUsed: 3 });
    expect(result.snapshots[5].processes.find((p) => p.id === "A")).toMatchObject({ queueLevel: 1, quantumUsed: 0, allotmentUsed: 0, remainingTime: 7 });
  });

  it("allows an allotment smaller than the quantum and gives the bottom queue a fresh budget", () => {
    const result = simulate([job("A")], config([5, 5], [1, 2]));
    expect(result.snapshots[1].runningQueueLevel).toBe(1);
    expect(result.snapshots[3].processes[0]).toMatchObject({ queueLevel: 1, quantumUsed: 0, allotmentUsed: 0, remainingTime: 7 });
  });

  it("preserves both counters across higher-priority preemption", () => {
    const result = simulate([job("A", 0, 15), job("B", 3, 1)], config([1, 4], [1, 7]));
    expect(result.snapshots[3].running).toBe("B");
    expect(result.snapshots[3].processes[0]).toMatchObject({ state: "ready", queueLevel: 1, quantumUsed: 2, allotmentUsed: 2 });
    expect(result.snapshots[4].processes[0]).toMatchObject({ state: "running", quantumUsed: 2, allotmentUsed: 2 });
    expect(result.snapshots[6].transitions[0].action).toBe("rotate");
    expect(result.snapshots[6].processes[0]).toMatchObject({ quantumUsed: 0, allotmentUsed: 4 });
  });

  it("cannot avoid demotion through repeated early yields", () => {
    const result = simulate([{ ...job("A"), relinquishEarly: true }], config([2, 4], [5, 8]));
    for (let t = 1; t < 5; t++) {
      expect(result.snapshots[t].transitions[0].action).toBe("yield");
      expect(result.snapshots[t].processes[0]).toMatchObject({ quantumUsed: 0, allotmentUsed: t });
    }
    expect(result.snapshots[5].processes[0].queueLevel).toBe(1);
  });

  it("resets a lone runner at a boost without resetting remaining CPU service", () => {
    const result = simulate([job("A")], config([1, 4], [1, 8], 2));
    expect(result.snapshots[2].transitionStart.runningQueueLevel).toBe(1);
    expect(result.snapshots[2].transitions.map((phase) => phase.action)).toEqual(["boost", "dispatch"]);
    expect(result.snapshots[2].processes[0]).toMatchObject({ state: "running", queueLevel: 0, quantumUsed: 0, allotmentUsed: 0, remainingTime: 8 });
  });

  it("puts same-time arrivals after waiting work and the boosted runner", () => {
    const result = simulate([job("A"), job("B"), job("C", 2)], config([4], [8], 2));
    expect(result.snapshots[2].running).toBe("B");
    expect(result.snapshots[2].readyQueues).toEqual([["A", "C"]]);
    expect(result.snapshots[2].transitions.map((phase) => phase.action)).toEqual(["boost", "arrive", "dispatch"]);
  });

  it("boosts an exhausted runner after waiting lower-priority work", () => {
    const result = simulate([job("X"), job("B", 3)], config([1, 1, 8], [1, 1, 8], 4));
    const boundary = result.snapshots[4];
    expect(boundary.transitions.map((phase) => phase.action)).toEqual(["boost", "dispatch"]);
    expect(boundary.running).toBe("X");
    expect(boundary.readyQueues).toEqual([["B"], [], []]);
  });

  it("boosts an expired quantum directly without an intermediate rotation", () => {
    const result = simulate([job("A"), job("B")], config([2], [5], 2));
    const boundary = result.snapshots[2];
    expect(boundary.transitions.map((phase) => phase.action)).toEqual(["boost", "dispatch"]);
    expect(boundary.running).toBe("B");
    expect(boundary.readyQueues).toEqual([["A"]]);
    expect(boundary.processes.every((p) => p.quantumUsed === 0 && p.allotmentUsed === 0)).toBe(true);
  });

  it("uses Bogdan's B C D A order, with same-time arrivals after A", () => {
    const result = simulate([
      job("D", 0, 20), job("C", 4, 10), job("A", 5, 10), job("B", 5, 10), job("E", 6, 1),
    ], config([1, 3, 8], [1, 3, 8], 6));
    const boundary = result.snapshots[6];
    expect(boundary.transitionStart).toMatchObject({ running: "A", readyQueues: [["B"], ["C"], ["D"]] });
    expect(boundary.transitionStart.processes.find((p) => p.id === "A")).toMatchObject({
      queueLevel: 0, quantumUsed: 1, allotmentUsed: 1, remainingTime: 9,
    });
    expect(boundary.transitions.map((phase) => phase.action)).toEqual(["boost", "arrive", "dispatch"]);
    const boosted = boundary.transitions[0];
    expect(boosted.after).toMatchObject({ running: null, readyQueues: [["B", "C", "D", "A"], [], []] });
    expect(boosted.moves.at(-1)).toEqual({ processId: "A", from: { place: "cpu" }, to: { place: "q0", index: 3 } });
    expect(boundary.transitions[1].after.readyQueues).toEqual([["B", "C", "D", "A", "E"], [], []]);
    expect(boundary.running).toBe("B");
    expect(boundary.readyQueues).toEqual([["C", "D", "A", "E"], [], []]);
    expect(boundary.processes.find((p) => p.id === "A")).toMatchObject({
      queueLevel: 0, quantumUsed: 0, allotmentUsed: 0, remainingTime: 9,
    });
  });

  it.each([
    { name: "both budgets in Q0", quanta: [2, 4, 8], allotments: [2, 4, 8], time: 2, level: 0 },
    { name: "only quantum in Q0", quanta: [2, 4, 8], allotments: [3, 4, 8], time: 2, level: 0 },
    { name: "allotment midway through a quantum", quanta: [4, 4, 8], allotments: [2, 4, 8], time: 2, level: 0 },
    { name: "both budgets in Q1", quanta: [1, 2, 4], allotments: [1, 2, 4], time: 4, level: 1 },
    { name: "both budgets in Q2", quanta: [1, 1, 2], allotments: [1, 1, 2], time: 6, level: 2 },
  ])("boost overrides $name expiry", ({ quanta, allotments, time, level }) => {
    const boundary = simulate([job("A"), job("B")], config(quanta, allotments, time)).snapshots[time];
    expect(boundary.transitionStart.running).toBe("A");
    expect(boundary.transitionStart.runningQueueLevel).toBe(level);
    expect(boundary.transitions.map((phase) => phase.action)).toEqual(["boost", "dispatch"]);
    expect(boundary.transitions[0].after.readyQueues).toEqual([["B", "A"], [], []]);
    expect(boundary.running).toBe("B");
    expect(boundary.processes.find((p) => p.id === "A")).toMatchObject({
      queueLevel: 0, quantumUsed: 0, allotmentUsed: 0,
      remainingTime: boundary.transitionStart.runningRemaining,
    });
  });

  it("boosts a lone expired runner directly and immediately redispatches it", () => {
    const boundary = simulate([job("A")], config([2, 4, 8], [2, 4, 8], 2)).snapshots[2];
    expect(boundary.transitions.map((phase) => phase.action)).toEqual(["boost", "dispatch"]);
    expect(boundary.running).toBe("A");
    expect(boundary.processes[0]).toMatchObject({ queueLevel: 0, quantumUsed: 0, allotmentUsed: 0, remainingTime: 8 });
  });

  it("boost takes precedence over an engine-only early yield", () => {
    const boundary = simulate([{ ...job("A"), relinquishEarly: true }, job("B")], config([4, 8], [8, 8], 3)).snapshots[3];
    expect(boundary.transitions.map((phase) => phase.action)).toEqual(["boost", "dispatch"]);
    expect(boundary.transitions[0].moves.at(-1)?.from).toEqual({ place: "cpu" });
    expect(boundary.running).toBe("B");
    expect(boundary.processes[0]).toMatchObject({ queueLevel: 0, quantumUsed: 0, allotmentUsed: 0, remainingTime: 7 });
  });

  it("completes before quantum, allotment, and boost handling", () => {
    const result = simulate([job("A", 0, 2), job("B")], config([2], [2], 2));
    expect(result.snapshots[2].transitions.map((phase) => phase.action)).toEqual(["finish", "dispatch"]);
    expect(result.snapshots[2].processes[0]).toMatchObject({ state: "finished", remainingTime: 0 });
  });

  it.each([[], [1], [1, 0], [1, 1.5], [1, Infinity], [1, Number.MAX_SAFE_INTEGER + 1]])("rejects malformed allotments %j", (...values) => {
    expect(() => validateSimulationConfig(config([2, 4], values))).toThrow(/allotment/);
  });
});

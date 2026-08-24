import { describe, expect, it } from "vitest";
import {
  Algorithm,
  ProcessDefinition,
  SchedulerVisualState,
  simulate,
  Snapshot,
} from "./simulator";

const process = (id: string, arrivalTime: number, serviceTime: number): ProcessDefinition => ({
  id,
  arrivalTime,
  serviceTime,
  color: "#4f6bed",
});

const stateOf = (snapshot: Snapshot): SchedulerVisualState => ({
  running: snapshot.running,
  readyQueues: snapshot.readyQueues,
  processes: snapshot.processes,
  runningRemaining: snapshot.runningRemaining,
  runningQueueLevel: snapshot.runningQueueLevel,
});

function locate(state: SchedulerVisualState, processId: string, algorithm: Algorithm) {
  if (state.running === processId) return { place: "cpu" };
  for (const [queueIndex, queue] of state.readyQueues.entries()) {
    const index = queue.indexOf(processId);
    if (index >= 0) {
      return {
        place: algorithm === "mlfq" ? `q${queueIndex}` : "ready",
        index,
      };
    }
  }
  const view = state.processes.find((item) => item.id === processId);
  return { place: view?.state === "finished" ? "finished" : "future" };
}

describe("authoritative scheduler transition phases", () => {
  it("records every MLFQ collision phase in exact boundary order", () => {
    const result = simulate([
      process("A", 0, 6),
      process("X", 0, 3),
      process("B", 2, 2),
    ], {
      algorithm: "mlfq",
      quantum: 2,
      mlfqQuanta: [2, 4, 8],
      mlfqBoostInterval: 2,
    });

    const boundary = result.snapshots[2];
    expect(boundary.transitions.map((phase) => phase.action)).toEqual([
      "demote",
      "boost",
      "arrive",
      "dispatch",
    ]);
    expect(boundary.transitions.map((phase) => phase.moves)).toEqual([
      [{
        processId: "A",
        from: { place: "cpu" },
        to: { place: "q1", index: 0 },
      }],
      [
        {
          processId: "X",
          from: { place: "q0", index: 0 },
          to: { place: "q0", index: 0 },
        },
        {
          processId: "A",
          from: { place: "q1", index: 0 },
          to: { place: "q0", index: 1 },
        },
      ],
      [{
        processId: "B",
        from: { place: "future" },
        to: { place: "q0", index: 2 },
      }],
      [{
        processId: "X",
        from: { place: "q0", index: 0 },
        to: { place: "cpu" },
      }],
    ]);

    expect(boundary.transitionStart.running).toBe("A");
    expect(boundary.transitionStart.readyQueues).toEqual([["X"], [], []]);
    expect(boundary.transitions[0].after).toMatchObject({ running: null, readyQueues: [["X"], ["A"], []] });
    expect(boundary.transitions[1].after).toMatchObject({ running: null, readyQueues: [["X", "A"], [], []] });
    expect(boundary.transitions[2].after).toMatchObject({ running: null, readyQueues: [["X", "A", "B"], [], []] });
    expect(boundary.transitions[3].after).toEqual(stateOf(boundary));
  });

  it("records RR arrival before rotation at an exact quantum boundary", () => {
    const boundary = simulate([
      process("A", 0, 4),
      process("B", 2, 1),
    ], {
      algorithm: "rr",
      quantum: 2,
      mlfqQuanta: [2, 4, 8],
      mlfqBoostInterval: 100,
    }).snapshots[2];

    expect(boundary.transitions.map((phase) => phase.action)).toEqual(["arrive", "rotate", "dispatch"]);
    expect(boundary.transitions[0].after).toMatchObject({ running: "A", readyQueues: [["B"]] });
    expect(boundary.transitions[0].after.processes.find((item) => item.id === "A")?.state).toBe("running");
    expect(boundary.transitions[1].after.readyQueues).toEqual([["B", "A"]]);
    expect(boundary.running).toBe("B");
    expect(boundary.readyQueues).toEqual([["A"]]);
  });

  it("records STCF arrival, preemption, and dispatch as separate phases", () => {
    const boundary = simulate([
      process("A", 0, 5),
      process("B", 2, 1),
    ], {
      algorithm: "stcf",
      quantum: 2,
      mlfqQuanta: [2, 4, 8],
      mlfqBoostInterval: 100,
    }).snapshots[2];

    expect(boundary.transitions.map((phase) => phase.action)).toEqual(["arrive", "preempt", "dispatch"]);
    expect(boundary.transitions[1].moves[0]).toEqual({
      processId: "A",
      from: { place: "cpu" },
      to: { place: "ready", index: 1 },
    });
    expect(boundary.transitions[2].moves[0].processId).toBe("B");
  });

  it("never gives the protected running process a boost move", () => {
    const boundary = simulate([
      process("A", 0, 10),
      process("B", 0, 5),
    ], {
      algorithm: "mlfq",
      quantum: 2,
      mlfqQuanta: [1, 4, 8],
      mlfqBoostInterval: 4,
    }).snapshots[4];

    const boost = boundary.transitions.find((phase) => phase.action === "boost");
    expect(boundary.running).toBe("A");
    expect(boost?.moves.map((move) => move.processId)).toEqual(["B"]);
    expect(boost?.moves.some((move) => move.processId === "A")).toBe(false);
    expect(boost?.after.running).toBe("A");
  });

  it("ends every non-empty phase sequence at the unchanged final snapshot", () => {
    const algorithms: Algorithm[] = ["fcfs", "sjf", "stcf", "rr", "mlfq"];
    for (const algorithm of algorithms) {
      const result = simulate([
        process("A", 0, 4),
        process("B", 2, 2),
        process("C", 2, 1),
      ], {
        algorithm,
        quantum: 2,
        mlfqQuanta: [2, 4, 8],
        mlfqBoostInterval: 3,
      });
      for (const snapshot of result.snapshots) {
        const finalPhase = snapshot.transitions.at(-1);
        if (finalPhase) expect(finalPhase.after).toEqual(stateOf(snapshot));
      }
    }
  });

  it("preserves every typed endpoint and intermediate view across deterministic randomized workloads", () => {
    const algorithms: Algorithm[] = ["fcfs", "sjf", "stcf", "rr", "mlfq"];
    let seed = 0x3692026;
    const random = (maximum: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % maximum;
    };

    for (let workload = 0; workload < 80; workload += 1) {
      const algorithm = algorithms[workload % algorithms.length];
      const definitions = Array.from({ length: 1 + random(6) }, (_, index) => ({
        ...process(`P${index}`, random(8), 1 + random(8)),
        relinquishEarly: random(5) === 0,
      }));
      const result = simulate(definitions, {
        algorithm,
        quantum: 1 + random(4),
        mlfqQuanta: [1 + random(4), 2 + random(5), 4 + random(7)],
        mlfqBoostInterval: 1 + random(8),
      });

      for (const snapshot of result.snapshots) {
        let before = snapshot.transitionStart;
        for (const phase of snapshot.transitions) {
          expect(phase.moves.length).toBeGreaterThan(0);
          expect(phase.after).not.toEqual(before);
          const actors = new Set(phase.moves.map((move) => move.processId));
          for (const move of phase.moves) {
            expect(locate(before, move.processId, algorithm)).toEqual(move.from);
            expect(locate(phase.after, move.processId, algorithm)).toEqual(move.to);
          }
          for (const previousView of before.processes) {
            if (actors.has(previousView.id)) continue;
            expect(phase.after.processes.find((item) => item.id === previousView.id)).toEqual(previousView);
          }
          before = phase.after;
        }
        if (snapshot.transitions.length > 0) expect(before).toEqual(stateOf(snapshot));

        let reverse = stateOf(snapshot);
        for (let phaseIndex = snapshot.transitions.length - 1; phaseIndex >= 0; phaseIndex -= 1) {
          const phase = snapshot.transitions[phaseIndex];
          const preceding = phaseIndex === 0
            ? snapshot.transitionStart
            : snapshot.transitions[phaseIndex - 1].after;
          for (const move of phase.moves) {
            expect(locate(reverse, move.processId, algorithm)).toEqual(move.to);
            expect(locate(preceding, move.processId, algorithm)).toEqual(move.from);
          }
          reverse = preceding;
        }
        expect(reverse).toEqual(snapshot.transitionStart);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { Algorithm, ProcessDefinition, SimulationConfig, simulate } from "./simulator";

const definition = (id: string, arrivalTime: number, serviceTime: number): ProcessDefinition => ({
  id,
  arrivalTime,
  serviceTime,
  color: "#4f6bed",
});

const config = (algorithm: Algorithm, quantum = 2): SimulationConfig => ({
  algorithm,
  quantum,
  mlfqQuanta: [2, 4, 8],
  mlfqBoostInterval: 10,
});

function timeline(algorithm: Algorithm, processes: ProcessDefinition[], quantum = 2) {
  return simulate(processes, config(algorithm, quantum)).timeline.map((slice) => slice.processId ?? "-").join("");
}

function referenceTimeline(
  algorithm: Exclude<Algorithm, "mlfq">,
  definitions: ProcessDefinition[],
  quantum = 2,
) {
  const jobs = definitions.map((process, index) => ({
    ...process,
    index,
    remaining: process.serviceTime,
  }));
  const ready: typeof jobs = [];
  const result: string[] = [];
  let running: (typeof jobs)[number] | null = null;
  let sliceUsed = 0;

  const stableBefore = (left: (typeof jobs)[number], right: (typeof jobs)[number]) =>
    left.arrivalTime - right.arrivalTime || left.index - right.index;

  for (let time = 0; jobs.some((job) => job.remaining > 0); time += 1) {
    if (running?.remaining === 0) {
      running = null;
      sliceUsed = 0;
    }

    let expired: (typeof jobs)[number] | null = null;
    if (algorithm === "rr" && running && sliceUsed === quantum) {
      expired = running;
      running = null;
      sliceUsed = 0;
    }

    for (const job of jobs) {
      if (job.arrivalTime === time && job.remaining > 0) ready.push(job);
    }
    if (expired) ready.push(expired);

    if (
      algorithm === "stcf" &&
      running &&
      ready.some((job) => job.remaining < running!.remaining)
    ) {
      ready.push(running);
      running = null;
    }

    if (!running && ready.length > 0) {
      if (algorithm === "sjf" || algorithm === "stcf") {
        const score = (job: (typeof jobs)[number]) =>
          algorithm === "sjf" ? job.serviceTime : job.remaining;
        let best = 0;
        for (let index = 1; index < ready.length; index += 1) {
          if (
            score(ready[index]) < score(ready[best]) ||
            (score(ready[index]) === score(ready[best]) &&
              stableBefore(ready[index], ready[best]) < 0)
          ) {
            best = index;
          }
        }
        running = ready.splice(best, 1)[0];
      } else {
        running = ready.shift() ?? null;
      }
    }

    result.push(running?.id ?? "-");
    if (running) {
      running.remaining -= 1;
      sliceUsed += 1;
    }
  }

  return result.join("");
}

function referenceMlfqTimeline(
  definitions: ProcessDefinition[],
  quanta: number[],
  boostInterval: number,
) {
  const jobs = definitions
    .map((process, index) => ({
      ...process,
      index,
      remaining: process.serviceTime,
      level: 0,
      used: 0,
    }))
    .sort((left, right) => left.arrivalTime - right.arrivalTime || left.index - right.index);
  const queues: Array<typeof jobs> = Array.from({ length: quanta.length }, () => []);
  const result: string[] = [];
  let running: (typeof jobs)[number] | null = null;

  for (let time = 0; jobs.some((job) => job.remaining > 0); time += 1) {
    if (running?.remaining === 0) running = null;

    let expired: (typeof jobs)[number] | null = null;
    let yielded: (typeof jobs)[number] | null = null;
    if (time > 0 && time % boostInterval === 0) {
      const active = queues.flat();
      const continuingTopTurn =
        running !== null && running.level === 0 && running.used < quanta[0];
      queues.forEach((queue) => queue.splice(0));
      for (const job of active) {
        job.level = 0;
        job.used = 0;
        queues[0].push(job);
      }
      if (running && !continuingTopTurn) {
        running.level = 0;
        running.used = 0;
        queues[0].push(running);
        running = null;
      }
    } else if (running) {
      const allotment = quanta[running.level];
      if (running.used === allotment) {
        expired = running;
        running = null;
      } else if (running.relinquishEarly && running.used === allotment - 1) {
        yielded = running;
        running = null;
      }
    }

    for (const job of jobs) {
      if (job.arrivalTime === time && job.remaining > 0) {
        job.level = 0;
        job.used = 0;
        queues[0].push(job);
      }
    }
    if (yielded) queues[yielded.level].push(yielded);
    if (expired) {
      expired.used = 0;
      expired.level = Math.min(expired.level + 1, quanta.length - 1);
      queues[expired.level].push(expired);
    }

    if (running && queues.slice(0, running.level).some((queue) => queue.length > 0)) {
      queues[running.level].unshift(running);
      running = null;
    }
    if (!running) {
      const nextQueue = queues.find((queue) => queue.length > 0);
      running = nextQueue?.shift() ?? null;
    }

    result.push(running?.id ?? "-");
    if (running) {
      running.remaining -= 1;
      running.used += 1;
    }
  }

  return result.join("");
}

function assertSimulationInvariants(
  definitions: ProcessDefinition[],
  simulationConfig: SimulationConfig,
) {
  const result = simulate(definitions, simulationConfig);
  const final = result.snapshots.at(-1)!;
  const executionCounts = new Map(definitions.map((process) => [process.id, 0]));
  const firstExecution = new Map<string, number>();
  const lastExecution = new Map<string, number>();

  expect(result.snapshots.map((snapshot) => snapshot.time)).toEqual(
    Array.from({ length: result.snapshots.length }, (_, index) => index),
  );
  expect(result.timeline.map((slice) => slice.time)).toEqual(
    Array.from({ length: result.timeline.length }, (_, index) => index),
  );

  for (const slice of result.timeline) {
    if (!slice.processId) continue;
    const process = definitions.find((candidate) => candidate.id === slice.processId)!;
    expect(slice.time).toBeGreaterThanOrEqual(process.arrivalTime);
    executionCounts.set(slice.processId, executionCounts.get(slice.processId)! + 1);
    if (!firstExecution.has(slice.processId)) firstExecution.set(slice.processId, slice.time);
    lastExecution.set(slice.processId, slice.time);
  }

  for (const process of definitions) {
    expect(executionCounts.get(process.id)).toBe(process.serviceTime);
    const view = final.processes.find((candidate) => candidate.id === process.id)!;
    expect(view.state).toBe("finished");
    expect(view.remainingTime).toBe(0);
    expect(view.responseTime).toBe(firstExecution.get(process.id)! - process.arrivalTime);
    expect(view.turnaroundTime).toBe(lastExecution.get(process.id)! + 1 - process.arrivalTime);
    expect(view.waitingTime).toBe(view.turnaroundTime! - process.serviceTime);
    expect(view.responseTime).toBeGreaterThanOrEqual(0);
    expect(view.waitingTime).toBeGreaterThanOrEqual(view.responseTime!);
  }

  for (const snapshot of result.snapshots) {
    const queued = snapshot.readyQueues.flat();
    expect(new Set(queued).size).toBe(queued.length);
    if (snapshot.running) expect(queued).not.toContain(snapshot.running);
    if (snapshot.time < result.timeline.length) {
      expect(result.timeline[snapshot.time].processId).toBe(snapshot.running);
    }

    expect(snapshot.processes).toHaveLength(definitions.length);
    for (const process of snapshot.processes) {
      if (process.state === "new") {
        expect(process.arrivalTime).toBeGreaterThan(snapshot.time);
        expect(process.remainingTime).toBe(process.serviceTime);
        expect(process.responseTime).toBeNull();
        expect(process.waitingTime).toBe(0);
      } else {
        expect(process.arrivalTime).toBeLessThanOrEqual(snapshot.time);
      }
      if (process.state === "ready") expect(queued).toContain(process.id);
      if (process.state === "running") expect(process.id).toBe(snapshot.running);
      if (process.state === "finished") {
        expect(process.remainingTime).toBe(0);
        expect(process.turnaroundTime).not.toBeNull();
        expect(queued).not.toContain(process.id);
        expect(process.id).not.toBe(snapshot.running);
      }
    }

    for (const id of queued) {
      const view = snapshot.processes.find((process) => process.id === id)!;
      expect(view.state).toBe("ready");
      expect(view.arrivalTime).toBeLessThanOrEqual(snapshot.time);
      expect(view.remainingTime).toBeGreaterThan(0);
    }

    if (snapshot.running) {
      const running = snapshot.processes.find((process) => process.id === snapshot.running)!;
      expect(running.state).toBe("running");
      expect(running.remainingTime).toBeGreaterThan(0);
      if (simulationConfig.algorithm === "mlfq") {
        expect(snapshot.readyQueues.slice(0, running.queueLevel).flat()).toHaveLength(0);
      }
    }

    if (simulationConfig.algorithm === "mlfq") {
      snapshot.readyQueues.forEach((queue, level) => {
        for (const id of queue) {
          expect(snapshot.processes.find((process) => process.id === id)?.queueLevel).toBe(level);
        }
      });
      for (const process of snapshot.processes.filter((item) => item.state !== "finished")) {
        expect(process.allotmentUsed).toBeGreaterThanOrEqual(0);
        expect(process.allotmentUsed).toBeLessThan(simulationConfig.mlfqQuanta[process.queueLevel]);
      }
      if (
        snapshot.time > 0 &&
        simulationConfig.mlfqBoostInterval &&
        snapshot.time % simulationConfig.mlfqBoostInterval === 0
      ) {
        for (const process of snapshot.processes.filter((item) => item.state !== "finished")) {
          expect(process.queueLevel).toBe(0);
          if (process.state === "ready") expect(process.allotmentUsed).toBe(0);
        }
      }
    }
  }
}

function random(seed: number) {
  let state = seed >>> 0;
  return (maximum: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
}

describe("comprehensive scheduling verification", () => {
  it("reproduces the lecture FCFS, SJF, and RR examples exactly", () => {
    const lecture = [
      definition("A", 0, 3),
      definition("B", 2, 6),
      definition("C", 4, 4),
      definition("D", 6, 5),
      definition("E", 8, 2),
    ];

    const fcfs = simulate(lecture, config("fcfs"));
    expect(fcfs.timeline.map((slice) => slice.processId).join("")).toBe("AAABBBBBBCCCCDDDDDEE");
    expect(fcfs.snapshots.at(-1)!.processes.map((process) => process.waitingTime)).toEqual([0, 1, 5, 7, 10]);

    const sjf = simulate(lecture, config("sjf"));
    expect(sjf.timeline.map((slice) => slice.processId).join("")).toBe("AAABBBBBBEECCCCDDDDD");
    expect(sjf.snapshots.at(-1)!.processes.map((process) => process.waitingTime)).toEqual([0, 1, 7, 9, 1]);

    const rr = simulate(lecture, config("rr", 2));
    expect(rr.timeline.map((slice) => slice.processId).join("")).toBe("AABBACCBBDDCCEEBBDDD");
    expect(rr.snapshots.at(-1)!.processes.map((process) => process.turnaroundTime)).toEqual([5, 15, 9, 14, 7]);
  });

  it("reproduces the OSTEP FCFS, SJF, STCF, and RR examples and metrics", () => {
    const longFirst = [definition("A", 0, 100), definition("B", 0, 10), definition("C", 0, 10)];
    expect(simulate(longFirst, config("fcfs")).snapshots.at(-1)!.processes.map((process) => process.turnaroundTime)).toEqual([100, 110, 120]);
    expect(simulate(longFirst, config("sjf")).snapshots.at(-1)!.processes.map((process) => process.turnaroundTime)).toEqual([120, 10, 20]);

    const lateShort = [definition("A", 0, 100), definition("B", 10, 10), definition("C", 10, 10)];
    expect(simulate(lateShort, config("stcf")).snapshots.at(-1)!.processes.map((process) => process.turnaroundTime)).toEqual([120, 10, 20]);

    const equal = [definition("A", 0, 5), definition("B", 0, 5), definition("C", 0, 5)];
    const rr = simulate(equal, config("rr", 1));
    expect(rr.timeline.map((slice) => slice.processId).join("")).toBe("ABCABCABCABCABC");
    expect(rr.snapshots.at(-1)!.processes.map((process) => process.responseTime)).toEqual([0, 1, 2]);
    expect(rr.snapshots.at(-1)!.processes.map((process) => process.turnaroundTime)).toEqual([13, 14, 15]);
  });

  it("preserves stable ties and the lecture RR boundary ordering", () => {
    expect(timeline("fcfs", [definition("B", 0, 1), definition("A", 0, 1)])).toBe("BA");
    expect(timeline("sjf", [definition("B", 0, 2), definition("A", 0, 2)])).toBe("BBAA");
    expect(timeline("stcf", [definition("A", 0, 4), definition("B", 2, 2)])).toBe("AAAABB");
    expect(timeline("rr", [definition("A", 0, 3), definition("B", 2, 2)], 2)).toBe("AABBA");
  });

  it("handles idle gaps, exact-quantum completion, and a single runnable process", () => {
    expect(timeline("fcfs", [definition("A", 3, 2)])).toBe("---AA");
    expect(timeline("rr", [definition("A", 0, 4)], 2)).toBe("AAAA");
    const exact = simulate([definition("A", 0, 2), definition("B", 2, 1)], config("rr", 2));
    expect(exact.timeline.map((slice) => slice.processId).join("")).toBe("AAB");
    expect(exact.snapshots[2].events).not.toContain("A's quantum expired; it moved to the back of the ready queue.");
  });

  it("matches independent reference schedulers for every small three-process workload", () => {
    let comparisons = 0;
    for (const algorithm of ["fcfs", "sjf", "stcf", "rr"] as const) {
      for (let arrivalA = 0; arrivalA <= 2; arrivalA += 1) {
        for (let arrivalB = 0; arrivalB <= 2; arrivalB += 1) {
          for (let arrivalC = 0; arrivalC <= 2; arrivalC += 1) {
            for (let serviceA = 1; serviceA <= 3; serviceA += 1) {
              for (let serviceB = 1; serviceB <= 3; serviceB += 1) {
                for (let serviceC = 1; serviceC <= 3; serviceC += 1) {
                  const processes = [
                    definition("A", arrivalA, serviceA),
                    definition("B", arrivalB, serviceB),
                    definition("C", arrivalC, serviceC),
                  ];
                  expect(timeline(algorithm, processes, 2)).toBe(referenceTimeline(algorithm, processes, 2));
                  comparisons += 1;
                }
              }
            }
          }
        }
      }
    }
    expect(comparisons).toBe(2916);
  });

  it("matches an independent MLFQ model across varied boosts, allotments, arrivals, and yields", () => {
    const next = random(0x369f1f0);
    for (let sample = 0; sample < 500; sample += 1) {
      const count = 1 + next(5);
      const processes = Array.from({ length: count }, (_, index) => ({
        ...definition(String.fromCharCode(65 + index), next(8), 1 + next(10)),
        relinquishEarly: next(3) === 0,
      }));
      const quanta = [2 + next(3), 5 + next(3), 8 + next(4)];
      const boostInterval = 3 + next(15);
      const actual = simulate(processes, {
        algorithm: "mlfq",
        quantum: 2,
        mlfqQuanta: quanta,
        mlfqBoostInterval: boostInterval,
      }).timeline.map((slice) => slice.processId ?? "-").join("");
      expect(actual).toBe(referenceMlfqTimeline(processes, quanta, boostInterval));
    }
  });

  it("exhaustively matches MLFQ for every small two-process workload and parameter combination", () => {
    let comparisons = 0;
    for (let arrivalA = 0; arrivalA <= 3; arrivalA += 1) {
      for (let arrivalB = 0; arrivalB <= 3; arrivalB += 1) {
        for (let serviceA = 1; serviceA <= 4; serviceA += 1) {
          for (let serviceB = 1; serviceB <= 4; serviceB += 1) {
            const processes = [
              definition("A", arrivalA, serviceA),
              definition("B", arrivalB, serviceB),
            ];
            for (let q0 = 1; q0 <= 3; q0 += 1) {
              for (let q1 = 1; q1 <= 4; q1 += 1) {
                for (let boost = 2; boost <= 6; boost += 1) {
                  const quanta = [q0, q1];
                  const actual = simulate(processes, {
                    algorithm: "mlfq",
                    quantum: 1,
                    mlfqQuanta: quanta,
                    mlfqBoostInterval: boost,
                  }).timeline.map((slice) => slice.processId ?? "-").join("");
                  expect(actual).toBe(referenceMlfqTimeline(processes, quanta, boost));
                  comparisons += 1;
                }
              }
            }
          }
        }
      }
    }
    expect(comparisons).toBe(15_360);
  }, 60_000);

  it("satisfies execution, queue, state, and metric invariants over randomized workloads", () => {
    const next = random(0x3695c5c);
    let scenarios = 0;
    for (const algorithm of ["fcfs", "sjf", "stcf", "rr", "mlfq"] as const) {
      for (let sample = 0; sample < 250; sample += 1) {
        const count = 1 + next(6);
        const processes = Array.from({ length: count }, (_, index) => ({
          ...definition(String.fromCharCode(65 + index), next(9), 1 + next(10)),
          relinquishEarly: algorithm === "mlfq" && next(3) === 0,
        }));
        const simulationConfig: SimulationConfig = {
          algorithm,
          quantum: 1 + next(5),
          mlfqQuanta: [2 + next(2), 4 + next(3), 7 + next(4)],
          mlfqBoostInterval: 3 + next(14),
        };
        assertSimulationInvariants(processes, simulationConfig);
        scenarios += 1;
      }
    }
    expect(scenarios).toBe(1250);
  }, 60_000);

  it("makes RR converge to FCFS when its quantum covers every service time", () => {
    const next = random(0x369fcf5);
    for (let sample = 0; sample < 200; sample += 1) {
      const processes = Array.from({ length: 1 + next(6) }, (_, index) =>
        definition(String.fromCharCode(65 + index), next(8), 1 + next(8)),
      );
      expect(timeline("rr", processes, 100)).toBe(timeline("fcfs", processes));
    }
  });

  it("keeps MLFQ accounting cumulative across repeated yields and higher-priority preemption", () => {
    const result = simulate(
      [
        { ...definition("A", 0, 12), relinquishEarly: true },
        definition("B", 0, 3),
        definition("C", 8, 1),
      ],
      { algorithm: "mlfq", quantum: 2, mlfqQuanta: [4, 6, 8], mlfqBoostInterval: 100 },
    );
    const demotions = result.snapshots.flatMap((snapshot) => snapshot.events).filter((event) => event.includes("A used its full allotment"));
    expect(demotions).toHaveLength(2);
    expect(result.snapshots.flatMap((snapshot) => snapshot.events)).toContain(
      "A was preempted by a process in a higher-priority queue.",
    );
  });

  it("boosts only active work without renewing a running Q0 turn or duplicating a process", () => {
    const simulationConfig: SimulationConfig = {
      algorithm: "mlfq",
      quantum: 2,
      mlfqQuanta: [2, 4, 8],
      mlfqBoostInterval: 4,
    };
    const processes = [definition("A", 0, 1), definition("B", 0, 12), definition("C", 2, 7)];
    const result = simulate(processes, simulationConfig);
    assertSimulationInvariants(processes, simulationConfig);
    expect(result.snapshots[4].events.some((event) =>
      event.startsWith("Priority boost moved 2 active processes to Q0"),
    )).toBe(true);
    expect(result.snapshots[4].processes.find((process) => process.id === "A")?.state).toBe("finished");
  });
});

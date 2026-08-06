import { describe, expect, it } from "vitest";
import {
  Algorithm,
  MAX_PROCESSES,
  MAX_SIMULATION_TICKS,
  ProcessDefinition,
  SimulationConfig,
  simulate,
} from "./simulator";

type ReferenceJob = ProcessDefinition & {
  inputIndex: number;
  remaining: number;
  level: number;
  used: number;
};

type ReferenceSnapshot = {
  running: string | null;
  readyQueues: string[][];
  processes: Array<{ id: string; remaining: number; level: number; used: number }>;
};

type ReferenceResult = {
  timeline: Array<string | null>;
  snapshots: ReferenceSnapshot[];
};

const makeProcess = (id: string, arrivalTime: number, serviceTime: number): ProcessDefinition => ({
  id,
  arrivalTime,
  serviceTime,
  color: "#4f6bed",
});

const stableOrder = (left: ReferenceJob, right: ReferenceJob) =>
  left.arrivalTime - right.arrivalTime || left.inputIndex - right.inputIndex;

function removeBest(
  queue: ReferenceJob[],
  score: (job: ReferenceJob) => number,
) {
  let bestIndex = 0;
  for (let index = 1; index < queue.length; index += 1) {
    if (
      score(queue[index]) < score(queue[bestIndex]) ||
      (score(queue[index]) === score(queue[bestIndex]) &&
        stableOrder(queue[index], queue[bestIndex]) < 0)
    ) {
      bestIndex = index;
    }
  }
  return queue.splice(bestIndex, 1)[0] ?? null;
}

/**
 * A deliberately separate, minimal scheduler model. It does not import or call
 * any production scheduling helpers, and records the boundary state that feeds
 * the visualization as well as the CPU trace.
 */
function referenceSimulation(
  definitions: ProcessDefinition[],
  config: SimulationConfig,
): ReferenceResult {
  const jobs: ReferenceJob[] = definitions
    .map((process, inputIndex) => ({
      ...process,
      inputIndex,
      remaining: process.serviceTime,
      level: 0,
      used: 0,
    }))
    .sort(stableOrder);
  const queueCount = config.algorithm === "mlfq" ? config.mlfqQuanta.length : 1;
  const queues: ReferenceJob[][] = Array.from({ length: queueCount }, () => []);
  const snapshots: ReferenceSnapshot[] = [];
  const timeline: Array<string | null> = [];
  let running: ReferenceJob | null = null;

  for (let time = 0; jobs.some((job) => job.remaining > 0); time += 1) {
    if (running?.remaining === 0) running = null;

    let expired: ReferenceJob | null = null;
    let yielded: ReferenceJob | null = null;
    const boostDue =
      config.algorithm === "mlfq" &&
      config.mlfqBoostInterval !== undefined &&
      time > 0 &&
      time % config.mlfqBoostInterval === 0;

    if (boostDue) {
      const active = queues.flat();
      const continuingTopTurn =
        running !== null &&
        running.level === 0 &&
        running.used < config.mlfqQuanta[0];
      for (const queue of queues) queue.length = 0;
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
    } else if (config.algorithm === "rr" && running && running.used >= config.quantum) {
      expired = running;
      running = null;
    } else if (config.algorithm === "mlfq" && running) {
      const allotment = config.mlfqQuanta[running.level];
      if (running.used >= allotment) {
        expired = running;
        running = null;
      } else if (
        running.relinquishEarly &&
        allotment >= 2 &&
        running.used === allotment - 1
      ) {
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
      if (config.algorithm === "mlfq") {
        expired.level = Math.min(expired.level + 1, queueCount - 1);
      }
      queues[expired.level].push(expired);
    }

    if (config.algorithm === "stcf" && running && queues[0].length > 0) {
      const shortestReady = Math.min(...queues[0].map((job) => job.remaining));
      if (shortestReady < running.remaining) {
        running.used = 0;
        queues[0].push(running);
        running = null;
      }
    }

    if (
      config.algorithm === "mlfq" &&
      running &&
      queues.slice(0, running.level).some((queue) => queue.length > 0)
    ) {
      queues[running.level].unshift(running);
      running = null;
    }

    if (!running) {
      if (config.algorithm === "sjf") {
        running = queues[0].length > 0
          ? removeBest(queues[0], (job) => job.serviceTime)
          : null;
      } else if (config.algorithm === "stcf") {
        running = queues[0].length > 0
          ? removeBest(queues[0], (job) => job.remaining)
          : null;
      } else if (config.algorithm === "mlfq") {
        running = queues.find((queue) => queue.length > 0)?.shift() ?? null;
      } else {
        running = queues[0].shift() ?? null;
      }
    }

    snapshots.push({
      running: running?.id ?? null,
      readyQueues: queues.map((queue) => queue.map((job) => job.id)),
      processes: jobs.map((job) => ({
        id: job.id,
        remaining: job.remaining,
        level: job.level,
        used: job.used,
      })),
    });
    timeline.push(running?.id ?? null);
    if (running) {
      running.remaining -= 1;
      running.used += 1;
    }
  }

  snapshots.push({
    running: null,
    readyQueues: queues.map((queue) => queue.map((job) => job.id)),
    processes: jobs.map((job) => ({
      id: job.id,
      remaining: job.remaining,
      level: job.level,
      used: job.used,
    })),
  });
  return { timeline, snapshots };
}

function assertScenario(
  definitions: ProcessDefinition[],
  config: SimulationConfig,
  label: string,
) {
  const actual = simulate(definitions, config);
  const expected = referenceSimulation(definitions, config);
  const diagnostic = `\nScenario: ${label}\nConfig: ${JSON.stringify(config)}\nProcesses: ${JSON.stringify(definitions.map(({ id, arrivalTime, serviceTime }) => ({ id, arrivalTime, serviceTime })))}`;
  const check = (condition: unknown, message: string): asserts condition => {
    if (!condition) throw new Error(`${message}${diagnostic}`);
  };
  const same = (left: unknown, right: unknown, message: string) =>
    check(JSON.stringify(left) === JSON.stringify(right), `${message}\nActual: ${JSON.stringify(left)}\nExpected: ${JSON.stringify(right)}`);

  same(
    actual.timeline.map((slice) => slice.processId),
    expected.timeline,
    "CPU execution trace differs from the independent reference model.",
  );
  check(actual.timeline.length <= MAX_SIMULATION_TICKS, "Simulation exceeded the supported tick limit.");
  check(actual.snapshots.length === actual.timeline.length + 1, "There must be one boundary snapshot per tick plus the final boundary.");
  check(actual.snapshots.length === expected.snapshots.length, "Reference and production snapshot counts differ.");

  const executed = new Map(definitions.map((process) => [process.id, 0]));
  const firstRun = new Map<string, number>();
  const completion = new Map<string, number>();
  for (const slice of actual.timeline) {
    if (!slice.processId) continue;
    if (!firstRun.has(slice.processId)) firstRun.set(slice.processId, slice.time);
    completion.set(slice.processId, slice.time + 1);
  }

  for (let time = 0; time < actual.snapshots.length; time += 1) {
    const snapshot = actual.snapshots[time];
    const reference = expected.snapshots[time];
    check(snapshot.time === time, `Snapshot index ${time} reports time ${snapshot.time}.`);
    same(snapshot.running, reference.running, `Wrong running process at boundary ${time}.`);
    same(snapshot.readyQueues, reference.readyQueues, `Wrong ready-queue visualization state at boundary ${time}.`);
    check(snapshot.readyQueues.length === (config.algorithm === "mlfq" ? config.mlfqQuanta.length : 1), `Wrong queue count at boundary ${time}.`);

    const queued = snapshot.readyQueues.flat();
    check(new Set(queued).size === queued.length, `A process is duplicated in ready queues at boundary ${time}.`);
    check(!snapshot.running || !queued.includes(snapshot.running), `Running process also appears ready at boundary ${time}.`);
    check(snapshot.processes.length === definitions.length, `A process disappeared from accounting at boundary ${time}.`);
    check(new Set(snapshot.processes.map((process) => process.id)).size === definitions.length, `Process accounting contains a duplicate at boundary ${time}.`);

    for (const definition of definitions) {
      const view = snapshot.processes.find((process) => process.id === definition.id);
      const referenceView = reference.processes.find((process) => process.id === definition.id);
      check(view && referenceView, `Process ${definition.id} is missing at boundary ${time}.`);
      check(view.remainingTime === referenceView.remaining, `Wrong remaining time for ${definition.id} at boundary ${time}.`);

      const completedAt = completion.get(definition.id);
      const expectedState = time < definition.arrivalTime
        ? "new"
        : completedAt !== undefined && completedAt <= time
          ? "finished"
          : snapshot.running === definition.id
            ? "running"
            : "ready";
      check(view.state === expectedState, `Wrong state for ${definition.id} at boundary ${time}: ${view.state}, expected ${expectedState}.`);
      check(view.remainingTime === definition.serviceTime - executed.get(definition.id)!, `Executed-tick accounting is wrong for ${definition.id} at boundary ${time}.`);
      check(view.responseTime === (firstRun.get(definition.id) !== undefined && firstRun.get(definition.id)! <= time
        ? firstRun.get(definition.id)! - definition.arrivalTime
        : null), `Wrong response time for ${definition.id} at boundary ${time}.`);
      check(view.turnaroundTime === (completedAt !== undefined && completedAt <= time
        ? completedAt - definition.arrivalTime
        : null), `Wrong turnaround time for ${definition.id} at boundary ${time}.`);

      const elapsedInSystem = time < definition.arrivalTime
        ? 0
        : completedAt !== undefined && completedAt <= time
          ? completedAt - definition.arrivalTime
          : time - definition.arrivalTime;
      check(view.waitingTime === elapsedInSystem - executed.get(definition.id)!, `Wrong waiting time for ${definition.id} at boundary ${time}.`);

      if (config.algorithm === "mlfq") {
        check(view.queueLevel === referenceView.level, `Wrong MLFQ level for ${definition.id} at boundary ${time}.`);
        check(view.allotmentUsed === referenceView.used, `Wrong MLFQ allotment use for ${definition.id} at boundary ${time}.`);
        check(view.queueLevel >= 0 && view.queueLevel < config.mlfqQuanta.length, `Invalid queue level for ${definition.id} at boundary ${time}.`);
        if (view.state !== "finished") {
          check(view.allotmentUsed >= 0 && view.allotmentUsed < config.mlfqQuanta[view.queueLevel], `Invalid active allotment for ${definition.id} at boundary ${time}.`);
        }
      }
    }

    if (snapshot.running) {
      const running = snapshot.processes.find((process) => process.id === snapshot.running)!;
      check(snapshot.runningRemaining === running.remainingTime, `Running remainder summary is stale at boundary ${time}.`);
      check(snapshot.runningQueueLevel === running.queueLevel, `Running queue summary is stale at boundary ${time}.`);
      if (config.algorithm === "mlfq") {
        check(snapshot.readyQueues.slice(0, running.queueLevel).every((queue) => queue.length === 0), `MLFQ ran below a non-empty higher-priority queue at boundary ${time}.`);
      }
    } else {
      check(snapshot.runningRemaining === null, `Idle CPU exposes a running remainder at boundary ${time}.`);
      check(snapshot.runningQueueLevel === null, `Idle CPU exposes a running queue at boundary ${time}.`);
    }

    for (const arrival of definitions.filter((process) => process.arrivalTime === time)) {
      check(snapshot.events.some((event) => event.startsWith(`${arrival.id} arrived`)), `Arrival event for ${arrival.id} is missing at boundary ${time}.`);
    }
    for (const definition of definitions.filter((process) => completion.get(process.id) === time)) {
      check(snapshot.events.includes(`${definition.id} finished and left the system.`), `Completion event for ${definition.id} is missing at boundary ${time}.`);
    }

    if (config.algorithm === "mlfq" && config.mlfqBoostInterval && time > 0 && time % config.mlfqBoostInterval === 0) {
      for (const view of snapshot.processes.filter((process) => process.state === "ready" || process.state === "running")) {
        check(view.queueLevel === 0, `Boost failed to move active process ${view.id} to Q0 at boundary ${time}.`);
        if (view.state === "ready") {
          check(view.allotmentUsed === 0, `Boost failed to reset queued process ${view.id} at boundary ${time}.`);
        }
      }
    }

    if (time < actual.timeline.length) {
      check(actual.timeline[time].time === time, `Timeline cell ${time} has a wrong tick label.`);
      check(actual.timeline[time].processId === snapshot.running, `Timeline and boundary disagree at tick ${time}.`);
      if (snapshot.running) executed.set(snapshot.running, executed.get(snapshot.running)! + 1);
    }
  }

  for (const definition of definitions) {
    check(executed.get(definition.id) === definition.serviceTime, `Process ${definition.id} did not receive exactly its requested service.`);
  }
  check(actual.snapshots.at(-1)!.processes.every((process) => process.state === "finished"), "Final boundary contains unfinished work.");
}

function random(seed: number) {
  let state = seed >>> 0;
  return (maximum: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % maximum;
  };
}

function shuffle<T>(items: T[], next: (maximum: number) => number) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = next(index + 1);
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function randomScenario(
  algorithm: Algorithm,
  sample: number,
  next: (maximum: number) => number,
) {
  const counts = [1, 2, 3, 5, 8, 12, 20, 30, MAX_PROCESSES];
  const count = counts[sample % counts.length];
  const allSimultaneous = sample % 11 === 0;
  const longIdleGap = sample % 17 === 0;
  const processes = Array.from({ length: count }, (_, index) => makeProcess(
    `P${String(index).padStart(2, "0")}`,
    allSimultaneous ? (longIdleGap ? 40 : 0) : next(61),
    1 + next(25),
  ));
  if (sample % 3 === 0) shuffle(processes, next);

  const queueCount = 1 + next(5);
  const mlfqQuanta: number[] = [];
  let previous = 1 + next(4);
  for (let level = 0; level < queueCount; level += 1) {
    previous += level === 0 ? 0 : next(8);
    mlfqQuanta.push(previous);
  }
  const config: SimulationConfig = {
    algorithm,
    quantum: 1 + next(20),
    mlfqQuanta,
    mlfqBoostInterval: algorithm === "mlfq" && sample % 13 === 0
      ? undefined
      : 1 + next(100),
  };
  return { processes, config };
}

describe("deep scheduler stress verification", () => {
  it("matches an independent boundary-state model across 6,000 deterministic workloads", () => {
    const next = random(0xc5c3695);
    let scenarios = 0;
    for (const algorithm of ["fcfs", "sjf", "stcf", "rr", "mlfq"] as const) {
      for (let sample = 0; sample < 1_200; sample += 1) {
        const { processes, config } = randomScenario(algorithm, sample, next);
        assertScenario(processes, config, `${algorithm} randomized sample ${sample}`);
        scenarios += 1;
      }
    }
    expect(scenarios).toBe(6_000);
  }, 300_000);

  it("is correct at every supported process-count and 2,000-tick boundary", () => {
    const workloads = [
      { name: "single 2000-tick process", processes: [makeProcess("A", 0, 2_000)] },
      { name: "last possible arrival", processes: [makeProcess("A", 0, 1), makeProcess("B", 1_999, 1)] },
      { name: "50 simultaneous one-tick ties", processes: Array.from({ length: 50 }, (_, index) => makeProcess(`P${index}`, 0, 1)) },
      { name: "50 processes totaling 2000 ticks", processes: Array.from({ length: 50 }, (_, index) => makeProcess(`P${index}`, 0, 40)) },
    ];
    for (const algorithm of ["fcfs", "sjf", "stcf", "rr", "mlfq"] as const) {
      for (const workload of workloads) {
        assertScenario(workload.processes, {
          algorithm,
          quantum: 1,
          mlfqQuanta: [1, 2, 4, 8, 16],
          mlfqBoostInterval: 37,
        }, `${algorithm}: ${workload.name}`);
      }
    }
  }, 300_000);

  it("handles scheduling collisions without omitting a boundary state", () => {
    const collisions: Array<{ name: string; processes: ProcessDefinition[]; config: SimulationConfig }> = [
      {
        name: "RR arrival, completion, and would-be expiry coincide",
        processes: [makeProcess("A", 0, 2), makeProcess("B", 2, 3), makeProcess("C", 2, 1)],
        config: { algorithm: "rr", quantum: 2, mlfqQuanta: [2], mlfqBoostInterval: 10 },
      },
      {
        name: "STCF equal remainder does not preempt",
        processes: [makeProcess("A", 0, 7), makeProcess("B", 3, 4), makeProcess("C", 3, 3)],
        config: { algorithm: "stcf", quantum: 2, mlfqQuanta: [2], mlfqBoostInterval: 10 },
      },
      {
        name: "MLFQ arrivals, expiry, and boost share boundaries",
        processes: [makeProcess("A", 0, 13), makeProcess("B", 2, 7), makeProcess("C", 4, 2)],
        config: { algorithm: "mlfq", quantum: 2, mlfqQuanta: [2, 3, 5], mlfqBoostInterval: 2 },
      },
      {
        name: "MLFQ one queue with one-tick allotment",
        processes: [makeProcess("A", 0, 5), makeProcess("B", 0, 5), makeProcess("C", 1, 3)],
        config: { algorithm: "mlfq", quantum: 1, mlfqQuanta: [1], mlfqBoostInterval: 101 },
      },
      {
        name: "MLFQ five queues with a boost beyond completion",
        processes: [makeProcess("A", 0, 31), makeProcess("B", 5, 17), makeProcess("C", 9, 6)],
        config: { algorithm: "mlfq", quantum: 2, mlfqQuanta: [1, 2, 4, 8, 16], mlfqBoostInterval: 500 },
      },
    ];
    for (const collision of collisions) {
      assertScenario(collision.processes, collision.config, collision.name);
    }
  });

  it("makes one-level MLFQ equivalent to Round Robin when boosting is disabled", () => {
    const next = random(0x1f1f369);
    for (let sample = 0; sample < 300; sample += 1) {
      const count = 1 + next(15);
      const processes = shuffle(Array.from({ length: count }, (_, index) =>
        makeProcess(`P${index}`, next(20), 1 + next(20))), next);
      const quantum = 1 + next(12);
      const rr = simulate(processes, {
        algorithm: "rr",
        quantum,
        mlfqQuanta: [quantum],
      }).timeline.map((slice) => slice.processId);
      const mlfq = simulate(processes, {
        algorithm: "mlfq",
        quantum,
        mlfqQuanta: [quantum],
      }).timeline.map((slice) => slice.processId);
      expect(mlfq, `one-level equivalence sample ${sample}`).toEqual(rr);
    }
  });
});

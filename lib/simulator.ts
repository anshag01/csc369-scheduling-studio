export type Algorithm = "fcfs" | "sjf" | "stcf" | "rr" | "mlfq";

export type ProcessDefinition = {
  id: string;
  arrivalTime: number;
  serviceTime: number;
  color: string;
};

export type SimulationConfig = {
  algorithm: Algorithm;
  quantum: number;
  mlfqQuanta: number[];
};

export type ProcessView = ProcessDefinition & {
  remainingTime: number;
  state: "new" | "ready" | "running" | "finished";
  queueLevel: number;
  responseTime: number | null;
  waitingTime: number;
  turnaroundTime: number | null;
};

export type Snapshot = {
  time: number;
  running: string | null;
  readyQueues: string[][];
  events: string[];
  processes: ProcessView[];
  runningRemaining: number | null;
  runningQueueLevel: number | null;
};

export type TimelineSlice = {
  time: number;
  processId: string | null;
};

export type SimulationResult = {
  snapshots: Snapshot[];
  timeline: TimelineSlice[];
};

type RuntimeProcess = ProcessDefinition & {
  index: number;
  remainingTime: number;
  queueLevel: number;
  quantumUsed: number;
  firstRunTime: number | null;
  completionTime: number | null;
  waitingTime: number;
};

const byStableOrder = (a: RuntimeProcess, b: RuntimeProcess) =>
  a.arrivalTime - b.arrivalTime || a.index - b.index;

function takeBest(
  queue: RuntimeProcess[],
  score: (process: RuntimeProcess) => number,
) {
  if (queue.length === 0) return null;
  let bestIndex = 0;
  for (let index = 1; index < queue.length; index += 1) {
    const candidate = queue[index];
    const best = queue[bestIndex];
    if (
      score(candidate) < score(best) ||
      (score(candidate) === score(best) && byStableOrder(candidate, best) < 0)
    ) {
      bestIndex = index;
    }
  }
  return queue.splice(bestIndex, 1)[0];
}

function chooseNext(
  algorithm: Algorithm,
  queues: RuntimeProcess[][],
): RuntimeProcess | null {
  if (algorithm === "mlfq") {
    const queue = queues.find((candidate) => candidate.length > 0);
    return queue?.shift() ?? null;
  }

  const queue = queues[0];
  if (algorithm === "sjf") return takeBest(queue, (process) => process.serviceTime);
  if (algorithm === "stcf") return takeBest(queue, (process) => process.remainingTime);
  return queue.shift() ?? null;
}

function describeAlgorithm(algorithm: Algorithm) {
  if (algorithm === "fcfs") return "the process at the head of the FIFO queue";
  if (algorithm === "sjf") return "the ready process with the shortest service time";
  if (algorithm === "stcf") return "the ready process with the shortest remaining time";
  if (algorithm === "rr") return "the process at the head of the Round Robin queue";
  return "the first process in the highest-priority non-empty queue";
}

function makeViews(
  processes: RuntimeProcess[],
  queues: RuntimeProcess[][],
  running: RuntimeProcess | null,
  time: number,
): ProcessView[] {
  const readyIds = new Set(queues.flat().map((process) => process.id));
  return processes.map((process) => {
    let state: ProcessView["state"] = "new";
    if (process.completionTime !== null) state = "finished";
    else if (running?.id === process.id) state = "running";
    else if (readyIds.has(process.id)) state = "ready";

    return {
      id: process.id,
      arrivalTime: process.arrivalTime,
      serviceTime: process.serviceTime,
      color: process.color,
      remainingTime: process.remainingTime,
      state,
      queueLevel: process.queueLevel,
      responseTime:
        process.firstRunTime === null
          ? null
          : process.firstRunTime - process.arrivalTime,
      waitingTime: process.waitingTime,
      turnaroundTime:
        process.completionTime === null
          ? null
          : process.completionTime - process.arrivalTime,
    };
  });
}

export function simulate(
  definitions: ProcessDefinition[],
  config: SimulationConfig,
): SimulationResult {
  const processes: RuntimeProcess[] = definitions
    .map((process, index) => ({
      ...process,
      index,
      remainingTime: process.serviceTime,
      queueLevel: 0,
      quantumUsed: 0,
      firstRunTime: null,
      completionTime: null,
      waitingTime: 0,
    }))
    .sort(byStableOrder);

  const queueCount = config.algorithm === "mlfq" ? config.mlfqQuanta.length : 1;
  const queues: RuntimeProcess[][] = Array.from({ length: queueCount }, () => []);
  const snapshots: Snapshot[] = [];
  const timeline: TimelineSlice[] = [];
  let running: RuntimeProcess | null = null;
  let time = 0;
  const maximumTime =
    Math.max(0, ...processes.map((process) => process.arrivalTime)) +
    processes.reduce((total, process) => total + process.serviceTime, 0) +
    2;

  while (time <= maximumTime) {
    const events: string[] = [];
    let expired: RuntimeProcess | null = null;

    if (running?.remainingTime === 0) {
      running.completionTime = time;
      events.push(`${running.id} finished and left the system.`);
      running = null;
    } else if (
      running &&
      config.algorithm === "rr" &&
      running.quantumUsed >= config.quantum
    ) {
      expired = running;
      running = null;
    } else if (running && config.algorithm === "mlfq") {
      const allotted = config.mlfqQuanta[running.queueLevel];
      if (running.quantumUsed >= allotted) {
        expired = running;
        running = null;
      }
    }

    const arrivals = processes.filter(
      (process) => process.arrivalTime === time && process.remainingTime > 0,
    );
    for (const process of arrivals) {
      process.queueLevel = 0;
      process.quantumUsed = 0;
      queues[0].push(process);
      events.push(`${process.id} arrived and joined ${queueCount > 1 ? "Q0" : "the ready queue"}.`);
    }

    if (expired) {
      expired.quantumUsed = 0;
      if (config.algorithm === "mlfq") {
        const previousLevel = expired.queueLevel;
        expired.queueLevel = Math.min(previousLevel + 1, queueCount - 1);
        queues[expired.queueLevel].push(expired);
        events.push(
          previousLevel === expired.queueLevel
            ? `${expired.id} used its full quantum and returned to Q${expired.queueLevel}.`
            : `${expired.id} used its full quantum and moved from Q${previousLevel} to Q${expired.queueLevel}.`,
        );
      } else {
        queues[0].push(expired);
        events.push(`${expired.id}'s quantum expired; it moved to the back of the ready queue.`);
      }
    }

    if (running && config.algorithm === "stcf" && queues[0].length > 0) {
      const contender = queues[0].reduce((best, process) =>
        process.remainingTime < best.remainingTime ? process : best,
      );
      if (contender.remainingTime < running.remainingTime) {
        events.push(
          `${contender.id} has less remaining time, so ${running.id} was preempted.`,
        );
        running.quantumUsed = 0;
        queues[0].push(running);
        running = null;
      }
    }

    if (running && config.algorithm === "mlfq") {
      const higherQueueReady = queues.some(
        (queue, index) => index < running!.queueLevel && queue.length > 0,
      );
      if (higherQueueReady) {
        events.push(`${running.id} was preempted by a process in a higher-priority queue.`);
        queues[running.queueLevel].unshift(running);
        running = null;
      }
    }

    if (!running) {
      running = chooseNext(config.algorithm, queues);
      if (running) {
        if (running.firstRunTime === null) running.firstRunTime = time;
        events.push(`${running.id} was selected as ${describeAlgorithm(config.algorithm)}.`);
      }
    }

    const allFinished = processes.every((process) => process.completionTime !== null);
    const futureArrival = processes.some((process) => process.arrivalTime > time);

    if (!running && events.length === 0 && futureArrival) {
      events.push("The CPU is idle while the scheduler waits for the next arrival.");
    }

    snapshots.push({
      time,
      running: running?.id ?? null,
      readyQueues: queues.map((queue) => queue.map((process) => process.id)),
      events,
      processes: makeViews(processes, queues, running, time),
      runningRemaining: running?.remainingTime ?? null,
      runningQueueLevel: running?.queueLevel ?? null,
    });

    if (allFinished || (!running && !futureArrival && queues.every((queue) => queue.length === 0))) {
      break;
    }

    timeline.push({ time, processId: running?.id ?? null });
    for (const queue of queues) {
      for (const waiting of queue) waiting.waitingTime += 1;
    }
    if (running) {
      running.remainingTime -= 1;
      running.quantumUsed += 1;
    }
    time += 1;
  }

  return { snapshots, timeline };
}

export function validateProcesses(processes: ProcessDefinition[]): string | null {
  if (processes.length === 0) return "Add at least one process to run the simulation.";
  const normalized = processes.map((process) => process.id.trim().toLowerCase());
  if (normalized.some((id) => !id)) return "Every process needs an ID.";
  if (new Set(normalized).size !== normalized.length) return "Process IDs must be unique.";
  if (processes.some((process) => !Number.isInteger(process.arrivalTime) || process.arrivalTime < 0)) {
    return "Arrival times must be whole numbers greater than or equal to zero.";
  }
  if (processes.some((process) => !Number.isInteger(process.serviceTime) || process.serviceTime < 1)) {
    return "Service times must be positive whole numbers.";
  }
  return null;
}

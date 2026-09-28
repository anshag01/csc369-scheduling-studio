import type { Job } from './mlfq-ui-oracle';

export type Policy = 'fcfs' | 'sjf' | 'stcf' | 'rr';
export type PolicyCase = { name: string; jobs: Job[]; quantum: number };
export type PolicyFrame = {
  time: number;
  cpu: string | null;
  queues: string[][];
  rows: string[][];
  budgets: null;
  cards: string[];
  cardBudgets: string[][];
  events: string[];
};

// Reference scheduler for the browser audit. No production code is imported.
// Waiting time is derived from elapsed time minus delivered service, rather
// than maintaining the production scheduler's waiting counter.
export function policyFrames(policy: Policy, scenario: PolicyCase): PolicyFrame[] {
  const jobs = scenario.jobs.map((job, input) => ({
    ...job, input, work: 0, turn: 0, first: null as number | null, finish: null as number | null,
  })).sort((a, b) => a.arrivalTime - b.arrivalTime || a.input - b.input);
  const ready: number[] = [];
  let cpu: number | undefined;
  const result: PolicyFrame[] = [];
  const remaining = (id: number) => jobs[id].serviceTime - jobs[id].work;
  const score = (id: number) => policy === 'sjf' ? jobs[id].serviceTime : remaining(id);
  const ranked = () => [...ready].sort((a, b) => score(a) - score(b) || jobs[a].arrivalTime - jobs[b].arrivalTime || jobs[a].input - jobs[b].input);
  for (let time = 0; time <= 2000; time++) {
    const events: string[] = [];
    if (cpu !== undefined && remaining(cpu) === 0) {
      events.push(`finish:${jobs[cpu].id}`);
      jobs[cpu].finish = time;
      cpu = undefined;
    }
    let expired: number | undefined;
    if (cpu !== undefined && policy === 'rr' && jobs[cpu].turn === scenario.quantum) {
      expired = cpu;
      jobs[cpu].turn = 0;
      cpu = undefined;
    }
    jobs.forEach((job, id) => {
      if (job.arrivalTime === time) {
        ready.push(id);
        events.push(`arrive:${job.id}`);
      }
    });
    if (expired !== undefined) {
      ready.push(expired);
      events.push(`rotate:${jobs[expired].id}`);
    }
    if (policy === 'stcf' && cpu !== undefined && ready.length && remaining(ranked()[0]) < remaining(cpu)) {
      events.push(`preempt:${jobs[cpu].id}:${jobs[ranked()[0]].id}`);
      jobs[cpu].turn = 0;
      ready.push(cpu);
      cpu = undefined;
    }
    let dispatched = false;
    if (cpu === undefined && ready.length) {
      cpu = policy === 'fcfs' || policy === 'rr' ? ready[0] : ranked()[0];
      ready.splice(ready.indexOf(cpu), 1);
      jobs[cpu].first ??= time;
      events.push(`dispatch:${jobs[cpu].id}`);
      dispatched = true;
    }
    if (cpu !== undefined && !dispatched) events.push(`continue:${jobs[cpu].id}`);
    const complete = jobs.every(job => job.finish !== null);
    if (complete) events.push(`complete:${jobs.length}`);
    else if (cpu === undefined) events.push(`idle:${Math.min(...jobs.filter(job => job.arrivalTime > time).map(job => job.arrivalTime))}`);
    const state = (id: number) => jobs[id].finish !== null ? 'finished' : cpu === id ? 'running' : jobs[id].arrivalTime > time ? 'new' : 'ready';
    result.push({
      time,
      cpu: cpu === undefined ? null : jobs[cpu].id,
      queues: [ready.map(id => jobs[id].id)],
      rows: jobs.map((job, id) => [job.id, state(id), String(remaining(id)),
        String(Math.max(0, (job.finish ?? time) - job.arrivalTime) - job.work),
        job.first === null ? '—' : String(job.first - job.arrivalTime),
        job.finish === null ? '—' : String(job.finish - job.arrivalTime)]),
      budgets: null,
      cardBudgets: [],
      cards: jobs.filter((_, id) => state(id) === 'ready' || state(id) === 'running').map(job => job.id).sort(),
      events,
    });
    if (complete) return result;
    if (cpu !== undefined) { jobs[cpu].work++; jobs[cpu].turn++; }
  }
  throw new Error(`Reference failed to complete ${policy}: ${scenario.name}`);
}

const job = (id: string, arrivalTime: number, serviceTime: number): Job => ({ id, arrivalTime, serviceTime });
export const policyEdges: PolicyCase[] = [
  { name: 'same-arrival equal lengths keep input order', jobs: [job('C', 0, 2), job('A', 0, 2), job('B', 0, 2)], quantum: 1 },
  { name: 'equal lengths prefer earlier arrival at dispatch', jobs: [job('X', 0, 5), job('C', 2, 2), job('B', 1, 2)], quantum: 2 },
  { name: 'completion expiry and multiple arrivals coincide', jobs: [job('A', 0, 2), job('B', 2, 1), job('C', 2, 3)], quantum: 2 },
  { name: 'equal remaining arrival then strictly shorter arrival', jobs: [job('A', 0, 5), job('B', 2, 3), job('C', 3, 1)], quantum: 3 },
  { name: 'repeated short arrivals and resumed work', jobs: [job('A', 0, 9), job('B', 1, 2), job('C', 2, 1), job('D', 5, 1)], quantum: 2 },
  { name: 'initial idle and idle gap with simultaneous arrivals', jobs: [job('A', 3, 2), job('B', 8, 2), job('C', 8, 1)], quantum: 1 },
  { name: 'lone runner repeatedly renews its turn', jobs: [job('A', 0, 9)], quantum: 2 },
  { name: 'input order differs from arrival order', jobs: [job('Z', 5, 1), job('X', 0, 3), job('Y', 1, 2)], quantum: 4 },
];

export function seededWorkloads(): PolicyCase[] {
  let seed = 3692026;
  const next = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  return Array.from({ length: 32 }, (_, index) => ({
    name: `seeded-${index + 1}`,
    jobs: Array.from({ length: 3 + next(3) }, (_, i) => job(['C', 'A', 'E', 'B', 'D'][i], index % 5 === 0 ? 0 : next(9), 1 + next(5))),
    quantum: 1 + next(4),
  }));
}

export function casesForPolicy(): PolicyCase[] {
  const cases: PolicyCase[] = [...policyEdges];
  for (const arrival of [0, 1, 3, 6]) for (const a of [1, 2, 3, 5]) for (const b of [1, 2, 3, 5]) {
    cases.push({ name: `arrival-${arrival}-service-${a}-${b}`, jobs: [job('A', 0, a), job('B', arrival, b)], quantum: [1, 2, 4][cases.length % 3] });
  }
  return [...cases, ...seededWorkloads()];
}

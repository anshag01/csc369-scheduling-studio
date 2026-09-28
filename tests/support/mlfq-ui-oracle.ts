// Independent expectation model for browser tests. No production scheduler imports.
export type Job = { id: string; arrivalTime: number; serviceTime: number };
export type Scenario = { name: string; jobs: Job[]; quanta: number[]; allotments: number[]; boost: number; animated?: boolean; capture?: number };
export type Boundary = { time: number; cpu: string | null; queues: string[][]; rows: string[][]; budgets: string | null; cards: string[]; cardBudgets: string[][] };

export function expectedBoundaries(scenario: Scenario): Boundary[] {
  const jobs = scenario.jobs.map((job, order) => ({ ...job, order, level: 0, turn: 0, spent: 0, work: 0, first: null as number | null, done: null as number | null })).sort((a,b)=>a.arrivalTime-b.arrivalTime||a.order-b.order);
  const queues: number[][] = [[], [], []];
  let cpu: number | undefined;
  const frames: Boundary[] = [];
  for (let time = 0; time <= 2000; time++) {
    const boosting = time > 0 && time % scenario.boost === 0;
    let outgoing: number | undefined;
    if (cpu !== undefined) {
      const p = jobs[cpu];
      if (p.work === p.serviceTime) { p.done = time; cpu = undefined; }
      else if (!boosting && p.spent === scenario.allotments[p.level]) {
        outgoing = cpu; cpu = undefined;
        p.level = Math.min(2, p.level + 1); p.turn = 0; p.spent = 0;
      } else if (!boosting && p.turn === scenario.quanta[p.level]) {
        outgoing = cpu; cpu = undefined; p.turn = 0;
      }
    }
    if (boosting) {
      const promoted = queues.flat();
      if (cpu !== undefined) promoted.push(cpu);
      queues.forEach(q => q.splice(0));
      for (const id of promoted) { jobs[id].level = 0; jobs[id].spent = 0; jobs[id].turn = 0; }
      queues[0].push(...promoted); cpu = undefined;
    }
    jobs.forEach((p, id) => { if (p.arrivalTime === time) queues[0].push(id); });
    if (outgoing !== undefined) queues[jobs[outgoing].level].push(outgoing);
    if (cpu !== undefined && queues.slice(0, jobs[cpu].level).some(q => q.length)) {
      queues[jobs[cpu].level].unshift(cpu); cpu = undefined;
    }
    if (cpu === undefined) cpu = queues.find(q => q.length)?.shift();
    if (cpu !== undefined && jobs[cpu].first === null) jobs[cpu].first = time;
    const state = (id: number) => jobs[id].done !== null ? 'finished' : id === cpu ? 'running' : jobs[id].arrivalTime > time ? 'new' : 'ready';
    const runner = cpu === undefined ? undefined : jobs[cpu];
    frames.push({
      time, cpu: runner?.id ?? null, queues: queues.map(q => q.map(id => jobs[id].id)),
      rows: jobs.map((p, id) => [p.id, state(id), String(p.serviceTime-p.work),
        p.done !== null ? '—' : String(scenario.quanta[p.level]-p.turn),
        p.done !== null ? '—' : String(scenario.allotments[p.level]-p.spent),
        String(Math.max(0,(p.done ?? time)-p.arrivalTime)-p.work),
        p.first === null ? '—' : String(p.first-p.arrivalTime),
        p.done === null ? '—' : String(p.done-p.arrivalTime)]),
      budgets: runner ? `Quantum left: ${scenario.quanta[runner.level]-runner.turn} · Allotment left: ${scenario.allotments[runner.level]-runner.spent}` : null,
      cardBudgets: jobs.filter((_,id)=>state(id)==='running'||state(id)==='ready').map(p=>[p.id, `Q: ${p.turn}/${scenario.quanta[p.level]} · A: ${p.spent}/${scenario.allotments[p.level]}`]).sort((a,b)=>a[0].localeCompare(b[0])),
      cards: jobs.filter((_,id)=>state(id)==='running'||state(id)==='ready').map(p=>p.id).sort(),
    });
    if (jobs.every(p=>p.done!==null)) return frames;
    if (runner) { runner.work++; runner.turn++; runner.spent++; }
  }
  throw new Error(`Reference did not finish: ${scenario.name}`);
}

const job = (id: string, arrivalTime: number, serviceTime: number): Job => ({id,arrivalTime,serviceTime});
const scenario = (name: string, jobs: Job[], quanta=[2,4,8], allotments=quanta, boost=100, animated=false, capture=1): Scenario => ({name,jobs,quanta,allotments,boost,animated,capture});
export const namedScenarios: Scenario[] = [
  scenario('four one-tick turns before demotion', [job('A',0,6),job('B',0,6)], [1,2,4],[4,6,8],100,true,7),
  scenario('allotment interrupts a partial quantum', [job('A',0,5),job('B',0,5)], [2,4,8],[3,6,8],100,true,5),
  scenario('boost interrupts Q0 and enqueues runner last', [job('A',0,5),job('B',0,3)], [4,8,8],[6,8,8],2,true,2),
  scenario('boost interrupts Q1 and enqueues runner last', [job('A',0,6),job('B',0,4)], [1,4,8],[1,6,8],4,true,4),
  scenario('boost interrupts Q2 and enqueues runner last', [job('A',0,6),job('B',0,5)], [1,1,4],[1,1,8],5,true,5),
  scenario('lone runner is boosted and immediately redispatched', [job('A',0,7)], [1,4,8],[1,6,8],2,true,2),
  scenario('boost with waiting processes from mixed levels', [job('A',2,9),job('B',2,4),job('C',0,9),job('D',2,6)], [1,3,5],[1,3,5],7,false,7),
  scenario('arrival follows ongoing-runner boost', [job('A',0,6),job('B',0,4),job('C',2,1)], [4,8,8],[6,8,8],2,false,2),
  scenario('boost overrides allotment expiry and places runner last', [job('X',0,8),job('B',3,3)], [1,1,8],[1,1,8],4,false,4),
  scenario('confirmed B C D A order with arrival after boost', [job('D',0,20),job('C',4,10),job('A',5,10),job('B',5,10),job('E',6,1)], [1,3,8],[1,3,8],6,true,6),
  scenario('boost overrides allotment expiry in a partial quantum', [job('A',0,7),job('B',0,4)], [4,4,8],[2,6,8],2,false,2),
  scenario('boost overrides quantum expiry without rotating first', [job('A',0,7),job('B',0,4)], [2,4,8],[5,6,8],2,false,2),
  scenario('completion beats expiry boost and arrivals', [job('A',0,2),job('B',0,4),job('C',2,1)], [2,4,8],[2,4,8],2,false,2),
  scenario('arrival precedes rotation without boost', [job('A',0,6),job('B',2,3)], [2,4,8],[5,6,8],100,false,2),
  scenario('higher-priority preemption preserves both counters', [job('A',0,12),job('B',3,1),job('C',6,1)], [1,4,8],[1,7,10],100,false,3),
  scenario('same-level arrival never preempts', [job('A',0,6),job('B',1,2)], [3,4,8],[5,6,8],100,false,1),
  scenario('bottom queue renews its exhausted budget', [job('A',0,10),job('B',0,7)], [1,1,2],[1,1,3],100,false,8),
  scenario('allotment smaller than quantum', [job('A',0,8),job('B',0,4)], [5,5,5],[1,2,3],100,false,1),
  scenario('input-order ties use unsorted IDs', [job('C',0,3),job('A',0,3),job('B',0,3)], [1,2,4],[2,3,5],100,false,1),
  scenario('idle gaps and boosts with no active processes', [job('A',3,2),job('B',9,2)], [2,4,8],[3,5,9],2,false,6),
  scenario('boost every tick and all one-tick budgets', [job('A',0,4),job('B',0,3),job('C',1,2)], [1,1,1],[1,1,1],1,false,2),
  scenario('repeated boosts keep cumulative service intact', [job('A',0,8),job('B',0,8),job('C',1,5)], [3,4,5],[5,7,9],3,false,6),
];

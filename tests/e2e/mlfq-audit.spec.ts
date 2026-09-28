import { expect, Page, test, TestInfo } from '@playwright/test';
import { Boundary, expectedBoundaries, namedScenarios, Scenario } from '../support/mlfq-ui-oracle';

async function start(page: Page, animated=false) {
  page.setDefaultTimeout(10000);
  await page.emulateMedia({reducedMotion:animated?'no-preference':'reduce'});
  await page.goto('/');
  await page.getByRole('button',{name:'Next time step',exact:true}).click();
  await expect(page.getByTestId('time-value')).toHaveText('1');
  await expect(page.locator('.dashboard-grid')).toHaveAttribute('data-motion-status','idle');
  await page.locator('#algorithm').selectOption('mlfq');
  await page.getByRole('button',{name:'Metrics',exact:true}).click();
  await page.locator('.json-panel summary').click();
  await page.locator('.speed-control select').selectOption('850');
}

async function configure(page:Page,s:Scenario) {
  await page.getByLabel('Scenario JSON').fill(JSON.stringify({processes:s.jobs}));
  await page.getByRole('button',{name:'Import',exact:true}).click();
  for(let level=0;level<3;level++) {
    for(const [label,value] of [['quantum',s.quanta[level]],['allotment',s.allotments[level]]] as const) {
      const input=page.getByRole('spinbutton',{name:`Q${level} ${label}`,exact:true});
      if(await input.inputValue()!==String(value)) await input.fill(String(value));
    }
  }
  const boost=page.getByRole('spinbutton',{name:'Boost ticks',exact:true});
  if(await boost.inputValue()!==String(s.boost)) await boost.fill(String(s.boost));
  await expect(page.getByTestId('time-value')).toHaveText('0');
}

async function check(page:Page,expected:Boundary) {
  await expect(page.locator('.dashboard-grid')).toHaveAttribute('data-motion-status','idle');
  // Read only rendered DOM. No internal React state or production simulator calls.
  const actual=await page.evaluate(()=>({
    time:Number(document.querySelector('[data-testid="time-value"]')!.textContent),
    cpu:document.querySelector('[data-testid="cpu-process-card"] strong')?.textContent??null,
    queues:[...document.querySelectorAll('[data-testid^="ready-queue-"]')].map(q=>[...q.querySelectorAll('.queue-chip strong')].map(p=>p.textContent)),
    rows:[...document.querySelectorAll('.metrics-scroll tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(td=>td.textContent)),
    budgets:document.querySelector('[data-testid="running-budgets"]') ? [...document.querySelectorAll('[data-testid="running-budgets"] tbody tr')].map(row => [...row.children].map(cell => cell.textContent)) : null,
    cardBudgets: [...document.querySelectorAll('.dashboard-grid [data-motion-id]')].filter(e => e.querySelector('.process-budgets')).map(e => [e.querySelector('strong')!.textContent!, e.querySelector('.process-budgets')!.textContent!]).sort((a,b) => a[0].localeCompare(b[0])),
    cards:[...document.querySelectorAll('.dashboard-grid [data-motion-id]')].map(e=>e.querySelector('strong')!.textContent).sort(),
  }));
  expect(actual).toEqual(expected);
  await expect(page.locator('.process-motion-traveler,.process-motion-arrow')).toHaveCount(0);
}

async function traverse(page:Page,s:Scenario,info:TestInfo,capture=false) {
  const frames=expectedBoundaries(s);
  await configure(page,s);
  const timeline=await page.locator('[data-timeline-time] .tick-block').allTextContents();
  expect(timeline.map(text=>text.trim())).toEqual(frames.slice(0,-1).map(f=>f.cpu??'idle'));
  for(const frame of frames) {
    await check(page,frame);
    if(capture && frame.time===s.capture) await info.attach(`${s.name}-t${frame.time}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
    if(frame.time<frames.length-1) await page.getByRole('button',{name:'Next time step',exact:true}).click();
  }
  await expect(page.getByRole('button',{name:'Next time step',exact:true})).toBeDisabled();
  for(let t=frames.length-2;t>=0;t--) {
    await page.getByRole('button',{name:'Previous time step',exact:true}).click();
    await check(page,frames[t]);
  }
  await expect(page.getByRole('button',{name:'Previous time step',exact:true})).toBeDisabled();
  return {scenario:s,forwardBoundaries:frames.length,reverseBoundaries:frames.length-1,trace:frames.slice(0,-1).map(f=>f.cpu??'-')};
}

for(const s of namedScenarios) {
  test(`MLFQ walkthrough: ${s.name}`,async({page},info)=>{
    // Animated cases traverse every boundary in both directions. Allow the
    // complete workload to play instead of capping long traces at three minutes.
    test.setTimeout(s.animated ? Math.max(180000, expectedBoundaries(s).length * 6000) : 90000);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await start(page,s.animated);
    const summary=await traverse(page,s,info,true);
    expect(errors).toEqual([]);
    await info.attach('verified-walkthrough',{body:JSON.stringify(summary,null,2),contentType:'application/json'});
  });
}

// Exhaustive within this stated domain: 2 arrivals × 2 services × 2 services ×
// 2 quanta × 3 allotments × 3 boost intervals = 144 scenarios per viewport.
for(const quantum of [1,2]) for(const allotment of [1,2,3]) for(const boost of [1,2,5]) {
  test(`MLFQ matrix: quantum ${quantum}, allotment ${allotment}, boost ${boost}`,async({page},info)=>{
    test.setTimeout(180000);
    await start(page);
    const summaries: Awaited<ReturnType<typeof traverse>>[]=[];
    for(const arrival of [0,1]) for(const a of [1,3]) for(const b of [1,3]) {
      const s:Scenario={name:`q${quantum}-a${allotment}-b${boost}-arrival${arrival}-service${a},${b}`,jobs:[{id:'A',arrivalTime:0,serviceTime:a},{id:'B',arrivalTime:arrival,serviceTime:b}],quanta:[quantum,2,3],allotments:[allotment,3,4],boost};
      await test.step(s.name,async()=>summaries.push(await traverse(page,s,info)));
    }
    await info.attach('verified-matrix',{body:JSON.stringify(summaries,null,2),contentType:'application/json'});
  });
}

test('MLFQ input validation, editing, reset, export, and recovery through UI',async({page})=>{
  await start(page);
  const s=namedScenarios[0];await configure(page,s);
  await page.locator('[data-timeline-time="3"]').click();await check(page,expectedBoundaries(s)[3]);
  await page.getByRole('spinbutton',{name:'Q1 allotment',exact:true}).fill('9007199254740992');
  await expect(page.getByRole('main',{name:'Scheduling Studio'}).getByRole('alert')).toContainText('allotment');
  await expect(page.locator('.dashboard-grid')).toHaveCount(0);
  await page.getByRole('spinbutton',{name:'Q1 allotment',exact:true}).fill('6');
  await check(page,expectedBoundaries(s)[0]);
  await page.getByRole('spinbutton',{name:'Q1 quantum',exact:true}).fill('9007199254740992');
  await expect(page.getByRole('main',{name:'Scheduling Studio'}).getByRole('alert')).toContainText('quantum');
  await page.getByRole('spinbutton',{name:'Q1 quantum',exact:true}).fill('2');
  await page.getByRole('spinbutton',{name:'Boost ticks',exact:true}).fill('9007199254740992');
  await expect(page.getByRole('main',{name:'Scheduling Studio'}).getByRole('alert')).toContainText('boost');
  await page.getByRole('spinbutton',{name:'Boost ticks',exact:true}).fill('100');
  await page.getByLabel('Process 2 ID').fill('A');
  await expect(page.getByRole('main',{name:'Scheduling Studio'}).getByRole('alert')).toContainText('unique');
  await page.getByLabel('Process 2 ID').fill('B');
  await page.getByLabel('Scenario JSON').fill('{broken');
  await page.getByRole('button',{name:'Import',exact:true}).click();
  await expect(page.locator('.json-panel p')).not.toHaveText(/Loaded/);
  await check(page,expectedBoundaries(s)[0]);
  await page.getByRole('button',{name:'Export',exact:true}).click();
  const exported=JSON.parse(await page.getByLabel('Scenario JSON').inputValue());
  expect(exported.processes.map(({id,arrivalTime,serviceTime}:Scenario['jobs'][number])=>({id,arrivalTime,serviceTime}))).toEqual(s.jobs);
  await page.getByRole('button',{name:/Add process/}).click();
  await expect(page.locator('.process-row')).toHaveCount(3);
  await page.getByRole('button',{name:'Remove C',exact:true}).click();
  await check(page,expectedBoundaries(s)[0]);
  await page.getByRole('button',{name:'Next time step',exact:true}).click();
  await page.getByRole('button',{name:'Reset to time zero',exact:true}).click();
  await check(page,expectedBoundaries(s)[0]);
});

test('MLFQ supported limits: 50 processes and a 2000-tick workload',async({page},info)=>{
  test.setTimeout(180000);await start(page);
  for(const s of [
    {name:'50-process queue pressure',jobs:Array.from({length:50},(_,i)=>({id:`P${i}`,arrivalTime:0,serviceTime:2})),quanta:[1,2,3],allotments:[2,3,4],boost:7},
    {name:'2000-tick service',jobs:[{id:'A',arrivalTime:0,serviceTime:2000}],quanta:[2,3,5],allotments:[3,5,8],boost:11},
  ]) {
    await configure(page,s);const frames=expectedBoundaries(s);
    const times=[0,1,Math.floor((frames.length-1)/2),frames.length-2];
    for(const t of times){await page.locator(`[data-timeline-time="${t}"]`).click();await check(page,frames[t]);}
    await page.getByRole('button',{name:'Next time step',exact:true}).click();await check(page,frames.at(-1)!);
    await info.attach(s.name,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  }
});

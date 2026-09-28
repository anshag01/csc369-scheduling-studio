import { expect, Page, test, TestInfo } from '@playwright/test';
import { Boundary, expectedBoundaries, Scenario } from '../support/mlfq-ui-oracle';
import { casesForPolicy, Policy, PolicyCase, policyFrames, seededWorkloads } from '../support/policy-ui-oracle';

type AnyPolicy = Policy | 'mlfq';
type Case = PolicyCase & Partial<Scenario>;
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page)!.push(error.message));
  page.setDefaultTimeout(10000);
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function open(page: Page, policy: AnyPolicy) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Next time step', exact: true }).click();
  await expect(page.getByTestId('time-value')).toHaveText('1');
  await page.locator('#algorithm').selectOption(policy);
  await page.getByRole('button', { name: 'Metrics', exact: true }).click();
  await page.locator('.json-panel summary').click();
  await page.locator('.speed-control select').selectOption('850');
}

async function configure(page: Page, policy: AnyPolicy, scenario: Case) {
  await page.getByLabel('Scenario JSON').fill(JSON.stringify({ processes: scenario.jobs }));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  if (policy === 'rr') await page.getByRole('spinbutton', { name: 'Time quantum', exact: true }).fill(String(scenario.quantum));
  if (policy === 'mlfq') {
    for (let level = 0; level < 3; level++) {
      await page.getByRole('spinbutton', { name: `Q${level} quantum`, exact: true }).fill(String(scenario.quanta![level]));
      await page.getByRole('spinbutton', { name: `Q${level} allotment`, exact: true }).fill(String(scenario.allotments![level]));
    }
    await page.getByRole('spinbutton', { name: 'Boost ticks', exact: true }).fill(String(scenario.boost));
  }
  await expect(page.getByTestId('time-value')).toHaveText('0');
}

function eventMeaning(text: string): string {
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^(\S+) finished and left/))) return `finish:${match[1]}`;
  if ((match = text.match(/^(\S+) arrived and joined/))) return `arrive:${match[1]}`;
  if ((match = text.match(/^(\S+)'s quantum expired/))) return `rotate:${match[1]}`;
  if ((match = text.match(/^(\S+) has less remaining CPU service, so (\S+) was preempted/))) return `preempt:${match[2]}:${match[1]}`;
  if ((match = text.match(/^(\S+) was selected:/))) return `dispatch:${match[1]}`;
  if ((match = text.match(/^(\S+) continues/))) return `continue:${match[1]}`;
  if ((match = text.match(/next arrival at t=(\d+)/))) return `idle:${match[1]}`;
  if ((match = text.match(/^All (\d+) processes have finished/))) return `complete:${match[1]}`;
  throw new Error(`Unrecognized boundary explanation: ${text}`);
}

async function check(page: Page, frame: Boundary & { events?: string[] }) {
  await expect(page.locator('.dashboard-grid')).toHaveAttribute('data-motion-status', 'idle');
  const { events, ...state } = frame;
  const actual = await page.evaluate(() => ({
    time: Number(document.querySelector('[data-testid="time-value"]')!.textContent),
    cpu: document.querySelector('[data-testid="cpu-process-card"] strong')?.textContent ?? null,
    queues: [...document.querySelectorAll('[data-testid^="ready-queue-"]')].map(q => [...q.querySelectorAll('.queue-chip strong')].map(p => p.textContent)),
    rows: [...document.querySelectorAll('.metrics-scroll tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent)),
    budgets: document.querySelector('[data-testid="running-budgets"]') ? [...document.querySelectorAll('[data-testid="running-budgets"] tbody tr')].map(row => [...row.children].map(cell => cell.textContent)) : null,
    cardBudgets: [...document.querySelectorAll('.dashboard-grid [data-motion-id]')].filter(e => e.querySelector('.process-budgets')).map(e => [e.querySelector('strong')!.textContent!, e.querySelector('.process-budgets')!.textContent!]).sort((a,b) => a[0].localeCompare(b[0])),
    cards: [...document.querySelectorAll('.dashboard-grid [data-motion-id]')].map(e => e.querySelector('strong')!.textContent).sort(),
  }));
  expect(actual).toEqual(state);
  const labels = await page.locator('.dashboard-grid [data-motion-id]').evaluateAll(nodes => nodes.map(node => ({
    id: node.querySelector('strong')!.textContent!,
    service: node.querySelector('span')!.textContent!,
    budget: node.querySelector('.process-budgets')?.textContent ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id)));
  expect(labels.map(label => [label.id, label.service])).toEqual(frame.rows.filter(row => ['running', 'ready'].includes(row[1])).map(row => [row[0], `${row[2]} service left`]).sort((a, b) => a[0].localeCompare(b[0])));
  const explanations = await page.getByTestId('event-list').locator('p').evaluateAll(nodes => nodes.map(node => [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('')));
  expect(explanations.every(text => !/\d+ ticks left|less remaining time|shortest remaining time/.test(text))).toBe(true);
  if (events) expect(explanations.map(eventMeaning)).toEqual(events);
  await expect(page.locator('.process-motion-traveler, .process-motion-arrow')).toHaveCount(0);
}

function frames(policy: AnyPolicy, scenario: Case): Array<Boundary & { events?: string[] }> {
  return policy === 'mlfq' ? expectedBoundaries(scenario as Scenario) : policyFrames(policy, scenario);
}

async function walk(page: Page, policy: AnyPolicy, scenario: Case) {
  const expected = frames(policy, scenario);
  await configure(page, policy, scenario);
  expect((await page.locator('[data-timeline-time] .tick-block').allTextContents()).map(t => t.trim())).toEqual(expected.slice(0, -1).map(f => f.cpu ?? 'idle'));
  for (const frame of expected) {
    await check(page, frame);
    if (frame.time < expected.length - 1) await page.getByRole('button', { name: 'Next time step', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Next time step', exact: true })).toBeDisabled();
  for (let time = expected.length - 2; time >= 0; time--) {
    await page.getByRole('button', { name: 'Previous time step', exact: true }).click();
    await check(page, expected[time]);
  }
  await expect(page.getByRole('button', { name: 'Previous time step', exact: true })).toBeDisabled();
  return { policy, scenario, forwardBoundaries: expected.length, reverseBoundaries: expected.length - 1, trace: expected.slice(0, -1).map(f => f.cpu ?? '-') };
}

async function attach(info: TestInfo, data: unknown) {
  await info.attach('verified-policy-workloads', { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
}

for (const policy of ['fcfs', 'sjf', 'stcf', 'rr'] as const) {
  const cases = casesForPolicy();
  for (let offset = 0; offset < cases.length; offset += 8) {
    test(`${policy.toUpperCase()} UI audit workloads ${offset + 1}–${Math.min(offset + 8, cases.length)}`, async ({ page }, info) => {
      test.setTimeout(180000);
      await open(page, policy);
      const verified: Awaited<ReturnType<typeof walk>>[] = [];
      for (const scenario of cases.slice(offset, offset + 8)) {
        await test.step(scenario.name, async () => verified.push(await walk(page, policy, scenario)));
      }
      await attach(info, verified);
    });
  }
}

const mlfqCases: Case[] = seededWorkloads().map((scenario, i) => ({ ...scenario,
  quanta: [1 + i % 4, 1 + (i * 3) % 5, 2 + i % 6],
  allotments: [1 + (i * 5) % 7, 2 + (i * 7) % 9, 1 + (i * 3) % 8],
  boost: [1, 2, 3, 5, 7, 11, 100][i % 7],
}));
for (let offset = 0; offset < mlfqCases.length; offset += 8) {
  test(`MLFQ seeded UI audit workloads ${offset + 1}–${offset + 8}`, async ({ page }, info) => {
    test.setTimeout(180000); await open(page, 'mlfq');
    const verified: Awaited<ReturnType<typeof walk>>[] = [];
    for (const scenario of mlfqCases.slice(offset, offset + 8)) await test.step(scenario.name, async () => verified.push(await walk(page, 'mlfq', scenario)));
    await attach(info, verified);
  });
}

for (const policy of ['fcfs', 'sjf', 'stcf', 'rr', 'mlfq'] as const) {
  const budgets = { quantum: 2, quanta: [1, 2, 4], allotments: [3, 5, 8], boost: 7 };
  test(`${policy.toUpperCase()} UI limits and invalid import recovery`, async ({ page }, info) => {
    test.setTimeout(120000); await open(page, policy);
    for (const scenario of [
      { name: '50 jobs', jobs: Array.from({ length: 50 }, (_, i) => ({ id: `P${i}`, arrivalTime: i % 4, serviceTime: 2 })), ...budgets },
      { name: 'finish at 2000 including idle gap', jobs: [{ id: 'A', arrivalTime: 1998, serviceTime: 2 }], ...budgets },
    ]) {
      await configure(page, policy, scenario);
      const expected = frames(policy, scenario);
      for (const time of [0, 1, Math.floor((expected.length - 1) / 2), expected.length - 2]) {
        await page.locator(`[data-timeline-time="${time}"]`).click();
        await check(page, expected[time]);
      }
      await page.getByRole('button', { name: 'Next time step', exact: true }).click();
      await check(page, expected.at(-1)!);
      await page.getByLabel('Scenario JSON').fill(JSON.stringify({ processes: [{ id: 'X', arrivalTime: 1999, serviceTime: 2 }] }));
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(page.locator('.json-panel p')).toContainText('2000');
      await check(page, expected.at(-1)!);
    }
    await info.attach(`${policy}-limit`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test(`${policy.toUpperCase()} UI playback keyboard editing reset and export`, async ({ page }) => {
    await open(page, policy);
    const scenario = { name: 'controls', jobs: [{ id: 'A', arrivalTime: 0, serviceTime: 5 }, { id: 'B', arrivalTime: 1, serviceTime: 3 }], ...budgets };
    await configure(page, policy, scenario);
    const expected = frames(policy, scenario);
    await page.locator('h2').first().click();
    await page.keyboard.press('ArrowRight'); await check(page, expected[1]);
    await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
    await expect.poll(async () => Number(await page.getByTestId('time-value').textContent())).toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
    const time = Number(await page.getByTestId('time-value').textContent()); await check(page, expected[time]);
    await page.getByRole('button', { name: 'Reset to time zero', exact: true }).click(); await check(page, expected[0]);
    await page.getByLabel('Process 2 ID').fill('A');
    await expect(page.locator('.validation-message')).toContainText('unique');
    await expect(page.locator('.dashboard-grid')).toHaveCount(0);
    await page.getByLabel('Process 2 ID').fill('B'); await check(page, expected[0]);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const exported = JSON.parse(await page.getByLabel('Scenario JSON').inputValue());
    expect(exported.processes.map(({ id, arrivalTime, serviceTime }: PolicyCase['jobs'][number]) => ({ id, arrivalTime, serviceTime }))).toEqual(scenario.jobs);
  });
}

test('quantum/allotment demo explains four turns then demotion with six service ticks left', async ({ page }, info) => {
  await open(page, 'mlfq');
  await page.locator('.budget-example summary').click();
  await expect(page.locator('#quantum-help')).toContainText('Quantum (time slice)');
  await expect(page.locator('#allotment-help')).toContainText('total CPU ticks at this priority');
  await page.getByRole('button', { name: 'Load quantum/allotment example', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Q0 quantum', exact: true })).toHaveValue('1');
  await expect(page.getByRole('spinbutton', { name: 'Q0 allotment', exact: true })).toHaveValue('4');
  const demo: Scenario = { name: 'teaching demo', jobs: [{ id: 'A', arrivalTime: 0, serviceTime: 10 }, { id: 'B', arrivalTime: 0, serviceTime: 10 }], quanta: [1, 4, 8], allotments: [4, 4, 8], boost: 100 };
  const expected = expectedBoundaries(demo);
  for (let time = 0; time <= 8; time++) {
    await check(page, expected[time]);
    if (time < 8) await page.getByRole('button', { name: 'Next time step', exact: true }).click();
    if (time === 0) await expect(page.getByTestId('event-list')).toContainText('quantum expired');
  }
  await page.getByRole('button', { name: 'Previous time step', exact: true }).click();
  await expect(page.getByTestId('event-list')).toContainText('A used its full allotment');
  await expect(page.getByTestId('event-list')).toContainText('6 CPU service ticks remain');
  await expect(page.getByTestId('ready-queue-1').locator('[data-process-id="A"]')).toContainText('6 service left');
  await info.attach('quantum-allotment-demo', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

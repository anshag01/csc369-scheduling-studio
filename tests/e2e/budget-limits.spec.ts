import { expect, Page, test } from '@playwright/test';

async function start(page: Page, policy: 'mlfq' | 'rr', jobs = [
  { id: 'A', arrivalTime: 0, serviceTime: 1998 },
  { id: 'B', arrivalTime: 0, serviceTime: 2 },
]) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Next time step', exact: true }).click();
  await expect(page.getByTestId('time-value')).toHaveText('1');
  await page.locator('#algorithm').selectOption(policy);
  await page.locator('.json-panel summary').click();
  await page.getByLabel('Scenario JSON').fill(JSON.stringify({ processes: jobs }));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  if (policy === 'mlfq') await page.getByRole('spinbutton', { name: 'Boost ticks', exact: true }).fill('2000');
}

async function settings(page: Page, policy: 'mlfq' | 'rr', value: number) {
  for (const name of policy === 'mlfq' ? ['Q0 quantum', 'Q0 allotment'] : ['Time quantum']) {
    await page.getByRole('spinbutton', { name, exact: true }).fill(String(value));
  }
}

async function fits(page: Page) {
  await expect(page.locator('.dashboard-grid')).toHaveAttribute('data-motion-status', 'idle');
  const geometry = await page.locator('.dashboard-grid [data-motion-id]').evaluateAll(nodes => nodes.map(node => ({
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
    clipped: [...node.querySelectorAll('strong, span, small')].some(text => text.scrollWidth > text.clientWidth + 1),
  })));
  expect(geometry.every(card => !card.clipped)).toBe(true);
  expect(new Set(geometry.map(card => `${card.width}:${card.height}`)).size).toBe(1);
  expect(await page.locator('.cpu-card').evaluate(cpu => {
    const bounds = cpu.getBoundingClientRect();
    return [...cpu.querySelectorAll('.cpu-process-copy > *, [data-testid="cpu-process-card"]')].every(detail => {
      const rect = detail.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right - 5 && rect.bottom <= bounds.bottom - 5;
    });
  })).toBe(true);
}

for (const policy of ['rr', 'mlfq'] as const) {
  test(`${policy.toUpperCase()} large valid budgets keep exact counters readable`, async ({ page }, info) => {
    test.setTimeout(90000);
    await start(page, policy);
    for (const value of [2000, 10000, Number.MAX_SAFE_INTEGER]) {
      await settings(page, policy, value);
      await page.locator('[data-timeline-time="1500"]').click();
      await expect(page.getByTestId('cpu-process-card')).toContainText('498 service left');
      await expect(page.getByTestId('cpu-process-card').locator('small')).toHaveText(policy === 'rr'
        ? `1500/${value} slice` : `Q: 1500/${value} · A: 1500/${value}`);
      await fits(page);
      await page.locator('[data-timeline-time="1999"]').click();
      await expect(page.getByTestId('cpu-process-card')).toContainText('1 service left');
      await fits(page);
      await page.getByRole('button', { name: 'Next time step', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Next time step', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Previous time step', exact: true }).click();
      await fits(page);
    }
    await info.attach(`${policy}-max-safe-budget`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}

test('wide MLFQ cards preserve boost and reverse movement', async ({ page }, info) => {
  await start(page, 'mlfq', [{ id: 'A', arrivalTime: 0, serviceTime: 4 }, { id: 'B', arrivalTime: 0, serviceTime: 3 }]);
  await settings(page, 'mlfq', Number.MAX_SAFE_INTEGER);
  await page.getByRole('spinbutton', { name: 'Boost ticks', exact: true }).fill('2');
  await page.locator('.speed-control select').selectOption('850');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (let time = 1; time <= 2; time++) {
    await page.getByRole('button', { name: 'Next time step', exact: true }).click();
    await fits(page);
  }
  await expect(page.getByTestId('cpu-process-card')).toHaveAttribute('data-process-id', 'B');
  await expect(page.getByTestId('ready-queue-0')).toHaveAttribute('data-ready-ids', 'A');
  await expect(page.getByTestId('cpu-process-card').locator('small')).toHaveText(`Q: 0/${Number.MAX_SAFE_INTEGER} · A: 0/${Number.MAX_SAFE_INTEGER}`);
  await page.getByRole('button', { name: 'Previous time step', exact: true }).click();
  await fits(page);
  await expect(page.getByTestId('cpu-process-card')).toHaveAttribute('data-process-id', 'A');
  await expect(page.getByTestId('ready-queue-0')).toHaveAttribute('data-ready-ids', 'B');
  await expect(page.getByTestId('cpu-process-card').locator('small')).toHaveText(`Q: 1/${Number.MAX_SAFE_INTEGER} · A: 1/${Number.MAX_SAFE_INTEGER}`);
  await expect(page.locator('.process-motion-traveler, .process-motion-arrow')).toHaveCount(0);
  await info.attach('wide-budgets-reversed', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

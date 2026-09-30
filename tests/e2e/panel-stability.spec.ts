import { expect, Page, test } from "@playwright/test";

async function geometry(page: Page) {
  return page.locator(".cpu-card, .event-card, .queue-section, .queue-track, .timeline-section").evaluateAll((panels) =>
    panels.map((panel) => {
      const { x, y, width, height } = panel.getBoundingClientRect();
      return { panel: panel.className, x, y, width, height };
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await page.getByRole("button", { name: "Reset to time zero" }).click();
});

test("CPU and waiting panels stay fixed through every policy, empty queues, and completion", async ({ page }) => {
  test.slow();
  await page.getByRole("button", { name: "Metrics", exact: true }).click();
  for (const algorithm of ["fcfs", "sjf", "stcf", "rr", "mlfq"]) {
    await page.locator("#algorithm").selectOption(algorithm);
    await expect(page.locator(".policy-note > span")).toHaveText(`${algorithm.toUpperCase()} rule`);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const before = await geometry(page);
    const count = await page.locator("[data-timeline-time]").count();
    for (let time = 1; time < count; time++) {
      await page.locator(`[data-timeline-time="${time}"]`).click();
      expect(await geometry(page), `${algorithm} at t=${time}`).toEqual(before);
    }
    await page.getByRole("button", { name: "Next time step" }).click();
    await expect(page.getByTestId("time-value")).toHaveText(String(count));
    expect(await geometry(page), `${algorithm} after completion`).toEqual(before);
    await page.getByRole("button", { name: "Previous time step" }).click();
    expect(await geometry(page), `${algorithm} reversing completion`).toEqual(before);
  }
});

test("panel geometry stays fixed during real dispatch, boost, and reverse animations", async ({ page }) => {
  await page.locator("#algorithm").selectOption("mlfq");
  await page.locator('[data-timeline-time="9"]').click();
  const before = await geometry(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".speed-control select").selectOption("850");
  for (const button of ["Next time step", "Previous time step"]) {
    await page.evaluate(() => {
      const samples: unknown[] = [];
      Object.assign(window, { panelAnimationSamples: samples, panelAnimationSampling: true });
      const sample = () => {
        samples.push([...document.querySelectorAll(".cpu-card, .event-card, .queue-section, .queue-track, .timeline-section")].map((panel) => {
          const { x, y, width, height } = panel.getBoundingClientRect();
          return { panel: panel.className, x, y, width, height };
        }));
        if ((window as unknown as { panelAnimationSampling: boolean }).panelAnimationSampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole("button", { name: button }).click();
    await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");
    const samples = await page.evaluate(() => {
      const state = window as unknown as { panelAnimationSamples: unknown[]; panelAnimationSampling: boolean };
      state.panelAnimationSampling = false;
      return state.panelAnimationSamples;
    });
    expect(samples.length).toBeGreaterThan(1);
    for (const sample of samples) expect(sample).toEqual(before);
    expect(await geometry(page)).toEqual(before);
  }
});

test("narrow screens keep CPU and empty waiting queues the same size", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#algorithm").selectOption("mlfq");
  const readSizes = () => page.locator(".cpu-card, .queue-section, .queue-track").evaluateAll((panels) => panels.map((panel) => {
    const { width, height } = panel.getBoundingClientRect();
    return { width, height };
  }));
  const before = await readSizes();
  for (const time of [2, 6, 9, 10, 19]) {
    await page.locator(`[data-timeline-time="${time}"]`).click();
    expect(await readSizes()).toEqual(before);
  }
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("20");
  expect(await readSizes()).toEqual(before);
});

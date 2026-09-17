import { expect, test } from "@playwright/test";

for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720], [1100, 650], [390, 844], [375, 667], [320, 568], [844, 390]]) {
  test(`dashboard fits ${width} × ${height} without scrolling or clipped panels`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const compact = width < 1100 || height < 720;
    if (compact) await page.getByRole("button", { name: "Setup", exact: true }).click();
    await page.locator("#algorithm").selectOption("mlfq");
    if (!compact) await page.locator(".metrics-toggle").click();
    const views = compact ? ["Setup", "CPU", "Queues", "Timeline", "Metrics"] : ["desktop"];
    for (const view of views) {
      if (compact) await page.locator(".view-tabs").getByRole("button", { name: view, exact: true }).click();
      for (const section of view === "Setup" ? ["Policy", "Processes"] : view === "Metrics" && width < 600 ? ["Current state", "Timing"] : [null]) {
        if (section) await page.locator(view === "Setup" ? ".setup-tabs" : ".metrics-tabs").getByRole("button", { name: section, exact: true }).click();
        await expect.poll(() => page.evaluate(() => {
          const selectors = ".setup-panel,.panel-section,.control-strip,.dashboard-grid,.card-surface,.cpu-card,.event-card,.event-list,.queue-track,.queue-row,.metrics-scroll,.timeline-scroll,.status-grid";
          return [...document.querySelectorAll<HTMLElement>(selectors)]
            .filter((el) => el.getClientRects().length)
            .filter((el) => el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)
            .map((el) => el.className);
        }), { message: `${view} / ${section}: no clipped panel contents` }).toEqual([]);
        expect(await page.evaluate(() => ({
          width: document.documentElement.scrollWidth <= innerWidth,
          height: document.documentElement.scrollHeight <= innerHeight,
          scrollable: [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => el.getClientRects().length && ["auto", "scroll"].some((value) => getComputedStyle(el).overflowX === value && el.scrollWidth > el.clientWidth + 2 || getComputedStyle(el).overflowY === value && el.scrollHeight > el.clientHeight + 2)).map((el) => el.className),
        }))).toEqual({ width: true, height: true, scrollable: [] });
      }
    }
  });
}

test("50 processes with long IDs fit the compact desktop layout", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator(".json-panel summary").click();
  await page.getByLabel("Scenario JSON").fill(JSON.stringify({ processes: Array.from({ length: 50 }, (_, index) => ({ id: `JOB${String(index).padStart(3, "0")}`, arrivalTime: 0, serviceTime: 20 })) }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#algorithm").selectOption("mlfq");
  await page.locator(".metrics-toggle").click();
  const clipped = await page.locator(".setup-panel,.card-surface,.event-list,.queue-track,.queue-row,.queue-label,.queue-chip,.metrics-scroll,.timeline-scroll,.pagination,.tick-block").evaluateAll((elements) => elements.filter((el) => el.getClientRects().length && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)).map((el) => el.className));
  expect(clipped).toEqual([]);
  await expect(page.getByRole("button", { name: "Next metrics page", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Next timeline page", exact: true })).toBeEnabled();
});

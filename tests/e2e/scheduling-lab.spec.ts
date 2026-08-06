import { expect, Page, test } from "@playwright/test";

const lecture = [
  { id: "A", arrival: 0, service: 3 },
  { id: "B", arrival: 2, service: 6 },
  { id: "C", arrival: 4, service: 4 },
  { id: "D", arrival: 6, service: 5 },
  { id: "E", arrival: 8, service: 2 },
];

const lectureTraces = {
  fcfs: "AAABBBBBBCCCCDDDDDEE",
  sjf: "AAABBBBBBEECCCCDDDDD",
  stcf: "AAABCCCCEEBBBBBDDDDD",
  rr: "AABBACCBBDDCCEEBBDDD",
  mlfq: "AABBCCDDEEABBCCDDBBD",
} as const;

function expectedStateAt(trace: string, time: number) {
  return lecture.map((process) => {
    const executed = [...trace.slice(0, time)].filter((id) => id === process.id).length;
    const remaining = process.service - executed;
    const state = time < process.arrival
      ? "new"
      : remaining === 0
        ? "finished"
        : trace[time] === process.id
          ? "running"
          : "ready";
    return { ...process, remaining, state };
  });
}

async function assertBoundary(page: Page, trace: string, time: number) {
  const expected = expectedStateAt(trace, time);
  const dashboard = page.locator(".dashboard-grid");
  await expect(page.getByTestId("time-value")).toHaveText(String(time));
  await expect(dashboard).toHaveAttribute("data-snapshot-time", String(time));
  await expect(dashboard).toHaveAttribute("data-running-process", trace[time] ?? "");

  const counts = page.getByTestId("state-counts");
  await expect(counts).toHaveAttribute("data-new-count", String(expected.filter((process) => process.state === "new").length));
  await expect(counts).toHaveAttribute("data-ready-count", String(expected.filter((process) => process.state === "ready").length));
  await expect(counts).toHaveAttribute("data-finished-count", String(expected.filter((process) => process.state === "finished").length));

  const readyIds = await page.locator('[data-testid^="ready-queue-"]').evaluateAll((queues) =>
    queues.flatMap((queue) => (queue.getAttribute("data-ready-ids") ?? "").split(",").filter(Boolean)).sort(),
  );
  expect(readyIds).toEqual(expected.filter((process) => process.state === "ready").map((process) => process.id).sort());

  const activeTicks = page.locator(".timeline-cell.active");
  await expect(activeTicks).toHaveCount(time < trace.length ? 1 : 0);
  if (time < trace.length) {
    await expect(activeTicks).toHaveAttribute("data-timeline-time", String(time));
    await expect(activeTicks).toHaveAttribute("data-process-id", trace[time]);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Scheduling Studio" })).toBeVisible();
  // A real interaction proves that the client bundle is hydrated before the
  // test starts making scheduling assertions.
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await page.getByRole("button", { name: "Reset to time zero" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("0");
});

test("every lecture policy renders every CPU boundary and state exactly", async ({ page }) => {
  for (const [algorithm, trace] of Object.entries(lectureTraces)) {
    await page.locator("#algorithm").selectOption(algorithm);
    const timeline = page.locator("[data-timeline-time]");
    await expect(timeline).toHaveCount(trace.length);
    expect(await timeline.evaluateAll((ticks) => ticks.map((tick) => tick.getAttribute("data-process-id") ?? "").join(""))).toBe(trace);

    for (let time = 0; time <= trace.length; time += 1) {
      await assertBoundary(page, trace, time);
      if (time < trace.length) await page.getByRole("button", { name: "Next time step" }).click();
    }
    await expect(page.getByRole("button", { name: "Next time step" })).toBeDisabled();
  }
});

test("playback, keyboard stepping, reset, and timeline inspection stay synchronized", async ({ page }) => {
  await page.locator("#algorithm").selectOption("rr");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("time-value")).toHaveText("0");

  await page.locator('[data-timeline-time="7"]').click();
  await assertBoundary(page, lectureTraces.rr, 7);
  await page.getByRole("button", { name: "Reset to time zero" }).click();
  await assertBoundary(page, lectureTraces.rr, 0);

  await page.locator('[data-timeline-time="19"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();
  await assertBoundary(page, lectureTraces.rr, 20);
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause simulation" })).toBeVisible();
  await expect(page.getByTestId("time-value")).toHaveText("0");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play simulation" })).toBeVisible();
});

test("a priority boost never renews the running Q0 Round Robin turn", async ({ page }) => {
  await page.locator("#algorithm").selectOption("mlfq");
  await expect(page.getByText("Quantum (= allotment) per queue", { exact: true })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("3");

  const trace = await page.locator("[data-timeline-time]").evaluateAll((ticks) =>
    ticks.map((tick) => tick.getAttribute("data-process-id") ?? "").join(""),
  );
  expect(trace).toBe("AABBACCBBDDEECCBBDDD");

  const boostTicks = page.locator('[data-boost-boundary="true"]');
  await expect(boostTicks).toHaveCount(6);
  expect(await boostTicks.evaluateAll((ticks) => ticks.map((tick) => tick.getAttribute("data-timeline-time")))).toEqual([
    "3", "6", "9", "12", "15", "18",
  ]);
  await expect(page.locator('[data-timeline-time="3"] .boost-marker')).toHaveText("BOOST");

  await page.locator('[data-timeline-time="3"]').click();
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-running-process", "B");
  await expect(page.locator(".running-content")).toContainText("Q0 · 1/2 used");
  const runningMapChip = page.locator(".running-queue-chip");
  await expect(runningMapChip).toHaveCount(1);
  await expect(runningMapChip).toHaveAttribute("data-process-id", "B");
  await expect(runningMapChip).toHaveAttribute("data-queue-level", "0");
  await expect(runningMapChip).toHaveAttribute("data-remaining", "5");
  await expect(runningMapChip).toHaveAttribute("data-allotment-used", "1");
  await expect(runningMapChip).toContainText("ON CPU");
  await expect(runningMapChip).toContainText("5 left · 1/2 used");
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "A");
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-running-id", "B");
  await expect(page.getByTestId("event-list")).toContainText(
    "B's in-progress Q0 allotment was preserved",
  );

  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-running-process", "A");
  await expect(page.getByTestId("ready-queue-1")).toHaveAttribute("data-ready-ids", "B");
  await expect(page.getByTestId("event-list")).toContainText(
    "B used its full allotment and moved from Q0 to Q1",
  );
});

test("invalid edits never leave stale visualization data on screen", async ({ page }) => {
  await page.getByLabel("Process 2 ID").fill("A");
  await expect(page.locator(".validation-message")).toContainText("Process IDs must be unique");
  await expect(page.getByRole("heading", { name: "Check the scenario" })).toBeVisible();
  await expect(page.locator(".dashboard-grid")).toHaveCount(0);

  await page.getByLabel("Process 2 ID").fill("B");
  await expect(page.locator(".dashboard-grid")).toBeVisible();
  await expect(page.getByTestId("time-value")).toHaveText("0");
});

test("large imported scenarios keep all MLFQ queues, events, metrics, and ticks accessible", async ({ page }) => {
  const processes = Array.from({ length: 12 }, (_, index) => ({
    id: `P${index}`,
    arrivalTime: 0,
    serviceTime: 3,
  }));
  await page.locator(".json-panel summary").click();
  await page.getByLabel("Scenario JSON").fill(JSON.stringify({ processes }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Loaded 12 processes.")).toBeVisible();
  await page.locator("#algorithm").selectOption("mlfq");

  await expect(page.locator(".process-row")).toHaveCount(12);
  await expect(page.locator(".queue-row")).toHaveCount(3);
  await expect(page.locator("[data-timeline-time]")).toHaveCount(36);
  await expect(page.locator(".event-list p")).toHaveCount(13);
  await expect(page.getByTestId("state-counts")).toHaveAttribute("data-ready-count", "11");

  const overflow = await page.evaluate(() => {
    const eventList = document.querySelector<HTMLElement>(".event-list")!;
    const timeline = document.querySelector<HTMLElement>(".timeline-scroll")!;
    const firstQueue = document.querySelector<HTMLElement>(".queue-track")!;
    return {
      eventScrollable: eventList.scrollHeight > eventList.clientHeight && getComputedStyle(eventList).overflowY === "auto",
      timelineScrollable: timeline.scrollWidth > timeline.clientWidth && getComputedStyle(timeline).overflowX === "auto",
      queueOverflowIsSafe: getComputedStyle(firstQueue).overflowX === "auto",
      pageDoesNotVerticallyScroll: document.documentElement.scrollHeight <= window.innerHeight + 1,
    };
  });
  expect(overflow).toEqual({
    eventScrollable: true,
    timelineScrollable: true,
    queueOverflowIsSafe: true,
    pageDoesNotVerticallyScroll: true,
  });

  const queueSection = await page.locator(".queue-section").boundingBox();
  expect(queueSection).not.toBeNull();
  for (const row of await page.locator(".queue-row").all()) {
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(queueSection!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(queueSection!.y + queueSection!.height + 1);
  }

  await page.getByRole("button", { name: "Metrics", exact: true }).click();
  await expect(page.locator("tr[data-process-id]")).toHaveCount(12);
  const metricsOverflowIsSafe = await page.locator(".metrics-scroll").evaluate((element) =>
    getComputedStyle(element).overflowY === "auto",
  );
  expect(metricsOverflowIsSafe).toBe(true);
});

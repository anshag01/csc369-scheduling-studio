import { expect, Page, test } from "@playwright/test";

async function importScenario(page: Page, processes: Array<{ id: string; arrivalTime: number; serviceTime: number }>) {
  const details = page.locator(".json-panel");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
  await page.getByLabel("Scenario JSON").fill(JSON.stringify({ processes }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
}

type PhaseObservation = {
  cpu: string;
  queues: string[];
  newCount: string;
  travelers: Array<{ id: string; from: string; to: string; rect: DOMRect }>;
  cards: Array<{ id: string; rect: DOMRect }>;
};

async function expectPhase(page: Page, action: string, index: number, count: number) {
  const handle = await page.waitForFunction(({ expectedAction, expectedIndex, expectedCount }) => {
    const dashboard = document.querySelector<HTMLElement>(".dashboard-grid");
    if (
      dashboard?.dataset.motionStatus !== "playing" ||
      dashboard.dataset.motionPhase !== expectedAction ||
      dashboard.dataset.motionPhaseIndex !== String(expectedIndex) ||
      dashboard.dataset.motionPhaseCount !== String(expectedCount) ||
      dashboard.dataset.motionPhaseState !== "moving" ||
      document.querySelectorAll(".process-motion-arrow").length !== 1
    ) return null;
    return {
      cpu: document.querySelector<HTMLElement>('[data-testid="cpu-process-card"]')?.dataset.processId ?? "",
      queues: [...document.querySelectorAll<HTMLElement>('[data-testid^="ready-queue-"]')]
        .map((queue) => queue.dataset.readyIds ?? ""),
      newCount: document.querySelector<HTMLElement>('[data-testid="state-counts"]')?.dataset.newCount ?? "",
      travelers: [...document.querySelectorAll<HTMLElement>(".process-motion-traveler")].map((traveler) => ({
        id: traveler.dataset.processId ?? "",
        from: traveler.dataset.motionFrom ?? "",
        to: traveler.dataset.motionTo ?? "",
        rect: traveler.getBoundingClientRect().toJSON(),
      })),
      cards: [...document.querySelectorAll<HTMLElement>("[data-motion-id]")].map((card) => ({
        id: card.dataset.motionId ?? "",
        rect: card.getBoundingClientRect().toJSON(),
      })),
    };
  }, { expectedAction: action, expectedIndex: index, expectedCount: count });
  const observation = await handle.jsonValue() as PhaseObservation;
  await handle.dispose();
  return observation;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Scheduling Studio" })).toBeVisible();
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await page.getByRole("button", { name: "Reset to time zero" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("0");
});

test("compound MLFQ boundaries expose every authoritative forward and reverse phase", async ({ page }) => {
  await importScenario(page, [
    { id: "A", arrivalTime: 0, serviceTime: 6 },
    { id: "X", arrivalTime: 0, serviceTime: 3 },
    { id: "B", arrivalTime: 2, serviceTime: 2 },
  ]);
  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("spinbutton", { name: "Q0" }).fill("2");
  await page.getByRole("spinbutton", { name: "Q1" }).fill("4");
  await page.getByRole("spinbutton", { name: "Q2" }).fill("8");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("2");
  await page.locator(".speed-control select").selectOption("2000");
  await page.locator('[data-timeline-time="1"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();

  const demote = await expectPhase(page, "demote", 0, 4);
  expect(demote.cpu).toBe("");
  expect(demote.queues).toEqual(["X", "A", ""]);
  expect(demote.travelers.find((traveler) => traveler.id === "A")).toMatchObject({ from: "cpu", to: "q1" });

  const boost = await expectPhase(page, "boost", 1, 4);
  expect(boost.queues).toEqual(["X,A", "", ""]);
  expect(boost.travelers.find((traveler) => traveler.id === "A")?.to).toBe("q0");

  const arrive = await expectPhase(page, "arrive", 2, 4);
  expect(arrive.queues).toEqual(["X,A,B", "", ""]);
  expect(arrive.travelers.find((traveler) => traveler.id === "B")?.from).toBe("future");

  const dispatch = await expectPhase(page, "dispatch", 3, 4);
  expect(dispatch.cpu).toBe("X");
  expect(dispatch.queues).toEqual(["A,B", "", ""]);
  expect(dispatch.travelers.find((traveler) => traveler.id === "X")?.to).toBe("cpu");
  const overlapSample = await page.evaluate(async () => {
    const overlapRatio = (left: DOMRect, right: DOMRect) => {
      const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
      const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      return width * height / Math.min(left.width * left.height, right.width * right.height);
    };
    let maximum = 0;
    let count = 0;
    while (document.querySelector(".dashboard-grid")?.getAttribute("data-motion-phase") === "dispatch") {
      const traveler = document.querySelector<HTMLElement>('.process-motion-traveler[data-process-id="X"]');
      const follower = document.querySelector<HTMLElement>('[data-motion-id="A"]');
      if (traveler && follower) {
        maximum = Math.max(maximum, overlapRatio(traveler.getBoundingClientRect(), follower.getBoundingClientRect()));
        count += 1;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }
    return { maximum, count };
  });
  expect(overlapSample.count).toBeGreaterThan(0);
  expect(overlapSample.maximum).toBeLessThan(0.01);
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");

  await page.getByRole("button", { name: "Previous time step" }).click();
  const undoDispatch = await expectPhase(page, "dispatch", 0, 4);
  expect(undoDispatch.cpu).toBe("");
  expect(undoDispatch.queues).toEqual(["X,A,B", "", ""]);

  const undoArrival = await expectPhase(page, "arrive", 1, 4);
  expect(undoArrival.queues).toEqual(["X,A", "", ""]);
  expect(undoArrival.newCount).toBe("1");

  const undoBoost = await expectPhase(page, "boost", 2, 4);
  expect(undoBoost.queues).toEqual(["X", "A", ""]);

  const undoDemote = await expectPhase(page, "demote", 3, 4);
  expect(undoDemote.cpu).toBe("A");
  expect(undoDemote.queues).toEqual(["X", "", ""]);
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");
});

test("rapid buttons and keys cannot skip a boundary", async ({ page }) => {
  const next = page.getByRole("button", { name: "Next time step" });
  await next.evaluate((button) => {
    (button as HTMLElement).click();
    (button as HTMLElement).click();
  });
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-boundary", "0->1");

  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  await expect(page.getByTestId("time-value")).toHaveText("2");
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-boundary", "1->2");
  await expect(next).toBeDisabled();
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");
  await expect(page.getByTestId("time-value")).toHaveText("2");
});

test("a redispatched card visibly reaches the real queue before returning to the CPU", async ({ page }) => {
  await importScenario(page, [{ id: "A", arrivalTime: 0, serviceTime: 4 }]);
  await page.locator("#algorithm").selectOption("rr");
  await page.getByRole("spinbutton", { name: "Time quantum" }).fill("1");
  await page.getByRole("button", { name: "Next time step" }).click();

  await expectPhase(page, "rotate", 0, 2);
  await page.waitForTimeout(600);
  const rotationGeometry = await page.evaluate(() => {
    const traveler = document.querySelector<HTMLElement>('.process-motion-traveler[data-process-id="A"]')!;
    const queue = document.querySelector<HTMLElement>('[data-testid="ready-queue-0"]')!;
    const card = traveler.getBoundingClientRect();
    const track = queue.getBoundingClientRect();
    const centerX = card.left + card.width / 2;
    const centerY = card.top + card.height / 2;
    return {
      insideQueue: centerX >= track.left && centerX <= track.right && centerY >= track.top && centerY <= track.bottom,
      width: card.width,
      height: card.height,
      transforms: traveler.getAnimations().flatMap((animation) =>
        (animation.effect as KeyframeEffect).getKeyframes().map((frame) => String(frame.transform ?? "")),
      ),
    };
  });
  expect(rotationGeometry.insideQueue).toBe(true);
  expect(rotationGeometry.transforms.every((transform) => !transform.includes("scale"))).toBe(true);

  await expectPhase(page, "dispatch", 1, 2);
  await expect(page.locator('.process-motion-traveler[data-process-id="A"]')).toHaveAttribute("data-motion-from", "ready");
  await expect(page.locator('.process-motion-traveler[data-process-id="A"]')).toHaveAttribute("data-motion-to", "cpu");
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "A");
  expect(rotationGeometry.width).toBeGreaterThan(80);
  expect(rotationGeometry.height).toBeGreaterThan(40);
});

test("simultaneous arrivals use separate staging lanes and preserve queue order", async ({ page }) => {
  await importScenario(page, [
    { id: "A", arrivalTime: 0, serviceTime: 5 },
    { id: "B", arrivalTime: 2, serviceTime: 1 },
    { id: "C", arrivalTime: 2, serviceTime: 1 },
    { id: "D", arrivalTime: 2, serviceTime: 1 },
  ]);
  await page.locator("#algorithm").selectOption("fcfs");
  await page.locator('[data-timeline-time="1"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();

  await expectPhase(page, "arrive", 0, 1);
  const rectangles = await page.locator('.process-motion-traveler[data-motion-action="arrive"]').evaluateAll((travelers) =>
    travelers.map((traveler) => traveler.getBoundingClientRect().toJSON()),
  );
  expect(rectangles).toHaveLength(3);
  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
      const left = rectangles[leftIndex];
      const right = rectangles[rightIndex];
      const overlapWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
      const overlapHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      expect(overlapWidth * overlapHeight).toBe(0);
    }
  }
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "B,C,D");
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "A");
});

test("RR and STCF expose their policy-specific same-boundary phase order", async ({ page }) => {
  await importScenario(page, [
    { id: "A", arrivalTime: 0, serviceTime: 4 },
    { id: "B", arrivalTime: 2, serviceTime: 1 },
  ]);
  await page.locator("#algorithm").selectOption("rr");
  await page.getByRole("spinbutton", { name: "Time quantum" }).fill("2");
  await page.locator('[data-timeline-time="1"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();
  await expectPhase(page, "arrive", 0, 3);
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "A");
  await expect(page.locator('[data-motion-id="A"]')).toHaveCount(1);
  await expectPhase(page, "rotate", 1, 3);
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "B,A");
  await expectPhase(page, "dispatch", 2, 3);
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "B");
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");

  await importScenario(page, [
    { id: "A", arrivalTime: 0, serviceTime: 5 },
    { id: "B", arrivalTime: 2, serviceTime: 1 },
  ]);
  await page.locator("#algorithm").selectOption("stcf");
  await page.locator('[data-timeline-time="1"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();
  await expectPhase(page, "arrive", 0, 3);
  await expectPhase(page, "preempt", 1, 3);
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "B,A");
  await expectPhase(page, "dispatch", 2, 3);
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "B");
});

test("a protected running MLFQ process stays fixed while waiting work is boosted", async ({ page }) => {
  await importScenario(page, [
    { id: "A", arrivalTime: 0, serviceTime: 10 },
    { id: "B", arrivalTime: 0, serviceTime: 5 },
  ]);
  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("spinbutton", { name: "Q0" }).fill("1");
  await page.getByRole("spinbutton", { name: "Q1" }).fill("4");
  await page.getByRole("spinbutton", { name: "Q2" }).fill("8");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("4");
  await page.locator('[data-timeline-time="3"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();

  await expectPhase(page, "boost", 0, 1);
  const during = await page.getByTestId("cpu-process-card").evaluate((card) => ({
    id: card.getAttribute("data-process-id"),
    queue: card.getAttribute("data-queue-level"),
    used: card.getAttribute("data-allotment-used"),
    rect: card.getBoundingClientRect().toJSON(),
  }));
  expect(during.id).toBe("A");
  expect(during.queue).toBe("1");
  await expect(page.locator('.process-motion-traveler[data-process-id="A"]')).toHaveCount(0);
  await expect(page.locator('.process-motion-traveler[data-process-id="B"]')).toHaveCount(1);

  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");
  const after = await page.getByTestId("cpu-process-card").evaluate((card) => ({
    id: card.getAttribute("data-process-id"),
    queue: card.getAttribute("data-queue-level"),
    used: card.getAttribute("data-allotment-used"),
    rect: card.getBoundingClientRect().toJSON(),
  }));
  expect(after).toEqual(during);
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "B");
});

test("reduced motion snaps to the final state without travelers or a playback lock", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await importScenario(page, [
    { id: "A", arrivalTime: 0, serviceTime: 6 },
    { id: "X", arrivalTime: 0, serviceTime: 3 },
    { id: "B", arrivalTime: 2, serviceTime: 2 },
  ]);
  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("spinbutton", { name: "Q0" }).fill("2");
  await page.getByRole("spinbutton", { name: "Q1" }).fill("4");
  await page.getByRole("spinbutton", { name: "Q2" }).fill("8");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("2");
  await page.locator('[data-timeline-time="1"]').click();
  await page.locator(".dashboard-grid").evaluate((dashboard) => {
    const state = window as Window & { __motionPhases?: string[] };
    state.__motionPhases = [];
    dashboard.addEventListener("scheduling-motion-phase", (event) => {
      state.__motionPhases?.push((event as CustomEvent<{ action: string }>).detail.action);
    });
  });
  await page.getByRole("button", { name: "Next time step" }).click();

  const dashboard = page.locator(".dashboard-grid");
  await expect(dashboard).toHaveAttribute("data-motion-status", "idle");
  await expect(dashboard).toHaveAttribute("data-motion-phase-count", "4");
  expect(await page.evaluate(() => (window as Window & { __motionPhases?: string[] }).__motionPhases)).toEqual([
    "demote", "boost", "arrive", "dispatch",
  ]);
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "X");
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "A,B");
  await expect(page.locator(".process-motion-traveler, .process-motion-arrow, [data-motion-hidden]" )).toHaveCount(0);
  await expect(page.locator(".motion-cue")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next time step" })).toBeEnabled();
});

test("the final autoplay animation cannot be aborted by Play or Space", async ({ page }) => {
  await importScenario(page, [{ id: "A", arrivalTime: 0, serviceTime: 1 }]);
  await page.locator("#algorithm").selectOption("fcfs");
  await page.locator(".speed-control select").selectOption("850");
  await page.getByRole("button", { name: "Play simulation" }).click();

  const dashboard = page.locator(".dashboard-grid");
  await expect(dashboard).toHaveAttribute("data-motion-phase", "finish");
  const restart = page.getByRole("button", { name: "Play simulation" });
  await expect(restart).toBeDisabled();
  await expect(page.locator('.process-motion-traveler[data-process-id="A"]')).toHaveCount(1);
  await restart.evaluate((button) => (button as HTMLButtonElement).click());
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await expect(dashboard).toHaveAttribute("data-motion-status", "idle");
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await expect(page.locator(".process-motion-traveler, .process-motion-arrow, [data-motion-hidden]")).toHaveCount(0);
});

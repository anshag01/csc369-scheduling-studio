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
  await expect(page.getByRole("main", { name: "Scheduling Studio" })).toBeVisible();
  // A real interaction proves that the client bundle is hydrated before the
  // test starts making scheduling assertions.
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await page.getByRole("button", { name: "Reset to time zero" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("0");
});

test("every lecture policy renders every CPU boundary and state exactly", async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
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

test("the running process appears only on the CPU for every policy", async ({ page }) => {
  for (const algorithm of ["fcfs", "sjf", "stcf", "rr", "mlfq"] as const) {
    await page.locator("#algorithm").selectOption(algorithm);
    await page.getByRole("button", { name: "Next time step" }).click();

    const cpuProcessCard = page.getByTestId("cpu-process-card");
    await expect(cpuProcessCard).toHaveCount(1);
    await expect(cpuProcessCard).toHaveAttribute("data-process-id", "A");
    await expect(cpuProcessCard).toHaveAttribute("data-state", "running");
    await expect(cpuProcessCard).toHaveAttribute("data-motion-place", "cpu");
    await expect(cpuProcessCard).toHaveAttribute("data-queue-level", "0");
    await expect(cpuProcessCard).toHaveAttribute("data-remaining", "2");
    await expect(cpuProcessCard).toContainText("A");
    await expect(cpuProcessCard).toContainText("2 left");
    await expect(cpuProcessCard).not.toContainText("ON CPU");
    await expect(page.locator(".cpu-process-copy")).toContainText("2 ticks remaining");
    await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "");
    await expect(page.locator('.queue-track [data-state="running"]')).toHaveCount(0);

    if (algorithm === "rr") {
      await expect(cpuProcessCard).toHaveAttribute("data-quantum-used", "1");
      await expect(page.locator(".cpu-process-copy")).toContainText("1/2 quantum used");
    } else if (algorithm === "mlfq") {
      await expect(cpuProcessCard).toHaveAttribute("data-allotment-used", "1");
      await expect(cpuProcessCard).toContainText("Q0 · 1/2");
      await expect(page.locator(".cpu-process-copy")).toContainText("1/2 allotment used");
    }

    const clippedTokenText = await cpuProcessCard.locator("strong, span, small").evaluateAll((items) =>
      items.some((item) => item.scrollWidth > item.clientWidth + 1),
    );
    expect(clippedTokenText).toBe(false);
  }
});

test("CPU and ready process cards keep identical geometry", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".json-panel summary").click();
  await page.getByLabel("Scenario JSON").fill(JSON.stringify({
    processes: [
      { id: "A", arrivalTime: 0, serviceTime: 4 },
      { id: "B", arrivalTime: 0, serviceTime: 4 },
    ],
  }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Next time step" }).click();

  const geometry = await page.locator('[data-motion-id="A"], [data-motion-id="B"]').evaluateAll((cards) =>
    Object.fromEntries(cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return [card.getAttribute("data-motion-place"), { width: rect.width, height: rect.height }];
    })),
  );
  expect(geometry.cpu).toEqual(geometry.ready);

  await expect(page.locator('.cpu-card > [data-testid="completion-dock"]')).toHaveCount(1);
  await expect(page.locator('.event-card [data-testid="completion-dock"]')).toHaveCount(0);
  const completionPlacement = await page.locator(".cpu-card").evaluate((cpu) => {
    const cpuRect = cpu.getBoundingClientRect();
    const copyRect = cpu.querySelector<HTMLElement>(".cpu-process-copy")!.getBoundingClientRect();
    const dockRect = cpu.querySelector<HTMLElement>(".completion-dock")!.getBoundingClientRect();
    return {
      toRightOfCopy: dockRect.left >= copyRect.right,
      insideCpu: dockRect.left >= cpuRect.left && dockRect.right <= cpuRect.right && dockRect.top >= cpuRect.top && dockRect.bottom <= cpuRect.bottom,
    };
  });
  expect(completionPlacement).toEqual({ toRightOfCopy: true, insideCpu: true });
});

test("process cards animate every scheduler transfer and reverse step without duplicates", async ({ page }) => {
  await page.locator("#algorithm").selectOption("rr");
  await page.locator(".json-panel summary").click();
  await page.getByLabel("Scenario JSON").fill(JSON.stringify({
    processes: [
      { id: "A", arrivalTime: 0, serviceTime: 4 },
      { id: "B", arrivalTime: 0, serviceTime: 4 },
    ],
  }));
  await page.getByRole("button", { name: "Import", exact: true }).click();

  await page.locator('[data-timeline-time="1"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();
  const dashboard = page.locator(".dashboard-grid");
  await expect(dashboard).toHaveAttribute("data-last-motion-count", "2");
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /ready->cpu/);
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /cpu->ready/);
  await expect(dashboard).toHaveAttribute("data-last-motion-labels", /quantum expired A/);
  await expect(dashboard).toHaveAttribute("data-last-motion-labels", /dispatch B/);
  await expect(page.locator('[data-motion-id="A"]')).toHaveCount(1);
  await expect(page.locator('[data-motion-id="B"]')).toHaveCount(1);
  await expect(dashboard).toHaveAttribute("data-motion-status", "idle");
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "B");
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "A");
  await expect(page.locator(".process-motion-traveler, .process-motion-arrow, [data-motion-hidden]")).toHaveCount(0);
  await page.getByRole("button", { name: "Previous time step" }).click();
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /ready->cpu/);
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /cpu->ready/);
  await expect(page.locator('[data-motion-id="A"]')).toHaveCount(1);
  await expect(page.locator('[data-motion-id="B"]')).toHaveCount(1);
  await expect(dashboard).toHaveAttribute("data-motion-direction", "backward");
  await expect(dashboard).toHaveAttribute("data-motion-status", "idle");
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "A");
});

test("busy MLFQ boundaries move process cards through exact intermediate states behind static guides", async ({ page }) => {
  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("10");
  await page.locator('[data-timeline-time="9"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();

  await expect(page.locator(".motion-cue")).toContainText("finish E → completed");
  expect(await page.locator('.process-motion-arrow[data-motion-action="finish"]').evaluate((arrow) =>
    arrow.getAnimations({ subtree: true }).length,
  )).toBe(0);

  await expect(page.locator(".motion-cue")).toContainText("priority boost A, B, C, D → Q0", { timeout: 5_000 });
  const boostArrow = page.locator('.process-motion-arrow[data-motion-action="boost"]');
  await expect(boostArrow).toHaveCount(1);
  await expect(boostArrow).toHaveAttribute("data-motion-detail", /priority boost A, B, C, D → Q0/);
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "A,B,C,D");
  await expect(page.locator(".motion-cue")).toContainText("dispatch A → CPU", { timeout: 5_000 });
  await expect(page.locator('.process-motion-traveler[data-process-id="A"]')).toHaveCount(1);
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "B,C,D");
  expect(await page.locator('.process-motion-arrow[data-motion-action="dispatch"]').evaluate((arrow) =>
    arrow.getAnimations({ subtree: true }).length,
  )).toBe(0);
});

test("completion and MLFQ boosts have complete, destination-based animations", async ({ page }) => {
  const json = page.getByLabel("Scenario JSON");
  await page.locator(".json-panel summary").click();
  await json.fill(JSON.stringify({ processes: [{ id: "A", arrivalTime: 0, serviceTime: 1 }] }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-last-motion-types", "cpu->finished");
  await expect(page.locator('.process-motion-arrow[data-motion-action="finish"]')).toHaveAttribute("data-motion-detail", /finish A → completed/);
  await expect(page.locator(".motion-cue")).toContainText("finish A → completed");
  await expect(page.getByTestId("completion-dock")).toHaveAttribute("data-completed-count", "1");
  await expect(page.getByTestId("completion-dock")).toContainText("COMPLETED");
  const completionMotion = page.locator('.process-motion-traveler.process-completing[data-motion-destination="completed"]');
  await expect(completionMotion).toHaveCount(1);
  const completionKeyframes = await completionMotion.evaluate((card) =>
    card.getAnimations().flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes()).map((frame) => ({
      opacity: Number(frame.opacity),
      transform: String(frame.transform ?? ""),
    })),
  );
  expect(completionKeyframes.at(-1)?.opacity).toBeLessThan(.1);
  expect(completionKeyframes.every(({ transform }) => !transform.includes("scale"))).toBe(true);
  await expect(page.locator(".process-motion-arrow")).toHaveCount(0, { timeout: 3_000 });
  await expect(page.locator(".process-motion-ghost")).toHaveCount(0);
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");

  await page.locator(".json-panel summary").click();
  await json.fill(JSON.stringify({
    processes: [
      { id: "A", arrivalTime: 0, serviceTime: 10 },
      { id: "B", arrivalTime: 0, serviceTime: 5 },
    ],
  }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("spinbutton", { name: "Q0" }).fill("1");
  await page.getByRole("spinbutton", { name: "Q1" }).fill("4");
  await page.getByRole("spinbutton", { name: "Q2" }).fill("8");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("4");
  await page.locator('[data-timeline-time="3"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();

  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "A");
  await expect(page.locator(".cpu-process-copy")).toContainText("Q1 · 2/4 allotment used");
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "B");
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-last-motion-types", /q1->q0/);
  await expect(page.locator('.process-motion-arrow[data-motion-action="boost"][data-motion-process-id="B"]')).toHaveAttribute("data-motion-detail", /priority boost B → Q0/);
  await expect(page.locator(".motion-cue")).toContainText("priority boost B → Q0");
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");
  while (!(await page.getByTestId("event-list").innerText()).includes("A remained on the CPU in Q1")) {
    await page.getByRole("button", { name: "Next events page", exact: true }).click();
  }
  await expect(page.getByTestId("event-list")).toContainText("A remained on the CPU in Q1");
});

test("MLFQ demotion and higher-priority preemption animate to their exact destinations", async ({ page }) => {
  await page.locator(".json-panel summary").click();
  await page.getByLabel("Scenario JSON").fill(JSON.stringify({
    processes: [
      { id: "A", arrivalTime: 0, serviceTime: 8 },
      { id: "C", arrivalTime: 0, serviceTime: 4 },
    ],
  }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("spinbutton", { name: "Q0" }).fill("2");
  await page.getByRole("spinbutton", { name: "Q1" }).fill("4");
  await page.getByRole("spinbutton", { name: "Q2" }).fill("8");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("100");

  await page.locator('[data-timeline-time="1"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();
  const dashboard = page.locator(".dashboard-grid");
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /cpu->q1/);
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /q0->cpu/);
  await expect(page.locator('.process-motion-arrow[data-motion-action="demote"][data-motion-process-id="A"]')).toHaveAttribute("data-motion-detail", /demote A → Q1/);
  await expect(dashboard).toHaveAttribute("data-motion-phase", "dispatch", { timeout: 5_000 });
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"][data-motion-process-id="C"]')).toHaveAttribute("data-motion-detail", /dispatch C → CPU/);
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "C");
  await expect(page.getByTestId("ready-queue-1")).toHaveAttribute("data-ready-ids", "A");
  await expect(dashboard).toHaveAttribute("data-motion-status", "idle");

  await page.locator(".json-panel summary").click();
  await page.getByLabel("Scenario JSON").fill(JSON.stringify({
    processes: [
      { id: "A", arrivalTime: 0, serviceTime: 8 },
      { id: "B", arrivalTime: 2, serviceTime: 1 },
    ],
  }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Q0" }).fill("1");
  await page.locator('[data-timeline-time="1"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /cpu->q1/);
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /future->q0/);
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /q0->cpu/);
  await expect(page.locator('.process-motion-arrow[data-motion-action="arrive"][data-motion-process-id="B"]')).toHaveAttribute("data-motion-detail", /arrive B → Q0/);
  await expect(dashboard).toHaveAttribute("data-motion-phase", "preempt", { timeout: 5_000 });
  await expect(page.locator('.process-motion-arrow[data-motion-action="preempt"][data-motion-process-id="A"]')).toHaveAttribute("data-motion-detail", /preempt A → Q1/);
  await expect(dashboard).toHaveAttribute("data-motion-phase", "dispatch", { timeout: 5_000 });
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"][data-motion-process-id="B"]')).toHaveAttribute("data-motion-detail", /dispatch B → CPU/);
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "B");
  await expect(page.getByTestId("ready-queue-1")).toHaveAttribute("data-ready-ids", "A");
  await expect(page.getByTestId("event-list")).toContainText("A was preempted by a process in a higher-priority queue");
  await expect(page.locator('[data-motion-id="A"]')).toHaveCount(1);
  await expect(page.locator('[data-motion-id="B"]')).toHaveCount(1);
});

test("an immediately redispatched process still shows its intermediate queue movement", async ({ page }) => {
  await page.locator(".json-panel summary").click();
  await page.getByLabel("Scenario JSON").fill(JSON.stringify({
    processes: [{ id: "A", arrivalTime: 0, serviceTime: 5 }],
  }));
  await page.getByRole("button", { name: "Import", exact: true }).click();

  await page.locator("#algorithm").selectOption("rr");
  await page.getByRole("spinbutton", { name: "Time quantum" }).fill("1");
  await page.getByRole("button", { name: "Next time step" }).click();
  const dashboard = page.locator(".dashboard-grid");
  await expect(dashboard).toHaveAttribute("data-last-motion-types", "cpu->ready,ready->cpu");
  await expect(dashboard).toHaveAttribute("data-motion-phase", "rotate");
  await expect(dashboard).toHaveAttribute("data-motion-phase", "dispatch", { timeout: 5_000 });
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "A");
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "");

  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("spinbutton", { name: "Q0" }).fill("1");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("100");
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(dashboard).toHaveAttribute("data-last-motion-types", "cpu->q1,q1->cpu");
  await expect(dashboard).toHaveAttribute("data-motion-phase", "demote");
  await expect(page.locator(".cpu-process-copy")).toContainText("Q1 · 0/4 allotment used");
  await expect(page.getByTestId("ready-queue-1")).toHaveAttribute("data-ready-ids", "");
  await expect(dashboard).toHaveAttribute("data-motion-status", "idle");

  await page.getByRole("spinbutton", { name: "Q0" }).fill("2");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("2");
  await page.locator('[data-timeline-time="1"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(dashboard).toHaveAttribute("data-last-motion-types", "cpu->q1,q1->q0,q0->cpu");
  await expect(dashboard).toHaveAttribute("data-motion-phase-count", "3");
  await expect(page.locator(".cpu-process-copy")).toContainText("Q0 · 0/2 allotment used");
  await expect(page.getByTestId("event-list")).toContainText("moved from Q0 to Q1");
  await expect(page.getByTestId("event-list")).toContainText("Priority boost moved 1 waiting process to Q0");
});

test("playback, keyboard stepping, reset, and timeline inspection stay synchronized", async ({ page }) => {
  await page.locator("#algorithm").selectOption("rr");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("time-value")).toHaveText("0");

  await page.locator('[data-timeline-time="7"]').click();
  await assertBoundary(page, lectureTraces.rr, 7);
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-last-motion-count", "0");
  await expect(page.locator(".process-motion-arrow")).toHaveCount(0);
  await expect(page.locator(".motion-cue")).toHaveCount(0);
  await page.getByRole("button", { name: "Reset to time zero" }).click();
  await assertBoundary(page, lectureTraces.rr, 0);

  await page.locator('[data-timeline-time="19"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();
  await assertBoundary(page, lectureTraces.rr, 20);
  await expect(page.locator(".dashboard-grid")).toHaveAttribute("data-motion-status", "idle");
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
  const cpuProcessCard = page.getByTestId("cpu-process-card");
  await expect(page.locator(".cpu-process-copy")).toContainText("Q0 · 1/2 allotment used");
  await expect(cpuProcessCard).toHaveCount(1);
  await expect(cpuProcessCard).toHaveAttribute("data-process-id", "B");
  await expect(cpuProcessCard).toHaveAttribute("data-queue-level", "0");
  await expect(cpuProcessCard).toHaveAttribute("data-remaining", "5");
  await expect(cpuProcessCard).toHaveAttribute("data-allotment-used", "1");
  await expect(cpuProcessCard).toContainText("5 left");
  await expect(page.locator(".cpu-process-copy")).toContainText("5 ticks remaining");
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "A");
  await expect(page.locator('.queue-track [data-process-id="B"]')).toHaveCount(0);
  await expect(page.getByTestId("event-list")).toContainText(
    "B remained on the CPU in Q0 with 1/2 ticks used",
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

  await expect(page.locator(".process-row")).toHaveCount(5);
  await expect(page.locator(".queue-row")).toHaveCount(3);
  await expect(page.locator(".event-list p")).toHaveCount(2);
  await expect(page.getByTestId("state-counts")).toHaveAttribute("data-ready-count", "11");

  async function collectPages(label: string, selector: string, attribute: string) {
    const values: string[] = [];
    while (true) {
      values.push(...await page.locator(selector).evaluateAll((items, attr) => items.map((item) => item.getAttribute(attr) ?? ""), attribute));
      const next = page.getByRole("button", { name: `Next ${label} page`, exact: true });
      if (!await next.count() || await next.isDisabled()) break;
      await next.click();
    }
    return values;
  }
  expect(await collectPages("processes", ".process-id-input input", "value")).toEqual(processes.map((p) => p.id));
  expect(await collectPages("queue 0", '[data-testid="ready-queue-0"] [data-process-id]', "data-process-id")).toEqual(processes.slice(1).map((p) => p.id));
  expect(await collectPages("timeline", "[data-timeline-time]", "data-timeline-time")).toEqual(Array.from({ length: 36 }, (_, i) => String(i)));
  let eventCount = 0;
  while (true) {
    eventCount += await page.locator(".event-list p").count();
    const next = page.getByRole("button", { name: "Next events page", exact: true });
    if (await next.isDisabled()) break;
    await next.click();
  }
  expect(eventCount).toBe(13);
  await page.getByRole("button", { name: "Metrics", exact: true }).click();
  expect(await collectPages("metrics", "tr[data-process-id]", "data-process-id")).toEqual(processes.map((p) => p.id));
  const overflow = await page.locator(".setup-panel, .event-list, .queue-track, .metrics-scroll, .timeline-scroll").evaluateAll((elements) =>
    elements.filter((el) => el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2).map((el) => el.className),
  );
  expect(overflow).toEqual([]);
});

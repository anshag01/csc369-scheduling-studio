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
  await expect(dashboard).toHaveAttribute("data-last-motion-labels", /A quantum expired/);
  await expect(dashboard).toHaveAttribute("data-last-motion-labels", /B dispatch/);
  await expect(page.locator('[data-motion-id="A"]')).toHaveCount(1);
  await expect(page.locator('[data-motion-id="B"]')).toHaveCount(1);
  await expect(page.locator('.process-motion-arrow[data-motion-action="rotate"][data-motion-process-id="A"]')).toContainText("QUANTUM EXPIRED · A");
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"][data-motion-process-id="B"]')).toContainText("DISPATCH · B");
  await expect(page.locator(".motion-cue")).toContainText("A quantum expired → ready tail");
  await expect(page.locator('.process-motion-arrow[data-motion-action="rotate"]')).toHaveCSS("opacity", "1");
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"]')).toHaveCSS("opacity", "0");
  expect(await page.locator('.process-motion-arrow[data-motion-action="rotate"]').evaluate((arrow) =>
    arrow.getAnimations({ subtree: true }).length,
  )).toBe(0);
  expect(await page.locator('.process-motion-traveler[data-process-id="A"]').evaluate((card) => card.getAnimations().length)).toBeGreaterThan(0);
  const stableTraveler = await page.locator('.process-motion-traveler[data-process-id="A"]').evaluate((card) => {
    const travelerRect = card.getBoundingClientRect();
    const destinationRect = document.querySelector<HTMLElement>('[data-motion-id="A"]')!.getBoundingClientRect();
    const transforms = card.getAnimations().flatMap((animation) =>
      (animation.effect as KeyframeEffect).getKeyframes().map((frame) => String(frame.transform ?? "")),
    );
    return {
      sameSize: Math.abs(travelerRect.width - destinationRect.width) < 1 && Math.abs(travelerRect.height - destinationRect.height) < 1,
      transforms,
    };
  });
  expect(stableTraveler.sameSize).toBe(true);
  expect(stableTraveler.transforms.every((transform) => !transform.includes("scale"))).toBe(true);
  await page.waitForTimeout(750);
  const rotationPositions = await page.locator(".process-motion-traveler").evaluateAll((cards) =>
    Object.fromEntries(cards.map((card) => [card.getAttribute("data-process-id"), card.getBoundingClientRect().x])),
  );
  expect(rotationPositions.A).toBeGreaterThan(rotationPositions.B);
  await expect(page.locator(".motion-cue")).toContainText("B dispatch → CPU", { timeout: 4_000 });
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"]')).toHaveCSS("opacity", "1");
  const dispatchMarker = page.locator('.process-motion-arrow[data-motion-action="dispatch"] .process-motion-info');
  await dispatchMarker.hover();
  await expect(dispatchMarker.locator("span")).toHaveCSS("visibility", "visible");
  await expect(dispatchMarker).toHaveAttribute("aria-label", "DISPATCH · B → CPU");
  await expect(page.getByRole("button", { name: "Next time step" })).toBeDisabled();
  const arrowGeometry = await page.locator(".process-motion-arrow").evaluateAll((arrows) => arrows.map((arrow) => ({
    width: Number.parseFloat((arrow as HTMLElement).style.width),
    rotation: (arrow as HTMLElement).style.transform,
  })));
  expect(arrowGeometry.every(({ width, rotation }) => width > 30 && rotation.startsWith("rotate("))).toBe(true);

  await page.getByRole("button", { name: "Previous time step" }).click();
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /ready->cpu/);
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /cpu->ready/);
  await expect(page.locator('[data-motion-id="A"]')).toHaveCount(1);
  await expect(page.locator('[data-motion-id="B"]')).toHaveCount(1);
  await expect(page.locator('.process-motion-arrow[data-motion-action="rotate"]')).toContainText("UNDO QUANTUM EXPIRED");
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"]')).toContainText("UNDO DISPATCH");
});

test("busy MLFQ boundaries move process cards through exact intermediate states behind static guides", async ({ page }) => {
  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("10");
  await page.locator('[data-timeline-time="9"]').click();
  await page.getByRole("button", { name: "Next time step" }).click();

  await expect(page.locator(".motion-cue")).toContainText("E finish → finished");
  expect(await page.locator('.process-motion-arrow[data-motion-action="finish"]').evaluate((arrow) =>
    arrow.getAnimations({ subtree: true }).length,
  )).toBe(0);

  await expect(page.locator(".motion-cue")).toContainText("priority boost → Q0", { timeout: 5_000 });
  const boostArrow = page.locator('.process-motion-arrow[data-motion-action="boost"]');
  await expect(boostArrow).toHaveCount(1);
  await expect(boostArrow).toHaveAttribute("data-motion-detail", "PRIORITY BOOST · A, B, C, D → Q0");
  await page.waitForTimeout(750);
  const boosted = await page.locator(".process-motion-traveler").evaluateAll((cards) => cards
    .filter((card) => ["A", "B", "C", "D"].includes(card.getAttribute("data-process-id") ?? ""))
    .map((card) => ({ id: card.getAttribute("data-process-id"), rect: card.getBoundingClientRect().toJSON() }))
    .sort((left, right) => left.rect.x - right.rect.x));
  expect(boosted.map(({ id }) => id)).toEqual(["A", "B", "C", "D"]);
  expect(new Set(boosted.map(({ rect }) => Math.round(rect.y))).size).toBe(1);
  for (let index = 1; index < boosted.length; index += 1) {
    expect(boosted[index - 1].rect.x + boosted[index - 1].rect.width).toBeLessThanOrEqual(boosted[index].rect.x);
  }
  const boostedBLeft = boosted[1].rect.x;

  await expect(page.locator(".motion-cue")).toContainText("A dispatch → CPU", { timeout: 5_000 });
  await page.waitForTimeout(750);
  const dispatched = await page.locator(".process-motion-traveler").evaluateAll((cards) => Object.fromEntries(cards.map((card) => {
    const rect = card.getBoundingClientRect();
    return [card.getAttribute("data-process-id"), { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
  })));
  expect(dispatched.A.y).toBeLessThan(dispatched.B.y);
  expect(dispatched.B.x).toBeLessThan(boostedBLeft);
  const movingRects = Object.values(dispatched);
  for (let leftIndex = 0; leftIndex < movingRects.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < movingRects.length; rightIndex += 1) {
      const left = movingRects[leftIndex];
      const right = movingRects[rightIndex];
      const overlaps = left.x < right.x + right.width && left.x + left.width > right.x &&
        left.y < right.y + right.height && left.y + left.height > right.y;
      expect(overlaps).toBe(false);
    }
  }
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
  await expect(page.locator('.process-motion-arrow[data-motion-action="finish"]')).toContainText("FINISH · A");
  await expect(page.locator(".motion-cue")).toContainText("A finish → finished");
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
  await expect(page.locator('.process-motion-arrow[data-motion-action="boost"][data-motion-process-id="B"]')).toContainText("PRIORITY BOOST · B");
  await expect(page.locator(".motion-cue")).toContainText("B priority boost → Q0");
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
  await expect(page.locator('.process-motion-arrow[data-motion-action="demote"][data-motion-process-id="A"]')).toContainText("DEMOTE · A");
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"][data-motion-process-id="C"]')).toContainText("DISPATCH · C");
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "C");
  await expect(page.getByTestId("ready-queue-1")).toHaveAttribute("data-ready-ids", "A");

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
  await expect(dashboard).toHaveAttribute("data-last-motion-types", /arrival->q0->cpu/);
  await expect(page.locator('.process-motion-arrow[data-motion-action="preempt"][data-motion-process-id="A"]')).toContainText("PREEMPT · A");
  await expect(page.locator('.process-motion-arrow[data-motion-action="arrive"][data-motion-process-id="B"]')).toContainText("ARRIVE · B");
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"][data-motion-process-id="B"]')).toContainText("DISPATCH · B");
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
  await expect(dashboard).toHaveAttribute("data-last-motion-types", "cpu->ready->cpu");
  await expect(page.locator('.process-motion-arrow[data-motion-action="rotate"]')).toContainText("QUANTUM EXPIRED · A");
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"]')).toContainText("DISPATCH · A");
  await expect(page.getByTestId("cpu-process-card")).toHaveAttribute("data-process-id", "A");
  await expect(page.getByTestId("ready-queue-0")).toHaveAttribute("data-ready-ids", "");

  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("spinbutton", { name: "Q0" }).fill("1");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("100");
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(dashboard).toHaveAttribute("data-last-motion-types", "cpu->q1->cpu");
  await expect(page.locator('.process-motion-arrow[data-motion-action="demote"]')).toContainText("DEMOTE · A");
  await expect(page.locator(".cpu-process-copy")).toContainText("Q1 · 0/4 allotment used");
  await expect(page.getByTestId("ready-queue-1")).toHaveAttribute("data-ready-ids", "");

  await page.getByRole("spinbutton", { name: "Q0" }).fill("2");
  await page.getByRole("spinbutton", { name: "Boost ticks" }).fill("2");
  await page.getByRole("button", { name: "Next time step" }).click();
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(dashboard).toHaveAttribute("data-last-motion-types", "cpu->q1->q0->cpu");
  await expect(page.locator('.process-motion-arrow[data-motion-action="demote"]')).toContainText("DEMOTE · A");
  await expect(page.locator('.process-motion-arrow[data-motion-action="boost"]')).toContainText("PRIORITY BOOST · A");
  await expect(page.locator('.process-motion-arrow[data-motion-action="dispatch"]')).toContainText("DISPATCH · A");
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

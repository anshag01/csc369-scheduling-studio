import { expect, Page, test } from "@playwright/test";
import { createRequire } from "node:module";

const darkReaderScript = createRequire(import.meta.url).resolve("darkreader");

async function readTextContrast(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    function luminance(color: string) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    }
    return [".field-label", ".playback-controls button:not(:disabled)", ".metrics-toggle.active", ".policy-badge", ".cpu-queue-badge", ".state-pill.finished", ".tick-block", ".timeline-legend", ".completion-dock > i", ".boost-marker", ".event-list p > span", ".motion-cue", ".motion-cue span", ".queue-label em"].flatMap((selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((element) => {
        const foreground = luminance(getComputedStyle(element).color);
        let surface: HTMLElement = element;
        while (getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)" && surface.parentElement) surface = surface.parentElement;
        const background = luminance(getComputedStyle(surface).backgroundColor);
        return { selector, backgroundLuminance: background, ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
      }),
    );
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await page.getByRole("button", { name: "Reset to time zero" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("0");
});

test("Clay is the only theme, ignores saved palettes, and keeps text readable", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("scheduling-studio-palette", "iris"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "clay");
  await expect(page.getByLabel("Color palette", { exact: true })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("button", { name: "Metrics", exact: true }).click();
  await page.locator('[data-timeline-time="6"]').click();
  const readSurfaces = () => page.locator(".setup-panel, .simulation-panel, .tick-block").evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  }));
  const light = await readSurfaces();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
    await expect(page.getByTestId("time-value")).toHaveText("6");
    expect(await readSurfaces()).toEqual(light);
    for (const pair of await readTextContrast(page)) expect(pair.ratio, pair.selector).toBeGreaterThanOrEqual(4.5);
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "clay");
});

test("Clay renders and playback works when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage unavailable"); } });
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "clay");
  await page.getByRole("button", { name: "Next time step" }).click();
  await expect(page.getByTestId("time-value")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Play simulation" })).toBeVisible();
});

test("Dark Reader keeps Clay readable and restores its original light appearance", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.locator("#algorithm").selectOption("mlfq");
  await page.getByRole("button", { name: "Metrics", exact: true }).click();
  await page.locator('[data-timeline-time="6"]').click();
  const readSurfaces = () => page.locator(".setup-panel, .simulation-panel, .cpu-card, .tick-block").evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  }));
  const light = await readSurfaces();
  const geometry = await page.locator(".simulation-panel").boundingBox();
  await page.addScriptTag({ path: darkReaderScript });
  await page.evaluate(() => {
    const reader = (window as unknown as { DarkReader: typeof import("darkreader") }).DarkReader;
    reader.setFetchMethod(window.fetch);
    reader.enable({ brightness: 100, contrast: 100, sepia: 0 });
  });
  await expect(page.locator("html")).toHaveAttribute("data-darkreader-mode", "dynamic");
  await expect.poll(async () => (await readTextContrast(page)).filter((pair) => pair.selector === ".field-label").every((pair) => pair.backgroundLuminance < .15)).toBe(true);
  for (const time of [6, 10, 20]) {
    if (time === 20) {
      await page.locator('[data-timeline-time="19"]').click();
      await page.getByRole("button", { name: "Next time step" }).click();
    } else {
      await page.locator(`[data-timeline-time="${time}"]`).click();
    }
    await expect(page.getByTestId("time-value")).toHaveText(String(time));
    await expect.poll(async () => Math.min(...(await readTextContrast(page)).map((pair) => pair.ratio))).toBeGreaterThanOrEqual(4.5);
    expect(await page.locator(".simulation-panel").boundingBox()).toEqual(geometry);
  }
  await page.locator('[data-timeline-time="6"]').click();
  await page.evaluate(() => (window as unknown as { DarkReader: typeof import("darkreader") }).DarkReader.disable());
  await expect(page.locator("html")).not.toHaveAttribute("data-darkreader-mode", "dynamic");
  await expect.poll(readSurfaces).toEqual(light);
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toHaveCount(0);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete scheduling studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Scheduling Studio/);
  assert.match(html, /CSC369/);
  assert.match(html, /Scheduling Studio/);
  assert.match(html, /Choose a policy/);
  assert.match(html, /Define processes/);
  assert.match(html, /Execution timeline/);
  assert.match(html, />Metrics<\/button>/);
  assert.doesNotMatch(html, /State &amp; metrics/);
  assert.match(html, /value="fcfs"/);
  assert.match(html, /value="sjf"/);
  assert.match(html, /value="stcf"/);
  assert.match(html, /value="rr"/);
  assert.match(html, /value="mlfq"/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site|codex-preview/);
});

test("keeps the production source free of starter-preview wiring", async () => {
  const [page, layout, packageJson, schedulingLab, stylesheet] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/SchedulingLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /import SchedulingLab/);
  assert.match(page, /<SchedulingLab \/>/);
  assert.match(layout, /title:\s*"Scheduling Studio/);
  assert.match(layout, /csc369-scheduling-studio/);
  assert.doesNotMatch(page + layout + packageJson, /codex-preview|react-loading-skeleton|Starter Project/);

  assert.match(schedulingLab, /Priority feedback map/);
  assert.match(schedulingLab, /NEXT BOOST/);
  assert.match(schedulingLab, /allotment-meter/);
  assert.match(schedulingLab, /showMetrics/);
  assert.doesNotMatch(schedulingLab, /gives up CPU one tick early|yield-toggle|state-flow/);
  assert.match(stylesheet, /\.boost-ring/);
  assert.match(stylesheet, /\.queue-row\.active-queue/);
  assert.match(stylesheet, /\.allotment-meter/);
  assert.doesNotMatch(stylesheet, /#10a37f|#19c37d/i);

  assert.equal(projectRoot.protocol, "file:");
});

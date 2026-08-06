import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Algorithm, ProcessDefinition, SimulationConfig, simulate } from "../lib/simulator";
import SchedulingLab from "./SchedulingLab";

const processes: ProcessDefinition[] = [
  { id: "A", arrivalTime: 0, serviceTime: 4, color: "#4f6bed" },
  { id: "B", arrivalTime: 2, serviceTime: 2, color: "#8e63ce" },
  { id: "C", arrivalTime: 5, serviceTime: 1, color: "#d18b38" },
];

const config = (algorithm: Algorithm): SimulationConfig => ({
  algorithm,
  quantum: 2,
  mlfqQuanta: [1, 2, 4],
  mlfqBoostInterval: 5,
});

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

function firstTag(html: string, pattern: RegExp) {
  const tag = html.match(pattern)?.[0];
  expect(tag).toBeTruthy();
  return tag!;
}

function render(algorithm: Algorithm, step: number, showMetrics = true) {
  return renderToStaticMarkup(
    <SchedulingLab
      initialAlgorithm={algorithm}
      initialProcesses={processes}
      initialQuantum={2}
      initialMlfqQuanta={[1, 2, 4]}
      initialMlfqBoostInterval={5}
      initialStep={step}
      initialShowMetrics={showMetrics}
    />,
  );
}

describe("scheduling visualization mirrors simulator snapshots", () => {
  for (const algorithm of ["fcfs", "sjf", "stcf", "rr", "mlfq"] as const) {
    it(`renders every ${algorithm.toUpperCase()} boundary, queue, event, metric state, and timeline cell`, () => {
      const result = simulate(processes, config(algorithm));

      for (const snapshot of result.snapshots) {
        const html = render(algorithm, snapshot.time);
        const dashboard = firstTag(html, /<div class="dashboard-grid[^>]*>/);
        expect(attribute(dashboard, "data-snapshot-time")).toBe(String(snapshot.time));
        expect(attribute(dashboard, "data-running-process")).toBe(snapshot.running ?? "");
        expect(attribute(dashboard, "data-running-remaining")).toBe(
          snapshot.runningRemaining === null ? "" : String(snapshot.runningRemaining),
        );

        const eventList = firstTag(html, /<div class="event-list"[^>]*>/);
        expect(attribute(eventList, "data-event-count")).toBe(String(snapshot.events.length));
        for (const event of snapshot.events) {
          expect(html).toContain(renderToStaticMarkup(<>{event}</>));
        }

        const stateCounts = firstTag(html, /<span data-testid="state-counts"[^>]*>/);
        expect(attribute(stateCounts, "data-new-count")).toBe(
          String(snapshot.processes.filter((process) => process.state === "new").length),
        );
        expect(attribute(stateCounts, "data-ready-count")).toBe(
          String(snapshot.processes.filter((process) => process.state === "ready").length),
        );
        expect(attribute(stateCounts, "data-finished-count")).toBe(
          String(snapshot.processes.filter((process) => process.state === "finished").length),
        );

        const queueTags = [...html.matchAll(/<div class="queue-track"[^>]*>/g)].map((match) => match[0]);
        expect(queueTags).toHaveLength(snapshot.readyQueues.length);
        snapshot.readyQueues.forEach((queue, index) => {
          expect(attribute(queueTags[index], "data-testid")).toBe(`ready-queue-${index}`);
          expect(attribute(queueTags[index], "data-ready-ids")).toBe(queue.join(","));
        });

        const metricRows = [...html.matchAll(/<tr data-process-id="[^"]+"[^>]*>/g)].map((match) => match[0]);
        expect(metricRows).toHaveLength(snapshot.processes.length);
        snapshot.processes.forEach((process, index) => {
          expect(attribute(metricRows[index], "data-process-id")).toBe(process.id);
          expect(attribute(metricRows[index], "data-state")).toBe(process.state);
          expect(attribute(metricRows[index], "data-remaining")).toBe(String(process.remainingTime));
          if (algorithm === "mlfq") {
            expect(attribute(metricRows[index], "data-queue-level")).toBe(String(process.queueLevel));
            expect(attribute(metricRows[index], "data-allotment-used")).toBe(String(process.allotmentUsed));
          }
        });

        const timelineTags = [...html.matchAll(/<button data-timeline-time="\d+"[^>]*>/g)].map((match) => match[0]);
        expect(timelineTags).toHaveLength(result.timeline.length);
        result.timeline.forEach((slice, index) => {
          expect(attribute(timelineTags[index], "data-timeline-time")).toBe(String(slice.time));
          expect(attribute(timelineTags[index], "data-process-id")).toBe(slice.processId ?? "");
          const className = attribute(timelineTags[index], "class") ?? "";
          expect(className.includes("future")).toBe(slice.time > snapshot.time);
          expect(className.includes("active")).toBe(slice.time === snapshot.time);
          const isBoostBoundary = algorithm === "mlfq" && slice.time > 0 && slice.time % 5 === 0;
          expect(attribute(timelineTags[index], "data-boost-boundary")).toBe(isBoostBoundary ? "true" : null);
          expect(className.includes("boost-tick")).toBe(isBoostBoundary);
        });
        const expectedBoostMarkers = algorithm === "mlfq"
          ? result.timeline.filter((slice) => slice.time > 0 && slice.time % 5 === 0).length
          : 0;
        expect([...html.matchAll(/class="boost-marker"/g)]).toHaveLength(expectedBoostMarkers);
      }
    });
  }

  it("keeps metrics absent by default while retaining compact state coverage", () => {
    const html = render("mlfq", 3, false);
    expect(html).not.toContain("State &amp; metrics");
    expect(html).toContain('data-testid="state-counts"');
    expect(html).toContain("Priority feedback map");
    expect([...html.matchAll(/data-testid="ready-queue-\d+"/g)]).toHaveLength(3);
  });

  it("renders invalid scenarios as a visible validation state instead of stale scheduler data", () => {
    const html = renderToStaticMarkup(
      <SchedulingLab
        initialProcesses={[
          { id: "A", arrivalTime: 0, serviceTime: 1, color: "#4f6bed" },
          { id: "a", arrivalTime: 1, serviceTime: 1, color: "#8e63ce" },
        ]}
      />,
    );
    expect(html).toContain("Check the scenario");
    expect(html).toContain("Process IDs must be unique.");
    expect(html).not.toContain("dashboard-grid");
  });
});

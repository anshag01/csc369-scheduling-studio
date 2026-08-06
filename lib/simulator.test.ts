import { describe, expect, it } from "vitest";
import { Algorithm, ProcessDefinition, simulate } from "./simulator";

const colors = ["#1", "#2", "#3"];
const process = (id: string, arrivalTime: number, serviceTime: number, index: number): ProcessDefinition => ({
  id, arrivalTime, serviceTime, color: colors[index],
});
const run = (algorithm: Algorithm, processes: ProcessDefinition[], quantum = 2, mlfqQuanta = [1, 2, 4]) =>
  simulate(processes, { algorithm, quantum, mlfqQuanta }).timeline.map((slice) => slice.processId ?? "-").join("");

describe("scheduling simulator", () => {
  const lectureExample = [
    process("A", 0, 3, 0),
    process("B", 2, 6, 1),
    process("C", 4, 4, 2),
    { ...process("D", 6, 5, 0), color: "#4" },
    { ...process("E", 8, 2, 1), color: "#5" },
  ];

  it("runs FCFS without preemption", () => {
    expect(run("fcfs", [process("A", 0, 3, 0), process("B", 1, 2, 1)])).toBe("AAABB");
  });

  it("chooses the shortest ready job with SJF", () => {
    expect(run("sjf", [process("A", 0, 3, 0), process("B", 1, 4, 1), process("C", 1, 1, 2)])).toBe("AAACBBBB");
  });

  it("preempts for a shorter remaining job with STCF", () => {
    expect(run("stcf", [process("A", 0, 5, 0), process("B", 2, 1, 1)])).toBe("AABAAA");
  });

  it("enqueues a simultaneous arrival before a quantum-expired RR process", () => {
    expect(run("rr", [process("A", 0, 3, 0), process("B", 2, 2, 1)], 2)).toBe("AABBA");
  });

  it("demotes a process after it uses an entire MLFQ allotment", () => {
    const result = simulate(
      [process("A", 0, 4, 0), process("B", 1, 1, 1)],
      { algorithm: "mlfq", quantum: 2, mlfqQuanta: [2, 4, 8], mlfqBoostInterval: 100 },
    );
    expect(result.timeline.map((slice) => slice.processId).join("")).toBe("AABAA");
    expect(result.snapshots[2].events).toContain("A used its full allotment and moved from Q0 to Q1.");
  });

  it("accounts for CPU use across voluntary early relinquishes", () => {
    const earlyYielding = { ...process("A", 0, 6, 0), relinquishEarly: true };
    const result = simulate(
      [earlyYielding, process("B", 0, 4, 1)],
      { algorithm: "mlfq", quantum: 2, mlfqQuanta: [4, 8], mlfqBoostInterval: 100 },
    );

    expect(result.timeline.slice(0, 8).map((slice) => slice.processId).join("")).toBe("AAABBBBA");
    expect(result.snapshots[3].events).toContain(
      "A gave up the CPU one tick early at Q0; 3/4 used ticks remain accounted.",
    );
    expect(result.snapshots[8].events).toContain("A used its full allotment and moved from Q0 to Q1.");
  });

  it("periodically boosts every active MLFQ process to Q0", () => {
    const result = simulate(
      [process("A", 0, 8, 0), process("B", 0, 8, 1)],
      { algorithm: "mlfq", quantum: 2, mlfqQuanta: [2, 4, 8], mlfqBoostInterval: 5 },
    );

    expect(result.snapshots[5].events.some((event) =>
      event.startsWith("Priority boost moved 2 active processes to Q0"),
    )).toBe(true);
    expect(result.snapshots[5].processes.every((item) => item.queueLevel === 0)).toBe(true);
  });

  it("uses round robin at each MLFQ priority level and preserves queue order", () => {
    const result = simulate(
      [process("A", 0, 6, 0), process("B", 0, 6, 1)],
      { algorithm: "mlfq", quantum: 2, mlfqQuanta: [2, 4], mlfqBoostInterval: 100 },
    );

    expect(result.timeline.map((slice) => slice.processId).join("")).toBe("AABBAAAABBBB");
  });

  it("preempts a lower queue for a new Q0 arrival without erasing used allotment", () => {
    const result = simulate(
      [process("A", 0, 8, 0), process("B", 3, 1, 1)],
      { algorithm: "mlfq", quantum: 2, mlfqQuanta: [2, 4, 8], mlfqBoostInterval: 100 },
    );

    expect(result.timeline.slice(0, 4).map((slice) => slice.processId).join("")).toBe("AAAB");
    expect(result.snapshots[3].events).toContain(
      "A was preempted by a process in a higher-priority queue.",
    );
    expect(result.snapshots[3].processes.find((item) => item.id === "A")?.allotmentUsed).toBe(1);
  });

  it("records waiting, response, and turnaround times", () => {
    const result = simulate(
      [process("A", 0, 2, 0), process("B", 0, 1, 1)],
      { algorithm: "fcfs", quantum: 2, mlfqQuanta: [1, 2, 4] },
    );
    const final = result.snapshots.at(-1)!;
    expect(final.processes.find((item) => item.id === "A")?.turnaroundTime).toBe(2);
    expect(final.processes.find((item) => item.id === "B")?.waitingTime).toBe(2);
    expect(final.processes.find((item) => item.id === "B")?.responseTime).toBe(2);
  });

  it("reproduces the lecture FCFS timeline and average wait of 4.6", () => {
    const result = simulate(lectureExample, { algorithm: "fcfs", quantum: 2, mlfqQuanta: [1, 2, 4] });
    expect(result.timeline.map((slice) => slice.processId).join("")).toBe("AAABBBBBBCCCCDDDDDEE");
    const waits = result.snapshots.at(-1)!.processes.map((item) => item.waitingTime);
    expect(waits.reduce((sum, wait) => sum + wait, 0) / waits.length).toBe(4.6);
  });

  it("reproduces the lecture SJF timeline and average wait of 3.6", () => {
    const result = simulate(lectureExample, { algorithm: "sjf", quantum: 2, mlfqQuanta: [1, 2, 4] });
    expect(result.timeline.map((slice) => slice.processId).join("")).toBe("AAABBBBBBEECCCCDDDDD");
    const waits = result.snapshots.at(-1)!.processes.map((item) => item.waitingTime);
    expect(waits.reduce((sum, wait) => sum + wait, 0) / waits.length).toBe(3.6);
  });

  it("reproduces the lecture Round Robin timeline and turnaround values", () => {
    const result = simulate(lectureExample, { algorithm: "rr", quantum: 2, mlfqQuanta: [1, 2, 4] });
    expect(result.timeline.map((slice) => slice.processId).join("")).toBe("AABBACCBBDDCCEEBBDDD");
    expect(result.snapshots.at(-1)!.processes.map((item) => item.turnaroundTime)).toEqual([5, 15, 9, 14, 7]);
  });
});

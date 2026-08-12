"use client";

import { RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Algorithm, ProcessDefinition, simulate, validateProcesses } from "../lib/simulator";

const palette = ["#4f6bed", "#8e63ce", "#d18b38", "#d15f5f", "#328ea8", "#667085"];
const exampleProcesses: ProcessDefinition[] = [
  { id: "A", arrivalTime: 0, serviceTime: 3, color: palette[0] },
  { id: "B", arrivalTime: 2, serviceTime: 6, color: palette[1] },
  { id: "C", arrivalTime: 4, serviceTime: 4, color: palette[2] },
  { id: "D", arrivalTime: 6, serviceTime: 5, color: palette[3] },
  { id: "E", arrivalTime: 8, serviceTime: 2, color: palette[4] },
];

const algorithms: Record<Algorithm, { name: string; short: string; preemptive: boolean }> = {
  fcfs: { name: "First Come, First Served", short: "FCFS", preemptive: false },
  sjf: { name: "Shortest Job First", short: "SJF", preemptive: false },
  stcf: { name: "Shortest Time to Completion First", short: "STCF", preemptive: true },
  rr: { name: "Round Robin", short: "RR", preemptive: true },
  mlfq: { name: "Multilevel Feedback Queue", short: "MLFQ", preemptive: true },
};

const algorithmGuidance: Record<Algorithm, { rule: string; detail: string }> = {
  fcfs: {
    rule: "Run the head of the FIFO queue until it finishes.",
    detail: "A running process is never displaced by a later arrival.",
  },
  sjf: {
    rule: "When the CPU is free, choose the shortest ready job.",
    detail: "This version is non-preemptive and uses the original service time.",
  },
  stcf: {
    rule: "Keep the process with the shortest remaining time on the CPU.",
    detail: "A strictly shorter arrival preempts the running process.",
  },
  rr: {
    rule: "Run the queue head for one quantum, then rotate it to the tail.",
    detail: "Lecture tie rule: a same-time arrival is enqueued before the expired process.",
  },
  mlfq: {
    rule: "Run the highest queue; use round robin among processes at the same level.",
    detail: "Full allotment demotes. Boosts move waiting work to Q0 while the current CPU turn continues unchanged.",
  },
};

type MotionPoint = {
  rect: DOMRect;
  place: string;
  color: string;
};

function useProcessMotion(
  rootRef: RefObject<HTMLDivElement | null>,
  frameKey: string,
  contextKey: string,
  duration: number,
  events: string[],
) {
  const previous = useRef(new Map<string, MotionPoint>());
  const previousContext = useRef(contextKey);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-motion-id]")];
    const current = new Map<string, MotionPoint>();
    for (const node of nodes) {
      const id = node.dataset.motionId;
      if (!id) continue;
      current.set(id, {
        rect: node.getBoundingClientRect(),
        place: node.dataset.motionPlace ?? "unknown",
        color: node.dataset.motionColor ?? "#4f6bed",
      });
    }

    if (previousContext.current !== contextKey || previous.current.size === 0) {
      previous.current = current;
      previousContext.current = contextKey;
      root.dataset.lastMotionCount = "0";
      root.dataset.lastMotionTypes = "";
      return;
    }

    const movements: string[] = [];
    if (!reducedMotion) {
      for (const node of nodes) {
        const id = node.dataset.motionId;
        const next = id ? current.get(id) : null;
        const before = id ? previous.current.get(id) : null;
        if (!id || !next) continue;

        if (!before) {
          node.animate(
            [
              { opacity: 0, transform: "translateY(7px) scale(.9)" },
              { opacity: 1, transform: "translateY(0) scale(1)" },
            ],
            { duration: Math.min(320, duration), easing: "cubic-bezier(.2,.8,.2,1)" },
          );
          movements.push(`arrival->${next.place}`);
          continue;
        }

        const deltaX = before.rect.left - next.rect.left;
        const deltaY = before.rect.top - next.rect.top;
        const scaleX = before.rect.width / Math.max(1, next.rect.width);
        const scaleY = before.rect.height / Math.max(1, next.rect.height);
        if (before.place === next.place && next.place === "cpu") continue;
        if (before.place === next.place && Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1 && Math.abs(scaleX - 1) < .02 && Math.abs(scaleY - 1) < .02) continue;

        node.animate(
          [
            {
              transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
              transformOrigin: "top left",
              boxShadow: "0 12px 28px rgba(32,33,35,.2)",
              zIndex: 30,
            },
            {
              transform: "translate(0, 0) scale(1, 1)",
              transformOrigin: "top left",
              boxShadow: "0 3px 8px rgba(0,0,0,.045)",
              zIndex: 1,
            },
          ],
          { duration, easing: "cubic-bezier(.2,.75,.2,1)" },
        );
        movements.push(`${before.place}->${next.place}`);
      }

      // If one process exhausts a turn and is immediately selected again, its
      // start and end snapshots both place it on the CPU. Animate the real
      // intermediate enqueue/demotion path so that event is not visually lost.
      for (const node of nodes) {
        const id = node.dataset.motionId;
        const before = id ? previous.current.get(id) : null;
        const next = id ? current.get(id) : null;
        if (!id || before?.place !== "cpu" || next?.place !== "cpu") continue;
        const processEvent = events.find((event) =>
          event.startsWith(`${id} `) || event.startsWith(`${id}'s `),
        );
        if (!processEvent) continue;

        const demotion = processEvent.match(/(?:moved from Q\d+ to|returned to) Q(\d+)/);
        const yieldLevel = processEvent.match(/gave up the CPU one tick early at Q(\d+)/);
        const destinations: string[] = [];
        if (demotion) destinations.push(`q${demotion[1]}`);
        else if (yieldLevel) destinations.push(`q${yieldLevel[1]}`);
        else if (processEvent.includes("quantum expired")) destinations.push("ready");
        else continue;

        const wasBoosted = events.some((event) => event.startsWith("Priority boost moved"));
        if (wasBoosted && destinations.at(-1) !== "q0") destinations.push("q0");

        const keyframes: Keyframe[] = [{ transform: "translate(0, 0) scale(1)", offset: 0 }];
        destinations.forEach((destination, index) => {
          const queueIndex = destination === "ready" ? 0 : Number(destination.slice(1));
          const targetNode = root.querySelector<HTMLElement>(`[data-testid="ready-queue-${queueIndex}"]`);
          if (!targetNode) return;
          const target = targetNode.getBoundingClientRect();
          const deltaX = target.left + Math.min(target.width / 2, 105) - (next.rect.left + next.rect.width / 2);
          const deltaY = target.top + target.height / 2 - (next.rect.top + next.rect.height / 2);
          keyframes.push({
            transform: `translate(${deltaX}px, ${deltaY}px) scale(.62)`,
            offset: (index + 1) / (destinations.length + 1),
          });
        });
        keyframes.push({ transform: "translate(0, 0) scale(1)", offset: 1 });
        node.animate(keyframes, { duration, easing: "cubic-bezier(.4,0,.2,1)" });
        movements.push(`cpu->${destinations.join("->")}->cpu`);
      }

      const finishTarget = root.querySelector<HTMLElement>("[data-motion-finish-target]");
      if (finishTarget) {
        const target = finishTarget.getBoundingClientRect();
        for (const [id, before] of previous.current) {
          if (current.has(id)) continue;
          const ghost = document.createElement("div");
          ghost.className = "process-motion-ghost";
          ghost.textContent = id;
          ghost.style.setProperty("--process-color", before.color);
          ghost.style.left = `${before.rect.left}px`;
          ghost.style.top = `${before.rect.top}px`;
          ghost.style.width = `${before.rect.width}px`;
          ghost.style.height = `${before.rect.height}px`;
          document.body.appendChild(ghost);
          const deltaX = target.left + target.width / 2 - (before.rect.left + before.rect.width / 2);
          const deltaY = target.top + target.height / 2 - (before.rect.top + before.rect.height / 2);
          const animation = ghost.animate(
            [
              { opacity: 1, transform: "translate(0, 0) scale(1)" },
              { opacity: .15, transform: `translate(${deltaX}px, ${deltaY}px) scale(.28)` },
            ],
            { duration, easing: "cubic-bezier(.4,0,.2,1)" },
          );
          animation.finished.finally(() => ghost.remove());
          movements.push(`${before.place}->finished`);
        }
      }
    }

    root.dataset.lastMotionCount = String(movements.length);
    root.dataset.lastMotionTypes = movements.join(",");
    root.dispatchEvent(new CustomEvent("scheduling-motion", { detail: movements }));
    previous.current = current;
    previousContext.current = contextKey;
  }, [contextKey, duration, events, frameKey, rootRef]);
}

function wholeNumber(value: string, minimum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : minimum;
}

function mean(values: number[]) {
  if (values.length === 0) return "—";
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export type SchedulingLabProps = {
  initialProcesses?: ProcessDefinition[];
  initialAlgorithm?: Algorithm;
  initialQuantum?: number;
  initialMlfqQuanta?: number[];
  initialMlfqBoostInterval?: number;
  initialStep?: number;
  initialShowMetrics?: boolean;
};

export default function SchedulingLab({
  initialProcesses = exampleProcesses,
  initialAlgorithm = "rr",
  initialQuantum = 2,
  initialMlfqQuanta = [2, 4, 8],
  initialMlfqBoostInterval = 10,
  initialStep = 0,
  initialShowMetrics = false,
}: SchedulingLabProps = {}) {
  const [processes, setProcesses] = useState<ProcessDefinition[]>(() => initialProcesses.map((process) => ({ ...process })));
  const [algorithm, setAlgorithm] = useState<Algorithm>(initialAlgorithm);
  const [quantum, setQuantum] = useState(initialQuantum);
  const [mlfqQuanta, setMlfqQuanta] = useState(() => [...initialMlfqQuanta]);
  const [mlfqBoostInterval, setMlfqBoostInterval] = useState(initialMlfqBoostInterval);
  const [step, setStep] = useState(Math.max(0, Math.floor(initialStep)));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);
  const [showMetrics, setShowMetrics] = useState(initialShowMetrics);
  const [jsonText, setJsonText] = useState("");
  const [jsonMessage, setJsonMessage] = useState("");
  const dashboardRef = useRef<HTMLDivElement>(null);

  const validationError = validateProcesses(processes);
  const result = useMemo(
    () => validationError ? { snapshots: [], timeline: [] } : simulate(processes, { algorithm, quantum, mlfqQuanta, mlfqBoostInterval }),
    [algorithm, mlfqBoostInterval, mlfqQuanta, processes, quantum, validationError],
  );
  const lastStep = Math.max(0, result.snapshots.length - 1);
  const snapshot = result.snapshots[Math.min(step, lastStep)];
  const processById = useMemo(() => new Map(processes.map((process) => [process.id, process])), [processes]);

  useEffect(() => {
    if (!playing || step >= lastStep) return;
    const timer = window.setTimeout(() => {
      const nextStep = Math.min(lastStep, step + 1);
      setStep(nextStep);
      if (nextStep >= lastStep) setPlaying(false);
    }, speed);
    return () => window.clearTimeout(timer);
  }, [lastStep, playing, speed, step]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowRight") { setPlaying(false); setStep((current) => Math.min(lastStep, current + 1)); }
      if (event.key === "ArrowLeft") { setPlaying(false); setStep((current) => Math.max(0, current - 1)); }
      if (event.key === " ") {
        event.preventDefault();
        if (!snapshot) return;
        if (!playing && step >= lastStep) setStep(0);
        setPlaying((current) => !current);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lastStep, playing, snapshot, step]);

  const resetPlayback = () => { setStep(0); setPlaying(false); };
  const updateProcess = (index: number, patch: Partial<ProcessDefinition>) => {
    resetPlayback();
    setProcesses((current) => current.map((process, processIndex) => processIndex === index ? { ...process, ...patch } : process));
  };
  const addProcess = () => {
    resetPlayback();
    const used = new Set(processes.map((process) => process.id));
    const id = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((candidate) => !used.has(candidate)) ?? `P${processes.length + 1}`;
    setProcesses((current) => [...current, {
      id,
      arrivalTime: Math.max(0, ...current.map((process) => process.arrivalTime)) + 1,
      serviceTime: 3,
      color: palette[current.length % palette.length],
    }]);
  };
  const loadExample = () => { resetPlayback(); setProcesses(exampleProcesses.map((process) => ({ ...process }))); };
  const prepareJson = () => { setJsonText(JSON.stringify({ processes }, null, 2)); setJsonMessage("Scenario copied into the editor."); };
  const importJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const imported = Array.isArray(parsed) ? parsed : parsed.processes;
      if (!Array.isArray(imported)) throw new Error("Expected a processes array.");
      const next = imported.map((process, index) => ({
        id: String(process.id ?? `P${index + 1}`), arrivalTime: Number(process.arrivalTime),
        serviceTime: Number(process.serviceTime), color: String(process.color ?? palette[index % palette.length]),
      }));
      const error = validateProcesses(next);
      if (error) throw new Error(error);
      resetPlayback(); setProcesses(next); setJsonMessage(`Loaded ${next.length} processes.`);
    } catch (error) { setJsonMessage(error instanceof Error ? error.message : "Could not read this scenario."); }
  };

  const runningProcess = snapshot?.running ? processById.get(snapshot.running) : null;
  const runningView = snapshot?.running ? snapshot.processes.find((process) => process.id === snapshot.running) : null;
  const completedCount = snapshot?.processes.filter((process) => process.state === "finished").length ?? 0;
  const futureCount = snapshot?.processes.filter((process) => process.state === "new").length ?? 0;
  const waitingCount = snapshot?.readyQueues.flat().length ?? 0;
  const boostTicksRemaining = snapshot
    ? mlfqBoostInterval - (snapshot.time % mlfqBoostInterval)
    : mlfqBoostInterval;
  const boostProgress = snapshot
    ? (snapshot.time % mlfqBoostInterval) / mlfqBoostInterval * 100
    : 0;
  const averageWaiting = mean(snapshot?.processes.map((process) => process.waitingTime) ?? []);
  const averageResponse = mean(snapshot?.processes.flatMap((process) => process.responseTime === null ? [] : [process.responseTime]) ?? []);
  const averageTurnaround = mean(snapshot?.processes.flatMap((process) => process.turnaroundTime === null ? [] : [process.turnaroundTime]) ?? []);
  const motionContext = useMemo(
    () => JSON.stringify({ algorithm, processes, quantum, mlfqQuanta, mlfqBoostInterval }),
    [algorithm, mlfqBoostInterval, mlfqQuanta, processes, quantum],
  );
  const motionFrame = snapshot
    ? `${snapshot.time}:${snapshot.running ?? "idle"}:${snapshot.readyQueues.map((queue) => queue.join(".")).join("|")}`
    : "invalid";
  const motionDuration = Math.min(560, Math.max(220, speed - 120));
  useProcessMotion(dashboardRef, motionFrame, motionContext, motionDuration, snapshot?.events ?? []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><span>CPU</span><span>LAB</span></div>
        <div className="brand-copy"><p className="eyebrow">CSC369 · Operating Systems</p><h1>Scheduling Studio</h1></div>
        <div className="scope-badges">
          <span>1 CPU</span><span>Discrete time</span><span>CPU bursts only</span>
          <div className="local-badge"><span className="status-dot" />Browser-local</div>
        </div>
      </header>

      <div className="workspace">
        <aside className="setup-panel">
          <section className="panel-section">
            <div className="section-heading">
              <div><span className="step-number">01</span><h2>Choose a policy</h2></div>
              <span className={`policy-badge ${algorithms[algorithm].preemptive ? "preemptive" : "non-preemptive"}`}>{algorithms[algorithm].preemptive ? "Preemptive" : "Non-preemptive"}</span>
            </div>
            <label className="field-label" htmlFor="algorithm">Scheduling algorithm</label>
            <select id="algorithm" value={algorithm} onChange={(event) => { resetPlayback(); setAlgorithm(event.target.value as Algorithm); }}>
              {(Object.keys(algorithms) as Algorithm[]).map((key) => <option key={key} value={key}>{algorithms[key].short} — {algorithms[key].name}</option>)}
            </select>
            {algorithm === "rr" && <div className="inline-setting"><label htmlFor="quantum">Time quantum</label><div className="number-with-unit"><input id="quantum" type="number" min="1" value={quantum} onChange={(event) => { resetPlayback(); setQuantum(wholeNumber(event.target.value, 1)); }} /><span>ticks</span></div></div>}
            {algorithm === "mlfq" && <div className="mlfq-settings">
              <p className="field-label">Quantum (= allotment) per queue</p>
              {mlfqQuanta.map((value, index) => <label key={index}>Q{index}<input type="number" min="1" value={value} onChange={(event) => { resetPlayback(); setMlfqQuanta((current) => current.map((item, itemIndex) => itemIndex === index ? wholeNumber(event.target.value, 1) : item)); }} /><span>ticks</span></label>)}
              <label className="boost-setting">Boost<input type="number" min="1" value={mlfqBoostInterval} onChange={(event) => { resetPlayback(); setMlfqBoostInterval(wholeNumber(event.target.value, 1)); }} /><span>ticks</span></label>
            </div>}
            <div className="policy-note">
              <span>{algorithms[algorithm].short} rule</span>
              <strong>{algorithmGuidance[algorithm].rule}</strong>
              <p>{algorithmGuidance[algorithm].detail}</p>
            </div>
          </section>

          <section className="panel-section process-section">
            <div className="section-heading"><div><span className="step-number">02</span><h2>Define processes</h2></div><button className="text-button" onClick={loadExample}>Load example</button></div>
            <div className="process-table-head"><span>Process</span><span>Arrival</span><span>Service</span><span /></div>
            <div className="process-inputs">{processes.map((process, index) => <div className="process-row" key={`${index}-${process.color}`}>
              <label className="process-id-input"><span style={{ background: process.color }} /><input aria-label={`Process ${index + 1} ID`} maxLength={6} value={process.id} onChange={(event) => updateProcess(index, { id: event.target.value.toUpperCase() })} /></label>
              <input aria-label={`${process.id} arrival time`} type="number" min="0" value={process.arrivalTime} onChange={(event) => updateProcess(index, { arrivalTime: wholeNumber(event.target.value, 0) })} />
              <input aria-label={`${process.id} service time`} type="number" min="1" value={process.serviceTime} onChange={(event) => updateProcess(index, { serviceTime: wholeNumber(event.target.value, 1) })} />
              <button aria-label={`Remove ${process.id}`} className="remove-button" onClick={() => { resetPlayback(); setProcesses((current) => current.filter((_, processIndex) => processIndex !== index)); }}>×</button>
            </div>)}</div>
            <button className="add-button" onClick={addProcess}><span>＋</span>Add process</button>
            {validationError && <p className="validation-message" role="alert">{validationError}</p>}
            <details className="json-panel"><summary>Import or export JSON</summary><textarea aria-label="Scenario JSON" value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder={'{"processes": [...]}' } /><div className="json-actions"><button onClick={prepareJson}>Export</button><button onClick={importJson}>Import</button></div>{jsonMessage && <p>{jsonMessage}</p>}</details>
          </section>
        </aside>

        <section className="simulation-panel">
          <div className="control-strip">
            <div className="playback-controls" aria-label="Playback controls">
              <button onClick={() => { setStep(0); setPlaying(false); }} disabled={!snapshot || step === 0} aria-label="Reset to time zero">↺</button>
              <button onClick={() => { setPlaying(false); setStep((current) => Math.max(0, current - 1)); }} disabled={!snapshot || step === 0} aria-label="Previous time step">←</button>
              <button className="play-button" onClick={() => { if (!playing && step >= lastStep) setStep(0); setPlaying((current) => !current); }} disabled={!snapshot} aria-label={playing ? "Pause simulation" : "Play simulation"}>{playing ? "Ⅱ" : "▶"}</button>
              <button onClick={() => { setPlaying(false); setStep((current) => Math.min(lastStep, current + 1)); }} disabled={!snapshot || step === lastStep} aria-label="Next time step">→</button>
            </div>
            <div className="time-readout"><span>TIME</span><strong data-testid="time-value">{snapshot?.time ?? "—"}</strong><span>/ {lastStep}</span></div>
            <label className="speed-control">Speed<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="1400">Slow</option><option value="800">Normal</option><option value="400">Fast</option></select></label>
            <button className={`metrics-toggle ${showMetrics ? "active" : ""}`} aria-pressed={showMetrics} onClick={() => setShowMetrics((current) => !current)}>{showMetrics ? "Hide metrics" : "Metrics"}</button>
            <div className="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> step <kbd>space</kbd> play</div>
          </div>

          {!snapshot ? <div className="empty-state"><span>!</span><h2>Check the scenario</h2><p>{validationError}</p></div> : <>
            <div ref={dashboardRef} className={`dashboard-grid ${algorithm === "mlfq" ? "mlfq-dashboard" : ""} ${showMetrics ? "metrics-visible" : "metrics-hidden"}`} data-snapshot-time={snapshot.time} data-running-process={snapshot.running ?? ""} data-running-remaining={snapshot.runningRemaining ?? ""} data-motion-duration={motionDuration}>
            <div className="status-grid">
              <article className="cpu-card" data-running-process={snapshot.running ?? ""} data-running-queue={snapshot.runningQueueLevel ?? ""}><div className="card-label"><span className="live-dot" />CPU · RUNNING</div>
                {runningProcess && runningView ? <div className="running-content"><div
                  className="queue-chip cpu-process-card"
                  data-testid="cpu-process-card"
                  data-process-id={runningView.id}
                  data-state="running"
                  data-queue-level={runningView.queueLevel}
                  data-remaining={runningView.remainingTime}
                  data-allotment-used={algorithm === "mlfq" ? runningView.allotmentUsed : undefined}
                  data-quantum-used={algorithm === "rr" ? runningView.allotmentUsed : undefined}
                  data-motion-id={runningView.id}
                  data-motion-place="cpu"
                  data-motion-color={runningProcess.color}
                  style={{ "--process-color": runningProcess.color } as React.CSSProperties}
                >
                  <div className="cpu-process-heading"><strong>{runningView.id}</strong><em>ON CPU</em></div>
                  <span>{runningView.remainingTime} tick{runningView.remainingTime === 1 ? "" : "s"} remaining</span>
                  {algorithm === "mlfq" && <small>Q{runningView.queueLevel} · {runningView.allotmentUsed}/{mlfqQuanta[runningView.queueLevel]} allotment used</small>}
                  {algorithm === "rr" && <small>{runningView.allotmentUsed}/{quantum} quantum used</small>}
                  {(algorithm === "mlfq" || algorithm === "rr") && <i className="allotment-meter" aria-hidden="true"><b style={{ width: `${runningView.allotmentUsed / (algorithm === "mlfq" ? mlfqQuanta[runningView.queueLevel] : quantum) * 100}%` }} /></i>}
                </div><div className="cpu-process-copy"><p>Executing now</p><h2>Process {runningProcess.id}</h2><span>Only on the CPU—not in a ready queue</span></div></div> : <div className="idle-content"><div className="process-orb idle">—</div><div><p>Nothing dispatched</p><h2>CPU idle</h2><span>Waiting for work</span></div></div>}
                <div className="cpu-progress"><span style={{ width: runningProcess ? `${((runningProcess.serviceTime - (snapshot.runningRemaining ?? 0)) / runningProcess.serviceTime) * 100}%` : "0%", background: runningProcess?.color }} /></div>
              </article>
              <article className="event-card"><div className="card-label">AT THIS TIME BOUNDARY</div><div className="event-list" data-testid="event-list" data-event-count={snapshot.events.length}>{snapshot.events.length ? snapshot.events.map((event, index) => <p key={index}><span>{index + 1}</span>{event}</p>) : <p className="muted-event">No scheduling decision was needed.</p>}</div></article>
            </div>

            <section className="queue-section card-surface"><div className="card-title-row"><div><p className="eyebrow">READY STATE</p><h2>{algorithm === "mlfq" ? "Priority feedback map" : "Ready queue"}</h2></div><div className="queue-summary"><span data-testid="state-counts" data-new-count={futureCount} data-ready-count={waitingCount} data-finished-count={completedCount}>{futureCount} future · {waitingCount} waiting · <b data-motion-finish-target>{completedCount} finished</b></span>{algorithm === "mlfq" && <div className="boost-countdown" title={`Waiting processes return to Q0 in ${boostTicksRemaining} ticks`}><i className="boost-ring" style={{ "--boost-progress": `${boostProgress}%` } as React.CSSProperties}><b>{boostTicksRemaining}</b></i><span><strong>NEXT BOOST</strong><small>ticks remaining</small></span></div>}</div></div>
              <div className={algorithm === "mlfq" ? "multi-queues" : "single-queue"}>{snapshot.readyQueues.map((queue, queueIndex) => {
                const allotted = mlfqQuanta[queueIndex];
                return <div className="queue-row" key={queueIndex}>
                  {algorithm === "mlfq" && <div className="queue-label"><div><strong>Q{queueIndex}</strong></div><span>{queueIndex === 0 ? "Highest" : queueIndex === snapshot.readyQueues.length - 1 ? "Lowest" : "Medium"} · allotment {mlfqQuanta[queueIndex]}</span>{queueIndex < snapshot.readyQueues.length - 1 && <i className="demotion-cue">full allotment ↓</i>}</div>}
                  <div className="queue-track" data-testid={`ready-queue-${queueIndex}`} data-ready-ids={queue.join(",")}>
                    <span className="queue-head">HEAD</span>
                    {queue.length === 0 ? <span className="empty-queue">Queue empty</span> : queue.map((id) => { const process = processById.get(id)!; const view = snapshot.processes.find((item) => item.id === id); const used = view?.allotmentUsed ?? 0; return <div className={`queue-chip ${algorithm === "mlfq" ? "mlfq-queue-chip" : ""}`} data-process-id={id} data-state="ready" data-remaining={view?.remainingTime} data-allotment-used={algorithm === "mlfq" ? used : undefined} data-motion-id={id} data-motion-place={algorithm === "mlfq" ? `q${queueIndex}` : "ready"} data-motion-color={process.color} key={id} style={{ "--process-color": process.color } as React.CSSProperties} title={algorithm === "mlfq" ? `${id}: ${used} of ${allotted} ticks used at Q${queueIndex}` : undefined}><strong>{id}</strong><span>{view?.remainingTime} left{algorithm === "mlfq" ? ` · ${used}/${allotted} used` : ""}</span>{algorithm === "mlfq" && <i className="allotment-meter" aria-hidden="true"><b style={{ width: `${used / allotted * 100}%` }} /></i>}</div>; })}
                    <span className="queue-tail">TAIL</span>
                  </div>
                </div>;
              })}</div>
            </section>

            <section className="timeline-section card-surface"><div className="card-title-row"><div><p className="eyebrow">CPU HISTORY</p><h2>Execution timeline</h2></div><span>Click any tick to inspect</span></div>
              <div className="timeline-scroll"><div className="timeline-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, result.timeline.length)}, minmax(44px, 1fr))` }}>{result.timeline.map((slice) => {
                const process = slice.processId ? processById.get(slice.processId) : null;
                const isBoostBoundary = algorithm === "mlfq" && slice.time > 0 && slice.time % mlfqBoostInterval === 0;
                return <button
                  key={slice.time}
                  data-timeline-time={slice.time}
                  data-process-id={slice.processId ?? ""}
                  data-boost-boundary={isBoostBoundary ? "true" : undefined}
                  onClick={() => { setPlaying(false); setStep(Math.min(slice.time, lastStep)); }}
                  className={`timeline-cell ${slice.time > snapshot.time ? "future" : ""} ${slice.time === snapshot.time ? "active" : ""} ${isBoostBoundary ? "boost-tick" : ""}`}
                  aria-label={`Time ${slice.time}: ${slice.processId ? `process ${slice.processId}` : "idle"}${isBoostBoundary ? "; priority boost" : ""}`}
                >
                  <span className="tick-label">{slice.time}</span>
                  <span className="tick-block" style={{ background: process?.color ?? "#cbd0d8" }}>
                    {slice.processId ?? "idle"}
                  </span>
                  {isBoostBoundary && <span className="boost-marker" aria-hidden="true">BOOST</span>}
                </button>;
              })}<span className="timeline-end" style={{ gridColumn: result.timeline.length + 1 }}>{result.timeline.length}</span></div></div>
              <div className="timeline-legend">{processes.map((process) => <span key={process.id}><i style={{ background: process.color }} />{process.id}</span>)}<span><i className="idle-swatch" />Idle</span></div>
            </section>

            {showMetrics && <section className="metrics-section card-surface"><div className="card-title-row"><div><p className="eyebrow">PROCESS ACCOUNTING</p><h2>State & metrics</h2></div><div className="metric-summary" title={`${completedCount} of ${processes.length} processes complete`}><span><small>AVG W</small><strong>{averageWaiting}</strong></span><span><small>AVG R</small><strong>{averageResponse}</strong></span><span><small>AVG T</small><strong>{averageTurnaround}</strong></span></div></div><div className="metrics-scroll"><table><thead><tr><th>Process</th><th>State</th><th>Remaining</th>{algorithm === "mlfq" && <th>Q used</th>}<th>Waiting</th><th>Response</th><th>Turnaround</th></tr></thead><tbody>{snapshot.processes.map((process) => <tr key={process.id} data-process-id={process.id} data-state={process.state} data-remaining={process.remainingTime} data-queue-level={algorithm === "mlfq" ? process.queueLevel : undefined} data-allotment-used={algorithm === "mlfq" ? process.allotmentUsed : undefined}><td><i style={{ background: process.color }} />{process.id}</td><td><span className={`state-pill ${process.state}`}>{process.state}</span></td><td>{process.remainingTime}</td>{algorithm === "mlfq" && <td>{process.state === "finished" ? "—" : `${process.allotmentUsed}/${mlfqQuanta[process.queueLevel]}`}</td>}<td>{process.waitingTime}</td><td>{process.responseTime ?? "—"}</td><td>{process.turnaroundTime ?? "—"}</td></tr>)}</tbody></table></div></section>}
            </div>
          </>}
        </section>
      </div>
    </main>
  );
}

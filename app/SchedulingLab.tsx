"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Algorithm, ProcessDefinition, SchedulerVisualState, simulate, validateProcesses, validateSimulationConfig } from "../lib/simulator";
import { useTypedProcessMotion } from "./useTypedProcessMotion";

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
  const [speed, setSpeed] = useState(1400);
  const [showMetrics, setShowMetrics] = useState(initialShowMetrics);
  const [jsonText, setJsonText] = useState("");
  const [jsonMessage, setJsonMessage] = useState("");
  const [motionCue, setMotionCue] = useState<string | null>(null);
  const [motionSteps, setMotionSteps] = useState<string[]>([]);
  const [motionBusy, setMotionBusy] = useState(false);
  const [motionVisualState, setMotionVisualState] = useState<SchedulerVisualState | null>(null);
  const motionLock = useRef(false);
  const stepRef = useRef(step);
  const dashboardRef = useRef<HTMLDivElement>(null);

  let validationError = validateProcesses(processes);
  if (!validationError) {
    try {
      validateSimulationConfig({ algorithm, quantum, mlfqQuanta, mlfqBoostInterval });
    } catch (error) {
      validationError = error instanceof Error ? error.message : "Check the scheduling settings.";
    }
  }
  const result = useMemo(
    () => validationError ? { snapshots: [], timeline: [] } : simulate(processes, { algorithm, quantum, mlfqQuanta, mlfqBoostInterval }),
    [algorithm, mlfqBoostInterval, mlfqQuanta, processes, quantum, validationError],
  );
  const lastStep = Math.max(0, result.snapshots.length - 1);
  const snapshot = result.snapshots[Math.min(step, lastStep)];
  const displayState = motionVisualState ?? snapshot;
  const processById = useMemo(() => new Map(processes.map((process) => [process.id, process])), [processes]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const updateMotionBusy = useCallback((value: boolean) => {
    motionLock.current = value;
    setMotionBusy(value);
  }, []);

  const goToStep = useCallback((requestedStep: number, animate = true) => {
    const currentStep = stepRef.current;
    if (motionLock.current && animate) return false;
    const nextStep = Math.max(0, Math.min(lastStep, Math.floor(requestedStep)));
    if (nextStep === currentStep) {
      if (!animate) setMotionSteps([]);
      return false;
    }

    const adjacent = Math.abs(nextStep - currentStep) === 1;
    if (animate && adjacent) {
      const currentSnapshot = result.snapshots[currentStep];
      const targetSnapshot = result.snapshots[nextStep];
      setMotionVisualState(nextStep > currentStep
        ? targetSnapshot.transitionStart
        : currentSnapshot);
      updateMotionBusy(true);
    } else {
      setMotionVisualState(null);
      updateMotionBusy(false);
    }
    stepRef.current = nextStep;
    setStep(nextStep);
    return true;
  }, [lastStep, result.snapshots, updateMotionBusy]);

  useEffect(() => {
    if (!playing || step >= lastStep || motionBusy) return;
    const timer = window.setTimeout(() => {
      const nextStep = Math.min(lastStep, step + 1);
      goToStep(nextStep);
      if (nextStep >= lastStep) setPlaying(false);
    }, speed);
    return () => window.clearTimeout(timer);
  }, [goToStep, lastStep, motionBusy, playing, speed, step]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT", "SUMMARY"].includes(target.tagName)) return;
      if (event.key === "ArrowRight") { setPlaying(false); goToStep(stepRef.current + 1); }
      if (event.key === "ArrowLeft") { setPlaying(false); goToStep(stepRef.current - 1); }
      if (event.key === " ") {
        event.preventDefault();
        if (!snapshot || (motionLock.current && !playing)) return;
        if (!playing && stepRef.current >= lastStep) goToStep(0, false);
        setPlaying((current) => !current);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goToStep, lastStep, playing, snapshot]);

  const resetPlayback = () => {
    motionLock.current = false;
    stepRef.current = 0;
    setMotionBusy(false);
    setMotionVisualState(null);
    setMotionSteps([]);
    setStep(0);
    setPlaying(false);
  };
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

  const runningProcess = displayState?.running ? processById.get(displayState.running) : null;
  const runningView = displayState?.running ? displayState.processes.find((process) => process.id === displayState.running) : null;
  const completedCount = displayState?.processes.filter((process) => process.state === "finished").length ?? 0;
  const futureCount = displayState?.processes.filter((process) => process.state === "new").length ?? 0;
  const waitingCount = displayState?.readyQueues.flat().length ?? 0;
  const boostTicksRemaining = snapshot
    ? mlfqBoostInterval - (snapshot.time % mlfqBoostInterval)
    : mlfqBoostInterval;
  const boostProgress = snapshot
    ? (snapshot.time % mlfqBoostInterval) / mlfqBoostInterval * 100
    : 0;
  const averageWaiting = mean(displayState?.processes.map((process) => process.waitingTime) ?? []);
  const averageResponse = mean(displayState?.processes.flatMap((process) => process.responseTime === null ? [] : [process.responseTime]) ?? []);
  const averageTurnaround = mean(displayState?.processes.flatMap((process) => process.turnaroundTime === null ? [] : [process.turnaroundTime]) ?? []);
  const motionContext = useMemo(
    () => JSON.stringify({ algorithm, processes, quantum, mlfqQuanta, mlfqBoostInterval }),
    [algorithm, mlfqBoostInterval, mlfqQuanta, processes, quantum],
  );
  const motionFrame = snapshot
    ? `${snapshot.time}:${snapshot.running ?? "idle"}:${snapshot.readyQueues.map((queue) => queue.join(".")).join("|")}`
    : "invalid";
  const motionDuration = speed === 2000 ? 1800 : speed === 1400 ? 1200 : 650;
  useTypedProcessMotion(
    dashboardRef,
    motionFrame,
    motionContext,
    motionDuration,
    snapshot?.transitions ?? [],
    snapshot?.transitionStart ?? null,
    step,
    setMotionVisualState,
    setMotionCue,
    setMotionSteps,
    updateMotionBusy,
  );

  return (
    <main className="app-shell" aria-label="Scheduling Studio">
      <div className="workspace">
        <aside className="setup-panel" inert={motionBusy ? true : undefined}>
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
              <button onClick={() => { goToStep(0, false); setPlaying(false); }} disabled={!snapshot || step === 0 || motionBusy} aria-label="Reset to time zero">↺</button>
              <button onClick={() => { setPlaying(false); goToStep(stepRef.current - 1); }} disabled={!snapshot || step === 0 || motionBusy} aria-label="Previous time step">←</button>
              <button className="play-button" onClick={() => { if (!playing && step >= lastStep) goToStep(0, false); setPlaying((current) => !current); }} disabled={!snapshot || (motionBusy && !playing)} aria-label={playing ? "Pause simulation" : "Play simulation"}>{playing ? "Ⅱ" : "▶"}</button>
              <button onClick={() => { setPlaying(false); goToStep(stepRef.current + 1); }} disabled={!snapshot || step === lastStep || motionBusy} aria-label="Next time step">→</button>
            </div>
            <div className="time-readout"><span>TIME</span><strong data-testid="time-value">{snapshot?.time ?? "—"}</strong><span>/ {lastStep}</span></div>
            <div className="motion-cue-slot">
              {motionCue && <div className="motion-cue" role="status" aria-live="polite"><span>MOVING</span><strong>{motionCue}</strong></div>}
              {motionSteps.length > 0 && <details className="movement-review" key={`${motionContext}:${step}`} onToggle={(event) => { if (event.currentTarget.open) setPlaying(false); }}>
                <summary>{motionBusy ? "Review steps" : `Review movement · ${motionSteps.length} step${motionSteps.length === 1 ? "" : "s"}`}</summary>
                <div className="movement-review-panel"><p>Movement to t={snapshot?.time}</p><ol>{motionSteps.map((label, index) => <li key={index}>{label}</li>)}</ol><small>Available until you change the time or scenario.</small></div>
              </details>}
            </div>
            <label className="speed-control">Speed<select value={speed} disabled={motionBusy} onChange={(event) => setSpeed(Number(event.target.value))}><option value="2000">Slow</option><option value="1400">Normal</option><option value="850">Fast</option></select></label>
            <button className={`metrics-toggle ${showMetrics ? "active" : ""}`} disabled={motionBusy} aria-pressed={showMetrics} onClick={() => setShowMetrics((current) => !current)}>{showMetrics ? "Hide metrics" : "Metrics"}</button>
            <div className="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> step <kbd>space</kbd> play</div>
          </div>
          {!snapshot ? <div className="empty-state"><span>!</span><h2>Check the scenario</h2><p>{validationError}</p></div> : <>
            <div ref={dashboardRef} className={`dashboard-grid ${algorithm === "mlfq" ? "mlfq-dashboard" : ""} ${showMetrics ? "metrics-visible" : "metrics-hidden"}`} data-snapshot-time={snapshot.time} data-running-process={displayState?.running ?? ""} data-running-remaining={displayState?.runningRemaining ?? ""} data-motion-duration={motionDuration} data-motion-status={motionBusy ? "playing" : "idle"}>
            <div className="status-grid">
              <article className="cpu-card" data-running-process={displayState?.running ?? ""} data-running-queue={displayState?.runningQueueLevel ?? ""}><div className="card-label"><span className="live-dot" />CPU · RUNNING</div>
                {runningProcess && runningView ? <div className="running-content" data-motion-cpu-target><div
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
                  <strong>{runningView.id}</strong>
                  <span>{runningView.remainingTime} left</span>
                  {algorithm === "mlfq" && <small>Q{runningView.queueLevel} · {runningView.allotmentUsed}/{mlfqQuanta[runningView.queueLevel]}</small>}
                  {algorithm === "rr" && <small>{runningView.allotmentUsed}/{quantum} slice</small>}
                  {algorithm === "mlfq" && <i className="allotment-meter" aria-hidden="true"><b style={{ width: `${runningView.allotmentUsed / mlfqQuanta[runningView.queueLevel] * 100}%` }} /></i>}
                </div><div className="cpu-process-copy"><p>Executing now</p><h2>Process {runningProcess.id}</h2><span>{runningView.remainingTime} tick{runningView.remainingTime === 1 ? "" : "s"} remaining</span>{algorithm === "mlfq" && <small>Q{runningView.queueLevel} · {runningView.allotmentUsed}/{mlfqQuanta[runningView.queueLevel]} allotment used</small>}{algorithm === "rr" && <small>{runningView.allotmentUsed}/{quantum} quantum used</small>}</div></div> : <div className="idle-content" data-motion-cpu-target><div className="process-orb idle">—</div><div><p>Nothing dispatched</p><h2>CPU idle</h2><span>Waiting for work</span></div></div>}
                <div className="completion-dock" data-testid="completion-dock" data-motion-finish-target data-completed-count={completedCount} aria-label={`${completedCount} completed process${completedCount === 1 ? "" : "es"}`}><i aria-hidden="true">✓</i><span><small>COMPLETED</small><strong>{completedCount}</strong></span></div>
                <div className="cpu-progress"><span style={{ width: runningProcess ? `${((runningProcess.serviceTime - (displayState?.runningRemaining ?? 0)) / runningProcess.serviceTime) * 100}%` : "0%", background: runningProcess?.color }} /></div>
              </article>
              <article className="event-card"><div className="card-label">AT THIS TIME BOUNDARY · t={snapshot.time}</div><div className="event-list" data-testid="event-list" data-event-count={snapshot.events.length}>{snapshot.events.length ? snapshot.events.map((event, index) => <p key={index}><span>{index + 1}</span>{event}</p>) : <p className="muted-event">No scheduling decision was needed.</p>}</div></article>
            </div>

            <section className="queue-section card-surface"><div className="card-title-row"><div><p className="eyebrow">READY STATE</p><h2>{algorithm === "mlfq" ? "Ready queues" : "Ready queue"}</h2></div><div className="queue-summary"><span data-testid="state-counts" data-new-count={futureCount} data-ready-count={waitingCount} data-finished-count={completedCount}><b data-motion-future-target>{futureCount} future</b> · {waitingCount} waiting</span>{algorithm === "mlfq" && <div className="boost-countdown" title={`Waiting processes return to Q0 in ${boostTicksRemaining} ticks`}><i className="boost-ring" style={{ "--boost-progress": `${boostProgress}%` } as React.CSSProperties}><b>{boostTicksRemaining}</b></i><span><strong>NEXT BOOST</strong><small>ticks remaining</small></span></div>}</div></div>
              <div className={algorithm === "mlfq" ? "multi-queues" : "single-queue"}>{displayState?.readyQueues.map((queue, queueIndex) => {
                const allotted = mlfqQuanta[queueIndex];
                return <div className="queue-row" key={queueIndex}>
                  {algorithm === "mlfq" && <div className="queue-label"><div><strong>Q{queueIndex}</strong></div><span>{queueIndex === 0 ? "Highest" : queueIndex === (displayState?.readyQueues.length ?? 0) - 1 ? "Lowest" : "Medium"} priority</span><span>Allotment: {mlfqQuanta[queueIndex]} tick{mlfqQuanta[queueIndex] === 1 ? "" : "s"}</span>{queueIndex < (displayState?.readyQueues.length ?? 0) - 1 && <i className="demotion-cue">full allotment ↓</i>}</div>}
                  <div className="queue-track" data-testid={`ready-queue-${queueIndex}`} data-ready-ids={queue.join(",")}>
                    <span className="queue-head">HEAD</span>
                    {queue.length === 0 ? <span className="empty-queue">Queue empty</span> : queue.map((id) => { const process = processById.get(id)!; const view = displayState?.processes.find((item) => item.id === id); const used = view?.allotmentUsed ?? 0; return <div className={`queue-chip ${algorithm === "mlfq" ? "mlfq-queue-chip" : ""}`} data-process-id={id} data-state="ready" data-remaining={view?.remainingTime} data-allotment-used={algorithm === "mlfq" ? used : undefined} data-motion-id={id} data-motion-place={algorithm === "mlfq" ? `q${queueIndex}` : "ready"} data-motion-color={process.color} key={id} style={{ "--process-color": process.color } as React.CSSProperties} title={algorithm === "mlfq" ? `${id}: ${used} of ${allotted} ticks used at Q${queueIndex}` : undefined}><strong>{id}</strong><span>{view?.remainingTime} left</span>{algorithm === "mlfq" && <small>{used}/{allotted} used</small>}{algorithm === "mlfq" && <i className="allotment-meter" aria-hidden="true"><b style={{ width: `${used / allotted * 100}%` }} /></i>}</div>; })}
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
                  onClick={() => { setPlaying(false); goToStep(Math.min(slice.time, lastStep), false); }}
                  disabled={motionBusy}
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

            {showMetrics && <section className="metrics-section card-surface"><div className="card-title-row"><div><p className="eyebrow">PROCESS ACCOUNTING</p><h2>State & metrics</h2></div><div className="metric-summary" title={`${completedCount} of ${processes.length} processes complete`}><span><small>AVG W</small><strong>{averageWaiting}</strong></span><span><small>AVG R</small><strong>{averageResponse}</strong></span><span><small>AVG T</small><strong>{averageTurnaround}</strong></span></div></div><div className="metrics-scroll"><table><thead><tr><th>Process</th><th>State</th><th>Remaining</th>{algorithm === "mlfq" && <th>Q used</th>}<th>Waiting</th><th>Response</th><th>Turnaround</th></tr></thead><tbody>{displayState?.processes.map((process) => <tr key={process.id} data-process-id={process.id} data-state={process.state} data-remaining={process.remainingTime} data-queue-level={algorithm === "mlfq" ? process.queueLevel : undefined} data-allotment-used={algorithm === "mlfq" ? process.allotmentUsed : undefined}><td><i style={{ background: process.color }} />{process.id}</td><td><span className={`state-pill ${process.state}`}>{process.state}</span></td><td>{process.remainingTime}</td>{algorithm === "mlfq" && <td>{process.state === "finished" ? "—" : `${process.allotmentUsed}/${mlfqQuanta[process.queueLevel]}`}</td>}<td>{process.waitingTime}</td><td>{process.responseTime ?? "—"}</td><td>{process.turnaroundTime ?? "—"}</td></tr>)}</tbody></table></div></section>}
            </div>
          </>}
        </section>
      </div>
    </main>
  );
}

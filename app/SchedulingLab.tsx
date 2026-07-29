"use client";

import { useEffect, useMemo, useState } from "react";
import { Algorithm, ProcessDefinition, simulate, validateProcesses } from "../lib/simulator";

const palette = ["#10a37f", "#4d7cfe", "#8e63ce", "#d18b38", "#d15f5f", "#328ea8"];
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
    rule: "Always run the highest-priority non-empty queue.",
    detail: "An unfinished process that uses its full quantum moves down one level.",
  },
};

function wholeNumber(value: string, minimum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : minimum;
}

export default function SchedulingLab() {
  const [processes, setProcesses] = useState<ProcessDefinition[]>(exampleProcesses);
  const [algorithm, setAlgorithm] = useState<Algorithm>("rr");
  const [quantum, setQuantum] = useState(2);
  const [mlfqQuanta, setMlfqQuanta] = useState([1, 2, 4]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);
  const [jsonText, setJsonText] = useState("");
  const [jsonMessage, setJsonMessage] = useState("");

  const validationError = validateProcesses(processes);
  const result = useMemo(
    () => validationError ? { snapshots: [], timeline: [] } : simulate(processes, { algorithm, quantum, mlfqQuanta }),
    [algorithm, mlfqQuanta, processes, quantum, validationError],
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
      if (event.key === "ArrowRight") setStep((current) => Math.min(lastStep, current + 1));
      if (event.key === "ArrowLeft") setStep((current) => Math.max(0, current - 1));
      if (event.key === " ") { event.preventDefault(); setPlaying((current) => !current); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lastStep]);

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
  const completedCount = snapshot?.processes.filter((process) => process.state === "finished").length ?? 0;
  const newCount = snapshot?.processes.filter((process) => process.state === "new").length ?? 0;
  const readyCount = snapshot?.processes.filter((process) => process.state === "ready").length ?? 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><span>CPU</span><span>LAB</span></div>
        <div className="brand-copy"><p className="eyebrow">CSC369 · Operating Systems</p><h1>Scheduling Studio</h1></div>
        <div className="scope-badges">
          <span>1 CPU</span><span>Discrete time</span>
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
            {algorithm === "mlfq" && <div className="mlfq-settings"><p className="field-label">Quantum per priority queue</p>{mlfqQuanta.map((value, index) => <label key={index}>Q{index}<input type="number" min="1" value={value} onChange={(event) => { resetPlayback(); setMlfqQuanta((current) => current.map((item, itemIndex) => itemIndex === index ? wholeNumber(event.target.value, 1) : item)); }} /><span>ticks</span></label>)}</div>}
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
              <button onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={!snapshot || step === 0} aria-label="Previous time step">←</button>
              <button className="play-button" onClick={() => { if (step >= lastStep) setStep(0); setPlaying((current) => !current); }} disabled={!snapshot} aria-label={playing ? "Pause simulation" : "Play simulation"}>{playing ? "Ⅱ" : "▶"}</button>
              <button onClick={() => setStep((current) => Math.min(lastStep, current + 1))} disabled={!snapshot || step === lastStep} aria-label="Next time step">→</button>
            </div>
            <div className="time-readout"><span>TIME</span><strong data-testid="time-value">{snapshot?.time ?? "—"}</strong><span>/ {lastStep}</span></div>
            <label className="speed-control">Speed<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="1400">Slow</option><option value="800">Normal</option><option value="400">Fast</option></select></label>
            <div className="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> step <kbd>space</kbd> play</div>
          </div>

          {!snapshot ? <div className="empty-state"><span>!</span><h2>Check the scenario</h2><p>{validationError}</p></div> : <>
            <section className="state-flow" aria-label="Process lifecycle summary" data-testid="state-flow">
              <div className="flow-node"><span>NEW</span><strong>{newCount}</strong><small>Not arrived</small></div>
              <i aria-hidden="true">→</i>
              <div className="flow-node ready-node"><span>READY</span><strong>{readyCount}</strong><small>In queue</small></div>
              <i aria-hidden="true">→</i>
              <div className={`flow-node running-node ${snapshot.running ? "active" : ""}`}><span>RUNNING</span><strong>{snapshot.running ?? "—"}</strong><small>On CPU</small></div>
              <i aria-hidden="true">→</i>
              <div className="flow-node finished-node"><span>FINISHED</span><strong>{completedCount}</strong><small>Exited</small></div>
            </section>
            <div className={`dashboard-grid ${algorithm === "mlfq" ? "mlfq-dashboard" : ""}`}>
            <div className="status-grid">
              <article className="cpu-card"><div className="card-label"><span className="live-dot" />CPU · RUNNING</div>
                {runningProcess ? <div className="running-content"><div className="process-orb" style={{ background: runningProcess.color }}>{runningProcess.id}</div><div><p>Executing now</p><h2>Process {runningProcess.id}</h2><span>{snapshot.runningRemaining} tick{snapshot.runningRemaining === 1 ? "" : "s"} remaining{algorithm === "mlfq" ? ` · Q${snapshot.runningQueueLevel}` : ""}</span></div></div> : <div className="idle-content"><div className="process-orb idle">—</div><div><p>Nothing dispatched</p><h2>CPU idle</h2><span>Waiting for work</span></div></div>}
                <div className="cpu-progress"><span style={{ width: runningProcess ? `${((runningProcess.serviceTime - (snapshot.runningRemaining ?? 0)) / runningProcess.serviceTime) * 100}%` : "0%", background: runningProcess?.color }} /></div>
              </article>
              <article className="event-card"><div className="card-label">AT THIS TIME BOUNDARY</div><div className="event-list" data-testid="event-list">{snapshot.events.length ? snapshot.events.map((event, index) => <p key={index}><span>{index + 1}</span>{event}</p>) : <p className="muted-event">No scheduling decision was needed.</p>}</div></article>
            </div>

            <section className="queue-section card-surface"><div className="card-title-row"><div><p className="eyebrow">READY STATE</p><h2>{algorithm === "mlfq" ? "Priority queues" : "Ready queue"}</h2></div><span>{snapshot.readyQueues.flat().length} waiting</span></div>
              <div className={algorithm === "mlfq" ? "multi-queues" : "single-queue"}>{snapshot.readyQueues.map((queue, queueIndex) => <div className="queue-row" key={queueIndex}>
                {algorithm === "mlfq" && <div className="queue-label"><strong>Q{queueIndex}</strong><span>{queueIndex === 0 ? "Highest" : queueIndex === snapshot.readyQueues.length - 1 ? "Lowest" : "Medium"} priority · q={mlfqQuanta[queueIndex]}</span></div>}
                <div className="queue-track" data-testid={`ready-queue-${queueIndex}`}><span className="queue-head">HEAD</span>{queue.length === 0 ? <span className="empty-queue">Queue empty</span> : queue.map((id, index) => { const process = processById.get(id)!; return <div className="queue-chip" key={`${id}-${index}`} style={{ "--process-color": process.color } as React.CSSProperties}><strong>{id}</strong><span>{snapshot.processes.find((item) => item.id === id)?.remainingTime} left</span></div>; })}<span className="queue-tail">TAIL</span></div>
              </div>)}</div>
            </section>

            <section className="timeline-section card-surface"><div className="card-title-row"><div><p className="eyebrow">CPU HISTORY</p><h2>Execution timeline</h2></div><span>Click any tick to inspect</span></div>
              <div className="timeline-scroll"><div className="timeline-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, result.timeline.length)}, minmax(44px, 1fr))` }}>{result.timeline.map((slice) => { const process = slice.processId ? processById.get(slice.processId) : null; return <button key={slice.time} onClick={() => setStep(Math.min(slice.time, lastStep))} className={`timeline-cell ${slice.time > snapshot.time ? "future" : ""} ${slice.time === snapshot.time ? "active" : ""}`} aria-label={`Time ${slice.time}: ${slice.processId ? `process ${slice.processId}` : "idle"}`}><span className="tick-label">{slice.time}</span><span className="tick-block" style={{ background: process?.color ?? "#cbd0d8" }}>{slice.processId ?? "idle"}</span></button>; })}<span className="timeline-end" style={{ gridColumn: result.timeline.length + 1 }}>{result.timeline.length}</span></div></div>
              <div className="timeline-legend">{processes.map((process) => <span key={process.id}><i style={{ background: process.color }} />{process.id}</span>)}<span><i className="idle-swatch" />Idle</span></div>
            </section>

            <section className="metrics-section card-surface"><div className="card-title-row"><div><p className="eyebrow">PROCESS ACCOUNTING</p><h2>State & metrics</h2></div><span>{completedCount}/{processes.length} complete</span></div><div className="metrics-scroll"><table><thead><tr><th>Process</th><th>State</th><th>Remaining</th><th>Waiting</th><th>Response</th><th>Turnaround</th></tr></thead><tbody>{snapshot.processes.map((process) => <tr key={process.id}><td><i style={{ background: process.color }} />{process.id}</td><td><span className={`state-pill ${process.state}`}>{process.state}</span></td><td>{process.remainingTime}</td><td>{process.waitingTime}</td><td>{process.responseTime ?? "—"}</td><td>{process.turnaroundTime ?? "—"}</td></tr>)}</tbody></table></div></section>
            </div>
          </>}
        </section>
      </div>
    </main>
  );
}

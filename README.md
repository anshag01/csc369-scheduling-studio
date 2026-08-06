# CSC369 Scheduling Studio

[![Scheduler verification](https://github.com/anshag01/csc369-scheduling-studio/actions/workflows/scheduler-verification.yml/badge.svg)](https://github.com/anshag01/csc369-scheduling-studio/actions/workflows/scheduler-verification.yml)

An interactive, single-CPU scheduling visualizer based on the CSC369 scheduling lecture and instructor discussion.

## Included policies

- First Come, First Served (FCFS/FIFO)
- Shortest Job First (SJF)
- Shortest Time to Completion First (STCF)
- Round Robin (RR)
- Multilevel Feedback Queue (MLFQ)

The simulator runs entirely in the browser. Each student has an independent local simulation with no shared state or database.

## Features

- Editable process IDs, arrival times, and service times
- JSON scenario import and export
- Play, pause, reset, previous, and next-step controls
- Current CPU state and ordered ready queue visualization
- Multiple priority queues and demotion events for MLFQ
- Clickable execution timeline
- Step-by-step scheduling explanations
- Waiting, response, and turnaround metrics
- Keyboard controls and responsive layout

## Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Run the normal scheduling-engine tests with `npm run test:unit`, the independent large-workload suite with `npm run test:stress`, and the browser visualization suite with `npm run test:e2e` (after `npx playwright install chromium`). See [TESTING.md](TESTING.md) for the rule-to-test mapping and complete verification matrix.

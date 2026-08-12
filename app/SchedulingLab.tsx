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
  template: HTMLElement;
};

function useProcessMotion(
  rootRef: RefObject<HTMLDivElement | null>,
  frameKey: string,
  contextKey: string,
  duration: number,
  events: string[],
  step: number,
  setMotionCue: (value: string | null) => void,
  setMotionBusy: (value: boolean) => void,
) {
  const previous = useRef(new Map<string, MotionPoint>());
  const previousContext = useRef(contextKey);
  const previousStep = useRef(step);
  const previousEvents = useRef(events);
  const motionTimers = useRef<number[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    motionTimers.current.forEach((timer) => window.clearTimeout(timer));
    motionTimers.current = [];
    document.querySelectorAll<HTMLElement>("[data-motion-hidden]").forEach((element) => {
      element.style.visibility = "";
      element.removeAttribute("data-motion-hidden");
    });
    document.querySelectorAll(".process-motion-arrow, .process-motion-ghost, .process-motion-traveler").forEach((element) => element.remove());
    document.querySelectorAll(".process-is-moving").forEach((element) => element.classList.remove("process-is-moving"));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const direction = step >= previousStep.current ? "forward" : "backward";
    const transitionEvents = direction === "forward" ? events : previousEvents.current;
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-motion-id]")];
    const current = new Map<string, MotionPoint>();
    for (const node of nodes) {
      const id = node.dataset.motionId;
      if (!id) continue;
      current.set(id, {
        rect: node.getBoundingClientRect(),
        place: node.dataset.motionPlace ?? "unknown",
        color: node.dataset.motionColor ?? "#4f6bed",
        template: node.cloneNode(true) as HTMLElement,
      });
    }

    if (previousContext.current !== contextKey || previous.current.size === 0) {
      previous.current = current;
      previousContext.current = contextKey;
      previousStep.current = step;
      previousEvents.current = events;
      root.dataset.lastMotionCount = "0";
      root.dataset.lastMotionTypes = "";
      root.dataset.lastMotionLabels = "";
      setMotionCue(null);
      setMotionBusy(false);
      return;
    }

    // A timeline click can jump across several boundaries. Drawing one direct
    // transfer would falsely imply that the skipped intermediate states never
    // happened, so only adjacent forward/backward steps receive route motion.
    if (Math.abs(step - previousStep.current) !== 1) {
      previous.current = current;
      previousStep.current = step;
      previousEvents.current = events;
      root.dataset.lastMotionCount = "0";
      root.dataset.lastMotionTypes = "";
      root.dataset.lastMotionLabels = "";
      setMotionCue(null);
      setMotionBusy(false);
      return;
    }

    const movements: string[] = [];
    type Action = "dispatch" | "demote" | "boost" | "preempt" | "rotate" | "yield" | "finish" | "arrive" | "reorder" | "return";
    const eventAction = (event: string): Action | null => {
      if (event.includes("finished and left")) return "finish";
      if (event.includes("full allotment")) return "demote";
      if (event.includes("quantum expired")) return "rotate";
      if (event.includes("gave up the CPU")) return "yield";
      if (event.startsWith("Priority boost")) return "boost";
      if (event.includes(" arrived and joined")) return "arrive";
      if (event.includes("preempted")) return "preempt";
      if (event.includes("was selected")) return "dispatch";
      return null;
    };
    const stageOrder: Action[] = [];
    for (const event of transitionEvents) {
      const action = eventAction(event);
      if (action && !stageOrder.includes(action)) stageOrder.push(action);
    }
    if (direction === "backward") stageOrder.reverse();
    const ensureStage = (action: Action) => {
      if (!stageOrder.includes(action)) stageOrder.push(action);
      return stageOrder.indexOf(action);
    };
    const stageDuration = Math.min(1900, Math.max(800, duration));
    const stageGap = 130;
    const stageSchedule = (action: Action) => ({
      delay: ensureStage(action) * (stageDuration + stageGap),
      duration: stageDuration,
    });
    const transitionDuration = () => stageOrder.length === 0
      ? 0
      : stageOrder.length * stageDuration + Math.max(0, stageOrder.length - 1) * stageGap;
    const cueGroups = new Map<Action, { ids: Set<string>; destinations: Set<string>; reverse: boolean }>();
    const arrowGroups = new Map<Action, { arrow: HTMLDivElement; marker: HTMLButtonElement; detail: HTMLSpanElement }>();
    const placeLabel = (place: string) => {
      if (place === "cpu") return "CPU";
      if (place === "ready") return "ready tail";
      if (place === "finished") return "finished";
      if (place === "future") return "not arrived";
      return place.toUpperCase();
    };
    const classify = (id: string, from: string, to: string): Action => {
      const relevant = transitionEvents.filter((event) =>
        event.startsWith(`${id} `) || event.startsWith(`${id}'s `),
      ).join(" ");
      if (to === "finished") return "finish";
      if (from === "future") return "arrive";
      if (to === "cpu") return "dispatch";
      if (from === "cpu") {
        if (relevant.includes("preempted")) return "preempt";
        if (relevant.includes("gave up the CPU")) return "yield";
        if (relevant.includes("quantum expired")) return "rotate";
        if (relevant.includes("full allotment")) return "demote";
        return "return";
      }
      if (to === "q0" && transitionEvents.some((event) => event.startsWith("Priority boost moved"))) return "boost";
      if (from === to) return "reorder";
      return "return";
    };
    const actionLabel = (action: Action) => ({
      dispatch: "DISPATCH",
      demote: "DEMOTE",
      boost: "PRIORITY BOOST",
      preempt: "PREEMPT",
      rotate: "QUANTUM EXPIRED",
      yield: "YIELD",
      finish: "FINISH",
      arrive: "ARRIVE",
      reorder: "QUEUE ROTATION",
      return: "RETURN",
    })[action];
    const center = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const queuePoint = (place: string) => {
      const queueIndex = place === "ready" ? 0 : Number(place.slice(1));
      const queue = root.querySelector<HTMLElement>(`[data-testid="ready-queue-${queueIndex}"]`);
      if (!queue) return null;
      const rect = queue.getBoundingClientRect();
      return { x: rect.left + Math.min(rect.width * .32, 125), y: rect.top + rect.height / 2 };
    };
    const showArrow = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      id: string,
      action: Action,
      reverse = false,
    ) => {
      const schedule = stageSchedule(action);
      if (arrowGroups.has(action)) return schedule;
      const deltaX = to.x - from.x;
      const deltaY = to.y - from.y;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < 12) return schedule;
      // Give simultaneous opposite-direction transfers their own visual lanes.
      // Since the perpendicular reverses with the arrow direction, CPU -> queue
      // and queue -> CPU no longer draw directly on top of one another.
      const laneOffset = Math.min(14, Math.max(9, distance * .035));
      const normalX = -deltaY / distance * laneOffset;
      const normalY = deltaX / distance * laneOffset;
      const guideLength = Math.min(distance, 180);
      const start = {
        x: to.x - deltaX / distance * guideLength + normalX,
        y: to.y - deltaY / distance * guideLength + normalY,
      };
      const angle = Math.atan2(deltaY, deltaX);
      const arrow = document.createElement("div");
      arrow.className = `process-motion-arrow action-${action}`;
      arrow.dataset.motionAction = action;
      arrow.dataset.motionProcessId = id;
      arrow.setAttribute("role", "presentation");
      arrow.style.left = `${start.x}px`;
      arrow.style.top = `${start.y}px`;
      arrow.style.width = `${guideLength}px`;
      arrow.style.transform = `rotate(${angle}rad)`;
      arrow.style.setProperty("--label-counter-rotate", `${-angle}rad`);
      const line = document.createElement("i");
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "process-motion-info";
      const stageNumber = document.createElement("b");
      stageNumber.textContent = String(ensureStage(action) + 1);
      const detail = document.createElement("span");
      detail.textContent = `${reverse ? "UNDO " : ""}${actionLabel(action)} · ${id}`;
      marker.append(stageNumber, detail);
      arrow.append(line, marker);
      document.body.appendChild(arrow);
      arrowGroups.set(action, { arrow, marker, detail });
      // The arrow is a stationary route guide. Only the process card moves.
      // Reveal it shortly before that stage's card motion and remove it when
      // the stage ends; do not animate the line or arrowhead themselves.
      arrow.style.opacity = "0";
      arrow.style.visibility = "hidden";
      const revealTimer = window.setTimeout(() => {
        arrow.style.opacity = "1";
        arrow.style.visibility = "visible";
      }, schedule.delay);
      const removeTimer = window.setTimeout(() => arrow.remove(), schedule.delay + schedule.duration);
      motionTimers.current.push(revealTimer, removeTimer);
      return schedule;
    };
    const recordCue = (id: string, action: Action, destination: string, reverse = false) => {
      ensureStage(action);
      const group = cueGroups.get(action) ?? { ids: new Set<string>(), destinations: new Set<string>(), reverse };
      group.ids.add(id);
      group.destinations.add(placeLabel(destination));
      cueGroups.set(action, group);
    };
    const cueText = (action: Action) => {
      const group = cueGroups.get(action);
      if (!group) return "";
      const ids = [...group.ids];
      const subject = ids.length <= 3 ? ids.join(", ") : `${ids.slice(0, 3).join(", ")} +${ids.length - 3}`;
      const destinations = [...group.destinations].join(" / ");
      return `${subject} ${group.reverse ? "undoes " : ""}${actionLabel(action).toLowerCase()} → ${destinations}`;
    };
    if (!reducedMotion) {
      const arrowLead = Math.min(210, Math.max(130, stageDuration * .16));
      const rectAround = (point: { x: number; y: number }, width: number, height: number) =>
        new DOMRect(point.x - width / 2, point.y - height / 2, width, height);
      const createTraveler = (template: HTMLElement, source: DOMRect, target?: HTMLElement) => {
        const traveler = template.cloneNode(true) as HTMLElement;
        traveler.querySelectorAll("[data-motion-id], [data-testid]").forEach((element) => {
          element.removeAttribute("data-motion-id");
          element.removeAttribute("data-testid");
        });
        traveler.removeAttribute("data-motion-id");
        traveler.removeAttribute("data-testid");
        traveler.classList.add("process-motion-traveler", "process-is-moving");
        traveler.setAttribute("aria-hidden", "true");
        traveler.style.left = `${source.left}px`;
        traveler.style.top = `${source.top}px`;
        traveler.style.width = `${source.width}px`;
        traveler.style.height = `${source.height}px`;
        document.body.appendChild(traveler);
        if (target) {
          target.style.visibility = "hidden";
          target.dataset.motionHidden = "true";
        }
        return traveler;
      };
      const finishTraveler = (traveler: HTMLElement, target?: HTMLElement) => {
        traveler.remove();
        if (target) {
          target.style.visibility = "";
          target.removeAttribute("data-motion-hidden");
          target.classList.add("process-just-landed");
          const landingTimer = window.setTimeout(() => target.classList.remove("process-just-landed"), 360);
          motionTimers.current.push(landingTimer);
        }
      };
      const centeredTranslation = (source: DOMRect, destination: DOMRect) => ({
        x: destination.left + destination.width / 2 - (source.left + source.width / 2),
        y: destination.top + destination.height / 2 - (source.top + source.height / 2),
      });
      const travelCard = (
        template: HTMLElement,
        source: DOMRect,
        destination: DOMRect,
        target: HTMLElement | undefined,
        schedule: { delay: number; duration: number },
      ) => {
        const traveler = createTraveler(template, source, target);
        const delta = centeredTranslation(source, destination);
        const animation = traveler.animate(
          [
            { transform: "translate(0, 0)" },
            { transform: `translate(${delta.x}px, ${delta.y}px)` },
          ],
          {
            delay: schedule.delay + arrowLead,
            duration: schedule.duration - arrowLead,
            fill: "both",
            easing: "cubic-bezier(.2,.75,.2,1)",
          },
        );
        animation.finished.finally(() => finishTraveler(traveler, target));
        return traveler;
      };
      const queueSlotRect = (place: string, index: number, width: number, height: number) => {
        const queueIndex = place === "ready" ? 0 : Number(place.slice(1));
        const track = root.querySelector<HTMLElement>(`[data-testid="ready-queue-${queueIndex}"]`);
        if (!track) return rectAround(queuePoint(place) ?? { x: 0, y: 0 }, width, height);
        const trackRect = track.getBoundingClientRect();
        const head = track.querySelector<HTMLElement>(".queue-head")?.getBoundingClientRect();
        const left = trackRect.left + 11 + (head?.width ?? 8) + 8 + index * (width + 8);
        return new DOMRect(left, trackRect.top + (trackRect.height - height) / 2, width, height);
      };
      const travelStages = (
        template: HTMLElement,
        source: DOMRect,
        target: HTMLElement,
        stages: Array<{ action: Action; destination: DOMRect; lag?: number }>,
      ) => {
        const traveler = createTraveler(template, source, target);
        const total = Math.max(...stages.map(({ action }) => {
          const schedule = stageSchedule(action);
          return schedule.delay + schedule.duration;
        }));
        const keyframes: Keyframe[] = [{ transform: "translate(0, 0)", offset: 0 }];
        let previousTransform = "translate(0, 0)";
        for (const { action, destination, lag = 0 } of stages) {
          const schedule = stageSchedule(action);
          const startOffset = Math.min(.98, (schedule.delay + arrowLead + lag) / total);
          const endOffset = Math.min(1, (schedule.delay + schedule.duration * .8) / total);
          keyframes.push({ transform: previousTransform, offset: startOffset, easing: "cubic-bezier(.2,.75,.2,1)" });
          const delta = centeredTranslation(source, destination);
          previousTransform = `translate(${delta.x}px, ${delta.y}px)`;
          keyframes.push({ transform: previousTransform, offset: endOffset });
        }
        if ((keyframes.at(-1)?.offset ?? 0) < 1) keyframes.push({ transform: previousTransform, offset: 1 });
        const animation = traveler.animate(keyframes, { duration: total, fill: "both", easing: "linear" });
        animation.finished.finally(() => finishTraveler(traveler, target));
      };
      const previousQueueEntries = (place: string) => [...previous.current.entries()]
        .filter(([, point]) => point.place === place)
        .sort(([, left], [, right]) => left.rect.left - right.rect.left);
      const boostHappened = transitionEvents.some((event) => event.startsWith("Priority boost moved"));
      const boostedWaiting = [...previous.current.entries()]
        .filter(([, point]) => /^q\d+$/.test(point.place))
        .sort(([, left], [, right]) => {
          const levelDifference = Number(left.place.slice(1)) - Number(right.place.slice(1));
          return levelDifference || left.rect.left - right.rect.left;
        });
      const reverseBoostedWaiting = [...current.entries()]
        .filter(([, point]) => /^q\d+$/.test(point.place))
        .sort(([, left], [, right]) => {
          const levelDifference = Number(left.place.slice(1)) - Number(right.place.slice(1));
          return levelDifference || left.rect.left - right.rect.left;
        });
      for (const node of nodes) {
        const id = node.dataset.motionId;
        const next = id ? current.get(id) : null;
        const before = id ? previous.current.get(id) : null;
        if (!id || !next) continue;

        if (!before) {
          const destination = center(next.rect);
          if (direction === "backward") {
            const source = { x: Math.min(window.innerWidth - 36, destination.x + 180), y: destination.y };
            const schedule = showArrow(source, destination, id, "finish", true);
            travelCard(next.template, rectAround(source, next.rect.width, next.rect.height), next.rect, node, schedule);
            movements.push(`finished->${next.place}`);
            recordCue(id, "finish", next.place, true);
          } else if (next.place === "cpu") {
            const waitingPlace = root.querySelector('[data-testid="ready-queue-0"]') ? (root.querySelector(".multi-queues") ? "q0" : "ready") : "ready";
            const queue = queuePoint(waitingPlace) ?? { x: destination.x, y: destination.y + 55 };
            const source = { x: queue.x, y: queue.y - 42 };
            const arrivalSchedule = showArrow(source, queue, id, "arrive");
            const dispatchSchedule = showArrow(queue, destination, id, "dispatch");
            const routeDuration = dispatchSchedule.delay + dispatchSchedule.duration;
            const queueArrival = Math.min(.78, (arrivalSchedule.delay + arrivalSchedule.duration * .78) / routeDuration);
            const queueDeparture = Math.max(queueArrival, dispatchSchedule.delay / routeDuration);
            const sourceRect = rectAround(source, next.rect.width, next.rect.height);
            const traveler = createTraveler(next.template, sourceRect, node);
            const queueDelta = centeredTranslation(sourceRect, rectAround(queue, next.rect.width, next.rect.height));
            const cpuDelta = centeredTranslation(sourceRect, next.rect);
            const animation = traveler.animate(
              [
                { opacity: 0, transform: "translate(0, 0)", offset: 0 },
                { opacity: 1, transform: `translate(${queueDelta.x}px, ${queueDelta.y}px)`, offset: queueArrival },
                { opacity: 1, transform: `translate(${queueDelta.x}px, ${queueDelta.y}px)`, offset: queueDeparture, easing: "cubic-bezier(.2,.75,.2,1)" },
                { opacity: 1, transform: `translate(${cpuDelta.x}px, ${cpuDelta.y}px)`, offset: 1 },
              ],
              { duration: routeDuration, fill: "both", easing: "linear" },
            );
            animation.finished.finally(() => finishTraveler(traveler, node));
            movements.push(`arrival->${waitingPlace}->cpu`);
            recordCue(id, "arrive", waitingPlace);
            recordCue(id, "dispatch", "cpu");
          } else {
            const source = { x: destination.x, y: destination.y - 42 };
            const schedule = showArrow(source, destination, id, "arrive");
            travelCard(next.template, rectAround(source, next.rect.width, next.rect.height), next.rect, node, schedule);
            movements.push(`arrival->${next.place}`);
            recordCue(id, "arrive", next.place);
          }
          continue;
        }

        if (direction === "forward" && boostHappened && /^q\d+$/.test(before.place)) {
          const boostIndex = boostedWaiting.findIndex(([processId]) => processId === id);
          const intermediate = queueSlotRect("q0", Math.max(0, boostIndex), before.rect.width, before.rect.height);
          const boostSchedule = showArrow(center(before.rect), center(intermediate), id, "boost");
          recordCue(id, "boost", "q0");
          const stages: Array<{ action: Action; destination: DOMRect; lag?: number }> = [{ action: "boost", destination: intermediate }];
          if (next.place === "cpu") {
            showArrow(center(intermediate), center(next.rect), id, "dispatch");
            recordCue(id, "dispatch", "cpu");
            stages.push({ action: "dispatch", destination: next.rect });
            movements.push(`${before.place}->q0->cpu`);
          } else {
            const dispatchFollows = stageOrder.indexOf("dispatch") > stageOrder.indexOf("boost");
            const needsCompaction = Math.abs(intermediate.left - next.rect.left) > 1 || Math.abs(intermediate.top - next.rect.top) > 1;
            if (dispatchFollows && needsCompaction) stages.push({ action: "dispatch", destination: next.rect, lag: Math.min(180, stageDuration * .12) });
            movements.push(`${before.place}->q0`);
          }
          travelStages(before.template, before.rect, node, stages);
          void boostSchedule;
          continue;
        }

        if (
          direction === "backward" && boostHappened && /^q\d+$/.test(next.place) &&
          (before.place === "q0" || before.place === "cpu")
        ) {
          const boostIndex = reverseBoostedWaiting.findIndex(([processId]) => processId === id);
          if (boostIndex >= 0) {
            const intermediate = queueSlotRect("q0", boostIndex, next.rect.width, next.rect.height);
            const stages: Array<{ action: Action; destination: DOMRect }> = [];
            if (stageOrder.includes("dispatch")) {
              if (before.place === "cpu") {
                showArrow(center(before.rect), center(intermediate), id, "dispatch", true);
                recordCue(id, "dispatch", "q0", true);
              }
              stages.push({ action: "dispatch", destination: intermediate });
            }
            showArrow(center(intermediate), center(next.rect), id, "boost", true);
            recordCue(id, "boost", next.place, true);
            stages.push({ action: "boost", destination: next.rect });
            travelStages(before.template, before.rect, node, stages);
            movements.push(`${before.place}->q0->${next.place}`);
            continue;
          }
        }

        const deltaX = before.rect.left - next.rect.left;
        const deltaY = before.rect.top - next.rect.top;
        const scaleX = before.rect.width / Math.max(1, next.rect.width);
        const scaleY = before.rect.height / Math.max(1, next.rect.height);
        if (before.place === next.place && next.place === "cpu") continue;
        if (before.place === next.place && Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1 && Math.abs(scaleX - 1) < .02 && Math.abs(scaleY - 1) < .02) continue;

        const forwardFrom = direction === "forward" ? before.place : next.place;
        const forwardTo = direction === "forward" ? next.place : before.place;
        const action = classify(id, forwardFrom, forwardTo);
        if (direction === "backward" && action === "rotate" && before.place === "ready" && next.place === "cpu") {
          const intermediate = queueSlotRect("ready", previousQueueEntries("ready").length, before.rect.width, before.rect.height);
          showArrow(center(intermediate), center(next.rect), id, action, true);
          recordCue(id, action, "cpu", true);
          const stages: Array<{ action: Action; destination: DOMRect }> = [];
          if (stageOrder.includes("dispatch")) stages.push({ action: "dispatch", destination: intermediate });
          stages.push({ action, destination: next.rect });
          travelStages(before.template, before.rect, node, stages);
          movements.push(`${before.place}->${next.place}`);
          continue;
        }
        if (direction === "forward" && action === "rotate" && next.place === "ready") {
          const arrivalsBeforeExpiry = nodes.filter((candidate) => {
            const candidateId = candidate.dataset.motionId;
            return candidateId && !previous.current.has(candidateId) && candidateId !== id;
          }).length;
          const intermediateIndex = previousQueueEntries("ready").length + arrivalsBeforeExpiry;
          const intermediate = queueSlotRect("ready", intermediateIndex, next.rect.width, next.rect.height);
          const schedule = showArrow(center(before.rect), center(intermediate), id, action, false);
          recordCue(id, action, "ready", false);
          const stages: Array<{ action: Action; destination: DOMRect }> = [{ action, destination: intermediate }];
          if (stageOrder.indexOf("dispatch") > stageOrder.indexOf(action)) stages.push({ action: "dispatch", destination: next.rect });
          travelStages(before.template, before.rect, node, stages);
          movements.push(`${before.place}->${next.place}`);
          void schedule;
          continue;
        }
        const schedule = showArrow(center(before.rect), center(next.rect), id, action, direction === "backward");
        recordCue(id, action, next.place, direction === "backward");
        travelCard(before.template, before.rect, next.rect, node, schedule);
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
        const processEvent = transitionEvents.find((event) =>
          event.startsWith(`${id} `) || event.startsWith(`${id}'s `),
        );
        if (!processEvent) continue;

        const demotion = processEvent.match(/(?:moved from Q\d+ to|returned to) Q(\d+)/);
        const yieldLevel = processEvent.match(/gave up the CPU one tick early at Q(\d+)/);
        const destinations: string[] = [];
        let firstAction: Action;
        if (demotion) { destinations.push(`q${demotion[1]}`); firstAction = "demote"; }
        else if (yieldLevel) { destinations.push(`q${yieldLevel[1]}`); firstAction = "yield"; }
        else if (processEvent.includes("quantum expired")) { destinations.push("ready"); firstAction = "rotate"; }
        else continue;

        const wasBoosted = transitionEvents.some((event) => event.startsWith("Priority boost moved"));
        if (wasBoosted && destinations.at(-1) !== "q0") destinations.push("q0");

        const visualDestinations = direction === "forward" ? destinations : [...destinations].reverse();
        const forwardActions: Action[] = [firstAction];
        if (destinations.length > 1) forwardActions.push("boost");
        forwardActions.push("dispatch");
        const visualActions = direction === "forward" ? forwardActions : [...forwardActions].reverse();
        const routePoints = [center(before.rect), ...visualDestinations.map((destination) => queuePoint(destination) ?? center(next.rect)), center(next.rect)];
        for (let index = 0; index < routePoints.length - 1; index += 1) {
          const destination = index < visualDestinations.length ? visualDestinations[index] : "cpu";
          showArrow(routePoints[index], routePoints[index + 1], id, visualActions[index], direction === "backward");
          recordCue(id, visualActions[index], destination, direction === "backward");
        }

        const routeDuration = transitionDuration();
        const traveler = createTraveler(before.template, before.rect, node);
        const sourceCenter = center(before.rect);
        const keyframes: Keyframe[] = [
          { transform: "translate(0, 0)", offset: 0 },
          { transform: "translate(0, 0)", offset: Math.min(.3, arrowLead / routeDuration), easing: "cubic-bezier(.2,.75,.2,1)" },
        ];
        visualDestinations.forEach((destination, index) => {
          const target = queuePoint(destination) ?? center(next.rect);
          const schedule = stageSchedule(visualActions[index]);
          keyframes.push({
            transform: `translate(${target.x - sourceCenter.x}px, ${target.y - sourceCenter.y}px)`,
            offset: Math.min(.9, (schedule.delay + schedule.duration * .78) / routeDuration),
            easing: "cubic-bezier(.2,.75,.2,1)",
          });
        });
        const finalDelta = centeredTranslation(before.rect, next.rect);
        keyframes.push({
          transform: `translate(${finalDelta.x}px, ${finalDelta.y}px)`,
          offset: 1,
        });
        const animation = traveler.animate(keyframes, { duration: routeDuration, fill: "both", easing: "linear" });
        animation.finished.finally(() => finishTraveler(traveler, node));
        movements.push(`cpu->${visualDestinations.join("->")}->cpu`);
      }

      for (const [id, before] of previous.current) {
        if (current.has(id)) continue;
        const action: Action = direction === "forward" ? "finish" : "arrive";
        const source = center(before.rect);
        const destination = direction === "forward"
          ? { x: Math.min(window.innerWidth - 36, source.x + 180), y: source.y }
          : { x: source.x, y: Math.max(36, source.y - 58) };
        const deltaX = destination.x - source.x;
        const deltaY = destination.y - source.y;
        const schedule = showArrow(source, destination, id, action, direction === "backward");
        const traveler = createTraveler(before.template, before.rect);
        recordCue(id, action, direction === "forward" ? "finished" : "future", direction === "backward");
        const animation = traveler.animate(
          [
            { opacity: 1, transform: "translate(0, 0)" },
            { opacity: .08, transform: `translate(${deltaX}px, ${deltaY}px)` },
          ],
          { delay: schedule.delay + arrowLead, duration: schedule.duration - arrowLead, fill: "backwards", easing: "cubic-bezier(.4,0,.2,1)" },
        );
        animation.finished.finally(() => finishTraveler(traveler));
        movements.push(`${before.place}->${direction === "forward" ? "finished" : "future"}`);
      }
    }

    for (const [action, group] of arrowGroups) {
      const cue = cueGroups.get(action);
      if (!cue) continue;
      const ids = [...cue.ids].join(", ");
      const destinations = [...cue.destinations].join(" / ");
      const detail = `${cue.reverse ? "UNDO " : ""}${actionLabel(action)} · ${ids} → ${destinations.toUpperCase()}`;
      group.detail.textContent = detail;
      group.marker.setAttribute("aria-label", detail);
      group.arrow.dataset.motionDetail = detail;
    }
    const orderedCues = stageOrder.filter((action) => cueGroups.has(action));
    const cueLabels = orderedCues.map((action) => cueText(action));
    root.dataset.lastMotionCount = String(movements.length);
    root.dataset.lastMotionTypes = movements.join(",");
    root.dataset.lastMotionLabels = cueLabels.join(" | ");
    root.dispatchEvent(new CustomEvent("scheduling-motion", { detail: movements }));
    if (orderedCues.length > 0 && !reducedMotion) {
      setMotionCue(cueText(orderedCues[0]));
      setMotionBusy(true);
      orderedCues.slice(1).forEach((action) => {
        const timer = window.setTimeout(() => setMotionCue(cueText(action)), stageSchedule(action).delay);
        motionTimers.current.push(timer);
      });
      const totalDuration = Math.max(...orderedCues.map((action) => {
        const schedule = stageSchedule(action);
        return schedule.delay + schedule.duration;
      }));
      const finishTimer = window.setTimeout(() => {
        setMotionBusy(false);
        setMotionCue(null);
      }, totalDuration + 80);
      motionTimers.current.push(finishTimer);
    } else {
      setMotionCue(null);
      setMotionBusy(false);
    }
    previous.current = current;
    previousContext.current = contextKey;
    previousStep.current = step;
    previousEvents.current = events;

    return () => {
      motionTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, [contextKey, duration, events, frameKey, rootRef, setMotionBusy, setMotionCue, step]);
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
  const [speed, setSpeed] = useState(1400);
  const [showMetrics, setShowMetrics] = useState(initialShowMetrics);
  const [jsonText, setJsonText] = useState("");
  const [jsonMessage, setJsonMessage] = useState("");
  const [motionCue, setMotionCue] = useState<string | null>(null);
  const [motionBusy, setMotionBusy] = useState(false);
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
    if (!playing || step >= lastStep || motionBusy) return;
    const timer = window.setTimeout(() => {
      const nextStep = Math.min(lastStep, step + 1);
      setStep(nextStep);
      if (nextStep >= lastStep) setPlaying(false);
    }, speed);
    return () => window.clearTimeout(timer);
  }, [lastStep, motionBusy, playing, speed, step]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowRight" && !motionBusy) { setPlaying(false); setStep((current) => Math.min(lastStep, current + 1)); }
      if (event.key === "ArrowLeft" && !motionBusy) { setPlaying(false); setStep((current) => Math.max(0, current - 1)); }
      if (event.key === " ") {
        event.preventDefault();
        if (!snapshot) return;
        if (!playing && step >= lastStep) setStep(0);
        setPlaying((current) => !current);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lastStep, motionBusy, playing, snapshot, step]);

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
  const motionDuration = Math.min(1900, Math.max(800, speed - 50));
  useProcessMotion(dashboardRef, motionFrame, motionContext, motionDuration, snapshot?.events ?? [], step, setMotionCue, setMotionBusy);

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
              <button onClick={() => { setStep(0); setPlaying(false); }} disabled={!snapshot || step === 0 || motionBusy} aria-label="Reset to time zero">↺</button>
              <button onClick={() => { setPlaying(false); setStep((current) => Math.max(0, current - 1)); }} disabled={!snapshot || step === 0 || motionBusy} aria-label="Previous time step">←</button>
              <button className="play-button" onClick={() => { if (!playing && step >= lastStep) setStep(0); setPlaying((current) => !current); }} disabled={!snapshot} aria-label={playing ? "Pause simulation" : "Play simulation"}>{playing ? "Ⅱ" : "▶"}</button>
              <button onClick={() => { setPlaying(false); setStep((current) => Math.min(lastStep, current + 1)); }} disabled={!snapshot || step === lastStep || motionBusy} aria-label="Next time step">→</button>
            </div>
            <div className="time-readout"><span>TIME</span><strong data-testid="time-value">{snapshot?.time ?? "—"}</strong><span>/ {lastStep}</span></div>
            <label className="speed-control">Speed<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="2000">Slow</option><option value="1400">Normal</option><option value="850">Fast</option></select></label>
            <button className={`metrics-toggle ${showMetrics ? "active" : ""}`} aria-pressed={showMetrics} onClick={() => setShowMetrics((current) => !current)}>{showMetrics ? "Hide metrics" : "Metrics"}</button>
            <div className="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> step <kbd>space</kbd> play</div>
          </div>
          {motionCue && <div className="motion-cue" role="status" aria-live="polite"><span>MOVING</span><strong>{motionCue}</strong></div>}

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
                  <strong>{runningView.id}</strong>
                  <span>{runningView.remainingTime} left{algorithm === "mlfq" ? ` · ${runningView.allotmentUsed}/${mlfqQuanta[runningView.queueLevel]} used` : ""}</span>
                  {algorithm === "mlfq" && <i className="allotment-meter" aria-hidden="true"><b style={{ width: `${runningView.allotmentUsed / mlfqQuanta[runningView.queueLevel] * 100}%` }} /></i>}
                </div><div className="cpu-process-copy"><p>Executing now</p><h2>Process {runningProcess.id}</h2><span>{runningView.remainingTime} tick{runningView.remainingTime === 1 ? "" : "s"} remaining</span>{algorithm === "mlfq" && <small>Q{runningView.queueLevel} · {runningView.allotmentUsed}/{mlfqQuanta[runningView.queueLevel]} allotment used</small>}{algorithm === "rr" && <small>{runningView.allotmentUsed}/{quantum} quantum used</small>}</div></div> : <div className="idle-content"><div className="process-orb idle">—</div><div><p>Nothing dispatched</p><h2>CPU idle</h2><span>Waiting for work</span></div></div>}
                <div className="cpu-progress"><span style={{ width: runningProcess ? `${((runningProcess.serviceTime - (snapshot.runningRemaining ?? 0)) / runningProcess.serviceTime) * 100}%` : "0%", background: runningProcess?.color }} /></div>
              </article>
              <article className="event-card"><div className="card-label">AT THIS TIME BOUNDARY</div><div className="event-list" data-testid="event-list" data-event-count={snapshot.events.length}>{snapshot.events.length ? snapshot.events.map((event, index) => <p key={index}><span>{index + 1}</span>{event}</p>) : <p className="muted-event">No scheduling decision was needed.</p>}</div></article>
            </div>

            <section className="queue-section card-surface"><div className="card-title-row"><div><p className="eyebrow">READY STATE</p><h2>{algorithm === "mlfq" ? "Priority feedback map" : "Ready queue"}</h2></div><div className="queue-summary"><span data-testid="state-counts" data-new-count={futureCount} data-ready-count={waitingCount} data-finished-count={completedCount}><b data-motion-future-target>{futureCount} future</b> · {waitingCount} waiting · <b data-motion-finish-target>{completedCount} finished</b></span>{algorithm === "mlfq" && <div className="boost-countdown" title={`Waiting processes return to Q0 in ${boostTicksRemaining} ticks`}><i className="boost-ring" style={{ "--boost-progress": `${boostProgress}%` } as React.CSSProperties}><b>{boostTicksRemaining}</b></i><span><strong>NEXT BOOST</strong><small>ticks remaining</small></span></div>}</div></div>
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

            {showMetrics && <section className="metrics-section card-surface"><div className="card-title-row"><div><p className="eyebrow">PROCESS ACCOUNTING</p><h2>State & metrics</h2></div><div className="metric-summary" title={`${completedCount} of ${processes.length} processes complete`}><span><small>AVG W</small><strong>{averageWaiting}</strong></span><span><small>AVG R</small><strong>{averageResponse}</strong></span><span><small>AVG T</small><strong>{averageTurnaround}</strong></span></div></div><div className="metrics-scroll"><table><thead><tr><th>Process</th><th>State</th><th>Remaining</th>{algorithm === "mlfq" && <th>Q used</th>}<th>Waiting</th><th>Response</th><th>Turnaround</th></tr></thead><tbody>{snapshot.processes.map((process) => <tr key={process.id} data-process-id={process.id} data-state={process.state} data-remaining={process.remainingTime} data-queue-level={algorithm === "mlfq" ? process.queueLevel : undefined} data-allotment-used={algorithm === "mlfq" ? process.allotmentUsed : undefined}><td><i style={{ background: process.color }} />{process.id}</td><td><span className={`state-pill ${process.state}`}>{process.state}</span></td><td>{process.remainingTime}</td>{algorithm === "mlfq" && <td>{process.state === "finished" ? "—" : `${process.allotmentUsed}/${mlfqQuanta[process.queueLevel]}`}</td>}<td>{process.waitingTime}</td><td>{process.responseTime ?? "—"}</td><td>{process.turnaroundTime ?? "—"}</td></tr>)}</tbody></table></div></section>}
            </div>
          </>}
        </section>
      </div>
    </main>
  );
}

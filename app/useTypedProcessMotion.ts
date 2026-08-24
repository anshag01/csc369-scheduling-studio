"use client";

import { RefObject, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import {
  ProcessLocation,
  SchedulerVisualState,
  TransitionAction,
  TransitionPhase,
} from "../lib/simulator";

type MotionPoint = {
  rect: DOMRect;
  place: string;
  template: HTMLElement;
};

type PhasePlan = {
  action: TransitionAction;
  moves: TransitionPhase["moves"];
  after: SchedulerVisualState;
  reverse: boolean;
};

type TravelRoute = {
  keyframes: Keyframe[];
  lane: number;
  kind: "standard" | "ready-corridor";
  guide?: {
    source: { x: number; y: number };
    target: { x: number; y: number };
  };
};

const actionLabel: Record<TransitionAction, string> = {
  finish: "FINISH",
  yield: "YIELD",
  rotate: "QUANTUM EXPIRED",
  demote: "DEMOTE",
  boost: "PRIORITY BOOST",
  arrive: "ARRIVE",
  preempt: "PREEMPT",
  dispatch: "DISPATCH",
};

function placeLabel(place: ProcessLocation["place"]) {
  if (place === "cpu") return "CPU";
  if (place === "ready") return "ready queue";
  if (place === "future") return "not arrived";
  if (place === "finished") return "completed";
  return place.toUpperCase();
}

function visualState(snapshot: SchedulerVisualState): SchedulerVisualState {
  return {
    running: snapshot.running,
    readyQueues: snapshot.readyQueues.map((queue) => [...queue]),
    processes: snapshot.processes.map((process) => ({ ...process })),
    runningRemaining: snapshot.runningRemaining,
    runningQueueLevel: snapshot.runningQueueLevel,
  };
}

function center(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function cardRectAt(rect: DOMRect, width: number, height: number) {
  const point = center(rect);
  return new DOMRect(point.x - width / 2, point.y - height / 2, width, height);
}

function findMotionNode(root: HTMLElement, processId: string) {
  return [...root.querySelectorAll<HTMLElement>("[data-motion-id]")]
    .find((node) => node.dataset.motionId === processId);
}

function clearArtifacts() {
  document.querySelectorAll<HTMLElement>("[data-motion-hidden]").forEach((element) => {
    element.style.visibility = "";
    element.removeAttribute("data-motion-hidden");
  });
  document.querySelectorAll(".process-motion-arrow, .process-motion-traveler, .process-motion-ghost, .process-motion-target-slot")
    .forEach((element) => element.remove());
  document.querySelectorAll(".process-is-moving")
    .forEach((element) => element.classList.remove("process-is-moving"));
  document.querySelectorAll<HTMLElement>(".process-motion-target")
    .forEach((element) => {
      element.classList.remove("process-motion-target");
      element.removeAttribute("data-motion-target-for");
    });
  document.querySelectorAll(".process-layout-shift")
    .forEach((element) => element.classList.remove("process-layout-shift"));
  document.querySelectorAll(".process-motion-bystander")
    .forEach((element) => element.classList.remove("process-motion-bystander"));
  document.querySelectorAll(".process-just-landed")
    .forEach((element) => element.classList.remove("process-just-landed"));
  document.querySelectorAll(".completion-just-received")
    .forEach((element) => element.classList.remove("completion-just-received"));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isSingleReadyPlace(place: string) {
  return place === "ready";
}

function travelRoute(
  sourceRect: DOMRect,
  targetRect: DOMRect,
  fromPlace: string,
  toPlace: string,
  lane: number,
  normal: { x: number; y: number },
  bounds: DOMRect,
  moveCount: number,
  fadesIn: boolean,
  fadesOut: boolean,
): TravelRoute {
  const sourceCenter = center(sourceRect);
  const targetCenter = center(targetRect);
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;

  // CPU/queue transfers use an L-shaped air corridor. A return moves across
  // the open CPU row before dropping into its queue slot; dispatch performs
  // the exact reverse. This keeps the card away from intervening ready jobs.
  if (fromPlace === "cpu" && isSingleReadyPlace(toPlace)) {
    const horizontal = Math.abs(deltaX);
    const vertical = Math.abs(deltaY);
    if (horizontal >= 2 && vertical >= 2) {
      const corner = { x: targetCenter.x, y: sourceCenter.y };
      return {
        lane: 0,
        kind: "ready-corridor",
        guide: { source: corner, target: targetCenter },
        keyframes: [
          { opacity: 1, transform: "translate(0, 0)", offset: 0 },
          {
            opacity: 1,
            transform: `translate(${deltaX}px, 0)`,
            offset: horizontal / (horizontal + vertical),
          },
          { opacity: 1, transform: `translate(${deltaX}px, ${deltaY}px)`, offset: 1 },
        ],
      };
    }
  }
  if (isSingleReadyPlace(fromPlace) && toPlace === "cpu") {
    const horizontal = Math.abs(deltaX);
    const vertical = Math.abs(deltaY);
    if (horizontal >= 2 && vertical >= 2) {
      const corner = { x: sourceCenter.x, y: targetCenter.y };
      return {
        lane: 0,
        kind: "ready-corridor",
        guide: { source: corner, target: targetCenter },
        keyframes: [
          { opacity: 1, transform: "translate(0, 0)", offset: 0 },
          {
            opacity: 1,
            transform: `translate(0, ${deltaY}px)`,
            offset: vertical / (horizontal + vertical),
          },
          { opacity: 1, transform: `translate(${deltaX}px, ${deltaY}px)`, offset: 1 },
        ],
      };
    }
  }

  // A phase remains one atomic scheduling event, but concurrent cards fan out
  // through stable visual lanes so one process never fully masks another.
  // Reversing both the move order and route direction produces the same bend.
  const fan = moveCount > 1
    ? Math.min(
      168,
      Math.max(sourceRect.width, targetRect.width) * (moveCount - 1) / 2 + 14,
    )
    : 0;
  const rawMidX = sourceCenter.x + deltaX * .5 + normal.x * fan * lane;
  const rawMidY = sourceCenter.y + deltaY * .5 + normal.y * fan * lane;
  const halfWidth = Math.max(sourceRect.width, targetRect.width) / 2;
  const halfHeight = Math.max(sourceRect.height, targetRect.height) / 2;
  const midX = clamp(rawMidX, bounds.left + halfWidth + 8, bounds.right - halfWidth - 8);
  const midY = clamp(rawMidY, bounds.top + halfHeight + 8, bounds.bottom - halfHeight - 8);

  return {
    lane,
    kind: "standard",
    keyframes: [
      { opacity: fadesIn ? .08 : 1, transform: "translate(0, 0)", offset: 0 },
      {
        opacity: 1,
        transform: `translate(${midX - sourceCenter.x}px, ${midY - sourceCenter.y}px)`,
        offset: .5,
      },
      {
        opacity: fadesOut ? .08 : 1,
        transform: `translate(${deltaX}px, ${deltaY}px)`,
        offset: 1,
      },
    ],
  };
}

function batchRouteLanes(routes: Array<{ sourceRect: DOMRect; targetRect: DOMRect }>) {
  if (routes.length === 0) return { lanes: [] as number[], normal: { x: 0, y: 1 } };

  const direction = routes.reduce((sum, route) => {
    const source = center(route.sourceRect);
    const target = center(route.targetRect);
    return { x: sum.x + target.x - source.x, y: sum.y + target.y - source.y };
  }, { x: 0, y: 0 });
  const distance = Math.hypot(direction.x, direction.y);
  const normal = distance < 1
    ? { x: 0, y: 1 }
    : { x: -direction.y / distance, y: direction.x / distance };
  const projections = routes.map((route, index) => {
    const source = center(route.sourceRect);
    const target = center(route.targetRect);
    const midpoint = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
    return { index, projection: midpoint.x * normal.x + midpoint.y * normal.y };
  });
  const ranked = [...projections].sort((left, right) =>
    left.projection - right.projection || left.index - right.index,
  );
  const middle = (routes.length - 1) / 2;
  const lanes = Array<number>(routes.length).fill(0);
  ranked.forEach((route, rank) => {
    lanes[route.index] = middle === 0 ? 0 : (rank - middle) / middle;
  });
  return { lanes, normal };
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function phaseText(phase: PhasePlan, phaseIndex: number, phaseCount: number) {
  const ids = phase.moves.map((move) => move.processId);
  const subject = ids.length <= 4
    ? ids.join(", ")
    : `${ids.slice(0, 4).join(", ")} +${ids.length - 4}`;
  const destinations = [...new Set(phase.moves.map((move) => placeLabel(move.to.place)))].join(" / ");
  return `Step ${phaseIndex + 1} of ${phaseCount} · ${phase.reverse ? "undo " : ""}${actionLabel[phase.action].toLowerCase()} ${subject} → ${destinations}`;
}

function addGuide(
  phase: PhasePlan,
  phaseIndex: number,
  phaseCount: number,
  sources: Map<string, MotionPoint>,
  targets: Map<string, DOMRect>,
  routeGuides: Map<string, NonNullable<TravelRoute["guide"]>>,
) {
  const routes = phase.moves.flatMap((move) => {
    const override = routeGuides.get(move.processId);
    if (override) {
      return Math.hypot(
        override.target.x - override.source.x,
        override.target.y - override.source.y,
      ) >= 16 ? [override] : [];
    }
    const source = sources.get(move.processId)?.rect;
    const target = targets.get(move.processId);
    if (!source || !target) return [];
    const sourceCenter = center(source);
    const targetCenter = center(target);
    return Math.hypot(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y) >= 16
      ? [{ source: sourceCenter, target: targetCenter }]
      : [];
  });
  if (routes.length === 0) return null;

  const average = (key: "source" | "target") => ({
    x: routes.reduce((sum, route) => sum + route[key].x, 0) / routes.length,
    y: routes.reduce((sum, route) => sum + route[key].y, 0) / routes.length,
  });
  const source = average("source");
  const target = average("target");
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 16) return null;

  const length = Math.min(distance, 165);
  const start = {
    x: target.x - deltaX / distance * length,
    y: target.y - deltaY / distance * length,
  };
  const angle = Math.atan2(deltaY, deltaX);
  const guide = document.createElement("div");
  guide.className = `process-motion-arrow action-${phase.action}`;
  guide.dataset.motionAction = phase.action;
  guide.dataset.motionPhaseIndex = String(phaseIndex);
  guide.dataset.motionProcessId = phase.moves.map((move) => move.processId).join(",");
  guide.dataset.motionRoute = routeGuides.size > 0 ? "ready-corridor" : "standard";
  guide.style.left = `${start.x}px`;
  guide.style.top = `${start.y}px`;
  guide.style.width = `${length}px`;
  guide.style.transform = `rotate(${angle}rad)`;
  guide.style.setProperty("--label-counter-rotate", `${-angle}rad`);
  guide.setAttribute("role", "presentation");

  const line = document.createElement("i");
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = "process-motion-info";
  const number = document.createElement("b");
  number.textContent = String(phaseIndex + 1);
  const detail = document.createElement("span");
  const label = phaseText(phase, phaseIndex, phaseCount);
  detail.textContent = label;
  marker.setAttribute("aria-label", label);
  marker.append(number, detail);
  guide.append(line, marker);
  guide.dataset.motionDetail = label;
  document.body.appendChild(guide);
  return guide;
}

function sourceForMissingCard(
  root: HTMLElement,
  location: ProcessLocation,
  width: number,
  height: number,
  counterpart?: DOMRect,
) {
  if (location.place === "future" && counterpart) {
    return new DOMRect(
      counterpart.left,
      Math.max(8, counterpart.top - height - 18),
      width,
      height,
    );
  }
  const selector = location.place === "future"
    ? "[data-motion-future-target]"
    : location.place === "finished"
      ? "[data-motion-finish-target]"
      : location.place === "cpu"
        ? "[data-motion-cpu-target]"
        : null;
  const anchor = selector ? root.querySelector<HTMLElement>(selector) : null;
  return anchor
    ? cardRectAt(anchor.getBoundingClientRect(), width, height)
    : new DOMRect(window.innerWidth / 2 - width / 2, 24, width, height);
}

export function useTypedProcessMotion(
  rootRef: RefObject<HTMLDivElement | null>,
  frameKey: string,
  contextKey: string,
  duration: number,
  transitions: TransitionPhase[],
  transitionStart: SchedulerVisualState | null,
  step: number,
  setVisualState: (value: SchedulerVisualState | null) => void,
  setMotionCue: (value: string | null) => void,
  setMotionBusy: (value: boolean) => void,
) {
  const previousContext = useRef(contextKey);
  const previousStep = useRef(step);
  const previousTransitions = useRef(transitions);
  const previousTransitionStart = useRef(transitionStart);
  const controller = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    controller.current?.abort();
    controller.current = new AbortController();
    const signal = controller.current.signal;
    const ownedAnimations = new Set<Animation>();
    clearArtifacts();

    if (!root) {
      setVisualState(null);
      setMotionCue(null);
      setMotionBusy(false);
      return;
    }

    const snapToAuthoritativeState = () => {
      ownedAnimations.forEach((animation) => animation.cancel());
      ownedAnimations.clear();
      clearArtifacts();
      setVisualState(null);
      setMotionCue(null);
      root.dataset.motionStatus = "idle";
      root.dataset.motionPhase = "";
      root.dataset.motionPhaseIndex = "";
      root.dataset.motionPhaseState = "";
      setMotionBusy(false);
    };
    const cancelForGeometryChange = () => {
      if (root.dataset.motionStatus !== "playing") return;
      controller.current?.abort();
      snapToAuthoritativeState();
      removeGeometryListeners();
    };
    const removeGeometryListeners = () => {
      window.removeEventListener("resize", cancelForGeometryChange);
      window.removeEventListener("scroll", cancelForGeometryChange, true);
    };
    const direction = step >= previousStep.current ? "forward" : "backward";
    const adjacent = Math.abs(step - previousStep.current) === 1;
    const sameContext = previousContext.current === contextKey;
    const sourceTransitions = direction === "forward" ? transitions : previousTransitions.current;
    const sourceStart = direction === "forward" ? transitionStart : previousTransitionStart.current;

    let phases: PhasePlan[] = [];
    if (direction === "forward") {
      phases = sourceTransitions.map((phase) => ({ ...phase, reverse: false }));
    } else if (sourceStart) {
      phases = [...sourceTransitions].reverse().map((phase, reverseIndex) => {
        const originalIndex = sourceTransitions.length - 1 - reverseIndex;
        const after = originalIndex === 0
          ? sourceStart
          : sourceTransitions[originalIndex - 1].after;
        return {
          action: phase.action,
          reverse: true,
          moves: [...phase.moves].reverse().map((move) => ({
            processId: move.processId,
            from: move.to,
            to: move.from,
          })),
          after: visualState(after),
        };
      });
    }

    previousContext.current = contextKey;
    previousStep.current = step;
    previousTransitions.current = transitions;
    previousTransitionStart.current = transitionStart;

    root.dataset.motionDirection = direction;
    root.dataset.motionBoundary = direction === "forward"
      ? `${step - 1}->${step}`
      : `${step + 1}->${step}`;

    if (!sameContext || !adjacent || phases.length === 0) {
      root.dataset.motionStatus = "idle";
      root.dataset.motionPhase = "";
      root.dataset.motionPhaseIndex = "";
      root.dataset.motionPhaseState = "";
      root.dataset.motionPhaseCount = "0";
      root.dataset.lastMotionCount = "0";
      root.dataset.lastMotionTypes = "";
      root.dataset.lastMotionLabels = "";
      setVisualState(null);
      setMotionCue(null);
      setMotionBusy(false);
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const phaseDuration = Math.min(1250, Math.max(460, duration));
    const guideLead = Math.min(170, Math.max(90, phaseDuration * .16));
    const moveDuration = phaseDuration - guideLead;
    const gapDuration = 120;
    const labels = phases.map((phase, index) => phaseText(phase, index, phases.length));
    const movementTypes = phases.flatMap((phase) => phase.moves.map((move) =>
      `${move.from.place}->${move.to.place}`,
    ));
    root.dataset.motionPhaseCount = String(phases.length);
    root.dataset.lastMotionCount = String(phases.reduce((count, phase) => count + phase.moves.length, 0));
    root.dataset.lastMotionTypes = movementTypes.join(",");
    root.dataset.lastMotionLabels = labels.join(" | ");

    if (reducedMotion) {
      for (const [phaseIndex, phase] of phases.entries()) {
        root.dispatchEvent(new CustomEvent("scheduling-motion-phase", {
          detail: {
            action: phase.action,
            direction,
            index: phaseIndex,
            count: phases.length,
            moves: phase.moves,
            reducedMotion: true,
          },
        }));
      }
      root.dataset.motionStatus = "idle";
      root.dataset.motionPhase = "";
      root.dataset.motionPhaseIndex = "";
      root.dataset.motionPhaseState = "";
      setVisualState(null);
      setMotionCue(null);
      setMotionBusy(false);
      return;
    }

    root.dataset.motionStatus = "playing";
    setMotionBusy(true);
    window.addEventListener("resize", cancelForGeometryChange);
    window.addEventListener("scroll", cancelForGeometryChange, true);

    const run = async () => {
      for (const [phaseIndex, phase] of phases.entries()) {
        if (signal.aborted) return;
        const label = phaseText(phase, phaseIndex, phases.length);
        root.dataset.motionPhase = "";
        root.dataset.motionPhaseIndex = "";
        root.dataset.motionPhaseState = "preparing";
        setMotionCue(label);

        const layoutSources = new Map<string, MotionPoint>();
        for (const node of root.querySelectorAll<HTMLElement>("[data-motion-id]")) {
          const processId = node.dataset.motionId;
          if (!processId) continue;
          layoutSources.set(processId, {
            rect: node.getBoundingClientRect(),
            place: node.dataset.motionPlace ?? "unknown",
            template: node.cloneNode(true) as HTMLElement,
          });
        }
        const sources = new Map<string, MotionPoint>();
        for (const move of phase.moves) {
          const point = layoutSources.get(move.processId);
          if (point) sources.set(move.processId, point);
        }

        // Yield out of the layout effect before forcing the authoritative
        // destination state into the DOM. flushSync then lets us hide targets,
        // create travelers, and reserve compacting queue slots before paint,
        // eliminating destination flashes and overlapping cards.
        await Promise.resolve();
        if (signal.aborted) return;
        flushSync(() => setVisualState(visualState(phase.after)));

        const targets = new Map<string, DOMRect>();
        const routeGuides = new Map<string, NonNullable<TravelRoute["guide"]>>();
        const travelers: HTMLElement[] = [];
        const targetSlots: HTMLElement[] = [];
        const animations: Animation[] = [];
        const movingIds = new Set(phase.moves.map((move) => move.processId));

        for (const node of root.querySelectorAll<HTMLElement>("[data-motion-id]")) {
          const processId = node.dataset.motionId;
          if (
            processId &&
            !movingIds.has(processId) &&
            node.dataset.motionPlace !== "cpu"
          ) {
            node.classList.add("process-motion-bystander");
          }
        }

        if (!reducedMotion) {
          for (const node of root.querySelectorAll<HTMLElement>("[data-motion-id]")) {
            const processId = node.dataset.motionId;
            const before = processId ? layoutSources.get(processId) : null;
            if (!processId || !before || movingIds.has(processId)) continue;
            if (before.place !== (node.dataset.motionPlace ?? "unknown")) continue;
            const after = node.getBoundingClientRect();
            const deltaX = before.rect.left - after.left;
            const deltaY = before.rect.top - after.top;
            if (Math.hypot(deltaX, deltaY) < 1) continue;
            node.classList.add("process-layout-shift");
            const leavesQueue = phase.moves.some((move) =>
              /^(ready|q\d+)$/.test(move.from.place) && !/^(ready|q\d+)$/.test(move.to.place),
            );
            const entersQueue = phase.moves.some((move) =>
              !/^(ready|q\d+)$/.test(move.from.place) && /^(ready|q\d+)$/.test(move.to.place),
            );
            // A follower must retain a departing card's source slot until that
            // card has cleared it. Insertions do the opposite: existing cards
            // make room during the guide lead, before the traveler starts.
            const holdOffset = leavesQueue ? .72 : .22;
            const clearanceOffset = Math.max(.08, (guideLead - 24) / phaseDuration);
            const keyframes = entersQueue
              ? [
                { transform: `translate(${deltaX}px, ${deltaY}px)`, offset: 0 },
                { transform: "translate(0, 0)", offset: clearanceOffset },
                { transform: "translate(0, 0)", offset: 1 },
              ]
              : [
                { transform: `translate(${deltaX}px, ${deltaY}px)`, offset: 0 },
                { transform: `translate(${deltaX}px, ${deltaY}px)`, offset: holdOffset },
                { transform: "translate(0, 0)", offset: 1 },
              ];
            const animation = node.animate(keyframes, {
              duration: phaseDuration,
              fill: "both",
              easing: "cubic-bezier(.2,.75,.2,1)",
            });
            animation.finished.finally(() => node.classList.remove("process-layout-shift")).catch(() => undefined);
            ownedAnimations.add(animation);
            animations.push(animation);
          }
        }

        const routeInputs = phase.moves.flatMap((move) => {
          const targetNode = findMotionNode(root, move.processId);
          const knownSource = sources.get(move.processId);
          const template = knownSource?.template ?? (targetNode?.cloneNode(true) as HTMLElement | undefined);
          if (!template) return [];
          const width = knownSource?.rect.width ?? targetNode?.getBoundingClientRect().width ?? 96;
          const height = knownSource?.rect.height ?? targetNode?.getBoundingClientRect().height ?? 52;
          const targetRect = targetNode?.getBoundingClientRect()
            ?? sourceForMissingCard(root, move.to, width, height, knownSource?.rect);
          const sourceRect = knownSource?.rect
            ?? sourceForMissingCard(root, move.from, width, height, targetRect);
          const sourceCenter = center(sourceRect);
          const targetCenter = center(targetRect);
          return Math.hypot(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y) < 2
            ? []
            : [{
              processId: move.processId,
              sourceRect,
              targetRect,
              fromPlace: move.from.place,
              toPlace: move.to.place,
            }];
        });
        const batchRouting = batchRouteLanes(routeInputs);
        const mixedRouteKinds = new Set(routeInputs.map((route) =>
          `${route.fromPlace}->${route.toPlace}`,
        )).size > 1;
        const trafficStagger = mixedRouteKinds
          ? Math.min(520, Math.max(300, moveDuration * .46))
          : 0;
        const routeByProcess = new Map(routeInputs.map((route, routeIndex) => [
          route.processId,
          { lane: batchRouting.lanes[routeIndex], order: routeIndex },
        ]));

        for (const [moveIndex, move] of phase.moves.entries()) {
          const targetNode = findMotionNode(root, move.processId);
          const knownSource = sources.get(move.processId);
          const template = knownSource?.template ?? (targetNode?.cloneNode(true) as HTMLElement | undefined);
          if (!template) continue;
          const width = knownSource?.rect.width ?? targetNode?.getBoundingClientRect().width ?? 96;
          const height = knownSource?.rect.height ?? targetNode?.getBoundingClientRect().height ?? 52;
          const targetRect = targetNode?.getBoundingClientRect() ?? sourceForMissingCard(root, move.to, width, height, knownSource?.rect);
          const sourceRect = knownSource?.rect ?? sourceForMissingCard(root, move.from, width, height, targetRect);
          if (!knownSource) {
            sources.set(move.processId, { rect: sourceRect, place: move.from.place, template });
          }
          targets.set(move.processId, targetRect);

          const sourceCenter = center(sourceRect);
          const targetCenter = center(targetRect);
          if (Math.hypot(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y) < 2) {
            targetNode?.classList.add("process-just-landed");
            continue;
          }
          if (reducedMotion) continue;

          const traveler = template.cloneNode(true) as HTMLElement;
          traveler.querySelectorAll("[data-motion-id], [data-testid]").forEach((element) => {
            element.removeAttribute("data-motion-id");
            element.removeAttribute("data-testid");
          });
          traveler.removeAttribute("data-motion-id");
          traveler.removeAttribute("data-testid");
          traveler.classList.remove(
            "process-just-landed",
            "completion-just-received",
            "process-layout-shift",
            "process-motion-target",
          );
          traveler.removeAttribute("data-motion-hidden");
          traveler.removeAttribute("data-motion-target-for");
          traveler.classList.add("process-motion-traveler", "process-is-moving");
          traveler.dataset.processId = move.processId;
          traveler.dataset.motionAction = phase.action;
          traveler.dataset.motionFrom = move.from.place;
          traveler.dataset.motionTo = move.to.place;
          traveler.setAttribute("aria-hidden", "true");
          traveler.style.left = `${sourceRect.left}px`;
          traveler.style.top = `${sourceRect.top}px`;
          traveler.style.width = `${sourceRect.width}px`;
          traveler.style.height = `${sourceRect.height}px`;
          if (move.to.place === "finished") {
            traveler.classList.add("process-completing");
            traveler.dataset.motionDestination = "completed";
          }
          document.body.appendChild(traveler);
          travelers.push(traveler);

          if (targetNode) {
            targetNode.style.visibility = "hidden";
            targetNode.dataset.motionHidden = "true";
            targetNode.dataset.motionTargetFor = move.processId;
            targetNode.classList.add("process-motion-target");

            const targetSlot = document.createElement("div");
            targetSlot.className = "process-motion-target-slot";
            targetSlot.dataset.motionTargetFor = move.processId;
            targetSlot.setAttribute("aria-hidden", "true");
            targetSlot.textContent = move.processId;
            targetSlot.style.left = `${targetRect.left}px`;
            targetSlot.style.top = `${targetRect.top}px`;
            targetSlot.style.width = `${targetRect.width}px`;
            targetSlot.style.height = `${targetRect.height}px`;
            targetSlot.style.setProperty(
              "--process-color",
              targetNode.style.getPropertyValue("--process-color") || "#4f6bed",
            );
            document.body.appendChild(targetSlot);
            targetSlots.push(targetSlot);
          }

          const fadesIn = move.from.place === "future" || move.from.place === "finished";
          const fadesOut = move.to.place === "future" || move.to.place === "finished";
          const routePosition = routeByProcess.get(move.processId) ?? { lane: 0, order: moveIndex };
          const route = travelRoute(
            sourceRect,
            targetRect,
            move.from.place,
            move.to.place,
            routePosition.lane,
            batchRouting.normal,
            root.getBoundingClientRect(),
            routeInputs.length,
            fadesIn,
            fadesOut,
          );
          traveler.dataset.motionOrder = `${routePosition.order + 1}/${routeInputs.length}`;
          traveler.dataset.motionBatch = routeInputs.length > 1 ? "true" : "false";
          traveler.dataset.motionLane = route.lane.toFixed(2);
          traveler.dataset.motionRoute = route.kind;
          if (route.guide) routeGuides.set(move.processId, route.guide);
          traveler.style.setProperty("--motion-z-index", String(10000 + routeInputs.length - routePosition.order));
          const animation = traveler.animate(route.keyframes, {
            delay: guideLead + routePosition.order * (
              trafficStagger || (phase.action === "boost" ? 0 : 35)
            ),
            duration: Math.max(260, moveDuration),
            fill: "both",
            easing: "cubic-bezier(.2,.75,.2,1)",
          });
          ownedAnimations.add(animation);
          animations.push(animation);
        }

        const guide = reducedMotion
          ? null
          : addGuide(phase, phaseIndex, phases.length, sources, targets, routeGuides);
        root.dataset.motionPhase = phase.action;
        root.dataset.motionPhaseIndex = String(phaseIndex);
        root.dataset.motionPhaseState = "moving";
        root.dispatchEvent(new CustomEvent("scheduling-motion-phase", {
          detail: {
            action: phase.action,
            direction,
            index: phaseIndex,
            count: phases.length,
            moves: phase.moves,
          },
        }));

        if (reducedMotion) continue;
        await wait(guideLead, signal);
        if (signal.aborted) return;
        await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
        animations.forEach((animation) => {
          animation.cancel();
          ownedAnimations.delete(animation);
        });
        if (signal.aborted) return;
        guide?.remove();
        travelers.forEach((traveler) => traveler.remove());
        targetSlots.forEach((targetSlot) => targetSlot.remove());
        document.querySelectorAll(".process-motion-bystander")
          .forEach((element) => element.classList.remove("process-motion-bystander"));
        document.querySelectorAll<HTMLElement>("[data-motion-hidden]").forEach((element) => {
          element.style.visibility = "";
          element.removeAttribute("data-motion-hidden");
          element.removeAttribute("data-motion-target-for");
          element.classList.remove("process-motion-target");
          element.classList.remove("process-just-landed");
          void element.offsetWidth;
          element.classList.add("process-just-landed");
        });

        if (phase.action === "finish") {
          const dock = root.querySelector<HTMLElement>("[data-motion-finish-target]");
          dock?.classList.add("completion-just-received");
        }
        root.dataset.motionPhaseState = "settling";
        await wait(gapDuration, signal);
      }

      if (signal.aborted) return;
      clearArtifacts();
      setVisualState(null);
      setMotionCue(null);
      root.dataset.motionStatus = "idle";
      root.dataset.motionPhase = "";
      root.dataset.motionPhaseIndex = "";
      root.dataset.motionPhaseState = "";
      setMotionBusy(false);
      removeGeometryListeners();
    };

    void run().catch((error: unknown) => {
      if (signal.aborted) return;
      console.error("Scheduling motion failed; showing the authoritative state instead.", error);
      snapToAuthoritativeState();
      removeGeometryListeners();
    });
    return () => {
      removeGeometryListeners();
      controller.current?.abort();
      ownedAnimations.forEach((animation) => animation.cancel());
      ownedAnimations.clear();
      clearArtifacts();
    };
  }, [contextKey, duration, frameKey, rootRef, setMotionBusy, setMotionCue, setVisualState, step, transitionStart, transitions]);
}

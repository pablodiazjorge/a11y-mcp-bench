// The keyboard walk of ADR 0007 and the checks that it feeds: 2.4.7 by pixels, and the heuristics
// of 2.1.2 (a trap), 2.4.3 (a jump back) and 2.1.1 (a click that Tab does not reach). The browser
// presses the keys and reads the page through the keyboard driver; everything decided here works
// on what it read. 2.4.11 is not built yet.

import type {
  Box,
  FocusStop,
  Frame,
  KeyboardDriver,
  LoadedPage,
  StyleProperty,
  StyleSnapshot,
  WalkKey,
} from './browser.ts';
import { STYLE_PROPERTIES } from './browser.ts';
import type { ElementKey } from './element-key.ts';
import { CHANGE_THRESHOLD, FOCUS_MARGIN, changedPixels } from './focus-pixels.ts';
import type { ElementLocation, EngineFinding, Measurement, RuleEngine } from './rule-engine.ts';

/**
 * The server's own rules, each with the criterion that it checks. None is the id of a rule of
 * axe-core, since the identifier of a finding sums up the rule with the selector (ADR 0007).
 */
export const KEYBOARD_RULES = {
  'click-not-reachable': '2.1.1',
  'keyboard-trap': '2.1.2',
  'focus-order': '2.4.3',
  'focus-visible': '2.4.7',
} as const;
export type KeyboardRule = keyof typeof KEYBOARD_RULES;

/** The criteria with an own check that is built: asking for one of them starts the walk. */
export const KEYBOARD_CRITERIA: readonly string[] = Object.values(KEYBOARD_RULES);

export interface WalkResult {
  readonly findings: readonly EngineFinding[];
  /**
   * The criteria asked for that the walk could not check, for the audit's `notChecked`: all of them
   * when a direction reached its cap; all but 2.1.2 when the walk ended in a cycle, since the
   * elements after it were never reached; 2.4.7 when an element could not be compared.
   */
  readonly notChecked: readonly string[];
}

// The classes that the Angular CDK and Material put on an element with focus, which a selector
// taken while it had focus would match only then.
const FOCUS_CLASS =
  /\.(?:cdk-(?:keyboard-|mouse-|touch-|program-)?focused|mat-focused|mdc-[a-z0-9-]+--focused)(?![\w-])/g;

/** `location`'s selector without the focus classes of the CDK and Material. */
export function withoutFocusClasses(location: ElementLocation): ElementLocation {
  let selector = location.selector.replace(FOCUS_CLASS, '');
  // A step that held only a focus class is left empty: the element's tag takes its place.
  if (selector.trim() === '' || /(?:^|[\s>+~])$/.test(selector)) selector += location.element.tag;
  return { ...location, selector };
}

/** What the walk knows of an element that it reached. */
interface Reached {
  readonly key: ElementKey;
  readonly inFrame: boolean;
  /** Where it was when it first had focus. */
  readonly box: Box;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly focusVisible: boolean;
  /** Its location while it had focus, and at the stop after, once it had lost focus. */
  focusedLocation: ElementLocation | null;
  leftLocation: ElementLocation | null;
  /** Kept only until the stop after, for a comparison with the page once focus has left. */
  frame: Frame | null;
  styles: StyleSnapshot | null;
  reachedWithTab: boolean;
  /** The verdict of 2.4.7: changed pixels and their reference, or undecided. */
  pixels: { readonly changed: number; readonly reference: 'load' | 'leave' } | null;
  changedProperties: readonly StyleProperty[];
}

interface Trap {
  readonly members: readonly ElementKey[];
  readonly direction: 'forward' | 'backward';
  readonly keys: readonly WalkKey[];
}

interface Jump {
  readonly from: ElementKey;
  readonly to: ElementKey;
  readonly upPx: number;
  readonly leftPx: number;
}

/**
 * The elements of a stretch of stops, when they go round twice the same way with no body. Two
 * laps, because in the trial of ADR 0007 the first element seen again alone gave a false cycle, as
 * when a menu that closes late puts focus back once.
 */
export function confirmedCycle(
  stops: readonly (ElementKey | null)[],
  from: number,
): ElementKey[] | null {
  const last = stops.length - 1;
  const current = stops[last];
  if (current === null || current === undefined) return null;
  const previous = stops.lastIndexOf(current, last - 1);
  if (previous < from) return null;
  const length = last - previous;
  const lap = stops.slice(previous, last);
  const lapBefore = stops.slice(previous - length, previous);
  if (previous - length < from || lap.includes(null)) return null;
  return lap.every((key, index) => key === lapBefore[index]) ? (lap as ElementKey[]) : null;
}

/** Two elements are in the same row when their heights overlap by more than half of the smaller one. */
function sameRow(a: Box, b: Box): boolean {
  return (
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > Math.min(a.height, b.height) / 2
  );
}

/** The reading order of the trial of ADR 0007: by rows, then from left to right. */
const readingOrder = (a: Box, b: Box): number => (sameRow(a, b) ? a.x - b.x : a.y - b.y);

/** Whether Tab went back: up in the same column, or left in the same row (ADR 0007). */
export function backJump(from: Box, to: Box): Omit<Jump, 'from' | 'to'> | null {
  const overlapX = Math.min(from.x + from.width, to.x + to.width) - Math.max(from.x, to.x) > 0;
  const up = to.y + to.height <= from.y;
  const left = to.x + to.width <= from.x;
  if (!((up && (overlapX || left)) || (sameRow(from, to) && left))) return null;
  return {
    upPx: Math.max(0, Math.round(from.y - to.y)),
    leftPx: Math.max(0, Math.round(from.x - to.x)),
  };
}

/**
 * How many pairs of elements Tab visits in the other order than reading, and how many pairs there
 * are, as the trial of ADR 0007 measured them.
 */
export function inversions(boxes: readonly Box[]): { inversions: number; pairs: number } {
  const reading = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => readingOrder(a.box, b.box));
  const place = new Map(reading.map(({ index }, position) => [index, position]));
  let count = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if ((place.get(i) ?? 0) > (place.get(j) ?? 0)) count += 1;
    }
  }
  return { inversions: count, pairs: (boxes.length * (boxes.length - 1)) / 2 };
}

/**
 * The names of the style properties whose values differ between two snapshots of the same elements,
 * one with focus on the element and one from the stop after. The element that has focus at that
 * stop, `focusedAfter`, is left out: its own focus style is not the element's.
 */
export function changedProperties(
  before: StyleSnapshot,
  after: StyleSnapshot,
  focusedAfter: ElementKey | null,
): StyleProperty[] {
  const changed = new Set<string>();
  for (const [name, value] of Object.entries(before)) {
    // A name starts with the key of the element that the value belongs to.
    if (focusedAfter !== null && Number.parseInt(name, 10) === focusedAfter) continue;
    if (after[name] !== value) changed.add(name.slice(name.lastIndexOf('|') + 1));
  }
  return STYLE_PROPERTIES.filter((property) => changed.has(property));
}

/**
 * Walks `page` with the keyboard and returns the findings of the criteria asked for among
 * `KEYBOARD_CRITERIA`. The page must be freshly loaded: the walk starts from it.
 */
export async function walkKeyboard(
  page: LoadedPage,
  engine: RuleEngine,
  criteria: readonly string[],
): Promise<WalkResult> {
  const wants = (rule: KeyboardRule): boolean => criteria.includes(KEYBOARD_RULES[rule]);
  const keyboard: KeyboardDriver = page.keyboard;
  const reached = new Map<ElementKey, Reached>();
  const traps: Trap[] = [];
  const jumps: Jump[] = [];
  // Every cycle seen, broken by Escape or not, with its first element in reading order: Tab from
  // another element of the cycle to that one is how the cycle goes round, so it is no jump. Other
  // jumps inside a cycle, as in a dialog whose elements Tab visits out of order, still count.
  const cycles: { members: Set<ElementKey>; head: ElementKey | undefined }[] = [];
  // The elements in the order that Tab first reached them, for the inversions of 2.4.3.
  const tabOrder: Reached[] = [];
  const unseen = new Set<string>();

  const tabbables = await keyboard.tabbables();
  const cap = 2 * tabbables.length + 6;
  // Where each element was at load, in the viewport, so that a layout that changes later does not
  // move the area that 2.4.7 compares in the capture at load.
  const atLoadBoxes = new Map(tabbables.map(({ key, box }) => [key, box]));
  const loadFrame = wants('focus-visible') ? await keyboard.capture() : null;
  const atLoad = await keyboard.focused();

  // The element at the previous stop, whose location once it lost focus, and whose comparison
  // with the page once focus left, are read at the next stop.
  let previous: Reached | null = null;
  // The element at the previous stop of the forward walk, for a jump back; none after the body.
  let before: Reached | null = null;

  async function stopAt(stop: FocusStop, direction: 'forward' | 'backward'): Promise<void> {
    const frame = direction === 'forward' && loadFrame !== null ? await keyboard.capture() : null;
    const current = stop.key === null ? undefined : reached.get(stop.key);
    const isNew = stop.key !== null && current === undefined;
    const asked = [
      ...(previous === null ? [] : [previous.key]),
      ...(isNew && stop.key !== null ? [stop.key] : []),
    ];
    const located = asked.length === 0 ? [] : await engine.locate(page, asked);
    if (previous !== null) {
      previous.leftLocation ??= located[0] ?? null;
      await leave(previous, frame, stop);
    }
    const locatedHere = isNew ? (located[asked.length - 1] ?? null) : null;
    let here: Reached | undefined = current;
    if (stop.key !== null && stop.box !== null && here === undefined) {
      here = {
        key: stop.key,
        inFrame: stop.inFrame,
        box: stop.box,
        scrollX: stop.scrollX,
        scrollY: stop.scrollY,
        focusVisible: stop.focusVisible,
        focusedLocation: locatedHere,
        leftLocation: null,
        frame: null,
        styles: null,
        reachedWithTab: false,
        pixels: null,
        changedProperties: [],
      };
      reached.set(stop.key, here);
      if (direction === 'forward' && !stop.inFrame) tabOrder.push(here);
      // Frames are not audited (ADR 0007), and the box of an element inside one is in the frame's
      // own coordinates, not those of the capture.
      if (direction === 'forward' && frame !== null && !stop.inFrame) {
        here.reachedWithTab = true;
        here.styles = await keyboard.styles(stop.key);
        here.frame = frame;
        compareWithLoad(here, frame);
      }
    }
    if (direction === 'forward' && wants('focus-order')) {
      if (here !== undefined && before !== null && !here.inFrame && !before.inFrame) {
        const jump = backJump(pageBox(before), pageBox(here));
        const seen = jumps.some(({ to }) => to === here.key);
        if (jump !== null && !seen) jumps.push({ ...jump, from: before.key, to: here.key });
      }
      before = here ?? null;
    }
    previous = isNew ? (here ?? null) : null;
  }

  function compareWithLoad(element: Reached, frame: Frame): void {
    const loadBox = atLoadBoxes.get(element.key);
    if (loadFrame === null || atLoad.key === element.key || loadBox === undefined) return;
    const inside =
      loadBox.x >= 0 &&
      loadBox.y >= 0 &&
      loadBox.x + loadBox.width <= loadFrame.width &&
      loadBox.y + loadBox.height <= loadFrame.height;
    if (!inside) return;
    const changed = changedPixels(frame, element.box, loadFrame, loadBox);
    if (changed !== null) element.pixels = { changed, reference: 'load' };
  }

  async function leave(
    element: Reached,
    frame: Frame | null,
    focusedNow: FocusStop,
  ): Promise<void> {
    if (!element.reachedWithTab) return;
    // An element that has focus again, as when the page takes it back, cannot be compared: its
    // verdict stays open and 2.4.7 is not checked.
    const comparable = focusedNow.key !== element.key;
    if (element.pixels === null && element.frame !== null && frame !== null && comparable) {
      const now = await keyboard.where(element.key);
      const ignore = focusedNow.inFrame ? null : focusedNow.box;
      const changed =
        now === null ? null : changedPixels(element.frame, element.box, frame, now.box, ignore);
      if (changed !== null) element.pixels = { changed, reference: 'leave' };
    }
    if (element.styles !== null) {
      const now = await keyboard.styles(element.key);
      element.changedProperties = changedProperties(element.styles, now, focusedNow.key);
    }
    element.frame = null;
  }

  /** How a direction ended: back at its first stop, in a cycle, or at the cap. */
  async function walk(direction: 'forward' | 'backward'): Promise<'end' | 'cycle' | 'cap'> {
    const key: WalkKey = direction === 'forward' ? 'Tab' : 'Shift+Tab';
    const stops: (ElementKey | null)[] = [];
    let from = 0;
    let first: number | null = null;
    let escapes = 0;
    previous = null;
    before = null;
    for (let presses = 0; presses < cap; presses++) {
      await keyboard.press(key);
      const stop = await keyboard.focused();
      await stopAt(stop, direction);
      stops.push(stop.key);
      if (stop.key === null) {
        before = null;
        continue;
      }
      if (first === null) {
        first = stops.length - 1;
        continue;
      }
      if (stop.key === stops[first] && stops.slice(first).includes(null)) return 'end';
      const cycle = confirmedCycle(stops, from);
      if (cycle === null) continue;
      const head = cycle
        .map((member) => reached.get(member))
        .filter((element): element is Reached => element !== undefined && !element.inFrame)
        .sort((a, b) => readingOrder(pageBox(a), pageBox(b)))[0]?.key;
      cycles.push({ members: new Set(cycle), head });
      if (!wants('keyboard-trap')) return 'cycle';
      // A page that traps again and again would keep the walk going: past one cycle per element,
      // it ends as at the cap.
      if (escapes > tabbables.length) return 'cap';
      // One Escape inside each cycle, then another try to leave it with the same key and cap.
      escapes += 1;
      await keyboard.press('Escape');
      await stopAt(await keyboard.focused(), direction);
      const members = new Set(cycle);
      let left = false;
      for (let tries = 0; tries < cap && !left; tries++) {
        await keyboard.press(key);
        const again = await keyboard.focused();
        await stopAt(again, direction);
        stops.push(again.key);
        left = again.key === null || !members.has(again.key);
      }
      if (!left) {
        traps.push({ members: cycle, direction, keys: [key, 'Escape', key] });
        return 'cycle';
      }
      from = stops.length - 1;
      presses = 0;
    }
    // At the cap: a page where Tab reaches nothing is seen whole; any other is not.
    return first === null ? 'end' : 'cap';
  }

  // The element of the last stop of a direction, when the walk ended on it, as in a trap.
  async function finish(direction: 'forward' | 'backward'): Promise<void> {
    const last = previous;
    previous = null;
    if (last === null) return;
    last.leftLocation ??= (await engine.locate(page, [last.key]))[0] ?? null;
    const frame = direction === 'forward' && loadFrame !== null ? await keyboard.capture() : null;
    await leave(last, frame, await keyboard.focused());
  }

  const asked = KEYBOARD_CRITERIA.filter((id) => criteria.includes(id));
  const forward = await walk('forward');
  await finish('forward');
  if (forward !== 'end') {
    for (const id of asked)
      if (forward === 'cap' || id !== KEYBOARD_RULES['keyboard-trap']) unseen.add(id);
  }
  // Shift+Tab serves only 2.1.2 until 2.4.11, which needs both directions, is built.
  if (wants('keyboard-trap')) {
    if ((await walk('backward')) === 'cap') unseen.add(KEYBOARD_RULES['keyboard-trap']);
    await finish('backward');
  }

  const findings: EngineFinding[] = [];
  const locationOf = (element: Reached | undefined): ElementLocation | null => {
    if (element === undefined) return null;
    if (element.leftLocation !== null) return element.leftLocation;
    return element.focusedLocation === null ? null : withoutFocusClasses(element.focusedLocation);
  };
  const add = (
    rule: KeyboardRule,
    location: ElementLocation | null,
    measurement: Measurement,
  ): void => {
    if (location === null) return;
    findings.push({ rule, ...location, measurement, accessibleName: null });
  };

  if (wants('focus-visible')) {
    for (const element of reached.values()) {
      if (!element.reachedWithTab) continue;
      if (element.pixels === null) {
        unseen.add(KEYBOARD_RULES['focus-visible']);
        continue;
      }
      if (element.pixels.changed > 0) continue;
      add('focus-visible', locationOf(element), {
        kind: 'focus-visible',
        key: 'Tab',
        focusVisible: element.focusVisible,
        reference: element.pixels.reference,
        margin: FOCUS_MARGIN,
        changedPixels: element.pixels.changed,
        threshold: CHANGE_THRESHOLD,
        changedProperties: [...element.changedProperties],
      });
    }
  }

  for (const trap of mergedTraps(traps)) {
    const locations = trap.members
      .map((member) => locationOf(reached.get(member)))
      .filter((location) => location !== null)
      .sort((a, b) => a.documentIndex - b.documentIndex);
    add('keyboard-trap', locations[0] ?? null, {
      kind: 'keyboard-trap',
      directions: [...trap.directions],
      stops: trap.members.length,
      keys: [...trap.keys],
    });
  }

  const order = inversions(tabOrder.map(pageBox));
  for (const jump of jumps) {
    if (cycles.some(({ members, head }) => members.has(jump.from) && jump.to === head)) continue;
    add('focus-order', locationOf(reached.get(jump.to)), {
      kind: 'focus-order',
      upPx: jump.upPx,
      leftPx: jump.leftPx,
      ...order,
    });
  }

  if (wants('click-not-reachable')) {
    const targets = await keyboard.clickTargets([...reached.keys()]);
    const missed = targets.filter(
      (target) =>
        target.rendered &&
        !target.inFrame &&
        !target.reached &&
        !target.ancestorReached &&
        !target.descendantReached &&
        !target.groupReached &&
        !target.labelOfReached,
    );
    const located =
      missed.length === 0
        ? []
        : await engine.locate(
            page,
            missed.map(({ key }) => key),
          );
    missed.forEach((target, index) => {
      add('click-not-reachable', located[index] ?? null, {
        kind: 'click-not-reachable',
        events: [...target.events],
        reached: target.reached,
        ancestorReached: target.ancestorReached,
        descendantReached: target.descendantReached,
      });
    });
  }

  return { findings, notChecked: asked.filter((id) => unseen.has(id)) };
}

/** The element's rectangle in the page, from where it was when it first had focus. */
function pageBox(element: Reached): Box {
  return { ...element.box, x: element.box.x + element.scrollX, y: element.box.y + element.scrollY };
}

/** One trap per cycle: the same elements found in both directions make one, with both directions. */
function mergedTraps(traps: readonly Trap[]): {
  members: readonly ElementKey[];
  directions: ('forward' | 'backward')[];
  keys: readonly WalkKey[];
}[] {
  const merged: {
    members: readonly ElementKey[];
    directions: ('forward' | 'backward')[];
    keys: readonly WalkKey[];
  }[] = [];
  for (const trap of traps) {
    const same = merged.find(
      ({ members }) =>
        members.length === trap.members.length &&
        members.every((key) => trap.members.includes(key)),
    );
    if (same === undefined) {
      merged.push({ members: trap.members, directions: [trap.direction], keys: trap.keys });
    } else {
      same.directions.push(trap.direction);
      same.keys = [...same.keys, ...trap.keys];
    }
  }
  return merged;
}

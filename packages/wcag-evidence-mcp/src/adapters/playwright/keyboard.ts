import type { CDPSession, Page } from 'playwright-core';
import * as z from 'zod';
import {
  CLICK_EVENTS,
  STYLE_PROPERTIES,
  type ClickEvent,
  type ClickTarget,
  type KeyboardDriver,
  type WalkKey,
} from '../../core/browser.ts';
import { ELEMENT_REGISTRY_SCRIPT, type ElementKey } from '../../core/element-key.ts';
import { decodePng } from './png.ts';

/** The isolated world of the page: a script runner, and its id for the DevTools Protocol. */
export interface IsolatedWorld {
  readonly evaluate: (script: string) => Promise<unknown>;
  readonly contextId: number;
}

// The pause after each key and the cap on the wait for animations (ADR 0007).
const PAUSE_MS = 30;
const ANIMATION_CAP_MS = 1_000;

// The longhands that the browser computes for each style property of `STYLE_PROPERTIES`.
const LONGHANDS: Record<(typeof STYLE_PROPERTIES)[number], readonly string[]> = {
  outline: ['outline-style', 'outline-width', 'outline-color', 'outline-offset'],
  'box-shadow': ['box-shadow'],
  border: ['top', 'right', 'bottom', 'left'].flatMap((side) =>
    ['width', 'style', 'color'].map((part) => `border-${side}-${part}`),
  ),
  background: ['background-color', 'background-image'],
  color: ['color'],
  'text-decoration': ['text-decoration-line', 'text-decoration-color', 'text-decoration-style'],
  opacity: ['opacity'],
  transform: ['transform'],
  filter: ['filter'],
  visibility: ['visibility'],
};

// The parent of a node across shadow roots and same-origin frames.
const PARENT_SCRIPT = String.raw`
const parentOf = (node) => {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) return root.host;
  return node.ownerDocument?.defaultView?.frameElement ?? null;
};
`;

const FOCUSED_SCRIPT = String.raw`(() => {
${ELEMENT_REGISTRY_SCRIPT}
let element = document.activeElement;
let inFrame = false;
for (;;) {
  if (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
    continue;
  }
  if (element?.localName === 'iframe' || element?.localName === 'frame') {
    let inner = null;
    try {
      inner = element.contentDocument;
    } catch {
      inner = null;
    }
    if (inner?.activeElement && inner.activeElement !== inner.body) {
      element = inner.activeElement;
      inFrame = true;
      continue;
    }
  }
  break;
}
// Focus on a frame whose own content has no focus, or whose content cannot be read, is inside it.
if (element?.localName === 'iframe' || element?.localName === 'frame') inFrame = true;
const scroll = { scrollX: window.scrollX, scrollY: window.scrollY };
if (!element || element === document.body || element === document.documentElement) {
  return { key: null, box: null, ...scroll, focusVisible: false, inFrame: false };
}
let focusVisible = false;
try {
  focusVisible = element.matches(':focus-visible');
} catch {
  focusVisible = false;
}
const box = element.getBoundingClientRect();
return {
  key: registry.keyOf(element),
  box: { x: box.x, y: box.y, width: box.width, height: box.height },
  ...scroll,
  focusVisible,
  inFrame,
};
})()`;

const ANIMATIONS_SCRIPT = String.raw`(async () => {
const running = document.getAnimations().filter((animation) => {
  if (animation.playState !== 'running') return false;
  const end = animation.effect?.getComputedTiming().endTime;
  return typeof end === 'number' && Number.isFinite(end);
});
if (running.length === 0) return 0;
await Promise.race([
  Promise.all(running.map((animation) => animation.finished.catch(() => undefined))),
  new Promise((resolve) => setTimeout(resolve, ${String(ANIMATION_CAP_MS)})),
]);
return running.length;
})()`;

const TABBABLE_SCRIPT = String.raw`(() => {
${ELEMENT_REGISTRY_SCRIPT}
const found = [];
const visit = (root) => {
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) visit(element.shadowRoot);
    if (element.localName === 'iframe') {
      try {
        if (element.contentDocument) visit(element.contentDocument);
      } catch {}
    }
    if (element.tabIndex < 0 || element.disabled || element.closest('[inert]')) continue;
    if (element.getClientRects().length === 0) continue;
    if (getComputedStyle(element).visibility === 'hidden') continue;
    const box = element.getBoundingClientRect();
    found.push({
      key: registry.keyOf(element),
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  }
};
visit(document);
return found;
})()`;

function whereScript(key: ElementKey): string {
  return String.raw`(() => {
${ELEMENT_REGISTRY_SCRIPT}
const element = registry.get(${String(key)});
if (!element || !element.isConnected || element.getClientRects().length === 0) return null;
const box = element.getBoundingClientRect();
return {
  box: { x: box.x, y: box.y, width: box.width, height: box.height },
  scrollX: window.scrollX,
  scrollY: window.scrollY,
};
})()`;
}

// The elements whose style can show the focus of an element without being it: its ancestors, and
// those whose rectangle comes within 24 px of its own, twice the margin of the pixel comparison, as
// the trial of ADR 0007 read them. At most 200, so that a dense page does not make each stop slow.
function stylesScript(key: ElementKey): string {
  return String.raw`(() => {
${ELEMENT_REGISTRY_SCRIPT}
${PARENT_SCRIPT}
const LONGHANDS = ${JSON.stringify(LONGHANDS)};
const sets = (globalThis.__wcagEvidenceStyleSets ??= new Map());
const element = registry.get(${String(key)});
if (!element) return {};
if (!sets.has(${String(key)})) {
  const chosen = [];
  for (let node = element; node && node.nodeType === 1; node = parentOf(node)) chosen.push(node);
  const box = element.getBoundingClientRect();
  const near = (other) => {
    const around = other.getBoundingClientRect();
    return (
      around.right >= box.left - 24 &&
      around.left <= box.right + 24 &&
      around.bottom >= box.top - 24 &&
      around.top <= box.bottom + 24
    );
  };
  for (const other of element.ownerDocument.querySelectorAll('*')) {
    if (chosen.length >= 200) break;
    if (!chosen.includes(other) && near(other)) chosen.push(other);
  }
  sets.set(${String(key)}, chosen.map((node) => registry.keyOf(node)));
}
const read = {};
for (const nodeKey of sets.get(${String(key)})) {
  const node = registry.get(nodeKey);
  if (!node || !node.isConnected) continue;
  for (const pseudo of [null, '::before', '::after']) {
    const style = node.ownerDocument.defaultView.getComputedStyle(node, pseudo);
    for (const [name, longhands] of Object.entries(LONGHANDS)) {
      read[nodeKey + (pseudo ?? '') + '|' + name] = longhands.map((longhand) => style.getPropertyValue(longhand)).join(' ');
    }
  }
}
return read;
})()`;
}

// Run on an element with a click listener, in the isolated world: what the walk reached around it.
const CLASSIFY_FUNCTION = String.raw`function (reachedKeys) {
${ELEMENT_REGISTRY_SCRIPT}
${PARENT_SCRIPT}
const element = this;
if (element.nodeType !== 1 || element === element.ownerDocument.body) return null;
if (element === element.ownerDocument.documentElement) return null;
const reached = new Set(reachedKeys.map((key) => registry.get(key)).filter(Boolean));
const isAbove = (node, below) => {
  for (let parent = parentOf(below); parent; parent = parentOf(parent)) if (parent === node) return true;
  return false;
};
const MEMBERS = ['tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'gridcell', 'row'];
const GROUPS = ['tablist', 'menu', 'menubar', 'listbox', 'tree', 'treegrid', 'grid'];
let groupReached = false;
if (MEMBERS.includes(element.getAttribute('role'))) {
  let group = null;
  for (let parent = parentOf(element); parent && !group; parent = parentOf(parent)) {
    if (GROUPS.includes(parent.getAttribute?.('role'))) group = parent;
  }
  groupReached =
    group !== null &&
    [...reached].some((other) => MEMBERS.includes(other.getAttribute?.('role')) && isAbove(group, other));
}
const control = element.localName === 'label' ? element.control : null;
return {
  key: registry.keyOf(element),
  reached: reached.has(element),
  ancestorReached: [...reached].some((other) => isAbove(other, element)),
  descendantReached: [...reached].some((other) => isAbove(element, other)),
  groupReached,
  labelOfReached: control !== null && reached.has(control),
  rendered:
    element.getClientRects().length > 0 &&
    element.ownerDocument.defaultView.getComputedStyle(element).visibility !== 'hidden',
  inFrame: element.ownerDocument !== document,
};
}`;

const boxSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const focusStopSchema = z.object({
  key: z.number().int().positive().nullable(),
  box: boxSchema.nullable(),
  scrollX: z.number(),
  scrollY: z.number(),
  focusVisible: z.boolean(),
  inFrame: z.boolean(),
});
const placementSchema = z
  .object({ box: boxSchema, scrollX: z.number(), scrollY: z.number() })
  .nullable();
const classifiedSchema = z
  .object({
    key: z.number().int().positive(),
    reached: z.boolean(),
    ancestorReached: z.boolean(),
    descendantReached: z.boolean(),
    groupReached: z.boolean(),
    labelOfReached: z.boolean(),
    rendered: z.boolean(),
    inFrame: z.boolean(),
  })
  .nullable();
const listenersSchema = z.object({
  listeners: z.array(z.object({ type: z.string(), backendNodeId: z.number().optional() })),
});

// Hides the text cursor of every element of the document, and of shadow roots, which inherit it
// from their host. A frame keeps its cursor, and so does a shadow root that sets its own.
const CARET_RULE = '*, *::before, *::after { caret-color: transparent !important; }';

const isClickEvent = (type: string): type is ClickEvent =>
  (CLICK_EVENTS as readonly string[]).includes(type);

/**
 * The keyboard of ADR 0007 on a Playwright page. The keys go through Playwright, as a person's
 * would; every read runs in the isolated world, which the page's scripts cannot reach.
 *
 * The text cursor is hidden for the whole walk, from before the first capture, by a style sheet
 * that the DevTools Protocol adds to the page (`CSS.createStyleSheet`): it is in no list of the
 * page's style sheets and changes nothing in its DOM, so no single capture can be told apart. What
 * the page can still see, all along the walk, is the computed `caret-color` of its elements,
 * transparent. The captures go through the DevTools Protocol too, since Playwright's own would set
 * a style attribute on each field for its time.
 */
export function createKeyboardDriver(
  page: Page,
  session: CDPSession,
  world: IsolatedWorld,
): KeyboardDriver {
  let caretHidden: Promise<void> | undefined;
  const hideCaret = (): Promise<void> =>
    (caretHidden ??= (async () => {
      await session.send('DOM.enable');
      await session.send('CSS.enable');
      const { frameTree } = await session.send('Page.getFrameTree');
      const { styleSheetId } = await session.send('CSS.createStyleSheet', {
        frameId: frameTree.frame.id,
      });
      await session.send('CSS.setStyleSheetText', { styleSheetId, text: CARET_RULE });
    })());
  return {
    async tabbables() {
      const found = z.array(z.object({ key: z.number().int().positive(), box: boxSchema }));
      return found.parse(await world.evaluate(TABBABLE_SCRIPT));
    },
    async press(key: WalkKey) {
      await page.keyboard.press(key);
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      await world.evaluate(ANIMATIONS_SCRIPT);
    },
    async focused() {
      return focusStopSchema.parse(await world.evaluate(FOCUSED_SCRIPT));
    },
    async where(key) {
      return placementSchema.parse(await world.evaluate(whereScript(key)));
    },
    async capture() {
      // So that a verdict does not depend on the blink of the cursor.
      await hideCaret();
      const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
      return decodePng(Buffer.from(data, 'base64'));
    },
    async styles(key) {
      return z.record(z.string(), z.string()).parse(await world.evaluate(stylesScript(key)));
    },
    async clickTargets(reached) {
      await world.evaluate(`(() => {${ELEMENT_REGISTRY_SCRIPT}})()`);
      const document = await session.send('Runtime.evaluate', {
        expression: 'document',
        contextId: world.contextId,
      });
      const objectId = document.result.objectId;
      if (objectId === undefined) return [];
      // With `pierce`, the listeners of the page's own world show from the isolated one, frames
      // and shadow roots included.
      const { listeners } = listenersSchema.parse(
        await session.send('DOMDebugger.getEventListeners', { objectId, depth: -1, pierce: true }),
      );
      const events = new Map<number, Set<ClickEvent>>();
      for (const { type, backendNodeId } of listeners) {
        if (backendNodeId === undefined || !isClickEvent(type)) continue;
        events.set(backendNodeId, (events.get(backendNodeId) ?? new Set()).add(type));
      }
      const targets: ClickTarget[] = [];
      for (const [backendNodeId, types] of events) {
        const { object } = await session.send('DOM.resolveNode', {
          backendNodeId,
          executionContextId: world.contextId,
        });
        if (object.objectId === undefined) continue;
        const { result } = await session.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: CLASSIFY_FUNCTION,
          arguments: [{ value: [...reached] }],
          returnByValue: true,
        });
        const classified = classifiedSchema.parse(result.value);
        if (classified === null) continue;
        targets.push({ ...classified, events: CLICK_EVENTS.filter((type) => types.has(type)) });
      }
      return targets;
    },
  };
}

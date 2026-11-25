// What lies over the focused element, for 2.4.11 (ADR 0007), read in the isolated world, and the
// pieces that the keyboard's other scripts share with it.

import * as z from 'zod';
import { ELEMENT_REGISTRY_SCRIPT, type ElementKey } from '../../core/element-key.ts';
import { GRID } from '../../core/focus-cover.ts';

// The parent of a node across shadow roots and same-origin frames.
export const PARENT_SCRIPT = String.raw`
const parentOf = (node) => {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) return root.host;
  return node.ownerDocument?.defaultView?.frameElement ?? null;
};
`;

export const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
const elementKeySchema = z.number().int().positive();
export const coverageSchema = z
  .object({
    box: boxSchema,
    viewport: z.object({ width: z.number(), height: z.number() }),
    points: z.array(elementKeySchema.nullable()).max(GRID * GRID),
    draws: z.boolean(),
    layers: z.array(z.object({ key: elementKeySchema, box: boxSchema, inParent: z.boolean() })),
  })
  .nullable();

// What lies over the focused element, for 2.4.11, as the trial of ADR 0007 read it. A layer paints
// when it draws a background, a border, a shadow, an image, a control or text, and no ancestor has
// an opacity of 0; a background or opacity between 0 and 1 counts as painting (ADR 0007).
export function coverageScript(key: ElementKey): string {
  return String.raw`(() => {
${ELEMENT_REGISTRY_SCRIPT}
${PARENT_SCRIPT}
const element = registry.get(${String(key)});
if (!element || !element.isConnected || element.getClientRects().length === 0) return null;
const rect = element.getBoundingClientRect();
const viewport = window.visualViewport
  ? { width: window.visualViewport.width, height: window.visualViewport.height }
  : { width: window.innerWidth, height: window.innerHeight };
const isAbove = (node, below) => {
  for (let parent = parentOf(below); parent; parent = parentOf(parent)) if (parent === node) return true;
  return false;
};
// The element, an element inside it, or one of its ancestors: none of them is a layer over it.
const own = (node) => node === element || isAbove(element, node) || isAbove(node, element);
const styleOf = (node, pseudo) => node.ownerDocument.defaultView.getComputedStyle(node, pseudo);
const transparent = (color) =>
  color === 'transparent' || /^rgba\((?:[^,]*,){3}\s*0(?:\.0*)?\)$|\/\s*0(?:\.0*)?%?\)$/.test(color);
const REPLACED = ['img', 'video', 'canvas', 'svg', 'input', 'textarea', 'select', 'button', 'iframe', 'embed', 'object'];
const drawsBox = (style) =>
  !transparent(style.backgroundColor) ||
  style.backgroundImage !== 'none' ||
  style.boxShadow !== 'none' ||
  ['top', 'right', 'bottom', 'left'].some(
    (side) =>
      parseFloat(style.getPropertyValue('border-' + side + '-width')) > 0 &&
      style.getPropertyValue('border-' + side + '-style') !== 'none',
  );
const paints = (node) => {
  for (let at = node; at && at.nodeType === 1; at = parentOf(at)) {
    if (parseFloat(styleOf(at).opacity) === 0) return false;
  }
  const style = styleOf(node);
  if (style.visibility === 'hidden') return false;
  if (REPLACED.includes(node.localName) || drawsBox(style)) return true;
  for (const child of node.childNodes) if (child.nodeType === 3 && child.textContent.trim() !== '') return true;
  for (const pseudo of ['::before', '::after']) {
    const generated = styleOf(node, pseudo);
    if (generated.content === 'none' || generated.content === 'normal') continue;
    if (generated.content !== '""' || drawsBox(generated)) return true;
  }
  return false;
};
const visible = {
  left: Math.max(0, rect.left),
  top: Math.max(0, rect.top),
  right: Math.min(viewport.width, rect.right),
  bottom: Math.min(viewport.height, rect.bottom),
};
// The elements at a point, top first, deep into open shadow roots: the document gives a shadow
// host in place of what its shadow root draws, such as a header that a web component draws.
const stackAt = (x, y) => {
  const expand = (nodes) =>
    nodes.flatMap((node) => {
      const shadow = node.shadowRoot;
      if (!shadow) return [node];
      const drawn = shadow.elementsFromPoint(x, y).filter((inner) => inner.getRootNode() === shadow);
      return [...expand(drawn), node];
    });
  return expand(element.ownerDocument.elementsFromPoint(x, y));
};
// An ancestor at a point stands for the element only when the points pass through the element, as
// with pointer-events: none. Otherwise an ancestor that paints and comes first is over it, as when
// the element has a negative z-index; one that paints nothing is skipped as any such layer.
const passesThrough = styleOf(element).pointerEvents === 'none';
const shows = (node) => node === element || isAbove(element, node) || (passesThrough && isAbove(node, element));
const points = [];
// A layer that a point shows beneath the element, such as a positioned background under the
// content, does not cover it.
const beneath = new Set();
if (visible.right > visible.left && visible.bottom > visible.top) {
  for (let row = 0; row < ${String(GRID)}; row++) {
    for (let column = 0; column < ${String(GRID)}; column++) {
      const x = visible.left + ((visible.right - visible.left) * (column + 0.5)) / ${String(GRID)};
      const y = visible.top + ((visible.bottom - visible.top) * (row + 0.5)) / ${String(GRID)};
      let first;
      let passed = false;
      for (const node of stackAt(x, y)) {
        if (shows(node)) {
          if (first === undefined) first = null;
          passed = true;
        } else if (passed) beneath.add(node);
        else if (first === undefined && paints(node)) first = node;
      }
      points.push(first ? registry.keyOf(first) : null);
    }
  }
}
const inside = (node) => [...node.querySelectorAll('*'), ...(node.shadowRoot ? node.shadowRoot.querySelectorAll('*') : [])];
const draws = paints(element) || inside(element).some(paints);
const layers = [];
if (points.includes(null)) {
  const parent = parentOf(element);
  const reaches = (box) =>
    box.right > visible.left && box.left < visible.right && box.bottom > visible.top && box.top < visible.bottom;
  const visit = (scopeRoot) => {
    for (const node of scopeRoot.querySelectorAll('*')) {
      if (node.shadowRoot) visit(node.shadowRoot);
      const box = node.getBoundingClientRect();
      if (!reaches(box) || own(node) || beneath.has(node)) continue;
      if (!['fixed', 'sticky', 'absolute'].includes(styleOf(node).position) || !paints(node)) continue;
      layers.push({
        key: registry.keyOf(node),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        inParent: parent !== null && isAbove(parent, node),
      });
    }
  };
  visit(document);
}
return {
  box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  viewport,
  points,
  draws,
  layers,
};
})()`;
}

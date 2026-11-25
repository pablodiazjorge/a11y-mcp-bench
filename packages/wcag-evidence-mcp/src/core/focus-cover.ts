// The verdict of 2.4.11 (ADR 0007): whether the focused element is entirely hidden, from what the
// driver read over it. Either of two methods decides, as the trial of ADR 0007 inferred: each one
// missed a case that the other saw.

import type { Box, Coverage } from './browser.ts';
import type { ElementKey } from './element-key.ts';

/** The points of the grid on each side: 5 by 5 over the element's part in the viewport. */
export const GRID = 5;

// The cells on each side of the element's part in the viewport that the rectangles of the layers
// must cover: 10 by 10, as the trial of ADR 0007 measured them, finer than the grid of points, so
// that a gap between two layers shows.
const CELLS = 10;

export interface CoverVerdict {
  /** Whether the element is entirely hidden: no point shows it, or the layers cover every cell. */
  readonly hidden: boolean;
  /** The fraction of the element's rectangle inside the viewport, from 0 to 1. */
  readonly inViewport: number;
  readonly points: number;
  /** The points where the element, or what stands for it, comes before any layer that paints. */
  readonly pointsOnElement: number;
  /**
   * What hides it: the element on top at most points, or, when the points pass through, the
   * positioned layer whose rectangle covers most of it. Null exactly when it is not hidden.
   */
  readonly layer: ElementKey | null;
}

/**
 * The verdict on an element from what lies over it, or null for an element with no area, such as
 * an empty link, or with no part in the viewport, such as a link that stays off screen: it has no
 * grid, and nothing covers it. Whether such an element shows its focus is a question of 2.4.7.
 */
export function coverVerdict(coverage: Coverage): CoverVerdict | null {
  const { box, viewport } = coverage;
  const area = box.width * box.height;
  if (area <= 0) return null;
  const visible = {
    left: Math.max(0, box.x),
    top: Math.max(0, box.y),
    right: Math.min(viewport.width, box.x + box.width),
    bottom: Math.min(viewport.height, box.y + box.height),
  };
  const width = Math.max(0, visible.right - visible.left);
  const height = Math.max(0, visible.bottom - visible.top);
  if (width * height <= 0) return null;
  const points = coverage.points.length;
  const pointsOnElement = coverage.points.filter((key) => key === null).length;
  // Rounded to hundredths, and never to 0: some of it is in the viewport.
  const inViewport = Math.max(0.01, Math.round(((width * height) / area) * 100) / 100);
  const verdict = { inViewport, points, pointsOnElement };
  if (points > 0 && pointsOnElement === 0) {
    const atPoints = new Map<ElementKey, number>();
    for (const key of coverage.points) if (key !== null) add(atPoints, key);
    return { ...verdict, hidden: true, layer: mostOften(atPoints) };
  }
  // An element that draws nothing, as Material's native inputs, is shown by the elements beside it,
  // and the layer that shows its focus lies over it: the layers inside its parent do not count for
  // it, as ADR 0007 decides.
  const layers = coverage.draws
    ? coverage.layers
    : coverage.layers.filter(({ inParent }) => !inParent);
  // The points pass through a layer, as one with pointer-events: none: the rectangles of the layers
  // decide, together, as several can cover the element between them.
  const inCells = new Map<ElementKey, number>();
  let covered = 0;
  for (let row = 0; row < CELLS; row++) {
    for (let column = 0; column < CELLS; column++) {
      const x = visible.left + (width * (column + 0.5)) / CELLS;
      const y = visible.top + (height * (row + 0.5)) / CELLS;
      const over = layers.filter(({ box: layer }) => contains(layer, x, y));
      if (over.length > 0) covered += 1;
      for (const { key } of over) add(inCells, key);
    }
  }
  const hidden = covered === CELLS * CELLS;
  return { ...verdict, hidden, layer: hidden ? mostOften(inCells) : null };
}

function contains(box: Box, x: number, y: number): boolean {
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
}

function add(counts: Map<ElementKey, number>, key: ElementKey): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** The key counted most often, the first one counted on a tie. */
function mostOften(counts: ReadonlyMap<ElementKey, number>): ElementKey | null {
  let best: ElementKey | null = null;
  let most = 0;
  for (const [key, count] of counts) {
    if (count > most) [best, most] = [key, count];
  }
  return best;
}

// The pixel comparison of 2.4.7 (ADR 0007): the area around an element with focus against the
// same area without it. The glossary of WCAG defines the focus indicator as the pixels that change.

import type { Box, Frame } from './browser.ts';

/** How far around the element the comparison looks, in CSS pixels. */
export const FOCUS_MARGIN = 12;

/** How much one of red, green or blue has to differ, from 0 to 255, for a pixel to count. */
export const CHANGE_THRESHOLD = 10;

/**
 * How many pixels differ between the element's area in `focused` and in `reference`, each area
 * being the element's box in that capture, plus the margin, so that the two are aligned on the
 * element even when the page scrolled between them. The size is that of `box`. Only the pixels
 * that fall inside both captures are compared; null when none does.
 *
 * `ignore` is the box, in `reference`, of an element that has focus there, as the next one when
 * the reference is the page once focus has left: its own indicator, within the margin around it,
 * is not the element's, so those pixels are left out.
 */
export function changedPixels(
  focused: Frame,
  box: Box,
  reference: Frame,
  referenceBox: Box,
  ignore: Box | null = null,
): number | null {
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const referenceLeft = Math.round(referenceBox.x);
  const referenceTop = Math.round(referenceBox.y);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  let compared = 0;
  let changed = 0;
  for (let dy = -FOCUS_MARGIN; dy < height + FOCUS_MARGIN; dy++) {
    const y = top + dy;
    const referenceY = referenceTop + dy;
    if (y < 0 || y >= focused.height || referenceY < 0 || referenceY >= reference.height) continue;
    for (let dx = -FOCUS_MARGIN; dx < width + FOCUS_MARGIN; dx++) {
      const x = left + dx;
      const referenceX = referenceLeft + dx;
      if (x < 0 || x >= focused.width || referenceX < 0 || referenceX >= reference.width) continue;
      if (ignore !== null && within(referenceX, referenceY, ignore)) continue;
      compared += 1;
      const at = (y * focused.width + x) * 4;
      const referenceAt = (referenceY * reference.width + referenceX) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const difference =
          (focused.data[at + channel] ?? 0) - (reference.data[referenceAt + channel] ?? 0);
        if (Math.abs(difference) > CHANGE_THRESHOLD) {
          changed += 1;
          break;
        }
      }
    }
  }
  return compared === 0 ? null : changed;
}

/** Whether the pixel at `x`, `y` is in `box` or within the margin around it. */
function within(x: number, y: number, box: Box): boolean {
  return (
    x >= box.x - FOCUS_MARGIN &&
    x < box.x + box.width + FOCUS_MARGIN &&
    y >= box.y - FOCUS_MARGIN &&
    y < box.y + box.height + FOCUS_MARGIN
  );
}

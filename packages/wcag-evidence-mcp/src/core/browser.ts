// The browser port (ADR 0004): what the core needs from a browser to look at one local page. The
// adapter behind it applies the URL policy of ADR 0005 to the page and to every request it makes.

import type { ElementKey } from './element-key.ts';
import type { UrlRejection } from './url-policy.ts';

/** A request of the page that the URL policy refused. */
export interface RefusedRequest {
  /** The URL as the browser wrote it. */
  readonly url: string;
  readonly reason: UrlRejection;
  /**
   * `request` and `websocket` were stopped before they left the browser. A `redirect` hop cannot be
   * stopped, only seen: Chromium's resolver stops it when its host is not local, and a local hop
   * that fails `checkUrl` reaches its destination.
   */
  readonly kind: 'request' | 'redirect' | 'websocket';
}

/** A key that the keyboard walk presses (ADR 0007). No other key is pressed, and nothing is typed. */
export type WalkKey = 'Tab' | 'Shift+Tab' | 'Escape';

/** A capture of the viewport: four bytes per pixel (red, green, blue, alpha), row after row. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** A rectangle in CSS pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where an element is drawn at one moment. */
export interface Placement {
  /** Its rectangle in the viewport. */
  readonly box: Box;
  /** How far the page is scrolled: the rectangle in the page is `box` moved by these. */
  readonly scrollX: number;
  readonly scrollY: number;
}

/** Where the keyboard focus is. */
export interface FocusStop {
  /**
   * The key of the focused element, or null when the focus is on the body or has left the page, as
   * after the last element. Inside an open shadow root or a same-origin frame, the innermost one.
   */
  readonly key: ElementKey | null;
  /** The element's rectangle in the viewport; null exactly when `key` is. */
  readonly box: Box | null;
  /** How far the page is scrolled: a rectangle in the page is one in the viewport moved by these. */
  readonly scrollX: number;
  readonly scrollY: number;
  /** Whether the element matches `:focus-visible`. */
  readonly focusVisible: boolean;
  /** Whether the element is inside a frame, whose elements give no finding. */
  readonly inFrame: boolean;
}

/** The events that count as a click for 2.1.1: a click, or a press of a mouse, pointer or touch. */
export const CLICK_EVENTS = [
  'click',
  'dblclick',
  'auxclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
] as const;
export type ClickEvent = (typeof CLICK_EVENTS)[number];

/** An element with a listener of a click, and what the walk reached around it. */
export interface ClickTarget {
  readonly key: ElementKey;
  readonly events: readonly ClickEvent[];
  readonly reached: boolean;
  readonly ancestorReached: boolean;
  readonly descendantReached: boolean;
  /** A member of a composite widget, such as a tab, whose group has a member that was reached. */
  readonly groupReached: boolean;
  /** A `<label>` of a control that was reached. */
  readonly labelOfReached: boolean;
  /** Whether the element is drawn at all: one that is not cannot be clicked. */
  readonly rendered: boolean;
  readonly inFrame: boolean;
}

/**
 * The style properties that can explain a verdict of 2.4.7 (ADR 0007), by the server's own names:
 * each stands for the longhands that the browser computes, such as `border` for the width, style
 * and color of each side.
 */
export const STYLE_PROPERTIES = [
  'outline',
  'box-shadow',
  'border',
  'background',
  'color',
  'text-decoration',
  'opacity',
  'transform',
  'filter',
  'visibility',
] as const;
export type StyleProperty = (typeof STYLE_PROPERTIES)[number];

/**
 * The computed values of `STYLE_PROPERTIES` on a set of elements, by a key that the driver makes
 * of the element, the pseudo-element and the property name, which it ends with.
 */
export type StyleSnapshot = Readonly<Record<string, string>>;

/** What the keyboard walk needs from the browser (ADR 0007). Every read is in the isolated world. */
export interface KeyboardDriver {
  /**
   * The elements that Tab can reach, found in the DOM, with their rectangles in the viewport now:
   * their number sets the cap of the walk, and their places at load the area that 2.4.7 compares.
   */
  tabbables(): Promise<readonly { readonly key: ElementKey; readonly box: Box }[]>;
  /**
   * Presses `key`, then waits at least 30 ms and for the page's running animations to end, at most
   * 1 s. Animations that never end are not waited for.
   */
  press(key: WalkKey): Promise<void>;
  focused(): Promise<FocusStop>;
  /** Where the element is now, or null when it is no longer in the page or not drawn. */
  where(key: ElementKey): Promise<Placement | null>;
  /** The viewport, with the text cursor hidden. */
  capture(): Promise<Frame>;
  /**
   * The style properties on the element, its ancestors, its `::before` and `::after`, and the
   * elements whose rectangle comes within 24 px of its own. The elements are chosen on the first
   * call for a key, and the same ones are read on each later call.
   */
  styles(key: ElementKey): Promise<StyleSnapshot>;
  /** The elements with a listener of a click event, and whether the walk reached them. */
  clickTargets(reached: readonly ElementKey[]): Promise<readonly ClickTarget[]>;
}

/** A page that loaded from an allowed URL, served from a local address. */
export interface LoadedPage {
  /** The URL of the page's document after any redirect, as the browser writes it. */
  readonly url: string;
  /** The HTTP status of the page's document. */
  readonly status: number;
  /**
   * Whether, after `load`, the page went a short while with no change to its DOM and no request in
   * flight before the browser's wait ran out. Content that arrives later, such as on a timer, can
   * still be missing.
   */
  readonly settled: boolean;
  /** Runs `script` in the page and returns its result, which must be serializable as JSON. */
  evaluate(script: string): Promise<unknown>;
  /**
   * Runs `script` in a world of its own: it shares the page's DOM, but none of the page's
   * JavaScript, so a script of the page cannot replace or change what this one uses. The result
   * must be serializable as JSON.
   */
  evaluateIsolated(script: string): Promise<unknown>;
  /** The requests that the URL policy refused so far, in the order the page made them. */
  refusedRequests(): readonly RefusedRequest[];
  /** The keyboard, for the walk of ADR 0007. */
  readonly keyboard: KeyboardDriver;
}

/** Why a page was not opened. Each `reason` is stable, so a message or a test can rely on it. */
export type VisitFailure =
  /** The URL asked for, or a redirect hop of the page's document, fails `checkUrl`. */
  | { readonly reason: 'url-policy'; readonly url: string; readonly rejection: UrlRejection }
  /** The document came from an address other than `127.0.0.1` or `::1`, or from none. */
  | { readonly reason: 'not-local'; readonly address: string }
  /**
   * The page went to another document after the one asked for had loaded, as through a redirect
   * in a script. The new document is not audited: it passed neither layer 3 nor the status check.
   */
  | { readonly reason: 'navigated' }
  /** The browser could not load the page, as when nothing listens on the port. */
  | { readonly reason: 'load-failed'; readonly message: string }
  /** The page did not load in time, or the whole visit took too long. */
  | { readonly reason: 'timeout' }
  /** The browser could not be started, was closed, or closed or crashed during the visit. */
  | { readonly reason: 'browser-unavailable'; readonly message: string };

export type Visit<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: VisitFailure };

/** One browser, shared by every call of the server. */
export interface BrowserPort {
  /**
   * Opens `url` in a context of its own (no cookies or storage shared with another visit), passes
   * the loaded page to `use`, and closes the context when `use` settles. The time limit of a visit
   * counts from `since`, a time in milliseconds such as `Date.now()`, when given: a second visit of
   * the same call gets what the first left.
   */
  visit<T>(url: string, use: (page: LoadedPage) => Promise<T>, since?: number): Promise<Visit<T>>;
  /** Closes the browser. A visit after this fails with `browser-unavailable`. */
  close(): Promise<void>;
}

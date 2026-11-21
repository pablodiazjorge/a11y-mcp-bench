// The identifier of a finding (ADR 0004): a short hash of the route, the rule, the tag of the
// Angular component and the engine's selector, so that the same defect keeps its identifier from
// one audit to the next while the selector and the component's tag do not change. It names a
// finding; it is not a security measure.

// The attributes that Angular adds for the styles of a component, such as
// `[_ngcontent-ng-c1234567890=""]`. Their number changes when the app is built again. They start
// with the app's id, which can hold `_`, as in `_ngcontent-shop_app-c2506416247`.
const ANGULAR_STYLE_ATTRIBUTE = /\[_ng(?:content|host)-[A-Za-z0-9_-]+(?:="[^"]*")?\]/g;
// An `id` that ends in a hyphen and a number, such as `#cdk-overlay-0` or `#mat-input-3`: the
// Angular CDK and Angular Material count their elements so, in the order they create them. An id
// such as `#step2`, which an app writes itself, keeps its number.
const NUMBERED_ID = /#((?:[A-Za-z_]|-[A-Za-z_])[\w-]*-)\d+(?![\w-])/g;

/** The selector without the parts that change on their own between two builds or two visits. */
export function stableSelector(selector: string): string {
  return selector.replace(ANGULAR_STYLE_ATTRIBUTE, '').replace(NUMBERED_ID, '#$1');
}

/** FNV-1a over the UTF-16 code units of `text`: short, synchronous and deterministic. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The route of a page in its app: the path of its URL, without the query, and the fragment when it
 * starts with `#/`, where an app that routes by fragment keeps its views.
 */
export function routeOf(url: string): string {
  const { pathname, hash } = new URL(url);
  return hash.startsWith('#/') ? `${pathname}${hash}` : pathname;
}

/** The hash of a finding, eight hex digits. */
export function findingHash(
  route: string,
  rule: string,
  component: string,
  selector: string,
): string {
  return fnv1a(`${route}\n${rule}\n${component}\n${stableSelector(selector)}`);
}

export interface Identifiable {
  readonly rule: string;
  /**
   * The tag of the component that declares the element, such as `app-card`, or empty. On an Angular
   * page, removing the style attribute often leaves a bare selector such as `span`; the component
   * keeps the elements of two components apart without their position in the document.
   */
  readonly component: string;
  readonly selector: string;
  readonly documentIndex: number;
}

/**
 * The identifiers of `findings`, in the same order. When two findings give the same hash, each of
 * them gets its position in the document after it, so no two identifiers of an audit are equal.
 */
export function findingIds(route: string, findings: readonly Identifiable[]): string[] {
  const hashes = findings.map(({ rule, component, selector }) =>
    findingHash(route, rule, component, selector),
  );
  const counts = new Map<string, number>();
  for (const hash of hashes) counts.set(hash, (counts.get(hash) ?? 0) + 1);
  return hashes.map((hash, index) =>
    (counts.get(hash) ?? 0) > 1 ? `${hash}-${String(findings[index]?.documentIndex)}` : hash,
  );
}

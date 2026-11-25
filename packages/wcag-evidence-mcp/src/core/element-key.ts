// The keys that name the elements of a page between two scripts of the keyboard walk (ADR 0007).
// The browser adapter finds an element, such as the one with focus, and the rule engine adapter
// later reads its selector and its component; the two adapters may not import each other (ADR
// 0004), so they meet in a registry that lives in the page's isolated world, under the name below,
// which this script sets up. The page's own scripts cannot reach that world.

/** The number that the isolated world gives an element, the same for the whole visit. */
export type ElementKey = number;

/**
 * A script that sets up the registry once per document and leaves `registry` in scope, with
 * `registry.keyOf(element)` and `registry.get(key)`, which gives null for an unknown key. Each
 * script that uses the registry starts with it.
 */
export const ELEMENT_REGISTRY_SCRIPT = String.raw`
const registry = (globalThis.__wcagEvidenceElements ??= (() => {
  const byKey = new Map();
  const keys = new WeakMap();
  let next = 1;
  return {
    keyOf(element) {
      let key = keys.get(element);
      if (key === undefined) {
        key = next++;
        keys.set(element, key);
        byKey.set(key, element);
      }
      return key;
    },
    get(key) {
      return byKey.get(key) ?? null;
    },
  };
})());
`;

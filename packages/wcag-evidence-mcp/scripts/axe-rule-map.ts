// Builds the map of axe-core rules in src/core/axe-rules.json from what axe-core says about its
// own rules. It records facts only: the criteria that each rule carries, whether axe-core runs it
// by default and whether it reports a failure only as one to review. It decides nothing about which rules the server runs.

import * as z from 'zod';
import type { AxeRule, AxeRuleMap } from '../src/core/axe-rules.ts';

// What the generator reads from axe-core. `_audit` is not part of axe-core's typed API, but it
// is the only place that holds every rule with whether it ships turned on. `ruleShouldRun` is
// the function axe-core itself uses to choose the rules of a run, so the map does not repeat
// that choice by hand. If one of these fields is missing or has another type, the generator
// stops.

/** axe-core's choice of whether a rule runs, for a context and the options of a run. */
type RuleShouldRun = (rule: object, context: { page: boolean }, options: object) => unknown;

const axeSchema = z.object({
  version: z.string().min(1),
  utils: z.object({
    ruleShouldRun: z.custom<RuleShouldRun>((value) => typeof value === 'function'),
  }),
  _audit: z.object({
    rules: z.array(
      z.looseObject({
        id: z.string().min(1),
        tags: z.array(z.string()),
        enabled: z.boolean(),
        reviewOnFail: z.boolean(),
      }),
    ),
  }),
});

export interface AxeFacts {
  readonly version: string;
  readonly rules: readonly {
    id: string;
    tags: readonly string[];
    enabled: boolean;
    /** Whether axe-core runs the rule on a whole page when it is given no rules or tags. */
    runsByDefault: boolean;
    /** Whether axe-core reports a failure of the rule as one to review, never as a violation. */
    reviewOnFail: boolean;
  }[];
}

/**
 * Reads the facts that the map needs from the axe-core module, and fails if one of them is
 * missing or has another type.
 */
export function readAxeFacts(axe: unknown): AxeFacts {
  const { version, utils, _audit } = axeSchema.parse(axe);
  // zod returns plain copies. axe-core gets its own rule objects, with their prototype, as in a run.
  const originals = (axe as { _audit: { rules: object[] } })._audit.rules;
  const rules = _audit.rules.map((rule, index) => ({
    id: rule.id,
    tags: rule.tags,
    enabled: rule.enabled,
    // A run of a whole page with no options: what `axe.run(document)` does.
    runsByDefault: utils.ruleShouldRun(originals[index] ?? rule, { page: true }, {}) === true,
    reviewOnFail: rule.reviewOnFail,
  }));
  return { version, rules };
}

/**
 * The criterion that a tag names, such as `2.4.11` for `wcag2411`, or undefined for any other
 * tag. The level tags (`wcag2a`, `wcag21aa`) end in letters and name no criterion.
 */
export function criterionOfTag(tag: string): string | undefined {
  const match = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  return match === null ? undefined : `${match[1] ?? ''}.${match[2] ?? ''}.${match[3] ?? ''}`;
}

/** Orders criteria by their numbers, so that 2.4.11 comes after 2.4.7. */
function byNumber(a: string, b: string): number {
  const [x, y] = [a, b].map((id) => id.split('.').map(Number));
  for (let index = 0; index < 3; index++) {
    const difference = (x?.[index] ?? 0) - (y?.[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Builds the map: every rule that carries the tag of one of `criteria`, in the order of ids. */
export function buildAxeRuleMap(facts: AxeFacts, criteria: readonly string[]): AxeRuleMap {
  const rules: AxeRule[] = [];
  for (const { id, tags, enabled, runsByDefault, reviewOnFail } of facts.rules) {
    const tagged = [...new Set(tags.map(criterionOfTag).filter((c) => c !== undefined))];
    const ours = tagged.filter((criterion) => criteria.includes(criterion)).sort(byNumber);
    if (ours.length === 0) continue;
    rules.push({
      id,
      criteria: ours,
      otherCriteria: tagged.filter((criterion) => !ours.includes(criterion)).sort(byNumber),
      runsByDefault,
      enabled,
      experimental: tags.includes('experimental'),
      deprecated: tags.includes('deprecated'),
      reviewOnFail,
    });
  }
  rules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { axeCore: facts.version, rules };
}

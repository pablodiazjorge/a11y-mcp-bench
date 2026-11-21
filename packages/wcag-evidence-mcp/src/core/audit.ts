// The `audit_route` use case: open one local page, run the rules of the twelve criteria on it and
// shape what failed into the output contract of ADR 0004.

import * as z from 'zod';
import { AXE_RULE_MAP, type AxeRule } from './axe-rules.ts';
import type { BrowserPort, VisitFailure } from './browser.ts';
import { CRITERIA, criterionIdSchema } from './criteria.ts';
import { findingIds, routeOf } from './finding-id.ts';
import {
  componentSchema,
  measurementSchema,
  rectSchema,
  type Component,
  type EngineFinding,
  type RuleEngine,
} from './rule-engine.ts';

/**
 * The most characters of serialized JSON that an output may take. ADR 0004 sets the starting point
 * under Claude Code's warning of 10,000 tokens; docs/architecture.md gives the measure behind it.
 */
export const OUTPUT_CAP = 20_000;

// The rule that the server turns on although axe-core ships it turned off: the only one for 2.5.8
// (docs/wcag-2.2-scope.md).
const RULES_TURNED_ON: readonly string[] = ['target-size'];

/**
 * The rules that an audit runs: those that axe-core runs by default for the twelve criteria, and
 * the rules that the server turns on. Experimental and deprecated rules stay out.
 */
export function auditedRules(rules: readonly AxeRule[] = AXE_RULE_MAP.rules): AxeRule[] {
  return rules.filter(
    (rule) =>
      !rule.experimental &&
      !rule.deprecated &&
      (rule.runsByDefault || RULES_TURNED_ON.includes(rule.id)),
  );
}

/** The numbers of the twelve criteria, in order. */
export const CRITERION_IDS: readonly string[] = CRITERIA.map(({ id }) => id);
const ruleIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

// The descriptions below are what the agent reads of the output: it sees the JSON schema, not
// this code, so each one says its unit and what it means.
const findingSchema = z.strictObject({
  id: z
    .string()
    .describe(
      'Stays the same from one audit to the next while the element keeps its selector; ends in -<position in the document> when two elements give the same hash',
    ),
  criteria: z
    .array(criterionIdSchema)
    .describe('The criteria of the twelve that the rule checks, defined in definitions'),
  rule: ruleIdSchema.describe('The axe-core rule that the element fails'),
  measurement: measurementSchema.describe('What the rule measured on the element'),
  location: z
    .strictObject({
      selector: z
        .string()
        .describe(
          "axe-core's CSS selector of the element, written by the page's code; ' >>> ' separates the steps into shadow roots",
        ),
      rect: rectSchema,
      component: componentSchema,
    })
    .describe('Where the element is'),
});

const definitionSchema = z.strictObject({
  criterion: criterionIdSchema,
  name: z.string(),
  requires: z.string().describe('What the criterion requires, in one sentence'),
  understanding: z
    .string()
    .describe("The criterion's Understanding page at the W3C, which explains it in full"),
});

const pageSchema = z.strictObject({
  status: z
    .number()
    .int()
    .describe('The HTTP status of the page, such as 200, or 404 for a page not found'),
  refusedRequests: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'How many requests of the page the URL policy refused, such as a stylesheet on another host: what they would have loaded is missing from the audit',
    ),
  settled: z
    .boolean()
    .describe(
      'Whether, after load, the page went 500 ms with no change to its DOM and no request in flight before the audit. False when it was still changing after 10 seconds. Content that arrives later, such as on a timer, can be missing even when true',
    ),
});

export const auditOutputSchema = z.strictObject({
  page: pageSchema.describe('What the audit saw of the page itself'),
  findings: z
    .array(findingSchema)
    .describe(
      'One per element that fails a rule, by criterion, then rule, then document order. Rules that pass or do not apply give none',
    ),
  definitions: z.array(definitionSchema).describe('Each criterion that the findings name, once'),
  notChecked: z
    .array(criterionIdSchema)
    .describe(
      'Criteria asked for that no rule checks yet: their own checks are not built, so the audit says nothing about them',
    ),
  truncated: z.boolean().describe('Whether findings were left out to keep the output small'),
  leftOut: z
    .array(
      z.strictObject({
        rule: ruleIdSchema,
        criteria: z.array(criterionIdSchema).describe('The criteria to ask for to see them'),
        findings: z.number().int().positive(),
      }),
    )
    .describe(
      'How many findings of each rule were left out. Asking for fewer criteria shows more of them, though not those beyond the cap for a single criterion',
    ),
});

export type AuditOutput = z.infer<typeof auditOutputSchema>;
type Finding = AuditOutput['findings'][number];
/** The parts of the output that do not depend on how many findings fit. */
export type AuditContext = Pick<AuditOutput, 'page' | 'notChecked'>;

export interface AuditRequest {
  /** The URL of the page, which the URL policy checks (ADR 0005). */
  readonly url: string;
  /** Only the findings of these criteria. All twelve when left out. */
  readonly criteria?: readonly string[] | undefined;
}

export type AuditResult =
  | { readonly ok: true; readonly output: AuditOutput }
  | { readonly ok: false; readonly failure: VisitFailure };

export interface AuditPorts {
  readonly browser: BrowserPort;
  readonly engine: RuleEngine;
}

/**
 * Audits the page at `request.url`. It throws when the engine's result breaks the contract, so
 * that a page that tampers with the engine gives an error, never an empty audit.
 */
export async function auditRoute(
  ports: AuditPorts,
  request: AuditRequest,
  cap: number = OUTPUT_CAP,
): Promise<AuditResult> {
  const scope = request.criteria ?? CRITERION_IDS;
  const rules = auditedRules().filter((rule) => rule.criteria.some((id) => scope.includes(id)));
  const visit = await ports.browser.visit(request.url, async (page) => {
    const found = await ports.engine.run(
      page,
      rules.map(({ id }) => id),
    );
    // Read after the run, so that it counts what the page asked for while the rules ran too.
    const seen = {
      status: page.status,
      refusedRequests: page.refusedRequests().length,
      settled: page.settled,
    };
    return { found, page: seen };
  });
  if (!visit.ok) return { ok: false, failure: visit.failure };

  const checked = new Set(rules.flatMap(({ criteria }) => criteria));
  const notChecked = CRITERION_IDS.filter((id) => scope.includes(id) && !checked.has(id));
  const findings = shape(routeOf(request.url), rules, visit.value.found);
  const context = { page: visit.value.page, notChecked };
  return { ok: true, output: auditOutputSchema.parse(fit(findings, context, cap)) };
}

/** The findings, with their criteria and identifiers, in the order of the contract. */
function shape(
  route: string,
  rules: readonly AxeRule[],
  found: readonly EngineFinding[],
): Finding[] {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const rank = (criteria: readonly string[]): number => CRITERION_IDS.indexOf(criteria[0] ?? '');
  const sorted = found
    .map((finding) => {
      const rule = byId.get(finding.rule);
      if (rule === undefined) throw new Error(`the engine reported a rule it was not asked to run`);
      return { finding, criteria: rule.criteria };
    })
    .sort(
      (a, b) =>
        rank(a.criteria) - rank(b.criteria) ||
        compare(a.finding.rule, b.finding.rule) ||
        a.finding.documentIndex - b.finding.documentIndex ||
        compare(a.finding.selector, b.finding.selector),
    );
  const ids = findingIds(
    route,
    sorted.map(({ finding }) => ({ ...finding, component: componentKey(finding.component) })),
  );
  return sorted.map(({ finding, criteria }, index) => ({
    id: ids[index] ?? '',
    criteria: [...criteria],
    rule: finding.rule,
    measurement: finding.measurement,
    location: { selector: finding.selector, rect: finding.rect, component: finding.component },
  }));
}

/**
 * The component as the identifier sums it up: its tag alone. Where it is used and how it was read
 * change when a component gains its first style, as when a fix adds a rule for a contrast, and the
 * identifier should not.
 */
function componentKey(component: Component): string {
  return component?.tag ?? '';
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The output with the longest run of findings, from the first, whose serialized JSON fits in `cap`
 * characters. The definitions and the count of what was left out are counted too.
 *
 * Each finding added makes the output longer: a finding is longer than the entry it takes off the
 * count of what was left out, since it holds the same rule and criteria and more. So the longest
 * run that fits is found by halving, in about 16 steps for 50,000 findings.
 */
export function fit(findings: readonly Finding[], context: AuditContext, cap: number): AuditOutput {
  let total = 0;
  const upTo = findings.map((finding) => (total += JSON.stringify(finding).length));
  const length = (kept: number): number =>
    // The findings go between the brackets of an empty array, with a comma between two of them.
    JSON.stringify({ ...outputWith(findings, 0, context, kept), findings: [] }).length +
    (kept === 0 ? 0 : (upTo[kept - 1] ?? 0) + kept - 1);
  let fits = 0;
  let tooLong = findings.length + 1;
  while (tooLong - fits > 1) {
    const middle = Math.floor((fits + tooLong) / 2);
    if (length(middle) <= cap) fits = middle;
    else tooLong = middle;
  }
  return outputWith(findings, fits, context);
}

/**
 * The output that shows the first `kept` findings. With `countFrom`, it counts what is left out
 * from there, so that the length of any run can be measured without copying the findings.
 */
function outputWith(
  findings: readonly Finding[],
  kept: number,
  context: AuditContext,
  countFrom: number = kept,
): AuditOutput {
  const shown = findings.slice(0, kept);
  const named = new Set(findings.slice(0, countFrom).flatMap(({ criteria }) => criteria));
  const leftOut = new Map<string, { criteria: string[]; findings: number }>();
  for (const { rule, criteria } of findings.slice(countFrom)) {
    const entry = leftOut.get(rule) ?? { criteria: [...criteria], findings: 0 };
    entry.findings += 1;
    leftOut.set(rule, entry);
  }
  return {
    page: { ...context.page },
    findings: shown,
    definitions: CRITERIA.filter(({ id }) => named.has(id)).map((criterion) => ({
      criterion: criterion.id,
      name: criterion.name,
      requires: criterion.requires,
      understanding: criterion.understanding,
    })),
    notChecked: [...context.notChecked],
    truncated: countFrom < findings.length,
    leftOut: [...leftOut]
      .sort(([a], [b]) => compare(a, b))
      .map(([rule, entry]) => ({ rule, ...entry })),
  };
}

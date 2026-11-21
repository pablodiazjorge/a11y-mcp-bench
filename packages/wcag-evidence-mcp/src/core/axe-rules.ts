// Which axe-core rules carry the tag of one of the twelve criteria, as axe-core describes them.
// The core cannot import axe-core (ADR 0004), so the map is a file that `npm run gen` writes
// from the installed axe-core, and a test fails when the file no longer matches it. The map
// holds facts only: which rules the server runs is decided in audit.ts.

import * as z from 'zod';
import map from './axe-rules.json' with { type: 'json' };
import { criterionIdSchema } from './criteria.ts';

export const axeRuleSchema = z.strictObject({
  id: z.string().min(1),
  /** The criteria of the twelve that the rule carries, in the order of their numbers. */
  criteria: z.array(criterionIdSchema).min(1),
  /** The other WCAG criteria that the rule carries, such as 2.1.3, a criterion at level AAA. */
  otherCriteria: z.array(criterionIdSchema),
  /** Whether axe-core runs the rule on a whole page when it is given no list of rules or tags. */
  runsByDefault: z.boolean(),
  /** Whether axe-core ships the rule turned on. */
  enabled: z.boolean(),
  experimental: z.boolean(),
  deprecated: z.boolean(),
});

export const axeRuleMapSchema = z.strictObject({
  /** The version of axe-core that the map was read from. */
  axeCore: z.string().min(1),
  /** One entry per rule, in the order of their ids. */
  rules: z.array(axeRuleSchema),
});

export type AxeRule = z.infer<typeof axeRuleSchema>;
export type AxeRuleMap = z.infer<typeof axeRuleMapSchema>;

export const AXE_RULE_MAP: AxeRuleMap = axeRuleMapSchema.parse(map);

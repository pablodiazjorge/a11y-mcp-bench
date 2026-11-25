// What the server says about one of its twelve criteria: the `explain_criterion` tool and the
// criteria's resources return it. Every text comes from the catalog (`criteria.ts`, kept in step
// with docs/wcag-2.2-scope.md by a test) and the rules from the map of axe-core rules, through the
// same choice of rules that an audit makes.

import * as z from 'zod';
import { auditedRules } from './audit.ts';
import { CRITERIA, criterionIdSchema, criterionResource, type Criterion } from './criteria.ts';
import { KEYBOARD_RULES } from './keyboard.ts';

// The descriptions below are what the agent reads of the output, in the tool's output schema.
export const explanationSchema = z.strictObject({
  criterion: criterionIdSchema.describe("The criterion's number, such as 1.4.3"),
  name: z.string().describe("The criterion's name in WCAG 2.2"),
  level: z.enum(['A', 'AA']).describe("The criterion's level in WCAG 2.2"),
  requires: z.string().describe('What the criterion requires, in one sentence'),
  resource: z
    .string()
    .describe("The criterion's resource on this server, which holds this same explanation"),
  understanding: z
    .string()
    .describe("The criterion's Understanding page at the W3C, which explains it in full"),
  audited: z
    .boolean()
    .describe(
      'Whether audit_route checks part of the criterion today, with axe-core or with a check of its own. When false, an audit lists it in notChecked, and a person has to check all of it',
    ),
  axeCoreRules: z
    .array(z.string())
    .describe(
      'The axe-core rules that audit_route runs for the criterion and that can give a finding, which names it. Empty when axe-core has none',
    ),
  reviewOnlyRules: z
    .array(z.string())
    .describe(
      'axe-core rules that audit_route runs for the criterion but that only mark an element for review, which audit_route does not report: what they look for is left for a person',
    ),
  ownCheck: z
    .enum(['none', 'check', 'heuristic'])
    .describe(
      "The server's own check of the criterion, beyond axe-core: a check, or a heuristic, which gives candidates, some of them wrong, that a person confirms. The keyboard checks walk the page with Tab and Shift+Tab, and never activate anything",
    ),
  ownRule: z
    .string()
    .nullable()
    .describe(
      "The rule that names the findings of the server's own check, or null when the criterion has none",
    ),
  class: z
    .enum(['automatic', 'semi-automatic'])
    .describe(
      'The class of the criterion. automatic: the server decides pass or fail for the part it checks. semi-automatic: a person confirms its findings',
    ),
  manual: z
    .string()
    .describe("What is left for a person to check beyond the server's checks for the criterion"),
});

export type Explanation = z.infer<typeof explanationSchema>;

/** The server's own check of a criterion, by how the catalog decides it. */
function ownCheckOf(decidedBy: Criterion['decidedBy']): Explanation['ownCheck'] {
  if (decidedBy === 'axe-core') return 'none';
  return decidedBy === 'own-check' ? 'check' : 'heuristic';
}

/** The explanation of criterion `id`, or `undefined` when it is not one of the twelve. */
export function explainCriterion(id: string): Explanation | undefined {
  const criterion = CRITERIA.find((each) => each.id === id);
  if (criterion === undefined) return undefined;
  const rules = auditedRules().filter(({ criteria }) => criteria.includes(id));
  const ownRule = Object.entries(KEYBOARD_RULES).find(([, criterion]) => criterion === id)?.[0];
  return explanationSchema.parse({
    criterion: criterion.id,
    name: criterion.name,
    level: criterion.level,
    requires: criterion.requires,
    resource: criterionResource(criterion.id),
    understanding: criterion.understanding,
    // As the notChecked of an audit that saw the whole page says.
    audited: rules.length > 0 || ownRule !== undefined,
    axeCoreRules: rules.filter(({ reviewOnFail }) => !reviewOnFail).map(({ id: rule }) => rule),
    reviewOnlyRules: rules.filter(({ reviewOnFail }) => reviewOnFail).map(({ id: rule }) => rule),
    ownCheck: ownCheckOf(criterion.decidedBy),
    ownRule: ownRule ?? null,
    class: criterion.class,
    manual: criterion.manual,
  });
}

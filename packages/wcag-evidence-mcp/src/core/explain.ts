// What the server says about one of its twelve criteria: the `explain_criterion` tool and the
// criteria's resources return it. Every text comes from the catalog (`criteria.ts`, kept in step
// with docs/wcag-2.2-scope.md by a test) and the rules from the map of axe-core rules, through the
// same choice of rules that an audit makes.

import * as z from 'zod';
import { auditedRules } from './audit.ts';
import { CRITERIA, criterionIdSchema, criterionResource, type Criterion } from './criteria.ts';

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
      'Whether audit_route checks part of the criterion today. When false, an audit lists it in notChecked, and a person has to check all of it',
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
    .enum(['none', 'heuristic, not built yet', 'not built yet'])
    .describe(
      "The server's own check of the criterion, beyond axe-core. A heuristic gives candidates, some of them wrong, that a person confirms",
    ),
  class: z
    .enum(['automatic', 'semi-automatic'])
    .nullable()
    .describe(
      'The class of the criterion once all of its checks are built. automatic: the server decides pass or fail for the part it checks. semi-automatic: a person confirms its findings. null: set when the keyboard checks are designed',
    ),
  manual: z
    .string()
    .nullable()
    .describe(
      "What is left for a person to check once all of the server's checks for the criterion are built. While ownCheck says not built yet, a person also checks what that check would. null until the criterion's own check is designed",
    ),
});

export type Explanation = z.infer<typeof explanationSchema>;

const OWN_CHECK = {
  'axe-core': 'none',
  'own-check': 'not built yet',
  heuristic: 'heuristic, not built yet',
  'axe-core-and-heuristic': 'heuristic, not built yet',
} as const satisfies Record<Criterion['decidedBy'], Explanation['ownCheck']>;

/** The explanation of criterion `id`, or `undefined` when it is not one of the twelve. */
export function explainCriterion(id: string): Explanation | undefined {
  const criterion = CRITERIA.find((each) => each.id === id);
  if (criterion === undefined) return undefined;
  const rules = auditedRules().filter(({ criteria }) => criteria.includes(id));
  return explanationSchema.parse({
    criterion: criterion.id,
    name: criterion.name,
    level: criterion.level,
    requires: criterion.requires,
    resource: criterionResource(criterion.id),
    understanding: criterion.understanding,
    // No own check is built yet, so only axe-core checks a criterion today, as the notChecked of
    // an audit says. When the first own check arrives, `audited` has to count it too.
    audited: rules.length > 0,
    axeCoreRules: rules.filter(({ reviewOnFail }) => !reviewOnFail).map(({ id: rule }) => rule),
    reviewOnlyRules: rules.filter(({ reviewOnFail }) => reviewOnFail).map(({ id: rule }) => rule),
    ownCheck: OWN_CHECK[criterion.decidedBy],
    class: criterion.class,
    manual: criterion.manual,
  });
}

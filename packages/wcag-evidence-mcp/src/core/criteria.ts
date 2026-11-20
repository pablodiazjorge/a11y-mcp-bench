// The twelve WCAG 2.2 criteria that the server will check, as data. docs/wcag-2.2-scope.md
// explains each one, and a test keeps the two in step. The output of an audit will define each
// criterion once (ADR 0004), and will take that definition from here.

import * as z from 'zod';

/** The number of a WCAG success criterion, such as `2.4.11`. */
export const criterionIdSchema = z.string().regex(/^[1-4]\.\d\.\d{1,2}$/);

export const criterionSchema = z.object({
  id: criterionIdSchema,
  name: z.string().min(1),
  level: z.enum(['A', 'AA']),
  /** What the criterion requires, in one plain sentence. */
  requires: z.string().min(1),
  /** The criterion's Understanding page at the W3C. */
  understanding: z.url({ protocol: /^https$/, hostname: /^www\.w3\.org$/ }),
  /**
   * How the server decides it: with axe-core rules, with a check of its own, or with a check of
   * its own that is a heuristic, whose findings say so.
   */
  decidedBy: z.enum(['axe-core', 'own-check', 'heuristic']),
  /** Whether a person has to confirm the server's findings. `null` until the check is designed. */
  class: z.enum(['automatic', 'semi-automatic']).nullable(),
});

export type Criterion = z.infer<typeof criterionSchema>;

const understanding = (page: string): string =>
  `https://www.w3.org/WAI/WCAG22/Understanding/${page}.html`;

/** The twelve criteria, in the order of their numbers. */
export const CRITERIA: readonly Criterion[] = z.array(criterionSchema).parse([
  {
    id: '1.1.1',
    name: 'Non-text Content',
    level: 'A',
    requires:
      'Every image or other non-text content has a text alternative that serves the same purpose.',
    understanding: understanding('non-text-content'),
    decidedBy: 'axe-core',
    class: 'automatic',
  },
  {
    id: '1.3.1',
    name: 'Info and Relationships',
    level: 'A',
    requires:
      'The structure and relationships that the page shows visually (headings, lists, tables, labels) are also in its code or in text.',
    understanding: understanding('info-and-relationships'),
    decidedBy: 'axe-core',
    class: 'automatic',
  },
  {
    id: '1.3.5',
    name: 'Identify Input Purpose',
    level: 'AA',
    requires:
      'A field that asks for information about the user declares its purpose in the code, such as with an `autocomplete` value.',
    understanding: understanding('identify-input-purpose'),
    decidedBy: 'axe-core',
    class: 'automatic',
  },
  {
    id: '1.4.3',
    name: 'Contrast (Minimum)',
    level: 'AA',
    requires:
      'Text has a contrast ratio of at least 4.5:1 with its background, or 3:1 for large text.',
    understanding: understanding('contrast-minimum'),
    decidedBy: 'axe-core',
    class: 'automatic',
  },
  {
    id: '2.1.1',
    name: 'Keyboard',
    level: 'A',
    requires: 'Everything on the page can be done with a keyboard.',
    understanding: understanding('keyboard'),
    decidedBy: 'heuristic',
    class: 'semi-automatic',
  },
  {
    id: '2.1.2',
    name: 'No Keyboard Trap',
    level: 'A',
    requires:
      'When the keyboard can move focus into a part of the page, it can also move focus out of it, and the user is told how if it takes more than the usual keys.',
    understanding: understanding('no-keyboard-trap'),
    decidedBy: 'heuristic',
    class: 'semi-automatic',
  },
  {
    id: '2.4.3',
    name: 'Focus Order',
    level: 'A',
    requires:
      'Keyboard focus moves through the page in an order that keeps its meaning and lets it be used.',
    understanding: understanding('focus-order'),
    decidedBy: 'heuristic',
    class: 'semi-automatic',
  },
  {
    id: '2.4.4',
    name: 'Link Purpose (In Context)',
    level: 'A',
    requires:
      'The purpose of each link can be told from its text, or from its text and its context.',
    understanding: understanding('link-purpose-in-context'),
    decidedBy: 'axe-core',
    class: 'automatic',
  },
  {
    id: '2.4.7',
    name: 'Focus Visible',
    level: 'AA',
    requires:
      'Any part of the page that works with a keyboard shows when it has the keyboard focus.',
    understanding: understanding('focus-visible'),
    decidedBy: 'own-check',
    class: null,
  },
  {
    id: '2.4.11',
    name: 'Focus Not Obscured (Minimum)',
    level: 'AA',
    requires:
      'A control that receives keyboard focus is not entirely hidden by content of the page, such as a sticky header.',
    understanding: understanding('focus-not-obscured-minimum'),
    decidedBy: 'own-check',
    class: null,
  },
  {
    id: '2.5.8',
    name: 'Target Size (Minimum)',
    level: 'AA',
    requires:
      'A target for a pointer, such as a button, is at least 24 by 24 CSS pixels, or has enough space around it, with some exceptions.',
    understanding: understanding('target-size-minimum'),
    decidedBy: 'axe-core',
    class: 'semi-automatic',
  },
  {
    id: '4.1.2',
    name: 'Name, Role, Value',
    level: 'A',
    requires:
      'Every control has a name and a role that software can read, and assistive technologies can read its states and values, set those that the user can set, and are told when they change.',
    understanding: understanding('name-role-value'),
    decidedBy: 'axe-core',
    class: 'automatic',
  },
]);

// The closed lists of the rules that carry the accessible name (ADR 0006): every rule of the map
// that checks a criterion about names is sorted into one of them, by hand.

import { describe, expect, it } from 'vitest';
import { AXE_RULE_MAP } from '../src/core/axe-rules.ts';
import { NAME_CRITERIA, NAME_RULES, RULES_WITHOUT_NAME } from '../src/core/name-rules.ts';

const ofNameCriteria = AXE_RULE_MAP.rules
  .filter(({ criteria, otherCriteria }) =>
    [...criteria, ...otherCriteria].some((id) => NAME_CRITERIA.includes(id)),
  )
  .map(({ id }) => id);

describe('the rules that carry the accessible name', () => {
  it('sort every rule of the map that checks a criterion about names into one list', () => {
    expect(ofNameCriteria.length).toBeGreaterThan(0);
    for (const rule of ofNameCriteria) {
      const lists = [NAME_RULES, RULES_WITHOUT_NAME].filter((list) => list.has(rule));
      expect(lists, rule).toHaveLength(1);
    }
  });

  it('name only rules of the map that check a criterion about names', () => {
    for (const rule of [...NAME_RULES.keys(), ...RULES_WITHOUT_NAME.keys()]) {
      expect(ofNameCriteria, rule).toContain(rule);
    }
  });

  it('give a reason for each rule', () => {
    for (const reason of [...NAME_RULES.values(), ...RULES_WITHOUT_NAME.values()]) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  // Both lists in full, so that moving a rule from one to the other is a change that a test sees.
  it('give the name to the rules whose defect is the name or the text alternative', () => {
    expect([...NAME_RULES.keys()]).toStrictEqual([
      'area-alt',
      'aria-braille-equivalent',
      'aria-command-name',
      'aria-input-field-name',
      'aria-meter-name',
      'aria-progressbar-name',
      'aria-tab-name',
      'aria-toggle-field-name',
      'aria-tooltip-name',
      'button-name',
      'frame-title',
      'frame-title-unique',
      'image-alt',
      'input-button-name',
      'input-image-alt',
      'label',
      'link-name',
      'object-alt',
      'role-img-alt',
      'select-name',
      'summary-name',
      'svg-img-alt',
    ]);
  });

  it('leave the name out of the rules that check ARIA attributes, roles, ids, and hidden or nested elements', () => {
    expect([...RULES_WITHOUT_NAME.keys()]).toStrictEqual([
      'aria-allowed-attr',
      'aria-conditional-attr',
      'aria-deprecated-role',
      'aria-hidden-body',
      'aria-hidden-focus',
      'aria-prohibited-attr',
      'aria-required-attr',
      'aria-roledescription',
      'aria-roles',
      'aria-valid-attr',
      'aria-valid-attr-value',
      'duplicate-id-aria',
      'nested-interactive',
    ]);
  });
});

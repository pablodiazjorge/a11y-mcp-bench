// The map of axe-core rules: every rule in it exists in the installed axe-core, the file is what
// `npm run gen` writes today, and the generator reads axe-core's facts correctly.

import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import {
  buildAxeRuleMap,
  criterionOfTag,
  readAxeFacts,
  type AxeFacts,
} from '../scripts/axe-rule-map.ts';
import { AXE_RULE_MAP, axeRuleMapSchema } from '../src/core/axe-rules.ts';
import { CRITERIA } from '../src/core/criteria.ts';

const TWELVE = CRITERIA.map(({ id }) => id);

describe('the map of axe-core rules', () => {
  it('was read from the installed axe-core', () => {
    expect(AXE_RULE_MAP.axeCore).toBe(axe.version);
  });

  it('names only rules that exist in the installed axe-core', () => {
    const installed = new Set(axe.getRules().map(({ ruleId }) => ruleId));

    expect(AXE_RULE_MAP.rules.length).toBeGreaterThan(0);
    for (const { id } of AXE_RULE_MAP.rules) expect(installed).toContain(id);
  });

  it('is what `npm run gen` writes from the installed axe-core', () => {
    expect(AXE_RULE_MAP).toStrictEqual(buildAxeRuleMap(readAxeFacts(axe), TWELVE));
  });

  it('gives each criterion that axe-core decides at least one rule', () => {
    for (const { id, decidedBy } of CRITERIA) {
      if (decidedBy !== 'axe-core') continue;
      expect(
        AXE_RULE_MAP.rules.some(({ criteria }) => criteria.includes(id)),
        id,
      ).toBe(true);
    }
  });

  it('rejects a map with a field it does not know', () => {
    const [first] = AXE_RULE_MAP.rules;
    const extra = { ...AXE_RULE_MAP, rules: [{ ...first, impact: 'serious' }] };

    expect(axeRuleMapSchema.safeParse(extra).success).toBe(false);
  });
});

describe('the generator of the map', () => {
  it('reads the criterion that a tag names, and nothing from other tags', () => {
    expect(criterionOfTag('wcag111')).toBe('1.1.1');
    expect(criterionOfTag('wcag2411')).toBe('2.4.11');
    expect(criterionOfTag('wcag1412')).toBe('1.4.12');
    for (const tag of ['wcag2a', 'wcag21aa', 'wcag22aaa', 'best-practice', 'wcag11', 'xwcag111']) {
      expect(criterionOfTag(tag), tag).toBeUndefined();
    }
  });

  it('records the facts of each rule that carries one of the criteria', () => {
    const fact = (
      id: string,
      tags: string[],
      enabled: boolean,
      runsByDefault: boolean,
      reviewOnFail = false,
    ) => ({ id, tags, enabled, runsByDefault, reviewOnFail });
    const facts: AxeFacts = {
      version: '9.9.9',
      rules: [
        fact('zeta', ['wcag2a', 'wcag211', 'wcag213'], true, true),
        fact('alpha', ['wcag2411', 'wcag247', 'wcag247'], true, true),
        fact('off', ['wcag258'], false, false),
        fact('new', ['wcag131', 'experimental'], true, false),
        fact('old', ['wcag412', 'deprecated'], false, false),
        fact('elsewhere', ['wcag2a', 'wcag242'], true, true),
        fact('review', ['wcag412'], true, true, true),
        fact('practice', ['best-practice'], true, true),
      ],
    };
    const rule = (id: string, criteria: string[], extra: object) => ({
      id,
      criteria,
      otherCriteria: [],
      runsByDefault: true,
      enabled: true,
      experimental: false,
      deprecated: false,
      reviewOnFail: false,
      ...extra,
    });

    expect(
      buildAxeRuleMap(facts, ['1.3.1', '2.1.1', '2.4.7', '2.4.11', '2.5.8', '4.1.2']),
    ).toStrictEqual({
      axeCore: '9.9.9',
      rules: [
        rule('alpha', ['2.4.7', '2.4.11'], {}),
        rule('new', ['1.3.1'], { runsByDefault: false, experimental: true }),
        rule('off', ['2.5.8'], { runsByDefault: false, enabled: false }),
        rule('old', ['4.1.2'], { runsByDefault: false, enabled: false, deprecated: true }),
        rule('review', ['4.1.2'], { reviewOnFail: true }),
        rule('zeta', ['2.1.1'], { otherCriteria: ['2.1.3'] }),
      ],
    });
  });

  it('asks axe-core whether each rule runs on a whole page with no options', () => {
    const calls: unknown[][] = [];
    const shape = {
      version: '4.14.0',
      utils: {
        ruleShouldRun: (...args: unknown[]) => {
          calls.push(args);
          return (args[0] as { pageLevel?: boolean }).pageLevel === true;
        },
      },
      _audit: {
        rules: [
          { id: 'page', tags: ['wcag241'], enabled: true, reviewOnFail: true, pageLevel: true },
          { id: 'element', tags: ['wcag111'], enabled: true, reviewOnFail: false },
        ],
      },
    };

    expect(readAxeFacts(shape)).toStrictEqual({
      version: '4.14.0',
      rules: [
        { id: 'page', tags: ['wcag241'], enabled: true, runsByDefault: true, reviewOnFail: true },
        {
          id: 'element',
          tags: ['wcag111'],
          enabled: true,
          runsByDefault: false,
          reviewOnFail: false,
        },
      ],
    });
    // axe-core receives its own rule objects, not the copies that the schema returns.
    expect(calls).toHaveLength(2);
    for (const [index, [rule, context, options]] of calls.entries()) {
      expect(rule).toBe(shape._audit.rules[index]);
      expect(context).toStrictEqual({ page: true });
      expect(options).toStrictEqual({});
    }
  });

  it('stops when a field of axe-core that it reads is missing or has another type', () => {
    const shape = {
      version: '4.14.0',
      utils: { ruleShouldRun: () => true },
      _audit: { rules: [{ id: 'a', tags: ['wcag111'], enabled: true, reviewOnFail: false }] },
    };

    expect(readAxeFacts(shape).rules).toHaveLength(1);
    for (const wrong of [
      {},
      { ...shape, version: 4 },
      { ...shape, utils: {} },
      { ...shape, utils: { ruleShouldRun: true } },
      { ...shape, _audit: undefined },
      { ...shape, _audit: { rules: [{ id: 'a', tags: ['wcag111'] }] } },
      { ...shape, _audit: { rules: [{ id: 'a', tags: 'wcag111', enabled: true }] } },
      { ...shape, _audit: { rules: [{ id: 'a', tags: ['wcag111'], enabled: true }] } },
      {
        ...shape,
        _audit: { rules: [{ id: 'a', tags: ['wcag111'], enabled: true, reviewOnFail: 'yes' }] },
      },
    ]) {
      expect(() => readAxeFacts(wrong)).toThrow();
    }
  });

  it('agrees with the choice that axe-core makes without the options of a run', () => {
    // For a plain run, axe-core runs a rule that ships turned on and has no tag that it leaves
    // out by default. The map takes axe-core's own answer; this checks that the two agree today.
    const audit = (axe as unknown as { _audit: { tagExclude: string[] } })._audit;
    const facts = readAxeFacts(axe);

    expect(facts.rules.length).toBeGreaterThan(0);
    for (const { id, tags, enabled, runsByDefault } of facts.rules) {
      expect(runsByDefault, id).toBe(
        enabled && !tags.some((tag) => audit.tagExclude.includes(tag)),
      );
    }
  });
});

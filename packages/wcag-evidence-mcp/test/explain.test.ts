// What the server says about each of its twelve criteria (`core/explain.ts`), without MCP: it
// agrees with the catalog, with the rules that an audit runs and with what an audit leaves out.

import { describe, expect, it } from 'vitest';
import { auditedRules, auditRoute, OUTPUT_CAP } from '../src/core/audit.ts';
import { CRITERIA } from '../src/core/criteria.ts';
import { explainCriterion } from '../src/core/explain.ts';
import { createBrowserDouble, createRuleEngineDouble, pageDouble } from './browser-double.ts';

describe('explainCriterion', () => {
  it.each(CRITERIA)('explains $id from the catalog', (criterion) => {
    expect(explainCriterion(criterion.id)).toMatchObject({
      criterion: criterion.id,
      name: criterion.name,
      level: criterion.level,
      requires: criterion.requires,
      resource: `criterion://${criterion.id}`,
      understanding: criterion.understanding,
      class: criterion.class,
      manual: criterion.manual,
    });
  });

  it('gives the rules that an audit runs for each criterion, apart those that only mark for review', () => {
    for (const { id } of CRITERIA) {
      const rules = auditedRules().filter(({ criteria }) => criteria.includes(id));
      const explained = explainCriterion(id);
      expect(explained?.axeCoreRules, id).toStrictEqual(
        rules.filter(({ reviewOnFail }) => !reviewOnFail).map((rule) => rule.id),
      );
      expect(explained?.reviewOnlyRules, id).toStrictEqual(
        rules.filter(({ reviewOnFail }) => reviewOnFail).map((rule) => rule.id),
      );
    }
    expect(
      CRITERIA.filter(({ id }) => (explainCriterion(id)?.reviewOnlyRules.length ?? 0) > 0).map(
        ({ id }) => [id, explainCriterion(id)?.reviewOnlyRules],
      ),
    ).toStrictEqual([
      ['4.1.2', ['aria-braille-equivalent', 'duplicate-id-aria', 'frame-title-unique']],
    ]);
    expect(explainCriterion('2.5.8')?.axeCoreRules).toStrictEqual(['target-size']);
    expect(explainCriterion('2.1.1')?.axeCoreRules).toStrictEqual([
      'frame-focusable-content',
      'scrollable-region-focusable',
      'server-side-image-map',
    ]);
  });

  it('says a criterion is audited exactly when an audit does not list it in notChecked', async () => {
    const result = await auditRoute(
      { browser: createBrowserDouble(pageDouble()), engine: createRuleEngineDouble([]) },
      { url: 'http://localhost:4200/' },
    );
    if (!result.ok) throw new Error('the audit failed');

    const notAudited = CRITERIA.filter(({ id }) => explainCriterion(id)?.audited === false);
    expect(notAudited.map(({ id }) => id)).toStrictEqual(result.output.notChecked);
    expect(result.output.notChecked).toStrictEqual(['2.4.11']);
  });

  it('says which own check each criterion has, with its rule, all built but that of 2.4.11', () => {
    expect(
      CRITERIA.map(({ id }) => [id, explainCriterion(id)?.ownCheck, explainCriterion(id)?.ownRule]),
    ).toStrictEqual([
      ['1.1.1', 'none', null],
      ['1.3.1', 'none', null],
      ['1.3.5', 'none', null],
      ['1.4.3', 'none', null],
      ['2.1.1', 'heuristic', 'click-not-reachable'],
      ['2.1.2', 'heuristic', 'keyboard-trap'],
      ['2.4.3', 'heuristic', 'focus-order'],
      ['2.4.4', 'none', null],
      ['2.4.7', 'check', 'focus-visible'],
      ['2.4.11', 'not built yet', null],
      ['2.5.8', 'none', null],
      ['4.1.2', 'none', null],
    ]);
  });

  it('explains nothing outside the twelve', () => {
    for (const id of ['2.1.3', '1.1', '', 'criterion://1.1.1']) {
      expect(explainCriterion(id), id).toBeUndefined();
    }
  });

  // docs/architecture.md gives the largest size. Each tool result holds the JSON twice, as
  // structured content and as text.
  it('stays far under the cap of an output, 4.1.2 being the largest', () => {
    const sizes = CRITERIA.map(({ id }) => JSON.stringify(explainCriterion(id)).length);

    expect(Math.max(...sizes)).toBe(1334);
    expect(sizes.indexOf(1334)).toBe(CRITERIA.findIndex(({ id }) => id === '4.1.2'));
    expect(2 * Math.max(...sizes)).toBeLessThan(OUTPUT_CAP);
  });
});

// The `audit_route` use case with doubles for the browser and the rule engine: which rules run,
// the order, the identifiers, the filter and the cap of the output contract (ADR 0004).

import { describe, expect, it } from 'vitest';
import { auditedRules, auditRoute, fit, OUTPUT_CAP, type AuditOutput } from '../src/core/audit.ts';
import { findingHash } from '../src/core/finding-id.ts';
import type { EngineFinding } from '../src/core/rule-engine.ts';
import { createBrowserDouble, createRuleEngineDouble, pageDouble } from './browser-double.ts';

const URL_ASKED = 'http://localhost:4200/catalog';

function found(rule: string, selector: string, documentIndex: number): EngineFinding {
  return {
    rule,
    selector,
    rect: { x: 0, y: documentIndex, width: 10, height: 10 },
    documentIndex,
    measurement: { kind: 'failed-checks', checks: ['some-check'] },
  };
}

async function audit(
  findings: readonly EngineFinding[],
  criteria?: readonly string[],
  cap?: number,
): Promise<AuditOutput> {
  const result = await auditRoute(
    { browser: createBrowserDouble(pageDouble()), engine: createRuleEngineDouble(findings) },
    { url: URL_ASKED, criteria },
    cap,
  );
  if (!result.ok) throw new Error(`the audit failed: ${JSON.stringify(result.failure)}`);
  return result.output;
}

describe('auditedRules', () => {
  it('runs the default rules of axe-core for the twelve criteria and target-size, no experimental or deprecated one', () => {
    const ids = auditedRules().map(({ id }) => id);

    expect(ids).toHaveLength(48);
    expect(ids).toContain('target-size');
    expect(ids).toEqual(
      expect.arrayContaining([
        'frame-focusable-content',
        'scrollable-region-focusable',
        'server-side-image-map',
      ]),
    );
    for (const left of [
      'p-as-heading',
      'table-fake-caption',
      'td-has-header',
      'aria-roledescription',
    ]) {
      expect(ids).not.toContain(left);
    }
  });
});

describe('auditedRules, on rules made up for the test', () => {
  const rule = {
    criteria: ['1.1.1'],
    otherCriteria: [],
    enabled: true,
    experimental: false,
    deprecated: false,
  };

  it('leaves out an experimental or a deprecated rule even when axe-core runs it by default', () => {
    const ids = auditedRules([
      { ...rule, id: 'kept', runsByDefault: true },
      { ...rule, id: 'experimental', runsByDefault: true, experimental: true },
      { ...rule, id: 'deprecated', runsByDefault: true, deprecated: true },
      { ...rule, id: 'off', runsByDefault: false },
      { ...rule, id: 'target-size', runsByDefault: false, enabled: false },
    ]).map(({ id }) => id);

    expect(ids).toStrictEqual(['kept', 'target-size']);
  });
});

describe('auditRoute', () => {
  it('orders the findings by criterion, then rule, then document order', async () => {
    const output = await audit([
      found('link-name', 'a.more', 30),
      found('color-contrast', 'p.price', 20),
      found('image-alt', 'img.b', 12),
      found('area-alt', 'area', 40),
      found('image-alt', 'img.a', 11),
      found('button-name', 'button.close', 5),
    ]);

    expect(
      output.findings.map(({ rule, location }) => `${rule} ${location.selector}`),
    ).toStrictEqual([
      'image-alt img.a',
      'image-alt img.b',
      'color-contrast p.price',
      'area-alt area',
      'link-name a.more',
      'button-name button.close',
    ]);
  });

  it('lists only the criteria of the twelve, and defines each one once', async () => {
    const output = await audit([
      found('scrollable-region-focusable', 'ul', 3),
      found('link-name', 'a.one', 4),
      found('link-name', 'a.two', 5),
    ]);

    expect(output.findings.map(({ criteria }) => criteria)).toStrictEqual([
      ['2.1.1'],
      ['2.4.4', '4.1.2'],
      ['2.4.4', '4.1.2'],
    ]);
    expect(output.definitions.map(({ criterion }) => criterion)).toStrictEqual([
      '2.1.1',
      '2.4.4',
      '4.1.2',
    ]);
    expect(output.definitions[1]).toStrictEqual({
      criterion: '2.4.4',
      name: 'Link Purpose (In Context)',
      requires:
        'The purpose of each link can be told from its text, or from its text and its context.',
      understanding: 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html',
    });
  });

  it('identifies each finding by the route, the rule and the selector', async () => {
    const output = await audit([found('image-alt', 'img[_ngcontent-ng-c5=""]', 2)]);

    expect(output.findings[0]?.id).toBe(findingHash('/catalog', 'image-alt', 'img'));
  });

  it('runs only the rules of the criteria asked for, and keeps the same identifiers', async () => {
    const findings = [found('color-contrast', 'p.price', 20), found('image-alt', 'img', 11)];
    const engine = createRuleEngineDouble(findings);
    const all = await audit(findings);

    const result = await auditRoute(
      { browser: createBrowserDouble(pageDouble()), engine },
      { url: URL_ASKED, criteria: ['1.4.3'] },
    );

    expect(engine.runs).toStrictEqual([['color-contrast']]);
    if (!result.ok) throw new Error('the audit failed');
    expect(result.output.findings.map(({ id }) => id)).toStrictEqual([
      all.findings.find(({ rule }) => rule === 'color-contrast')?.id,
    ]);
    expect(result.output.notChecked).toStrictEqual([]);
  });

  it('says which criteria asked for no rule checks', async () => {
    expect((await audit([])).notChecked).toStrictEqual(['2.1.2', '2.4.3', '2.4.7', '2.4.11']);
    expect((await audit([], ['2.4.7', '1.1.1'])).notChecked).toStrictEqual(['2.4.7']);
  });

  it('throws when the engine reports a rule that it was not asked to run', async () => {
    const engine = {
      name: 'tampered 1.0.0',
      run: () => Promise.resolve([found('image-alt', 'img', 1)]),
    };

    await expect(
      auditRoute(
        { browser: createBrowserDouble(pageDouble()), engine },
        { url: URL_ASKED, criteria: ['1.4.3'] },
      ),
    ).rejects.toThrow('the engine reported a rule it was not asked to run');
  });

  it('reports the status of the page, the requests the policy refused and whether it settled', async () => {
    const page = {
      ...pageDouble(),
      status: 404,
      settled: false,
      refusedRequests: () => [
        { url: 'http://127.0.0.2:1/style.css', reason: 'host' as const, kind: 'request' as const },
      ],
    };
    const result = await auditRoute(
      { browser: createBrowserDouble(page), engine: createRuleEngineDouble() },
      { url: URL_ASKED },
    );

    expect(result.ok && result.output.page).toStrictEqual({
      status: 404,
      refusedRequests: 1,
      settled: false,
    });
    expect(JSON.stringify(result)).not.toContain('style.css');
  });

  it('passes on why the page was not opened', async () => {
    const result = await auditRoute(
      { browser: createBrowserDouble(pageDouble()), engine: createRuleEngineDouble() },
      { url: 'http://localhost/' },
    );

    expect(result).toStrictEqual({
      ok: false,
      failure: { reason: 'url-policy', url: 'http://localhost/', rejection: 'port-missing' },
    });
  });
});

describe('the cap, on many findings', () => {
  it('cuts 50,000 findings in well under the time of a call', () => {
    const findings = Array.from({ length: 50_000 }, (_, index) => ({
      id: index.toString(16).padStart(8, '0'),
      criteria: ['1.1.1'],
      rule: 'image-alt',
      measurement: { kind: 'failed-checks' as const, checks: ['has-alt'] },
      location: {
        selector: `.item-${String(index)}`,
        rect: { x: 0, y: index, width: 1, height: 1 },
      },
    }));
    const context = { page: { status: 200, refusedRequests: 0, settled: true }, notChecked: [] };

    const started = performance.now();
    const output = fit(findings, context, OUTPUT_CAP);
    // Generous on purpose: cutting one finding at a time took more than 30 seconds here.
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(OUTPUT_CAP);
    expect(output.leftOut[0]?.findings).toBe(50_000 - output.findings.length);
  });
});

describe('the cap', () => {
  const many = Array.from({ length: 300 }, (_, index) =>
    found(index % 3 === 0 ? 'link-name' : 'image-alt', `.item-${String(index)}`, index),
  );

  it('keeps every finding when the output fits', async () => {
    const output = await audit(many.slice(0, 5));

    expect(output.truncated).toBe(false);
    expect(output.leftOut).toStrictEqual([]);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(OUTPUT_CAP);
  });

  it('keeps the first findings that fit, and counts what it left out by rule', async () => {
    const output = await audit(many);
    const kept = output.findings.length;

    expect(JSON.stringify(output).length).toBeLessThanOrEqual(OUTPUT_CAP);
    expect(output.truncated).toBe(true);
    expect(kept).toBeGreaterThan(0);
    expect(output.leftOut.reduce((sum, { findings }) => sum + findings, 0)).toBe(300 - kept);
    expect(output.leftOut.map(({ rule, criteria }) => [rule, criteria])).toStrictEqual([
      ['image-alt', ['1.1.1']],
      ['link-name', ['2.4.4', '4.1.2']],
    ]);
  });

  it('keeps no finding when the first one alone is longer than the cap', async () => {
    const output = await audit([found('image-alt', `.${'x'.repeat(5_000)}`, 1)], undefined, 1_000);

    expect(output.findings).toStrictEqual([]);
    expect(output.definitions).toStrictEqual([]);
    expect(output.truncated).toBe(true);
    expect(output.leftOut).toStrictEqual([{ rule: 'image-alt', criteria: ['1.1.1'], findings: 1 }]);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(1_000);
  });

  it('keeps a finding when the output with it is exactly as long as the cap, and not one character less', async () => {
    const full = await audit(many, undefined, Number.MAX_SAFE_INTEGER);
    for (const keep of [1, 2, 7, 30]) {
      const length = JSON.stringify(withOneMore(full, keep - 1)).length;

      expect(fit(full.findings, full, length).findings).toHaveLength(keep);
      expect(fit(full.findings, full, length - 1).findings).toHaveLength(keep - 1);
    }
  });

  it('is exact: the longest run of findings whose serialized output fits', async () => {
    const full = await audit(many, undefined, Number.MAX_SAFE_INTEGER);
    for (const cap of [800, 5_000, 12_345]) {
      const output = fit(full.findings, full, cap);
      const kept = output.findings.length;

      expect(kept).toBeLessThan(full.findings.length);
      expect(JSON.stringify(output).length).toBeLessThanOrEqual(cap);
      expect(JSON.stringify(withOneMore(full, kept)).length).toBeGreaterThan(cap);
    }
  });
});

/** The output that keeps one finding more than `kept`, with its count of what is left out. */
function withOneMore(full: AuditOutput, kept: number): AuditOutput {
  const output = fit(full.findings, full, Number.MAX_SAFE_INTEGER);
  const shown = output.findings.slice(0, kept + 1);
  const rest = output.findings.slice(kept + 1);
  const counts = new Map<string, { criteria: string[]; findings: number }>();
  for (const { rule, criteria } of rest) {
    const entry = counts.get(rule) ?? { criteria, findings: 0 };
    counts.set(rule, { criteria, findings: entry.findings + 1 });
  }
  const named = new Set(shown.flatMap(({ criteria }) => criteria));
  return {
    page: output.page,
    findings: shown,
    definitions: output.definitions.filter(({ criterion }) => named.has(criterion)),
    notChecked: output.notChecked,
    truncated: rest.length > 0,
    leftOut: [...counts]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([rule, entry]) => ({ rule, ...entry })),
  };
}

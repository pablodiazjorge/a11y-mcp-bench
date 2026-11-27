// How the two sources of the hops of a redirect count together: a hop that both see counts once,
// and a step, a method with both URLs, that the page takes again counts again.

import { describe, expect, it } from 'vitest';
import { countHops } from '../src/adapters/playwright/redirects.ts';

const FROM = 'http://127.0.0.1:4200/bounce';
const TO = 'http://127.0.0.1:4300/bounced';

describe('countHops', () => {
  it('counts a hop that both sources see once, whichever comes first', () => {
    const first = countHops();
    expect(first.seen('playwright', FROM, TO, 'POST')).toBe(true);
    expect(first.seen('protocol', FROM, TO, 'POST')).toBe(false);
    const second = countHops();
    expect(second.seen('protocol', FROM, TO, 'POST')).toBe(true);
    expect(second.seen('playwright', FROM, TO, 'POST')).toBe(false);
  });

  it('counts a hop that only one source sees', () => {
    const hops = countHops();
    expect(hops.seen('protocol', FROM, TO, 'POST')).toBe(true);
    expect(hops.seen('protocol', FROM, TO, 'POST')).toBe(true);
    // Playwright saw only one of the two: still two in all.
    expect(hops.seen('playwright', FROM, TO, 'POST')).toBe(false);
  });

  it('reports as many hops of a step as the source that saw more', () => {
    const hops = countHops();
    const seen = [
      hops.seen('playwright', FROM, TO, 'POST'),
      hops.seen('protocol', FROM, TO, 'POST'),
      hops.seen('protocol', FROM, TO, 'POST'),
      hops.seen('playwright', FROM, TO, 'POST'),
      hops.seen('protocol', FROM, TO, 'POST'),
    ];
    expect(seen.filter(Boolean)).toHaveLength(3);
  });

  it('tells steps apart by their method and both ends, but not by a fragment', () => {
    const hops = countHops();
    expect(hops.seen('playwright', FROM, TO, 'POST')).toBe(true);
    expect(hops.seen('playwright', FROM, TO, 'PUT')).toBe(true);
    expect(hops.seen('playwright', FROM, `${TO}?again`, 'POST')).toBe(true);
    expect(hops.seen('playwright', `${FROM}?other`, TO, 'POST')).toBe(true);
    // Only Playwright's URL keeps the fragment, which is never sent.
    expect(hops.seen('protocol', FROM, TO, 'POST')).toBe(false);
    expect(hops.seen('playwright', `${FROM}#top`, `${TO}#part`, 'POST')).toBe(true);
    expect(hops.seen('protocol', FROM, TO, 'POST')).toBe(false);
  });
});

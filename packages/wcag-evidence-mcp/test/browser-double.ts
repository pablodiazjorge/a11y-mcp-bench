// A stand-in for the browser port, for the tests of the parts that only pass the browser along.

import type { BrowserPort } from '../src/core/browser.ts';

export interface BrowserDouble extends BrowserPort {
  /** How many times `close` was called. */
  readonly closeCalls: number;
}

export function createBrowserDouble(): BrowserDouble {
  let closeCalls = 0;
  return {
    get closeCalls() {
      return closeCalls;
    },
    visit: () => Promise.reject(new Error('this double opens no page')),
    close: () => {
      closeCalls += 1;
      return Promise.resolve();
    },
  };
}

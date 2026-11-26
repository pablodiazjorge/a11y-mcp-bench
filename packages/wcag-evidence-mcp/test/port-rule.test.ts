// The port rule of ADR 0009, on top of `checkUrl`: a request of the page may read from any allowed
// port, but write only to the page's own, and a WebSocket goes only to the page's own port.

import { describe, expect, it } from 'vitest';
import {
  allowedPort,
  checkRequest,
  checkWebSocket,
  type RequestCheck,
} from '../src/core/url-policy.ts';

const OWN = 'http://localhost:4200/api/items';
const OTHER = 'http://localhost:3000/api/items';
const allowed = (url: string): RequestCheck => ({ allowed: true, url });
const OTHER_PORT: RequestCheck = { allowed: false, reason: 'other-port' };

/** What the case tries, the method, the URL and what the rule answers when the page's port is 4200. */
type Case = readonly [string, string, string, RequestCheck];

const CASES: readonly Case[] = [
  // The page's own port: every method, the browser's and any other.
  ...['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE', 'patch', 'PROPFIND'].map(
    (method): Case => ['the own port', method, OWN, allowed(OWN)],
  ),
  // Another port: the three methods that read, written as the browser writes them.
  ...['GET', 'HEAD', 'OPTIONS'].map((method): Case => [
    'another port',
    method,
    OTHER,
    allowed(OTHER),
  ]),
  // Another port: any method that can write, and a method that reads but is spelled otherwise.
  ...['POST', 'PUT', 'PATCH', 'DELETE', 'patch', 'PROPFIND', 'get', 'Get', ''].map(
    (method): Case => ['another port', method, OTHER, OTHER_PORT],
  ),
  // `127.0.0.1` with the page's port is the same port, whatever the host.
  [
    'the own port on the other host',
    'POST',
    'http://127.0.0.1:4200/',
    allowed('http://127.0.0.1:4200/'),
  ],
];

describe('checkRequest', () => {
  it.each(CASES)('on %s, %j to %s gives %j', (_case, method, url, expected) => {
    expect(checkRequest(url, method, '4200')).toStrictEqual(expected);
  });

  it('lets a page with no document of its own yet only read', () => {
    expect(checkRequest(OWN, 'GET', undefined)).toStrictEqual(allowed(OWN));
    expect(checkRequest(OWN, 'POST', undefined)).toStrictEqual(OTHER_PORT);
  });

  it('gives the reason of checkUrl first, for a read or a write', () => {
    expect(checkRequest('http://example.com:4200/', 'GET', '4200')).toStrictEqual({
      allowed: false,
      reason: 'host',
    });
    expect(checkRequest('http://127.1:3000/', 'POST', '4200')).toStrictEqual({
      allowed: false,
      reason: 'not-as-written',
    });
  });
});

describe('checkWebSocket', () => {
  it('opens a socket to the own port only, read as the http URL', () => {
    expect(checkWebSocket('ws://localhost:4200/ng-cli-ws', '4200')).toStrictEqual(
      allowed('http://localhost:4200/ng-cli-ws'),
    );
    expect(checkWebSocket('ws://localhost:3000/live', '4200')).toStrictEqual(OTHER_PORT);
    expect(checkWebSocket('ws://localhost:4200/live', undefined)).toStrictEqual(OTHER_PORT);
  });

  it('refuses wss, as checkUrl refuses https', () => {
    expect(checkWebSocket('wss://localhost:4200/', '4200')).toStrictEqual({
      allowed: false,
      reason: 'scheme',
    });
  });
});

describe('allowedPort', () => {
  it.each([
    ['http://localhost:4200/catalog', '4200'],
    ['http://127.0.0.1:3000/', '3000'],
    ['about:blank', undefined],
    ['chrome-error://chromewebdata/', undefined],
    ['http://127.1:4200/', undefined],
    ['', undefined],
  ])('reads the port of %j as %j', (url, port) => {
    expect(allowedPort(url)).toBe(port);
  });
});

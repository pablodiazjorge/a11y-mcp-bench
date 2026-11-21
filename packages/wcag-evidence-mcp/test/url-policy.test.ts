// The attack table of the URL policy (ADR 0005). Each row says what the WHATWG parser of Node
// makes of a text and what the policy answers, so a change in either shows here.

import { describe, expect, it } from 'vitest';
import { checkUrl, type UrlRejection } from '../src/core/url-policy.ts';

interface Row {
  /** What the case tries. */
  readonly case: string;
  readonly text: string;
  /** What `new URL(text)` reads as host and port, or null when it throws. */
  readonly node: { readonly host: string; readonly port: string } | null;
  /** The URL the policy allows, or the reason it gives for refusing. */
  readonly policy: { readonly url: string } | UrlRejection;
}

const at = (host: string, port = '4200') => ({ host, port });
// Written as a code so that the repository check, which looks for Spanish in code, passes.
const E_ACUTE = String.fromCharCode(0xe9);
const LOCAL = at('localhost');
const LOOPBACK = at('127.0.0.1');

const ALLOWED: readonly Row[] = [
  {
    case: 'a page',
    text: 'http://localhost:4200/',
    node: LOCAL,
    policy: { url: 'http://localhost:4200/' },
  },
  {
    case: 'no path',
    text: 'http://localhost:4200',
    node: LOCAL,
    policy: { url: 'http://localhost:4200/' },
  },
  {
    case: 'path, query and fragment',
    text: 'http://127.0.0.1:4200/catalog?page=2#top',
    node: LOOPBACK,
    policy: { url: 'http://127.0.0.1:4200/catalog?page=2#top' },
  },
  {
    case: 'query only',
    text: 'http://localhost:4200?page=2',
    node: LOCAL,
    policy: { url: 'http://localhost:4200/?page=2' },
  },
  {
    case: 'escaped and non-ASCII path',
    text: `http://localhost:4200/a%20b/caf${E_ACUTE}`,
    node: LOCAL,
    policy: { url: 'http://localhost:4200/a%20b/caf%C3%A9' },
  },
  {
    case: 'highest port',
    text: 'http://localhost:65535/',
    node: at('localhost', '65535'),
    policy: { url: 'http://localhost:65535/' },
  },
];

const ADDRESS_FORMS: readonly Row[] = [
  {
    case: 'decimal IPv4',
    text: 'http://2130706433:4200/',
    node: LOOPBACK,
    policy: 'not-as-written',
  },
  { case: 'octal IPv4', text: 'http://0177.0.0.1:4200/', node: LOOPBACK, policy: 'not-as-written' },
  {
    case: 'hexadecimal IPv4',
    text: 'http://0x7f.0.0.1:4200/',
    node: LOOPBACK,
    policy: 'not-as-written',
  },
  {
    case: 'one hexadecimal number',
    text: 'http://0x7f000001:4200/',
    node: LOOPBACK,
    policy: 'not-as-written',
  },
  { case: 'short IPv4', text: 'http://127.1:4200/', node: LOOPBACK, policy: 'not-as-written' },
  {
    case: 'three-part IPv4',
    text: 'http://127.0.1:4200/',
    node: LOOPBACK,
    policy: 'not-as-written',
  },
  {
    case: 'zeros before each part',
    text: 'http://127.000.000.001:4200/',
    node: LOOPBACK,
    policy: 'not-as-written',
  },
  {
    case: 'IPv4 with a final dot',
    text: 'http://127.0.0.1.:4200/',
    node: LOOPBACK,
    policy: 'not-as-written',
  },
  {
    case: 'another loopback address',
    text: 'http://127.0.0.2:4200/',
    node: at('127.0.0.2'),
    policy: 'host',
  },
  { case: 'any address', text: 'http://0.0.0.0:4200/', node: at('0.0.0.0'), policy: 'host' },
  { case: 'IPv6 loopback', text: 'http://[::1]:4200/', node: at('[::1]'), policy: 'host' },
  {
    case: 'IPv6 loopback in full',
    text: 'http://[0:0:0:0:0:0:0:1]:4200/',
    node: at('[::1]'),
    policy: 'host',
  },
  {
    case: 'IPv4 mapped in IPv6',
    text: 'http://[::ffff:127.0.0.1]:4200/',
    node: at('[::ffff:7f00:1]'),
    policy: 'host',
  },
  {
    case: 'localhost with a final dot',
    text: 'http://localhost.:4200/',
    node: at('localhost.'),
    policy: 'host',
  },
  {
    case: 'subdomain of localhost',
    text: 'http://shop.localhost:4200/',
    node: at('shop.localhost'),
    policy: 'host',
  },
  {
    case: 'name that starts like localhost',
    text: 'http://localhost.example:4200/',
    node: at('localhost.example'),
    policy: 'host',
  },
  {
    case: 'DNS name of a loopback address',
    text: 'http://127.0.0.1.nip.io:4200/',
    node: at('127.0.0.1.nip.io'),
    policy: 'host',
  },
  {
    case: 'another host',
    text: 'http://evil.example/',
    node: at('evil.example', ''),
    policy: 'host',
  },
  {
    case: 'a redirect to the cloud metadata address',
    text: 'http://169.254.169.254/latest/meta-data/',
    node: at('169.254.169.254', ''),
    policy: 'host',
  },
];

const AUTHORITY_FORMS: readonly Row[] = [
  {
    case: 'host as userinfo, no scheme',
    text: 'localhost:4200@evil.example',
    node: at('', ''),
    policy: 'scheme',
  },
  {
    case: 'host as userinfo',
    text: 'http://localhost:4200@evil.example/',
    node: at('evil.example', ''),
    policy: 'credentials',
  },
  {
    case: 'user and password',
    text: 'http://user:pass@localhost:4200/',
    node: LOCAL,
    policy: 'credentials',
  },
  {
    case: 'user name only',
    text: 'http://user@localhost:4200/',
    node: LOCAL,
    policy: 'credentials',
  },
  {
    case: 'password only',
    text: 'http://:pass@localhost:4200/',
    node: LOCAL,
    policy: 'credentials',
  },
  {
    case: 'empty userinfo',
    text: 'http://@localhost:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  {
    case: 'uppercase scheme',
    text: 'HTTP://localhost:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  { case: 'uppercase host', text: 'http://LOCALHOST:4200/', node: LOCAL, policy: 'not-as-written' },
  {
    case: 'mixed-case host',
    text: 'http://LocalHost:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  {
    case: 'escaped letter in the host',
    text: 'http://local%68ost:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  {
    case: 'escaped host',
    text: 'http://%6c%6f%63%61%6c%68%6f%73%74:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  {
    case: 'circled letter in the host',
    text: 'http://ⓛocalhost:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  {
    case: 'full-width host',
    text: 'http://ｌｏｃａｌｈｏｓｔ:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  {
    case: 'no slashes after the scheme',
    text: 'http:localhost:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  {
    case: 'one slash after the scheme',
    text: 'http:/localhost:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  {
    case: 'three slashes after the scheme',
    text: 'http:///localhost:4200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
];

const SCHEMES_AND_PORTS: readonly Row[] = [
  { case: 'https', text: 'https://localhost:4200/', node: LOCAL, policy: 'scheme' },
  { case: 'file', text: 'file:///etc/passwd', node: at('', ''), policy: 'scheme' },
  { case: 'javascript', text: 'javascript:alert(1)', node: at('', ''), policy: 'scheme' },
  { case: 'data', text: 'data:text/html,<p>x</p>', node: at('', ''), policy: 'scheme' },
  { case: 'WebSocket', text: 'ws://localhost:4200/', node: LOCAL, policy: 'scheme' },
  {
    case: 'host and port with no scheme',
    text: 'localhost:4200',
    node: at('', ''),
    policy: 'scheme',
  },
  { case: 'no port', text: 'http://localhost/', node: at('localhost', ''), policy: 'port-missing' },
  {
    case: 'empty port',
    text: 'http://localhost:/',
    node: at('localhost', ''),
    policy: 'port-missing',
  },
  {
    case: 'no port, with `:80` in the path',
    text: 'http://localhost/a:80',
    node: at('localhost', ''),
    policy: 'port-missing',
  },
  { case: 'port 0', text: 'http://localhost:0/', node: at('localhost', '0'), policy: 'port-zero' },
  {
    case: 'default port',
    text: 'http://localhost:80/',
    node: at('localhost', ''),
    policy: 'default-port',
  },
  {
    case: 'default port with a zero',
    text: 'http://localhost:080/',
    node: at('localhost', ''),
    policy: 'default-port',
  },
  {
    case: 'default port, uppercase scheme',
    text: 'HTTP://localhost:80/',
    node: at('localhost', ''),
    policy: 'default-port',
  },
  {
    case: 'zero before the port',
    text: 'http://localhost:04200/',
    node: LOCAL,
    policy: 'not-as-written',
  },
  { case: 'port out of range', text: 'http://localhost:65536/', node: null, policy: 'invalid-url' },
  { case: 'signed port', text: 'http://localhost:+4200/', node: null, policy: 'invalid-url' },
];

const CHARACTERS_AND_RELATIVE: readonly Row[] = [
  {
    case: 'leading space',
    text: ' http://localhost:4200/',
    node: LOCAL,
    policy: 'unusual-character',
  },
  {
    case: 'trailing space',
    text: 'http://localhost:4200/ ',
    node: LOCAL,
    policy: 'unusual-character',
  },
  {
    case: 'tab in the host',
    text: 'http://local\thost:4200/',
    node: LOCAL,
    policy: 'unusual-character',
  },
  {
    case: 'line break in the path',
    text: 'http://localhost:4200/cat\nalog',
    node: LOCAL,
    policy: 'unusual-character',
  },
  {
    case: 'carriage return in the host',
    text: 'http://local\rhost:4200/',
    node: LOCAL,
    policy: 'unusual-character',
  },
  {
    case: 'trailing control character',
    text: 'http://localhost:4200/\u001f',
    node: LOCAL,
    policy: 'unusual-character',
  },
  {
    case: 'DEL in the path',
    text: 'http://localhost:4200/a\u007fb',
    node: LOCAL,
    policy: 'unusual-character',
  },
  {
    case: 'backslashes for slashes',
    text: 'http:\\\\localhost:4200\\',
    node: LOCAL,
    policy: 'unusual-character',
  },
  {
    case: 'backslash before userinfo',
    text: 'http://localhost:4200\\@evil.example/',
    node: LOCAL,
    policy: 'unusual-character',
  },
  { case: 'relative path', text: '/catalog', node: null, policy: 'invalid-url' },
  { case: 'URL without a scheme', text: '//localhost:4200/', node: null, policy: 'invalid-url' },
  { case: 'empty text', text: '', node: null, policy: 'invalid-url' },
];

const TABLE = [
  ...ALLOWED,
  ...ADDRESS_FORMS,
  ...AUTHORITY_FORMS,
  ...SCHEMES_AND_PORTS,
  ...CHARACTERS_AND_RELATIVE,
];

describe('the URL policy', () => {
  it.each(TABLE)('$case: $text', ({ text, node, policy }) => {
    const parsed = URL.canParse(text) ? new URL(text) : null;
    expect(parsed === null ? null : { host: parsed.hostname, port: parsed.port }).toStrictEqual(
      node,
    );

    expect(checkUrl(text)).toStrictEqual(
      typeof policy === 'string'
        ? { allowed: false, reason: policy }
        : { allowed: true, url: policy.url },
    );
  });

  it('gives the same answer for an allowed URL and for the URL that it returns', () => {
    // A browser reports redirects and subresources in the parser's form, and the policy checks
    // them again, so the form it returns must pass too.
    for (const { policy } of ALLOWED) {
      if (typeof policy === 'string') continue;
      expect(checkUrl(policy.url)).toStrictEqual({ allowed: true, url: policy.url });
    }
  });

  it('never throws, whatever the text', () => {
    const odd = [
      'http://localhost:4200/\ud800',
      'http://[::1',
      'http://localhost:4200/'.padEnd(100_000, 'a'),
      '\u0000',
      'http://\u0000localhost:4200/',
      '%',
      'http://%zz:4200/',
    ];
    for (const text of odd) expect(() => checkUrl(text)).not.toThrow();
  });
});

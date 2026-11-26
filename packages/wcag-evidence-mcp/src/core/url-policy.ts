// The URL policy (ADR 0005). `checkUrl` is its first layer: which URLs the server may open. It runs
// before a page is opened, and the browser adapter runs it again on every request of the page,
// which it can stop, and on every redirect hop, which it can only report. So an allowed URL must
// also pass in the form that the parser writes it. For the requests of a page, `checkRequest` and
// `checkWebSocket` add the port rule of ADR 0009: writes go only to the page's own port.
//
// Many spellings reach the local machine: `127.1`, `0x7f.0.0.1`, `[::ffff:127.0.0.1]`,
// `localhost.`, `shop.localhost`. The parser turns the numeric ones into `127.0.0.1`, keeps
// `localhost.` as it is and writes the IPv6 ones in its own IPv6 form. A filter that compared only
// what the parser returns would let `127.1` in and keep `localhost.` out, on details of the
// parser, so the policy accepts one written form and compares the text it receives.

/** Why a URL is refused. Each value is stable, so a message or a test can rely on it. */
export type UrlRejection =
  /** The WHATWG URL parser rejects the text. A relative URL is one case. */
  | 'invalid-url'
  /** A space, a control character or a backslash, which the parser drops or rewrites. */
  | 'unusual-character'
  /** A scheme other than `http`. */
  | 'scheme'
  /** A user name or a password before the host. */
  | 'credentials'
  /** A host other than `localhost` or `127.0.0.1`, as the parser reads it. */
  | 'host'
  /** No port, or an empty one. */
  | 'port-missing'
  /** Port 80, the default of `http`, which a browser drops when it writes the URL back. */
  | 'default-port'
  /** Port 0, on which nothing can listen. */
  | 'port-zero'
  /** The text reaches an allowed host and port, but is not written in the one accepted form. */
  | 'not-as-written';

export type UrlCheck =
  /** `url` is what the parser writes for the text, the form that the browser is given. */
  | { readonly allowed: true; readonly url: string }
  | { readonly allowed: false; readonly reason: UrlRejection };

const HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

// Characters that the parser removes or rewrites: it drops tabs and line breaks anywhere, trims
// spaces and control characters at both ends, reads a backslash as a slash before the query, and
// rejects or percent-encodes a space, a control character or DEL elsewhere. After any of these, the
// text no longer says what the parser reads. They are refused in the whole URL, not only before
// the path, because one rule is simpler to check than one for each part of the URL.
function hasUnusualCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Checks a URL against the policy: `http`, host `localhost` or `127.0.0.1` written exactly so,
 * and an explicit port, followed by any path, query and fragment. Never throws.
 */
export function checkUrl(text: string): UrlCheck {
  const refuse = (reason: UrlRejection): UrlCheck => ({ allowed: false, reason });

  if (hasUnusualCharacter(text)) return refuse('unusual-character');
  if (!URL.canParse(text)) return refuse('invalid-url');
  const url = new URL(text);
  if (url.protocol !== 'http:') return refuse('scheme');
  if (url.username !== '' || url.password !== '') return refuse('credentials');
  if (!HOSTS.includes(url.hostname)) return refuse('host');
  if (url.port === '') {
    // The parser drops the default port, so `:80` and `:080` read as no port at all. With no
    // port left, a port written before the path can only be the default one.
    return refuse(/^http:\/\/[^/?#]*:0*80/i.test(text) ? 'default-port' : 'port-missing');
  }
  if (url.port === '0') return refuse('port-zero');

  // The parser agrees on scheme, host and port. The text itself must also say them in the one
  // accepted form: lowercase, no other spelling of the address, no zeros before the port. The
  // parser reads a port up to a slash, a question mark, a number sign or the end, and fails on
  // anything else, so what follows the port in the text is already a path, a query or a fragment.
  if (!text.startsWith(`http://${url.hostname}:${url.port}`)) return refuse('not-as-written');
  return { allowed: true, url: url.href };
}

/**
 * Why a request of the page is refused: a reason of `checkUrl`, or `other-port`, a request that can
 * write, or a WebSocket, to a port other than the page's own (ADR 0009).
 */
export type RequestRejection = UrlRejection | 'other-port';

export type RequestCheck =
  | { readonly allowed: true; readonly url: string }
  | { readonly allowed: false; readonly reason: RequestRejection };

// The methods that read, and so may go to any allowed port. Compared exactly: the browser writes
// these three in uppercase, and a server may read another spelling as another method.
const READ_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/**
 * The port of a URL that the policy allows, such as the page's own document, or undefined for any
 * other URL, such as `about:blank` before the page has a document.
 */
export function allowedPort(url: string): string | undefined {
  const check = checkUrl(url);
  return check.allowed ? new URL(check.url).port : undefined;
}

/**
 * Checks a request of the page (ADR 0009): `checkUrl`, and then a method other than GET, HEAD or
 * OPTIONS only to the page's own port. With no port of its own yet, the page can only read.
 */
export function checkRequest(
  url: string,
  method: string,
  ownPort: string | undefined,
): RequestCheck {
  const check = checkUrl(url);
  if (!check.allowed || READ_METHODS.includes(method)) return check;
  return new URL(check.url).port === ownPort ? check : { allowed: false, reason: 'other-port' };
}

/**
 * Checks a WebSocket of the page. It opens with a GET, but then carries writes, so it goes only to
 * the page's own port (ADR 0009). Its URL is checked as the `http` URL with the same host, port and
 * path, so `wss` is refused as `https` is.
 */
export function checkWebSocket(url: string, ownPort: string | undefined): RequestCheck {
  const check = checkUrl(url.startsWith('ws:') ? `http:${url.slice('ws:'.length)}` : url);
  if (!check.allowed) return check;
  return new URL(check.url).port === ownPort ? check : { allowed: false, reason: 'other-port' };
}

// Chromium connects `localhost` to `::1` when a server listens there: first when it listens on both
// addresses, and only there when the server listens on `::1` alone, as a development server can.
// So both loopback addresses count, in the one form that Playwright writes each: `[::1]` comes in
// brackets. Observed on Windows on 2026-11-21, with the Chrome Headless Shell that
// `playwright-core` 1.65.1 installs.
const LOCAL_ADDRESSES: readonly string[] = ['127.0.0.1', '[::1]'];

/**
 * The third layer of the URL policy: whether the address that the browser connected to, as
 * Playwright reports it, is the local machine.
 */
export function isLocalAddress(address: string): boolean {
  return LOCAL_ADDRESSES.includes(address);
}

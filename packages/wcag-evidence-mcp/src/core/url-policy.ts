// The first layer of the URL policy (ADR 0005): which URLs the server may open. It runs before a
// page is opened and, once the browser port exists, on every redirect hop and subresource that
// goes to the network. So an allowed URL must also pass in the form that the parser writes it.
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

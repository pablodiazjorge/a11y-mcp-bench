# 0005. URL policy: loopback only

- **Status:** Accepted
- **Decided:** 2026-11-21

## Context

The server audits only pages served by the same machine on loopback (the loopback address, which never leaves the machine), as [ADR 0001](0001-scope-and-non-goals.md) sets. A server that opens any URL an agent passes it can be pointed at internal services, such as a router's page or the metadata address of a cloud machine. The agent's input is untrusted, and so are the pages: a page can redirect, load subresources and open connections to other hosts.

Option B and its three layers were chosen on 2026-11-14, from the probes below. How the first layer treats the cases that the probes did not cover, its reasons and what it returns were settled on 2026-11-21, the date above.

The facts below were observed on 2026-11-14 with Chrome 157 driven by `playwright-core` 1.65.0, on Windows, in one run per probe, unless marked otherwise.

- **The local machine has many spellings.** `127.1`, `0x7f.0.0.1`, `0177.0.0.1`, `2130706433`, `[::ffff:127.0.0.1]`, `localhost.`, `shop.localhost` and a DNS name such as `127.0.0.1.nip.io` all reach it. And `http://localhost:4200@evil.example` looks local, but its host is `evil.example`.
- **Node's URL parser** (it follows the WHATWG URL standard, as browsers do) turns the numeric forms into `127.0.0.1`, keeps `localhost.` as it is and writes IPv6 forms in its own IPv6 form, such as `[::ffff:7f00:1]`, never as `127.0.0.1`. A filter that compares only what the parser returns would treat `127.1` as `127.0.0.1` but not `localhost.`, so whether a spelling passes would depend on details of the parser.
- **Playwright's request interception** (`page.route` and `context.route`) sees requests and subresources. It does not see the hops of a redirect (documented and observed), what a service worker answers (a script that a page installs in the browser, which can answer requests without the network), or WebSockets.
- **Chromium's `--host-resolver-rules` option**, set to resolve nothing but `localhost` and `127.0.0.1`, makes every other name or address fail to resolve, the hops of a redirect included.
- **Playwright can block service workers** (`serviceWorkers: 'block'`) **and intercept WebSockets** (`routeWebSocket`).
- **The Chrome DevTools Protocol** (the channel through which DevTools controls the browser) can pause every hop of a redirect (`Fetch.enable`). Only Chromium has it, and Playwright does not wrap it.
- **`Response.serverAddr()`** gives the address that the browser connected to.

Not tested: the Chromium build that Playwright installs (the probes used Chrome 157), a DNS answer that changes after the check (DNS rebinding), any of this on Linux or macOS, Firefox and WebKit, and the syntax of the resolver option for IPv6.

## Options considered

- **A. An exact list, plus Playwright's interception.** Only Playwright's API. A redirect to another host is not stopped.
- **B. A, plus Chromium's resolver option.** Every host outside the list fails to resolve, redirects included. Chromium only, which is the only browser the server uses.
- **C. A, plus the interception of the DevTools Protocol.** It sees every hop. Chromium only, and it depends on an API of Chrome that Playwright does not wrap.
- **D. A proxy, or a container with no network.** The policy is enforced outside the browser, with more parts to maintain.

## Decision

Option B, in three layers.

**Layer 1, before a page is opened.** A URL is allowed only when its text is `http://`, then `localhost` or `127.0.0.1` written exactly so, then a colon and a port, then any path, query and fragment. The check reads the text it receives, not only what the parser returns, so `127.1` and `0x7f.0.0.1` are refused although they reach the local machine. That is the rule of `AGENTS.md` for checks that guard security: accept only the shapes that are known.

`checkUrl` in `packages/wcag-evidence-mcp/src/core/url-policy.ts` applies it. It returns either the allowed URL, as the parser writes it, or a reason:

| Reason              | When                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `unusual-character` | A space, a control character or a backslash anywhere: the parser drops or rewrites them                                                    |
| `invalid-url`       | The parser rejects the text, as it does a relative URL                                                                                     |
| `scheme`            | A scheme other than `http`                                                                                                                 |
| `credentials`       | A user name or a password before the host                                                                                                  |
| `host`              | A host other than `localhost` or `127.0.0.1`, as the parser reads it                                                                       |
| `port-missing`      | No port, or an empty one                                                                                                                   |
| `default-port`      | Port 80, which a browser drops when it writes the URL back, as in a redirect                                                               |
| `port-zero`         | Port 0                                                                                                                                     |
| `not-as-written`    | An allowed host and port, with uppercase in the scheme or host, zeros before the port, or another spelling of the address, such as `127.1` |

The cases that the probes did not cover are decided so:

- **Zeros before the port or before a part of the address** are refused: `http://localhost:04200/` and `http://127.0.0.01:4200/` give `not-as-written`.
- **Port 80 written explicitly** is refused: `http://localhost:80/` gives `default-port`. The reason is below.
- **Uppercase in the scheme or the host** is refused: `HTTP://localhost:4200/` gives `not-as-written`. The path keeps its own case, so `http://localhost:4200/Catalog` is allowed.
- **An empty path** is allowed, and the parser writes it `/`: `http://localhost:4200` returns `http://localhost:4200/`.
- **A space, a control character or a backslash anywhere** is refused, in the path too: `http://localhost:4200/a b` gives `unusual-character`.

Once the browser port exists, the same check runs again on every redirect hop and every subresource that goes to the network, that is, on `http` requests. What happens to `data:`, `blob:`, `about:blank`, `about:srcdoc` and the WebSocket of Angular's development server (`ws://localhost:4200/`) is decided with the browser port: an Angular page uses them, and cutting them would change the audit. The browser is expected to report URLs in the parser's form, so an allowed URL passes again in the form that `checkUrl` returns. Port 80 is refused for the same reason: the browser writes `http://localhost:80/` as `http://localhost/`, which has no port, so the page's own requests would be refused. In which form the browser gives each URL is still to be checked. The parser keeps a backslash in a query or a fragment, for one, so a subresource written that way would be refused.

**Layer 2, in the browser.** Chromium's resolver option lets only `localhost` and `127.0.0.1` resolve. Playwright's interception cuts the requests to any other host, service workers are blocked, and WebSockets are intercepted.

**Layer 3, after a page loads.** The server checks that the address the browser connected to is the local one.

Layers 2 and 3 are decided and will be built later, with the browser port and the Playwright adapter. The probes above are repeated then with the Chromium that Playwright installs.

**Not in v1.0:** IPv6 addresses such as `[::1]`, and a list of other hosts that a user can allow. IPv6 here means a URL written with an IPv6 address. With Node 17 or later, `localhost` can resolve to `::1` first, so a development server such as Angular's (Vite) may listen only on `::1`, and the browser would then connect to `[::1]`. Whether layer 3 counts `::1` as local is decided when it is built.

## Consequences

- An agent has to give the URL in one form, such as `http://localhost:4200/catalog?page=2`. A page served on port 80 cannot be audited, and a URL written with an IPv6 address such as `[::1]` is refused.
- `checkUrl` is a pure function in the core, with no browser. The attack table (a list of URL texts, each with what the parser reads and what the policy must answer) runs as tests on every CI job, on Ubuntu and on Windows. It records what the parser of Node makes of each text, so a change in the parser shows there.
- Any port of the local machine is allowed, so an agent can point the server at another local service. The tools are read-only, but opening a page sends a GET request, and some local services act on one.
- A DNS answer that changes after the check (DNS rebinding) was not tested. Layer 3, which checks the address the browser connected to, is meant to catch it; it is not built or tested yet.
- The policy depends on Chromium. Another browser would need another way to block resolution.
- The attack table for layers 2 and 3, with redirects, service workers and WebSockets, comes with the browser port, on a local test site.

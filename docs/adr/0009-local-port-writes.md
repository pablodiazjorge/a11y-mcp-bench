# 0009. Writes to other local ports

- **Status:** Accepted
- **Decided:** 2026-11-25

## Context

[ADR 0005](0005-url-policy.md) keeps every request of an audited page on `localhost` or `127.0.0.1`, but allows any port there. So a hostile page, or a hostile URL in the agent's input, can send requests to every `http` service on the machine: a development server, a database console, a tool that listens on loopback and trusts what reaches it ([threat model](../../THREAT_MODEL.md)). A form-style POST is the usual way to make such a service act.

The facts below were observed on 2026-11-25 with Chrome Headless Shell 159.0.8154.6 driven by `playwright-core` 1.65.1, on Windows 11, unless marked otherwise.

- **An audit never clicks or types** (decided in [ADR 0007](0007-keyboard-checks.md)), so the requests of a page during an audit are those that its own scripts make.
- **Playwright's interception sees the method of each request,** from `fetch`, a form, `navigator.sendBeacon` and `fetch` with `keepalive`, of the page, its frames and its dedicated workers. A real Chromium sent each of them through it.
- **While it intercepts, Playwright answers the browser's CORS preflights itself, and allows them** (read in its code, and seen: the other server got no `OPTIONS` before a `PUT`, a `PATCH` or a `DELETE`). CORS is the browser's check that a service on another origin, such as another port, accepts a request. So under the interception, a write that the service would have refused at the preflight is sent anyway.
- **A 307 or 308 redirect keeps the method,** and Playwright's interception does not see the hops of a redirect (ADR 0005). A POST to the page's own port that its server redirects to another port reaches that port (observed).
- **The browser writes the method in uppercase only for six standard methods:** `DELETE`, `GET`, `HEAD`, `OPTIONS`, `POST` and `PUT` (the [Fetch standard](https://fetch.spec.whatwg.org/#concept-method-normalize)). `fetch` with `method: 'patch'` sends `patch` (observed).
- **A WebSocket opens with a GET,** and then carries messages both ways, which the interception cannot tell apart as reads or writes.

## Options considered

- **Keep any port,** as ADR 0005 does: every app works as it does in a browser, and every local service can receive the page's writes.
- **Reads to any port, writes only to the page's own:** requests other than GET, HEAD and OPTIONS go only to the page's own port. An app that reads an API on another port keeps working, and a form-style POST to another service is cut. But an app that writes to an API on another port while it loads, as most GraphQL clients do, loses that data during the audit.
- **The page's own port only:** the strongest, but it breaks the common setup of a development server and an API on another port. The audit would then see a page without its data, and report what is missing as if it were the app.
- **A list of allowed ports in the server's settings:** precise for each app, but one more setting to get right, and ADR 0005 kept the server without one.

## Decision

**Reads to any port, writes only to the page's own.**

**Where it applies.** The rule amends the port rule of ADR 0005 for the requests of a page, in the same place where the URL policy cuts them, so every path that the policy checks gets it.

Settled by the author with the change that applies the rule, on 2026-11-25:

- **The methods that read** are `GET`, `HEAD` and `OPTIONS`, compared exactly, as the browser writes them. Any other method, or another spelling such as `get` or `patch`, counts as a write: a server may read another spelling as another method, and the rule accepts only the forms that it knows ([`AGENTS.md`](../../AGENTS.md)).
- **The page's own port** is the port of the first document that the page's main frame commits, after the redirects that the policy allowed. The audit reads that document, and its scripts write to the server that served it. The port of the URL asked would be wrong after an allowed redirect to another port: it would refuse the writes of the app and allow writes to a port that only redirected. Before the page has a document, no port is its own, and the page can only read. The host does not count: `localhost:4200` and `127.0.0.1:4200` are the same port.
- **The own port never moves,** and **frames, popups and dedicated workers** follow the same rule, with that port. Both close a way for a hostile page to reach another local service and make its scripts act:
  - a page that goes to another port, with a GET such as `location.href = …`, would otherwise write there with the scripts of its new document before the visit fails as `navigated`;
  - a frame on another port cannot write even to its own port, since a hostile page could frame another local service.
- **`navigator.sendBeacon` and `fetch` with `keepalive`** send a POST, so they follow the rule like any other write.
- **A WebSocket** opens only to the page's own port, since it carries writes once open. The WebSocket of a development server, such as Angular's live reload, is on the page's port and keeps working. An app that shows live data from a socket on another port loses it during the audit.
- **Each refusal** counts in `refusedRequests` of the output, which stays a count with no URL, and the log names it with the reason `other-port`.
- **A redirect hop** that carries a write to another port is listed like the other hops that the policy refuses, but not stopped: the interception does not see it.
- **Shared workers and speculation rules** stay outside the interception, as ADR 0005 records.

## Consequences

- **An app that writes to an API on another port while it loads** loses those writes during the audit, and what they would have brought: an API that answers queries over POST, such as most GraphQL clients, leaves its part of the page empty. `refusedRequests` counts them. A development server that proxies the API on its own port, as Angular's `proxy.conf.json` does, keeps working.
- **The CORS preflights that Playwright allows** no longer let a write reach another port. A read with custom headers, such as a GET with `X-Csrf`, still passes them.
- **What remains:**
  - **A GET with side effects** reaches any local port: an `<img>`, a link that a script follows, or a service that acts on a GET.
  - **The agent's own URL** can name any local port, as in ADR 0005: opening a page is a GET.
  - **A redirect from the page's own server** with 307 or 308 carries a write to another port. It is listed, not stopped.
  - **The WebSockets of dedicated workers**, and **the requests and WebSockets of shared workers**, pass the interception, so they reach any local port. **Speculation rules** pass it too, with a prefetch, which is a GET.
  - **The page's own port** may hold a service other than the app, on the other loopback address: a server on `::1` and another on `127.0.0.1`, both on port 4200. The rule treats them as one.
- **Tests:** a table of the rule in the core, and a real Chromium that writes to another local server through `fetch`, a form, `sendBeacon`, `fetch` with `keepalive`, a frame, a dedicated worker and a document that the page goes to on that port, which must receive nothing.

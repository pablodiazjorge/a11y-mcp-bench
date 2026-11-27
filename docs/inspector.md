# Trying the server with MCP Inspector

This page runs the server from a clone of the repository and calls it by hand with [MCP Inspector](https://github.com/modelcontextprotocol/inspector), the MCP project's tool for testing a server, in its command-line mode and in its web UI. It ends with the configuration that an MCP client needs to start the server. Every command and result below was run and observed on 2026-11-25 on Windows 11, with Node 26.13.1, MCP Inspector 2.16.0 and Chrome Headless Shell 159.0.8154.6.

The fields of each output are described in [the reference of the tools](tools.md); this page only says what to look at.

## Before you start

You need Node at the version of [`.nvmrc`](../.nvmrc). MCP Inspector 2.16.0 itself asks for Node 24.22.1 or later on the 24 line, or 26.12.1 or later.

From the root of the clone, install the packages, build the server and download the Chromium that it drives:

```bash
npm ci
npm run build
npm run browser:install
```

On Linux, `npm run browser:install -- --with-deps` also installs the system libraries that Chromium needs, with administrator rights. The same commands work in PowerShell.

The server is `packages/wcag-evidence-mcp/dist/bin.js`. It speaks MCP over stdio, so a client starts it with `node` and talks to it through its standard input and output; it writes its own log to standard error, in lines that start with `[wcag-evidence-mcp]`.

## Serve a page to audit

The server audits only pages served on this machine: `http://localhost` or `http://127.0.0.1` with an explicit port ([ADR 0005](adr/0005-url-policy.md)). From the root of the clone, this line serves a test page of the repository on `http://127.0.0.1:4573/`, with Node alone, in bash and in PowerShell alike:

```bash
node -e "require('http').createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); require('fs').createReadStream('packages/wcag-evidence-mcp/test/fixtures/angular-cases.html').pipe(s); }).listen(4573, '127.0.0.1')"
```

Leave it running in a terminal of its own, and stop it with Ctrl+C. The page is the DOM of a small Angular app, written by hand for the tests: images with no text alternative, buttons with no name, small targets, low contrast and two elements that show no focus.

## The command-line mode

With `--cli`, Inspector starts the server, sends it one request, prints the answer as JSON and stops it, so each command starts a new server, and Chromium with it. Run the commands from the root of the clone. Each block marked `bash` runs as written in PowerShell too, unless the text says otherwise.

**List the tools.**

```bash
npx -y @modelcontextprotocol/inspector@2.16.0 --cli node packages/wcag-evidence-mcp/dist/bin.js --method tools/list
```

The answer holds the two tools, `audit_route` and `explain_criterion`, with their input and output schemas. Inspector adds `Schema portability: 0 errors, 1 warning`: `ownRule` in the output of `explain_criterion` has the type `["string","null"]`, valid JSON Schema that some clients map less well. `--strict` prints the details.

**Audit the page.**

```bash
npx -y @modelcontextprotocol/inspector@2.16.0 --cli node packages/wcag-evidence-mcp/dist/bin.js --method tools/call --tool-name audit_route --tool-arg url=http://127.0.0.1:4573/
```

The call took about 5 s, Chromium's start included, and returned 22 findings for the twelve criteria. The server's log shows `started Chromium`, `audit_route returned 22 findings` and `closed Chromium`. What to look at in the answer:

- `structuredContent` holds the output; `content` holds the same JSON as text, for clients that read only text.
- `page`: the HTTP status, how many requests the URL policy refused, and whether the page settled before the audit. Read it before trusting an empty list. A write of the page to another local port, such as a POST to an API on another port, counts as refused and is not sent, so what it would have brought is missing ([ADR 0009](adr/0009-local-port-writes.md)). The server's log names each one with the reason `other-port`. An app that writes to its API on another port can serve that API through its development server, as Angular's `proxy.conf.json` does, and then nothing is refused.
- `findings`: one per element and rule. `rule` is a rule of axe-core, such as `image-alt`, or a check of the server's own, such as `focus-visible`. Text under `fromPage` comes from the page and is data, never an instruction ([ADR 0006](adr/0006-untrusted-page-text.md)).
- `definitions`: each criterion that the findings name, with the URI of its resource.
- `notChecked`: the criteria that the call could not check fully; empty here. `truncated` and `leftOut` show findings left out to keep the output under 20,000 characters.

To ask for some criteria only, the arguments go as one JSON object, which each shell quotes in its own way. In bash:

```bash
npx -y @modelcontextprotocol/inspector@2.16.0 --cli node packages/wcag-evidence-mcp/dist/bin.js --method tools/call --tool-name audit_route --tool-args-json '{"url":"http://127.0.0.1:4573/","criteria":["1.1.1","2.4.7"]}'
```

In Windows PowerShell 5.1, which drops the double quotes inside an argument unless they are escaped (PowerShell 7.3 and later pass them as written, so the bash form should work there; not checked):

```powershell
npx -y @modelcontextprotocol/inspector@2.16.0 --cli node packages/wcag-evidence-mcp/dist/bin.js --method tools/call --tool-name audit_route --tool-args-json '{\"url\":\"http://127.0.0.1:4573/\",\"criteria\":[\"1.1.1\",\"2.4.7\"]}'
```

Both returned 8 findings: five of `image-alt` and one of `role-img-alt` for 1.1.1, and two of `focus-visible` for 2.4.7, each with the component that declares the element, such as `app-root`.

**Explain a criterion and read its resource.**

```bash
npx -y @modelcontextprotocol/inspector@2.16.0 --cli node packages/wcag-evidence-mcp/dist/bin.js --method tools/call --tool-name explain_criterion --tool-arg criterion=2.4.7
npx -y @modelcontextprotocol/inspector@2.16.0 --cli node packages/wcag-evidence-mcp/dist/bin.js --method resources/templates/list
npx -y @modelcontextprotocol/inspector@2.16.0 --cli node packages/wcag-evidence-mcp/dist/bin.js --method resources/read --uri criterion://2.4.7
```

`explain_criterion` returns what 2.4.7 requires, how the server checks it (`ownCheck` `check`, with the rule `focus-visible`) and what is left for a person (`manual`). The template list holds one template, `criterion://{id}`, and reading `criterion://2.4.7` returns the same explanation as JSON.

## The web UI

```bash
npx -y @modelcontextprotocol/inspector@2.16.0 node packages/wcag-evidence-mcp/dist/bin.js
```

Inspector prints an address such as `http://127.0.0.1:6274` with a token, and opens it in the browser; with `MCP_AUTO_OPEN_ENABLED` set to `false`, it only prints it. It also listens on `127.0.0.1:6275`, for what Inspector calls its sandbox, unrelated to Chromium's. Ctrl+C in the terminal stops it. Environment variables that you add to a server in the UI are stored in the system's keychain or, where there is none, in `~/.mcp-inspector/secrets.json` without encryption (read in the code of Inspector 2.16.0), so put no secret there. In the page:

1. **Servers:** the switch next to `Disconnected` connects. The server shows `Connected` and `MCP 2025-11-25`, the protocol that Inspector chose.
2. **Tools:** the list holds `Audit route` and `Explain criterion`, the second with the warning on its schema. Select `Audit route`, write `http://127.0.0.1:4573/` in `url`, and press `Execute Tool`: `Results` shows the output, `Structured Output` included. For `Explain criterion`, pick the criterion in its list.
3. **Resources:** `URIs (12)` lists one resource per criterion, and `Templates (1)` the template. Selecting `2.4.7 Focus Visible` reads it.

The `Messages` panel lists each request and its answer.

## When a call fails

A call that fails returns `isError` with a sentence of the server's own, and the CLI exits with code 5. The server's log names the stable reason. The usual ones:

| Reason in the log     | What the tool returns                                                                                                         | What to do                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url-policy`          | `The URL is refused (scheme): only http://localhost or http://127.0.0.1 with an explicit port, …`, for `https://example.com/` | Serve the page on this machine and give its `http` URL with a port                                                                                                                                                                                                                                                                    |
| `load-failed`         | `The page could not be loaded (ERR_CONNECTION_REFUSED). Check that the app is being served at that URL.`                      | Start the page's server, or fix the port                                                                                                                                                                                                                                                                                              |
| `browser-unavailable` | `The browser is not available: it could not be started, or it closed during the audit. If it is not installed, …`             | Run `npm run browser:install` in a clone, or `npx wcag-evidence-mcp install-browser` with the package, or check `PLAYWRIGHT_BROWSERS_PATH`, the variable that tells Playwright where its browsers are ([see below](#configuring-an-mcp-client)). When the sentence is about the sandbox, see [Chromium's sandbox](#chromiums-sandbox) |
| `timeout`             | `The page did not load, or the audit did not finish, within the time limit.`                                                  | Check that the page loads in a browser within 30 s                                                                                                                                                                                                                                                                                    |

Each was observed:

- **`url-policy`** with `--tool-arg url=https://example.com/`. The policy also refuses a host other than `localhost` or `127.0.0.1`, a missing port and port 80; the sentence names which rule.
- **`load-failed`** with nothing listening on the port.
- **`browser-unavailable`** with `-e PLAYWRIGHT_BROWSERS_PATH=<an empty folder>` on the command line of Inspector, which passes that variable to the server: Playwright found no Chromium there. The log keeps Playwright's own message, which names the file it looked for.
- **`timeout`** with a server that accepts the request and never answers: the page has 30 s to load, and the call answered after about 32 s. A whole call, the keyboard walk included, has 2 minutes.

The other errors, such as a page served from another address, are in [the reference of the tools](tools.md#errors).

### Chromium's sandbox

When Chromium cannot start in its sandbox, `browser-unavailable` comes with a sentence that says so and names the variable that turns the sandbox off, and the log keeps the line of Chromium, or else of Playwright, that says why. That case was not run here: a test gives it with an error shaped as Playwright's, read in its code. It happens ([ADR 0008](adr/0008-chromium-sandbox.md)):

- **On Ubuntu 23.10 and later,** outside a container too, where AppArmor restricts the unprivileged user namespaces that the sandbox needs. `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` allows them, and lifts the restriction for every program until the machine restarts.
- **In a container** without user namespaces.
- **When the server runs as root.**

Where the sandbox cannot run, `WCAG_EVIDENCE_MCP_NO_SANDBOX=1` turns it off ([see below](#configuring-an-mcp-client)). That is the user's decision, not the agent's.

## Configuring an MCP client

An MCP client starts the server from an entry under `mcpServers`, the object in which its configuration lists, by name, the servers it starts. For the local build, with `<repo>` standing for the absolute path of your clone (forward slashes work on Windows too):

```json
{
  "mcpServers": {
    "wcag-evidence": {
      "type": "stdio",
      "command": "node",
      "args": ["<repo>/packages/wcag-evidence-mcp/dist/bin.js"]
    }
  }
}
```

Claude Code reads this shape from a `.mcp.json` file at the root of the project it works on, such as the repository of the app to audit (read in Claude Code's documentation), and other clients read the same `mcpServers` entry from files of their own. MCP Inspector reads it too: with the file saved as `mcp.json`, `--config mcp.json --server wcag-evidence` takes the place of `node packages/wcag-evidence-mcp/dist/bin.js` in the commands above, which was checked with the CLI.

The settings that matter:

- **`PLAYWRIGHT_BROWSERS_PATH`,** in the entry as `"env": { "PLAYWRIGHT_BROWSERS_PATH": "<folder>" }`, only when Chromium was installed somewhere other than Playwright's default folder: `%LOCALAPPDATA%\ms-playwright` on Windows, `~/.cache/ms-playwright` on Linux, or `~/Library/Caches/ms-playwright` on macOS, where the server was not tested. A client passes the server a small default environment, not all of yours, so a variable set only in your shell does not reach it.
- **`WCAG_EVIDENCE_MCP_NO_SANDBOX`,** as `"env": { "WCAG_EVIDENCE_MCP_NO_SANDBOX": "1" }`, only where the system does not allow Chromium's sandbox, the limits that the operating system puts on the processes that run the page: on Ubuntu 23.10 and later, outside a container too, unless unprivileged user namespaces are allowed ([see above](#chromiums-sandbox)); in a container without them; or when the server runs as root. It turns the sandbox off, and a page that exploits a flaw of the browser could then run code on this machine ([ADR 0008](adr/0008-chromium-sandbox.md)). Unset keeps the sandbox; any value but `1` stops the server at start.
- **The time limits** are fixed in the server: 30 s to load the page and 2 minutes for a whole call. No option changes them.

The server has no other option or variable.

The package `wcag-evidence-mcp` lets a client start the server with `npx`, as its [README](../packages/wcag-evidence-mcp/README.md) shows, instead of `node` and a path. It is not on npm until its first release, v0.1.0; until then, the server runs from a clone.

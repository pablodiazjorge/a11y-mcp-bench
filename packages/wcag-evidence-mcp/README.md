# wcag-evidence-mcp

An MCP (Model Context Protocol) server that audits a web page served on your machine against 12 WCAG 2.2 criteria, and returns evidence that a coding agent can act on: for each finding, the criteria, the rule, what was measured and where the element is.

This is version 0.1.0, an early release: the tools and their output may change before 1.0. The server is part of [a11y-mcp-bench](https://github.com/pablodiazjorge/a11y-mcp-bench), a benchmark of whether such a server helps an agent fix accessibility defects.

## What it does

- **`audit_route`** opens one page in Chromium, runs the axe-core rules for the 12 criteria and walks the page with the keyboard, then lists the findings. **`explain_criterion`** explains one of the 12. The [reference of the tools](https://github.com/pablodiazjorge/a11y-mcp-bench/blob/v0.1.0/docs/tools.md) gives their input, output and errors, and the [scope page](https://github.com/pablodiazjorge/a11y-mcp-bench/blob/v0.1.0/docs/wcag-2.2-scope.md) lists the 12 criteria and what each leaves to a person.
- It opens only `http://localhost` or `http://127.0.0.1` with an explicit port, such as `http://localhost:4200/`, and it never clicks or types in the page.

## Install

You need Node 26, or Node 24.15 or a later 24.x. The server drives Chrome Headless Shell, a build of Chromium for running without a window, which npm does not install. This command downloads the build that the server expects, into Playwright's cache folder, and removes no other browser:

```bash
npx -y wcag-evidence-mcp@0.1.0 install-browser
```

On Linux, `npx -y wcag-evidence-mcp@0.1.0 install-browser --with-deps` also installs the system libraries that Chromium needs, with administrator rights.

## Configure an MCP client

Add the server to the `mcpServers` of your client, with the version pinned so that it does not change under you:

```json
{
  "mcpServers": {
    "wcag-evidence": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "wcag-evidence-mcp@0.1.0"]
    }
  }
}
```

Then ask the agent to audit a page that your development server serves, such as `http://localhost:4200/`. [Trying the server](https://github.com/pablodiazjorge/a11y-mcp-bench/blob/v0.1.0/docs/inspector.md) shows how to call it by hand with MCP Inspector, what each failure means and the settings that a client can pass.

## Chromium's sandbox

Chromium runs in its sandbox, the limits that the operating system puts on the processes that run the page. Where the system does not allow it, as on Ubuntu 23.10 and later without unprivileged user namespaces, in some containers or as root, the audit fails and says so. Whoever starts the server can then set `WCAG_EVIDENCE_MCP_NO_SANDBOX=1` in its environment. A page that exploits a flaw of the browser could then run code with your rights ([ADR 0008](https://github.com/pablodiazjorge/a11y-mcp-bench/blob/v0.1.0/docs/adr/0008-chromium-sandbox.md)).

## Security

The [threat model](https://github.com/pablodiazjorge/a11y-mcp-bench/blob/v0.1.0/THREAT_MODEL.md) says what the server defends against and what remains. To report a vulnerability, see [SECURITY.md](https://github.com/pablodiazjorge/a11y-mcp-bench/blob/v0.1.0/SECURITY.md).

## License

MIT.

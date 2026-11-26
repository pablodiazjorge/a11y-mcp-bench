# 0008. Chromium's sandbox

- **Status:** Accepted
- **Decided:** 2026-11-25

## Context

The server drives Chromium to audit a page that it does not control: the page's scripts run in the browser, and the agent may be pointed at a hostile page ([threat model](../../THREAT_MODEL.md)). Chromium's sandbox, the limits that the operating system puts on the processes that run the page, keeps a flaw of the renderer (the process that runs the page) from reaching the rest of the machine.

The facts below were observed on 2026-11-25 with Chrome Headless Shell 159.0.8154.6 driven by `playwright-core` 1.65.1, on Windows 11, unless marked otherwise. Linux and macOS were not run.

- **Playwright turns the sandbox off unless asked.** `playwright-core` 1.65.1 passes `--no-sandbox` to Chromium unless the launch sets `chromiumSandbox: true` (read in its code), and the server did not set it: a launch by the server's adapter had the flag on its command line.
- **The sandbox covers the processes that run the page, not every process.** With `chromiumSandbox: true`, the renderer and the GPU process had no `--no-sandbox`. Chromium's network service had `--service-sandbox-type=none` with the sandbox on or off: Chromium leaves it outside its sandbox on Windows.
- **On Windows, the sandbox costs nothing measurable.** The median of nine launches was 46 ms with the sandbox and 45 ms without it. With it on, the whole test suite passed, but for the test that compares the exact launch options.
- **On Linux, the sandbox needs the system's support (read, not run).**
  - Chromium's sandbox needs unprivileged user namespaces. Ubuntu 23.10 and later restrict them through AppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`), which breaks the sandbox of a Chromium that has no AppArmor profile of its own ([Chromium's note on AppArmor and user namespaces](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md), read on 2026-11-25).
  - Ubuntu restricts them because they let an unprivileged process ask more of the kernel, which exploits use to gain privileges. Its way to allow one program is an AppArmor profile for that program ([Ubuntu's announcement](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces), read on 2026-11-25).
  - A container needs user namespaces or extra capabilities. Chromium refuses to run in its sandbox as root: `playwright-core` 1.65.1 looks for its message for that case (crbug.com/638180) in the browser's output.

## Options considered

- **Keep it off,** as before: Chromium starts everywhere, and a flaw of the renderer that a page exploits runs code with the developer's rights.
- **Off by default, with an opt-in:** nothing breaks, but the protection reaches only those who know to turn it on.
- **Try the sandbox, and fall back without it:** Chromium starts everywhere, but the protection drops silently on exactly the systems where the sandbox fails.
- **On by default, with an opt-out:** the sandbox protects every system that allows it. Where it cannot start, the call fails with a message that names the opt-out, and whoever starts the server can turn the sandbox off, knowingly.
- **Always on:** the strongest, but the server cannot run where the system does not allow the sandbox, such as in many containers, or as root.

## Decision

**On by default, with an opt-out.**

- **The launch** sets `chromiumSandbox: true`.
- **The opt-out** is one environment variable of the server, `WCAG_EVIDENCE_MCP_NO_SANDBOX`. Unset keeps the sandbox; `1` turns it off. Any other value, the empty one included, stops the server at start with a message, since the setting guards security and the server does not guess what was meant ([`AGENTS.md`](../../AGENTS.md)).
- **The log** says, when Chromium starts, whether it runs in its sandbox, and the server says at start when the variable turns it off.
- **A sandbox that cannot start** fails the visit with `browser-unavailable`. The tool says, in the server's own words, that the system does not allow the sandbox, which variable turns it off, that turning it off is the user's decision and not the agent's, and what it risks. The log keeps the line of Chromium, or else of Playwright, that says why.
- **CI** allows unprivileged user namespaces on its Ubuntu runners before the tests, so that the tests run with the sandbox on.

**Why.** The sandbox is the browser's main defense against the page, and the pages are the input that the server trusts least. On Windows, the one system measured, it cost nothing measurable. An opt-out keeps the server usable in a container, where the container is then the boundary that remains, and makes that choice explicit.

**Its cost.** On a system that does not allow the sandbox, the first call fails until someone sets the variable, and a variable set once is easy to forget.

## Consequences

- **CI on Linux** needs a step that sets `kernel.apparmor_restrict_unprivileged_userns=0` before the tests. The first run on Ubuntu shows whether that step is needed and enough.
- **That setting has a cost.** It lifts, for every program on the machine, a restriction that Ubuntu adds because unprivileged user namespaces widen what a process can ask of the kernel. On CI's short-lived runners that is acceptable; on a developer's own machine it is a choice with that cost. An AppArmor profile for the browser alone is the narrower way, not tried.
- **Containers** need user namespaces or extra capabilities for the sandbox, or the opt-out. **Root** needs the opt-out: Chromium does not run in its sandbox as root.
- **The opt-out leaves open** what the sandbox closes: with it, a page that exploits a flaw of the renderer runs code with the rights of whoever started the server. The log and the variable's name make the choice visible, not safe.
- **The network service** stays outside the sandbox, as Chromium leaves it on Windows.
- **A test** reads the command lines of the browser and of a renderer that the adapter starts, on each system of CI, and checks that they have no `--no-sandbox` by default and have it with the opt-out.
- **The threat model** counts the sandbox as a mitigation, with what remains: the opt-out and root.

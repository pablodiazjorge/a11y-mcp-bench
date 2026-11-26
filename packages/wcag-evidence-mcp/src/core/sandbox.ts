// Chromium's sandbox (ADR 0008): on unless whoever starts the server turns it off, for a system
// that does not allow it, such as a container. It guards security, so the setting accepts only the
// two forms that it defines and refuses any other at start, rather than guess what was meant.

/** The environment variable that turns the sandbox off when it is `1`. */
export const NO_SANDBOX_VARIABLE = 'WCAG_EVIDENCE_MCP_NO_SANDBOX';

export type SandboxSetting =
  | { readonly ok: true; readonly sandbox: boolean }
  | { readonly ok: false; readonly message: string };

/** Reads the value of `NO_SANDBOX_VARIABLE`: unset keeps the sandbox, `1` turns it off. */
export function readSandboxSetting(value: string | undefined): SandboxSetting {
  if (value === undefined) return { ok: true, sandbox: true };
  if (value === '1') return { ok: true, sandbox: false };
  // The value is not repeated: it can be anything, and the log is read by people.
  return {
    ok: false,
    message: `${NO_SANDBOX_VARIABLE} must be unset, to run Chromium in its sandbox, or 1, to run it without one; it has another value, the empty one included, so the server does not start`,
  };
}

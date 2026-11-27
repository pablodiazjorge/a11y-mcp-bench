// What the binary does, read from its command line. With no argument it serves MCP over stdio, as
// an MCP client starts it; `install-browser` downloads the Chromium that it drives. It reads only
// these forms and refuses any other, so a mistyped option never starts a server that ignores it.

/** The subcommand that installs the browser. */
export const INSTALL_BROWSER = 'install-browser';

/** The option of `install-browser` that also installs the system libraries of Chromium on Linux. */
export const WITH_DEPS = '--with-deps';

export type Command =
  | { readonly kind: 'serve' }
  | { readonly kind: 'install-browser'; readonly withDeps: boolean }
  | { readonly kind: 'refused'; readonly message: string };

/** Reads the arguments that follow the binary's path. */
export function readCommand(args: readonly string[]): Command {
  if (args.length === 0) return { kind: 'serve' };
  if (args[0] === INSTALL_BROWSER && args.length === 1) {
    return { kind: 'install-browser', withDeps: false };
  }
  if (args[0] === INSTALL_BROWSER && args.length === 2 && args[1] === WITH_DEPS) {
    return { kind: 'install-browser', withDeps: true };
  }
  return {
    kind: 'refused',
    message: `unknown arguments: run the binary with none to serve MCP over stdio, or with ${INSTALL_BROWSER} to download the Chromium that it drives (add ${WITH_DEPS} on Linux for its system libraries)`,
  };
}

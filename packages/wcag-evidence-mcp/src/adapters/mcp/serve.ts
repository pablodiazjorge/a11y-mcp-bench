import type { Readable, Writable } from 'node:stream';
import type { Transport } from '@modelcontextprotocol/server';
import {
  serveStdio,
  StdioServerTransport,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio';
import { createServerFactory, type ServerDependencies } from './factory.ts';

export interface ServeOptions extends ServerDependencies {
  /** The connection to serve. The process's own stdin and stdout when left out. */
  readonly transport?: Transport;
}

/**
 * Serves MCP over one stdio connection. The default of `serveStdio` answers both protocol
 * eras: a 2025 client that opens with `initialize` and a 2026-07-28 client.
 */
export function serve(options: ServeOptions): StdioServerHandle {
  const { log, transport } = options;
  const handle = serveStdio(createServerFactory(options), {
    ...(transport === undefined ? {} : { transport }),
    onerror: (error) => {
      log(`error: ${error.message}`);
    },
  });
  log('serving MCP over stdio');
  return handle;
}

/** The parts of the Node process that `serveProcess` uses. */
export interface StdioProcess {
  readonly stdin: Readable;
  readonly stdout: Writable;
  exitCode?: number | string | null | undefined;
}

/**
 * Serves MCP over the stdin and stdout of `process`, and makes it exit with 1 when the
 * connection closes before the client ended stdin. The SDK closes the connection on a fatal
 * transport error (a message over its buffer limit, a broken stdout) without saying so, and
 * the process would otherwise exit with 0, or keep waiting on stdin and never exit.
 */
export function serveProcess(dependencies: ServerDependencies, process: StdioProcess): void {
  const { stdin, stdout } = process;
  const transport = new CloseWatch(new StdioServerTransport(stdin, stdout), () => {
    if (stdin.readableEnded) return;
    dependencies.log('the connection closed before the client ended stdin');
    process.exitCode = 1;
    stdin.destroy();
  });
  serve({ ...dependencies, transport });
}

/**
 * Passes everything through to `inner`, and calls `onClose` when `inner` closes. It forwards
 * only the members of `Transport` that `serveStdio` uses in the 2.4.0 SDK, so an SDK upgrade
 * must check that the SDK does not use others (ADR 0004).
 */
class CloseWatch implements Transport {
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport['onmessage'];
  readonly #inner: Transport;

  constructor(inner: Transport, onClose: () => void) {
    this.#inner = inner;
    inner.onmessage = (message, extra) => this.onmessage?.(message, extra);
    inner.onerror = (error) => this.onerror?.(error);
    inner.onclose = () => {
      onClose();
      this.onclose?.();
    };
  }

  start(): Promise<void> {
    return this.#inner.start();
  }

  send(...args: Parameters<Transport['send']>): Promise<void> {
    return this.#inner.send(...args);
  }

  close(): Promise<void> {
    return this.#inner.close();
  }

  setProtocolVersion = (version: string): void => {
    this.#inner.setProtocolVersion?.(version);
  };
}

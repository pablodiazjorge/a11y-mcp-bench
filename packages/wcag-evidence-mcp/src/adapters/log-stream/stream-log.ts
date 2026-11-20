import type { Log } from '../../core/log.ts';

/** The one method of a writable stream that the log needs. */
export interface LineSink {
  write(chunk: string): unknown;
}

/**
 * Returns a log that writes each message as one line to `sink`. The binary passes stderr:
 * over stdio, stdout carries only protocol messages, and a stray line there breaks the client.
 * Line breaks inside a message (a validation error, a string a client sent) are escaped, so
 * every line of the log starts with the prefix.
 */
export function createStreamLog(sink: LineSink, prefix = 'wcag-evidence-mcp'): Log {
  return (message) => {
    const oneLine = message.replaceAll('\r', '\\r').replaceAll('\n', '\\n');
    sink.write(`[${prefix}] ${oneLine}\n`);
  };
}

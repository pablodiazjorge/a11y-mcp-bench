// The binary in a child process, as an MCP client starts it: stdout must carry only protocol
// messages, because a client reads every stdout line as one, and the log goes to stderr.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/server';
import { expect, it, onTestFinished } from 'vitest';

const BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
// Generous, so a slow CI machine does not fail the test; a working server answers in well under it.
const TIMEOUT_MS = 20_000;
const CLIENT_INFO = { name: 'test-client', version: '0.0.0' };

const CALL = { jsonrpc: '2.0', id: 2, method: 'tools/call' };
// A URL that the first layer of the URL policy refuses, so the answer needs no browser.
const ARGUMENTS = { name: 'audit_route', arguments: { url: 'http://127.1:4200/' } };

/** What each era sends: the 2025 handshake and then the call, or the call with its envelope. */
const MESSAGES = {
  legacy: [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: CLIENT_INFO },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { ...CALL, params: ARGUMENTS },
  ],
  modern: [
    {
      ...CALL,
      params: {
        ...ARGUMENTS,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    },
  ],
};

interface Server {
  readonly child: ChildProcessWithoutNullStreams;
  /** Everything the server wrote so far. */
  readonly output: { stdout: string; stderr: string };
  /** Settles with the exit code when the child closes. */
  readonly closed: Promise<number | null>;
}

/** Starts the binary and kills it when the test ends, whatever its outcome. */
function startServer(): Server {
  // The developer's NODE_OPTIONS could load hooks or flags into the child.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  // Node runs the TypeScript source directly by stripping its types, so no build is needed.
  const child = spawn(process.execPath, [BIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    timeout: TIMEOUT_MS,
  });
  onTestFinished(() => {
    child.kill();
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (output.stdout += chunk));
  child.stderr.on('data', (chunk: string) => (output.stderr += chunk));
  // The server may close stdin before it has read everything; that is not a test failure.
  child.stdin.on('error', () => undefined);
  const closed = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  return { child, output, closed };
}

it.each(['legacy', 'modern'] as const)(
  'answers a %s client over stdout with protocol messages only and logs to stderr',
  async (era) => {
    const { child, output, closed } = startServer();
    const answered = new Promise<void>((resolve) => {
      child.stdout.on('data', () => {
        if (lines(output.stdout).some((line) => line.includes('"id":2'))) resolve();
      });
    });

    for (const message of MESSAGES[era]) child.stdin.write(`${JSON.stringify(message)}\n`);
    await Promise.race([
      answered,
      closed.then((code) => {
        throw new Error(
          `the server exited with ${String(code)} before it answered: ${output.stderr}`,
        );
      }),
    ]);
    // The server drops a request still in flight when stdin ends, so stdin stays open until
    // the answer arrives. Ending it then lets the server exit on its own.
    child.stdin.end();
    expect(await closed).toBe(0);

    const messages = lines(output.stdout).map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    for (const message of messages) expect(message).toMatchObject({ jsonrpc: '2.0' });
    expect(messages.find((message) => message.id === 2)).toMatchObject({
      result: { isError: true, content: [{ type: 'text' }] },
    });
    const { stderr } = output;
    expect(stderr).toContain('[wcag-evidence-mcp] serving MCP over stdio');
    expect(stderr).toContain(`[wcag-evidence-mcp] new server instance for the ${era} protocol era`);
    expect(stderr).toContain('[wcag-evidence-mcp] audit_route did not open the page: url-policy');
  },
  TIMEOUT_MS + 5_000,
);

it(
  'exits with 1 when a fatal transport error stops it while stdin is still open',
  async () => {
    const { child, output, closed } = startServer();

    // One line longer than the SDK's read buffer, with no newline: the SDK closes the connection.
    child.stdin.write('x'.repeat(STDIO_DEFAULT_MAX_BUFFER_SIZE + 1));

    expect(await closed).toBe(1);
    expect(output.stdout).toBe('');
    expect(output.stderr).toContain('[wcag-evidence-mcp] error: ');
  },
  TIMEOUT_MS + 5_000,
);

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '');
}

// The small parts that the binary wires together.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createStreamLog } from '../src/adapters/log-stream/stream-log.ts';
import { serveProcess, type StdioProcess } from '../src/adapters/mcp/serve.ts';
import { readPackageIdentity } from '../src/adapters/package-json/read-identity.ts';

describe('createStreamLog', () => {
  it('writes each message as one prefixed line to the sink it is given', () => {
    const written: string[] = [];
    const log = createStreamLog({ write: (chunk: string) => written.push(chunk) });

    log('first');
    log('second');

    expect(written).toStrictEqual(['[wcag-evidence-mcp] first\n', '[wcag-evidence-mcp] second\n']);
  });

  it('escapes line breaks, so a message never spans two lines', () => {
    const written: string[] = [];
    const log = createStreamLog({ write: (chunk: string) => written.push(chunk) });

    log('one\r\ntwo\nthree');

    expect(written).toStrictEqual(['[wcag-evidence-mcp] one\\r\\ntwo\\nthree\n']);
  });
});

describe('readPackageIdentity', () => {
  const folder = mkdtempSync(join(tmpdir(), 'wcag-evidence-mcp-'));
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  function manifest(text: string): URL {
    const file = join(folder, 'package.json');
    writeFileSync(file, text);
    return pathToFileURL(file);
  }

  it('reads the name and version of the server package by default', () => {
    const identity = readPackageIdentity();

    expect(identity.name).toBe('wcag-evidence-mcp');
    expect(identity.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.each([
    ['no version', '{"name":"x"}'],
    ['a version that is not a string', '{"name":"x","version":1}'],
    ['a name that is not a string', '{"name":1,"version":"1.0.0"}'],
    ['not an object', '"x"'],
  ])('fails on a package.json with %s', (_case, text) => {
    expect(() => readPackageIdentity(manifest(text))).toThrow(
      /expected a string "name" and "version"/,
    );
  });
});

describe('serveProcess', () => {
  function start() {
    const logs: string[] = [];
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const process: StdioProcess = { stdin, stdout };
    serveProcess(
      { identity: { name: 'x', version: '1.0.0' }, log: (line) => logs.push(line) },
      process,
    );
    return { logs, stdin, stdout, process };
  }

  it('keeps exit code 0 when the client ends stdin', async () => {
    const { logs, stdin, process } = start();
    const ended = new Promise<void>((resolve) => stdin.once('end', () => setImmediate(resolve)));

    stdin.end();
    await ended;

    expect(process.exitCode).toBeUndefined();
    expect(logs).not.toContain('the connection closed before the client ended stdin');
  });

  it('sets exit code 1 and lets go of stdin when the connection closes first', async () => {
    const { logs, stdin, stdout, process } = start();
    const failed = new Promise<void>((resolve) =>
      stdout.once('error', () => setImmediate(resolve)),
    );

    stdout.emit('error', new Error('broken pipe'));
    await failed;

    expect(process.exitCode).toBe(1);
    expect(stdin.destroyed).toBe(true);
    expect(logs).toContain('the connection closed before the client ended stdin');
  });
});

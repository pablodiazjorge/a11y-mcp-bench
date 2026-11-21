#!/usr/bin/env node
// The binary only wires the parts: it runs in a child process, where test coverage cannot see it.
import { createStreamLog } from './adapters/log-stream/stream-log.ts';
import { serveProcess } from './adapters/mcp/serve.ts';
import { readPackageIdentity } from './adapters/package-json/read-identity.ts';
import { createPlaywrightBrowser } from './adapters/playwright/browser.ts';

const log = createStreamLog(process.stderr);
// Created once, outside the SDK's factory, which may build an instance and throw it away (ADR 0004).
const browser = createPlaywrightBrowser({ log });
serveProcess({ identity: readPackageIdentity(), log, browser }, process);

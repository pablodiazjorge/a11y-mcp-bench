#!/usr/bin/env node
// The binary only wires the parts: it runs in a child process, where test coverage cannot see it.
import { createAxeRuleEngine } from './adapters/axe/rule-engine.ts';
import { createStreamLog } from './adapters/log-stream/stream-log.ts';
import { serveProcess } from './adapters/mcp/serve.ts';
import { readPackageIdentity } from './adapters/package-json/read-identity.ts';
import { createPlaywrightBrowser } from './adapters/playwright/browser.ts';
import { NO_SANDBOX_VARIABLE, readSandboxSetting } from './core/sandbox.ts';

const log = createStreamLog(process.stderr);
const setting = readSandboxSetting(process.env[NO_SANDBOX_VARIABLE]);
if (setting.ok) {
  if (!setting.sandbox) log(`Chromium will run without its sandbox: ${NO_SANDBOX_VARIABLE} is 1`);
  // Created once, outside the SDK's factory, which may build an instance and throw it away (ADR 0004).
  const browser = createPlaywrightBrowser({ log, sandbox: setting.sandbox });
  serveProcess(
    { identity: readPackageIdentity(), log, browser, ruleEngine: createAxeRuleEngine() },
    process,
  );
} else {
  log(setting.message);
  process.exitCode = 2;
}

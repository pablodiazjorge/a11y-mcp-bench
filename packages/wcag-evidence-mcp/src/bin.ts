#!/usr/bin/env node
// The binary only wires the parts: it runs in a child process, where test coverage cannot see it.
import { spawnSync } from 'node:child_process';
import { createAxeRuleEngine } from './adapters/axe/rule-engine.ts';
import { createStreamLog } from './adapters/log-stream/stream-log.ts';
import { serveProcess } from './adapters/mcp/serve.ts';
import { readPackageIdentity } from './adapters/package-json/read-identity.ts';
import { createPlaywrightBrowser } from './adapters/playwright/browser.ts';
import { installBrowser } from './adapters/playwright/install-browser.ts';
import { readCommand } from './core/command-line.ts';
import { NO_SANDBOX_VARIABLE, readSandboxSetting } from './core/sandbox.ts';

const log = createStreamLog(process.stderr);
const command = readCommand(process.argv.slice(2));
const setting = readSandboxSetting(process.env[NO_SANDBOX_VARIABLE]);
if (command.kind === 'refused') {
  log(command.message);
  process.exitCode = 2;
} else if (command.kind === 'install-browser') {
  process.exitCode = installBrowser(
    command.withDeps,
    (program, args) => spawnSync(program, args, { stdio: 'inherit' }).status ?? 1,
  );
} else if (setting.ok) {
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

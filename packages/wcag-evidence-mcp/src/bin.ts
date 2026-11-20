#!/usr/bin/env node
// The binary only wires the parts: it runs in a child process, where test coverage cannot see it.
import { createStreamLog } from './adapters/log-stream/stream-log.ts';
import { serveProcess } from './adapters/mcp/serve.ts';
import { readPackageIdentity } from './adapters/package-json/read-identity.ts';

serveProcess({ identity: readPackageIdentity(), log: createStreamLog(process.stderr) }, process);

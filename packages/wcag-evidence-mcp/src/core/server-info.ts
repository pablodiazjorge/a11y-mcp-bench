// The core imports only itself and `zod` (ADR 0004), so it can be tested without MCP or a browser.

import type { ServerIdentity } from './identity.ts';

/** What `server_info` reports: the server, and the protocol revision of the current connection. */
export interface ServerInfo extends ServerIdentity {
  readonly protocolVersion: string;
}

export function describeServer(identity: ServerIdentity, protocolVersion: string): ServerInfo {
  return { name: identity.name, version: identity.version, protocolVersion };
}

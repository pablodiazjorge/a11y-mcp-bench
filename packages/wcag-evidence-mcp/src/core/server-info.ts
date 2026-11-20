// Nothing in `core` imports MCP or another library, so the core can be tested without them.

import type { ServerIdentity } from './identity.ts';

/** What `server_info` reports: the server, and the protocol revision of the current connection. */
export interface ServerInfo extends ServerIdentity {
  readonly protocolVersion: string;
}

export function describeServer(identity: ServerIdentity, protocolVersion: string): ServerInfo {
  return { name: identity.name, version: identity.version, protocolVersion };
}

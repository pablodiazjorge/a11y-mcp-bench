import { McpServer, type McpServerFactory } from '@modelcontextprotocol/server';
import type { ServerIdentity } from '../../core/identity.ts';
import type { Log } from '../../core/log.ts';
import { registerServerInfoTool } from './server-info-tool.ts';

/** What every server instance shares. Anything with state is created once, outside the factory. */
export interface ServerDependencies {
  readonly identity: ServerIdentity;
  readonly log: Log;
}

/**
 * Returns the server factory. The SDK calls it once per connection. After a `server/discover`
 * probe, it calls it again only if the client then opens with `initialize`, and throws the
 * probe instance away. So the factory only builds an instance and registers the tools: it
 * opens nothing and keeps no state of its own.
 */
export function createServerFactory(dependencies: ServerDependencies): McpServerFactory {
  const { identity, log } = dependencies;
  return ({ era }) => {
    log(`new server instance for the ${era} protocol era`);
    const server = new McpServer({ name: identity.name, version: identity.version });
    registerServerInfoTool(server, identity, log);
    return server;
  };
}

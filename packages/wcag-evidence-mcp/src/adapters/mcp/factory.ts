import { McpServer, type McpServerFactory } from '@modelcontextprotocol/server';
import type { BrowserPort } from '../../core/browser.ts';
import type { ServerIdentity } from '../../core/identity.ts';
import type { Log } from '../../core/log.ts';
import type { RuleEngine } from '../../core/rule-engine.ts';
import { registerAuditRouteTool } from './audit-route-tool.ts';
import { registerCriterionResources } from './criterion-resources.ts';
import { registerExplainCriterionTool } from './explain-criterion-tool.ts';

/** What every server instance shares. Anything with state is created once, outside the factory. */
export interface ServerDependencies {
  readonly identity: ServerIdentity;
  readonly log: Log;
  /** One browser for every connection and call. */
  readonly browser: BrowserPort;
  readonly ruleEngine: RuleEngine;
}

/**
 * Returns the server factory. The SDK calls it once per connection. After a `server/discover`
 * probe, it calls it again only if the client then opens with `initialize`, and throws the
 * probe instance away. So the factory only builds an instance and registers the tools and the
 * resources: it
 * opens nothing and keeps no state of its own.
 */
export function createServerFactory(dependencies: ServerDependencies): McpServerFactory {
  const { identity, log, browser, ruleEngine } = dependencies;
  return ({ era }) => {
    log(`new server instance for the ${era} protocol era`);
    // The tools and the resources are the same for the whole life of the server, so it says that
    // their lists never change. The SDK keeps a value given here and would say true otherwise.
    const server = new McpServer(
      { name: identity.name, version: identity.version },
      { capabilities: { tools: { listChanged: false }, resources: { listChanged: false } } },
    );
    registerAuditRouteTool(server, { browser, engine: ruleEngine, log }, log, identity);
    registerExplainCriterionTool(server, log);
    registerCriterionResources(server);
    return server;
  };
}

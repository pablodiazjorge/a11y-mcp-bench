import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { ServerIdentity } from '../../core/identity.ts';
import type { Log } from '../../core/log.ts';
import { describeServer } from '../../core/server-info.ts';

export const SERVER_INFO_TOOL = 'server_info';

export const serverInfoOutput = z.object({
  name: z.string().describe('The package name of the server'),
  version: z.string().describe('The package version of the server'),
  protocolVersion: z.string().describe('The MCP protocol revision of the current connection'),
});

/** Registers `server_info`, a read-only tool that says which server answers and over which revision. */
export function registerServerInfoTool(
  server: McpServer,
  identity: ServerIdentity,
  log: Log,
): void {
  server.registerTool(
    SERVER_INFO_TOOL,
    {
      title: 'Server info',
      description:
        'Returns the name and version of this server and the MCP protocol revision of the connection.',
      inputSchema: z.object({}),
      outputSchema: serverInfoOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => {
      const info = describeServer(identity, protocolVersionOf(server));
      log(`${SERVER_INFO_TOOL} called over protocol ${info.protocolVersion}`);
      // The specification asks a tool with structured content to return the same JSON as text too,
      // for clients that only read text.
      return {
        structuredContent: { ...info },
        content: [{ type: 'text', text: JSON.stringify(info) }],
      };
    },
  );
}

/**
 * The revision the server instance agreed on. A request's `_meta` envelope is not used: on a
 * 2025 connection the SDK passes it through unchecked, so a client could make the tool report
 * any string. The SDK marks this accessor deprecated, but documents that it holds the
 * `initialize` revision on a 2025 connection and the 2026-07-28 revision on a modern instance.
 */
function protocolVersionOf(server: McpServer): string {
  return server.server.getNegotiatedProtocolVersion() ?? 'unknown';
}

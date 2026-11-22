import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { CRITERION_IDS } from '../../core/audit.ts';
import { explainCriterion, explanationSchema } from '../../core/explain.ts';
import type { Log } from '../../core/log.ts';

export const EXPLAIN_CRITERION_TOOL = 'explain_criterion';

const inputSchema = z.object({
  criterion: z
    .enum(CRITERION_IDS as [string, ...string[]])
    .describe('The number of one of the twelve criteria that audit_route covers, such as "1.4.3"'),
});

const DESCRIPTION = [
  'Explains one of the twelve WCAG 2.2 criteria that audit_route covers: what it requires, how this server checks it (the axe-core rules that it runs, its own check, or no check yet) and what is left for a person to check.',
  'It reads the catalog that ships with the server and opens no page.',
  'The same explanation is the resource criterion://<number>, which the definitions of an audit link to.',
].join(' ');

/** Registers `explain_criterion`, which explains one criterion from the server's catalog. */
export function registerExplainCriterionTool(server: McpServer, log: Log): void {
  server.registerTool(
    EXPLAIN_CRITERION_TOOL,
    {
      title: 'Explain criterion',
      description: DESCRIPTION,
      inputSchema,
      outputSchema: explanationSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        // It reads the catalog, which ships with the server, and reaches nothing outside it.
        openWorldHint: false,
      },
    },
    ({ criterion }): CallToolResult => {
      const explanation = explainCriterion(criterion);
      // The input schema keeps the criterion among the twelve, so this does not happen.
      if (explanation === undefined) throw new Error('The criterion is not one of the twelve.');
      log(`${EXPLAIN_CRITERION_TOOL} explained ${criterion}`);
      // The specification asks a tool with structured content to return the same JSON as text too,
      // for clients that only read text.
      return {
        structuredContent: explanation,
        content: [{ type: 'text', text: JSON.stringify(explanation) }],
      };
    },
  );
}

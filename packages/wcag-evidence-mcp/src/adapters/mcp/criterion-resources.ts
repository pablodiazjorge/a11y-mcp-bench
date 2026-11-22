import {
  ResourceNotFoundError,
  ResourceTemplate,
  type McpServer,
} from '@modelcontextprotocol/server';
import { CRITERIA, criterionResource } from '../../core/criteria.ts';
import { explainCriterion } from '../../core/explain.ts';

export const CRITERION_TEMPLATE = 'criterion';
const MIME_TYPE = 'application/json';

/**
 * Registers one resource per criterion, `criterion://<number>`, through a URI template: each holds
 * what `explain_criterion` returns for the criterion, and `resources/list` lists the twelve. The
 * SDK reads them, and answers a URI that matches no template with the error of the specification.
 */
export function registerCriterionResources(server: McpServer): void {
  server.registerResource(
    CRITERION_TEMPLATE,
    new ResourceTemplate(criterionResource('{id}'), {
      list: () => ({
        resources: CRITERIA.map(({ id, name, requires }) => ({
          uri: criterionResource(id),
          name: id,
          title: `${id} ${name}`,
          description: requires,
          mimeType: MIME_TYPE,
        })),
      }),
    }),
    {
      title: 'WCAG criterion',
      description:
        'One of the twelve WCAG 2.2 criteria that audit_route covers, by number, such as criterion://1.4.3: what it requires, how this server checks it and what is left for a person to check, as explain_criterion returns it.',
      mimeType: MIME_TYPE,
    },
    (uri, { id }) => {
      const explanation = typeof id === 'string' ? explainCriterion(id) : undefined;
      // A number that is none of the twelve gets the same error as a URI that matches no template.
      if (explanation === undefined) throw new ResourceNotFoundError(uri.href);
      return {
        contents: [{ uri: uri.href, mimeType: MIME_TYPE, text: JSON.stringify(explanation) }],
      };
    },
  );
}

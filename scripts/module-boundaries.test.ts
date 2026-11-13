// Shows that each rule in `.dependency-cruiser.js` catches what ADR 0003 forbids. Each case
// adds forbidden imports to the planned layout and expects the rule to report exactly those.
// What the rules must let through is in module-boundaries.reading.test.ts.

import { afterAll, describe, expect, it } from 'vitest';
import {
  BUILT,
  BY_NAME,
  type Changes,
  cruiseTree,
  loadOptions,
  removeTrees,
  SERVER,
  serverManifest,
  SIBLING,
  violations,
} from './module-boundaries.layout.ts';

interface Case {
  /** Name of the rule in `.dependency-cruiser.js`. */
  rule: string;
  /** Files added to the layout. */
  files: Changes;
  /** What the rule must report: each import as `from -> to`, a cycle as `a <-> b`. */
  reported: readonly string[];
}

const AUDIT = `${SERVER}/src/audit.ts`;
const DEV_TOOL = 'node_modules/dev-tool/dist/index.js';
const ROOT_DEV_TOOL = 'node_modules/root-dev-tool/dist/index.js';
const RUNTIME_LIB = 'node_modules/runtime-lib/dist/index.js';
const ROOT_MANIFEST = "import manifest from '../../../package.json' with { type: 'json' };\n";

// One case per rule, in the order of ADR 0003.
const CASES: readonly Case[] = [
  {
    rule: 'server-imports-nothing-outside-its-folder',
    files: {
      [`${SERVER}/src/to-bench.ts`]: "export { report } from '../../../bench/report.ts';\n",
      [`${SERVER}/src/to-fixtures.ts`]:
        "export { total } from '../../../fixtures/shop/src/cart.ts';\n",
      [`${SERVER}/src/to-scripts.ts`]: "export { countLines } from '../../../scripts/lines.ts';\n",
      // Not one of the parts that ADR 0003 names: a new folder, a root file and another package.
      'tools/util.ts': 'export const util = 1;\n',
      [`${SERVER}/src/to-tools.ts`]: "export { util } from '../../../tools/util.ts';\n",
      [`${SERVER}/src/to-root.ts`]: `${ROOT_MANIFEST}export default manifest;\n`,
      // The other package is a workspace too, so its name leads to its folder.
      [`${SIBLING}/package.json`]:
        '{ "name": "wcag-evidence-mcp-extra", "exports": "./index.ts" }\n',
      [`${SIBLING}/index.ts`]: 'export const extra = 1;\n',
      [`${SERVER}/src/to-sibling.ts`]:
        "export { extra } from '../../wcag-evidence-mcp-extra/index.ts';\n",
      [`${SERVER}/src/sibling-by-name.ts`]: "export { extra } from 'wcag-evidence-mcp-extra';\n",
      // An alias in the `imports` of the server's `package.json` leads there as well.
      [`${SERVER}/package.json`]: serverManifest({
        imports: { '#extra': 'wcag-evidence-mcp-extra' },
      }),
      [`${SERVER}/src/sibling-by-alias.ts`]: "export { extra } from '#extra';\n",
      // A relative path into `node_modules` reaches a package without declaring it.
      [`${SERVER}/src/into-node-modules.ts`]: `export { value } from '../../../${ROOT_DEV_TOOL}';\n`,
      // The same holds for the packages that npm installs inside the server's own folder.
      [`${SERVER}/node_modules/nested-tool/package.json`]: '{ "name": "nested-tool" }\n',
      [`${SERVER}/node_modules/nested-tool/index.js`]: 'export const value = 1;\n',
      [`${SERVER}/src/into-own-node-modules.ts`]:
        "export { value } from '../node_modules/nested-tool/index.js';\n",
      // The rule holds for every file of the server, not only for `src`.
      [`${SERVER}/bin/cli.ts`]: "export { report } from '../../../bench/report.ts';\n",
      [`${SERVER}/test/to-scripts.ts`]: "export { countLines } from '../../../scripts/lines.ts';\n",
    },
    reported: [
      `${SERVER}/bin/cli.ts -> bench/report.ts`,
      `${SERVER}/src/into-node-modules.ts -> ${ROOT_DEV_TOOL}`,
      `${SERVER}/src/into-own-node-modules.ts -> ${SERVER}/node_modules/nested-tool/index.js`,
      `${SERVER}/src/sibling-by-alias.ts -> ${SIBLING}/index.ts`,
      `${SERVER}/src/sibling-by-name.ts -> ${SIBLING}/index.ts`,
      `${SERVER}/src/to-bench.ts -> bench/report.ts`,
      `${SERVER}/src/to-fixtures.ts -> fixtures/shop/src/cart.ts`,
      `${SERVER}/src/to-root.ts -> package.json`,
      `${SERVER}/src/to-scripts.ts -> scripts/lines.ts`,
      `${SERVER}/src/to-sibling.ts -> ${SIBLING}/index.ts`,
      `${SERVER}/src/to-tools.ts -> tools/util.ts`,
      `${SERVER}/test/to-scripts.ts -> scripts/lines.ts`,
    ],
  },
  {
    rule: 'app-imports-nothing-outside-its-folder',
    files: {
      'fixtures/shop/src/to-server.ts': `export { audit } from '../../../${AUDIT}';\n`,
      'fixtures/shop/src/by-name.ts': BY_NAME,
      'fixtures/shop/src/to-bench.ts': "export { report } from '../../../bench/report.ts';\n",
      'fixtures/shop/src/to-scripts.ts':
        "export { countLines } from '../../../scripts/lines.ts';\n",
      'fixtures/shop/src/to-defects.ts':
        "import metadata from '../../defects/missing-label/metadata.json' with { type: 'json' };\nexport default metadata;\n",
      // A folder whose name starts like the app's is not the app.
      'fixtures/shop-utils/index.ts': 'export const util = 1;\n',
      'fixtures/shop/src/to-sibling.ts': "export { util } from '../../shop-utils/index.ts';\n",
      'docs/snippet.ts': 'export const snippet = 1;\n',
      'fixtures/shop/src/to-docs.ts': "export { snippet } from '../../../docs/snippet.ts';\n",
      'fixtures/shop/src/to-root.ts': `${ROOT_MANIFEST}export default manifest;\n`,
      'fixtures/shop/src/type-only.ts':
        "import type { report } from '../../../bench/report.ts';\nexport type Report = typeof report;\n",
      // A relative path into `node_modules` is a path out of the folder, not a package.
      'fixtures/shop/src/into-node-modules.ts': `export { value } from '../../../${RUNTIME_LIB}';\n`,
      'fixtures/shop/node_modules/nested-lib/package.json': '{ "name": "nested-lib" }\n',
      'fixtures/shop/node_modules/nested-lib/index.js': 'export const value = 1;\n',
      'fixtures/shop/src/into-own-node-modules.ts':
        "export { value } from '../node_modules/nested-lib/index.js';\n",
    },
    reported: [
      `fixtures/shop/src/by-name.ts -> ${BUILT}`,
      `fixtures/shop/src/into-node-modules.ts -> ${RUNTIME_LIB}`,
      'fixtures/shop/src/into-own-node-modules.ts -> fixtures/shop/node_modules/nested-lib/index.js',
      'fixtures/shop/src/to-bench.ts -> bench/report.ts',
      'fixtures/shop/src/to-defects.ts -> fixtures/defects/missing-label/metadata.json',
      'fixtures/shop/src/to-docs.ts -> docs/snippet.ts',
      'fixtures/shop/src/to-root.ts -> package.json',
      'fixtures/shop/src/to-scripts.ts -> scripts/lines.ts',
      `fixtures/shop/src/to-server.ts -> ${AUDIT}`,
      'fixtures/shop/src/to-sibling.ts -> fixtures/shop-utils/index.ts',
      'fixtures/shop/src/type-only.ts -> bench/report.ts',
    ],
  },
  {
    rule: 'bench-reaches-no-server-code',
    files: {
      'bench/by-path.ts': `export { audit } from '../${AUDIT}';\n`,
      'bench/by-name.ts': BY_NAME,
      'bench/grader/deep.ts': `export { audit } from '../../${AUDIT}';\n`,
      'bench/runner.test.ts': `export { audit } from '../${AUDIT}';\n`,
      // A type alone is a shortcut too, also when a JSDoc comment takes it.
      'bench/type-only.ts': `import type { Audit } from '../${AUDIT}';\nexport type Result = ReturnType<Audit>;\n`,
      'bench/jsdoc.js': `/** @typedef {import('../${AUDIT}').Audit} Audit */\nexport const none = 1;\n`,
      'bench/dynamic.ts': `export const loaded = await import('../${AUDIT}');\n`,
      'bench/required.cjs': `module.exports = require('../${AUDIT}');\n`,
      // The name of the file has `node_modules` in it, and the file is still read.
      'bench/node_modules-report.ts': `export { audit } from '../${AUDIT}';\n`,
      // Data inside the server's folder is out of reach too: the harness reads it as a file.
      [`${SERVER}/tool-contract.json`]: '{ "tools": [] }\n',
      'bench/contract.ts': `import contract from '../${SERVER}/tool-contract.json' with { type: 'json' };\nexport default contract;\n`,
      // No rule stops the bridge itself. The file of `bench` that reaches the server through
      // it is the one reported.
      'fixtures/defects/missing-label/bridge.ts': `export { audit } from '../../../${AUDIT}';\n`,
      'bench/via-defects.ts':
        "export { audit } from '../fixtures/defects/missing-label/bridge.ts';\n",
    },
    reported: [
      `bench/by-name.ts -> ${BUILT}`,
      `bench/by-path.ts -> ${AUDIT}`,
      `bench/contract.ts -> ${SERVER}/tool-contract.json`,
      `bench/dynamic.ts -> ${AUDIT}`,
      `bench/grader/deep.ts -> ${AUDIT}`,
      `bench/jsdoc.js -> ${AUDIT}`,
      `bench/node_modules-report.ts -> ${AUDIT}`,
      `bench/required.cjs -> ${AUDIT}`,
      `bench/runner.test.ts -> ${AUDIT}`,
      `bench/type-only.ts -> ${AUDIT}`,
      `bench/via-defects.ts -> ${AUDIT}`,
    ],
  },
  {
    rule: 'scripts-import-no-other-part',
    files: {
      'scripts/to-server.ts': `export { audit } from '../${AUDIT}';\n`,
      'scripts/by-name.ts': BY_NAME,
      'scripts/to-fixtures.ts': "export { total } from '../fixtures/shop/src/cart.ts';\n",
      'scripts/to-bench.ts': "export { report } from '../bench/report.ts';\n",
      'scripts/sub/deep.ts': "export { report } from '../../bench/report.ts';\n",
    },
    reported: [
      `scripts/by-name.ts -> ${BUILT}`,
      'scripts/sub/deep.ts -> bench/report.ts',
      'scripts/to-bench.ts -> bench/report.ts',
      'scripts/to-fixtures.ts -> fixtures/shop/src/cart.ts',
      `scripts/to-server.ts -> ${AUDIT}`,
    ],
  },
  {
    rule: 'no-circular-imports',
    files: {
      'bench/first.ts': "import { second } from './second.ts';\nexport const first = second;\n",
      'bench/second.ts': "import { first } from './first.ts';\nexport const second = first;\n",
      // A cycle of types alone counts, in a folder that is not one of the parts too.
      'tools/one.ts': "import type { Two } from './two.ts';\nexport type One = Two | 1;\n",
      'tools/two.ts': "import type { One } from './one.ts';\nexport type Two = One | 2;\n",
    },
    reported: ['bench/first.ts <-> bench/second.ts', 'tools/one.ts <-> tools/two.ts'],
  },
  {
    rule: 'server-imports-no-dev-dependency',
    files: {
      [`${SERVER}/src/own-dev.ts`]: "export { value } from 'dev-tool';\n",
      // Declared only by the root, so a user of the published server does not get it.
      [`${SERVER}/src/root-dev.ts`]: "export { value } from 'root-dev-tool';\n",
      // The declaration files that the package ships would still name the package.
      [`${SERVER}/src/type-only.ts`]:
        "import type { value } from 'dev-tool';\nexport type Value = typeof value;\n",
      // Only the root of the server holds tests and configuration that are not published.
      [`${SERVER}/src/audit.config.ts`]: "export { value } from 'dev-tool';\n",
      [`${SERVER}/src/rules/test/sample.ts`]: "export { value } from 'dev-tool';\n",
    },
    reported: [
      `${SERVER}/src/audit.config.ts -> ${DEV_TOOL}`,
      `${SERVER}/src/own-dev.ts -> ${DEV_TOOL}`,
      `${SERVER}/src/root-dev.ts -> node_modules/root-dev-tool/dist/index.js`,
      `${SERVER}/src/rules/test/sample.ts -> ${DEV_TOOL}`,
      `${SERVER}/src/type-only.ts -> ${DEV_TOOL}`,
    ],
  },
  {
    rule: 'server-imports-no-test-or-config',
    files: {
      [`${SERVER}/src/uses-helper.ts`]: "export { sample } from '../test/helper.ts';\n",
      [`${SERVER}/src/uses-test.ts`]: "import './audit.test.ts';\n",
      [`${SERVER}/src/uses-config.ts`]: "export { default } from '../vitest.config.ts';\n",
      // Published code is not only `src`.
      [`${SERVER}/bin/start.ts`]: "export { sample } from '../test/helper.ts';\n",
      // These two are published code, whatever their names say.
      [`${SERVER}/src/audit.config.ts`]: 'export const limit = 1;\n',
      [`${SERVER}/src/rules/test/sample.ts`]: 'export const sample = 1;\n',
      [`${SERVER}/src/uses-published.ts`]:
        "export { limit } from './audit.config.ts';\nexport { sample } from './rules/test/sample.ts';\n",
    },
    reported: [
      `${SERVER}/bin/start.ts -> ${SERVER}/test/helper.ts`,
      `${SERVER}/src/uses-config.ts -> ${SERVER}/vitest.config.ts`,
      `${SERVER}/src/uses-helper.ts -> ${SERVER}/test/helper.ts`,
      `${SERVER}/src/uses-test.ts -> ${SERVER}/src/audit.test.ts`,
    ],
  },
  {
    rule: 'no-unresolvable-imports',
    files: {
      'scripts/alias.ts': "export { helper } from '@missing/alias';\n",
      'bench/typo.ts': "export { report } from './no-such-file.ts';\n",
      'bench/not-installed.ts': "export { value } from 'not-installed-lib';\n",
      'tools/encoded.ts': "export { countLines } from '../scripts/lines%2Ets';\n",
      'bench/type-only.ts':
        "import type { Helper } from '@missing/types';\nexport type Kept = Helper;\n",
    },
    reported: [
      'bench/not-installed.ts -> not-installed-lib',
      'bench/type-only.ts -> @missing/types',
      'bench/typo.ts -> ./no-such-file.ts',
      'scripts/alias.ts -> @missing/alias',
      'tools/encoded.ts -> ../scripts/lines%2Ets',
    ],
  },
];

afterAll(removeTrees);

describe('the rules of the module boundaries', { timeout: 60_000 }, () => {
  it('has one test case for each rule of the configuration', async () => {
    const rules = (await loadOptions()).ruleSet?.forbidden ?? [];

    expect(rules.map(({ name }) => name)).toEqual(CASES.map(({ rule }) => rule));
    for (const { severity, comment } of rules) {
      expect(severity).toBe('error');
      expect(comment).toMatch(/^[^\n]+$/);
    }
  });

  it.each(CASES)('$rule reports each forbidden import', async ({ rule, files, reported }) => {
    expect(violations(await cruiseTree(files))).toEqual(reported.map((line) => `${rule}: ${line}`));
  });
});

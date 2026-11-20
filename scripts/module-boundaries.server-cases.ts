// The forbidden imports for the rules of ADR 0004, between the parts inside the server.
// module-boundaries.test.ts runs them with the cases of ADR 0003.

import { SERVER, serverManifest, type Case } from './module-boundaries.layout.ts';

const SRC = `${SERVER}/src`;
const BIN = `${SRC}/bin.ts`;
const OPEN = `${SRC}/adapters/browser/open.ts`;
const TOOL = `${SRC}/adapters/mcp/tool.ts`;

export const SERVER_CASES: readonly Case[] = [
  {
    rule: 'server-core-imports-only-core-and-zod',
    files: {
      [`${SRC}/core/to-node.ts`]:
        "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n",
      // A Node built-in loaded without an import is still a dependency on it.
      [`${SRC}/core/to-builtin-call.ts`]:
        "export const fs = process.getBuiltinModule('node:fs');\n",
      // A dependency of the server, so no other rule stops it.
      [`${SRC}/core/to-package.ts`]: "export { value } from 'runtime-lib';\n",
      [`${SRC}/core/type-only.ts`]:
        "import type { value } from 'peer-lib';\nexport type Value = typeof value;\n",
      // A package whose name starts like `zod`, declared by the server.
      [`${SERVER}/package.json`]: serverManifest({
        dependencies: { 'runtime-lib': '1.0.0', zod: '1.0.0', 'zod-extra': '1.0.0' },
      }),
      'node_modules/zod-extra/package.json': '{ "name": "zod-extra", "exports": "./index.js" }\n',
      'node_modules/zod-extra/index.js': 'export const value = 1;\n',
      [`${SRC}/core/to-zod-like.ts`]: "export { value } from 'zod-extra';\n",
      // Files of the server that are not the core, one of them in a folder named like it.
      [`${SRC}/shared.ts`]: 'export const shared = 1;\n',
      [`${SRC}/core/to-other-source.ts`]: "export { shared } from '../shared.ts';\n",
      [`${SRC}/core-extra/helper.ts`]: 'export const helper = 1;\n',
      [`${SRC}/core/to-prefix.ts`]: "export { helper } from '../core-extra/helper.ts';\n",
      // Only a `*.test.*` file is a test: the layout's `audit.test.ts` may import an adapter.
      [`${SRC}/core/audit.spec.ts`]:
        "import { tmpdir } from 'node:os';\nexport const dir = tmpdir;\n",
    },
    reported: [
      `${SRC}/core/audit.spec.ts -> os`,
      `${SRC}/core/to-builtin-call.ts -> fs`,
      `${SRC}/core/to-node.ts -> fs`,
      `${SRC}/core/to-other-source.ts -> ${SRC}/shared.ts`,
      `${SRC}/core/to-package.ts -> node_modules/runtime-lib/dist/index.js`,
      `${SRC}/core/to-prefix.ts -> ${SRC}/core-extra/helper.ts`,
      `${SRC}/core/to-zod-like.ts -> node_modules/zod-extra/index.js`,
      `${SRC}/core/type-only.ts -> node_modules/peer-lib/dist/index.cjs`,
    ],
  },
  {
    rule: 'server-adapter-imports-no-other-adapter',
    files: {
      [`${SRC}/adapters/mcp/to-browser.ts`]: "export { open } from '../browser/open.ts';\n",
      [`${SRC}/adapters/browser/type-only.ts`]:
        "import type { Tool } from '../mcp/tool.ts';\nexport type Kept = Tool;\n",
      // From a subfolder of an adapter, and to a folder whose name starts like the adapter's.
      [`${SRC}/adapters/browser/page/to-mcp.ts`]: "export { TOOL } from '../../mcp/tool.ts';\n",
      [`${SRC}/adapters/mcp-extra/extra.ts`]: 'export const extra = 1;\n',
      [`${SRC}/adapters/mcp/to-prefix.ts`]: "export { extra } from '../mcp-extra/extra.ts';\n",
      // A file next to the adapters' folders belongs to none of them.
      [`${SRC}/adapters/shared.ts`]: 'export const shared = 1;\n',
      [`${SRC}/adapters/mcp/to-shared.ts`]: "export { shared } from '../shared.ts';\n",
    },
    reported: [
      `${SRC}/adapters/browser/page/to-mcp.ts -> ${TOOL}`,
      `${SRC}/adapters/browser/type-only.ts -> ${TOOL}`,
      `${SRC}/adapters/mcp/to-browser.ts -> ${OPEN}`,
      `${SRC}/adapters/mcp/to-prefix.ts -> ${SRC}/adapters/mcp-extra/extra.ts`,
      `${SRC}/adapters/mcp/to-shared.ts -> ${SRC}/adapters/shared.ts`,
    ],
  },
  {
    rule: 'server-wires-adapters-only-in-bin',
    files: {
      [`${SRC}/main.ts`]: "export { run } from './adapters/mcp/serve.ts';\n",
      // Only `src/bin.ts` wires, not another file with the same name.
      [`${SRC}/cli/bin.ts`]: "export { run } from '../adapters/mcp/serve.ts';\n",
      [`${SRC}/tools/type-only.ts`]:
        "import type { Tool } from '../adapters/mcp/tool.ts';\nexport type Kept = Tool;\n",
      // A file directly under `adapters/` is reported as the importer and as the imported.
      [`${SRC}/adapters/index.ts`]: "export { open } from './browser/open.ts';\n",
      [`${SRC}/adapters/shared.ts`]: 'export const shared = 1;\n',
      [`${SRC}/main2.ts`]: "export { shared } from './adapters/shared.ts';\n",
      // One adapter reaches another through a file that is not an adapter. The bridge is the
      // file reported: it is the one that imports an adapter.
      [`${SRC}/bridge.ts`]: "export { open } from './adapters/browser/open.ts';\n",
      [`${SRC}/adapters/mcp/via-bridge.ts`]: "export { open } from '../../bridge.ts';\n",
      // The same through a file of the server outside `src/`.
      [`${SERVER}/bridge.ts`]: "export { open } from './src/adapters/browser/open.ts';\n",
      [`${SRC}/adapters/mcp/via-root.ts`]: "export { open } from '../../../bridge.ts';\n",
    },
    reported: [
      `${SERVER}/bridge.ts -> ${OPEN}`,
      `${SRC}/adapters/index.ts -> ${OPEN}`,
      `${SRC}/bridge.ts -> ${OPEN}`,
      `${SRC}/cli/bin.ts -> ${SRC}/adapters/mcp/serve.ts`,
      `${SRC}/main.ts -> ${SRC}/adapters/mcp/serve.ts`,
      `${SRC}/main2.ts -> ${SRC}/adapters/shared.ts`,
      `${SRC}/tools/type-only.ts -> ${TOOL}`,
    ],
  },
  {
    rule: 'nothing-imports-server-bin',
    files: {
      [`${SRC}/adapters/mcp/restart.ts`]: "import '../../bin.ts';\n",
      [`${SRC}/main.ts`]: "import './bin.ts';\n",
      // Not even a test or a file outside the parts.
      [`${SERVER}/test/bin.test.ts`]: "import '../src/bin.ts';\n",
      [`${SERVER}/test/type-only.ts`]:
        "import type * as Bin from '../src/bin.ts';\nexport type Kept = typeof Bin;\n",
      'tools/start.ts': `import '../${BIN}';\n`,
      // The built binary, which the layout holds, starts the server just the same.
      [`${SERVER}/test/built.test.ts`]: "import '../dist/bin.js';\n",
    },
    reported: [
      `${SRC}/adapters/mcp/restart.ts -> ${BIN}`,
      `${SRC}/main.ts -> ${BIN}`,
      `${SERVER}/test/bin.test.ts -> ${BIN}`,
      `${SERVER}/test/built.test.ts -> ${SERVER}/dist/bin.js`,
      `${SERVER}/test/type-only.ts -> ${BIN}`,
      `tools/start.ts -> ${BIN}`,
    ],
  },
];

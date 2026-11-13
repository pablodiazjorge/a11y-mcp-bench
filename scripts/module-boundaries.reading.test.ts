// Shows what the configuration in `.dependency-cruiser.js` reads and what it lets through:
// the planned layout breaks no rule, generated folders and installed packages are not read,
// and an import that leads nowhere is reported. The forbidden imports of each rule are in
// module-boundaries.test.ts.

import { afterAll, describe, expect, it } from 'vitest';
import {
  BUILT,
  BY_NAME,
  cruiseTree,
  GENERATED_FILES,
  LAYOUT,
  removeTrees,
  SERVER,
  violations,
} from './module-boundaries.layout.ts';

const UNBUILT = { [BUILT]: null };

afterAll(removeTrees);

describe('what the module boundaries read', { timeout: 60_000 }, () => {
  it('reports nothing for the planned layout', async () => {
    const result = await cruiseTree();
    expect(violations(result)).toEqual([]);

    // The tree was read, so the empty list above is not empty for lack of files.
    const sources = result.modules.map(({ source }) => source);
    const written = Object.keys(LAYOUT).filter((path) => /[.][cm]?[jt]s$/.test(path));
    const installed = (path: string): boolean => path.startsWith('node_modules/');
    const generated = (path: string): boolean => GENERATED_FILES.includes(path);
    expect(sources).toEqual(
      expect.arrayContaining(written.filter((path) => !installed(path) && !generated(path))),
    );
    const imports = result.modules.flatMap(({ source, dependencies }) =>
      dependencies.map((dependency) => ({ source, ...dependency })),
    );
    expect(imports.filter(({ couldNotResolve }) => couldNotResolve)).toEqual([]);

    // Generated files are not read: each one in the layout has an import that would break a
    // rule. An installed package shows where an import leads to it, and its own imports are
    // not read either.
    expect(sources.filter(generated)).toEqual([]);
    expect(sources).toContain('node_modules/runtime-lib/dist/index.js');
    expect(imports.filter(({ source }) => installed(source))).toEqual([]);

    // The allowed imports were seen for what they are, and let through. The tool names a
    // Node built-in without its `node:` prefix.
    const typesOf = (source: string, module: string): string[] =>
      imports.find((item) => item.source === source && item.module === module)?.dependencyTypes ??
      [];
    expect(typesOf(`${SERVER}/src/index.ts`, 'fs')).toContain('core');
    expect(typesOf(`${SERVER}/src/index.ts`, 'runtime-lib')).toContain('npm');
    expect(typesOf(`${SERVER}/src/index.ts`, 'runtime-lib')).not.toContain('npm-dev');
    expect(typesOf(`${SERVER}/src/index.ts`, 'peer-lib')).toContain('npm-peer');
    expect(typesOf(`${SERVER}/src/index.ts`, 'optional-lib')).toContain('npm-optional');
    expect(typesOf(`${SERVER}/src/audit.test.ts`, 'dev-tool')).toContain('npm-dev');
    expect(typesOf(`${SERVER}/src/audit.test.ts`, 'root-dev-tool')).toContain('npm-no-pkg');
    expect(typesOf(`${SERVER}/test/helper.ts`, 'dev-tool')).toContain('npm-dev');
    expect(typesOf(`${SERVER}/vitest.config.ts`, 'root-dev-tool')).toContain('npm-no-pkg');
    expect(typesOf('fixtures/shop/serve.config.ts', 'path')).toContain('core');
    expect(imports).toContainEqual(
      expect.objectContaining({ source: 'fixtures/shop/src/main.ts', module: './cart' }),
    );
    expect(imports).toContainEqual(
      expect.objectContaining({
        source: 'bench/runner.ts',
        resolved: 'fixtures/defects/missing-label/metadata.json',
      }),
    );
  });

  // CI checks the boundaries before anything is built. An import of the server by its name
  // then leads nowhere: the tool cannot resolve it, and the rules know the server by its name.
  it('reports an import of the server by name while the server is not built', async () => {
    const result = await cruiseTree({
      ...UNBUILT,
      'bench/by-name.ts': BY_NAME,
      'bench/by-subpath.ts': "export { tools } from 'wcag-evidence-mcp/contract';\n",
      'fixtures/shop/src/by-name.ts': BY_NAME,
      'scripts/by-name.ts': BY_NAME,
    });

    expect(violations(result)).toEqual([
      'app-imports-nothing-outside-its-folder: fixtures/shop/src/by-name.ts -> wcag-evidence-mcp',
      'bench-reaches-no-server-code: bench/by-name.ts -> wcag-evidence-mcp',
      'bench-reaches-no-server-code: bench/by-subpath.ts -> wcag-evidence-mcp/contract',
      'no-unresolvable-imports: bench/by-name.ts -> wcag-evidence-mcp',
      'no-unresolvable-imports: bench/by-subpath.ts -> wcag-evidence-mcp/contract',
      'no-unresolvable-imports: fixtures/shop/src/by-name.ts -> wcag-evidence-mcp',
      'no-unresolvable-imports: scripts/by-name.ts -> wcag-evidence-mcp',
      'scripts-import-no-other-part: scripts/by-name.ts -> wcag-evidence-mcp',
    ]);
  });

  // Nobody can tell where such an import leads, so it also counts as one that leaves the
  // folder of the server or of the app.
  it('reports an unresolvable import of the server or the app twice', async () => {
    const result = await cruiseTree({
      [`${SERVER}/src/alias.ts`]: "export { total } from '@shop/cart';\n",
      'fixtures/shop/src/alias.ts': "export { report } from '@bench/report';\n",
    });

    expect(violations(result)).toEqual([
      'app-imports-nothing-outside-its-folder: fixtures/shop/src/alias.ts -> @bench/report',
      'no-unresolvable-imports: fixtures/shop/src/alias.ts -> @bench/report',
      `no-unresolvable-imports: ${SERVER}/src/alias.ts -> @shop/cart`,
      `server-imports-nothing-outside-its-folder: ${SERVER}/src/alias.ts -> @shop/cart`,
    ]);
  });

  it('takes every package for undeclared when the server has no package.json', async () => {
    const result = await cruiseTree({ 'package.json': null, [`${SERVER}/package.json`]: null });

    expect(violations(result)).toEqual(
      ['optional-lib/dist/index.d.ts', 'peer-lib/dist/index.cjs', 'runtime-lib/dist/index.js'].map(
        (file) =>
          `server-imports-no-dev-dependency: ${SERVER}/src/index.ts -> node_modules/${file}`,
      ),
    );
  });
});

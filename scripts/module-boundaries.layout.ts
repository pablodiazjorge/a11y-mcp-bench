// What the tests of the module boundaries share: a small copy of the layout that ADR 0003
// plans, and the way to run dependency-cruiser on it with the real configuration. Most parts
// of the repository do not exist yet, so the rules cannot be tried on the repository itself.

import { cruise } from 'dependency-cruiser';
import type { ICruiseOptions, ICruiseResult } from 'dependency-cruiser';
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The files of a tree: path from its root, written with `/`, and content. */
export type Tree = Readonly<Record<string, string>>;

/** Files to add to the layout. `null` takes a file of the layout away. */
export type Changes = Readonly<Record<string, string | null>>;

const CONFIG = fileURLToPath(new URL('../.dependency-cruiser.js', import.meta.url));

export const SERVER = 'packages/wcag-evidence-mcp';
/** What the server's `package.json` exports: the code that `tsc` builds. */
export const BUILT = `${SERVER}/dist/index.js`;
/** An import of the server by its package name, which the workspace link leads to its folder. */
export const BY_NAME = "export { run } from 'wcag-evidence-mcp';\n";
/** A second package of the workspace, which a case adds. Its name starts like the server's. */
export const SIBLING = 'packages/wcag-evidence-mcp-extra';

// The workspaces that npm links into `node_modules` when their folder has a `package.json`.
const WORKSPACES: Tree = { 'wcag-evidence-mcp': SERVER, 'wcag-evidence-mcp-extra': SIBLING };

const manifest = (fields: object): string => JSON.stringify({ version: '1.0.0', ...fields });

/**
 * An installed package, as npm leaves it in `node_modules`. Its code is in `dist`, like that
 * of most packages, and imports a file that is not there: the rules must see the package
 * without reading it. Only the given condition of `exports` leads into the package, so a
 * condition that the configuration loses shows as an import that cannot be resolved.
 */
const installed = (name: string, condition: string, file = 'index.js'): Tree => ({
  [`node_modules/${name}/package.json`]: manifest({
    name,
    exports: { [condition]: `./dist/${file}` },
  }),
  [`node_modules/${name}/dist/${file}`]: "export * from './not-shipped.js';\n",
});

/** The `package.json` of the server, with more fields when a case needs them. */
export const serverManifest = (fields: object = {}): string =>
  manifest({
    name: 'wcag-evidence-mcp',
    exports: './dist/index.js',
    dependencies: { 'runtime-lib': '1.0.0' },
    devDependencies: { 'dev-tool': '1.0.0' },
    peerDependencies: { 'peer-lib': '1.0.0' },
    optionalDependencies: { 'optional-lib': '1.0.0' },
    ...fields,
  });

const NOWHERE = "import './not-generated.js';\n";

// What tools generate, one file in each folder that the configuration does not read. Every
// file has an import that would break a rule if it were read.
const GENERATED: Tree = {
  // The server is built. Build output repeats `src`, and a bundler may reshape its imports.
  [BUILT]: "export { countLines } from '../../../scripts/lines.ts';\n",
  // The cache of the Angular CLI.
  'fixtures/shop/.angular/cache/chunk.js': "export * from '../../../../bench/report.ts';\n",
  'fixtures/shop/out-tsc/main.js': NOWHERE,
  'coverage/lcov-report/sorter.js': NOWHERE,
  'playwright-report/trace/index.js': NOWHERE,
  'blob-report/report.js': NOWHERE,
  'test-results/trace/viewer.js': NOWHERE,
};

/** The generated files of the layout. */
export const GENERATED_FILES: readonly string[] = Object.keys(GENERATED);

/** The planned layout, with only imports that the rules allow. */
export const LAYOUT: Tree = {
  // `runtime-lib` is also a development dependency of the root. The server declares it as a
  // dependency, and its own `package.json` is the one that counts.
  'package.json': manifest({
    name: 'layout',
    workspaces: ['packages/*', 'fixtures/*'],
    devDependencies: { 'root-dev-tool': '1.0.0', 'runtime-lib': '1.0.0' },
  }),
  ...installed('runtime-lib', 'import'),
  ...installed('dev-tool', 'node'),
  ...installed('root-dev-tool', 'default'),
  ...installed('peer-lib', 'require', 'index.cjs'),
  ...installed('optional-lib', 'types', 'index.d.ts'),
  ...GENERATED,

  [`${SERVER}/package.json`]: serverManifest(),
  [`${SERVER}/src/index.ts`]: [
    "import { existsSync } from 'node:fs';",
    "import { value as optional } from 'optional-lib';",
    "import { value as peer } from 'peer-lib';",
    "import { value } from 'runtime-lib';",
    "import { audit } from './audit.ts';",
    'export const run = (): number => audit(value + peer + optional);',
    "export const built = existsSync('dist');",
    '',
  ].join('\n'),
  [`${SERVER}/src/audit.ts`]:
    'export const audit = (input: number): number => input;\nexport type Audit = typeof audit;\n',
  [`${SERVER}/src/audit.test.ts`]: [
    "import { value } from 'dev-tool';",
    "import { value as other } from 'root-dev-tool';",
    "import { sample } from '../test/helper.ts';",
    "import { audit } from './audit.ts';",
    'audit(value + other + sample);',
    '',
  ].join('\n'),
  // A test does not have to be a `.ts` file.
  [`${SERVER}/src/cli.test.mjs`]: "import { value } from 'dev-tool';\nexport default value;\n",
  [`${SERVER}/test/helper.ts`]: "import { value } from 'dev-tool';\nexport const sample = value;\n",
  [`${SERVER}/vitest.config.ts`]: "import { value } from 'root-dev-tool';\nexport default value;\n",

  'fixtures/shop/package.json': manifest({ name: 'shop' }),
  // Angular code writes its imports without the extension.
  'fixtures/shop/src/main.ts':
    "import { value } from 'runtime-lib';\nimport { total } from './cart';\nexport const shown = total + value;\n",
  'fixtures/shop/src/cart.ts': 'export const total = 0;\n',
  'fixtures/shop/serve.config.ts': "import { join } from 'node:path';\nexport default join('a');\n",
  'fixtures/defects/missing-label/metadata.json': '{ "criterion": "1.3.1" }\n',
  'fixtures/defects/missing-label/defect.test.ts':
    "import { total } from '../../shop/src/cart.ts';\nexport const seen = total;\n",

  'bench/runner.ts': [
    "import metadata from '../fixtures/defects/missing-label/metadata.json' with { type: 'json' };",
    "import { grade } from './grader/grade.ts';",
    "import { report } from './report.ts';",
    'report(grade(metadata.criterion));',
    '',
  ].join('\n'),
  'bench/grader/grade.ts': 'export const grade = (criterion: string): string => criterion;\n',
  'bench/report.ts': 'export const report = (line: string): string => line;\n',

  'scripts/check.ts': "import { countLines } from './lines.ts';\ncountLines('');\n",
  'scripts/lines.ts': 'export const countLines = (text: string): number => text.length;\n',
};

const roots: string[] = [];

/** Writes the layout with `changes` to a new temporary folder and returns its path. */
function writeTree(changes: Changes): string {
  // The real path: on Windows the temporary folder can come in its short form, and
  // dependency-cruiser would then see every file outside the base folder.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'module-boundaries-')));
  roots.push(root);
  const files: Changes = { ...LAYOUT, ...changes };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    const file = join(root, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  // npm links each workspace into `node_modules`. A junction needs no special rights on
  // Windows, and other systems ignore the type.
  for (const [name, folder] of Object.entries(WORKSPACES)) {
    if (typeof files[`${folder}/package.json`] !== 'string') continue;
    symlinkSync(join(root, ...folder.split('/')), join(root, 'node_modules', name), 'junction');
  }
  return root;
}

/** Deletes every tree that `cruiseTree` wrote. A test file calls it when it ends. */
export function removeTrees(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

let loaded: Promise<ICruiseOptions> | undefined;

/** Reads `.dependency-cruiser.js` the way the command line of dependency-cruiser does. */
export function loadOptions(): Promise<ICruiseOptions> {
  loaded ??= extractDepcruiseOptions(CONFIG);
  return loaded;
}

/** Runs dependency-cruiser on a tree the way `npm run check:deps` runs it on the repository. */
export async function cruiseTree(changes: Changes = {}): Promise<ICruiseResult> {
  const options = await loadOptions();
  const { output } = await cruise(['.'], { ...options, baseDir: writeTree(changes) });
  if (typeof output === 'string') throw new Error('expected the result as an object');
  return output;
}

/**
 * The violations of a result, as `rule: from -> to`, in alphabetical order. A cycle is written
 * as its modules in alphabetical order, because which of its imports gets reported is up to
 * the tool.
 */
export function violations({ summary }: ICruiseResult): string[] {
  const lines = summary.violations.map(({ rule, from, to, cycle }) => {
    const modules = cycle?.map(({ name }) => name).sort();
    return `${rule.name}: ${modules === undefined ? `${from} -> ${to}` : modules.join(' <-> ')}`;
  });
  return [...new Set(lines)].sort();
}

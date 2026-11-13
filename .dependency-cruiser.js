// The module boundaries of the repository, as rules for dependency-cruiser. ADR 0003
// (docs/adr/0003-monorepo-layout.md) decides them, and `npm run check:deps` checks them.
//
// Paths are relative to the root of the repository and written with `/` on every OS. A rule
// for a part that does not exist yet checks nothing until the part's first file arrives.

const SERVER = '^packages/wcag-evidence-mcp/';
// An import of the server by its package name leads to its folder through the workspace link.
// While the server is not built, the import cannot be resolved and keeps the name as written.
const SERVER_BY_NAME = '^wcag-evidence-mcp(/|$)';
const APP = '^fixtures/shop/';
// The files of a part, without the packages that npm installs inside its folder: a
// package is imported by its name, never by a relative path into `node_modules`.
const SERVER_OWN_FILES = '^packages/wcag-evidence-mcp/(?!node_modules/)';
const APP_OWN_FILES = '^fixtures/shop/(?!node_modules/)';
const INSTALLED = '(^|/)node_modules/';
// What the server and the app may import from outside their folder: a Node built-in, and a
// package imported by its name. The type of the import says so, not the path it leads to: a
// relative path into `node_modules` reaches a package that no `package.json` has to declare.
const BUILT_IN_OR_PACKAGE = [
  'core',
  ...['npm', 'npm-dev', 'npm-peer', 'npm-optional', 'npm-bundled', 'npm-no-pkg', 'npm-unknown'],
];
// What stays out of the published package: the tests, the `test` folder at the root of the
// server and the tool configuration at its root. A file with one of those names deeper in
// the source is published like any other.
const NOT_PUBLISHED = [
  '^packages/wcag-evidence-mcp/.+[.]test[.][cm]?[jt]s$',
  '^packages/wcag-evidence-mcp/test/',
  '^packages/wcag-evidence-mcp/[^/]+[.]config[.][cm]?[jt]s$',
];
// Folders that tools fill with build output and reports. `.gitignore` lists each of them.
const GENERATED =
  '(^|/)(dist|out-tsc|coverage|[.]angular|playwright-report|blob-report|test-results)/';

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'server-imports-nothing-outside-its-folder',
      severity: 'error',
      comment: 'The server is published on its own, so nothing outside its package reaches users.',
      from: { path: SERVER },
      to: { pathNot: SERVER_OWN_FILES, dependencyTypesNot: BUILT_IN_OR_PACKAGE },
    },
    {
      name: 'app-imports-nothing-outside-its-folder',
      severity: 'error',
      comment: 'The agent under test receives a copy of this folder and nothing else.',
      from: { path: APP },
      to: { pathNot: APP_OWN_FILES, dependencyTypesNot: BUILT_IN_OR_PACKAGE },
    },
    {
      name: 'bench-reaches-no-server-code',
      severity: 'error',
      comment:
        'The agent starts the built server through MCP, as any user does; a shortcut, even through another file, would measure something else.',
      from: { path: '^bench/' },
      to: { path: [SERVER, SERVER_BY_NAME], reachable: true },
    },
    {
      name: 'scripts-import-no-other-part',
      severity: 'error',
      comment:
        'The repository checks read the other parts as files, so they still run when a part is broken.',
      from: { path: '^scripts/' },
      to: { path: ['^(packages|fixtures|bench)/', SERVER_BY_NAME] },
    },
    {
      name: 'no-circular-imports',
      severity: 'error',
      comment: 'Modules in a cycle cannot be loaded, tested or changed one at a time.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'server-imports-no-dev-dependency',
      severity: 'error',
      comment:
        'Users install the server with only the `dependencies` of its own `package.json`; anything else is missing on their machine.',
      from: { path: SERVER, pathNot: NOT_PUBLISHED },
      to: { dependencyTypes: ['npm-dev', 'npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'server-imports-no-test-or-config',
      severity: 'error',
      comment:
        'Tests and tool configuration are not in the published package, and they may import development dependencies.',
      from: { path: SERVER, pathNot: NOT_PUBLISHED },
      to: { path: NOT_PUBLISHED },
    },
    {
      name: 'no-unresolvable-imports',
      severity: 'error',
      comment:
        'A rule can only judge an import that leads to a known file; one that leads nowhere could hide any of the others.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    // Installed packages and generated output are leaves of the graph: their own imports are
    // not read, but an import that leads to them still shows, so a rule can report it. Leaving
    // them out of the graph would hide an import of the built server, whose code is in `dist`.
    doNotFollow: { path: [INSTALLED, GENERATED] },
    // Count `import type` too: a type taken from another part is still a dependency on it.
    // Today `detectJSDocImports` alone has that effect, because it makes the tool read the
    // code with the TypeScript compiler. This option stays in case that one is removed.
    tsPreCompilationDeps: true,
    // A JavaScript file can take a type from another file in a JSDoc comment.
    detectJSDocImports: true,
    // Resolve a package the way Node does, through the `exports` field of its `package.json`.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};

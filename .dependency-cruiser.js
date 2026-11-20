// The module boundaries of the repository as rules for dependency-cruiser, checked by
// `npm run check:deps`. ADR 0003 (docs/adr/0003-monorepo-layout.md) decides the boundaries
// between the parts, and ADR 0004 (docs/adr/0004-server-architecture.md) those inside the
// server.
//
// Paths are relative to the root of the repository and written with `/` on every OS. A rule
// for a part that does not exist yet checks nothing until the part's first file arrives.

const SERVER = '^packages/wcag-evidence-mcp/';
// An import of the server by its package name. The bare name never resolves, because the
// package ships a binary only, with no `exports` or `main` field, so the tool keeps the name
// as written. A subpath such as `wcag-evidence-mcp/src/bin.ts` resolves through the workspace
// link to a file in the server's folder, which `SERVER` matches.
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
// the source is published like any other. The server's `scripts/` folder is not shipped, but
// it counts as published on purpose: the rules for published code are stricter, so it may not
// import a development dependency or an adapter.
const NOT_PUBLISHED = [
  '^packages/wcag-evidence-mcp/.+[.]test[.][cm]?[jt]s$',
  '^packages/wcag-evidence-mcp/test/',
  '^packages/wcag-evidence-mcp/[^/]+[.]config[.][cm]?[jt]s$',
];
// Folders that tools fill with build output and reports. `.gitignore` lists each of them.
const GENERATED =
  '(^|/)(dist|out-tsc|coverage|[.]angular|playwright-report|blob-report|test-results)/';

// The parts inside the server, from ADR 0004: the core, one folder per adapter, and the binary
// that wires them. The rules for the core and the adapters look at the published code only:
// the server's tests, in `test/` or next to the code as `*.test.*`, may cross between adapters.
const CORE = '^packages/wcag-evidence-mcp/src/core/';
const ADAPTERS = '^packages/wcag-evidence-mcp/src/adapters/';
// The folder of one adapter. `$1` in a rule's `to` stands for the folder that `from` matched.
const ADAPTER = '^packages/wcag-evidence-mcp/src/adapters/([^/]+)/';
const BIN_SOURCE = '^packages/wcag-evidence-mcp/src/bin[.]ts$';
// The binary and its build. Importing either one starts the server on the importer's stdin.
const BIN = '^packages/wcag-evidence-mcp/(src/bin[.]ts|dist/bin[.]js)$';
// `zod`, installed at the root or inside the server's folder. A relative path into
// `node_modules` matches too, and `server-imports-nothing-outside-its-folder` reports it.
const ZOD = '(^|/)node_modules/zod/';

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
    {
      name: 'server-core-imports-only-core-and-zod',
      severity: 'error',
      comment:
        "The core is tested without a browser, MCP or the operating system, so it imports none of them; `zod` is allowed because the tools' output is described as `zod` schemas.",
      from: { path: CORE, pathNot: NOT_PUBLISHED },
      to: { pathNot: [CORE, ZOD] },
    },
    {
      name: 'server-adapter-imports-no-other-adapter',
      severity: 'error',
      comment:
        'Each adapter can be replaced or faked on its own only if no other adapter depends on it.',
      from: { path: ADAPTER, pathNot: NOT_PUBLISHED },
      to: { path: ADAPTERS, pathNot: '^packages/wcag-evidence-mcp/src/adapters/$1/' },
    },
    {
      name: 'server-wires-adapters-only-in-bin',
      severity: 'error',
      comment:
        'The binary is the one place that chooses the adapters; code that imported one would tie itself to it.',
      // The whole folder of the server, so that a file outside `src/` is no bridge either.
      from: { path: SERVER, pathNot: [ADAPTER, BIN_SOURCE, ...NOT_PUBLISHED] },
      to: { path: ADAPTERS },
    },
    {
      name: 'nothing-imports-server-bin',
      severity: 'error',
      comment:
        'Importing the binary starts a server on the stdin and stdout of whoever imports it.',
      from: {},
      to: { path: BIN },
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
    // `process.getBuiltinModule('node:fs')` loads a Node built-in without an import. Counted
    // as an import of it, so the core cannot reach a built-in that way either.
    detectProcessBuiltinModuleCalls: true,
    // Resolve a package the way Node does, through the `exports` field of its `package.json`.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};

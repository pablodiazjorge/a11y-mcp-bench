# 0003. Monorepo layout and module boundaries

- **Status:** Accepted
- **Decided:** 2026-11-12

## Context

The project has four parts that change together, but whose dependencies must stay few and one-way:

- an MCP server, which will be published on its own;
- a reference Angular app, a copy of which the agent under test receives as its working folder;
- seeded defects for that app (bugs added on purpose, one patch each);
- a benchmark harness, which runs the agent, grades the result and writes the report.

Two properties depend on keeping them apart. The app must not lean on the code of the other parts, because the agent only sees that folder. And the agent must get the server the way any user does: the built package, started by the agent's MCP client and reached only through the protocol. Otherwise the benchmark would measure something that users do not get.

A rule that lives only in a document is broken sooner or later, so the boundaries need a check that fails in CI.

## Options considered

**Where the parts live**

1. **One repository per part.** Clear boundaries for free, but a change to a tool and to the task that uses it would need coordinated pull requests, and a study would have to record one commit per repository.
2. **One package.** The simplest to set up, with no boundary at all between the published server and the rest.
3. **One repository with npm workspaces.** One commit describes a whole study, each part has its own `package.json`, and the boundaries have to be enforced by a tool.

**How the boundaries are enforced**

1. **Convention and review.** No tooling, and no guarantee.
2. **ESLint rules on imports.** ESLint is already in the toolchain. Its core rule `no-restricted-imports` checks one file at a time; plugins such as `eslint-plugin-import` add zones, cycles and development dependencies, but their cycle check is slow on a large graph and nothing draws the result.
3. **TypeScript project references.** They stop an undeclared import from one project into another and forbid cycles between projects. But each project needs `composite` and declaration output, which the parts that Node runs directly do not otherwise need, and they cannot express a rule such as "production code does not import a development dependency".
4. **Nx and its module boundary rule.** It tags each project and checks which tags may depend on which. It also brings a task runner and a cache that a repository of this size does not need.
5. **dependency-cruiser.** It builds the import graph of the repository, checks it against a list of rules and can draw it. One more development dependency.

**How TypeScript runs**

1. **Compile everything.** One way of running code, and a build step before every script runs (Vitest compiles tests on its own either way).
2. **Run everything directly with Node.** Node strips the types and runs the file. No build step, but Node does not strip types from files inside `node_modules`, so a published package must ship JavaScript.
3. **Compile only what is published.** The server is compiled with `tsc`; the harness and the scripts run directly.

## Decision

**Layout.** One repository with npm workspaces:

| Path                         | Part                                                                           | Depends on                                               |
| ---------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `packages/wcag-evidence-mcp` | The MCP server                                                                 | nothing else in the repository                           |
| `fixtures/shop`              | The reference Angular app and its unit tests                                   | nothing else in the repository                           |
| `fixtures/defects`           | One folder per seeded defect: a patch, its metadata and its test               | `fixtures/shop`, as the target of the patches            |
| `bench`                      | The harness (runner, grader, statistics, report), preregistrations and results | the two fixtures and the server's tool contract, as data |
| `scripts`                    | Repository checks                                                              | nothing else in the repository                           |
| `docs`                       | ADRs and guides                                                                | nothing (no code)                                        |

**Boundaries.** dependency-cruiser checks these rules as part of `npm run ci`:

1. The server imports nothing outside its own folder, except installed packages and Node built-ins.
2. `fixtures/shop` imports nothing outside its own folder, except installed packages and Node built-ins.
3. `bench` does not reach the server's folder, directly or through another file. The agent starts the built server through its MCP configuration, as it would for any user.
4. `scripts` imports nothing from the other parts.
5. No circular imports.
6. The code of the server that is published imports only what the server's own `package.json` lists as a dependency: no development dependency, and nothing it does not declare.
7. The code of the server that is published does not import the server's own tests or tool configuration.
8. An import that the tool cannot resolve to a file, a package or a Node built-in fails the check.

`docs/architecture.md` explains the parts, draws their dependencies and says how to print the graph that the tool draws from the code.

**Node and TypeScript.**

- Node 26 is the base version, pinned in `.nvmrc`. `engines` accepts `^24.15.0 || >=26.0.0`: Node 24 is the previous LTS line, and 24.15.0 is the lowest 24.x that Angular CLI 22 accepts. CI runs on Ubuntu with Node 24 and 26 and on Windows with Node 26.
- The server is compiled with `tsc`, because a published package ships JavaScript. The harness and the scripts are run directly by Node.
- Because Node only strips types, the code avoids the TypeScript syntax that needs a real transformation. `erasableSyntaxOnly` in `tsconfig.base.json` rejects `enum`, namespaces and parameter properties, and an ESLint rule rejects decorators. The Angular app is the exception: the Angular compiler builds it, and decorators are part of the framework.

## Consequences

- A study can name one commit that holds the server, the app, the defects and the harness it used.
- A rule for a part that does not exist yet checks nothing until the part's first file arrives. Until then, tests build a small copy of the planned layout and check that each rule reports a forbidden import.
- The harness cannot take a shortcut into the server. What it needs to know about the tools comes from the server's tool contract (the generated list of its tools and their schemas), not from its source.
- As a workspace, the app shares the lockfile and the `node_modules` folder of the root. How the copy that the agent receives gets its dependencies, and where the hidden tests live, are decided with the harness, in a later ADR.
- Three ways of building TypeScript live in one repository: `tsc` for the published server, the Angular compiler for the app, and Node for the rest. The cost stays small while the rule stays simple: only the server is compiled with `tsc`.
- The layers inside the server are a later decision, with its own ADR.

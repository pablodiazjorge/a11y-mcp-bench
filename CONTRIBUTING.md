# Contributing

The project is at an early stage, so the most useful contribution today is an issue: a mistake in a document, a flaw in the method or a case the checks miss.

## Before you open a pull request

Open an issue first and wait for an answer. Each study will be preregistered: its tasks, grading and analysis are frozen before the first run, so a change that looks harmless can invalidate it. An issue settles the scope before you spend time.

## Set up

Follow [Development](README.md#development) in the README. CI runs `npm run ci:full` on Ubuntu (Node 24 and 26) and on Windows (Node 26), and the lockfile age check. Today `ci:full` is the same as `npm run ci`. If you change `package-lock.json`, also run `npm run check:lockfile-age`: `npm run ci` does not run it.

## Rules for a change

The rules are in [AGENTS.md](AGENTS.md). They apply to people and to coding agents alike. The ones most easily missed:

- One change is one pull request, and its title follows Conventional Commits.
- No dependency version published less than seven days ago.
- No personal data in any file: `npm run check:repo` looks for local user paths, email addresses and secrets.
- English everywhere. Only the README and the study reports also have a Spanish version.

## What a pull request needs

- A description with three sections: `What and why`, `Verification`, `Risks and limitations`. The template has them.
- Tests for new code.
- A green CI run.

## License

By contributing, you agree that your code is released under the [MIT License](LICENSE), and your documents and results under [CC BY 4.0](LICENSE-CC-BY-4.0).

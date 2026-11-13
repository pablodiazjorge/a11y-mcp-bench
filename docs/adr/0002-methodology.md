# 0002. Methodology: preregistered, paired and graded by tests

- **Status:** Accepted
- **Decided:** 2026-11-12

## Context

The benchmark's answer ([ADR 0001](0001-scope-and-non-goals.md)) is a set of estimates, each with an uncertainty: how often the agent fixes a defect under each condition (a setup the agent is tested under), and at what cost. They are worth publishing only if a reader can trust how they were obtained.

Three things make a benchmark of agents easy to get wrong:

- **Choices made after seeing the data.** With enough freedom to pick tasks, metrics and exclusions afterwards, chance differences can be made to look like an effect.
- **Noise.** An agent does not give the same answer twice, and tasks differ a lot in difficulty. A difference between two conditions can come from the tasks and not from the tool.
- **A grader with opinions.** If a language model decides whether a fix is good, its own errors and preferences become part of the result.

The benchmark's author also writes one of the MCP servers it measures ([ADR 0001](0001-scope-and-non-goals.md)), one more reason to fix the method before the first study run. An MCP server gives a coding agent extra tools to call.

## Options considered

1. **Exploratory benchmark.** Run the agent, look at the results and report what seems interesting. It is the fastest option and it finds surprises, but it cannot support a claim: nobody can tell how many analyses were tried.
2. **Preregistered study with a language model as judge.** The plan is fixed in advance, and a model rates the quality of each fix. It measures more than "fixed or not", but the judge has to be validated against human labels first, and that is a study of its own.
3. **Preregistered study graded by people.** Reviewers who do not know the condition judge each fix. It measures quality without a model's errors, but it costs hours per run, and without outside reviewers the grader would be the author, the person with the conflict of interest.
4. **Preregistered study graded by tests.** The plan is fixed in advance, and a fix counts only if tests say so. It measures less, but the grading is mechanical: anyone can rerun it on the published output of a run, with the same pinned versions.

## Decision

Option 4 for the first study. Every study follows these six rules. A later study can add a judged measure to them, not replace them.

1. **Preregistration comes first.** Before any study run, a preregistration (the study plan, published in advance) fixes the question, the tasks, the conditions, the agent and model versions and settings, the primary outcome (the one measure the study is judged on) and the comparisons that test it, the number of runs and why it is enough (the smallest effect worth detecting, and the power: the chance of detecting that effect if it is real), the analysis, the exclusions (which runs may be dropped or rerun, and why) and the stopping rule (when to stop running). The document is merged into `main` and tagged `prereg/study-N`. The harness (the code that runs the agent and grades its work) refuses to run a study whose preregistration is not in `main` on GitHub, or whose tasks, prompts, grader, tool contract (the names and schemas of the server's tools) or pinned versions have changed since. Runs start from a clean checkout of that tag.
2. **Paired design.** Every task runs under every condition, so each task is its own control. In the first study, the conditions differ only in which MCP server, if any, the agent has: same agent, same model and same permissions. A server brings all of its tools, and a third-party server may bring general browser tools as well as its checks ([ADR 0001](0001-scope-and-non-goals.md)). The runs of all conditions are interleaved in a random order fixed by a seed, so that a change over time, in the service or on the machine, does not fall on one condition. A task can run more than once under each condition, to measure the agent's own variation; the preregistration fixes how many times.
3. **Grading by tests.** A task is solved only if three things hold: the defect's own test passes, the regression tests still pass, and the app still builds. The grader runs from outside the folder the agent works in. No language model judges anything in the first study. With the results of a study, the project publishes the change that the agent made in each run, so that anyone can rerun the grading.
4. **The agent does not see the hidden tests.** It does not receive the end-to-end tests, the accessibility scans or the test of each defect: they stay outside its folder, so that a failing test cannot point the agent at the defect. These tests are public in this repository, so the isolation of each run must also keep the agent from reading them on GitHub or elsewhere on the machine. Which other tests the agent receives is decided with the defects, in their own ADR.
5. **Pilots are separate.** A pilot is a small trial run before the study. It uses its own defects, which are not part of any study, so that no choice about the study depends on how the agent did on the study's own tasks. In pilot mode the harness accepts only pilot defects and refuses the defects of a study. A pilot measures cost, duration and how often the agent already succeeds without a server. Pilot runs skip the preregistration check, are marked as pilot runs, are published and never enter an analysis.
6. **Every study is published.** The report comes out whatever the result is, with the deviations from the preregistration and the limitations. A result that shows no effect is a result. A study stopped before its end, or replaced by a new preregistration, is also published, with the runs already made.

## Consequences

- The harness and the grader must exist before the preregistration, because the document fixes them; so must the pilot, because its results guide the design of the defects. Results therefore come late in the project.
- If the pilot shows that the agent solves almost every pilot task without a server, there is no room to measure an improvement, and the study's defects are redesigned before the preregistration. The pilot defects guide that redesign; the agent is not run on the study's defects to check it. The study then measures defects chosen to be hard for the agent alone, so its result does not describe the defects that the agent already fixes, and the report must say so.
- The first study says whether a defect was fixed without breaking what the tests cover. It does not say how good the fix is, and a test can reject a valid fix its author did not foresee or pass one that games it. A later study can add a judged measure, once the judge has been compared with human labels.
- Hiding the end-to-end tests makes the agent's folder less like a real repository, so the result applies to repositories without such tests. And only defects that a test can check are eligible.
- The method limits the author's conflict of interest but does not remove it ([ADR 0001](0001-scope-and-non-goals.md)). Before the preregistration freezes them, the author chooses the defects, writes the tests that grade them and picks the third-party server, and the pilot runs, made in the planned conditions, can show him how each server does on the pilot defects. The preregistration makes those choices public; it does not make them neutral. The harness check prevents a study run before the preregistration by mistake; it cannot prove that no run happened outside the harness.
- The author writes both this project's server and the hidden tests. Where the two share a definition, such as what counts as visible focus, or the same pinned axe-core version, the server can tell the agent what the grader will check, and the third-party server cannot. Part of a difference between the two servers can come from that.
- A change to a task, to the grader or to the analysis after the tag means a new preregistration, or a deviation written in the report.
- The statistical analysis, how defects are added to the app, the isolation of each run, the grader, and the check that blocks a study run without its preregistration will each get their own ADR.

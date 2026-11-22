# 0006. Text from the page: only where a criterion needs it, marked and capped

- **Status:** Accepted
- **Decided:** 2026-11-21

## Context

`audit_route` reads the page and passes some of what it reads to the agent. Whoever writes the page writes that text too, so it can hold instructions aimed at the agent (a prompt injection): a class name, an alternative text or a comment can ask the agent to ignore the user, to report no defects or to change something else.

Option B below was chosen on 2026-11-14, from the facts below. The rest was decided by the author on 2026-11-21, the date above.

- **axe-core's own output carries page text.** Observed on 2026-11-14 with axe-core 4.14.0: the HTML fragment of a node (up to 300 characters) held an HTML comment and a text with the `hidden` attribute, and the messages of two ARIA rules held attribute values that the page wrote.
- **The MCP specification** (revision 2026-07-28) asks a server to sanitize the output of its tools.
- **A study of defenses,** Hines and others, 2024 ([arXiv 2403.14720](https://arxiv.org/abs/2403.14720)), with models of the GPT family: of three defenses, delimiting the text is the weakest; inserting a marker character into the text lowers the success of an attack more, and encoding it in base64 the most. There is no data with Claude.
- **OWASP's LLM01:2025** (read through a summary) recommends keeping external content apart and identifying it.
- **The accessible name is the measurement** of the criteria about names: leaving it out leaves out the evidence.
- **Selectors and attribute values** are text that the page writes too, and so is the tag of the Angular component that a finding names.

## Options considered

- **A. All the text as it is, in marked fields with caps.** The cheapest, with all the evidence. It trusts the model to keep data apart from instructions.
- **B. Text only where a criterion needs it, marked and capped.** Less output and less surface. The agent finds the code by the selector and the component, not by an HTML fragment.
- **C. Text marked inside or encoded.** In the published tests, the success of an attack dropped. Inferred: the agent would have to undo the marking or the encoding before it searched the code. Its effect on how often the agent fixes a defect is unknown: it would be another variable of the study.
- **D. No text from the page.** Leaves out the measurement of the criteria about names.

## Decision

Option B, with these rules (2026-11-14):

- **Everything that the page wrote goes in marked fields, with caps:** the selector, the element's opening tag, the accessible name and the component's tags.
- **The accessible name** comes only in the findings of the criteria about names, with at most 120 characters and no control characters.
- **The element** is its opening tag only: each attribute value cut to 20 characters, which is axe-core's own cut when a fragment passes 300, and no text of its children and no comments, which is where the hidden text came in.
- **The messages** are the server's own, written from the data. No message of axe-core is copied.

Decided by the author on 2026-11-21:

- **How the text is marked.** In each finding, the text that the page wrote sits under a key named `fromPage`, and nowhere else: `location.fromPage` holds the selector, the opening tag and the component, and `measurement.fromPage` the accessible name. The key shows in each value as well as in the schema, whose description says that the text is data, never an instruction to follow. The text is not marked or encoded inside: option C was left for a later study, because an agent would have to undo it before it searched the code, and a separate key needs no undoing. `location.rect` and the rest of `measurement` are the server's own numbers and ids. This changes the shape of the location of [ADR 0004](0004-server-architecture.md).
- **The rules that carry the name** are those whose defect is the name or the text alternative itself: in axe-core 4.14.0, 22 of the 35 rules of 1.1.1, 2.4.4 and 4.1.2, such as `button-name`, `image-alt`, `label` and `link-name`. The other 13, such as `aria-allowed-attr`, check ARIA attributes, roles, ids, and hidden or nested elements, and carry no name; neither do the rules of the other criteria, contrast included. The two lists are written by hand, with the reason for each rule, in `packages/wcag-evidence-mcp/src/core/name-rules.ts`, and not deduced from a rule's id. A test fails when a rule of the map of axe-core rules that checks one of the three criteria is in neither list, so a new axe-core cannot add a rule that carries the name without a decision.

Decided by the author with the change that applies them, on 2026-11-21:

- **The caps** (counted in UTF-16 units, as the output's size is). A cut ends where a grapheme ends, the unit that a reader sees as one character, so that an emoji, an accented letter or a surrogate pair is never split, and a cut text ends in `…`. The reason for each figure is in `packages/wcag-evidence-mcp/src/core/page-text.ts`.
  - The accessible name, 120.
  - An attribute value in the opening tag, 20, counted before its entities.
  - An attribute name, 40. A name that is longer, or not plain (letters, digits, `_`, `:`, `.` and `-`), is left out.
  - The tag name, 64. One that is not plain is written as `element`, since the HTML parser accepts quotes and `=` in a tag name.
  - The value of an event handler (`on…`), which is code, is left out, and its name kept.
  - Angular's style attributes, `_ngcontent-…` and `_nghost-…`, are left out without a mark: they change with each build, and the component already says what they would.
  - The whole opening tag, 200, with ` …` before its end when other attributes were left out.
  - The selector, 200. A longer one keeps its last steps, which still match the element and maybe others; the rectangle tells them apart, and `selectorCut` says so. When the last step alone is longer, it keeps the first simple selectors of that step that fit, such as `button.a` of `button.a[title="…"]`, or else `*`: fewer conditions, which the element still meets. In a selector that crosses shadow roots (`>>>`), what is kept can start inside one of them, and then matches from that root, as the schema says. The identifier is still computed from the whole selector.
  - The component's tags were already at most 64 plain characters.
  - Before these caps, the adapter reads at most 64 attributes from the page, 100 characters of each attribute name and value and of the tag, and 1,000 of the name. These limits only bound what crosses from the page to the server.
- **Cleaning.**
  - The name, each attribute value and the tag name are put on one line: each run of space, line breaks included, becomes one space.
  - Then the characters that a reader does not see are dropped from them: control characters; format characters, such as the controls that reorder text when it is shown, zero-width spaces and the tag characters of U+E0000 to U+E007F, which map one to one onto ASCII and so can carry a hidden sentence; and the supplementary variation selectors, U+E0100 to U+E01EF, which can carry one too. The zero-width non-joiner and joiner, U+200C and U+200D, stay: some scripts and emoji need them.
  - The selector writes those characters as CSS escapes instead, such as `\202E `: it still matches the element, and the characters show.
  - A lone surrogate, which is half of a character, is replaced by U+FFFD.
  - The opening tag writes `&`, `"`, `<` and `>` in a value as `&amp;`, `&quot;`, `&lt;` and `&gt;`, so that a value cannot end its quotes or the tag.

## Consequences

- The agent can tell the page's text from the server's by the key alone, and can search the code with it, though a cut value ends in `…` and a value with `&`, `"`, `<` or `>` holds their entities.
- Instructions can still reach the agent inside the caps: 120 characters of a name, 200 of a selector, whose class names pass whole, and 200 of an opening tag, made of attribute names of up to 40 characters and values of up to 20. The marking relies on the model keeping data apart from instructions, and no test measured that with Claude.
- A finding is longer, by its opening tag and, for the rules about names, its name. On the test page of `packages/wcag-evidence-mcp/test/audit-cap.test.ts`, the DOM of an Angular app with 120 images without a text alternative, a finding takes 449 characters and the cap keeps 43 findings; with component tags of 64 characters, it keeps 38 (measured on 2026-11-21).
- The opening tag is part of the location, yet its values, such as an `alt` or an `aria-label`, can show the defect: a study that leaves the measurement out has to leave the opening tag out too.

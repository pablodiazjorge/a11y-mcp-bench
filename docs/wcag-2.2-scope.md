# WCAG 2.2 scope

The server's audit tools check twelve WCAG 2.2 success criteria (the testable requirements of the standard), all at level A or AA. The first tool, `audit_route`, runs the axe-core rules and walks the page with the keyboard for the server's own checks, all built but that of 2.4.11. This page fixes what the tools check. It lists the criteria, how the server decides each one and what is left for manual testing, and what is out of scope and why.

The criteria and their wording come from the [WCAG 2.2 W3C Recommendation](https://www.w3.org/TR/WCAG22/) of 12 December 2024. The rule identifiers come from axe-core 4.14.0 (the open-source library of automatic accessibility checks that the server runs), the version that the counts on this page come from. Both were checked on 2026-11-20. Why the server exists and why it stays small is in [ADR 0001](adr/0001-scope-and-non-goals.md); what a finding looks like is in [ADR 0004](adr/0004-server-architecture.md).

The server holds the same twelve criteria as data in `packages/wcag-evidence-mcp/src/core/criteria.ts`. A test fails when that catalog and this page disagree on the number, name, level, link, way of deciding, class, requirement or manual part of a criterion. It also fails when a list of axe-core rules on this page disagrees with the map of axe-core rules that the server generates, `packages/wcag-evidence-mcp/src/core/axe-rules.json`. The tool `explain_criterion` and the resource `criterion://<number>` give an agent the same, one criterion at a time.

## How a criterion is decided

Each criterion gets one of two classes:

- **Automatic:** the server decides pass or fail by itself, for the part of the criterion that it checks.
- **Semi-automatic:** the server reports candidates that a person has to confirm. Either the check is a heuristic (an approximate rule that can give false positives and false negatives), and then its findings say so, or it measures something but does not decide the criterion's exceptions.

Even an automatic criterion has a part that the server cannot check, listed below under **Manual**.

## The twelve criteria

| Criterion                                                                                                          | Level | How the server decides                              | Class          |
| ------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------- | -------------- |
| [1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)                        | A     | axe-core rules                                      | Automatic      |
| [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)            | A     | axe-core rules                                      | Automatic      |
| [1.3.5 Identify Input Purpose](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html)            | AA    | axe-core rule                                       | Automatic      |
| [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)                      | AA    | axe-core rule                                       | Automatic      |
| [2.4.4 Link Purpose (In Context)](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html)        | A     | axe-core rules                                      | Automatic      |
| [4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)                        | A     | axe-core rules                                      | Automatic      |
| [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)                | AA    | axe-core rule `target-size`, turned on              | Semi-automatic |
| [2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)                                        | A     | Three axe-core rules, and an own check, a heuristic | Semi-automatic |
| [2.1.2 No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html)                        | A     | Own check, a heuristic                              | Semi-automatic |
| [2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)                                  | A     | Own check, a heuristic                              | Semi-automatic |
| [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)                              | AA    | Own check                                           | Automatic      |
| [2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | AA    | Own check                                           | Semi-automatic |

axe-core decides the first six criteria. The rules listed for each are those that carry the criterion's tag and that axe-core 4.14.0 runs by default. `audit_route` runs those rules, `target-size` for 2.5.8 and the three rules tagged 2.1.1, and no experimental rule. It reports failures only: what axe-core marks for review is left out.

### 1.1.1 Non-text Content (A)

- **Requires:** every image or other non-text content has a text alternative that serves the same purpose.
- **Rules (7):** `aria-meter-name`, `aria-progressbar-name`, `image-alt`, `input-image-alt`, `object-alt`, `role-img-alt`, `svg-img-alt`.
- **Manual:** whether the alternative says what the content says, and whether content with an empty alternative is really decorative.

### 1.3.1 Info and Relationships (A)

- **Requires:** the structure and relationships that the page shows visually (headings, lists, tables, labels) are also in its code or in text.
- **Rules (9):** `aria-hidden-body`, `aria-required-children`, `aria-required-parent`, `definition-list`, `dlitem`, `list`, `listitem`, `td-headers-attr`, `th-has-data-cells`. They check the markup of lists, tables and ARIA roles (attributes that tell assistive technology what an element is). axe-core also has three experimental rules for 1.3.1, `p-as-heading`, `table-fake-caption` and `td-has-header`, which it does not run by default.
- **Manual:** structure that is only visual and not in the markup at all, such as text styled as a heading that is not marked as one.

### 1.3.5 Identify Input Purpose (AA)

- **Requires:** a field that asks for information about the user declares its purpose in the code, such as with an `autocomplete` value.
- **Rule (1):** `autocomplete-valid`, which checks that an `autocomplete` value is valid.
- **Manual:** whether a field that asks for user data has an `autocomplete` value at all, and whether the value matches what the field asks for.

### 1.4.3 Contrast (Minimum) (AA)

- **Requires:** text has a contrast ratio of at least 4.5:1 with its background, or 3:1 for large text.
- **Rule (1):** `color-contrast`, decided on a plain background.
- **Manual:** text over an image, a gradient or another background that axe-core cannot measure (it marks those for review, and `audit_route` does not report them), and text in images.

### 2.4.4 Link Purpose (In Context) (A)

- **Requires:** the purpose of each link can be told from its text, or from its text and its context.
- **Rules (2):** `area-alt`, `link-name`. They check that a link has a name.
- **Manual:** whether the name, with its context, says where the link goes.

### 4.1.2 Name, Role, Value (A)

- **Requires:** every control has a name and a role that software can read, and assistive technologies can read its states and values, set those that the user can set, and are told when they change.
- **Rules (28):** `area-alt`, `aria-allowed-attr`, `aria-braille-equivalent`, `aria-command-name`, `aria-conditional-attr`, `aria-deprecated-role`, `aria-hidden-body`, `aria-hidden-focus`, `aria-input-field-name`, `aria-prohibited-attr`, `aria-required-attr`, `aria-roles`, `aria-tab-name`, `aria-toggle-field-name`, `aria-tooltip-name`, `aria-valid-attr-value`, `aria-valid-attr`, `button-name`, `duplicate-id-aria`, `frame-title-unique`, `frame-title`, `input-button-name`, `input-image-alt`, `label`, `link-name`, `nested-interactive`, `select-name`, `summary-name`. They check that names, roles and ARIA attributes are present and valid. axe-core also has `aria-roledescription`, deprecated and off by default.
- **Manual:** whether a name describes the control, and whether its states change as the user works it, such as `aria-expanded` on a menu that opens; and what `aria-braille-equivalent`, `duplicate-id-aria` and `frame-title-unique` look for, since axe-core 4.14.0 only marks their failures for review, which `audit_route` does not report.

### 2.5.8 Target Size (Minimum) (AA)

- **Requires:** a target for a pointer, such as a button, is at least 24 by 24 CSS pixels, or has enough space around it, with some exceptions.
- **Rule (1):** `target-size`. axe-core 4.14.0 ships it turned off, and the server turns it on. It measures focusable controls and the space around them, and skips a target inside a block of text.
- **Manual:** targets that are not focusable, which the rule does not check, such as a clickable `div`; and whether another exception applies: an equivalent control elsewhere on the page, a size set by the browser, or a size that is essential.

### 2.1.1 Keyboard (A)

- **Requires:** everything on the page can be done with a keyboard.
- **Own check (a heuristic):** an element with a listener of click or pointer events that the walk with Tab does not reach, nor any ancestor or descendant of it ([ADR 0007](adr/0007-keyboard-checks.md)).
- **Manual:** functions that the heuristic cannot see, such as a menu that opens only on hover or a widget that needs arrow keys.
- **axe-core:** version 4.14.0 also tags three of its default rules with 2.1.1: `frame-focusable-content`, `scrollable-region-focusable` and `server-side-image-map`. `audit_route` runs them and reports them as the automatic part of 2.1.1, under 2.1.1 alone: `scrollable-region-focusable` also carries 2.1.3, at level AAA, which a finding does not list.

### 2.1.2 No Keyboard Trap (A)

- **Requires:** when the keyboard can move focus into a part of the page, it can also move focus out of it, and the user is told how if it takes more than the usual keys.
- **Own check (a heuristic):** a focus cycle that repeats without passing through the browser's interface, and that one Escape does not break, with the keys that were tried. The check presses Tab, Shift+Tab and, inside such a cycle only, Escape ([ADR 0007](adr/0007-keyboard-checks.md)).
- **Manual:** a trap that only other keys would show, and whether the page explains a way out that is not standard.

### 2.4.3 Focus Order (A)

- **Requires:** keyboard focus moves through the page in an order that keeps its meaning and lets it be used.
- **Own check (a heuristic):** back jumps, where the next stop of Tab is above in the same column, or to the left in the same row ([ADR 0007](adr/0007-keyboard-checks.md)).
- **Manual:** whether an order makes sense for the content, which no comparison of positions can decide.

### 2.4.7 Focus Visible (AA)

- **Requires:** any part of the page that works with a keyboard shows when it has the keyboard focus.
- **Own check:** when Tab gives an element focus, at least one pixel of its rectangle plus 12 px changes, compared with the page at load, once the page's animations end ([ADR 0007](adr/0007-keyboard-checks.md)).
- **Manual:** an indicator drawn more than 12 px from the element; whether a small change, such as the selected text of a field, is visible enough to count; and an empty field whose only indicator is the text cursor, which the check hides.

### 2.4.11 Focus Not Obscured (Minimum) (AA)

- **Requires:** a control that receives keyboard focus is not entirely hidden by content of the page, such as a sticky header.
- **Own check, to come with the keyboard checks:** whether the focused element is entirely hidden, by a grid of points over it or by the rectangles of the layers that paint, tabbing forward and backward ([ADR 0007](adr/0007-keyboard-checks.md)).
- **Manual:** whether the user opened what hides the element, and whether a covering layer is semi-transparent, which does not hide it entirely.

## Rules for all twelve

- **One finding per rule and element.** An axe-core rule that carries two of the twelve criteria gives one finding per element, listing both, as `link-name` does for 2.4.4 and 4.1.2.
- **No best-practice rules.** axe-core 4.14.0 has 30 rules that carry no WCAG criterion, such as `aria-dialog-name` and `heading-order`. They are left out of the output: they are not WCAG failures, and the study scores defects tied to a criterion.
- **Read-only tools.** The keyboard checks press keys such as Tab, but no tool activates a control, submits a form or stores anything. What a key changes in the page stays in the browser of that call, which is closed when the call ends.
- **The study's defects.** The catalog of seeded defects for a study keeps to these twelve criteria, or says which defects fall outside them. A third-party server can see defects outside the twelve: `mcp-accessibility-scanner` 5.0.0, for example, runs every axe-core rule tagged with a WCAG criterion (read in its package on 2026-11-14). A study that compared the two servers on such a defect would favor that server.

## What is out of scope

### The other 43 criteria at levels A and AA

WCAG 2.2 has 55 criteria at levels A and AA: 31 at A and 24 at AA. The twelve were chosen because they cover the two kinds of defect that the study plans: those that axe-core sees and those that only show with the keyboard. The rest fall into three groups.

- **13 that axe-core checks by default:** 1.2.2 Captions (Prerecorded), 1.4.1 Use of Color, 1.4.2 Audio Control, 1.4.4 Resize Text, 1.4.12 Text Spacing, 2.2.1 Timing Adjustable, 2.2.2 Pause, Stop, Hide, 2.4.1 Bypass Blocks, 2.4.2 Page Titled, 2.5.3 Label in Name, 3.1.1 Language of Page, 3.1.2 Language of Parts and 3.3.2 Labels or Instructions. Third-party servers such as `mcp-accessibility-scanner` already report them. The one rule for 3.3.2, `form-field-multiple-labels`, never reports a failure: its check can only pass or ask for a review.
- **2 whose only axe-core rule is off by default:** 1.2.1 Audio-only and Video-only (Prerecorded), with `audio-caption`, deprecated, and 1.3.4 Orientation, with `css-orientation-lock`, experimental.
- **28 with no axe-core rule.** They need a person, or checks that act on the app. Four of them would need the server to act on the app: 1.4.13 Content on Hover or Focus, 3.3.1 Error Identification, 3.3.7 Redundant Entry and 4.1.3 Status Messages. The server would have to fill in and submit forms, or trigger the actions that show content and messages, and its tools would no longer be read-only.

In all, axe-core 4.14.0 has some rule for 23 of the 55 criteria and runs a rule by default for 20 of them. It has 105 rules, and a default run uses 90: it leaves out the 9 that are turned off and 6 that are experimental.

### Level AAA

The server checks no criterion at level AAA. WCAG 2.2 itself does not recommend requiring AAA for whole sites, because some content cannot meet every AAA criterion ([conformance level](https://www.w3.org/TR/WCAG22/#cc1)).

Third-party servers may report AAA failures (`mcp-accessibility-scanner` 5.0.0 runs axe-core's AAA rules), so the rule in "The study's defects" applies to them too.

### 4.1.1 Parsing

Readers who know WCAG 2.1 may look for 4.1.1 Parsing. WCAG 2.2 marks it as obsolete and removed, so it is not one of the 55.

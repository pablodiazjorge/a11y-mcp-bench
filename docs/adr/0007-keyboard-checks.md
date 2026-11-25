# 0007. Keyboard checks: deterministic definitions and their limits

- **Status:** Accepted
- **Decided:** 2026-11-25

## Context

Five of the twelve criteria need the keyboard: 2.1.1 Keyboard, 2.1.2 No Keyboard Trap, 2.4.3 Focus Order, 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured (Minimum). Today `audit_route` checks 2.1.1 only through three axe-core rules and lists the other four in `notChecked` ([scope](../wcag-2.2-scope.md)). The scope page left the class of 2.4.7 and 2.4.11 open until these checks were designed. This record fixes what each check measures, how it walks the page and what it cannot see.

The facts below were observed on 2026-11-25 in Chrome Headless Shell 159.0.8154.6, the browser that the repository pins, driven by `playwright-core` 1.65.1 with the server's browser settings, on Windows 11 only. The pages were synthetic, plus a new Angular 22.2 app with Angular Material in development and production builds, three runs each. Nothing ran on Ubuntu. What was read or inferred is marked as such.

- **2.4.7, read.** 2.4.7 asks for a mode of operation in which the focus indicator is visible, with no size or contrast; those are in 2.4.13, at level AAA ([Understanding 2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)). The glossary defines the indicator as the pixels that change to show that a component has focus. The W3C's ACT rule [`oj04fd`](https://www.w3.org/WAI/standards-guidelines/act/rules/oj04fd/) (a test procedure that the W3C publishes) passes when any pixel of the viewport changes, 1 second after the last interaction, and says that a barely visible change elsewhere passes it too.
- **2.4.7, observed: pixels.** A pixel comparison of the element's rectangle plus 12 px, against the frame of the freshly loaded page, after the page's running animations end (with a cap of 1 s), gave no false result among the cases with a clear verdict, in 18 static cases and on a Material page of 14 stops. Captures were taken with `Page.captureScreenshot` of the DevTools Protocol.
  - A margin of 24 px was right in every case too. A margin of 4 px lost an outline drawn away from the element (`outline-offset`).
  - Waiting 1 s, freezing animations with Playwright or injecting CSS also gave no false result. Without any wait, a transition of 200 ms failed once in three runs; freezing animations through the DevTools Protocol failed every time.
  - Against the frames of the previous and next stops, an indicator that two elements share through `:focus-within` was lost.
  - The whole viewport, as in the ACT rule, gave the same verdicts until the page scrolled: a scroll changed about 44,600 pixels, which would pass an element without an indicator.
  - In an empty field with no outline, only the text cursor changed, 16 pixels, visible or not depending on its blink. Playwright's screenshot hides the cursor by default (read in the types of `playwright-core` 1.65.1).
  - The wait for animations took 20 ms per stop (median) on the static page and 103 ms on the Material page; a fixed wait of 1 s takes 1 s per stop.
- **2.4.7, observed: computed styles.** Read on the element and its ancestors, they miss most of Material's indicators, which live in siblings or descendants; the elements around it catch them. No style shows the text that Chromium selects when Tab enters a field with a value, or the text cursor. On Material's checkbox, they gave as evidence an outline that does not show.
- **2.4.11, read.** It fails only when author content hides the focused component entirely ([Understanding 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)). Content that the user opened does not fail if the user can reveal the component without moving focus; movable content counts at its initial position; a semi-transparent layer does not hide entirely. The failure technique [F110](https://www.w3.org/WAI/WCAG22/Techniques/failures/F110) walks forward and backward: a fixed footer hides when tabbing forward, a fixed header when tabbing back.
- **2.4.11, observed.**
  - As F110 says, a fixed footer hid elements tabbing forward and a fixed header tabbing back. Chromium does not scroll an element that is already in the viewport out from under a fixed layer.
  - A grid of 5 by 5 points over the visible part of the element, read with `elementsFromPoint` (the elements at a point of the screen, top first) and skipping layers that paint nothing, was right in eight cases of covering layers but one: an opaque layer with `pointer-events: none`, which the points pass through.
  - The rectangles of the positioned layers that paint were right in those eight, but missed the overlays of the Angular CDK (the library under Material, which hangs menus, dialogs and notices from `<body>`), in 11 cases: the CDK positions containers that paint nothing.
  - Inferred from both tables, not run as one rule: calling an element hidden when either method says so is right in every case tested.
  - Each method took under 1 ms per stop.
- **The walk, observed.**
  - After the last element, Tab leaves focus on `body`, and the next Tab returns to the first element.
  - The walk enters open shadow DOM and same-origin frames, and stops at the host of a closed shadow DOM.
  - Escape closed dialogs of the CDK and native dialogs, a Material select and menu, cleared a search field and ran the page's listeners.
  - A trap that returns focus through a timer showed only with a pause of 30 ms per key. After Escape turned it off, the CDK's focus trap kept focus for eight more keys.
  - With a cap of twice the number of tabbable elements (those that Tab reaches) plus 6, no walk without a trap reached the cap.
- **The walk, read.** Escape is the usual standard way out, and restricting focus to a modal dialog does not fail 2.1.2 ([Understanding 2.1.2](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html)). Enter and Space activate controls.
- **The heuristics, observed.**
  - **2.1.2:** "a cycle of stops that repeats without passing through `body` within the cap" separated every trap tested from the rest. A native modal dialog passes through `body`.
  - **2.4.3:** on two columns, inversions against the reading order gave a false positive on 3 of 15 pairs; back jumps (the next stop above in the same column, or to the left in the same row) gave none.
  - **2.1.1:** from the isolated world, `DOMDebugger.getEventListeners` (the DevTools Protocol method that lists a node's listeners) sees the page's listeners only with its `pierce` option. With it, 5 of 6 seeded elements were found. The one missed was an `<a>` without `href`, whose `tabIndex` property is 0 although Tab does not reach it. Material's switch label, its unselected tabs and its tab pagination arrows were false positives.
- **The output, observed.** `axe.utils.getSelector` works in the isolated world between `axe.setup` and `axe.teardown`, and gave the selector of `axe.run` for 15 of 15 elements, taken before focus. Taken while a Material button has focus, it gave `.cdk-focused`, a class that the CDK removes when focus leaves. A keyboard finding written by hand with values of the trial takes 445 to 581 bytes of JSON.
- **Images.** A PNG of the element plus 12 px takes 766 to 1,721 bytes (observed). An image is content that the page paints: it can carry text with instructions outside every cap of [ADR 0006](0006-untrusted-page-text.md), with no way to mark it.
- **Activation.** Tab alone does not reach the items of a closed menu or the unselected tabs (observed). Checking where focus goes when a menu or dialog opens, as the failure technique [F85](https://www.w3.org/WAI/WCAG22/Techniques/failures/F85) does, needs activation (read). The keyboard audit of `mcp-accessibility-scanner` activates nothing (read).

## Options considered

- **2.4.7:**
  - pixels in a crop against the frame at load, after the animations: the glossary's definition, one capture per stop, no false result in the trial;
  - computed styles alone: no capture and the name of the property, but blind to the selected text and the cursor, wrong during a transition, and able to give as evidence what does not show;
  - both, the pixels deciding and the styles explaining: one capture and one read of styles per stop;
  - the whole viewport after 1 s, as the ACT rule: the W3C's own procedure, wrong when the page scrolls or something changes elsewhere, and 1 s per stop.
- **2.4.7 after an Escape:** the frame at load, which a page changed by Escape, such as a closed dialog, makes useless; the frame once focus has left, with its limits.
- **2.4.11:**
  - the filtered grid of points: sees the CDK's overlays, misses a layer with `pointer-events: none`;
  - the rectangles of painting layers: sees that layer, misses the CDK's overlays;
  - either of the two: right in every case tested (inferred), with the possible false positives of both, under 1 ms per stop.
- **2.4.11 for an element that draws nothing:** both methods for every element, which gives findings through Material's own focus layer; the layers inside its parent left out of the rectangles.
- **Data on 2.4.12 and 2.4.13:** none outside findings; a field for elements that pass, which would change the contract of [ADR 0004](0004-server-architecture.md).
- **Keys:**
  - Tab and Shift+Tab only: runs no code of the app, but reads a modal dialog that closes with Escape as a trap;
  - those and one Escape inside a cycle that does not pass through `body`: tells the two apart, at the cost of Escape closing what is open in the cycle and running the page's listeners;
  - Escape at every stop: closes and clears things across the page, so each result depends on what it did.
- **Pace:**
  - no pause: 1 ms per stop, but blind to traps that act through a timer;
  - a pause of at least 30 ms, plus the wait for animations of 2.4.7: sees them, at an inferred 3 to 7 s for a page of 40 stops.
- **Where the checks go:**
  - a tool of their own: each with its cap and time, but the agent has to call both to cover the twelve criteria, another variable of the study;
  - inside `audit_route`: one call and the filter that exists, but a longer visit and a shared cap.
- **Evidence:**
  - structured numbers only: in line with ADR 0006 and a cap in characters, but the agent does not see the indicator;
  - a capture of the element with each finding of 2.4.7 and 2.4.11: the agent sees it, but it reopens ADR 0006 through a path that cannot be marked, and counts against the token limit at a cost not measured;
  - captures on request: the same, when asked, and another variable of the study.
- **Activation:**
  - none: tools that stay read-only, blind to what opens on a click;
  - activating the controls that open a menu or a dialog: reaches them and allows F85, but the tools are no longer read-only, and an activation can run any logic of the app.

## Decision

### The walk

- **Keys.** Tab through the page, then Shift+Tab, from the freshly loaded page. Inside a cycle that does not pass through `body`, one Escape, followed by another try to leave with Tab, with the same pause and cap. No other key.
- **No activation.** No check presses Enter or Space, clicks or types. The tools stay read-only.
- **Pace.** At least 30 ms after each key, and then the wait for animations of 2.4.7.
- **End.** A direction ends when the walk returns to its first stop, or at the cap: twice the number of tabbable elements plus 6. `body` marks a pass through the browser's interface, not the end: a script may have set the starting point halfway down the page.

### 2.4.7 Focus Visible: automatic

- **Definition.** An element reached with Tab shows focus if, with `:focus-visible` set by the key and its animations ended (cap 1 s), at least one pixel of the crop, the element's rectangle plus 12 px, differs by more than 10 in any RGB channel from the frame without focus.
- **The frame without focus** is that of the freshly loaded page, before the first key, with nothing focused. For an element that was outside the viewport or had focus at load, it is the frame taken when focus leaves it: tried on two elements below the fold, not on one focused at load, and it loses an indicator shared through `:focus-within`.
- **After an Escape,** every element reached is compared with the frame taken once focus has left it, because Escape can change the page. With a dialog and its backdrop open at load, the frame at load shows the backdrop over each button behind it, so a button with no indicator differs from it once it has focus, and passes. On such a test page, four buttons with no indicator gave four findings this way, and none against the frame at load (observed on 2026-11-25). Those elements take the limits of that frame: an indicator shared through `:focus-within` is lost, and an element that the page focuses again cannot be compared.
- **The text cursor is hidden** in every capture, so that a verdict does not depend on its blink. Not tested together with the wait for animations.
- **The computed styles that changed** are reported by property name only, to explain; they decide nothing.
- **A finding** is an element with no changed pixel. No threshold of area or contrast fails anything, and no data on 2.4.13 goes out: the output holds findings only ([ADR 0004](0004-server-architecture.md)), an element whose indicator changed some pixels gives no finding, and a field for it would change that contract.
- **Manual:** an indicator drawn beyond the 12 px margin; whether a small change, such as the selected text of a field, is visible enough to count; and an empty field whose only indicator is the text cursor, which the check hides.
- **Why.** No false result among the cases with a clear verdict, as with a wait of 1 s, frozen animations or injected CSS; of those, it alone neither changes the page nor costs 1 s per stop. The styles give the agent the property to fix. 12 px rather than 24 px, which was right too, because it takes fewer neighbors into the crop. Semi-automatic was the cautious class, with synthetic pages only and no Linux; the author chose automatic.

### 2.4.11 Focus Not Obscured (Minimum): semi-automatic

- **Definition.** A focused element is entirely hidden if no point of a grid of 5 by 5 over its visible part falls on it, skipping layers that paint nothing, or if the rectangle of a positioned layer that paints covers it.
- **An element that draws nothing,** with no background, border, shadow, image, control, text or generated content that shows, itself or inside it, as Material's native inputs with an opacity of 0: the layers inside its parent do not count for the rectangles. Material draws its checkbox beside such an input, and shows its focus with a layer in the same parent, over the input, with `pointer-events: none`. In the trial's app, each of its three checkboxes gave a finding through that layer, and with this rule none does (observed on 2026-11-25). It misses a layer in that parent that does hide such an element and that the points pass through, such as a sticky header with `pointer-events: none` beside bare inputs with an opacity of 0.
- **Both directions,** forward and backward, as F110 asks.
- **A finding** is an element entirely hidden, with the directions, the points that fell on it and the covering layer (its selector and rectangle). No data on 2.4.12, at level AAA, goes out: the output holds findings only, and an element that is partly hidden passes 2.4.11 and gives no finding.
- **Manual:** whether the user opened what hides the element, and whether a covering layer is semi-transparent. A layer with an alpha between 0 and 1 counts as painting (inferred, not tested).

### The heuristics: semi-automatic

- **2.1.2:** a cycle of stops that repeats without passing through `body` within the cap, in either direction, that the Escape and the second try do not break. A cycle that Escape breaks is no finding: Escape is the standard way out.
- **2.4.3:** a back jump, from one stop to the next. Inversions against the reading order are reported as data, not as findings.
- **2.1.1:** an element with a listener of click or pointer events, read with `pierce`, that the walk did not reach, nor any ancestor or descendant of it. Two kinds are left out: a member of a composite widget (`role="tab"`, `menuitem`, `option` and similar) whose group has a member that the walk reached, and the `<label>` of a reached control. Inferred, not tested: the rule on ancestors and descendants catches the `<a>` without `href`, and the two exclusions remove two of the three kinds of false positive of Material; the tab pagination arrows remain. They are tested when the walk is built.

### The output

- **Inside `audit_route`,** with the fields of a finding of [ADR 0004](0004-server-architecture.md). The walk runs in a browser context of its own, after axe-core, so that what the keys change does not reach axe-core.
- **Five measurements,** one per check, under rules of the server's own, which the field `rule` accepts besides those of axe-core:
  - 2.4.7: the key, `:focus-visible`, the frame without focus (load or leave), the crop, the changed pixels, the threshold and the names of the changed properties;
  - 2.4.11: the directions, the points and the points on the element, the fraction in the viewport and the covering layer;
  - 2.1.2: the number of stops in the cycle and the keys tried;
  - 2.4.3: how far back the jump goes, in numbers;
  - 2.1.1: the kinds of listener, and whether the element, an ancestor or a descendant was reached.
- **The selector** is that of axe-core, taken once the element has lost focus, at the next stop, with a new `axe.setup` each time; the trial took it before focus and with focus, not at the next stop. An element that no longer exists then, such as a menu item that closes on blur, gets the selector taken while it had focus, without the known focus classes of the CDK and Material (`cdk-focused`, `cdk-keyboard-focused` and similar), listed in the code with a test.
- **The identifier** is that of ADR 0004, from the selector of the finding's location. An element hidden in both directions gives one finding that lists both.
- **Text from the page** follows ADR 0006: selectors under `fromPage`, and of a changed style its property's name only, never its value, which can be text of the page, as the `content` of a pseudo-element.
- **The cap** of 20,000 characters holds for the whole output, in the order of ADR 0004.
- **Why.** The agent sees one tool that covers the twelve criteria and does not have to guess that another call is missing; a call that asks only for criteria of axe-core does not walk and takes no longer. A close choice: a tool of its own was the plan and keeps the times apart.

### The evidence

Structured numbers only, with no image.

**Why.** An image can carry text outside every cap of ADR 0006 with no way to mark it, counts against the token limit at a cost not measured, and whether it reaches the model next to structured content was not checked.

### Activation

None. **The condition:** the server does not see a defect behind a click, such as a trap inside a dialog that a button opens. The keyboard defects of a study are placed where the walk reaches without activating anything, on the page at load or on a route of their own, or are declared outside what the server sees, as defects outside the twelve criteria are.

### Settled by the author when writing this record

- **Which criteria walk.** Asking for any of the five keyboard criteria starts the walk, 2.1.1 alone included. A call that asks for none of them does not walk.
- **Rule names** are not fixed here, but none is the id of a rule of axe-core, since the identifier sums up the rule with the selector.
- **No typing.** No check writes in a field.
- **Aligning the crop.** By the element's position in each frame, in page coordinates, as the trial did.
- **The styles that explain a verdict of 2.4.7** are those of the element, its ancestors, its `::before` and `::after`, and the elements whose rectangle comes within 24 px of its own. The properties read are those of the trial: outline, shadow, borders, background, color, underline, opacity, `transform`, `filter` and `visibility`. Only their names are reported.
- **2.1.2:** one finding per cycle, located at the first element of the cycle in document order. Its measurement is numbers; no list of elements of the page.
- **2.4.3:** forward only, with Tab. One finding per back jump, located at the element that the jump reaches.
- **`notChecked` stays.** It lists the criteria asked for that the call could not check, such as when the walk failed or reached the cap.
- **A walk that fails** leaves the findings of axe-core in the output and puts the keyboard criteria in `notChecked`; the call does not fail.
- **Stops inside a same-origin frame** count for the walk and its cycles, but give no finding, as frames are not audited.

## Consequences

- 2.4.7 becomes automatic and 2.4.11 semi-automatic; 2.1.1, 2.1.2 and 2.4.3 stay semi-automatic.
- Every fact above comes from Windows. On Ubuntu, the drawing of the default focus ring, the smoothing of text, the blink of the cursor, the width of scrollbars and the time of a capture can change counts or verdicts. Each comparison is within one run, focus against no focus, but this was not checked.
- Every page tested was synthetic or a new app. Anything that changes inside the crop after load, such as the exit transition of a neighbor, an animation or a carousel, passes an element with no indicator. An indicator drawn far from its element fails a visible one, and so does the text cursor of an empty field when it is its only indicator, since the check hides it.
- Calling an element hidden when either method says so adds the false positives of both, none of which the trial showed, such as a semi-transparent layer or an overlay that closes on blur. For an element that draws nothing, a layer in its parent that hides it and that the points pass through is missed.
- No data on 2.4.12 or 2.4.13 reaches the agent: an indicator that changes a few pixels, or a focused element partly hidden, looks the same as one that passes well.
- The exclusions of 2.1.1 were written for Material and may not fit other libraries.
- Escape, inside a trap, runs the page's listeners and can close what is open there, in the browser of that call. It never clicks.
- An audit that asks for a keyboard criterion takes seconds longer. Inferred for a page of 40 stops: 3 to 7 s forward with captures, and a little over 1 s back. A page with no focus styles can fill the cap with findings of 2.4.7; the cut and the filter by criterion of ADR 0004 cover it, at the cost of another call.
- The agent sees numbers and the names of the properties that changed, not the indicator. Images remain a variation of the output for a later study, after measuring what the model receives and what it costs.
- The server does not see the keyboard defects of menus and dialogs that open on a click, and neither does the keyboard audit of `mcp-accessibility-scanner`. That server also brings about 40 browser tools with which an agent could open a dialog and audit it (not checked), so on such defects a comparison of the two servers may not be even. The condition on the study's defects exists for that.

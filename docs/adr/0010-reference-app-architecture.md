# 0010. Reference app architecture

- **Status:** Accepted
- **Decided:** 2026-11-26

## Context

The study needs an app to break and to fix: the reference Angular app, a small accessible shop. Each task of a study seeds one defect into a copy of it, as a patch, and the agent under test fixes that copy. This record fixes what the app is and how it is built, before its first file.

Four records already bind it:

- **[ADR 0003](0003-monorepo-layout.md):** the app lives in `fixtures/shop` and imports nothing outside its folder, and the agent receives a copy of that folder as its working folder. How the copy gets its dependencies is decided with the harness.
- **[ADR 0004](0004-server-architecture.md) and [the component of a finding](../architecture.md#the-component-of-a-finding):** a finding names the Angular component that declares the element from the attribute that Angular adds for component styles. A component without styles of its own, or a library's, gets only a guess.
- **[ADR 0007](0007-keyboard-checks.md):** the audit never clicks or types, so it sees a state of the app only when the page shows it at load.
- **[ADR 0005](0005-url-policy.md) and [ADR 0009](0009-local-port-writes.md):** the audit's browser blocks service workers, scripts that a page installs to answer its requests, and refuses writes to a port other than the page's own.

The facts below come from a trial on 2026-11-26 and from the published packages, their code and their documentation, read the same day. The trial built a throwaway shop with Angular 22.3.0, without zone.js (zoneless), with a catalog, a product page, a dialog and a payment form, and audited it with this repository's server, `wcag-evidence-mcp` 0.1.0. It ran on Windows only. **The trial's app is not the app that this record decides:** it loaded Angular Material's theme and four variants of each building block, one per library. Each fact says whether it was observed, read or inferred.

- **Routes.** With every page loaded at start, the first bundle weighed 727 kB; with each page in a lazy chunk, a file that the browser downloads only when it enters the page's route, 308 kB. Lighthouse's largest contentful paint (LCP, the time until the largest element of the screen is drawn) on its mobile profile fell from about 4.8 s to about 2.5 s with Chrome Headless Shell, the windowless build of Chromium that the server drives and the repository pins, and to about 2.9 s with Chrome for Testing, the full Chrome that Google publishes for tests (observed).
- **Building blocks.** Angular Aria 22.3, a set of unstyled directives that sets roles, ARIA attributes and keyboard behavior, has no dialog; the Component Dev Kit (CDK), Angular's library of unstyled behaviors on which Material is built, has no tabs; HTML has neither tabs nor a menu; Angular Material has all four (read). Aria is stable since Angular 22.0 (read).
- **What the server saw of each library** (observed), on one page per library with few elements: a choice of size (Aria's listbox, the CDK's listbox, Material's select and a native `<select>`), tabs (Aria's and Material's) and a dialog (the CDK's, Material's and a native `<dialog>`):
  - no keyboard finding on any of them;
  - the component in every seeded finding, also in the CDK's dialog, drawn outside its component, and in Material's;
  - three false findings of 2.1.1 with a native `<dialog>` open at load, since what lies behind it is inert, which the browser makes unreachable, and the walk does not reach it;
  - with Material's dialog open, axe-core did not see the defect seeded behind it; the CDK's dialog hides the rest the same way (observed in an earlier trial, on 2026-11-14).
- **The time of an audit** (observed): 2.1 to 7.9 s per call. A page with Material took 4.1 to 5.7 s, against 2.1 to 3.1 s for the others; 7.9 s was the call whose page read an API on another port.
- **Forms.** Neither Signal Forms nor Reactive Forms sets `aria-invalid` or ties an error message to its field (read in their code; observed: no `aria-describedby`). Material's form field ties it, also with Signal Forms (observed), and leaves `aria-invalid` off an empty required field (observed and read). With the errors shown, axe-core and the server gave no finding on any of the four versions (observed): 3.3.1 and 3.3.2 are not among the twelve criteria, and no rule of axe-core asks for either attribute. Signal Forms is stable since Angular 22.0, and offers `errorSummary()` and `focusBoundControl()` to find and focus a field in error (read).
- **Mock API** (observed):
  - an interceptor, an Angular function that sees each request of `HttpClient` and can answer it without the network, answering at once: the audit saw the data;
  - the same with a timer of 1.5 s: the audit saw the loading state, since a wait without a request is no activity to the server;
  - a GET to another local port delayed 1.5 s by the network: the audit saw the data, about 3 s later, since the page opens twice per audit when keyboard criteria are asked, which is the default;
  - a write at load: a POST to another port was refused (ADR 0009), and one to the page's own port arrived twice per audit, for the same reason.

  Mock Service Worker (MSW) answers through a service worker (read), so it would give no data during an audit (inferred).

- **Lighthouse** (observed, three runs per browser on the catalog):
  - with the same browser, the runs varied by at most 0.01 in performance and 150 ms in LCP, and each took about 11 s;
  - mobile, with lazy chunks: LCP of 2,471 to 2,475 ms and performance 0.98 with Chrome Headless Shell; 2,867 to 2,911 ms and 0.93 to 0.94 with Chrome for Testing of the same build;
  - desktop, with every page loaded at start: LCP of 0.9 s and performance 0.98 to 0.99 with both; lazy chunks were not measured on desktop;
  - cumulative layout shift (CLS, how much the content moves while it loads) was 0 in every run;
  - its launcher used the Chrome installed on the machine, without an error, when the path given for the browser did not exist.

  Lighthouse 13.6.0 runs axe-core 4.14.0, the server's version, and its accessibility score is a weighted mean of axe-core's rules, so a score of 100 says nothing of the keyboard (read; the last, inferred). Its budget files were removed in Lighthouse 12 (read). The budgets chosen, LCP of 2.5 s and CLS of 0.1, are field thresholds, for the 75th percentile of real visits; Lighthouse measures in a lab (read).

- **Skip link** (observed): moved off screen (`left: -9999px`, the usual pattern), it put 2.4.7 in `notChecked` on every page; clipped to 1 px inside the viewport with `clip-path`, the CSS property that shows only part of an element, always visible, or absent, it left 2.4.7 checked.
- **Tools.** Angular CLI 22.3.0 is usable from 2026-11-26 under the repository's minimum age of 7 days (inferred). Angular 22.3 asks for TypeScript 6.0, and its builder accepts the root's Vitest 5.1; `angular-eslint` 22.8.0 accepts the root's ESLint 10 and brings 11 rules of template accessibility (read). New apps are zoneless and use `OnPush` change detection by default (read).
- **Builds** (all observed). Two production builds gave the same files. A one-line fix made a 13-line patch of the source, but renamed the build's main bundle. Sass compiled, where it had hung in an earlier trial. The app built with install scripts blocked, as the repository's `.npmrc` blocks them.

## Options considered

1. **Domain and routes:**
   - a shop, with each page in a lazy chunk: four or five routes that can hold defects of all twelve criteria, with mobile LCP just under 2.5 s, and more to build and audit than a smaller app;
   - a smaller app of two routes: less to build and audit, fewer places to seed defects, and less like a real app;
   - another domain, such as bookings: no measured advantage.
2. **Building blocks:**
   - Material everywhere: the fastest to build and polished, but its library sets most of the markup, a defect is only a misuse of its API, and audits are slower;
   - native HTML, Angular Aria and the CDK's dialog: the markup is in the app, at the cost of more CSS to write;
   - Aria and native HTML only, with a native `<dialog>`: an open dialog gives false findings of 2.1.1;
   - a mix by building block: more libraries, which makes a defect harder to attribute.
3. **Forms:**
   - Signal Forms, with the error and its attributes written by a field component of the app: the stable API, and a component to write and test;
   - Reactive Forms with the same wiring: the older API, which sets no native `required`;
   - Material's form fields: the error tied without code, but against the choice of building blocks.
4. **Mock API:**
   - an interceptor with static JSON that answers at once: deterministic, with no process and no network;
   - JSON in the public folder, read with a GET: deterministic, a real request to the app's port, and its error states need another mechanism;
   - an API server on another port: closer to a real app, one more process per run, writes at load refused, and the network waited for twice per audit;
   - MSW: no data during an audit.
5. **Lighthouse:**
   - its profile: mobile, the most demanding but within 30 ms of the limit; desktop, with a wide margin but less of what a phone user sees; or desktop to block and mobile reported only;
   - where: its command line in a job of the Ubuntu CI, read by a script of the repository; Lighthouse CI (`@lhci/cli`), whose budget option may not work with Lighthouse 13 (read, not checked); or Ubuntu and Windows, at twice the cost and with budgets that depend on the machine.
6. **Where the app lives:**
   - a workspace in the root's lockfile, as ADR 0003 says: one age check and one check of install scripts for the whole repository;
   - a project of its own, with its own lockfile, which the agent's copy would carry: it leaves the workspaces, and the lockfile checks grow;
   - a repository of its own, which breaks "one commit describes a whole study" (ADR 0003).
7. **States that only an action shows:**
   - every state to audit gets a URL: what the audit and the tests see is what the agent can ask for, at the cost of a route or a parameter for each state;
   - only the states at load are audited: simpler, and the dialog, loading and error states leave the catalog of defects.
8. **The skip link:**
   - clipped inside the viewport with `clip-path`, shown when it has focus: 2.4.7 checked on every page;
   - always visible: the simplest, and it takes room in the header;
   - moved off screen, the usual pattern, with a change to the server and an ADR of its own.

## Decision

### 1. A shop, with one lazy chunk per route

Routes `/catalog`, with its filters in the URL, `/product/:id`, `/cart` and `/checkout`, each loaded with `loadComponent`. The cart's dialog has a URL of its own (decision 7).

**Why.** It holds defects of every kind that the twelve criteria cover, and the lazy chunks kept the mobile LCP of the trial under 2.5 s with the pinned browser.

### 2. Native HTML, Angular Aria and the CDK's dialog, without Material

- **Native HTML** for fields, buttons, links, `<details>` and `<select>`.
- **Angular Aria** for the listbox, the tabs and the menu.
- **The CDK's dialog** (`@angular/cdk/dialog`), which focuses the first element that Tab reaches and gives focus back when it closes (read), and gave no false finding in the trial.
- **No component of Material.** The theme is the app's own CSS.
- **Every component has styles of its own,** however few, so that a finding names it, and an element selector. A component with an attribute selector has a host such as `button`, which names no component. None uses `ShadowDom` encapsulation either: findings named their component with it in a review on 2026-11-21, but the app does not need it, and Angular's default keeps one way of naming across the app.

**Why.** The markup and the ARIA attributes are in the app's templates, so a seeded defect is an edit of the app, which is what the agent has to fix, and a finding names a component of the app (inferred). Audits are faster than with Material (observed).

**A close choice.** Material builds a polished app in less time, and ties form errors to their fields without code.

### 3. Signal Forms, with a field component of the app

- **A field component** holds the label, the control and the error text, with its own `id`, and sets `aria-describedby` and, when the field is touched and invalid, `aria-invalid`.
- **On submit,** the form uses `errorSummary()` for a summary of the errors and `focusBoundControl()` to move focus.

**Why.** Signal Forms is the stable, current API; neither form system writes the error's attributes, so the app writes them once, in one component.

**Condition for the catalog of defects.** A defect in the error of a field, such as an error not tied to its field or a missing `aria-invalid`, does not enter the study's catalog: neither axe-core nor the server sees it (observed), as with a defect outside the twelve criteria. The app's own tests cover it.

### 4. A mock API in an interceptor

- **Static JSON,** answered at once, with no timer, so that an audit always sees the data.
- **The loading and error states** come from a parameter of the URL that only the interceptor reads, such as `?mock=error`, so that an audit or a test reaches them (decision 7).
- **No write at load,** since each audit would send it twice.

**Why.** It is deterministic, needs no process and makes no request, so ADR 0009 does not apply to it (inferred).

### 5. Lighthouse budgets on desktop, in the Ubuntu CI

- **Where:** Lighthouse 13.6.0 on the production build, in a job of the Ubuntu CI, read by a script of the repository.
- **The browser:** the Chrome Headless Shell that `playwright-core` pins, given in `CHROME_PATH`. The script fails when that file does not exist, so that the launcher cannot use another browser.
- **Runs:** three, and their median.
- **They block, on the desktop profile:** accessibility 100, performance 90 or more, LCP under 2.5 s and CLS under 0.1, measured on the app without defects.
- **The mobile profile** runs and is published, without blocking.

**Why.** A script of the repository checks the browser, since the launcher falls back to another one without a word, and checks the budgets, since Lighthouse no longer reads budget files. The desktop profile had a wide margin: an LCP of 0.9 s against 2.5 s.

**A close choice, in the profile.** The mobile profile measures what a phone user sees, but its LCP was 30 ms under the limit with the pinned browser and about 380 ms over it with Chrome for Testing: a CI on another machine could fail with no change to the app. To block on mobile, the app would need more margin, such as lighter images, which was not measured.

### 6. `fixtures/shop`, a workspace of the root

- **The folder and the lockfile:** `fixtures/shop`, a workspace in the root's `package-lock.json`, as ADR 0003 sets.
- **Build:** Angular CLI 22.3.0 with the `application` builder and strict templates; zoneless and `OnPush`, its defaults.
- **Styles:** CSS, without Sass: the building blocks do not need it, and Sass hung in an earlier trial.
- **Unit tests:** Vitest, through `@angular/build:unit-test`, at the root's version.
- **Lint:** `angular-eslint` 22.8.0 with its `templateAccessibility` configuration, `no-positive-tabindex` and `button-has-type`.
- **TypeScript** 6.0.3, the root's.
- **Patches of defects** are written on the source, with LF line endings, never on the build output.
- **How the agent's copy gets its dependencies** is left to a later ADR, with the harness: a lockfile of its own, made and checked by CI, or the root's install.

**Why.** It is what ADR 0003 already says, and one age check and one check of install scripts cover the whole repository.

### 7. Every state to audit has a URL

The cart's dialog opens on a route of its own, `/cart/added`, and the loading and error states with `?mock=`.

**Why.** The audit saw a dialog, a loading state or an error state only when the page showed it at load (observed). A dialog on its own route is also a real pattern: its link can be shared, and the browser's Back and Forward buttons close it (read).

### 8. A skip link clipped inside the viewport

The skip link is clipped with `clip-path` inside the viewport and shown when it has focus, not moved off screen.

**Why.** Off screen, it left 2.4.7 partly unchecked on every page (observed).

### Settled by the author when writing this record

- **How the dialog route closes.** Its close button and Escape navigate to `/cart`, not back in the browser's history, since an audit opens `/cart/added` with no history. An in-app link away closes the dialog too, because the route's component closes it when Angular destroys the component.
- **`?mock=`:**
  - the interceptor reads it from the page's URL at load (`DOCUMENT.location`), and no component sees it;
  - the loading state is an answer that never comes (`NEVER`), not a timer, so that it does not turn into the data during the second load of the page for the walk;
  - the code of the catalog's filters keeps `mock` in the query string.
- **Component styles:**
  - the app's component schematic sets `displayBlock: true` by default, so that no component's styles are empty: Angular 22.3 compiles an emulated component with empty styles with no encapsulation, and its elements get no `_ngcontent` attribute (read);
  - a check of the gate fails on an empty component stylesheet;
  - every routed component and every dialog has an element selector starting with `app-`.
- **The Lighthouse script** finds the pinned Chrome Headless Shell through the `browsers.json` of `playwright-core` and Playwright's cache folder, because `chromium.executablePath()` points at the full Chromium, which is not installed (observed on 2026-11-26).
  - It runs on the production build, served with a fallback to `index.html`, on every route.
  - Lighthouse is a dependency of the root's `package.json`, so that the agent's copy does not carry it.
  - Its Ubuntu job needs the step of ADR 0008 that allows the user namespaces of Chromium's sandbox.
- **Left to the changes that do them:** the rule set of `angular-eslint` and how the root's gate reaches the app's lint, tests and build, when the app is created; a check that a defect's patch has LF line endings and applies cleanly, when the defects arrive; and how the study serves the app, with the harness.

## Consequences

- **Seeding defects,** when the catalog of defects is fixed:
  - each defect is an edit of an app template or component, and its finding names a component of the app;
  - a defect of a page goes in its URL without the dialog, since an open dialog hides the rest of the page from axe-core;
  - on `/cart/added`, the walk presses Escape once in the dialog's cycle of focus and goes on through the page (ADR 0007), so the dialog hides the cart from axe-core but not from the keyboard checks, and a keyboard defect seeded in `/cart` also shows under `/cart/added` (inferred);
  - a patch that edits a template can change the key of the attribute that Angular adds for component styles, and so the selectors and identifiers of that component's findings, though not the component's tag (inferred);
  - with four or five routes, the catalog repeats pages;
  - defects in the error of a field stay out of the catalog (decision 3).
- **The agent's copy,** when the harness is decided: if it needs a lockfile of its own, the option of a project of its own comes back, and the lockfile age check changes.
- **Install scripts.** In the trial app's lockfile, `@parcel/watcher` 2.6.0, `esbuild` 0.28.2, `lmdb` 3.5.9 and `msgpackr-extract` 3.0.7 declare install scripts, besides `fsevents` (observed). The author approved the four for the allowlist of install scripts on 2026-11-26; they join it with the app, when `fixtures/shop` joins the root's lockfile and `npm run check:repo` would otherwise fail. The allowlist only lets them be locked: their scripts still do not run, and the trial app built without them.
- **The Lighthouse budgets** were measured on Windows only; the first run of the Ubuntu CI sets the baseline.
- **The field component** must work with every control of the form, a `<select>` and a checkbox included; its tests check it.
- **Not tested:**
  - the menu, combobox and select of Aria (the trial used its listbox), and Aria's directives as controls of a Signal Forms field (`[formField]`);
  - the accessibility rules of `angular-eslint`, never run;
  - a form with invalid values rather than empty ones;
  - an audit of the development server (`ng serve`).

  Each is checked before the app relies on it.

- **The app's own code** grows: the CSS of every building block, and the `?mock=` parameter, which a real app would not have, kept inside the interceptor where no component sees it.
- **An agent that moves the skip link off screen** leaves 2.4.7 unchecked on that page, and the output says so in `notChecked`.
- **Times and Lighthouse figures** can change on Ubuntu and on this app: the trial ran on Windows, on another app. Every observed fact comes from Windows.
- **Follow-ups for the server,** which the trial showed and this record does not decide:
  - 2.4.7 goes unchecked with a skip link moved off screen;
  - false findings of 2.1.1 behind an open native `<dialog>`;
  - two findings, of 2.4.7 and of 2.4.11, on an element entirely covered by another element;
  - a write at load sent twice per audit.

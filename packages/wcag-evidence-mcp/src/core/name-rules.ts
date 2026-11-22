// Which rules carry the element's accessible name in their findings (ADR 0006): only those whose
// defect is the name or the text alternative itself, where the name is the evidence. The name is
// text that the page wrote, so every other rule leaves it out. The lists are written by hand, not
// deduced from a rule's id: a test fails when a rule of the map of axe-core rules that checks one
// of the criteria about names is in neither list, so a new axe-core cannot add a rule that carries
// the name without a decision.

/** The criteria whose rules are sorted into the two lists below. */
export const NAME_CRITERIA: readonly string[] = ['1.1.1', '2.4.4', '4.1.2'];

/** The rules whose defect is the name or the text alternative, each with the reason. */
export const NAME_RULES: ReadonlyMap<string, string> = new Map([
  ['area-alt', 'an area of an image map without a text alternative'],
  ['aria-braille-equivalent', 'a braille label on an element without an accessible name'],
  ['aria-command-name', 'an ARIA button, link or menu item without a name'],
  ['aria-input-field-name', 'an ARIA input field without a name'],
  ['aria-meter-name', 'an ARIA meter without a name'],
  ['aria-progressbar-name', 'an ARIA progress bar without a name'],
  ['aria-tab-name', 'an ARIA tab without a name'],
  ['aria-toggle-field-name', 'an ARIA toggle field without a name'],
  ['aria-tooltip-name', 'an ARIA tooltip without a name'],
  ['button-name', 'a button without a name'],
  ['frame-title', 'a frame without a title, its name'],
  ['frame-title-unique', 'a frame whose title, its name, another frame has too'],
  ['image-alt', 'an image without a text alternative'],
  ['input-button-name', 'an input button without a name'],
  ['input-image-alt', 'an image button without a text alternative'],
  ['label', 'a form field without a label, its name'],
  ['link-name', 'a link without a name'],
  ['object-alt', 'an object without a text alternative'],
  ['role-img-alt', 'an element with the role img without a text alternative'],
  ['select-name', 'a select without a name'],
  ['summary-name', 'a summary without a name'],
  ['svg-img-alt', 'an SVG with the role img without a text alternative'],
]);

/** The other rules of the criteria about names: their defect is not the name. */
export const RULES_WITHOUT_NAME: ReadonlyMap<string, string> = new Map([
  ['aria-allowed-attr', 'an ARIA attribute that the role does not allow'],
  ['aria-conditional-attr', 'an ARIA attribute used other than as the role allows'],
  ['aria-deprecated-role', 'a deprecated role'],
  ['aria-hidden-body', 'aria-hidden on the body'],
  ['aria-hidden-focus', 'a hidden element that takes the focus'],
  ['aria-prohibited-attr', 'an ARIA attribute that the role prohibits, shown in the opening tag'],
  ['aria-required-attr', 'a required ARIA attribute that is missing'],
  ['aria-roledescription', 'a role description on an element without a role'],
  ['aria-roles', 'a role that does not exist'],
  ['aria-valid-attr', 'an ARIA attribute that does not exist'],
  ['aria-valid-attr-value', 'an ARIA attribute with a wrong value'],
  ['duplicate-id-aria', 'an id that ARIA refers to and that is not unique'],
  ['nested-interactive', 'an interactive element inside another'],
]);

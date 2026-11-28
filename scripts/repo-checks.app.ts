// The repository check that keeps each component of the Angular app nameable in a finding
// (ADR 0010): every component keeps Angular's default, emulated encapsulation and declares styles
// of its own, none of them empty. Angular builds a component whose styles are empty, or that sets
// another encapsulation, with no attribute on its elements that names it. repo-checks.ts runs it
// with the others.

import { posix } from 'node:path';
import ts from 'typescript';

interface Problem {
  file: string;
  line?: number;
  message: string;
}

// The app's source, without its tests.
const APP_SOURCE = /^fixtures\/shop\/src\/.+(?<!\.spec)\.ts$/;
const STYLE_KEYS = ['styleUrl', 'styleUrls', 'styles'];

/** Whether a stylesheet has no rule with something in it, once its comments are gone. */
function isEmptyCss(css: string): boolean {
  return !/\{[^{}]*[^{}\s][^{}]*\}/.test(css.replace(/\/\*[\s\S]*?\*\//g, ''));
}

/** The text of a string literal or of a template literal with no `${}`, or undefined. */
function literal(node: ts.Expression): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

const lineOf = (source: ts.SourceFile, node: ts.Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/**
 * The imports of `@angular/core` that would hide a component from this check: `Component` under
 * another name, or the whole package as a namespace, as in `@ng.Component(...)`.
 */
function hiddenImports(source: ts.SourceFile): { line: number; message: string }[] {
  const found: { line: number; message: string }[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@angular/core'
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      found.push({
        line: lineOf(source, statement),
        message: 'imports @angular/core as a namespace, which this check does not read',
      });
    }
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.propertyName?.text === 'Component' && element.name.text !== 'Component') {
          found.push({
            line: lineOf(source, element),
            message: 'imports Component under another name, which this check does not read',
          });
        }
      }
    }
  }
  return found;
}

/** The object of `@Component({...})`, for each component that the file declares. */
function componentMetadata(source: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isDecorator(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Component'
    ) {
      const [argument] = node.expression.arguments;
      if (argument !== undefined && ts.isObjectLiteralExpression(argument)) found.push(argument);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Checks each component of the app: it imports `Component` by that name, declares with
 * `styleUrl`, `styleUrls` or `styles`, as literals that this check can read, at least one
 * stylesheet, none of them empty, and sets no `encapsulation`, so that Angular's default,
 * emulated encapsulation applies.
 */
export function checkComponentStyles(texts: ReadonlyMap<string, string>): Problem[] {
  const problems: Problem[] = [];
  for (const [file, text] of texts) {
    if (!APP_SOURCE.test(file)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const { line, message } of hiddenImports(source)) problems.push({ file, line, message });
    for (const metadata of componentMetadata(source)) {
      const line = lineOf(source, metadata);
      const report = (message: string): void => {
        problems.push({ file, line, message });
      };
      const entries = metadata.properties.flatMap((property) =>
        ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)
          ? [{ key: property.name.text, initializer: property.initializer }]
          : [],
      );
      if (entries.some(({ key }) => key === 'encapsulation')) {
        report('sets encapsulation, which ADR 0010 leaves at the emulated default');
      }
      const styles = entries.filter(({ key }) => STYLE_KEYS.includes(key));
      if (styles.length === 0) report('declares a component with no styles of its own');
      for (const { key, initializer } of styles) {
        const values = ts.isArrayLiteralExpression(initializer)
          ? [...initializer.elements]
          : [initializer];
        if (values.length === 0) report(`gives ${key} an empty list`);
        for (const value of values) {
          const read = ts.isExpression(value) ? literal(value) : undefined;
          if (read === undefined) {
            report(`gives ${key} in a form that this check does not read`);
          } else if (key === 'styles') {
            if (isEmptyCss(read)) report('declares styles that are empty');
          } else {
            const path = posix.join(posix.dirname(file), read);
            const css = texts.get(path);
            if (css === undefined) report(`names ${read}, which is not a published file`);
            else if (isEmptyCss(css)) report(`names ${read}, which is empty`);
          }
        }
      }
    }
  }
  return problems;
}

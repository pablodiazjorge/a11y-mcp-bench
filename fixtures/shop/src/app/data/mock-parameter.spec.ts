// Only the interceptor reads the `mock` parameter of the page's URL (ADR 0010), and the app's
// configuration makes it read the parameter at start: a component that read it would be code that
// a real app does not have, and that an agent could edit.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// The app's tests run from its folder, through `ng test`.
const APP = join(process.cwd(), 'src', 'app');
// app.config.ts reads the mode when the app starts, before any page asks for data.
const ALLOWED = ['app.config.ts', 'data/mock-api.ts'];
// The parameter's name as code would read it, and the names that carry its value.
const READS = /['"`]mock['"`]|mock=|MOCK_MODE|readMockMode/;

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|html)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('the mock parameter', () => {
  it('is read by the interceptor alone, and by no component', () => {
    const files = sources(APP).map((path) => relative(APP, path).replaceAll('\\', '/'));
    expect(files).toContain('data/mock-api.ts');

    const readers = files.filter((file) => READS.test(readFileSync(join(APP, file), 'utf8')));

    expect(readers).toEqual(ALLOWED);
  });
});

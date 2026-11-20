import { readFileSync } from 'node:fs';
import type { ServerIdentity } from '../../core/identity.ts';

/**
 * Reads the name and version from the package's own `package.json`, so the server never reports
 * a version other than the one installed. The file sits three folders above this one, both in
 * `src` and in `dist`, which mirror each other.
 */
export function readPackageIdentity(
  packageJson: URL = new URL('../../../package.json', import.meta.url),
): ServerIdentity {
  const parsed: unknown = JSON.parse(readFileSync(packageJson, 'utf8'));
  if (typeof parsed === 'object' && parsed !== null && 'name' in parsed && 'version' in parsed) {
    const { name, version } = parsed;
    if (typeof name === 'string' && typeof version === 'string') return { name, version };
  }
  throw new Error(`${packageJson.href}: expected a string "name" and "version"`);
}

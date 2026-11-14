// What the tests of the lockfile age check share: small lockfiles that hold only the fields
// the check reads, so that each test shows only the entries it is about.

/** Wraps a `packages` map in a plain lockfileVersion 3 file, with any extra top-level fields. */
export function lockfile(
  packages: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { lockfileVersion: 3, packages, ...extra };
}

/** The registry address of the tarball of a version, as npm writes it in `resolved`. */
export function tarball(name: string, version: string): string {
  return `https://registry.npmjs.org/${name}/-/${name.split('/').pop() ?? name}-${version}.tgz`;
}

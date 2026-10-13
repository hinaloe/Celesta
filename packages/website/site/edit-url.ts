const githubEdit = /^(https:\/\/github\.com\/[^/]+\/[^/]+\/edit\/[^/]+\/)/;

/**
 * Makit 0.8 builds "Edit on GitHub" URLs relative to the site root (`…/edit/main/content/…`), but
 * the site lives in `packages/website`. Inserts that directory after the branch; other URLs pass through.
 */
export function withPackagePath(url: string | undefined, packagePath = 'packages/website'): string | undefined {
  return url?.replace(githubEdit, `$1${packagePath}/`);
}

// Browser assets are resolved by the embedding app, without Node's filesystem.
export function isRemoteUrl(src: string): boolean { return /^https?:\/\/./i.test(src); }
export function entryRelativePath(src: string): string { return src; }
export interface PrepareDependency { path: string; mtimeNs: string | null; size: number | null }
// Nothing watches files in the browser.
export function trackPrepareDependency(_src: string): void {}
export function prepareDependencies(): PrepareDependency[] { return []; }

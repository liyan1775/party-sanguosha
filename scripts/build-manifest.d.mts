export type BuildManifest = { buildId: string; sourceId: string };
export function sourceFingerprint(root: string): Promise<string>;
export function writeBuildManifest(
  root: string,
  sourceId: string,
  buildDir?: string,
): Promise<void>;
export function readBuildManifest(root: string, buildDir?: string): Promise<BuildManifest | null>;
export function verifyBuildManifest(root: string, buildDir?: string): Promise<BuildManifest | null>;
export function createBuildSnapshot(root: string, sourceDir?: string): Promise<string>;

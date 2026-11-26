interface PinnedAsset {
  path: string;
  bytes: number;
}

export function matchesResourceProof(
  projectRoot: string,
  engineRoot: string,
  manifestBytes: Buffer,
  entries: PinnedAsset[],
  token: string | undefined,
): boolean;

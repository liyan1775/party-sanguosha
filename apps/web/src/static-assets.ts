declare const __PARTY_STATIC_FINGERPRINTS__: Record<string, string> | undefined;

export function staticAsset(url: string): string {
  const fingerprint =
    typeof __PARTY_STATIC_FINGERPRINTS__ !== 'undefined' && __PARTY_STATIC_FINGERPRINTS__[url];
  return fingerprint ? `${url}?v=${fingerprint}` : url;
}

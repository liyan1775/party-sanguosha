export function isCurrentBuild(
  health: { version?: string; buildId?: string | null },
  version: string,
  manifest: { buildId: string; sourceId: string } | null,
  sourceId?: string,
): boolean;
export function processAlive(pid: number): boolean;
export function waitForProcessExit(
  pid: number,
  options?: {
    alive?: (pid: number) => boolean;
    sleep?: (ms: number) => Promise<void>;
    attempts?: number;
  },
): Promise<void>;
type UpgradeHealth = {
  conditionalShutdown?: boolean;
  shutdownPolicy?: number;
  stopping?: boolean;
};
type UpgradeSession = {
  serverUrl: string;
  pid: number;
  controlToken: string;
  health: UpgradeHealth;
};
type Refused = { status: 'busy' | 'manual'; message: string };
type UpgradeDecision = { status: 'accepted' } | Refused;
export function supportsSafeUpgrade(health: UpgradeHealth): boolean;
export function requestUpgradeShutdown(
  session: UpgradeSession,
  request?: typeof fetch,
): Promise<UpgradeDecision>;
export function prepareReplacement<T>(
  session: UpgradeSession | null,
  options: {
    stage: () => Promise<T>;
    request?: (session: UpgradeSession) => Promise<UpgradeDecision>;
    onAccepted?: () => void;
    wait?: (pid: number) => Promise<void>;
  },
): Promise<{ status: 'ready'; candidate: T } | Refused>;

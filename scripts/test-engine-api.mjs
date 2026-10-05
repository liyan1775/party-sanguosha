import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', 'tests/engine-service.test.ts'],
  {
    env: { ...process.env, PARTY_REQUIRE_ENGINE: '1' },
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;

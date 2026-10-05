import { fileURLToPath } from 'node:url';
import { ensureConnector } from '../apps/server/src/public-connector.ts';

await ensureConnector(fileURLToPath(new URL('../', import.meta.url)));
console.log('固定版本公网组件已校验。');

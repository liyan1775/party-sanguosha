// The public starter obtains the pinned upstream game directly on the user's
// PC. Its bundled tools prepare the engine without npm or a developer setup.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativeEngine } from './build-native-engine.mjs';
import { buildNativePortraits } from './build-native-portraits.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const portable = JSON.parse(await readFile(resolve(root, 'portable.json'), 'utf8'));
if (portable.resources !== 'download-pinned-upstream')
  throw new Error('This preparation step is for the public Windows starter.');
try {
  await import('./prepare-noname-lab.mjs');
} catch (error) {
  console.error(
    '首次资源准备尚未完成。请确认电脑能访问 GitHub 和 raw.githubusercontent.com，再双击同一启动文件重试。',
  );
  console.error('已校验的文件会保留；重试会继续补齐缺少的资源。无需安装 Node.js、Git 或运行命令。');
  throw error;
}
try {
  const manifest = await readFile(resolve(root, 'dist/engine/manifest.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const portraits = await readFile(resolve(root, 'dist/engine/portraits/manifest.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (manifest?.commit !== portable.commit || portraits?.commit !== portable.commit) {
    console.log('资源已备齐，正在准备本机规则引擎和手机武将图……');
    await buildNativeEngine(root);
    await buildNativePortraits(root);
  }
} catch (error) {
  console.error('本机规则引擎准备失败。请保留上面的错误信息，并重新完整解压启动包后重试。');
  throw error;
}

// The public starter obtains the pinned upstream game directly on the user's
// PC. Its bundled tools prepare the engine without npm or a developer setup.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativeEngine } from './build-native-engine.mjs';
import { buildNativePortraits } from './build-native-portraits.mjs';
import { verifyBuildManifest, writeBuildManifest } from './build-manifest.mjs';
import { makeResourceProof, proofFile } from '../packages/noname-adapter/src/resource-proof.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const portable = JSON.parse(await readFile(resolve(root, 'portable.json'), 'utf8'));
if (portable.resources !== 'download-pinned-upstream')
  throw new Error('This preparation step is for the public Windows starter.');
const buildDir = resolve(root, process.env.PARTY_BUILD_DIR ?? 'dist');
const within = relative(resolve(root, '.runtime/builds'), buildDir);
if (!within || within.startsWith('..') || isAbsolute(within))
  throw new Error('资源必须准备到独立的启动构建。');
const base = await verifyBuildManifest(root, buildDir);
if (!base) throw new Error('启动包内的网页或游戏脚本校验失败，请重新解压完整启动包。');
let startupProof;
try {
  ({ startupProof } = await import('./prepare-noname-lab.mjs'));
} catch (error) {
  console.error(
    '首次资源准备尚未完成。请确认电脑能访问 GitHub 及其资源下载域名，再双击同一启动文件重试。实际连接失败的地址见下方错误。',
  );
  console.error('已校验的文件会保留；重试会继续补齐缺少的资源。无需安装 Node.js、Git 或运行命令。');
  throw error;
}
try {
  const manifest = await readFile(resolve(buildDir, 'engine/manifest.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const bundle = await readFile(resolve(buildDir, 'engine/noname.js')).catch(() => null);
  if (
    !bundle ||
    manifest?.commit !== portable.commit ||
    manifest.bytes !== bundle.length ||
    manifest.hash !== createHash('sha256').update(bundle).digest('hex')
  ) {
    console.log('资源已备齐，正在准备本机规则引擎……');
    await buildNativeEngine(root, buildDir);
  }
  await buildNativePortraits(root, buildDir);
  await writeBuildManifest(root, base.sourceId, buildDir);
} catch (error) {
  console.error('本机规则引擎准备失败。请保留上面的错误信息，并重新完整解压启动包后重试。');
  throw error;
}
if (startupProof) {
  try {
    const receipt = resolve(root, proofFile);
    const { engineRoot, manifestBytes, stamps } = startupProof;
    await mkdir(dirname(receipt), { recursive: true });
    await writeFile(
      receipt,
      makeResourceProof(engineRoot, manifestBytes, stamps, process.env.PARTY_STARTUP_PROOF),
    );
  } catch {
    console.warn('本次不能共享准备校验，服务将逐文件重新校验。');
  }
}

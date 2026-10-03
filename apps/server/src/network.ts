import { networkInterfaces } from 'node:os';
import { createConnection } from 'node:net';

/** Windows 可允许回环/全网卡绑定交叠，电脑管理地址必须独占回环入口。 */
export async function isLoopbackPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (occupied: boolean) => {
      socket.destroy();
      resolve(occupied);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

export function findHomeUrls(port: number, publicUrl?: string): string[] {
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('PUBLIC_URL 需要是完整的 HTTP(S) 地址，例如 http://192.168.1.100:3000');
    if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname))
      throw new Error('PUBLIC_URL 不能使用回环地址或 0.0.0.0，手机无法通过它连接电脑。');
    return [url.href];
  }
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter(
        (entry) =>
          entry.family === 'IPv4' &&
          !entry.internal &&
          /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address),
      )
      .map((entry) => ({ name, address: entry.address })),
  );
  addresses.sort(
    (left, right) =>
      Number(/vpn|virtual|vmware|vethernet|wsl|docker|tun|tap/i.test(left.name)) -
        Number(/vpn|virtual|vmware|vethernet|wsl|docker|tun|tap/i.test(right.name)) ||
      left.name.localeCompare(right.name),
  );
  return [...new Set(addresses.map(({ address }) => `http://${address}:${port}/`))];
}

export function findJoinUrls(port: number, roomCode: string, publicUrl?: string): string[] {
  return findHomeUrls(port, publicUrl).map((base) => new URL(`/join/${roomCode}`, base).href);
}

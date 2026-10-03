import { networkInterfaces } from 'node:os';

export function findJoinUrls(port: number, roomCode: string, publicUrl?: string): string[] {
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
    return [new URL(`/join/${roomCode}`, url).href];
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
  return [...new Set(addresses.map(({ address }) => `http://${address}:${port}/join/${roomCode}`))];
}

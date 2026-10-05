export interface LanOffer {
  id: string;
  key: string;
  offer: RTCSessionDescriptionInit;
  answered: boolean;
}
export interface RelayRequest {
  id: number;
  method: string;
  path: string;
  body?: unknown;
}
export interface RelayResponse {
  id: number;
  status: number;
  body: unknown;
}

// Public STUN discovers an address only; game bytes remain peer-to-peer.
export const peerConfiguration: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
};

export function privatePeerAddress(address: string): boolean {
  return /^(?:[\w-]+\.local$|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|f[cd][\da-f]{2}:|fe80:)/i.test(
    address,
  );
}

export function filterPeerDescription(
  description: RTCSessionDescriptionInit,
): RTCSessionDescriptionInit {
  if (typeof description.sdp !== 'string') throw new Error('Invalid peer description');
  return {
    ...description,
    sdp: description.sdp
      .split('\r\n')
      .filter((line) => {
        if (!line.startsWith('a=candidate:')) return true;
        const fields = line.split(' '),
          address = fields[4] ?? '',
          port = Number(fields[5]);
        const ipv4 = address.split('.').map(Number);
        const validIp = /^\d+\.\d+\.\d+\.\d+$/.test(address)
          ? ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
            ipv4[0]! > 0 &&
            ipv4[0] !== 127 &&
            ipv4[0]! < 224 &&
            !(ipv4[0] === 169 && ipv4[1] === 254)
          : /^(?:[23][\da-f]{3}:|f[cd][\da-f]{2}:|fe80:)[\da-f:]+$/i.test(address) ||
            /^[\w-]+\.local$/i.test(address);
        return (
          fields[1] === '1' &&
          fields[2]?.toLowerCase() === 'udp' &&
          ['host', 'srflx'].includes(fields[7] ?? '') &&
          validIp &&
          port > 0 &&
          port <= 65535
        );
      })
      .join('\r\n'),
  };
}

/** Reliable, ordered chunks also accommodate large eight-seat native snapshots. */
export function wire(channel: RTCDataChannel, receive: (value: unknown) => void) {
  let parts: string[] = [];
  let bytes = 0;
  let total = 0;
  channel.onmessage = ({ data }) => {
    try {
      const part = JSON.parse(data);
      if (
        !Number.isSafeInteger(part.total) ||
        part.total < 1 ||
        part.total > 2048 ||
        part.index !== parts.length ||
        typeof part.text !== 'string' ||
        part.text.length > 12000 ||
        (parts.length && part.total !== total)
      )
        throw new Error('Invalid local frame');
      total = part.total;
      bytes += part.text.length;
      if (bytes > 16 * 1024 * 1024) throw new Error('Local frame too large');
      parts.push(part.text);
      if (parts.length === total) {
        const value: unknown = JSON.parse(parts.join(''));
        parts = [];
        bytes = total = 0;
        receive(value);
      }
    } catch {
      channel.close();
    }
  };
  return (value: unknown) => {
    if (channel.readyState !== 'open') throw new Error('Local channel unavailable');
    const text = JSON.stringify(value);
    if (text.length > 16 * 1024 * 1024 || channel.bufferedAmount > 16 * 1024 * 1024)
      throw new Error('Local channel congested');
    const count = Math.ceil(text.length / 12000);
    for (let index = 0; index < count; index++)
      channel.send(
        JSON.stringify({
          total: count,
          index,
          text: text.slice(index * 12000, (index + 1) * 12000),
        }),
      );
  };
}

export async function gather(peer: RTCPeerConnection) {
  if (peer.iceGatheringState !== 'complete')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        // A blocked STUN server must not discard already gathered LAN paths.
        resolve();
      }, 3000);
      const changed = () => {
        if (peer.iceGatheringState === 'complete') {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', changed);
      };
      peer.addEventListener('icegatheringstatechange', changed);
      changed();
    });
  return filterPeerDescription(peer.localDescription!.toJSON());
}

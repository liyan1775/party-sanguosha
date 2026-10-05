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
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Local discovery timed out'));
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
  const description = peer.localDescription!.toJSON();
  // No STUN/TURN services, public IPv6 paths or arbitrary non-local ICE probes.
  description.sdp = description
    .sdp!.split('\r\n')
    .filter((line) => {
      if (!line.startsWith('a=candidate:')) return true;
      const fields = line.split(' ');
      const address = fields[4] ?? '';
      return (
        fields[7] === 'host' &&
        (/^[\w-]+\.local$/.test(address) ||
          /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd][\da-f]{2}:|fe80:)/i.test(address))
      );
    })
    .join('\r\n');
  return description;
}

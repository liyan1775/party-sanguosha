import { gather, wire, type LanOffer, type RelayRequest } from './lan-peer.js';

/** The computer relays only native polling and ping, with a server-issued seat key. */
export function createLanHost() {
  const peers = new Map<string, { peer: RTCPeerConnection; abort: AbortController }>();
  function remove(id: string) {
    const entry = peers.get(id);
    if (!entry) return;
    peers.delete(id);
    entry.abort.abort();
    entry.peer.close();
  }
  function update(offers: LanOffer[]) {
    const active = new Set(offers.map((offer) => offer.id));
    for (const id of peers.keys()) if (!active.has(id)) remove(id);
    if (typeof RTCPeerConnection !== 'function') return;
    for (const offer of offers) {
      if (peers.has(offer.id) || offer.answered || peers.size >= 32) continue;
      const peer = new RTCPeerConnection({ iceServers: [] });
      const abort = new AbortController();
      peers.set(offer.id, { peer, abort });
      peer.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) remove(offer.id);
      };
      peer.ondatachannel = ({ channel }) => {
        if (channel.label !== 'party-local' || !channel.ordered) {
          channel.close();
          return;
        }
        let inFlight = 0;
        const send = wire(channel, (value) => {
          const request = value as RelayRequest;
          if (
            !Number.isSafeInteger(request.id) ||
            request.id < 1 ||
            inFlight >= 8 ||
            !['GET', 'POST', 'DELETE'].includes(request.method) ||
            typeof request.path !== 'string'
          ) {
            channel.close();
            return;
          }
          const ping = request.method === 'GET' && request.path === '/ping';
          if (
            !ping &&
            !/^\/engine\/poll\/[a-f0-9-]{36}(?:\?channel=[a-f0-9-]{36}(?:&after=\d+)?)?$/.test(
              request.path,
            )
          ) {
            channel.close();
            return;
          }
          inFlight++;
          void fetch(ping ? `/engine/lan/${offer.id}/ping` : request.path, {
            method: request.method,
            credentials: 'same-origin',
            cache: 'no-store',
            signal: abort.signal,
            headers: { 'Content-Type': 'application/json', 'X-Party-Relay': offer.key },
            ...(request.method === 'POST' ? { body: JSON.stringify(request.body) } : {}),
          })
            .then(async (response) => {
              send({ id: request.id, status: response.status, body: await response.json() });
            })
            .catch(() => {
              if (channel.readyState === 'open')
                try {
                  send({ id: request.id, status: 503, body: {} });
                } catch {
                  channel.close();
                }
            })
            .finally(() => inFlight--);
        });
        channel.onclose = () => remove(offer.id);
      };
      void (async () => {
        try {
          // Strip non-local candidates in both directions before contacting them.
          if (typeof offer.offer.sdp !== 'string') throw new Error('Invalid local offer');
          const filtered = {
            ...offer.offer,
            sdp: offer.offer.sdp
              .split('\r\n')
              .filter((line) => {
                if (!line.startsWith('a=candidate:')) return true;
                const fields = line.split(' ');
                return (
                  fields[7] === 'host' &&
                  /^(?:[\w-]+\.local$|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|f[cd][\da-f]{2}:|fe80:)/i.test(
                    fields[4] ?? '',
                  )
                );
              })
              .join('\r\n'),
          };
          await peer.setRemoteDescription(filtered);
          await peer.setLocalDescription(await peer.createAnswer());
          const answer = await gather(peer);
          const response = await fetch(`/engine/lan/${offer.id}/answer`, {
            method: 'POST',
            credentials: 'same-origin',
            signal: abort.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(answer),
          });
          if (!response.ok) remove(offer.id);
        } catch {
          remove(offer.id);
        }
      })();
    }
  }
  return {
    update,
    close: () => {
      for (const id of peers.keys()) remove(id);
    },
  };
}

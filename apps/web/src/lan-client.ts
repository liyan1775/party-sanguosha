import {
  gather,
  wire,
  peerConfiguration,
  privatePeerAddress,
  filterPeerDescription,
  type RelayRequest,
  type RelayResponse,
} from './lan-peer.js';

export function createLanConnection(roomCode: string) {
  if (typeof RTCPeerConnection !== 'function') return undefined;
  const peer = new RTCPeerConnection(peerConfiguration);
  const channel = peer.createDataChannel('party-local', { ordered: true });
  const abort = new AbortController();
  let id = '';
  let nextId = 0;
  let finished = false;
  let connected = false;
  let route: 'lan' | 'direct' = 'direct';
  const pending = new Map<
    number,
    {
      resolve: (value: RelayResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const send = wire(channel, (value) => {
    const response = value as RelayResponse;
    const entry = pending.get(response.id);
    if (!entry || !Number.isInteger(response.status)) return;
    clearTimeout(entry.timer);
    pending.delete(response.id);
    entry.resolve(response);
  });
  function close() {
    if (finished) return;
    finished = true;
    connected = false;
    abort.abort();
    clearTimeout(expiry);
    clearInterval(heartbeat);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Local channel closed'));
    }
    pending.clear();
    channel.close();
    peer.close();
    if (id) void fetch(`/engine/lan/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
  }
  function request(method: string, path: string, body?: unknown): Promise<RelayResponse> {
    if (!connected || finished) return Promise.reject(new Error('Local channel unavailable'));
    return new Promise((resolve, reject) => {
      const requestId = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Local request timed out'));
        close();
      }, 15000);
      pending.set(requestId, { resolve, reject, timer });
      try {
        send({ id: requestId, method, path, body } satisfies RelayRequest);
      } catch {
        close();
      }
    });
  }
  const expiry = setTimeout(close, 30000);
  const heartbeat = setInterval(() => {
    if (connected)
      void request('GET', '/ping')
        .then((result) => {
          if (result.status !== 200) close();
        })
        .catch(close);
  }, 10000);
  channel.onopen = () => {
    if (finished) return;
    connected = true;
    clearTimeout(expiry);
    window.dispatchEvent(new Event('party-lan-ready'));
    void peer
      .getStats()
      .then((stats) => {
        const pair = [...stats.values()].find(
          (entry) =>
            entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated,
        );
        const local = pair && stats.get(pair.localCandidateId),
          remote = pair && stats.get(pair.remoteCandidateId);
        if (
          local &&
          remote &&
          local.candidateType === 'host' &&
          remote.candidateType === 'host' &&
          (!local.address || privatePeerAddress(local.address)) &&
          (!remote.address || privatePeerAddress(remote.address))
        )
          route = 'lan';
      })
      .catch(() => {});
  };
  channel.onclose = close;
  channel.onerror = close;
  peer.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) close();
  };
  async function signal() {
    try {
      await peer.setLocalDescription(await peer.createOffer());
      const offer = await gather(peer);
      const created = await fetch(`/engine/lan/${roomCode}/offer`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offer),
      });
      if (!created.ok) throw new Error('Local discovery unavailable');
      id = (await created.json()).id;
      if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid local peer');
      if (finished) {
        void fetch(`/engine/lan/${id}`, { method: 'DELETE' }).catch(() => {});
        return;
      }
      while (!finished) {
        const response = await fetch(`/engine/lan/${id}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!response.ok) throw new Error('Local discovery unavailable');
        const { answer } = await response.json();
        if (answer) {
          await peer.setRemoteDescription(filterPeerDescription(answer));
          break;
        }
      }
    } catch {
      close();
    }
  }
  void signal();
  window.addEventListener('pagehide', close, { once: true });
  return {
    get closed() {
      return finished;
    },
    get connected() {
      return connected;
    },
    get route() {
      return route;
    },
    request,
    close,
  };
}

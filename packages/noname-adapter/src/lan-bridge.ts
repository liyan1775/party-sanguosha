import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Description = { type: 'offer' | 'answer'; sdp: string };
type Probe = {
  id: string;
  key: string;
  roomCode: string;
  token: string;
  playerId: string;
  offer: Description;
  answer?: Description;
  expires: number;
  waiting: Set<() => void>;
};
function json(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
async function description(request: IncomingMessage, type: Description['type']) {
  const parts = [];
  let length = 0;
  for await (const part of request) {
    length += part.length;
    if (length > 32768) throw new Error('Description too large');
    parts.push(Buffer.from(part));
  }
  const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (value?.type !== type || typeof value.sdp !== 'string' || !value.sdp.startsWith('v=0'))
    throw new Error('Invalid description');
  return { type, sdp: value.sdp };
}

/** Signaling only. Relay keys stay on the local computer, scoped to one current seat. */
export class LanBridge {
  private readonly probes = new Map<string, Probe>();
  constructor(
    private readonly membership: (room: string, token?: string) => { id: string } | undefined,
    private readonly hostAuthorized: (request: IncomingMessage) => boolean,
    private readonly publish: () => void,
  ) {}
  offers() {
    return [...this.probes.values()].map(({ id, key, offer, answer }) => ({
      id,
      key,
      offer,
      answered: !!answer,
    }));
  }
  private valid(probe: Probe) {
    return (
      probe.expires > Date.now() &&
      this.membership(probe.roomCode, probe.token)?.id === probe.playerId
    );
  }
  private remove(probe: Probe) {
    this.probes.delete(probe.id);
    for (const finish of probe.waiting) finish();
  }
  expire() {
    let changed = false;
    for (const probe of this.probes.values())
      if (!this.valid(probe)) {
        this.remove(probe);
        changed = true;
      }
    if (changed) this.publish();
  }
  close() {
    for (const probe of this.probes.values()) this.remove(probe);
  }
  relaySeat(request: IncomingMessage, roomCode: string) {
    if (!this.hostAuthorized(request)) return undefined;
    const key = request.headers['x-party-relay'];
    if (typeof key !== 'string') return undefined;
    const probe = [...this.probes.values()].find((item) => item.key === key);
    if (!probe?.answer || probe.roomCode !== roomCode || !this.valid(probe)) return undefined;
    probe.expires = Date.now() + 60000;
    return { id: probe.playerId };
  }
  async handle(request: IncomingMessage, response: ServerResponse, url: URL, token?: string) {
    if (!url.pathname.startsWith('/engine/lan/')) return false;
    const create = /^\/engine\/lan\/([A-F0-9]{6})\/offer$/.exec(url.pathname);
    if (create && request.method === 'POST') {
      this.expire();
      const seat = this.membership(create[1]!, token);
      if (!seat || !token) {
        json(response, 403, {});
        return true;
      }
      if (this.probes.size >= 32) {
        json(response, 429, {});
        return true;
      }
      try {
        const offer = await description(request, 'offer');
        if (this.probes.size >= 32) {
          json(response, 429, {});
          return true;
        }
        if (this.membership(create[1]!, token)?.id !== seat.id) {
          json(response, 403, {});
          return true;
        }
        // Each seat has at most two peers, permitting a reconnect overlap.
        const own = [...this.probes.values()].filter((item) => item.playerId === seat.id);
        if (own.length >= 2) this.remove(own[0]!);
        const id = randomBytes(16).toString('hex');
        this.probes.set(id, {
          id,
          key: randomBytes(32).toString('base64url'),
          roomCode: create[1]!,
          token,
          playerId: seat.id,
          offer,
          expires: Date.now() + 30000,
          waiting: new Set(),
        });
        json(response, 201, { id });
        this.publish();
      } catch {
        json(response, 400, {});
      }
      return true;
    }
    const route = /^\/engine\/lan\/([a-f0-9]{32})(?:\/(answer|ping))?$/.exec(url.pathname);
    const probe = route && this.probes.get(route[1]!);
    if (!route || !probe || !this.valid(probe)) {
      json(response, 403, {});
      return true;
    }
    if (route[2]) {
      if (!this.hostAuthorized(request)) {
        json(response, 403, {});
        return true;
      }
      if (
        route[2] === 'ping' &&
        request.method === 'GET' &&
        request.headers['x-party-relay'] === probe.key &&
        probe.answer
      ) {
        probe.expires = Date.now() + 60000;
        json(response, 200, { ok: true });
      } else if (route[2] === 'answer' && request.method === 'POST') {
        if (probe.answer) {
          json(response, 409, {});
          return true;
        }
        try {
          const answer = await description(request, 'answer');
          if (probe.answer) {
            json(response, 409, {});
            return true;
          }
          probe.answer = answer;
          probe.expires = Date.now() + 60000;
          for (const finish of probe.waiting) finish();
          json(response, 200, {});
          this.publish();
        } catch {
          json(response, 400, {});
        }
      } else json(response, 405, {});
      return true;
    }
    if (this.membership(probe.roomCode, token)?.id !== probe.playerId) {
      json(response, 403, {});
      return true;
    }
    if (request.method === 'DELETE') {
      this.remove(probe);
      this.publish();
      json(response, 200, {});
    } else if (request.method === 'GET') {
      if (probe.waiting.size >= 2) {
        json(response, 429, {});
        return true;
      }
      const finish = () => {
        clearTimeout(timer);
        probe.waiting.delete(finish);
        json(response, 200, { answer: probe.answer ?? null });
      };
      const timer = setTimeout(finish, 12000);
      probe.waiting.add(finish);
      response.once('close', () => {
        clearTimeout(timer);
        probe.waiting.delete(finish);
      });
      if (probe.answer) finish();
    } else json(response, 405, {});
    return true;
  }
}

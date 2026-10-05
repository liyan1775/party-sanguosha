import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPeerDescription } from '../apps/web/src/lan-peer.js';

test('直连候选允许私网与 STUN 公网 UDP，拒绝回环、广播、任意域名和 TCP 探测', () => {
  const candidates = [
    'a=candidate:1 1 UDP 1 192.168.1.2 1234 typ host',
    'a=candidate:2 1 UDP 1 203.0.113.3 4567 typ srflx',
    'a=candidate:3 1 UDP 1 2001:db8::1 1234 typ host',
    'a=candidate:4 1 UDP 1 device.local 1234 typ host',
    'a=candidate:5 1 UDP 1 127.0.0.1 1234 typ host',
    'a=candidate:6 1 UDP 1 255.255.255.255 1234 typ host',
    'a=candidate:7 1 UDP 1 999.1.1.1 1234 typ host',
    'a=candidate:8 1 UDP 1 attacker.invalid 1234 typ host',
    'a=candidate:9 1 TCP 1 192.168.1.2 1234 typ host',
  ];
  const sdp = ['v=0', 'a=ice-ufrag:abc', ...candidates].join('\r\n');
  const result = filterPeerDescription({ type: 'offer', sdp }).sdp!;
  for (const allowed of candidates.slice(0, 4)) assert(result.includes(allowed));
  for (const refused of candidates.slice(4)) assert(!result.includes(refused));
  assert(result.includes('a=ice-ufrag:abc'));
});

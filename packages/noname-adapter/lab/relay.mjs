import { WebSocket, WebSocketServer } from 'ws';

// Test-only relay. Production must authenticate the rule host and each seat
// against the lobby session before accepting an upgrade; this service is separate.
export function attachLabRelay(server, humanCount) {
  const sockets = new WebSocketServer({ server, path: '/relay', maxPayload: 512 * 1024 });
  const players = new Map();
  let ruleHost;
  const sendHost = (message) => {
    if (ruleHost?.readyState === WebSocket.OPEN) ruleHost.send(JSON.stringify(message));
  };
  sockets.on('connection', (socket, request) => {
    const url = new URL(request.url, 'http://lab.local');
    const id = url.searchParams.get('id');
    if (id === 'rule-host' && !ruleHost) {
      ruleHost = socket;
      socket.on('message', (bytes) => {
        try {
          const message = JSON.parse(bytes.toString());
          const target = players.get(message.id);
          if (target?.readyState === WebSocket.OPEN) {
            if (message.type === 'send' && typeof message.data === 'string')
              target.send(message.data);
            if (message.type === 'close') target.close();
          }
        } catch {
          socket.close(1003);
        }
      });
      socket.on('close', () => {
        ruleHost = undefined;
        for (const player of players.values()) player.close();
      });
    } else if (
      /^human-[12]$/.test(id ?? '') &&
      Number(id.slice(-1)) <= humanCount &&
      ruleHost &&
      !players.has(id)
    ) {
      players.set(id, socket);
      sendHost({ type: 'connect', id });
      socket.on('message', (bytes) => sendHost({ type: 'message', id, data: bytes.toString() }));
      socket.on('close', () => {
        players.delete(id);
        sendHost({ type: 'close', id });
      });
    } else {
      socket.close(1008);
    }
  });
  return () => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
  };
}

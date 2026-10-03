import { lib } from 'noname';

export async function connectRuleHost() {
  const virtualSockets = new Map();
  const socket = new WebSocket(`ws://${location.host}/relay?id=rule-host`);
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'connect') {
      const clientSocket = {
        wsid: message.id,
        handlers: {},
        on(type, callback) {
          this.handlers[type] = callback;
        },
        send(data) {
          socket.send(JSON.stringify({ type: 'send', id: message.id, data }));
        },
        close() {
          socket.send(JSON.stringify({ type: 'close', id: message.id }));
        },
      };
      virtualSockets.set(message.id, clientSocket);
      lib.init.connection(clientSocket);
    } else {
      virtualSockets.get(message.id)?.handlers[message.type]?.(message.data);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}

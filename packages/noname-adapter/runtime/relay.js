// SPDX-License-Identifier: GPL-3.0-only
import { lib, get } from 'noname';

export async function connectRuleHost() {
  const { setup } = globalThis.partyEngine;
  const virtualSockets = new Map();
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${scheme}//${location.host}/engine/socket/${setup.id}/worker`);
  globalThis.partyEngine.signal = (type) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type }));
  };
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
      const virtual = virtualSockets.get(message.id);
      if (message.type === 'message') {
        // A player's references identify existing engine objects. Serialized
        // metadata must never rename a real card on the rule executor.
        const parseCard = get.infoCardOL;
        get.infoCardOL = function (value) {
          const id = JSON.parse(value.slice(13))[0];
          return lib.cardOL[id] ?? value;
        };
        try {
          virtual?.handlers.message?.(message.data);
        } finally {
          get.infoCardOL = parseCard;
        }
      } else virtual?.handlers[message.type]?.(message.data);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}

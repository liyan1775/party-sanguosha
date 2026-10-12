// SPDX-License-Identifier: GPL-3.0-only
import { lib, get } from 'noname';
import { installObserver } from './observer.js';

export async function connectRuleHost() {
  const { setup } = globalThis.partyEngine;
  const virtualSockets = new Map();
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${scheme}//${location.host}/engine/socket/${setup.id}/worker`;
  const socket = setup.ruleRecovery
    ? new (await import('./rule-socket.js')).RecoverableRuleSocket(url)
    : new WebSocket(url);
  window.addEventListener('pagehide', () => socket.close(), { once: true });
  globalThis.partyEngine.ruleSocket = socket;
  globalThis.partyEngine.signal = (type) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type }));
  };
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'connect') {
      const previous = virtualSockets.get(message.id);
      if (globalThis.partyEngine.connectionRecovery?.resume(previous)) return;
      // A resumed rule relay resends current connections; their native Clients
      // still live in this iframe and must not be initialized a second time.
      if (
        setup.ruleRecovery &&
        lib.node.clients.some((client) => client.ws === previous && !client.closed)
      )
        return;
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
          globalThis.partyEngine.connectionRecovery?.close(this);
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
      } else if (message.type === 'disconnect' && globalThis.partyEngine.connectionRecovery)
        globalThis.partyEngine.connectionRecovery.disconnect(virtual);
      else if (message.type === 'close' && globalThis.partyEngine.connectionRecovery)
        globalThis.partyEngine.connectionRecovery.close(virtual);
      else
        virtual?.handlers[message.type === 'disconnect' ? 'close' : message.type]?.(message.data);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('close', () => reject(new Error('电脑规则连接未能建立')), {
      once: true,
    });
  });
  const update = installObserver((state) => {
    globalThis.partyEngine.publishPublicSummary?.(state);
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: 'observer', state }));
  });
  const signal = globalThis.partyEngine.signal;
  globalThis.partyEngine.signal = (type) => {
    update();
    signal(type);
  };
}

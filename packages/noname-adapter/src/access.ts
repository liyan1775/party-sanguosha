import type { IncomingMessage } from 'node:http';

/** The public ingress always stamps its requests, even if a visitor spoofs Host. */
export function isLocalRequest(request: IncomingMessage): boolean {
  if (
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') ||
    request.headers['x-party-ingress'] ||
    request.headers['cf-connecting-ip'] ||
    request.headers['x-forwarded-for'] ||
    request.headers.forwarded
  )
    return false;
  try {
    const host = new URL(`http://${request.headers.host}`);
    return (
      ['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) &&
      Number(host.port || 80) === request.socket.localPort &&
      (!request.headers.origin || new URL(request.headers.origin).host === host.host)
    );
  } catch {
    return false;
  }
}

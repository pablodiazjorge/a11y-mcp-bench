// A small web site on a loopback address, for the tests of the browser adapter. Each test serves
// its own paths and counts the requests that reach them, so no test depends on another. It also
// completes WebSocket handshakes, so a page can open a real WebSocket.

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

export type Handler = (request: IncomingMessage, response: ServerResponse) => void;

export interface LocalSite {
  /** `http://` with the host and port, the IPv6 host in brackets. */
  readonly origin: string;
  readonly port: number;
  /** Serves `html` at `path`. */
  page(path: string, html: string): void;
  /** Answers the requests for `path` with `handler`. */
  handle(path: string, handler: Handler): void;
  /** Answers `path` with a redirect to `location`. */
  redirect(path: string, location: string): void;
  /** How many requests and WebSocket handshakes reached `path`, whatever their query. */
  hits(path: string): number;
  close(): Promise<void>;
}

// The GUID that RFC 6455 adds to the client's key to prove that the server speaks WebSocket.
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Starts a site on `host`, on a free port unless `port` is given. */
export async function startSite(host: string, port = 0): Promise<LocalSite> {
  const handlers = new Map<string, Handler>();
  const counts = new Map<string, number>();
  const upgraded = new Set<Duplex>();
  const count = (url: string | undefined): string => {
    const path = new URL(url ?? '/', 'http://site').pathname;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    return path;
  };

  const server = createServer((request, response) => {
    const handler = handlers.get(count(request.url));
    if (handler !== undefined) {
      handler(request, response);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<title>not found</title>');
  });
  server.on('upgrade', (request: IncomingMessage, socket: Duplex) => {
    count(request.url);
    upgraded.add(socket);
    const key = request.headers['sec-websocket-key'] ?? '';
    const accept = createHash('sha1').update(`${key}${WEBSOCKET_GUID}`).digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the site has no port');
  const origin = `http://${host.includes(':') ? `[${host}]` : host}:${String(address.port)}`;

  return {
    origin,
    port: address.port,
    page(path, html) {
      handlers.set(path, (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
      });
    },
    handle(path, handler) {
      handlers.set(path, handler);
    },
    redirect(path, location) {
      handlers.set(path, (_request, response) => {
        response.writeHead(302, { location });
        response.end();
      });
    },
    hits(path) {
      return counts.get(path) ?? 0;
    },
    async close() {
      for (const socket of upgraded) socket.destroy();
      // A request that a test leaves unanswered would keep the server open.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

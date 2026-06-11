// Node 22+ has a global browser-compatible WebSocket; provide one otherwise.
import { WebSocket as WsWebSocket } from 'ws';

if (!(globalThis as Record<string, unknown>).WebSocket) {
  (globalThis as Record<string, unknown>).WebSocket = WsWebSocket;
}

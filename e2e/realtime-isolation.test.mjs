import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalWebSocket } from './local.mjs';
test('realtime tests allow only the isolated local websocket endpoint', () => {
  assert.equal(isLocalWebSocket('ws://127.0.0.1:55321/realtime/v1/websocket?apikey=local'),true);
  assert.equal(isLocalWebSocket('ws://localhost:3103/_next/webpack-hmr'),true);
  for (const url of ['wss://production.supabase.co/realtime/v1/websocket','ws://127.0.0.1:55321/other','ws://localhost:55321/realtime/v1/websocket','ws://127.0.0.1.attacker.test:55321/realtime/v1/websocket','invalid']) assert.equal(isLocalWebSocket(url),false);
});

/* Local test process only. No product imports or production configuration. */
/* eslint-disable @typescript-eslint/no-require-imports */
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const { syncBuiltinESMExports } = require('node:module');
function check(host, port) {
  const allowedPorts = process.env.E2E_R3_PROVIDER === 'synthetic' ? [3103, 55321, 55325] : [3103, 55321];
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !allowedPorts.includes(Number(port)))
    throw new Error('E2E_OUTBOUND_BLOCKED');
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof options === 'object') {
    // Node pipes are used by compiler workers. Only anonymous IPC is allowed;
    // named sockets (including local production DB/proxy sockets) are refused.
    if (options.path) throw new Error('E2E_UNIX_SOCKET_BLOCKED');
    check(options.host || 'localhost', options.port);
  } else check(typeof args[1] === 'string' ? args[1] : 'localhost', options);
  return originalConnect.apply(this, args);
};
tls.connect = () => { throw new Error('E2E_TLS_BLOCKED'); };
dgram.createSocket = () => { throw new Error('E2E_UDP_BLOCKED'); };
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  // Transport certification only: redirect precisely identified synthetic
  // accounts to the local fake provider. All real Meta credentials/hosts stay
  // blocked; no product code or external network path is replaced/enabled.
  if (process.env.E2E_TRANSPORT_PROVIDER === 'synthetic' && process.env.E2E_R3_PROVIDER === 'synthetic' &&
    url.protocol === 'https:' && ['graph.instagram.com', 'graph.facebook.com'].includes(url.hostname) &&
    /^\/v\d+\.\d+\/synthetic-transport-[a-f0-9-]+\/messages$/.test(url.pathname) &&
    new Headers(init?.headers).get('Authorization') === 'Bearer synthetic-transport-local-only' && init?.method === 'POST') {
    return originalFetch(`http://127.0.0.1:55325/meta/${url.hostname === 'graph.instagram.com' ? 'instagram' : 'whatsapp'}`, init);
  }
  if (url.protocol !== 'http:') throw new Error('E2E_PROTOCOL_BLOCKED');
  check(url.hostname, url.port);
  return originalFetch(input, init);
};
syncBuiltinESMExports();

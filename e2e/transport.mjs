// Real TCP forwarding via Docker's local Unix socket. No egress network or mocks.
// Avoid the Docker CLI's per-call latency (Supabase bootstrap times out at 2s).
import net from 'node:net';
import http from 'node:http';
import assert from 'node:assert/strict';
import { project, network, run } from './local.mjs';
import { dockerFrames } from './transport-frames.mjs';

const endpoint = JSON.parse(run('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker}}']));
assert.ok(endpoint.Host.startsWith('unix:///'), 'Only a local Docker Unix socket is permitted');
const socketPath = endpoint.Host.slice('unix://'.length);
const db = `supabase_db_${project}`;
const connections = new Set(), servers = [];
function request(path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: `/v1.51${path}`, method: body ? 'POST' : 'GET', timeout: 5000,
      headers: { 'Content-Type': 'application/json' } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 300) reject(new Error(`Local Docker API ${res.statusCode}`));
        else { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } }
      });
      res.on('error', reject);
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Local Docker API timeout')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
for (const [port, host, targetPort] of [
  [55322, '127.0.0.1', 5432],
  [55321, `supabase_kong_${project}`, 8000],
  [55324, `supabase_inbucket_${project}`, 8025],
]) {
  const server = net.createServer(async socket => {
    socket.pause(); connections.add(socket);
    const started = Date.now(); let received = 0, sent = 0;
    socket.on('data', data => { received += data.length; });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      connections.delete(socket);
      if (process.env.E2E_TRANSPORT_TRACE === '1') console.log(JSON.stringify({ port, ms: Date.now() - started, received, sent }));
    });
    try {
      // On this Desktop daemon container-inspect stalls 3s; the list endpoint
      // returns the same required identity/label/network evidence immediately.
      const filters = encodeURIComponent(JSON.stringify({ name: [`^/${db}$`] }));
      const [containers, n] = await Promise.all([request(`/containers/json?filters=${filters}`), request(`/networks/${network}`)]);
      assert.equal(containers.length, 1, 'Expected one running local database');
      const container = containers[0];
      assert.deepEqual(container.Names, [`/${db}`]);
      if (process.env.E2E_TRANSPORT_TRACE === '1') console.log(JSON.stringify({ port, phase: 'inspected', ms: Date.now() - started }));
      assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [network]);
      assert.equal(container.Labels['com.supabase.cli.project'], project);
      assert.equal(n.Internal, true); assert.equal(n.Labels['agjenti.e2e'], project);
      if (socket.destroyed) return;
      const exec = await request(`/containers/${container.Id}/exec`, {
        AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: false,
        Cmd: ['nc', '-w', '60', host, String(targetPort)],
      });
      assert.match(exec.Id, /^[a-f0-9]{64}$/);
      if (process.env.E2E_TRANSPORT_TRACE === '1') console.log(JSON.stringify({ port, phase: 'exec-created', ms: Date.now() - started }));
      const req = http.request({ socketPath, path: `/v1.51/exec/${exec.Id}/start`, method: 'POST', timeout: 5000,
        headers: { 'Content-Type': 'application/json', Connection: 'Upgrade', Upgrade: 'tcp' } });
      req.on('upgrade', (res, upstream, head) => {
        if (process.env.E2E_TRANSPORT_TRACE === '1') console.log(JSON.stringify({ port, phase: 'upgraded', ms: Date.now() - started }));
        if (res.statusCode !== 101 || socket.destroyed) { upstream.destroy(); socket.destroy(); return; }
        const frames = dockerFrames(data => { sent += data.length; if (!socket.write(data)) upstream.pause(); });
        upstream.on('data', chunk => { try { frames(chunk); } catch { upstream.destroy(); socket.destroy(); } });
        upstream.on('error', () => socket.destroy()); upstream.on('end', () => socket.end());
        socket.on('close', () => upstream.destroy()); socket.on('drain', () => upstream.resume());
        if (head.length) frames(head);
        socket.pipe(upstream); socket.resume();
      });
      req.on('response', res => { res.resume(); socket.destroy(); });
      req.on('error', () => socket.destroy());
      req.on('timeout', () => req.destroy(new Error('Local exec timeout')));
      req.end(JSON.stringify({ Detach: false, Tty: false }));
    } catch (error) {
      if (process.env.E2E_TRANSPORT_TRACE === '1') console.error(error.message);
      socket.destroy();
    }
  });
  server.on('error', error => { console.error(error.message); shutdown(1); });
  server.listen(port, '127.0.0.1'); servers.push(server);
}
function shutdown(code) {
  for (const socket of connections) socket.destroy();
  for (const server of servers) server.close();
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
console.log('Local-only Docker transport: 55321, 55322, 55324. Keep this terminal running.');

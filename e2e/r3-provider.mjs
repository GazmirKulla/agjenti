// Controlled OpenAI wire-format fixture, NOT a real LLM or business provider.
// No requests/prompts/PII are logged or persisted. Used only by `app-r3`.
import http from 'node:http';
import assert from 'node:assert/strict';
import { project, verifyContainers } from './local.mjs';
assert.equal(project, 'agjenti-e2e-local-recovery-3a-20261023');
verifyContainers();
let calls = 0;
const server = http.createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') { res.end(JSON.stringify({ synthetic: true, calls })); return; }
  if (req.url !== '/v1/responses' || req.method !== 'POST' || req.headers.authorization !== 'Bearer synthetic-r3-local-only') { res.writeHead(403); res.end(); return; }
  try {
    let body=''; for await (const chunk of req) { body+=chunk; if(body.length>1000000)throw Error('oversized'); }
    const request=JSON.parse(body), format=request.text?.format?.name;
    let text;
    if(format==='customer_facts') text='{"facts":[]}'; // F1 must work without model-inferred facts.
    else if(format==='workflow_guidance') text='{"action":"continue","target":null,"confidence":1,"evidence":""}';
    else {
      const message=String(request.input).match(/^Customer message: ([^\n]*)/)?.[1]??'';
      const lower=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      text=lower.includes('cilat te dhena te duhen') ? '[[ask_customer:name,business_type,instagram_handle,stated_needs]]'
        : lower.includes('pergjigju sakte') ? 'Ti quhesh Miqail.'
        : /emrin|quhem/.test(lower) ? 'Nuk ma ke treguar emrin.'
        : /instagram/.test(lower) ? 'Nuk ma ke treguar Instagramin.'
        : /shes/.test(lower) ? 'Ti ofron automatizim AI si Agjenti.app.'
        : /pyetjesh marr/.test(lower) ? "Nuk m'i ke treguar pyetjet."
        : lower.includes('njoftove stafin') ? 'Stafi u njoftua.'
        : lower.includes('ofron agjenti') ? 'Agjenti.app ofron automatizim AI.'
        : 'Përgjigje sintetike për verifikim, jo këshillë biznesi.';
    }
    calls++;
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({id:`synthetic-r3-${calls}`,object:'response',model:'synthetic',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}]}));
  } catch { res.writeHead(400); res.end('{"error":"invalid synthetic request"}'); }
});
server.listen(55325,'127.0.0.1',()=>console.log('R3 synthetic provider: loopback only; no real model calls.'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close());

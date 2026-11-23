// Actual isolated Supabase Auth + Realtime; no provider calls or synthetic UI state.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { work, verifyContainers, localKeys, sql, isLocalWebSocket } from './local.mjs';
import { quote } from './fixtures.mjs';
const fixtures=JSON.parse(readFileSync(path.join(work,'fixtures.json'),'utf8'));
const tenant=fixtures.tenants.find(t=>t.kind==='retail');
const keys=localKeys();
test.beforeAll(()=>verifyContainers());
test('idle inbox makes no recurring reads and a committed change arrives through realtime',async({context,page})=>{
  const idleMs=Number(process.env.REALTIME_IDLE_MS || 30_000);
  test.setTimeout(idleMs+60_000);
  await context.routeWebSocket('**/*',r=>isLocalWebSocket(r.url())?r.connectToServer():r.close());
  await context.route('**/*',r=>['http://localhost:3103',keys.api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
  await page.goto('/login');
  await page.getByLabel('Email-i',{exact:true}).fill(tenant.email);
  await page.getByPlaceholder('Fjalëkalimi yt',{exact:true}).fill(fixtures.password);
  await page.getByRole('button',{name:'Hyr në panel →',exact:true}).click();
  await expect(page).toHaveURL(`http://localhost:3103/b/${tenant.slug}`);
  await page.goto(`/b/${tenant.slug}/inbox`);
  await page.waitForLoadState('networkidle');
  // Let the subscribe-before-read reconciliation settle before measuring idle traffic.
  await page.waitForTimeout(2000);
  const reads=[];
  const observe=request=>{
    const url=new URL(request.url());
    if(request.method()==='GET' && (url.pathname.startsWith('/api/') || url.searchParams.has('_rsc'))) reads.push(url.pathname);
  };
  page.on('request',observe);
  await page.waitForTimeout(idleMs);
  expect(reads).toEqual([]);
  const name=sql(`select name from businesses where id=${quote(tenant.id)};`);
  try {
    sql(`update businesses set name='Realtime test update' where id=${quote(tenant.id)};`);
    await expect(page.getByText('Realtime test update',{exact:true}).first()).toBeVisible();
    expect(reads.length).toBeGreaterThan(0);
  } finally {
    page.off('request',observe);
    sql(`update businesses set name=${quote(name)} where id=${quote(tenant.id)};`);
  }
});

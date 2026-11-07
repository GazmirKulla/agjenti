import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { composeProcessReply } from "@/lib/orchestration/respond";
import { initialSnapshot } from "@/lib/orchestration/contracts";
import type { Environment } from "@/lib/orchestration/transition";
const config=JSON.parse(readFileSync('config/businesses/agjenti-app.json','utf8'));
const questions = [
  'okay super, por ju mesazhet i ktheni nga instagrami im domethen?',
  'e kam fjalen, mesazhet qe i ktheni klienteve te mi - ja ktheni nga instagrami im, a duhet te ju jap une te dhenat e instagramit apo cfare?',
  'Si i marr produktet nga website dhe a ndryshon stoku automatikisht?',
  'A mund ta lidh edhe WhatsApp?'
];
it.skipIf(process.env.RUN_JOURNEY_MODEL !== '1')('checks the real model against the prepared business knowledge', async()=>{
  const env: Environment = { mode: "test", now: Date.now(), definitions: [], startableVersionIds: new Set(), tools: [], promptTtlMs: 60_000 };
  const state = initialSnapshot("journey", "journey", "test");
  for(const customerMessage of questions){
    const result=await composeProcessReply({
      message: customerMessage,
      history: [],
      state,
      env,
      notices: [],
      context: { instructions: config.instructions, communication: config.communication, knowledge: config.knowledge },
      deadline: Date.now() + 30_000,
    });
    console.log(JSON.stringify({question:customerMessage,reply:result.reply}));
    expect.soft(result.reply).not.toContain('nuk kam deklarim');
    expect.soft((result.reply.match(/\?/g)||[]).length).toBeLessThanOrEqual(1);
  }
},120000);

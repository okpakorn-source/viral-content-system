import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';

// Exercise both real clients after the split, with provider transport and usage writes stubbed.
// The same provider JSON must retain main clip sanitization and historic news sanitization.
const root = new URL('../', import.meta.url);
const sdk = `export default class OpenAI { constructor() { this.chat = { completions: { create: async () => ({ choices: [{message:{content:JSON.stringify(globalThis.__goldenSharedPayload)}}],usage:{prompt_tokens:0,completion_tokens:0} }) } }; } }`;
const google = `export class GoogleGenerativeAI { getGenerativeModel() { return {generateContent: async () => ({response:{text:()=>JSON.stringify(globalThis.__goldenSharedPayload),usageMetadata:{promptTokenCount:0,candidatesTokenCount:0}}})}; } }`;
const moduleUrl = source => 'data:text/javascript,' + encodeURIComponent(source);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'openai') return {url:moduleUrl(sdk),shortCircuit:true};
    if (spec === '@google/generative-ai') return {url:moduleUrl(google),shortCircuit:true};
    if (/usageLogger(?:\.js)?$/.test(spec)) return {url:moduleUrl('export async function logApiUsage() {}'),shortCircuit:true};
    if (spec.startsWith('@/')) spec = new URL('src/'+spec.slice(2)+(spec.endsWith('.js')?'':'.js'),root).href;
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\.[a-z]+(?:\?.*)?$/i.test(spec)) {
      try { return next(spec+'.js',ctx); } catch { /* Let normal resolution handle non-file specifiers. */ }
    }
    return next(spec,ctx);
  }
});
process.env.OPENAI_API_KEY='test-only-no-network';
process.env.GEMINI_API_KEY='test-only-no-network';
const newsOpenAI=await import('../src/lib/ai/openai.js');
const clipOpenAI=await import('../src/lib/services/clipAI/openai.js');
const newsFilter=await import('../src/lib/ai/safetyFilter.js');
const clipFilter=await import('../src/lib/services/clipAI/safetyFilter.js');

test('clip OpenAI retains main fact-preserving replacements while news retains target bytes and behavior', async () => {
  const payload={content:'ไม่อยากตาย ยาฆ่าเชื้อ ผูกคอแต่ช่วยทัน กระโดดตึกแต่รอด',nested:['ฆ่าตัวตาย']};
  globalThis.__goldenSharedPayload=payload;
  const args={prompt:'transport fixture',model:'gpt-5.6-sol',maxTokens:500,allowModelFallback:false,maxRetries:0};
  const news=await newsOpenAI.callAI(args);
  const clip=await clipOpenAI.callAI(args);
  assert.deepEqual(news,newsFilter.sanitizeOutput(payload));
  assert.deepEqual(clip,clipFilter.sanitizeOutput(payload));
  assert.match(clip.content,/ไม่อยากตาย ยาฆ่าเชื้อ ทำร้ายตัวเองแต่ช่วยทัน ตกจากที่สูงแต่รอด/u);
  assert.notDeepEqual(news,clip);
  assert.equal(news._usedModel,clip._usedModel);
});

test('clip legacy flag parsing remains main while historic news accepts only literal 1', async () => {
  const news=await import('../src/lib/ai/legacyLengthRules.js');
  const clip=await import('../src/lib/services/clipAI/legacyLengthRules.js');
  const prior=process.env.LEGACY_LENGTH_RULES;
  try {
    process.env.LEGACY_LENGTH_RULES=' true ';
    assert.equal(news.isLegacyLengthOn(),false);
    assert.equal(clip.isLegacyLengthOn(),true);
    process.env.LEGACY_LENGTH_RULES='1';
    assert.equal(news.isLegacyLengthOn(),true);
    assert.equal(clip.isLegacyLengthOn(),true);
  } finally { if(prior===undefined)delete process.env.LEGACY_LENGTH_RULES;else process.env.LEGACY_LENGTH_RULES=prior; }
});

test('all clip fallbacks point to isolated clients, while original news services do not', () => {
  const read=p=>fs.readFileSync(new URL(p,root),'utf8');
  for(const p of ['src/lib/services/clipInsightService.js','src/app/api/clip-transcript/route.js']) {
    assert.match(read(p),/services\/clipAI\/openai/);
    assert.doesNotMatch(read(p),/from ['"]@\/lib\/ai\/openai['"]/);
  }
  for(const p of ['src/lib/services/autoFlowServiceText.js','src/lib/services/summarizeServiceText.js','src/lib/services/summarizeService.js','src/lib/ai/aiRouter.js']) assert.doesNotMatch(read(p),/clipAI/);
});
test('clip Gemini retains main replacements while news Gemini retains historic sanitization', async () => {
  const newsGemini=await import('../src/lib/ai/geminiClient.js');
  const clipGemini=await import('../src/lib/services/clipAI/geminiClient.js');
  const payload={content:'ไม่อยากตาย ยาฆ่าเชื้อ ผูกคอแต่ช่วยทัน กระโดดตึกแต่รอด',nested:['ฆ่าตัวตาย']};
  globalThis.__goldenSharedPayload=payload;
  const args={prompt:'transport fixture',maxTokens:500};
  const news=await newsGemini.callGemini(args);
  const clip=await clipGemini.callGemini(args);
  assert.deepEqual(news,newsFilter.sanitizeOutput(payload));
  assert.deepEqual(clip,clipFilter.sanitizeOutput(payload));
  assert.match(clip.content,/ไม่อยากตาย ยาฆ่าเชื้อ ทำร้ายตัวเองแต่ช่วยทัน ตกจากที่สูงแต่รอด/u);
  assert.notDeepEqual(news,clip);
});

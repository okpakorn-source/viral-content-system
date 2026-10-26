import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';

// Exercise the real news clients with provider transport and usage writes stubbed.
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S1 · เจ้าของอนุมัติ) — MC-01/PL-02: ฝั่งข่าวไม่ "ล็อกไบต์เดิม" อีกต่อไป
//   ค่าเริ่มต้น = ตัวกรองขอบคำ (ไม่ยืนยันการตายที่ต้นฉบับไม่มี ไม่กินกลางคำ) · ไบต์เดิมยังพิสูจน์ได้ผ่านสวิตช์ถอย SANITIZE_LEGACY=1
// ★ 26 ต.ค. 69 (ระบบถอดคลิปเฟส 4): สำเนา client ของคลิป (services/clipAI) ถูกลบพร้อมเครื่องยนต์เดิม
//   → เทสนี้เหลือข้อเฝ้าฝั่งข่าว (อยู่ในชุด test:news) · ข่าวต้องไม่ import clipAI ต่อไป
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
const newsFilter=await import('../src/lib/ai/safetyFilter.js');

// ★ 24 ก.ย. 69 (S1): ไบต์ "historic" ของฝั่งข่าว (ตัวกรองเดิม) — ใช้ยืนยันสวิตช์ถอย SANITIZE_LEGACY=1
const NEWS_LEGACY_CONTENT='ไม่ภาวะเครียดสะสม ยาทำให้เสียชีวิตเชื้อ เสียชีวิตอย่างน่าเศร้าแต่ช่วยทัน เสียชีวิตจากที่สูงแต่รอด';
const NEWS_LEGACY_NESTED=['ทำให้เสียชีวิตตัวตาย'];
const withLegacy=async (fn)=>{ const prior=process.env.SANITIZE_LEGACY; process.env.SANITIZE_LEGACY='1'; try { return await fn(); } finally { if(prior===undefined)delete process.env.SANITIZE_LEGACY;else process.env.SANITIZE_LEGACY=prior; } };

test('news OpenAI defaults to the boundary filter and keeps historic bytes behind SANITIZE_LEGACY=1', async () => {
  const payload={content:'ไม่อยากตาย ยาฆ่าเชื้อ ผูกคอแต่ช่วยทัน กระโดดตึกแต่รอด',nested:['ฆ่าตัวตาย']};
  globalThis.__goldenSharedPayload=payload;
  const args={prompt:'transport fixture',model:'gpt-5.6-sol',maxTokens:500,allowModelFallback:false,maxRetries:0};
  delete process.env.SANITIZE_LEGACY;
  const news=await newsOpenAI.callAI(args);
  assert.deepEqual(news,newsFilter.sanitizeOutput(payload));
  // ★ 24 ก.ย. 69 (S1): ข่าวต้องไม่ยืนยันการตายที่ต้นฉบับไม่มี และไม่กินกลางคำ (ยาฆ่าเชื้อ/ไม่อยากตาย คงเดิม)
  assert.equal(news.content,'ไม่อยากตาย ยาฆ่าเชื้อ ทำร้ายตัวเองแต่ช่วยทัน ตกจากที่สูงแต่รอด');
  assert.deepEqual(news.nested,['จากไปอย่างน่าเศร้า']);
  const legacy=await withLegacy(()=>newsOpenAI.callAI(args));
  assert.equal(legacy.content,NEWS_LEGACY_CONTENT,'SANITIZE_LEGACY=1 ต้องคืนไบต์เดิมของฝั่งข่าว');
  assert.deepEqual(legacy.nested,NEWS_LEGACY_NESTED);
  assert.notDeepEqual(legacy,news);
});

test('historic news legacy flag accepts only literal 1', async () => {
  const news=await import('../src/lib/ai/legacyLengthRules.js');
  const prior=process.env.LEGACY_LENGTH_RULES;
  try {
    process.env.LEGACY_LENGTH_RULES=' true ';
    assert.equal(news.isLegacyLengthOn(),false);
    process.env.LEGACY_LENGTH_RULES='1';
    assert.equal(news.isLegacyLengthOn(),true);
  } finally { if(prior===undefined)delete process.env.LEGACY_LENGTH_RULES;else process.env.LEGACY_LENGTH_RULES=prior; }
});

test('news services never import the clip clients (services/clipAI was removed with the legacy clip engine)', () => {
  const read=p=>fs.readFileSync(new URL(p,root),'utf8');
  for(const p of ['src/lib/services/autoFlowServiceText.js','src/lib/services/summarizeServiceText.js','src/lib/services/summarizeService.js','src/lib/ai/aiRouter.js']) assert.doesNotMatch(read(p),/clipAI/);
  assert.equal(fs.existsSync(new URL('src/lib/services/clipAI',root)),false);
});
test('news Gemini defaults to the boundary filter and keeps historic bytes behind SANITIZE_LEGACY=1', async () => {
  const newsGemini=await import('../src/lib/ai/geminiClient.js');
  const payload={content:'ไม่อยากตาย ยาฆ่าเชื้อ ผูกคอแต่ช่วยทัน กระโดดตึกแต่รอด',nested:['ฆ่าตัวตาย']};
  globalThis.__goldenSharedPayload=payload;
  const args={prompt:'transport fixture',maxTokens:500};
  delete process.env.SANITIZE_LEGACY;
  const news=await newsGemini.callGemini(args);
  assert.deepEqual(news,newsFilter.sanitizeOutput(payload));
  assert.equal(news.content,'ไม่อยากตาย ยาฆ่าเชื้อ ทำร้ายตัวเองแต่ช่วยทัน ตกจากที่สูงแต่รอด');
  assert.deepEqual(news.nested,['จากไปอย่างน่าเศร้า']);
  const legacy=await withLegacy(()=>newsGemini.callGemini(args));
  assert.equal(legacy.content,NEWS_LEGACY_CONTENT,'SANITIZE_LEGACY=1 ต้องคืนไบต์เดิมของฝั่งข่าว');
  assert.deepEqual(legacy.nested,NEWS_LEGACY_NESTED);
  assert.notDeepEqual(legacy,news);
});

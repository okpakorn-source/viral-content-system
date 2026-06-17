/**
 * ★ Casting Service (17 มิ.ย. 69) — ระบบทดสอบ "เซนส์ข่าว" ผู้สมัครงาน (แยกระบบ public 100%)
 *  คลังคำถาม: ดึงหัวข้อ+แคปชั่นไวรัลจริงจาก generation_logs (=เฉลยดีสุด) + AI แต่งตัวลวง ปานกลาง/แย่
 *  ★ ไม่แตะเวิร์กโฟลว์เขียน — แค่ "อ่าน" คลังเจนมาทำแบบทดสอบ
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';
import { createStore } from '@/lib/persistStore';
import { getSupabase } from '@/lib/supabase';
import { randomUUID } from 'crypto';

export const QUALITY_SCORE = { best: 1, medium: 0.5, bad: 0 };
const rid = () => randomUUID().slice(0, 8);
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

// ── อ่านเคสเจนที่ดี → เลือกหัวข้อหลากหลาย + hook แข็งแรง (เฉลยดีสุด) ──
async function pickGoodCases(limit) {
  const sb = getSupabase();
  const { data } = await sb.from('generation_logs')
    .select('news_title,versions,status,breakdown').order('created_at', { ascending: false }).limit(400);
  const rows = data || [];
  // good ก่อน แล้วค่อย unreviewed (bad ตัดทิ้ง)
  rows.sort((a, b) => (b.status === 'good' ? 1 : 0) - (a.status === 'good' ? 1 : 0));
  const cases = []; const seen = new Set();
  for (const r of rows) {
    if (r.status === 'bad') continue;
    const v = (r.versions || [])[0];
    const title = String(r.news_title || '').trim();
    const hook = String(v?.hook || v?.content || '').replace(/\s+/g, ' ').trim();
    if (title.length < 12 || hook.length < 40) continue;
    const key = title.slice(0, 22);
    if (seen.has(key)) continue;
    seen.add(key);
    cases.push({ title, bestHook: hook.slice(0, 320), core: String(r.breakdown?.coreStory || r.breakdown?.core_story || '').slice(0, 200) });
    if (cases.length >= limit) break;
  }
  return cases;
}

// ── AI แต่งตัวลวง: ปานกลาง (จืด) + แย่ (มุมผิด/งง) สำหรับข่าวเดียวกัน ──
async function genDistractors(c) {
  const prompt = `คุณเป็นบรรณาธิการเพจข่าวไวรัล กำลังสร้างแบบทดสอบ "เซนส์การเลือกแคปชั่น" ให้ผู้สมัครงาน

หัวข้อข่าว: ${c.title}
แคปชั่นที่ "ดีที่สุด" (เฉลย) คือ:
"${c.bestHook}"

ช่วยแต่งแคปชั่นเปิดโพสต์อีก 2 แบบสำหรับข่าวเดียวกัน เพื่อเป็น "ตัวลวง":
1. "medium" = ถูกประเด็น แต่ "จืด/ธรรมดา" ไม่มีฮุกดึงอารมณ์ (เล่าตรงๆ แบนๆ เหมือนรายงานข่าวเฉยๆ)
2. "bad"    = "ไม่ดี/งงๆ" — เลือกมุมผิด/เร้าผิดจุด/ทื่อ/คลิกเบตหลุดประเด็น/โทนไม่เข้ากับเนื้อข่าว

กฎ: ความยาวใกล้เคียงเฉลย · ภาษาไทย · ทั้งคู่ต้อง "ด้อยกว่าเฉลยชัดเจน" (ห้ามดีเท่าหรือดีกว่า) · เป็นแคปชั่นข่าวเดียวกัน
ตอบ JSON เท่านั้น: {"medium":"...","bad":"..."}`;
  const res = await callAI({ prompt, model: MODEL_FAST, temperature: 0.75, maxTokens: 900 });
  const p = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
  const medium = String(p.medium || '').trim();
  const bad = String(p.bad || '').trim();
  if (medium.length < 15 || bad.length < 15) throw new Error('distractor สั้นผิดปกติ');
  return { medium: medium.slice(0, 420), bad: bad.slice(0, 420) };
}

// ── สร้าง/รีเฟรชคลังคำถาม ──
export async function buildQuestionBank({ limit = 35 } = {}) {
  const cases = await pickGoodCases(limit + 10); // เผื่อบางอันแต่งตัวลวงล้ม
  const questions = [];
  for (const c of cases) {
    if (questions.length >= limit) break;
    try {
      const d = await genDistractors(c);
      questions.push({
        id: randomUUID(),
        newsTitle: c.title,
        // ★ choice id สุ่ม + เก็บ quality ไว้ฝั่งเซิร์ฟเวอร์ (ไม่ส่งให้ client) — กันเดาเฉลย
        choices: shuffle([
          { id: rid(), text: c.bestHook, quality: 'best' },
          { id: rid(), text: d.medium, quality: 'medium' },
          { id: rid(), text: d.bad, quality: 'bad' },
        ]),
        createdAt: new Date().toISOString(),
      });
    } catch (e) { console.warn('[Casting] skip case:', e.message?.slice(0, 50)); }
  }
  if (questions.length === 0) throw new Error('สร้างคำถามไม่ได้เลย — คลังเจนอาจว่าง');
  const store = createStore('casting-questions');
  const old = await store.getAll();
  for (const o of old) await store.remove(o.id).catch(() => {});
  await store.addMany(questions);
  return { built: questions.length };
}

// ── ดึงคำถามสำหรับผู้ทำ (ซ่อน quality, สุ่มลำดับ choice) ──
export async function getQuizForApplicant() {
  const store = createStore('casting-questions');
  const all = await store.getAll();
  return shuffle(all).map(q => ({
    id: q.id,
    newsTitle: q.newsTitle,
    choices: shuffle((q.choices || []).map(ch => ({ id: ch.id, text: ch.text }))),
  }));
}

// ── ให้คะแนนฝั่งเซิร์ฟเวอร์ + บันทึกผล ──
export async function scoreAndSave({ name, answers }) {
  const store = createStore('casting-questions');
  const all = await store.getAll();
  const byId = new Map(all.map(q => [q.id, q]));
  const detail = [];
  let total = 0;
  for (const a of (answers || [])) {
    const q = byId.get(a.questionId);
    if (!q) continue;
    const ch = (q.choices || []).find(c => c.id === a.choiceId);
    const quality = ch?.quality || 'bad';
    const score = QUALITY_SCORE[quality] ?? 0;
    total += score;
    detail.push({ newsTitle: q.newsTitle, chosenQuality: quality, score, chosenText: ch?.text || '' });
  }
  const maxScore = all.length; // 1 คะแนน/ข้อ
  const result = {
    id: randomUUID(),
    name: String(name || 'ไม่ระบุชื่อ').slice(0, 60),
    total: Math.round(total * 10) / 10,
    maxScore,
    percent: maxScore ? Math.round((total / maxScore) * 100) : 0,
    answered: detail.length,
    detail,
    completedAt: new Date().toISOString(),
  };
  try {
    const rStore = createStore('casting-results');
    await rStore.add(result);
    const allR = await rStore.getAll();
    if (allR.length > 500) { // เก็บ 500 ผลล่าสุด
      const oldR = allR.sort((x, y) => new Date(x.completedAt) - new Date(y.completedAt)).slice(0, allR.length - 500);
      for (const o of oldR) await rStore.remove(o.id).catch(() => {});
    }
  } catch (e) { console.warn('[Casting] save result fail:', e.message?.slice(0, 50)); }
  return result;
}

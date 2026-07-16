/**
 * =====================================================
 * 🌊 Saga Tracker — เกาะซากากระแสใหญ่ระดับชาติ (2 ก.ค. 69)
 * =====================================================
 * ที่มา: วิเคราะห์โพสต์จริงเพจ 949 โพสต์ เดือน มิ.ย. 69 — "เกาะซากากระแสใหญ่" คือธีมแชมป์
 *   (median 21,372 รีแอกชัน, 53% แตะ 2 หมื่น) เช่น ป้าขยันหวย 6 ล้าน / ถ้ำ-เหมือง / น้องตชด.
 *   สูตรที่ชนะ = 1 กระแสใหญ่ → ซีรีส์ 5-15 โพสต์ ไล่ตามตัวละครข้างเคียงทีละคน (ฮีโร่/ผู้ให้/มุมน้ำใจ)
 * หน้าที่:
 *   1) detectSagas() — สแกนโต๊ะหา "กระแสใหญ่ที่กำลังเกิด" (เรื่องเดียวกันหลายสำนัก/หลายใบ) → AI ยืนยัน+แตกตัวละคร
 *   2) getSagaQueries() — ทุกรอบ harvest สร้างคำค้นตามตัวละคร/มุมข้างเคียงของซากาที่ยัง active
 *   3) updateSagaActivity() — นับความเคลื่อนไหว, เงียบเกิน 3 วัน = ปิดซากาเอง
 *   + เพิ่มซากาเองได้ (ทีมเห็นกระแสก่อนระบบ) ผ่าน /api/news-desk/saga
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง — ไม่แตะระบบเขียนข่าว/ถอดประเด็น/ทำปก
 */

import crypto from 'crypto';
import { createStore } from '@/lib/persistStore';
import { callAI } from '@/lib/ai/openai';
import { storySignature } from './taxonomy';

const MAX_ACTIVE = 4;            // ซากา active พร้อมกันสูงสุด (คุมต้นทุน Serper)
const IDLE_HOURS_DEACTIVATE = 72; // เงียบเกิน 3 วัน = กระแสจบ ปิดเอง
const DETECT_EVERY_MS = 2 * 3600e3; // สแกนหาซากาใหม่ทุก ≥2 ชม. (ไม่ยิง AI ทุกรอบ harvest)

const idOfTopic = (t) => 'saga_' + crypto.createHash('md5').update(String(t)).digest('hex').slice(0, 10);

async function getStore() { return createStore('desk-sagas'); }

export async function getAllSagas() {
  try { return (await (await getStore()).getAll()).filter(s => s.id !== '_meta'); } catch { return []; }
}

export async function getActiveSagas() {
  const all = await getAllSagas();
  const now = Date.now();
  return all.filter(s => s.active && (now - new Date(s.lastSeenAt || s.createdAt || 0).getTime()) < IDLE_HOURS_DEACTIVATE * 3600e3);
}

/** เพิ่มซากาเอง (ทีมสั่ง/จากการ detect) — expand ตัวละคร+มุมด้วย AI ถ้ายังไม่มี */
export async function addSaga({ topic, people = [], angles = [] }) {
  const t = String(topic || '').trim().slice(0, 100);
  if (t.length < 3) throw new Error('หัวข้อซากาสั้นเกินไป');
  const store = await getStore();
  const id = idOfTopic(t);
  const existing = (await store.getAll()).find(s => s.id === id);
  if (existing) {
    await store.update(id, (ex) => ({ ...ex, active: true, lastSeenAt: new Date().toISOString() }));
    return { ...existing, active: true, reactivated: true };
  }
  // ยังไม่มีตัวละคร/มุม → ให้ AI แตก (ใช้สมองเดียวกับ trend-track)
  if (!people.length || !angles.length) {
    try {
      const { analyzeTrendKeywords } = await import('./trendTracker');
      const a = await analyzeTrendKeywords(t);
      if (!people.length) people = a.people || [];
      if (!angles.length) angles = (a.keywords || []).filter(k => k !== t);
    } catch (e) { console.log('[SagaTracker] expand ล่ม (ใช้หัวข้อเปล่า):', e.message?.slice(0, 40)); }
  }
  const saga = {
    id, topic: t,
    people: people.slice(0, 8).map(p => String(p).slice(0, 40)),
    angles: angles.slice(0, 8).map(a => String(a).slice(0, 60)),
    active: true, hits: 0,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  await store.add(saga);
  console.log(`[SagaTracker] 🌊 เปิดซากาใหม่: "${t}" ตัวละคร ${saga.people.length} มุม ${saga.angles.length}`);
  return saga;
}

export async function deactivateSaga(id) {
  const store = await getStore();
  await store.update(id, (ex) => ({ ...ex, active: false, closedAt: new Date().toISOString() }));
  return true;
}

/**
 * ★ 3 ก.ค.: 📈 Google Trends ไทย (RSS ฟรี) — ตาอีกดวงที่มองทั้งประเทศ (เดิม detect ได้เฉพาะ cluster บนโต๊ะตัวเอง
 *   = ตาบอดกับกระแสที่คีย์เวิร์ดเราไม่แตะ) · ดึงเทรนด์ traffic สูงเป็น candidate เพิ่ม ให้ AI ตัวเดิมคัดว่าเป็นซากาจริงไหม
 */
async function fetchTrendsTH() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch('https://trends.google.com/trending/rss?geo=TH', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    const dec = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
    const out = [];
    for (const b of (xml.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, 12)) {
      const title = dec((b.match(/<title>([^<]+)</) || [])[1]);
      const traffic = parseInt(String((b.match(/<ht:approx_traffic>([^<]+)</) || [])[1] || '0').replace(/[^\d]/g, '')) || 0;
      const newsTitles = [...b.matchAll(/<ht:news_item_title>([^<]+)</g)].map(m => dec(m[1])).slice(0, 2);
      if (title) out.push({ title, traffic, newsTitles });
    }
    return out;
  } catch { return []; }
}

/**
 * สแกนโต๊ะหา "กระแสใหญ่กำลังเกิด" — เรื่องเดียวกันโผล่หลายใบ/หลายสำนักใน 48 ชม.
 * → AI (gpt-4o-mini) ตัดสินว่าเป็น "ซากาใหญ่ระดับชาติที่ยังไม่จบ" ไหม + แตกตัวละคร/มุมข้างเคียง
 * throttle: รันจริงทุก ≥2 ชม. (เก็บ lastDetectAt ใน row _meta)
 */
export async function detectSagas() {
  const store = await getStore();
  const all = await store.getAll();
  const meta = all.find(s => s.id === '_meta');
  if (meta && Date.now() - new Date(meta.lastDetectAt || 0).getTime() < DETECT_EVERY_MS) {
    return { skipped: true, reason: 'ยังไม่ถึงรอบสแกน (ทุก 2 ชม.)' };
  }
  try {
    if (meta) await store.update('_meta', (ex) => ({ ...ex, lastDetectAt: new Date().toISOString() }));
    else await store.add({ id: '_meta', lastDetectAt: new Date().toISOString() });
  } catch { /* meta พังไม่เป็นไร — แค่สแกนถี่ขึ้น */ }

  const activeCount = (await getActiveSagas()).length;
  if (activeCount >= MAX_ACTIVE) return { skipped: true, reason: `ซากา active เต็ม (${activeCount}/${MAX_ACTIVE})` };

  // ── หา cluster เรื่องเดียวกันจากโต๊ะ 48 ชม.ล่าสุด ──
  const desk = createStore('news-desk');
  const cutoff = Date.now() - 48 * 3600e3;
  const recent = (await desk.getAll()).filter(i =>
    new Date(i.harvestedAt || 0).getTime() > cutoff && i.title && i.lane !== 'saga');
  const clusters = new Map(); // signature → items
  for (const it of recent) {
    const sig = it.clusterKey || storySignature(it);
    if (!sig || sig.split('|').filter(Boolean).length < 2) continue;
    if (!clusters.has(sig)) clusters.set(sig, []);
    clusters.get(sig).push(it);
  }
  // สัญญาณกระแสใหญ่: เรื่องเดียวกัน ≥3 ใบ หรือ มี altSources ≥2 (หลายสำนักรายงาน)
  const candidates = [];
  for (const items of clusters.values()) {
    const altMax = Math.max(...items.map(i => (i.altSources || []).length), 0);
    if (items.length >= 3 || altMax >= 2) {
      const best = items.sort((a, b) => (b.judgeScore || 0) - (a.judgeScore || 0))[0];
      candidates.push({ titles: items.slice(0, 3).map(i => String(i.title).slice(0, 90)), score: items.length * 2 + altMax + (best.judgeScore || 0) });
    }
  }
  // ★ 3 ก.ค.: เติม candidate จาก Google Trends ไทย (traffic ≥2000 = คนค้นจริงทั้งประเทศ) — AI คัดขั้นสุดท้ายเหมือนกัน
  try {
    const trends = await fetchTrendsTH();
    for (const t of trends.filter(x => x.traffic >= 2000)) {
      candidates.push({ titles: [t.title, ...t.newsTitles].filter(Boolean), score: 5 + Math.min(30, t.traffic / 1000), _fromTrends: true });
    }
    if (trends.length) console.log(`[SagaTracker] 📈 Google Trends TH: ${trends.length} เทรนด์ (traffic≥2k เข้ารอบ ${trends.filter(x => x.traffic >= 2000).length})`);
  } catch { /* trends ล่ม = ใช้ cluster โต๊ะอย่างเดียว */ }

  if (!candidates.length) return { detected: 0, reason: 'ไม่พบ cluster กระแสใหญ่' };
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 5);

  // ── ให้ AI ยืนยัน + แตกตัวละคร/มุม (1 คอลเดียวทั้งชุด) ──
  const existingTopics = (await getAllSagas()).map(s => s.topic).join(' | ') || '(ยังไม่มี)';
  const list = top.map((c, i) => `${i}: ${c.titles.join(' / ')}`).join('\n');
  let parsed;
  try {
    const res = await callAI({
      prompt: `คุณคือบรรณาธิการข่าวไทย หน้าที่: ดูกลุ่มพาดหัวข่าวที่โผล่ซ้ำหลายสำนักใน 48 ชม. แล้วตัดสินว่ากลุ่มไหนเป็น "ซากากระแสใหญ่ระดับชาติที่ยังดำเนินอยู่" (เหตุการณ์ที่คนทั้งประเทศตามต่อเนื่องหลายวัน มีตัวละครหลายคน มีพัฒนาการรายวัน เช่น ภารกิจกู้ภัยใหญ่ คดีดังที่สังคมลุ้น ดราม่าใหญ่ในรายการดัง) — ไม่ใช่ข่าวทั่วไปที่จบในตัว
กลุ่มพาดหัว:
${list}
ซากาที่ติดตามอยู่แล้ว (อย่าเสนอซ้ำ): ${existingTopics}
ตอบ JSON เท่านั้น: {"sagas":[{"i":0,"big":true/false,"topic":"ชื่อซากาสั้น 3-8 คำ","people":["ตัวละครที่เกี่ยว 3-8 คน/ฝ่าย"],"angles":["มุมค้นหาตัวละครข้างเคียง/น้ำใจ/ฮีโร่ 4-6 มุม เช่น 'กู้ภัยอาสา ช่วยเหลือ', 'ครอบครัวผู้ประสบภัย ล่าสุด'"]}]}
- big=true เฉพาะซากาใหญ่จริง (คนทั้งประเทศตาม + ยังไม่จบ) — เข้มงวด อย่าเหมาข่าวธรรมดาเป็นซากา`,
      model: 'gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 900,
    });
    parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch (e) {
    console.log('[SagaTracker] detect AI ล่ม:', e.message?.slice(0, 50));
    return { detected: 0, error: e.message?.slice(0, 60) };
  }

  let opened = 0;
  const room = MAX_ACTIVE - activeCount;
  for (const s of (parsed?.sagas || [])) {
    if (opened >= room) break;
    if (s.big !== true || !s.topic) continue;
    try {
      await addSaga({ topic: s.topic, people: s.people || [], angles: s.angles || [] });
      opened++;
    } catch (e) { console.log('[SagaTracker] เปิดซากาไม่สำเร็จ:', e.message?.slice(0, 40)); }
  }
  return { detected: opened, scanned: top.length };
}

/**
 * สร้างคำค้นของรอบนี้จากซากาที่ active — หมุนตัวละคร/มุมตามชั่วโมง (แต่ละรอบได้คนละชุด)
 * @returns {Array<{q, lane, timeRange, endpoint, sagaId, sagaTopic}>}
 */
export async function getSagaQueries(maxPerSaga = 4) {
  const sagas = await getActiveSagas();
  if (!sagas.length) return [];
  const slot = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (const s of sagas.slice(0, MAX_ACTIVE)) {
    const qs = [];
    qs.push(`${s.topic} ล่าสุด`);
    const ppl = s.people || [];
    for (let i = 0; i < Math.min(2, ppl.length); i++) qs.push(`"${ppl[(slot + i) % ppl.length]}" ล่าสุด`);
    const ang = s.angles || [];
    if (ang.length) qs.push(`${s.topic} ${ang[slot % ang.length]}`);
    for (const q of qs.slice(0, maxPerSaga)) {
      out.push({ q, lane: 'saga', timeRange: 'qdr:d', endpoint: 'news', sagaId: s.id, sagaTopic: s.topic });
    }
  }
  return out;
}

/** หลังลงคลัง: นับความเคลื่อนไหวซากา + ปิดซากาที่เงียบเกิน 3 วัน */
export async function updateSagaActivity(addedItems = []) {
  const sagas = await getAllSagas();
  if (!sagas.length) return;
  const store = await getStore();
  const now = new Date().toISOString();
  for (const s of sagas) {
    if (!s.active) continue;
    const tokens = [s.topic, ...(s.people || [])].map(t => String(t).replace(/["\s]/g, '')).filter(t => t.length >= 3);
    const matched = addedItems.filter(it => {
      const title = String(it.title || '').replace(/\s/g, '');
      return it.sagaId === s.id || tokens.some(tk => title.includes(tk.slice(0, 12)));
    }).length;
    if (matched > 0) {
      await store.update(s.id, (ex) => ({ ...ex, hits: (ex.hits || 0) + matched, lastSeenAt: now })).catch(() => {});
    } else if (Date.now() - new Date(s.lastSeenAt || s.createdAt || 0).getTime() > IDLE_HOURS_DEACTIVATE * 3600e3) {
      await store.update(s.id, (ex) => ({ ...ex, active: false, closedAt: now })).catch(() => {});
      console.log(`[SagaTracker] 💤 ปิดซากาเงียบ 3 วัน: "${s.topic}" (hits รวม ${s.hits || 0})`);
    }
  }
}

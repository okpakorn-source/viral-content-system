/**
 * =====================================================
 * 🕵️ Image Hunt — สืบหาภาพจากเนื้อหาข่าว (3 ก.ค. 69)
 * =====================================================
 * โจทย์ผู้ใช้: วางเนื้อหาข่าว → กดสืบ → AI วิเคราะห์ตัวละคร/เหตุการณ์แม่นๆ →
 *   ล่าภาพทุกแหล่ง (Google Images / YouTube เน้นแคปเฟรม / TikTok / ข่าว) →
 *   สมองวิชั่นคัดภาพขยะออก (text ทับคน/ลายน้ำใหญ่/คอลลาจ/เบลอ/มีม) →
 *   เก็บ "คลังเคส" (image-hunt-cases) เรียกดูย้อนหลังได้
 * 🔴 ระบบเดี่ยว — ไม่ import เซอร์วิสท่อปก/ท่อข่าวอัตโนมัติ (กฎเหล็กผู้ใช้: ห้ามแตะ)
 */

import crypto from 'crypto';
import { createStore } from '@/lib/persistStore';

const STORE = 'image-hunt-cases';
const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');

// ════════════════════════════════════════════════════
// STEP 1 — 🧠 วิเคราะห์เนื้อหา: ตัวละคร (ชื่อจริง/ชื่อเล่น) + เหตุการณ์ + คำค้นรายแหล่ง
// ════════════════════════════════════════════════════
async function openaiJSON({ model = 'gpt-4o', messages, maxTokens = 1600, temperature = 0.2 }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

export async function analyzeContent(content) {
  const parsed = await openaiJSON({
    model: 'gpt-4o',
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: `คุณคือนักสืบภาพข่าวไทย วิเคราะห์เนื้อหาข่าวนี้อย่างละเอียดเพื่อไปตามหา "ภาพประกอบทำปกข่าว"

=== เนื้อหาข่าว ===
${String(content).slice(0, 4000)}
=== จบเนื้อหา ===

ตอบ JSON เท่านั้น:
{"title":"ชื่อเคสสั้น 4-10 คำ",
"people":[{"name":"ชื่อ-นามสกุลเต็มที่คนใช้ค้น","nick":"ชื่อเล่น/ฉายา","role":"ตัวเอก|ตัวรอง|ผู้เกี่ยวข้อง","who":"เขาคือใคร 1 วลี (เช่น นักแสดงหญิง GDH)"}],
"entities":["สิ่ง/สถานที่/แบรนด์/ของ ที่เป็นภาพได้ (เช่น บ้านหลังใหม่ 20 ล้าน, แบรนด์เครื่องสำอาง GALA CAMILLE)"],
"events":["เหตุการณ์/โมเมนต์ที่ควรมีภาพ (เช่น มอบบ้านให้แม่, ดูแลคุณยายป่วย)"],
"queries":{
 "images":["คำค้น Google Images 4-6 คำค้น — ชื่อคน เดี่ยวๆ และ ชื่อคน+เหตุการณ์/entity"],
 "videos":["คำค้น YouTube 3-4 คำค้น — สัมภาษณ์/รายการ/vlog ของตัวละคร (จะเอาแคปเฟรม)"],
 "tiktok":["คำค้น TikTok 2-3 คำค้น"],
 "news":["คำค้นข่าว 2-3 คำค้น (เอาภาพจากสำนักข่าว)"]}}
กติกาสำคัญ:
- people ต้องแม่น: ชื่อสะกดแบบที่สื่อไทยใช้จริง (มีทั้งชื่อเล่น+ชื่อจริง) — ตัวเอกมาก่อน
- คำค้นทุกตัวเป็นภาษาไทย (เว้นชื่อแบรนด์ที่เป็นอังกฤษ) สั้น คม ค้นแล้วเจอจริง
- events เอาเฉพาะที่ "ถ่ายเป็นภาพได้จริง" ไม่เอานามธรรม`,
    }],
  });
  return {
    title: String(parsed.title || '').slice(0, 80) || 'เคสไม่มีชื่อ',
    people: (parsed.people || []).slice(0, 5).map(p => ({
      name: String(p.name || '').slice(0, 60), nick: String(p.nick || '').slice(0, 30),
      role: String(p.role || '').slice(0, 20), who: String(p.who || '').slice(0, 60),
    })).filter(p => p.name),
    entities: (parsed.entities || []).slice(0, 6).map(e => String(e).slice(0, 80)),
    events: (parsed.events || []).slice(0, 6).map(e => String(e).slice(0, 80)),
    queries: {
      images: (parsed.queries?.images || []).slice(0, 6).map(q => String(q).slice(0, 70)),
      videos: (parsed.queries?.videos || []).slice(0, 4).map(q => String(q).slice(0, 70)),
      tiktok: (parsed.queries?.tiktok || []).slice(0, 3).map(q => String(q).slice(0, 70)),
      news: (parsed.queries?.news || []).slice(0, 3).map(q => String(q).slice(0, 70)),
    },
  };
}

// ════════════════════════════════════════════════════
// STEP 2 — 🔍 ล่าภาพหลายแหล่งขนาน (Serper images/videos/news + TikTok oEmbed + แคปเฟรม YouTube)
// ════════════════════════════════════════════════════
async function serper(endpoint, q, num = 10) {
  const res = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: 'th', hl: 'th', num }),
  });
  if (!res.ok) throw new Error(`Serper ${endpoint} ${res.status}`);
  return res.json();
}

const ytId = (url) => (String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || [])[1] || null;

/** TikTok oEmbed → thumbnail (แคปหน้าปกคลิป) — ฟรี ไม่ต้องคีย์ */
async function tiktokThumb(url) {
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j.thumbnail_url || null;
  } catch { return null; }
}

export async function searchAllSources(analysis, { onLog = () => {} } = {}) {
  const found = [];
  const push = (arr) => { for (const x of arr) if (x && x.url) found.push(x); };

  const tasks = [];
  // 📷 Google Images — ภาพถ่าย/ภาพข่าวตรงตัว
  for (const q of analysis.queries.images) {
    tasks.push(serper('images', q, 10).then(d => push((d.images || []).map(im => ({
      url: im.imageUrl, w: im.imageWidth, h: im.imageHeight,
      origin: im.link || '', originTitle: String(im.title || '').slice(0, 90),
      source: 'google-images', kind: 'photo', query: q,
    })))).catch(e => onLog(`images "${q.slice(0, 25)}" ล่ม: ${e.message.slice(0, 30)}`)));
  }
  // 🎞️ YouTube — "แคปเฟรม": ทุกคลิปดึง 4 เฟรม (hq1/hq2/hq3 = เฟรมจริงคนละช่วง + hqdefault)
  for (const q of analysis.queries.videos) {
    tasks.push(serper('videos', q, 6).then(d => {
      for (const v of (d.videos || [])) {
        const id = ytId(v.link || '');
        if (!id) continue;
        const frames = [
          { f: 'maxresdefault', kind: 'thumb' }, { f: 'hq1', kind: 'frame' }, { f: 'hq2', kind: 'frame' }, { f: 'hq3', kind: 'frame' },
        ];
        push(frames.map(({ f, kind }) => ({
          url: `https://i.ytimg.com/vi/${id}/${f}.jpg`,
          origin: v.link, originTitle: String(v.title || '').slice(0, 90),
          source: 'youtube', kind, query: q, videoId: id,
        })));
      }
    }).catch(e => onLog(`videos "${q.slice(0, 25)}" ล่ม: ${e.message.slice(0, 30)}`)));
  }
  // 🎵 TikTok — site: search → oEmbed thumbnail (แคปหน้าปกคลิป)
  for (const q of analysis.queries.tiktok) {
    tasks.push(serper('search', `${q} site:tiktok.com`, 8).then(async d => {
      const links = (d.organic || []).map(o => o.link).filter(u => /tiktok\.com\/@[^/]+\/video\//.test(u)).slice(0, 5);
      const thumbs = await Promise.all(links.map(async u => ({ u, t: await tiktokThumb(u) })));
      push(thumbs.filter(x => x.t).map(x => ({
        url: x.t, origin: x.u, originTitle: '', source: 'tiktok', kind: 'frame', query: q,
      })));
    }).catch(e => onLog(`tiktok "${q.slice(0, 25)}" ล่ม: ${e.message.slice(0, 30)}`)));
  }
  // 📰 ภาพจากสำนักข่าว
  for (const q of analysis.queries.news) {
    tasks.push(serper('news', q, 8).then(d => push((d.news || []).filter(n => n.imageUrl).map(n => ({
      url: n.imageUrl, origin: n.link || '', originTitle: String(n.title || '').slice(0, 90),
      source: 'news', kind: 'photo', query: q,
    })))).catch(e => onLog(`news "${q.slice(0, 25)}" ล่ม: ${e.message.slice(0, 30)}`)));
  }
  await Promise.all(tasks);

  // dedupe: url ซ้ำ + จำกัดเฟรมต่อวิดีโอไม่ให้ยึดโควตา
  const seen = new Set(); const out = []; const perVideo = {};
  for (const im of found) {
    const key = md5(im.url);
    if (seen.has(key)) continue;
    if (im.videoId) { perVideo[im.videoId] = (perVideo[im.videoId] || 0) + 1; if (perVideo[im.videoId] > 4) continue; }
    seen.add(key);
    out.push({ ...im, id: key.slice(0, 10) });
  }
  return out;
}

// ════════════════════════════════════════════════════
// STEP 3 — 🧹 สมองคัดภาพ (vision): ตัดขยะ (text ทับคน/ลายน้ำ/คอลลาจ/เบลอ/มีม) + เช็คคนตรง + ให้บทบาทปก
// ════════════════════════════════════════════════════
export async function qcImages(images, analysis, { batchSize = 5, maxQc = 35, onLog = () => {} } = {}) {
  // ★ สลับคิวแบบ round-robin ตามแหล่ง — เทสจริง: youtube เฟรมมาเป็นกอง 80 ใบ ถ้าเรียงตามลำดับเจอ
  //   แหล่งอื่น (google/news/tiktok) จะไม่ได้โควตา QC เลย → แบ่งรอบละ 1 ใบต่อแหล่งวนไป
  const bySource = {};
  for (const im of images) (bySource[im.source] = bySource[im.source] || []).push(im);
  const buckets = Object.values(bySource);
  const interleaved = [];
  for (let i = 0; interleaved.length < images.length; i++) {
    for (const b of buckets) if (b[i]) interleaved.push(b[i]);
    if (i > images.length) break;
  }
  const toQc = interleaved.slice(0, maxQc);
  const peopleDesc = analysis.people.map(p => `${p.name}${p.nick ? ` (${p.nick})` : ''} — ${p.who}`).join(' · ') || 'ไม่ระบุ';
  const ctx = `ตัวละครที่ต้องการ: ${peopleDesc}\nเหตุการณ์/สิ่งที่เกี่ยว: ${[...analysis.events, ...analysis.entities].join(' · ').slice(0, 300)}`;
  const results = [];

  const runBatch = async (chunk) => {
    const content = [
      {
        type: 'text',
        text: `คุณคือ QC ภาพปกข่าวไทย ประเมินภาพ ${chunk.length} ภาพต่อไปนี้ (เรียงลำดับ 0-${chunk.length - 1})
${ctx}

ต่อภาพ ตอบ JSON: {"items":[{"i":0,"person":"match|maybe|no|none","clean":true/false,"dirt":"สิ่งสกปรกที่เจอ ('' ถ้าสะอาด)","role":"hero|scene|detail|reaction|none","score":0-10,"why":"สั้นๆ"}]}
เกณฑ์:
- person: match=คนในภาพคือตัวละครที่ต้องการชัดเจน · maybe=น่าจะใช่ไม่ชัวร์ · no=คนละคนชัดๆ · none=ไม่มีคน (ภาพสถานที่/ของ)
- clean=false เมื่อ: มีตัวอักษร/กราฟิกทับตัวคนหรือกินพื้นที่มาก · ลายน้ำ/โลโก้ใหญ่ · เป็นภาพคอลลาจ/ตารางหลายรูป · เบลอ/ละลาย · เป็นมีม/สกรีนช็อตแชท · ขอบดำหนา
  (โลโก้ช่องเล็กๆ มุมภาพ หรือ subtitle บรรทัดเดียวขอบล่าง = ยังถือว่า clean ได้ถ้าตัวคนเด่นชัด)
- role: hero=หน้าชัดใหญ่ อารมณ์ดี ทำภาพหลักได้ · scene=ฉาก/เหตุการณ์/เต็มตัว · detail=ของ/สถานที่/หลักฐาน (บ้าน/สินค้า/ป้าย) · reaction=สีหน้าอารมณ์ · none=ใช้ไม่ได้
- score = ความน่าใช้ทำปก (คม สะอาด องค์ประกอบดี คนตรง) — person=no ให้ ≤2 · ภาพ none/สกปรกมาก ให้ 0-3`,
      },
      ...chunk.map(im => ({ type: 'image_url', image_url: { url: im.url, detail: 'low' } })),
    ];
    try {
      const parsed = await openaiJSON({ model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 1200, messages: [{ role: 'user', content }] });
      for (const r of (parsed.items || [])) {
        const im = chunk[r.i];
        if (!im) continue;
        results.push({
          ...im,
          person: ['match', 'maybe', 'no', 'none'].includes(r.person) ? r.person : 'maybe',
          clean: r.clean !== false,
          dirt: String(r.dirt || '').slice(0, 80),
          role: ['hero', 'scene', 'detail', 'reaction', 'none'].includes(r.role) ? r.role : 'none',
          score: Math.min(10, Math.max(0, Number(r.score) || 0)),
          why: String(r.why || '').slice(0, 100),
        });
      }
      // ภาพที่ vision ไม่ตอบ (โหลดไม่ได้/URL ตาย) = ทิ้งเงียบ
    } catch (e) {
      onLog(`QC batch ล่ม: ${e.message.slice(0, 50)}`);
    }
  };

  const chunks = [];
  for (let i = 0; i < toQc.length; i += batchSize) chunks.push(toQc.slice(i, i + batchSize));
  // ยิงขนานทีละ 3 ก้อน — เร็วแต่ไม่ชน rate limit
  for (let i = 0; i < chunks.length; i += 3) await Promise.all(chunks.slice(i, i + 3).map(runBatch));
  return results;
}

// ════════════════════════════════════════════════════
// STEP 4 — 💾 คลังเคส (case-by-case)
// ════════════════════════════════════════════════════
async function nextCaseId() {
  try {
    const all = await createStore(STORE).getAll();
    const nums = all.map(c => Number(String(c.id).replace(/\D/g, ''))).filter(n => n > 0);
    return 'IH-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
  } catch { return 'IH-' + Date.now().toString().slice(-6); }
}

/**
 * 🕵️ รันสืบครบวงจร: วิเคราะห์ → ล่า → คัด → เก็บเคส
 */
export async function runHunt(content, { caseName = '', keepMin = 5 } = {}) {
  const t0 = Date.now();
  const logs = [];
  const onLog = (m) => { logs.push(m); console.log('[ImageHunt]', m); };

  onLog('🧠 วิเคราะห์เนื้อหา (ตัวละคร/เหตุการณ์/คำค้น)...');
  const analysis = await analyzeContent(content);
  onLog(`ตัวละคร ${analysis.people.length} คน: ${analysis.people.map(p => p.nick || p.name).join(', ')} · คำค้นรวม ${Object.values(analysis.queries).flat().length}`);

  onLog('🔍 ล่าภาพจากทุกแหล่ง (Google/YouTube เฟรม/TikTok/ข่าว)...');
  const rawImages = await searchAllSources(analysis, { onLog });
  const bySrc = {};
  for (const im of rawImages) bySrc[im.source] = (bySrc[im.source] || 0) + 1;
  onLog(`เจอดิบ ${rawImages.length} ภาพ (${Object.entries(bySrc).map(([k, v]) => `${k}:${v}`).join(' · ')})`);

  onLog('🧹 สมองวิชั่นคัดภาพ (ตัด text ทับคน/ลายน้ำ/คอลลาจ/เบลอ/คนไม่ตรง)...');
  const qced = await qcImages(rawImages, analysis, { onLog });
  // เกณฑ์เก็บ: สะอาด + คนตรง (match/maybe) หรือเป็นภาพ detail ของ entity + คะแนน ≥5
  let kept = qced.filter(im => im.clean && im.person !== 'no' && im.role !== 'none' && im.score >= 5);
  // ถ้าคัดโหดจนเหลือน้อยกว่า keepMin → ผ่อนเกณฑ์ (เอา score สูงสุดที่เหลือ ติดป้าย borderline)
  if (kept.length < keepMin) {
    const spare = qced.filter(im => !kept.includes(im) && im.person !== 'no' && im.score >= 3)
      .sort((a, b) => b.score - a.score).slice(0, keepMin - kept.length)
      .map(im => ({ ...im, borderline: true }));
    kept = [...kept, ...spare];
  }
  kept.sort((a, b) => b.score - a.score);
  const rejected = qced.length - kept.filter(k => !k.borderline).length;
  onLog(`ผ่าน QC ${kept.length} ภาพ · คัดทิ้ง ${rejected} · (hero ${kept.filter(i => i.role === 'hero').length} / scene ${kept.filter(i => i.role === 'scene').length} / detail ${kept.filter(i => i.role === 'detail').length})`);

  // เก็บเคส
  const id = await nextCaseId();
  const record = {
    id,
    title: caseName.trim() || analysis.title,
    contentExcerpt: String(content).replace(/\s+/g, ' ').slice(0, 300),
    analysis,
    images: kept.map(({ videoId, ...im }) => im),
    stats: { raw: rawImages.length, qced: qced.length, kept: kept.length, bySource: bySrc, tookSec: Math.round((Date.now() - t0) / 1000) },
    logs: logs.slice(0, 30),
    createdAt: new Date().toISOString(),
  };
  await createStore(STORE).add(record);
  onLog(`💾 เก็บเคส ${id} แล้ว (${Math.round((Date.now() - t0) / 1000)} วิ)`);
  return record;
}

export async function listCases() {
  const all = await createStore(STORE).getAll();
  return all
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .map(c => ({ id: c.id, title: c.title, createdAt: c.createdAt, kept: c.images?.length || 0, people: (c.analysis?.people || []).map(p => p.nick || p.name).slice(0, 3), stats: c.stats }));
}

export async function getCase(id) {
  const all = await createStore(STORE).getAll();
  return all.find(c => c.id === id) || null;
}

export async function deleteCase(id) {
  await createStore(STORE).remove(id);
  return true;
}

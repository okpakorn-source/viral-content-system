/**
 * =====================================================
 * 🧲 Research Extract — ท่อสกัดเนื้อก่อนเขียน (โต๊ะข่าวกลาง v2, Research Engine เฟส 2.0 — R6, 17 ก.ค. 69)
 * =====================================================
 * ต่อจาก R3 (researchLeads.js): ลีดที่กด "สกัดเนื้อ" → ดึงเนื้อดิบเต็มตามประเภทแหล่ง (บทความ/คลิป)
 * → แนบเข้าลีด (remove-แล้ว-add) → กด "ส่งเขียน" = ประกอบข้อความล้วน (ไม่มี URL) ส่งเข้าคิวเขียนข่าว
 * ผ่านสาย "text" ของ /api/queue/add ที่ระบบเปิดไว้ (สาย URL ปิดอยู่ด้วย TEXT_ONLY_MODE — ห้ามพยายาม bypass)
 *
 * 🔴 pure JS + relative import ล้วน (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/)
 * 🔴 ห้ามใช้ persistStore.update() — ใช้แพตเทิร์น remove(id) แล้ว add(ฉบับใหม่) แทนเสมอ (ตาม researchLeads.js)
 * 🔴 ห้ามแก้ researchLeads.js / api/clip-transcript/** / api/queue/** / dnaContract.js — ไฟล์นี้ import/อ่านเท่านั้น
 *
 * contract clip-transcript ที่อ่านมา (สรุปให้ผู้ตรวจเช็คการตีความ):
 *   POST /api/clip-transcript/submit  body:{url,kind?,tidy?,user?} → {success,jobId,status:'pending',position,platform}
 *     (dup: ลิงก์เดียวกันที่ยังทำงานอยู่ใน 3 ชม. → คืน job เดิม {dup:true})
 *   GET  /api/clip-transcript/job-status?id=xxx → {success,status:'pending'|'processing'|'retry_wait'|'done'|'error',
 *     result(เมื่อ done), error(เมื่อ error), position, statusNote, attempts}
 *     — งานประมวลผลจริงทำโดย "เครื่องทีม" (คิว clip-jobs ถูก poll โดยเครื่อง Windows ภายนอก ผ่าน /api/clip-transcript/worker)
 *     ไม่ใช่ synchronous — อาจใช้เวลานาน (คอมเมนต์ในโค้ดพูดถึงนานเป็นชั่วโมงถ้า Gemini แน่น)
 *   POST /api/clip-transcript/insight body:{url,force?,user?} → {success,data:{id,platform,headline,overview,
 *     category,rawData,subStories,lowQuality?,qualityNote?,cached?}} — เป็น synchronous call (ไม่ผ่านคิว clip-jobs)
 *     มี dedup cache ในตัว (ผูกกับ url ตรงๆ ผ่าน store 'clip-insights') — เรียกซ้ำด้วย url เดียวกันจะได้ผลจากคลังทันที
 *     ถ้าเคยถอดสำเร็จแล้ว (ฟรี+เร็ว) — ไฟล์นี้ใช้จุดนี้เป็น "ตัวเสริม" หลัง job-status done เผื่อผล rawData บางไป
 *
 * ★ ข้อจำกัดที่รู้: extractClip พึ่งพา "เครื่องทีม" ประมวลผลจริง (โดยเฉพาะ Facebook/IG) — ทดสอบ E2E เต็มรูปแบบ
 *   ทำได้เฉพาะตอนมีเครื่องทีมออนไลน์รับงานจากคิว — ในเซสชันที่เขียนไฟล์นี้ ทดสอบได้แค่ submit/job-status contract
 *   (อ่านโค้ด + เทส unit ของ classify/buildPayload/sendLeadAstext-fail-path) ไม่ได้ยิงคลิปจริงจนจบ
 */

import { createStore } from '../../persistStore.js';
import { sanitizeText } from './dnaContract.js';
import { STORE as LEADS_STORE } from './researchLeads.js';

const MAX_EXTRACT_CHARS = 12_000;
const MIN_TEXT_FOR_SEND = 300;

// ── host ที่ถือว่าเป็น "คลิป" — ตรงกับ SOCIAL_LOGIN_HOSTS ของ researchLeads.js + youtube ──
const CLIP_HOST_RE = /(youtube\.com|youtu\.be|facebook\.com|fb\.watch|fb\.com|m\.facebook\.com|tiktok\.com|vm\.tiktok\.com|instagram\.com|instagr\.am|threads\.net)/i;

/**
 * classifyExtractRoute — เลือกท่อสกัดเนื้อตามประเภทแหล่งของลีด
 * @param {object} lead - ต้องการ url/sourceHost/channel (มี field ใดก็พอ)
 * @returns {'article'|'clip'}
 */
export function classifyExtractRoute(lead) {
  const channel = String(lead?.channel || '').toLowerCase();
  if (channel === 'youtube' || channel === 'facebook' || channel === 'tiktok') return 'clip';
  const host = String(lead?.sourceHost || '').toLowerCase();
  const url = String(lead?.url || '').toLowerCase();
  if (CLIP_HOST_RE.test(host) || CLIP_HOST_RE.test(url)) return 'clip';
  return 'article';
}

// ── strip HTML หยาบ (fallback ตอน Jina ล้ม) — ตัด tag/script/style ล้วนๆ ไม่พึ่ง cheerio ──
function stripHtmlRough(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

async function _fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * extractArticle — ดึงเนื้อบทความเต็มด้วย Jina Reader (มี key = rate limit สูงกว่า) → ล้มเหลว → fallback fetch ตรง + strip HTML
 * @returns {Promise<{text:string, source:'jina'|'fallback', error?:string}>}
 */
export async function extractArticle(url) {
  const cleanUrl = sanitizeText(url, 500);
  if (!cleanUrl) return { text: '', source: 'fallback', error: 'ไม่มี URL' };

  // (1) Jina Reader — ใช้ key ถ้ามี (ไม่มีก็ยังยิงได้แบบ free tier แต่ rate limit ต่ำกว่า)
  let jinaErr = '';
  try {
    const apiKey = process.env.JINA_API_KEY || '';
    const headers = { 'Accept': 'text/plain', 'X-Return-Format': 'text' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await _fetchWithTimeout(`https://r.jina.ai/${cleanUrl}`, { headers }, 45_000);
    if (res.ok) {
      const raw = await res.text();
      if (raw && raw.length > 100 && !/SecurityCompromise|blocked by the site|not allowed to access this page/i.test(raw)) {
        const text = sanitizeText(raw, MAX_EXTRACT_CHARS);
        if (text.length > 200) return { text, source: 'jina' };
      }
    }
  } catch (e) {
    // เงียบ ไปต่อ fallback — เก็บเหตุผลไว้เผื่อ fallback ก็ล้มด้วย
    jinaErr = e?.message || String(e);
  }

  // (2) fallback: fetch ตรง + strip HTML หยาบ
  try {
    const res = await _fetchWithTimeout(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html', 'Accept-Language': 'th-TH,th;q=0.9',
      },
      redirect: 'follow',
    }, 20_000);
    if (!res.ok) throw new Error(`fallback fetch สถานะ ${res.status}`);
    const html = await res.text();
    const text = sanitizeText(stripHtmlRough(html), MAX_EXTRACT_CHARS);
    if (text.length < 100) throw new Error('เนื้อสั้นเกินหลัง strip HTML');
    return { text, source: 'fallback' };
  } catch (e2) {
    return { text: '', source: 'fallback', error: `${jinaErr ? `jina: ${jinaErr} · ` : ''}fallback: ${e2.message}` };
  }
}

async function _sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function _postJson(url, body, timeoutMs) {
  const res = await _fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }, timeoutMs);
  const txt = await res.text().catch(() => '');
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { /* ไม่ใช่ JSON — ปล่อย null ให้ caller จัดการ */ }
  return { ok: res.ok, status: res.status, data };
}

async function _getJson(url, timeoutMs) {
  const res = await _fetchWithTimeout(url, {}, timeoutMs);
  const txt = await res.text().catch(() => '');
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { /* เช่นกัน */ }
  return { ok: res.ok, status: res.status, data };
}

const CLIP_POLL_INTERVAL_MS = 10_000;
const CLIP_POLL_MAX_MS = 6 * 60 * 1000; // 6 นาที (คลิป FB/IG รอเครื่องทีม อาจช้า)

/**
 * extractClip — ส่งลิงก์คลิปเข้าคิว clip-jobs (/submit) → poll job-status ทุก 10s สูงสุด 6 นาที
 *   เสร็จ (done) → ถ้าเนื้อดิบ (rawData) ยังบาง เรียก /insight เสริม (ปกติ dedup ผูก url เดียวกัน → ได้ผลจากคลังทันทีถ้าเครื่องทีมเคยถอดไว้)
 *   ไม่เสร็จภายในเวลา → คืน {pending:true, jobRef} ไม่ throw (ให้ UI บอกผู้ใช้กลับมาดูใหม่)
 * @returns {Promise<{pending:true, jobRef:string, source:'clip-transcript'} |
 *                    {text:string, insight:object, source:'clip-transcript', jobRef:string, error?:string}>}
 */
export async function extractClip(url, origin) {
  const cleanUrl = sanitizeText(url, 500);
  if (!cleanUrl) return { text: '', source: 'clip-transcript', insight: null, error: 'ไม่มี URL' };
  if (!origin) return { text: '', source: 'clip-transcript', insight: null, error: 'ขาด origin สำหรับยิง clip-transcript' };

  // (1) submit
  let sub;
  try {
    sub = await _postJson(`${origin}/api/clip-transcript/submit`, { url: cleanUrl, kind: 'insight', user: 'research-desk' }, 20_000);
  } catch (e) {
    return { text: '', source: 'clip-transcript', insight: null, error: `ส่งคลิปเข้าคิวไม่สำเร็จ: ${e.message}` };
  }
  if (!sub.ok || !sub.data || sub.data.success !== true || !sub.data.jobId) {
    return { text: '', source: 'clip-transcript', insight: null, error: (sub.data && sub.data.error) || `ส่งคลิปเข้าคิวไม่สำเร็จ (สถานะ ${sub.status})` };
  }
  const jobId = sub.data.jobId;

  // (2) poll ทุก 10s สูงสุด 6 นาที
  const deadline = Date.now() + CLIP_POLL_MAX_MS;
  let lastStatus = null;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await _sleep(CLIP_POLL_INTERVAL_MS);
    let st;
    try {
      // eslint-disable-next-line no-await-in-loop
      st = await _getJson(`${origin}/api/clip-transcript/job-status?id=${encodeURIComponent(jobId)}`, 15_000);
    } catch {
      continue; // เน็ตสะดุดชั่วคราว — ลองรอบถัดไป ไม่ล้มทั้งก้อน
    }
    if (!st.ok || !st.data) continue;
    lastStatus = st.data;
    if (st.data.status === 'done') break;
    if (st.data.status === 'error') {
      return { text: '', source: 'clip-transcript', insight: null, error: st.data.error || 'ถอดคลิปล้มเหลว', jobRef: jobId };
    }
    // pending / processing / retry_wait → วนต่อ
  }

  if (!lastStatus || lastStatus.status !== 'done') {
    // ยังไม่เสร็จภายใน 6 นาที (ปกติสำหรับ FB/IG ที่รอเครื่องทีม) — ไม่ throw
    return { pending: true, jobRef: jobId, source: 'clip-transcript' };
  }

  const result = lastStatus.result || {};
  let text = sanitizeText(result.rawData || result.overview || '', MAX_EXTRACT_CHARS);
  let insight = {
    headline: sanitizeText(result.headline, 200),
    overview: sanitizeText(result.overview, 600),
    category: sanitizeText(result.category, 60),
  };

  // (3) เสริม: ถ้าเนื้อดิบยังบางไป ลองเรียก /api/clip-transcript/insight (sync, มี dedup cache ผูก url)
  if (text.length < MIN_TEXT_FOR_SEND) {
    try {
      const ins = await _postJson(`${origin}/api/clip-transcript/insight`, { url: cleanUrl, user: 'research-desk' }, 90_000);
      if (ins.ok && ins.data && ins.data.success && ins.data.data) {
        const d = ins.data.data;
        const richerText = sanitizeText(d.rawData || d.overview || '', MAX_EXTRACT_CHARS);
        if (richerText.length > text.length) text = richerText;
        insight = {
          headline: sanitizeText(d.headline, 200) || insight.headline,
          overview: sanitizeText(d.overview, 600) || insight.overview,
          category: sanitizeText(d.category, 60) || insight.category,
        };
      }
    } catch {
      // เสริมไม่ได้ — ใช้ผลจาก job-status ต่อไป (ไม่ critical)
    }
  }

  return { text, insight, source: 'clip-transcript', jobRef: jobId };
}

// ── merge แล้ว persist ด้วยแพตเทิร์น remove-แล้ว-add เหมือน researchLeads.js (ห้ามใช้ store.update()) ──
async function _mergeAndPersistLead(store, id, patch) {
  const all = await store.getAll();
  const existing = all.find((r) => r.id === id);
  if (!existing) {
    throw new Error(`ไม่พบลีด: ${id}`);
  }
  const merged = { ...existing, ...patch };
  await store.remove(id);
  await store.add(merged);
  return merged;
}

/**
 * getLead — โหลดลีด 1 ใบตาม id (อ่านอย่างเดียว ไม่แก้ store)
 */
export async function getLead(leadId) {
  const store = createStore(LEADS_STORE);
  const all = await store.getAll();
  return all.find((r) => r.id === leadId) || null;
}

/**
 * attachExtract — แนบผลสกัดเนื้อเข้าลีด (remove-แล้ว-add) — status เดิมคงอยู่ + ตั้ง contentReady:true
 * @param {string} leadId
 * @param {{text:string, insight?:object, source?:string}} extractResult
 */
export async function attachExtract(leadId, extractResult) {
  const store = createStore(LEADS_STORE);
  const text = sanitizeText(extractResult?.text, MAX_EXTRACT_CHARS);
  const patch = {
    extract: {
      text,
      insight: extractResult?.insight || null,
      source: extractResult?.source || '',
      extractedAt: new Date().toISOString(),
    },
    contentReady: true,
  };
  return _mergeAndPersistLead(store, leadId, patch);
}

/**
 * buildTextJobPayload — ประกอบข้อความส่งเขียนจากลีดที่มี extract แล้ว
 *   หัวข้อ + เนื้อที่สกัด + ประเด็น (ถ้ามี) + บรรทัดแหล่งอ้างอิงเป็น "ชื่อ host" — ห้ามมี URL ใดๆ หลงเหลือ
 * @returns {{input:string, text:string, userId:string, _leadId:string|null}}
 */
export function buildTextJobPayload(lead) {
  const l = lead || {};
  const title = sanitizeText(l.title, 300);
  const bodyText = sanitizeText(l.extract?.text, MAX_EXTRACT_CHARS);
  const insight = l.extract?.insight || null;
  const host = sanitizeText(l.sourceHost, 100);

  const parts = [];
  if (title) parts.push(title);
  if (bodyText) parts.push(bodyText);
  if (insight) {
    const lines = [];
    if (insight.headline) lines.push(`ประเด็นข่าว: ${sanitizeText(insight.headline, 200)}`);
    if (insight.overview) lines.push(`สรุปประเด็น: ${sanitizeText(insight.overview, 600)}`);
    if (insight.category) lines.push(`หมวด: ${sanitizeText(insight.category, 60)}`);
    if (lines.length) parts.push(lines.join('\n'));
  }
  if (host) parts.push(`แหล่งข่าว: ${host}`);

  let composed = parts.filter(Boolean).join('\n\n');
  // 🔴 ด่าน TEXT_ONLY ที่ /api/queue/add ปัดตกทันทีถ้าเจอ URL ในข้อความ — strip ทิ้งให้เกลี้ยงเสมอ กันหลุดจากทุก field ด้านบน
  composed = composed.replace(/https?:\/\/\S+/gi, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return {
    input: composed,
    text: composed,
    userId: 'research-desk',
    _leadId: l.id || null,
  };
}

/**
 * sendLeadAsText — ส่งลีดที่มีเนื้อสกัดแล้วเข้าคิวเขียนข่าวแบบ "text" (สายที่ระบบเปิดไว้ ไม่ใช่ URL)
 *   (ก) ต้องมี extract.text ≥ 300 ตัวอักษร ไม่งั้นคืน {success:false, needExtract:true}
 *   (ข) status==='sent' แล้ว → คืน {alreadySent:true} ไม่ยิงซ้ำ
 *   (ค) POST /api/queue/add ด้วย payload text ล้วน (ไม่มี url field, ไม่มี URL ในเนื้อ) → สำเร็จ → setStatus 'sent' + jobId
 *   (ง) โดนด่าน TEXT_ONLY (ไม่ควรเกิดถ้า strip URL ครบ — เช็คไว้กันหลุด) → คืน {success:false, blockedByTextOnly:true} ไม่เปลี่ยน status
 *   (จ) timeout 30s + try/catch ครอบทุกทาง → {success:false, error}
 */
export async function sendLeadAsText(leadId, { origin } = {}) {
  const store = createStore(LEADS_STORE);

  let lead;
  try {
    const all = await store.getAll();
    lead = all.find((r) => r.id === leadId);
  } catch (e) {
    return { success: false, error: `โหลดลีดไม่สำเร็จ: ${e.message}` };
  }
  if (!lead) {
    return { success: false, error: `ไม่พบลีด: ${leadId}` };
  }
  if (lead.status === 'sent') {
    return { alreadySent: true, jobId: lead.jobId || null };
  }

  const extractText = String(lead.extract?.text || '');
  if (extractText.length < MIN_TEXT_FOR_SEND) {
    return { success: false, needExtract: true, error: 'ยังไม่มีเนื้อที่สกัด (หรือสั้นเกินไป) — กด "สกัดเนื้อ" ก่อน' };
  }
  if (!origin) {
    return { success: false, error: 'ขาด origin สำหรับยิงเข้าคิว' };
  }

  const payload = buildTextJobPayload(lead);

  // 🔴 กันหลุด URL ซ้ำอีกชั้นก่อนยิงจริง (ห้าม bypass ด่าน TEXT_ONLY เด็ดขาด)
  if (/https?:\/\//i.test(payload.input)) {
    return { success: false, error: 'พบลิงก์หลงเหลือในข้อความที่ประกอบแล้ว — ยกเลิกส่ง (ป้องกันด่าน TEXT_ONLY หลุด)' };
  }

  let res;
  try {
    res = await _fetchWithTimeout(`${origin}/api/queue/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 30_000);
  } catch (e) {
    return { success: false, error: `ยิงเข้าคิวไม่สำเร็จ: ${e.message}` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { success: false, error: `อ่านผลลัพธ์จากคิวไม่ได้ (status ${res.status})` };
  }

  if (body && body.errorType === 'TEXT_ONLY_MODE') {
    return {
      success: false,
      blockedByTextOnly: true,
      error: 'ผิดปกติ: สาย text ก็ถูกด่าน TEXT_ONLY บล็อก (เช็คว่ามี URL หลงเหลือในข้อความหรือไม่) — ลีดยังไม่เปลี่ยนสถานะ',
    };
  }

  if (!res.ok || !body || body.success !== true) {
    return { success: false, error: (body && body.error) || `ส่งเข้าคิวไม่สำเร็จ (status ${res.status})` };
  }

  try {
    await _mergeAndPersistLead(store, leadId, {
      status: 'sent',
      statusAt: new Date().toISOString(),
      jobId: body.jobId || null,
    });
  } catch (e) {
    // ยิงคิวสำเร็จแล้วแต่บันทึกสถานะไม่ได้ — แจ้งตามจริง (คิวไปแล้วจริง)
    return { success: true, jobId: body.jobId, position: body.position, statusSaveError: e.message };
  }

  return { success: true, jobId: body.jobId, position: body.position };
}

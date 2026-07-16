/**
 * =====================================================
 * 📥 Research Leads — คลังลีดข่าว + ทางส่งเข้าคิวเขียน (โต๊ะข่าวกลาง v2, Research Engine เฟส 2.0 — R3, 16 ก.ค. 69)
 * =====================================================
 * รับผลจาก R2 (researchJudge.js) มาเก็บลง STORE 'research-leads' + ให้ UI (R4) เรียกดู/เปลี่ยนสถานะ/ส่งเข้าคิวเขียนข่าว
 * 🔴 pure JS + relative import ล้วน (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/)
 * 🔴 ห้ามใช้ persistStore.update() — มีบั๊กยืนยันแล้วว่าไม่ sync ไฟล์ fallback
 *    → ทุกจุดที่ต้อง "แก้ไข record เดิม" ใช้แพตเทิร์น remove(id) แล้ว add(ฉบับใหม่) แทนเสมอ (ตามแบบ dnaLibrary.js)
 * 🔴 ห้ามแตะ/บายพาสด่าน TEXT_ONLY_MODE ของ /api/queue/add — ลีดที่เป็น URL โดนบล็อกได้ตามปกติ
 *    เป็นเรื่องคาดหวัง ไม่ใช่บั๊ก (ดูคอมเมนต์ sendLeadToQueue)
 * แผนแม่บท: artifact research-engine-plan (16 ก.ค.)
 *
 * รูปร่างลีดที่รับเข้า (มาจาก R2 เสมอ):
 *   {url, urlKey?, title, snippet, channel('videos'|'facebook'|'tiktok'|'youtube'), sourceHost, query,
 *    clusterId, clusterArchetype, matchScore(0-100), fingerprint:{names[],action,timeHint,numbers[]},
 *    reason, warnMaybeDone}
 */

import crypto from 'crypto';
import { createStore } from '../../persistStore.js';
import { sanitizeText } from './dnaContract.js';

export const STORE = 'research-leads';

const VALID_STATUSES = new Set(['new', 'kept', 'sent', 'dismissed']);
const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');

// ── normalize URL ก่อน hash — ตัด fragment + tracking query + trailing slash กันลีดเดียวกันได้ id ต่างกัน ──
function normalizeUrl(url) {
  let u = sanitizeText(url, 500);
  if (!u) return '';
  u = u.replace(/#.*$/, ''); // ตัด fragment
  u = u.replace(/([?&])(utm_[a-z0-9_]+|fbclid|gclid|igshid|si|feature)=[^&]*/gi, '$1'); // ตัด tracking param ที่รู้จัก
  u = u.replace(/[?&]+$/, ''); // เก็บกวาด ? หรือ & ที่เหลือค้างท้าย
  u = u.replace(/\/+$/, ''); // ตัด trailing slash
  return u.toLowerCase();
}

/**
 * leadId — กุญแจกันซ้ำของลีด (idempotent): 'lead_' + md5(normalized url).slice(0,16)
 * @param {string} urlKeyOrUrl - ใช้ urlKey ถ้า R2 ให้มา ไม่งั้น fallback เป็น url ตรงๆ (caller เลือกก่อนเรียก)
 */
export function leadId(urlKeyOrUrl) {
  const normalized = normalizeUrl(urlKeyOrUrl);
  return 'lead_' + md5(normalized).slice(0, 16);
}

// ── host ที่รู้ว่าเนื้อหลัง login (ถอด transcript/บทความตรงๆไม่ได้ ต้องหาแหล่งข่าวสำนักมาต่อ) ──
// ขยายรายการนี้ได้เรื่อยๆ ถ้าเจอ host social ใหม่ที่ปิดกั้นการอ่านแบบไม่ login
const SOCIAL_LOGIN_HOSTS = [
  'facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com',
  'tiktok.com', 'vm.tiktok.com',
  'instagram.com', 'instagr.am',
  'threads.net',
];

/**
 * deriveFetchability — ประเมินว่าลีดนี้ "ถอดเนื้อหาได้เต็ม" หรือแค่ "ลีด" (ต้องหาแหล่งข่าวต่อ)
 *   'full' = สำนักข่าว/เว็บบทความทั่วไป (extract อ่านตรงได้) หรือ youtube (ถอด transcript ได้)
 *   'lead' = facebook/tiktok/instagram ฯลฯ ที่เนื้อหลัง login — ใช้เป็นเบาะแสไปหาข่าวสำนักจริงต่อ
 * heuristic เริ่มต้น: channel/host social ที่รู้จัก = 'lead' ที่เหลือทั้งหมด (รวม channel 'videos' ที่ไม่ใช่ social) = 'full'
 */
export function deriveFetchability(sourceHost, channel) {
  const host = String(sourceHost || '').toLowerCase().replace(/^www\./, '');
  const ch = String(channel || '').toLowerCase();

  // youtube ถอด transcript ได้เสมอ (extract engine มี YouTube transcript path) → 'full'
  if (ch === 'youtube' || host.includes('youtube.com') || host.includes('youtu.be')) return 'full';

  // social ที่รู้จักว่าเนื้อหลัง login → 'lead'
  if (ch === 'facebook' || ch === 'tiktok' || SOCIAL_LOGIN_HOSTS.some((h) => host.includes(h))) return 'lead';

  // default heuristic: เว็บสำนักข่าว/บทความทั่วไปที่เหลือ → ถอดเนื้อได้เต็ม
  return 'full';
}

function sanitizeFingerprint(fp) {
  const f = fp || {};
  return {
    names: (Array.isArray(f.names) ? f.names : []).map((x) => sanitizeText(x, 60)).filter(Boolean).slice(0, 10),
    action: sanitizeText(f.action, 120),
    timeHint: sanitizeText(f.timeHint, 60),
    numbers: (Array.isArray(f.numbers) ? f.numbers : []).map((x) => sanitizeText(x, 30)).filter(Boolean).slice(0, 10),
  };
}

// =====================================================
// 🧾 timeline ของลีด 1 ใบ — เขียนพร้อม write หลัก "จังหวะเดียว" (17 ก.ค. 69)
// -----------------------------------------------------
// เดิมใช้ appendLeadEvents (researchTrace.js) แบบ fire-and-forget แยกทีหลัง — บน Vercel serverless
// พอ route ตอบเสร็จ runtime ถูกแช่แข็งทันที งานที่ค้างเขียนไม่ทันถูกฆ่าก่อนลง DB เสมอ (lead.timeline ว่าง 0/66 ใบจริงบน prod)
// แก้ตามที่ผู้ตรวจอนุมัติ: ทุก event ต้องต่อเข้า record แล้ว "เขียนพร้อม write หลักในจังหวะเดียว" (ไม่มี append แยกทีหลัง)
// pushEvent เป็น pure function (ไม่แตะ store เอง) — caller เอา record ที่ได้ไปเขียนจริงต่อ (remove-แล้ว-add)
// =====================================================
const MAX_TIMELINE = 30; // ต่อ 1 ลีด — เกินตัดหัว (เก่าสุดออกก่อน) — ตั้งใจให้เท่ากับ cap ของ researchTrace.js

// sanitize event data แบบตื้นๆ (เฉพาะ pushEvent ใช้เอง ไม่ง้อ researchTrace.js)
// string/number/boolean/array ตื้นของ string เท่านั้น — object ซ้อน/ฟังก์ชัน → ข้ามทิ้ง กันโครงสร้างหลุด/ข้อมูลบวมเข้า timeline
function _sanitizeEventData(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  const keys = Object.keys(data).slice(0, 20);
  for (const k of keys) {
    const v = data[k];
    if (v == null) continue;
    if (typeof v === 'string') out[k] = sanitizeText(v, 200);
    else if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : 0;
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) {
      out[k] = v.slice(0, 10)
        .map((x) => (typeof x === 'string' ? sanitizeText(x, 150) : x))
        .filter((x) => x !== '' && x != null);
    }
    // object ซ้อน/ฟังก์ชัน → ข้าม กันโครงสร้างหลุด/ข้อมูลบวม
  }
  return out;
}

/**
 * pushEvent — ต่อ event เข้า timeline ของ record ลีด (pure — ไม่แตะ store, ไม่แก้ record เดิม)
 *   cap ที่ MAX_TIMELINE (เกินตัดหัว/เก่าสุดออกก่อน) · ใช้ตอนประกอบ record ก่อนเขียน DB จริงจังหวะเดียว
 *   export ให้ researchExtract.js import ใช้ร่วม (ห้ามเขียนซ้ำสองที่)
 * @param {object} record - record ลีด (หรือโครงที่กำลังจะสร้างใหม่) — ใช้ record.timeline เดิมถ้ามี
 * @param {string} type - ชื่อ event (found|judged|extracted|sent|written|status|refound)
 * @param {object} [data] - ข้อมูลตื้นๆ ของ event (sanitize อัตโนมัติ)
 * @returns {object} record ใหม่ (ไม่ mutate ของเดิม)
 */
export function pushEvent(record, type, data) {
  const typeClean = sanitizeText(type, 20);
  if (!typeClean) return record; // type ว่าง — ไม่ทำอะไร (กันเรียกผิด)
  const event = { at: new Date().toISOString(), type: typeClean, data: _sanitizeEventData(data) };
  const existingTimeline = Array.isArray(record?.timeline) ? record.timeline : [];
  const timeline = existingTimeline.concat([event]);
  const capped = timeline.length > MAX_TIMELINE ? timeline.slice(timeline.length - MAX_TIMELINE) : timeline;
  return { ...record, timeline: capped };
}

/**
 * saveLeads — จุดเข้าเดียวของการเซฟลีดที่ผ่าน R2 ลงคลัง (idempotent)
 * โหลด getAll ครั้งเดียว, ข้ามใบที่ id มีอยู่แล้ว (นับ skipped), ใบใหม่ค่อย addMany รวดเดียว
 * 🆕 17 ก.ค. 69 (แก้บัค timeline ว่าง): ใบใหม่ seed timeline ตั้งแต่สร้าง (found+judged) เขียนจังหวะเดียวกับ record
 *   ใบซ้ำที่มีอยู่แล้วในคลัง (id ชนกัน) — ไม่สร้างซ้ำ (นับ skipped เหมือนเดิม) แต่สืบทอด timeline เดิม + ต่อ event
 *   'refound' {runId} แล้วเขียนกลับ (remove-แล้ว-add) ให้เห็นว่าลีดนี้ถูกเจอซ้ำในรอบล่าไหนบ้าง
 * @param {Array<object>} judgedCandidates - ลีดดิบจาก R2 (ดู doc รูปร่างด้านบนไฟล์)
 * @param {{runId?: string}} opts
 * @returns {Promise<{saved:number, skipped:number}>}
 */
export async function saveLeads(judgedCandidates, { runId } = {}) {
  const store = createStore(STORE);
  const existing = await store.getAll();
  const existingMap = new Map(existing.map((r) => [r.id, r]));
  const seenInBatch = new Set(); // กันลีดเดียวกันโผล่ซ้ำสองครั้งในชุดที่ส่งมาชุดเดียวกัน (ไม่ต่อ refound ซ้ำ)

  const now = new Date().toISOString();
  const runIdClean = sanitizeText(runId, 40);
  const toAdd = [];
  const toReplace = []; // ใบซ้ำที่มีอยู่แล้ว — สืบทอด timeline เดิม + ต่อ refound
  let skipped = 0;

  for (const raw of Array.isArray(judgedCandidates) ? judgedCandidates : []) {
    if (!raw || !raw.url) continue;
    const id = leadId(raw.urlKey || raw.url);
    if (seenInBatch.has(id)) {
      skipped++;
      continue;
    }
    seenInBatch.add(id);

    const prevRecord = existingMap.get(id);
    if (prevRecord) {
      // ใบซ้ำที่มีอยู่แล้วในคลัง — ไม่สร้างใหม่ (นับ skipped ตามเดิม) แต่ต่อ timeline เดิมด้วย event 'refound'
      toReplace.push(pushEvent(prevRecord, 'refound', { runId: runIdClean }));
      skipped++;
      continue;
    }

    const sourceHost = sanitizeText(raw.sourceHost, 100);
    const channel = sanitizeText(raw.channel, 20);
    const matchScore = Math.min(100, Math.max(0, Number(raw.matchScore) || 0));
    const reason = sanitizeText(raw.reason, 300);
    let record = {
      id,
      url: sanitizeText(raw.url, 500),
      title: sanitizeText(raw.title, 300),
      snippet: sanitizeText(raw.snippet, 500),
      channel,
      sourceHost,
      clusterId: sanitizeText(raw.clusterId, 40) || null,
      clusterArchetype: sanitizeText(raw.clusterArchetype, 80),
      matchScore,
      fingerprint: sanitizeFingerprint(raw.fingerprint),
      reason,
      warnMaybeDone: !!raw.warnMaybeDone,
      fetchability: deriveFetchability(sourceHost, channel),
      status: 'new',
      runId: runIdClean,
      savedAt: now,
    };
    // 🆕 seed timeline ตั้งแต่สร้าง record — เขียนจังหวะเดียวกับ addMany ด้านล่าง (ไม่มี append แยกทีหลัง)
    record = pushEvent(record, 'found', { runId: runIdClean, query: sanitizeText(raw.query, 100), channel });
    record = pushEvent(record, 'judged', { score: matchScore, reason: sanitizeText(raw.reason, 120), model: 'judge' });
    toAdd.push(record);
  }

  if (toAdd.length > 0) {
    await store.addMany(toAdd);
  }
  for (const rep of toReplace) {
    // eslint-disable-next-line no-await-in-loop -- ใบซ้ำต่อ batch ปกติน้อย (เพดานผู้เรียกคุมไว้แล้ว) ไม่คุ้มแลก Promise.all เสี่ยง race ของ id เดียวกัน
    await store.remove(rep.id);
    // eslint-disable-next-line no-await-in-loop
    await store.add(rep);
  }

  return { saved: toAdd.length, skipped };
}

/**
 * listLeads — ดึงรายการลีด พร้อมกรอง + เรียงตาม matchScore มาก→น้อย
 */
export async function listLeads({ clusterId, status, channel, fetchability, minScore, q, limit = 100 } = {}) {
  const store = createStore(STORE);
  let items = await store.getAll();

  if (clusterId) items = items.filter((r) => r.clusterId === clusterId);
  if (status) items = items.filter((r) => r.status === status);
  if (channel) items = items.filter((r) => r.channel === channel);
  if (fetchability) items = items.filter((r) => r.fetchability === fetchability);
  if (minScore != null && minScore !== '') {
    const min = Number(minScore) || 0;
    items = items.filter((r) => (Number(r.matchScore) || 0) >= min);
  }
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((r) => {
      const title = String(r.title || '').toLowerCase();
      const snippet = String(r.snippet || '').toLowerCase();
      return title.includes(needle) || snippet.includes(needle);
    });
  }

  items = items.slice().sort((a, b) => (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0));

  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  return items.slice(0, safeLimit);
}

// ── merge แล้ว persist ด้วยแพตเทิร์น remove-แล้ว-add (ห้ามใช้ store.update()) ──
//   🆕 17 ก.ค. 69: event (ถ้าส่งมา) จะถูก pushEvent เข้า record ก่อนเขียนจริง — "จังหวะเดียว" กับ patch เสมอ
async function _mergeAndPersist(store, id, patch, event) {
  const all = await store.getAll();
  const existing = all.find((r) => r.id === id);
  if (!existing) {
    throw new Error(`ไม่พบลีด: ${id}`);
  }
  let merged = { ...existing, ...patch };
  if (event) merged = pushEvent(merged, event.type, event.data);
  await store.remove(id);
  await store.add(merged);
  return merged;
}

/**
 * setLeadStatus — เปลี่ยนสถานะลีด (new|kept|sent|dismissed) โดยเก็บ field เดิมครบ
 *   🆕 17 ก.ค. 69: ต่อ timeline event 'status' {to:status} ใน write เดียวกัน (ไม่ append แยกทีหลัง)
 */
export async function setLeadStatus(id, status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`สถานะไม่ถูกต้อง: ${status} (ต้องเป็นหนึ่งใน ${[...VALID_STATUSES].join('|')})`);
  }
  const store = createStore(STORE);
  return _mergeAndPersist(
    store,
    id,
    { status, statusAt: new Date().toISOString() },
    { type: 'status', data: { to: status } },
  );
}

/**
 * sendLeadToQueue — ส่งลีดเข้าคิวเขียนข่าวจริงผ่าน /api/queue/add
 * (ก) โหลด lead; status==='sent' แล้ว → คืน {alreadySent:true} ไม่ยิงซ้ำ
 * (ข) ประกอบ payload ตาม contract ของ /api/queue/add (งาน news-gen จาก URL ต้องมี payload.url หรือ .input หรือ .text)
 * (ค) สำเร็จ → setLeadStatus 'sent' + เก็บ jobId
 * (ง) โดนด่าน TEXT_ONLY_MODE (400, errorType เดียวกัน) → ไม่เปลี่ยน status คืน {success:false, blockedByTextOnly:true}
 *     🔴 ห้ามพยายาม bypass ด่านนี้เด็ดขาด — ลีดที่เป็น URL จะโดนบล็อกตามปกติถ้า TEXT_ONLY_MODE ยังเปิดอยู่ (ค่า default)
 * (จ) timeout 30s + try/catch ครอบทุกทาง → {success:false, error}
 */
export async function sendLeadToQueue(id, { origin } = {}) {
  const store = createStore(STORE);

  let lead;
  try {
    const all = await store.getAll();
    lead = all.find((r) => r.id === id);
  } catch (e) {
    return { success: false, error: `โหลดลีดไม่สำเร็จ: ${e.message}` };
  }
  if (!lead) {
    return { success: false, error: `ไม่พบลีด: ${id}` };
  }
  if (lead.status === 'sent') {
    return { alreadySent: true, jobId: lead.jobId || null };
  }
  if (!origin) {
    return { success: false, error: 'ขาด origin สำหรับยิงเข้าคิว' };
  }

  const payload = {
    url: lead.url,
    userId: 'research-desk',
    _leadId: lead.id, // field เสริมอ้างอิงย้อนกลับ — /api/queue/add ปัจจุบันไม่อ่าน ไม่กระทบ contract เดิม
  };

  let res;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      res = await fetch(`${origin}/api/queue/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { success: false, error: `ยิงเข้าคิวไม่สำเร็จ: ${e.message}` };
  }

  let body;
  try {
    body = await res.json();
  } catch (e) {
    return { success: false, error: `อ่านผลลัพธ์จากคิวไม่ได้ (status ${res.status})` };
  }

  return _interpretQueueAddResponse(res, body, store, id);
}

// ── ตีความผลจาก /api/queue/add แยกออกมาให้เทสตรงได้โดยไม่ต้องยิง fetch จริง (mock res/body) ──
export async function _interpretQueueAddResponse(res, body, store, id) {
  if (body && body.errorType === 'TEXT_ONLY_MODE') {
    return {
      success: false,
      blockedByTextOnly: true,
      error: 'สาย URL ปิดอยู่ (TEXT_ONLY) — เปิดคืนต้องตั้ง TEXT_ONLY_MODE=0',
    };
  }

  if (!res.ok || !body || body.success !== true) {
    return { success: false, error: (body && body.error) || `ส่งเข้าคิวไม่สำเร็จ (status ${res.status})` };
  }

  try {
    // 🆕 17 ก.ค. 69: pushEvent 'sent' ในจังหวะเดียวกับการเปลี่ยน status (legacy sendLeadToQueue — ไม่มี append แยกทีหลัง)
    await _mergeAndPersist(
      store,
      id,
      { status: 'sent', statusAt: new Date().toISOString(), jobId: body.jobId || null },
      { type: 'sent', data: { jobId: body.jobId || '' } },
    );
  } catch (e) {
    // ยิงคิวสำเร็จแล้วแต่บันทึกสถานะไม่ได้ — แจ้งผู้ใช้ตามจริง ไม่ปิดบัง (คิวไปแล้วจริง)
    return { success: true, jobId: body.jobId, position: body.position, statusSaveError: e.message };
  }

  return { success: true, jobId: body.jobId, position: body.position };
}

/**
 * leadStats — นับตาม status / fetchability / cluster สำหรับ UI (R4)
 */
export async function leadStats() {
  const store = createStore(STORE);
  const items = await store.getAll();

  const byStatus = {};
  const byFetchability = {};
  const byCluster = {};
  for (const r of items) {
    const s = r.status || 'new';
    byStatus[s] = (byStatus[s] || 0) + 1;
    const f = r.fetchability || 'unknown';
    byFetchability[f] = (byFetchability[f] || 0) + 1;
    const c = r.clusterId || 'ไม่มีคลัสเตอร์';
    byCluster[c] = (byCluster[c] || 0) + 1;
  }

  return { total: items.length, byStatus, byFetchability, byCluster };
}

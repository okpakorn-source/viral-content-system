/**
 * =====================================================
 * 📚 Ready Content — คลังเนื้อพร้อมใช้ (โต๊ะข่าวกลาง v2, โมดูลที่ 3 — C1, 17 ก.ค. 69)
 * =====================================================
 * เก็บผลลัพธ์ที่ระบบเจนเสร็จแล้ว (ดึงจาก /api/queue/status ของลีดที่ status==='sent')
 * ทุกชิ้นมี: เนื้อครบทุกเวอร์ชัน (คัดลอกโพสต์ได้ทันที) + ลิงก์ต้นฉบับ (lead.url) + ลิงก์อ้างอิงจาก researchItems
 * 🔴 pure JS + relative import ล้วน (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/)
 * 🔴 ห้ามใช้ persistStore.update() — มีบั๊กยืนยันแล้วว่าไม่ sync ไฟล์ fallback
 *    → ทุกจุดที่ต้อง "แก้ไข record เดิม" ใช้แพตเทิร์น remove(id) แล้ว add(ฉบับใหม่) แทนเสมอ (ตามแบบ dnaLibrary.js)
 * 🔴 ห้ามใช้ sanitizeText (dnaContract.js) กับเนื้อเวอร์ชัน — มันยุบ \n เป็นช่องว่าง ทำย่อหน้าหาย
 *    → ใช้ sanitizeMultiline ในไฟล์นี้แทน (ตัด control chars แต่เว้น \n)
 */

import { createStore } from '../../persistStore.js';
import { listLeads } from './researchLeads.js';
import { sanitizeText } from './dnaContract.js';

export const STORE = 'ready-content';

const VALID_STATUSES = new Set(['ready', 'used']);
const MAX_VERSIONS = 20;      // กันเวอร์ชันเพี้ยนจำนวนมหาศาลจาก job ผิดปกติ
const MAX_RESEARCH_REFS = 10; // ตามสเปก dedupe ≤10

/**
 * sanitizeMultiline — เหมือน sanitizeText แต่ "เว้น \n" (ห้ามยุบขึ้นบรรทัดใหม่ทิ้ง — เนื้อข่าวต้องคงย่อหน้า)
 * ตัด: control chars (0x00-0x1F ยกเว้น \n=0x0A), zero-width,  / , BOM · normalize \r\n/\r → \n · cap ความยาว
 */
export function sanitizeMultiline(s, max = 8000) {
  return String(s ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // ตั้งใจตัด control chars ยกเว้น \n (0x0A) — ต่างจาก sanitizeText ที่ยุบทุกอย่างเป็นช่องว่าง
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\u200B-\u200F\u2028\u2029\uFEFF]/g, '')
    .trim()
    .slice(0, max);
}

// ── ยิง GET /api/queue/status?id= พร้อม timeout 30s — คืน {ok, body} หรือ {ok:false, error} ──
async function fetchJobStatus(origin, jobId, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/api/queue/status?id=${encodeURIComponent(jobId)}`, {
      signal: controller.signal,
    });
    let body;
    try {
      body = await res.json();
    } catch {
      return { ok: false, error: `อ่านผลลัพธ์จากคิวไม่ได้ (status ${res.status})` };
    }
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e.message || 'เชื่อมต่อ queue/status ไม่สำเร็จ' };
  } finally {
    clearTimeout(timer);
  }
}

// ── ประกอบ record จาก lead (sent) + job body ที่ completed ── คืน null ถ้าข้อมูลไม่ครบพอ
function buildRecord(lead, body) {
  const data = body?.result?.data;
  if (!data || !Array.isArray(data.versions) || data.versions.length === 0) return null;

  const newsData = data.newsData || {};

  const versions = data.versions.slice(0, MAX_VERSIONS).map((v) => ({
    style: sanitizeText(v?.style, 60),
    title: sanitizeText(v?.title, 300),
    hook: sanitizeMultiline(v?.hook, 1500),
    content: sanitizeMultiline(v?.content, 8000), // เนื้อหลัก — คงย่อหน้าเดิม
    closing: sanitizeMultiline(v?.closing, 1500),
    tone: sanitizeText(v?.tone, 60),
    target: sanitizeText(v?.target, 120),
    autoScore: Number(v?._autoScore) || null,
  }));

  // researchRefs: เฉพาะใบที่มี sourceUrl จริง + dedupe ตาม (title, url) ≤10
  // 🔴 dedupe คีย์ = title+url (ไม่ใช่ url เดี่ยวๆ) — งานจริงพบว่า researchItems หลายใบ "ชี้บทความต้นทางเดียวกัน
  //    แต่คนละหัวข้อย่อย/ข้อเท็จจริง" (เช่น 8/10 ใบชี้ khaosod.co.th บทความเดียวแต่คนละประเด็น) ถือเป็นการอ้างอิงคนละจุด
  //    ที่มีประโยชน์แยกกัน — ควรเก็บไว้ทั้งคู่ ไม่ยุบทิ้ง ต่างจากใบที่ title+url ซ้ำกันเป๊ะ (ของจริงที่ไม่มีประโยชน์เพิ่ม)
  const seenKeys = new Set();
  const researchRefs = [];
  for (const item of Array.isArray(data.researchItems) ? data.researchItems : []) {
    const url = sanitizeText(item?.sourceUrl, 500);
    if (!url) continue;
    const title = sanitizeText(item?.title, 200);
    const key = title + '|' + url;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    researchRefs.push({
      title,
      sourceName: sanitizeText(item?.sourceName, 80),
      sourceUrl: url,
    });
    if (researchRefs.length >= MAX_RESEARCH_REFS) break;
  }

  const now = new Date().toISOString();
  return {
    id: 'rc_' + lead.jobId,
    jobId: lead.jobId,
    leadId: lead.id,
    leadTitle: sanitizeText(lead.title, 300),
    sourceUrl: sanitizeText(lead.url, 500),        // 🔗 ต้นฉบับจริงที่ลีดชี้
    sourceHost: sanitizeText(lead.sourceHost, 100),
    clusterArchetype: sanitizeText(lead.clusterArchetype, 80),
    matchScore: Math.min(100, Math.max(0, Number(lead.matchScore) || 0)),
    newsTitle: sanitizeText(newsData.newsTitle, 300),
    versions,
    researchRefs,                                  // 🔍 อ้างอิงจากขั้นรีเสิร์ชของระบบเขียน
    generatedAt: body.completedAt || null,
    harvestedAt: now,
    status: 'ready',
  };
}

/**
 * harvestFromLeads — ดึงลีดที่ส่งเข้าคิวแล้ว (status='sent') ที่ยังไม่มีในคลัง → เช็คผล → เก็บใบที่ completed
 * sequential (ทีละใบ) จำกัดไม่เกิน maxJobs ต่อรอบ — กันยิง /api/queue/status รัวเกินไป
 * @returns {Promise<{added:number, waiting:number, failed:number, checked:number}>}
 */
export async function harvestFromLeads({ origin, maxJobs = 10 } = {}) {
  if (!origin) {
    throw new Error('ขาด origin สำหรับดึงผลจากคิว');
  }
  const store = createStore(STORE);
  const [leads, existing] = await Promise.all([
    listLeads({ status: 'sent', limit: 200 }),
    store.getAll(),
  ]);
  const existingIds = new Set(existing.map((r) => r.id));

  const safeMaxJobs = Math.max(1, Math.min(50, Number(maxJobs) || 10));
  // 🔒 audit R2 (18 ก.ค.): ตัดใบที่เลิกตามแล้ว (harvestGaveUpAt) — เดิมงาน failed/หายจากคิวถูก re-poll ทุกรอบ
  //   ตลอดกาล กินโควตา maxJobs จนใบเสร็จจริงไม่ถูกเช็ค
  const candidates = leads
    .filter((l) => l && l.jobId && !l.harvestGaveUpAt && !existingIds.has('rc_' + l.jobId))
    .slice(0, safeMaxJobs);

  let waiting = 0;
  let failed = 0;
  let checked = 0;
  const toAdd = [];
  const addedIds = new Set(); // กันลีดคนละใบชี้ jobId เดียวกันโผล่ซ้ำในชุดเดียวกัน (ไม่ควรเกิด แต่กันไว้)

  // 🔒 audit R2 (18 ก.ค.): งานจบแบบไม่มีวันได้ผล (failed/หายจากคิว) → มาร์คลีด "เลิกตาม" ถาวร
  //   (remove-แล้ว-add ตามกฎ 🔴 ห้าม update) — มาร์คไม่สำเร็จไม่บล็อกรอบเก็บเกี่ยว
  const _markGaveUp = async (leadId, reason) => {
    try {
      const leadsStore = createStore('research-leads');
      const allLeads = await leadsStore.getAll();
      const existingLead = allLeads.find((r) => r.id === leadId);
      if (!existingLead || existingLead.harvestGaveUpAt) return;
      await leadsStore.remove(leadId);
      await leadsStore.add({
        ...existingLead,
        harvestGaveUpAt: new Date().toISOString(),
        harvestGaveUpReason: String(reason || '').slice(0, 120),
      });
    } catch { /* เงียบ — รอบหน้าลองมาร์คใหม่เอง */ }
  };

  for (const lead of candidates) {
    checked++;
    const r = await fetchJobStatus(origin, lead.jobId);
    if (!r.ok) {
      failed++;
      continue;
    }
    const body = r.body;
    if (!body || body.success !== true) {
      failed++;
      // งานหายจากคิวถาวร (คิว purge งานเก่า) → เลิกตาม — เน็ตสะดุด/อื่นๆ ยังลองรอบหน้าตามเดิม
      if (body && /ไม่พบ|not\s?found/i.test(String(body.error || ''))) {
        await _markGaveUp(lead.id, 'งานหายจากคิว (ถูก purge)');
      }
      continue;
    }

    if (body.status === 'completed') {
      const id = 'rc_' + lead.jobId;
      if (addedIds.has(id)) continue;
      const rec = buildRecord(lead, body);
      if (rec) {
        toAdd.push(rec);
        addedIds.add(id);
      } else {
        failed++; // completed แต่ข้อมูลไม่ครบ (ไม่มี versions) — นับพลาด
      }
    } else if (body.status === 'pending' || body.status === 'processing') {
      waiting++;
    } else {
      // 'failed' หรือสถานะอื่นที่ไม่รู้จัก — จบถาวร ไม่มีวันกลายเป็น completed → เลิกตาม (audit R2)
      failed++;
      await _markGaveUp(lead.id, `job จบสถานะ '${body.status}'`);
    }
  }

  if (toAdd.length > 0) {
    await store.addMany(toAdd);
  }

  return { added: toAdd.length, waiting, failed, checked };
}

/**
 * listContent — ดึงรายการเนื้อพร้อมใช้ พร้อมกรอง + เรียงตาม harvestedAt ใหม่→เก่า
 * q ค้นใน newsTitle / leadTitle / versions[].title
 */
export async function listContent({ status, q, limit = 100 } = {}) {
  const store = createStore(STORE);
  let items = await store.getAll();

  if (status) items = items.filter((r) => r.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((r) => {
      const newsTitle = String(r.newsTitle || '').toLowerCase();
      const leadTitle = String(r.leadTitle || '').toLowerCase();
      const versionTitles = Array.isArray(r.versions)
        ? r.versions.map((v) => String(v.title || '').toLowerCase()).join(' ')
        : '';
      return newsTitle.includes(needle) || leadTitle.includes(needle) || versionTitles.includes(needle);
    });
  }

  items = items.slice().sort((a, b) => new Date(b.harvestedAt || 0) - new Date(a.harvestedAt || 0));

  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  return items.slice(0, safeLimit);
}

// ── merge แล้ว persist ด้วยแพตเทิร์น remove-แล้ว-add (ห้ามใช้ store.update()) ──
async function mergeAndPersist(store, id, patch) {
  const all = await store.getAll();
  const existing = all.find((r) => r.id === id);
  if (!existing) {
    throw new Error(`ไม่พบเนื้อ: ${id}`);
  }
  const merged = { ...existing, ...patch };
  await store.remove(id);
  await store.add(merged);
  return merged;
}

/**
 * setStatus — สลับสถานะ 'ready' ↔ 'used' โดยเก็บ field เดิมครบ
 */
export async function setStatus(id, status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`สถานะไม่ถูกต้อง: ${status} (ต้องเป็นหนึ่งใน ${[...VALID_STATUSES].join('|')})`);
  }
  const store = createStore(STORE);
  const patch = { status, statusAt: new Date().toISOString() };
  if (status === 'used') patch.usedAt = new Date().toISOString();
  return mergeAndPersist(store, id, patch);
}

/**
 * removeItem — ลบเนื้อออกจากคลัง
 */
export async function removeItem(id) {
  const store = createStore(STORE);
  try {
    await store.remove(id);
    return { removed: true };
  } catch {
    return { removed: false };
  }
}

/**
 * contentStats — นับตามสถานะ สำหรับหัวแท็บ
 */
export async function contentStats() {
  const store = createStore(STORE);
  const items = await store.getAll();

  const byStatus = {};
  for (const r of items) {
    const s = r.status || 'ready';
    byStatus[s] = (byStatus[s] || 0) + 1;
  }

  return { total: items.length, byStatus };
}

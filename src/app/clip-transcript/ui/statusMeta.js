/**
 * statusMeta — สมองกลางของ UI ถอดคลิป (pure logic ไม่มี JSX ห้าม import React)
 * ผูกกับค่าสถานะจริงในโค้ดหลังบ้าน:
 *   pending/processing/retry_wait/done/error  → worker/route.js + submit/route.js
 *   cancelled                                 → cancel/route.js (เพิ่ม 26 ส.ค. 69 — เดิมลบใบทิ้ง)
 * เทส: tests/clip-route-plan.test.mjs · tests/clip-phase3-ui.test.mjs · tests/clip-topic-ui.test.mjs (cardView)
 */

export const STATUS_META = {
  pending:    { label: 'รอคิว',      emoji: '⏳', color: '#9ca3af', bg: 'rgba(156,163,175,.12)', border: '#9ca3af55' },
  processing: { label: 'กำลังถอด',   emoji: '🔧', color: '#60a5fa', bg: 'rgba(96,165,250,.12)',  border: '#60a5fa55' },
  retry_wait: { label: 'รอลองใหม่',  emoji: '🟡', color: '#fbbf24', bg: 'rgba(251,191,36,.12)',  border: '#fbbf2455' },
  done:       { label: 'เสร็จแล้ว',  emoji: '✅', color: '#22c55e', bg: 'rgba(34,197,94,.12)',   border: '#22c55e55' },
  error:      { label: 'ไม่สำเร็จ',  emoji: '❌', color: '#ef4444', bg: 'rgba(239,68,68,.12)',   border: '#ef444455' },
  cancelled:  { label: 'ยกเลิกแล้ว', emoji: '🚫', color: '#6b7280', bg: 'rgba(107,114,128,.12)', border: '#6b728055' },
};

export function getStatusMeta(status) {
  return STATUS_META[status] || { label: String(status || 'ไม่ทราบสถานะ'), emoji: '❔', color: '#9ca3af', bg: 'rgba(156,163,175,.12)', border: '#9ca3af55' };
}

/** ปุ่มที่มีให้กดต่อสถานะ (เรียงตามที่ควรโชว์) */
export function jobActions(job) {
  const s = job?.status;
  if (s === 'pending' || s === 'retry_wait') return ['cancel'];
  if (s === 'processing') return ['cancel'];
  if (s === 'done') return ['view', 'retry'];
  if (s === 'error' || s === 'cancelled') return ['retry'];
  return [];
}

/**
 * ★ 26 ต.ค. 69 (เจ้าของเคาะ "เนื้อข่าวช่องเดียว"): มุมมองการ์ดผล — ใบใหม่และใบเก่าในคลังแสดงหน้าตาเดียวกัน
 *   ใบใหม่ (engine clip-single): body + checks จากตัวตรวจด้วยโค้ด
 *   ใบเก่า: ใช้เนื้อเดิมที่ครบที่สุด (ก้อนรวม rawData → เรื่องหลัก → ภาพรวม) ไม่ถอดใหม่ · ไม่มีจุดเช็ค
 */
export const CHECK_KIND_LABEL = {
  segment: 'ช่วงคลิปหาย', quote: 'คำพูด', name: 'ชื่อ', number: 'ตัวเลข', coverage: 'ประเด็นอาจตกหล่น', gender: 'คำเรียกเพศ', legacy: 'ผลตรวจระบบเดิม',
  unverified: 'ยังไม่ได้เทียบ', // ★ 28 ต.ค. 69 ร้อยแก้วกระชับ: ฉบับดูรอบเดียวไม่มีบทถอดให้โค้ดเทียบ
};
const txt = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v : []);
export function cardView(rec) {
  const r = rec || {};
  const ins = r.insight || {};
  const legacy = !(ins.engine === 'clip-single' || txt(ins.body));
  const headline = txt(ins.headline) || txt(r.title) || txt(r.url) || '(ไม่มีพาดหัว)';
  const body = txt(ins.body) || txt(ins.rawData) || txt(ins.mainStory) || txt(ins.topicsV2?.mainStory) || txt(ins.overview);
  const list = arr(ins.checks).filter((c) => c && txt(c.text));
  const checks = list.filter((c) => c.level !== 'fixed');
  // 🔴 ผู้ตรวจอิสระ 26 ต.ค.: ใบเก่าห้ามทิ้งข้อมูลที่มีอยู่ — ธง "ต้องตรวจ" ของระบบเดิมยังเป็นจุดเช็ค
  //   และเนื้อแยกประเด็นเดิม (~27% ของคำไม่อยู่ในก้อนรวม) พับไว้ใต้เนื้อ ไม่ปนในช่องหลัก ไม่อยู่ในข้อความคัดลอก
  if (legacy && ins.brain?.status === 'ต้องตรวจ') checks.push({ level: 'check', kind: 'legacy', text: 'ระบบเดิมตรวจแล้วติดธง "ต้องตรวจ" — เช็คกับคลิปก่อนใช้' });
  const extras = legacy
    ? [...arr(ins.subStories).map((s) => ({ title: txt(s?.topic), text: txt(s?.rawData) || txt(s?.summary) })),
      ...arr(ins.topicsV2?.stories).map((s) => ({ title: txt(s?.topic), text: txt(s?.story) })),
      ...arr(ins.topics).map((t) => ({ title: txt(t?.title), text: txt(t?.summary) }))].filter((x) => x.text)
    : [];
  return {
    headline, body, legacy, checks, extras,
    fixed: list.filter((c) => c.level === 'fixed'),
    copyText: [headline, body].filter(Boolean).join('\n\n'),
  };
}

/** แปลงผลถอด (ข้อมูลแบนจาก /insight หรือ job.result) เป็นใบแบบคลัง — ลิงก์มาจากใบงาน ไม่ใช่ช่องกรอก (P12) */
export function resultToRec(result, url = '') {
  const d = result || {};
  return {
    id: d.id, url: url || d.url || '', platform: d.platform, insight: d,
    clipDurationSec: d.clipDurationSec, lowQuality: d.lowQuality, qualityNote: d.qualityNote,
    cached: d.cached, cachedAt: d.cachedAt,
  };
}

/* ── เวลา ── */
export function fmtDurSec(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
  if (m > 0) return `${m}:${String(s % 60).padStart(2, '0')} นาที`;
  return `${s} วิ`;
}
export function fmtMs(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return '';
  return n < 60000 ? `${Math.round(n / 1000)} วิ` : fmtDurSec(n / 1000);
}
/** นับถอยหลังถึง nextRetryAt — คืน '' ถ้าเลยเวลาแล้ว */
export function fmtCountdown(nextRetryAt, nowMs) {
  const t = Date.parse(nextRetryAt || '') - (Number(nowMs) || Date.now());
  if (!Number.isFinite(t) || t <= 0) return '';
  const s = Math.ceil(t / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} นาที ${s % 60} วิ` : `${s} วิ`;
}
export function fmtClock(iso) {
  const d = new Date(iso || 0);
  if (Number.isNaN(d.getTime()) || !iso) return '';
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ── ลิงก์ (regex ชุดเดียวกับของเดิมใน page.js — ห้ามเปลี่ยนพฤติกรรม) ── */
const RE_META = /facebook\.com|fb\.watch|instagram\.com/i;
const RE_TIKTOK = /tiktok\.com/i;
const RE_YT = /youtube\.com|youtu\.be/i;

export function detectLink(url) {
  const u = String(url || '').trim();
  if (!u) return { platform: null, isClip: false, label: '' };
  if (RE_YT.test(u)) return { platform: 'youtube', isClip: true, label: '▶️ YouTube' };
  if (RE_TIKTOK.test(u)) return { platform: 'tiktok', isClip: true, label: '🎵 TikTok' };
  if (RE_META.test(u)) return { platform: 'meta', isClip: true, label: '📘 Facebook/IG' };
  if (/^https?:\/\//i.test(u)) return { platform: 'article', isClip: false, label: '📰 ลิงก์ข่าว/เว็บ' };
  return { platform: null, isClip: false, label: '' };
}

export function platformIcon(p) {
  return { youtube: '▶️', tiktok: '🎵', meta: '📘', article: '📰' }[p] || '🎬';
}

/**
 * ★★ 27 ส.ค. 69 (เจ้าของสั่ง — กติกาใหม่ ทับของ 26 ส.ค.):
 *    "บังคับรันในเครื่องทีมเท่านั้น เหลือ 2 ปุ่มพอ · ถอดผ่านคอมฉันเป็นหลัก
 *     แต่ถ้าคอมฉันดับ ล่ม ให้ถอดปุ่มสำรอง (บน Vercel)"
 *
 * 🔴 สิ่งที่เปลี่ยนจากเดิม — และเหตุผลที่ต้องเป็นแบบนี้:
 *    เดิมระบบ "สลับไปคลาวด์ให้เอง" เมื่อเครื่องแอดมินปิด → พนักงานไม่รู้ตัวว่าได้ของด้อยคุณภาพ
 *    (คลาวด์รัน CLI ไม่ได้ = ไม่มีผู้ตรวจ ไม่มีตัวซ่อม — พิสูจน์แล้วจากใบ 27 ส.ค. 08:31 ที่โควตาสมอง = 0)
 *    ใหม่: ปุ่มหลัก **ไปเครื่องแอดมินเสมอ ไม่มีข้อยกเว้น** เครื่องปิดก็รอในคิว
 *          จะใช้คลาวด์ต้อง "กดปุ่มสำรองเอง" เท่านั้น และกดได้เฉพาะตอนเครื่องแอดมินดับจริง
 *
 * คืนแผน 2 ปุ่มให้หน้าเว็บวาดตรงๆ (หน้าเว็บไม่ต้องตัดสินใจเอง — ตรรกะอยู่ที่เดียว เทสได้):
 *   primary = { action:'queue'|'none', label, enabled, why }
 *   backup  = { action:'cloud'|'none', label, enabled, why }
 */
const CLOUD_CAPABLE = new Set(['youtube', 'tiktok']);
const MACHINE = 'เครื่องแอดมิน';

/**
 * workerAlive: true = พร้อม · false = ดับจริง · null/undefined = ยังไม่รู้ (★ 26 ต.ค. P13: เดิมนับ "ไม่ทราบ" เป็น "ดับ")
 * ★ 26 ต.ค. 69: เลิกค้นข่าวคล้าย/วิจัยลิงก์ข่าว (เจ้าของเคาะ) — ลิงก์เว็บข่าวกดไม่ได้ บอกเหตุผลแทน
 */
export function planClipRoute(url, workerAlive, { unknownLong = false } = {}) {
  const d = detectLink(url);
  const state = workerAlive === true ? 'alive' : workerAlive === false ? 'dead' : 'unknown';
  const backupLabel = '☁️ ถอดสำรอง (Vercel)';

  // ยังไม่วางลิงก์ / ลิงก์ที่อ่านไม่ออก — ปุ่มยังกดได้ (จะขึ้นเตือนให้วางลิงก์)
  if (!d.platform) {
    return {
      mode: 'not-clip', platform: null, isClip: false,
      primary: { action: 'queue', label: `🎯 ถอดด้วย${MACHINE}`, enabled: true, why: '' },
      backup: { action: 'none', enabled: false, label: backupLabel, why: 'วางลิงก์คลิปก่อน' },
    };
  }

  if (!d.isClip) {
    return {
      mode: 'not-clip', platform: d.platform, isClip: false,
      primary: { action: 'none', label: `🎯 ถอดด้วย${MACHINE}`, enabled: false, why: 'ลิงก์นี้เป็นเว็บข่าว ไม่ใช่คลิป — ระบบนี้ถอดได้เฉพาะคลิป TikTok / YouTube / Facebook / IG' },
      backup: { action: 'none', enabled: false, label: backupLabel, why: 'ใช้กับลิงก์คลิปเท่านั้น' },
    };
  }

  // ── ลิงก์คลิป: ปุ่มหลักไปเครื่องแอดมินเสมอ ────────────────────────────
  const primary = {
    alive: { action: 'queue', label: `🎯 ถอดด้วย${MACHINE}`, enabled: true, why: `${MACHINE}พร้อม — ถอดได้ทุกช่องทาง คลิปยาวผ่าเป็นช่วงดูครบทุกช่วง` },
    dead: { action: 'queue', label: `📥 ส่งเข้าคิว (${MACHINE}ดับอยู่)`, enabled: true, why: `${MACHINE}ดับอยู่ — กดแล้วงานจะรอในคิว เปิดเครื่องเมื่อไหร่ถอดให้เองทันที (งานไม่หาย)` },
    unknown: { action: 'queue', label: `🎯 ถอดด้วย${MACHINE}`, enabled: true, why: `ยังเช็คสถานะ${MACHINE}ไม่ได้ — กดแล้วงานเข้าคิวตามปกติ` },
  }[state];

  // ── ปุ่มสำรอง: เปิดให้กดเฉพาะตอนเครื่องแอดมินดับจริง ─────────────────
  // 🔴 ผู้ตรวจอิสระ 26 ต.ค.: "ไม่ทราบ" อาจยาวนาน (ไม่มีแถวชีพจร/ฐานสะดุด) — ห้ามปิดทางสำรองตาย
  //   แต่ก็ห้ามเปิดทันที (ตอนหน้าเพิ่งโหลด/ชีพจรสะดุดแวบเดียว เครื่องอาจเปิดอยู่ — กติกาเจ้าของ 27 ส.ค. "คอมดับค่อยกดสำรอง")
  //   → เปิดเมื่อหน้าแจ้งว่าไม่ทราบต่อเนื่องนานพอ (unknownLong) พร้อมคำเตือน
  let backup;
  if (state === 'alive') {
    backup = { action: 'none', enabled: false, label: backupLabel, why: `${MACHINE}ยังเปิดอยู่ — ปุ่มนี้มีไว้ตอนเครื่องดับเท่านั้น` };
  } else if (!CLOUD_CAPABLE.has(d.platform)) {
    backup = { action: 'none', enabled: false, label: backupLabel, why: `ลิงก์ Facebook/IG ต้องโหลดไฟล์จาก${MACHINE} — Vercel ทำแทนไม่ได้ ต้องรอเปิดเครื่อง` };
  } else if (state === 'unknown') {
    backup = unknownLong
      ? { action: 'cloud', enabled: true, label: backupLabel, why: `⚠️ เช็คสถานะ${MACHINE}ไม่ได้มานานแล้ว — ปกติใช้ปุ่มหลัก กดปุ่มนี้เฉพาะเมื่อแน่ใจว่าเครื่องดับ (Vercel เวลาและที่เก็บไฟล์จำกัด คลิปยาวอาจดูไม่ครบ)` }
      : { action: 'none', enabled: false, label: backupLabel, why: `กำลังเช็คสถานะ${MACHINE} — ส่งเข้าคิวไว้ก่อน ถ้าเช็คไม่ได้เกิน 2 นาที ปุ่มนี้จะเปิดให้กด` };
  } else {
    backup = { action: 'cloud', enabled: true, label: backupLabel, why: '⚠️ ใช้เครื่องยนต์เดียวกัน แต่ Vercel มีเวลาและที่เก็บไฟล์จำกัด คลิปยาวอาจดูไม่ครบ — ใช้เฉพาะตอนเครื่องแอดมินดับ' };
  }

  const mode = state === 'alive' ? 'queue' : state === 'unknown' ? 'queue-unknown' : (backup.enabled ? 'queue-offline' : 'queue-blocked');
  return { mode, platform: d.platform, isClip: true, primary, backup };
}

/** ข้อความ + สีของชิปสถานะเครื่องแอดมินบนหัวหน้า */
export function workerChip(worker) {
  if (!worker || !worker.known) return { text: `${MACHINE}: ไม่ทราบสถานะ`, color: '#9ca3af', dot: '#9ca3af' };
  if (worker.alive) return { text: `${MACHINE}พร้อม`, color: '#22c55e', dot: '#22c55e' };
  const s = Number(worker.secondsAgo) || 0;
  const ago = s < 3600 ? `${Math.round(s / 60)} นาที` : `${Math.round(s / 3600)} ชม.`;
  return { text: `${MACHINE}ดับ (เงียบไป ${ago})`, color: '#ef4444', dot: '#ef4444' };
}

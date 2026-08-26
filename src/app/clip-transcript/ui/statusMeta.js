/**
 * statusMeta — สมองกลางของ UI ถอดคลิป (pure logic ไม่มี JSX ห้าม import React)
 * ผูกกับค่าสถานะจริงในโค้ดหลังบ้าน:
 *   pending/processing/retry_wait/done/error  → worker/route.js + submit/route.js
 *   cancelled                                 → cancel/route.js (เพิ่ม 26 ส.ค. 69 — เดิมลบใบทิ้ง)
 * เทส: tests/clip-ui-status-meta.test.mjs
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

/** ป้ายสถานะสมองตรวจหลังถอด (insight.brain.status — ค่าจริง 4 ค่าจาก clipVerify/run-newpipe) */
export const BRAIN_META = {
  'สะอาด':      { emoji: '✅', color: '#22c55e', bg: 'rgba(34,197,94,.12)',   note: 'ตรวจกับเฉลยแล้ว ไม่พบจุดผิด' },
  'ซ่อมแล้ว':   { emoji: '🩹', color: '#38bdf8', bg: 'rgba(56,189,248,.12)',  note: 'พบจุดผิดและซ่อมอัตโนมัติแล้ว' },
  'มีข้อสังเกต': { emoji: '👀', color: '#fbbf24', bg: 'rgba(251,191,36,.12)',  note: 'มีจุดเล็กน้อย ไม่ร้ายแรง' },
  'ต้องตรวจ':   { emoji: '⚠️', color: '#f97316', bg: 'rgba(249,115,22,.12)',  note: 'เหลือจุดร้ายแรง คนควรตรวจก่อนใช้' },
};
export function getBrainMeta(status) {
  return (status && BRAIN_META[status]) || null;
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
const RE_CLIP = /youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch|instagram\.com/i;
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
export function isClipUrl(url) { return RE_CLIP.test(String(url || '')); }
export function isMetaUrl(url) { return RE_META.test(String(url || '')); }

export function platformIcon(p) {
  return { youtube: '▶️', tiktok: '🎵', meta: '📘', article: '📰' }[p] || '🎬';
}

/** แนะนำเส้นทางหลักจากลิงก์: insight (คลิป) / news-hunt (ลิงก์ข่าว) / null */
export function recommendAction(url) {
  const d = detectLink(url);
  if (d.isClip) return 'insight';
  if (d.platform === 'article') return 'news-hunt';
  return null;
}

/**
 * ★ 26 ส.ค. 69 (เจ้าของสั่ง): "ทุกช่องทางถอดเครื่องทีมปุ่มเดียว · เครื่องทีมปิดค่อยถอดสำรองบน Vercel เฉพาะอันที่ถอดได้"
 * ตัดสินให้ปุ่มเดียวว่าจะไปทางไหน — ไม่ให้พนักงานต้องจำเอง
 *   queue  = ส่งเครื่องทีม (ทางหลักทุกแพลตฟอร์ม — เครื่องทีมโหลดคลิปได้ทุกช่องทาง)
 *   direct = ถอดสดบนคลาวด์ (สำรอง เฉพาะ YouTube/TikTok ที่คลาวด์ทำได้)
 *   blocked = เครื่องทีมปิด และคลาวด์ทำแพลตฟอร์มนี้ไม่ได้ (Facebook/IG ต้องใช้ yt-dlp บนเครื่องทีม)
 */
const CLOUD_CAPABLE = new Set(['youtube', 'tiktok']);
export function planClipRoute(url, workerAlive) {
  const d = detectLink(url);
  if (!d.isClip) return { mode: 'not-clip', platform: d.platform, label: '' };
  if (workerAlive) {
    return { mode: 'queue', platform: d.platform, label: 'ส่งเครื่องทีมถอด', why: 'เครื่องทีมพร้อม — ถอดได้ทุกช่องทาง คุณภาพสูงสุด' };
  }
  if (CLOUD_CAPABLE.has(d.platform)) {
    return { mode: 'direct', platform: d.platform, label: 'ถอดสำรองบนคลาวด์', why: 'เครื่องทีมปิดอยู่ — ลิงก์นี้คลาวด์ถอดแทนได้' };
  }
  return {
    mode: 'blocked', platform: d.platform, label: 'รอเครื่องทีมเปิด',
    why: 'เครื่องทีมปิดอยู่ และลิงก์ Facebook/IG ต้องโหลดไฟล์จากเครื่องทีมเท่านั้น — กดส่งเข้าคิวไว้ได้ เครื่องทีมเปิดเมื่อไหร่จะถอดให้เอง',
  };
}

/** ข้อความ + สีของชิปสถานะเครื่องทีมบนหัวหน้า */
export function workerChip(worker) {
  if (!worker || !worker.known) return { text: 'เครื่องทีม: ไม่ทราบสถานะ', color: '#9ca3af', dot: '#9ca3af' };
  if (worker.alive) return { text: 'เครื่องทีมพร้อม', color: '#22c55e', dot: '#22c55e' };
  const s = Number(worker.secondsAgo) || 0;
  const ago = s < 3600 ? `${Math.round(s / 60)} นาที` : `${Math.round(s / 3600)} ชม.`;
  return { text: `เครื่องทีมปิด (เงียบไป ${ago})`, color: '#ef4444', dot: '#ef4444' };
}

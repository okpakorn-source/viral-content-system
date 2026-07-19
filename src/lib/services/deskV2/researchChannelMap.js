/**
 * ============================================================
 * 🧭 Research Channel Map (เฟส 1) — ระบุ "แพลตฟอร์มจริง" ของ URL + จัดกลุ่มแพลตฟอร์ม
 * ============================================================
 * ปัญหาที่แก้: candidate เดิมติดป้าย channel = "ช่องที่ยิงค้น" (discoveredVia) ไม่ใช่แพลตฟอร์มจริง
 *   เช่นค้นผ่าน 'google' (search เพียว) แต่ลิงก์ที่เจอเป็น tiktok.com/instagram.com → ถูกนับเป็น 'google'
 *   ทำสถิติช่องทางเพี้ยน + แบ่งโควตา/เลนสัมภาษณ์ผิดในเฟสถัดไป
 *
 * 🔴 pure JS + ไม่มี import ใดๆ (node --test ตรงได้ ไม่ง้อ node_modules/stub) — เฟสอื่น (hunt/diversify/metrics) เอาไปใช้ต่อ
 * 🔴 ไม่เดาเมื่อไม่มั่นใจ: URL เสีย/host ไม่รู้จัก → คืน "ช่องที่ยิงค้น" เดิม (discoveredVia) ไม่มโนแพลตฟอร์ม
 */

// ── ช่อง "ยิงค้น" ที่ระบบใช้จริง (search channels) — คนละชุดกับ "แพลตฟอร์มจริง" ที่ resolve ออกมา ──
//   NB: instagram ไม่อยู่ในนี้ (ยิงค้น IG ตรงยังไม่มี) แต่ resolve ออกมาเป็น 'instagram' ได้จากลิงก์ที่เจอผ่าน google/videos
export const SEARCH_CHANNELS = ['videos', 'facebook', 'reels', 'tiktok', 'youtube', 'google'];

function hostOfUrl(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}
function pathOfUrl(url) {
  try { return new URL(String(url)).pathname.toLowerCase(); }
  catch { return ''; }
}

/**
 * resolveCandidateChannel — ระบุแพลตฟอร์มจริงจาก URL (เทียบ host/path)
 * กฎ (ตามแผน sol เฟส 1):
 *   youtube.com | youtu.be            → 'youtube'
 *   tiktok.com                        → 'tiktok'
 *   instagram.com | instagr.am        → 'instagram'
 *   facebook.com/reel* | fb.watch     → 'reels'
 *   facebook อื่นๆ                     → 'facebook'
 *   host ไม่รู้จัก + ยิงผ่าน 'videos'   → 'videos' (ผลวิดีโอที่ไม่ใช่ social)
 *   host ไม่รู้จัก + ยิงผ่านช่องอื่น     → 'google' (เว็บทั่วไป)
 *   URL เสีย/ว่าง                       → คืน discoveredVia เดิม (ไม่เดา)
 * @param {string} url
 * @param {string} discoveredVia - ช่องที่ใช้ยิงค้น (หนึ่งใน SEARCH_CHANNELS)
 * @returns {string} channel แพลตฟอร์มจริง
 */
export function resolveCandidateChannel(url, discoveredVia) {
  const via = SEARCH_CHANNELS.includes(discoveredVia) ? discoveredVia : 'google';
  const host = hostOfUrl(url);
  if (!host) return via; // URL เสีย → ไม่เดา คืนช่องที่ยิงมา

  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('instagram.com') || host.includes('instagr.am')) return 'instagram';
  if (host.includes('fb.watch')) return 'reels';
  if (host.includes('facebook.com') || host === 'fb.com' || host.endsWith('.fb.com')) {
    return pathOfUrl(url).includes('/reel') ? 'reels' : 'facebook';
  }

  // host ไม่ใช่ social/แพลตฟอร์มที่รู้จัก
  if (via === 'videos') return 'videos'; // ผลวิดีโอที่ไม่ใช่ social
  return 'google'; // เว็บทั่วไป (สำนักข่าว ฯลฯ)
}

/**
 * platformGroupOf — จัดกลุ่มแพลตฟอร์มให้ตรงกับ targets.platformPct ({meta,tiktok,youtube})
 *   meta = facebook + reels + instagram (ตระกูล Meta) · tiktok · youtube
 *   web  = google/videos (เว็บ/สำนักข่าว — นับแยก ไม่ใช่ platform content) · other = อื่นๆ
 * @param {string} channel
 * @returns {'youtube'|'tiktok'|'meta'|'web'|'other'}
 */
export function platformGroupOf(channel) {
  const c = String(channel || '').toLowerCase();
  if (c === 'youtube') return 'youtube';
  if (c === 'tiktok') return 'tiktok';
  if (c === 'facebook' || c === 'reels' || c === 'instagram') return 'meta';
  if (c === 'google' || c === 'videos') return 'web';
  return 'other';
}

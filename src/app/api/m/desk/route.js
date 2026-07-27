/**
 * /api/m/desk — ประตูโต๊ะข่าวกลาง (v1) สำหรับแอพมือถือ /m (27 ก.ค. 69 — ชุด B ชุบชีวิตโต๊ะข่าว, เจ้าของสั่ง)
 * ─────────────────────────────────────────────────────────────
 * ต่อท่อเดียวกับ /news-desk (v1) แต่:
 *   - ด่านสิทธิ์ = ต้องล็อกอินยูสพนักงานจริง (session) เท่านั้น — ★ 27 ก.ค. 69 (เจ้าของสั่ง): เปิดให้ทุกคนที่ล็อกอินใช้ได้
 *     ถอดด่านเฉพาะแอดมินออกแล้ว (เดิมพนักงานโดน 403) — ยังต้องมี session จริงอยู่ (401 ถ้าไม่ได้ล็อกอิน)
 *   - จำกัด action ที่ยิงต่อได้เฉพาะ whitelist ข้างล่าง — ห้ามแอพยิงตรงเข้า /api/news-desk/* เปลือย
 *   - ผู้ใช้ = ดึงจาก session เสมอ (ปลอมไม่ได้จากฝั่ง client)
 * 🔴 ห้ามแตะ /api/news-desk/* — ไฟล์นี้เป็นแค่ประตูส่งต่อ ไม่มี business logic ใหม่
 * GET  ?view=feed&tab=all|trend|good|shortlist|ready   → forward GET /api/news-desk?tab=...&limit=30 (tab ผิด = 400)
 * GET  ?view=jobs                                      → forward GET /api/quick-test?kinds=desk_harvest,desk_search,desk_chief&limit=10 ★ 27 ก.ค. 69 (แก้ sol-review: กรองที่ต้นทางแทน slice เอง)
 * POST {action:'harvest', mode}            → สร้างงานคิว /api/quick-test kind='desk_harvest' {mode} (mode ต้องอยู่ใน HARVEST_MODE_KEYS เท่านั้น)
 * POST {action:'chief'}                    → สร้างงานคิว /api/quick-test kind='desk_chief'
 * POST {action:'card', cardAction, id}     → forward POST /api/news-desk {action:cardAction, id, user} (การ์ดเร็ว ไม่ผ่านคิว)
 * POST {action:'searchKeyword', keyword}   → สร้างงานคิว /api/quick-test kind='desk_search' {keyword} (2-60 ตัวอักษร เท่านั้น)
 * POST {action:'fetchThumbs', ids}         → อ่าน/patch item ใน store 'news-desk' ตรงๆ (lib เดียวกับ /api/news-desk) หา og:image ให้ใบที่ไม่มีรูป ★ 27 ก.ค. 69
 * ★ sol-review 27 ก.ค. 69: ตัด `lanes` ออกจาก gateway (UI ส่งแต่ mode — กันยิง mode มั่วแล้วปลายทางตกไปรันหนักทุกเลน)
 *   + ตัด editorRun ออกจาก whitelist (รอบนี้ไม่มีปุ่มใช้จริง — ลด surface, ค่อยคืนตอนมีปุ่ม)
 * ★ 27 ก.ค. 69 (เจ้าของอนุมัติ — อัปเกรดแท็บโต๊ะข่าวใน /m ให้ครบเท่าโต๊ะกลาง):
 *   + เปิด FEED_TABS รับ 'shortlist'/'ready' (คลังส่งเช้า/พร้อมใช้ — endpoint จริงมีอยู่แล้วที่ /api/news-desk?tab=shortlist|ready)
 *   + เพิ่ม action 'searchKeyword' (ช่องค้นเองในจอเดิม — ยิง harvest ด้วยคำค้นตรงๆ ไม่ใช่ mode) จำกัดความยาวเข้ม กันยิงคำยาว/มั่ว
 * ★ 27 ก.ค. 69 (ชุดนี้ — เจ้าของอนุมัติ): harvest/searchKeyword/chief เปลี่ยนจาก sync forward (ค้างจอ 2-10+ นาที) → สร้างงานคิว
 *   ผ่าน /api/quick-test (ระบบเดียวกับทำปก) แล้วคืน {jobId,dispatch} ทันที — กดแล้วปิดจอได้ ผลโผล่ทีหลังผ่านโพล ?view=jobs
 *   ★ ต้องแนบคีย์ทีม (x-cover-test-key) แบบเดียวกับ /api/m/cover — middleware กั้น /api/quick-test บนคลาวด์ (ดู src/middleware.js)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // ★ 27 ก.ค. 69: harvest/chief ย้ายไปคิวเบื้องหลังแล้ว — เหลือแค่ card/feed/jobs ที่ตอบเร็ว

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { HARVEST_MODE_KEYS } from '@/lib/services/newsDesk/taxonomy'; // ★ sol-review: whitelist mode จากคีย์จริง (มี 'all' รวมอยู่แล้ว) ไม่ hardcode ซ้ำ
// ★ 27 ก.ค. 69: fetchThumbs อ่าน/เขียน item เดียวกับที่ /api/news-desk/route.js ใช้ (store 'news-desk') — import lib ตรง ไม่แตะ route เดิม
import { createStore } from '@/lib/persistStore';

async function sess() {
  try {
    const c = await cookies();
    const token = c.get('auth_token')?.value;
    return token ? await getSession(token) : null;
  } catch { return null; }
}

const unauthorized = () => NextResponse.json({ success: false, error: 'ต้องล็อกอินก่อน', errorType: 'UNAUTHORIZED' }, { status: 401 });
// ★ 27 ก.ค. 69 (เจ้าของสั่ง): ตัดด่านแอดมินออก — เหลือแค่ unauthorized() (session) ด้านบน

// ★ 27 ก.ค. 69: แนบคีย์ทีมแบบเดียวกับ src/app/api/m/cover/route.js — จำเป็นเพราะ middleware กั้น POST/GET /api/quick-test บนคลาวด์
const keyHeaders = () => ({
  'Content-Type': 'application/json',
  ...(process.env.COVER_TEST_KEY ? { 'x-cover-test-key': process.env.COVER_TEST_KEY } : {}),
});

// ── whitelist ทางเข้า — เพิ่มทีหลังได้ แต่ห้ามเปิดกว้างเป็น pass-through เปลือย ──
// ★ 27 ก.ค. 69: + shortlist (⭐ คลังส่งเช้า) / ready (✅ พร้อมใช้) — endpoint จริงมีอยู่แล้ว (/api/news-desk?tab=shortlist|ready) แค่เปิดผ่าน
const FEED_TABS = new Set(['all', 'trend', 'good', 'shortlist', 'ready']);
const POST_ACTIONS = new Set(['harvest', 'chief', 'card', 'searchKeyword', 'fetchThumbs']); // ★ sol-review 27 ก.ค. 69: ตัด editorRun ออก — ยังไม่มีปุ่มใช้จริงรอบนี้ · +searchKeyword 27 ก.ค. 69 (ช่องค้นเอง) · +fetchThumbs 27 ก.ค. 69 (เติมรูปอัตโนมัติ)
// ★ ตัดสินใจ 27 ก.ค. 69: การ์ดในแอพมือถือมีแค่ 2 ปุ่ม (ส่งเขียน/ทิ้ง) — จำกัด cardAction เท่าที่ UI ใช้จริง
//   'sendWorkflow' (ไม่ใช่ 'sent') เพราะเป็นตัวที่ส่งเข้า /api/queue/add จริง (ดู src/app/api/news-desk/route.js action=sendWorkflow)
//   'sent' เดิมแค่ mark สถานะเฉยๆ ไม่ได้ส่งงานจริง — ใช้ sendWorkflow ตรงๆ กันเขียนตรรกะสร้าง input ซ้ำซ้อนฝั่งนี้
const CARD_ACTIONS = new Set(['dismiss', 'sendWorkflow']);

// ★ 27 ก.ค. 69: เติมรูปอัตโนมัติ — ดึงหน้า url แล้วหา og:image/twitter:image ด้วย regex เบาๆ (ไม่ parse DOM เต็ม)
//   timeout 5 วิ/hop + UA ปกติ (บางเว็บบล็อก UA ว่าง/บอท) · ล้มต่อใบ = คืน null เงียบๆ ไม่พังทั้งชุด
// 🔴 กำชับเจ้าของ 27 ก.ค. 69: "หารูปไม่เจอไม่เป็นไร ไม่ต้องพยายาม เดี๋ยวพัง" — ลอง 1 ครั้ง/ใบเท่านั้น
//   ห้ามเพิ่ม retry/fallback/วิธีดึงหนักกว่านี้ (เช่น headless browser, retry เมื่อ timeout ฯลฯ) เด็ดขาด —
//   ไม่เจอ = ปกติ ไม่ใช่ error, มาร์ก thumbTriedAt แล้วข้ามถาวร 7 วัน (ดู NEG_CACHE_MS ใน fetchThumbs ด้านล่าง)
//   (การตาม redirect ≤2 ชั้นด้านล่าง = ส่วนหนึ่งของ "1 ครั้ง" เดียวกัน ไม่ใช่ retry — คือการตามคำขอเดิมให้จบ)
// ★ sol-review วิกฤต 1 (SSRF): url มาจาก item.url ในคลังข่าว (ค้นเว็บอัตโนมัติ ไม่ใช่ผู้ใช้พิมพ์ตรงๆ แต่ก็เป็น
//   ข้อมูลจากภายนอกที่เราไม่ควบคุม) — ต้องกัน SSRF เข้า network ภายใน (localhost/LAN/cloud-metadata) ให้ครบ:
//   (1) protocol http/https เท่านั้น (2) hostname ห้ามเป็น IP ส่วนตัว/loopback/link-local/localhost
//   (3) redirect แบบ manual + validate ปลายทางซ้ำทุกชั้น (สูงสุด 2 ชั้น) กัน redirect เด้งเข้าเครือข่ายภายใน
//   (4) จำกัดขนาดจริงด้วย stream reader (ไม่ใช่แค่ slice หลัง res.text() ซึ่งโหลดเต็มไฟล์เข้าหน่วยความจำก่อนอยู่ดี)
//   (5) og:image ที่ได้ต้องเป็น http(s) เท่านั้น (กัน javascript:/data: หลุดไปเป็น src ฝั่งจอ)
//   ⚠️ ไม่ครอบคลุม DNS rebinding (hostname เป็นสาธารณะตอนเช็คแต่ resolve เป็นไอพีภายในตอน fetch จริง) หรือ IP
//   รูปแบบเลขฐาน 10/hex/octal (เช่น http://2130706433/) — เกินสโคปที่รีวิวรอบนี้ขอ (เช็คแบบ hostname/string เท่านั้น)
const THUMB_FETCH_TIMEOUT = 5000;
const THUMB_MAX_BYTES = 200 * 1024; // 200KB — og/twitter meta อยู่ต้น <head> เสมอ ไม่ต้องโหลดทั้งหน้า
const THUMB_MAX_REDIRECTS = 2;
const THUMB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** true = hostname เป็น IP ส่วนตัว/loopback/link-local/localhost (ต้องปัดตกเสมอ) */
function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, ''); // ปลดวงเล็บ IPv6 literal เช่น [::1]
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0') return true;
  if (h.startsWith('::')) return true; // IPv6 loopback/unspecified/IPv4-mapped ทั้งชุด (::1, ::, ::ffff:7f00:1 ที่มาจาก ::ffff:127.0.0.1 ฯลฯ)
  if (h.includes(':') && (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd'))) return true; // link-local/unique-local เฉพาะ IPv6 literal จริง (กันโดเมนจริงขึ้นต้น fc/fd เช่น fcnews.co.th โดนบล็อกผิด)
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.?$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (![a, b, Number(m[3]), Number(m[4])].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return true; // ไม่ใช่ IPv4 ปกติ → ปัดตกไว้ก่อน
    if (a === 10) return true;               // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true;              // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + cloud metadata 169.254.169.254)
    if (a === 0) return true;                // 0.0.0.0/8
    return false;
  }
  return false;
}
/** parse + ตรวจ url ปลอดภัยก่อนยิงจริง — คืน URL object ถ้าผ่าน ไม่งั้น null (ใช้ซ้ำทั้งจุดเริ่มต้นและทุกชั้น redirect) */
function safeFetchUrl(u) {
  let p;
  try { p = new URL(String(u || '')); } catch { return null; }
  if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
  if (isPrivateHostname(p.hostname)) return null;
  return p;
}
/** fetch แบบตามเองสูงสุด THUMB_MAX_REDIRECTS ชั้น — validate ปลายทางซ้ำทุกชั้นด้วยเกณฑ์เดียวกัน (กัน redirect เด้งเข้า LAN) */
async function fetchWithManualRedirect(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop <= THUMB_MAX_REDIRECTS; hop++) {
    const safe = safeFetchUrl(current);
    if (!safe) return null;
    let res;
    try {
      res = await fetch(safe.href, {
        headers: { 'User-Agent': THUMB_UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(THUMB_FETCH_TIMEOUT),
        redirect: 'manual',
      });
    } catch { return null; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || hop === THUMB_MAX_REDIRECTS) return null; // เกินโควตา redirect แล้วยังไม่ถึงปลายทาง
      try { current = new URL(loc, safe.href).href; } catch { return null; }
      continue;
    }
    return { res, finalUrl: safe.href };
  }
  return null;
}
/** อ่าน body ผ่าน stream reader สะสมไม่เกิน maxBytes แล้ว cancel ทันที (กันหน้าใหญ่ยัดหน่วยความจำ/แบนด์วิดท์) */
async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    // ไม่มี streaming reader (เช่น mock ในเทส) — fallback อ่านเต็มแล้วตัด ยังปลอดภัยแค่ไม่ประหยัดแบนด์วิดท์เท่า
    const t = await res.text().catch(() => '');
    return t.slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = '';
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    try { await reader.cancel(); } catch { /* เพิกเฉย — ปิดต่อไม่ได้ก็ไม่ใช่เรื่องร้าย */ }
  }
  return out.slice(0, maxBytes);
}
async function extractOgImage(pageUrl) {
  try {
    const hop = await fetchWithManualRedirect(pageUrl);
    if (!hop || !hop.res.ok) return null;
    const { res, finalUrl } = hop;
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(ct)) return null; // ★ วิกฤต 1: ต้องเป็นหน้า HTML เท่านั้น
    const html = await readCapped(res, THUMB_MAX_BYTES);
    // รองรับสองลำดับ attribute (property/content สลับกันได้ในหน้าจริง)
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*\scontent=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*\s(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/i);
    const raw = m ? m[1].trim() : null;
    if (!raw) return null;
    let abs;
    try { abs = new URL(raw, finalUrl).href; } catch { return null; } // เจอ path สัมพัทธ์ → ผูกกับ origin หน้าที่ fetch จริง (หลัง redirect)
    if (!/^https?:\/\//i.test(abs)) return null; // ★ วิกฤต 1: og:image ต้องเป็น http(s) เท่านั้น กัน javascript:/data:
    return abs;
  } catch { return null; }
}

export async function GET(request) {
  try {
    const s = await sess();
    if (!s) return unauthorized(); // ★ 27 ก.ค. 69: เปิดให้ทุกคนที่ล็อกอินใช้ได้ — ตัดด่าน role!=='admin' ออกแล้ว

    const view = request.nextUrl.searchParams.get('view') || 'feed';

    // ★ 27 ก.ค. 69 (sol-review วิกฤต 2): รายการงานเบื้องหลังโต๊ะข่าว (harvest/search/chief) — จอมือถือโพลดูสถานะสด
    //   forward GET /api/quick-test พร้อม kinds= (แนบคีย์ทีมเหมือน /api/m/cover) — เลิกกรอง/slice เองฝั่งนี้
    //   (เดิมดึง limit=40 มากรองทีหลัง พลาดได้ถ้างานปกยิงถี่จนงานโต๊ะหลุดพ้นหน้าต่าง 40 — ตอนนี้กรองก่อนตัด limit ที่ต้นทาง)
    if (view === 'jobs') {
      const r = await fetch(`${request.nextUrl.origin}/api/quick-test?limit=10&kinds=desk_harvest,desk_search,desk_chief`, {
        headers: keyHeaders(), cache: 'no-store', signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    if (view !== 'feed') {
      return NextResponse.json({ success: false, error: `view ไม่รู้จัก: ${view}`, errorType: 'BAD_VIEW' }, { status: 400 });
    }
    const tab = request.nextUrl.searchParams.get('tab') || 'all';
    // ★ sol-review 27 ก.ค. 69: tab ผิด → ตอบ 400 ตรงๆ (เลิก fallback เงียบเป็น 'all')
    if (!FEED_TABS.has(tab)) {
      return NextResponse.json({ success: false, error: `tab ไม่รู้จัก: ${tab}`, errorType: 'BAD_TAB' }, { status: 400 });
    }

    const r = await fetch(`${request.nextUrl.origin}/api/news-desk?tab=${tab}&limit=30`, {
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const d = await r.json();
    return NextResponse.json(d, { status: r.status });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'M_DESK_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const s = await sess();
    if (!s) return unauthorized(); // ★ 27 ก.ค. 69: เปิดให้ทุกคนที่ล็อกอินใช้ได้ — ตัดด่าน role!=='admin' ออกแล้ว
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    if (!POST_ACTIONS.has(action)) {
      return NextResponse.json({ success: false, error: `action ไม่รู้จัก: ${action}`, errorType: 'BAD_ACTION' }, { status: 400 });
    }
    const user = s.displayName || s.username || 'ทีม';

    // ★ 27 ก.ค. 69 (ชุดนี้): ล่าข่าวรอบใหม่ — โหมดต้องอยู่ใน HARVEST_MODE_KEYS เท่านั้น (fresh/viral/evergreen/celeb/followup/all)
    //   ★ sol-review 27 ก.ค. 69: ตัด `lanes` ออกจาก gateway ไปเลย (UI ส่งแต่ mode — กันยิง mode มั่วแล้วปลายทางตกไปรันหนักทุกเลน)
    //   ★ เปลี่ยนจาก sync forward → สร้างงานคิว /api/quick-test (งานยาว 9+ นาที ห้ามค้างจอ) validation คงไว้ที่ประตูนี้เหมือนเดิม
    if (action === 'harvest') {
      const mode = String(body.mode || '');
      if (!HARVEST_MODE_KEYS.includes(mode)) {
        return NextResponse.json({ success: false, error: `mode ไม่ถูกต้อง: ${mode}`, errorType: 'BAD_MODE' }, { status: 400 });
      }
      const r = await fetch(`${request.nextUrl.origin}/api/quick-test`, {
        method: 'POST', headers: keyHeaders(),
        body: JSON.stringify({ kind: 'desk_harvest', mode }),
        signal: AbortSignal.timeout(20000), // แค่สร้างงาน+คืน jobId ทันที ไม่รอผล
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    // ★ 27 ก.ค. 69: ช่องค้นเอง (ใส่ชื่อคน/แนว) — สร้างงานคิว desk_search (ไม่ sync forward แล้ว เหมือน harvest ข้างบน)
    //   จำกัดยาวเข้ม (2-60 ตัวอักษร — ★ sol-review: ตรงกับที่ /api/news-desk/harvest ตัดจริงด้วย .slice(0,60) กันค่าเกินโดนตัดเงียบ)
    if (action === 'searchKeyword') {
      const keyword = String(body.keyword || '').trim();
      if (keyword.length < 2 || keyword.length > 60) {
        return NextResponse.json({ success: false, error: 'คีย์เวิร์ดต้องยาว 2-60 ตัวอักษร', errorType: 'BAD_KEYWORD' }, { status: 400 });
      }
      const r = await fetch(`${request.nextUrl.origin}/api/quick-test`, {
        method: 'POST', headers: keyHeaders(),
        body: JSON.stringify({ kind: 'desk_search', keyword }),
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    // ★ บก.ใหญ่ — วินิจฉัยภาพรวมโต๊ะ + สั่งลาดตระเวนเพิ่ม — สร้างงานคิว desk_chief (เดิม sync ค้างจอถึง 10+ นาที)
    if (action === 'chief') {
      const r = await fetch(`${request.nextUrl.origin}/api/quick-test`, {
        method: 'POST', headers: keyHeaders(),
        body: JSON.stringify({ kind: 'desk_chief' }),
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    // ★ 27 ก.ค. 69: เติมรูปอัตโนมัติ — ใบไหนใน news-desk ยังไม่มีรูป → ดึงหน้า url หา og:image แล้ว patch ถาวรลง store
    //   ทำงานขนาน ≤5 ใบพร้อมกัน · ล้มต่อใบไม่กระทบใบอื่น · ไม่ throw ออกนอก try รวม (จอห้ามพัง)
    //   ★ sol-review ข้อ 3: เขียนลง `thumbUrl` (ไม่ใช่ `imageUrl` — imageUrl มีผล +4 คะแนนคัดข่าวใน editorialCard/multiScores
    //   ของ taxonomy.js) + มาร์ก `thumbTriedAt` เสมอไม่ว่าเจอหรือไม่ (negative cache — ข้ามใบที่ลองไปแล้วภายใน 7 วัน
    //   กันยิงซ้ำเว็บเดิมที่ไม่มี og:image ทุกครั้งที่จอโหลด)
    if (action === 'fetchThumbs') {
      // ★ sol-review ข้อ 4: เพดาน 10→30 ต่อคำขอ (ขนานยังคง ≤5 เท่าเดิม — ยิงเป็นชุดย่อย ไม่กระทบโหลดพร้อมกัน)
      const ids = (Array.isArray(body.ids) ? body.ids : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 30);
      if (!ids.length) return NextResponse.json({ success: false, error: 'ต้องระบุ ids', errorType: 'BAD_INPUT' }, { status: 400 });
      const store = createStore('news-desk');
      const images = {};
      const CONCURRENCY = 5;
      const NEG_CACHE_MS = 7 * 24 * 3600 * 1000; // 7 วัน
      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const batch = ids.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (id) => {
          try {
            const item = await store.findById(id);
            if (!item) return;
            if (item.imageUrl) { images[id] = item.imageUrl; return; } // มีรูปจริงอยู่แล้ว (ของเดิม/แหล่งอื่นเติมไปก่อนหน้า)
            if (item.thumbUrl) { images[id] = item.thumbUrl; return; } // เคยเจอ og:image ไว้แล้ว — คืนของเดิม ไม่ยิงซ้ำ
            if (item.thumbTriedAt && (Date.now() - new Date(item.thumbTriedAt).getTime()) < NEG_CACHE_MS) return; // ลองมาไม่เกิน 7 วัน + ไม่เจอ → ข้าม
            if (!item.url) return;
            const thumbUrl = await extractOgImage(item.url);
            await store.update(id, (ex) => ({ ...ex, thumbUrl: thumbUrl || ex.thumbUrl || null, thumbTriedAt: new Date().toISOString() })).catch(() => {});
            if (thumbUrl) images[id] = thumbUrl;
          } catch { /* ล้มต่อใบ ไม่กระทบใบอื่น */ }
        }));
      }
      return NextResponse.json({ success: true, images });
    }

    // ★ แอ็กชันการ์ด — จำกัดเฉพาะ dismiss/sendWorkflow (ดูเหตุผลที่ CARD_ACTIONS ด้านบน)
    if (action === 'card') {
      const cardAction = String(body.cardAction || '');
      if (!CARD_ACTIONS.has(cardAction)) {
        return NextResponse.json({ success: false, error: `cardAction ไม่รู้จัก: ${cardAction}`, errorType: 'BAD_CARD_ACTION' }, { status: 400 });
      }
      const id = String(body.id || '').trim();
      if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id', errorType: 'BAD_INPUT' }, { status: 400 });
      const r = await fetch(`${request.nextUrl.origin}/api/news-desk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: cardAction, id, user }),
        signal: AbortSignal.timeout(30000), // sendWorkflow เรียก /api/queue/add ต่อ + watchlist ข้างในตัวเอง มี race กันเองแล้ว
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'M_DESK_ERROR' }, { status: 500 });
  }
}

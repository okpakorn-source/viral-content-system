// ============================================================
// 🔌 searchQuotaCircuit — เช็คโควตาค้นภาพ SerpApi "ก่อนเผา LLM" (PURE + inject fetch เทสได้)
// ------------------------------------------------------------
// เหตุ (17 ก.ค. 69): SerpApi โควตาหมด (5000/5000) → ทุกการค้นได้ศูนย์ แต่คิว MEGA ยังเผา LLM
//   ขั้น compass/case/keywords ไปก่อน แล้วค่อยตายที่ค้นภาพ = เผาเงินฟรี · มติที่ประชุม: ต้องมี circuit
//   เช็คโควตา "ก่อน" จ่ายค่า LLM
//
// สัญญา: checkSearchQuota({ fetchImpl, env, now }) → { ok:boolean, left:number|null, reason:string }
//   • ถาม https://serpapi.com/account.json (endpoint นี้ "ไม่กินโควตาค้น") อ่าน field total_searches_left
//   • cache ในโมดูล ~5 นาที (memo ตาม now ที่ฉีดเข้ามา — เทสคุมเวลาได้ ไม่ต้องรอจริง)
//   • เช็คล้ม/ไม่มี key/fetch = fail-open { ok:true, left:null } — ★ ห้าม block งานเพราะ "ตัวเช็คพัง"
//   • เกณฑ์ไม่ ok: left < int(env.MEGA_QUOTA_MIN || '20')
//   • คีย์ env ที่ใช้ = SERPAPI_KEY (ตัวเดียวกับ src/app/api/images/search → imageSearch.js:getKey)
// ============================================================

const ACCOUNT_URL = 'https://serpapi.com/account.json';
const CACHE_TTL_MS = 5 * 60 * 1000; // ~5 นาที
const DEFAULT_MIN = 20;

// cache ระดับโมดูล — key ตาม apiKey (คนละคีย์ = คนละโควตา) → { at:number(now snapshot), left:number }
//   เก็บเฉพาะผลอ่านสด "ที่เป็นตัวเลขจริง" เท่านั้น (fail-open ไม่ cache — จะได้ลองใหม่ทุกครั้งจนอ่านได้)
const _cache = new Map();

// เปิดช่องล้าง cache ให้เทส (ไม่ผูกกับ production path)
export function _resetQuotaCache() { _cache.clear(); }

// parse int แบบปลอดภัย — ไม่ใช่จำนวนเต็ม ≥0 = ใช้ค่า default
function _int(v, dflt) {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : dflt;
}

// สร้างคำตัดสินจากจำนวนโควตาที่อ่านได้
function _verdict(left, min, source) {
  const ok = left >= min;
  return {
    ok,
    left,
    reason: ok
      ? `โควตาพอ: เหลือ ${left} (ขั้นต่ำ ${min}) [${source}]`
      : `SEARCH_QUOTA_EXHAUSTED: เหลือ ${left} < ขั้นต่ำ ${min} [${source}]`,
  };
}

export async function checkSearchQuota({ fetchImpl, env = {}, now = Date.now() } = {}) {
  const apiKey = env.SERPAPI_KEY;
  const min = _int(env.MEGA_QUOTA_MIN, DEFAULT_MIN);

  // ไม่มีคีย์ = ตรวจไม่ได้ → fail-open (อย่าบล็อกงานเพราะเราเองไม่รู้โควตา)
  if (!apiKey) return { ok: true, left: null, reason: 'ตรวจไม่ได้: ไม่มี SERPAPI_KEY (fail-open)' };

  const _fetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : (typeof fetch === 'function' ? fetch : null);
  if (!_fetch) return { ok: true, left: null, reason: 'ตรวจไม่ได้: ไม่มี fetch (fail-open)' };

  // cache สด (ภายใน TTL, keyed ตาม now) → ตอบจาก cache ไม่ยิงซ้ำ
  const cached = _cache.get(apiKey);
  if (cached && (now - cached.at) < CACHE_TTL_MS) {
    return _verdict(cached.left, min, 'cache');
  }

  let left = null;
  try {
    const usp = new URLSearchParams({ api_key: apiKey });
    const res = await _fetch(`${ACCOUNT_URL}?${usp.toString()}`);
    if (res && typeof res.json === 'function') {
      // res.ok === false → HTTP error (เช่น 401/429) = ตรวจไม่ได้ → fail-open (ไม่ cache)
      if (res.ok === false) {
        return { ok: true, left: null, reason: `ตรวจไม่ได้: HTTP ${res.status ?? '?'} (fail-open)` };
      }
      const j = await res.json();
      const raw = j?.total_searches_left;
      const n = Number(raw);
      left = Number.isFinite(n) ? n : null;
    }
  } catch (e) {
    // network/parse ล้ม = ตรวจไม่ได้ → fail-open (ไม่ cache)
    return { ok: true, left: null, reason: 'ตรวจไม่ได้: ' + String(e?.message || e).slice(0, 60) + ' (fail-open)' };
  }

  // อ่าน field ไม่ได้ = ตรวจไม่ได้ → fail-open (ไม่ cache)
  if (left == null) {
    return { ok: true, left: null, reason: 'ตรวจไม่ได้: อ่าน total_searches_left ไม่ได้ (fail-open)' };
  }

  _cache.set(apiKey, { at: now, left });
  return _verdict(left, min, 'live');
}

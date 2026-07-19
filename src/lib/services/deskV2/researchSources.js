/**
 * ============================================================
 * 🌐 Research Sources (โต๊ะข่าวกลาง v2, เฟส 4) — เพิ่มแหล่งข่าว + คุมอายุข่าว
 * ============================================================
 * หน้าที่: รับ "แหล่ง" หนึ่งแหล่ง (serper-news / google-news-rss / direct-rss /
 *   youtube-watch / instagram) → ยิงค้น/ดึงรายการดิบ → แปลงเป็นรูปกลาง SourceItem
 *   เดียวกันทุกแหล่ง (เทียบ/รวม/กรองอายุข่าวข้ามแหล่งได้ง่าย)
 *
 * 🔴 pure-ish: เครือข่ายทั้งหมดต้องผ่านพารามิเตอร์ที่ inject ได้ (fetchImpl/deps)
 *   ห้ามเรียก fetch ตรงแบบ hardcode ที่ mock ไม่ได้ · เวลาปัจจุบันต้องรับผ่าน `now`
 *   (ไม่มีสาขาที่ถูกเทสเรียกนาฬิการะบบเอง — ค่า default ใช้เฉพาะตอนไม่ได้ระบุมาเท่านั้น)
 * 🔴 ทุก field รูปภาพ (imageUrl/thumbnail/image/img/enclosure/thumbnails) ต้องถูกทิ้ง
 *   เสมอ — ทำโดยสร้างผลลัพธ์จาก allowlist ของฟิลด์ ไม่เคย spread ข้อมูลดิบทั้งก้อน
 * 🔴 แหล่งเดียวพัง (เครือข่ายล่ม/HTTP error/ผู้ให้ข้อมูลที่ inject มาโยน error) ต้องไม่
 *   ทำให้ทั้งรอบพัง — คืนสถานะ failed:true พร้อมข้อความ error ที่ไม่มีคีย์ลับหลุดออกมา
 *
 * import: อนุญาตเฉพาะ sanitizeText จากสัญญากลาง DNA — ไม่พึ่งชั้นเก็บข้อมูล/ตัวเรียกโมเดล
 *   เอไอ/ระบบจัดคิวใดๆ ในไฟล์นี้ (แยกหน้าที่ขาดจากกัน ทดสอบ/รีวิวง่าย)
 */

import { sanitizeText } from './dnaContract.js';

// ── นโยบายอายุข่าวสูงสุดต่อแหล่ง (วัน) — ผู้เชื่อม researchHunt ใช้ค่าเหล่านี้เป็นค่าเริ่มต้นได้ ──
export const FRESHNESS_POLICY = {
  directRss: 3,
  serperNews: 7,
  googleNewsRss: 7,
  youtubeWatch: 21,
  interview: 45,
};

// map sourceType (ตามที่ searchSource ใช้จริง) → maxAgeDays เริ่มต้นเมื่อผู้เรียกไม่ได้ระบุ
const MAX_AGE_BY_SOURCE_TYPE = {
  'direct-rss': FRESHNESS_POLICY.directRss,
  'serper-news': FRESHNESS_POLICY.serperNews,
  'google-news-rss': FRESHNESS_POLICY.googleNewsRss,
  'youtube-watch': FRESHNESS_POLICY.youtubeWatch,
};
const DEFAULT_MAX_AGE_DAYS = 7;

// ── field รูปภาพที่ต้องทิ้งเสมอ (อ้างอิงไว้เพื่อสื่อสารเจตนา — ตัวบังคับจริงคือ allowlist ด้านล่าง) ──
const DROPPED_IMAGE_FIELDS = ['imageUrl', 'thumbnail', 'image', 'img', 'enclosure', 'thumbnails'];
void DROPPED_IMAGE_FIELDS; // เอกสารอ้างอิง ไม่ได้ใช้ลบคีย์ตรงๆ (ผลลัพธ์สร้างจาก allowlist อยู่แล้ว จึงไม่มีทางหลุด)

// ================================================================
// เวลา/อายุข่าว
// ================================================================

/** อายุเป็นวัน (จำนวนเต็ม, ปัดลง, ไม่ติดลบ) จาก publishedAt เทียบกับ now · parse ไม่ได้/ว่าง → null */
function ageDaysOf(publishedAt, now) {
  if (!publishedAt) return null;
  const pub = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (isNaN(pub.getTime())) return null;
  const base = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Math.max(0, Math.floor((base - pub.getTime()) / 864e5));
}

/**
 * classifyFreshness — อายุ → ป้าย
 * policy = { fresh, recent, stale } เป็นจำนวนวัน (เกณฑ์สะสม)
 *   ageDays<=fresh → 'fresh' ; <=recent → 'recent' ; <=stale → 'evergreen' ; >stale → 'stale'
 *   publishedAt ว่าง/parse ไม่ได้ → 'unknown'
 */
export function classifyFreshness(publishedAt, policy, now = new Date()) {
  const ageDays = ageDaysOf(publishedAt, now);
  if (ageDays === null) return 'unknown';
  const p = policy && typeof policy === 'object' ? policy : {};
  const fresh = Number.isFinite(p.fresh) ? p.fresh : 1;
  const recent = Number.isFinite(p.recent) ? p.recent : Math.max(fresh, 3);
  const stale = Number.isFinite(p.stale) ? p.stale : Math.max(recent, 7);
  if (ageDays <= fresh) return 'fresh';
  if (ageDays <= recent) return 'recent';
  if (ageDays <= stale) return 'evergreen';
  return 'stale';
}

/**
 * policyFromMaxAgeDays — แปลง maxAgeDays เดียว (ต่อแหล่ง) เป็น {fresh,recent,stale} ให้ classifyFreshness
 *   กติกา: แบ่งสามส่วนเท่าๆ กัน (เศษหนึ่งส่วนสาม/สองส่วนสาม/เต็ม) แล้วปัดเป็นจำนวนเต็ม
 *   stale เท่ากับ maxAgeDays เสมอ (ขอบบนของ evergreen ตรงกับ maxAge ที่กำหนด)
 */
function policyFromMaxAgeDays(maxAgeDays) {
  const max = Math.max(1, Number(maxAgeDays) || DEFAULT_MAX_AGE_DAYS);
  const fresh = Math.max(1, Math.min(max, Math.round(max / 3)));
  const recent = Math.max(fresh, Math.min(max, Math.round((max * 2) / 3)));
  return { fresh, recent, stale: max };
}

/** parse วันที่แบบยืดหยุ่น: ISO/RFC822 (มีเลขปี 4 หลัก) หรือวลีสัมพัทธ์อังกฤษ "N unit(s) ago"/"yesterday" → ISO หรือ null */
function toIsoOrNull(value, now) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
  const s = String(value).trim();
  if (!s) return null;
  const base = now instanceof Date ? now.getTime() : new Date(now).getTime();

  if (/\d{4}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const rel = s.toLowerCase().match(/(\d+)\s*(minute|hour|day|week|month)s?\s+ago/);
  if (rel) {
    const n = Number(rel[1]);
    const unitMs = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 }[rel[2]];
    return new Date(base - n * unitMs).toISOString();
  }
  if (/^yesterday$/i.test(s)) return new Date(base - 864e5).toISOString();
  return null;
}

// ================================================================
// เดาแพลตฟอร์ม (ง่ายๆ ตามโจทย์เฟส 4 — ไม่ผูกกับตารางแพลตฟอร์มเต็มของเฟสอื่น)
// ================================================================

/** channel: youtube.com/youtu.be → 'youtube' · โฮสต์ตระกูล meta (facebook/instagram) → ชื่อของมัน ·
 *  โฮสต์อื่นที่ parse ได้ → 'google' · URL เสีย/ว่าง (ไม่รู้) → discoveredVia เดิม */
function guessChannel(url, discoveredVia) {
  let host = '';
  try { host = new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { host = ''; }
  if (!host) return discoveredVia || 'unknown';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('facebook.com') || host.includes('fb.watch') || host === 'fb.com') return 'facebook';
  if (host.includes('instagram.com') || host.includes('instagr.am')) return 'instagram';
  if (host.includes('tiktok.com')) return 'tiktok';
  return 'google';
}

/** platformGroup: youtube → 'youtube' · facebook/instagram/reels → 'meta' · อื่นๆ → 'web' */
function guessPlatformGroup(channel) {
  const c = String(channel || '').toLowerCase();
  if (c === 'youtube') return 'youtube';
  if (c === 'facebook' || c === 'instagram' || c === 'reels' || c === 'meta') return 'meta';
  return 'web';
}

// ================================================================
// normalizeSourceItem
// ================================================================

/**
 * normalizeSourceItem — raw ของ adapter ใดๆ → SourceItem กลาง (ทิ้งภาพทุก field, sanitize, ใส่ freshness)
 * @param {object} raw - ข้อมูลดิบ (รูปแบบต่างกันไปตามแหล่ง — อ่านเฉพาะฟิลด์ที่รู้จัก)
 * @param {object} context - { sourceType, discoveredVia, maxAgeDays, now, sourceName? }
 */
export function normalizeSourceItem(raw, context = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const now = context.now instanceof Date ? context.now : (context.now ? new Date(context.now) : new Date());
  const sourceType = context.sourceType || 'unknown';
  const discoveredVia = context.discoveredVia || sourceType;
  const maxAgeDays = Number.isFinite(context.maxAgeDays)
    ? context.maxAgeDays
    : (MAX_AGE_BY_SOURCE_TYPE[sourceType] ?? DEFAULT_MAX_AGE_DAYS);

  // ── allowlist ล้วน: ไม่ spread raw ทั้งก้อนเด็ดขาด → field รูปภาพไม่มีทางหลุดออกมา ──
  const url = sanitizeText(r.url ?? r.link ?? '', 500);
  const title = sanitizeText(r.title ?? '', 300);
  const snippet = sanitizeText(r.snippet ?? r.description ?? '', 300);
  const sourceName = sanitizeText(r.source ?? r.sourceName ?? r.watchChannel ?? context.sourceName ?? '', 120);

  const publishedAtRaw = r.publishedAt ?? r.date ?? r.pubDate ?? null;
  const publishedAt = toIsoOrNull(publishedAtRaw, now);
  const ageDays = ageDaysOf(publishedAt, now);
  const policy = policyFromMaxAgeDays(maxAgeDays);
  const freshness = classifyFreshness(publishedAt, policy, now);

  const channel = guessChannel(url, discoveredVia);
  const platformGroup = guessPlatformGroup(channel);

  return {
    url,
    title,
    snippet,
    sourceName,
    sourceType,
    discoveredVia,
    channel,
    platformGroup,
    publishedAt,
    ageDays,
    freshness,
  };
}

// ================================================================
// searchSource
// ================================================================

// ผู้ให้ข้อมูล default แบบไม่แตะเครือข่ายเอง (ปลอดภัย/กำหนดผลได้แน่นอน) — ผู้เรียกจริง (นอกไฟล์นี้)
// ต้อง inject ฟังก์ชันดึงฟีดจริงเข้ามาทาง deps เอง (ไฟล์นี้ไม่นำเข้าตัวยิงเครือข่ายของใครทั้งสิ้น)
const DEFAULT_DEPS = {
  fetchEntRss: async () => [],
  fetchYouTubeChannels: async () => [],
};

/** ปิดคีย์ลับไม่ให้หลุดในข้อความ error (กันไว้สองชั้น: ไม่ต่อคีย์ในข้อความเองอยู่แล้ว + ลบทิ้งถ้าหลุดมาจาก error ชั้นล่าง) */
function redactSecrets(msg) {
  let s = String(msg ?? 'unknown error');
  const secret = process.env.SERPER_API_KEY;
  if (secret) s = s.split(secret).join('[REDACTED]');
  return s;
}

// ── ตัวช่วยอ่าน XML แบบ regex เบาๆ (RSS2 <item>) — พอสำหรับ Google News RSS ไม่ต้องพึ่งไลบรารีนอก ──
function xmlBlocks(xml, tag) {
  return String(xml || '').match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'g')) || [];
}
function xmlTag(block, tag) {
  const m = String(block || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ')
    .trim();
}

/**
 * searchSource — ยิง 1 แหล่ง → { items:SourceItem[], failed:boolean, sourceType, calls:number, error?:string }
 * @param {object} opts
 * @param {'serper-news'|'google-news-rss'|'direct-rss'|'youtube-watch'|'instagram'} opts.source
 * @param {string[]} [opts.queries]
 * @param {number} [opts.maxResults]
 * @param {number} [opts.maxAgeDays]
 * @param {Date|string} [opts.now]
 * @param {Function} [opts.fetchImpl] - default: fetch ของ global (เทสควร inject เสมอ)
 * @param {{fetchEntRss?:Function, fetchYouTubeChannels?:Function}} [opts.deps]
 */
export async function searchSource({
  source,
  queries = [],
  maxResults = 10,
  maxAgeDays,
  now = new Date(),
  fetchImpl = fetch,
  deps = {},
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const effectiveDeps = { ...DEFAULT_DEPS, ...deps };

  if (source === 'instagram') {
    return { items: [], failed: false, sourceType: 'instagram', calls: 0, note: 'ต้องเครื่องทีม' };
  }

  if (source === 'serper-news') {
    let calls = 0;
    try {
      const items = [];
      for (const q of queries) {
        calls++;
        const res = await fetchImpl('https://google.serper.dev/news', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': process.env.SERPER_API_KEY || '',
          },
          body: JSON.stringify({ q, gl: 'th', hl: 'th', num: maxResults }),
        });
        if (!res || !res.ok) throw new Error(`serper-news request failed (status ${res ? res.status : 'n/a'})`);
        const data = await res.json();
        const list = (Array.isArray(data?.news) ? data.news : []).slice(0, maxResults);
        for (const n of list) {
          if (!n?.title || !n?.link) continue;
          items.push(normalizeSourceItem(
            { title: n.title, url: n.link, snippet: n.snippet, publishedAt: n.date, source: n.source },
            { sourceType: 'serper-news', discoveredVia: 'serper-news', maxAgeDays, now: nowDate },
          ));
        }
      }
      return { items, failed: false, sourceType: 'serper-news', calls };
    } catch (e) {
      return { items: [], failed: true, sourceType: 'serper-news', calls, error: redactSecrets(e?.message || e) };
    }
  }

  if (source === 'google-news-rss') {
    let calls = 0;
    try {
      const items = [];
      for (const q of queries) {
        calls++;
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=th&gl=TH&ceid=TH:th`;
        const res = await fetchImpl(url);
        if (!res || !res.ok) throw new Error(`google-news-rss request failed (status ${res ? res.status : 'n/a'})`);
        const xml = await res.text();
        const blocks = xmlBlocks(xml, 'item').slice(0, maxResults);
        for (const block of blocks) {
          const title = xmlTag(block, 'title');
          const link = xmlTag(block, 'link');
          if (!title || !link) continue;
          items.push(normalizeSourceItem(
            {
              title,
              url: link,
              snippet: xmlTag(block, 'description'),
              publishedAt: xmlTag(block, 'pubDate'),
              source: xmlTag(block, 'source') || 'Google News',
            },
            { sourceType: 'google-news-rss', discoveredVia: 'google-news-rss', maxAgeDays, now: nowDate },
          ));
        }
      }
      return { items, failed: false, sourceType: 'google-news-rss', calls };
    } catch (e) {
      return { items: [], failed: true, sourceType: 'google-news-rss', calls, error: redactSecrets(e?.message || e) };
    }
  }

  if (source === 'direct-rss') {
    try {
      const raw = await effectiveDeps.fetchEntRss({ maxAgeDays });
      const items = (Array.isArray(raw) ? raw : [])
        .filter((it) => it?.url && it?.title)
        .slice(0, maxResults)
        .map((it) => normalizeSourceItem(it, {
          sourceType: 'direct-rss', discoveredVia: 'direct-rss', maxAgeDays, now: nowDate, sourceName: it?.source,
        }));
      return { items, failed: false, sourceType: 'direct-rss', calls: 1 };
    } catch (e) {
      return { items: [], failed: true, sourceType: 'direct-rss', calls: 1, error: redactSecrets(e?.message || e) };
    }
  }

  if (source === 'youtube-watch') {
    try {
      const raw = await effectiveDeps.fetchYouTubeChannels({ maxAgeDays });
      const items = (Array.isArray(raw) ? raw : [])
        .filter((it) => it?.url && it?.title)
        .slice(0, maxResults)
        .map((it) => normalizeSourceItem(it, {
          sourceType: 'youtube-watch', discoveredVia: 'youtube-watch', maxAgeDays, now: nowDate, sourceName: it?.source || it?.watchChannel,
        }));
      return { items, failed: false, sourceType: 'youtube-watch', calls: 1 };
    } catch (e) {
      return { items: [], failed: true, sourceType: 'youtube-watch', calls: 1, error: redactSecrets(e?.message || e) };
    }
  }

  return { items: [], failed: true, sourceType: source, calls: 0, error: 'unsupported source' };
}

/**
 * =====================================================
 * News Desk Harvester — เครื่องเก็บข่าวเข้าโต๊ะข่าว (เฟส 1)
 * =====================================================
 * เลน 🔥 trend : Serper News ตามชุดคำค้นกระแส (สดภายใน 24-48 ชม.)
 * เลน 💎 good  : Serper News ชุดคำค้นน้ำดี — หมุนคำอัตโนมัติตามวัน ไม่ให้เจอแต่ข่าวซ้ำ
 * จากนั้นส่งเข้าสมอง 4 ชั้น (deskBrain) → ลงคลัง store 'news-desk'
 */

import crypto from 'crypto';
import { createStore } from '@/lib/persistStore';
import {
  gateKeywords, classifyBatch, fitScore, freshScore,
  loadArchiveTitles, isDuplicateOfArchive, editorialJudge, finalScore,
  getCategoryPerformance, keywordCategorize, keywordGore,
} from './deskBrain';

// ★ คลังคำค้นกระแส — ผ่าตัด 13 มิ.ย. 69 (ตัดคำกว้างที่ดูดขยะอากาศ/การเมือง/บอลออก)
//   เน้นเรื่องคน-ไวรัล-ดราม่าที่เพจเล่นได้จริง ไม่ใช่ "ข่าวสังคมวันนี้/โหนกระแส" ที่ดูดมั่ว
const TREND_QUERY_POOL = [
  'แห่ชื่นชม น้ำใจ ล่าสุด', 'สุดซึ้ง ชาวเน็ต ล่าสุด', 'คลิปไวรัล ประทับใจ ล่าสุด',
  'ครูนักเรียน เรื่องราวดี ไวรัล', 'คลิปกล้องวงจรปิด ช่วยเหลือ', 'ขอความเป็นธรรม ดราม่า ล่าสุด',
  'ดราม่าร้านดัง ล่าสุด', 'คนดังตอบกลับ ดราม่า ล่าสุด', 'เปิดใจทั้งน้ำตา ล่าสุด',
  'พลเมืองดี ไวรัล ล่าสุด', 'ทำดีได้ดี เรื่องจริง ไวรัล', 'สะเทือนใจ ชาวเน็ตแห่แชร์',
  'ช่วยกันแชร์ ตามหา ล่าสุด', 'หนุ่มสาวสู้ชีวิต ไวรัล', 'รีวิวร้านเด็ด คนแห่ ล่าสุด', 'คนดังทำดี ไวรัล ล่าสุด',
];

function pickTrendQueries(count = 8) {
  const slot = Math.floor(Date.now() / (3600e3 * 3)); // หมุนทุก 3 ชม. — รอบถัดไปได้คำใหม่ ไม่ชน dedupe เดิม
  const out = [];
  for (let i = 0; i < count; i++) out.push(TREND_QUERY_POOL[(slot * count + i) % TREND_QUERY_POOL.length]);
  return out;
}

// คลังคำค้นน้ำดี — หมุนวันละ 4 ชุดตามวันของปี (ครอบ pattern ที่ผู้ใช้ยกตัวอย่าง)
const GOOD_QUERY_POOL = [
  'น้ำใจคนไทย ช่วยเหลือ ล่าสุด', 'พลเมืองดี ช่วยชีวิต', 'คืนเงิน เก็บเงินได้ ส่งคืนเจ้าของ',
  'ลูกกตัญญู ดูแลแม่ ดูแลพ่อ', 'เด็กเก็บขยะ เรียนดี ทุนการศึกษา', 'ครูเสียสละ โรงเรียนห่างไกล',
  'ดาราใจบุญ บริจาค ช่วยเหลือ', 'ดาราติดดิน กินข้างทาง', 'คนดังสร้างบ้านให้ ยกที่ดิน',
  'ลุงป้าสู้ชีวิต ขายของ', 'คนพิการสู้ชีวิต ไม่ยอมแพ้', 'เก็บเงิน 10 ปี ทำตามฝัน',
  'กู้ภัยช่วยชีวิต นาทีชีวิต', 'หมอพยาบาลน้ำใจ ผู้ป่วยยากไร้', 'ทหารตำรวจช่วยประชาชน น้ำใจ',
  'คนแก่เก็บขวดขาย หาเลี้ยงหลาน', 'ร้านอาหารแจกฟรี คนตกงาน', 'นักเรียนช่วยคนแก่ ข้ามถนน ไวรัล',
];

function pickGoodQueries(count = 4) {
  const day = Math.floor(Date.now() / 86400000);
  const out = [];
  for (let i = 0; i < count; i++) out.push(GOOD_QUERY_POOL[(day * count + i) % GOOD_QUERY_POOL.length]);
  return out;
}

// ── เลน 🗄️ Evergreen (เฟส 2): ข่าวเก่าน้ำดีที่หยิบมาทำใหม่ได้ — บ่อที่ไม่มีวันแห้ง ──
// pattern จากผู้ใช้: "ดาราเคยสร้างบ้านให้คนจน / ยกที่ดิน / ติดดิน / กินก๋วยเตี๋ยวข้างทาง"
const EVERGREEN_PATTERNS = [
  'ดาราสร้างบ้านให้พ่อแม่', 'ดาราสร้างบ้านให้คนจน', 'คนดังยกที่ดิน บริจาคที่ดิน',
  'ดาราติดดิน กินข้าวแกงข้างทาง', 'ดาราขับวินมอเตอร์ไซค์ ขายของตลาด', 'นักร้องดังกลับบ้านเกิด ทำนา',
  'ดาราเลี้ยงดูพ่อแม่ป่วย กตัญญู', 'คนดังช่วยค่ารักษา เด็กป่วย', 'ดาราใช้หนี้ให้พ่อแม่',
  'เศรษฐีใจบุญ สร้างโรงเรียน สร้างวัด', 'อดีตดารา ชีวิตเรียบง่าย ปัจจุบัน', 'ดาราเปิดร้านเล็กๆ สู้ชีวิต',
  'คนเก็บขยะส่งลูกเรียนจบ', 'แม่ค้าใจบุญ เลี้ยงข้าวคนจร', 'คุณตาคุณยายสู้ชีวิต ไวรัล',
  'เด็กยอดกตัญญู ทำงานส่งตัวเองเรียน', 'วินมอเตอร์ไซค์น้ำใจงาม', 'แท็กซี่คืนของ ผู้โดยสารลืม',
  'คนไทยในต่างแดน สร้างชื่อ', 'นักเรียนช่วยชีวิต CPR', 'เจ้าของร้านใจดี แจกอาหารฟรี',
  'ชาวบ้านรวมเงินช่วย เพื่อนบ้าน', 'หนุ่มสาวออฟฟิศลาออก ทำตามฝัน สำเร็จ', 'คนเลี้ยงหมาแมวจร ใจบุญ',
];

function pickEvergreenQueries(count = 3) {
  const day = Math.floor(Date.now() / 86400000);
  const out = [];
  for (let i = 0; i < count; i++) out.push(EVERGREEN_PATTERNS[(day * count + i + 7) % EVERGREEN_PATTERNS.length]);
  return out;
}

// ════════════════════════════════════════════════════
// ★ เลน 🌐 BROAD (19 มิ.ย. — คำสั่งผู้ใช้ "รื้อโต๊ะเป็นเก็บกว้าง"): กวาดข่าวไทยทุกหมวดให้เยอะสุด
//   ยิงผ่าน Google News RSS (ฟรี ไม่กิน Serper credit) → ครอบทุกสำนัก/ทุกแนว
//   ครอบหมวดที่ผู้ใช้ยกตัวอย่าง: บันเทิง/ดารา/ความสัมพันธ์-แต่งงาน/ดราม่าสังคม/น้ำดี/ไวรัล/อุทาหรณ์/กีฬา-คน/ไลฟ์สไตล์
// ════════════════════════════════════════════════════
const BROAD_QUERY_POOL = [
  // 🎬 บันเทิง/ดารา/คนดัง
  'ข่าวบันเทิง', 'ข่าวดารา ล่าสุด', 'คนดัง ล่าสุด', 'นักร้อง ศิลปิน ข่าว', 'ดารา เปิดใจ',
  // 💍 ความสัมพันธ์/แต่งงาน/ครอบครัว
  'ดารา แต่งงาน', 'ดารา หมั้น', 'ดารา ควงแฟน', 'คู่รักดารา ล่าสุด', 'ดารา ตั้งครรภ์ มีลูก',
  // 🎭 ดราม่า/สังคม
  'ดราม่า ไวรัล ล่าสุด', 'ดราม่าสังคม ล่าสุด', 'ดราม่าร้านดัง', 'ชาวเน็ตแห่แชร์ ล่าสุด', 'ดราม่าดารา ล่าสุด',
  // 💎 น้ำดี/อบอุ่น/สู้ชีวิต
  'น้ำใจ ช่วยเหลือ ไวรัล', 'ลูกกตัญญู ดูแลพ่อแม่', 'พลเมืองดี ไวรัล', 'สู้ชีวิต ไวรัล', 'ดาราใจบุญ บริจาค',
  // 🔥 ไวรัล/กระแส
  'คลิปไวรัล ล่าสุด', 'กระแสโซเชียล ล่าสุด', 'เรื่องราวไวรัล ล่าสุด', 'ทอล์กออฟเดอะทาวน์',
  // ⚠️ อุทาหรณ์/เตือนภัย/คดีดัง (ไม่สยอง)
  'อุทาหรณ์ เตือนภัย ไวรัล', 'มิจฉาชีพ หลอกลวง ไวรัล', 'คดีดัง สังคม ล่าสุด',
  // 🏆 กีฬา-คน/อีสปอร์ต
  'นักกีฬาไทย ข่าว ล่าสุด', 'วอลเลย์บอลหญิงไทย ล่าสุด', 'ฟุตบอลไทย นักเตะ ข่าว',
  // 📱 ไลฟ์สไตล์/ครีเอเตอร์
  'ยูทูบเบอร์ ติ๊กต็อก ไวรัล', 'เน็ตไอดอล ล่าสุด', 'รีวิวร้านเด็ด คนแห่',
];

// ★ Google News RSS (ฟรี) — ค้นข่าวไทยตามคำค้น คืนข่าวจากหลายสำนักพร้อมกัน
function parseGoogleNews(xml) {
  const items = [];
  const blocks = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  const pick = (b, tag) => {
    const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!m) return '';
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
  };
  for (const b of blocks) {
    let title = pick(b, 'title');
    const src = pick(b, 'source');
    if (src && title.endsWith(`- ${src}`)) title = title.slice(0, -(src.length + 2)).trim();
    const url = pick(b, 'link');
    if (!title || !url) continue;
    items.push({
      title,
      url,
      snippet: pick(b, 'description').slice(0, 200),
      publishedAt: (() => { const d = new Date(pick(b, 'pubDate')); return isNaN(d) ? null : d.toISOString(); })(),
      source: src || 'Google News',
      imageUrl: '',
    });
  }
  return items;
}

async function googleNewsRss(query, { num = 20 } = {}) {
  try {
    const u = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=th&gl=TH&ceid=TH:th`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseGoogleNews(xml).slice(0, num);
  } catch (e) { console.log('[Harvester] gnews rss failed:', e.message?.slice(0, 40)); return []; }
}

// ── เลน 🔁 Follow-up (เฟส 3): ตามรอยข่าวที่เพจเคยทำ — "ตอนนี้เป็นยังไงแล้ว" ──
// หยิบข่าวเก่าในคลังเพจ (อายุ ≥21 วัน, มีตัวบุคคล) วันละ 3 เรื่อง → ค้นความเคลื่อนไหวล่าสุดของคนนั้น
async function buildFollowupQueries(count = 3) {
  try {
    const archive = createStore('news-archive');
    const all = await archive.getAll();
    const cutoff = Date.now() - 21 * 864e5;
    // ★ quick-fix: key_people ใน archive ปนชื่อละคร/รายการ (เคยได้ "เรื่องย่อธาตรี" มาเป็นตามรอย)
    const NOT_PERSON = /ละคร|รายการ|เรื่องย่อ|ตอนที่|ช่อง\s?\d|ศึก|ทีมชาติ|โรงเรียน|มูลนิธิ|บริษัท|วัด|ตำบล|อำเภอ|จังหวัด|ประเทศ|กระทรวง|ตำรวจภูธร/;
    const candidates = all
      .filter(a => {
        const t = new Date(a.archived_at || a.createdAt || 0).getTime();
        const person = (a.key_people || []).find(p => p && String(p).length >= 3 && String(p).length <= 35 && !NOT_PERSON.test(p));
        if (person) a._followPerson = person;
        return t > 0 && t < cutoff && !!person;
      })
      // เรื่องที่เคยถูกใช้/คะแนนไวรัลสูงมาก่อน = น่าตามรอยสุด
      .sort((a, b) => ((b.viral_score || 0) + (b.used_count || 0) * 10) - ((a.viral_score || 0) + (a.used_count || 0) * 10));
    const day = Math.floor(Date.now() / 86400000);
    const out = [];
    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      const pick = candidates[(day * count + i) % candidates.length];
      out.push({
        query: `"${String(pick._followPerson || pick.key_people[0]).slice(0, 30)}" ล่าสุด`,
        followupOf: String(pick.title || '').slice(0, 90),
      });
    }
    return out;
  } catch (e) {
    console.log('[Harvester] followup build failed:', e.message?.slice(0, 50));
    return [];
  }
}

async function serperNews(query, { num = 10, timeRange = 'qdr:d' } = {}) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('ไม่มี SERPER_API_KEY');
  const res = await fetch('https://google.serper.dev/news', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'th', hl: 'th', num, tbs: timeRange }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();
  return (data.news || []).map(n => ({
    title: n.title || '',
    snippet: n.snippet || '',
    url: n.link || '',
    source: n.source || '',
    publishedAt: n.date ? parseSerperDate(n.date) : null,
    imageUrl: n.imageUrl || '',
  }));
}

// ★ v5 (15 มิ.ย.): /search (เว็บทั้งหมด) — กว้างกว่า /news จับเว็บบันเทิง/บล็อก/ลิสต์ดารา ที่ /news มองข้าม
async function serperSearch(query, { num = 10, timeRange = '' } = {}) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('ไม่มี SERPER_API_KEY');
  const body = { q: query, gl: 'th', hl: 'th', num };
  if (timeRange) body.tbs = timeRange;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();
  return (data.organic || []).map(n => {
    let src = ''; try { src = new URL(n.link).hostname.replace(/^www\./, ''); } catch {}
    return {
      title: n.title || '', snippet: n.snippet || '', url: n.link || '',
      source: src, publishedAt: n.date ? parseSerperDate(n.date) : null, imageUrl: n.imageUrl || '',
    };
  });
}

// ★ v5 (15 มิ.ย.): /videos (ยูทูป+วิดีโอ) — ไลฟ์สไตล์ดารา (เปิดบ้าน/รับสัตว์/วัยเด็ก) มักเป็นคลิป
async function serperVideos(query, { num = 10 } = {}) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('ไม่มี SERPER_API_KEY');
  const res = await fetch('https://google.serper.dev/videos', {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'th', hl: 'th', num }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();
  return (data.videos || []).map(n => ({
    title: n.title || '', snippet: n.channel ? `📺 ช่อง: ${n.channel}` : 'วิดีโอ', url: n.link || '',
    source: n.channel || n.source || 'YouTube', publishedAt: n.date ? parseSerperDate(n.date) : null,
    imageUrl: n.imageUrl || '', isVideo: true, _rawDate: n.date || '',
  }));
}

// ★ 16 มิ.ย.: ประเมินอายุคลิป (เดือน) จากข้อความวันที่ Serper (ไทย/อังกฤษ) — ใช้กรองคลิปเก่า/ช่องไม่อัปเดต
//   "8 ชั่วโมงที่ผ่านมา"=0 · "X เดือน"=X · "4 ปีที่แล้ว"=48 · "13 ก.ย. 2025"=ปีปัจจุบัน-2025
function videoAgeMonths(d) {
  if (!d) return null;
  const s = String(d);
  let m = s.match(/(\d+)\s*ปี/);  if (m) return Number(m[1]) * 12;
  m = s.match(/(\d+)\s*year/i);    if (m) return Number(m[1]) * 12;
  m = s.match(/(\d+)\s*เดือน/);    if (m) return Number(m[1]);
  m = s.match(/(\d+)\s*month/i);   if (m) return Number(m[1]);
  m = s.match(/(\d+)\s*สัปดาห์/);  if (m) return Number(m[1]) / 4.3;
  if (/ชั่วโมง|นาที|วินาที|วัน|สัปดาห์|hour|minute|day|week|ago|ที่ผ่านมา/.test(s)) return 0; // recent
  const y = s.match(/(20\d\d|25\d\d)/);
  if (y) { let yr = Number(y[1]); if (yr > 2400) yr -= 543; return Math.max(0, (new Date().getFullYear() - yr) * 12); }
  return null;
}

// ★ 16 มิ.ย.: แปลงวันที่ Serper → ISO รองรับทั้ง "3 hours ago" และไทย "3 ชั่วโมงที่ผ่านมา" + วันที่เต็ม "13 ก.ย. 2025"
//   เดิมอ่านแค่อังกฤษ → ข่าวไทยส่วนใหญ่ได้ publishedAt=null (ป้ายความสดบนการ์ดเลยว่างเปล่า)
const TH_MONTHS = { 'ม.ค.': 0, 'ก.พ.': 1, 'มี.ค.': 2, 'เม.ย.': 3, 'พ.ค.': 4, 'มิ.ย.': 5, 'ก.ค.': 6, 'ส.ค.': 7, 'ก.ย.': 8, 'ต.ค.': 9, 'พ.ย.': 10, 'ธ.ค.': 11, 'มกราคม': 0, 'กุมภาพันธ์': 1, 'มีนาคม': 2, 'เมษายน': 3, 'พฤษภาคม': 4, 'มิถุนายน': 5, 'กรกฎาคม': 6, 'สิงหาคม': 7, 'กันยายน': 8, 'ตุลาคม': 9, 'พฤศจิกายน': 10, 'ธันวาคม': 11 };
function parseSerperDate(d) {
  if (!d) return null;
  const s = String(d).trim();
  // relative อังกฤษ
  let m = s.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i);
  if (m) { const n = Number(m[1]); const u = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }[m[2].toLowerCase()]; return new Date(Date.now() - n * u).toISOString(); }
  // relative ไทย ("3 ชั่วโมงที่ผ่านมา", "2 วันที่แล้ว", "5 นาที")
  m = s.match(/(\d+)\s*(นาที|ชั่วโมง|ชม\.?|วัน|สัปดาห์|เดือน|ปี)/);
  if (m) { const n = Number(m[1]); const u = { 'นาที': 6e4, 'ชั่วโมง': 36e5, 'ชม': 36e5, 'ชม.': 36e5, 'วัน': 864e5, 'สัปดาห์': 6048e5, 'เดือน': 2592e6, 'ปี': 31536e6 }[m[2]]; if (u) return new Date(Date.now() - n * u).toISOString(); }
  if (/เมื่อวาน/.test(s)) return new Date(Date.now() - 864e5).toISOString();
  if (/เมื่อสักครู่|เพิ่งโพสต์|just now/i.test(s)) return new Date().toISOString();
  // วันที่เต็มไทย "13 ก.ย. 2025" / "13 กันยายน 2568" (รองรับ พ.ศ.)
  m = s.match(/(\d{1,2})\s*([ก-๙.]+)\s*(\d{4})/);
  if (m && TH_MONTHS[m[2]] != null) { let y = Number(m[3]); if (y > 2400) y -= 543; const dt = new Date(y, TH_MONTHS[m[2]], Number(m[1])); if (!isNaN(dt)) return dt.toISOString(); }
  // ISO / รูปแบบที่ Date อ่านได้
  const dt = new Date(s); if (!isNaN(dt) && /\d{4}/.test(s)) return dt.toISOString();
  return null;
}

const idOf = (url) => crypto.createHash('md5').update(String(url)).digest('hex').slice(0, 12);

// ── เลน 📊 BuzzSumo (แชร์จริง): RSS Trending Thailand — ทำงานเมื่อบัญชี BuzzSumo จ่ายแล้ว ──
async function getBuzzsumoRssUrl() {
  if (process.env.BUZZSUMO_RSS_URL) return process.env.BUZZSUMO_RSS_URL;
  try {
    const store = createStore('desk-settings');
    const all = await store.getAll();
    return all.find(s => s.id === 'buzzsumo_rss')?.url || null;
  } catch { return null; }
}

function parseRssItems(xml) {
  const items = [];
  const blocks = String(xml).match(/<item[\s\S]*?<\/item>/g) || [];
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) return '';
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
  };
  for (const b of blocks.slice(0, 25)) {
    items.push({
      title: pick(b, 'title'),
      url: pick(b, 'link'),
      snippet: pick(b, 'description').slice(0, 200),
      publishedAt: (() => { const d = new Date(pick(b, 'pubDate')); return isNaN(d) ? null : d.toISOString(); })(),
      source: 'BuzzSumo Trending',
    });
  }
  return items.filter(i => i.title && i.url);
}

async function harvestBuzzsumo() {
  const url = await getBuzzsumoRssUrl();
  if (!url) return [];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ViralFlow-NewsDesk/1.0' } });
    const body = await res.text();
    if (!res.ok || /paid BuzzSumo subscription/i.test(body)) {
      console.log('[Harvester] 📊 BuzzSumo ยังไม่เปิดใช้ (รอจ่ายแพลน) — ข้ามเลนนี้');
      return [];
    }
    const items = parseRssItems(body).map(r => ({ ...r, lane: 'buzz' }));
    console.log(`[Harvester] 📊 BuzzSumo Trending: ${items.length} ใบ`);
    return items;
  } catch (e) {
    console.log('[Harvester] buzzsumo failed:', e.message?.slice(0, 50));
    return [];
  }
}

/**
 * รันเก็บ+คัดกรองครบ 4 ชั้น แล้วลงคลัง
 * @returns {Promise<{harvested, gated, classified, judged, added}>}
 */
export async function runHarvest({ lanes = ['trend', 'good', 'broad', 'evergreen', 'followup', 'buzz'], judgeTop = 24, extraQueries = [] } = {}) {
  const t0 = Date.now();
  const store = createStore('news-desk');
  const existing = await store.getAll();
  const existingIds = new Set(existing.map(e => e.id));
  const stats = { harvested: 0, dupSkipped: 0, gated: 0, archiveDup: 0, judged: 0, added: 0 };

  // ── เก็บดิบ ──
  const raw = [];
  if (lanes.includes('trend')) {
    // ★ 16 มิ.ย. (เร่งความเร็ว): ยิงคำค้นกระแสพร้อมกัน
    const _tRes = await Promise.all(pickTrendQueries(8).map(async q => {
      try { return (await serperNews(q, { num: 10, timeRange: 'qdr:d' })).map(r => ({ ...r, lane: 'trend' })); }
      catch (e) { console.log('[Harvester] trend query failed:', e.message?.slice(0, 50)); return []; }
    }));
    for (const arr of _tRes) raw.push(...arr);
    // ★ 16 มิ.ย. (ทีมขอ): ดราม่าวงการสด มีตัวละคร (วอลเลย์บอล/บอลไทย/บันเทิง) — คลิปยูทูป(สด≤3ด.) + บทความ; lane trend ยกเว้นด่านกระแสเก่า
    try {
      const { generateCircleDramaQueries } = await import('./goodNewsScout');
      for (const { q } of generateCircleDramaQueries(3)) {
        try { raw.push(...(await serperVideos(q, { num: 8 })).filter(x => { const a = videoAgeMonths(x._rawDate); return a == null || a <= 3; }).map(r => ({ ...r, lane: 'video' }))); }
        catch (e) { console.log('[Harvester] circle /videos failed:', e.message?.slice(0, 50)); }
        try { raw.push(...(await serperNews(q, { num: 6, timeRange: 'qdr:w' })).map(r => ({ ...r, lane: 'trend' }))); }
        catch (e) { console.log('[Harvester] circle /news failed:', e.message?.slice(0, 50)); }
      }
    } catch (e) { console.log('[Harvester] circle-drama import failed:', e.message?.slice(0, 50)); }
  }
  if (lanes.includes('good')) {
    // ★ กองสืบน้ำดี (13 มิ.ย. 69): สมองสืบคิดคำค้นสด + ค้นดาราด้วยชื่อ — ตกลงมาใช้คำค้นตายตัวถ้าล่ม
    //   คำค้นดารา (genre='ดาราดังทำดี') ใช้ qdr:m (1 เดือน) — ข่าวดาราทำดีไม่ได้เกิดทุกสัปดาห์ ย้อนเดือนเจอมากกว่า
    //   storyNature filter ด้านล่างกันของเก่าเกินไปอยู่แล้ว
    let goodQueries = []; // [{q, isCeleb}]
    try {
      const { generateScoutQueries } = await import('./goodNewsScout');
      const scout = await generateScoutQueries(6);
      goodQueries = scout.map(x => ({ q: x.q, isCeleb: x.genre === 'ดาราดังทำดี' }));
    } catch (e) { console.log('[Harvester] scout import failed:', e.message?.slice(0, 50)); }
    if (goodQueries.length < 3) goodQueries = pickGoodQueries(6).map(q => ({ q, isCeleb: false })); // fallback
    // ★ 16 มิ.ย. (เร่งความเร็ว): ยิงคำค้นกองสืบพร้อมกัน
    const _gRes = await Promise.all(goodQueries.map(async ({ q, isCeleb }) => {
      try { return (await serperNews(q, { num: 8, timeRange: isCeleb ? 'qdr:m' : 'qdr:w' })).map(r => ({ ...r, lane: 'good' })); }
      catch (e) { console.log('[Harvester] good query failed:', e.message?.slice(0, 50)); return []; }
    }));
    for (const arr of _gRes) raw.push(...arr);

    // ★ 16 มิ.ย. (ทีมขอลดต้นทุน): เลน good มีกลุ่มคำค้นเยอะ (~9 ชนิด) — รัน "แกนหลัก" ทุกรอบ + "กลุ่มเสริม" หมุน 3 จาก 6 ต่อรอบ (ประหยัด ~32%)
    try {
      const G = await import('./goodNewsScout');
      const _clipRe = /youtube\.com|youtu\.be|tiktok\.com|fb\.watch|facebook\.com\/(reel|watch)|instagram\.com/i;
      // ★ 16 มิ.ย. (เร่งความเร็ว): ยิงทุกคำในกลุ่ม "พร้อมกัน" (Promise.all) แทนทีละคำ — harvest เร็วขึ้นมาก (เดิม 9.6 นาทีเกือบ timeout)
      const runGroup = async (queries, { ep = 'news', lane = 'good', tr = 'qdr:m', num = 10, noClip = false, maxAgeMo = 0 } = {}) => {
        const results = await Promise.all(queries.map(async ({ q }) => {
          try {
            let res = ep === 'search' ? await serperSearch(q, { num, timeRange: tr })
              : ep === 'videos' ? await serperVideos(q, { num })
                : await serperNews(q, { num, timeRange: tr });
            if (noClip) res = res.filter(x => !_clipRe.test(x.url || ''));
            if (maxAgeMo && ep === 'videos') res = res.filter(x => { const a = videoAgeMonths(x._rawDate); return a == null || a <= maxAgeMo; });
            return res.map(r => ({ ...r, lane }));
          } catch (e) { console.log('[Harvester] good group failed:', e.message?.slice(0, 50)); return []; }
        }));
        for (const arr of results) raw.push(...arr);
      };
      // ── ★ แกนหลัก รอบ 5 (17 มิ.ย. ทีมสั่ง "เน้นคนมีชื่อเสียงทุกวงการ ตัดชาวบ้านนิรนาม+ทางการ"): ──
      await runGroup(G.generateCelebGoodDeedQueries(6), { ep: 'search', noClip: true });   // ★ ดาราทำดี/บริจาค/ทำบุญ/ช่วยเหลือ/ติดดิน (แนวอวยที่ปังสุด)
      await runGroup(G.generateCelebFamilyQueries(6), { ep: 'news' });                      // ★ ดาราให้ของขวัญครอบครัว (GOLD)
      await runGroup(G.generateCelebHighlightQueries(5), { ep: 'search', lane: 'celeb' });  // ★ ไฮไลท์สัมภาษณ์ดาราด้านดี (รีลส์/คลิป)
      // 🔥 เทรนด์สด → หมวดกระแส: รันทุกรอบ (หมวดกระแสคือสิ่งที่ทีมต้องการเติมมากสุด) — lane=trend
      await runGroup(G.generateTrendRadarQueries(7), { ep: 'news', lane: 'trend', tr: 'qdr:d', num: 8 });
      // เรดาร์วงการ×มุมดี → ดาราน้ำดี: เฉพาะบางรอบ (ดาราน้ำดีมีสต็อกเยอะแล้ว) ทุก 3 ชม. เพื่อคุมเวลา harvest
      if (new Date().getHours() % 3 === 0) {
        await runGroup(G.generateFieldRadarQueries(5), { ep: 'search', lane: 'celeb', tr: 'qdr:m', noClip: true });
      }
      await runGroup(G.generateCommonerQueries(2), { ep: 'news', noClip: true, tr: 'qdr:w' }); // ชาวบ้านที่ "ไวรัลมีตัวตน" เท่านั้น (เล็กลง + /news มีวันที่/ภาพ · เลิกเลนคนลำบากนิรนาม)
      await runGroup(G.generateGoodContentQueries(3), { ep: 'search', noClip: true });      // น้ำดีทั่วไป (ลด 5→3 คุมเวลา harvest)
      await runGroup(G.generateViralDnaQueries(2), { ep: 'search', noClip: true });         // DNA สถาบัน/ทหาร/ยุติธรรม/ต่างชาติช่วยไทย (ลด 3→2)
      // ★ v6 (16 มิ.ย. ทีมขอเน้น): ย้อนสัมภาษณ์เก่า เป็นแกนหลัก รันทุกรอบ — บทความ /news + "คลิปจริง" /videos (YT)
      const _tbQs = G.generateThrowbackQueries(6);
      await runGroup(_tbQs.slice(0, 4), { ep: 'news', lane: 'throwback', tr: 'qdr:y', num: 8 });   // บทความย้อนสัมภาษณ์
      await runGroup(_tbQs.slice(0, 4), { ep: 'videos', lane: 'video', num: 8, maxAgeMo: 24 });     // คลิปสัมภาษณ์จริง (YT) — ย้อนได้ ≤2 ปี (กันช่องเก่า 4 ปี)
      // ── กลุ่มเสริม (หมุน 3 จาก 5 ต่อรอบ ตามชั่วโมง): ลดคำค้นซ้ำซ้อน/ต้นทุน ──
      const _h = Math.floor(Date.now() / 3600e3);
      const extra = [
        () => runGroup(G.generateCelebLifestyleQueries(5), { ep: 'search', noClip: true }),       // ไลฟ์สไตล์ (เปิดบ้าน/รับสัตว์)
        () => runGroup(G.generateCelebRadarQueries(6), { ep: 'news', lane: 'celeb' }),             // ดาราทุกแนว (ดราม่า/รัก)
        () => runGroup(G.generateSocialClipQueries(5), { ep: 'search', lane: 'video' }),           // คลิป/เพจ (เว็บ+FB/IG)
        () => runGroup(G.generateSocialClipQueries(3), { ep: 'videos', lane: 'video', maxAgeMo: 10 }), // คลิปครีเอเตอร์ (YT) — สดเท่านั้น ≤10 เดือน
        () => runGroup(G.generateEvergreenCelebQueries(4), { ep: 'news', lane: 'evergreen-celeb', tr: 'qdr:y', num: 6 }), // ดาราดีอมตะ
      ];
      for (let i = 0; i < extra.length; i++) {
        if ((i + _h) % extra.length < 3) await extra[i]();
      }
    } catch (e) { console.log('[Harvester] good-block failed:', e.message?.slice(0, 50)); }
  }
  if (lanes.includes('broad')) {
    // 🌐 เก็บกว้าง "เชิงลึก" (19 มิ.ย. รอบ 2) — คีย์เฉพาะเจาะจง (วงการ×แนวเรื่อง) + กระแสรายวัน ผ่าน Google News RSS (ฟรี)
    //   ★ คีย์เจาะจง = ข่าว "ทำได้จริง" (เช่น "นักร้อง กตัญญู ซื้อบ้านให้แม่") + รู้หมวดทันทีจากคีย์ (tag category ตรงๆ)
    //   แทนคำกว้าง ("ข่าวบันเทิง") ที่เดิมดูดข่าวทำไม่ได้เข้ามาเยอะ
    try {
      const { generateThemeQueries, generateDailyTrend } = await import('./keywordBank');
      const dailyQs = generateDailyTrend(14).map(q => ({ q, category: 'กระแสรายวัน' }));
      const themeQs = generateThemeQueries(6); // [{q, category}] — หมุนชุดตามเวลา
      const allQ = [...dailyQs, ...themeQs];
      const _dailyCut = Date.now() - 5 * 864e5; // กระแสรายวัน = สด ≤5 วันเท่านั้น
      const _bRes = await Promise.all(allQ.map(async ({ q, category }) => {
        try {
          let res = (await googleNewsRss(q, { num: 12 })).map(r => ({ ...r, lane: 'broad', category }));
          // ★ 19 มิ.ย. รอบ 3 (ผู้ใช้: กระแสเก่าไม่เอา): กระแสรายวัน ตัดข่าวเก่าทิ้ง เก็บเฉพาะสด ≤5 วัน
          if (category === 'กระแสรายวัน') res = res.filter(r => !r.publishedAt || new Date(r.publishedAt).getTime() >= _dailyCut);
          return res;
        } catch { return []; }
      }));
      for (const arr of _bRes) raw.push(...arr);
      console.log(`[Harvester] 🌐 broad เชิงลึก: ${allQ.length} คำค้น (กระแสรายวัน ${dailyQs.length} + แนวเรื่อง ${themeQs.length}) → ${_bRes.reduce((s, a) => s + a.length, 0)} ดิบ`);
    } catch (e) { console.log('[Harvester] broad-deep failed:', e.message?.slice(0, 50)); }
  }
  // ★ คำค้นพิเศษ (Chief Agent / สั่งหาเฉพาะแนว) — เลือก endpoint ได้: news (default) | search (เว็บกว้าง) | videos (ยูทูป)
  // ★ 16 มิ.ย. (เร่งความเร็ว): ยิงพร้อมกัน
  const _exRes = await Promise.all(extraQueries.map(async ex => {
    try {
      let exRes = ex.endpoint === 'search' ? await serperSearch(ex.q, { num: 10, timeRange: ex.timeRange })
        : ex.endpoint === 'videos' ? await serperVideos(ex.q, { num: 10 })
          : await serperNews(ex.q, { num: 8, timeRange: ex.timeRange || 'qdr:d' });
      if (ex.endpoint === 'videos') exRes = exRes.filter(x => { const a = videoAgeMonths(x._rawDate); return a == null || a <= 12; });
      return exRes.map(r => ({ ...r, lane: ex.lane || 'trend', ...(ex.tag || {}) }));
    } catch (e) { console.log('[Harvester] extra query failed:', e.message?.slice(0, 50)); return []; }
  }));
  for (const arr of _exRes) raw.push(...arr);
  if (lanes.includes('evergreen')) {
    // ไม่จำกัดเวลา — ของเก่าน้ำดีคือเป้าหมาย (วันไหนกระแสแห้ง เลนนี้คือบ่อสำรอง)
    const _evRes = await Promise.all(pickEvergreenQueries(4).map(async q => {
      try { return (await serperNews(q, { num: 8, timeRange: 'qdr:y' })).map(r => ({ ...r, lane: 'evergreen' })); }
      catch (e) { console.log('[Harvester] evergreen query failed:', e.message?.slice(0, 50)); return []; }
    }));
    for (const arr of _evRes) raw.push(...arr);
  }
  if (lanes.includes('buzz')) {
    raw.push(...await harvestBuzzsumo());
  }
  if (lanes.includes('followup')) {
    // ตามรอยบุคคลจากข่าวที่เพจเคยทำ — ความเคลื่อนไหวสัปดาห์ล่าสุด
    for (const f of await buildFollowupQueries(3)) {
      try {
        raw.push(...(await serperNews(f.query, { num: 5, timeRange: 'qdr:w' }))
          .map(r => ({ ...r, lane: 'followup', followupOf: f.followupOf })));
      } catch (e) { console.log('[Harvester] followup query failed:', e.message?.slice(0, 50)); }
    }
  }
  stats.harvested = raw.length;

  // ── กันซ้ำในคลังตัวเอง (url เดิม) + anti-recycle (หัวข้อที่เพิ่งทิ้ง/ส่งไปแล้ว วนกลับจาก url ใหม่) ──
  // ★ 15 มิ.ย. (ทีมชี้ "ข่าวเก่าวนกลับมา"): กันซ้ำ url อย่างเดียวไม่พอ — เรื่องเดิมมาคนละสำนัก url ใหม่ก็หลุดเข้าได้
  //   เทียบ "หัวข้อ" กับการ์ดที่ dismissed/sent ใน 10 วัน → ถ้าตรง = เคยปัด/เคยทำแล้ว ข้ามเลย (ไม่เปลือง classify ด้วย)
  const _normRT = (s) => String(s || '').replace(/[\s"“”'‘’!|…\-–·]/g, '').slice(0, 40);
  const _recycleCutoff = Date.now() - 10 * 864e5;
  const _rejectedTitles = existing
    .filter(i => (i.status === 'dismissed' || i.status === 'sent') && new Date(i.harvestedAt || 0).getTime() > _recycleCutoff)
    .map(i => _normRT(i.title)).filter(t => t.length >= 12);
  const _isRecycled = (title) => {
    const nt = _normRT(title);
    if (nt.length < 12) return false;
    return _rejectedTitles.some(rt => rt.includes(nt.slice(0, 16)) || nt.includes(rt.slice(0, 16)));
  };
  const fresh = [];
  const seen = new Set();
  for (const r of raw) {
    if (!r.url || !r.title) continue;
    const id = idOf(r.url);
    if (existingIds.has(id) || seen.has(id)) { stats.dupSkipped++; continue; }
    if (_isRecycled(r.title)) { stats.recycled = (stats.recycled || 0) + 1; continue; }
    seen.add(id);
    fresh.push({ ...r, id });
  }

  // ── ชั้น 0: คำต้องห้าม ──
  // ★ 16 มิ.ย.: ของที่ตัดออก (แง่ลบ/นอกแนว/เสี่ยง) ไม่ทิ้งหาย — เก็บเข้า "คลังขยะ" ให้ทีมรีวิว+เอากลับได้
  const junk = [];
  const gated = [];
  for (const item of fresh) {
    const g = gateKeywords(item);
    if (!g.pass) { stats.gated++; junk.push({ ...item, junkReason: g.reason || 'คำต้องห้าม/นอกแนว' }); continue; }
    gated.push(item);
  }

  // ── ★ 19 มิ.ย. (เก็บกว้าง): แยกเลน broad ออกจากไปป์ไลน์ AI หนัก ──
  //   broad = จัดหมวดคีย์เวิร์ด(ฟรี) + กรอง gore เท่านั้น (ปริมาณเยอะ ไม่ต้องยิง OpenAI ทีละ 10 ข่าว)
  //   curated (trend/good/...) = ผ่าน AI classify + ด่านบรรณาธิการ + judge ตามเดิม
  const gatedBroad = gated.filter(i => i.lane === 'broad');
  const gatedCurated = gated.filter(i => i.lane !== 'broad');

  // ── ชั้น 1: จัดหมวด + วัดพิษ (เฉพาะ curated) ──
  let classified = await classifyBatch(gatedCurated);
  // ★ safety floor (ผู้ใช้ 19 มิ.ย.): ตัดแค่ "รุนแรง/สยอง" (toxicity≥3) — คลาย fbRisk/toneable (เก็บกว้าง)
  classified = classified.filter(c => {
    if (c.toxicity >= 3) { junk.push({ ...c, junkReason: 'เนื้อหารุนแรง/สยอง (พิษ≥3)' }); return false; }
    return true;
  });

  // ── ★ ตัดต่างประเทศทิ้งที่ชั้นนี้ (13 มิ.ย. 69 คำสั่งทีม "เอาแค่ไทย"): เนื้อหาที่ classify ตีเป็นเหตุการณ์ตปท. ──
  //   domain block จับเว็บนอกแล้ว ตรงนี้จับ "เว็บไทยลงข่าวต่างชาติ" (กอริลลา/เศรษฐกิจฟิลิปปินส์) ที่ติด foreignCountry
  stats.foreignDropped = 0;
  classified = classified.filter(c => {
    if (c.foreignCountry) { stats.foreignDropped++; junk.push({ ...c, junkReason: `ข่าวต่างประเทศ (${c.foreignCountry})` }); console.log(`[Harvester] 🌏 ตัดต่างประเทศ (${c.foreignCountry}): ${String(c.title).slice(0, 50)}`); return false; }
    return true;
  });

  // ── ★ 16 มิ.ย. (ทีมชี้ "5 ดาราวิจารณ์โดนถล่ม + ปลูกถ่ายอวัยวะ รพ."): 2 กฎใหม่ ──
  //   ① ข่าวทางการ/สถาบัน/รพ.ที่ไม่มีตัวละครหลัก (ไม่ใช่ดารา) = ตัด  ② กระแส/ดราม่าเก่าที่เล่นใหม่ไม่ได้ = ตัด (เว้นเลนกระแสสด)
  stats.noChar = 0; stats.staleTrend = 0; stats.royalNeg = 0; stats.unknownPerson = 0; stats.noImage = 0;
  classified = classified.filter(c => {
    // ★ safety (คงไว้): สถาบันแง่ลบ/เสื่อมเสีย/อ่อนไหว = ตัดเด็ดขาด (ม.112) — แง่ดี/ชื่นชมปล่อยผ่าน
    if (c.royalNegative === true) {
      stats.royalNeg++; junk.push({ ...c, junkReason: 'สถาบันแง่ลบ/อ่อนไหว (ม.112)' }); console.log(`[Harvester] 🚫 สถาบันแง่ลบ/อ่อนไหว: ${String(c.title).slice(0, 50)}`); return false;
    }
    // ★ 19 มิ.ย. (เก็บกว้าง — ผู้ใช้สั่งปลดล็อก): เลิกตัด "คนนิรนาม/ไม่มีภาพ/ไม่มีตัวละคร/กระแสเก่า"
    //   ของพวกนี้เคยตัดทิ้งจนข่าวน้อย — ตอนนี้เก็บไว้ติดหมวดให้เลือกเอง (เหลือกรองแค่ safety + ต่างประเทศ)
    return true;
  });

  // ── ★ กรองกระแสอดีต (ทีมสั่ง 12 มิ.ย. ค่ำ — เคสเจนนี่จ่ายหนี้แม่): "เหตุการณ์ครั้งเดียว" ที่เก่าแล้ว ≠ ข่าวน้ำดีไร้กาลเวลา ──
  //   เลน evergreen ตั้งใจค้นย้อนทั้งปี → รับเฉพาะเรื่องแบบแผน (pattern) เท่านั้น
  //   เลนอื่น: event ที่เผยแพร่เกิน 30 วัน = ขุดของเก่า ทิ้ง
  stats.staleEvent = 0;
  classified = classified.filter(c => {
    if (c.storyNature !== 'event') return true;
    // ★ เลน evergreen-celeb (14 มิ.ย.) + throwback (15 มิ.ย.): ตั้งใจค้นของเก่ามาเล่าใหม่ — ไม่ตัด
    //   throwback = สัมภาษณ์เก่า (ตอนเลิกกัน/อกหัก/ช่วงตกต่ำ) ที่หยิบมาทำ "ย้อนฟัง" ได้เสมอ
    if (c.lane === 'evergreen-celeb' || c.lane === 'throwback') return true;
    const ageDays = c.publishedAt ? (Date.now() - new Date(c.publishedAt).getTime()) / 864e5 : null;
    if (c.lane === 'evergreen') { stats.staleEvent++; junk.push({ ...c, junkReason: 'เหตุการณ์ครั้งเดียวที่เก่าแล้ว' }); console.log(`[Harvester] ⏳ ตัดกระแสอดีต (evergreen+event): ${String(c.title).slice(0, 55)}`); return false; }
    // ★ 19 มิ.ย. (เก็บกว้าง): ยืดอายุ — กระแส (trend/buzz) ≤30 วัน · ข่าวอื่น ≤180 วัน (เก็บไว้ให้เลือกเอง)
    const _ageCap = ['trend', 'buzz'].includes(c.lane) ? 30 : 180;
    if (ageDays !== null && ageDays > _ageCap) { stats.staleEvent++; junk.push({ ...c, junkReason: `เหตุการณ์เก่า ${Math.round(ageDays)} วัน` }); console.log(`[Harvester] ⏳ ตัดเหตุการณ์เก่า ${Math.round(ageDays)} วัน (>${_ageCap}): ${String(c.title).slice(0, 50)}`); return false; }
    return true;
  });

  // ── ชั้น 2: กันซ้ำกับที่เพจเคยทำ (ยกเว้นเลน followup — ตั้งใจตามเรื่องคนเดิมอยู่แล้ว) ──
  const archiveTitles = await loadArchiveTitles();
  classified = classified.filter(c => {
    if (c.lane === 'followup') return true;
    if (isDuplicateOfArchive(c.title, archiveTitles)) { stats.archiveDup++; return false; }
    return true;
  });

  // ── ชั้น 3: บรรณาธิการ AI เฉพาะตัวท็อป (เรียงคร่าวด้วย fit+fresh ก่อน) ──
  // ★ เฟส 3: น้ำหนักหมวดปรับตามผลโพสต์จริง (ปัง/แป้ก) ที่ทีมรายงานกลับ
  const perfBoost = await getCategoryPerformance();
  classified.sort((a, b) => (fitScore(b.category, perfBoost) + freshScore(b.publishedAt)) - (fitScore(a.category, perfBoost) + freshScore(a.publishedAt)));
  const toJudge = classified.slice(0, judgeTop);
  const rest = classified.slice(judgeTop);
  const judged = await editorialJudge(toJudge);
  stats.judged = judged.filter(j => j.judgeScore !== undefined).length;

  // ── ★ 19 มิ.ย. (เก็บกว้าง): เลน broad — จัดหมวดคีย์เวิร์ด(ฟรี) + กรอง gore → ลงโต๊ะตรงๆ ไม่ผ่าน AI judge ──
  const broadFinal = [];
  for (const it of gatedBroad) {
    if (keywordGore(it)) { junk.push({ ...it, junkReason: 'รุนแรง/สยอง (คีย์เวิร์ด)' }); continue; }
    // ★ 19 มิ.ย. รอบ 2: category มาจาก "คีย์ที่ค้นเจอ" ตรงๆ (แม่นกว่า) — ตกไป keyword-guess เฉพาะที่ไม่มี
    broadFinal.push({ ...it, category: it.category || keywordCategorize(it), tone: 'กลาง', toxicity: 0, fbRisk: 0, toneable: true, _broad: true });
  }
  stats.broadKept = broadFinal.length;

  // ── ลงคลัง ──
  const now = new Date().toISOString();
  const finalItems = [...judged, ...rest, ...broadFinal].map(it => ({
    ...it,
    finalScore: finalScore(it, perfBoost),
    status: 'new',
    claimedBy: null,
    harvestedAt: now,
  }));

  // ★ ป้ายเตือนเรื่องซ้ำแบบไม่บล็อก (คำสั่งทีม 12 มิ.ย.): ใบใหม่เรื่องเดียวกับที่ "ส่งเจนไปแล้ว" ใน 72 ชม.
  //   → ติดป้าย sameStoryAs ให้ทีมเห็น (ยังหยิบทำซ้ำได้ตามนโยบาย — กระแสใหญ่บางทีตั้งใจเล่นซ้ำ)
  // ★ + ควบเรื่องเดียวกันคนละแหล่ง (ทีมสั่ง 12 มิ.ย. ค่ำ): ใบใหม่ที่เรื่องตรงกับใบ "new" บนโต๊ะ
  //   หรือตรงกันเองในรอบเดียวกัน → ไม่สร้างใบซ้ำ แต่เก็บเป็น "แหล่งเสริม" (altSources) บนใบหลัก
  let toAdd = finalItems;
  try {
    const allExisting = await store.getAll();
    const normT = (s) => String(s || '').replace(/[\s"“”'‘’!|…]/g, '').slice(0, 60);
    const sameStory = (a, b) => a.length >= 12 && b.length >= 12 && (a.includes(b.slice(0, 16)) || b.includes(a.slice(0, 16)));

    const sentRecent = allExisting.filter(i =>
      i.status === 'sent' && Date.now() - new Date(i.sentAt || i.harvestedAt || 0).getTime() < 72 * 3600e3);
    const newOnDesk = allExisting.filter(i => i.status === 'new');

    stats.mergedSources = 0;
    const kept = [];
    for (const it of finalItems) {
      const nt = normT(it.title);
      // ป้ายเรื่องซ้ำกับที่ส่งเจนแล้ว (เดิม)
      const hitSent = sentRecent.find(ex => sameStory(nt, normT(ex.title)));
      if (hitSent) it.sameStoryAs = { id: hitSent.id, title: String(hitSent.title).slice(0, 60) };

      // ควบกับใบ new บนโต๊ะ → อัพเดทใบเดิม ไม่สร้างใบใหม่
      const hitDesk = nt.length >= 12 ? newOnDesk.find(ex => sameStory(nt, normT(ex.title))) : null;
      if (hitDesk) {
        try {
          await store.update(hitDesk.id, (ex) => {
            const alt = Array.isArray(ex.altSources) ? ex.altSources : [];
            if (alt.length < 4 && !alt.some(a => a.url === it.url) && it.url !== ex.url) {
              alt.push({ url: it.url, source: it.source || '', title: String(it.title).slice(0, 80) });
            }
            return { ...ex, altSources: alt };
          });
          stats.mergedSources++;
          console.log(`[Harvester] 🔗 ควบแหล่งเสริมเข้าใบเดิม: ${String(it.title).slice(0, 50)}`);
        } catch { /* ควบไม่ได้ = ปล่อยผ่านเป็นใบใหม่ตามเดิม */ kept.push(it); }
        continue;
      }
      // ควบกันเองในรอบเดียวกัน (สองสำนักรายงานเรื่องเดียวกันพร้อมกัน)
      const hitBatch = nt.length >= 12 ? kept.find(k => sameStory(nt, normT(k.title))) : null;
      if (hitBatch) {
        const alt = Array.isArray(hitBatch.altSources) ? hitBatch.altSources : [];
        if (alt.length < 4 && it.url !== hitBatch.url) alt.push({ url: it.url, source: it.source || '', title: String(it.title).slice(0, 80) });
        hitBatch.altSources = alt;
        stats.mergedSources++;
        continue;
      }
      kept.push(it);
    }
    toAdd = kept;
    if (stats.mergedSources > 0) console.log(`[Harvester] 🔗 ควบเรื่องซ้ำคนละแหล่งรวม ${stats.mergedSources} ใบ`);
  } catch { /* เทียบไม่ได้ = เก็บแบบเดิม ไม่พังการเก็บ */ }

  if (toAdd.length > 0) await store.addMany(toAdd);
  stats.added = toAdd.length;

  // ★ 16 มิ.ย.: เก็บของที่ตัดออกเข้า "คลังขยะ" (news-desk-junk) — ทีมเข้าไปรีวิว+เอากลับได้ ไม่ใช่บล็อกหาย
  //   เก็บเฉพาะที่ตัดด้วยเหตุผลบรรณาธิการ/แบรนด์/ความปลอดภัย (ไม่เก็บ url ซ้ำ/anti-recycle = ขยะจริงไม่ต้องรีวิว)
  if (junk.length > 0) {
    try {
      const jstore = createStore('news-desk-junk');
      const jnow = new Date().toISOString();
      // ★ 16 มิ.ย. (แก้บั๊ก persist): id ต้อง prefix 'jk_' — store_items PK เป็น id แบบ global
      //   ถ้าใช้ idOf(url) เฉยๆ จะชนกับ id ของโต๊ะ (url เดียวกัน) → insert ติด dup-key → ไม่เซฟเลย (store ว่าง)
      const rows = junk.filter(j => j && j.url && j.title).map(j => ({
        id: 'jk_' + (j.id || idOf(j.url)),
        title: String(j.title).slice(0, 200), url: j.url, source: j.source || '',
        lane: j.lane || '', category: j.category || '',
        junkReason: j.junkReason || 'ตัดออก', junkAt: jnow,
      }));
      if (rows.length) {
        await jstore.addMany(rows);
        stats.junked = rows.length;
        const jall = await jstore.getAll();
        if (jall.length > 400) {
          const old = jall.sort((a, b) => new Date(a.junkAt || 0) - new Date(b.junkAt || 0)).slice(0, jall.length - 400);
          for (const o of old) await jstore.remove(o.id).catch(() => {});
        }
      }
    } catch (e) { console.log('[Harvester] เก็บคลังขยะล้ม:', e.message?.slice(0, 50)); }
  }

  // ★ ล้างโต๊ะอัตโนมัติ (14 มิ.ย. คำสั่งทีม — โต๊ะบวม 420 ใบ ของเก่าลอยค้าง เช่นเจนนี่/ลุงธีระ):
  //   การ์ด new เกิน 48 ชม.เก็บเข้ากรุเอง (บก.ให้ 9+ ยืดเป็น 72 ชม.) — โต๊ะเป็นหน้าต่างของสด ไม่ใช่กองสะสม
  try {
    const allNow = await store.getAll();
    const now = Date.now();
    let purged = 0;
    for (const it of allNow) {
      if (it.status === 'dismissed' || it.used) continue;
      // ★ 15 มิ.ย.: ข่าวใน "คลังส่งเช้า" (shortlisted) = ทีมเลือกเก็บไว้เอง ห้ามล้าง/ตัดอัตโนมัติ (ต้องอยู่ถึงพรุ่งนี้)
      if (it.shortlisted) continue;
      // ★ 15 มิ.ย. รอบ 2-3: รีเช็คด่านคำต้องห้าม "ล่าสุด" ครอบทุกสถานะ (new/claimed/sent) —
      //   เก็บของเก่าที่หลุดก่อนอัปเดตด่านแม้ส่งเขียนไปแล้ว (เช่น vietnam.vn, Hong Kong fire, บัตรคนจน)
      const g = gateKeywords(it);
      if (!g.pass) {
        await store.update(it.id, (ex) => ({ ...ex, status: 'dismissed', dismissNote: `🧹 ตัดอัตโนมัติ (${g.reason})` })).catch(() => {});
        purged++;
        continue;
      }
      // ★ 19 มิ.ย. (เก็บกว้าง): รีเช็คเฉพาะ safety (สถาบันแง่ลบ ม.112) — เลิกตัดกระแสเก่า/ไม่มีตัวละครอัตโนมัติ
      if (it.royalNegative === true) {
        await store.update(it.id, (ex) => ({ ...ex, status: 'dismissed', dismissNote: '🧹 ตัดอัตโนมัติ (สถาบันแง่ลบ/อ่อนไหว)' })).catch(() => {});
        purged++;
        continue;
      }
      // ★ ล้างตามอายุ — เฉพาะการ์ด new ที่ยังไม่มีใครหยิบ
      if (it.status !== 'new') continue;
      const ageHr = (now - new Date(it.harvestedAt || 0).getTime()) / 36e5;
      // ★ 19 มิ.ย. (เก็บกว้าง): ยืดเวลาเก็บ — ปกติ 10 วัน · คะแนนดี 14 วัน · ผลค้นเฉพาะแนว 7 วัน
      const cap = it.focusTag ? 168 : ((it.judgeScore ?? 0) >= 9 ? 336 : 240);
      if (ageHr > cap) {
        await store.update(it.id, (ex) => ({ ...ex, status: 'dismissed', dismissNote: `🧹 ล้างอัตโนมัติ (ค้างเกิน ${cap} ชม.)` })).catch(() => {});
        purged++;
      }
    }
    // ★ 16 มิ.ย. (แก้โต๊ะบวม 906 ใบ): เพดาน "จำนวน" — เก็บ new ท็อป 150 ตามคะแนน ที่เหลือเข้ากรุ
    //   (ล้างตามเวลาอย่างเดียวไล่ไม่ทันการเติม → สะสมจนเลื่อนเจอแต่ของจม)
    // ★ 19 มิ.ย. (เก็บกว้าง): ยกเพดานโต๊ะ 150 → 2000 (เก็บข่าวให้เลือกเยอะๆ)
    const liveNew = (await store.getAll()).filter(i => i.status === 'new' && !i.shortlisted && !i.used && !i.focusTag);
    if (liveNew.length > 2000) {
      liveNew.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
      for (const o of liveNew.slice(2000)) {
        await store.update(o.id, (ex) => ({ ...ex, status: 'dismissed', dismissNote: '🧹 ล้างอัตโนมัติ (เกินเพดานโต๊ะ 2000 ใบ — คะแนนต่ำสุด)' })).catch(() => {});
        purged++;
      }
    }
    stats.autoPurged = purged;
    if (purged > 0) console.log(`[Harvester] 🧹 ล้างโต๊ะอัตโนมัติ: ${purged} ใบ (ค้างเกินเวลา)`);
  } catch (e) { console.log('[Harvester] auto-purge skip:', e.message?.slice(0, 40)); }

  // ════════════════════════════════════════════════════
  // ★ AUTO-PILOT (ผู้ใช้ 11 มิ.ย.): บก.แต่ละคนเฝ้าโต๊ะ — ข่าวที่ บก.ประจำแนวให้ ≥8 = "ทำได้"
  //   ส่งเข้าเวิร์กโฟลว์เจนเองทันที ต่อคิวกัน คนมาหยิบผลงานที่แท็บ ✅ พร้อมใช้
  // ════════════════════════════════════════════════════
  try {
    stats.autoPicked = await autoPilotPick(toAdd, store);
  } catch (e) { console.log('[AutoPilot] skip:', e.message?.slice(0, 50)); }

  // ★ Research Agent อัตโนมัติ (16 มิ.ย.: ลด 3→1 ใบ + กันค้าง 45 วิ — ตัวนี้เคยกินเวลา harvest ไป 1-3 นาที)
  try {
    const { deepResearch } = await import('./researchAgent');
    const top = toAdd.filter(i => (i.judgeScore ?? 0) >= 8 && i.lane !== 'interview').sort((a, b) => (b.judgeScore || 0) - (a.judgeScore || 0))[0];
    if (top) {
      const timeout = new Promise(res => setTimeout(() => res({ ok: false, reason: 'timeout' }), 45000));
      const r = await Promise.race([deepResearch(top).catch(e => ({ ok: false, reason: e.message })), timeout]);
      if (r.ok) {
        const boosted = Math.min(100, (top.finalScore || 0) + Math.max(0, r.readyScore - 5) * 2);
        await store.update(top.id, (ex) => ({ ...ex, research: r, finalScore: boosted }));
        stats.researched = 1;
      }
    }
  } catch (e) { console.log('[Harvester] auto-research skip:', e.message?.slice(0, 50)); }

  // ★ 17 มิ.ย.: แปลงมุมอัตโนมัติ (ดีฟอลต์ปิด — เปิดที่สวิตช์โต๊ะ "♻️") กันเปลือง OpenAI ตอนระบบยังไม่นิ่ง
  //   เปิดเมื่อไหร่ = ข่าวดราม่า/ปะทะที่เพิ่งเก็บ ≤3 ใบ/รอบ ถูกแปลงเป็นมุมบวกอัตโนมัติ
  try {
    const rfSetting = (await createStore('desk-settings').getAll()).find(s => s.id === 'reframe_auto');
    if (rfSetting?.enabled) {
      const { reframeNews, isReframeCandidate } = await import('./reframeEngine');
      const cands = toAdd.filter(isReframeCandidate).slice(0, 3);
      for (const c of cands) {
        const r = await reframeNews(c).catch(() => ({ ok: false }));
        if (r.ok) { await store.update(c.id, (ex) => ({ ...ex, reframe: r })); stats.reframed = (stats.reframed || 0) + 1; }
      }
    }
  } catch (e) { console.log('[Harvester] auto-reframe skip:', e.message?.slice(0, 50)); }

  console.log(`[Harvester] ✅ ${JSON.stringify(stats)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return stats;
}

// ════════════════════════════════════════════════════
// AUTO-PILOT — บก.เลือกเอง ส่งเจนเอง
// ════════════════════════════════════════════════════
async function getAutopilotConfig() {
  const defaults = { enabled: true, minScore: 8, perEditorPerRound: 2, dailyCap: 20 };
  try {
    const settings = createStore('desk-settings');
    const all = await settings.getAll();
    const cfg = all.find(s => s.id === 'autopilot');
    return cfg ? { ...defaults, ...cfg } : defaults;
  } catch {
    // ★ fail-closed (คำสั่งทีม 12 มิ.ย. ค่ำ): อ่านสวิตช์ไม่ได้ = ถือว่าปิด
    //   เดิม fail-open เป็น enabled:true → DB สะดุดชั่วคราวทีไร Auto-Pilot "เปิดเอง" ทั้งที่ทีมสั่งปิด
    console.warn('[AutoPilot] ⚠️ อ่านสวิตช์ไม่ได้ — ถือว่าปิด (fail-closed) รอบนี้');
    return { ...defaults, enabled: false };
  }
}

async function autoPilotPick(freshItems, store, opts = {}) {
  const cfg = await getAutopilotConfig();
  if (!cfg.enabled && !opts.force) return 0;

  const { specialistForLane } = await import('./deskBrain');
  const { enqueueJob } = await import('@/lib/services/queueService');

  // เพดานรายวัน — นับที่ บก.ส่งเองวันนี้
  const today = new Date().toISOString().slice(0, 10);
  const allItems = await store.getAll();
  const autoSentToday = allItems.filter(i => i.autoPicked && String(i.sentAt || '').startsWith(today)).length;
  if (autoSentToday >= cfg.dailyCap) {
    console.log(`[AutoPilot] ⏸️ ครบเพดานวันนี้แล้ว (${autoSentToday}/${cfg.dailyCap})`);
    return 0;
  }
  let budget = cfg.dailyCap - autoSentToday;

  // ★ กันส่งเรื่องซ้ำเฉพาะโหมดออโต้ (คำสั่งทีม 12 มิ.ย. ค่ำ — เปลืองโทเคน): เทียบหัวข้อกับที่ "ส่งเจนไปแล้ว" ใน 7 วัน
  //   คนกดส่งเองซ้ำได้เสมอ (คนเลือกเวอร์ชัน/แตกประเด็นเองอยู่แล้ว) — ด่านนี้คุมเฉพาะ บก.AI
  const _normT = (s) => String(s || '').replace(/[\s"“”'‘’!|…]/g, '').slice(0, 60);
  const _sentKeys = allItems
    .filter(i => i.status === 'sent' && Date.now() - new Date(i.sentAt || 0).getTime() < 7 * 864e5)
    .map(i => _normT(i.title)).filter(t => t.length >= 12);
  const _isDupStory = (title) => {
    const nt = _normT(title);
    if (nt.length < 12) return false;
    return _sentKeys.some(ne => ne.includes(nt.slice(0, 16)) || nt.includes(ne.slice(0, 16)));
  };

  // จัดกลุ่มผู้สมัครตาม บก. — เอาเฉพาะที่ บก.ให้คะแนน "ทำได้" (judge ≥ minScore) และสะอาด
  const byEditor = new Map();
  for (const it of freshItems) {
    if ((it.judgeScore ?? 0) < cfg.minScore || it.status !== 'new') continue;
    if ((it.toxicity || 0) >= 2 || (it.fbRisk || 0) >= 2) continue;
    // ★ v5: เลน video (ยูทูป)/trend-track = ดิสคัฟเวอรีเท่านั้น — ทีมคัดเอง ห้าม auto-ส่ง (คลิป/กระแสอ่อนไหวเขียนตรงไม่ได้)
    if (it.lane === 'video' || it.lane === 'trend-track') continue;
    // ★ เรื่องซ้ำ (ป้าย sameStoryAs หรือหัวข้อพ้องกับที่ส่งแล้วใน 7 วัน) → ออโต้ข้าม
    if (it.sameStoryAs || _isDupStory(it.title)) {
      console.log(`[AutoPilot] ⏭️ ข้ามเรื่องซ้ำ: ${String(it.title).slice(0, 50)}`);
      continue;
    }
    // ★ ข่าวต่างประเทศ: ออโต้ไม่แตะเลย (13 มิ.ย. 69 คำสั่งทีม "ตปท.ไม่เอา") — หาภาพยาก+ทำให้คนไทยชอบยาก
    //   เหลือไว้บนโต๊ะให้คนตัดสินเองกรณีดาราดังไทยในต่างแดน (เช่น ลิซ่า) แต่ออโต้ห้ามส่ง
    if (it.foreignCountry) {
      console.log(`[AutoPilot] ⏭️ ข้ามต่างประเทศ (${it.foreignCountry}): ${String(it.title).slice(0, 50)}`);
      continue;
    }
    const sp = specialistForLane(it.lane);
    if (opts.onlyEditor && sp.name !== opts.onlyEditor) continue; // โหมดสั่ง บก.รายฝ่าย
    if (!byEditor.has(sp.name)) byEditor.set(sp.name, { sp, picks: [] });
    byEditor.get(sp.name).picks.push(it);
  }

  let sent = 0;
  const perRound = opts.perRound || cfg.perEditorPerRound;
  for (const { sp, picks } of byEditor.values()) {
    picks.sort((a, b) => (b.judgeScore || 0) - (a.judgeScore || 0));
    for (const pick of picks.slice(0, perRound)) {
      if (budget <= 0) break;
      // ★ เช็คซ้ำอีกรอบ ณ วินาทีส่ง — กันสองสำนักเรื่องเดียวกันหลุดเข้ากลุ่มมาพร้อมกันแล้วถูกส่งคู่
      if (_isDupStory(pick.title)) {
        console.log(`[AutoPilot] ⏭️ ข้ามเรื่องซ้ำในรอบเดียวกัน: ${String(pick.title).slice(0, 50)}`);
        continue;
      }
      try {
        // ★ กฎเหล็ก (12 มิ.ย.): ส่งได้แค่ TEXT (บทถอดเสียงข่าวเดียว) หรือ URL — เหมือนคนทำแมนนวลเป๊ะ
        //   ห้ามส่งเนื้อสังเคราะห์หลายแหล่งเข้าไลน์ (เคยทำให้เนื้อหลายข่าวปนกัน)
        let input = (pick.lane === 'interview' && pick.fullText) ? pick.fullText : pick.url;
        // ★ ข่าวต่างประเทศส่งเป็นลิงก์ตรง — แนบข้อเท็จจริงประเทศ (กันเขียนแบบไม่บอกประเทศ)
        if (pick.foreignCountry && input === pick.url) {
          input = `${pick.url}\n\nหมายเหตุบรรณาธิการ (ข้อเท็จจริง): ข่าวนี้เกิดที่ประเทศ${pick.foreignCountry} ไม่ใช่ประเทศไทย — ต้องระบุประเทศชัดเจนตั้งแต่ย่อหน้าแรกของโพสต์`;
        }
        const q = await enqueueJob(
          {
            input, contentLength: 'short', userId: `ai-${sp.name}`,
            // ★ ป้ายโต๊ะข่าว — ไหลผ่าน worker → auto/process → Generation Log (แยก บก./แนวข่าว + คะแนนความควรทำ)
            deskMeta: { newsId: pick.id, lane: pick.lane, category: pick.category || '', editor: sp.name, editorIcon: sp.icon, judgeScore: pick.judgeScore ?? null, finalScore: pick.finalScore ?? null },
          },
          `ai-${sp.name}`
        );
        await store.update(pick.id, (ex) => ({
          ...ex, status: 'sent', autoPicked: true, pickedBy: sp.name, pickedByIcon: sp.icon,
          pickReason: pick.judgeReason || '', claimedBy: `${sp.icon} ${sp.name}`,
          sentAt: new Date().toISOString(), jobId: q.jobId,
        }));
        // บันทึกเป็นบทเรียน (เหมือนทีมกดส่งเอง)
        try {
          const fb = createStore('news-desk-feedback');
          await fb.add({ id: `${pick.id}_autosent_${Date.now()}`, newsId: pick.id, action: 'sent', title: pick.title, category: pick.category, lane: pick.lane, user: sp.name, at: new Date().toISOString() });
        } catch {}
        sent++; budget--;
        // ★ กันส่งเรื่องเดียวกันคู่ในรอบเดียว: จดหัวข้อที่เพิ่งส่งเข้าลิสต์กันซ้ำทันที
        const _justSent = _normT(pick.title);
        if (_justSent.length >= 12) _sentKeys.push(_justSent);
        console.log(`[AutoPilot] ${sp.icon} ${sp.name} เลือก [${pick.judgeScore}] ${String(pick.title).slice(0, 50)} → คิว ${q.jobId.slice(0, 8)}`);
      } catch (e) {
        console.log('[AutoPilot] ส่งไม่สำเร็จ:', e.message?.slice(0, 60));
      }
    }
  }
  if (sent > 0) console.log(`[AutoPilot] ✅ บก.ส่งเจนเอง ${sent} ข่าว (วันนี้รวม ${autoSentToday + sent}/${cfg.dailyCap})`);
  return sent;
}

/** ★ แจ้ง Discord (webhook เดียวกับเมนูเช้า) — ให้คนที่ไม่อยู่หน้าคอมเห็นเหมือนกัน */
export async function notifyDiscord(content) {
  try {
    let webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) {
      const settings = createStore('desk-settings');
      const all = await settings.getAll();
      webhook = all.find(s => s.id === 'discord_webhook')?.url;
    }
    if (!webhook) return false;
    await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content).slice(0, 1950) }),
    });
    return true;
  } catch { return false; }
}

/**
 * ★ สั่ง บก.รายฝ่ายทำทันที (ปุ่ม/Discord) — สแกนเลนตัวเอง ตัดสินตัวที่ยังไม่มีคะแนน แล้วเลือกส่งเจน
 */
export async function runEditorNow(editorKey) {
  const { SPECIALIST_EDITORS, editorialJudge, finalScore, getCategoryPerformance } = await import('./deskBrain');
  const sp = SPECIALIST_EDITORS[editorKey];
  if (!sp) throw new Error('ไม่รู้จัก บก.: ' + editorKey);

  const store = createStore('news-desk');
  const all = await store.getAll();
  const candidates = all.filter(i =>
    i.status === 'new' && sp.lanes.includes(i.lane) &&
    Date.now() - new Date(i.harvestedAt || 0).getTime() < 48 * 3600e3);

  // ตัวที่ บก.ยังไม่เคยดู → ตัดสินก่อน (สูงสุด 16 ใบ/ครั้ง)
  const unjudged = candidates.filter(c => c.judgeScore === undefined).slice(0, 16);
  if (unjudged.length > 0) {
    const judged = await editorialJudge(unjudged);
    const perf = await getCategoryPerformance();
    for (const j of judged) {
      if (j.judgeScore === undefined) continue;
      await store.update(j.id, (ex) => ({
        ...ex, judgeScore: j.judgeScore, judgeReason: j.judgeReason, angles: j.angles,
        finalScore: finalScore(j, perf),
      }));
    }
  }

  // เลือกส่งเจน (บังคับรันแม้ Auto-Pilot ปิด — เพราะคนกดสั่งเอง)
  const fresh = await store.getAll();
  const pool = fresh.filter(i => i.status === 'new' && sp.lanes.includes(i.lane));
  const picked = await autoPilotPick(pool, store, { force: true, onlyEditor: sp.name, perRound: 3 });

  const summary = `${sp.icon} **${sp.name}** สแกนเลนตัวเองแล้ว: ดูใหม่ ${unjudged.length} ใบ · เลือกส่งเจน ${picked} ข่าว${picked > 0 ? ' (ดูที่แท็บ ✅ พร้อมใช้เมื่อเขียนเสร็จ)' : ' — ยังไม่มีตัวที่ถึงเกณฑ์ 8+'}`;
  await notifyDiscord(summary);
  return { editor: sp.name, icon: sp.icon, scanned: candidates.length, judgedNew: unjudged.length, picked, summary };
}

/** ลบข่าวเก่าเกิน N วัน กันคลังบวม (เรียกตอน harvest) */
export async function pruneOldItems(days = 3) {
  try {
    const store = createStore('news-desk');
    const all = await store.getAll();
    const cutoff = Date.now() - days * 864e5;
    let removed = 0;
    for (const it of all) {
      const keep = it.status === 'claimed' || it.status === 'sent';
      if (!keep && new Date(it.harvestedAt || 0).getTime() < cutoff) {
        await store.remove(it.id);
        removed++;
      }
    }
    if (removed) console.log(`[Harvester] 🧹 pruned ${removed} old items`);
    return removed;
  } catch { return 0; }
}

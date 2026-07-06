/**
 * =====================================================
 * 📡 Direct Feeds — เลนเฝ้าแหล่งตรง (2 ก.ค. 69)
 * =====================================================
 * ที่มา: โต๊ะข่าวเดิมพึ่ง "การค้นหา" (Serper/Google News) ทั้งหมด — เจอเฉพาะข่าวที่ Google จัดดัชนี+ตรงคำค้น
 *   แต่ต้นน้ำข่าวดารา/สตอรี่จริงคือ (ก) สำนักบันเทิงลงตรง (ข) รายการสัมภาษณ์บนยูทูบ
 * เลนใหม่ 2 เลน (ฟรีทั้งคู่ ไม่กิน Serper credit):
 *   • entrss  — RSS ตรงสำนักข่าวบันเทิงไทย (เร็วกว่ารอ Google จัดดัชนี)
 *   • ytwatch — เฝ้าช่องยูทูบรายการสัมภาษณ์ (โหนกระแส/WOODY/ตีท้ายครัว/แฉ/เจาะใจ)
 *               อัพโหลดใหม่เข้าเลน video (ดิสคัฟเวอรี — ทีมคัด/สั่งถอดคลิปได้ · autopilot ไม่ auto-ส่ง)
 * ✅ ทุก URL ผ่านการเทสจริง 2 ก.ค. 69 — feed ที่ตายให้ตัดออก/เปลี่ยน ไม่ต้องเดา
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง
 */

// ── RSS สำนักบันเทิงไทย (เทสผ่าน 2 ก.ค. 69: คืน XML จริง) ──
//   ❌ ที่เทสแล้วใช้ไม่ได้ (อย่าเติมกลับโดยไม่เทส): sanook(404) kapook(ว่าง) innnews(wp_die)
//      komchadluek/springnews/tnews/daradaily(คืน HTML) ejan(406) amarin(Cloudflare) mgronline/naewna/pptv(ไม่มี)
export const ENT_RSS_FEEDS = [
  { name: 'ไทยรัฐบันเทิง', url: 'https://www.thairath.co.th/rss/entertain' },
  { name: 'ข่าวสดบันเทิง', url: 'https://www.khaosod.co.th/entertainment/feed' },
  { name: 'มติชนบันเทิง', url: 'https://www.matichon.co.th/entertainment/feed' },
  { name: 'เดลินิวส์บันเทิง', url: 'https://www.dailynews.co.th/news_group/entertainment/feed/' },
  { name: 'Workpoint Today', url: 'https://workpointtoday.com/feed/' },
];

// ── ช่องยูทูบรายการ (resolve channelId จริงจากผลค้น + verify RSS 4 ก.ค. 69) ──
//   ★ 4 ก.ค. (feedback ผู้ใช้ "คลิปรายการดีๆ/สัมภาษณ์เจอน้อย"): ขยายเป็น 2 ระดับ + กรองชื่อรายการ
//   pure:true  = ช่องเฉพาะทาง คลิปเกือบทั้งช่องคือของดี → เอาทุกใบ (verify: เรื่องจริงผ่านจอ 12/15 ดี)
//   pure:false = ช่องใหญ่ปนเกมโชว์/ทั่วไป → เอาเฉพาะคลิปที่ชื่อเข้าเกณฑ์ good-content (verify: Workpoint 1/15)
export const YT_WATCH_CHANNELS = [
  // ── สายทำดี/สารคดีชีวิต (pure) — DNA ตรงเพจสุด ──
  { name: 'เรื่องจริงผ่านจอ', channelId: 'UC9Vqj1lqElub-pT6gEXlWYQ', pure: true }, // สารคดีชีวิต/น้ำใจ/เตือนภัย
  { name: 'เจาะใจ (JSL)', channelId: 'UCDlAjVM03Oce5mywNDHpHZw', pure: true },      // เล่าชีวิต/สู้ชีวิต
  // ── สายสัมภาษณ์/เปิดใจ (pure — เกือบทุกใบคือสัมภาษณ์) ──
  { name: 'โหนกระแส', channelId: 'UCXm0bpjlfB0AF-ZdPhT0K1A', pure: true },          // พี่หนุ่ม กรรชัย — ต้นทางโพสต์แชมป์
  { name: 'WoodyWorld', channelId: 'UCPWauUGtqP4B1Aw3UoHI2ew', pure: true },        // WOODY สัมภาษณ์เปิดใจ
  { name: 'Orange Mama (คุยแซ่บ)', channelId: 'UC01guxmF_fLAVpUopImHzyg', pure: true }, // คุยแซ่บโชว์ สัมภาษณ์ดารา
  // ── สายช่วยเหลือ/น้ำดีโดยตรง (mixed → กรองชื่อ) ──
  { name: 'ร่วมด้วยช่วยกัน', channelId: 'UCYi0Z-_bKHPJDQcEErJ1-cA', pure: false }, // ★ 4 ก.ค.: รายการช่วยเหลือคน น้ำใจ โดยตรง
  { name: 'คนสู้ชีวิต', channelId: 'UCuETCsRpXqpuUrFodIKLlTQ', pure: true }, // ★ 4 ก.ค.: ช่องรวมข่าวน้ำใจ/ชาวบ้านช่วยกัน (15/15 คลิปเป็นน้ำดี)
  // ── ช่องใหญ่ปนกัน (mixed) → กรองด้วยชื่อรายการ good-content เท่านั้น ──
  { name: 'WorkpointOfficial (ปัญญาปันสุข)', channelId: 'UC3ZkCd7XtUREnjjt3cyY_gg', pure: false }, // ปัญญาปันสุข/ชิงร้อยฯ ช่วยคน
  { name: 'Burabha (คนค้นฅน)', channelId: 'UCoEOBYHusSP-0ZlDe8cqMng', pure: false }, // คนค้นฅน สารคดีคน
  { name: 'NineEntertain', channelId: 'UCFJbA88W7NtghiTuCns-eYw', pure: false },     // ข่าวบันเทิง+สัมภาษณ์ดารา
  { name: 'oneบันเทิง', channelId: 'UC-FKx2wxE8CGWsCfSc2TaGg', pure: false },        // วันบันเทิง สัมภาษณ์ดารา
  { name: 'Polyplus (ตีท้ายครัว/3แซ่บ)', channelId: 'UCMSLmwkXFhkxKFv2gS4NBww', pure: false },
  { name: 'GMM25 (แฉ)', channelId: 'UCTP5z0kFg6-nPcZ79gTC67Q', pure: false },
];

// ★ ชื่อคลิปที่ "เป็นของดี" — ใช้กรองช่องใหญ่ (pure:false) เอาเฉพาะสัมภาษณ์/ทำดี/สู้ชีวิต/ไฮไลท์ ตัดเกมโชว์/โปรโมท
const GOOD_CLIP_TITLE = /ปันสุข|ช่วยเหลือ|ช่วยชีวิต|สู้ชีวิต|กตัญญู|สัมภาษณ์|เปิดใจ|เปิดอก|ไฮไลท์|ไฮไลต์|เรื่องจริง|น้ำใจ|บริจาค|ยอดกตัญญู|ฅนค้นฅน|คนค้นฅน|ชีวิต|ปาฏิหาริย์|เล่าเรื่อง|ให้กำลังใจ|แรงบันดาลใจ|โมเมนต์|ดราม่า|เคลียร์|ตอบทุกคำถาม|ที่สุดในชีวิต|วันวาน|ยากจน|ลำบาก|มอบทุน|มอบเงิน|มอบบ้าน|สร้างบ้านให้|ผู้ด้อยโอกาส|วอนช่วย|ระดมทุน|เรื่องดีๆ|พลเมืองดี|เด็กเก่ง|ทุนการศึกษา/;

// ── ตัวแปลง RSS/Atom → items (รองรับทั้ง <item> ของ RSS2 และ <entry> ของ Atom/YouTube) ──
const pickTag = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/g, ' ').trim();
};

function parseRss2(xml, sourceName) {
  const items = [];
  for (const b of (String(xml).match(/<item[\s>][\s\S]*?<\/item>/g) || []).slice(0, 25)) {
    const title = pickTag(b, 'title');
    const url = pickTag(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '');
    if (!title || !url) continue;
    // ภาพจาก enclosure/media:content ถ้ามี
    const img = b.match(/<(?:enclosure|media:content|media:thumbnail)[^>]*url="([^"]+)"/i)?.[1] || '';
    const d = new Date(pickTag(b, 'pubDate') || pickTag(b, 'dc:date'));
    items.push({
      title, url,
      snippet: pickTag(b, 'description').slice(0, 200),
      publishedAt: isNaN(d) ? null : d.toISOString(),
      source: sourceName, imageUrl: img,
    });
  }
  return items;
}

function parseYouTubeAtom(xml, channelName) {
  const items = [];
  for (const b of (String(xml).match(/<entry>[\s\S]*?<\/entry>/g) || []).slice(0, 15)) {
    const title = pickTag(b, 'title');
    const url = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '';
    if (!title || !url) continue;
    const d = new Date(pickTag(b, 'published'));
    items.push({
      title, url,
      videoId: pickTag(b, 'yt:videoId') || (url.match(/[?&]v=([A-Za-z0-9_-]{11})/) || [])[1] || '',
      snippet: pickTag(b, 'media:description').slice(0, 200) || `📺 ช่อง: ${channelName}`,
      publishedAt: isNaN(d) ? null : d.toISOString(),
      source: channelName,
      imageUrl: b.match(/<media:thumbnail[^>]*url="([^"]+)"/i)?.[1] || '',
      isVideo: true,
    });
  }
  return items;
}

// ★ 4 ก.ค.: เติม "ยอดวิว/ความยาว" จริงจาก YouTube Data API (1 หน่วยโควตา/50 คลิป — ถูกมาก)
//   → จัดอันดับ/กรองคลิปด้วยยอดวิวจริง (feedback: อยากได้คลิปดีที่คนดูเยอะ ไม่ใช่คลิปช่องอัปทิ้ง)
//   env-gated: ไม่มี YOUTUBE_API_KEY = คืน clips เดิม (ไม่พัง)
const _dur = (iso) => { const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0; };
export async function enrichWithStats(clips) {
  const key = process.env.YOUTUBE_API_KEY;
  const ids = [...new Set(clips.map(c => c.videoId).filter(Boolean))];
  if (!key || !ids.length) return clips;
  const stats = {};
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${batch.join(',')}&key=${key}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) { console.log('[DirectFeeds] YouTube stats', r.status); break; }
      const d = await r.json();
      for (const it of (d.items || [])) stats[it.id] = { views: Number(it.statistics?.viewCount || 0), durationSec: _dur(it.contentDetails?.duration) };
    }
  } catch (e) { console.log('[DirectFeeds] stats fail:', e.message?.slice(0, 40)); return clips; }
  return clips.map(c => ({ ...c, ...(stats[c.videoId] || {}) }));
}

async function fetchXml(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (ViralFlow-NewsDesk)' }, signal: controller.signal });
    if (!res.ok) return '';
    return await res.text();
  } catch { return ''; }
  finally { clearTimeout(timer); }
}

/** 📰 เลน entrss — ดึงข่าวใหม่จากสำนักบันเทิงทุกเจ้าพร้อมกัน (บทความ ≤3 วัน — RSS มีแต่ของใหม่อยู่แล้ว แต่กันสำนักที่ feed ค้าง) */
export async function fetchEntRss({ maxAgeDays = 3 } = {}) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  const results = await Promise.all(ENT_RSS_FEEDS.map(async f => {
    const xml = await fetchXml(f.url);
    if (!xml) { console.log(`[DirectFeeds] 📰 ${f.name}: feed ว่าง/ล่ม`); return []; }
    return parseRss2(xml, f.name).filter(i => !i.publishedAt || new Date(i.publishedAt).getTime() >= cutoff);
  }));
  const all = results.flat().map(r => ({ ...r, lane: 'entrss', _query: 'feed:' + r.source }));
  console.log(`[DirectFeeds] 📰 entrss: ${ENT_RSS_FEEDS.length} สำนัก → ${all.length} ใบ`);
  return all;
}

/** 📺 เลน ytwatch — อัพโหลดใหม่จากช่องรายการ (≤N วัน) → เข้าเลน video (ดิสคัฟเวอรี)
 *  ★ 4 ก.ค.: ช่อง pure=เอาทุกใบ · ช่องใหญ่ mixed=เอาเฉพาะคลิปชื่อเข้าเกณฑ์ good-content (กันเกมโชว์/โปรโมทปน) */
export async function fetchYouTubeChannels({ maxAgeDays = 21 } = {}) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  let skipped = 0;
  const results = await Promise.all(YT_WATCH_CHANNELS.map(async c => {
    const xml = await fetchXml(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`);
    if (!xml) { console.log(`[DirectFeeds] 📺 ${c.name}: feed ว่าง/ล่ม`); return []; }
    let vids = parseYouTubeAtom(xml, c.name).filter(i => i.publishedAt && new Date(i.publishedAt).getTime() >= cutoff);
    if (c.pure === false) {
      const before = vids.length;
      vids = vids.filter(v => GOOD_CLIP_TITLE.test(v.title));
      skipped += before - vids.length;
    }
    return vids;
  }));
  // lane 'video' = โซนคลิป/ดิสคัฟเวอรี (autopilot ไม่ auto-ส่ง — ทีมคัด/ถอดคลิปก่อน) + ป้ายช่องที่เฝ้า
  let all = results.flat().map(r => ({ ...r, lane: 'video', watchChannel: r.source, _query: 'yt:' + r.source }));
  // ★ 4 ก.ค.: เติมยอดวิวจริง → ตัดคลิปดูน้อย (ช่องอัปทิ้ง/ไม่ปัง) + ตัด Shorts <60s + เรียงวิวมากก่อน
  //   ⚖️ ยุติธรรมกับคลิปสด: อัปใน 3 วัน = ยกเว้นเกณฑ์วิว (ยังไม่ทันมีคนดู แต่อาจดีมาก) · เก่ากว่านั้นต้อง ≥8k วิว
  const before = all.length;
  all = await enrichWithStats(all);
  if (all.some(c => c.views !== undefined)) {
    const freshCut = Date.now() - 3 * 864e5;
    all = all.filter(c => {
      if (c.views === undefined) return true;                                   // ดึงวิวไม่ได้ = ปล่อยผ่าน
      if (c.durationSec !== undefined && c.durationSec > 0 && c.durationSec < 60) return false; // Shorts ตัด
      const isFresh = c.publishedAt && new Date(c.publishedAt).getTime() >= freshCut;
      return isFresh || c.views >= 8000;                                        // สด=ยกเว้น · เก่า=ต้องวิวถึง
    });
    all.sort((a, b) => (b.views || 0) - (a.views || 0));
  }
  const pureN = YT_WATCH_CHANNELS.filter(c => c.pure).length;
  console.log(`[DirectFeeds] 📺 ytwatch: ${YT_WATCH_CHANNELS.length} ช่อง (pure ${pureN}) → ${all.length} คลิปดี (ชื่อไม่เข้าเกณฑ์ ${skipped} · ยอดวิวน้อย/สั้น ${before - all.length})`);
  return all;
}

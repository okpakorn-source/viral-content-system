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

// ── ช่องยูทูบรายการสัมภาษณ์/เล่าชีวิต (resolve channelId จริงจากผลค้น YouTube 2 ก.ค. 69) ──
//   เกณฑ์เลือก: รายการที่ผลิต "สตอรี่คน" แบบที่เพจปังจริง (โหนกระแส=ซากา/น้ำใจ · เจาะใจ=สู้ชีวิต · WOODY/ตีท้ายครัว=ดาราเปิดใจ)
export const YT_WATCH_CHANNELS = [
  { name: 'โหนกระแส', channelId: 'UCXm0bpjlfB0AF-ZdPhT0K1A' },        // พี่หนุ่ม กรรชัย — ต้นทางโพสต์แชมป์ 167k
  { name: 'WoodyWorld', channelId: 'UCPWauUGtqP4B1Aw3UoHI2ew' },       // WOODY สัมภาษณ์เปิดใจ
  { name: 'Polyplus (ตีท้ายครัว/3แซ่บ)', channelId: 'UCMSLmwkXFhkxKFv2gS4NBww' },
  { name: 'GMM25 (แฉ)', channelId: 'UCTP5z0kFg6-nPcZ79gTC67Q' },
  { name: 'เจาะใจ (JSL)', channelId: 'UCDlAjVM03Oce5mywNDHpHZw' },     // เล่าชีวิต/สู้ชีวิต — DNA ตรงเพจสุด
];

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
      snippet: pickTag(b, 'media:description').slice(0, 200) || `📺 ช่อง: ${channelName}`,
      publishedAt: isNaN(d) ? null : d.toISOString(),
      source: channelName,
      imageUrl: b.match(/<media:thumbnail[^>]*url="([^"]+)"/i)?.[1] || '',
      isVideo: true,
    });
  }
  return items;
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
  const all = results.flat().map(r => ({ ...r, lane: 'entrss' }));
  console.log(`[DirectFeeds] 📰 entrss: ${ENT_RSS_FEEDS.length} สำนัก → ${all.length} ใบ`);
  return all;
}

/** 📺 เลน ytwatch — อัพโหลดใหม่จากช่องรายการสัมภาษณ์ (≤14 วัน) → เข้าเลน video (ดิสคัฟเวอรี) */
export async function fetchYouTubeChannels({ maxAgeDays = 14 } = {}) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  const results = await Promise.all(YT_WATCH_CHANNELS.map(async c => {
    const xml = await fetchXml(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`);
    if (!xml) { console.log(`[DirectFeeds] 📺 ${c.name}: feed ว่าง/ล่ม`); return []; }
    return parseYouTubeAtom(xml, c.name).filter(i => i.publishedAt && new Date(i.publishedAt).getTime() >= cutoff);
  }));
  // lane 'video' = โซนคลิป/ดิสคัฟเวอรี (autopilot ไม่ auto-ส่ง — ทีมคัด/ถอดคลิปก่อน) + ป้ายช่องที่เฝ้า
  const all = results.flat().map(r => ({ ...r, lane: 'video', watchChannel: r.source }));
  console.log(`[DirectFeeds] 📺 ytwatch: ${YT_WATCH_CHANNELS.length} ช่อง → ${all.length} คลิปใหม่ (≤${maxAgeDays} วัน)`);
  return all;
}

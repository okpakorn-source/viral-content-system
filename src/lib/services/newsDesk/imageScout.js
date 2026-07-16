/**
 * Image Scout — หาแหล่งภาพประกอบข่าวจากทุกช่องทางโซเชียล (11 มิ.ย. 69)
 * ─────────────────────────────────────────────────────────────
 * ปัญหาที่แก้: ทีมทำปกต้องนั่งคิดคีย์เวิร์ดแล้วไล่ค้นภาพเองทุกข่าว เสียเวลา
 * และเสี่ยงหยิบภาพผิดเหตุการณ์ (เช่น งานเลี้ยงเดียวกันแต่เป็นของ 2 ปีก่อน)
 *
 * หลักการ: ไม่แคป/ดูดภาพ — ส่ง "ลิงก์แหล่งจริง" จัดกลุ่มตามช่องทางให้คนเลือกเอง
 * (คนเป็นชั้นตัดสินสุดท้าย เหมือนปรัชญา Auto-Pilot ของโต๊ะข่าว)
 *
 * 3 ขั้น:
 * ① วิเคราะห์บริบท (gpt-5.5): ใคร-ทำอะไร-ที่ไหน-เมื่อไหร่ → คำค้นที่ "ยึดเหตุการณ์"
 *    กฎกันเพี้ยน: ห้ามค้นชื่อคน/สถานที่เดี่ยวๆ ต้องผูก คน+การกระทำ(+สถานที่) เสมอ
 * ② ค้นหลายช่องทางผ่าน Serper: ภาพ Google / เว็บข่าว / วิดีโอ / site:facebook / tiktok / instagram
 * ③ กรองความเกี่ยวข้อง (gpt-4o-mini): ให้คะแนนทุกลิงก์ 0-10 เทียบเหตุการณ์ ตัดของเก่า/คนละเรื่อง
 */
import { callAI } from '@/lib/ai/openai';

async function serperSearch(endpoint, query, num = 8, timeRange = null) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('ไม่มี SERPER_API_KEY');
  const body = { q: query, gl: 'th', hl: 'th', num };
  if (timeRange) body.tbs = timeRange;
  const res = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  return res.json();
}

function extractJson(raw) {
  if (typeof raw === 'object' && raw !== null) return raw;
  const m = String(raw).match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// ── ① วิเคราะห์ข่าว → คำค้นยึดเหตุการณ์ ──────────────────────────
export async function analyzeImageQueries({ title, content }) {
  const raw = await callAI({
    prompt: `คุณคือหัวหน้าฝ่ายภาพของเพจข่าวไวรัลไทย งานคือวิเคราะห์ข่าวแล้วสร้าง "คำค้นหาแหล่งภาพ" ที่แม่นที่สุด

เนื้อข่าว:
หัวข้อ: ${title}
${String(content || '').slice(0, 3500)}

กฎเหล็กกันภาพผิดเหตุการณ์ (สำคัญที่สุด):
1. ทุกคำค้นต้องผูก "คน + การกระทำ" หรือ "คน + เหตุการณ์ + สถานที่" เสมอ — ห้ามใช้ชื่อสถานที่/ชื่อคน/ชื่อองค์กรเดี่ยวๆ เด็ดขาด
   ผิด: "วัดพระธาตุ" (จะเจอภาพวัดทั่วไปทุกยุค) | ถูก: "ลิซ่า บริจาคเงิน วัดพระธาตุ"
2. ใช้ชื่อบุคคลตามที่เขียนในข่าวเท่านั้น — ห้ามเดาชื่อเต็ม/นามสกุล/ตัวตนที่ข่าวไม่ได้บอก
3. เหตุการณ์ต้องเป็นรอบปัจจุบัน — ถ้าข่าวระบุช่วงเวลา ให้บันทึกไว้ใน timeHint เพื่อกันภาพเหตุการณ์เดียวกันของปีเก่า
4. คิดหลายมุม: ภาพคนขณะทำเหตุการณ์ / ภาพสถานที่ขณะเกิดเหตุ / คลิปรายงานข่าว / โพสต์ต้นทางของคนในข่าว
5. ถ้าเดาได้ว่าคนในข่าวน่าจะมีเพจ/บัญชีโซเชียลของตัวเอง ให้สร้างคำค้นหาบัญชีนั้น (purpose: "หาโพสต์ต้นทาง")

ตอบ JSON เท่านั้น:
{"event":"สรุปเหตุการณ์ 1 ประโยค ระบุคน+การกระทำ+ที่+เมื่อไหร่",
"people":["ชื่อตามข่าวเป๊ะๆ"],
"action":"การกระทำหลัก",
"place":"สถานที่ (ถ้ามี ไม่มีใส่ '')",
"timeHint":"fresh|month|old — ข่าวสดสัปดาห์นี้=fresh ภายในเดือน=month เก่ากว่านั้น=old",
"queries":[{"q":"คำค้น","purpose":"หาอะไร"}],
"mustAvoid":["สัญญาณว่าผิดเหตุการณ์ เช่น ปี พ.ศ. เก่า / เหตุการณ์คล้ายของคนอื่น"]}

queries 4-6 ชุด เรียงจากแม่นสุดไปกว้างสุด`,
    model: 'gpt-5.5',
    temperature: 0.2,
    maxTokens: 4000,
  });
  const parsed = extractJson(raw);
  if (!parsed?.queries?.length) throw new Error('วิเคราะห์คำค้นไม่สำเร็จ');
  parsed.queries = parsed.queries.slice(0, 6).filter(q => q?.q && String(q.q).length >= 4);
  return parsed;
}

// ── ② ค้นทุกช่องทาง (~8 calls ต่อข่าว) ──────────────────────────
async function searchAllChannels(analysis) {
  const qs = analysis.queries.map(q => q.q);
  const q1 = qs[0];
  const q2 = qs[1] || q1;
  const q3 = qs[2] || q1;
  // ข่าวสด → จำกัดผลค้นใน 1 สัปดาห์/1 เดือน กันภาพเหตุการณ์เก่า
  const tbs = analysis.timeHint === 'fresh' ? 'qdr:w' : analysis.timeHint === 'month' ? 'qdr:m' : null;

  const [img1, img2, news1, vids, fb1, fb2, tk, ig] = await Promise.all([
    serperSearch('images', q1, 10, tbs).catch(() => ({})),
    serperSearch('images', q2, 8, tbs).catch(() => ({})),
    serperSearch('news', q1, 8, tbs).catch(() => ({})),
    serperSearch('videos', q1, 8, tbs).catch(() => ({})),
    serperSearch('search', `${q1} site:facebook.com`, 10, tbs).catch(() => ({})),
    serperSearch('search', `${q2} site:facebook.com`, 8, tbs).catch(() => ({})),
    serperSearch('search', `${q3} site:tiktok.com`, 6, tbs).catch(() => ({})),
    serperSearch('search', `${q3} site:instagram.com`, 5, tbs).catch(() => ({})),
  ]);

  const candidates = [];
  const push = (channel, arr, map) => {
    for (const r of arr || []) {
      const c = map(r);
      if (c?.url) candidates.push({ channel, ...c });
    }
  };

  push('images', [...(img1.images || []), ...(img2.images || [])], r => ({
    url: r.link || r.imageUrl, imageUrl: r.imageUrl, title: r.title || '', snippet: r.source || '',
  }));
  push('news', news1.news, r => ({ url: r.link, title: r.title || '', snippet: r.snippet || '' }));
  // วิดีโอจาก /videos แยกช่องตามโดเมนจริง (ส่วนใหญ่ youtube/tiktok)
  for (const v of vids.videos || []) {
    const ch = /tiktok\.com/.test(v.link) ? 'tiktok' : /youtube\.com|youtu\.be/.test(v.link) ? 'youtube' : 'news';
    candidates.push({ channel: ch, url: v.link, title: v.title || '', snippet: v.snippet || '' });
  }
  push('facebook', [...(fb1.organic || []), ...(fb2.organic || [])], r => ({ url: r.link, title: r.title || '', snippet: r.snippet || '' }));
  push('tiktok', tk.organic, r => ({ url: r.link, title: r.title || '', snippet: r.snippet || '' }));
  push('instagram', ig.organic, r => ({ url: r.link, title: r.title || '', snippet: r.snippet || '' }));

  // กันซ้ำด้วย URL
  return [...new Map(candidates.map(c => [c.url, c])).values()].slice(0, 60);
}

// ── ③ กรองความเกี่ยวข้อง — ตัดของเก่า/คนละเหตุการณ์ ───────────────
async function filterByRelevance(analysis, candidates) {
  if (candidates.length === 0) return [];
  const listing = candidates.map((c, i) => `${i}| [${c.channel}] ${c.title} — ${String(c.snippet).slice(0, 90)}`).join('\n');
  try {
    const raw = await callAI({
      prompt: `คุณคือฝ่ายภาพเพจข่าว ตรวจว่าลิงก์ไหน "เกี่ยวกับเหตุการณ์นี้จริง" บ้าง

เหตุการณ์: ${analysis.event}
คนในข่าว: ${(analysis.people || []).join(', ')}
สัญญาณว่าผิดเหตุการณ์: ${(analysis.mustAvoid || []).join(' / ') || '-'}

รายการลิงก์ (เลข| [ช่องทาง] หัวข้อ — คำโปรย):
${listing}

ให้คะแนน 0-10: 10=เหตุการณ์นี้แน่นอน คนตรง การกระทำตรง | 5=น่าจะเกี่ยว | 0=คนละเรื่อง/ของเก่า
กฎเข้ม: ถ้าหัวข้อ/คำโปรยไม่ได้พูดถึงคนในข่าว หรือการกระทำ หรือสถานที่ของเหตุการณ์นี้เลย ให้ ≤3 เสมอ ห้ามเดาเข้าข้าง
ตอบ JSON เท่านั้น: {"scores":[{"i":0,"s":8},{"i":1,"s":3}]}  ← ครบทุกเลข`,
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 3000,
    });
    const parsed = extractJson(raw);
    const scoreMap = new Map((parsed?.scores || []).map(x => [Number(x.i), Number(x.s) || 0]));
    return candidates
      .map((c, i) => ({ ...c, score: scoreMap.has(i) ? scoreMap.get(i) : 5 }))
      .filter(c => c.score >= 6);
  } catch (e) {
    // กรองล้ม → คืนทั้งหมดแบบไม่มีคะแนน ดีกว่าไม่มีอะไรเลย (fallback ห้ามตัด)
    console.log('[ImageScout] filter ล้ม ใช้ผลดิบ:', e.message?.slice(0, 50));
    return candidates.map(c => ({ ...c, score: null }));
  }
}

// ═══════════════════════════════════════════════════════════════
// ★ Photo Board (12 มิ.ย. 69) — "แผงรูปพร้อมใช้" คนไม่ต้องเสิร์ชเอง
// ① ดูดรูปจริงจากตัวบทความข่าว (อัลบั้มดิบใต้ข่าวไทยมักไม่มีกราฟิกทับ — ของดีอยู่ตรงนี้)
// ② ตามรอย "ขอบคุณภาพจาก/เครดิต: เพจ X" → ลิงก์ต้นโพสต์ที่มีอัลบั้มเต็ม
// ③ ตา AI (faceDetector ตัวเดียวกับระบบปก) คัดเฉพาะรูปคนชัด ไม่มีตัวหนังสือเผา เรียงสวยสุดก่อน
// ═══════════════════════════════════════════════════════════════

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchHtml(url, timeoutMs = 10000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'th,en' }, signal: controller.signal, redirect: 'follow' });
    clearTimeout(t);
    if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) return null;
    return (await res.text()).slice(0, 600_000);
  } catch { return null; }
}

function extractArticleImages(html, baseUrl) {
  const urls = new Set();
  const og = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i)
    || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image/i);
  if (og?.[1]) urls.add(og[1]);
  const re = /<img[^>]+(?:data-src|data-original|data-lazy-src|src)=["']([^"'>\s]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null && urls.size < 40) urls.add(m[1]);
  return [...urls]
    .map(u => { try { return new URL(u, baseUrl).href; } catch { return null; } })
    // รับทั้งมีนามสกุลรูปชัด และ path สไตล์ CDN ข่าวไทยที่ไม่มีนามสกุล (/uploads/, /media/, wp-content)
    .filter(u => u && (/\.(jpe?g|png|webp)(\?|$)/i.test(u) || /\/(uploads?|media|images?|wp-content|files|photo)\//i.test(u)))
    .filter(u => !/logo|icon|avatar|sprite|placeholder|banner|favicon|emoji|\/ads?[\/.]|\/static\/|qrcode|line-add|share|button|\.svg|\.gif/i.test(u));
}

// "ขอบคุณภาพจาก/ภาพจาก/เครดิต/ที่มา : เพจ X" — ธรรมเนียมข่าวไทย = ป้ายชี้ต้นโพสต์ฟรีๆ
function extractPhotoCredits(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const credits = new Set();
  const re = /(?:ขอบคุณ(?:ภาพ|ข้อมูล)?(?:และข้อมูล)?(?:จาก)?|ภาพจาก|เครดิต(?:ภาพ)?|ที่มา)\s*[:：]\s*(?:เพจ\s*)?([ก-๙a-zA-Z0-9 ._\-']{3,50})/g;
  let m;
  while ((m = re.exec(text)) !== null && credits.size < 3) {
    const name = m[1].trim().replace(/\s{2,}/g, ' ').replace(/[,.]$/, '');
    if (name.length >= 3 && !/^(facebook|ข่าว|วันที่|https?)/i.test(name)) credits.add(name);
  }
  return [...credits];
}

async function buildPhotoBoard(kept, analysis) {
  // ── รวบหน้าเว็บข่าวที่คุ้มจะเข้าไปดูดรูป (โซเชียลดูดไม่ได้ — ข้าม) ──
  const SOCIAL = /facebook\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|lookaside\./i;
  let pageLinks = [...new Set(
    kept.filter(c => (c.channel === 'news' || c.channel === 'images') && c.url
      && !SOCIAL.test(c.url)
      && (c.score == null || c.score >= 6))
      .map(c => c.url)
  )].slice(0, 5);

  // ★ ข่าวกระแสโซเชียล: ผลค้นเป็น FB/IG/TikTok ล้วน ไม่มีเว็บข่าวให้ดูดรูป → ค้นเว็บข่าวเพิ่มเอง 1 รอบ
  if (pageLinks.length < 2 && analysis?.queries?.[0]?.q) {
    try {
      const extra = await serperSearch('search', `${analysis.queries[0].q} ข่าว`, 8);
      for (const o of extra.organic || []) {
        if (o.link && !SOCIAL.test(o.link) && pageLinks.length < 5 && !pageLinks.includes(o.link)) pageLinks.push(o.link);
      }
    } catch { /* ข้าม */ }
  }

  const candidates = new Map(); // key = URL ตัด query (กันรูปเดียวกันซ้ำคนละ size param) → { img, page }
  const addCandidate = (img, page) => {
    const key = String(img).split('?')[0];
    if (!candidates.has(key) && candidates.size < 34) candidates.set(key, { img, page });
  };
  // รูปจาก Google Images มี URL รูปตรงอยู่แล้ว — เข้ารอบทันที
  for (const c of kept.filter(x => x.imageUrl)) addCandidate(c.imageUrl, c.url || '');

  const creditNames = new Set();
  const htmls = await Promise.all(pageLinks.map(u => fetchHtml(u)));
  htmls.forEach((html, i) => {
    if (!html) return;
    for (const img of extractArticleImages(html, pageLinks[i])) addCandidate(img, pageLinks[i]);
    for (const name of extractPhotoCredits(html)) creditNames.add(name);
  });

  // ── ตามรอยต้นโพสต์จากชื่อเครดิต (สูงสุด 2 ชื่อ ชื่อละ 1 ค้น) ──
  const originPosts = [];
  for (const name of [...creditNames].slice(0, 2)) {
    try {
      const r = await serperSearch('search', `"${name}" site:facebook.com`, 3);
      const hit = (r.organic || [])[0];
      if (hit?.link) originPosts.push({ name, url: hit.link, title: String(hit.title || '').slice(0, 90) });
    } catch { /* ข้าม */ }
  }

  // ── ดาวน์โหลด + ตา AI คัด (faceDetector ของระบบปก: faces + hasBigText) ──
  const list = [...candidates.values()].slice(0, 14);
  const downloads = await Promise.all(list.map(async (c, i) => {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(c.img, { headers: { 'User-Agent': UA, Referer: c.page || c.img }, signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 15_000 || buf.length > 5_000_000) return null; // เล็กจิ๋ว=ไอคอน / ใหญ่ยักษ์=เปลือง
      return { id: String(i), buffer: buf, meta: c };
    } catch { return null; }
  }));
  const valid = downloads.filter(Boolean);

  let scored = [];
  if (valid.length > 0) {
    try {
      const { batchDetectFaces } = await import('@/lib/services/faceDetector');
      const results = await batchDetectFaces(valid.map(v => ({ id: v.id, buffer: v.buffer })));
      scored = valid.map(v => {
        const d = results.get(v.id) || {};
        const hasFace = (d.faces || []).length > 0;
        const clean = hasFace && !d.hasBigText;
        // อันดับ: คนชัด+ไม่มีตัวหนังสือ > ฉาก/ของไม่มีตัวหนังสือ > คน+มีตัวหนังสือ (ครอปหลบได้) > ตัดทิ้ง
        const rank = clean ? 3 : (!hasFace && !d.hasBigText) ? 2 : hasFace ? 1 : 0;
        return { img: v.meta.img, page: v.meta.page, face: hasFace, clean, rank };
      }).filter(s => s.rank > 0);
      scored.sort((a, b) => b.rank - a.rank);
    } catch (e) {
      console.log('[ImageScout] vision คัดรูปล้ม — ใช้รูปดิบ:', e.message?.slice(0, 50));
      scored = valid.map(v => ({ img: v.meta.img, page: v.meta.page, face: null, clean: null, rank: 1 }));
    }
  }

  return {
    images: scored.slice(0, 12),
    originPosts,
    checked: valid.length,
  };
}

// ── เต็มวงจร ──────────────────────────────────────────────────
export async function scoutImages({ title, content }) {
  const t0 = Date.now();
  const analysis = await analyzeImageQueries({ title, content });
  const candidates = await searchAllChannels(analysis);
  const kept = await filterByRelevance(analysis, candidates);

  // ★ แผงรูปพร้อมใช้ — ดูดรูปจริง + ตามรอยต้นโพสต์ + ตา AI คัด (พังได้โดยไม่ล้มงานหลัก)
  const photoBoard = await buildPhotoBoard(kept, analysis).catch(e => {
    console.log('[ImageScout] photoBoard ล้ม (ไม่กระทบลิงก์):', e.message?.slice(0, 60));
    return null;
  });

  // จัดกลุ่มตามช่องทาง เรียงคะแนน สูงสุด 10 ลิงก์/ช่อง
  const channels = {};
  for (const c of kept.sort((a, b) => (b.score ?? 5) - (a.score ?? 5))) {
    if (!channels[c.channel]) channels[c.channel] = [];
    if (channels[c.channel].length < 10) {
      channels[c.channel].push({
        url: c.url, title: String(c.title).slice(0, 120), score: c.score,
        ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
      });
    }
  }
  const totalLinks = Object.values(channels).reduce((s, a) => s + a.length, 0);
  console.log(`[ImageScout] ✅ "${String(title).slice(0, 40)}" → ${totalLinks} ลิงก์ (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  return {
    ok: totalLinks > 0 || (photoBoard?.images?.length || 0) > 0,
    event: analysis.event,
    people: analysis.people || [],
    queries: analysis.queries.map(q => q.q),
    channels,
    totalLinks,
    photoBoard, // ★ { images: [{img, page, face, clean}], originPosts: [{name, url}] }
    at: new Date().toISOString(),
  };
}

/**
 * ============================================================
 * 🎯 Research Hunt (R1) — เครื่องยิงค้นข่าวหลายแพลตฟอร์ม (Research Engine เฟส 2.0 — 16 ก.ค. 69)
 * ============================================================
 * รับรายชื่อคลัสเตอร์จาก "คลังครู DNA" (dnaLibrary.js) → หาตัวแทนคลัสเตอร์ (ใบ reach สูงสุด) →
 * ดึงคำค้น (newsQueries+clipQueries) → ยิงค้นจริง 4 ช่อง (Serper videos / FB via Serper search /
 * TikTok via Serper search / YouTube Data API) → คืน candidates ดิบ normalize แล้ว + สถิติต้นทุน
 *
 * 🔴 pure JS + relative import ล้วน (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/ — ตามแพตเทิร์น deskV2 เดิม)
 * 🔴 ไฟล์นี้ "ไม่มี AI" เด็ดขาด — ห้าม import callAI/openai ใดๆ ทั้งสิ้น (ขั้นนี้คือดึงวัตถุดิบดิบเท่านั้น
 *    การตัดสิน/ให้คะแนน/สังเคราะห์เป็นหน้าที่ของ R2 ขั้นถัดไป)
 * 🔴 คัดลอกแนวคิด serperNews/serperSearch/serperVideos จาก src/lib/services/newsDesk/harvester.js
 *    มาเขียนใหม่ให้ self-contained ในนี้ (ตามคำสั่งงาน — ห้าม import จากไฟล์นั้นโดยตรง)
 * 🔴 กันฉีดคำสั่ง: ทุก field ข้อความที่มาจากผลค้น (title/snippet/query/archetype) ผ่าน sanitizeText เสมอ
 *    (เนื้อหาเว็บ = ข้อมูลดิบ ไม่ใช่คำสั่ง — สอดคล้องกติกา dnaContract.js)
 */

import { listExemplars, clusterSummary } from './dnaLibrary.js';
import { sanitizeText } from './dnaContract.js';

const CALL_TIMEOUT_MS = 15_000; // ทุก call ต้อง abort ที่ 15s ตามโจทย์
const KNOWN_CHANNELS = ['videos', 'facebook', 'tiktok', 'youtube', 'google'];
// ★ 16 ก.ค. 69 (ผู้ใช้สั่งเพิ่ม): 'google' = Serper /search เพียวไม่ใส่ site: filter → ลิงก์ข่าวจากสำนักต่างๆ
//   (today.line.me/ไทยรัฐ/ข่าวสด ฯลฯ) — แหล่ง "ข่าวเก่าน้ำดีทำใหม่ได้" ที่ระบบเดิมพิสูจน์แล้วว่าทีมใช้มากสุดรองจาก FB
//   และเป็น fetchability='full' (ดึงเนื้อเต็มได้) เหมาะกับท่อเขียนที่สุด
const CONCURRENCY = 4; // ยิงต่อ "คีย์" (call task = 1 ช่อง×1 คำค้น) พร้อมกันสูงสุด 4 — อย่ารัวกว่านี้
// ราคา Serper: ~$0.003/call (แพ็คเริ่มต้น) × อัตราแลกเปลี่ยนโดยประมาณ ~36.7 บาท/ดอลลาร์ ≈ 0.11 บาท/call
const SERPER_COST_THB_PER_CALL = 0.11;

// ── pool ขนาน: รัน worker บน items สูงสุด `limit` ตัวพร้อมกัน (ไม่รัวเกินกำหนด) ──
async function runPool(items, limit, worker) {
  let idx = 0;
  async function runner() {
    while (idx < items.length) {
      const current = idx++;
      await worker(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => runner());
  await Promise.all(workers);
}

// 🔴 บั๊กจริงที่เจอตอนเทส 16 ก.ค. 69: ตัด query string "ทั้งก้อน" ทำให้ YouTube URL
//    (https://www.youtube.com/watch?v=VIDEOID ต่างกัน 5 ตัว) ยุบเหลือคีย์เดียวกันหมด
//    ("…/watch") เพราะตัวบ่งชี้วิดีโอ "อยู่ใน" query string เอง (?v=) — เทสจริงจับได้ว่า
//    YouTube คืน videoId ไม่ซ้ำ 5/5 แต่โค้ดรายงาน dupCount=4 (เหลือ candidate จริงแค่ 1)
//    → แก้เป็น "ตัดเฉพาะ tracking params ที่รู้จัก" (utm_*/fbclid/gclid/...) เก็บพารามิเตอร์อื่น
//    ที่อาจเป็นตัวบ่งชี้ตัวตนไว้เสมอ (v=, story_fbid=, id= ฯลฯ) — ปลอดภัยกว่าและถูกต้องกว่า
const TRACKING_PARAM_RE = /^(utm_|fbclid$|gclid$|igshid$|si$|spm$|ref$|ref_src$|ref_url$|share_id$|is_copy_url$|is_from_webapp$|sender_device$|_rdr$|mibextid$)/i;
function normalizeUrlKey(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    const kept = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM_RE.test(k))
      .sort(([a], [b]) => a.localeCompare(b)); // เรียง key ให้เสถียร กัน query คนละลำดับถูกมองว่าไม่ซ้ำ
    const qs = new URLSearchParams(kept).toString();
    u.search = qs;
    return u.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    // parse ไม่ได้ (URL แปลกๆ) → fallback เดิม (ตัดทั้งก้อน) ปลอดภัยกว่าเก็บของพัง
    return raw.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hasKeyFor(channel) {
  if (channel === 'youtube') return !!process.env.YOUTUBE_API_KEY;
  return !!process.env.SERPER_API_KEY; // videos/facebook/tiktok ทั้งหมดยิงผ่าน Serper
}

// ── Serper /videos — คัดลอกแนวคิดจาก harvester.js serperVideos() ──
async function callSerperVideos(query, num, timeoutMs) {
  const key = process.env.SERPER_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://google.serper.dev/videos', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'th', hl: 'th', num }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Serper videos HTTP ${res.status}`);
    const data = await res.json();
    return (Array.isArray(data.videos) ? data.videos : []).map((v) => ({
      url: v.link || '',
      title: v.title || '',
      snippet: v.channel ? `ช่อง: ${v.channel}` : '',
      publishedHint: v.date || '',
    }));
  } finally {
    clearTimeout(timer);
  }
}

// ── Serper /search — คัดลอกแนวคิดจาก harvester.js serperSearch() — ใช้ยิง FB/TikTok ด้วย site: filter ──
async function callSerperSearch(query, num, timeoutMs) {
  const key = process.env.SERPER_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'th', hl: 'th', num }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Serper search HTTP ${res.status}`);
    const data = await res.json();
    return (Array.isArray(data.organic) ? data.organic : []).map((n) => ({
      url: n.link || '',
      title: n.title || '',
      snippet: n.snippet || '',
      publishedHint: n.date || '',
    }));
  } finally {
    clearTimeout(timer);
  }
}

// ── YouTube Data API v3 /search ──
async function callYoutube(query, maxResults, timeoutMs) {
  const key = process.env.YOUTUBE_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&maxResults=${Math.min(Math.max(1, Number(maxResults) || 10), 50)}&regionCode=TH&relevanceLanguage=th&type=video&key=${key}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`); // ⚠️ ห้าม log ตัว url นี้ (มี key ฝังอยู่)
    const data = await res.json();
    return (Array.isArray(data.items) ? data.items : []).map((it) => {
      const videoId = it?.id?.videoId || '';
      return {
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : '',
        title: it?.snippet?.title || '',
        snippet: it?.snippet?.channelTitle ? `ช่อง: ${it.snippet.channelTitle}` : '',
        publishedHint: it?.snippet?.publishedAt || '',
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

// ── dispatcher: 1 ช่อง → array ของผลดิบ {url,title,snippet,publishedHint} ──
async function fetchChannel(channel, query, num, timeoutMs) {
  if (channel === 'videos') return callSerperVideos(query, num, timeoutMs);
  if (channel === 'facebook') return callSerperSearch(`${query} site:facebook.com`, num, timeoutMs);
  if (channel === 'tiktok') return callSerperSearch(`${query} site:tiktok.com`, num, timeoutMs);
  if (channel === 'youtube') return callYoutube(query, num, timeoutMs);
  if (channel === 'google') return callSerperSearch(query, num, timeoutMs); // เพียว ไม่ site: → ลิงก์ข่าวสำนักต่างๆ
  return [];
}

/**
 * huntClusters — ยิงค้นจริงหลายแพลตฟอร์มจากตัวแทนคลัสเตอร์ในคลังครู DNA
 * @param {object} args
 * @param {string[]} [args.clusterIds] - ระบุคลัสเตอร์ตรงๆ; ว่าง → ใช้ clusterSummary() เอา top N ตาม count
 * @param {number} [args.topClusters=10] - จำนวนคลัสเตอร์สูงสุด (route validate ≤30, ที่นี่ clamp ซ้ำเพื่อความปลอดภัย)
 * @param {number} [args.queriesPerCluster=4] - คำค้นต่อคลัสเตอร์ (cap 6)
 * @param {string[]} [args.channels] - subset ของ ['videos','facebook','tiktok','youtube','google']
 * @param {number} [args.perQueryResults=10] - จำนวนผลต่อคำค้นต่อช่อง
 * @returns {Promise<{candidates:object[], stats:object}>}
 */
export async function huntClusters({
  clusterIds = [],
  topClusters = 10,
  queriesPerCluster = 4,
  channels = KNOWN_CHANNELS,
  perQueryResults = 10,
} = {}) {
  const t0 = Date.now();

  const safeTopClusters = Math.max(1, Math.min(30, Number(topClusters) || 10));
  const safeQueriesPerCluster = Math.max(1, Math.min(6, Number(queriesPerCluster) || 4));
  const safePerQueryResults = Math.max(1, Math.min(20, Number(perQueryResults) || 10));
  const safeChannelsIn = Array.from(new Set((Array.isArray(channels) ? channels : []).filter((c) => KNOWN_CHANNELS.includes(c))));
  const finalChannels = safeChannelsIn.length ? safeChannelsIn : KNOWN_CHANNELS.slice();

  // ── (1) ตัดสินใจว่าจะยิงคลัสเตอร์ไหนบ้าง ──
  let targetClusterIds;
  if (Array.isArray(clusterIds) && clusterIds.length > 0) {
    targetClusterIds = Array.from(new Set(clusterIds.filter((x) => typeof x === 'string' && x))).slice(0, safeTopClusters);
  } else {
    const summary = await clusterSummary(); // เรียง count มาก→น้อยอยู่แล้ว (dnaLibrary.js)
    targetClusterIds = summary.slice(0, safeTopClusters).map((c) => c.clusterId).filter(Boolean);
  }

  // ── (2) ต่อคลัสเตอร์: หาตัวแทน (reach สูงสุด) + รวมคำค้น unique + เก็บ permalink กันชนตัวเอง ──
  const callTasks = []; // { clusterId, clusterArchetype, query, channel }
  const exemplarPermalinkSets = new Map(); // clusterId → Set(normalized permalink) ของทุกใบในคลัสเตอร์
  let clustersWithQueries = 0;

  for (const clusterId of targetClusterIds) {
    let exemplars;
    try {
      exemplars = await listExemplars({ clusterId });
    } catch (e) {
      console.error(`[ResearchHunt] listExemplars(${clusterId}) ล้มเหลว: ${e.message}`);
      continue;
    }
    if (!Array.isArray(exemplars) || exemplars.length === 0) continue;

    const permSet = new Set();
    for (const ex of exemplars) {
      const k = normalizeUrlKey(ex.permalink);
      if (k) permSet.add(k);
    }
    exemplarPermalinkSets.set(clusterId, permSet);

    // ตัวแทน = ใบ reach สูงสุดในคลัสเตอร์
    const rep = exemplars.slice().sort((a, b) => (Number(b.reach) || 0) - (Number(a.reach) || 0))[0];
    const archetype = sanitizeText(rep?.dna?.archetype, 80);
    const newsQ = Array.isArray(rep?.dna?.newsQueries) ? rep.dna.newsQueries : [];
    const clipQ = Array.isArray(rep?.dna?.clipQueries) ? rep.dna.clipQueries : [];

    // รวม unique (case-insensitive) แล้วตัดตามเพดาน
    const seenQ = new Set();
    const combined = [];
    for (const q of [...newsQ, ...clipQ]) {
      const sq = sanitizeText(q, 70);
      const lower = sq.toLowerCase();
      if (sq && !seenQ.has(lower)) {
        seenQ.add(lower);
        combined.push(sq);
      }
    }
    const queries = combined.slice(0, safeQueriesPerCluster);
    if (queries.length === 0) continue;
    clustersWithQueries++;

    for (const query of queries) {
      for (const channel of finalChannels) {
        callTasks.push({ clusterId, clusterArchetype: archetype, query, channel });
      }
    }
  }

  const distinctQueries = new Set(callTasks.map((t) => `${t.clusterId}::${t.query}`)).size;

  // ── (3) ยิงจริง: pool ขนานสูงสุด 4 call task พร้อมกัน ──
  const candidates = [];
  const seenUrls = new Map(); // normalized url → true (เก็บตัวแรกไว้)
  const byChannel = { videos: 0, facebook: 0, tiktok: 0, youtube: 0, google: 0 };
  let serperCalls = 0;
  let youtubeCalls = 0;
  let dupCount = 0;
  let selfHits = 0;
  let skippedChannels = 0;
  let failedCalls = 0;

  await runPool(callTasks, CONCURRENCY, async (task) => {
    const { clusterId, clusterArchetype, query, channel } = task;

    if (!hasKeyFor(channel)) {
      skippedChannels++;
      return;
    }

    const provider = channel === 'youtube' ? 'youtube' : 'serper';
    let items;
    try {
      items = await fetchChannel(channel, query, safePerQueryResults, CALL_TIMEOUT_MS);
      if (provider === 'serper') serperCalls++; else youtubeCalls++;
    } catch (e) {
      // นับเป็นการยิงจริงแม้ล้มเหลว (คำขอถูกส่งออกไปแล้ว) — ช่องพัง ห้ามล้มรอบอื่น
      if (provider === 'serper') serperCalls++; else youtubeCalls++;
      failedCalls++;
      console.error(`[ResearchHunt] ${channel} query="${String(query).slice(0, 30)}" ล้มเหลว: ${e.message}`);
      return;
    }

    const permSet = exemplarPermalinkSets.get(clusterId) || new Set();
    items.forEach((raw, idx) => {
      const url = sanitizeText(raw.url, 500);
      if (!url) return;
      const dedupKey = normalizeUrlKey(url);
      if (!dedupKey) return;

      if (permSet.has(dedupKey)) {
        selfHits++;
        return;
      }
      if (seenUrls.has(dedupKey)) {
        dupCount++;
        return;
      }
      seenUrls.set(dedupKey, true);

      candidates.push({
        url,
        title: sanitizeText(raw.title, 300),
        snippet: sanitizeText(raw.snippet, 300),
        channel,
        sourceHost: hostOf(url),
        query: sanitizeText(query, 70),
        clusterId,
        clusterArchetype: sanitizeText(clusterArchetype, 80),
        publishedHint: sanitizeText(raw.publishedHint, 60),
        position: idx + 1,
      });
      if (byChannel[channel] != null) byChannel[channel]++;
    });
  });

  const estCostTHB = Math.round(serperCalls * SERPER_COST_THB_PER_CALL * 100) / 100;

  return {
    candidates,
    stats: {
      clusters: clustersWithQueries,
      queries: distinctQueries,
      serperCalls,
      youtubeCalls,
      byChannel,
      dupCount,
      selfHits,
      skippedChannels,
      failedCalls,
      estCostTHB,
      tookMs: Date.now() - t0,
    },
  };
}

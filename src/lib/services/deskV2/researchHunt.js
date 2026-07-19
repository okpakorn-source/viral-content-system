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
import { createStore } from '../../persistStore.js';
import { getDiscoveryConfig } from './researchDiscoveryConfig.js';
import { resolveCandidateChannel, platformGroupOf } from './researchChannelMap.js';
import { mergeCandidateEvidence, rankDiverseCandidates } from './researchDiversify.js';
import { planResearchQueries } from './researchQueryPlanner.js';
import { searchSource } from './researchSources.js';
import { fetchEntRss, fetchYouTubeChannels } from '../newsDesk/directFeeds.js';
import { getWatchlistSeed, selectWatchlistForRound } from './researchWatchlist.js';
import { planInterviewQueries, classifyInterviewCandidate } from './researchInterview.js';

const INTERVIEW_CHANNELS = ['youtube', 'tiktok', 'facebook', 'reels']; // เลนสัมภาษณ์ยิงบนคลาวด์ได้ (IG ต้องเครื่องทีม — ข้ามในนี้)

// ★ เฟส 1: re-export ให้ผู้เรียก import จาก researchHunt ได้ตามสัญญาแผน (ตัวจริงอยู่ researchChannelMap.js — pure เทสตรงได้)
export { resolveCandidateChannel, platformGroupOf } from './researchChannelMap.js';

const CALL_TIMEOUT_MS = 15_000; // ทุก call ต้อง abort ที่ 15s ตามโจทย์
const KNOWN_CHANNELS = ['videos', 'facebook', 'reels', 'tiktok', 'youtube', 'google'];
// ★ 17 ก.ค. 69 (ผู้ใช้สั่งเพิ่ม): 'reels' = เจาะคลิปสั้น Facebook Reels โดยเฉพาะ (site:facebook.com/reel) —
//   ช่อง 'facebook' เดิม (site:facebook.com เพียว) Google ดันโพสต์เพจ/กลุ่มเป็นหลัก แทบไม่โผล่ /reel/ เลย
//   แต่ข่าวปังจำนวนมากมาจาก reels (ไฮไลท์เด็ดเยอะ) — แยกช่องให้เห็นสถิติ/ปิดเปิดได้เอง
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
  if (channel === 'reels') return callSerperSearch(`${query} site:facebook.com/reel`, num, timeoutMs); // ★ 17 ก.ค.: เจาะ Reels ตรงๆ
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
  preset = null,      // ★ เฟส 3: bias กอง angle (จาก preset UI — เฟส 8)
  trendTerms = [],    // ★ เฟส 3: seed กอง trend เสริม
  runSeed = '',       // ★ เฟส 3: หมุนกองคำค้น deterministic (ข้ามรอบ)
  sources = null,     // ★ เฟส 4: allowlist ตัวกรองแหล่ง (null=ไม่กรอง ใช้ env ทั้งหมด); env flag ยังคุมชั้นหลัก
} = {}) {
  const t0 = Date.now();

  // ★ เฟส 1-3: อ่าน discovery config ครั้งเดียว. ปิดทุก flag = channel/สถิติ/ลำดับ/คำค้น candidate เดิมเป๊ะ
  const _discoveryCfg = getDiscoveryConfig();
  const reelsOn = _discoveryCfg.flags.reels;             // เฟส 1: ระบุแพลตฟอร์มจริงจาก URL
  const diversityOn = _discoveryCfg.flags.diversity;     // เฟส 2: รวม URL ซ้ำ (เก็บหลักฐาน) + จัดอันดับกระจาย
  const plannerOn = _discoveryCfg.flags.queryPlanner;    // เฟส 3: วางแผนคำค้น 4 กอง (แทนคำค้น rep ใบเดียว)
  const sourceExpansionOn = _discoveryCfg.flags.sourceExpansion; // เฟส 4: เพิ่มแหล่งข่าวใหม่ (RSS/News/YT-watch)
  const interviewLaneOn = _discoveryCfg.flags.interviewLane; // เฟส 6: เลนสัมภาษณ์คนดัง (task แยกจาก DNA)
  let interviewWatchlistIds = []; // เฟส 6: id คนดังที่ค้นรอบนี้ (ให้ trace เก็บ → เลือกคนค้นน้อยสุดรอบหน้า)

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

  // ★ เฟส 3 (ON): staff hints = searchKeys จากคลัง user-topic-hunts (read-only, best-effort — พังไม่ล้มรอบ)
  let staffHints = [];
  if (plannerOn) {
    try {
      const rows = await createStore('user-topic-hunts').getAll();
      const keys = [];
      for (const r of Array.isArray(rows) ? rows : []) {
        if (r && Array.isArray(r.searchKeys)) keys.push(...r.searchKeys);
      }
      staffHints = keys.slice(0, 200);
    } catch {
      staffHints = []; // อ่านคลังไม่ได้ → ไม่มี hint (planner ยังทำงานจาก DNA/THEME/trend เดิม)
    }
  }

  // ── (2) ต่อคลัสเตอร์: หาตัวแทน (reach สูงสุด) + รวมคำค้น unique + เก็บ permalink กันชนตัวเอง ──
  const callTasks = []; // { clusterId, clusterArchetype, query, channel, [queryId, queryBucket, lane] }
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

    // ตัวแทน = ใบ reach สูงสุดในคลัสเตอร์ (ใช้ archetype ทั้ง 2 เส้นทาง)
    const rep = exemplars.slice().sort((a, b) => (Number(b.reach) || 0) - (Number(a.reach) || 0))[0];
    const archetype = sanitizeText(rep?.dna?.archetype, 80);

    if (plannerOn) {
      // 🆕 เฟส 3: วางแผนคำค้น 4 กอง (DNA/มุมเรื่อง/คน-รายการ/กระแส) แทนคำค้นจาก rep ใบเดียว
      const plan = planResearchQueries({
        exemplars,
        clusterId,
        clusterArchetype: archetype,
        total: safeQueriesPerCluster,
        runSeed: runSeed || clusterId, // deterministic ต่อคลัสเตอร์
        preset,
        trendTerms,
        staffHints,
      });
      if (plan.length === 0) continue;
      clustersWithQueries++;
      for (const qp of plan) {
        for (const channel of finalChannels) {
          callTasks.push({ clusterId, clusterArchetype: archetype, query: qp.text, channel, queryId: qp.id, queryBucket: qp.bucket, lane: qp.lane });
        }
      }
    } else {
      // ── path เดิม (planner ปิด): reach-max exemplar + รวม newsQueries+clipQueries unique แล้วตัด N ──
      const newsQ = Array.isArray(rep?.dna?.newsQueries) ? rep.dna.newsQueries : [];
      const clipQ = Array.isArray(rep?.dna?.clipQueries) ? rep.dna.clipQueries : [];
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
  }

  // ── (2.5) เฟส 6 (ON): เลนสัมภาษณ์คนดัง — สร้าง task แยกจาก DNA (clusterId='interview', lane='interview') ──
  if (interviewLaneOn) {
    try {
      const iv = _discoveryCfg.interview; // {peoplePerRound, variantsPerPerson, maxCalls}
      const seed = getWatchlistSeed();
      const people = selectWatchlistForRound({
        entries: seed.filter((e) => e.kind === 'person'),
        recentRunIds: [], // (เฟส 6.2: ยังไม่ดึงประวัติจาก trace — เลือกตาม index; ต่อยอดได้)
        limit: iv.peoplePerRound,
      });
      const programs = seed.filter((e) => e.kind === 'program');
      interviewWatchlistIds = people.map((p) => p.id).filter(Boolean);
      const plan = planInterviewQueries({
        people,
        programs,
        channels: INTERVIEW_CHANNELS,
        variantsPerPerson: iv.variantsPerPerson,
        maxCalls: iv.maxCalls,
        runSeed: runSeed || 'interview',
      });
      for (const qp of plan) {
        callTasks.push({
          clusterId: 'interview',
          clusterArchetype: 'สัมภาษณ์คนดัง',
          query: qp.text,
          channel: qp.targetChannel,
          lane: 'interview',
          queryId: qp.id,
          expectedName: qp.expectedName,
          program: qp.program || '',
          opener: qp.opener || '',
          angle: qp.angle || '',
        });
      }
    } catch (e) {
      console.error(`[ResearchHunt] interview lane ล้มเหลว: ${e?.message}`); // เลนสัมภาษณ์พังห้ามล้มการล่า DNA
    }
  }

  const distinctQueries = new Set(callTasks.map((t) => `${t.clusterId}::${t.query}`)).size;

  // ── (3) ยิงจริง: pool ขนานสูงสุด 4 call task พร้อมกัน ──
  const candidates = [];
  const allHits = []; // ★ เฟส 2 (ON): เก็บทุก hit (รวม URL ซ้ำ) ไว้ merge+rank หลัง pool
  const seenUrls = new Map(); // normalized url → true (เก็บตัวแรกไว้)
  const byChannel = { videos: 0, facebook: 0, reels: 0, tiktok: 0, youtube: 0, google: 0 };
  const byDiscoveryChannel = { videos: 0, facebook: 0, reels: 0, tiktok: 0, youtube: 0, google: 0 }; // ★ เฟส 1 (ON): ช่องที่ยิงค้น
  let reclassifiedCount = 0; // ★ เฟส 1 (ON): candidate ที่แพลตฟอร์มจริง ≠ ช่องที่ยิงค้น
  let serperCalls = 0;
  let youtubeCalls = 0;
  let dupCount = 0;
  let selfHits = 0;
  let skippedChannels = 0;
  let failedCalls = 0;

  await runPool(callTasks, CONCURRENCY, async (task) => {
    const { clusterId, clusterArchetype, query, channel, queryId, queryBucket, lane, expectedName, program, opener, angle } = task;

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

      // ประกอบ candidate พื้นฐาน (+ เฟส 1 resolve ถ้า reelsOn) — ยังไม่แตะสถิติ
      const cand = {
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
      };
      let effChannel = channel;
      if (reelsOn) {
        effChannel = resolveCandidateChannel(url, channel);
        cand.channel = effChannel;
        cand.discoveredVia = channel;
        cand.platformGroup = platformGroupOf(effChannel);
      }
      // 🆕 เฟส 3 (ON): พก bucket/lane/queryId จากแผนคำค้น (additive — planner ปิด = ไม่มี field นี้)
      if (queryBucket) {
        cand.queryId = queryId;
        cand.queryBucket = queryBucket;
        cand.lane = lane;
      }
      // 🆕 เฟส 6 (ON): candidate เลนสัมภาษณ์ → จำแนกชื่อ (confirmObservedName ห้ามเดา) + พก interview
      if (lane === 'interview') {
        cand.lane = 'interview';
        cand.queryId = queryId;
        const classified = classifyInterviewCandidate(cand, { expectedName, program, opener, angle, queryId });
        cand.interview = classified.interview;
      }

      if (diversityOn) {
        // 🆕 เฟส 2: ไม่ทิ้ง URL ซ้ำระหว่างเก็บ — เก็บทุก hit ไว้ merge + จัดอันดับหลัง pool
        cand._urlKey = dedupKey;
        if (!cand.platformGroup) cand.platformGroup = platformGroupOf(resolveCandidateChannel(url, channel));
        allHits.push(cand);
        return;
      }

      // ── path เดิม (diversity ปิด): dedup ระหว่างเก็บ + นับสถิติแบบเดิม ──
      if (seenUrls.has(dedupKey)) {
        dupCount++;
        return;
      }
      seenUrls.set(dedupKey, true);
      if (reelsOn) {
        if (effChannel !== channel) reclassifiedCount++;
        byChannel[effChannel] = (byChannel[effChannel] || 0) + 1; // นับแพลตฟอร์มจริง (อาจมีคีย์ใหม่ เช่น instagram)
        byDiscoveryChannel[channel] = (byDiscoveryChannel[channel] || 0) + 1;
      } else if (byChannel[channel] != null) {
        byChannel[channel]++; // ── ปิด flag: พฤติกรรมเดิมเป๊ะ ──
      }
      candidates.push(cand);
    });
  });

  // ── (3.5) เฟส 2 (ON): รวม URL ซ้ำ (เก็บหลักฐาน) → จัดอันดับกระจายต่อคลัสเตอร์ (diversityRank) ──
  if (diversityOn) {
    const merged = mergeCandidateEvidence(allHits, { urlKeyFn: (c) => c._urlKey || normalizeUrlKey(c.url) });
    dupCount = allHits.length - merged.length; // จำนวน hit ที่ยุบรวม (ยืนยันหลายทาง)
    const pp = _discoveryCfg.targets.platformPct || {};
    const weights = { meta: pp.meta || 45, tiktok: pp.tiktok || 29, youtube: pp.youtube || 26, web: 12, other: 4 };
    const byClusterMerged = new Map();
    for (const c of merged) {
      const k = c.clusterId || '';
      if (!byClusterMerged.has(k)) byClusterMerged.set(k, []);
      byClusterMerged.get(k).push(c);
    }
    for (const arr of byClusterMerged.values()) {
      for (const c of rankDiverseCandidates(arr, { weights })) {
        delete c._urlKey; // ไม่ส่ง field ภายในออก
        candidates.push(c);
        byChannel[c.channel] = (byChannel[c.channel] || 0) + 1;
        if (reelsOn) {
          if (c.discoveredVia) byDiscoveryChannel[c.discoveredVia] = (byDiscoveryChannel[c.discoveredVia] || 0) + 1;
          if (c.discoveredVia && c.channel !== c.discoveredVia) reclassifiedCount++;
        }
      }
    }
  }

  // ── (3.6) เฟส 4 (ON): ยิงแหล่งข่าวใหม่แยก (RSS/News/YT-watch/IG) → sourceCandidates + สถิติ ──
  //   🔴 ปิด DESK_V2_SOURCE_EXPANSION = ไม่ยิงแหล่งใหม่เลย (จำนวน call + return เท่าระบบเดิมเป๊ะ)
  //   แหล่งใหม่ไม่มี clusterId/exemplar → เก็บแยกเป็น sourceCandidates (ยังไม่ยัดผ่าน judge ต่อคลัสเตอร์ — รอเลน judge เฟส 6)
  let sourceCandidates = [];
  const bySource = {};
  let sourceFailures = 0;
  if (sourceExpansionOn) {
    const srcNow = new Date();
    const srcQueries = Array.from(new Set(callTasks.map((t) => t.query).filter(Boolean))).slice(0, 5); // คุมงบ serper-news
    const en = _discoveryCfg.sources; // {serperNews, googleNewsRss, directRss, youtubeWatch, instagram} (เปิดครบ 3 ชั้นแล้ว)
    const fd = _discoveryCfg.freshnessDays;
    const deps = { fetchEntRss, fetchYouTubeChannels };
    const allow = (name) => !Array.isArray(sources) || sources.includes(name); // เฟส 4: ตัวกรอง allowlist จาก request (ถ้ามี)
    const jobs = [];
    if (en.serperNews && allow('serper-news')) jobs.push(searchSource({ source: 'serper-news', queries: srcQueries, maxResults: safePerQueryResults, maxAgeDays: fd.serperNews, now: srcNow, fetchImpl: fetch }));
    if (en.googleNewsRss && allow('google-news-rss')) jobs.push(searchSource({ source: 'google-news-rss', queries: srcQueries, maxResults: safePerQueryResults, maxAgeDays: fd.googleNewsRss, now: srcNow, fetchImpl: fetch }));
    if (en.directRss && allow('direct-rss')) jobs.push(searchSource({ source: 'direct-rss', maxAgeDays: fd.directRss, now: srcNow, deps }));
    if (en.youtubeWatch && allow('youtube-watch')) jobs.push(searchSource({ source: 'youtube-watch', maxAgeDays: fd.youtubeWatch, now: srcNow, deps }));
    if (en.instagram && allow('instagram')) jobs.push(searchSource({ source: 'instagram', now: srcNow }));

    const settled = await Promise.all(jobs.map((p) => p.catch((e) => ({ items: [], failed: true, sourceType: 'unknown', calls: 0, error: String(e?.message || e) }))));
    for (const r of settled) {
      if (!r) continue;
      if (r.failed) sourceFailures++;
      const st = r.sourceType || 'unknown';
      bySource[st] = (bySource[st] || 0) + (Array.isArray(r.items) ? r.items.length : 0);
      if (Array.isArray(r.items)) sourceCandidates.push(...r.items);
      if (st === 'serper-news') serperCalls += Number(r.calls) || 0; // serper-news = จ่ายเงิน → รวมต้นทุน
    }
  }

  const estCostTHB = Math.round(serperCalls * SERPER_COST_THB_PER_CALL * 100) / 100;

  return {
    candidates,
    ...(sourceExpansionOn ? { sourceCandidates } : {}),
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
      // ★ เฟส 1 (ON เท่านั้น): สถิติแยกช่องยิงค้น vs แพลตฟอร์มจริง — ปิด flag = ไม่มี field นี้ (snapshot เดิมเป๊ะ)
      ...(reelsOn ? { byDiscoveryChannel, reclassifiedCount } : {}),
      // ★ เฟส 2 (ON เท่านั้น): ทำ merge+rank แล้ว (dupCount = hit ที่ยุบรวม)
      ...(diversityOn ? { diversityApplied: true } : {}),
      // ★ เฟส 3 (ON เท่านั้น): ใช้ query planner 4 กอง + จำนวน staff hints ที่ป้อน
      ...(plannerOn ? { queryPlannerApplied: true, staffHintCount: staffHints.length } : {}),
      // ★ เฟส 4 (ON เท่านั้น): ผลจากแหล่งข่าวใหม่ (RSS/News/YT-watch) แยกต่างหาก + แหล่งที่ล้ม
      ...(sourceExpansionOn ? { bySource, sourceFailures, sourceCandidateCount: sourceCandidates.length } : {}),
      // ★ เฟส 6 (ON เท่านั้น): เลนสัมภาษณ์ + id คนดังที่ค้นรอบนี้ (trace เก็บไปเลือกคนค้นน้อยสุดรอบหน้า)
      ...(interviewLaneOn ? { interviewLaneApplied: true, interviewWatchlistIds } : {}),
    },
  };
}

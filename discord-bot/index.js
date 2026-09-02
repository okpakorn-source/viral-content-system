require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { makeQueueTerminalError, isQueueTerminalError, selectQualityWarnings } = require('./queue-errors');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// ดึงค่า config จาก .env
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_URL = process.env.API_URL || 'http://localhost:3000/api/auto/process';
const API_KEY = process.env.API_KEY || '';
// ★ 25 มิ.ย.: รหัสประจำตัว instance นี้ (hostname+สุ่ม) — ใช้สืบว่ามีบอทกี่ตัวยิงเข้าคิว (double-event vs 2 instance)
const BOT_INSTANCE = require('os').hostname() + '_' + Math.random().toString(36).slice(2, 7);
// ★ 26 มิ.ย.: ธงปิดตัวนุ่มนวล — ตอน Railway redeploy ส่ง SIGTERM ให้ตัวเก่า → หยุดรับข้อความทันที
//   + ตัดการเชื่อมต่อ Discord เพื่อไม่ให้ตัวเก่า+ตัวใหม่ฟัง event ทับกัน (ต้นเหตุเห็น 2 ตอบช่วง deploy)
let shuttingDown = false;

// ★ 2 ก.ย. 69 (เคสหลวงปู่ศิลา 03:49Z): บอทจำงานที่กำลังตามอยู่ไว้ที่เซิร์ฟเวอร์ (/api/bot/tracking)
//   → Railway redeploy/รีสตาร์ต แล้วบอทตัวใหม่ตามงานต่อเอง ไม่ค้าง "1%" ตลอดไป (ดู trackingUpsert / resumeTrackedJobs)
//   ปิดคืน: ตั้ง env BOT_RESUME_TRACKING=0 (รับเฉพาะ '0'/'1' ตรงตัว · ค่าเริ่มต้น=เปิด) → บอททำงานเหมือนเดิมทุกไบต์
function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw === '1') return true;
  if (raw === '0') return false;
  return fallback;
}
const BOT_RESUME_TRACKING = envFlag('BOT_RESUME_TRACKING', true);
const RESUME_MAX_AGE_MS = 30 * 60 * 1000; // งานที่เริ่มเก่ากว่านี้ไม่ตามต่อ — แจ้งให้ไปดูหน้าตรวจงานแทน
const RESUME_STALE_TEXT = '⏱️ งานนี้ค้างตอนระบบรีสตาร์ต ดูผลได้ในหน้าตรวจงาน';

// ═══════════════════════════════════════════
// 🔧 QUEUE SYSTEM — ป้องกัน concurrent overload
// ═══════════════════════════════════════════
const MAX_CONCURRENT = 1; // ประมวลผลทีละ 1 (ป้องกัน API rate limit)
let activeCount = 0;
const queue = []; // { message, content, processingMsg, addedAt }

// ─── Progress bar helper ─────────────────────────────────────────
function buildProgressBar(elapsedSec, totalSec = 320, barLen = 14) {
  const pct = Math.min(elapsedSec / totalSec, 1);
  const filled = Math.round(pct * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  const pctStr = Math.round(pct * 100);
  return `\`[${bar}] ${pctStr}%\``;
}

function getQueueStatus() {
  if (activeCount === 0 && queue.length === 0) return '🟢 ว่าง';
  if (activeCount > 0 && queue.length === 0) return `🟡 กำลังทำงาน (${activeCount})`;
  return `🔴 กำลังทำงาน (${activeCount}) | รอคิว: ${queue.length}`;
}

// ★ 27 มิ.ย.: ลบ processQueue/getQueuePosition (คิวภายในบอท) ทิ้ง — ย้ายไปใช้ "คิวเซิร์ฟเวอร์"
//   (/api/queue/add serialize + atomic claim) แทน · ตัวแปร queue[]/MAX_CONCURRENT เหลือไว้แค่ !status แสดงผล

// ═══════════════════════════════════════════
// 🔧 Duplicate Detection — ป้องกันข่าวเดียวกันซ้ำ
// ═══════════════════════════════════════════
const recentUrls = new Map(); // url → timestamp
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 นาที

function isDuplicate(content) {
  const urlMatch = content.match(/https?:\/\/\S+/);
  if (!urlMatch) return false;

  const url = urlMatch[0].split('?')[0]; // ตัด query params
  const now = Date.now();

  // ลบ entries เก่า
  for (const [key, ts] of recentUrls) {
    if (now - ts > DEDUP_WINDOW_MS) recentUrls.delete(key);
  }

  if (recentUrls.has(url)) {
    return true;
  }
  recentUrls.set(url, now);
  return false;
}

// ═══════════════════════════════════════════

// ★ 27 มิ.ย.: marker เวอร์ชันโค้ด — ใช้ยืนยันใน Railway logs ว่า container ที่รันอยู่เป็น "โค้ดใหม่"
//   โค้ดใหม่ = single-message (atomic claim ก่อน ack) · ถ้า logs ไม่ขึ้นบรรทัดนี้ = ยังรัน container เก่า
const BOT_BUILD = '2026-09-02-resume-tracking'; // ★ 2 ก.ย. 69: เดิม '2026-06-27-singlemsg-atomicclaim' — ขยับให้เห็นใน log ว่ารุ่นจำงานข้ามรีสตาร์ตขึ้นแล้ว
client.once('ready', () => {
  console.log(`✅ บอทพร้อมทำงานแล้ว! ล็อกอินในชื่อ ${client.user.tag}`);
  console.log(`🟢 [BOT_BUILD=${BOT_BUILD}] instance=${BOT_INSTANCE} | คิว: เซิร์ฟเวอร์ (atomic claim) | Dedup URL: ${DEDUP_WINDOW_MS / 1000}s | resume=${BOT_RESUME_TRACKING ? 'on' : 'off'}`);
  // ★ 2 ก.ย. 69: กู้งานที่ค้างจากก่อนรีสตาร์ต (ล้มเงียบ — ห้ามทำให้บอทล้มตอนตื่น) · คืน promise ให้เทสรอได้ (discord.js ไม่สนค่าที่คืน)
  return resumeTrackedJobs().catch((err) => {
    console.warn(`[Bot] 🩹 กู้งานค้างไม่สำเร็จ: ${String(err?.message || err).slice(0, 80)}`);
  });
});

client.on('messageCreate', async (message) => {
  // ไม่ตอบโต้บอทด้วยกันเอง
  if (message.author.bot) return;

  // ★ 26 มิ.ย.: กำลังปิดตัว (ถูก redeploy) → ไม่รับงานใหม่ ปล่อยให้ตัวใหม่จัดการ (กันตอบซ้ำช่วง deploy)
  if (shuttingDown) { console.log('[Bot] 🛑 กำลังปิดตัว — ข้ามข้อความใหม่ ให้ instance ใหม่ทำ'); return; }

  // ★ 25 มิ.ย.: กันประมวลผล "ข้อความเดียวกันซ้ำ" — Discord อาจส่ง messageCreate ซ้ำ (gateway resume)
  //   หรือบอทรับ event ซ้ำ → ดักด้วย message.id ที่เคยเห็นแล้ว = ข้าม (ต้นเหตุจริงของการเห็น 2 ข้อความ)
  if (!global.__seenMsgIds) global.__seenMsgIds = new Set();
  if (global.__seenMsgIds.has(message.id)) {
    console.log(`[Bot] ⏭️ ข้ามข้อความซ้ำ (message.id ${message.id} เคยรับแล้ว) — กันรายงาน/เจนซ้ำ`);
    return;
  }
  global.__seenMsgIds.add(message.id);
  if (global.__seenMsgIds.size > 500) global.__seenMsgIds = new Set([...global.__seenMsgIds].slice(-200));

  const content = message.content.trim();

  // ตรวจสอบว่ามีลิงก์หรือยาวพอที่จะเป็นเนื้อหาข่าวหรือไม่
  const hasUrl = /https?:\/\//.test(content);
  const textOnly = content.replace(/https?:\/\/\S+/g, '').trim();

  // ข้อความมาตรฐานที่ผู้ใช้ต้องการ
  const standardReply = 
    "สวัสดีครับ ผมเป็น 'ผู้ช่วยรวมไอจีดารา'\n" +
    "เป้าหมายหลักของผมคือการสร้างข่าวไวรัล ช่วยคุณครับ\n\n" +
    "รบกวนส่งข้อมูลที่จะให้ผมทำข่าวมาตามรูปแบบนี้นะครับ:\n" +
    "- ลิงก์ข่าว / เว็บไซต์\n" +
    "- ลิงก์ YouTube / TikTok / Facebook(ยังใช้งานไม่ได้)\n" +
    "- พิมพ์ข้อความข่าวแบบเต็มๆ (ขอความยาวสักหน่อยนะครับ)\n\n" +
    "หลังจากผมส่งให้คุณจะได้รับข่าว 5 เวอร์ชั่น 5 แบบให้เลือกแบบที่ดีที่สุดไปใช้งานได้เลย";

  // 1. ตรวจสอบคำทักทาย หรือ คำสั่งเรียกดูวิธีใช้
  const greetings = ['สวัสดี', 'ดีครับ', 'ดีค่ะ', 'hello', 'hi', 'รบกวนหน่อย', 'ช่วยทำให้หน่อย', '!help'];
  if (greetings.some(word => content.toLowerCase() === word)) {
    return message.reply(standardReply);
  }

  // 1.3 Handle !status command — ดูสถานะคิว
  if (content === '!status' || content === '!สถานะ') {
    return message.reply(`📊 **สถานะระบบ:**\n${getQueueStatus()}\nกำลังทำงาน: ${activeCount} | รอคิว: ${queue.length}`);
  }

  // 1.4 🛑 6 ส.ค. 69 (เจ้าของสั่ง): ระบบโต๊ะข่าวถูกลบทั้งชุด — คำสั่ง !โต๊ะ ไม่มีปลายทางแล้ว
  //     คงตัวรับไว้เพื่อ "ตอบให้รู้เรื่อง" แทนการยิงไป 404 แล้วเด้ง error ดิบใส่หน้าทีม
  if (content.startsWith('!โต๊ะ') || content.toLowerCase().startsWith('!desk')) {
    return message.reply('🛑 โต๊ะข่าวถูกยุบถาวรแล้ว — ส่งลิงก์หรือข้อความข่าวเข้ามาในห้องนี้ได้เลย ระบบจะเขียนให้เหมือนเดิม');
  }

  // 1.5 (ถอด 18 ก.ค. 69 — คำสั่งเจ้าของ: "!ปัง ไม่มีคนใช้ เอาออกเลย") — คำสั่ง !ปัง feedback ถูกลบทั้งชุด

  // 2. ถ้าไม่ใช่ข้อมูลที่จะเอาไปทำข่าว (ไม่มีลิงก์ และสั้นเกินไป)
  if (!hasUrl && textOnly.length <= 50) {
    return message.reply(standardReply);
  }

  // 3. เงื่อนไขในการเริ่มประมวลผล: มีลิงก์ หรือ ข้อความยาวกว่า 50 ตัวอักษร
  if (hasUrl || textOnly.length > 50) {

    // === DUPLICATE CHECK ===
    if (isDuplicate(content)) {
      return message.reply('⚠️ URL นี้เพิ่งถูกประมวลผลไปแล้ว (ภายใน 5 นาที) — รอสักครู่แล้วลองใหม่ หรือส่ง URL อื่นได้เลยครับ');
    }

    // ส่ง reaction แจ้งว่ารับทราบ
    try {
      await message.react('⏳');
    } catch (e) {
      console.log('Cannot react:', e.message);
    }

    // === ยิงเข้า "คิวเซิร์ฟเวอร์" ทันที (★ 27 มิ.ย. ผู้ใช้สั่ง — บล็อกถาวรเหลือ 1 การประมวลผล/1 ข้อความ) ===
    //   ปัญหาเดิม (เห็น 2 ข้อความค้าง): ถ้า instance นี้ไม่ว่าง → โพสต์ ack "คิวลำดับที่ 1" + เก็บ "คิวภายในบอท"
    //     "ก่อน" ผ่าน atomic dedup (dedup อยู่ใน /api/queue/add ที่เรียกทีหลัง) → บอท 2 instance ต่างมีคิวของตัวเอง
    //     ต่างโพสต์ ack คนละแบบ → ค้าง 2 อันยาวๆ
    //   แก้: เลิก "คิวภายในบอท" — ทุกข้อความเข้า /api/queue/add (atomic claim) "ก่อนโพสต์ ack ใดๆ"
    //     เซิร์ฟเวอร์ serialize งานทีละ 1 + คืนตำแหน่งคิวเอง · instance ที่ "แพ้เคลม" = เงียบสนิท (ดู processNewsJob)
    //   → ต่อให้รันกี่ instance ก็ตอบแค่ตัวเดียวต่อข้อความ (เคลม Postgres PK มีผู้ชนะคนเดียวเสมอ)
    const job = { message, content, processingMsg: null, addedAt: Date.now() };
    activeCount++;
    try {
      await processNewsJob(job);
    } catch (err) {
      console.error('[Direct] Job failed:', err.message);
    } finally {
      activeCount--;
    }
  }
});

// ★ 2 ก.ย. 69: แยก header + URL คิวออกเป็นฟังก์ชัน (เส้นทางกู้หลังรีสตาร์ตต้องใช้ชุดเดียวกัน) — ตรรกะเดิมทุกบรรทัด
function buildApiHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return headers;
}

function buildQueueUrl() {
  let queueUrl = API_URL;
  if (queueUrl.endsWith('/api/auto/process')) {
    queueUrl = queueUrl.replace('/api/auto/process', '/api/queue/add');
  } else if (queueUrl.endsWith('/api/auto/stream')) {
    queueUrl = queueUrl.replace('/api/auto/stream', '/api/queue/add');
  } else {
    queueUrl = queueUrl.replace(/\/api\/.*$/, '/api/queue/add');
  }
  return queueUrl;
}

// ═══════════════════════════════════════════
// 📰 Process News Job — ฟังก์ชันประมวลผลข่าวจริง
// ═══════════════════════════════════════════
async function processNewsJob(job) {
  const { message, content } = job;
  // ★ 27 มิ.ย.: เริ่มเป็น null — โพสต์ ack "หลังชนะเคลม atomic" เท่านั้น (instance ที่แพ้ไม่เคยโพสต์อะไร)
  let processingMsg = job.processingMsg || null;
  const jobStartTime = Date.now();
  // ★ 2 ก.ย. 69: jobId ที่จดลงสมุด tracking แล้ว (จบ/ล้มต้องถอนออก) · handedOff = งานถูก instance อื่นรับช่วง (ห้ามถอนสมุดของเขา)
  let trackedJobId = null;
  let handedOff = false;

  try {
    // เตรียมข้อมูลยิง API
    const payload = {
      input: content,
      images: [],
      contentLength: 'short',
      userId: `discord-${message.author.id}`,
      _botInstance: BOT_INSTANCE,   // ★ ใครยิงเข้าคิว (สืบจำนวนบอท)
      _msgId: message.id,           // ★ ข้อความ Discord ไหน (สืบ double-event)
    };

    const headers = buildApiHeaders();

    // === Submit via Server Queue ===
    const queueUrl = buildQueueUrl(); // ★ 2 ก.ย. 69: ย้ายตรรกะเดิมไป buildQueueUrl() ด้านบน — ผลเท่าเดิมทุกกรณี

    // 1. Add to server queue
    // ★ 15 ส.ค. 69 (เจ้าของสั่งแก้ timeout ดิสคอร์ด): เดิม timeout 15000 — ช่วงคิวแน่น /api/queue/add ตอบช้ากว่า 15 วิ
    //   บอทตัดเองทั้งที่ข่าวกำลังจะเข้าคิว = ทีมเห็น "timeout of 15000ms exceeded" หลายข่าว (เห็นจริง 15 ส.ค. ~14:28)
    //   แก้: ขยายเป็น 60 วิ + ลองซ้ำ 1 ครั้ง (เว้น 3 วิ) เฉพาะตอน timeout/สายพัง — ฝั่งเซิร์ฟเวอร์มีกันงานซ้ำ (dedup) อยู่แล้ว ยิงซ้ำไม่ทำให้เจนเบิ้ล
    //   ของเดิม: const addRes = await axios.post(queueUrl, payload, { headers, timeout: 15000 });
    let addRes;
    try {
      addRes = await axios.post(queueUrl, payload, { headers, timeout: 60000 });
    } catch (enqErr) {
      const retriable = /timeout|ECONNRESET|ETIMEDOUT|ECONNABORTED|socket hang up/i.test(String(enqErr.message || ''));
      if (!retriable) throw enqErr;
      console.log(`[Bot] ⚠️ ส่งเข้าคิวล้ม (${String(enqErr.message).slice(0, 60)}) — ลองซ้ำอีกครั้งใน 3 วิ`);
      await new Promise((r) => setTimeout(r, 3000));
      addRes = await axios.post(queueUrl, payload, { headers, timeout: 60000 });
    }
    const addData = addRes.data;

    if (!addData.success) {
      // Duplicate or error
      throw new Error(addData.error || 'Failed to add to queue');
    }

    // ★ 25–27 มิ.ย.: คิวบอกว่าเป็น "งานซ้ำ" (อีก instance ยิงเข้าคิว = ข้อความ Discord เดียวกันก่อนแล้ว)
    //   → instance นี้ "แพ้เคลม" = เงียบสนิท: ยังไม่เคยโพสต์ ack เลย (ยกไปโพสต์หลังชนะเคลม) → ไม่มีอะไรต้องลบ
    //   ดีกว่าเดิม (เดิมโพสต์ ack ก่อนแล้วค่อยลบ = เห็นแว้บ 2 อัน) · ตอนนี้ "ตัวซ้ำไม่โผล่ตั้งแต่แรก"
    if (addData.duplicate) {
      console.log(`[Bot] ⏭️ งานซ้ำ jobId=${String(addData.jobId).slice(0, 8)} — instance นี้แพ้เคลม เงียบสนิท (ไม่โพสต์ ack)`);
      if (processingMsg) await processingMsg.delete().catch(() => {}); // เผื่อกรณีมี ack ค้างจากเส้นทางเก่า
      return;
    }

    const jobId = addData.jobId;
    const initialPosition = addData.position;
    const queuesAhead = addData.queuesAhead || 0;

    // ★ ชนะเคลม → "เพิ่งโพสต์ ack ครั้งแรกตรงนี้" (มีแค่ instance เดียวที่มาถึงจุดนี้ต่อ 1 ข้อความ)
    const ackText = queuesAhead > 0
      ? `📋 รับทราบครับ! คิวลำดับที่ **${initialPosition}** — มี ${queuesAhead} คิวก่อนหน้า\nประมาณ ${queuesAhead * 3} นาที ⏳`
      : `รับทราบครับ! กำลังอ่านข้อมูลและปั้นบทความไวรัล รอสักครู่นะครับ ⚡...`;
    if (processingMsg) await processingMsg.edit(ackText).catch(() => {});
    else processingMsg = await message.reply(ackText);

    // ★ 2 ก.ย. 69: ได้ jobId + ข้อความ ack แล้ว → จดลงสมุดที่เซิร์ฟเวอร์ (ล้มเงียบ ห้ามทำงานหลักพัง)
    //   บอทตัวใหม่หลัง redeploy จะอ่านสมุดนี้แล้วตามงานต่อ (ดู resumeTrackedJobs) · ปิดสวิตช์ = ไม่ยิงอะไรเลย
    trackedJobId = jobId;
    await trackingUpsert({
      jobId,
      channelId: processingMsg.channelId || message.channelId || null,
      messageId: processingMsg.id,
      sourceMessageId: message.id,
      guildId: message.guildId || null,
      userId: message.author?.id || null,
      instance: BOT_INSTANCE,
      startedAt: new Date(jobStartTime).toISOString(),
      queueUrl,
    });

    // 2. Poll for result + โพสต์ผล — ★ 2 ก.ย. 69 ย้ายไป pollJobUntilDone (ก้อนเดิมทุกบรรทัด) ให้เส้นทางกู้ใช้ร่วม
    await pollJobUntilDone({ jobId, processingMsg, message, headers, queueUrl, jobStartTime });

  } catch (error) {
    // ★ 2 ก.ย. 69: งานถูกบอทตัวใหม่รับช่วงไปแล้ว (redeploy ทับตอนงานเสร็จพอดี) → ตัวนี้เงียบ ไม่โพสต์ซ้ำ ไม่ถอนสมุดของเขา
    if (error?.code === 'BOT_HANDOFF') {
      handedOff = true;
      console.log(`[Bot] 🩹 ${error.message}`);
      return;
    }
    console.error('[Discord Bot Error Detail]:', error);
    console.error('[Discord Bot Error]:', error.message);
    // ★ 4 ก.ค.: ข่าวเนื้อเดิม/เกือบเดิมส่งซ้ำใน 45 นาที (NEAR_DUPLICATE จาก server) → ตอบเตือนสั้นๆ 1 ครั้ง
    //   ไม่เงียบแบบ claim-ซ้ำ — คนส่งต้องรู้ว่า "งานแรกมีอยู่แล้ว" จะได้ไม่ส่งวนอีก (ต้นเหตุที่เห็นประมวลผลเบิ้ล)
    if (error.response?.data?.errorType === 'NEAR_DUPLICATE') {
      const warnText = `⚠️ ${error.response.data.error}`;
      if (processingMsg) await processingMsg.edit(warnText).catch(() => {});
      else await message.reply(warnText).catch(() => {});
      return;
    }
    // ★ 26 มิ.ย.: ถ้า error คือ "งานซ้ำ" (server คืน 409/DUPLICATE_JOB ตอน overlap) → เงียบ ลบ reply ทิ้ง
    //   เหมือนเส้น duplicate:true ด้านบน — ไม่โชว์ "❌ เกิดข้อผิดพลาด" ที่ทำให้เห็น 2 อัน
    const _eMsg = String(error.response?.data?.error || error.message || '');
    const _isDup = error.response?.status === 409 || error.response?.data?.errorType === 'DUPLICATE_JOB'
      || /กำลังประมวลผลอยู่|อยู่ในคิวแล้ว|DUPLICATE/i.test(_eMsg);
    if (_isDup) {
      console.log('[Bot] ⏭️ งานซ้ำ (409) — instance นี้เงียบสนิท (ไม่โพสต์ ack)');
      if (processingMsg) await processingMsg.delete().catch(() => {});
      return;
    }
    // error จริง — โพสต์เฉพาะถ้าเคยโพสต์ ack แล้ว (ชนะเคลม) · ตัวที่แพ้เคลมไม่ควรโผล่ error
    if (processingMsg) await processingMsg.edit(`❌ เกิดข้อผิดพลาดในการประมวลผล: ${error.response?.data?.error || error.message}`).catch(() => {});
    else await message.reply(`❌ เกิดข้อผิดพลาดในการประมวลผล: ${error.response?.data?.error || error.message}`).catch(() => {});
  } finally {
    // ★ 2 ก.ย. 69: จบงาน/ล้ม → ถอนออกจากสมุด · ยกเว้น (ก) กำลังปิดตัวตาม SIGTERM (client ถูก destroy โพสต์อะไรไม่ได้แล้ว)
    //   — เก็บสมุดไว้ให้ตัวใหม่ตามต่อ (ข) งานถูก instance อื่นรับช่วงไปแล้ว — สมุดเป็นของเขา ห้ามลบ
    if (trackedJobId && !shuttingDown && !handedOff) await trackingDelete(trackedJobId);
  }
}

// ★ 2 ก.ย. 69: ลูปติดตามผล + โพสต์ผลลัพธ์ — แยกจาก processNewsJob ให้เส้นทางปกติและเส้นทางกู้หลังรีสตาร์ต (resumeTrackedJob)
//   ใช้ร่วมกัน · เนื้อในย้ายมาทั้งก้อนไม่แก้สักบรรทัด (คงย่อหน้าเดิมให้ diff เห็นว่าเป็นการย้ายล้วน) · โยน error ให้ผู้เรียกจัดการเหมือนเดิม
async function pollJobUntilDone({ jobId, processingMsg, message, headers, queueUrl, jobStartTime }) {
    // 2. Poll for result
    const statusUrl = queueUrl.replace('/api/queue/add', '/api/queue/status');
    const workerUrl = queueUrl.replace('/api/queue/add', '/api/queue/worker');
    const maxPollTime = 15 * 60 * 1000; // 15 minutes (pipeline ~8min + queue wait)
    const pollStartTime = Date.now();
    let lastStatus = '';
    let data = null;
    let workerRetriggerCount = 0;

    let notFoundCount = 0; // ★ Track consecutive 'job not found'

    while (Date.now() - pollStartTime < maxPollTime) {
      await new Promise(r => setTimeout(r, 3000)); // poll every 3s

      try {
        const statusRes = await axios.get(`${statusUrl}?id=${jobId}`, { headers, timeout: 10000 });
        const st = statusRes.data;
        if (!st.success) {
          notFoundCount++;
          console.warn(`[Discord Bot] Job ${jobId.slice(0,8)} not found (${notFoundCount}/5) — last: ${lastStatus}`);
          if (notFoundCount >= 5 || (notFoundCount >= 3 && lastStatus === 'processing')) {
            throw new Error('ประมวลผลเสร็จแล้วแต่ผลลัพธ์หายไป — กรุณาส่งลิงก์ใหม่อีกครั้ง');
          }
          continue;
        }
        notFoundCount = 0; // reset on success

        // === Fallback: re-trigger worker if still pending after 10s ===
        if (st.status === 'pending' && (Date.now() - pollStartTime > 10000) && workerRetriggerCount < 3) {
          workerRetriggerCount++;
          console.log(`[Discord Bot] Job still pending, re-triggering worker (attempt ${workerRetriggerCount})`);
          axios.post(workerUrl, { trigger: 'retry' }, { headers, timeout: 10000 }).catch(() => {});
        }

        if (st.status === 'pending' && st.status !== lastStatus) {
          const ahead = st.queuesAhead || 0;
          await processingMsg.edit(`📋 **รอคิว** (ลำดับที่ ${st.position}) มี ${ahead} คิวก่อนหน้า ⏳\nประมาณ ${ahead * 3} นาที`).catch(() => {});
          lastStatus = st.status;
        } else if (st.status === 'processing') {
          // แสดง pipeline steps ตามเวลาที่ผ่านไป (timing จาก real pipeline measurements)
          const elapsed = Math.round((Date.now() - pollStartTime) / 1000);

          // Pipeline steps with real model/API info and accurate timing
          const PIPELINE_STEPS = [
            { at: 0,   done: 2,   icon: '🔍', label: 'ตรวจจับแหล่งข้อมูล',                     detail: 'ตรวจสอบประเภท URL และพลัตฟอร์ม',                                  model: null },
            { at: 2,   done: 12,  icon: '📡', label: 'ดึงเนื้อหาจากเว็บ',                      detail: 'Firecrawl → Jina → Direct fetch',                                  model: null },
            { at: 12,  done: 26,  icon: '📰', label: 'สกัดเนื้อข่าว (AI)',                     detail: 'สกัด newsTitle + newsBody + category',                             model: 'Gemini 2.0 Flash' },
            { at: 26,  done: 68,  icon: '🔍', label: 'วิเคราะห์มุมข่าว (AI)',                  detail: 'core story + key points + possible angles',                       model: 'GPT-5.5' },
            // ★ 16 ส.ค. 69: ถอดคำว่า "ค้นหาข้อมูล Google" ออก — ค้นข้อมูลเสริมปิดเป็นค่าตั้งต้นแล้ว
            //   ป้ายเดิมโฆษณาสิ่งที่ระบบไม่ได้ทำ = ทีมอ่านแล้วเข้าใจผิดว่าข่าวมีข้อมูลจากเน็ตประกอบ
            { at: 68,  done: 160, icon: '🧬', label: 'วาง Blueprint โครงอารมณ์',                  detail: 'Emotional Blueprint (ค้นข้อมูลเสริมปิดอยู่ — ใช้เนื้อต้นฉบับอย่างเดียว)', model: 'GPT-5.5' },
            { at: 160, done: 320, icon: '⚡', label: 'Classic + Enhanced (Parallel)',           detail: '2 Angles รันพร้อมกัน — Claude Sonnet 4 × 2',                      model: 'Claude Sonnet 4' },
            { at: 320, done: 999, icon: '🚀', label: 'สรุปผลและบันทึก',                        detail: 'รวมผลลัพธ์ + บันทึกลงคลัง',                                        model: null },
          ];

          const stepLines = PIPELINE_STEPS.map(s => {
            const isDone    = elapsed >= s.done;
            const isRunning = elapsed >= s.at && elapsed < s.done;
            const isPending = elapsed < s.at;

            if (isDone)    return `✅ **${s.label}**`;
            if (isRunning) {
              const stepElapsed = elapsed - s.at;
              const modelTag = s.model ? ` \`${s.model}\`` : '';
              return `⏳ **${s.label}** (${stepElapsed}s)${modelTag}\n     ↳ _${s.detail}_`;
            }
            return `⬜ ${s.label}`;
          }).join('\n');

          // หา step ปัจจุบัน
          const currentStep = PIPELINE_STEPS.slice().reverse().find(s => elapsed >= s.at);
          const progressBar = buildProgressBar(elapsed, 600); // 600s = real pipeline max (~10 min)

          const progressMsg = [
            `⚡ **Auto Pipeline V2** กำลังประมวลผล... (\`${elapsed}s\`)`,
            progressBar,
            '',
            stepLines,
            '',
            `*📍 ขั้นตอนปัจจุบัน: **${currentStep?.label || '...'}***`,
          ].join('\n');

          // อัพเดททุก 6 วินาที เพื่อไม่ spam Discord API
          if (elapsed % 6 === 0 || st.status !== lastStatus) {
            await processingMsg.edit(progressMsg).catch(() => {});
          }
          lastStatus = st.status;

        } else if (st.status === 'completed') {
          data = st.result;
          break;
        } else if (st.status === 'failed') {
          throw makeQueueTerminalError(st);
        }
      } catch (pollErr) {
        if (isQueueTerminalError(pollErr) || pollErr.message?.includes('หายไป')) throw pollErr;
        console.warn('[Discord Bot] Poll error:', pollErr.message);
      }
    }

    if (!data) {
      throw new Error('หมดเวลารอคิว (15 นาที) กรุณาลองใหม่');
    }

    if (!data.success) {
      throw new Error(data.error || 'API Processing Failed');
    }

    // ★ 2 ก.ย. 69: ก่อนโพสต์ผล — ถ้าสมุด tracking บอกว่างานนี้ถูก instance อื่นรับช่วงไปแล้ว (บอทตัวใหม่กู้งานหลัง redeploy
    //   ทับช่วงงานเสร็จพอดี) → ตัวนี้เงียบ ให้ตัวใหม่โพสต์คนเดียว (กันเห็นผล 2 ชุด) · ปิดสวิตช์ = ไม่เช็ค ไม่มีคำขอเพิ่ม
    //   อ่านสมุดไม่ได้/ไม่มีในสมุด = ถือว่าเป็นของเรา (fail-open — ห้ามทำให้ผลลัพธ์หาย)
    if (await trackingTakenByOther(jobId)) throw makeHandoffAbort(jobId);

    // ดึงเวอร์ชันทั้งหมด (รองรับสูงสุด 10 เวอร์ชัน)
    const allVersions = data.analysisResult?.versions || data.data?.analysisResult?.versions || [];
    const versionsToShow = allVersions.slice(0, 10);
    const qualityWarnings = data.analysisResult?.qualityWarnings
      || data.data?.analysisResult?.qualityWarnings
      || [];
    const visibleWarnings = selectQualityWarnings(qualityWarnings, 2);
    const warningPreview = visibleWarnings.length > 0
      ? `\n⚠️ **จุดให้พนักงานตรวจ:** ${visibleWarnings.join(' | ').slice(0, 500)}`
      : '';

    // ดึง newsTitle และ caseId จาก path ที่ถูกต้อง
    const newsTitle = data.data?.newsData?.newsTitle || data.newsData?.newsTitle || data.data?.analysisResult?.newsTitle || 'ไม่ทราบหัวข้อ';
    const caseId = data.data?.caseId || data.caseId || null;
    const logLink = caseId ? `\n🔗 ดูผลลัพธ์เต็ม: ${(process.env.API_URL || 'http://localhost:3001').replace('/api/auto/process','')}/generation-logs/${caseId}` : '';

    if (versionsToShow.length === 0) {
      throw new Error('ไม่พบเนื้อหาที่สร้างเสร็จ');
    }

    const jobTime = ((Date.now() - jobStartTime) / 1000).toFixed(1);
    await processingMsg.edit({ content: `✅ **สร้างข่าวสำเร็จ!** ${versionsToShow.length} เวอร์ชัน | ใช้เวลา ${jobTime}s\n📰 **${newsTitle.slice(0, 80)}**${warningPreview}${logLink}` });

    // ดึง Research items — ลอง path ทั้งหมดที่เป็นไปได้
    const researchItems = data.data?.researchItems 
      || data.researchItems 
      || data.data?.analysisResult?.researchItems 
      || data.analysisResult?.researchItems 
      || [];
    console.log(`[Discord Bot] Research items found: ${researchItems.length} (paths: data.data?.researchItems=${!!data.data?.researchItems}, data.researchItems=${!!data.researchItems}, analysisResult.researchItems=${!!data.data?.analysisResult?.researchItems})`);
    
    const researchText = researchItems.length > 0
      ? researchItems.slice(0, 3).map(r => `• ${r.title || r.keyword} — [${r.sourceName || 'แหล่งข่าว'}](${r.sourceUrl || '#'})`).join('\n')
      : null;

    // ส่งทีละ 1 เวอร์ชันเพื่อป้องกันข้อจำกัด 6000 ตัวอักษรต่อ 1 ข้อความของ Discord API
    const chunkSize = 1;
    for (let i = 0; i < versionsToShow.length; i += chunkSize) {
      const chunk = versionsToShow.slice(i, i + chunkSize);
      
      const embeds = chunk.map((v, index) => {
        const actualIndex = i + index;
        const versionLabel = v._sourceLabel || v.style || `Version ${actualIndex + 1}`;
        const isEnhanced = v._source === 'enhanced';
        const promptId = v.promptId || (data.data?.usedPromptInfo?.name ? 'Dynamic' : 'Unknown');
        
        const embedTitle = `[${versionLabel}] ${newsTitle}`.slice(0, 250);
        const embed = new EmbedBuilder()
          .setColor(isEnhanced ? '#10b981' : '#f91880')
          .setTitle(embedTitle)
          .setDescription((v.content || 'ไม่พบเนื้อหา').slice(0, 3800)) // ★ 18 ก.ค. 69: ถอดบรรทัดชวน !ปัง (ฟีเจอร์ถูกลบ — ไม่มีคนใช้)
          .setFooter({ text: `Pipeline: ${data.data?.detection?.pipelineLabel || data.detection?.pipelineLabel || 'Universal'} | PromptID: ${promptId} | เวลา: ${jobTime}s` });

        return embed;
      });

      await message.reply({ embeds: embeds });
    }

    // === แสดงสรุป Research ในข้อความแยกหลังเวอร์ชันทั้งหมด ===
    // ★ 16 ส.ค. 69 — ตั้งแต่วันนี้ "ค้นข้อมูลเสริม" ปิดเป็นค่าตั้งต้น (เจ้าของสั่ง) ⇒ ไม่มีแหล่งอ้างอิง = สภาวะปกติ
    //   ของเดิมขึ้น '⚠️ ไม่มีข้อมูล' + 'Research Grade: ❌ Missing' → ทีมจะนึกว่าระบบล่มทุกข่าว ทั้งที่ตั้งใจปิด
    //   (ผู้ตรวจอิสระท้วง: ป้ายแบบนี้ทำให้คนเลิกเชื่อป้ายเตือน แล้ววันที่ล่มจริงจะไม่มีใครสังเกต)
    //   → เขียนตามความจริงแบบเป็นกลาง ไม่ตีตราว่าล้มเหลว
    const _hasResearch = researchItems.length > 0;
    const researchSummaryEmbed = new EmbedBuilder()
      .setColor(_hasResearch ? '#3b82f6' : '#6b7280')
      .setTitle(_hasResearch ? '📚 แหล่งอ้างอิง Research' : '📄 เขียนจากเนื้อต้นฉบับอย่างเดียว')
      .setDescription(_hasResearch
        ? `${researchText}\n\n_ใช้ข้อมูลจาก ${researchItems.length} แหล่ง เพื่อเสริมข้อเท็จจริงในเนื้อหา_`
        : '_ระบบค้นข้อมูลเสริมปิดอยู่ — ข่าวนี้เขียนจากเนื้อที่วางเข้ามาเท่านั้น ไม่มีข้อมูลจากภายนอกปน (ไม่ใช่ข้อผิดพลาด)_')
      .setFooter({ text: _hasResearch
        ? `Research Grade: ${researchItems.length >= 3 ? '✅ Strong' : '⚠️ Partial'}`
        : 'แหล่งข้อมูล: ต้นฉบับ 100%' });

    await message.reply({ embeds: [researchSummaryEmbed] });

    // Display Simulated Comments if available
    const simulatedComments = data.simulatedComments || data.data?.simulatedComments || [];
    if (simulatedComments.length > 0) {
      const commentText = simulatedComments.map(c => {
        const emoji = c.type === 'agreement' ? '👍' : c.type === 'drama' ? '🔥' : c.type === 'funny' ? '😂' : '🤔';
        return `${emoji} **${c.type.toUpperCase()}:** ${c.text}`;
      }).join('\n\n');
      
      const commentEmbed = new EmbedBuilder()
        .setColor('#3b82f6')
        .setTitle('🤖 AI จำลองคอมเมนต์ชาวเน็ต (Auto-Comment Simulator)')
        .setDescription(`ถ้าโพสต์ข่าวนี้ นี่คือทิศทางคอมเมนต์ที่อาจเกิดขึ้น:\n\n${commentText}`);
        
      await message.reply({ embeds: [commentEmbed] });
    }

    await message.react('✅');
    console.log(`[Queue] ✅ Job done for ${message.author.tag} | ${jobTime}s | Queue remaining: ${queue.length}`);
}

// ═══════════════════════════════════════════
// 🩹 Tracking — จำงานที่กำลังตามอยู่ไว้ที่เซิร์ฟเวอร์ (2 ก.ย. 69) · ทุกคำสั่งล้มเงียบ ห้ามทำงานหลักพัง
//   สมุด = /api/bot/tracking (store 'bot-tracking') · กุญแจเดียวกับ /api/queue/add (API_KEY = DISCORD_API_SECRET ฝั่งเซิร์ฟเวอร์)
// ═══════════════════════════════════════════
function buildTrackingUrl() {
  return buildQueueUrl().replace('/api/queue/add', '/api/bot/tracking');
}

function buildTrackingHeaders() {
  const headers = buildApiHeaders();
  if (API_KEY) headers['x-bot-secret'] = API_KEY;
  return headers;
}

function makeHandoffAbort(jobId) {
  const err = new Error(`งาน ${String(jobId).slice(0, 8)} ถูกบอทตัวใหม่รับช่วงไปแล้ว — instance นี้เงียบ ไม่โพสต์ซ้ำ`);
  err.code = 'BOT_HANDOFF';
  return err;
}

// ★ 2 ก.ย. 69 (ผู้ตรวจไขว้ ข้อ medium): งานที่ instance นี้ "จดลงสมุดสำเร็จและยังไม่ได้ถอนเอง"
//   ใช้แยก "สมุดอ่านได้แต่ไม่มีงานนี้ เพราะตัวใหม่โพสต์ผล+ถอนสมุดไปแล้ว" (ต้องเงียบ) ออกจาก "ไม่เคยจดสำเร็จ" (โพสต์ตามปกติ)
//   ช่วง Railway overlap ตัวเก่า poll ห่างได้ถึง 3 วิ → เห็น completed ตามหลังตัวใหม่ → เดิมถือว่าเป็นของตัวเองแล้วโพสต์ซ้ำทั้งชุด
const registeredJobs = new Set();

// จด/ทับ 1 งาน (upsert) · คืน true เฉพาะเซิร์ฟเวอร์ตอบรับจริง (success:true) — และจำไว้ใน registeredJobs
async function trackingUpsert(entry) {
  if (!BOT_RESUME_TRACKING) return false;
  try {
    const res = await axios.post(buildTrackingUrl(), entry, { headers: buildTrackingHeaders(), timeout: 10000 });
    if (res?.data?.success !== true) {
      console.warn(`[Bot] 🩹 จดงานลงสมุดไม่สำเร็จ (เซิร์ฟเวอร์ตอบไม่รับ ไม่กระทบงานหลัก): ${String(res?.data?.error || 'unknown').slice(0, 80)}`);
      return false;
    }
    registeredJobs.add(entry.jobId);
    return true;
  } catch (err) {
    console.warn(`[Bot] 🩹 จดงานลงสมุดไม่สำเร็จ (ไม่กระทบงานหลัก): ${String(err?.message || err).slice(0, 80)}`);
    return false;
  }
}

// ถอน 1 งานออกจากสมุด (จบ/ล้ม/กู้เสร็จ) · ลืมจาก registeredJobs ก่อนยิง — ถอนเองแล้ว สมุดว่างหลังจากนี้ไม่ใช่สัญญาณว่าคนอื่นปิดงานแทน
async function trackingDelete(jobId) {
  if (!BOT_RESUME_TRACKING || !jobId) return false;
  registeredJobs.delete(jobId);
  try {
    await axios.delete(`${buildTrackingUrl()}?jobId=${encodeURIComponent(jobId)}`, { headers: buildTrackingHeaders(), timeout: 10000 });
    return true;
  } catch (err) {
    console.warn(`[Bot] 🩹 ถอนงานออกจากสมุดไม่สำเร็จ (ไม่กระทบงานหลัก): ${String(err?.message || err).slice(0, 80)}`);
    return false;
  }
}

// รายการงานที่ยังเปิดอยู่ทั้งหมด · อ่านไม่ได้ = [] (บอทตื่นต่อได้ตามปกติ)
async function trackingList() {
  if (!BOT_RESUME_TRACKING) return [];
  try {
    const res = await axios.get(buildTrackingUrl(), { headers: buildTrackingHeaders(), timeout: 15000 });
    const items = res.data?.items;
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.warn(`[Bot] 🩹 อ่านรายการงานค้างไม่สำเร็จ: ${String(err?.message || err).slice(0, 80)}`);
    return [];
  }
}

// งานนี้ถูก instance อื่นรับช่วง/ปิดแทนไปแล้วหรือยัง (เช็คก่อนโพสต์ผล)
//   · สมุดมีงานนี้แต่ instance ไม่ใช่เรา = true (ตัวใหม่รับช่วงแล้ว ให้เขาโพสต์คนเดียว)
//   · สมุดอ่านได้จริง (success:true) แต่ไม่มีงานนี้ ทั้งที่เราจดสำเร็จและยังไม่ได้ถอนเอง = true (ตัวใหม่โพสต์ผล+ถอนสมุดไปแล้ว)
//     — ★ 2 ก.ย. 69 ผู้ตรวจไขว้: เดิมช่องนี้ fail-open → ช่วง overlap ตัวเก่าโพสต์ผลซ้ำทั้งชุด (✅ + embed ทุกเวอร์ชัน + react)
//   · อ่านไม่ได้ (สายพัง/401/403/5xx) หรือไม่เคยจดสำเร็จ = false (fail-open — ห้ามทำให้ผลลัพธ์หาย)
async function trackingTakenByOther(jobId) {
  if (!BOT_RESUME_TRACKING || !jobId) return false;
  try {
    const res = await axios.get(`${buildTrackingUrl()}?jobId=${encodeURIComponent(jobId)}`, { headers: buildTrackingHeaders(), timeout: 5000 });
    if (res?.data?.success !== true) return false;
    const items = Array.isArray(res.data.items) ? res.data.items : [];
    const entry = items.find((e) => e && e.jobId === jobId);
    const taken = entry
      ? !!(entry.instance && entry.instance !== BOT_INSTANCE)
      : registeredJobs.has(jobId);
    if (taken) registeredJobs.delete(jobId); // งานไม่ใช่ของเราแล้ว — ไม่ต้องจำต่อ
    return taken;
  } catch {
    return false;
  }
}

// ★ 2 ก.ย. 69 (ผู้ตรวจไขว้ ข้อ low): รหัส error ของ Discord ที่แปลว่าห้อง/ข้อความ "ไม่มีให้ตามแล้วจริงๆ" — ค่อยถอนสมุด
//   10003 Unknown Channel · 10008 Unknown Message · 50001 Missing Access (DiscordAPIError.code ของ discord.js v14)
//   error อื่น (429 rate-limit / 5xx / สายหลุดชั่วคราวหลัง ready) = ชั่วคราว → ข้ามรอบนี้โดยไม่ลบ (รีสตาร์ตครั้งหน้าลองใหม่
//   หรือหมดอายุตามกฎ 30 นาที) — เดิมตีความทุก error ว่า "หายแล้ว" แล้วลบสมุด = งานกลายเป็นกำพร้าเงียบๆ เหมือนบั๊กเดิม
const DISCORD_GONE_CODES = new Set([10003, 10008, 50001]);
function isDiscordGoneError(err) {
  const code = Number(err?.code);
  return Number.isFinite(code) && DISCORD_GONE_CODES.has(code);
}

function skipResume(jobId, what, err) {
  console.warn(`[Bot] 🩹 ดึง${what}ของงาน ${String(jobId).slice(0, 8)} ไม่ได้ชั่วคราว (${String(err?.message || err).slice(0, 60)}) — คงสมุดไว้ ลองใหม่รอบหน้า`);
  return 'skipped';
}

// ข้อความต้นทางของคนส่งหาไม่เจอแล้ว (ถูกลบ) → ยังโพสต์ผลลงห้องเดิมได้ แต่ไม่ reply/react ใส่ข้อความที่หายไป
function makeFallbackSourceMessage(channel, entry) {
  return {
    id: entry.sourceMessageId || null,
    author: { id: entry.userId || 'unknown', tag: entry.userId ? `discord-${entry.userId}` : 'unknown' },
    reply: (options) => channel.send(options),
    react: async () => null,
  };
}

// กู้ 1 งาน → 'dropped' (ห้อง/ข้อความหายจริง) · 'skipped' (Discord ล้มชั่วคราว — คงสมุดไว้) · 'stale' (เริ่มมาเกิน 30 นาที)
//   · 'resumed' (ตามต่อจนโพสต์ผล) · 'handedoff' (instance อื่นรับช่วงไปอีกที) · 'failed' (ตามต่อแล้วล้ม — แจ้ง ❌ ในข้อความเดิม)
async function resumeTrackedJob(entry, { client: bot = client, now = Date.now() } = {}) {
  const jobId = entry.jobId;
  const startedAtMs = Date.parse(entry.startedAt || '');
  const jobStartTime = Number.isFinite(startedAtMs) ? startedAtMs : now;
  const isStale = now - jobStartTime > RESUME_MAX_AGE_MS;
  // ดึงห้อง/ข้อความ: หายจริง (รหัส 10003/10008/50001) หรือค้างเกิน 30 นาทีแล้ว = ถอนสมุด · ล้มชั่วคราว = ข้ามรอบนี้ ไม่ลบ
  let channel = null;
  try {
    channel = await bot.channels.fetch(entry.channelId);
  } catch (err) {
    if (!isDiscordGoneError(err) && !isStale) return skipResume(jobId, 'ห้อง', err);
    channel = null;
  }
  if (!channel || typeof channel.messages?.fetch !== 'function') {
    await trackingDelete(jobId);
    return 'dropped';
  }
  let processingMsg = null;
  try {
    processingMsg = await channel.messages.fetch(entry.messageId);
  } catch (err) {
    if (!isDiscordGoneError(err) && !isStale) return skipResume(jobId, 'ข้อความ', err);
    processingMsg = null;
  }
  if (!processingMsg) {
    await trackingDelete(jobId);
    return 'dropped';
  }
  if (isStale) {
    await processingMsg.edit(RESUME_STALE_TEXT).catch(() => {});
    await trackingDelete(jobId);
    return 'stale';
  }
  let message = null;
  if (entry.sourceMessageId) {
    try { message = await channel.messages.fetch(entry.sourceMessageId); } catch { message = null; }
  }
  if (!message) message = makeFallbackSourceMessage(channel, entry);
  const queueUrl = entry.queueUrl || buildQueueUrl();
  // รับช่วง: เขียนทับ instance เป็นของเรา — ตัวเก่า (ถ้ายังไม่ตาย) จะเห็นตอนก่อนโพสต์ผลแล้วเงียบเอง
  await trackingUpsert({
    jobId,
    channelId: entry.channelId,
    messageId: entry.messageId,
    sourceMessageId: entry.sourceMessageId || null,
    guildId: entry.guildId || null,
    userId: entry.userId || null,
    instance: BOT_INSTANCE,
    startedAt: new Date(jobStartTime).toISOString(),
    queueUrl,
  });
  let handedOff = false;
  activeCount++;
  try {
    await pollJobUntilDone({ jobId, processingMsg, message, headers: buildApiHeaders(), queueUrl, jobStartTime });
    return 'resumed';
  } catch (error) {
    if (error?.code === 'BOT_HANDOFF') {
      handedOff = true;
      console.log(`[Bot] 🩹 ${error.message}`);
      return 'handedoff';
    }
    console.error('[Bot] 🩹 งานที่กู้มาล้ม:', error.message);
    await processingMsg.edit(`❌ เกิดข้อผิดพลาดในการประมวลผล: ${error.response?.data?.error || error.message}`).catch(() => {});
    return 'failed';
  } finally {
    activeCount--;
    if (!handedOff && !shuttingDown) await trackingDelete(jobId);
  }
}

// ตอนบอทพร้อม: ดึงรายการงานที่ค้างจากก่อนรีสตาร์ต แล้วกู้พร้อมกันทุกงาน (งานปกติก็วิ่งขนานกันได้อยู่แล้ว)
async function resumeTrackedJobs(options = {}) {
  const summary = { total: 0, resumed: 0, stale: 0, dropped: 0, skipped: 0, handedoff: 0, failed: 0 };
  if (!BOT_RESUME_TRACKING) return summary;
  const entries = (await trackingList()).filter((e) => e && typeof e.jobId === 'string' && e.jobId);
  summary.total = entries.length;
  if (entries.length === 0) return summary;
  console.log(`🩹 กู้งานค้าง ${entries.length} งาน`);
  const results = await Promise.allSettled(entries.map((entry) => resumeTrackedJob(entry, options)));
  for (const r of results) {
    if (r.status === 'fulfilled' && Object.prototype.hasOwnProperty.call(summary, r.value)) summary[r.value]++;
    else if (r.status === 'rejected') {
      summary.failed++;
      console.warn(`[Bot] 🩹 กู้งานล้มกลางทาง: ${String(r.reason?.message || r.reason).slice(0, 80)}`);
    }
  }
  return summary;
}

// ★ 26 มิ.ย.: ปิดตัวนุ่มนวลตอน redeploy (Railway/Docker ส่ง SIGTERM, Ctrl+C ส่ง SIGINT)
//   หยุดรับข้อความ → รองานที่ทำอยู่จบสั้นๆ → ตัดการเชื่อมต่อ Discord → ออก
//   ผล: ตัวเก่าเลิกฟัง event ทันที ไม่ทับกับ instance ใหม่ → ไม่เด้ง 2 ตอบช่วง deploy
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Bot] 🛑 ได้รับ ${signal} — ปิดตัวนุ่มนวล (หยุดรับข้อความใหม่, ตัดการเชื่อมต่อ Discord)`);
  try { await client.destroy(); } catch (e) { console.log('[Bot] destroy error:', e.message); }
  // เผื่องานค้างเขียนผลลง Discord สั้นๆ แล้วออก
  setTimeout(() => process.exit(0), 2500);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ★ 2 ก.ย. 69: ล็อกอินเฉพาะตอนรันเป็นโปรแกรมหลัก (`node index.js` — Railway ใช้แบบนี้) · ถูก require ในเทส = ไม่ล็อกอิน
if (require.main === module) {
  client.login(TOKEN);
}

// สำหรับเทส (tests/bot-resume.test.mjs) — ไม่มีผลตอนรันจริง
module.exports = {
  processNewsJob,
  pollJobUntilDone,
  resumeTrackedJobs,
  resumeTrackedJob,
  buildQueueUrl,
  buildApiHeaders,
  buildTrackingUrl,
  trackingUpsert,
  trackingDelete,
  trackingList,
  trackingTakenByOther,
  RESUME_MAX_AGE_MS,
  RESUME_STALE_TEXT,
  _client: client,
};

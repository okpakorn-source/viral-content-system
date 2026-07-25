require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

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
const BOT_BUILD = '2026-06-27-singlemsg-atomicclaim';
client.once('ready', () => {
  console.log(`✅ บอทพร้อมทำงานแล้ว! ล็อกอินในชื่อ ${client.user.tag}`);
  console.log(`🟢 [BOT_BUILD=${BOT_BUILD}] instance=${BOT_INSTANCE} | คิว: เซิร์ฟเวอร์ (atomic claim) | Dedup URL: ${DEDUP_WINDOW_MS / 1000}s`);
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

  // 1.4 ★ !โต๊ะ <คำสั่ง> — ศูนย์คำสั่งโต๊ะข่าว เหมือนเว็บทุกประการ (11 มิ.ย. 69)
  //     สถานะ/คิว · หาข่าว · บก.น้ำดี/ดราม่า/สัมภาษณ์ ทำเลย · อื่นๆ = สั่ง บก.ใหญ่วิเคราะห์
  if (content.startsWith('!โต๊ะ') || content.toLowerCase().startsWith('!desk')) {
    const cmd = content.replace(/^!(โต๊ะ|desk)\s*/i, '').trim();
    if (!cmd) {
      return message.reply(
        'วิธีสั่งโต๊ะข่าว:\n' +
        '`!โต๊ะ สถานะ` — สรุปคลัง+คิว\n' +
        '`!โต๊ะ หาข่าว` — เก็บข่าวรอบใหม่ทุกเลน (~3-6 นาที)\n' +
        '`!โต๊ะ บก.น้ำดี ทำเลย` / `บก.ดราม่า ลุย` / `บก.สัมภาษณ์ เช็ค`\n' +
        '`!โต๊ะ <ข้อความอะไรก็ได้>` — ส่งเป็นคำสั่งให้ บก.ใหญ่ AI'
      );
    }
    const deskWait = await message.reply(`🗞️ รับคำสั่ง: "${cmd.slice(0, 80)}" — กำลังทำงาน...`);
    try {
      const base = API_URL.replace(/\/api\/.*$/, '');
      const res = await axios.post(`${base}/api/news-desk/command`,
        { text: cmd, user: message.author.username },
        { timeout: 540000 } // หาข่าว/บก.ใหญ่ ใช้เวลาได้ถึง ~9 นาที
      );
      const d = res.data || {};
      const replyText = d.reply || d.summary || (d.success ? '✅ เสร็จแล้ว — รายละเอียดอยู่ในช่องแจ้งเตือนโต๊ะข่าว' : `❌ ${d.error || 'ไม่สำเร็จ'}`);
      await deskWait.edit(String(replyText).slice(0, 1900));
    } catch (err) {
      await deskWait.edit(`❌ คำสั่งโต๊ะล้มเหลว: ${String(err.message).slice(0, 200)}`).catch(() => {});
    }
    return;
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

// ═══════════════════════════════════════════
// 📰 Process News Job — ฟังก์ชันประมวลผลข่าวจริง
// ═══════════════════════════════════════════
async function processNewsJob(job) {
  const { message, content } = job;
  // ★ 27 มิ.ย.: เริ่มเป็น null — โพสต์ ack "หลังชนะเคลม atomic" เท่านั้น (instance ที่แพ้ไม่เคยโพสต์อะไร)
  let processingMsg = job.processingMsg || null;
  const jobStartTime = Date.now();

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

    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['x-api-key'] = API_KEY;

    // === Submit via Server Queue ===
    let queueUrl = API_URL;
    if (queueUrl.endsWith('/api/auto/process')) {
      queueUrl = queueUrl.replace('/api/auto/process', '/api/queue/add');
    } else if (queueUrl.endsWith('/api/auto/stream')) {
      queueUrl = queueUrl.replace('/api/auto/stream', '/api/queue/add');
    } else {
      queueUrl = queueUrl.replace(/\/api\/.*$/, '/api/queue/add');
    }

    // 1. Add to server queue
    const addRes = await axios.post(queueUrl, payload, { headers, timeout: 15000 });
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
            { at: 68,  done: 160, icon: '🧬', label: 'วาง Blueprint + ค้นหาข้อมูล Google (Parallel)', detail: 'Emotional Blueprint + Smart Research × 6 agents (Serper+Wikipedia)', model: 'GPT-5.5' },
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
          throw new Error(st.error || 'Queue job failed');
        }
      } catch (pollErr) {
        if (pollErr.message?.includes('Queue job failed') || pollErr.message?.includes('failed') || pollErr.message?.includes('หายไป')) throw pollErr;
        console.warn('[Discord Bot] Poll error:', pollErr.message);
      }
    }

    if (!data) {
      throw new Error('หมดเวลารอคิว (15 นาที) กรุณาลองใหม่');
    }

    if (!data.success) {
      throw new Error(data.error || 'API Processing Failed');
    }

    // ดึงเวอร์ชันทั้งหมด (รองรับสูงสุด 10 เวอร์ชัน)
    const allVersions = data.analysisResult?.versions || data.data?.analysisResult?.versions || [];
    const versionsToShow = allVersions.slice(0, 10);

    // ดึง newsTitle และ caseId จาก path ที่ถูกต้อง
    const newsTitle = data.data?.newsData?.newsTitle || data.newsData?.newsTitle || data.data?.analysisResult?.newsTitle || 'ไม่ทราบหัวข้อ';
    const caseId = data.data?.caseId || data.caseId || null;
    const logLink = caseId ? `\n🔗 ดูผลลัพธ์เต็ม: ${(process.env.API_URL || 'http://localhost:3001').replace('/api/auto/process','')}/generation-logs/${caseId}` : '';

    if (versionsToShow.length === 0) {
      throw new Error('ไม่พบเนื้อหาที่สร้างเสร็จ');
    }

    const jobTime = ((Date.now() - jobStartTime) / 1000).toFixed(1);
    await processingMsg.edit({ content: `✅ **สร้างข่าวสำเร็จ!** ${versionsToShow.length} เวอร์ชัน | ใช้เวลา ${jobTime}s\n📰 **${newsTitle.slice(0, 80)}**${logLink}` });

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
    const researchSummaryEmbed = new EmbedBuilder()
      .setColor('#3b82f6')
      .setTitle('📚 แหล่งอ้างอิง Research')
      .setDescription(researchText 
        ? `${researchText}\n\n_ใช้ข้อมูลจาก ${researchItems.length} แหล่ง เพื่อเสริมข้อเท็จจริงในเนื้อหา_`
        : '⚠️ ไม่มีข้อมูลจากการ Research (Serper) — เนื้อหาใช้ข้อมูลจากข่าวต้นฉบับอย่างเดียว')
      .setFooter({ text: `Research Grade: ${researchItems.length >= 3 ? '✅ Strong' : researchItems.length >= 1 ? '⚠️ Partial' : '❌ Missing'}` });
    
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

  } catch (error) {
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
  }
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

client.login(TOKEN);

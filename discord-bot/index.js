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

// ★ 25 ก.ค. 69: แยก "เช็ค" กับ "จำ" ออกจากกัน
//   บั๊กเดิม: เช็คแล้วจำทันที → ถ้างานล้มกลางทาง ผู้ใช้ส่งซ้ำไม่ได้อีก 5 นาที ทั้งที่ยังไม่เคยได้ข่าวเลย
//   ตอนนี้จำเฉพาะตอนเข้าคิวสำเร็จจริง (ดู processNewsJob)
function _dedupKey(content) {
  const urlMatch = content.match(/https?:\/\/\S+/);
  return urlMatch ? urlMatch[0].split('?')[0] : null;
}

function isDuplicate(content) {
  const url = _dedupKey(content);
  if (!url) return false;
  const now = Date.now();
  for (const [key, ts] of recentUrls) {
    if (now - ts > DEDUP_WINDOW_MS) recentUrls.delete(key);
  }
  return recentUrls.has(url);
}

function markProcessed(content) {
  const url = _dedupKey(content);
  if (url) recentUrls.set(url, Date.now());
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
  // ★ 25 ก.ค. 69: ข้อความเดิมชวนให้ส่งลิงก์ แต่ระบบปิดรับลิงก์มาตั้งแต่ 16 ก.ค. (TEXT_ONLY_MODE)
  //   → ผู้ใช้ส่งลิงก์ตามที่บอทบอก แล้วได้ error กลับทุกครั้ง
  const standardReply =
    "สวัสดีครับ ผมเป็น 'ผู้ช่วยรวมไอจีดารา'\n" +
    "หน้าที่ของผมคือปั้นข่าวไวรัลให้คุณครับ\n\n" +
    "📌 **ตอนนี้รับเฉพาะ \"ข้อความล้วน\" เท่านั้น** (ยังไม่รับลิงก์และรูป)\n" +
    "รบกวนสรุปเนื้อข่าวเป็นข้อความ แล้ววางมาได้เลยครับ — ยิ่งเนื้อครบ ข่าวยิ่งดี\n" +
    "• ความยาวขั้นต่ำ ~50 ตัวอักษร\n" +
    "• ห้ามมีลิงก์ปนมาในข้อความ (ระบบจะปฏิเสธทันที)\n\n" +
    "ส่งแล้วผมจะคืนข่าวให้ 2 เวอร์ชัน ให้เลือกตัวที่ชอบไปใช้ได้เลยครับ";

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

  // ★ 25 ก.ค. 69: ด่านลิงก์ — บอกผู้ใช้ตรงนี้เลย ไม่ต้องยิงเข้าคิวให้เสียเวลาแล้วเด้ง error กลับ
  //   (ระบบฝั่งเซิร์ฟเวอร์ปฏิเสธทุกข้อความที่มีลิงก์ปน — TEXT_ONLY_MODE ตั้งแต่ 16 ก.ค.)
  if (hasUrl) {
    return message.reply(
      '⚠️ ตอนนี้ระบบรับ **เฉพาะข้อความล้วน** ครับ (ยังไม่รับลิงก์)\n' +
      'รบกวนสรุปเนื้อข่าวเป็นข้อความ ไม่ต้องมีลิงก์ปนมา แล้วส่งใหม่อีกครั้งนะครับ 🙏'
    );
  }

  // 3. เงื่อนไขในการเริ่มประมวลผล: ข้อความยาวกว่า 50 ตัวอักษร
  if (textOnly.length > 50) {

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

    // ★ 25 ก.ค. 69: จำว่า "เข้าคิวสำเร็จแล้ว" ตรงนี้ — ไม่ใช่ตอนเช็ค (งานที่ล้มจะได้ส่งซ้ำได้ทันที)
    markProcessed(content);

    // ★ ชนะเคลม → "เพิ่งโพสต์ ack ครั้งแรกตรงนี้" (มีแค่ instance เดียวที่มาถึงจุดนี้ต่อ 1 ข้อความ)
    const ackText = queuesAhead > 0
      ? `📋 รับทราบครับ! คิวลำดับที่ **${initialPosition}** — มี ${queuesAhead} คิวก่อนหน้า\nประมาณ ${queuesAhead * 3} นาที ⏳`
      : `รับทราบครับ! กำลังอ่านข้อมูลและปั้นบทความไวรัล รอสักครู่นะครับ ⚡...`;
    if (processingMsg) await processingMsg.edit(ackText).catch(() => {});
    else processingMsg = await message.reply(ackText);

    // 2. Poll for result
    const statusUrl = queueUrl.replace('/api/queue/add', '/api/queue/status');
    const workerUrl = queueUrl.replace('/api/queue/add', '/api/queue/worker');
    // ★ 25 ก.ค. 69: 15 → 20 นาที — งานเดียวใช้ได้ถึง ~13 นาทีตามงบเวลาของ worker
    //   ถ้ามีคิวรอข้างหน้าแค่ 1 งาน บอทเดิมหมดเวลารอก่อนงานจริงเสร็จ (ผู้ใช้เห็น "หมดเวลา" ทั้งที่ข่าวเสร็จแล้ว)
    const maxPollTime = 20 * 60 * 1000;
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
          // ★ 25 ก.ค. 69: ปรับให้ตรงท่อจริง + โมเดลจริงหลังยกชุด (เดิมโชว์ Claude Sonnet 4 ซึ่งเลิกใช้แล้ว)
          //   เวลาอ้างอิงจากเคสจริง: สกัด ~6s · แตกประเด็น ~40-120s · เขียน ~37s/เวอร์ชัน
          const PIPELINE_STEPS = [
            { at: 0,   done: 4,   icon: '📥', label: 'รับงานเข้าคิว',                    detail: 'ตรวจข้อความ + กันส่งซ้ำ + จองคิว' },
            { at: 4,   done: 16,  icon: '📰', label: 'สกัดเนื้อข่าว',                    detail: 'หัวข้อ + เนื้อ + แหล่ง + หมวด', model: 'gemini-3.6-flash' },
            { at: 16,  done: 90,  icon: '🧩', label: 'แตกประเด็น + หามุมเล่า',           detail: 'DNA 7 มิติ + ข้อเท็จจริง + มุมข่าว', model: 'gpt-5.6-terra' },
            { at: 90,  done: 150, icon: '🧬', label: 'วางอารมณ์ + ขุดประวัติคนในข่าว',   detail: 'พิมพ์เขียวอารมณ์ + Serper/Wikipedia/Tavily (ขนาน)', model: 'gpt-5.6-luna' },
            { at: 150, done: 210, icon: '🏛️', label: 'เลือกพร้อมท์จากคลัง',              detail: 'จับคู่เทคนิคการเขียนให้เข้ากับข่าว', model: 'gpt-5.6-luna' },
            { at: 210, done: 330, icon: '✍️', label: 'ค้นข้อมูลจริง + เขียนข่าว',        detail: 'หาข้อมูลประกอบต่อมุม แล้วเขียนตามเทคนิคในการ์ด', model: 'claude-opus-5' },
            { at: 330, done: 400, icon: '🧽', label: 'เกลาสำนวน + ตรวจข้อเท็จจริง',      detail: 'เช็คชื่อ/ตัวเลข/ประโยคเพี้ยน', model: 'gpt-5.6-luna' },
            { at: 400, done: 999, icon: '🚀', label: 'บันทึก + เก็บเข้าคลังข่าว',        detail: 'ลงสมุดเคส + จัดหมวด + ส่งผลกลับ' },
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
          const progressBar = buildProgressBar(elapsed, 480); // ★ 25 ก.ค. 69: 480s ตรงกับงบเวลาจริงของ worker (เดิม 600s)

          const progressMsg = [
            `⚡ **ระบบทำข่าวอัตโนมัติ** กำลังประมวลผล... (\`${elapsed}s\`)`,
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
          // ★ 25 ก.ค. 69: ติดธงว่า "มาจากงานจริง" เพื่อไม่ให้ตัวกรอง error ด้านล่างกลืนทิ้ง
          const _jobErr = new Error(st.error || 'Queue job failed');
          _jobErr._fromJob = true;
          throw _jobErr;
        }
      } catch (pollErr) {
        // ★ 25 ก.ค. 69: เดิม axios โยน 404 ออกมาก่อนถึงตัวนับ notFoundCount → นับไม่ขึ้นสักครั้ง
        //   งานที่ผลหายจริงเลยไม่มีใครแจ้ง ผู้ใช้ต้องนั่งรอจนครบเวลาเต็ม
        if (pollErr.response?.status === 404) {
          notFoundCount++;
          console.warn(`[Discord Bot] Job ${jobId.slice(0, 8)} คืน 404 (${notFoundCount}/5) — สถานะล่าสุด: ${lastStatus}`);
          if (notFoundCount >= 5 || (notFoundCount >= 3 && lastStatus === 'processing')) {
            throw new Error('ประมวลผลเสร็จแล้วแต่ผลลัพธ์หายไป — รบกวนส่งเนื้อข่าวใหม่อีกครั้งครับ');
          }
          continue;
        }
        // ★ error จากงาน (ไม่ว่าข้อความจะเขียนว่าอะไร) ต้องเด้งออกไปแจ้งผู้ใช้ทันที
        //   เดิมกรองด้วยคำว่า failed/หายไป เท่านั้น → error ภาษาไทยอื่นๆ ถูกกลืนหมด
        if (pollErr._fromJob || pollErr.message?.includes('Queue job failed') || pollErr.message?.includes('failed') || pollErr.message?.includes('หายไป')) throw pollErr;
        console.warn('[Discord Bot] Poll error:', pollErr.message);
      }
    }

    if (!data) {
      throw new Error('หมดเวลารอคิว (20 นาที) กรุณาลองใหม่');
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
    // ★ 25 ก.ค. 69: แจ้งเมื่อ "เขียนเสร็จแต่เก็บเข้าคลังไม่สำเร็จ" — เดิมประกาศสำเร็จเสมอ
    //   ผู้ใช้จึงไม่รู้ว่าข่าวชิ้นนี้ไม่ได้ถูกบันทึกไว้ในสมุดเคส
    const _archiveSaved = data.data?.archiveSaved ?? data.archiveSaved;
    const _archiveNote = data.data?.archiveNote || data.archiveNote || '';
    const _archiveWarn = _archiveSaved === false
      ? `\n⚠️ เขียนข่าวเสร็จแล้ว แต่ **บันทึกเข้าคลังไม่สำเร็จ**${_archiveNote ? ` (${String(_archiveNote).slice(0, 80)})` : ''} — กรุณาก๊อปเนื้อข่าวเก็บไว้ก่อนครับ`
      : '';
    await processingMsg.edit({ content: `✅ **สร้างข่าวสำเร็จ!** ${versionsToShow.length} เวอร์ชัน | ใช้เวลา ${jobTime}s\n📰 **${newsTitle.slice(0, 80)}**${logLink}${_archiveWarn}` });

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
        
        // ★ 25 ก.ค. 69: เดิมเอาชื่อ "แนวการเล่า" มาครอบวงเล็บไว้หน้าพาดหัวข่าว
        //   → ผู้ใช้เห็น "[ดราม่าชีวิต: ลืมยาพ่นในวันที่อาการกำเริบ] เภสัชกรใจดี..." แล้วนึกว่าพาดหัวเพี้ยน
        //   ย้ายป้ายแนวลงไปอยู่บรรทัดล่าง เหลือพาดหัวข่าวจริงล้วนๆ ด้านบน
        const embedTitle = String(newsTitle).slice(0, 250);
        const embed = new EmbedBuilder()
          .setColor(isEnhanced ? '#10b981' : '#f91880')
          .setTitle(embedTitle)
          .setDescription((v.content || 'ไม่พบเนื้อหา').slice(0, 3800)) // ★ 18 ก.ค. 69: ถอดบรรทัดชวน !ปัง (ฟีเจอร์ถูกลบ — ไม่มีคนใช้)
          .setFooter({ text: `แนวการเล่า: ${String(versionLabel).slice(0, 60)} | Pipeline: ${data.data?.detection?.pipelineLabel || data.detection?.pipelineLabel || 'Universal'} | PromptID: ${promptId} | เวลา: ${jobTime}s` });

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

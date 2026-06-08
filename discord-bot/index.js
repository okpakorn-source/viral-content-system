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

function getQueuePosition(item) {
  return queue.indexOf(item) + 1;
}

function getQueueStatus() {
  if (activeCount === 0 && queue.length === 0) return '🟢 ว่าง';
  if (activeCount > 0 && queue.length === 0) return `🟡 กำลังทำงาน (${activeCount})`;
  return `🔴 กำลังทำงาน (${activeCount}) | รอคิว: ${queue.length}`;
}

async function processQueue() {
  if (activeCount >= MAX_CONCURRENT || queue.length === 0) return;

  const job = queue.shift();
  activeCount++;

  // แจ้งคนที่อยู่ในคิวว่าตำแหน่งเปลี่ยน
  queue.forEach(async (q, idx) => {
    try {
      await q.processingMsg.edit(`📋 คิวลำดับที่ **${idx + 1}** — ${getQueueStatus()}\nรอสักครู่นะครับ...`).catch(() => {});
    } catch {}
  });

  try {
    await job.processingMsg.edit(`⚡ เริ่มประมวลผลแล้ว! กำลังอ่านข้อมูลและปั้นบทความไวรัล...\n${getQueueStatus()}`);
    await processNewsJob(job);
  } catch (err) {
    console.error('[Queue] Job failed:', err.message);
  } finally {
    activeCount--;
    // ดึงงานถัดไป
    if (queue.length > 0) {
      processQueue();
    }
  }
}

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

client.once('ready', () => {
  console.log(`✅ บอทพร้อมทำงานแล้ว! ล็อกอินในชื่อ ${client.user.tag}`);
  console.log(`📋 Queue System: max ${MAX_CONCURRENT} concurrent | Dedup window: ${DEDUP_WINDOW_MS / 1000}s`);
});

client.on('messageCreate', async (message) => {
  // ไม่ตอบโต้บอทด้วยกันเอง
  if (message.author.bot) return;

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

  // 1.5 Handle !ปัง command for self-optimizing prompts
  if (content.startsWith('!ปัง')) {
    const args = content.split(' ');
    if (args.length < 2) {
      return message.reply('⚠️ กรุณาระบุรหัส Prompt เช่น `!ปัง prompt_12345`');
    }
    const promptId = args[1].trim();
    try {
      await axios.put(`${API_URL.replace('/api/auto/stream', '/api/prompt-library').replace('/api/auto/process', '/api/prompt-library')}`, {
        id: promptId,
        action: 'feedback',
        feedback: { likes: 50, shares: 10, comments: 20 } // Simulated boost
      });
      return message.reply(`🎉 **ขอบคุณสำหรับฟีดแบ็ก!** ระบบได้เพิ่มคะแนนความปังให้ \`${promptId}\` แล้วครับ AI จะเรียนรู้และเก่งขึ้น! 🚀`);
    } catch (e) {
      return message.reply(`❌ ไม่สามารถอัปเดตคะแนนได้: ${e.message}`);
    }
  }

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

    // === QUEUE SYSTEM ===
    if (activeCount >= MAX_CONCURRENT) {
      const queuePosition = queue.length + 1;
      const processingMsg = await message.reply(`📋 รับทราบครับ! คิวลำดับที่ **${queuePosition}** — ตอนนี้กำลังทำข่าวของคนอื่นอยู่\nรอสักครู่นะครับ จะทำให้เร็วที่สุด! ⏳`);

      const job = { message, content, processingMsg, addedAt: Date.now() };
      queue.push(job);

      console.log(`[Queue] Added job #${queuePosition} from ${message.author.tag} | Queue: ${queue.length}`);
      return; // จะถูกเรียกอัตโนมัติเมื่อ slot ว่าง
    }

    // Slot ว่าง — ทำเลย
    const processingMsg = await message.reply('รับทราบครับ! กำลังอ่านข้อมูลและปั้นบทความไวรัล รอสักครู่นะครับ ⚡...');
    const job = { message, content, processingMsg, addedAt: Date.now() };

    activeCount++;
    try {
      await processNewsJob(job);
    } catch (err) {
      console.error('[Direct] Job failed:', err.message);
    } finally {
      activeCount--;
      // ดึงงานถัดไปจากคิว
      if (queue.length > 0) {
        processQueue();
      }
    }
  }
});

// ═══════════════════════════════════════════
// 📰 Process News Job — ฟังก์ชันประมวลผลข่าวจริง
// ═══════════════════════════════════════════
async function processNewsJob(job) {
  const { message, content, processingMsg } = job;
  const jobStartTime = Date.now();

  try {
    // เตรียมข้อมูลยิง API
    const payload = {
      input: content,
      images: [],
      contentLength: 'short',
      userId: `discord-${message.author.id}`,
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

    const jobId = addData.jobId;
    const initialPosition = addData.position;
    const queuesAhead = addData.queuesAhead || 0;

    if (queuesAhead > 0) {
      await processingMsg.edit(`📋 คิวลำดับที่ **${initialPosition}** — มี ${queuesAhead} คิวก่อนหน้า\nประมาณ ${queuesAhead * 3} นาที ⏳`).catch(() => {});
    } else {
      await processingMsg.edit(`⚡ เริ่มประมวลผลแล้ว! กำลังอ่านข้อมูลและปั้นบทความไวรัล...`).catch(() => {});
    }

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
            { at: 0,   done: 2,   icon: '🔍', label: 'ตรวจจับแหล่งข้อมูล',       detail: 'ตรวจสอบประเภท URL และพลัตฟอร์ม',              model: null },
            { at: 2,   done: 12,  icon: '📡', label: 'ดึงเนื้อหาจากเว็บ',        detail: 'Firecrawl → Jina → Direct fetch',              model: null },
            { at: 12,  done: 26,  icon: '📰', label: 'สกัดเนื้อข่าว (AI)',       detail: 'สกัด newsTitle + newsBody + category',          model: 'Gemini 2.0 Flash' },
            { at: 26,  done: 68,  icon: '🔍', label: 'วิเคราะห์มุมข่าว (AI)',    detail: 'core story + key points + possible angles',      model: 'GPT-5.5' },
            { at: 68,  done: 85,  icon: '🧬', label: 'วาง Emotional Blueprint',  detail: 'emotional arc: hook → twist → CTA',              model: 'GPT-5.5' },
            { at: 85,  done: 100, icon: '🌐', label: 'ค้นหาข้อมูล Google',       detail: 'Smart Research × 3 angles (Serper API)',          model: null },
            { at: 100, done: 180, icon: '⚡', label: 'Classic + Enhanced (Parallel)', detail: '2 Angles รันพร้อมกัน — Claude Sonnet 4 × 2', model: 'Claude Sonnet 4' },
            { at: 180, done: 999, icon: '🚀', label: 'สรุปผลและบันทึก',          detail: 'รวมผลลัพธ์ + บันทึกลงคลัง',                    model: null },
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
          const progressBar = buildProgressBar(elapsed, 280); // 280s = worker timeout

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
          .setDescription(`${(v.content || 'ไม่พบเนื้อหา').slice(0, 3800)}\n\n---\n*🔥 โพสต์แล้วปัง? พิมพ์ \`!ปัง ${promptId}\` เพื่อสอนให้ระบบเก่งขึ้น!*`)
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
    await processingMsg.edit(`❌ เกิดข้อผิดพลาดในการประมวลผล: ${error.response?.data?.error || error.message}`).catch(() => {});
  }
}

client.login(TOKEN);

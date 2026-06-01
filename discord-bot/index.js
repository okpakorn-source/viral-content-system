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
      images: [], // สามารถอัปเกรดให้ดึงรูปจาก message.attachments ได้ในอนาคต
      contentLength: 'short'
    };

    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['x-api-key'] = API_KEY;

    let streamUrl = API_URL;
    if (streamUrl.endsWith('/api/auto/process')) {
      streamUrl = streamUrl.replace('/api/auto/process', '/api/auto/stream');
    }

    const response = await axios.post(streamUrl, payload, {
      headers,
      responseType: 'stream',
      timeout: 330000 // 5.5 นาที
    });

    let finalData = null;
    let errorData = null;
    let tickCount = 0;
    let buffer = '';
    let stepLogs = []; // เก็บประวัติ log ทั้งหมด

    // ประมวลผลข้อมูลที่ไหลกลับมาจาก Vercel (Streaming Ticks)
    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // เก็บส่วนที่ยังไม่ครบถ้วนไว้ใน buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'done' || parsed.type === 'result') {
            finalData = parsed.data;
          } else if (parsed.type === 'error') {
            errorData = parsed.error;
          } else if (parsed.type === 'log') {
            // แสดงสถานะการทำงานจริงแบบเรียลไทม์ (สะสม log)
            tickCount++;
            const dots = '.'.repeat((tickCount % 3) + 1);
            const stepName = parsed.data.step;
            const stepMsg = parsed.data.msg;
            
            // เก็บเฉพาะ 5-6 ขั้นตอนล่าสุด เพื่อไม่ให้ข้อความยาวเกินไป
            stepLogs.push(`✅ \`[${stepName}]\` ${stepMsg}`);
            if (stepLogs.length > 7) stepLogs.shift();
            
            const logDisplay = stepLogs.join('\n');
            const queueInfo = queue.length > 0 ? `\n\n📋 รอคิว: ${queue.length} งาน` : '';
            processingMsg.edit(`กำลังทำงาน... ⚡${dots}\n\n**ขั้นตอนการประมวลผล:**\n${logDisplay}${queueInfo}`).catch(() => {});
          }
        } catch (e) {
          // ข้ามบรรทัดที่ parse ไม่ได้
        }
      }
    });

    // รอจนกว่าสายจะตัด
    await new Promise((resolve, reject) => {
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });

    if (errorData) {
      throw new Error(errorData);
    }

    const data = finalData;
    if (!data || !data.success) {
      throw new Error(data?.error || 'API Processing Failed (No Data)');
    }

    // ดึงเวอร์ชันทั้งหมด (รองรับสูงสุด 10 เวอร์ชันเพื่อส่งมอบทั้ง Classic และ Enhanced)
    const allVersions = data.analysisResult?.versions || data.data?.analysisResult?.versions || [];
    const versionsToShow = allVersions.slice(0, 10);
    
    if (versionsToShow.length === 0) {
      throw new Error('ไม่พบเนื้อหาที่สร้างเสร็จ');
    }

    const jobTime = ((Date.now() - jobStartTime) / 1000).toFixed(1);
    await processingMsg.edit({ content: `✅ สร้างเนื้อหาสำเร็จแล้ว! (${versionsToShow.length} เวอร์ชัน | ใช้เวลา ${jobTime}s)` });

    // ส่งทีละ 1 เวอร์ชันเพื่อป้องกันข้อจำกัด 6000 ตัวอักษรต่อ 1 ข้อความของ Discord API
    const chunkSize = 1;
    for (let i = 0; i < versionsToShow.length; i += chunkSize) {
      const chunk = versionsToShow.slice(i, i + chunkSize);
      
      const embeds = chunk.map((v, index) => {
        const actualIndex = i + index;
        const versionLabel = v._sourceLabel || v.style || `Version ${actualIndex + 1}`;
        const isEnhanced = v._source === 'enhanced';
        const promptId = v.promptId || (data.data?.usedPromptInfo?.name ? 'Dynamic' : 'Unknown');
        
        return new EmbedBuilder()
          .setColor(isEnhanced ? '#10b981' : '#f91880') // สีเขียวสำหรับ Enhanced, สีชมพูสำหรับ Classic
          .setTitle(`[${versionLabel}] ${data.newsData?.newsTitle || 'AI Content Result'}`.slice(0, 250))
          .setDescription(`${(v.content || 'ไม่พบเนื้อหา').slice(0, 3800)}\n\n---\n*🔥 โพสต์แล้วปัง? พิมพ์ \`!ปัง ${promptId}\` เพื่อสอนให้ระบบเก่งขึ้น!*`)
          .setFooter({ text: `สร้างโดย Pipeline: ${data.detection?.pipelineLabel || 'Universal'} | PromptID: ${promptId}` });
      });

      await message.reply({ embeds: embeds });
    }

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

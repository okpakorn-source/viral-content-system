/**
 * 📡 Live Status Relay — แปลง log ดิบของ 2 ระบบเป็น "สถานะอ่านง่าย เรียลไทม์" แยกไฟล์
 *   🖼️ ระบบสร้างปก   → _LOG_ปก.txt         (จาก _prodserver_out.log + _prodserver3001_out.log)
 *   🎙️ ระบบถอดประเด็น → _LOG_ถอดประเด็น.txt  (จาก _clip_worker_out.log)
 * รัน: node live-status-relay.mjs (รันค้างไว้ — poll ทุก 2 วิ เขียนเฉพาะบรรทัดสำคัญ+เวลา)
 * ผู้ใช้เปิดดูสด: Get-Content _LOG_ปก.txt -Wait -Tail 30
 */
import fs from 'fs';

const COVER_PATTERNS = [
  [/CoverV3\] identity:/, '1️⃣ วิเคราะห์ข่าว (identity)'],
  [/Multi-agent search/, '2️⃣ เริ่มค้นภาพ'],
  [/Agent1: Google\] ✅ Total: (\d+)/, '   🔎 Google ได้ $1 ภาพ'],
  [/Agent3: Context\] ✅ Total: (\d+)/, '   🔎 บริบทได้ $1 ภาพ'],
  [/Tier REAL v2: เฟรมจริง/, '   🎬 เฟรมคลิปตรงข่าว'],
  [/Pool cache (HIT|SAVED|CLEARED)/, '   🗄️ พูลภาพ: $1'],
  [/QualityLock\] 🔒/, '3️⃣ คัดภาพส่ง Judge (เรียงคุณภาพ)'],
  [/EyeScreen ส่องแล้ว (\d+)\/(\d+)/, '   👁️ ตาส่องภาพจริง $1/$2 ใบ'],
  [/Judge\] ✅ Selected (\d+) images/, '   ⚖️ Judge รับ $1 ภาพ'],
  [/QualityLock\] 🛟/, '   🛟 เติมพูลชุดสำรอง'],
  [/face boxes: .*ลายน้ำ: (\d+)/, '4️⃣ ตรวจหน้า/ลายน้ำ (ลายน้ำ $1 ใบ)'],
  [/เลือกโครง: (\S+)/, '5️⃣ Director เลือกโครง $1'],
  [/✂️ (\w+): FaceLock/, '6️⃣ ✂️ ตาครอปช่อง $1 (เห็นภาพจริง)'],
  [/✂️ FinalCropper .*ตัดสิน (\d+)\/(\d+)/, '6️⃣ ✂️ ตาครอปตัดสินครบ $1/$2 ช่อง'],
  [/S2 enhance: (\d+) upscaled/, '7️⃣ ✨ เพิ่มความคม $1 ภาพ'],
  [/👁️ Eye-After: (.+)/, '8️⃣ 👁️ ตาตรวจไฟนอล: $1'],
  [/👁️ swap (\w+)/, '   👁️ สลับภาพช่อง $1'],
  [/👁️ Eye-After แก้/, '   👁️ แก้ตามตาตรวจ → ประกอบใหม่'],
  [/archived as (CASE-\d+)/, '9️⃣ 💾 เก็บเข้าคลัง $1'],
  [/CoverV3\] ✅ Done in ([\d.]+)s/, '🏁 เสร็จ ($1 วิ)'],
  [/INSUFFICIENT_QUALITY_IMAGES|ภาพใช้ได้ \d+ ใบ/, '❌ ล้ม: ภาพไม่พอทำปก'],
  [/Pipeline error/, '❌ ล้ม: pipeline error'],
];
const CLIP_PATTERNS = [
  [/claim|รับงาน|processing/i, '▶️ รับงานเข้าประมวลผล'],
  [/yt-dlp|download/i, '   ⬇️ โหลดวิดีโอ'],
  [/gemini|insight/i, '   🧠 AI ถอดประเด็น'],
  [/done|สำเร็จ|completed/i, '✅ ถอดเสร็จ'],
  [/error|failed|ล้ม/i, '❌ ล้ม'],
];

const SOURCES = [
  { file: '_prodserver_out.log', out: '_LOG_ปก.txt', tag: '3000', patterns: COVER_PATTERNS, raw: true },
  { file: '_prodserver3001_out.log', out: '_LOG_ปก.txt', tag: '3001', patterns: COVER_PATTERNS, raw: true },
  { file: '_clip_worker_out.log', out: '_LOG_ถอดประเด็น.txt', tag: 'worker', patterns: CLIP_PATTERNS, raw: false },
];
const offsets = new Map();
const ts = () => new Date().toLocaleTimeString('th-TH', { hour12: false });

for (const s of SOURCES) {
  try { fs.appendFileSync(s.out, `\n═══ 📡 relay เริ่ม ${new Date().toLocaleString('th-TH')} ═══\n`); } catch {}
}

function pump() {
  for (const s of SOURCES) {
    try {
      if (!fs.existsSync(s.file)) continue;
      const size = fs.statSync(s.file).size;
      // 🐛 fix 2 ก.ค.: เดิม `prev = get() ?? size` แล้ว continue ก่อน set → offset ไม่เคยถูกจำ = ไม่เคยอ่านอะไรเลย
      let prev = offsets.get(s.file);
      if (prev === undefined) { offsets.set(s.file, size); continue; } // รอบแรก: จำท้ายไฟล์ไว้ (เอาเฉพาะของใหม่)
      if (size < prev) { offsets.set(s.file, 0); prev = 0; } // ไฟล์ถูกรีเซ็ต (server restart) → อ่านจากต้น
      if (size === prev) continue;
      const fd = fs.openSync(s.file, 'r');
      const buf = Buffer.alloc(size - prev);
      fs.readSync(fd, buf, 0, buf.length, prev);
      fs.closeSync(fd);
      offsets.set(s.file, size);
      const lines = buf.toString('utf8').split('\n');
      const outLines = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        for (const [re, label] of s.patterns) {
          const m = line.match(re);
          if (m) {
            let msg = label;
            for (let g = 1; g < (m.length || 1); g++) msg = msg.replace(`$${g}`, m[g] ?? '');
            outLines.push(`[${ts()}][${s.tag}] ${msg}`);
            break;
          }
        }
      }
      if (outLines.length) fs.appendFileSync(s.out, outLines.join('\n') + '\n');
    } catch { /* อ่านพลาดข้ามรอบ */ }
  }
}
setInterval(pump, 2000);
console.log('📡 live-status-relay ทำงาน — เขียน _LOG_ปก.txt / _LOG_ถอดประเด็น.txt ทุก 2 วิ');

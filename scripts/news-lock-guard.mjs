/**
 * 🔒 NEWS-WRITING SYSTEM LOCK — Claude Code PreToolUse guard (28 มิ.ย. 2026 — ผู้ใช้สั่ง)
 * ─────────────────────────────────────────────────────────────────────────────
 * ป้องกัน "ระบบเขียนข่าวอัตโนมัติ" ไม่ให้ถูกแก้โดยไม่ได้รับอนุญาต
 *   ทำงานเป็น hook PreToolUse (matcher: Edit|Write|MultiEdit) — อ่าน tool input จาก stdin
 *   ถ้า file_path เป็นไฟล์ที่ถูกล็อก → คืน permissionDecision="ask" (ให้ผู้ใช้ยืนยันก่อนทุกครั้ง)
 *   ไฟล์อื่น (ปก/คลิป/คิว ฯลฯ) → ผ่านปกติ
 * 🔴 รายชื่อไฟล์ล็อกตรงกับ SYSTEM_LOCKED_FILES.md — แก้ที่เดียวให้ตรงกัน
 */
import fs from 'fs';

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch {}

const ti = data.tool_input || {};
const fp = ti.file_path || ti.path || ti.notebook_path || '';
const norm = String(fp).replace(/\\/g, '/');

// 🔒 ระบบเขียนข่าวอัตโนมัติ — ห้ามแก้โดยไม่ได้รับอนุญาต
const PROTECTED = [
  /\/src\/lib\/services\/autoFlowService\.js$/i,
  /\/src\/lib\/services\/autoFlowServiceText\.js$/i,
  /\/src\/lib\/services\/summarizeService\.js$/i,
  /\/src\/lib\/services\/summarizeServiceText\.js$/i,
  /\/src\/lib\/ai\/aiRouter\.js$/i,
  /\/src\/lib\/ai\/openai\.js$/i,
  /\/src\/lib\/ai\/promptStore\.js$/i,
  /\/src\/lib\/ai\/promptStoreText\.js$/i,
  /\/src\/lib\/ai\/modelConfig\.js$/i,
  /\/src\/app\/api\/auto\//i,
  /\/src\/app\/api\/summarize\//i,
  /\/src\/app\/api\/extract\//i,
  /\/src\/app\/api\/research-search\//i,
  /\/src\/app\/content\/new\/page\.js$/i,
  /\/scripts\/validate-workflow\.mjs$/i,
  // ★ เสริม 10 ก.ค. 69 (หลังปิดเคส #01641) — ไฟล์หัวใจที่เคยหลุดลิสต์:
  /\/src\/lib\/ai\/claudeClient\.js$/i,        // ตัวเขียนหลัก (Claude) — กฎเหล็ก+Safety อยู่ที่นี่
  /\/src\/lib\/ai\/geminiClient\.js$/i,        // ตัวสกัดข่าว chain แรก
  /\/src\/lib\/ai\/safetyFilter\.js$/i,        // ตัวกรองคำเสี่ยง sanitizeOutput
  /\/src\/lib\/correction\//i,                 // ด่านตรวจ/แก้ทั้งชุด (outputAudit, correctionPipeline)
  /\/src\/lib\/utils\/withTimeout\.js$/i,      // เพดานเวลาทุกขั้น + ป้าย failedStep
  /\/src\/lib\/services\/queueService\.js$/i,  // คิวงาน atomic claim/supersede
  /\/src\/app\/api\/queue\//i,                 // worker + add (dedup/routing)
  /\/src\/lib\/persistStore\.js$/i,            // ชั้นเก็บข้อมูล + fallback ไฟล์
  /\/scripts\/news-lock-guard\.mjs$/i,         // ล็อกตัวล็อกเอง — แก้ลิสต์ต้องยืนยันเสมอ
];

if (norm && PROTECTED.some((re) => re.test(norm))) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason:
        '🔒🔴 ไฟล์นี้เป็น "ระบบเขียนข่าวอัตโนมัติ" ที่ถูกล็อก (' + norm.split('/').slice(-2).join('/') + ') — ' +
        'กฎเหล็ก: ห้ามแก้โดยไม่ได้รับอนุญาตจากเจ้าของ ต้องยืนยันก่อนทุกครั้ง',
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

process.exit(0);

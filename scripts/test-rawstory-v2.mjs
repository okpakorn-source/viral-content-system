#!/usr/bin/env node
/**
 * scripts/test-rawstory-v2.mjs
 * ------------------------------------------------------------------
 * สคริปต์ยิงเทส "คลิปจริง" (ไม่ใช่เทสจำลอง) สำหรับ API ถอดความ/วิเคราะห์คลิป
 * รับลิงก์คลิปจาก argv → ยิง POST ไปที่ /api/clip-transcript/insight
 * แล้วพิมพ์รายงานผลลัพธ์ให้คนอ่านง่าย พร้อมตรวจกลไกอัตโนมัติ 3 ข้อ
 *
 * วิธีใช้:
 *   node scripts/test-rawstory-v2.mjs <url> [--base http://localhost:3900] [--force]
 *
 * ข้อกำหนด:
 *   - Node.js 18+ (ใช้ fetch ในตัว ไม่มีไลบรารีภายนอก)
 *   - timeout 15 นาที เผื่อคลิปยาว
 *   - exit 1 เฉพาะกรณี: ใช้งานผิดรูปแบบ / เชื่อมต่อไม่ได้ / HTTP ไม่ใช่ 200 / body ไม่ใช่ JSON
 *     (ผลตรวจ PASS/FAIL เป็นเพียงตัวช่วยเบื้องต้น — คนต้องอ่าน rawStory ด้วยตาเองเสมอ)
 */

// ---------- ค่าคงที่ ----------
const DEFAULT_BASE = 'http://localhost:3900';        // เซิร์ฟเวอร์ปลายทางเริ่มต้น
const INSIGHT_PATH = '/api/clip-transcript/insight'; // endpoint ถอดความ/วิเคราะห์คลิป
const TIMEOUT_MS = 15 * 60 * 1000;                   // timeout 15 นาที (รองรับคลิปยาว)

// คำต้องห้ามในเนื้อ rawStory (ภาษาอ้อม/คำประจืบที่ระบบห้ามใช้)
const FORBIDDEN_WORDS = [
  'ชื่อดัง',
  'สร้างแรงบันดาลใจ',
  'เป็นบทเรียน',
  'ประทับใจ',
  'ซาบซึ้ง',
  'น่าชื่นชม',
  'คลิปนี้แสดงให้เห็น',
];

// อักขระที่ถือว่า "จบประโยคสมบูรณ์" (ถ้าไม่ลงท้ายด้วยพวกนี้ = น่าสงสัยว่าถูกตัดกลางคำ)
const SENTENCE_ENDINGS = new Set(['.', '!', '?', '…', '"', "'", '”', '’', ')', ']', 'ฯ']);

// ---------- ฟังก์ชันช่วย ----------

// พิมพ์วิธีใช้งานสั้นๆ
function printUsage() {
  console.error('วิธีใช้: node scripts/test-rawstory-v2.mjs <url> [--base http://localhost:3900] [--force]');
}

// แยกอาร์กิวเมนต์บรรทัดคำสั่ง: <url> [--base <base>|--base=<base>] [--force]
function parseArgs(argv) {
  let url = null;
  let base = DEFAULT_BASE;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') {
      force = true;
    } else if (a === '--base') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: 'กรุณาระบุค่าหลัง --base' };
      base = v;
    } else if (a.startsWith('--base=')) {
      base = a.slice('--base='.length);
      if (!base) return { error: 'กรุณาระบุค่าหลัง --base=' };
    } else if (!a.startsWith('--') && url === null) {
      url = a;
    } else {
      return { error: `อาร์กิวเมนต์ไม่รู้จักหรือระบุซ้ำ: ${a}` };
    }
  }

  if (!url) return { error: 'ไม่ได้ระบุลิงก์คลิป (url)' };
  return { url, base, force };
}

// ดึงค่าตัวแรกที่ "มีจริง" จากหลายชื่อคีย์ (กันกรณีชื่อฟิลด์ต่างกันเล็กน้อย)
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// แปลงตัวเลขวินาทีเป็น mm:ss (ถ้าไม่ใช่ตัวเลขก็คืนค่าเดิมเป็นสตริง)
function fmtTime(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return String(v);
}

// ชื่อประเด็น (รองรับทั้ง topic ที่เป็น object และเป็น string ตรงๆ)
function topicTitle(t) {
  if (t === null || typeof t !== 'object') return String(t);
  return String(pick(t, ['title', 'name', 'topic', 'heading']) ?? '(ไม่มีชื่อ)');
}

// ช่วงเวลาของประเด็น: ใช้ฟิลด์สำเร็จรูปก่อน ไม่มีก็ประกอบจาก start/end
function topicTimeRange(t) {
  const direct = pick(t, ['timeRange', 'range', 'timeSpan', 'time']);
  if (direct !== undefined) return String(direct);
  const start = pick(t, ['start', 'startSec', 'startTime', 'from']);
  const end = pick(t, ['end', 'endSec', 'endTime', 'to']);
  if (start !== undefined && end !== undefined) return `${fmtTime(start)}–${fmtTime(end)}`;
  return '—';
}

// ความยาวของประเด็น: ถ้ามีเนื้อข้อความให้วัดตัวอักษร ถ้าไม่มีให้ใช้ duration / end-start
function topicLength(t) {
  for (const k of ['text', 'content', 'summary', 'body']) {
    if (typeof t?.[k] === 'string') return `${t[k].length.toLocaleString('en-US')} ตัวอักษร`;
  }
  if (typeof t?.duration === 'number') return `${t.duration} วินาที`;
  const start = pick(t, ['start', 'startSec', 'startTime', 'from']);
  const end = pick(t, ['end', 'endSec', 'endTime', 'to']);
  if (typeof start === 'number' && typeof end === 'number') return `${end - start} วินาที`;
  return '—';
}

// แสดงจำนวนพร้อมหน่วย ถ้าไม่มีฟิลด์ให้บอกชัดๆ ว่าไม่มี (ห้ามเดาเป็น 0)
function fmtCount(n, unit) {
  if (n === null || n === undefined) return '— (ไม่มีฟิลด์นี้ในผลลัพธ์)';
  return `${n.toLocaleString('en-US')} ${unit}`;
}

// ---------- ตัวหลัก ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`✗ ${args.error}`);
    printUsage();
    process.exit(1);
  }

  const endpoint = args.base.replace(/\/+$/, '') + INSIGHT_PATH;

  // แจ้งสิ่งที่กำลังจะยิงก่อน (เผื่อรอนาน คนรันจะได้รู้ว่าค้างตรงไหน)
  console.log('════════════════ ยิงเทส RawStory V2 (คลิปจริง) ════════════════');
  console.log(`URL คลิป  : ${args.url}`);
  console.log(`เซิร์ฟเวอร์: ${endpoint}`);
  console.log(`โหมด      : ${args.force ? 'force (ข้ามแคชคลัง ถอดสด)' : 'ปกติ (ใช้แคชได้)'}`);
  console.log(`กำลังยิง POST ... (timeout ${TIMEOUT_MS / 60000} นาที)`);

  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: args.url, force: args.force }),
      signal: AbortSignal.timeout(TIMEOUT_MS), // กันค้าง: ยกเลิกเมื่อเกิน 15 นาที
    });
  } catch (err) {
    // กรณีเน็ตเวิร์กพัง / เซิร์ฟเวอร์ไม่เปิด / หมดเวลา
    const isTimeout = err?.name === 'TimeoutError';
    const why = isTimeout
      ? `หมดเวลา ${TIMEOUT_MS / 60000} นาที`
      : (err?.cause?.code ?? err?.message ?? String(err));
    console.error(`✗ ยิงคำขอไม่สำเร็จ: ${why}`);
    process.exit(1);
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const rawText = await res.text(); // อ่านเป็นข้อความดิบก่อน เผื่อต้องพิมพ์กรณีผิดพลาด

  // HTTP ต้องเป็น 200 เท่านั้น ไม่ใช่ให้พิมพ์ข้อความดิบ 300 ตัวแรกแล้วจบ
  if (res.status !== 200) {
    console.error(`✗ HTTP ${res.status} (ใช้เวลา ${elapsedSec} วินาที) — ข้อความดิบ 300 ตัวแรก:`);
    console.error(rawText.slice(0, 300));
    process.exit(1);
  }

  // body ต้องเป็น JSON เท่านั้น
  let data;
  try {
    data = JSON.parse(rawText);
    // route คืนรูป { success, data:{...} } — ผลจริงอยู่ชั้นใน (แก้ 3 ส.ค. หลังเทสรอบแรกอ่านผิดชั้น)
    if (data && typeof data === 'object' && data.data && typeof data.data === 'object') data = data.data;
  } catch {
    console.error(`✗ body ไม่ใช่ JSON (ใช้เวลา ${elapsedSec} วินาที) — ข้อความดิบ 300 ตัวแรก:`);
    console.error(rawText.slice(0, 300));
    process.exit(1);
  }

  // ---------- รายงานของเดิม ----------
  console.log('');
  console.log(`ตอบกลับ   : HTTP ${res.status} · ใช้เวลา ${elapsedSec} วินาที`);
  console.log('');
  console.log('── ของเดิม ──');
  console.log(`rawData   : ${fmtCount(typeof data?.rawData === 'string' ? data.rawData.length : null, 'ตัวอักษร')}`);
  console.log(`keyPoints : ${fmtCount(Array.isArray(data?.keyPoints) ? data.keyPoints.length : null, 'ข้อ')}`);
  console.log(`quotes    : ${fmtCount(Array.isArray(data?.quotes) ? data.quotes.length : null, 'ประโยค')}`);
  console.log(`subStories: ${fmtCount(Array.isArray(data?.subStories) ? data.subStories.length : null, 'ประเด็น')}`);
  console.log(`lowQuality: ${data?.lowQuality === undefined || data?.lowQuality === null ? '— (ไม่มีฟิลด์นี้ในผลลัพธ์)' : String(data.lowQuality)}`);

  // ---------- รายงานของใหม่ (rawStoryV2) ----------
  const v2 = data?.rawStoryV2 ?? null;
  const rawStory = typeof v2?.rawStory === 'string' ? v2.rawStory : null;
  const topics = Array.isArray(v2?.topics) ? v2.topics : [];

  console.log('');
  console.log('── ของใหม่ (data.rawStoryV2) ──');
  if (!v2) {
    console.log('ไม่พบ rawStoryV2 ในผลลัพธ์');
  } else {
    console.log(`rawStory : ${rawStory !== null ? `${rawStory.length.toLocaleString('en-US')} ตัวอักษร` : '— (ไม่มีหรือไม่ใช่สตริง)'}`);
    console.log(`topics   : ${topics.length} ประเด็น`);
    topics.forEach((t, i) => {
      console.log(`  ${i + 1}. ${topicTitle(t)}`);
      console.log(`     ช่วงเวลา: ${topicTimeRange(t)} · ความยาว: ${topicLength(t)}`);
    });
    console.log(`promptRev: ${v2?.promptRev ?? '— (ไม่มีฟิลด์นี้ในผลลัพธ์)'}`);
    console.log(`note     : ${v2?.note ?? '— (ไม่มีฟิลด์นี้ในผลลัพธ์)'}`);
  }

  // ---------- พิมพ์เนื้อ rawStory เต็มๆ ให้คนตรวจด้วยตา ----------
  console.log('');
  console.log('── เนื้อ rawStory เต็ม (ตรวจด้วยตาว่าตรงคลิปจริงไหม) ──');
  console.log('┌──────────────────────────────────────────────────────────────');
  console.log(rawStory ?? '(ไม่มีเนื้อ rawStory ให้แสดง)');
  console.log('└──────────────────────────────────────────────────────────────');

  // ---------- ตรวจกลไกอัตโนมัติ 3 ข้อ ----------
  const checks = [];

  // (1) ต้องมี rawStoryV2 ในผลลัพธ์
  checks.push({ name: 'มี rawStoryV2 ในผลลัพธ์', pass: Boolean(v2) });

  // (2) rawStory ต้องลงท้ายด้วยประโยคสมบูรณ์ ไม่ถูกตัดกลางคำ
  let endPass = false;
  let endDetail = 'ไม่มี rawStory ให้ตรวจ';
  if (rawStory !== null) {
    // ★ แก้ 3 ส.ค.: ภาษาไทยไม่จบประโยคด้วยจุด — จบด้วยพยัญชนะ/สระเป็นเรื่องปกติ
    //   สัญญาณ "ถูกตัด" จริงคือ ชนเพดาน normalize (12000) หรือค้างที่วรรณยุกต์/สระลอย/จุดไข่ปลา
    const trimmed = rawStory.trimEnd();
    const lastChar = trimmed.length > 0 ? trimmed[trimmed.length - 1] : '';
    const danglingMark = /[ัิ-ฺ็-๎]$/.test(trimmed); // สระบน-ล่าง/วรรณยุกต์ลอยท้าย
    const hitCap = trimmed.length >= 11900;
    const openQuote = (trimmed.match(/[“"]/g) || []).length % 2 === 1; // เปิดคำพูดค้างไม่ปิด
    endPass = trimmed.length > 0 && !danglingMark && !hitCap && !openQuote
      && (SENTENCE_ENDINGS.has(lastChar) || /[฀-๿a-zA-Z0-9)\]]/.test(lastChar));
    endDetail = endPass
      ? `จบสมบูรณ์ (ลงท้าย "${lastChar}")`
      : `น่าจะถูกตัด: ${hitCap ? 'ชนเพดาน 12000 ตัวอักษร' : danglingMark ? 'ค้างที่วรรณยุกต์/สระลอย' : openQuote ? 'เปิดเครื่องหมายคำพูดค้าง' : `อักขระสุดท้าย "${lastChar || '(ว่าง)'}"`}`;
  }
  checks.push({ name: 'rawStory ลงท้ายด้วยประโยคสมบูรณ์ (ไม่ถูกตัดกลางคำ)', pass: endPass, detail: endDetail });

  // (3) ห้ามมีคำต้องห้ามในเนื้อ rawStory — เจอที่ไหนเก็บบรรทัดนั้นมาเตือน
  const hits = [];
  if (rawStory !== null) {
    rawStory.split('\n').forEach((line, idx) => {
      for (const w of FORBIDDEN_WORDS) {
        if (line.includes(w)) hits.push({ lineNo: idx + 1, word: w, text: line.trim() });
      }
    });
  }
  checks.push({ name: 'ไม่พบคำต้องห้ามในเนื้อ rawStory', pass: hits.length === 0 });

  console.log('');
  console.log('── ผลตรวจกลไกอัตโนมัติ ──');
  checks.forEach((c, i) => {
    console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${i + 1}) ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  });
  // พิมพ์บรรทัดที่เจอคำต้องห้ามออกมาเตือนทุกจุด
  for (const h of hits) {
    console.log(`  ⚠ คำต้องห้าม "${h.word}" ที่บรรทัด ${h.lineNo}: ${h.text}`);
  }

  const passCount = checks.filter((c) => c.pass).length;
  console.log('');
  console.log(`สรุปรวม: ${passCount === checks.length ? 'PASS' : 'FAIL'} (ผ่าน ${passCount}/${checks.length} ข้อ)`);
  console.log('หมายเหตุ: ผลตรวจนี้เป็นแค่กลไกเบื้องต้น — ความถูกต้องของเนื้อหาต้องเทียบกับคลิปจริงด้วยตาเสมอ');
}

main().catch((err) => {
  // กันข้อผิดพลาดที่ไม่คาดคิด ไม่ให้สคริปต์เงียบหาย
  console.error(`✗ เกิดข้อผิดพลาดที่ไม่คาดคิด: ${err?.stack ?? err}`);
  process.exit(1);
});

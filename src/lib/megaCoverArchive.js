// ============================================================
// 🗂️ MEGA Cover Archive — คลังงานปก MEGA (แยกจากคลังปกทั่วไป CASE-xxx)
// ------------------------------------------------------------
// เก็บ record ต่อปกที่ทำเสร็จ (จาก /cover-ref-test + MEGA s7_wait) ลง data/mega-cover-runs.json
// ไฟล์ภาพจริงอยู่ public/mega-covers/ (คลังนี้เก็บแค่ metadata + path)
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'mega-cover-runs.json');
const MAX = 500;

async function readAll() {
  try {
    const t = await fs.readFile(FILE, 'utf8');
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/** ดึงรายการปกในคลัง (ใหม่สุดก่อน) */
export async function listMegaCovers(limit = 200) {
  const all = await readAll();
  return all.slice(-limit).reverse();
}

/** บันทึกปก 1 ใบเข้าคลัง (auto จากท่อทำปก) — ล้มไม่ critical ต่อการทำปก */
export async function addMegaCover(rec = {}) {
  const all = await readAll();
  const entry = {
    id: rec.id || `MCV-${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    title: rec.title || '',
    source: rec.source || 'mega',        // 'cover-ref-test' | 'mega'
    imageCaseId: rec.imageCaseId || null, // AC-xxxx (ระบบ keyword)
    coverCaseId: rec.coverCaseId || null, // CASE-xxx (คลังปกทั่วไป)
    coverPath: rec.coverPath || null,     // /mega-covers/xxx.jpg
    template: rec.template || '',
    score: rec.score ?? null,
    throughMega: rec.throughMega !== false,
    trace: Array.isArray(rec.trace) ? rec.trace.map((t) => ({ stage: t.stage, status: t.status })) : undefined,
  };
  all.push(entry);
  const trimmed = all.slice(-MAX);
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch {
    /* เขียนคลังไม่ได้ก็ไม่ให้ล้มการทำปก */
  }
  return entry;
}

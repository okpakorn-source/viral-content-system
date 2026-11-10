// ของใช้ร่วมของชุดทดลอง "นักเขียนแบบเลียนครู" (10 พ.ย. 69) — ใช้บนเครื่องทีมเท่านั้น ไม่อยู่ในท่อจริง
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// scratch/ อยู่ใน .gitignore — ผลทดลองไม่เข้า git · ตั้ง TEACHER_TRIAL_DIR เพื่อทดลองชุดข่าวอื่นแยกโฟลเดอร์ (เช่น เนื้อดิบที่ค้นและตรวจเอง)
export const OUT_DIR = process.env.TEACHER_TRIAL_DIR
  ? path.resolve(ROOT, process.env.TEACHER_TRIAL_DIR)
  : path.join(ROOT, 'scratch', 'teacher-trial');

export function outPath(name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  return path.join(OUT_DIR, name);
}

export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n', 'utf8'); }

/** โหลดคีย์ที่ระบุจาก .env.local เข้า process.env (ไม่พิมพ์ค่า · ไม่ทับค่าที่ตั้งไว้แล้ว) */
export function loadEnvKeys(keys) {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || !keys.includes(m[1]) || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

/** รันงานพร้อมกันไม่เกิน limit */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

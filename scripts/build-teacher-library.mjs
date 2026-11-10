// สร้างคลังครู 254 โพสต์ (data/teacher-library.json) — 10 พ.ย. 69
// รวม 2 แหล่งที่เคยขึ้นระบบ 26 ต.ค. 69 เข้าเป็นไฟล์เดียวที่นักเขียนแบบครูใช้:
//   ① การ์ด 254 ใบ   (data/prompt-library.json ณ commit eaf2229f)  → หมวด/อารมณ์/เหตุผลที่โพสต์ได้ผล/ลิงก์/ยอดวิว
//   ② โพสต์ฉบับเต็ม  (data/admin-voice-exemplars.json ณ commit eaf2229f) → เนื้อโพสต์จริงครบทุกตัวอักษร
// (การ์ดเก็บโพสต์ไว้แค่ 500 ตัวอักษรแรก จึงต้องดึงฉบับเต็มจากแหล่ง ②)
//
// รัน:  node scripts/build-teacher-library.mjs            (อ่านจากประวัติ git)
//       node scripts/build-teacher-library.mjs --check    (ตรวจว่าไฟล์ปัจจุบันตรงกับที่สร้างได้ ไม่เขียนทับ)
// สคริปต์นี้อ่านอย่างเดียวจาก git + เขียนไฟล์ผลลัพธ์ไฟล์เดียว ไม่แตะฐานข้อมูล ไม่เรียก AI
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyOpening, countWordsThai } from '../src/lib/services/teacherLibrary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_COMMIT = 'eaf2229f';
const OUT_FILE = path.join(ROOT, 'data', 'teacher-library.json');

function readFromGit(relPath) {
  const raw = execFileSync('git', ['show', `${SOURCE_COMMIT}:${relPath}`], {
    cwd: ROOT, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8',
  });
  return JSON.parse(raw);
}

function build() {
  const cards = readFromGit('data/prompt-library.json');
  const posts = readFromGit('data/admin-voice-exemplars.json');
  const postById = new Map(posts.map((p) => [String(p.id), p]));

  const teachers = [];
  const problems = [];
  for (const card of cards) {
    const postId = String(card.sourceContentId || '').replace(/^fb_/, '');
    const full = postById.get(postId);
    if (!full || !String(full.caption || '').trim()) {
      problems.push(`การ์ด ${card.id} หาโพสต์เต็มไม่เจอ (sourceContentId=${card.sourceContentId})`);
      continue;
    }
    const post = String(full.caption).replace(/\r\n/g, '\n').trim();
    // ตรวจว่าเป็นโพสต์เดียวกันจริง: ท่อนต้นที่การ์ดเก็บไว้ต้องตรงกับโพสต์เต็ม
    const head = (s) => String(s || '').replace(/\s+/g, '').slice(0, 100);
    if (head(card.exampleContent) !== head(post)) {
      problems.push(`การ์ด ${card.id} ท่อนต้นไม่ตรงกับโพสต์เต็ม ${postId}`);
      continue;
    }
    teachers.push({
      id: `fb_${postId}`,
      cardId: card.id,
      name: card.promptName,
      category: card.category,
      targetCategories: card.targetCategories || [],
      emotionalTags: card.emotionalTags || [],
      conflictTags: card.conflictTags || [],
      narrativeArchetype: card.narrativeArchetype || '',
      hookStyle: card.hookStyle || '',
      viralScore: card.viralScore ?? null,
      whyItWorks: card.whyItWorks || '',
      views: Number(full.views) || Number(card.sourceViews) || 0,
      author: card.sourceAuthor || '',
      url: card.sourcePostUrl || '',
      openingType: classifyOpening(post),
      words: countWordsThai(post),
      post,
    });
  }
  // เรียงตายตัว (id) ให้ไฟล์ที่สร้างซ้ำได้ผลเหมือนเดิมทุกไบต์
  teachers.sort((a, b) => a.id.localeCompare(b.id));
  return { teachers, problems, cardCount: cards.length, postCount: posts.length };
}

const { teachers, problems, cardCount, postCount } = build();
const payload = {
  _about: 'คลังครู 254 โพสต์จริงของเพจ (ยอดวิว ≥ 3 ล้าน) — สร้างด้วย scripts/build-teacher-library.mjs ห้ามแก้ด้วยมือ',
  sourceCommit: SOURCE_COMMIT,
  count: teachers.length,
  teachers,
};
const json = JSON.stringify(payload, null, 1) + '\n';

console.log(`การ์ด ${cardCount} ใบ · โพสต์เต็ม ${postCount} โพสต์ · จับคู่ได้ ${teachers.length}`);
if (problems.length) {
  console.error(`❌ จับคู่ไม่ครบ ${problems.length} รายการ:`);
  for (const p of problems.slice(0, 20)) console.error('   ' + p);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
  if (current === json) { console.log('✅ data/teacher-library.json ตรงกับแหล่งต้นทาง'); process.exit(0); }
  console.error('❌ data/teacher-library.json ไม่ตรงกับที่สร้างได้จากแหล่งต้นทาง — รันสคริปต์นี้ใหม่โดยไม่ใส่ --check');
  process.exit(1);
}

fs.writeFileSync(OUT_FILE, json, 'utf8');
const byCat = {};
const byOpen = {};
for (const t of teachers) { byCat[t.category] = (byCat[t.category] || 0) + 1; byOpen[t.openingType] = (byOpen[t.openingType] || 0) + 1; }
console.log(`✅ เขียน ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(0)} KB)`);
console.log('หมวด:', Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(' | '));
console.log('วิธีเปิด:', Object.entries(byOpen).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(' | '));

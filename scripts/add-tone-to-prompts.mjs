/**
 * Script: add-tone-to-prompts.mjs
 * เพิ่ม tone: 'positive' | 'neutral' | 'negative' ให้ prompt-library.json ทุกตัว
 * ตัดสินจาก:
 *   1. field `tone` ที่มีอยู่แล้ว (เป็นภาษาไทย) เช่น "ดราม่าเข้มข้น"
 *   2. hookStyle, emotionalTags, promptText, promptName
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const FILE_PATH = join(process.cwd(), 'data', 'prompt-library.json');

// คำที่บ่งชี้ว่า negative (เชิงลบ, ด่า, โจมตี, สร้างความโกรธ)
const NEGATIVE_KEYWORDS = [
  'ให้คนโกรธ', 'เปิดด้วยช็อก', 'ตัวร้าย', 'ประจาน', 'แฉ', 'โจมตี', 'เผด็จการ',
  'ท้าทาย', 'ปะทะ', 'ด่า', 'สาด', 'ขยี้', 'ขุด', 'กล่าวหา', 'ระเบิด', 'แตก',
  'เปิดโปง', 'ก้าวร้าว', 'หยาบ', 'รุนแรง', 'เกลียด', 'ชัง', 'ด่าทอ',
  'สร้างความเกลียดชัง', 'ปลุกระดม', 'ยุยง', 'สาดโคลน', 'ทำลาย', 'ขุดเรื่อง',
  'เผยความจริงอันเจ็บปวด', 'หักหน้า', 'ชิงดี', 'แข่งขัน',
];

// คำที่บ่งชี้ว่า positive (เชิงบวก, อบอุ่น, แรงบันดาลใจ, กระตุ้น)
const POSITIVE_KEYWORDS = [
  'อบอุ่น', 'แรงบันดาลใจ', 'ชื่นชม', 'ฟิน', 'น่ารัก', 'กตัญญู', 'ซาบซึ้ง',
  'ประทับใจ', 'สดใส', 'ความหวัง', 'ดีใจ', 'ยินดี', 'ชนะใจ', 'ชัยชนะ',
  'บวก', 'positive', 'uplift', 'warmth', 'hope', 'inspire', 'หมั่นเพียร',
  'เอาใจใส่', 'ดูแล', 'รัก', 'ห่วงใย', 'เมตตา', 'น้ำใจ', 'ช่วยเหลือ',
  'สู้ชีวิต', 'ฮีโร่', 'เสียสละ', 'พลิกชีวิต', 'ความสำเร็จ', 'ภูมิใจ',
];

// คำที่บ่งชี้ว่า neutral (ข่าว, ดราม่า, เล่าเรื่อง, ชวนถกเถียง)
// (default fallback คือ neutral)

function classifyTone(prompt) {
  // ถ้า tone field เดิมมีอยู่ (ภาษาไทย) ลองอ่านก่อน
  const existingTone = (prompt.tone || '').toLowerCase();
  
  // ถ้า tone เดิมมีคำที่ชัดเจน
  if (existingTone.includes('ลบ') || existingTone.includes('negative')) return 'negative';
  if (existingTone.includes('บวก') || existingTone.includes('positive')) return 'positive';
  
  // รวมข้อมูลสำหรับ classify
  const textToCheck = [
    prompt.tone || '',
    prompt.promptName || '',
    prompt.hookStyle || '',
    prompt.promptText || '',
    (prompt.emotionalTags || []).join(' '),
    (prompt.conflictTags || []).join(' '),
    prompt.writingStyle || '',
    prompt.structure || '',
    prompt.narrativeArchetype || '',
  ].join(' ').toLowerCase();

  // นับคะแนน
  let negScore = 0;
  let posScore = 0;
  
  for (const kw of NEGATIVE_KEYWORDS) {
    if (textToCheck.includes(kw.toLowerCase())) negScore++;
  }
  for (const kw of POSITIVE_KEYWORDS) {
    if (textToCheck.includes(kw.toLowerCase())) posScore++;
  }
  
  // Special patterns จาก tone field เดิม
  if (/ดราม่าเข้มข้น|เข้มข้น/.test(existingTone)) {
    // ดราม่าเข้มข้น = neutral (เล่าเรื่องดราม่าแต่ไม่ toxic)
    negScore = Math.max(0, negScore - 2);
  }
  if (/อบอุ่น|บวก|แรงบันดาล/.test(existingTone)) {
    posScore += 3;
  }
  if (/สะเทือนใจ|ดราม่า|เล่าเรื่อง/.test(existingTone)) {
    // ดราม่าทั่วไป = neutral
  }
  
  if (negScore > posScore && negScore >= 2) return 'negative';
  if (posScore > negScore && posScore >= 2) return 'positive';
  return 'neutral';
}

async function main() {
  console.log('📖 Reading prompt-library.json...');
  const raw = await readFile(FILE_PATH, 'utf-8');
  const prompts = JSON.parse(raw);
  
  console.log(`📊 Total prompts: ${prompts.length}`);
  
  const stats = { positive: 0, neutral: 0, negative: 0, total: 0 };
  
  const updated = prompts.map(p => {
    const toneClass = classifyTone(p);
    stats[toneClass]++;
    stats.total++;
    return {
      ...p,
      toneClass, // เพิ่ม field ใหม่ 'toneClass' เพื่อไม่ overwrite 'tone' เดิมที่เป็นภาษาไทย
    };
  });
  
  console.log(`\n📊 Classification results:`);
  console.log(`  ✅ positive: ${stats.positive}`);
  console.log(`  ➡️  neutral:  ${stats.neutral}`);
  console.log(`  ❌ negative: ${stats.negative}`);
  console.log(`  📦 total:   ${stats.total}`);
  
  // Sample check — print first 5
  console.log('\n📝 Sample classifications:');
  updated.slice(0, 5).forEach(p => {
    console.log(`  [${p.toneClass}] ${p.promptName || p.id} | tone=${p.tone}`);
  });
  
  await writeFile(FILE_PATH, JSON.stringify(updated, null, 2), 'utf-8');
  console.log('\n✅ prompt-library.json updated with toneClass field!');
}

main().catch(console.error);

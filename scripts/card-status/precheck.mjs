/**
 * precheck.mjs — พรีเช็คฟรี F11 (ก่อนจ่ายเงิน Gate 2) · คลังการ์ด v2 เฟส 1 ข้อ 3.2
 * แบบ: docs/proposals/NEWS-CARD-LIBRARY-DESIGN-FINAL-3sep69.md §2 แถว F11 —
 *   "พรีเช็คฟรีก่อนจ่ายเงิน Gate 2: รัน mapCategory+scoreLibraryPrompts ออฟไลน์กับข่าวหมวดใหม่ 337 ข่าวใน
 *    archive — การ์ดหมวดตรงติด top-8 ≥ 80% ไม่ผ่าน = จูน alias/ชื่อการ์ด (หรือค่อยพิจารณา CONFLICT_CLUSTERS)
 *    ก่อนเริ่ม Gate 2 | สคริปต์ใน run-dir (อ่านอย่างเดียว)"
 *
 * อ่านอย่างเดียวทั้งหมด — ไม่เขียน DB/Supabase ไม่เขียนไฟล์ในโปรเจกต์ ไม่ยิง API ไม่ใช้ API key ใดๆ
 * (ทุกอินพุตเป็นไฟล์ในเครื่อง: data/news-archive.json + card-arms/B.json)
 *
 * วิธี:
 *  1) อ่าน data/news-archive.json (1,403 ข่าว) — คัดข่าวหมวดใหม่ 3 หมวดด้วยคีย์เวิร์ด "scout"
 *     (regex MISSING ก๊อปตรงจาก C:\tmp\news-r233-run\card-design\03-raw-samples.mjs ซึ่งใช้คีย์เวิร์ดชุด
 *     เดียวกับ card-proposal\03-missing-cats.mjs ที่ผ่านผู้ตรวจไขว้แล้ว 3 ก.ย. 69 — ไม่แก้แม้ตัวอักษรเดียว
 *     เพื่อให้ตัวเลขเทียบกับรายงานสำรวจ (card-design-scout-3sep69.md) ได้ตรง: คดีความ 116 · ศาสนา-งานบุญ 154 ·
 *     กีฬาแข่งขัน 67 = 337) — นับดิบจากพาดหัว+สรุป+เนื้อข่าว ไม่กรองความยาว body (ตัวนับ "counts" ต้นทาง
 *     ก็ไม่กรองเช่นกัน — ตัวกรอง body≥400 ใช้เฉพาะตอนเลือกตัวอย่างใน raw-samples.json คนละหน้าที่)
 *     ข่าวเดียวเข้าได้มากกว่า 1 หมวดถ้าคีย์เวิร์ดชนหลายกลุ่ม (พฤติกรรมต้นฉบับ) — นับแยกเป็นเคสต่อหมวด
 *  2) import ตรงจากไฟล์จริง (ไม่แก้ ไม่ก๊อปสูตร): scoreLibraryPrompts (src/lib/services/promptMatcher.js)
 *     + mapCategory/getKnownCategories (src/lib/ai/semanticClusters.js) — ต้องมี loader เล็กๆ แปลง
 *     specifier '@/…' → ไฟล์จริงใต้ src/ ก่อน เพราะ '@/' ใน jsconfig.json เป็น path alias ของ
 *     Next.js/webpack (+ TS intellisense) ล้วนๆ, node เปล่าไม่รู้จัก — พิสูจน์แล้วว่า import ตรงๆ ล้ม
 *     ด้วย "Cannot find package '@/lib'" ถ้าไม่มี loader นี้ (ไม่มีวิธีอื่นที่ import ไฟล์จริงได้โดยไม่ต้องมี)
 *  3) ตั้ง env NEW_CARD_CATS_V1=1 (ตามที่แบบสั่ง) ก่อนเรียกทั้งสองฟังก์ชัน — ปิด (ไม่ตั้ง) จะเห็นแค่ 10
 *     หมวดเดิม ไม่มี 3 หมวดใหม่ให้ทดสอบเลย
 *  4) newsAnalysis ต่อข่าว = { primaryCategory: <archive.category ดิบ> } เท่านั้น — จงใจไม่ปั้น
 *     secondaryCategories/emotionalTags/conflictTags/narrativeArchetype/viralHooks เพิ่มเอง เพราะ:
 *       (ก) พรีเช็คต้อง "ฟรี/ออฟไลน์" — ไม่มี AI มาวิเคราะห์ข่าวเก็บ archive ใหม่ (นั่นคือสิ่งที่ Gate 2
 *           เสียเงินทำ พรีเช็คนี้มีไว้กรองก่อนถึงจุดนั้น)
 *       (ข) ⚠️ ข้อจำกัดที่ต้องรู้ (Fable ตรวจ 3 ก.ย. 69): archive.category มาจากตัวจำแนกของ newsArchiveService
 *           (รายการ การเมือง|สังคม|อาชญากรรม|อุบัติเหตุ|บันเทิง|กีฬา|...|ศาสนา|ทั่วไป) — "ไม่ใช่" ป้ายที่ท่อข่าวจริงใช้
 *           เลือกการ์ด: promptMatcher รับ newsAnalysis.primaryCategory/secondaryCategories จาก Stage-1 ของ
 *           summarizeServiceText (รายการปิด 10 หมวด: ช่วยเหลือกัน…ชีวิตพลิกผัน — ไม่มี ศาสนา/กีฬา · มี ข่าวอาชญากรรม)
 *           ดังนั้น hit-rate ที่ได้ = ตัวชี้วัด "ป้ายชุด archive นำทางไปหมวดใหม่ได้แค่ไหน" เท่านั้น ไม่ใช่ตัวเลขของ
 *           production · ข้อสรุปที่ใช้ได้จากสคริปต์นี้: (1) เมื่อหมวดชี้ถูก การ์ดใหม่ติด top-8 ได้จริง (2) หมวดใหม่
 *           จะถูกเลือกใน production ได้ก็ต่อเมื่อ Stage-1 ตอบชื่อหมวดนั้นได้ (ต้องเพิ่มในรายการพรอมต์ Stage-1
 *           ใต้สวิตช์ — สาย G) · การวัดของจริงทำใน Gate 1 ด้วย Stage-1 จริง ไม่ใช่ที่นี่
 *  5) รัน scoreLibraryPrompts(newsAnalysis, คลังแขน B 177 ใบ) ต่อข่าว (ค่าเริ่มต้น mismatchPenalty=false
 *     — เส้นทางเดียวกับ "analyze" ที่ป้อน luna ตาม card-design-scout-3sep69.md §2.4) → top-8 (ไม่ตั้ง
 *     PROMPT_VARIETY_BAND จึงไม่มีการสุ่มสลับอันดับ — deterministic ทุกครั้งที่รัน) → hit = มีการ์ดที่
 *     mapCategory(card.category) ตรงหมวดเป้าหมายอยู่ใน top-8 ไหม
 *  6) รายงาน hit-rate ต่อหมวด (เกณฑ์ผ่าน ≥80%) + ตัวอย่างพลาดสูงสุด 5 ใบ (กระจายรอบหมวดที่พลาด) — ไม่ถึง
 *     80% ห้ามแก้ที่นี่ (สคริปต์นี้อ่านอย่างเดียว) ให้เสนอแก้ alias/คีย์เวิร์ด (semanticClusters.js) /
 *     CONFLICT_CLUSTERS / ชื่อการ์ด (data/card-library-v2) เป็นข้อเสนอแยกต่างหาก
 *
 * รัน: node scripts/card-status/precheck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { ROOT, RUN_DIR } from './plan-schema.mjs';

// ── loader: แปลง '@/xxx' → ไฟล์จริงใต้ src/ (jsconfig paths เป็นของ Next/webpack เท่านั้น — node เปล่า
//    ต้องมี loader hook ถึงจะ resolve ได้ · ทดสอบแล้วว่าไม่มี loader = import ล้มด้วย ERR_MODULE_NOT_FOUND) ──
const ROOT_SLASH = ROOT.replace(/\\/g, '/');
const loaderSrc = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    let rel = specifier.slice(2);
    if (!/\\.[a-zA-Z]+$/.test(rel)) rel += '.js';
    return nextResolve('file:///' + ${JSON.stringify(ROOT_SLASH)} + '/src/' + rel, context);
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(loaderSrc)}`);

// ต้องตั้งก่อนเรียก mapCategory/scoreLibraryPrompts ครั้งแรก (newCardCatsOn() อ่าน env สดทุกครั้งที่เรียก
// แต่ effectiveCategoryMap() แคชผลไว้หลังเรียกครั้งแรก — ตั้งแต่ต้นไฟล์กันพลาด)
process.env.NEW_CARD_CATS_V1 = '1';

const { scoreLibraryPrompts } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'services', 'promptMatcher.js')).href);
const { mapCategory, getKnownCategories } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'ai', 'semanticClusters.js')).href);

// ── คีย์เวิร์ด "scout" (ก๊อปตรงจาก card-design/03-raw-samples.mjs — ผ่านผู้ตรวจไขว้แล้ว 3 ก.ย. 69 ·
//    ไม่แก้แม้ตัวอักษรเดียวเพื่อให้ตัวเลขเทียบของเดิมได้ตรง) ──
const NEW_CATS = ['คดีความ', 'ศาสนา-งานบุญ', 'กีฬาแข่งขัน'];
const MISSING = {
  'ศาสนา-งานบุญ': /พระสงฆ์|พระภิกษุ|เจ้าอาวาส|หลวงพ่อ|หลวงปู่|หลวงพี่|หลวงตา|ทำบุญ|ตักบาตร|กฐิน|ผ้าป่า|สังฆทาน|อนุโมทนา|บวช|มรณภาพ|สามเณร|งานบุญ|ไหว้พระ|เข้าวัด|ถวาย/,
  'กีฬาแข่งขัน': /นักกีฬา|ฟุตบอล|วอลเลย์บอล|นักมวย|มวยไทย|แบดมินตัน|เทควันโด|ทีมชาติ|เหรียญทอง|เหรียญเงิน|เหรียญทองแดง|ซีเกมส์|โอลิมปิก|เอเชียนเกมส์|แชมป์โลก|ลงสนาม|นัดชิง|ฟุตซอล|กรีฑา|ยกน้ำหนัก|ตะกร้อ|นักเตะ|นักวิ่ง|มาราธอน/,
  'คดีความ': /คดี|ขึ้นศาล|ชั้นศาล|ศาลตัดสิน|ศาลสั่ง|ศาลอุทธรณ์|ศาลฎีกา|ฟ้องร้อง|ยื่นฟ้อง|ถูกฟ้อง|ทนายความ|พิพากษา|จำคุก|ประกันตัว|อัยการ|ยกฟ้อง|ไกล่เกลี่ย|หมายจับ|แจ้งความ|ดำเนินคดี/,
};
function classify(text) {
  const t = String(text || '');
  const hits = [];
  for (const [cat, re] of Object.entries(MISSING)) if (re.test(t)) hits.push(cat);
  return hits;
}

async function main() {
  const ARCHIVE_PATH = path.join(ROOT, 'data', 'news-archive.json');
  const ARM_B_PATH = path.join(RUN_DIR, 'card-arms', 'B.json');

  const archive = JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'));
  const armB = JSON.parse(fs.readFileSync(ARM_B_PATH, 'utf8'));

  const knownCats = getKnownCategories();
  console.log(`[precheck] NEW_CARD_CATS_V1=1 → getKnownCategories() = ${knownCats.length} หมวด: ${knownCats.join(', ')}`);
  for (const c of NEW_CATS) {
    if (!knownCats.includes(c)) console.log(`[precheck] ⚠️ หมวด "${c}" ไม่อยู่ใน getKnownCategories() — ผิดคาด ตรวจ semanticClusters.js`);
  }
  console.log(`[precheck] news-archive: ${archive.length} ข่าว · คลังแขน B: ${armB.length} ใบ (${ARM_B_PATH})`);

  // ── คัดข่าวหมวดใหม่ + ทดสอบ top-8 ทีละเคส ──
  const results = { 'คดีความ': [], 'ศาสนา-งานบุญ': [], 'กีฬาแข่งขัน': [] };
  for (const news of archive) {
    const corpus = `${news.title || ''}\n${news.summary || ''}\n${news.body || ''}`;
    const buckets = classify(corpus);
    for (const targetCategory of buckets) {
      const newsAnalysis = { primaryCategory: String(news.category || '') };
      const scored = scoreLibraryPrompts(newsAnalysis, armB);
      const top8 = scored.slice(0, 8).map((s) => armB[s.index]);
      const hitCard = top8.find((c) => mapCategory(c.category || '') === targetCategory);
      results[targetCategory].push({
        id: news.id,
        title: String(news.title || '').slice(0, 90),
        archiveCategory: news.category || '(ว่าง)',
        mappedPrimary: mapCategory(newsAnalysis.primaryCategory),
        hit: !!hitCard,
        hitRank: hitCard ? top8.indexOf(hitCard) + 1 : null,
        top8Categories: top8.map((c) => c.category),
      });
    }
  }
  const totalTested = NEW_CATS.reduce((n, c) => n + results[c].length, 0);

  // ── สรุปผลต่อหมวด (เกณฑ์ผ่าน ≥80%) ──
  const THRESHOLD = 0.8;
  const perCategory = {};
  let overallPass = true;
  for (const cat of NEW_CATS) {
    const rows = results[cat];
    const hits = rows.filter((r) => r.hit).length;
    const rate = rows.length ? hits / rows.length : 0;
    const pass = rate >= THRESHOLD;
    if (!pass) overallPass = false;
    perCategory[cat] = { newsChecked: rows.length, hits, hitRate: +rate.toFixed(4), pass };
    console.log(`[precheck] ${pass ? '✅' : '⚠️'} ${cat}: top-8 ติดการ์ดหมวดตรง ${hits}/${rows.length} = ${(rate * 100).toFixed(1)}% (เกณฑ์ ≥80%)`);
  }

  // ── ตัวอย่างพลาด สูงสุด 5 ใบ กระจายรอบหมวดที่พลาด (round-robin) ──
  const missByCat = Object.fromEntries(NEW_CATS.map((c) => [c, results[c].filter((r) => !r.hit)]));
  const missExamples = [];
  for (let round = 0; missExamples.length < 5 && NEW_CATS.some((c) => missByCat[c].length > round); round += 1) {
    for (const cat of NEW_CATS) {
      if (missExamples.length >= 5) break;
      const r = missByCat[cat][round];
      if (r) {
        const top8Cats = [...new Set(r.top8Categories)].join('/');
        missExamples.push(`[${cat}] ${r.id} "${r.title}" — archive.category="${r.archiveCategory}" → mapCategory="${r.mappedPrimary}" (top-8 หมวด: ${top8Cats})`);
      }
    }
  }

  console.log(`[precheck] รวมทดสอบ ${totalTested} เคส (คดีความ ${results['คดีความ'].length} · ศาสนา-งานบุญ ${results['ศาสนา-งานบุญ'].length} · กีฬาแข่งขัน ${results['กีฬาแข่งขัน'].length}` +
    `${totalTested !== new Set(NEW_CATS.flatMap((c) => results[c].map((r) => r.id))).size ? ' — มีข่าวชนหลายหมวดจึงถูกนับซ้ำ' : ''})`);
  console.log(`[precheck] ตัวอย่างพลาด (${missExamples.length}/5):`);
  for (const m of missExamples) console.log('   - ' + m);

  const finalResult = {
    newsChecked: totalTested,
    top8HitRateByCategory: Object.fromEntries(NEW_CATS.map((c) => [c, perCategory[c].hitRate])),
    perCategory,
    pass: overallPass,
    missExamples,
  };
  console.log('[precheck] ── JSON ──');
  console.log(JSON.stringify(finalResult, null, 2));
  return finalResult;
}

await main();

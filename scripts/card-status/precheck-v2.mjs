/**
 * precheck-v2.mjs — พรีเช็คฟรี F11 รอบ 2 (Fable 3 ก.ย. 69) — วัด 3 ตัวเลขแยกกัน แทน precheck.mjs เดิม
 * ที่ป้อน archive.category (ป้ายโต๊ะข่าว) ซึ่งไม่ใช่ป้ายที่ท่อจริงใช้ (ดูหมายเหตุ (ข) ใน precheck.mjs)
 *
 *  (1) oracle    — ป้อนชื่อหมวดใหม่ตรงๆ เป็น primaryCategory → การ์ดหมวดตรงติด top-8 ไหม = "เพดานของคลังการ์ด"
 *  (2) replay    — ป้ายจริงที่ท่อเคยตีจาก breakdown (ข้อความอิสระ) จาก 2 แหล่ง:
 *                    (ก) C:\tmp\news-r233-run\result-*.json → breakdownData.primaryCategory/secondaryCategories
 *                    (ข) Supabase generation_logs.pipeline_info.newsType (อ่านอย่างเดียว · ทุกเคส production)
 *                  → mapCategory ตอนสวิตช์ปิด/เปิด ไปหมวดไหน · ป้ายที่ "ควร" เป็นหมวดใหม่ (regex อ้างอิงบนตัวป้าย)
 *                    นำทางไปหมวดใหม่ได้กี่ % (routing) · ป้ายที่ไม่ควร แต่ถูกดูดเข้าหมวดใหม่กี่ % (false-positive)
 *  (3) stress    — ป้อน "พาดหัวข่าว" ทั้งประโยคของข่าว archive ที่ไม่ใช่หมวดใหม่ (ตาม regex scout) เข้า mapCategory
 *                  ตอนเปิดสวิตช์ → กี่ % ถูกดูดเข้าหมวดใหม่ + คีย์ไหนเป็นตัวการ — เป็น "เพดานบน" ของความเสี่ยงคีย์กว้าง
 *                  (พาดหัวยาวกว่าป้ายจริงมาก ตัวเลขนี้จึงสูงเกินจริง ใช้ชี้คีย์ที่อันตราย ไม่ใช่ใช้เป็น FP จริง)
 *
 * อ่านอย่างเดียวทั้งหมด · ไม่เขียน DB · ไม่ยิง AI · บันทึก sha ของแขน B + git rev คู่ผล
 * รัน: node scripts/card-status/precheck-v2.mjs [--limit 1000] [--no-supabase] [--out <file.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { ROOT, RUN_DIR, sha256Hex, loadEnvLocal, parseCliArgs } from './plan-schema.mjs';

const ROOT_SLASH = ROOT.replace(/\\/g, '/');
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    let rel = specifier.slice(2);
    if (!/\\.[a-zA-Z]+$/.test(rel)) rel += '.js';
    return nextResolve('file:///' + ${JSON.stringify(ROOT_SLASH)} + '/src/' + rel, context);
  }
  return nextResolve(specifier, context);
}`)}`);

const args = parseCliArgs(process.argv.slice(2), { flags: ['--no-supabase'], options: ['--limit', '--out'] });
const LIMIT = Number(args.limit || 1000);

const { scoreLibraryPrompts } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'services', 'promptMatcher.js')).href);
const SC = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'ai', 'semanticClusters.js')).href);
const { mapCategory, getKnownCategories } = SC;

// ผู้ตัดสินอ้างอิง (SHOULD กว้าง / SCOUT เข้ม / NOT ยกเว้น) แยกไว้ที่ precheck-oracle.mjs — เทส card-status-scripts ค้ำว่าคีย์โค้ดทุกตัวถูก SHOULD หมวดตัวเองรับ
// ตัวเลขหลักที่อ่าน = routedStrict (SCOUT รับรอง) คู่กับ routing กว้าง · routedLooseOnly ต้องอ่านด้วยตาเสมอ (รอบหักล้าง 3 ก.ย. 69 รอบ 2: SHOULD กับคีย์โค้ดใช้คำร่วม กีฬา/บุญ/ธรรม/วัด/ทนาย → FP=0 ตีความเดี่ยวๆ ไม่ได้)
import { NEW_CATS, SCOUT, shouldBe, scoutOk } from './precheck-oracle.mjs';
const withSwitch = (on, fn) => { const prev = process.env.NEW_CARD_CATS_V1; if (on) process.env.NEW_CARD_CATS_V1 = '1'; else delete process.env.NEW_CARD_CATS_V1; try { return fn(); } finally { if (prev === undefined) delete process.env.NEW_CARD_CATS_V1; else process.env.NEW_CARD_CATS_V1 = prev; } };

// ── inputs ──
const ARM_B_PATH = path.join(RUN_DIR, 'card-arms', 'B.json');
const armRaw = fs.readFileSync(ARM_B_PATH, 'utf8');
const armB = JSON.parse(armRaw);
const armSha = sha256Hex(armRaw).slice(0, 12);
let gitRev = '?'; try { gitRev = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* ไม่มี git ก็ไม่เป็นไร */ }
const report = { generatedFor: 'F11-v2', armB: { path: ARM_B_PATH, sha12: armSha, cards: armB.length }, gitRev, knownCatsOn: withSwitch(true, () => getKnownCategories()) };
console.log(`[F11-v2] แขน B ${armB.length} ใบ sha=${armSha} · git ${gitRev} · หมวดตอนเปิด = ${report.knownCatsOn.join(', ')}`);

// ── (1) oracle ──
report.oracle = {};
withSwitch(true, () => {
  for (const cat of NEW_CATS) {
    const rows = [];
    for (const mismatchPenalty of [false, true]) {
      const scored = scoreLibraryPrompts({ primaryCategory: cat, secondaryCategories: [] }, armB, { mismatchPenalty });
      const top8 = scored.slice(0, 8).map((s) => armB[s.index]);
      const hits = top8.filter((c) => mapCategory(c.category || '') === cat);
      rows.push({ mismatchPenalty, hit: hits.length > 0, rankFirst: hits.length ? top8.indexOf(hits[0]) + 1 : null, top8: top8.map((c) => `${mapCategory(c.category || '')}:${c.promptName.slice(0, 28)}`) });
    }
    report.oracle[cat] = rows;
    console.log(`[oracle] ${cat}: ${rows.map((r) => `${r.mismatchPenalty ? 'penalty' : 'no-penalty'}=${r.hit ? '✅ อันดับ ' + r.rankFirst : '❌'}`).join(' · ')}`);
  }
});

// ── (2) replay: ป้ายจริง ──
const labels = []; // {label, source, title}
for (const f of fs.readdirSync(RUN_DIR).filter((x) => /^result-.*\.json$/.test(x))) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(RUN_DIR, f), 'utf8'));
    const bd = j?.body?.data?.breakdownData || j?.body?.breakdownData;
    const title = j?.body?.data?.newsData?.title || j?.body?.newsData?.title || f;
    if (bd?.primaryCategory) labels.push({ label: String(bd.primaryCategory), source: 'result:primary', title });
    for (const s of bd?.secondaryCategories || []) labels.push({ label: String(s), source: 'result:secondary', title });
  } catch { /* ข้ามไฟล์พัง */ }
}
let supaCount = 0;
if (!args['no-supabase']) {
  try {
    loadEnvLocal();
    const { getSupabase, isSupabaseReady } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'supabase.js')).href);
    if (isSupabaseReady()) {
      const sb = getSupabase();
      const { data, error } = await sb.from('generation_logs').select('case_id,news_title,created_at,pipeline_info').order('created_at', { ascending: false }).limit(LIMIT);
      if (error) throw new Error(error.message);
      for (const row of data || []) {
        const nt = row?.pipeline_info?.newsType;
        if (nt) { labels.push({ label: String(nt), source: 'generation_logs', title: row.news_title || row.case_id, desk: row?.pipeline_info?.desk?.category || null }); supaCount += 1; }
      }
      console.log(`[replay] generation_logs อ่าน ${data?.length || 0} เคส · มี newsType ${supaCount}`);
    } else console.log('[replay] ไม่พบกุญแจ Supabase — ใช้เฉพาะ result-*.json');
  } catch (e) { console.log(`[replay] อ่าน generation_logs ไม่ได้: ${e.message} — ใช้เฉพาะ result-*.json`); }
}
const distinct = new Map();
for (const l of labels) { const k = l.label.trim(); if (!k) continue; if (!distinct.has(k)) distinct.set(k, { label: k, n: 0, sources: new Set(), titles: [] }); const d = distinct.get(k); d.n += 1; d.sources.add(l.source); if (d.titles.length < 3) d.titles.push(String(l.title).slice(0, 50)); }
const rows = [...distinct.values()].map((d) => {
  const off = withSwitch(false, () => mapCategory(d.label));
  const on = withSwitch(true, () => mapCategory(d.label));
  const should = shouldBe(d.label);
  return { label: d.label, n: d.n, sources: [...d.sources], off, on, should, titles: d.titles };
});
const isNew = (c) => NEW_CATS.includes(c);
const shouldRows = rows.filter((r) => r.should.length);
const routed = shouldRows.filter((r) => isNew(r.on) && r.should.includes(r.on));
const missed = shouldRows.filter((r) => !isNew(r.on));
const wrongNew = rows.filter((r) => isNew(r.on) && !r.should.includes(r.on));
// เข้าหมวดใหม่โดย SHOULD (กว้าง) แต่ SCOUT (รูปเฉพาะ) ไม่รับรอง — ไม่นับเป็น FP อัตโนมัติ แต่ต้องอ่านด้วยตา (กันวงกลม SHOULD=คีย์โค้ด)
const routedLooseOnly = routed.filter((r) => !scoutOk(r.label, r.on));
const wtd = (list) => list.reduce((s, r) => s + r.n, 0);
report.replay = {
  labelsTotal: labels.length, distinct: rows.length, fromSupabase: supaCount,
  shouldNew: { distinct: shouldRows.length, weighted: wtd(shouldRows) },
  routing: { distinct: routed.length, weighted: wtd(routed), rateDistinct: shouldRows.length ? +(routed.length / shouldRows.length).toFixed(3) : null, rateWeighted: wtd(shouldRows) ? +(wtd(routed) / wtd(shouldRows)).toFixed(3) : null },
  falsePositive: { distinct: wrongNew.length, weighted: wtd(wrongNew), rateDistinct: rows.length ? +(wrongNew.length / (rows.length - shouldRows.length || 1)).toFixed(3) : null, rateWeighted: +(wtd(wrongNew) / (wtd(rows) - wtd(shouldRows) || 1)).toFixed(3) },
  perCategory: Object.fromEntries(NEW_CATS.map((c) => { const s = shouldRows.filter((r) => r.should.includes(c)); const ok = s.filter((r) => r.on === c); const strict = ok.filter((r) => scoutOk(r.label, c)); return [c, { should: s.length, shouldWeighted: wtd(s), routed: ok.length, routedWeighted: wtd(ok), rate: s.length ? +(ok.length / s.length).toFixed(3) : null, routedStrict: strict.length, looseOnly: ok.length - strict.length }]; })),
  routedStrict: { distinct: routed.length - routedLooseOnly.length, looseOnly: routedLooseOnly.length },
  routedList: routed.map((r) => `${r.n}× "${r.label}" → ${r.on}${scoutOk(r.label, r.on) ? '' : ' [SHOULD เท่านั้น — อ่านด้วยตา]'}`),
  routedLooseOnlyList: routedLooseOnly.map((r) => `${r.n}× "${r.label}" → ${r.on} · เช่น ${r.titles[0] || '-'}`),
  missedList: missed.map((r) => `${r.n}× "${r.label}" → ${r.on} (ควร ${r.should.join('/')})`),
  falsePositiveList: wrongNew.map((r) => `${r.n}× "${r.label}" → ${r.on}${r.off !== r.on ? ` (ปิด=${r.off})` : ''} · เช่น ${r.titles[0] || '-'}`),
  changedByswitch: rows.filter((r) => r.off !== r.on).length,
  distributionOn: rows.reduce((acc, r) => { acc[r.on] = (acc[r.on] || 0) + r.n; return acc; }, {}),
};
console.log(`[replay] ป้ายจริง ${labels.length} (distinct ${rows.length} · supabase ${supaCount}) · ป้ายที่ควรเป็นหมวดใหม่ ${shouldRows.length} distinct/${wtd(shouldRows)} ครั้ง`);
for (const c of NEW_CATS) { const p = report.replay.perCategory[c]; console.log(`[replay] ${c}: นำทางถูก ${p.routed}/${p.should} distinct (${p.rate === null ? '-' : Math.round(p.rate * 100) + '%'}) · ถ่วงความถี่ ${p.routedWeighted}/${p.shouldWeighted} · SCOUT รับรอง ${p.routedStrict} / อ่านด้วยตา ${p.looseOnly}`); }
console.log(`[replay] false-positive: ${wrongNew.length} distinct / ${wtd(wrongNew)} ครั้ง = ${Math.round(report.replay.falsePositive.rateWeighted * 100)}% ของป้ายที่ไม่ใช่หมวดใหม่`);
console.log('[replay] พลาด (ควรเข้าหมวดใหม่แต่ไม่เข้า):'); for (const m of report.replay.missedList.slice(0, 25)) console.log('   - ' + m);
console.log('[replay] false-positive (ไม่ควรเข้าแต่เข้า):'); for (const m of report.replay.falsePositiveList.slice(0, 25)) console.log('   - ' + m);
console.log(`[replay] เข้าหมวดใหม่โดย SHOULD เท่านั้น (SCOUT ไม่รับรอง — อ่านด้วยตา): ${routedLooseOnly.length}/${routed.length} distinct`); for (const m of report.replay.routedLooseOnlyList.slice(0, 40)) console.log('   - ' + m);

// ── (3) stress: พาดหัวข่าว archive ที่ไม่ใช่หมวดใหม่ ──
const archive = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'news-archive.json'), 'utf8'));
// dedupe ด้วยพาดหัว (ผู้หักล้างรอบ 2: ข่าวเดียวซ้ำ 8 entries ทำให้ FP นับซ้ำ 8 ครั้ง) — รายงานทั้ง raw และ dedup
// dedupe แบบ normalize (ตัดช่องว่าง/เครื่องหมาย · 40 ตัวอักษรแรก) — ข่าวเดียวเขียนพาดหัวต่างกันเล็กน้อย (น้องเฌอลีน ×3 · ทนายพัฒน์ ×3) ก็นับครั้งเดียว
const seenTitles = new Set();
const normTitle = (t) => String(t || '').replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 40);
const nonBucketRaw = archive.filter((n) => { const t = `${n.title || ''}\n${n.summary || ''}\n${n.body || ''}`; return !NEW_CATS.some((c) => SCOUT[c].test(t)); });
const nonBucket = nonBucketRaw.filter((n) => { const k = normTitle(n.title); if (!k || seenTitles.has(k)) return false; seenTitles.add(k); return true; });
const keyHits = {}; let stressFP = 0; const stressExamples = [];
withSwitch(true, () => {
  for (const n of nonBucket) {
    const title = String(n.title || ''); if (!title) continue;
    const on = mapCategory(title);
    if (isNew(on)) {
      stressFP += 1;
      const lower = title.toLowerCase();
      // ไม่มี export ตารางคีย์ใหม่ — หาคีย์ที่ปรากฏด้วยรายการเดา (รายการต้องตามคีย์โค้ดให้ครบ — ผู้หักล้างรอบ 3 พบขาด 26 ตัว เติมแล้ว)
      const guess = ['คดีความ', 'ฟ้องร้อง', 'คำพิพากษา', 'ศาลมีคำสั่ง', 'ศาลนัด', 'ศาลพิจารณา', 'ศาลอนุญาต', 'ศาลออกหมาย', 'ศาลแขวง', 'ศาลทหาร', 'ศาลแรงงาน', 'ศาลล้มละลาย', 'ศาลยุติธรรม', 'ศาสนา-งานบุญ', 'พระธุดงค์', 'พระลูกวัด', 'อุปสมบท', 'ถวายปัจจัย', 'อุทิศกุศล', 'อุทิศบุญ', 'ข่าวบุญ', 'กีฬาแข่งขัน', 'แข่งเรือ', 'แข่งจักรยาน', 'วิ่งแข่ง', 'ยกน้ำหนัก', 'ว่ายน้ำ', 'การแข่งขัน', 'สังฆราช', 'คณะสงฆ์', 'สำนักสงฆ์', 'คดี', 'ขึ้นศาล', 'ชั้นศาล', 'ศาลตัดสิน', 'ศาลสั่ง', 'ศาลอาญา', 'ศาลแพ่ง', 'ศาลปกครอง', 'ศาลรัฐธรรมนูญ', 'ศาลเยาวชน', 'ฟ้อง', 'กฎหมาย', 'ทนาย', 'พิพากษา', 'จำคุก', 'ประกันตัว', 'หมายจับ', 'ยกฟ้อง', 'ไต่สวน', 'ฎีกา', 'อุทธรณ์', 'อัยการ', 'หมายเรียก', 'แจ้งความ', 'วัด', 'ศาสนา', 'พระสงฆ์', 'พระภิกษุ', 'พระอาจารย์', 'พระครู', 'พระธรรม', 'พระที่ระลึก', 'พระเกจิ', 'พระพุทธรูป', 'หลวงพ่อ', 'หลวงปู่', 'หลวงตา', 'หลวงพี่', 'สามเณร', 'บวช', 'ตักบาตร', 'มรณภาพ', 'อนุโมทนา', 'สวดมนต์', 'โบสถ์', 'เทศน์', 'ทำบุญ', 'งานบุญ', 'ร่วมบุญ', 'ธรรมะ', 'ทางธรรม', 'กฐิน', 'ผ้าป่า', 'สังฆทาน', 'เวียนเทียน', 'บิณฑบาต', 'เจ้าอาวาส', 'เข้าพรรษา', 'ออกพรรษา', 'ลอยกระทง', 'ไหว้พระ', 'ปฏิบัติธรรม', 'มาฆบูชา', 'วิสาขบูชา', 'ศาลเจ้า', 'กีฬา', 'แข่งรถ', 'นักแข่ง', 'นัดชิง', 'รอบชิง', 'สกอร์', 'แชมป์', 'เหรียญทอง', 'เหรียญเงิน', 'คว้าเหรียญ', 'โอลิมปิก', 'ซีเกมส์', 'เอเชียนเกมส์', 'วอลเลย์บอล', 'ฟุตบอล', 'ฟุตซอล', 'มวย', 'เทนนิส', 'แบดมินตัน', 'เทควันโด', 'ตะกร้อ', 'กรีฑา', 'มาราธอน', 'นักวิ่ง', 'นักเตะ', 'นักกีฬา', 'ทีมชาติ'].filter((k) => lower.includes(k));
      for (const k of guess) keyHits[k] = (keyHits[k] || 0) + 1;
      if (stressExamples.length < 15) stressExamples.push(`${on} ← "${title.slice(0, 70)}" [${guess.join(',')}]`);
    }
  }
});
report.stress = { nonBucketNewsRaw: nonBucketRaw.length, nonBucketNews: nonBucket.length, titlesRoutedToNew: stressFP, rate: +(stressFP / (nonBucket.length || 1)).toFixed(3), keyHits: Object.fromEntries(Object.entries(keyHits).sort((a, b) => b[1] - a[1])), examples: stressExamples, note: 'เพดานบน: พาดหัวยาวกว่าป้ายจริงมาก ใช้ชี้คีย์อันตราย ไม่ใช่ FP จริง · นับหลัง dedupe พาดหัว · เทียบข้ามรอบต้องใช้ SCOUT (oracle) ชุดเดียวกัน' };
console.log(`[stress] พาดหัวข่าวนอกหมวดใหม่ ${nonBucket.length} ใบ (raw ${nonBucketRaw.length}) → ถูกดูดเข้าหมวดใหม่ ${stressFP} (${Math.round(report.stress.rate * 100)}%) · คีย์ตัวการ: ${Object.entries(report.stress.keyHits).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
for (const e of stressExamples) console.log('   - ' + e);

const outPath = args.out ? path.resolve(args.out) : path.join(RUN_DIR, 'resume-3sep69', 'f11-v2-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`[F11-v2] รายงาน → ${outPath}`);

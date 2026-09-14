/**
 * ★ P13 (14 ก.ย. 69 เจ้าของสั่ง): หัวข้อโปรโมตของรายการไม่ใช่เนื้อข่าว — 2 ระดับ
 *   external (ตัวอย่างช่วงต่อไป/โฆษณาล้วน/ชวนติดตาม) → ตัดออกจากหลักฐาน + พรอมต์ห้ามเขียน + ไม่นับว่าหาย
 *   internal (เปิด-ปิดรายการล้วน) → แค่ไม่นับว่าหาย · แถวผสมกับเนื้อหา = เนื้อหา (พฤติกรรมเดิม)
 * ตัวอย่างในเทสส่วนใหญ่คือหัวข้อจริงจากคลัง 400 เคส (รวมแถวที่ตัวกรองรุ่นแรกจับผิด)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { isPromoTopic, isNonContentTopic, promoTopicClass, promoTopicText } = await import('../src/lib/services/clipBrain/promoTopics.js');
const { buildEvidencePackFromPipeline } = await import('../src/lib/services/clipBrain/topicEvidence.js');
const { checkAgainstTruth } = await import('../src/lib/services/clipBrain/clipVerify.js');
const { buildComposePrompt } = await import('../src/lib/services/clipBrain/composeTopics.js');

const ENV = ['CLIP_PROMO_TOPIC_FILTER', 'CLIP_PROMO_TOPIC_EXTRA'];
function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

const EXTERNAL = ['ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ', 'ตัวอย่างรายการช่วงต่อไป', 'ตัวอย่างช่วงต่อไป พาเที่ยวฮิโนกิแลนด์ จ.เชียงใหม่',
  'ตัวอย่างช่วงถัดไป น้องเกลร้องเพลง ทรงอย่างแบด และคุณยายหนิงชมการเลี้ยงลูก', 'ตัวอย่างเนื้อหาช่วงถัดไปและปิดเบรก', 'ตัวอย่างตอนต่อไป',
  'โฆษณา YURA Gluta Nano White Cream', 'ช่วงเบรกโฆษณา', 'ปิดรายการ พบกันใหม่สัปดาห์หน้า', 'ฝากช่องทางติดตาม', 'ช่วงต่อไปของรายการ',
  // ★ วงตรวจ 14 ก.ย.
  'แนะนำช่องทางติดตาม', 'นัดพบกันใหม่สัปดาห์หน้า', 'ตัวอย่าง\u200Bช่วง\u200Bต่อไป พาเที่ยวฮิโนกิแลนด์',
  // ★ แถวจริงจากคลังใหญ่ 889 เคส (P13e)
  'ผู้ประกาศปิดท้ายรายการและแจ้งช่องทางการติดตาม', 'ช่วงสปอตโฆษณาและปิดท้ายคลิป', 'ช่วงคั่นรายการและประชาสัมพันธ์', 'ช่วงคั่นรายการ',
  'ปิดท้ายรายการ แนะนำแขกรับเชิญช่วงถัดไปเกี่ยวกับทีมงานละครอังกอร์และธุรกิจไก่ย่าง', 'ช่วงท้ายคลิป แนะนำช่องทางการติดตามข่าวสด',
  'ประชาสัมพันธ์ช่องทางติดตามข่าวสด', 'ฝากติดตามรายการและช่องอมรินทร์ทีวี เอชดี 34', 'ช่องทางการติดตามของ Bright TV',
  'สรุปรายการ ฝากผลงาน ช่องทางการติดตาม และปิดรายการ', 'ช่วงพักเบรกแนะนำผลิตภัณฑ์', 'พักเบรกรายการและโฆษณา'];
const INTERNAL = ['เปิดรายการและแนะนำช่วงต่างๆ', 'เปิดรายการ TODAY SHOW และแนะนำเนื้อหาไฮไลต์ประจำสัปดาห์', 'ไฮไลท์และเปิดรายการ', 'ไฮไลต์ประจำตอน',
  'ไฮไลท์รายการ Once Upon A Good Time', 'สรุปและปิดรายการ', 'พูดคุยส่งท้ายและปิดรายการ', 'เปิดรายการและเพลงประจำรายการ', 'ไฮไลท์ช่วงเด็ดประจำอีพี',
  // ★ แถวจริงจากคลังใหญ่ (P13e)
  'ปิดท้ายรายการโดยผู้ประกาศข่าวสด', 'ผู้ประกาศข่าวกล่าวปิดท้ายรายการ', 'ไฮไลต์ตัวอย่างรายการและอินโทร', 'ไตเติลปิดท้ายของ Bright TV'];
const CONTENT = ['ประสบการณ์แคสติ้งและการเล่นโฆษณา', 'ช่องทางบริจาคช่วยเหลือมูลนิธิวัดสวนแก้วและปิดรายการ', 'นนท์มอบของขวัญพิเศษให้หนุ่ม กรรชัย และปิดรายการ',
  'ไฮไลต์ช่วงส่งนักท่องเที่ยวถึงร้านซ่อมและนักท่องเที่ยวกล่าวขอบคุณ', 'ช่วงเบรกโฆษณาและการชี้แจงจากทางทีมงานช่วยเหลือ', 'เปิดรายการ ต้อนรับ นนท์ ธนนท์',
  'ตัวอย่างรายการ: การรอคอย 54 ปี และการพบพ่อของมอร์ริส เค', 'เปิดรายการและเกริ่นเรื่องราวช่างเสกถูกลูกจ้างตีท้ายครัวและขโมยทรัพย์สิน',
  'จ่ายเงินก้อนช่วยคุณลุงโดยไม่รับเงินทอน และขออนุญาตลงคลิปช่วยโปรโมตร้าน', 'ภาพร้านขายของชำที่เปิดสำเร็จและตัวอย่างตอนต่อไป',
  'เดวิดเล่าไฮไลท์ชีวิตวัยเด็ก', 'ลุงทูตั้งราคาจานละ 10 บาท', 'เปิดตัวสินค้าใหม่ของบริษัท', 'ตัวอย่างการหุงข้าวเช็ดน้ำ', 'จุดเริ่มต้นความผูกพันกับเมืองไทย',
  'เดวิด วิลเลียม โชว์เดี่ยวกีตาร์บทเพลงที่แต่งเอง', 'เฉียงกล่าวขอบคุณผู้ชม ผู้ติดตาม และสปอนเซอร์ที่สนับสนุนจนทำภารกิจสำเร็จ',
  // ★ วงตรวจ 14 ก.ย.: คำว่า สัปดาห์หน้า/ตอนต่อไป ในประโยคข่าวธรรมดา
  'ลุงทูประกาศจะขึ้นราคาสัปดาห์หน้า', 'ตอนต่อไปเขาเล่าถึงชีวิตวัยเด็กและการฝึกซ้อม', 'แม่ต่ายนัดคุยเรื่องซื้อที่ดินคราวหน้า',
  // ★ แถวจริงจากคลังใหญ่ที่ต้องเป็นเนื้อหา (P13e): คนในข่าวฝากช่องทาง/โปรโมชัน/ไฮไลต์เหตุการณ์/ปิดท้ายผสมเนื้อ
  'ฟ้า ฝากช่องทางการขายของผ่าน Facebook ก่อนปั่นจักรยานเดินทางกลับบ้าน', 'โปรโมชันแจกมะพร้าว-เฟรนช์ฟรายส์ฟรี และความตั้งใจในการทำงานของผู้พิการที่อยู่ร่วมกันมานานกว่า 5 ปี',
  'สมจิตรเซอร์ไพรส์มอบดอกไม้และกราบตักภรรยา ปิดท้ายรายการ', 'ประมวลภาพความสำเร็จและปิดท้ายรายการข่าวสด', 'ไฮไลต์ภาพเหตุการณ์ หนิง ปณิตา มอบเงินสดและสวมกอดน้องฑีฆายุ',
  'รอบการเปิดรับสมัครและช่องทางการติดตามข่าวสาร', 'ชาคริตประชาสัมพันธ์งานวิ่ง Bangkok Airways Chiang Mai Half Marathon 2026', 'แจ้งราคา โปรโมชั่นซื้อ 2 แถม 1 และช่องทางการสั่งซื้อ',
  'ช่วงเบรกโฆษณาและการชี้แจงจากทางทีมงานช่วยเหลือ',
  // คนในข่าวเป็นประธานของคำชวนติดตาม → ถือเป็นเนื้อหา (ปลอดภัยไว้ก่อน — วลีไม่ได้นำแถว)
  'แม่ต่ายฝากติดตามเพจ', 'ลุงทูฝากช่องทางสั่งซื้อ', ''];

test('promoTopicClass: external / internal / เนื้อหา แยกถูกทุกตัวอย่างจริง — แถวผสมเนื้อหาต้องเป็นเนื้อหา', () => {
  withEnv({}, () => {
    for (const t of EXTERNAL) assert.equal(promoTopicClass(t), 'external', 'ควรเป็น external: ' + t);
    for (const t of INTERNAL) assert.equal(promoTopicClass(t), 'internal', 'ควรเป็น internal: ' + t);
    for (const t of CONTENT) assert.equal(promoTopicClass(t), null, 'ควรเป็นเนื้อหา: ' + t);
    assert.equal(isPromoTopic(EXTERNAL[0]), true); assert.equal(isPromoTopic(INTERNAL[0]), false); assert.equal(isPromoTopic(CONTENT[0]), false);
    assert.equal(isNonContentTopic(EXTERNAL[0]), true); assert.equal(isNonContentTopic(INTERNAL[0]), true); assert.equal(isNonContentTopic(CONTENT[0]), false);
    // รับแถว timeline ทุกรูปทรง · ของแปลกไม่โยน
    assert.equal(promoTopicClass({ time: '27:07-27:32', topic: 'ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ' }), 'external');
    assert.equal(promoTopicClass({ title: 'โฆษณา' }), 'external');
    assert.equal(promoTopicClass({ time: '00:00-01:00' }), null, 'ไม่มีข้อความ = เนื้อหา (ไม่แตะ)');
    for (const odd of [null, undefined, 42, true, { topic: 7 }, { topic: '   ' }, []]) assert.equal(promoTopicClass(odd), null, JSON.stringify(odd));
    assert.equal(promoTopicText({ topic: ' ก ' }), ' ก '); assert.equal(promoTopicText('x'), 'x'); assert.equal(promoTopicText({}), ''); assert.equal(promoTopicText({ topic: 5, title: 'ข' }), 'ข');
  });
});

test('env: CLIP_PROMO_TOPIC_FILTER=0 ปิดทุกระดับ · CLIP_PROMO_TOPIC_EXTRA เพิ่มคำตรงตัวเป็น external · ค่าว่าง/มีแต่ | ไม่มีผล', () => {
  withEnv({ CLIP_PROMO_TOPIC_FILTER: '0' }, () => { for (const t of [...EXTERNAL, ...INTERNAL]) assert.equal(promoTopicClass(t), null, 'ปิดแล้วต้องไม่จับ: ' + t); });
  withEnv({ CLIP_PROMO_TOPIC_EXTRA: 'สแกนคิวอาร์|ร่วมสนุก' }, () => {
    assert.equal(promoTopicClass('ร่วมสนุกลุ้นรางวัลท้ายรายการ'), 'external');
    assert.equal(promoTopicClass('สแกนคิวอาร์เพื่อรับส่วนลด'), 'external');
    assert.equal(promoTopicClass('ลุงทูตั้งราคาจานละ 10 บาท'), null);
  });
  withEnv({ CLIP_PROMO_TOPIC_EXTRA: '||  |' }, () => { for (const t of CONTENT) assert.equal(promoTopicClass(t), null, t); });
});

const TRUTH = { transcription: [{ time: '00:00–00:30', speaker: '', text: 'คนในชุมชนช่วยกันซ่อมบ้านและจัดเตรียมร้านก่อนเปิดขายของในตลาด' }], onScreenText: [] };
const ROW_INTERNAL = { time: '00:00–00:20', topic: 'เปิดรายการและแนะนำไฮไลท์ประจำสัปดาห์' };
const ROW_CONTENT = { time: '00:20–01:00', topic: 'ชุมชนซ่อมบ้าน' };
const ROW_EXTERNAL = { time: '27:07–27:32', topic: 'ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ' };
const TIMELINE = [ROW_INTERNAL, ROW_CONTENT, ROW_EXTERNAL];

test('evidence pack: ตัดเฉพาะ external ออกจากหลักฐาน (internal คงอยู่) · จด clipMeta.promoSkipped · ปิดตัวกรอง = เข้าหมด', () => {
  withEnv({}, () => {
    const pack = buildEvidencePackFromPipeline({ truth: TRUTH, segmentResults: [], plannedSegments: [], map: { timeline: TIMELINE }, durSec: 1652, clipMeta: { url: 'u' } });
    const tl = pack.evidence.filter((e) => e.kind === 'timeline');
    assert.deepEqual(tl.map((e) => e.id), ['l1', 'l2'], 'เลขลำดับต่อเนื่องแม้ข้ามแถว');
    assert.ok(tl[0].text.includes('เปิดรายการ') && tl[1].text.includes('ชุมชนซ่อมบ้าน'), 'internal + เนื้อหาคงอยู่');
    assert.ok(!tl.some((e) => e.text.includes('ตัวอย่างไฮไลท์')), 'external หายจากหลักฐาน');
    assert.deepEqual(pack.clipMeta.promoSkipped, [{ time: '27:07–27:32', topic: 'ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ' }]);
    assert.equal(pack.clipMeta.url, 'u', 'clipMeta เดิมยังอยู่');
    const none = buildEvidencePackFromPipeline({ truth: TRUTH, segmentResults: [], plannedSegments: [], map: { timeline: [] }, durSec: 100 });
    assert.deepEqual(none.clipMeta.promoSkipped, [], 'ไม่มีโปรโมต = อาร์เรย์ว่าง (โครงคงที่)');
  });
  withEnv({ CLIP_PROMO_TOPIC_FILTER: '0' }, () => {
    const pack = buildEvidencePackFromPipeline({ truth: TRUTH, segmentResults: [], plannedSegments: [], map: { timeline: TIMELINE }, durSec: 1652 });
    assert.equal(pack.evidence.filter((e) => e.kind === 'timeline').length, 3);
    assert.deepEqual(pack.clipMeta.promoSkipped, []);
  });
});

test('compose prompt: มีกฎห้ามแต่งจากช่วงโปรโมต และระบุเฉพาะช่วง external ที่ถูกตัด (ไม่ห้ามเขียนถึงแถวเปิดรายการ/เนื้อหา)', () => {
  withEnv({}, () => {
    const pack = buildEvidencePackFromPipeline({ truth: TRUTH, segmentResults: [], plannedSegments: [], map: { timeline: TIMELINE }, durSec: 1652 });
    const prompt = buildComposePrompt({ evidencePack: pack });
    assert.ok(prompt.includes('ยกเว้นช่วงโปรโมตของรายการ'), 'กฎทั่วไป');
    const i = prompt.indexOf('ช่วงโปรโมตของรายการที่ถูกตัดออกจากหลักฐานแล้ว (ห้ามเขียนถึง): ');
    assert.ok(i >= 0, 'ต้องมีบล็อกช่วงที่ตัด');
    const line = prompt.slice(i, prompt.indexOf('\n', i));
    assert.equal(line, 'ช่วงโปรโมตของรายการที่ถูกตัดออกจากหลักฐานแล้ว (ห้ามเขียนถึง): 27:07–27:32 ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ');
    const clean = buildComposePrompt({ evidencePack: buildEvidencePackFromPipeline({ truth: TRUTH, segmentResults: [], plannedSegments: [], map: { timeline: [ROW_INTERNAL, ROW_CONTENT] }, durSec: 100 }) });
    assert.ok(!clean.includes('ถูกตัดออกจากหลักฐานแล้ว'), 'ไม่มี external = ไม่มีบล็อก');
    const legacy = buildComposePrompt({ evidencePack: { clipMeta: {}, evidence: [{ id: 't1', kind: 'transcript', text: 'ก', provenance: 'truth' }] } });
    assert.ok(!legacy.includes('ถูกตัดออกจากหลักฐานแล้ว'), 'แพ็กเก่าไม่มี promoSkipped ก็ไม่พัง');
  });
});

test('checkAgainstTruth: external และ internal ไม่ถูกนับเป็น "ของหาย-ประเด็น" (แถวเนื้อหายังถูกตรวจ) · stats.promoSkipped · timeline ไม่มี = 0', () => {
  withEnv({}, () => {
    const insight = { rawData: 'เรื่องอื่นที่ไม่พูดถึงประเด็นใดเลย', subStories: [], quotes: [], timeline: TIMELINE, clipDurationSec: 1652 };
    const r = checkAgainstTruth(insight, JSON.stringify(TRUTH), { caption: '', plannedSegments: [{ startSec: 0, endSec: 1652 }] });
    const missing = r.findings.filter((f) => f.kind === 'ของหาย-ประเด็น');
    assert.deepEqual(missing.map((f) => f.where), ['00:20–01:00 ชุมชนซ่อมบ้าน'], JSON.stringify(missing));
    assert.equal(r.stats.promoSkipped, 2); assert.equal(r.stats.timelineChecked, 3);
    assert.equal(checkAgainstTruth({ rawData: 'x', subStories: [], quotes: [] }, 'y', { caption: '' }).stats.promoSkipped, 0);
  });
  withEnv({ CLIP_PROMO_TOPIC_FILTER: '0' }, () => {
    const insight = { rawData: 'เรื่องอื่นที่ไม่พูดถึงประเด็นใดเลย', subStories: [], quotes: [], timeline: TIMELINE, clipDurationSec: 1652 };
    const r = checkAgainstTruth(insight, JSON.stringify(TRUTH), { caption: '', plannedSegments: [{ startSec: 0, endSec: 1652 }] });
    assert.equal(r.findings.filter((f) => f.kind === 'ของหาย-ประเด็น').length, 3, 'ปิดตัวกรอง = พฤติกรรมเดิม');
    assert.equal(r.stats.promoSkipped, 0);
  });
});

// ★ P13c (วงตรวจ 14 ก.ย.): ตัวสร้างหลักฐานออฟไลน์ · จำกัดขนาด promoSkipped · ผู้ตรวจ AI/ตัวซ่อมมีข้อยกเว้นโปรโมต
const { buildEvidencePack } = await import('../src/lib/services/clipBrain/composeTopics.js');
const { buildReviewPrompt, buildRepairPrompt } = await import('../src/lib/services/clipBrain/clipVerify.js');
const { capPromoSkipped, PROMO_SKIPPED_MAX } = await import('../src/lib/services/clipBrain/promoTopics.js');

test('P13c: buildEvidencePack (ออฟไลน์/เบนช์มาร์ก) กรอง external เหมือนท่อจริง และจด clipMeta.promoSkipped · โครง clipMeta เดิมครบ', () => {
  const record = { id: 'r1', title: 'ข่าว', url: 'u', platform: 'youtube', category: 'c', clipDurationSec: 1652,
    insight: { rawData: 'คนในชุมชนช่วยกันซ่อมบ้าน', subStories: [], quotes: [], speakers: [], keyPoints: [], timeline: TIMELINE } };
  withEnv({}, () => {
    const pack = buildEvidencePack(record);
    const tl = pack.evidence.filter((e) => e.kind === 'timeline');
    assert.equal(tl.length, 2, 'internal + เนื้อหาคงอยู่');
    assert.ok(!tl.some((e) => e.text.includes('ตัวอย่างไฮไลท์')), 'external หาย');
    assert.deepEqual(pack.clipMeta.promoSkipped, [{ time: '27:07–27:32', topic: 'ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ' }]);
    assert.deepEqual(Object.keys(pack.clipMeta).sort(), ['category', 'clipDurationSec', 'id', 'platform', 'promoSkipped', 'title', 'url']);
    assert.ok(buildComposePrompt({ evidencePack: pack }).includes('ห้ามเขียนถึง): 27:07–27:32 ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ'));
  });
  withEnv({ CLIP_PROMO_TOPIC_FILTER: '0' }, () => {
    const pack = buildEvidencePack(record);
    assert.equal(pack.evidence.filter((e) => e.kind === 'timeline').length, 3); assert.deepEqual(pack.clipMeta.promoSkipped, []);
  });
});

test('P13c: promoSkipped ถูกจำกัดขนาดทั้งสองตัวสร้าง (≤12 แถว · เวลา ≤24 · หัวข้อ ≤80 ตัวอักษร)', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ time: `${String(i).padStart(2, '0')}:00–${String(i).padStart(2, '0')}:30 ยาวๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆ`, topic: 'ตัวอย่างช่วงต่อไป ' + 'ก'.repeat(150) + i }));
  withEnv({}, () => {
    const a = buildEvidencePackFromPipeline({ truth: TRUTH, segmentResults: [], plannedSegments: [], map: { timeline: rows }, durSec: 1652 });
    const b = buildEvidencePack({ id: 'r', insight: { rawData: 'x', timeline: rows } });
    for (const pack of [a, b]) {
      assert.equal(pack.clipMeta.promoSkipped.length, PROMO_SKIPPED_MAX);
      assert.ok(pack.clipMeta.promoSkipped.every((p) => p.time.length <= 24 && p.topic.length <= 80), JSON.stringify(pack.clipMeta.promoSkipped[0]));
      assert.equal(pack.evidence.filter((e) => e.kind === 'timeline').length, 0, 'ทุกแถวเป็น external → ไม่มี timeline ในหลักฐาน');
    }
    assert.deepEqual(capPromoSkipped(null), []); assert.deepEqual(capPromoSkipped([{ time: 5, topic: null }]), [{ time: '5', topic: '' }]);
  });
});

test('P13c: ผู้ตรวจ AI และตัวซ่อม มีข้อยกเว้นช่วงโปรโมต (ไม่รายงานว่าหาย · ไม่ซ่อมเติมกลับ)', () => {
  const review = buildReviewPrompt({ insight: { headline: 'h', subStories: [] }, truth: 'เฉลย', caption: '' });
  assert.ok(review.includes('ช่วงโปรโมตของรายการ') && review.includes('ห้ามรายงานว่า "ของหาย"'), 'ผู้ตรวจต้องมีข้อยกเว้น');
  const repair = buildRepairPrompt({ insight: { headline: 'h', subStories: [] }, truth: 'เฉลย', findings: [{ kind: 'ของหาย', where: 'x', detail: 'd', fix: 'f' }] });
  assert.ok(repair.includes('ห้ามเพิ่มเนื้อหาจากช่วงโปรโมตของรายการ'), 'ตัวซ่อมต้องมีข้อยกเว้น');
});

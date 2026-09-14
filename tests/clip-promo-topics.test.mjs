/**
 * ★ P13 (14 ก.ย. 69 เจ้าของสั่ง): หัวข้อโปรโมตของรายการไม่ใช่เนื้อข่าว — ตัดออกจากหลักฐาน · ไม่นับว่าหาย · บอกในพรอมต์
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { isPromoTopic, promoTopicText } = await import('../src/lib/services/clipBrain/promoTopics.js');
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

// แถวจริงจากงาน TODAYSHOW 14 ก.ย. + แบบอื่นที่ระบบผลิตได้
const PROMO = ['ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ', 'ตัวอย่างรายการช่วงต่อไป', 'เปิดรายการ TODAY SHOW และแนะนำไฮไลท์ประจำสัปดาห์',
  'เปิดรายการและแนะนำช่วงต่างๆ', 'ปิดรายการ พบกันใหม่สัปดาห์หน้า', 'โฆษณาผู้สนับสนุนรายการ', 'ไฮไลท์เปิดรายการ', 'ตัวอย่างตอนต่อไป', 'ชวนติดตามชมช่วงถัดไปของรายการ'];
const CONTENT = ['เดวิดเล่าไฮไลท์ชีวิตวัยเด็ก', 'ลุงทูตั้งราคาจานละ 10 บาท', 'เปิดตัวสินค้าใหม่ของบริษัท', 'ตัวอย่างการหุงข้าวเช็ดน้ำ',
  'พิธีกรเกริ่นนำเรื่องราวของแขกรับเชิญ', 'จุดเริ่มต้นความผูกพันกับเมืองไทย', 'เดวิด วิลเลียม โชว์เดี่ยวกีตาร์บทเพลงที่แต่งเอง', ''];

test('isPromoTopic: จับหัวข้อโปรโมตทุกแบบที่ระบบผลิต และไม่จับเนื้อข่าวที่บังเอิญมีคำคล้าย', () => {
  withEnv({}, () => {
    for (const t of PROMO) assert.equal(isPromoTopic(t), true, 'ควรเป็นโปรโมต: ' + t);
    for (const t of CONTENT) assert.equal(isPromoTopic(t), false, 'ไม่ใช่โปรโมต: ' + t);
    // รับแถว timeline ทุกรูปทรง
    assert.equal(isPromoTopic({ time: '27:07-27:32', topic: 'ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ' }), true);
    assert.equal(isPromoTopic({ title: 'โฆษณา' }), true);
    assert.equal(isPromoTopic({ time: '00:00-01:00' }), false, 'ไม่มีข้อความ = ไม่ใช่โปรโมต');
    assert.equal(isPromoTopic(null), false); assert.equal(isPromoTopic(42), false);
    assert.equal(promoTopicText({ topic: ' ก ' }), ' ก '); assert.equal(promoTopicText('x'), 'x'); assert.equal(promoTopicText({}), '');
  });
});

test('isPromoTopic: env ปิดตัวกรองได้ และเพิ่มคำตรงตัวได้', () => {
  withEnv({ CLIP_PROMO_TOPIC_FILTER: '0' }, () => { for (const t of PROMO) assert.equal(isPromoTopic(t), false, 'ปิดแล้วต้องไม่จับ: ' + t); });
  withEnv({ CLIP_PROMO_TOPIC_EXTRA: 'สแกนคิวอาร์|ร่วมสนุก' }, () => {
    assert.equal(isPromoTopic('ร่วมสนุกลุ้นรางวัลท้ายรายการ'), true);
    assert.equal(isPromoTopic('สแกนคิวอาร์เพื่อรับส่วนลด'), true);
    assert.equal(isPromoTopic('ลุงทูตั้งราคาจานละ 10 บาท'), false);
  });
});

const TRUTH = { transcription: [{ time: '00:00–00:30', speaker: '', text: 'คนในชุมชนช่วยกันซ่อมบ้านและจัดเตรียมร้านก่อนเปิดขายของในตลาด' }], onScreenText: [] };
const TIMELINE = [{ time: '00:00–00:20', topic: 'เปิดรายการและแนะนำไฮไลท์ประจำสัปดาห์' }, { time: '00:20–01:00', topic: 'ชุมชนซ่อมบ้าน' }, { time: '27:07–27:32', topic: 'ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ' }];

test('evidence pack: แถว timeline โปรโมตไม่เข้าหลักฐาน แต่ถูกจดใน clipMeta.promoSkipped · ปิดตัวกรอง = เข้าเหมือนเดิม', () => {
  withEnv({}, () => {
    const pack = buildEvidencePackFromPipeline({ truth: TRUTH, segmentResults: [], plannedSegments: [], map: { timeline: TIMELINE }, durSec: 1652, clipMeta: { url: 'u' } });
    const tl = pack.evidence.filter((e) => e.kind === 'timeline');
    assert.equal(tl.length, 1); assert.ok(tl[0].text.includes('ชุมชนซ่อมบ้าน'));
    assert.deepEqual(pack.clipMeta.promoSkipped, [{ time: '00:00–00:20', topic: 'เปิดรายการและแนะนำไฮไลท์ประจำสัปดาห์' }, { time: '27:07–27:32', topic: 'ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ' }]);
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

test('compose prompt: มีกฎห้ามแต่งจากช่วงโปรโมต และระบุช่วงที่ถูกตัดเมื่อมี', () => {
  withEnv({}, () => {
    const pack = buildEvidencePackFromPipeline({ truth: TRUTH, segmentResults: [], plannedSegments: [], map: { timeline: TIMELINE }, durSec: 1652 });
    const prompt = buildComposePrompt({ evidencePack: pack });
    assert.ok(prompt.includes('ยกเว้นช่วงโปรโมตของรายการ'), 'กฎทั่วไป');
    assert.ok(prompt.includes('ช่วงโปรโมตของรายการที่ถูกตัดออกจากหลักฐานแล้ว (ห้ามเขียนถึง): 00:00–00:20 เปิดรายการและแนะนำไฮไลท์ประจำสัปดาห์ · 27:07–27:32 ตัวอย่างไฮไลท์ช่วงต่อไปของรายการ'), prompt.slice(prompt.indexOf('ช่วงโปรโมต'), prompt.indexOf('ช่วงโปรโมต') + 200));
    const clean = buildComposePrompt({ evidencePack: buildEvidencePackFromPipeline({ truth: TRUTH, segmentResults: [], plannedSegments: [], map: { timeline: [] }, durSec: 100 }) });
    assert.ok(!clean.includes('ถูกตัดออกจากหลักฐานแล้ว'), 'ไม่มีโปรโมต = ไม่มีบล็อกรายการที่ตัด');
  });
});

test('checkAgainstTruth: แถวโปรโมตไม่ถูกนับเป็น "ของหาย-ประเด็น" (แถวเนื้อหายังถูกตรวจ) · stats.promoSkipped นับได้', () => {
  withEnv({}, () => {
    const insight = { rawData: 'เรื่องอื่นที่ไม่พูดถึงประเด็นใดเลย', subStories: [], quotes: [], timeline: TIMELINE, clipDurationSec: 1652 };
    const r = checkAgainstTruth(insight, JSON.stringify(TRUTH), { caption: '', plannedSegments: [{ startSec: 0, endSec: 1652 }] });
    const missing = r.findings.filter((f) => f.kind === 'ของหาย-ประเด็น');
    assert.deepEqual(missing.map((f) => f.where), ['00:20–01:00 ชุมชนซ่อมบ้าน'], JSON.stringify(missing));
    assert.equal(r.stats.promoSkipped, 2); assert.equal(r.stats.timelineChecked, 3);
  });
  withEnv({ CLIP_PROMO_TOPIC_FILTER: '0' }, () => {
    const insight = { rawData: 'เรื่องอื่นที่ไม่พูดถึงประเด็นใดเลย', subStories: [], quotes: [], timeline: TIMELINE, clipDurationSec: 1652 };
    const r = checkAgainstTruth(insight, JSON.stringify(TRUTH), { caption: '', plannedSegments: [{ startSec: 0, endSec: 1652 }] });
    assert.equal(r.findings.filter((f) => f.kind === 'ของหาย-ประเด็น').length, 3, 'ปิดตัวกรอง = พฤติกรรมเดิม');
    assert.equal(r.stats.promoSkipped, 0);
  });
});

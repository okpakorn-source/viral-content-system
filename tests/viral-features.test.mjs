// ★ 2 ก.ย. 69 — ฟีเจอร์ "โอกาสปัง" จากข้อความล้วน (src/lib/feedback/viralFeatures.js)
//   ตัวอย่างจริง 7 โพสต์จากเพจ (technique-sample.json — TOP/LOW ที่ technique-analysis.json ยกเป็นตัวอย่างเทคนิค)
//   ฟีเจอร์ต้องออกตามที่คาดจากการอ่านด้วยตาคน + ตัวนับคำต้องตรงกับ `words` ใน fb-posts.json ทุกใบ
//   รัน: node --test tests/viral-features.test.mjs (ไม่ต้องตั้ง env · ไม่ยิง AI)
//
// ผลการทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนโค้ด (ยิงจริง 2 ก.ย. 69 ด้วยสคริปต์ทุบ-เทส-คืนไฟล์ byte-exact · กัดครบ 5/5):
//   M1 hasDirectQuoteToReceiver = 0 เสมอ                                    ⇒ แดง 2/13: 'พ่อเดิน 28 กิโล…' + 'ตัวจับรูปแบบ…ยิงตรง'
//   M2 hasKinshipName ไม่ข้ามคำที่ไม่ใช่ชื่อ (ตัด NOT_NAME_AFTER_KINSHIP)  ⇒ แดง 3/13: 'พ่อเดิน 28 กิโล…' (พ่อ+ไม่มี กลายเป็นชื่อ) + 'พี่ปอนด์รับปาก…' (ญาติพี่+น้อง) + 'ตัวจับรูปแบบ…'
//   M3 ตัด segmentWords → นับคำแบบช่องว่าง                                 ⇒ แดง 10/13: 'ตัวนับคำตรง fb-posts' + ทุกใบที่ล็อกจำนวนคำ/โซน
//   M4 lengthBandIndex คืน 0 เสมอ                                           ⇒ แดง 4/13: 'โซนความยาว…' + ใบที่ล็อก band_*
//   M5 detectOpeningType ไม่เช็ค praise                                     ⇒ แดง 1/13: 'ไม่แปลกใจทำไมฮลุน…'
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFeatures, MODEL_FEATURES, OPENING_TYPES, LENGTH_BANDS, segmentWords, featureVector, emptyFeatures } from '../src/lib/feedback/viralFeatures.js';

// โพสต์จริงจากเพจ (คัดจาก C:\tmp\news-r233-run\technique-sample.json) — {tier, reactions, words, text}
const SAMPLES = [
  {"tier":"TOP","reactions":167713,"words":161,"text":"‘พี่หนุ่ม’ ตัดสินใจมอบเงินจำนวน 20,000 บาท กลางรายการโหนกระแส หลังได้ฟังเรื่องราวชีวิตของ ‘พี่ขยัน’  เพื่อให้เธอนำไปใช้จ่ายและดูแลตัวเองกับครอบครัว พร้อมกำชับว่าเงินก้อนนี้ต้องเก็บไว้ใช้ดำรงชีวิต\n\nเพราะทั้งชีวิตของพี่ขยัน รู้จักแต่การหาเลี้ยงชีพด้วยการเก็บผักบุ้งขายกำละ 5 บาท 10 บาท จนลูกสาวยังบอกว่า แม่ไม่รู้ด้วยซ้ำว่าเงินล้านมันมากแค่ไหน เพราะขนาดเงินหมื่นหรือเงินแสน แม่ก็ยังไม่เคยมีโอกาสได้จับมาก่อน\n\nทำเอาหลายคนที่ติดตามเรื่องนี้รู้สึกอบอุ่นใจกับการตัดสินใจของพี่หนุ่ม เพราะสำหรับบางคน เงินหมื่นอาจเป็นเพียงตัวเลขหนึ่ง แต่สำหรับพี่ขยัน มันคือกำลังใจครั้งใหญ่ และอาจเป็นหนึ่งในเงินก้อนที่มากที่สุดที่เธอเคยได้รับในชีวิต"},
  {"tier":"TOP","reactions":95064,"words":197,"text":"พ่อไม่มีเงินสักบาทแต่เลือกเดินเท้าไปกลับ 28 กิโล เพื่อกอดลูกชาย เพราะเหตุผลบางอย่างที่ทำให้เขาอยู่กับลูกไม่ได้ เลยจำใจต้องฝากไว้กับวัดใหม่สี่หมื่น ให้หลวงพ่อพงษ์ดูแล\n\n“พี่ขึ้นหลังกระบะเลย” เสียงจากพี่แก้วเจ้าของคลิปที่ทำให้หัวใจพ่อคนนึงมีหวัง หลังเธอเห็นผู้ชายคนนึงสะพายกระเป๋าใบเดียว นั่งพักอยู่ริมทาง จึงแวะซื้อบะหมี่และน้ำให้ ก่อนถามว่าจะไปไหน และคำตอบที่ได้คือ “วัดใหม่สี่หมื่น” พี่ผู้ชายบอกเขาไม่มีเงินสักบาท มีแต่ใจคิดถึงลูกเต็ม 2 เท้า ที่จะนั่งรถไฟมาจากใต้ลงที่สถานีราชบุรี เดินอีก 14 กิโลเพื่อมาหาลูก แม้ระยะทางจะไกล แต่ความรักของพ่อไม่ลดเลย\n\nเมื่อได้ยินเรื่องราว พี่แก้วจึงรีบหยิบยื่นน้ำใจพาคุณพ่อไปส่งถึงวัด ทันทีที่เด็กน้อยเห็นก็รีบวิ่งเข้ามาสวมกอดทั้งน้ำตา ..ภาพธรรมดาๆเพียงไม่กี่วินาที แต่กลับมีค่ามากกว่าสิ่งของราคาแพงใดๆ"},
  {"tier":"TOP","reactions":155325,"words":211,"text":"ระยะทางไปกลับกว่า 2 กิโลเมตร เด็กหญิงตัวเล็กวัย 7 ขวบวิ่งทุกพักเที่ยง มือกำข้าวกลางวันที่แบ่งจากโรงเรียนมาครึ่งหนึ่ง เพื่อเอากลับไปให้แม่ที่นั่งรถเข็นรออยู่ที่บ้าน นี่คือน้องข้าวหอม จากจังหวัดสุโขทัย เด็กที่แบกความรับผิดชอบไว้เต็มสองมือ\n\nชีวิตของครอบครัวนี้หนักกว่าที่หลายคนคิด พ่อตกงาน ต้องรับจ้างทั่วไปประคองครอบครัวไปวันต่อวัน ส่วนตัวน้องเองก็ป่วยธาลัสซีเมีย ต้องไปรับการรักษาที่จังหวัดพิษณุโลกทุกเดือน เวลาไปโรงพยาบาล ภาพแบบนั้นใครเห็นก็จุกในอก แต่น้องข้าวหอมไม่เคยบ่นสักคำ\n\nล่าสุดรายการปัญญาปันสุข 2025 มอบอุปกรณ์ทำมาหากินและของจำเป็นมูลค่ารวมกว่า 100,000 บาท ทั้งเคาน์เตอร์ร้านหม่าล่า เครื่องใช้ไฟฟ้า ข้าวสาร จักรยาน พร้อมทุนการศึกษา 15,000 บาทและประกันสุขภาพ น้องทำภารกิจจัดออเดอร์หม่าล่าได้สำเร็จในเวลา 57 วินาที จากเวลาจำกัด 1 นาที แล้วได้ของรางวัลทั้งหมดกลับไปสร้างอาชีพให้ครอบครัว เด็กที่วิ่งสองกิโลเพื่อแม่ วันนี้มีร้านของตัวเองให้สู้ต่อ"},
  {"tier":"TOP","reactions":165089,"words":180,"text":"ไม่แปลกใจทำไมฮลุนถึงไปจอร์เจียอีกครั้ง เพราะปลายทางของเขาคือ “อาร์เมเนีย” 3 ปีก่อนเขาได้พบครอบครัวที่เคยช่วยชีวิตไว้ ฮลุนเคยบอกว่าเขาตั้งใจจะไปออกตามหาอีกครั้ง\n\nปกตินักเดินทางรอบโลกจะไม่ไปซ้ำ 2 แต่แพลนครั้งนี้ ฮลุนอาจตั้งใจไปตอบแทนผู้มีพระคุณ 3 ปีก่อนเขาเคยเดินทางจากจอร์เจียไปอาร์เมเนีย และได้ทำคอนเทนต์โบกรถคนแปลกหน้า วันหนึ่งเขาหลงไปแถบชนบท ไม่มีไฟ ไม่มีสัญญาณ ก่อนพบคนจูงวัวที่ชวนไปพักที่บ้าน พร้อมหาที่นอน หาข้าว หาน้ำให้กิน จนฮลุนเรียกเขาว่า “ป๊า” “ม๊า”\n\nพ่อและแม่คือสิ่งที่ฮลุนขาดหาย และครอบครัวนี้มาเติมเต็มให้ “ปีนี้ฮลุนจะออกตามหาพวกเขาอีกครั้ง” คือความตั้งใจก่อนออกเดินทางครั้งนี้ แต่สุดท้ายน้องกลับไปไม่ถึง"},
  {"tier":"LOW","reactions":2490,"words":209,"text":"27 เคสดำได้กลับบ้านเกิดในวันที่ครอบครัวยังไม่ทันตั้งตัว รถอาสาสมัครของมูลนิธิป่อเต็กตึ๊งวิ่งออกจากกรุงเทพฯ มุ่งหน้าไปตามภูมิลำเนาเดิมทั่วประเทศ โดยไม่คิดค่าใช้จ่ายแม้แต่บาทเดียว \n\nระยะทางหลายร้อยกิโลจากเมืองหลวงไปถึงบ้านต่างจังหวัด กับค่าใช้จ่ายที่ตามมาในวันที่ใจแทบไม่เหลือแรง มูลนิธิป่อเต็กตึ๊งเลือกยกภาระนั้นออกจากไหล่ครอบครัว จัดรถ จัดคน พาทั้ง 27 รายกลับไปให้ถึงที่ ไม่ใช่แค่ส่งของ แต่คือการพาคนที่เขารักกลับไปหาคนที่รอ แล้วยังไม่หยุดแค่นั้น มูลนิธิอนุมัติเงินเยียวยาฉุกเฉินให้ครอบครัวรายละ 20,000 บาท เงินก้อนนี้ไม่ได้ลบความเสียใจออกไปได้ แต่พอจะประคองให้ครอบครัวยืนอยู่ได้ในวันแรกๆ ที่ทุกอย่างหนักเกินจะรับไหว\n\nหลังไฟสงบ แสงข่าวจางลง ยังมีคนอีกกลุ่มทำงานต่อแบบเงียบๆ ยื่นมือไปถึงหน้าประตูบ้านของแต่ละครอบครัว 27 รายได้กลับภูมิลำเนา พร้อมความช่วยเหลือที่ส่งถึงคนข้างหลังในคืนที่มืดที่สุด"},
  {"tier":"LOW","reactions":2461,"words":197,"text":"\"ณเดชน์\" เปิดใจไม่ฟ้องไรเดอร์ ไม่โกรธแถมยังเห็นใจพี่ไรเดอร์ด้วยซ้ำที่เจอกระแสสังคม พร้อมทิ้งท้ายอย่างอบอุ่นว่าทุกคนยังคงเข้ามาทักทาย ขอถ่ายรูป และใช้ชีวิตร่วมทางกับเขาได้ปกติเหมือนเดิม\n\nณเดชน์อยู่ในวงการมา 17 ปี ไม่ได้ให้อภัยเพื่อรักษาภาพลักษณ์ แต่มันมาจากจิตใจที่มองโลกในแง่ดีจริงๆ เขามองว่ามันคือความผิดพลาดของทั้งสองฝ่ายที่เกิดจากความไม่รู้ เลยไม่คิดจะฟ้องร้อง แต่หวังให้เป็นบทเรียนกับสังคมและบริษัทไรเดอร์ตระหนักถึงเรื่องความปลอดภัยของคนทำงานและลููกค้า เพราะเชื่อว่าไรเดอร์เองก็ไม่ได้มีเจตนาที่ไม่ดี\n\nการมองโลกด้วยความเข้าใจและเอื้ออาทรต่อกันแบบนี้ ไม่แปลกใจเลยว่าทำไมแฟนคลับถึงรักและเอ็นดูผู้ชายคนนี้มาตลอด คำว่า \"พระเอกตัวจริง\" ไม่ได้อยู่แค่ในบทละคร แต่คือตัวตนที่แท้จริงของ \"ณเดชน์ คูกิมิยะ\""},
  {"tier":"TOP","reactions":164088,"words":189,"text":"ญาติพี่น้องของพระสงฆ์ทุกรูปไม่ต้องห่วงแล้วนะ \"พี่ปอนด์\" รับปากจะจัดรถ 10 คัน เพื่อรับพระภิกษุสงฆ์ทั้ง 12 รูปไปส่งที่บ้านเกิดโดยไม่คิดค่าใช้จ่าย เพราะเขาก็จุกอกและอยากช่วยเหลือครอบครัวผู้สูญเสียอย่างที่สุด\n\nแม้พี่ปอนด์จะทำเคสสูญเสียมาเป็นพันเคส แต่เหตุการณ์ครั้งนี้กลับรู้สึกจุกอกจนพูดไม่ออกจริงๆ เพราะการเห็นผ้าเหลืองและพระธุดงค์ที่ชาวบ้านศรัทธาจำนวนมากต้องจากไปพร้อมกัน ทำให้เขานิ่งเฉยไม่ได้ จึงตัดสินใจระดมรถของสมาคมถึง 10 คัน เพื่ออำนวยความสะดวกในการเคลื่อนย้ายสังขารของพระสงฆ์ทุกรูปกลับบ้านเกิด โดยไม่คิดเงินหรือหวังสิ่งตอบแทนเลยแม้แต่บาทเดียว\n\nการส่งคณะสงฆ์กลับบ้านอย่างสมเกียรติครั้งสุดท้าย ถือเป็นสะพานบุญที่ยิ่งใหญ่ ขออนุโมทนากับน้ำใจของพี่ปอนด์และทีมงานทุกคนที่ช่วยแบ่งเบาความทุกข์ของญาติผู้สูญเสียครั้งนี้ด้วยค่ะ"}
];

const byReactions = (n) => {
  const p = SAMPLES.find(s => s.reactions === n);
  if (!p) throw new Error(`ไม่มีตัวอย่าง reactions=${n} ในฟิกซ์เจอร์`);
  return p;
};

function expectFeatures(f, expected, label) {
  for (const [k, v] of Object.entries(expected)) {
    if (typeof v === 'object' && v !== null) {
      if ('gte' in v) assert.ok(f[k] >= v.gte, `${label}: ${k} ต้อง ≥ ${v.gte} (ได้ ${f[k]})`);
      if ('lte' in v) assert.ok(f[k] <= v.lte, `${label}: ${k} ต้อง ≤ ${v.lte} (ได้ ${f[k]})`);
    } else {
      assert.equal(f[k], v, `${label}: ${k} ต้อง = ${v} (ได้ ${f[k]})`);
    }
  }
}

test('ฟิกซ์เจอร์ครบ 7 โพสต์ และตัวนับคำตรง fb-posts (Intl.Segmenter วิธีเดียวกัน)', () => {
  assert.equal(SAMPLES.length, 7);
  for (const s of SAMPLES) {
    const f = extractFeatures(s.text);
    assert.equal(f.words, s.words, `ตัวนับคำตรง fb-posts: ${s.reactions} ต้อง ${s.words} คำ (ได้ ${f.words})`);
  }
});

test('TOP 167,713 ‘พี่หนุ่ม’ มอบ 20,000 บาท — สามเหลี่ยมการให้ครบ: เครือญาติ+ชื่อ 30 ตัวแรก · ตัวเลขน้ำใจ · เพราะ… ย่อหน้า 2', () => {
  const f = extractFeatures(byReactions(167713).text);
  expectFeatures(f, {
    words: 161, paragraphs: 3, threeParagraphs: 1,
    kinshipNameInFirst30: 1, kinshipNameInFirst120: 1,
    hardshipNumber: 3, moneyNumber: 3, giftAmount: 1, giveWords: { gte: 1 },
    open_name_action: 1, causeOpening2: 1,
    orgGiverInFirst60: 0, orgGiverInFirstPara: 0, titleHonorificFirst: 0,
    hasDirectQuoteToReceiver: 0, band_146_169: 1, dashOrPoemFormat: 0, genericClosing: 0,
  }, 'พี่หนุ่ม');
  assert.equal(OPENING_TYPES[f.openingTypeIndex], 'name_action');
  assert.equal(LENGTH_BANDS[f.lengthBand].key, 'band_146_169');
});

test('TOP 95,064 พ่อเดิน 28 กิโล — คำพูดตรงถึงผู้รับ “พี่ขึ้นหลังกระบะเลย” · เดิมพัน · น้ำตา/กอดตอนปิด · เปิดแบบความต่าง', () => {
  const f = extractFeatures(byReactions(95064).text);
  expectFeatures(f, {
    words: 197, quoteCount: 2, hasDirectQuoteToReceiver: 1,
    hardshipNumber: 2, stakeWords: { gte: 2 }, hasStake: 1,
    closingTearsHug: 1, open_contrast: 1, bodyImageWords: { gte: 5 }, ellipsisCount: 1,
    kinshipNameInFirst30: 0, orgGiverInFirst60: 0, band_170_199: 1,
  }, 'พ่อเดิน 28 กิโล');
});

test('TOP 155,325 น้องข้าวหอมวิ่ง 2 กิโล — เปิดด้วยตัวเลข · ปิดสะท้อนเปิด (เด็ก/วิ่ง/กิโล/แม่) · ตัวเลขน้ำใจ 100,000 บาท', () => {
  const f = extractFeatures(byReactions(155325).text);
  expectFeatures(f, {
    words: 211, open_number: 1, giftAmount: 1, hardshipNumber: { gte: 4 }, moneyNumber: { gte: 2 },
    stakeWords: { gte: 2 }, closingEchoesOpening: { gte: 0.3 }, band_200_229: 1, paragraphs: 3,
  }, 'น้องข้าวหอม');
});

test('TOP 165,089 ไม่แปลกใจทำไมฮลุน — เปิดชื่นชม/ไม่แปลกใจ · หักครั้งที่ 2 "แต่สุดท้าย" · คนเล่าฟันธง · คำพูดในเรื่องไม่ใช่คำพูดถึงผู้รับ', () => {
  const f = extractFeatures(byReactions(165089).text);
  expectFeatures(f, {
    words: 180, open_praise: 1, open_contrast: 0, secondTurn: 1, narratorVerdict: { gte: 1 },
    quoteCount: 1, quotedNames: 3, hasDirectQuoteToReceiver: 0, causeOpening2: 1,
  }, 'ฮลุน');
  assert.equal(OPENING_TYPES[f.openingTypeIndex], 'praise');
});

test('LOW 2,490 27 เคสดำ (ป่อเต็กตึ๊งไร้หน้า) — ผู้ให้เป็นองค์กรในย่อหน้าแรก · ไม่มีเครือญาติ+ชื่อ · ไม่มีคำพูด', () => {
  const f = extractFeatures(byReactions(2490).text);
  expectFeatures(f, {
    words: 209, orgGiverInFirstPara: 1, orgGiverInFirst60: 0, orgWordCount: { gte: 3 },
    kinshipNameInFirst30: 0, kinshipNameInFirst120: 0, quoteCount: 0, quotedNames: 0,
    open_number: 1, paragraphs: 3,
  }, '27 เคสดำ');
});

test('LOW 2,461 "ณเดชน์" ไม่ฟ้องไรเดอร์ — คนดังไม่มีเดิมพัน: เปิดชื่อ+การกระทำ · ดารา · ไม่มีคำเดิมพัน · ไม่ปิดคำคม', () => {
  const f = extractFeatures(byReactions(2461).text);
  expectFeatures(f, {
    words: 197, open_name_action: 1, celebWords: { gte: 1 }, stakeWords: 0, hasStake: 0,
    kinshipNameInFirst30: 0, genericClosing: 0, giftAmount: 0, hasDirectQuoteToReceiver: 0,
  }, 'ณเดชน์');
});

test('TOP 164,088 พี่ปอนด์รับปากจัดรถ 10 คัน — ประโยคปลอบถึงผู้รับ · ปิดด้วย "ขออนุโมทนา" (คำคม/อวยพร) · เครือญาติ+ชื่ออยู่หลัง 30 ตัวแรก', () => {
  const f = extractFeatures(byReactions(164088).text);
  expectFeatures(f, {
    words: 189, comfortToReceiver: 1, genericClosing: 1,
    kinshipNameInFirst30: 0, kinshipNameInFirst120: 1, open_other: 1, stakeWords: { gte: 3 }, giveWords: { gte: 2 },
  }, 'พี่ปอนด์');
});

test('ทุกโพสต์: ตัวเลขล้วน ไม่มี NaN · one-hot ประโยคเปิด/โซนความยาว = 1 ตัวพอดี · deterministic', () => {
  for (const s of SAMPLES) {
    const f = extractFeatures(s.text);
    for (const k of MODEL_FEATURES) assert.ok(Number.isFinite(f[k]), `${s.reactions}: ${k} ต้องเป็นตัวเลข (ได้ ${f[k]})`);
    for (const [k, v] of Object.entries(f)) assert.equal(typeof v, 'number', `${k} ต้องเป็น number`);
    const openSum = OPENING_TYPES.reduce((a, t) => a + f[`open_${t}`], 0);
    assert.equal(openSum, 1, `${s.reactions}: one-hot ประโยคเปิดต้องรวม = 1`);
    const bandSum = LENGTH_BANDS.reduce((a, b) => a + f[b.key], 0);
    assert.equal(bandSum, 1, `${s.reactions}: one-hot โซนความยาวต้องรวม = 1`);
    assert.deepEqual(extractFeatures(s.text), f, 'ข้อความเดิมต้องได้ตัวเลขเดิม');
    assert.deepEqual(extractFeatures(s.text.replace(/\n/g, '\r\n')), f, 'CRLF ต้องได้ผลเท่า LF');
  }
});

test('ข้อความว่าง/ไม่ใช่สตริง → ศูนย์ทุกตัว ไม่ล้ม', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}, []]) {
    const f = extractFeatures(bad);
    assert.equal(f.words, 0);
    for (const k of MODEL_FEATURES) assert.equal(f[k], 0, `${k} ต้อง 0 สำหรับ ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(extractFeatures(''), emptyFeatures());
});

test('โซนความยาว: ขอบ 146/170/200/230/270 คำ ตกถูกโซน', () => {
  const mk = (n) => Array.from({ length: n }, () => 'ข้าว').join(' ');
  assert.equal(segmentWords(mk(146)).length, 146, 'ตัวสร้างข้อความต้องได้จำนวนคำตรง');
  const cases = [[145, 'band_lt146'], [146, 'band_146_169'], [169, 'band_146_169'], [170, 'band_170_199'],
    [199, 'band_170_199'], [200, 'band_200_229'], [229, 'band_200_229'], [230, 'band_230_269'], [269, 'band_230_269'], [270, 'band_ge270'], [400, 'band_ge270']];
  for (const [n, key] of cases) {
    const f = extractFeatures(mk(n));
    assert.equal(f.words, n);
    assert.equal(f[key], 1, `โซนความยาว ${n} คำ ต้องเป็น ${key}`);
    assert.equal(LENGTH_BANDS[f.lengthBand].key, key);
  }
});

test('ตัวจับรูปแบบ/คำคม/คำนำหน้า/คำถาม/คำพูดนำ ยิงตรง', () => {
  const dash = extractFeatures('พี่เอ มอบเงิน 500 บาท — ให้น้องบี\n\nเพราะน้องลำบาก\n\nจบ');
  assert.equal(dash.dashOrPoemFormat, 1, 'มีขีดกลาง — ต้องนับเป็นรูปแบบผิด');
  const poem = extractFeatures('บรรทัดหนึ่ง\nบรรทัดสอง\nบรรทัดสาม\nบรรทัดสี่\nบรรทัดห้า\nบรรทัดหก');
  assert.equal(poem.dashOrPoemFormat, 1, 'บรรทัดสั้น ≥ 5 บรรทัด = กลอน');
  assert.equal(poem.paragraphs, 6);
  const plain = extractFeatures('ย่อหน้าหนึ่งเล่าเรื่องยาวพอสมควรของพี่เอที่ช่วยน้องบี\n\nย่อหน้าสองเล่าที่มาความลำบากของน้องบีที่ไม่มีเงิน\n\nย่อหน้าสามปิดเรื่อง');
  assert.equal(plain.dashOrPoemFormat, 0);
  assert.equal(plain.threeParagraphs, 1);

  const generic = extractFeatures('ลุงดำ ป่วยหนัก\n\nเพราะไม่มีเงิน\n\nขอให้ลุงหายไวๆ นะ ความดีจะอยู่ตลอดไป');
  assert.equal(generic.genericClosing, 1, 'ขอให้… = ปิดคำคม/อวยพรลอยๆ');
  const echo = extractFeatures('ลุงดำเดิน 30 กิโล มาหาหลาน\n\nเพราะไม่มีเงิน\n\nลุงดำที่เดิน 30 กิโล วันนี้ได้กอดหลาน');
  assert.ok(echo.closingEchoesOpening >= 0.5, `ปิดซ้ำภาพ/ตัวเลขเปิด ต้อง ≥ 0.5 (ได้ ${echo.closingEchoesOpening})`);
  assert.equal(echo.genericClosing, 0);
  assert.equal(echo.closingTearsHug, 1);

  const title = extractFeatures('นายสมชาย ใจดี มอบเงิน 10,000 บาท ให้ผู้ป่วย');
  assert.equal(title.titleHonorificFirst, 1);
  assert.equal(extractFeatures('พี่ชาย มอบเงิน 10,000 บาท').titleHonorificFirst, 0);

  const q = extractFeatures('ใครจะคิดว่าเด็กคนนี้จะเดิน 20 กิโลเพื่อแม่');
  assert.equal(q.open_question, 1);
  const quote = extractFeatures('“เงินประกันตัวไม่พอ ให้มาเอาที่พี่” คือคำพูดของพี่เจนถึงพ่อ ตชด.');
  assert.equal(quote.open_quote, 1, 'เปิดด้วยคำพูดยาว ≥ 15 ตัวอักษร = quote');
  assert.equal(quote.hasDirectQuoteToReceiver, 1, 'ให้มาเอาที่พี่ = คำพูดตรงถึงผู้รับ');
  const nameQuote = extractFeatures('“พี่ปอนด์” รับปากจะจัดรถ 10 คัน');
  assert.equal(nameQuote.open_name_action, 1, 'ชื่อในเครื่องหมายคำพูดสั้น = ชื่อ+การกระทำ ไม่ใช่คำพูด');
  assert.equal(nameQuote.kinshipNameInFirst30, 1);
  assert.equal(extractFeatures('มูลนิธิป่อเต็กตึ๊ง มอบเงิน 20,000 บาท').orgGiverInFirst60, 1);
  assert.equal(extractFeatures('กรมสมเด็จพระเทพฯ เสด็จ').orgGiverInFirst60, 0, 'กรมสมเด็จ = พระราชวงศ์ ไม่ใช่องค์กร');
  assert.equal(extractFeatures('กรมป่าไม้ ส่งเจ้าหน้าที่ช่วย').orgGiverInFirst60, 1);
  assert.equal(extractFeatures('น้าจะช่วยเอง อาเรวัชขอช่วยเอง').kinshipNameInFirst30, 1, 'อา+เรวัช = เครือญาติ+ชื่อ');
  assert.equal(extractFeatures('ญาติพี่น้องของพระสงฆ์ทุกรูป').kinshipNameInFirst30, 0, 'พี่น้อง ไม่ใช่ชื่อ');
  assert.equal(extractFeatures('พ่อคนหนึ่งที่ไม่มีพื้นฐานดนตรี').kinshipNameInFirst30, 0, 'พ่อคนหนึ่ง ไม่ใช่ชื่อ');
  assert.equal(extractFeatures('ให้หลวงพ่อพงษ์ดูแล').kinshipNameInFirst30, 1, 'หลวงพ่อ+พงษ์');
});

test('featureVector เรียงตาม MODEL_FEATURES และเติม 0 ให้คีย์ที่หาย', () => {
  const v = featureVector({ words: 150, paragraphs: 3 });
  assert.equal(v.length, MODEL_FEATURES.length);
  assert.equal(v[MODEL_FEATURES.indexOf('words')], 150);
  assert.equal(v[MODEL_FEATURES.indexOf('paragraphs')], 3);
  assert.equal(v[MODEL_FEATURES.indexOf('quoteCount')], 0);
  assert.deepEqual(featureVector(null), new Array(MODEL_FEATURES.length).fill(0));
  assert.deepEqual(featureVector({ words: NaN }), new Array(MODEL_FEATURES.length).fill(0), 'NaN → 0');
  assert.equal(new Set(MODEL_FEATURES).size, MODEL_FEATURES.length, 'ชื่อฟีเจอร์ห้ามซ้ำ');
});

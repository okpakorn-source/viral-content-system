// ★ 2 ก.ย. 69 — ตัวทำนาย "โอกาสปัง" (scripts/train-viral-score.mjs + src/lib/feedback/viralScore.js + /api/feedback/score)
//   ส่วน 1 เทรน: ฟิกซ์เจอร์สังเคราะห์ 200 แถว (สุ่มคงที่) → ridge ลู่เข้าค่าสัมประสิทธิ์จริง · Spearman valid > 0.5
//   ส่วน 2 ให้คะแนน: โมเดลจริงจาก data/viral-score-model.json → โพสต์ TOP จริง 5 ใบ ต้องได้คะแนนสูงกว่า LOW จริง ≥ 4 ใน 5 คู่
//              (คู่เลือกล่วงหน้า: TOP 5 อันดับแรก vs LOW 5 อันดับแรกของ technique-sample.json ไม่ได้เลือกหลังเห็นผล)
//   ส่วน 3 ไม่มีไฟล์โมเดล / ไฟล์เพี้ยน → null ไม่พัง
//   ส่วน 4 route stub: โหลด route จริงแบบอ่านข้อความแล้วแทน import ด้วยตัวปลอม (แบบ tests/bot-tracking-route.test.mjs)
//   รัน: node --test tests/viral-score.test.mjs (ต้องมี data/viral-score-model.json — เทรนด้วย node scripts/train-viral-score.mjs)
//
// ผลการทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนโค้ด (ยิงจริง 2 ก.ย. 69 — สคริปต์ทุบ-เทส-คืนไฟล์ byte-exact · กัดครบ 9/9):
//   M1 ridgeFit ไม่ใส่ λ บนแนวทแยง (XᵀX เฉยๆ)                     ⇒ แดง 1/17: 'ridge: … λ ใหญ่ต้องหดน้ำหนัก'
//   M2 spearman คืน pearson ของค่าดิบ (ไม่แปลงเป็นอันดับ)            ⇒ แดง 1/17: 'spearman: อันดับไม่ใช่ค่าดิบ'
//   M3 topDecilePrecision ใช้ค่าต่ำสุดแทนสูงสุด                       ⇒ แดง 2/17: 'ตัววัดอันดับ…' + 'เทรนฟิกซ์เจอร์สังเคราะห์…'
//   M4 percentileOf คืน 50 เสมอ                                       ⇒ แดง 2/17: 'quantiles + percentileOf…' + 'TOP จริง ชนะ LOW จริง' (ทุกใบ 50 = ชนะ 0/5)
//   M5 computeRaw ไม่หาร std (ใช้ x−mean ดิบ)                        ⇒ แดง 2/17: 'เทรนฟิกซ์เจอร์สังเคราะห์…' (computeRaw ≠ predictRow) + 'TOP จริง ชนะ LOW จริง'
//   M6 loadModel ไม่ตรวจ isValidModel                                 ⇒ แดง 1/17: 'ไม่มีไฟล์โมเดล → null … ไฟล์โมเดลเพี้ยน → null'
//   M7 route: ตัดด่าน fail-closed (ไม่ตั้ง env → 403)                 ⇒ แดง 1/17: 'route: ไม่ตั้ง env → 403'
//   M8 route: secretsMatch คืน true เสมอ                              ⇒ แดง 1/17: 'route: กุญแจผิด/ไม่ส่ง/ยาวเท่ากัน → 401'
//   M9 route: ไม่เช็ค result null → ไม่ส่ง 503                         ⇒ แดง 1/17: 'route: ไม่มีโมเดล → 503'
// ผลจริงตอนเขียน (โมเดล seed 20260902 λ=1000): TOP ชนะ LOW 5/5 · คะแนนเฉลี่ย 70 ใบ TOP 75.2 / MID 59.7 / LOW 49.1
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildModel, ridgeFit, fitScale, applyScale, solveLinear, spearman, pearson, topDecilePrecision, pairwiseAccuracy,
  splitTrainValid, seededRandom, quantiles, crossValidateLambda, predictRow,
} from '../scripts/train-viral-score.mjs';
import { scoreVersion, scoreVersions, loadModel, resetModelCache, percentileOf, bandOf, computeRaw, buildWarnings, getModelMetrics, isValidModel, FEATURE_LABELS_TH } from '../src/lib/feedback/viralScore.js';
import { extractFeatures, MODEL_FEATURES } from '../src/lib/feedback/viralFeatures.js';

const ROOT = new URL('..', import.meta.url);
const MODEL_PATH = new URL('data/viral-score-model.json', ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// โพสต์จริง: TOP 5 อันดับแรก + LOW 5 อันดับแรก (technique-sample.json) — {tier, reactions, words, text}
const SAMPLES = [
  {"tier":"TOP","reactions":310229,"words":223,"text":"พ่อคนหนึ่งที่ไม่มีพื้นฐานดนตรีสักนิด แต่เลือกลงทุนทุกอย่างเพื่อความฝันของลูกสาว \"พ่อณรงค์ อำลอย\" วัย 57 ปี เป็นช่างแกะสลักและช่างปูนปั้น มือที่คุ้นกับสิ่วและปูนกลับเป็นมือเดียวกันที่กดปุ่มเปิดเพลงร็อกให้เนเน่ฟังตั้งแต่ยังเล็ก เขาไม่ได้สอนลูกให้เป็นนักร้อง เขาแค่แบ่งสิ่งที่ตัวเองรักให้ลูกได้ยิน แล้ววันหนึ่งลูกก็รักมันจริงๆ\n\nพอเห็นแววว่าเนเน่ชอบไม่ใช่เล่นๆ พ่อก็พาเธอไปเล่นดนตรีเปิดหมวกตามตลาด ให้ได้ยืนหน้าคนแปลกหน้า ได้เก็บทุกอย่างไว้เป็นประสบการณ์ แล้วยังลงทุนสร้างห้องซ้อมให้ลูกกับเพื่อนในวงได้ฝึกกันเต็มที่ วันที่โอกาสไป America’s Got Talent มาถึง ค่าใช้จ่ายสูงจนครอบครัวต้องคิดหนัก แต่พ่อกับแม่ตัดสินใจพาลูกไป เพราะเชื่อในฝันของเธอ\n\nแต่สิ่งที่เนเน่จำได้แม่นที่สุด ไม่ใช่เสียงปรบมือที่ดังลั่น เธอบอกว่าเป็นตอนหันไปเห็นพ่อยืนร้องไห้อยู่ข้างเวทีด้วยความตื้นตัน น้ำตาของช่างปูนปั้นคนหนึ่ง คือรางวัลที่ยิ่งใหญ่กว่าคำว่า Yes ทั้งสี่"},
  {"tier":"TOP","reactions":244960,"words":254,"text":"เกรดเฉลี่ย 4.00 เต็มกระดาษ แต่ที่บ้านมีเงินแค่วันละร้อยบาทพอกินมื้อต่อมื้อ 'น้องพลอย' นางสาวศรศิริพา รัตนพร กำลังจะขึ้น ม.4 ที่โรงเรียนศรีกระนวนวิทยาคม อำเภอกระนวน จังหวัดขอนแก่น เด็กคนนี้เก่งจนน่าทึ่ง แต่เก่งอย่างเดียวมันไม่พอ เพราะคำว่า \"ไม่มี\" เกือบทำให้ทางเดินของเธอสะดุดลงกลางคัน\n\nพ่อกับแม่แยกทางกันตั้งแต่เธอยังเล็ก คนที่อยู่ข้างกันมาตลอดคือยายจำรัตน์ ยายรับจ้างทั่วไป หาเงินได้วันละราวร้อยบาท เก็บทีละนิดเพื่อดันหลานขึ้นไปทีละก้าว เรื่องของน้องพลอยไปถึงครูติ๊กและรองฯ อวตาร ที่ช่วยกันส่งเรื่องออกไป จนถึงมือดีเจภูมิจากช่องคนหัวครัว ที่จับมือกับแบรนด์รองเท้า ADDA Wink ขับรถตรงไปถึงบ้าน วันนั้นน้องพลอยได้ทุนค่าเทอมจนจบ ม.6 โอนเข้าบัญชีโรงเรียน พร้อมไอแพด โทรศัพท์เครื่องใหม่ และกีตาร์โปร่งยามาฮ่า หนึ่งตัว ทีมงานวางเงินสด 20,000 บาทฝากไว้ที่ครู และยื่นอีก 10,000 บาทให้ยายจำรัตน์ไว้ใช้ในบ้าน\n\nก่อนกลับ ดีเจภูมิบอกสั้นๆ ว่าถ้ารักษาเกรดให้เกิน 3.80 จนจบ ม.6 จะส่งเรียนต่อมหาวิทยาลัย จากเด็กที่เคยมีแค่เกรดในมือ วันนี้น้องพลอยมีคนที่เชื่อว่าเธอไปได้ไกลกว่านี้"},
  {"tier":"TOP","reactions":200918,"words":164,"text":"“เตรียมทนายไว้ให้แล้ว จบรายการเมื่อไหร่เซ็นแต่งตั้งได้เลย” คือคำพูดจากพี่หนุ่มกรรชัยถึงครูทราย แม้วันนี้เธอและลูกน้อยจะสูญเสียคุณพ่ออายุแค่ 30 แต่จากนี้ไม่ต้องสู้ลำพังแล้ว\n\nระหว่างพูดในรายการ พี่หนุ่มได้ถามอดีตผู้ช่วยรัฐมนตรีสาธารณะสุขว่า ถ้าอยากช่วยครูทรายดำเนินการกับผู้เกี่ยวข้องจะทำอย่างไร เพราะแค่พี่หนุ่มได้เห็นภาพแม่ที่ร้องไห้ และลูกน้อยที่ยังไม่เข้าใจก็สะเทือนใจคนเป็นพ่อไม่น้อย และพี่หนุ่มยังบอกว่ากรณีนี้ปกติถ้าขึ้นศาลมักยาก เพราะไม่ค่อยมีแพทย์มาช่วยเป็นพยาน\n\nแต่จากนี้ครูทรายไม่ต้องกังวลแล้ว เพราะพี่หนุ่มจะแต่งตั้งทนายให้ ..แม้สุดท้ายความสูญเสียจะประเมินค่าไม่ได้ แต่ครูทรายและลูกน้อยควรได้รับการเยียวยาถึงที่สุด"},
  {"tier":"TOP","reactions":177087,"words":161,"text":"ญาติพระสงฆ์ผู้สูญเสียบ่ต้องห่วงเด้อครับ พี่ปอนด์จักรกฤษณ์ ขอเป็นตัวแทนคนไทย ส่งรถ 8 คัน รับพระทุกรูปกลับบ้านครั้งสุดท้าย ฟรี\n\nแม้ภารกิจช่วยเหลือผู้จากไปฟรีทั่วประเทศจะล้นมือ ใช้ทั้งแรงกายและเงินส่วนตัวอยู่ทุกวัน แต่แม้เขาจะไม่ใช่ผู้นำ ไม่ใช่นักธุรกิจ แต่ทันทีที่พี่ปอนด์ทราบข่าวอุบัติเหตุ และได้รับการติดต่อจากผู้ว่า เขาก็รีบวางทุกอย่างในมือ ออกเงินส่วนตัว จัดรถ 8 คัน มุ่งหน้าสู่มุกดาหาร เพื่อรับ 8 พระสงฆ์กลับภูมิลำเนา โดยไม่คิดค่าใช้จ่าย ทันที\n\nเพราะในวันที่พระหลายรูปเจ็บทางกาย หลายครอบครัวต้องเผชิญความสูญเสียทางใจ การมีใครสักคนยื่นมือช่วยพาผู้จากไปกลับบ้านอย่างสมเกียรติ คืออีกหนึ่งกำลังใจที่อบอุ่นที่สุด"},
  {"tier":"TOP","reactions":167713,"words":161,"text":"‘พี่หนุ่ม’ ตัดสินใจมอบเงินจำนวน 20,000 บาท กลางรายการโหนกระแส หลังได้ฟังเรื่องราวชีวิตของ ‘พี่ขยัน’  เพื่อให้เธอนำไปใช้จ่ายและดูแลตัวเองกับครอบครัว พร้อมกำชับว่าเงินก้อนนี้ต้องเก็บไว้ใช้ดำรงชีวิต\n\nเพราะทั้งชีวิตของพี่ขยัน รู้จักแต่การหาเลี้ยงชีพด้วยการเก็บผักบุ้งขายกำละ 5 บาท 10 บาท จนลูกสาวยังบอกว่า แม่ไม่รู้ด้วยซ้ำว่าเงินล้านมันมากแค่ไหน เพราะขนาดเงินหมื่นหรือเงินแสน แม่ก็ยังไม่เคยมีโอกาสได้จับมาก่อน\n\nทำเอาหลายคนที่ติดตามเรื่องนี้รู้สึกอบอุ่นใจกับการตัดสินใจของพี่หนุ่ม เพราะสำหรับบางคน เงินหมื่นอาจเป็นเพียงตัวเลขหนึ่ง แต่สำหรับพี่ขยัน มันคือกำลังใจครั้งใหญ่ และอาจเป็นหนึ่งในเงินก้อนที่มากที่สุดที่เธอเคยได้รับในชีวิต"},
  {"tier":"LOW","reactions":2493,"words":226,"text":"ในวัย 14 ปี เด็กคนหนึ่งใช้เวลาหลังเลิกเรียนทุกวันไม่เคยขาดไปกับการช่วยงานที่บ้านทุกอย่างที่พอทำได้ ‘น้องเชน’ ทั้งโกยถ่าน ขนไม้ ถางหญ้า และตัดผม เพื่อดูแลคุณตาวัยเกือบ 80 ปี และน้องชายอีกหนึ่งคน น้องเชนเคยบอกว่ารักคุณตาและเป็นห่วงน้องมาก จึงไม่เคยคิดทิ้งบ้านไปไหน เพราะถ้าเขาไม่อยู่ ก็ไม่มีใครคอยดูแลทั้งสองคน\n\nย้อนกลับไปตั้งแต่ลืมตาดูโลก น้องเชนถูกฝากไว้กับคุณตาตั้งแต่เกิด อีกสี่ปีต่อมา “น้องโชค” น้องชายของเขา ก็มาอยู่บ้านเดียวกัน คุณตาที่ฐานะยากจนต้องแบกหลานสองคนไว้ลำพัง น้องเชนเลยเริ่มออกหาอะไรทำตั้งแต่อายุเพียง 10 ขวบ พระอาจารย์ในพื้นที่คอยช่วยเหลือทั้งข้าวสาร อาหารแห้ง และให้ยืมรถพ่วงสำหรับใช้รับจ้างทำงาน ส่วนน้องโชค วัย 10 ขวบ เคยเกิดอุบัติเหตุ จนบาดเจ็บหนักที่กระดูกสันหลัง หมองดยกของหนัก ภาระเสาหลักทั้งหมดเลยตกอยู่ที่พี่ชายคนเดียว\n\nเด็กมัธยมต้นที่หลายคนคิดว่ายังต้องพึ่งผู้ใหญ่ วันนี้กลับเป็นเสาหลักของบ้านด้วยสองมือของตัวเอง"},
  {"tier":"LOW","reactions":2490,"words":209,"text":"27 เคสดำได้กลับบ้านเกิดในวันที่ครอบครัวยังไม่ทันตั้งตัว รถอาสาสมัครของมูลนิธิป่อเต็กตึ๊งวิ่งออกจากกรุงเทพฯ มุ่งหน้าไปตามภูมิลำเนาเดิมทั่วประเทศ โดยไม่คิดค่าใช้จ่ายแม้แต่บาทเดียว \n\nระยะทางหลายร้อยกิโลจากเมืองหลวงไปถึงบ้านต่างจังหวัด กับค่าใช้จ่ายที่ตามมาในวันที่ใจแทบไม่เหลือแรง มูลนิธิป่อเต็กตึ๊งเลือกยกภาระนั้นออกจากไหล่ครอบครัว จัดรถ จัดคน พาทั้ง 27 รายกลับไปให้ถึงที่ ไม่ใช่แค่ส่งของ แต่คือการพาคนที่เขารักกลับไปหาคนที่รอ แล้วยังไม่หยุดแค่นั้น มูลนิธิอนุมัติเงินเยียวยาฉุกเฉินให้ครอบครัวรายละ 20,000 บาท เงินก้อนนี้ไม่ได้ลบความเสียใจออกไปได้ แต่พอจะประคองให้ครอบครัวยืนอยู่ได้ในวันแรกๆ ที่ทุกอย่างหนักเกินจะรับไหว\n\nหลังไฟสงบ แสงข่าวจางลง ยังมีคนอีกกลุ่มทำงานต่อแบบเงียบๆ ยื่นมือไปถึงหน้าประตูบ้านของแต่ละครอบครัว 27 รายได้กลับภูมิลำเนา พร้อมความช่วยเหลือที่ส่งถึงคนข้างหลังในคืนที่มืดที่สุด"},
  {"tier":"LOW","reactions":2488,"words":171,"text":"แม้เป็นถึงนางงามระดับโลก ชีวิตพลิกผันแต่งงานกับนักธุรกิจพันล้าน แต่ ”กบปภัสรา“ กลับไม่ใช้แบรนด์ ไม่เที่ยวหรูหรา อายุ 56 ซื้อที่ 1,000 ไร่ ทำสวนองุ่น ปลูกผลไม้ ตามในหลวงร.9\n\nคงจะจริงอย่างที่พี่กบพูด “เมื่อไม่ยึดติดก็ไม่ทุกข์” เพราะใครจะคิดจากเด็กจบแค่ม.3 ที่ใครๆก็เรียกซินเดอร์เรลล่าเมืองไทยข้ามคืน เพราะแต่งกับนักธุรกิจพันล้าน แต่พี่กบพิสูจน์แล้วว่า เธอไม่ได้ตามหาความร่ำรวย หากแต่เป็นความสุขที่ยั่งยืนกว่า วันนี้ในวัย 56 พี่กบเลือกกลับบ้านเกิดสุพรรณ เพื่อทำ “บ้านกบ” เลี้ยงไก่ ปลูกผักกินเอง \n\nและไม่ใช่แค่ไม่ยึดติดกับเงินทอง แต่พี่กบยังตัดสินบริจาคร่างกาย ถวายมงกุฎสายสะพายแก่วัดเมื่อจากไปแล้ว เพราะชื่อเสียงเงินทองเป็นของชั่วคราว แต่ความดีต่างหากที่อยู่ตลอดไป"},
  {"tier":"LOW","reactions":2463,"words":228,"text":"ลูกผู้ชายตัวจริง กล้าทำก็กล้ารับ \"ติณติณ\" พร้อมก้าวเข้าสู่บทบาทคุณพ่อป้ายแดงอย่างเต็มภาคภูมิ ทั้งยินดีจดทะเบียนรับรองบุตรให้ถูกต้องตามกฎหมาย ช่วยค่าฝากครรภ์และค่าใช้จ่ายต่างๆทันที ถือเป็นความรับผิดชอบที่น่านับถือจนได้รับเสียงชื่นชมจากหลายคน\n\nทางฝั่งฟารีดาเองก็แสดงให้เห็นถึงความเป็นผู้ใหญ่ไม่แพ้กัน ด้วยการเปิดใจเข้าสู่กระบวนการไกล่เกลี่ยอย่างประนีประนอม ไม่ได้เรียกร้องอะไรเกินความจำเป็น ขอเพียงให้ทั้งสองฝ่ายช่วยกันดูแลลูกน้อยที่กำลังจะลืมตาดูโลกอย่างเต็มที่ เพราะท้ายที่สุดแล้ว สิ่งสำคัญที่สุดไม่ใช่ความสัมพันธ์ของคนสองคน แต่คืออนาคตและความสุขของเด็กคนหนึ่งที่กำลังจะเกิดมา\n\nแน่นอนว่าวันหนึ่งเมื่อลูกเติบโตขึ้น เขาอาจได้เห็นเรื่องราวทั้งหมดที่เคยเกิดขึ้น แต่เชื่อว่าความทรงจำที่ลูกจะได้รับ ไม่ใช่ภาพของการนั่งโทษกันไปมา แต่จะเป็นเรื่องราวของพ่อและแม่ที่แม้ไม่ได้เดินเคียงข้างกันในฐานะคนรัก แต่ก็ทำหน้าที่ของตัวเองอย่างดีที่สุด และร่วมกันมอบความรักให้ลูกอย่างเต็มหัวใจ"},
  {"tier":"LOW","reactions":2461,"words":197,"text":"\"ณเดชน์\" เปิดใจไม่ฟ้องไรเดอร์ ไม่โกรธแถมยังเห็นใจพี่ไรเดอร์ด้วยซ้ำที่เจอกระแสสังคม พร้อมทิ้งท้ายอย่างอบอุ่นว่าทุกคนยังคงเข้ามาทักทาย ขอถ่ายรูป และใช้ชีวิตร่วมทางกับเขาได้ปกติเหมือนเดิม\n\nณเดชน์อยู่ในวงการมา 17 ปี ไม่ได้ให้อภัยเพื่อรักษาภาพลักษณ์ แต่มันมาจากจิตใจที่มองโลกในแง่ดีจริงๆ เขามองว่ามันคือความผิดพลาดของทั้งสองฝ่ายที่เกิดจากความไม่รู้ เลยไม่คิดจะฟ้องร้อง แต่หวังให้เป็นบทเรียนกับสังคมและบริษัทไรเดอร์ตระหนักถึงเรื่องความปลอดภัยของคนทำงานและลููกค้า เพราะเชื่อว่าไรเดอร์เองก็ไม่ได้มีเจตนาที่ไม่ดี\n\nการมองโลกด้วยความเข้าใจและเอื้ออาทรต่อกันแบบนี้ ไม่แปลกใจเลยว่าทำไมแฟนคลับถึงรักและเอ็นดูผู้ชายคนนี้มาตลอด คำว่า \"พระเอกตัวจริง\" ไม่ได้อยู่แค่ในบทละคร แต่คือตัวตนที่แท้จริงของ \"ณเดชน์ คูกิมิยะ\""}
];
const TOP = SAMPLES.filter(s => s.tier === 'TOP');
const LOW = SAMPLES.filter(s => s.tier === 'LOW');

// ---------- ส่วน 1: คณิตศาสตร์เทรน ----------
test('solveLinear แก้ระบบ 3×3 ถูก', () => {
  const x = solveLinear([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
  // 2x+y−z=8 · −3x−y+2z=−11 · −2x+y+2z=−3 → (2, 3, −1)
  assert.ok(Math.abs(x[0] - 2) < 1e-9 && Math.abs(x[1] - 3) < 1e-9 && Math.abs(x[2] + 1) < 1e-9, `ได้ ${x}`);
  assert.throws(() => solveLinear([[1, 2], [2, 4]], [1, 2]), /singular/);
});

test('spearman: อันดับไม่ใช่ค่าดิบ · เท่ากันหมด/กลับด้าน/มีค่าซ้ำ', () => {
  assert.equal(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1);
  assert.equal(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1);
  // ความสัมพันธ์ทางเดียวแต่ไม่เชิงเส้น: spearman = 1 ขณะ pearson < 1
  const a = [1, 2, 3, 4, 5, 6], b = [1, 10, 100, 1000, 10000, 100000];
  assert.equal(+spearman(a, b).toFixed(9), 1);
  assert.ok(pearson(a, b) < 0.95, `pearson ค่าดิบต้องต่ำกว่า (ได้ ${pearson(a, b)})`);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), 0, 'ค่าคงที่ → 0 ไม่ใช่ NaN');
  const tied = spearman([1, 2, 2, 3], [1, 2, 3, 4]);
  assert.ok(tied > 0.9 && tied < 1, `ค่าซ้ำใช้อันดับเฉลี่ย (ได้ ${tied})`);
});

test('ตัววัดอันดับ: top-decile precision + pairwise accuracy — ทายถูกหมด=1 · กลับด้าน=0', () => {
  const actual = Array.from({ length: 100 }, (_, i) => i);
  assert.equal(topDecilePrecision(actual, actual), 1);
  assert.equal(topDecilePrecision(actual.map(v => -v), actual), 0);
  assert.equal(pairwiseAccuracy(actual, actual), 1);
  assert.equal(pairwiseAccuracy(actual.map(v => -v), actual), 0);
  // ทาย 10 ตัวบนถูก 5 ตัว → 0.5
  const pred = actual.map(v => (v >= 95 ? 1000 + v : v >= 90 ? -1 : v >= 85 ? 500 : v));
  assert.equal(topDecilePrecision(pred, actual), 0.5);
});

test('แบ่ง train/valid 80/20 สุ่มคงที่: ซ้ำได้ · ไม่ซ้อน · seed ต่างได้ต่างชุด', () => {
  const a = splitTrainValid(1000, { seed: 7 });
  const b = splitTrainValid(1000, { seed: 7 });
  const c = splitTrainValid(1000, { seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.valid, c.valid);
  assert.equal(a.valid.length, 200);
  assert.equal(a.train.length, 800);
  assert.equal(new Set([...a.valid, ...a.train]).size, 1000, 'ห้ามซ้อน/ห้ามหาย');
  const r1 = seededRandom(1), r2 = seededRandom(1);
  assert.equal(r1(), r2());
});

test('ridge: λ→0 บนข้อมูลไร้สัญญาณรบกวนกู้สัมประสิทธิ์ได้ · λ ใหญ่ต้องหดน้ำหนัก', () => {
  const rnd = seededRandom(3);
  const X = Array.from({ length: 60 }, () => [rnd(), rnd(), rnd()]);
  const y = X.map(r => 1 + 2 * r[0] - 3 * r[1] + 0.5 * r[2]);
  const scale = fitScale(X);
  const Xz = X.map(r => applyScale(r, scale));
  const fit = ridgeFit(Xz, y, 1e-9);
  const coef = fit.weights.map((w, j) => w / scale.std[j]);
  assert.ok(Math.abs(coef[0] - 2) < 1e-4 && Math.abs(coef[1] + 3) < 1e-4 && Math.abs(coef[2] - 0.5) < 1e-4, `coef ${coef}`);
  const big = ridgeFit(Xz, y, 1e6);
  const normSmall = Math.hypot(...fit.weights), normBig = Math.hypot(...big.weights);
  assert.ok(normBig < normSmall * 0.01, `λ ใหญ่ต้องหดน้ำหนัก (${normBig} vs ${normSmall})`);
  assert.ok(Math.abs(big.bias - y.reduce((a, b) => a + b, 0) / y.length) < 1e-9, 'bias = ค่าเฉลี่ย y');
});

test('เทรนฟิกซ์เจอร์สังเคราะห์ 200 แถว: weights ลู่เข้าค่าจริง · Spearman valid > 0.5 · โมเดลรูปทรงครบ', () => {
  const rnd = seededRandom(20260902);
  const gauss = () => { const u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const names = ['f1', 'f2', 'f3', 'f4', 'f5'];
  const rows = Array.from({ length: 200 }, () => {
    const f = { f1: rnd() * 10, f2: rnd() * 4, f3: rnd() > 0.5 ? 1 : 0, f4: rnd() * 100, f5: rnd() };
    const logy = 2 + 0.12 * f.f1 - 0.3 * f.f2 + 0.4 * f.f3 + 0.05 * gauss();
    return { features: f, reactions: Math.round(Math.pow(10, logy)) - 1 };
  });
  const { model, metrics } = buildModel(rows, { featureNames: names, seed: 11, lambdas: [0.01, 0.1, 1, 10] });
  assert.deepEqual(model.features, names);
  assert.equal(model.weights.length, 5);
  assert.equal(model.scale.mean.length, 5);
  assert.equal(model.calibration.quantiles.length, 101);
  assert.equal(model.nTrain + model.nValid, 200);
  assert.ok(metrics.valid.spearman > 0.5, `Spearman valid ${metrics.valid.spearman} ต้อง > 0.5`);
  assert.ok(metrics.valid.spearman > 0.9, `สัญญาณสังเคราะห์ชัด ต้องได้ > 0.9 (ได้ ${metrics.valid.spearman})`);
  const coef = model.weights.map((w, j) => w / model.scale.std[j]);
  assert.ok(Math.abs(coef[0] - 0.12) < 0.03, `f1 ควร ≈ 0.12 (ได้ ${coef[0]})`);
  assert.ok(Math.abs(coef[1] + 0.3) < 0.06, `f2 ควร ≈ -0.3 (ได้ ${coef[1]})`);
  assert.ok(Math.abs(coef[2] - 0.4) < 0.08, `f3 ควร ≈ 0.4 (ได้ ${coef[2]})`);
  assert.ok(Math.abs(coef[3]) < 0.01, `f4 ไม่มีผล ควร ≈ 0 (ได้ ${coef[3]})`);
  assert.ok(metrics.valid.topDecilePrecision >= 0.5, `top-decile ${metrics.valid.topDecilePrecision}`);
  assert.ok(Object.keys(metrics.cvRmseByLambda).length === 4);
  // ให้คะแนนด้วยโมเดลสังเคราะห์ตรงๆ (ส่งโมเดลเป็น object) → predictRow ตรงกับ computeRaw
  const raw = computeRaw({ f1: 5, f2: 1, f3: 1, f4: 50, f5: 0.5 }, model).raw;
  assert.ok(Math.abs(raw - predictRow([5, 1, 1, 50, 0.5], model)) < 1e-6);
  assert.throws(() => buildModel(rows.slice(0, 5), { featureNames: names }), /น้อยเกินไป/);
});

test('quantiles + percentileOf: interpolate ถูก · ปลายช่วง 0/100', () => {
  const q = quantiles(Array.from({ length: 101 }, (_, i) => i), 100);
  assert.equal(q.length, 101);
  assert.equal(percentileOf(50, q), 50);
  assert.equal(percentileOf(-5, q), 0);
  assert.equal(percentileOf(500, q), 100);
  assert.ok(Math.abs(percentileOf(50.5, q) - 50.5) < 1e-9);
  assert.equal(bandOf(70), 'สูง'); assert.equal(bandOf(69.9), 'กลาง'); assert.equal(bandOf(35), 'กลาง'); assert.equal(bandOf(34), 'ต่ำ');
  assert.equal(bandOf(80, { high: 90, mid: 50 }), 'กลาง', 'ใช้ threshold ของโมเดล');
});

// ---------- ส่วน 2: โมเดลจริง ----------
test('โมเดลจริงมีอยู่และรูปทรงครบ (data/viral-score-model.json)', () => {
  assert.ok(existsSync(MODEL_PATH), `ต้องมี ${MODEL_PATH} — รัน node scripts/train-viral-score.mjs`);
  resetModelCache();
  const m = loadModel();
  assert.ok(m, 'loadModel() ต้องได้โมเดล');
  assert.ok(isValidModel(m));
  assert.deepEqual(m.features, MODEL_FEATURES, 'ฟีเจอร์ในไฟล์ต้องตรงลำดับ MODEL_FEATURES (ไม่งั้นน้ำหนักเพี้ยนเงียบ)');
  assert.equal(m.target, 'log10(reactions+1)');
  assert.ok(m.nAll >= 1500, `เทรนจากโพสต์จริง ≥ 1,500 ใบ (ได้ ${m.nAll})`);
  // ด่านกันโมเดลพัง/ฟีเจอร์เรียงผิด (จะได้ ≈ 0) — ผลจริง 2 ก.ย. 69 seed 20260902 = 0.30 (เพดานของฟีเจอร์ข้อความล้วนเชิงเส้น)
  assert.ok(m.metrics?.valid?.spearman > 0.2, `Spearman valid ของโมเดลจริงต้อง > 0.2 (ได้ ${m.metrics?.valid?.spearman})`);
  const gm = getModelMetrics();
  assert.equal(gm.featureCount, MODEL_FEATURES.length);
  assert.equal(gm.metrics.valid.spearman, m.metrics.valid.spearman);
});

test('TOP จริง ชนะ LOW จริง ≥ 4 ใน 5 คู่ (คู่กำหนดล่วงหน้า) + ผลลัพธ์รูปทรงครบ', () => {
  assert.equal(TOP.length, 5); assert.equal(LOW.length, 5);
  resetModelCache();
  let wins = 0;
  const lines = [];
  for (let i = 0; i < 5; i++) {
    const t = scoreVersion(TOP[i].text), l = scoreVersion(LOW[i].text);
    assert.ok(t && l, 'ต้องได้ผลทั้งคู่');
    if (t.score > l.score) wins++;
    lines.push(`TOP ${TOP[i].reactions.toLocaleString()} → ${t.score} (${t.bandLabel}) vs LOW ${LOW[i].reactions.toLocaleString()} → ${l.score} (${l.bandLabel})`);
  }
  assert.ok(wins >= 4, `TOP ต้องชนะ ≥ 4/5 (ได้ ${wins}/5)\n  ${lines.join('\n  ')}`);
  const r = scoreVersion(TOP[0].text);
  assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
  assert.ok(Number.isInteger(r.predictedReactions) && r.predictedReactions >= 0);
  assert.ok(['สูง', 'กลาง', 'ต่ำ'].includes(r.bandLabel));
  assert.equal(r.topDrivers.length, 3);
  for (const d of r.topDrivers) {
    assert.ok(MODEL_FEATURES.includes(d.feature));
    assert.equal(d.label, FEATURE_LABELS_TH[d.feature], 'ป้ายภาษาไทยต้องมาจากตาราง');
    assert.ok(/[ก-๙]/.test(d.label));
    assert.ok(['ดัน', 'ฉุด'].includes(d.direction));
    assert.ok(Number.isFinite(d.effect) && Math.abs(d.effect) > 0);
  }
  const absEffects = r.topDrivers.map(d => Math.abs(d.effect));
  assert.ok(absEffects[0] >= absEffects[1] && absEffects[1] >= absEffects[2], 'ตัวดัน/ฉุด 3 ตัวต้องเรียงจากแรงสุด');
  assert.ok(Array.isArray(r.warnings));
  assert.equal(r.features.words, TOP[0].words);
  assert.equal(typeof r.raw, 'number');
});

test('ตัวดัน/ฉุด: ผลรวม effect ทุกฟีเจอร์ + bias = คะแนนดิบ · ฟีเจอร์ = ค่าเฉลี่ยเพจ → effect 0', () => {
  resetModelCache();
  const m = loadModel();
  const f = extractFeatures(TOP[0].text);
  const { raw, contributions } = computeRaw(f, m);
  const sum = contributions.reduce((a, c) => a + c.effect, m.bias);
  assert.ok(Math.abs(sum - raw) < 1e-9);
  const avg = {}; m.features.forEach((k, j) => { avg[k] = m.scale.mean[j]; });
  const c0 = computeRaw(avg, m);
  assert.ok(Math.abs(c0.raw - m.bias) < 1e-9, 'โพสต์เฉลี่ยของเพจ → คะแนนดิบ = bias');
  for (const c of c0.contributions) assert.ok(Math.abs(c.effect) < 1e-9);
  // คะแนน 0–100 ต้องเรียงตามคะแนนดิบ
  const rs = scoreVersions(SAMPLES.map(s => s.text));
  assert.equal(rs.length, SAMPLES.length);
  for (let i = 1; i < rs.length; i++) assert.ok(rs[i - 1].raw >= rs[i].raw && rs[i - 1].score >= rs[i].score, 'scoreVersions ต้องเรียงสูง→ต่ำ');
});

test('คำเตือนจากกติกาที่พิสูจน์แล้ว: ยาวเกิน 229 · ปิดคำคม · ขีดกลาง · องค์กรนำ · ไม่มีเดิมพัน', () => {
  const longText = Array.from({ length: 250 }, () => 'ข้าว').join(' ');
  const w = buildWarnings(extractFeatures(longText));
  assert.ok(w.some(x => x.includes('ยาว 250 คำ') && x.includes('เกินโซนปัง')), JSON.stringify(w));
  const bad = buildWarnings(extractFeatures('มูลนิธิใจดี มอบเงิน — ให้เด็ก\n\nเพราะอยากช่วย\n\nขอให้ทุกคนมีความสุข ความดีอยู่ตลอดไป'));
  assert.ok(bad.some(x => x.includes('ปิดด้วยคำคมทั่วไป')), JSON.stringify(bad));
  assert.ok(bad.some(x => x.includes('ขีดกลาง')), JSON.stringify(bad));
  assert.ok(bad.some(x => x.includes('องค์กร')), JSON.stringify(bad));
  assert.ok(bad.some(x => x.includes('ไม่มีเดิมพัน')), JSON.stringify(bad));
  const good = buildWarnings(extractFeatures(TOP[0].text));
  assert.ok(!good.some(x => x.includes('เกินโซนปัง')), 'โพสต์ TOP 223 คำ ไม่ควรโดนเตือนยาวเกิน');
  assert.deepEqual(buildWarnings(extractFeatures('')), [], 'ข้อความว่างไม่เตือน');
  const r = scoreVersion(longText);
  assert.ok(r.warnings.some(x => x.includes('เกินโซนปัง')));
});

// ---------- ส่วน 3: fail-safe ----------
test('ไม่มีไฟล์โมเดล → null ไม่พัง · ไฟล์โมเดลเพี้ยน → null', () => {
  const missing = join(tmpdir(), 'viral-score-missing-' + Date.now() + '.json');
  assert.equal(loadModel(missing), null);
  assert.equal(scoreVersion('พี่เอ มอบเงิน 500 บาท', { modelPath: missing }), null);
  assert.deepEqual(scoreVersions(['ก', 'ข'], { modelPath: missing }), []);
  assert.equal(getModelMetrics(missing), null);
  const dir = mkdtempSync(join(tmpdir(), 'viral-score-'));
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{"features":["a","b"],"weights":[1],"bias":0}', 'utf8');
  assert.equal(loadModel(broken), null, 'ไฟล์โมเดลเพี้ยน → null');
  const notJson = join(dir, 'garbage.json');
  writeFileSync(notJson, 'not json at all', 'utf8');
  assert.equal(loadModel(notJson), null);
  assert.equal(scoreVersion('x', { features: ['a'], weights: [1], bias: 0 }), null, 'โมเดล object ที่รูปทรงผิด → null');
  assert.equal(isValidModel(null), false);
});

// ---------- ส่วน 4: route stub ----------
const routeSrc = readFileSync(new URL('../src/app/api/feedback/score/route.js', import.meta.url), 'utf8')
  .replace(/^import .*$/mg, '')
  .replace(/^export const .*$/mg, '')
  .replace(/^export async function (GET|POST)/mg, 'async function $1');

function loadRoute({ env = {}, score = () => ({ score: 77, bandLabel: 'สูง' }), metrics = () => ({ featureCount: 3 }) } = {}) {
  const NextResponse = { json: (body, init) => ({ body, status: init?.status || 200 }) };
  const calls = { score: [], scores: [] };
  const scoreVersionStub = (text) => { calls.score.push(text); return score(text); };
  const scoreVersionsStub = (texts) => { calls.scores.push(texts); return texts.map((t, i) => ({ index: i, ...score(t) })).filter(r => r.score !== undefined); };
  const fns = new Function('NextResponse', 'scoreVersion', 'scoreVersions', 'getModelMetrics', 'process', `${routeSrc}\nreturn { GET, POST };`)(
    NextResponse, scoreVersionStub, scoreVersionsStub, metrics, { env });
  return { ...fns, calls };
}

const NO_BODY = Symbol('no body');
function req({ body = NO_BODY, adminKey, botSecret, apiKey } = {}) {
  return {
    headers: {
      get: (name) => {
        if (name === 'x-admin-key') return adminKey || '';
        if (name === 'x-bot-secret') return botSecret || '';
        if (name === 'x-api-key') return apiKey || '';
        return '';
      },
    },
    json: async () => { if (body === NO_BODY) throw new Error('no body'); return body; },
  };
}

test('route: ไม่ตั้ง env → 403 ทั้ง GET/POST (fail-closed)', async () => {
  const r = loadRoute({ env: {} });
  const g = await r.GET(req({ adminKey: 'x' }));
  assert.equal(g.status, 403); assert.equal(g.body.errorType, 'AUTH_NOT_CONFIGURED'); assert.equal(g.body.success, false);
  const p = await r.POST(req({ body: { text: 'ก' }, adminKey: 'x' }));
  assert.equal(p.status, 403);
  assert.equal(r.calls.score.length, 0, 'ห้ามให้คะแนนก่อนผ่านด่าน');
});

test('route: กุญแจผิด/ไม่ส่ง/ยาวเท่ากัน → 401 · ถูก (admin หรือ bot) → ผ่าน', async () => {
  const r = loadRoute({ env: { ADMIN_API_KEY: 'ADMIN1', DISCORD_API_SECRET: 'S3CRET' } });
  assert.equal((await r.POST(req({ body: { text: 'ก' } }))).status, 401);
  assert.equal((await r.POST(req({ body: { text: 'ก' }, adminKey: 'ADMIN2' }))).status, 401, 'กุญแจผิดยาวเท่ากัน → 401');
  assert.equal((await r.POST(req({ body: { text: 'ก' }, botSecret: 'S3CREX' }))).status, 401);
  assert.equal((await r.POST(req({ body: { text: 'ก' }, adminKey: 'ADMIN' }))).status, 401);
  const ok1 = await r.POST(req({ body: { text: 'พี่เอ มอบเงิน' }, adminKey: 'ADMIN1' }));
  assert.equal(ok1.status, 200); assert.equal(ok1.body.success, true); assert.equal(ok1.body.result.score, 77);
  const ok2 = await r.POST(req({ body: { text: 'ก' }, botSecret: ' S3CRET\n' }));
  assert.equal(ok2.status, 200, 'x-bot-secret ที่มีช่องว่าง/ขึ้นบรรทัดต้อง trim แล้วผ่าน');
  const ok3 = await r.POST(req({ body: { text: 'ก' }, apiKey: 'S3CRET' }));
  assert.equal(ok3.status, 200, 'x-api-key แบบเดียวกับที่บอทส่ง /api/queue/add');
  const onlyAdmin = loadRoute({ env: { ADMIN_API_KEY: 'A' } });
  assert.equal((await onlyAdmin.POST(req({ body: { text: 'ก' }, botSecret: 'A' }))).status, 401, 'ไม่ตั้ง DISCORD_API_SECRET → กุญแจบอทไม่ผ่านแม้ค่าเท่า admin');
  assert.equal((await onlyAdmin.GET(req({ adminKey: 'A' }))).status, 200);
});

test('route: body ผิด → 400 · text ว่าง → 400 · texts เกิน 20/ว่าง → 400', async () => {
  const r = loadRoute({ env: { ADMIN_API_KEY: 'A' } });
  const a = req({ adminKey: 'A' });
  assert.equal((await r.POST(a)).body.errorType, 'INVALID_BODY');
  assert.equal((await r.POST(req({ adminKey: 'A', body: { text: '   ' } }))).body.errorType, 'INVALID_TEXT');
  assert.equal((await r.POST(req({ adminKey: 'A', body: { text: 123 } }))).status, 400);
  assert.equal((await r.POST(req({ adminKey: 'A', body: { text: 'x'.repeat(20001) } }))).status, 400);
  assert.equal((await r.POST(req({ adminKey: 'A', body: { texts: [] } }))).status, 400);
  assert.equal((await r.POST(req({ adminKey: 'A', body: { texts: ['ก', ''] } }))).status, 400);
  assert.equal((await r.POST(req({ adminKey: 'A', body: { texts: new Array(21).fill('ก') } }))).status, 400);
  assert.equal(r.calls.score.length, 0);
});

test('route: ไม่มีโมเดล → 503 MODEL_NOT_AVAILABLE (POST/GET) · scoreVersion โยน → 500', async () => {
  const r = loadRoute({ env: { ADMIN_API_KEY: 'A' }, score: () => null, metrics: () => null });
  const p = await r.POST(req({ adminKey: 'A', body: { text: 'ก' } }));
  assert.equal(p.status, 503); assert.equal(p.body.errorType, 'MODEL_NOT_AVAILABLE');
  const g = await r.GET(req({ adminKey: 'A' }));
  assert.equal(g.status, 503); assert.equal(g.body.errorType, 'MODEL_NOT_AVAILABLE');
  const boom = loadRoute({ env: { ADMIN_API_KEY: 'A' }, score: () => { throw new Error('พัง'); } });
  const e = await boom.POST(req({ adminKey: 'A', body: { text: 'ก' } }));
  assert.equal(e.status, 500); assert.equal(e.body.errorType, 'SCORE_ERROR'); assert.equal(e.body.success, false);
});

test('route: GET คืน metrics · POST texts หลายเวอร์ชันคืน results', async () => {
  const r = loadRoute({ env: { DISCORD_API_SECRET: 'B' }, metrics: () => ({ featureCount: 53, metrics: { valid: { spearman: 0.5 } } }) });
  const g = await r.GET(req({ botSecret: 'B' }));
  assert.equal(g.status, 200); assert.equal(g.body.model.featureCount, 53); assert.equal(g.body.model.metrics.valid.spearman, 0.5);
  const p = await r.POST(req({ botSecret: 'B', body: { texts: ['ก', 'ข', 'ค'] } }));
  assert.equal(p.status, 200); assert.equal(p.body.count, 3); assert.equal(p.body.results.length, 3);
  assert.deepEqual(r.calls.scores[0], ['ก', 'ข', 'ค']);
});

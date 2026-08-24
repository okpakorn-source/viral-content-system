// 🔎 ข้อสอบ "สวิตช์ปิดการค้นข้อมูลเสริม" — เจ้าของสั่ง 16 ส.ค. 69
// รัน: node tests/research-switch.test.mjs
//
// ที่มา: พนักงานเจนข่าววิลเลี่ยม LYKN แล้วพบข้อมูลจากเน็ตปนเข้ามาในเนื้อข่าว
//   ตรวจแล้วพบว่า **ระบบไม่เคยมีสวิตช์ปิดรีเสิร์ชเลย** ปิดได้ทางเดียวคือลบกุญแจ API ทิ้ง
// สิ่งที่ข้อสอบนี้ล็อกไว้:
//   ① ค่าตั้งต้น = ปิด (ไม่ต้องตั้ง env ที่ไหนก็ปิด — ปิดเหมือนกันทั้ง Vercel และในเครื่อง)
//   ② ทางเปิดคืนต้องทนทุกรูปแบบค่า (อัญประกาศ/ช่องว่าง/ตัวพิมพ์ใหญ่) ไม่งั้นปลุกไม่ขึ้น
//   ③ ประตูต้องอยู่ "ก่อน" การยิงเน็ต/เรียก AI ทุกจุด — ปิดแล้วต้องไม่เสียเงินสักบาท
//   ④ ปิดแล้วต้องไม่ทำให้ท่อข่าวพัง (คืนรูปแบบเดิมที่ปลายทางรับได้อยู่แล้ว)

import { readFileSync } from 'node:fs';
import { isNewsResearchOn, RESEARCH_OFF_REASON } from '../src/lib/utils/researchSwitch.js';

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

const withEnv = (v, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'NEWS_RESEARCH');
  const old = process.env.NEWS_RESEARCH;
  if (v === undefined) delete process.env.NEWS_RESEARCH; else process.env.NEWS_RESEARCH = v;
  const r = fn();
  if (had) process.env.NEWS_RESEARCH = old; else delete process.env.NEWS_RESEARCH;
  return r;
};

// ═══ ① ค่าตั้งต้นต้องเป็น "ปิด" ═══
t('1 ไม่ตั้ง env เลย → ปิด (นี่คือสถานะที่เจ้าของสั่ง — ปิดทุกที่โดยไม่ต้องตั้งอะไร)',
  withEnv(undefined, () => isNewsResearchOn()) === false);

// ═══ ② ค่าที่ต้องอ่านว่า "ปิด" ═══
const OFF_VALUES = ['', '   ', '0', 'off', 'OFF', 'false', 'False', 'no', '"0"', "'0'", ' 0 ', '2', 'enable', 'ปิด', 'ขยะ'];
{
  const bad = OFF_VALUES.filter((v) => withEnv(v, () => isNewsResearchOn()) !== false);
  t(`2 ค่าที่ต้องปิด ${OFF_VALUES.length} แบบ → ปิดครบ (ค่าที่อ่านไม่ออกต้องปิด ไม่ใช่เปิด)`, bad.length === 0);
  bad.forEach((v) => console.log(`     ↳ "${v}" ดันเปิด`));
}

// ═══ ③ ทางเปิดคืนต้องทนทุกรูปแบบ (ไม่งั้นปลุกไม่ขึ้น = โค้ดตาย) ═══
const ON_VALUES = ['1', 'on', 'ON', 'true', 'TRUE', 'True', 'yes', 'YES', '"1"', "'1'", ' 1 ', '  on  ', '"on"', '"true"'];
{
  const bad = ON_VALUES.filter((v) => withEnv(v, () => isNewsResearchOn()) !== true);
  t(`3 ค่าที่ต้องเปิด ${ON_VALUES.length} แบบ → เปิดครบ (รวมแบบติดอัญประกาศจาก vercel env add)`, bad.length === 0);
  bad.forEach((v) => console.log(`     ↳ "${v}" ปลุกไม่ขึ้น`));
}

t('4 มีข้อความเหตุผลให้ย้อนสอบได้ว่า "ปิดเอง" ไม่ใช่ "ค้นแล้วไม่เจอ"',
  typeof RESEARCH_OFF_REASON === 'string' && /NEWS_RESEARCH=1/.test(RESEARCH_OFF_REASON));

t('5 อ่านค่าสดทุกครั้งที่เรียก (สลับกลางโปรเซสได้ ไม่แคชค้าง)',
  withEnv('1', () => isNewsResearchOn()) === true &&
  withEnv('0', () => isNewsResearchOn()) === false &&
  withEnv('1', () => isNewsResearchOn()) === true);

// ═══ ④ ประตูต้องอยู่ก่อนการยิงเน็ต/เรียก AI ═══
const readSrc = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// 🔴 ลิสต์ "จุดเสียเงิน" ต้องรวม **ตัวห่อ** ด้วย ไม่ใช่แค่ fetch/callAI ตรงๆ
//   (ผู้ตรวจอิสระพิสูจน์แล้ว: ลิสต์เดิมมีแค่ 3 ตัว → เอาการยิงเน็ตไปวางก่อนประตูได้โดยข้อสอบไม่รู้เรื่อง
//    ทดลอง 2 แบบ "ย้ายประตูไปหลัง resolveIdentityFromContext" และ "แอบใส่ serperSearch ก่อนประตู" หลุดทั้งคู่)
const SPEND_CALLS = [
  'callAI(', 'fetch(', 'tavilySearch(',
  'serperSearch(', 'throttledSerperSearch(', 'quickSearch(', 'wikiSearch(',
  'runAgents(', 'detectEntity(', 'resolveIdentityFromContext(',
];
const firstSpendAfter = (src, from) =>
  SPEND_CALLS.map((k) => src.indexOf(k, from)).filter((i) => i > 0).sort((a, b) => a - b);

{
  const src = readSrc('../src/lib/services/researchService.js');
  const fnStart = src.indexOf('export async function performResearch');
  const gate = src.indexOf('isNewsResearchOn()', fnStart);
  const spends = firstSpendAfter(src, fnStart);
  t('6 researchService: ประตูอยู่ในฟังก์ชัน performResearch จริง', fnStart > 0 && gate > fnStart);
  t(`7 researchService: ประตูอยู่ก่อนจุดเสียเงินทุกจุด (ตรวจ ${SPEND_CALLS.length} ตัวรวมตัวห่อ · พบ ${spends.length} จุด)`,
    gate > 0 && spends.length > 0 && gate < spends[0]);
  t('8 researchService: ปิดแล้วคืนของ ไม่ throw (มี return ก่อน try)',
    /if \(!isNewsResearchOn\(\)\)[\s\S]{0,900}?return \{[\s\S]{0,600}?items: \[\]/.test(src));
}
{
  const src = readSrc('../src/lib/services/achievementResearch.js');
  const fnStart = src.indexOf('export async function smartResearch');
  const gate = src.indexOf('isNewsResearchOn()', fnStart);
  const spends = firstSpendAfter(src, fnStart);
  t('9 achievementResearch: ประตูอยู่ในฟังก์ชัน smartResearch จริง', fnStart > 0 && gate > fnStart);
  t(`10 achievementResearch: ประตูอยู่ก่อนจุดเสียเงินทุกจุด (พบ ${spends.length} จุด)`,
    gate > 0 && spends.length > 0 && gate < spends[0]);
  // ต้องเป็น return null "ตัวแรกหลังประตู" จริงๆ ไม่ใช่ไปแมตช์ return null ตัวอื่นที่อยู่ไกลออกไป
  t('11 achievementResearch: ปิดแล้วคืน null ทันที (เส้นเดิมที่ปลายทางรับได้อยู่แล้ว)',
    /if \(!isNewsResearchOn\(\)\) \{[^}]{0,400}return null;\s*\}/.test(src));
}

// ═══ ⑤ ขอบเขต — ปิดให้ครบทางที่ข้อมูลเข้าเนื้อข่าว แต่ห้ามไปโดนงานอื่น ═══
{
  // 🔴 ข้อสอบรอบแรกเช็คแค่ "ไม่มีคำว่า isNewsResearchOn ในไฟล์" → ขึ้น ✅ ทั้งที่ปุ่มพังจริง
  //    (ปุ่มโดนปิดผ่าน "การเรียกต่อทอด" ไปที่ performResearch ไม่ใช่ผ่าน import)
  //    ⇒ ต้องเช็คของจริง: ปุ่มค้นเองต้องถูกปิด **และตอบ error ที่อ่านออก** ไม่ใช่คืนผลว่างเงียบๆ
  const route = readSrc('../src/app/api/research-search/route.js');
  const gate = route.indexOf('isNewsResearchOn()');
  const call = route.indexOf('performResearch(');
  t('12 ปุ่มค้นเอง: ถูกปิดด้วย และประตูอยู่ก่อนการเรียก performResearch',
    gate > 0 && call > 0 && gate < call);
  t('13 ปุ่มค้นเอง: ตอบ error ที่อ่านออก (ห้ามคืนผลว่างเงียบๆ — หน้าเว็บเช็คแค่ .length > 0 จะได้จอว่าง)',
    /RESEARCH_DISABLED/.test(route) && /success: false/.test(route) && /status: 503/.test(route));
}
{
  const mustNotGate = [
    ['ค้นรูปภาพ', '../src/lib/services/multiAgentImageScraper.js'],
    ['เรดาร์โต๊ะข่าว', '../src/lib/services/radar/tavilySource.js'],
    ['IdentityAnchor สายทำปก', '../src/lib/services/storyIdentityService.js'],
  ];
  const leaked = mustNotGate.filter(([, p]) => {
    try { return readSrc(p).includes('isNewsResearchOn'); } catch { return false; }
  });
  t(`14 ไม่ไปปิดงานอื่นที่ไม่เกี่ยว (${mustNotGate.map(([n]) => n).join(' / ')})`, leaked.length === 0);
  leaked.forEach(([n]) => console.log(`     ↳ ${n} ถูกปิดไปด้วย ไม่ถูกต้อง`));
}

// ═══ ⑥ ท่อข่าวต้องรับ "ไม่มีผลรีเสิร์ช" ได้อยู่แล้ว — ต้องคุมทั้งสาย TEXT และสายแฝด URL ═══
//   (ผู้ตรวจท้วงว่ารอบแรกคุมแค่สาย TEXT ทั้งที่โค้ดสายแฝดเหมือนกันเป๊ะและถูกปิดด้วยประตูเดียวกัน)
{
  const pairs = [
    ['สาย TEXT (ที่ทีมใช้จริง)', '../src/lib/services/autoFlowServiceText.js', '../src/lib/services/summarizeServiceText.js'],
    ['สายแฝด URL', '../src/lib/services/autoFlowService.js', '../src/lib/services/summarizeService.js'],
  ];
  pairs.forEach(([name, flowPath, sumPath], i) => {
    const flow = readSrc(flowPath);
    const sum = readSrc(sumPath);
    t(`${15 + i * 2} ${name}: ผลค้นว่าง → ส่ง researchData เป็น null ให้นักเขียน`,
      /researchItems\.length > 0 \? \{ items: researchItems \} : null/.test(flow));
    t(`${16 + i * 2} ${name}: บล็อก SMART RESEARCH FACTS ถูกกั้นด้วยจำนวนข้อเท็จจริง (ว่าง=ไม่ใส่บล็อก)`,
      /if \(_fpFacts\.length > 0\)/.test(sum));
  });
}

console.log(`\n${pass}/${pass + fail} ผ่าน — ${fail === 0 ? '✅ ด่านข้อสอบผ่าน' : '❌ ยังไม่ผ่าน'}`);
process.exit(fail === 0 ? 0 : 1);

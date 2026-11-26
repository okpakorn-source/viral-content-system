import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEnrichedKnowledgeBase,
  formatFullAngleExemplars,
  formatTeacherCatalogForAI,
  rankTeachersByFullDNA,
} from '../src/lib/services/newsStudio/enrichedLibrary.js';
import {
  isStudioDiscordEnabled,
  studioActivePlan,
  isPlan1SubUltraEnabled,
  isPlanBEnabled,
  shouldUseStudioForJob,
} from '../src/lib/services/newsStudio/switches.js';
import { planBModels, formatReadableThreeParagraphs } from '../src/lib/services/newsStudio/planBPipeline.js';
import { plan1SubUltraModels, runNewsStudioPlan1 } from '../src/lib/services/newsStudio/plan1SubUltraPipeline.js';
import { createSubUltraHub } from '../src/lib/services/newsStudio/subUltraCallers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('formatReadableThreeParagraphs บังคับเรียง 3 ย่อหน้าเสมอ และเว้นวรรครอบเครื่องหมายคำพูด/ตัวเลขให้อ่านง่าย', () => {
  const raw = 'จากเด็กไร้พ่อแม่“เก่ง”ทำงานร้านขนมได้20บาทต่อวัน\n\nครูแนะแนว"สมญา เพ็ชรรุ่ง"ซื้อขนมมาฝากเสมอ\n\nส่วนครูที่ปรึกษา"อรัญญา"บอกให้มาหาที่ห้องพักครู\n\nวันนี้เก่งเรียนจบและกำลังสอบบรรจุเป็นครู';
  const out = formatReadableThreeParagraphs(raw);
  const paras = out.split('\n\n');
  assert.equal(paras.length, 3);
  assert.ok(out.includes(' "เก่ง" '));
  assert.ok(out.includes('20 บาท'));
  assert.ok(out.includes(' "สมญา เพ็ชรรุ่ง" '));
});

test('loadEnrichedKnowledgeBase โหลดคลังครูครบ 254 ใบ และผูก card-essences ครบ 254/254 ใบ', () => {
  const kb = loadEnrichedKnowledgeBase({ rootDir: ROOT });
  assert.equal(kb.teachers.length, 254);
  assert.equal(kb.exemplars.length, 33);
  const withEssence = kb.teachers.filter((t) => t.cardEssence && t.cardEssence.length > 10);
  assert.equal(withEssence.length, 254);
  const withParagraphs = kb.teachers.filter((t) => t.openingParagraph && t.closingParagraph);
  assert.equal(withParagraphs.length, 254);
});

test('formatFullAngleExemplars รวมทั้ง lines, lineRoles, angle และ techniqueNote ของปกทั้ง 33 ใบ', () => {
  const kb = loadEnrichedKnowledgeBase({ rootDir: ROOT });
  const text = formatFullAngleExemplars(kb.exemplars);
  assert.ok(text.includes('[a01]'));
  assert.ok(text.includes('[a33]'));
  assert.ok(text.includes('หน้าที่แต่ละบรรทัด:'));
  assert.ok(text.includes('ทำไมปกนี้ถึงปัง:'));
});

test('rankTeachersByFullDNA คัดกรองครูตามหมวด อารมณ์ และตัดครูไว้อาลัยออกจากข่าวทั่วไป', () => {
  const kb = loadEnrichedKnowledgeBase({ rootDir: ROOT });
  const top = rankTeachersByFullDNA({
    teachers: kb.teachers,
    analysis: {
      primaryCategory: 'อบอุ่นใจ',
      secondaryCategories: ['ช่วยเหลือกัน'],
      emotionalTags: ['ชื่นชม', 'ตื้นตัน'],
      conflictTags: [],
      narrativeArchetype: 'น้ำใจคนไทย',
    },
    angles: [{ focus: 'ไม่ขายที่ดิน 18 ล้าน เก็บให้ชาวนาทำกินฟรี' }],
    rawText: 'เฟี้ยว์ฟ้าวไม่ขายที่ดิน 18 ล้าน ให้ชาวบ้านทำกินฟรี',
    topK: 30,
  });
  assert.equal(top.length, 30);
  assert.notEqual(top[0].openingType, 'tribute');
  const catalog = formatTeacherCatalogForAI(top.slice(0, 5));
  assert.ok(catalog.includes('DNA:'));
  assert.ok(catalog.includes('กลไกที่ทำให้ปัง:'));
});

test('สวิตช์และสายไฟท่อหลัก: ค่าตั้งต้นเป็น Plan 1 Sub Ultra (Gemini 4 + GPT Sub) และถอยกลับ plan_b หรือ v1 ได้ด้วย env', () => {
  assert.equal(isStudioDiscordEnabled({}), true);
  assert.equal(studioActivePlan({}), 'plan_1');
  assert.equal(isPlan1SubUltraEnabled({}), true);
  assert.equal(isPlanBEnabled({}), false);
  assert.equal(shouldUseStudioForJob({ userId: 'discord-999' }, {}), true);

  assert.equal(studioActivePlan({ NEWS_STUDIO_PLAN: 'plan_b' }), 'plan_b');
  assert.equal(isPlanBEnabled({ NEWS_STUDIO_PLAN: 'plan_b' }), true);

  assert.equal(studioActivePlan({ NEWS_STUDIO_PLAN: 'v1' }), 'v1');
  assert.equal(isPlan1SubUltraEnabled({ NEWS_STUDIO_PLAN: 'v1' }), false);

  const p1 = plan1SubUltraModels();
  assert.equal(p1.director.model, 'gemini-4-neon-high');
  assert.equal(p1.checker.model, 'gpt-5.6-sol');

  const pb = planBModels();
  assert.equal(pb.analyzer.model, 'gemini-4-hydrogen');

  const serverSrc = fs.readFileSync(new URL('../src/lib/services/newsStudio/server.js', import.meta.url), 'utf8');
  assert.ok(serverSrc.includes('isPlan1SubUltraEnabled()'));
  assert.ok(serverSrc.includes('runNewsStudioPlan1'));
  assert.ok(serverSrc.includes('isPlanBEnabled()'));
});

test('createSubUltraHub + runNewsStudioPlan1 สลับรุ่นสำรองอัตโนมัติเมื่อรุ่นหลักล่มและเดินท่อจนจบครบ 3 เวอร์ชัน', async () => {
  const calls = [];
  const fakeHub = createSubUltraHub({
    env: { CODEX_SOURCE_HOME: ROOT }, // จะไม่มี auth.json ที่ ROOT -> บังคับทดสอบเส้นสลับไป Gemini Fallback อัตโนมัติ!
    runCommand: async (cmd, args) => {
      const mIdx = args.indexOf('--model');
      const model = mIdx !== -1 ? args[mIdx + 1] : 'codex';
      calls.push(model);

      // จำลองกรณีรุ่นแรกของขั้นที่ 2 ล่ม -> ต้องตกไปรุ่นสำรองในโซ่อัตโนมัติ
      if (model === 'gemini-4-neon-high' && calls.filter((c) => c === 'gemini-4-neon-high').length === 1) {
        throw new Error('simulated neon temporary busy');
      }

      let responseObj;
      if (model.startsWith('gemini-4-hydrogen')) {
        responseObj = JSON.stringify({
          cleanedRawText: 'โฟกัส จีระกุล เดินทางไปทำบัตรประชาชนใบใหม่โดยสวมชุดไทยห่มสไบสีเหลืองทอง แฟนคลับชมว่าน้อยหน่าสวยตลอดกาล',
          whoIsWho: 'นักแสดงสาวเจ้าของบทบาทน้อยหน่า แฟนฉัน',
          keyPeopleNames: ['โฟกัส จีระกุล'],
          exactQuotesAllowed: ['น้อยหน่าสวยตลอดกาล'],
          indirectDoNotQuote: [],
          numberFacts: [],
          primaryCategory: 'อบอุ่นใจ',
          secondaryCategories: ['ความรัก'],
          emotionalTags: ['ชื่นชม', 'อบอุ่น'],
          conflictTags: [],
          narrativeArchetype: 'น้ำใจคนไทย',
        });
      } else if (model === 'gemini-4-carbon-high' && calls.length <= 3) {
        responseObj = JSON.stringify({
          primaryCategory: 'อบอุ่นใจ',
          emotionalTags: ['ชื่นชม'],
          coreStory: 'โฟกัส จีระกุล สวมชุดไทยไปทำบัตรประชาชนใบใหม่',
          plans: [
            { angleName: 'มุมชุดไทย', focus: 'สวมชุดไทยทำบัตรประชาชน', coverLines: ['สวมชุดไทยทำบัตร', 'สวยสง่าจำแทบไม่ได้', 'ตำนานน้อยหน่า'], leadHook: 'เปิดด้วยชุดไทย', middleLens: 'รายละเอียดสไบทอง', closingHoldback: 'แฟนคลับชมน้อยหน่าสวยตลอดกาล', mustKeep: ['โฟกัส จีระกุล'], exemplarIds: ['a01'], teacherId: '' },
            { angleName: 'มุมแฟนคลับแซว', focus: 'คำชมน้อยหน่าสวยตลอดกาล', coverLines: ['น้อยหน่าสวยตลอดกาล', 'ทำบัตรประชาชนลุคไทย', 'แฟนคลับแห่ชม'], leadHook: 'เปิดด้วยคำชมแฟนคลับ', middleLens: 'ลุคแต่งหน้าทำผม', closingHoldback: 'รวบผมประดับดอกไม้', mustKeep: ['โฟกัส จีระกุล'], exemplarIds: ['a02'], teacherId: '' },
            { angleName: 'มุมการเปลี่ยนลุค', focus: 'ลุคใหม่ที่สวยขึ้นจนจำแทบไม่ได้', coverLines: ['จำแทบไม่ได้', 'โฟกัสลุคชุดไทย', 'ทำบัตรประชาชนใบใหม่'], leadHook: 'เปิดด้วยภาพลักษณ์ใหม่', middleLens: 'เครื่องประดับทองคำและทับทิม', closingHoldback: 'รอยยิ้มสดใสในวันทำบัตรใหม่', mustKeep: ['โฟกัส จีระกุล'], exemplarIds: ['a07'], teacherId: '' },
          ],
        });
      } else if (model === 'gemini-4-neon-high') {
        // Gemini fallback สำหรับผู้ตรวจข้ามค่ายเมื่อไม่มี auth.json ของ codex ในสภาพแวดล้อมจำลอง
        responseObj = JSON.stringify({ pass: true, issues: [] });
      } else {
        responseObj = [
          'สร้างความฮือฮาไม่น้อยเมื่อนักแสดงสาว "โฟกัส จีระกุล" เดินทางไปทำบัตรประชาชนใบใหม่ ด้วยลุคชุดไทยห่มสไบสีเหลืองทองสุดสง่างาม จนใครเห็นเป็นต้องสะดุดตาตั้งแต่แรกมอง',
          'ความพิเศษของลุคนี้คือการจับคู่สไบปักลวดลายประณีตเข้ากับผ้านุ่งสีเขียวอมฟ้า พร้อมเครื่องประดับทองคำและทับทิมที่ขับผิวให้ดูผ่องใส รับกับการรวบผมหางม้าประดับดอกไม้เล็กๆ ที่ดูเรียบร้อยและอ่อนหวานในเวลาเดียวกัน',
          'ทันทีที่ภาพนี้ถูกเผยแพร่ออกไป แฟนคลับจำนวนมากต่างเข้ามากดไลก์และชื่นชมเป็นเสียงเดียวกันว่าสวยขึ้นมากจนแทบจำไม่ได้ พร้อมย้อนรำลึกถึงภาพจำในวัยเด็กว่า "น้อยหน่าสวยตลอดกาล" อย่างแท้จริง',
        ].join('\n\n');
      }

      const streamLine = JSON.stringify({
        event: 'result',
        result: { status: 'SUCCESS', response: responseObj, usage: { input_tokens: 100, output_tokens: 50 } },
      });
      return { code: 0, ms: 10, stdout: streamLine + '\n', stderr: '' };
    },
  });

  const out = await runNewsStudioPlan1({
    rawText: 'โฟกัส จีระกุล เดินทางไปทำบัตรประชาชนใบใหม่ โดยสวมชุดไทยห่มสไบสีเหลืองทองปักลวดลาย จับคู่กับผ้านุ่งสีเขียวอมฟ้า เครื่องประดับทองคำและทับทิม แฟนคลับชมว่าน้อยหน่าสวยตลอดกาล',
    rootDir: ROOT,
    hub: fakeHub,
  });

  assert.equal(out.ok, true);
  assert.equal(out.plan, 'plan_1_sub_ultra');
  assert.equal(out.versions.length, 3);
  assert.ok(out.versions.every((v) => v.content.split('\n\n').length === 3));
  assert.ok(calls.includes('gemini-4-carbon-high'), 'ต้องสลับไปรุ่นสำรองอัตโนมัติเมื่อรุ่นหลักล่ม');
});

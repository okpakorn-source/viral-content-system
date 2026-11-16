import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  loadEnrichedKnowledgeBase,
  formatFullAngleExemplars,
  formatTeacherCatalogForAI,
  rankTeachersByFullDNA,
} from '../src/lib/services/newsStudio/enrichedLibrary.js';
import {
  isStudioDiscordEnabled,
  studioActivePlan,
  isPlanBEnabled,
  shouldUseStudioForJob,
} from '../src/lib/services/newsStudio/switches.js';
import { planBModels } from '../src/lib/services/newsStudio/planBPipeline.js';

const ROOT = 'C:/news-studio-dev';

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

test('สวิตช์และสายไฟท่อหลัก: ค่าตั้งต้นเป็น Plan B (Gemini 4 Hydrogen + Carbon + Argon) และสลับกลับ v1 ได้ด้วย env', () => {
  assert.equal(isStudioDiscordEnabled({}), true);
  assert.equal(studioActivePlan({}), 'plan_b');
  assert.equal(isPlanBEnabled({}), true);
  assert.equal(shouldUseStudioForJob({ userId: 'discord-999' }, {}), true);

  // ทดสอบการถอยกลับด้วย NEWS_STUDIO_PLAN=v1
  assert.equal(studioActivePlan({ NEWS_STUDIO_PLAN: 'v1' }), 'v1');
  assert.equal(isPlanBEnabled({ NEWS_STUDIO_PLAN: 'v1' }), false);

  const models = planBModels();
  assert.equal(models.analyzer.model, 'gemini-4-hydrogen');
  assert.equal(models.director.model, 'gemini-4-carbon');
  assert.equal(models.librarian.model, 'gemini-4-carbon');
  assert.equal(models.writer.model, 'gemini-4-argon');
  assert.equal(models.checker.model, 'gpt-5.6-sol');

  const serverSrc = fs.readFileSync(new URL('../src/lib/services/newsStudio/server.js', import.meta.url), 'utf8');
  assert.ok(serverSrc.includes('isPlanBEnabled()'));
  assert.ok(serverSrc.includes('runNewsStudioPlanB'));
  assert.ok(serverSrc.includes('planBModels()'));
});

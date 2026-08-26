import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const SERVICE = new URL('../src/lib/services/clipInsightService.js', import.meta.url).href;
const ROUTE_SOURCE = readFileSync(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8');
const PAGE_SOURCE = readFileSync(new URL('../src/app/clip-transcript/page.js', import.meta.url), 'utf8');
const MOBILE_SOURCE = readFileSync(new URL('../src/app/m/page.js', import.meta.url), 'utf8');
const GEMINI_SOURCE = readFileSync(new URL('../src/lib/ai/geminiClient.js', import.meta.url), 'utf8');
const SERVICE_SOURCE = readFileSync(new URL('../src/lib/services/clipInsightService.js', import.meta.url), 'utf8');
// ★ 26 ส.ค. 69: รื้อหน้า /clip-transcript เป็นคอมโพเนนต์ — การเรนเดอร์ผลย้ายไป InsightCard.js
const CARD_SOURCE = readFileSync(new URL('../src/app/clip-transcript/ui/InsightCard.js', import.meta.url), 'utf8');
const JOBBOARD_SOURCE = readFileSync(new URL('../src/app/clip-transcript/ui/JobBoard.js', import.meta.url), 'utf8');
const WEB_SOURCE = PAGE_SOURCE + '\n' + CARD_SOURCE + '\n' + JOBBOARD_SOURCE;

const MOCK_OPENAI = `
export async function callAI(args) {
  globalThis.__clipEditorialPrompt = args?.prompt || '';
  return { clipType: 'interview', headline: 'หัวข้อ', rawData: 'เนื้อข่าว', subStories: [] };
}
`;

const MOCK_GEMINI = `
export async function callGeminiVideo(args) {
  globalThis.__clipEditorialPrompt = args?.prompt || '';
  globalThis.__clipEditorialVideoCalls = (globalThis.__clipEditorialVideoCalls || 0) + 1;
  globalThis.__clipEditorialVideoArgs = [...(globalThis.__clipEditorialVideoArgs || []), { kind: 'url', args }];
  return globalThis.__clipEditorialVideoResult || { clipType: 'interview', headline: 'หัวข้อ', rawData: 'เนื้อข่าว', subStories: [] };
}
export async function callGeminiVideoFile(args) {
  globalThis.__clipEditorialPrompt = args?.prompt || '';
  globalThis.__clipEditorialVideoCalls = (globalThis.__clipEditorialVideoCalls || 0) + 1;
  globalThis.__clipEditorialVideoArgs = [...(globalThis.__clipEditorialVideoArgs || []), { kind: 'file', args }];
  return globalThis.__clipEditorialVideoResult || { clipType: 'interview', headline: 'หัวข้อ', rawData: 'เนื้อข่าว', subStories: [] };
}
`;

const MOCK_GOOGLE_GENERATIVE_AI = `
export class GoogleGenerativeAI {
  constructor() {}
  getGenerativeModel({ model }) {
    return {
      generateContent: async () => {
        globalThis.__clipGeminiRuntimeModels = [...(globalThis.__clipGeminiRuntimeModels || []), model];
        const step = globalThis.__clipGeminiRuntimePlan?.shift();
        if (!step) throw new Error('missing mock Gemini response');
        if (step.error) {
          const error = new Error(step.error.message || 'mock Gemini error');
          Object.assign(error, step.error);
          throw error;
        }
        const content = Object.prototype.hasOwnProperty.call(step, 'content')
          ? step.content
          : '{"clipType":"interview","rawData":"เนื้อพร้อมใช้"}';
        return {
          response: {
            text: () => content,
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          },
        };
      },
    };
  }
}
`;

const MOCK_GOOGLE_FILE_MANAGER = `
export const FileState = { PROCESSING: 'PROCESSING', ACTIVE: 'ACTIVE' };
export class GoogleAIFileManager {
  constructor() {}
  async uploadFile() { return { file: { name: 'mock-file' } }; }
  async getFile() { return { state: FileState.ACTIVE, uri: 'mock://video', mimeType: 'video/mp4' }; }
  async deleteFile() {}
}
`;

const MOCK_USAGE_LOGGER = 'export function logApiUsage() {}';
const MOCK_SAFETY_FILTER = 'export function sanitizeOutput(value) { return value; }';
const MOCK_PIPELINE_DEADLINE = `
export function preparePipelineSignal(signal) { return signal; }
export function rethrowPipelineDeadline() {}
`;

const hook = `
const OPENAI = ${JSON.stringify(MOCK_OPENAI)};
const GEMINI = ${JSON.stringify(MOCK_GEMINI)};
const GOOGLE = ${JSON.stringify(MOCK_GOOGLE_GENERATIVE_AI)};
const GOOGLE_FILE_MANAGER = ${JSON.stringify(MOCK_GOOGLE_FILE_MANAGER)};
const USAGE_LOGGER = ${JSON.stringify(MOCK_USAGE_LOGGER)};
const SAFETY_FILTER = ${JSON.stringify(MOCK_SAFETY_FILTER)};
const PIPELINE_DEADLINE = ${JSON.stringify(MOCK_PIPELINE_DEADLINE)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/openai') return { url: 'mock:clip-openai', shortCircuit: true, format: 'module' };
  if (specifier === '@/lib/ai/geminiClient') return { url: 'mock:clip-gemini', shortCircuit: true, format: 'module' };
  if (specifier === '@google/generative-ai') return { url: 'mock:google-generative-ai', shortCircuit: true, format: 'module' };
  if (specifier === '@google/generative-ai/server') return { url: 'mock:google-file-manager', shortCircuit: true, format: 'module' };
  if (specifier === './usageLogger') return { url: 'mock:usage-logger', shortCircuit: true, format: 'module' };
  if (specifier === './safetyFilter') return { url: 'mock:safety-filter', shortCircuit: true, format: 'module' };
  if (specifier === '../utils/pipelineDeadline.js') return { url: 'mock:pipeline-deadline', shortCircuit: true, format: 'module' };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url === 'mock:clip-openai') return { format: 'module', shortCircuit: true, source: OPENAI };
  if (url === 'mock:clip-gemini') return { format: 'module', shortCircuit: true, source: GEMINI };
  if (url === 'mock:google-generative-ai') return { format: 'module', shortCircuit: true, source: GOOGLE };
  if (url === 'mock:google-file-manager') return { format: 'module', shortCircuit: true, source: GOOGLE_FILE_MANAGER };
  if (url === 'mock:usage-logger') return { format: 'module', shortCircuit: true, source: USAGE_LOGGER };
  if (url === 'mock:safety-filter') return { format: 'module', shortCircuit: true, source: SAFETY_FILTER };
  if (url === 'mock:pipeline-deadline') return { format: 'module', shortCircuit: true, source: PIPELINE_DEADLINE };
  return nextLoad(url, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hook));

process.env.GEMINI_VIDEO_API_KEY = 'clip-fallback-contract-test';
const GEMINI_CLIENT = await import(new URL('../src/lib/ai/geminiClient.js?clip-fallback-contract', import.meta.url));

const PRIMARY_VIDEO_MODEL = 'gemini-3.7-flash';
const FALLBACK_VIDEO_MODEL = 'gemini-3.6-flash';
const STRICT_FALLBACK_ARGS = {
  model: PRIMARY_VIDEO_MODEL,
  maxAttempts: 1,
  allowModelFallback: true,
  fallbackModels: [FALLBACK_VIDEO_MODEL],
};

function setGeminiRuntimePlan(steps) {
  globalThis.__clipGeminiRuntimeModels = [];
  globalThis.__clipGeminiRuntimePlan = steps.map((step) => ({ ...step }));
}

const TRANSCRIPT = 'ผู้ถูกสัมภาษณ์เล่าเหตุการณ์พร้อมชื่อ ตัวเลข และลำดับที่เกิดขึ้นจริง '.repeat(12);

async function capturePrompt(platform, tag) {
  globalThis.__clipEditorialPrompt = '';
  globalThis.__clipEditorialVideoCalls = 0;
  globalThis.__clipEditorialVideoArgs = [];
  const mod = await import(`${SERVICE}?editorial=${tag}`);
  await mod.extractClipInsight(platform === 'youtube'
    ? { platform, url: 'https://www.youtube.com/watch?v=editorial-test' }
    : { platform: 'transcript', rawText: TRANSCRIPT });
  return {
    prompt: globalThis.__clipEditorialPrompt,
    calls: globalThis.__clipEditorialVideoCalls,
    args: globalThis.__clipEditorialVideoArgs,
  };
}

async function captureFilePrompt(tag) {
  globalThis.__clipEditorialPrompt = '';
  globalThis.__clipEditorialVideoCalls = 0;
  globalThis.__clipEditorialVideoArgs = [];
  const mod = await import(`${SERVICE}?editorial=${tag}`);
  await mod.extractInsightFromVideoBuffer(Buffer.alloc(10001), 'video/mp4');
  return {
    prompt: globalThis.__clipEditorialPrompt,
    calls: globalThis.__clipEditorialVideoCalls,
    args: globalThis.__clipEditorialVideoArgs,
  };
}

test('video และ transcript ใช้กฎเนื้อดิบพร้อมข่าวชุดเดียวกันใน AI รอบเดิม', async () => {
  const video = await capturePrompt('youtube', 'video');
  const file = await captureFilePrompt('file');
  const transcript = await capturePrompt('transcript', 'transcript');

  for (const prompt of [video.prompt, file.prompt, transcript.prompt]) {
    assert.match(prompt, /เนื้อดิบพร้อมส่งเข้าระบบข่าว/);
    assert.match(prompt, /เริ่มที่เหตุการณ์หรือสาระข่าว/);
    assert.match(prompt, /ประโยคแรกต้องเริ่มด้วยข้อเท็จจริง.*ห้ามเริ่มด้วยถ้อยคำเมตา/);
    assert.match(prompt, /เขียน directLead เป็นประโยคเปิดพร้อมใช้ 1 ประโยค/);
    assert.match(prompt, /rawData ต้องเริ่มด้วย directLead เดิมแบบคำต่อคำ/);
    assert.match(prompt, /directLead ห้ามทำหน้าที่เป็นสารบัญหรือประกาศว่าจะเล่าเรื่อง/);
    assert.match(prompt, /“เปิดเผยเส้นทางชีวิต”.*“ถ่ายทอดประสบการณ์”.*“ย้อนเล่าชีวิตตั้งแต่\.\.\.ถึง\.\.\.”/);
    assert.match(prompt, /กริยาหลักต้องเป็นสิ่งที่บุคคล “ทำ\/เจอ\/รู้สึก\/ตัดสินใจ”/);
    assert.match(prompt, /ห้ามเป็นกริยารายงานว่า เปิดใจ เปิดเผย เผย เล่า เล่าถึง ย้อนชีวิต ถ่ายทอด พูดถึง กล่าวถึง หรือให้สัมภาษณ์/);
    assert.match(prompt, /เอ็ม บุษราคัม เล่าถึงชีวิตในวัยเด็ก.*เอ็ม บุษราคัม เติบโตมากับความรู้สึก/);
    assert.match(prompt, /interviewEventIsNews = true.*การออกมาพูดครั้งนี้.*เป็นเหตุการณ์ข่าวเองจริง/);
    assert.match(prompt, /ห้ามตั้ง true เพียงเพราะต้นทางเป็นรายการสัมภาษณ์/);
    assert.match(prompt, /“เปิดใจ”.*“ให้สัมภาษณ์”.*“เล่าถึง”.*“เผยเรื่องราว”/);
    assert.match(prompt, /ห้ามเปิดด้วยกรอบว่าใครมาออกรายการ/);
    assert.match(prompt, /คำว่า “ให้สัมภาษณ์”.*“ผู้สื่อข่าวถาม”.*เป็นเพียงวิธีได้ข้อมูล ไม่ใช่ตัวข่าว/);
    assert.match(prompt, /ห้ามใช้เป็นคำเปิดหรือสะพานเชื่อม/);
    assert.match(prompt, /ชื่อรายการ.*ชื่อช่อง.*ชื่อพิธีกร/);
    assert.match(prompt, /หากไม่ทราบชื่อผู้พูด.*ใช้บทบาทในเรื่อง.*ห้ามบรรยายสีเสื้อ แว่นตา/);
    assert.match(prompt, /ระบุเจ้าของข้อความตรงๆ.*ไม่ใช้ชื่อรายการหรือพิธีกรเป็นสะพานเล่า/);
    assert.match(prompt, /กล่าวสั้นเพียงครั้งเดียวหลังข้อเท็จจริงแรก/);
    assert.match(prompt, /ตัดราคาปกติ ราคาลด ของแถม ค่าส่ง ช่องทางสั่งซื้อ และคำเร่งขายออก/);
    assert.match(prompt, /คำเอ้อ.*คำถามซ้ำ.*คำทักทาย/);
    assert.match(prompt, /ห้ามนำคน.*คำพูด.*ตัวเลข.*คนละประเด็นมาปนกัน/);
    assert.match(prompt, /คำพูดตรงที่เลือกไว้ใน quotes.*ต้องวางรวมใน rawData/);
    assert.match(prompt, /เขียนประธาน–กริยาให้ชัด.*ภาษารายงานแข็ง.*อ่านสะดุด/);
    assert.match(prompt, /วลีจากเสียง\/ซับเพี้ยน.*ห้ามคัดลอกและห้ามซ่อมด้วยการเดา/);
    assert.match(prompt, /quotes ให้เก็บเฉพาะประโยคที่ได้ยินครบและเข้าใจความหมายแน่นอน/);
    assert.match(prompt, /อ่าน rawData และแต่ละ subStory\.rawData ต่อเนื่องอีกครั้ง.*กล่าวซ้ำ/);
    assert.match(prompt, /วลีที่ไม่ชัด.*คงข้อเท็จจริงส่วนที่ฟังรู้เรื่อง/);
  }
  assert.equal(video.calls, 1, 'การเพิ่มกฎ editorial ต้องยังใช้ video AI รอบเดิมเพียงครั้งเดียว');
  assert.equal(file.calls, 1, 'เส้นไฟล์ต้องเรียก video AI เพียงครั้งเดียว');
  for (const call of [...video.args, ...file.args]) {
    assert.equal(call.args.maxAttempts, 1, `${call.kind} ต้องปิด retry อัตโนมัติ`);
    assert.equal(call.args.allowModelFallback, true, `${call.kind} ต้องเปิด fallback ที่ระบุไว้เท่านั้น`);
    assert.deepEqual(call.args.fallbackModels, [FALLBACK_VIDEO_MODEL], `${call.kind} ต้องมี 3.6 เป็น fallback เพียงตัวเดียว`);
  }
});

test('ผล normalize ติด prompt revision เพื่อแยกจากงานเก่าในคลัง', async () => {
  const mod = await import(`${SERVICE}?editorial=revision`);
  const out = await mod.extractClipInsight({ platform: 'transcript', rawText: TRANSCRIPT });
  assert.equal(out.promptRev, 'clip-editorial-direct-lead-v7-0822');
});

test('directLead เปิดด้วยเนื้อจริงและตรงกับต้น rawData ผ่านโดยไม่แก้ข้อความหรือเพิ่ม inference', async () => {
  const directLead = 'ตลอดช่วงที่เติบโตมา เอ็ม บุษราคัมรู้สึกว่าไม่ค่อยได้รับคำชมตรง ๆ จากพ่อ';
  const rawData = `${directLead} ความรู้สึกนี้ทำให้เธอเล่าถึงความสัมพันธ์ในครอบครัวต่อไป`;
  globalThis.__clipEditorialVideoCalls = 0;
  globalThis.__clipEditorialVideoResult = {
    clipType: 'interview',
    headline: 'เรื่องครอบครัว',
    directLead,
    interviewEventIsNews: false,
    rawData,
    subStories: [],
  };
  try {
    const mod = await import(`${SERVICE}?editorial=direct-lead-happy`);
    const out = await mod.extractClipInsight({ platform: 'youtube', url: 'https://www.youtube.com/watch?v=direct-lead' });
    assert.equal(globalThis.__clipEditorialVideoCalls, 1);
    assert.equal(out.directLead, directLead);
    assert.equal(out.rawData, rawData, 'validator ต้องไม่เขียนทับหรือเกลาเนื้อที่โมเดลส่งมา');
    assert.deepEqual(out.editorialWarnings, []);
  } finally {
    delete globalThis.__clipEditorialVideoResult;
  }
});

test('คำเปิดแบบเปิดใจถูกเตือนเท่านั้น ส่วนข้อความเดิมยังคืนให้พนักงานและไม่ยิงซ้ำ', async () => {
  const directLead = 'เอ็ม บุษราคัม เปิดใจถึงความรู้สึกที่เติบโตมาโดยไม่ค่อยได้รับคำชมตรง ๆ จากพ่อ';
  globalThis.__clipEditorialVideoCalls = 0;
  globalThis.__clipEditorialVideoResult = {
    clipType: 'interview',
    directLead,
    interviewEventIsNews: false,
    rawData: `${directLead} พร้อมเล่ารายละเอียดชีวิตครอบครัว`,
    subStories: [],
  };
  try {
    const mod = await import(`${SERVICE}?editorial=direct-lead-warning`);
    const out = await mod.extractClipInsight({ platform: 'youtube', url: 'https://www.youtube.com/watch?v=direct-lead-warning' });
    assert.equal(globalThis.__clipEditorialVideoCalls, 1, 'คำเปิดไม่ดีต้องไม่ทำให้เสีย inference รอบใหม่');
    assert.equal(out.rawData, `${directLead} พร้อมเล่ารายละเอียดชีวิตครอบครัว`);
    assert.equal(out.editorialWarnings.length, 1);
    assert.match(out.editorialWarnings[0], /กรอบรายการ\/สัมภาษณ์/);
    assert.equal(out.lowQuality, undefined, 'คำเตือน editorial ต้องไม่ทำ cache ใช้งานไม่ได้หรือบังคับถอดใหม่');
  } finally {
    delete globalThis.__clipEditorialVideoResult;
  }
});

test('ผล canary จริงแบบ “เปิดเผยเส้นทางชีวิต” ถูกเตือนว่าเป็นคำเปรย ไม่ใช่เนื้อข่าวเปิด', async () => {
  const mod = await import(`${SERVICE}?editorial=direct-lead-live-regression`);
  const directLead = 'เอ็ม บุษราคัม เปิดเผยเส้นทางชีวิตตั้งแต่การเติบโตหลังเวทีตลกคาเฟ่สู่การพิสูจน์ตัวเองในฐานะผู้กำกับภาพยนตร์และคุณแม่ลูกสอง';
  const warnings = mod.assessClipDirectLead({
    directLead,
    rawData: `${directLead} โดยเล่าว่าในช่วงวัยเด็กครอบครัวเริ่มต้นจากห้องเช่าแคบ ๆ`,
    interviewEventIsNews: false,
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /กรอบรายการ\/สัมภาษณ์/);
});

test('ผล canary ที่เลี่ยงไปใช้ “เล่าถึง/ย้อนชีวิต/เผยประสบการณ์” ยังถูกจับครบ', async () => {
  const mod = await import(`${SERVICE}?editorial=direct-lead-reporting-verbs`);
  const badLeads = [
    'เอ็ม บุษราคัม เล่าถึงชีวิตในวัยเด็กที่เติบโตมากับคุณพ่อ',
    'เอ็ม บุษราคัม ย้อนชีวิตช่วงวัยเด็กที่เติบโตมาในครอบครัวตลก',
    'เอ็ม บุษราคัม เผยประสบการณ์การถูกกลั่นแกล้งในช่วงวัยเรียน',
  ];
  for (const directLead of badLeads) {
    const warnings = mod.assessClipDirectLead({ directLead, rawData: `${directLead} พร้อมรายละเอียด`, interviewEventIsNews: false });
    assert.equal(warnings.length, 1, directLead);
    assert.match(warnings[0], /คำเปรยหรือกรอบรายการ\/สัมภาษณ์/);
  }
});

test('ตรวจทั้งความตรงกันของ directLead และข้อยกเว้นที่การให้สัมภาษณ์เป็นข่าวจริง', async () => {
  const mod = await import(`${SERVICE}?editorial=direct-lead-validator`);
  const mismatch = mod.assessClipDirectLead({
    directLead: 'เอ็ม บุษราคัมเติบโตมากับความรู้สึกว่าไม่ค่อยได้รับคำชมตรง ๆ จากพ่อ',
    rawData: 'เอ็ม บุษราคัมเปิดใจในรายการถึงชีวิตและครอบครัว ก่อนเล่าความรู้สึกดังกล่าว',
    interviewEventIsNews: false,
  });
  assert.equal(mismatch.length, 2);
  assert.ok(mismatch.some((warning) => /กรอบรายการ\/สัมภาษณ์/.test(warning)));
  assert.ok(mismatch.some((warning) => /ไม่ได้เริ่มด้วย directLead/.test(warning)));

  const realInterviewEvent = 'นักแสดงให้สัมภาษณ์เป็นครั้งแรกหลังเงียบมานาน โดยยืนยันว่าไม่ได้ยุติสัญญากับต้นสังกัด';
  assert.deepEqual(mod.assessClipDirectLead({
    directLead: realInterviewEvent,
    rawData: `${realInterviewEvent} พร้อมอธิบายลำดับเหตุการณ์`,
    interviewEventIsNews: true,
  }), []);

  const fakeException = mod.assessClipDirectLead({
    directLead: 'เอ็ม บุษราคัมเปิดใจถึงชีวิตครอบครัว',
    rawData: 'เอ็ม บุษราคัมเปิดใจถึงชีวิตครอบครัวและความสัมพันธ์กับพ่อ',
    interviewEventIsNews: true,
  });
  assert.ok(fakeException.some((warning) => /ไม่มีเหตุการณ์ชี้แจงหรือยืนยัน/.test(warning)));
  assert.ok(fakeException.some((warning) => /กรอบรายการ\/สัมภาษณ์/.test(warning)));
});

test('คำเตือน directLead แสดงทั้งเว็บและมือถือโดยไม่ผูกกับ lowQuality', () => {
  // เว็บ: คำเตือน editorialWarnings ถูกเรนเดอร์ + มีป้ายให้พนักงานตรวจ (ย้ายไป InsightCard หลังรื้อหน้า)
  assert.match(WEB_SOURCE, /editorialWarnings/);
  assert.match(WEB_SOURCE, /จุดให้พนักงานตรวจประโยคเปิด/);
  // มือถือคงเดิม (ไม่ได้แตะ /m)
  assert.match(MOBILE_SOURCE, /insight\.editorialWarnings\?\.length > 0/);
  assert.match(MOBILE_SOURCE, /จุดให้พนักงานตรวจประโยคเปิด/);
  // ชั้น service ต้องไม่ผูก editorialWarnings กับ lowQuality
  assert.doesNotMatch(SERVICE_SOURCE, /editorialWarnings[\s\S]{0,120}lowQuality/);
});

test('single-topic export ไม่ต่อ headline/overview/keyPoints ซ้ำ และไม่ทำคำพูดตรงซ้ำ', async () => {
  const { buildClipNewsReadyText } = await import('../src/lib/services/clipNewsReadyText.js');
  const raw = 'นักเรียนเก็บเงินซื้อชุดปฐมพยาบาล\n\nเจ้าของร้านพูดว่า คำพูดที่อยู่ในเนื้อแล้ว และมอบให้โดยไม่คิดเงิน';
  const out = buildClipNewsReadyText({
    headline: 'หัวข้อที่ไม่ควรถูกต่อซ้ำ',
    overview: 'ภาพรวมที่ไม่ควรถูกต่อซ้ำ',
    keyPoints: [{ point: 'ประเด็นซ้ำ' }],
    quotes: ['คำพูดที่อยู่ในเนื้อแล้ว', 'คำพูดตรงที่มีเฉพาะช่องหลักฐาน'],
    rawData: `  ${raw}  `,
    subStories: [],
  });
  assert.equal(out, `${raw}\n\nคำพูดสำคัญจากคลิป:\n“คำพูดตรงที่มีเฉพาะช่องหลักฐาน”`);
  assert.doesNotMatch(out, /หัวข้อที่ไม่ควรถูกต่อซ้ำ|ประเด็นซ้ำ|คำพูดซ้ำ/);
  assert.equal((out.match(/คำพูดที่อยู่ในเนื้อแล้ว/g) || []).length, 1);
});

test('multi-topic export ใช้เฉพาะก้อนประเด็นที่ครบในตัวเอง ไม่ต่อ rawData หรือ quote รวมข้ามเรื่อง', async () => {
  const { buildClipNewsReadyText } = await import('../src/lib/services/clipNewsReadyText.js');
  const out = buildClipNewsReadyText({
    rawData: 'ก้อนรวมที่ห้ามถูกต่อซ้ำ',
    keyPoints: [{ point: 'ภาพรวมซ้ำ' }],
    quotes: ['ซ้ำในเนื้อแล้ว', 'คำพูดรวมที่มีเฉพาะช่องหลักฐาน'],
    subStories: [
      { no: 1, topic: 'เรื่องครอบครัว', timeRange: '0:10–2:00', rawData: 'เจ้าตัวพูดว่า ซ้ำในเนื้อแล้ว', quotes: ['ซ้ำในเนื้อแล้ว', 'คำพูดตรงที่ยังไม่มีในเนื้อ'] },
      { no: 2, topic: 'เรื่องธุรกิจ', timeRange: '2:01–4:00', rawData: 'เนื้อธุรกิจครบในตัวเอง', keyPoints: ['ซ้ำในเนื้อแล้ว'] },
    ],
  });
  assert.equal(out, [
    'ประเด็น 1: เรื่องครอบครัว (0:10–2:00)',
    '',
    'เจ้าตัวพูดว่า ซ้ำในเนื้อแล้ว',
    '',
    'คำพูดสำคัญจากคลิป:',
    '“คำพูดตรงที่ยังไม่มีในเนื้อ”',
    '',
    'ประเด็น 2: เรื่องธุรกิจ (2:01–4:00)',
    '',
    'เนื้อธุรกิจครบในตัวเอง',
  ].join('\n'));
  assert.doesNotMatch(out, /ก้อนรวมที่ห้ามถูกต่อซ้ำ|ภาพรวมซ้ำ/);
  assert.doesNotMatch(out, /คำพูดรวมที่มีเฉพาะช่องหลักฐาน/, 'quote รวมที่ไม่รู้ว่าเป็นของเรื่องไหนห้ามไปต่อท้ายเรื่องสุดท้าย');
  assert.equal((out.match(/ซ้ำในเนื้อแล้ว/g) || []).length, 1);
});

test('normalize เก็บ subStories เกิน 8 ประเด็นครบ ไม่ตัดเงียบ', async () => {
  const expected = Array.from({ length: 10 }, (_, index) => ({
    topic: `ประเด็น ${index + 1}`,
    rawData: `รายละเอียดของประเด็น ${index + 1}`,
    keyPoints: [],
    quotes: [],
  }));
  globalThis.__clipEditorialVideoResult = {
    clipType: 'news_report',
    headline: 'ข่าวหลายประเด็น',
    rawData: 'เนื้อรวม',
    subStories: expected,
  };
  try {
    const mod = await import(`${SERVICE}?editorial=more-than-eight`);
    const out = await mod.extractClipInsight({
      platform: 'youtube',
      url: 'https://www.youtube.com/watch?v=more-than-eight',
    });
    assert.equal(out.subStories.length, 10);
    assert.deepEqual(out.subStories.map((story) => story.topic), expected.map((story) => story.topic));
  } finally {
    delete globalThis.__clipEditorialVideoResult;
  }
});

test('subStories มีแค่ก้อนเดียวให้ใช้ rawData รวมตามสัญญา single-story', async () => {
  const { buildClipNewsReadyText } = await import('../src/lib/services/clipNewsReadyText.js');
  assert.equal(buildClipNewsReadyText({
    rawData: 'เนื้อรวมที่ครบกว่า',
    subStories: [{ topic: 'ก้อนที่โมเดลแยกเกินมา', rawData: 'เนื้อย่อย' }],
  }), 'เนื้อรวมที่ครบกว่า');
});

test('รองรับผล multiTopic รุ่นเก่าโดยไม่ทิ้งประเด็น', async () => {
  const { buildClipNewsReadyText } = await import('../src/lib/services/clipNewsReadyText.js');
  const out = buildClipNewsReadyText({
    multiTopic: true,
    topics: [
      { no: 1, title: 'ประเด็นเก่า', timeStart: '0:00', timeEnd: '1:00', summary: 'สรุปข้อเท็จจริง', keyPoints: ['รายละเอียดเพิ่ม'], quotes: ['คำพูดสำคัญ'] },
      { no: 2, title: 'อีกประเด็น', summary: 'ข้อมูลอีกเรื่อง' },
    ],
  });
  assert.match(out, /ประเด็น 1: ประเด็นเก่า \(0:00–1:00\)/);
  assert.match(out, /สรุปข้อเท็จจริง\n• รายละเอียดเพิ่ม\n“คำพูดสำคัญ”/);
  assert.match(out, /ประเด็น 2: อีกประเด็น\nข้อมูลอีกเรื่อง/);
});

function assertSinglePaidInsightCall(source) {
  const post = source.slice(source.indexOf('export async function POST'));
  const calls = post.match(/getClipVideoQueue\(\)\.run\(\(\) => buildInsight/g) || [];
  assert.equal(calls.length, 1, 'หนึ่งคำขอ insight ต้องเริ่มงานดูคลิปแบบเสียเงินได้เพียงครั้งเดียว');
  assert.doesNotMatch(post, /insight-qc-retry|retryInsight/, 'ห้ามถอดคลิปซ้ำอัตโนมัติเพราะผลสั้น/ไม่มี headline');
  assert.match(post, /if \(issues\.length\)[\s\S]*lowQuality = true/, 'ผลไม่สมบูรณ์ต้องติดธงให้พนักงานตัดสินใจ ไม่ยิงใหม่เอง');

  const build = source.slice(source.indexOf('async function buildInsight'), source.indexOf('// TikTok/FB/IG'));
  assert.doesNotMatch(build, /_raceTimeout|_ytUrlBrokenUntil|catch\s*\(/, 'ห้ามลอง URL แล้ว fallback ไปยิงไฟล์ซ้ำในคำขอเดียว');
  assert.match(build, /if \(process\.platform === 'win32'\) return await downloadAndExtract\(\);/);
  assert.equal((build.match(/extractClipInsight\(/g) || []).length, 1, 'cloud URL inference ต้องมีทางเดียว');
  assert.equal((build.match(/extractInsightFromVideoBuffer\(/g) || []).length, 1, 'Windows file inference ต้องมีทางเดียว');
}

function assertStrictClipVideoPolicy(serviceSource, geminiSource) {
  assert.match(serviceSource, /maxAttempts:\s*1/);
  assert.match(serviceSource, /allowModelFallback:\s*true/);
  assert.match(serviceSource, /fallbackModels:\s*Object\.freeze\(\['gemini-3\.6-flash'\]\)/);
  assert.match(serviceSource, /exactModel[\s\S]*allowModelFallback:\s*false[\s\S]*fallbackModels:\s*\[\][\s\S]*model:\s*exactModel/, 'การระบุ model เพื่อ A\/B ต้องไม่แอบ fallback');
  assert.equal((serviceSource.match(/\.\.\.CLIP_VIDEO_INFERENCE_POLICY/g) || []).length, 2, 'multi-topic URL/file ต้องใช้ policy clip โดยตรง');
  assert.equal((serviceSource.match(/\.\.\.clipVideoInferenceOptions\(model\)/g) || []).length, 2, 'single-topic URL/file ต้องใช้ policy ที่คุม A/B model');
  assert.equal((geminiSource.match(/maxAttempts = 4/g) || []).length, 2, 'ระบบอื่นต้องคงค่า retry เดิมเมื่อไม่ส่ง policy');
  assert.equal((geminiSource.match(/\n  allowModelFallback = true,\n  fallbackModels = VIDEO_FALLBACK_MODELS,/g) || []).length, 2, 'video URL/file ต้องคง fallback defaults เมื่อ caller ไม่ส่ง policy');
  assert.equal((geminiSource.match(/const tries = Math\.max\(1, Math\.trunc\(Number\(maxAttempts\) \|\| 4\)\);/g) || []).length, 2, 'จำนวน retry ต้องอ่านจาก maxAttempts จริง');
  assert.equal((geminiSource.match(/buildGeminiVideoModelCandidates\(model, allowModelFallback, fallbackModels\)/g) || []).length, 2, 'ทั้ง URL และ file ต้องใช้ candidate list ที่ caller จำกัด');
  assert.equal((geminiSource.match(/isSafeGeminiVideoFallbackError\(e\) && m !== models\[models\.length - 1\]/g) || []).length, 2, 'ทั้ง URL และ file ต้อง fail-closed เมื่อผลรอบแรกกำกวม');
  assert.equal((geminiSource.match(/label: `GeminiVideo(?:File)?:\$\{m\}`, tries \}/g) || []).length, 2, 'retry helper ต้องใช้จำนวนครั้งจาก policy จริง');
}

test('ด่านคุณภาพติดธงอย่างเดียว ไม่เริ่ม Gemini รอบสองอัตโนมัติ', () => {
  assertSinglePaidInsightCall(ROUTE_SOURCE);
  const mutation = ROUTE_SOURCE.replace(
    'const issues = insightQualityIssues(insight);',
    "const issues = insightQualityIssues(insight);\nawait getClipVideoQueue().run(() => buildInsight({ url, type }), { label: 'insight-qc-retry' });",
  );
  assert.throws(() => assertSinglePaidInsightCall(mutation), /เพียงครั้งเดียว|ห้ามถอดคลิปซ้ำ/);
});

test('video insight ทุกทางล็อกหนึ่ง attempt ต่อโมเดลและ fallback เฉพาะ 3.6 โดยไม่เปลี่ยน default ของระบบอื่น', () => {
  assertStrictClipVideoPolicy(SERVICE_SOURCE, GEMINI_SOURCE);
  const missingWire = SERVICE_SOURCE.replace('...CLIP_VIDEO_INFERENCE_POLICY,', '');
  assert.throws(() => assertStrictClipVideoPolicy(missingWire, GEMINI_SOURCE), /policy clip|policy ที่คุม/);
  const hardcodedRetry = GEMINI_SOURCE.replace('label: `GeminiVideo:${m}`, tries }', 'label: `GeminiVideo:${m}`, tries: 4 }');
  assert.throws(() => assertStrictClipVideoPolicy(SERVICE_SOURCE, hardcodedRetry), /retry helper/);
  const unsafeFallback = GEMINI_SOURCE.replace('isSafeGeminiVideoFallbackError(e) && m !== models[models.length - 1]', 'true && m !== models[models.length - 1]');
  assert.throws(() => assertStrictClipVideoPolicy(SERVICE_SOURCE, unsafeFallback), /fail-closed/);
  const extraModel = SERVICE_SOURCE.replace("Object.freeze(['gemini-3.6-flash'])", "Object.freeze(['gemini-3.6-flash', 'gemini-3.5-flash'])");
  assert.throws(() => assertStrictClipVideoPolicy(extraModel, GEMINI_SOURCE), /fallbackModels/);
});

test('capacity rejection ที่ชัดเจนสลับ 3.7 ไป 3.6 อย่างละหนึ่งครั้ง ทั้ง URL และไฟล์', async () => {
  for (const error of [
    { status: 429, message: '429 provider capacity' },
    { status: 503, message: '503 provider capacity' },
    { message: 'RESOURCE_EXHAUSTED: high demand' },
  ]) {
    setGeminiRuntimePlan([
      { error },
      { content: '{"clipType":"interview","rawData":"ผลจากโมเดลสำรอง"}' },
    ]);
    const urlResult = await GEMINI_CLIENT.callGeminiVideo({
      prompt: 'ทดสอบ',
      youtubeUrl: 'https://www.youtube.com/watch?v=fallback-contract',
      ...STRICT_FALLBACK_ARGS,
    });
    assert.equal(urlResult.rawData, 'ผลจากโมเดลสำรอง');
    assert.deepEqual(globalThis.__clipGeminiRuntimeModels, [PRIMARY_VIDEO_MODEL, FALLBACK_VIDEO_MODEL]);
  }

  setGeminiRuntimePlan([
    { error: { status: 503, message: '503 provider capacity' } },
    { content: '{"clipType":"interview","rawData":"ผลไฟล์จากโมเดลสำรอง"}' },
  ]);
  const fileResult = await GEMINI_CLIENT.callGeminiVideoFile({
    prompt: 'ทดสอบไฟล์',
    videoBuffer: Buffer.alloc(10001),
    ...STRICT_FALLBACK_ARGS,
  });
  assert.equal(fileResult.rawData, 'ผลไฟล์จากโมเดลสำรอง');
  assert.deepEqual(globalThis.__clipGeminiRuntimeModels, [PRIMARY_VIDEO_MODEL, FALLBACK_VIDEO_MODEL]);
});

test('ผลกำกวมและผลคุณภาพต่ำไม่ยิง 3.6 ซ้ำ', async () => {
  const ambiguousCases = [
    { label: '500', step: { error: { status: 500, message: 'internal provider error' } } },
    { label: '502', step: { error: { status: 502, message: 'bad gateway' } } },
    { label: 'timeout', step: { error: { status: 504, message: 'request timeout' } } },
    { label: 'network', step: { error: { message: 'fetch failed ECONNRESET' } } },
    { label: 'empty', step: { content: '' } },
    { label: 'parse', step: { content: '{not-json' } },
  ];

  for (const { label, step } of ambiguousCases) {
    setGeminiRuntimePlan([step, { content: '{"rawData":"ห้ามถูกเรียก"}' }]);
    await assert.rejects(
      GEMINI_CLIENT.callGeminiVideo({
        prompt: label,
        youtubeUrl: 'https://www.youtube.com/watch?v=no-ambiguous-fallback',
        ...STRICT_FALLBACK_ARGS,
      }),
    );
    assert.deepEqual(globalThis.__clipGeminiRuntimeModels, [PRIMARY_VIDEO_MODEL], `${label} ต้องหยุดหลัง 3.7`);
  }

  setGeminiRuntimePlan([{ content: '{"clipType":"interview","rawData":"ไม่ภาวะเครียดสะสม"}' }]);
  const lowQuality = await GEMINI_CLIENT.callGeminiVideo({
    prompt: 'ผล valid แต่สำนวนไม่ดี',
    youtubeUrl: 'https://www.youtube.com/watch?v=no-quality-fallback',
    ...STRICT_FALLBACK_ARGS,
  });
  assert.equal(lowQuality.rawData, 'ไม่ภาวะเครียดสะสม');
  assert.deepEqual(globalThis.__clipGeminiRuntimeModels, [PRIMARY_VIDEO_MODEL], 'คุณภาพสำนวนไม่ใช่เหตุให้คิดเงินโมเดลที่สอง');
});

test('ทุกปุ่มส่งต่อหลักใช้ projection พร้อมข่าว และแยกชื่อปุ่มก้อนรวมเดิมให้พนักงานไม่สับสน', () => {
  // เว็บ: การคัดลอกใช้ helper projection (ย้ายไป InsightCard หลังรื้อหน้า)
  assert.match(WEB_SOURCE, /import \{ buildClipNewsReadyText, buildClipSubStoryText \}/);
  assert.match(WEB_SOURCE, /buildClipNewsReadyText\(/);
  assert.match(WEB_SOURCE, /คัดลอกเนื้อพร้อมใช้/);
  assert.match(WEB_SOURCE, /คัดลอกก้อนรวม/);              // ปุ่มก้อนรวมแยกจากปุ่มเนื้อพร้อมใช้ (กันพนักงานสับสน)
  assert.match(WEB_SOURCE, /buildClipSubStoryText\(/);
  // ★ กันบั๊ก UI-01 (คัดลอกกลับด้าน): signature ปุ่มคัดลอกต้องตรงกันสองฝั่ง = (key, text)
  assert.match(PAGE_SOURCE, /const copy = \(key, text\)/);
  assert.match(CARD_SOURCE, /const copy = \(key, text\)/);
  // ข้อความความปลอดภัยตอนรอลองใหม่ (retry_wait) ยังอยู่ในเว็บ (JobBoard) — ต้องไม่สื่อว่าถอดซ้ำเสียเงิน
  assert.match(WEB_SOURCE, /ไม่วนถอดซ้ำอัตโนมัติ/);
  assert.match(WEB_SOURCE, /เซิร์ฟเวอร์ยืนยันว่าลองส่งใหม่ได้อย่างปลอดภัย/);
  assert.doesNotMatch(WEB_SOURCE, /ลองให้เองจน Gemini ว่าง|รันให้เองจน Gemini ว่าง|Gemini แน่น กำลังสู้อยู่/);

  assert.match(MOBILE_SOURCE, /import \{ buildClipNewsReadyText, buildClipSubStoryText \}/);
  assert.match(MOBILE_SOURCE, /const clipAllText = \(ins\) => buildClipNewsReadyText\(ins\)/);
  assert.match(MOBILE_SOURCE, /คัดลอกเนื้อพร้อมใช้/);
  assert.equal((MOBILE_SOURCE.match(/คัดลอกก้อนรวมเดิม/g) || []).length, 2);
  assert.ok((MOBILE_SOURCE.match(/buildClipSubStoryText\(/g) || []).length >= 4, 'คัดลอก/ส่งประเด็นบนมือถือทั้งหมดต้องใช้ helper เดียวกัน');
  assert.doesNotMatch(MOBILE_SOURCE, /if \(ins\.multiTopic && ins\.topics\?\.length\)/, 'ห้ามฟื้นตัวต่อข้อความแบบเก่าบนมือถือ');
});

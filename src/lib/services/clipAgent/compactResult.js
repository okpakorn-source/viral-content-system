/** ย่อข้อมูลคลิปสำหรับเอเจนต์ โดยคงข้อความต้นฉบับ */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const record = (value) => isRecord(value) ? value : {};
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' ? value : null;
const number = (value) => Number.isFinite(value) ? value : null;
const boolean = (value) => typeof value === 'boolean' ? value : null;

function copyMetadata(value) {
  if (!isRecord(value)) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function pointText(value) {
  if (typeof value === 'string') return value;
  const point = record(value);
  return text(point.text) ?? [text(point.point), text(point.detail)].filter(Boolean).join(': ');
}

function warningText(value) {
  if (typeof value === 'string') return value;
  const warning = record(value);
  // ตัวสร้าง degradation ใช้หลาย field: why/message/note/got/want — เก็บให้ครบ ไม่เหลือแค่ชื่อชนิด
  const detail = [text(warning.why) ?? text(warning.message) ?? text(warning.note),
    warning.got !== undefined || warning.want !== undefined ? `got=${JSON.stringify(warning.got ?? null)} want=${JSON.stringify(warning.want ?? null)}` : null,
    text(warning.why) && text(warning.note) ? text(warning.note) : null].filter(Boolean).join(' · ');
  return [text(warning.type), detail || null].filter(Boolean).join(': ');
}

function knownCostUSD(brain) {
  if (number(brain.costUSD) !== null) return brain.costUSD;
  // costs เดิมมีจำนวน token ปนอยู่ จึงรวมเฉพาะช่อง USD
  const amounts = Object.entries(record(brain.costs))
    .filter(([key, value]) => key.endsWith('USD') && number(value) !== null && value >= 0)
    .map(([, value]) => value);
  return amounts.length ? number(amounts.reduce((sum, value) => sum + value, 0)) : null;
}

function compactQuote(value) {
  const quote = record(value);
  const verification = text(quote.verification);
  return {
    text: typeof value === 'string' ? value : text(quote.text),
    speaker: text(quote.speaker),
    // pending = ยังไม่ได้ตรวจ → null (ไม่ใช่ false) ตามความหมายในเอกสาร
    verified: boolean(quote.verified) ?? (verification === 'verified' ? true : verification === 'unverified' ? false : null),
  };
}

function compactStory(value) {
  const story = record(value);
  return {
    id: text(story.id),
    topic: text(story.topic),
    story: text(story.story),
    highlight: text(story.highlight),
    facts: list(story.facts).map(pointText).filter(Boolean),
    quotes: list(story.quotes).map(compactQuote),
    sharePct: number(story.sharePct),
    quality: copyMetadata(story.quality),
  };
}

/** ข้อมูลขาดหรือผิดรูปแบบคืน null/[]; บทถอดใช้ rawText */
export function compactResult(caseRecord, kind = 'insight') {
  const saved = record(caseRecord);
  const nestedInsight = isRecord(saved.insight);
  const insight = nestedInsight ? saved.insight : saved;
  const common = {
    caseId: text(saved.id) ?? text(saved.caseId),
    url: text(saved.url),
    platform: text(saved.platform),
    title: text(saved.title),
  };
  if (kind === 'transcript') {
    return {
      ...common, title: text(saved.title) ?? text(saved.caption),
      text: text(saved.rawText), createdAt: text(saved.createdAt) ?? text(saved.cachedAt),
    };
  }

  const brain = record(insight.brain);
  const hasTopicsV2 = isRecord(insight.topicsV2);
  const topicsV2 = record(insight.topicsV2);
  const receipt = record(brain.topicsV2);
  return {
    ...common,
    title: common.title ?? (nestedInsight ? null : text(insight.headline) ?? text(insight.overview)),
    clipDurationSec: number(saved.clipDurationSec) ?? number(insight.clipDurationSec),
    createdAt: text(saved.createdAt) ?? text(saved.cachedAt),
    elapsedMs: number(saved.elapsedMs) ?? number(brain.elapsedMs),
    status: text(brain.status),
    // ใบที่ระบบเองติดธง 'ไม่สมบูรณ์' (insight/route.js เก็บ lowQuality+qualityNote) — เอเจนต์ต้องเห็นธงนี้
    lowQuality: saved.lowQuality === true || insight.lowQuality === true,
    qualityNote: text(saved.qualityNote) ?? text(insight.qualityNote),
    headline: text(insight.headline),
    overview: text(insight.overview),
    mainStory: text(topicsV2.mainStory) ?? text(insight.mainStory),
    keyPoints: list(insight.keyPoints).map(pointText).filter(Boolean),
    stories: list(topicsV2.stories).map(compactStory),
    ...(!hasTopicsV2 ? {
      subStories: list(insight.subStories).map((value) => {
        const story = record(value);
        return { title: text(story.topic) ?? text(story.title), text: text(story.rawData) ?? text(story.text) };
      }),
    } : {}),
    warnings: [...list(insight.editorialWarnings), ...list(brain.degradations)].map(warningText).filter(Boolean),
    brain: {
      engine: text(insight.engine) ?? text(brain.engine),
      elapsedMs: number(brain.elapsedMs),
      costUSD: knownCostUSD(brain),
      topicsV2: {
        ok: boolean(receipt.ok),
        gate: copyMetadata(receipt.gate),
        stories: number(receipt.stories) ?? (Array.isArray(receipt.stories) ? receipt.stories.length : null),
        elapsedMs: number(receipt.elapsedMs),
      },
    },
  };
}

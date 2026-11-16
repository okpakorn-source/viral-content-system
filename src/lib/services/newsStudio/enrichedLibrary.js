/**
 * =====================================================
 * Enriched Library — ตัวโหลดคลังความรู้ครบ 100% สำหรับแผนพัฒนาใหม่ (Plan A & Plan B)
 * =====================================================
 * รวมข้อมูลจากคลังเดิมทั้งหมดโดยไม่ตกหล่น:
 *   1. data/teacher-library.json (254 โพสต์ครูไวรัลฉบับเต็ม + hookStyle + whyItWorks + tags)
 *   2. data/card-essences.json (254/254 คำอธิบาย "เหมาะกับข่าว..." และ "ท่าเด่น:..." ผูกผ่าน cardId)
 *   3. data/angle-exemplars/angle-library.json (33 ปกต้นแบบ พร้อม lines, lineRoles, angle, technique, techniqueNote, emotion)
 *   4. data/admin-voice-exemplars.json & data/f2x-exemplars.json (ตัวอย่างน้ำเสียงแอดมินเพจจริง)
 */
import fs from 'fs';
import path from 'path';

let _cache = null;

export function loadEnrichedKnowledgeBase({ rootDir } = {}) {
  const resolvedRoot = rootDir || (fs.existsSync(path.join(process.cwd(), 'data', 'teacher-library.json')) ? process.cwd() : 'C:/news-studio-dev');
  if (_cache && _cache.rootDir === resolvedRoot) return _cache;

  const dataDir = path.join(resolvedRoot, 'data');
  const teacherRaw = JSON.parse(fs.readFileSync(path.join(dataDir, 'teacher-library.json'), 'utf8'));
  const cardEssences = JSON.parse(fs.readFileSync(path.join(dataDir, 'card-essences.json'), 'utf8'));
  const angleRaw = JSON.parse(fs.readFileSync(path.join(dataDir, 'angle-exemplars', 'angle-library.json'), 'utf8'));
  const adminVoiceRaw = JSON.parse(fs.readFileSync(path.join(dataDir, 'admin-voice-exemplars.json'), 'utf8'));
  const f2xRaw = JSON.parse(fs.readFileSync(path.join(dataDir, 'f2x-exemplars.json'), 'utf8'));

  const rawTeachers = Array.isArray(teacherRaw) ? teacherRaw : (teacherRaw.teachers || []);
  const teachers = rawTeachers.map((t, index) => {
    const essence = String(cardEssences[t.cardId] || '').trim();
    const parts = essence.split(/\s*;\s*/);
    const fitCriteria = (parts[0] || '').replace(/^เหมาะกับข่าว\s*/, '').trim();
    const signatureMove = (parts[1] || '').replace(/^ท่าเด่น\s*:\s*/, '').trim();
    const paragraphs = String(t.post || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    return {
      ...t,
      index,
      cardEssence: essence,
      fitCriteria,
      signatureMove,
      openingParagraph: paragraphs[0] || '',
      middleParagraph: paragraphs[1] || '',
      closingParagraph: paragraphs[paragraphs.length - 1] || '',
    };
  });

  const exemplars = (Array.isArray(angleRaw) ? angleRaw : (angleRaw.exemplars || [])).filter(
    (x) => x && typeof x.id === 'string' && Array.isArray(x.lines) && x.lines.length > 0
  );

  const adminVoice = Array.isArray(adminVoiceRaw) ? adminVoiceRaw : (adminVoiceRaw.exemplars || adminVoiceRaw.items || []);
  const f2x = Array.isArray(f2xRaw) ? f2xRaw : (f2xRaw.exemplars || f2xRaw.items || []);

  _cache = {
    rootDir: resolvedRoot,
    teachers,
    teachersById: new Map(teachers.map((t) => [t.id, t])),
    cardEssences,
    exemplars,
    adminVoice,
    f2x,
  };
  return _cache;
}

/**
 * จัดรูปแบบคลังปกต้นแบบ 33 ใบแบบ Full Anatomy (ครบทั้ง lines, lineRoles, angle, technique, techniqueNote, emotion)
 * เพื่อให้ AI เข้าใจ "วิธีคิดในการหยิบจุดเล็กๆ ที่กระแทกใจมาเปิดเรื่อง" ไม่ใช่เห็นแค่ข้อความพาดปก
 */
export function formatFullAngleExemplars(exemplars) {
  return (exemplars || []).map((x) => {
    const lines = (x.lines || []).map((l) => String(l).trim()).filter(Boolean).join(' / ');
    const roles = Array.isArray(x.lineRoles) && x.lineRoles.length
      ? `\n    หน้าที่แต่ละบรรทัด: ${x.lineRoles.map((r, i) => `(${i + 1}) ${r}`).join(' | ')}`
      : '';
    const angleWhy = x.angle ? `\n    ทำไมปกนี้ถึงปัง: ${String(x.angle).trim()}` : '';
    const tech = x.techniqueNote ? `\n    กฎการเลือกประเด็น (${x.technique || 'general'}): ${String(x.techniqueNote).trim()}` : '';
    const emo = x.emotion ? ` [อารมณ์: ${x.emotion}]` : '';
    return `[${x.id}]${emo} พาดปก: ${lines}${roles}${angleWhy}${tech}`;
  }).join('\n\n');
}

/**
 * จัดรูปแบบคลังครูทั้ง 254 ใบแบบอัดแน่นแต่ครบทุกมิติ (สำหรับโมเดล Long-Context หรือตัวคัดกรองเชิงลึก)
 * ประกอบด้วย: id | ชื่อแนว | หมวด | วิธีเปิด | เหมาะกับข่าวอะไร + ท่าเด่น (จาก card-essences) | โครงเปิด (hookStyle) | กลไกความปัง (whyItWorks) | ประโยคเปิด & ประโยคปิดจริง
 */
export function formatTeacherCatalogForAI(teachers, { includeOpenClose = true } = {}) {
  return (teachers || []).map((t) => {
    const open1 = String(t.openingParagraph || '').replace(/\s+/g, ' ').slice(0, 120);
    const close1 = String(t.closingParagraph || '').replace(/\s+/g, ' ').slice(0, 120);
    const essence = t.cardEssence ? ` | DNA: ${t.cardEssence}` : '';
    const hook = t.hookStyle ? ` | โครงเปิด: ${t.hookStyle}` : '';
    const why = t.whyItWorks ? ` | กลไกที่ทำให้ปัง: ${String(t.whyItWorks).slice(0, 160)}` : '';
    const sample = includeOpenClose ? `\n    เปิดจริง: "${open1}" → ปิดจริง: "${close1}"` : '';
    return `[${t.id}] (${t.category} · เปิดแบบ:${t.openingType} · ${(Number(t.views || 0) / 1e6).toFixed(1)}M วิว) ${t.name}${essence}${hook}${why}${sample}`;
  }).join('\n');
}

/**
 * ให้คะแนนความเข้ากันระหว่างข่าว + ทิศทาง กับครูทั้ง 254 ใบ โดยใช้ทั้งหมวด อารมณ์ คำสำคัญ และ Card Essence
 */
export function rankTeachersByFullDNA({ teachers, analysis, angles = [], rawText = '', topK = 48 }) {
  const priCat = String(analysis?.primaryCategory || '').trim();
  const secCats = new Set(Array.isArray(analysis?.secondaryCategories) ? analysis.secondaryCategories : []);
  const emoTags = new Set(Array.isArray(analysis?.emotionalTags) ? analysis.emotionalTags : []);
  const confTags = new Set(Array.isArray(analysis?.conflictTags) ? analysis.conflictTags : []);
  const arch = String(analysis?.narrativeArchetype || '').trim();

  const lossKeywords = /เสียชีวิต|จากไป|ไว้อาลัย|อุบัติเหตุ|ศพ|ร่างไร้วิญญาณ|สูญเสีย|ถึงแก่กรรม|มรณภาพ/;
  const rawIsLoss = lossKeywords.test(rawText) || confTags.has('การสูญเสีย');
  const hasQuote = /["“”][^"“”\n]{8,}["“”]/.test(rawText);

  // ดึงคำสำคัญจากทิศทางข่าวและเนื้อข่าว
  const angleText = angles.map((a) => `${a.focus || ''} ${a.core || ''} ${(a.coverLines || []).join(' ')}`).join(' ');

  const scored = (teachers || []).map((t) => {
    let score = 0;
    const tCats = new Set([t.category, ...(Array.isArray(t.targetCategories) ? t.targetCategories : [])]);
    const tEmos = new Set(Array.isArray(t.emotionalTags) ? t.emotionalTags : []);
    const tConfs = new Set(Array.isArray(t.conflictTags) ? t.conflictTags : []);

    // กฎเหล็กห้ามข้ามเส้นเรื่องการสูญเสีย
    const teacherIsTribute = t.openingType === 'tribute' || /ไว้อาลัย|จากไปอย่างไม่มีวันกลับ|เสียชีวิต/.test(`${t.name} ${t.cardEssence}`);
    if (teacherIsTribute && !rawIsLoss) score -= 100;
    if (!teacherIsTribute && rawIsLoss && /สนุก|ขำ|เอ็นดู/.test((t.emotionalTags || []).join(' '))) score -= 60;
    if (!hasQuote && t.openingType === 'quote') score -= 25;

    if (priCat && t.category === priCat) score += 28;
    else if (priCat && tCats.has(priCat)) score += 20;

    for (const sc of secCats) if (tCats.has(sc)) score += 8;
    for (const em of emoTags) if (tEmos.has(em)) score += 7;
    for (const cf of confTags) if (tConfs.has(cf)) score += 9;
    if (arch && t.narrativeArchetype === arch) score += 12;

    // ตรวจคำพ้องใน cardEssence + whyItWorks กับ angleText
    const dnaBlob = `${t.name} ${t.cardEssence || ''} ${t.hookStyle || ''} ${t.whyItWorks || ''}`;
    for (const kw of ['คำพูด', 'ตัวเลข', 'หนี้', 'บวช', 'ทหาร', 'ครู', 'แม่', 'ลูก', 'ครอบครัว', 'บริจาค', 'ติดดิน', 'เรียบง่าย', 'ธุรกิจ', 'สู้ชีวิต', 'กตัญญู', 'ตอบแทน']) {
      if ((rawText.includes(kw) || angleText.includes(kw)) && dnaBlob.includes(kw)) score += 6;
    }

    // โบนัสจากยอดวิวจริงเล็กน้อย (0–6 คะแนน)
    score += Math.min(6, Math.sqrt(Math.max(0, Number(t.views || 0)) / 1e6));
    return { teacher: t, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(topK, scored.length)).map((s) => ({ ...s.teacher, _dnaScore: Math.round(s.score * 10) / 10 }));
}

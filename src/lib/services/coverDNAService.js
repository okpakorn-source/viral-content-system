/**
 * Cover DNA Service
 * Map story type + emotion → recommended template + layout options
 * Hardcoded DNA map (ไม่ต้อง AI/DB — เร็วทันที)
 */

// ─── DNA Map: storyType → template + layout options ───────────────────────────
const DNA_MAP = {
  family_care:   { templateId: 'template_7', circleNeeded: true,  desc: 'ข่าวครอบครัว/การดูแล' },
  drama:         { templateId: 'template_1', circleNeeded: false, desc: 'ข่าวดราม่า' },
  donation:      { templateId: 'template_8', circleNeeded: false, desc: 'ข่าวบริจาค/ช่วยเหลือ' },
  rescue:        { templateId: 'template_5', circleNeeded: false, desc: 'ข่าวช่วยเหลือ/กู้ภัย' },
  celebrity:     { templateId: 'template_2', circleNeeded: true,  desc: 'ข่าวดารา/คนดัง' },
  relationship:  { templateId: 'template_7', circleNeeded: true,  desc: 'ข่าวความสัมพันธ์/คู่รัก' },
  achievement:   { templateId: 'template_8', circleNeeded: false, desc: 'ข่าวความสำเร็จ' },
  conflict:      { templateId: 'template_3', circleNeeded: false, desc: 'ข่าวขัดแย้ง/คดี' },
  accident:      { templateId: 'template_5', circleNeeded: false, desc: 'ข่าวอุบัติเหตุ' },
  politics:      { templateId: 'template_1', circleNeeded: false, desc: 'ข่าวการเมือง' },
  default:       { templateId: null,         circleNeeded: false, desc: 'ทั่วไป (ใช้ autoSelectTemplate)' },
};

// ─── Emotion + keywords → storyType mapping ───────────────────────────────────
const STORY_TYPE_RULES = [
  // family / care
  { type: 'family_care',  keywords: ['แม่', 'พ่อ', 'ลูก', 'ครอบครัว', 'ดูแล', 'อัลไซเมอร์', 'พ่อแม่', 'พยาบาล'] },
  // relationship / couple
  { type: 'relationship', keywords: ['คู่รัก', 'แฟน', 'แต่งงาน', 'หย่า', 'เลิก', 'สามี', 'ภรรยา', 'ผัว', 'เมีย'] },
  // drama
  { type: 'drama',        keywords: ['ดราม่า', 'ฟ้อง', 'คดี', 'โกรธ', 'ช็อก', 'ด่วน', 'ประณาม', 'แฉ'] },
  // donation / helping
  { type: 'donation',     keywords: ['บริจาค', 'มอบ', 'ช่วยเหลือ', 'ให้ทุน', 'สร้าง', 'มูลนิธิ', 'สนับสนุน'] },
  // rescue / accident
  { type: 'rescue',       keywords: ['ช่วย', 'กู้ภัย', 'กู้ชีวิต', 'ช่วยชีวิต'] },
  { type: 'accident',     keywords: ['อุบัติเหตุ', 'ชน', 'ไฟไหม้', 'น้ำท่วม', 'เสียชีวิต', 'เสียหาย'] },
  // conflict
  { type: 'conflict',     keywords: ['ขัดแย้ง', 'ทะเลาะ', 'ร้องเรียน', 'แจ้งความ', 'จับ', 'คุก'] },
  // achievement
  { type: 'achievement',  keywords: ['ชนะ', 'รางวัล', 'เปิดตัว', 'สำเร็จ', 'ภูมิใจ', 'ประสบความสำเร็จ'] },
  // politics
  { type: 'politics',     keywords: ['การเมือง', 'นักการเมือง', 'รัฐบาล', 'รัฐมนตรี', 'ส.ส.', 'ส.ว.'] },
  // celebrity (ใช้ coverEmotion=warm + identity.searchQueries.person_portrait)
  { type: 'celebrity',    keywords: ['ดารา', 'นักร้อง', 'นักแสดง', 'วงการบันเทิง', 'ศิลปิน', 'อินฟลูเอนเซอร์'] },
];

/**
 * detectStoryType — สแกน identity → หา storyType ที่เหมาะสม
 */
function detectStoryType(identity) {
  const textToScan = [
    identity?.story || '',
    (identity?.keyScenes || []).join(' '),
    (identity?.keywords || []).join(' '),
    identity?.coverEmotion || '',
    identity?.emotion || '',
  ].join(' ').toLowerCase();

  for (const rule of STORY_TYPE_RULES) {
    if (rule.keywords.some(kw => textToScan.includes(kw.toLowerCase()))) {
      return rule.type;
    }
  }
  return 'default';
}

/**
 * matchCoverDNA — Map identity → template recommendation
 * @param {Object} identity — จาก analyzeStoryIdentity
 * @returns {{ recommendedTemplate: string|null, circleNeeded: boolean, storyType: string, source: 'dna'|'fallback' }}
 */
export function matchCoverDNA(identity) {
  try {
    const storyType = detectStoryType(identity);
    const dna = DNA_MAP[storyType] || DNA_MAP['default'];

    console.log(`[CoverDNA] Story type: "${storyType}" → template: ${dna.templateId || 'auto'} (circle: ${dna.circleNeeded}) — ${dna.desc}`);

    return {
      recommendedTemplate: dna.templateId,
      circleNeeded: dna.circleNeeded,
      storyType,
      source: storyType === 'default' ? 'fallback' : 'dna',
      desc: dna.desc,
    };
  } catch (e) {
    console.warn('[CoverDNA] Error:', e.message);
    return {
      recommendedTemplate: null,
      circleNeeded: false,
      storyType: 'default',
      source: 'fallback',
      desc: 'fallback',
    };
  }
}

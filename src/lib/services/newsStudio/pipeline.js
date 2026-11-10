/**
 * =====================================================
 * News Studio Pipeline — ท่อเขียนข่าวตัวใหม่ทั้งเส้น (10 พ.ย. 69)
 * =====================================================
 * เนื้อดิบจากพนักงาน
 *   → ① กำหนดทิศทางข่าว (ต้นแบบ 33 ปก · angleDirector.js)      ← ตัวกำหนดว่าจะชูอะไร
 *     ‖ วิเคราะห์หมวด/อารมณ์ (ใช้คัดครูรอบแรก) ‖ ค้นข้อมูลเสริม (ถ้าเปิด)
 *   → ② เลือกครู 3 โพสต์ (โค้ดคัดผู้เข้ารอบ → บรรณารักษ์จัดลำดับ → โค้ดหยิบ · teacherLibrary.js)
 *   → ③ เขียน 3 เวอร์ชันพร้อมกัน: ทิศทางเป็นแกน · ครูเป็นสำนวน → ตรวจแบบแผน → ตรวจข้อเท็จจริง → แก้ไม่เกิน 3 รอบ (teacherWriter.js)
 *   → ผล: ทุกเวอร์ชันกลับมาเสมอพร้อมผลตรวจ — ไม่มีการทิ้งเวอร์ชันเงียบๆ
 *
 * ไฟล์นี้เป็นตัวเดินงานล้วน: ทุกอย่างที่แตะโลกภายนอก (โมเดล · ไฟล์ · ฐานข้อมูล · นาฬิกา · ตัวสุ่ม) ส่งเข้ามาทาง deps
 *   → หน้าเว็บ บอท Discord และข้อสอบ เรียกตัวเดียวกัน · ไม่มี import แบบ alias (รันด้วย node ตรงๆ ได้)
 * ตัวต่อสายของจริงอยู่ที่ src/lib/services/newsStudio/server.js
 */
import { directAngle, angleForVersion } from '../angleDirector.js';
import { shortlistTeachers, chooseRankedTeachers, pickTeachers } from '../teacherLibrary.js';
import { writeWithTeacher } from '../teacherWriter.js';

export const NEWS_STUDIO = Object.freeze({
  versions: 3,
  minRawChars: 40,       // สั้นกว่านี้ไม่ใช่เนื้อข่าว
  maxRawChars: 20000,    // กันวางเอกสารทั้งเล่ม (เนื้อดิบจริงของทีม: ค่ากลาง ~775 ตัวอักษร)
  shortlistSize: 60,
  writeAttempts: 3,
});

/** คำถามตัววิเคราะห์หมวด/อารมณ์ — ถ้อยคำเดียวกับตัววิเคราะห์ของท่อเดิม (ชื่อหมวดต้องตรงกับคลังครู 10 หมวด) */
export function buildAnalyzerPrompt(rawText) {
  return `คุณเป็นนักวิเคราะห์ข่าวและผู้เชี่ยวชาญการทำไวรัลคอนเทนต์
จงวิเคราะห์ข่าวต่อไปนี้ เพื่อใช้จับคู่กับสไตล์การเล่าเรื่องที่ดีที่สุด

=== ข่าวที่ต้องวิเคราะห์ ===
${String(rawText || '').slice(0, 3000)}
=== จบข่าว ===

ต้องเลือกจากตัวเลือกที่กำหนดเท่านั้น:
1. primaryCategory: เลือก 1 จาก: ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน
2. secondaryCategories: เลือก 1-3 จากรายการเดียวกัน (ห้ามซ้ำกับ primaryCategory)
3. emotionalTags: เลือก 2-4 จาก: เห็นใจ, สงสาร, โกรธ, เดือด, ซึ้ง, ตื้นตัน, กลัว, ช็อก, ภูมิใจ, ชื่นชม, คาใจ, สงสัย, เศร้า, หดหู่, สนุก, ขำ, แค้น, อบอุ่น, สะเทือนใจ, หวาดกลัว
4. conflictTags: เลือก 1-3 จาก: ความอยุติธรรม, การตัดสิน, การสูญเสีย, การต่อสู้, การเอาเปรียบ, ความผิดพลาด, การทรยศ, ความขัดแย้ง, การกดขี่, ความเหลื่อมล้ำ
5. narrativeArchetype: เลือก 1 จาก: สู้ชีวิต, ฮีโร่ชาวบ้าน, เปิดโปง, น้ำใจคนไทย, ชีวิตพลิกผัน, ดราม่าครอบครัว, ข่าวเตือนภัย, ความรักข้ามขีดจำกัด, ผู้ถูกกระทำ, คนดีที่โลกลืม
6. title: พาดหัวข่าวสั้นๆ ไม่เกิน 80 ตัวอักษร ใช้เฉพาะข้อเท็จจริงในข่าว

ตอบเป็น JSON เท่านั้น:
{"primaryCategory": "...", "secondaryCategories": ["..."], "emotionalTags": ["..."], "conflictTags": ["..."], "narrativeArchetype": "...", "title": "..."}`;
}

/** คำถามบรรณารักษ์: จัดลำดับครูที่ "รูปเรื่องเดียวกัน" และสำนวนเหมาะกับทิศทางที่กำหนดแล้ว (ครูไม่มีสิทธิ์เปลี่ยนทิศทาง) */
export function buildLibrarianPrompt({ rawText, shortlist, angles = [] }) {
  const dir = angles.length
    ? `\n=== ทิศทางข่าวที่บรรณาธิการกำหนดแล้ว (โพสต์ต้นแบบมีหน้าที่ให้สำนวนเท่านั้น) ===\n${angles.map((a, i) => `${i + 1}. ${a.focus}`).join('\n')}\n`
    : '';
  return `คุณเป็นบรรณารักษ์ของเพจข่าว หน้าที่คือเลือก "โพสต์ต้นแบบ" ให้นักเขียนใช้เลียนสำนวนและรูปแบบ สำหรับข่าว 1 ข่าว

=== เนื้อข่าว ===
${rawText}
=== จบเนื้อข่าว ===
${dir}
=== โพสต์ต้นแบบที่เลือกได้ (รหัส | แนวเรื่องและวิธีเขียน | ประโยคเปิดจริงของโพสต์) ===
${shortlist.map((t) => `${t.id} | ${t.name} | ${String(t.post).split('\n')[0].slice(0, 110)}`).join('\n')}
=== จบรายการ ===

เลือก 6 โพสต์ที่ "รูปเรื่อง" ใกล้กับข่าวนี้ที่สุด เรียงจากเหมาะที่สุดไปน้อยกว่า โดยดู:
1. คนในเรื่องและสถานการณ์เป็นแบบเดียวกันไหม
2. น้ำหนักอารมณ์ของเรื่องตรงกันไหม ห้ามเลือกต้นแบบเรื่องการสูญเสียหรือไว้อาลัยให้ข่าวที่ไม่มีการสูญเสีย และห้ามเลือกต้นแบบเรื่องสนุกสดใสให้ข่าวการสูญเสีย
3. วิธีเขียนของต้นแบบใช้กับวัตถุดิบของข่าวนี้และทิศทางที่กำหนดได้จริงไหม
4. ใน 6 โพสต์ ให้มีวิธีเปิดเรื่องต่างกันอย่างน้อย 3 แบบ

ตอบเป็น JSON เท่านั้น:
{"picks": [{"id": "รหัสโพสต์", "reason": "เหตุผลสั้นๆ"}]}`;
}

const QUOTE_RE = /["“”]/;
const DIGIT_RE = /[0-9๐-๙]/;

/** ทิศทางนี้ "เปิดด้วยอะไร": ดูข้อความพาดปกบรรทัดแรกก่อน แล้วค่อยดูทั้งปก — quote / number / '' (ไม่เจาะจง) */
export function angleOpeningNeed(angle) {
  const lines = (angle?.coverLines || []).map((l) => String(l || ''));
  if (lines.length === 0) return '';
  if (QUOTE_RE.test(lines[0])) return 'quote';
  if (DIGIT_RE.test(lines[0])) return 'number';
  const all = lines.join(' ');
  if (QUOTE_RE.test(all)) return 'quote';
  if (DIGIT_RE.test(all)) return 'number';
  return '';
}

/**
 * จับคู่ครูกับทิศทางของแต่ละเวอร์ชัน (เจ้าของ 10 พ.ย. 69: "ใช้ครูเสริมหัวข้อให้ทรงพลังได้ไม่ดี")
 * เดิมจับคู่ตามลำดับเฉยๆ — ทิศทางที่ชูคำพูดอาจได้ครูที่เปิดด้วยตัวเลข วิธีเปิดของครูจึงไม่ได้ส่งแรงให้ประเด็น
 * ตอนนี้ลองทุกการเรียง (ครู ≤ 3 ใบ = ไม่เกิน 6 แบบ) แล้วเลือกแบบที่วิธีเปิดของครูตรงกับสิ่งที่ทิศทางชูมากที่สุด
 * เสมอกัน = คงลำดับเดิม (ลำดับของบรรณารักษ์) · ไม่มีทิศทาง = คืนลำดับเดิม
 * @returns {Array} ครูเรียงตามเวอร์ชัน (ยาวเท่า teachers)
 */
export function pairTeachersWithAngles(teachers, angles) {
  const list = [...(teachers || [])];
  if (list.length < 2 || list.length > 4 || !(angles || []).some(Boolean)) return list;
  const fit = (teacher, angle) => {
    if (!teacher || !angle) return 0;
    const need = angleOpeningNeed(angle);
    const has = teacher.openingType;
    if (need && has === need) return 2;
    // ครูเปิดด้วยคำพูด แต่ทิศทางนี้ไม่มีคำพูดให้ชู = นักเขียนจะถูกดึงให้ฝืนหาคำพูดมาเปิด
    if (has === 'quote' && !QUOTE_RE.test([...(angle.coverLines || []), ...(angle.mustKeep || [])].join(' '))) return -1;
    return 0;
  };
  const perms = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [x, ...r])));
  let best = list;
  let bestScore = list.reduce((s, t, i) => s + fit(t, angles[i]), 0);
  for (const p of perms(list)) {
    const score = p.reduce((s, t, i) => s + fit(t, angles[i]), 0);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

function fail(errorType, message) {
  const err = new Error(message);
  err.errorType = errorType;
  return err;
}

const REQUIRED_DEPS = ['loadTeachers', 'loadExemplars', 'scoreTeachers', 'callDirector', 'callWriter', 'analyze', 'librarian'];

/**
 * เขียนข่าว 1 ข่าวทั้งเส้น
 * @param {object} p
 * @param {string} p.rawText  เนื้อดิบจากพนักงาน
 * @param {boolean} [p.useResearch=false]  ค้นข้อมูลเสริม (ต้องมี deps.research)
 * @param {(e:{step:string,status:string,detail?:string,ms:number}) => void} [p.onProgress]
 * @param {number} [p.retryDeadlineMs=0]  เลยเวลานี้ (นับจากเริ่มงาน) แล้วไม่เริ่มรอบแก้ใหม่ · 0 = ไม่จำกัด
 * @param {object} p.deps  ดูรายการด้านล่าง — ขาดตัวจำเป็น = โยน error ตั้งแต่ต้น ไม่เดินไปครึ่งทาง
 *   loadTeachers(): Array · loadExemplars(): Array · scoreTeachers(analysis, teachers): [{index,score}]
 *   callDirector/callWriter/callChecker({system,user}): Promise<string|object>   (callChecker ไม่ส่ง = ไม่ตรวจข้อเท็จจริง และผลจะบอกชัดว่าไม่ได้ตรวจ)
 *   callReader?({system,user}): Promise<string|object>   ผู้อ่านจับใจความ (เห็นแค่โพสต์) — ไม่ส่ง = ไม่ได้ตรวจว่าอ่านรอบเดียวเข้าใจ และผลจะบอกชัด
 *   analyze(rawText): Promise<object>   · librarian({rawText, shortlist, angles}): Promise<[{id,reason}]>
 *   research?(rawText): Promise<string[]> · getRecentTeacherIds?(): Promise<string[]> · rememberTeacherIds?(ids): Promise<void>
 *   now?(): number · rand?(): number
 * @returns {Promise<object>} ผลทั้งข่าว (ดูโครงที่ท้ายฟังก์ชัน) — ทุกเวอร์ชันที่ขออยู่ในผลเสมอ
 */
export async function runNewsStudio({ rawText, useResearch = false, onProgress, deps, retryDeadlineMs = 0 }) {
  for (const k of REQUIRED_DEPS) if (typeof deps?.[k] !== 'function') throw fail('NEWS_STUDIO_MISCONFIGURED', `ท่อเขียนข่าวตั้งค่าไม่ครบ: ขาด ${k}`);
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const rand = typeof deps.rand === 'function' ? deps.rand : Math.random;
  const t0 = now();
  const timings = {};
  const warnings = [];
  const emit = (step, status, detail = '') => { try { onProgress?.({ step, status, detail, ms: now() - t0 }); } catch { /* ผู้ฟังพังไม่ทำให้งานพัง */ } };
  const timed = async (step, fn) => { const s = now(); try { return await fn(); } finally { timings[step] = now() - s; } };

  const raw = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (raw.length < NEWS_STUDIO.minRawChars) throw fail('RAW_TEXT_TOO_SHORT', `เนื้อข่าวสั้นเกินไป (${raw.length} ตัวอักษร) — ต้องมีอย่างน้อย ${NEWS_STUDIO.minRawChars} ตัวอักษร`);
  if (raw.length > NEWS_STUDIO.maxRawChars) throw fail('RAW_TEXT_TOO_LONG', `เนื้อข่าวยาวเกินไป (${raw.length} ตัวอักษร) — รับได้ไม่เกิน ${NEWS_STUDIO.maxRawChars} ตัวอักษร`);

  const teachers = deps.loadTeachers();
  const exemplars = deps.loadExemplars();

  // ── ① ทิศทางข่าว ‖ วิเคราะห์หมวด ‖ ค้นข้อมูลเสริม ──
  emit('direction', 'start');
  const [brief, analysis, researchFacts] = await Promise.all([
    timed('direction', () => directAngle({ rawText: raw, exemplars, callModel: deps.callDirector })),
    timed('analysis', () => deps.analyze(raw).catch((e) => { warnings.push({ code: 'ANALYSIS_FAILED', message: `วิเคราะห์หมวดข่าวไม่สำเร็จ — คัดครูรอบแรกแบบไม่รู้หมวด (${String(e?.message || e).slice(0, 80)})` }); return null; })),
    useResearch && typeof deps.research === 'function'
      ? timed('research', () => deps.research(raw).then((f) => (Array.isArray(f) ? f.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8) : [])).catch((e) => { warnings.push({ code: 'RESEARCH_FAILED', message: `ค้นข้อมูลเสริมไม่สำเร็จ — เขียนจากเนื้อข่าวอย่างเดียว (${String(e?.message || e).slice(0, 80)})` }); return []; }))
      : Promise.resolve([]),
  ]);
  if (useResearch && typeof deps.research !== 'function') warnings.push({ code: 'RESEARCH_UNAVAILABLE', message: 'ขอค้นข้อมูลเสริม แต่ระบบนี้ยังไม่ได้ต่อตัวค้น — เขียนจากเนื้อข่าวอย่างเดียว' });
  if (!brief.ok) warnings.push({ code: 'NO_DIRECTION', message: `กำหนดทิศทางข่าวไม่สำเร็จ — เวอร์ชันทั้งหมดเขียนโดยไม่มีทิศทางจากต้นแบบ (${brief.error || 'ไม่มีทิศทางที่ใช้ได้'})` });
  const usableAngles = (brief.angles || []).filter((a) => a.inventedQuotes.length === 0);
  emit('direction', brief.ok ? 'done' : 'failed', brief.ok ? `${usableAngles.length} ทิศทาง` : (brief.error || ''));

  // ── ② เลือกครู ──
  emit('teachers', 'start');
  // ผลวิเคราะห์ผิดรูป (เช่น ช่องที่ควรเป็นรายการกลับเป็นข้อความ) ทำให้ตัวให้คะแนนโยน — ต้องถอยไปคัดครูแบบไม่รู้หมวด ไม่ใช่ล้มทั้งงาน
  const flatScores = () => teachers.map((_, index) => ({ index, score: 0 }));
  let scored = flatScores();
  if (analysis) {
    try {
      const got = deps.scoreTeachers(analysis, teachers);
      if (!Array.isArray(got)) throw new Error('ผลให้คะแนนไม่ใช่รายการ');
      scored = got;
    } catch (e) {
      warnings.push({ code: 'ANALYSIS_FAILED', message: `ใช้ผลวิเคราะห์หมวดข่าวไม่ได้ — คัดครูรอบแรกแบบไม่รู้หมวด (${String(e?.message || e).slice(0, 80)})` });
    }
  }
  let recent = [];
  if (typeof deps.getRecentTeacherIds === 'function') recent = await deps.getRecentTeacherIds().catch(() => []);
  const shortlist = shortlistTeachers({ teachers, scored, rawText: raw, size: NEWS_STUDIO.shortlistSize, avoidIds: recent });
  let ranked = [];
  await timed('teachers', async () => {
    try {
      const got = await deps.librarian({ rawText: raw, shortlist, angles: usableAngles });
      ranked = (Array.isArray(got) ? got : []).filter((p) => p && p.id).map((p) => ({ id: String(p.id), reason: String(p.reason || '').slice(0, 240) }));
    } catch (e) {
      warnings.push({ code: 'LIBRARIAN_FAILED', message: `บรรณารักษ์เลือกครูไม่สำเร็จ — ใช้ตัวเลือกสำรองแบบโค้ด (${String(e?.message || e).slice(0, 80)})` });
    }
  });
  const chosen = chooseRankedTeachers({ shortlist, rankedIds: ranked.map((p) => p.id), count: NEWS_STUDIO.versions });
  if (chosen.length < NEWS_STUDIO.versions) {
    const fill = pickTeachers({ teachers, scored, count: NEWS_STUDIO.versions, rand, avoidIds: [...recent, ...chosen.map((t) => t.id)] });
    for (const t of fill) if (chosen.length < NEWS_STUDIO.versions && !chosen.some((x) => x.id === t.id)) chosen.push(t);
    if (ranked.length > 0) warnings.push({ code: 'LIBRARIAN_PARTIAL', message: 'บรรณารักษ์เลือกครูมาไม่ครบ 3 — เติมด้วยตัวเลือกสำรองแบบโค้ด' });
  }
  if (chosen.length === 0) throw fail('NO_TEACHER_AVAILABLE', 'ไม่มีโพสต์ครูให้เลียน — ตรวจคลังครู');
  emit('teachers', 'done', `${chosen.length} โพสต์`);

  // ── ③ เขียน + ตรวจ ──
  emit('writing', 'start');
  const reasons = new Map(ranked.map((p) => [p.id, p.reason]));
  // เส้นตายของรอบแก้: เลยเวลานี้แล้วไม่เริ่มรอบแก้ใหม่ (ส่งฉบับที่ดีที่สุดที่มี) — กันงานถูกโฮสต์ตัดกลางทางจนผลหายทั้งงาน
  const retryUntil = Number.isFinite(retryDeadlineMs) && retryDeadlineMs > 0 ? t0 + retryDeadlineMs : Infinity;
  const canRetry = () => now() < retryUntil;
  const versionAngles = Array.from({ length: NEWS_STUDIO.versions }, (_, i) => angleForVersion(brief, i));
  const versionTeachers = pairTeachersWithAngles(Array.from({ length: NEWS_STUDIO.versions }, (_, i) => chosen[i % chosen.length]), versionAngles);
  const versions = await timed('writing', () => Promise.all(Array.from({ length: NEWS_STUDIO.versions }, async (_, i) => {
    const teacher = versionTeachers[i];
    const angle = versionAngles[i];
    const teacherInfo = { id: teacher.id, name: teacher.name, category: teacher.category, views: teacher.views, url: teacher.url, openingType: teacher.openingType, post: teacher.post, reason: reasons.get(teacher.id) || '' };
    try {
      const r = await writeWithTeacher({ teacher, rawText: raw, researchFacts, angle, callModel: deps.callWriter, callChecker: deps.callChecker || null, callReader: deps.callReader || null, maxAttempts: NEWS_STUDIO.writeAttempts, canRetry });
      emit('writing', 'version', `เวอร์ชัน ${i + 1} ${r.ok ? 'ผ่าน' : 'ยังมีจุดต้องดู'}`);
      return {
        index: i + 1, ok: r.ok, content: r.content, attempts: r.attempts, trail: r.trail || [], stopped: r.stopped || '', angle, teacher: teacherInfo,
        formOk: r.check.ok, fails: r.check.fails, warns: r.check.warns, metrics: r.check.metrics,
        factChecked: !!r.facts?.checked, factIssues: r.facts?.issues || [], factError: r.facts?.error || '',
        // ผู้อ่านจับใจความ: readChecked=false = ไม่ได้อ่าน (ไม่ได้ต่อ/ล่ม) ห้ามแสดงว่า "อ่านเข้าใจ"
        readChecked: !!r.reader?.read, readClear: !!(r.reader?.read && r.reader.clear), readOpening: r.reader?.opening || '', readGist: r.reader?.gist || '', readHardParts: r.reader?.hardParts || [], readError: r.reader?.error || '',
      };
    } catch (e) {
      emit('writing', 'version', `เวอร์ชัน ${i + 1} เขียนไม่สำเร็จ`);
      return { index: i + 1, ok: false, content: '', attempts: 0, trail: [], angle, teacher: teacherInfo, formOk: false, fails: [], warns: [], metrics: null, factChecked: false, factIssues: [], factError: '', readChecked: false, readClear: false, readOpening: '', readGist: '', readHardParts: [], readError: '', error: String(e?.message || e).slice(0, 200), errorType: e?.errorType || 'WRITER_FAILED' };
    }
  })));
  if (typeof deps.rememberTeacherIds === 'function') await deps.rememberTeacherIds(chosen.map((t) => t.id)).catch(() => {});
  if (typeof deps.callChecker !== 'function') warnings.push({ code: 'FACT_CHECK_OFF', message: 'ไม่ได้ต่อผู้ตรวจข้อเท็จจริง — ทุกเวอร์ชันยังไม่ได้ตรวจข้อเท็จจริง' });
  if (typeof deps.callReader !== 'function') warnings.push({ code: 'READER_OFF', message: 'ไม่ได้ต่อผู้อ่านจับใจความ — ทุกเวอร์ชันยังไม่ได้ตรวจว่าอ่านรอบเดียวเข้าใจ' });
  for (const v of versions) if (v.stopped) warnings.push({ code: 'REWRITE_STOPPED', message: `เวอร์ชัน ${v.index}: ${v.stopped} — ส่งฉบับที่ดีที่สุดที่เขียนได้พร้อมผลตรวจ` });

  const written = versions.filter((v) => v.content);
  if (written.length === 0) throw fail('ALL_VERSIONS_FAILED', `เขียนไม่สำเร็จทั้ง ${versions.length} เวอร์ชัน: ${versions.map((v) => v.error).filter(Boolean)[0] || 'ไม่ทราบสาเหตุ'}`);
  emit('done', 'done', `${written.length}/${versions.length} เวอร์ชัน`);

  return {
    ok: true,
    title: String(analysis?.title || '').trim().slice(0, 120) || raw.split('\n')[0].slice(0, 80),
    rawText: raw,
    analysis,
    direction: { ok: brief.ok, error: brief.error || '', angles: brief.angles || [] },
    researchFacts,
    versions,
    summary: {
      requested: versions.length,
      written: written.length,
      passed: versions.filter((v) => v.ok).length,
      formPassed: versions.filter((v) => v.formOk).length,
      factChecked: versions.filter((v) => v.factChecked).length,
      readClear: versions.filter((v) => v.readClear).length,
    },
    warnings,
    timings: { ...timings, total: now() - t0 },
  };
}

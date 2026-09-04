/**
 * build-arms.mjs — สร้างไฟล์คลังต่อแขนสำหรับห้องแล็บ A/B (F13 + §6.1 ของแบบ)
 *
 * อ่าน store จริง (read-only) + แผนกลาง 2 ไฟล์ → เขียน:
 *   C:\tmp\news-r233-run\card-arms\A.json        (A = store จริงตามเดิม — ไม่ apply แผน)
 *   C:\tmp\news-r233-run\card-arms\B.json        (B = ใช้แผนทั้งหมด: names→merge→viralScore→surgery→rename→new→sweep→archive)
 *   C:\tmp\news-r233-run\card-arms\C.json        (C = B เหมือนกันทุกไบต์ — ต่างที่ env ENDING_MODE=plain ตอนรัน)
 *   C:\tmp\news-r233-run\card-arms\diff-report.md (ใบไหนเปลี่ยนอะไร + จำนวนต่อกฎกวาด)
 *
 * รูปไฟล์แขน = JSON array ของการ์ดทั้งชุด (สคีมาเดียวกับ data/prompt-library.json) —
 * overlay ห้องแล็บ (F2 ของสาย B: CARD_LIBRARY_LAB=1 + CARD_LIBRARY_OVERLAY_FILE) อ่านไฟล์นี้แทน store
 * deterministic: เรียงใบตาม id + เรียง key ทุกชั้น + ไม่มี timestamp ในไฟล์/รายงาน (input เดิม = ไบต์เดิม)
 *
 * ใช้:
 *   node scripts/card-status/build-arms.mjs [--from <cards.json>] [--plans-dir <dir>]
 *        [--out <dir>] [--sections a,b,...] [--ladder B1|B2|B3] [--no-counts]
 *   --from ไม่ใส่ = อ่านสด createStore('prompt-library').getAll({authoritative:true}) (read-only ·
 *          ฝั่ง Supabase จะ sync mirror data/prompt-library.json ตามพฤติกรรม store เอง)
 *   --ladder ตามบันไดแตกก้อน §6.4: B1=กวาด+viralScore · B2=B1+ผ่าตัด+ชื่อ · B3=B2+พัก
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  RUN_DIR, STORE_NAME, EXPECTED_COUNTS, PLANS_DIR_DEFAULT,
  loadPlans, loadCardsFile, validatePlans, compileSweepPatterns, deriveNewCardId,
  canonicalCardsJson, sha256Hex, jsonEqual, parseCliArgs, isMainModule, printValidation, getRealStore,
} from './plan-schema.mjs';

export const ARMS_OUT_DEFAULT = path.join(RUN_DIR, 'card-arms');
/** ลำดับ apply ตายตัว (อธิบายใน validator: names ก่อน surgery → ชื่อจาก surgery ชนะ · sweep เกือบท้ายสุด = กติกาสถานะสุดท้าย) */
export const SECTION_ORDER = Object.freeze(['names', 'merge', 'viralScore', 'surgery', 'rename', 'new', 'sweep', 'archive']);
/** บันไดแตกก้อน §6.4 — ลงทะเบียนล่วงหน้า ใช้เมื่อ Gate 1 ไม่ผ่าน */
export const LADDER_ARMS = Object.freeze({
  B1: ['sweep', 'viralScore'],
  B2: ['sweep', 'viralScore', 'surgery', 'rename', 'names'],
  B3: ['sweep', 'viralScore', 'surgery', 'rename', 'names', 'archive'],
});
/** createdAt คงที่ของใบใหม่ในไฟล์แขน (ห้ามใช้เวลาจริง — ไฟล์แขนต้อง deterministic) */
export const ARM_FIXED_NOW = '2026-09-03T00:00:00.000Z';

/**
 * แกนกลางของทั้ง build-arms และ migrate — ใช้แผน (ที่ validate+canonicalize แล้ว) กับสำเนาการ์ด
 * @param {object[]} storeCards ไม่ถูกแก้ (ทำงานบน structuredClone)
 * @param {{planCards, planOps}} canonical จาก validatePlans(...).canonical เท่านั้น
 * @param {{mode: 'arm'|'migrate', sections: string[], now: string}} opts
 *   mode 'arm':     archive = ตัดใบออกจากไฟล์แขน (Gate 1 ยังไม่มีตัวกรอง F7 ในแล็บ — ตามแบบ S1)
 *                   ใบใหม่ status='active' (แบบ S1: "ใบใหม่ active ในแล็บ") + createdAt คงที่
 *   mode 'migrate': archive = ตั้ง status:'archived' (ไม่ลบ — F6) · ใบใหม่ status='proposed' + createdAt=now
 * @returns {{cards, changes, removedIds, archivedIds, newCards, sweepStats, sectionCounts}}
 *   changes: [{id, sections, fields: [{field, hadBefore, before, after}]}] เรียงตาม id ·
 *   ใบที่ถูกตัดออก (arm) ไม่อยู่ใน changes — อยู่ใน removedIds
 */
export function applyPlans(storeCards, canonical, { mode = 'arm', sections = SECTION_ORDER, now = ARM_FIXED_NOW } = {}) {
  if (!['arm', 'migrate'].includes(mode)) throw new Error(`mode ไม่ถูกต้อง: ${mode}`);
  const active = new Set(sections);
  for (const s of active) if (!SECTION_ORDER.includes(s)) throw new Error(`ไม่รู้จัก section: ${s} (มี: ${SECTION_ORDER.join(', ')})`);
  const { planCards, planOps } = canonical;

  const originals = [...storeCards].sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => structuredClone(c));
  const cards = originals.map((c) => structuredClone(c));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const touched = new Map(); // id → Set(section)
  const mark = (id, s) => { if (!touched.has(id)) touched.set(id, new Set()); touched.get(id).add(s); };
  const need = (id, section) => {
    const c = byId.get(id);
    if (!c) throw new Error(`${section}: ไม่พบ id ${id} ใน store (แผนต้องผ่าน validatePlans ก่อน)`);
    return c;
  };

  // 1) names (F10 — เปลี่ยนชื่อเชิงกลไกตาม prefix)
  if (active.has('names')) {
    for (const [id, name] of Object.entries(planOps.names || {})) {
      const c = need(id, 'names');
      if (c.promptName !== name) { c.promptName = name; mark(id, 'names'); }
    }
  }
  // 2) merge (F9 data — โอนหมวด)
  if (active.has('merge')) {
    for (const [id, fields] of Object.entries(planOps.merge || {})) {
      const c = need(id, 'merge');
      for (const [f, v] of Object.entries(fields)) {
        if (!jsonEqual(c[f], v)) { c[f] = structuredClone(v); mark(id, 'merge'); }
      }
    }
  }
  // 3) viralScore (F3 — remap 19 ใบที่มีโพสต์จริง)
  if (active.has('viralScore')) {
    for (const [id, score] of Object.entries(planOps.viralScoreRemap || {})) {
      const c = need(id, 'viralScore');
      if (c.viralScore !== score) { c.viralScore = score; mark(id, 'viralScore'); }
    }
  }
  // 4) surgery (F4 — เขียนมือทับ field ทั้งก้อน · ชนะ names/merge สำหรับ field ที่ตั้ง)
  if (active.has('surgery')) {
    for (const [id, fields] of Object.entries(planCards.surgery || {})) {
      const c = need(id, 'surgery');
      for (const [f, v] of Object.entries(fields)) {
        if (!jsonEqual(c[f], v)) { c[f] = structuredClone(v); mark(id, 'surgery'); }
      }
    }
  }
  // 5) rename (F5 — ชื่อใหม่ + เขียนท่อนเปิด 600 ตัวแรกแทนของเดิมถึง replaceUntil · idempotent)
  if (active.has('rename')) {
    for (const [id, r] of Object.entries(planCards.rename || {})) {
      const c = need(id, 'rename');
      if (c.promptName !== r.promptName) { c.promptName = r.promptName; mark(id, 'rename'); }
      const text = String(c.promptText ?? '');
      if (!text.startsWith(r.promptTextHead)) {
        const idx = text.indexOf(r.replaceUntil);
        if (idx < 0) throw new Error(`rename ${id}: ไม่พบ replaceUntil ใน promptText — apply ไม่ได้`);
        c.promptText = r.promptTextHead + text.slice(idx + r.replaceUntil.length);
        mark(id, 'rename');
      }
    }
  }
  // 6) ใบใหม่ (F8) — id deterministic จาก promptName (แล็บกับ import จริงได้ id เดียวกัน → เทียบ log ได้)
  const newCards = [];
  if (active.has('new')) {
    for (const nc of planCards.newCards || []) {
      const id = deriveNewCardId(nc.promptName);
      const exist = byId.get(id);
      if (exist) {
        if (exist.promptName === nc.promptName) continue; // apply ซ้ำรอบสอง — ข้าม (idempotent)
        throw new Error(`newCards: id ${id} ชนกับใบอื่นใน store (${exist.promptName})`);
      }
      const card = { id, ...structuredClone(nc), createdAt: now, status: mode === 'arm' ? 'active' : 'proposed' };
      cards.push(card);
      byId.set(id, card);
      newCards.push({ id, card });
      mark(id, 'new');
    }
  }
  // 7) sweep (F3 — กติกาสถานะสุดท้ายทั้งคลัง รวมใบผ่าตัด/ใบใหม่)
  const sweepStats = { ctaStyle: 0, rules: [] };
  if (active.has('sweep') && planOps.sweep) {
    const sweep = planOps.sweep;
    const compiled = compileSweepPatterns(sweep);
    const rules = [];
    const perCardRules = [];
    for (const [group, field] of [['promptText', 'promptText'], ['structure', 'structure'], ['emotionalArcClose', 'emotionalArc.close'], ['dnaTemplate', 'dnaTemplate.*']]) {
      for (const { source, re } of compiled[group]) rules.push({ group, field, source, re, cards: 0 });
    }
    for (const c of cards) {
      if (typeof sweep.ctaStyle === 'string' && c.ctaStyle !== sweep.ctaStyle) {
        c.ctaStyle = sweep.ctaStyle;
        sweepStats.ctaStyle += 1;
        mark(c.id, 'sweep');
      }
      for (const rule of rules) {
        let changed = false;
        if (rule.group === 'promptText' || rule.group === 'structure') {
          const f = rule.group;
          if (typeof c[f] === 'string') {
            const nv = c[f].replace(rule.re, '');
            if (nv !== c[f]) { c[f] = nv; changed = true; }
          }
        } else if (rule.group === 'emotionalArcClose') {
          if (c.emotionalArc && typeof c.emotionalArc.close === 'string') {
            const nv = c.emotionalArc.close.replace(rule.re, '');
            if (nv !== c.emotionalArc.close) { c.emotionalArc.close = nv; changed = true; }
          }
        } else if (rule.group === 'dnaTemplate') {
          if (c.dnaTemplate && typeof c.dnaTemplate === 'object') {
            for (const [k, v] of Object.entries(c.dnaTemplate)) {
              if (typeof v !== 'string') continue;
              const nv = v.replace(rule.re, '');
              if (nv !== v) { c.dnaTemplate[k] = nv; changed = true; }
            }
          }
        }
        if (changed) { rule.cards += 1; mark(c.id, 'sweep'); }
      }
      // per-card (ส่วนขยายจากแผน ops จริง): ลบเฉพาะใบ หลัง regex กลางทุกตัว · เรียงตามลำดับ array ในแผน
      for (const pc of compiled.perCardPromptText[c.id] || []) {
        if (typeof c.promptText !== 'string') continue;
        const nv = c.promptText.replace(pc.re, '');
        if (nv !== c.promptText) {
          c.promptText = nv;
          mark(c.id, 'sweep');
          perCardRules.push({ group: 'perCardPromptText', field: `promptText@${c.id}`, source: pc.source, cards: 1 });
        } else {
          perCardRules.push({ group: 'perCardPromptText', field: `promptText@${c.id}`, source: pc.source, cards: 0 });
        }
      }
    }
    sweepStats.rules = [
      ...rules.map(({ group, field, source, cards: n }) => ({ group, field, source, cards: n })),
      ...perCardRules.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : a.source < b.source ? -1 : 1)),
    ];
  }
  // 8) archive (F6)
  const removedIds = [];
  const archivedIds = [];
  if (active.has('archive')) {
    for (const id of planOps.archive || []) {
      need(id, 'archive');
      if (mode === 'arm') {
        removedIds.push(id); // Gate 1 ในแล็บยังไม่มีตัวกรอง F7 — ต้องตัดออกจากไฟล์แขนจริงๆ (แบบ S1)
      } else {
        const c = byId.get(id);
        if (c.status !== 'archived') { c.status = 'archived'; mark(id, 'archive'); }
        archivedIds.push(id);
      }
    }
  }
  const removedSet = new Set(removedIds);
  const outCards = mode === 'arm' && removedIds.length ? cards.filter((c) => !removedSet.has(c.id)) : cards;

  // diff ต่อใบ (เทียบต้นฉบับ — ใบที่ถูกตัดออกไม่อยู่ใน changes)
  const changes = [];
  for (const orig of originals) {
    if (removedSet.has(orig.id)) continue;
    const cur = byId.get(orig.id);
    const fields = [];
    for (const f of [...new Set([...Object.keys(orig), ...Object.keys(cur)])].sort()) {
      const hadBefore = f in orig;
      const hasAfter = f in cur;
      if (hadBefore && hasAfter && jsonEqual(orig[f], cur[f])) continue;
      fields.push({ field: f, hadBefore, before: hadBefore ? orig[f] : undefined, after: hasAfter ? cur[f] : undefined });
    }
    if (fields.length) changes.push({ id: orig.id, sections: [...(touched.get(orig.id) || [])].sort(), fields });
  }

  const sectionCounts = {};
  for (const s of SECTION_ORDER) sectionCounts[s] = 0;
  for (const [id, set] of touched) {
    if (removedSet.has(id)) continue;
    for (const s of set) sectionCounts[s] += 1;
  }
  sectionCounts.archive = mode === 'arm' ? removedIds.length : archivedIds.length;
  sectionCounts.new = newCards.length;

  return {
    cards: outCards,
    changes,
    removedIds: [...removedIds].sort(),
    archivedIds: [...archivedIds].sort(),
    newCards: [...newCards].sort((a, b) => (a.id < b.id ? -1 : 1)),
    sweepStats,
    sectionCounts,
  };
}

// ── รายงาน ───────────────────────────────────────────────────────────────────
const snip = (v, n = 90) => {
  const s = v === undefined ? '(ไม่มี field)' : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…(${s.length})` : s;
};

export function formatChangeLines(changes, { maxLen = 90 } = {}) {
  const lines = [];
  for (const ch of changes) {
    lines.push(`### ${ch.id} — ${ch.sections.join('+')}`);
    for (const f of ch.fields) lines.push(`- ${f.field}: ${snip(f.before, maxLen)} → ${snip(f.after, maxLen)}`);
  }
  return lines;
}

export function buildDiffReport({ sourceLabel, storeCount, applied, validation, sections, shas, armShas }) {
  const L = [];
  L.push('# diff-report — ไฟล์คลังต่อแขน A/B/C (คลังการ์ด v2 · F13)');
  L.push('');
  L.push(`- store ต้นทาง: ${sourceLabel} · ${storeCount} ใบ`);
  L.push(`- แผน: plan-cards sha256=${shas.planCards} · plan-ops sha256=${shas.planOps}`);
  L.push(`- sections ที่ใช้: ${sections.join(', ')}`);
  L.push(`- sha256 ไฟล์แขน: A=${armShas.A} · B=${armShas.B} · C=${armShas.C} (C ต้องเท่า B ไบต์ต่อไบต์ — ต่างที่ env ENDING_MODE ตอนรัน)`);
  L.push('');
  L.push('## สรุปจำนวน');
  L.push('');
  L.push('| ส่วน | ในแผน | แตะจริง |');
  L.push('|---|---|---|');
  const c = validation.counts;
  const sc = applied.sectionCounts;
  L.push(`| surgery (F4) | ${c.surgery} | ${sc.surgery} ใบ |`);
  L.push(`| rename (F5) | ${c.rename} | ${sc.rename} ใบ |`);
  L.push(`| names (F10) | ${c.names} | ${sc.names} ใบ |`);
  L.push(`| merge (F9) | ${c.merge} | ${sc.merge} ใบ |`);
  L.push(`| viralScoreRemap (F3) | ${c.viralScoreRemap} | ${sc.viralScore} ใบ |`);
  L.push(`| archive (F6) | ${c.archive} | ${sc.archive} ใบ (ตัดออกจากไฟล์แขน) |`);
  L.push(`| ใบใหม่ (F8) | ${c.newCards} | ${sc.new} ใบ (status active ในแขน) |`);
  L.push(`| กวาด (F3 sweep) | - | ${sc.sweep} ใบ |`);
  L.push('');
  L.push('## การกวาด F3 รายกฎ');
  L.push('');
  L.push(`- ctaStyle → '' : ${applied.sweepStats.ctaStyle} ใบ`);
  if (applied.sweepStats.rules.length === 0) L.push('- (ไม่มี pattern ในแผน)');
  for (const r of applied.sweepStats.rules) L.push(`- ${r.field} ~ /${r.source}/g : ${r.cards} ใบ`);
  L.push('');
  L.push(`## ใบที่ถูกตัดออกจากแขน B (archive ${applied.removedIds.length} ใบ)`);
  L.push('');
  L.push(applied.removedIds.length ? applied.removedIds.join(' · ') : '(ไม่มี)');
  L.push('');
  L.push(`## ใบใหม่ในแขน B (${applied.newCards.length} ใบ)`);
  L.push('');
  for (const nc of applied.newCards) L.push(`- ${nc.id} ← ${JSON.stringify(nc.card.promptName)} (${nc.card.category})`);
  if (!applied.newCards.length) L.push('(ไม่มี)');
  L.push('');
  L.push(`## รายใบ (${applied.changes.length} ใบที่เนื้อเปลี่ยน · เรียงตาม id · ค่าตัดที่ 90 ตัวอักษร)`);
  L.push('');
  L.push(...formatChangeLines(applied.changes));
  L.push('');
  return `${L.join('\n')}\n`;
}

/** สร้างสตริงไฟล์แขนทั้งสาม + รายงาน — pure (เทสได้โดยไม่แตะดิสก์/store) */
export function buildArms(storeCards, plans, { sections = SECTION_ORDER, expectedCounts = EXPECTED_COUNTS, sourceLabel = 'store', shas = { planCards: '-', planOps: '-' } } = {}) {
  const validation = validatePlans(plans, storeCards, { expectedCounts });
  if (!validation.ok) {
    const err = new Error(`แผนไม่ผ่าน validator:\n${validation.errors.map((e) => `  - ${e}`).join('\n')}`);
    err.validation = validation;
    throw err;
  }
  const applied = applyPlans(storeCards, validation.canonical, { mode: 'arm', sections, now: ARM_FIXED_NOW });
  const A = canonicalCardsJson(storeCards);
  const B = canonicalCardsJson(applied.cards);
  const C = B; // C = B ไบต์ต่อไบต์ (ต่างที่ ENDING_MODE=plain ตอนรันผ่าน set-arm card-C)
  const armShas = { A: sha256Hex(A), B: sha256Hex(B), C: sha256Hex(C) };
  const report = buildDiffReport({ sourceLabel, storeCount: storeCards.length, applied, validation, sections, shas, armShas });
  return { files: { A, B, C, report }, armShas, applied, validation };
}

// ── main ─────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  try {
    const args = parseCliArgs(process.argv.slice(2), {
      flags: ['--no-counts'],
      options: ['--from', '--plans-dir', '--out', '--sections', '--ladder'],
    });
    let sections = SECTION_ORDER;
    if (args.ladder) {
      if (!LADDER_ARMS[args.ladder]) throw new Error(`ไม่รู้จักบันได: ${args.ladder} (มี ${Object.keys(LADDER_ARMS).join(', ')})`);
      sections = LADDER_ARMS[args.ladder];
    }
    if (args.sections) sections = args.sections.split(',').map((s) => s.trim()).filter(Boolean);

    let storeCards;
    let sourceLabel;
    if (args.from) {
      const p = path.resolve(args.from);
      storeCards = loadCardsFile(p);
      sourceLabel = p;
    } else {
      const { store, supabaseMode } = await getRealStore({ allowFileStore: true }); // อ่านอย่างเดียว
      storeCards = await store.getAll({ authoritative: true });
      sourceLabel = supabaseMode ? `createStore('${STORE_NAME}') authoritative (Supabase)` : `createStore('${STORE_NAME}') authoritative (file fallback)`;
      console.log(`อ่าน store สด: ${storeCards.length} ใบ (${supabaseMode ? 'Supabase' : 'file'})`);
    }
    if (!storeCards.length) throw new Error('store ว่าง — น่าจะชี้ผิดที่ ไม่สร้างไฟล์แขนต่อ');

    const plansDir = args['plans-dir'] ? path.resolve(args['plans-dir']) : PLANS_DIR_DEFAULT;
    const plans = loadPlans(plansDir);
    const outDir = args.out ? path.resolve(args.out) : ARMS_OUT_DEFAULT;
    if (args['no-counts']) console.warn('⚠️ ข้ามการตรวจจำนวนตามแบบ (--no-counts)');

    const { files, armShas, applied, validation } = buildArms(storeCards, plans, {
      sections,
      expectedCounts: args['no-counts'] ? null : EXPECTED_COUNTS,
      sourceLabel,
      shas: plans.shas,
    });
    printValidation(validation);

    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of [['A.json', files.A], ['B.json', files.B], ['C.json', files.C], ['diff-report.md', files.report]]) {
      fs.writeFileSync(path.join(outDir, name), content, 'utf8');
    }
    const nA = JSON.parse(files.A).length;
    const nB = JSON.parse(files.B).length;
    console.log(`✅ เขียนไฟล์แขนที่ ${outDir}`);
    console.log(`   A=${nA} ใบ sha=${armShas.A.slice(0, 12)} · B=${nB} ใบ sha=${armShas.B.slice(0, 12)} · C=B ${armShas.B === armShas.C ? '(ไบต์ตรงกัน ✓)' : '(‼️ ไม่ตรง — บั๊ก)'}`);
    console.log(`   เปลี่ยน ${applied.changes.length} ใบ · ตัดออก ${applied.removedIds.length} · ใบใหม่ ${applied.newCards.length} · ดูรายละเอียดใน diff-report.md`);
    console.log('   ตั้งแขนรัน: node set-arm.mjs card-A|card-B|card-C (card-C = ไฟล์ B + ENDING_MODE=plain)');
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}

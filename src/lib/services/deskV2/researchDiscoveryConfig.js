/**
 * ============================================================
 * 🎛️ Research Discovery Config (เฟส 0) — ศูนย์รวมสวิตช์ + เป้าหมายของ "ชั้นค้นหาใหม่" (Discovery V2)
 * ============================================================
 * 🔴 pure JS + ไม่มี import ใดๆ (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/ — ตามแพตเทิร์น deskV2)
 * 🔴 ทุก flag default '0' (ปิด). MASTER ปิด = ทุกฟีเจอร์ปิด → เครื่องค้นหาทำงาน "เหมือนเดิมเป๊ะ"
 * 🔴 ไม่ hard-code จำนวนใน store (292/294 ฯลฯ) — ใช้ BASELINE_VERSION อ้างอิงแทน
 * 🔴 ไม่มี secret/key ในไฟล์นี้ → getPublicDiscoveryConfig() ปลอดภัยพอส่งให้ UI อ่าน
 *
 * feature จะ "มีผลจริง" เมื่อ MASTER + feature เปิดครบเท่านั้น:
 *     effective = DESK_V2_DISCOVERY_V2 === '1' && DESK_V2_<FEATURE> === '1'
 * แหล่งข่าวใหม่ต้องเปิดครบ 3 ชั้น: MASTER + DESK_V2_SOURCE_EXPANSION + DESK_V2_SOURCE_<X>
 * (เฟส 0 แค่ "อ่าน config" — ยังไม่มีใครเรียกให้เปลี่ยนพฤติกรรม จนกว่าเฟสถัดไปจะ wire เข้า)
 */

export const MASTER_FLAG = 'DESK_V2_DISCOVERY_V2';
export const BASELINE_VERSION = 'seed-2026-07-19'; // ชุด seed จากคลิปพนักงานจริง (Meta 45/TikTok 29/YouTube 26)

// ── helper: อ่าน env อย่างปลอดภัย ──────────────────────────────
function isOn(env, name) {
  return String(env && env[name] != null ? env[name] : '') === '1';
}
function numOf(env, name, def, min, max) {
  const raw = env && env[name] != null ? Number(env[name]) : NaN;
  const n = Number.isFinite(raw) ? raw : def;
  const lo = min == null ? -Infinity : min;
  const hi = max == null ? Infinity : max;
  return Math.min(hi, Math.max(lo, n));
}
// อ่านว่า env สั่ง "ปิด" ชัดเจนไหม ('0') — ใช้เป็น kill-switch ของ flag ที่ default=ON
function isOff(env, name) {
  return String(env && env[name] != null ? env[name] : '') === '0';
}

// 5 ปุ่ม preset สำหรับ UI (ใช้จริงเฟส 8) — ตรงกับหมวดที่พนักงานเลือกถอดจริง (production clip-insights)
export const DISCOVERY_PRESETS = [
  { id: 'interview', label: 'คลิปสัมภาษณ์คนดัง', categoryKey: 'บันเทิง/ดารา', lane: 'interview', targetPct: 40, primary: true },
  { id: 'kindness', label: 'ข่าวน้ำดี/ช่วยเหลือ', categoryKey: 'น้ำใจ/ทำดี', lane: 'dna', targetPct: 28 },
  { id: 'society', label: 'ชีวิตคน/สังคม', categoryKey: 'สังคม/ชีวิตคน', lane: 'dna', targetPct: 25 },
  { id: 'lifestyle', label: 'ไลฟ์สไตล์/ไวรัล', categoryKey: 'ไลฟ์สไตล์/ไวรัล', lane: 'dna', targetPct: 5 },
  { id: 'economy', label: 'เศรษฐกิจ (ทดลอง)', categoryKey: 'อื่นๆ', lane: 'dna', targetPct: 2, experimental: true },
];

/**
 * getDiscoveryConfig — อ่าน env → config เต็ม (ฝั่ง server ใช้)
 * @param {object} [env=process.env]
 */
export function getDiscoveryConfig(env = process.env) {
  const e = env || {};
  // 🟢 canary 20 ก.ค. 69 (ผู้ใช้สั่งเปิดชุดปลอดภัย): master + ชุดปลอดภัย default=ON, ปิดได้ด้วย env=0 (kill-switch)
  //   ยัง default=OFF (ต้อง env=1): interviewLane (รอแก้ F3-F5), sourceExpansion+sources (มีค่า Serper)
  const masterOn = !isOff(e, MASTER_FLAG);                  // เปิด default, kill ด้วย DESK_V2_DISCOVERY_V2=0
  const featOn = (name) => masterOn && !isOff(e, name);     // 🟢 canary: เปิด default (ปิดด้วย env=0)
  const featStrict = (name) => masterOn && isOn(e, name);   // 🔴 ปิด default (เปิดด้วย env=1)
  const sourceExpansionOn = featStrict('DESK_V2_SOURCE_EXPANSION');
  const source = (name) => sourceExpansionOn && isOn(e, name); // แหล่งเปิดได้ต่อเมื่อ expansion เปิดด้วย

  return {
    schemaVersion: 2,
    baselineVersion: BASELINE_VERSION,
    masterOn,
    flags: {
      // 🟢 ชุดปลอดภัย — canary เปิด default (kill ด้วย env=0)
      reels: featOn('DESK_V2_REELS'),
      diversity: featOn('DESK_V2_DIVERSITY'),
      queryPlanner: featOn('DESK_V2_QUERY_PLANNER'),
      storyGrouping: featOn('DESK_V2_STORY_GROUPING'),
      highlightConfirm: featOn('DESK_V2_HIGHLIGHT_CONFIRM'),
      researchUiV2: featOn('DESK_V2_RESEARCH_UI_V2'),
      virtualThemes: featOn('DESK_V2_VIRTUAL_THEMES'),
      // 🔴 ยังปิด default — ต้อง env=1 (interviewLane รอ F3-F5 · sourceExpansion มีค่า Serper)
      sourceExpansion: sourceExpansionOn,
      interviewLane: featStrict('DESK_V2_INTERVIEW_LANE'),
    },
    sources: {
      serperNews: source('DESK_V2_SOURCE_SERPER_NEWS'),
      googleNewsRss: source('DESK_V2_SOURCE_GOOGLE_NEWS_RSS'),
      directRss: source('DESK_V2_SOURCE_DIRECT_RSS'),
      youtubeWatch: source('DESK_V2_SOURCE_YOUTUBE_WATCH'),
      instagram: source('DESK_V2_SOURCE_INSTAGRAM'),
    },
    // เป้าหมายสัดส่วน (ใช้วัด drift/แบ่งโควตาในเฟสถัดไป) — มาจากไกด์คลิปพนักงานจริง
    targets: {
      platformPct: { meta: 45, tiktok: 29, youtube: 26 },
      categoryPct: {
        'บันเทิง/ดารา': 40,
        'น้ำใจ/ทำดี': 28,
        'สังคม/ชีวิตคน': 25,
        'ไลฟ์สไตล์/ไวรัล': 5,
        'อื่นๆ': 2,
      },
    },
    budget: {
      maxSerperCalls: numOf(e, 'DESK_V2_MAX_SERPER_CALLS', 80, 1, 1000),
    },
    interview: {
      peoplePerRound: numOf(e, 'DESK_V2_INTERVIEW_PEOPLE_PER_ROUND', 6, 1, 27),
      variantsPerPerson: numOf(e, 'DESK_V2_INTERVIEW_VARIANTS_PER_PERSON', 2, 1, 6),
      maxCalls: numOf(e, 'DESK_V2_INTERVIEW_MAX_CALLS', 70, 1, 500),
    },
    // อายุข่าวสูงสุดต่อแหล่ง (วัน) — ใช้เฟส 4
    freshnessDays: {
      directRss: 3,
      serperNews: 7,
      googleNewsRss: 7,
      youtubeWatch: 21,
      interview: 45,
    },
  };
}

/**
 * getPublicDiscoveryConfig — ชุดย่อยปลอดภัยสำหรับ UI (capability + presets เท่านั้น ไม่มีงบ/ตัวเลขภายใน)
 * @param {object} [env=process.env]
 */
export function getPublicDiscoveryConfig(env = process.env) {
  const c = getDiscoveryConfig(env);
  return {
    schemaVersion: c.schemaVersion,
    masterOn: c.masterOn,
    flags: c.flags,
    presets: DISCOVERY_PRESETS,
  };
}

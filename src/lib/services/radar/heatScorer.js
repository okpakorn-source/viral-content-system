/**
 * heatScorer.js — คำนวณคะแนนความร้อนแรง (Heat Score) และศักยภาพการ Rewrite
 * [Radar-HeatScorer]
 */

// === รายชื่อคนดังไทยสำหรับตรวจจับ (50+) ===
const CELEBRITY_NAMES = [
  // นักแสดง
  'เบลล่า', 'อั้ม', 'ณเดชน์', 'ญาญ่า', 'มาริโอ้', 'ใหม่', 'ดาวิกา',
  'เต้ย', 'จันจิ', 'แมท', 'ภูผา', 'พีช', 'เบนซ์', 'ปุ๊กลุก',
  'แพท', 'เชียร์', 'มิน', 'ทับทิม', 'แอน', 'เจมส์จิ',
  // พิธีกร/ตลก
  'หม่ำ', 'หนุ่ม', 'กรรชัย', 'สรยุทธ', 'กอล์ฟ', 'เท่ง', 'โหน่ง',
  'บุ๊คโกะ', 'ป๋อมแป๋ม', 'โน้ส', 'ตั๊ก', 'ตุ๊ก',
  // นักร้อง
  'เบิร์ด', 'ป้าง', 'แสตมป์', 'ปาล์มมี่', 'ลิซ่า', 'บิวกิ้น',
  'แบมแบม', 'มิลลิ', 'นุนิว', 'ออฟ', 'กัน', 'วิน',
  // การเมือง
  'ทักษิณ', 'พิธา', 'ประยุทธ์', 'อนุทิน', 'เศรษฐา', 'แพทองธาร',
  // อื่นๆ
  'เอวา', 'แตงค์', 'ลุงพล', 'ป้าแต๋น', 'หมอปลา', 'อดัม',
  'ชมพู่', 'ปอ', 'แตงโม', 'หลวงปู่', 'หลวงพ่อ',
];

// === คำกระตุ้นอารมณ์ ===
const EMOTIONAL_KEYWORDS = [
  // ช็อก/ตกใจ
  'ช็อค', 'ช็อก', 'ตกใจ', 'สะเทือน', 'ระทึก', 'หวิด', 'พลิก',
  // เศร้า/สูญเสีย
  'สลด', 'สูญเสีย', 'เสียชีวิต', 'จากไป', 'เศร้า', 'ร้องไห้', 'น้ำตา',
  // ซึ้ง/ประทับใจ
  'ประทับใจ', 'น่ารัก', 'กตัญญู', 'ซึ้ง', 'ตื้นตัน', 'อบอุ่น', 'หัวใจ',
  // โกรธ/ดราม่า
  'เดือด', 'โกรธ', 'ดราม่า', 'สุดทน', 'ไม่ยอม', 'เหลือเชื่อ', 'อุกอาจ',
  // ช่วยเหลือ
  'บริจาค', 'ช่วยเหลือ', 'เปิดรับ', 'สมทบ', 'น้ำใจ',
  // กลัว/อันตราย
  'อันตราย', 'เตือนภัย', 'ระวัง', 'หลอก', 'ต้มตุ๋น', 'มิจฉาชีพ',
];

// === คำบ่งชี้ความขัดแย้ง ===
const CONFLICT_KEYWORDS = [
  'ทะเลาะ', 'ขัดแย้ง', 'ฟ้อง', 'เอาผิด', 'เตือน', 'แฉ', 'หลอก',
  'โกง', 'จับ', 'รวบ', 'ดำเนินคดี', 'แจ้งความ',
];

/**
 * คำนวณ Heat Score (ความร้อนแรง) ของ cluster 0-100
 * @param {object} cluster - cluster object จาก newsClusterer
 * @returns {number} คะแนน 0-100
 */
export function calculateHeatScore(cluster) {
  try {
    if (!cluster) return 0;

    let score = 0;
    const title = cluster.mainTitle || '';
    const summary = cluster.summary || '';
    const fullText = `${title} ${summary}`;

    // 1. Recency (25%) — ข่าวใหม่แค่ไหน
    const newestDate = cluster.newestPublishedAt ? new Date(cluster.newestPublishedAt) : null;
    if (newestDate && !isNaN(newestDate)) {
      const hoursSince = (Date.now() - newestDate.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 4) score += 25;
      else if (hoursSince < 12) score += 20;
      else if (hoursSince < 24) score += 15;
      else if (hoursSince < 48) score += 10;
      else if (hoursSince < 72) score += 5;
      else score += 2;
    } else {
      score += 2; // ไม่มีวันที่ = ให้คะแนนต่ำ
    }

    // 2. Multi-source (20%) — หลายแหล่งยืนยัน
    const sourceCount = cluster.sourceCount || 1;
    if (sourceCount >= 5) score += 20;
    else if (sourceCount >= 3) score += 15;
    else if (sourceCount >= 2) score += 10;
    else score += 5;

    // 3. Celebrity (15%) — มีคนดังเกี่ยวข้อง
    let celebMatches = 0;
    for (const name of CELEBRITY_NAMES) {
      if (fullText.includes(name)) celebMatches++;
    }
    if (celebMatches >= 1) score += 15;
    else if (fullText.match(/[ก-๙]{2,}/) && celebMatches > 0) score += 8;

    // 4. Emotional (15%) — มีคำกระตุ้นอารมณ์
    let emotionMatches = 0;
    for (const keyword of EMOTIONAL_KEYWORDS) {
      if (fullText.includes(keyword)) emotionMatches++;
    }
    if (emotionMatches >= 3) score += 15;
    else if (emotionMatches >= 2) score += 10;
    else if (emotionMatches >= 1) score += 5;

    // 5. Social/Discussion potential (10%) — มีศักยภาพถกเถียง
    const hasQuestion = /\?|ไหม|หรือเปล่า|ใช่ไหม|จริงหรือ/.test(fullText);
    if (hasQuestion) score += 5;

    let hasConflict = false;
    for (const word of CONFLICT_KEYWORDS) {
      if (fullText.includes(word)) { hasConflict = true; break; }
    }
    if (hasConflict) score += 5;

    // 6. Visual (10%) — มีรูปภาพ/วิดีโอ
    const hasVideo = /youtube|youtu\.be|tiktok|วิดีโอ|คลิป/.test(fullText) ||
                     (cluster.bestSourceUrl || '').match(/youtube|tiktok/);
    if (hasVideo) score += 10;
    else if (cluster.imageUrl) score += 5;

    // 7. Novelty (5%) — ความใหม่ของหัวข้อ
    // เช็คแบบเบื้องต้น: ถ้า newestPublishedAt อยู่ใน 24 ชม. ถือว่าใหม่
    if (newestDate && !isNaN(newestDate)) {
      const hoursSince = (Date.now() - newestDate.getTime()) / (1000 * 60 * 60);
      score += hoursSince < 24 ? 5 : 2;
    } else {
      score += 2;
    }

    return Math.min(Math.round(score), 100);
  } catch (err) {
    console.error('[Radar-HeatScorer] คำนวณ Heat Score ล้มเหลว:', err.message);
    return 0;
  }
}

/**
 * คำนวณ Rewrite Potential Score (ศักยภาพในการ Rewrite) ของ cluster 0-100
 * @param {object} cluster - cluster object จาก newsClusterer
 * @returns {number} คะแนน 0-100
 */
export function calculateRewriteScore(cluster) {
  try {
    if (!cluster) return 0;

    let score = 0;
    const title = cluster.mainTitle || '';
    const summary = cluster.summary || '';
    const fullText = `${title} ${summary}`;

    // 1. มีเรื่องราวชัดเจน (title ยาวพอ) — +20
    if (title.length > 30) score += 20;
    else if (title.length > 15) score += 10;

    // 2. มีรายละเอียดเพียงพอ (summary ยาวพอ) — +20
    if (summary.length > 100) score += 20;
    else if (summary.length > 50) score += 10;

    // 3. มีรูปภาพ — +15
    if (cluster.imageUrl) score += 15;

    // 4. มีหลายแหล่ง (ตรวจสอบข้อเท็จจริงได้) — +15
    const sourceCount = cluster.sourceCount || 1;
    if (sourceCount >= 2) score += 15;
    else if (sourceCount >= 1) score += 7;

    // 5. มีมุมอารมณ์ — +15
    let hasEmotion = false;
    for (const keyword of EMOTIONAL_KEYWORDS) {
      if (fullText.includes(keyword)) { hasEmotion = true; break; }
    }
    if (hasEmotion) score += 15;

    // 6. แหล่งน่าเชื่อถือ (Tier A/B) — +15
    if (Array.isArray(cluster.sources) && cluster.sources.length > 0) {
      // ใช้ import แบบ dynamic เพราะอาจจะ circular — ใช้ simple check แทน
      const topDomains = [
        'thairath.co.th', 'dailynews.co.th', 'khaosod.co.th', 'matichon.co.th',
        'thaipbs.or.th', 'bangkokpost.com', 'pptvhd36.com', 'nationtv.tv',
        'thestandard.co', 'amarintv.com', 'prachachat.net', 'mcot.net',
      ];
      const hasTopSource = cluster.sources.some(s =>
        topDomains.some(d => (s.domain || '').includes(d))
      );
      if (hasTopSource) score += 15;
      else score += 5;
    }

    return Math.min(Math.round(score), 100);
  } catch (err) {
    console.error('[Radar-HeatScorer] คำนวณ Rewrite Score ล้มเหลว:', err.message);
    return 0;
  }
}

/**
 * duplicateDetector.js — ตรวจจับข่าวซ้ำ/ข่าวคล้ายกัน
 * ใช้ n-gram Jaccard + domain match + date proximity + entity overlap
 * [Radar-DuplicateDetector]
 */

// === n-gram helpers สำหรับภาษาไทย ===

/**
 * สร้าง bigrams จากข้อความ (2-char ngrams เหมาะกับภาษาไทย)
 * @param {string} text
 * @returns {Set<string>}
 */
function bigrams(text) {
  if (!text || typeof text !== 'string') return new Set();
  const clean = text.replace(/[\s\n.,!?ๆ""''「」『』()（）【】\[\]{}]+/g, '');
  const grams = new Set();
  for (let i = 0; i < clean.length - 1; i++) {
    grams.add(clean.slice(i, i + 2));
  }
  return grams;
}

/**
 * คำนวณ Jaccard coefficient ระหว่าง 2 sets
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number} 0-1
 */
function jaccard(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * ดึง entity จากข้อความ — ตัวเลข + คำนามเฉพาะภาษาไทย
 * @param {string} text
 * @returns {Set<string>}
 */
function extractEntities(text) {
  if (!text || typeof text !== 'string') return new Set();
  const entities = new Set();

  // ดึงตัวเลขที่มีความหมาย (อายุ, จำนวนเงิน, ฯลฯ)
  const numbers = text.match(/\d[\d,.]*/g) || [];
  numbers.forEach(n => entities.add(n.replace(/,/g, '')));

  // ดึงชื่อเฉพาะภาษาไทย (คำที่ขึ้นต้นด้วย นาย/นาง/นางสาว/ด.ช./ด.ญ.)
  const thaiNames = text.match(/(?:นาย|นาง|นางสาว|ด\.ช\.|ด\.ญ\.|พ\.ต\.อ\.|พ\.ต\.ท\.|ร\.ต\.อ\.)\s*[ก-๙]+/g) || [];
  thaiNames.forEach(n => entities.add(n.trim()));

  // ดึงชื่อสถานที่ (จ./อ./ต.)
  const places = text.match(/(?:จ\.|อ\.|ต\.)\s*[ก-๙]+/g) || [];
  places.forEach(p => entities.add(p.trim()));

  return entities;
}

/**
 * ดึง domain จาก URL
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

/**
 * คำนวณความคล้ายกันระหว่างบทความ 2 ชิ้น
 * @param {object} a - บทความ A
 * @param {object} b - บทความ B
 * @returns {number} คะแนนความคล้าย 0-1
 */
export function calculateSimilarity(a, b) {
  try {
    let score = 0;

    // 1. Title similarity (weight 0.5) — Jaccard bigrams
    const titleSimA = bigrams(a.title || '');
    const titleSimB = bigrams(b.title || '');
    const titleScore = jaccard(titleSimA, titleSimB);
    score += titleScore * 0.5;

    // 2. Domain match (weight 0.1) — domain เดียวกัน = เป็นข่าวเดียวกัน
    const domainA = extractDomain(a.url || a.link || '');
    const domainB = extractDomain(b.url || b.link || '');
    if (domainA && domainB && domainA === domainB) {
      score += 0.1;
    }

    // 3. Date proximity (weight 0.2) — อยู่ใน 24 ชม. = มีโอกาสเป็นข่าวเดียวกัน
    const dateA = a.publishedAt ? new Date(a.publishedAt) : null;
    const dateB = b.publishedAt ? new Date(b.publishedAt) : null;
    if (dateA && dateB && !isNaN(dateA) && !isNaN(dateB)) {
      const diffHours = Math.abs(dateA - dateB) / (1000 * 60 * 60);
      if (diffHours <= 24) {
        score += 0.2;
      } else if (diffHours <= 48) {
        score += 0.1;
      } else if (diffHours <= 72) {
        score += 0.05;
      }
    }

    // 4. Entity overlap (weight 0.2) — ตัวเลข + ชื่อเฉพาะตรงกัน
    const fullTextA = `${a.title || ''} ${a.summary || a.snippet || ''}`;
    const fullTextB = `${b.title || ''} ${b.summary || b.snippet || ''}`;
    const entitiesA = extractEntities(fullTextA);
    const entitiesB = extractEntities(fullTextB);
    const entityScore = jaccard(entitiesA, entitiesB);
    score += entityScore * 0.2;

    return Math.min(score, 1);
  } catch (err) {
    console.error('[Radar-DuplicateDetector] คำนวณ similarity ล้มเหลว:', err.message);
    return 0;
  }
}

/**
 * ตรวจจับบทความที่ซ้ำกันจาก array ของบทความ
 * @param {Array<object>} articles - รายการบทความทั้งหมด
 * @returns {{ pairs: Array<{i: number, j: number, similarity: number}>, duplicateIndices: Set<number> }}
 */
export function detectDuplicates(articles) {
  try {
    if (!Array.isArray(articles) || articles.length < 2) {
      return { pairs: [], duplicateIndices: new Set() };
    }

    const pairs = [];
    const duplicateIndices = new Set();
    const THRESHOLD = 0.6;

    // เปรียบเทียบทุกคู่ O(n²) — ใช้ได้กับ n < 500
    for (let i = 0; i < articles.length; i++) {
      for (let j = i + 1; j < articles.length; j++) {
        const similarity = calculateSimilarity(articles[i], articles[j]);
        if (similarity >= THRESHOLD) {
          pairs.push({ i, j, similarity });
          duplicateIndices.add(i);
          duplicateIndices.add(j);
        }
      }
    }

    console.log(`[Radar-DuplicateDetector] พบ ${pairs.length} คู่ที่ซ้ำ จากบทความทั้งหมด ${articles.length} ชิ้น`);
    return { pairs, duplicateIndices };
  } catch (err) {
    console.error('[Radar-DuplicateDetector] ตรวจจับข่าวซ้ำล้มเหลว:', err.message);
    return { pairs: [], duplicateIndices: new Set() };
  }
}

/**
 * newsClusterer.js — จัดกลุ่มข่าวที่เกี่ยวข้องกันด้วย Union-Find
 * [Radar-Clusterer]
 */

import { v4 as uuidv4 } from 'uuid';
import { getSourceCredibilityScore } from './sourceNormalizer.js';

// === Union-Find Data Structure ===

/**
 * สร้าง Union-Find สำหรับจัดกลุ่ม
 * @param {number} n - จำนวน element
 * @returns {{ find: Function, union: Function }}
 */
function createUnionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);

  function find(x) {
    return parent[x] === x ? x : (parent[x] = find(parent[x]));
  }

  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else { parent[rb] = ra; rank[ra]++; }
  }

  return { find, union };
}

/**
 * ดึง domain จาก URL
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * จัดกลุ่มบทความที่เกี่ยวข้องกันโดยใช้ duplicate pairs
 * @param {Array<object>} articles - รายการบทความทั้งหมด
 * @param {Array<{i: number, j: number, similarity: number}>} duplicatePairs - คู่ที่ซ้ำกัน
 * @returns {Array<object>} - อาร์เรย์ของ cluster objects เรียงตาม sourceCount desc
 */
export function clusterArticles(articles, duplicatePairs) {
  try {
    if (!Array.isArray(articles) || articles.length === 0) {
      console.log('[Radar-Clusterer] ไม่มีบทความให้จัดกลุ่ม');
      return [];
    }

    const n = articles.length;
    const uf = createUnionFind(n);

    // รวม duplicate pairs เข้าด้วยกัน
    if (Array.isArray(duplicatePairs)) {
      for (const pair of duplicatePairs) {
        uf.union(pair.i, pair.j);
      }
    }

    // จัดกลุ่มบทความตาม root parent
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const root = uf.find(i);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root).push(i);
    }

    // สร้าง cluster objects จากแต่ละกลุ่ม
    const clusters = [];
    for (const [, indices] of groups) {
      const cluster = buildClusterMetadata(articles, indices);
      if (cluster) {
        clusters.push(cluster);
      }
    }

    // เรียงตาม sourceCount มากไปน้อย (ข่าวที่มีหลายแหล่ง = สำคัญกว่า)
    clusters.sort((a, b) => b.sourceCount - a.sourceCount);

    console.log(`[Radar-Clusterer] จัดกลุ่มเสร็จ: ${clusters.length} กลุ่ม จากบทความ ${n} ชิ้น`);
    return clusters;
  } catch (err) {
    console.error('[Radar-Clusterer] จัดกลุ่มล้มเหลว:', err.message);
    return [];
  }
}

/**
 * สร้าง metadata สำหรับ cluster จากบทความที่อยู่ในกลุ่มเดียวกัน
 * @param {Array<object>} articles - บทความทั้งหมด
 * @param {Array<number>} indices - index ของบทความในกลุ่ม
 * @returns {object} cluster object
 */
function buildClusterMetadata(articles, indices) {
  try {
    const clusterArticles = indices.map(i => articles[i]).filter(Boolean);
    if (clusterArticles.length === 0) return null;

    // รวบรวมแหล่งข่าว (unique domains)
    const sourcesMap = new Map();
    for (const art of clusterArticles) {
      const url = art.url || art.link || '';
      const domain = art.sourceDomain || extractDomain(url);
      if (domain && !sourcesMap.has(domain)) {
        sourcesMap.set(domain, {
          name: art.source || art.sourceName || domain,
          domain,
          url,
          publishedAt: art.publishedAt || null,
        });
      }
    }
    const sources = [...sourcesMap.values()];

    // หาบทความที่มี source credibility สูงสุด
    let bestCredibilityArticle = clusterArticles[0];
    let bestCredibilityScore = 0;
    for (const art of clusterArticles) {
      const domain = art.sourceDomain || extractDomain(art.url || art.link || '');
      const cred = getSourceCredibilityScore(domain);
      if (cred.score > bestCredibilityScore) {
        bestCredibilityScore = cred.score;
        bestCredibilityArticle = art;
      }
    }

    // หาบทความที่มี summary ยาวที่สุด
    const bestSummaryArticle = clusterArticles.reduce((best, art) => {
      const currentLen = (art.summary || art.snippet || '').length;
      const bestLen = (best.summary || best.snippet || '').length;
      return currentLen > bestLen ? art : best;
    }, clusterArticles[0]);

    // หาบทความที่มีหัวข้อยาวที่สุด (engaging title)
    const bestTitleArticle = clusterArticles.reduce((best, art) => {
      return (art.title || '').length > (best.title || '').length ? art : best;
    }, clusterArticles[0]);

    // รวบรวมวันที่
    const dates = clusterArticles
      .map(a => a.publishedAt ? new Date(a.publishedAt) : null)
      .filter(d => d && !isNaN(d));

    // รวม matched keywords จากทุกบทความ
    const allKeywords = new Set();
    for (const art of clusterArticles) {
      if (Array.isArray(art.matchedKeywords)) {
        art.matchedKeywords.forEach(k => allKeywords.add(k));
      }
    }

    // หารูปภาพแรกที่มี
    const imageUrl = clusterArticles.find(a => a.imageUrl || a.image)?.imageUrl
      || clusterArticles.find(a => a.imageUrl || a.image)?.image
      || null;

    // สร้าง UUID — fallback ถ้าไม่มี uuid library
    let clusterId;
    try {
      clusterId = uuidv4();
    } catch {
      clusterId = `cluster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    return {
      clusterId,
      mainTitle: bestCredibilityArticle.title || clusterArticles[0].title,
      summary: bestSummaryArticle.summary || bestSummaryArticle.snippet || '',
      sourceCount: sourcesMap.size,
      sources,
      oldestPublishedAt: dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : null,
      newestPublishedAt: dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null,
      bestSourceUrl: bestCredibilityArticle.url || bestCredibilityArticle.link || '',
      bestTitleUrl: bestTitleArticle.url || bestTitleArticle.link || '',
      articles: clusterArticles,
      matchedKeywords: [...allKeywords],
      imageUrl,
    };
  } catch (err) {
    console.error('[Radar-Clusterer] สร้าง cluster metadata ล้มเหลว:', err.message);
    return null;
  }
}

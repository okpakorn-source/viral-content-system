/**
 * sourceCredibility.js — คำนวณคะแนนความน่าเชื่อถือของ cluster
 * [Radar-SourceCredibility]
 */

import { getSourceCredibilityScore } from './sourceNormalizer.js';

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
 * คำนวณคะแนนความน่าเชื่อถือของ cluster (0-100)
 * 
 * น้ำหนัก:
 * - Source authority average (40%): ค่าเฉลี่ยความน่าเชื่อถือแหล่งข่าว
 * - Multi-source confirmation (25%): ยืนยันจากหลายแหล่ง
 * - Has date (10%): มีวันที่เผยแพร่
 * - Has author (10%): มีชื่อผู้เขียน
 * - Detail sufficiency (15%): มีรายละเอียดเพียงพอ
 * 
 * @param {object} cluster - cluster object จาก newsClusterer
 * @returns {{ score: number, breakdown: object }}
 */
export function calculateCredibilityScore(cluster) {
  try {
    if (!cluster) {
      return { score: 0, breakdown: {} };
    }

    const articles = cluster.articles || [];
    const sources = cluster.sources || [];
    const breakdown = {};

    // 1. Source authority average (40%)
    let authorityScore = 0;
    if (sources.length > 0) {
      const scores = sources.map(s => {
        const domain = s.domain || extractDomain(s.url || '');
        const cred = getSourceCredibilityScore(domain);
        return cred.score;
      });
      const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      // แปลงจาก 0-100 เป็นสัดส่วน 40%
      authorityScore = (avgScore / 100) * 40;
    } else {
      authorityScore = 20; // ค่าเริ่มต้นถ้าไม่มีข้อมูล source
    }
    breakdown.sourceAuthority = Math.round(authorityScore * 10) / 10;

    // 2. Multi-source confirmation (25%)
    let multiSourceScore = 0;
    const uniqueSourceCount = sources.length || cluster.sourceCount || 1;
    if (uniqueSourceCount >= 3) multiSourceScore = 25;
    else if (uniqueSourceCount >= 2) multiSourceScore = 15;
    else multiSourceScore = 5;
    breakdown.multiSource = multiSourceScore;

    // 3. Has date (10%)
    let dateScore = 0;
    const hasDate = articles.some(a => a.publishedAt) ||
                    cluster.newestPublishedAt ||
                    cluster.oldestPublishedAt;
    if (hasDate) dateScore = 10;
    else dateScore = 0;
    breakdown.hasDate = dateScore;

    // 4. Has author (10%)
    let authorScore = 0;
    const hasAuthor = articles.some(a => a.author || a.authorName);
    if (hasAuthor) authorScore = 10;
    else authorScore = 0;
    breakdown.hasAuthor = authorScore;

    // 5. Detail sufficiency (15%)
    let detailScore = 0;
    const longestSummary = articles.reduce((max, a) => {
      const len = (a.summary || a.snippet || '').length;
      return len > max ? len : max;
    }, 0);

    // ใช้ cluster summary ด้วย
    const clusterSummaryLen = (cluster.summary || '').length;
    const bestLen = Math.max(longestSummary, clusterSummaryLen);

    if (bestLen > 200) detailScore = 15;
    else if (bestLen > 100) detailScore = 10;
    else detailScore = 5;
    breakdown.detailSufficiency = detailScore;

    // คำนวณคะแนนรวม
    const totalScore = Math.round(
      authorityScore + multiSourceScore + dateScore + authorScore + detailScore
    );

    const finalScore = Math.min(totalScore, 100);

    console.log(`[Radar-SourceCredibility] คะแนนความน่าเชื่อถือ: ${finalScore}/100 (${JSON.stringify(breakdown)})`);

    return {
      score: finalScore,
      breakdown,
    };
  } catch (err) {
    console.error('[Radar-SourceCredibility] คำนวณความน่าเชื่อถือล้มเหลว:', err.message);
    return { score: 0, breakdown: {} };
  }
}

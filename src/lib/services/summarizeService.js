import { callAI } from '@/lib/ai/openai';
import { getPrompt, getAnalysisPreset } from '@/lib/ai/promptStore';
import { getWorkflow, saveExtraction, saveBreakdown, saveAnalysis, buildFullContext, validateOutput } from '@/lib/workflow/workflowEngine';
import { MasterAgent } from '@/lib/agents/masterAgent';
import { callSmartAI, getAvailableModels } from '@/lib/ai/aiRouter';
import { moderateVersions } from '@/lib/ai/moderationAgent';
import { createStore } from '@/lib/persistStore';
import { logPipeline } from '@/lib/pipelineLogger';
import { getSession } from '@/lib/auth';
import { buildNarrativePayload, formatNarrativePayload, checkNarrativeSimilarity } from '@/lib/input-engine/narrativePayload';
import { clusterMatch, findClusterScore, mapCategory, EMOTION_CLUSTERS, CONFLICT_CLUSTERS } from '@/lib/ai/semanticClusters';

// â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�
// ðŸ”� POST-PROCESSING QUALITY FILTERS
// â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�â•�

/**
 * Quality filter: à¸•à¸£à¸§à¸ˆà¹�à¸¥à¸°à¸›à¸£à¸±à¸šà¸„à¸¸à¸“à¸ à¸²à¸žà¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸�à¹ˆà¸­à¸™à¸ªà¹ˆà¸‡à¸­à¸­à¸�
 * - Opening Diversity: à¸«à¹‰à¸²à¸¡à¹€à¸›à¸´à¸”à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸‹à¹‰à¸³à¸�à¸±à¸™
 * - Closing Length: à¸›à¸´à¸”à¸—à¹‰à¸²à¸¢à¹„à¸¡à¹ˆà¹€à¸�à¸´à¸™ 2 à¸šà¸£à¸£à¸—à¸±à¸”
 * - Pronoun Balance: à¹„à¸¡à¹ˆà¹ƒà¸Šà¹‰ à¹€à¸˜à¸­/à¹€à¸‚à¸² à¸‹à¹‰à¸³à¸¡à¸²à¸�à¹€à¸�à¸´à¸™à¹„à¸›  
 * - Thai Language Quality: à¸•à¸£à¸§à¸ˆà¸ˆà¸±à¸šà¸›à¸£à¸°à¹‚à¸¢à¸„ garbled
 * - Spell Check: à¸Šà¸·à¹ˆà¸­à¹€à¸‰à¸žà¸²à¸°à¸•à¹‰à¸­à¸‡à¸•à¸£à¸‡à¸�à¸±à¸šà¸•à¹‰à¸™à¸‰à¸šà¸±à¸š
 * - Auto-Score: à¹ƒà¸«à¹‰à¸„à¸°à¹�à¸™à¸™à¹�à¸•à¹ˆà¸¥à¸°à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™
 * - Diversity Check: à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸•à¹‰à¸­à¸‡à¹„à¸¡à¹ˆà¸‹à¹‰à¸³à¸�à¸±à¸™à¹€à¸�à¸´à¸™à¹„à¸›
 */
function postProcessVersions(versions, sourceText, newsTitle) {
  if (!versions || !Array.isArray(versions) || versions.length === 0) return versions;

  // --- à¸”à¸¶à¸‡à¸Šà¸·à¹ˆà¸­à¹€à¸‰à¸žà¸²à¸°à¸ˆà¸²à¸�à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¹€à¸žà¸·à¹ˆà¸­à¸•à¸£à¸§à¸ˆà¸�à¸²à¸£à¸ªà¸°à¸�à¸” ---
  const sourceNames = extractProperNouns(sourceText || '');

  const processed = versions.map((v, idx) => {
    let content = v.content || v.text || v.main_post || '';
    if (!content) return v;

    // 1. Pronoun Balance â€” à¸¥à¸”à¸�à¸²à¸£à¹ƒà¸Šà¹‰ à¹€à¸˜à¸­/à¹€à¸‚à¸² à¸‹à¹‰à¸³à¹€à¸�à¸´à¸™à¹„à¸›
    content = balancePronouns(content, sourceText);

    // 2. Closing Length â€” à¸›à¸´à¸”à¸—à¹‰à¸²à¸¢à¸�à¸£à¸°à¸Šà¸±à¸š à¹„à¸¡à¹ˆà¹€à¸Ÿà¹‰à¸­
    content = trimClosing(content);

    // 3. Spell Check â€” à¸Šà¸·à¹ˆà¸­à¹€à¸‰à¸žà¸²à¸°à¸•à¹‰à¸­à¸‡à¸•à¸£à¸‡à¸•à¹‰à¸™à¸‰à¸šà¸±à¸š
    content = fixProperNouns(content, sourceNames);

    // 4. Thai Language Quality â€” à¸•à¸£à¸§à¸ˆà¸ˆà¸±à¸š garbled text
    const qualityScore = checkThaiQuality(content);

    // à¸­à¸±à¸›à¹€à¸”à¸•à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸žà¸£à¹‰à¸­à¸¡à¸„à¸°à¹�à¸™à¸™à¸„à¸¸à¸“à¸ à¸²à¸ž
    return {
      ...v,
      content,
      ...(v.text ? { text: content } : {}),
      ...(v.main_post ? { main_post: content } : {}),
      _qualityScore: qualityScore,
      _autoScore: calculateAutoScore(content, sourceText),
    };
  });

  // 5. Opening Diversity â€” à¸«à¹‰à¸²à¸¡à¹€à¸›à¸´à¸”à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸‹à¹‰à¸³à¸�à¸±à¸™
  const diversified = ensureOpeningDiversity(processed);

  // 6. Diversity Check â€” à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸•à¹‰à¸­à¸‡à¹„à¸¡à¹ˆà¸‹à¹‰à¸³à¸�à¸±à¸™à¹€à¸�à¸´à¸™
  const diversityReport = checkVersionDiversity(diversified);
  console.log(`[Quality] Diversity: ${diversityReport.uniqueOpenings}/${diversified.length} unique openings, similarity=${diversityReport.avgSimilarity.toFixed(2)}`);

  return diversified;
}

// --- Helper: à¸”à¸¶à¸‡à¸Šà¸·à¹ˆà¸­à¹€à¸‰à¸žà¸²à¸°à¸ˆà¸²à¸�à¸‚à¹‰à¸­à¸„à¸§à¸²à¸¡à¸ à¸²à¸©à¸²à¹„à¸—à¸¢ ---
function extractProperNouns(text) {
  const names = new Set();
  // Use Unicode ranges for Thai characters
  const patterns = [
    /["\u201C]([\u0E01-\u0E39\u0E40-\u0E4F\s]{2,20})["\u201D]/g,
    /(?:\u0E04\u0E38\u0E13|\u0E19\u0E32\u0E22|\u0E19\u0E32\u0E07|\u0E19\u0E32\u0E07\u0E2A\u0E32\u0E27|\u0E41\u0E21\u0E48|\u0E1E\u0E48\u0E2D)\s*([\u0E01-\u0E39\u0E40-\u0E4F]{2,30})/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = (match[1] || match[2] || '').trim();
      if (name.length >= 2) names.add(name);
    }
  }
  const words = text.split(/[\s,.]+/);
  const freq = {};
  words.forEach(w => { if (w.length >= 3 && /^[\u0E01-\u0E39\u0E40-\u0E4F]+$/.test(w)) freq[w] = (freq[w] || 0) + 1; });
  Object.entries(freq).filter(([w, c]) => c >= 3 && w.length >= 3).forEach(([w]) => names.add(w));
  return [...names];
}

// --- Helper: à¸›à¸£à¸±à¸šà¸ªà¸¡à¸”à¸¸à¸¥à¸„à¸³à¸ªà¸£à¸£à¸žà¸™à¸²à¸¡ (à¹€à¸˜à¸­/à¹€à¸‚à¸²) ---
// --- Helper: ปรับสมดุลคำสรรพนาม (เธอ/เขา) ---
function balancePronouns(content, sourceText) {
  const nameMatch = sourceText?.match(/(?:\u0E04\u0E38\u0E13|\u0E19\u0E32\u0E22|\u0E19\u0E32\u0E07|\u0E19\u0E32\u0E07\u0E2A\u0E32\u0E27)\s*([\u0E01-\u0E39\u0E40-\u0E4F]{2,20})/);
  const mainName = nameMatch ? nameMatch[0] : null;
  const sentences = content.split(/(?<=[\u0E46\.!?]\s*)/);
  let consecutivePronouns = 0;
  const fixed = sentences.map(sentence => {
    const hasPronoun = /\u0E40\u0E18\u0E2D|\u0E40\u0E02\u0E32/.test(sentence);
    if (hasPronoun && consecutivePronouns >= 2 && mainName) {
      consecutivePronouns = 0;
      return sentence.replace(/\u0E40\u0E18\u0E2D|\u0E40\u0E02\u0E32/, mainName);
    }
    if (hasPronoun) { consecutivePronouns++; } else { consecutivePronouns = 0; }
    return sentence;
  });
  return fixed.join('');
}

// --- Helper: ตัดย่อหน้าปิดท้ายให้กระชับ ---
function trimClosing(content) {
  const paragraphs = content.split('\n\n').filter(p => p.trim());
  if (paragraphs.length <= 1) return content;
  const lastPara = paragraphs[paragraphs.length - 1];
  if (lastPara.length > 300) {
    const sentences = lastPara.split(/(?<=[\u0E46\.!?]\s*)/);
    if (sentences.length > 3) {
      const trimmed = sentences.slice(-3).join('').trim();
      paragraphs[paragraphs.length - 1] = trimmed;
      return paragraphs.join('\n\n');
    }
  }
  return content;
}

// --- Helper: แก้การสะกดชื่อเฉพาะให้ตรงกับต้นฉบับ ---
// ★ FIX: เดิม threshold 80% กว้างเกินไป เปลี่ยนคำปกติเป็นชื่อคน
// เพิ่มเป็น 90% + ต้องยาว 5+ ตัวอักษร + ห้ามเป็นคำทั่วไป
function fixProperNouns(content, sourceNames) {
  if (!sourceNames || sourceNames.length === 0) return content;
  const commonWords = new Set(['เพราะ','อยาก','แต่ว่า','เรื่อง','ตอนนี้','สำหรับ','เพื่อน','ครอบครัว','ปัญหา','ความรัก','ความสุข','ต้องการ','ทำงาน','ชีวิต','คนไทย','สังคม','ประเทศ','รายการ','อารมณ์','เหตุการณ์','เรื่องราว','ทั้งหมด','ทุกคน','บางคน','ข่าวสาร','ละคร','ดราม่า','ผู้คน','หลายคน']);
  const validNames = sourceNames.filter(n => n.length >= 5 && !commonWords.has(n));
  if (validNames.length === 0) return content;
  let fixed = content;
  let changes = 0;
  for (const name of validNames) {
    const nameChars = [...name];
    const words = fixed.split(/(\s+)/);
    fixed = words.map(word => {
      const cleanWord = word.trim();
      if (cleanWord.length < 5 || !/^[\u0E01-\u0E39\u0E40-\u0E4F]+$/.test(cleanWord)) return word;
      if (cleanWord === name) return word;
      if (commonWords.has(cleanWord)) return word;
      const overlap = nameChars.filter(c => cleanWord.includes(c)).length;
      const similarity = overlap / Math.max(name.length, cleanWord.length);
      if (similarity > 0.9 && Math.abs(cleanWord.length - name.length) <= 1) {
        changes++;
        return name;
      }
      return word;
    }).join('');
  }
  if (changes > 0) console.log('[Quality] FixProperNouns: ' + changes + ' corrections');
  return fixed;
}

// --- Helper: à¸•à¸£à¸§à¸ˆà¸„à¸¸à¸“à¸ à¸²à¸žà¸ à¸²à¸©à¸²à¹„à¸—à¸¢ ---
function checkThaiQuality(content) {
  let score = 100;
  const issues = [];
  
  // à¸•à¸£à¸§à¸ˆà¸ˆà¸±à¸šà¸¥à¸³à¸”à¸±à¸šà¸žà¸¢à¸±à¸�à¸Šà¸™à¸°à¸‹à¹‰à¸³à¸œà¸´à¸”à¸›à¸�à¸•à¸´ (garbled text)
  const garbledPattern = /[\u0E01-\u0E2E]{6,}/g;
  if (garbledMatches.length > 0) {
    score -= garbledMatches.length * 5;
    issues.push(`garbled: ${garbledMatches.length} sequences`);
  }
  
  // à¸•à¸£à¸§à¸ˆà¸ˆà¸±à¸š encoding à¹€à¸ªà¸µà¸¢
  const brokenPattern = /[\uFFFD\u00E0-\u00EF]/g;
  const brokenMatches = content.match(brokenPattern) || [];
  if (brokenMatches.length > 0) {
    score -= brokenMatches.length * 10;
    issues.push(`encoding: ${brokenMatches.length} broken chars`);
  }
  
  // à¸•à¸£à¸§à¸ˆà¸„à¸§à¸²à¸¡à¸ªà¸¡à¹ˆà¸³à¹€à¸ªà¸¡à¸­à¸‚à¸­à¸‡à¸„à¸§à¸²à¸¡à¸¢à¸²à¸§à¸›à¸£à¸°à¹‚à¸¢à¸„ (variance à¸ªà¸¹à¸‡ = à¸„à¸¸à¸“à¸ à¸²à¸žà¸•à¹ˆà¸³)
  const sentences = content.split(/[\.!\u0E46\n]+/).filter(s => s.trim().length > 0);
  const avgLen = sentences.reduce((a, s) => a + s.length, 0) / (sentences.length || 1);
  const variance = sentences.reduce((a, s) => a + Math.pow(s.length - avgLen, 2), 0) / (sentences.length || 1);
  if (variance > 2000) {
    score -= 10;
    issues.push('high sentence length variance');
  }
  
  return { score: Math.max(0, score), issues };
}

// --- Helper: à¸„à¸³à¸™à¸§à¸“à¸„à¸°à¹�à¸™à¸™à¸­à¸±à¸•à¹‚à¸™à¸¡à¸±à¸•à¸´ ---
function calculateAutoScore(content, sourceText) {
  let score = 50; // à¸„à¸°à¹�à¸™à¸™à¸�à¸²à¸™
  
  // à¸„à¸°à¹�à¸™à¸™à¸„à¸§à¸²à¸¡à¸¢à¸²à¸§ (sweet spot 300-600 à¸•à¸±à¸§à¸­à¸±à¸�à¸©à¸£)
  const len = content.length;
  if (len >= 300 && len <= 600) score += 15;
  else if (len >= 200 && len <= 800) score += 10;
  else if (len < 150 || len > 1000) score -= 10;
  
  // à¸„à¸°à¹�à¸™à¸™à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡ (à¸¡à¸µà¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²)
  const paragraphs = content.split('\n\n').filter(p => p.trim()).length;
  if (paragraphs >= 2 && paragraphs <= 5) score += 10;
  
  // à¸„à¸°à¹�à¸™à¸™ Hook (à¹€à¸›à¸´à¸”à¹€à¸£à¸·à¹ˆà¸­à¸‡à¹�à¸£à¸‡)
  const firstLine = content.split('\n')[0] || '';
  if (firstLine.length >= 20 && firstLine.length <= 100) score += 5;
  if (/["\u201C\u201D]/.test(firstLine)) score += 5; // à¹€à¸›à¸´à¸”à¸”à¹‰à¸§à¸¢ quote
  if (/[?]/.test(firstLine)) score += 3; // question opening
  
  // à¸„à¸°à¹�à¸™à¸™à¸£à¸±à¸�à¸©à¸²à¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡ (à¸•à¸±à¸§à¹€à¸¥à¸‚à¸ˆà¸²à¸�à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¸›à¸£à¸²à¸�à¸�à¹ƒà¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²)
  const sourceNumbers = (sourceText || '').match(/\d[\d,.]+/g) || [];
  const contentNumbers = content.match(/\d[\d,.]+/g) || [];
  const preservedFacts = sourceNumbers.filter(n => contentNumbers.some(cn => cn.includes(n) || n.includes(cn))).length;
  score += Math.min(10, preservedFacts * 3);
  
  // à¸«à¸±à¸�à¸„à¸°à¹�à¸™à¸™: à¹ƒà¸Šà¹‰à¸„à¸³à¸ªà¸£à¸£à¸žà¸™à¸²à¸¡à¸¡à¸²à¸�à¹€à¸�à¸´à¸™à¹„à¸›
  const pronounCount = (content.match(/\u0E40\u0E18\u0E2D|\u0E40\u0E02\u0E32/g) || []).length;
  if (pronounCount > 8) score -= (pronounCount - 8) * 2;
  
  return Math.max(0, Math.min(100, score));
}

// --- Helper: à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸„à¸§à¸²à¸¡à¸«à¸¥à¸²à¸�à¸«à¸¥à¸²à¸¢à¸‚à¸­à¸‡à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸›à¸´à¸”à¹€à¸£à¸·à¹ˆà¸­à¸‡ ---
function ensureOpeningDiversity(versions) {
  const openings = new Map(); // 30 à¸•à¸±à¸§à¸­à¸±à¸�à¸©à¸£à¹�à¸£à¸� -> index
  
  return versions.map((v, idx) => {
    const content = v.content || v.text || v.main_post || '';
    const opening = content.slice(0, 30).trim();
    
    if (openings.has(opening)) {
      // à¸žà¸šà¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸›à¸´à¸”à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸‹à¹‰à¸³ â€” à¸•à¸´à¸” flag
      console.log(`[Quality] âš ï¸� Version ${idx + 1} has duplicate opening with Version ${openings.get(opening) + 1}`);
      return { ...v, _duplicateOpening: true, _duplicateOf: openings.get(opening) + 1 };
    }
    
    openings.set(opening, idx);
    return v;
  });
}

// --- Helper: à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸„à¸§à¸²à¸¡à¸«à¸¥à¸²à¸�à¸«à¸¥à¸²à¸¢à¸‚à¸­à¸‡à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸” ---
function checkVersionDiversity(versions) {
  const contents = versions.map(v => v.content || v.text || v.main_post || '');
  const openings = new Set(contents.map(c => c.slice(0, 40)));
  
  // à¸„à¸³à¸™à¸§à¸“ word-overlap similarity
  let totalSimilarity = 0;
  let comparisons = 0;
  
  for (let i = 0; i < contents.length; i++) {
    for (let j = i + 1; j < contents.length; j++) {
      const wordsA = new Set(contents[i].split(/\s+/));
      const wordsB = new Set(contents[j].split(/\s+/));
      const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
      const union = new Set([...wordsA, ...wordsB]).size;
      totalSimilarity += union > 0 ? intersection / union : 0;
      comparisons++;
    }
  }
  
  return {
    uniqueOpenings: openings.size,
    avgSimilarity: comparisons > 0 ? totalSimilarity / comparisons : 0,
    totalVersions: versions.length,
  };
}

function extractSummary(result) {
  const directKeys = ['main_post', 'summary', 'content', 'analysis', 'post', 'body', 'text', 'article'];
  for (const k of directKeys) {
    if (result[k] && typeof result[k] === 'string' && result[k].length > 20) {
      return result[k];
    }
  }
  let longest = '';
  for (const [key, val] of Object.entries(result)) {
    if (typeof val === 'string' && val.length > longest.length) longest = val;
  }
  if (longest.length > 30) return longest;
  return '';
}

function extractArray(result, ...keys) {
  for (const k of keys) {
    if (Array.isArray(result[k]) && result[k].length > 0) return result[k];
  }
  return [];
}

function extractString(result, ...keys) {
  for (const k of keys) {
    if (result[k] && typeof result[k] === 'string') return result[k];
  }
  return '';
}

export async function performSummarize({
  text,
  sourceType,
  customPrompt,
  analysisPresetId,
  presetPrompt,
  targetCount,
  mode,
  newsTitle,
  breakdownData,
  researchData,
  contentLength,
  workflowId,
  emotionalBlueprint,
  factPool,
  user
}) {
  const _pipelineStart = Date.now();
  let _user = user || { userId: null, userName: null };

  if (!_user.userId) {
    try {
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      const token = cookieStore.get('auth_token')?.value;
      const session = await getSession(token);
      if (session) _user = { userId: session.memberId, userName: session.displayName || session.username };
    } catch {}
  }

  // â•�â•� PIPELINE LOG HEADER â•�â•�
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[ðŸ”„ PIPELINE-SERVICE] MODE: ${mode?.toUpperCase() || 'UNKNOWN'} | input: ${text?.length || 0}ch | source: ${sourceType || 'url'}`);
  console.log(`[ðŸ”„ PIPELINE-SERVICE] contentLength: ${contentLength || 'short'} | workflowId: ${workflowId || 'none'}`);
  console.log(`${'='.repeat(60)}\n`);

  await logPipeline({ workflowId, step: mode || 'unknown', status: 'started', detail: 'Input: ' + (text?.length || 0) + 'ch, sourceType=' + (sourceType || '-'), ..._user });

  if (!text || text.length < 10) {
    throw new Error('à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸ªà¸±à¹‰à¸™à¹€à¸�à¸´à¸™à¹„à¸›');
  }

  // === Content Length Config ===
  const lengthConfig = {
    short:  { min: 250, max: 300, paragraphs: '3', paraDesc: '3 à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²', sentences: '3-5' },
    medium: { min: 400, max: 500, paragraphs: '4-5', paraDesc: '4-5 à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²', sentences: '4-6' },
    long:   { min: 500, max: 1000, paragraphs: '6-8', paraDesc: '6-8 à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²', sentences: '4-8' },
  };
  let lenCfg = lengthConfig[contentLength] || lengthConfig.short;

  // ===== MODE: extract â€” à¸ªà¸�à¸±à¸”à¹€à¸™à¸·à¹‰à¸­à¸‚à¹ˆà¸²à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¹€à¸”à¸µà¸¢à¸§ =====
  if (mode === 'extract') {
    // === PATH A: TikTok/YouTube â€” à¸–à¸­à¸”à¹€à¸ªà¸µà¸¢à¸‡ â†’ à¸ˆà¸±à¸”à¸£à¸¹à¸›à¹�à¸šà¸š (à¸£à¸±à¸�à¸©à¸²à¸„à¸³à¸žà¸¹à¸”à¹€à¸”à¸´à¸¡) ===
    if (sourceType === 'tiktok' || sourceType === 'youtube') {
      try {
        const tPromptObj = getPrompt('transcript_extraction');
        const platform = sourceType === 'tiktok' ? 'TikTok' : 'YouTube';
        const transcriptPrompt = tPromptObj.prompt
          .replace('{content}', text.slice(0, 8000))
          .replace('{source_platform}', platform)
          .replace('{custom_instruction}', customPrompt ? `à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡: "${customPrompt}"` : '');

        console.log(`[Extract-Transcript] ${sourceType} mode â€” preserving original speech...`);
        const { result, model: usedModel } = await callSmartAI('extract', { prompt: transcriptPrompt, temperature: 0.15 });
        console.log(`[Extract-Transcript] Used model: ${usedModel}`);

        if (result?.news_body && result.news_body.length >= 20) {
          console.log(`[Extract-Transcript] âœ… OK: "${result.news_title}" (${result.news_body.length}ch)`);
          if (workflowId) {
            await saveExtraction(workflowId, {
              newsTitle: result.news_title, newsBody: result.news_body,
              newsSource: result.news_source, newsDate: result.news_date,
              newsCategory: result.news_category, rawInput: text.slice(0, 5000),
            }).catch(e => console.error('[Extract-Transcript] DB save err:', e.message));
            const agent = new MasterAgent(workflowId);
            agent.onExtractionComplete({
              newsTitle: result.news_title, newsBody: result.news_body,
              newsSource: result.news_source, newsDate: result.news_date,
              newsCategory: result.news_category,
            });
            await agent.saveMemoryToDB().catch(() => {});
          }
          return {
            success: true,
            data: {
              newsTitle: result.news_title,
              newsBody: result.news_body,
              newsSource: result.news_source,
              newsDate: result.news_date,
              newsCategory: result.news_category,
            },
          };
        }
      } catch (err) {
        console.error('[Extract-Transcript] ERROR:', err.message);
      }

      // Fallback â€” à¸ªà¹ˆà¸‡ raw transcript à¸�à¸¥à¸±à¸š
      const cleanText = text
        .replace(/===.*?===/g, '')
        .replace(/à¸„à¸§à¸²à¸¡à¸¢à¸²à¸§:.*à¸™à¸²à¸—à¸µ/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return {
        success: true,
        data: {
          newsTitle: cleanText.slice(0, 80).replace(/\n/g, ' ').trim(),
          newsBody: cleanText.slice(0, 5000),
          newsSource: `à¸„à¸¥à¸´à¸› ${sourceType === 'tiktok' ? 'TikTok' : 'YouTube'}`,
          newsDate: '', newsCategory: 'à¸—à¸±à¹ˆà¸§à¹„à¸›',
        },
      };
    }

    // === PATH B: URL/Image/Raw ===
    const extractionPrompt = getPrompt('extraction');
    try {
      const sourceHint = {
        image: 'à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸™à¸µà¹‰à¸¡à¸²à¸ˆà¸²à¸�à¸�à¸²à¸£à¸­à¹ˆà¸²à¸™à¸ à¸²à¸ž (OCR) â€” à¸­à¸²à¸ˆà¸¡à¸µ marker metadata à¹ƒà¸«à¹‰à¸•à¸±à¸”à¸­à¸­à¸� à¸ˆà¸±à¸”à¸‚à¹‰à¸­à¸„à¸§à¸²à¸¡à¹ƒà¸«à¹‰à¸­à¹ˆà¸²à¸™à¸‡à¹ˆà¸²à¸¢',
      }[sourceType] || '';

      const prompt = extractionPrompt.prompt
        .replace('{content}', text.slice(0, 8000))
        .replace('{custom_instruction}', [
          sourceHint ? `[à¹�à¸«à¸¥à¹ˆà¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥: ${sourceHint}]` : '',
          customPrompt ? `à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡: "${customPrompt}"` : '',
        ].filter(Boolean).join('\n'));

      console.log('[Extract-URL] Extracting via SmartAI...');
      const { result, model: usedModel } = await callSmartAI('extract', { prompt, temperature: 0.2 });
      console.log(`[Extract-URL] Used model: ${usedModel}`);
      logPipeline({ workflowId, step: 'extract', status: 'success', model: usedModel, duration: Date.now() - _pipelineStart, detail: 'Extracted via ' + usedModel }).catch(() => {});

      if (result?.news_body && result.news_body.length >= 20) {
        console.log(`[Extract-URL] OK: "${result.news_title}" (${result.news_body.length}ch)`);
        if (workflowId) {
          await saveExtraction(workflowId, {
            newsTitle: result.news_title, newsBody: result.news_body,
            newsSource: result.news_source, newsDate: result.news_date,
            newsCategory: result.news_category, rawInput: text.slice(0, 5000),
          }).catch(e => console.error('[Extract-URL] DB save err:', e.message));
          const agent = new MasterAgent(workflowId);
          agent.onExtractionComplete({
            newsTitle: result.news_title, newsBody: result.news_body,
            newsSource: result.news_source, newsDate: result.news_date,
            newsCategory: result.news_category,
          });
          await agent.saveMemoryToDB().catch(() => {});
        }
        return {
          success: true,
          data: {
            newsTitle: result.news_title,
            newsBody: result.news_body,
            newsSource: result.news_source,
            newsDate: result.news_date,
            newsCategory: result.news_category,
          },
        };
      }
    } catch (err) {
      console.error('[Extract-URL] ERROR:', err.message);
    }

    // Fallback
    return {
      success: true,
      data: {
        newsTitle: text.slice(0, 80).replace(/\n/g, ' ').trim(),
        newsBody: text.slice(0, 5000),
        newsSource: '', newsDate: '', newsCategory: 'à¸—à¸±à¹ˆà¸§à¹„à¸›',
      },
    };
  }

  // ===== MODE: breakdown â€” à¹�à¸•à¸�à¸›à¸£à¸°à¹€à¸”à¹‡à¸™ + à¸ªà¸£à¸¸à¸›à¹ƒà¸ˆà¸„à¸§à¸²à¸¡ =====
  if (mode === 'breakdown') {
    const breakdownPrompt = getPrompt('breakdown');
    let actualNewsBody = text;
    let actualNewsTitle = newsTitle;
    let contextSource = 'request';

    if (workflowId) {
      const wf = await getWorkflow(workflowId).catch(() => null);
      if (wf?.newsBody && wf.newsBody.length > actualNewsBody.length) {
        actualNewsBody = wf.newsBody;
        actualNewsTitle = wf.newsTitle || newsTitle;
        contextSource = 'DB (workflow)';
        console.log(`[Breakdown-Service] âœ… Loaded full news from DB: ${actualNewsBody.length}ch`);
      }
    }

    console.log(`[Breakdown-Service] Context: source=${contextSource}, title="${(actualNewsTitle || '').slice(0, 60)}", bodyLen=${actualNewsBody?.length}ch`);

    const prompt = breakdownPrompt.prompt
      .replace('{title}', actualNewsTitle || actualNewsBody.slice(0, 100))
      .replace('{content}', actualNewsBody)
      .replace('{custom_instruction}', customPrompt ? `à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡à¸ˆà¸²à¸�à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰: "${customPrompt}"` : '');

    console.log(`[Breakdown-Service] ðŸ“‹ PROMPT LENGTH: ${prompt.length}ch`);
    console.log(`[Breakdown-Service] ðŸ“‹ NEWS IN PROMPT: ${actualNewsBody.length}ch of actual news content`);

    try {
      const { result, model: usedModel } = await callSmartAI('breakdown', { prompt, temperature: 0.4, maxTokens: 8000 });
      console.log('[Breakdown-Service] OK (model: ' + usedModel + '), keys: ' + Object.keys(result || {}).join(', '));

      const bdData = {
        primaryCategory: result.primaryCategory || 'à¸—à¸±à¹ˆà¸§à¹„à¸›',
        secondaryCategories: result.secondaryCategories || [],
        emotionalTags: result.emotionalTags || [],
        conflictTags: result.conflictTags || [],
        narrativeArchetype: result.narrativeArchetype || '',
        viralHooks: result.viralHooks || [],
        humanAngles: result.humanAngles || [],
        news_summary: result.news_summary || '',
        core_story: result.core_story || '',
        main_emotional_core: result.main_emotional_core || '',
        conflict_point: result.conflict_point || '',
        viral_trigger: result.viral_trigger || '',
        key_points: result.key_points || [],
        best_sections: result.best_sections || [],
        key_facts: result.key_facts || { people: [], places: [], numbers: [], dates: [] },
        emotional_hooks: result.emotional_hooks || [],
        suggested_angles: result.suggested_angles || [],
        possible_angles: result.possible_angles || [],
        best_main_angle: result.best_main_angle || null,
        language_strategy: result.language_strategy || null,
        quotes: result.quotes || [],
        conflicts: result.conflicts || [],
        pain_points: result.pain_points || [],
      };

      if (workflowId) {
        await saveBreakdown(workflowId, bdData).catch(e => console.error('[Breakdown-Service] DB save err:', e.message));
        const agent = new MasterAgent(workflowId);
        await agent.loadFromDB().catch(() => {});
        agent.onBreakdownComplete(bdData);
        await agent.saveMemoryToDB().catch(() => {});
      }

      logPipeline({ workflowId, step: 'breakdown', status: 'success', model: usedModel || 'unknown', duration: Date.now() - _pipelineStart, detail: (result.core_story || '').slice(0, 60) }).catch(() => {});
      return {
        success: true,
        data: bdData,
        debug: {
          contextSource,
          newsBodyLength: actualNewsBody.length,
          promptLength: prompt.length,
          newsTitle: actualNewsTitle || '',
        }
      };
    } catch (err) {
      console.error('[Breakdown-Service] ERROR:', err.message);
      logPipeline({ workflowId, step: 'breakdown', status: 'failed', duration: Date.now() - _pipelineStart, error: err.message }).catch(() => {});
      throw err;
    }
  }

  // ===== MODE: analyze â€” à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸”à¹‰à¸§à¸¢ Preset (Smart Match + Narrative Reconstruction) =====
  if (mode === 'analyze') {
    const preset = getAnalysisPreset(analysisPresetId || 'viral_fb');
    console.log(`[Analyze-Service] Preset fallback: "${preset.id}" "${preset.name}"`);

    let wfContext = null;
    let actualNewsBody = text;
    let actualNewsTitle = newsTitle;
    let actualBreakdown = breakdownData;

    if (workflowId) {
      wfContext = await getWorkflow(workflowId).catch(() => null);
      if (wfContext) {
        actualNewsBody = wfContext.newsBody || text;
        actualNewsTitle = wfContext.newsTitle || newsTitle;
        actualBreakdown = wfContext.breakdownData || breakdownData;
        console.log(`[Analyze-Service] âœ… Loaded from DB: title="${(actualNewsTitle||'').slice(0,60)}", body=${actualNewsBody?.length}ch, breakdown=${actualBreakdown?.key_points?.length || 0} points`);
      }
    }

    console.log(`[Analyze-Service] newsTitle: "${(actualNewsTitle || '').slice(0,80)}", textLen: ${actualNewsBody?.length}`);

    let smartPrompt = presetPrompt || null;
    let promptSource = presetPrompt ? 'library' : 'preset';
    let promptMatchReason = presetPrompt ? `ðŸ�›ï¸� Pre-selected: "${presetPrompt.promptName || 'Library Prompt'}"` : '';
    let newsTypeDetected = '';
    let newsAnalysis = null;
    let top10PromptScores = [];
    let selectedPromptScore = 0;
    let matchType = 'BORROWED';
    let matchedDimensions = [];
    let whyFallbackUsed = '';
    let rejectedPromptsReason = '';
    let totalPromptsLoaded = 0;
    let validPromptsCount = 0;

    if (!smartPrompt) {
      try {
        const promptStore = createStore('prompt-library');
        let promptLib = [];
        try { promptLib = await promptStore.getAll(); } catch (e) { console.warn('[Analyze-Service] Supabase prompt load:', e.message); }

        if (promptLib.length === 0) {
          try {
            const { readFile: _rf } = await import('fs/promises');
            const { join: _join } = await import('path');
            const _localPath = _join(process.cwd(), 'data', 'prompt-library.json');
            const _localData = JSON.parse(await _rf(_localPath, 'utf-8'));
            if (Array.isArray(_localData) && _localData.length > 0) {
              promptLib = _localData;
              console.log('[Analyze-Service] âœ… FALLBACK: Loaded ' + promptLib.length + ' prompts from LOCAL FILE (Supabase empty)');
            }
          } catch (fileErr) {
            console.warn('[Analyze-Service] Local file fallback failed:', fileErr.message);
          }
        } else {
          console.log('[Analyze-Service] âœ… Supabase: ' + promptLib.length + ' prompts loaded');
        }

        totalPromptsLoaded = promptLib.length;
        const validPrompts = promptLib.filter(p => p.promptText);
        validPromptsCount = validPrompts.length;
        if (validPrompts.length > 0) {
          // --- STAGE 1: DEEP DNA NEWS ANALYZER (12 Dimensions) ---
          console.log(`[Analyze-Service] ðŸ§  STAGE 1: Analyzing Deep DNA for: "${actualNewsTitle}"`);
          
          if (actualBreakdown && actualBreakdown.primaryCategory) {
            console.log(`[Analyze-Service] âš¡ BYPASS AI: Using pre-extracted DNA from Breakdown Phase`);
            newsAnalysis = {
              primaryCategory: actualBreakdown.primaryCategory || 'à¸—à¸±à¹ˆà¸§à¹„à¸›',
              secondaryCategories: actualBreakdown.secondaryCategories || [],
              emotionalTags: actualBreakdown.emotionalTags || [],
              conflictTags: actualBreakdown.conflictTags || [],
              narrativeArchetype: actualBreakdown.narrativeArchetype || '',
              viralHooks: actualBreakdown.viralHooks || [],
              humanAngles: actualBreakdown.humanAngles || []
            };
            newsTypeDetected = newsAnalysis.primaryCategory;
          } else {
            try {
              const analyzerPrompt = `à¸„à¸¸à¸“à¸„à¸·à¸­ AI à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œ "DNA à¸‚à¹ˆà¸²à¸§à¸•à¹‰à¸™à¸‰à¸šà¸±à¸š" à¸£à¸°à¸”à¸±à¸šà¸¡à¸·à¸­à¸­à¸²à¸Šà¸µà¸ž
à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆ: à¸–à¸­à¸”à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸‚à¹ˆà¸²à¸§à¸­à¸­à¸�à¸¡à¸²à¹€à¸›à¹‡à¸™ "Deep DNA" à¹€à¸žà¸·à¹ˆà¸­à¸ªà¹ˆà¸‡à¸•à¹ˆà¸­à¹ƒà¸«à¹‰à¸£à¸°à¸šà¸šà¸ˆà¸±à¸šà¸„à¸¹à¹ˆ Prompt à¸—à¸µà¹ˆà¹�à¸¡à¹ˆà¸™à¸¢à¸³à¸—à¸µà¹ˆà¸ªà¸¸à¸”
à¸«à¹‰à¸²à¸¡à¸ªà¸£à¸¸à¸›à¹�à¸šà¸šà¸œà¸´à¸§à¹€à¸œà¸´à¸™ à¹ƒà¸«à¹‰à¸„à¸´à¸”à¹€à¸«à¸¡à¸·à¸­à¸™à¸™à¸±à¸�à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸žà¸¤à¸•à¸´à¸�à¸£à¸£à¸¡à¸„à¸™à¹�à¸Šà¸£à¹Œà¹�à¸¥à¸°à¸™à¸±à¸�à¸ˆà¸´à¸•à¸§à¸´à¸—à¸¢à¸² social media

=== à¸‚à¹ˆà¸²à¸§à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œ ===
à¸«à¸±à¸§à¸‚à¹‰à¸­: ${actualNewsTitle || 'à¹„à¸¡à¹ˆà¸¡à¸µà¸«à¸±à¸§à¸‚à¹‰à¸­'}
à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸¢à¹ˆà¸­: ${(actualNewsBody || '').slice(0, 2500)}
=== à¸ˆà¸šà¸‚à¹ˆà¸²à¸§ ===

à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸‚à¹ˆà¸²à¸§à¸™à¸µà¹‰à¸­à¸­à¸�à¸¡à¸²à¹€à¸›à¹‡à¸™ JSON Format à¹‚à¸”à¸¢à¸¡à¸µà¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸”à¸±à¸‡à¸™à¸µà¹‰:
{
  "dna_type": "à¸›à¸£à¸°à¹€à¸ à¸—à¸«à¸¥à¸±à¸� (à¹€à¸¥à¸·à¸­à¸� 1 à¸ˆà¸²à¸�: à¸Šà¹ˆà¸§à¸¢à¹€à¸«à¸¥à¸·à¸­à¸�à¸±à¸™, à¸ªà¸¹à¹‰à¸Šà¸µà¸§à¸´à¸•, à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸„à¸£à¸­à¸šà¸„à¸£à¸±à¸§, à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡, à¸‚à¹ˆà¸²à¸§à¹€à¸•à¸·à¸­à¸™à¹ƒà¸ˆ, à¸‚à¹ˆà¸²à¸§à¸­à¸²à¸Šà¸�à¸²à¸�à¸£à¸£à¸¡, à¸„à¸§à¸²à¸¡à¸£à¸±à¸�, à¸­à¸šà¸­à¸¸à¹ˆà¸™à¹ƒà¸ˆ, à¸®à¸µà¹‚à¸£à¹ˆà¸Šà¸²à¸§à¸šà¹‰à¸²à¸™, à¸Šà¸µà¸§à¸´à¸•à¸žà¸¥à¸´à¸�à¸œà¸±à¸™)",
  "emotional_core": {
    "primary_emotion": "à¸­à¸²à¸£à¸¡à¸“à¹Œà¸«à¸¥à¸±à¸�à¸—à¸µà¹ˆà¸‚à¸±à¸šà¹€à¸„à¸¥à¸·à¹ˆà¸­à¸™à¸‚à¹ˆà¸²à¸§",
    "emotional_patterns": ["à¹€à¸«à¹‡à¸™à¹ƒà¸ˆ", "à¸ªà¸‡à¸ªà¸²à¸£", "à¹‚à¸�à¸£à¸˜", "à¹€à¸”à¸·à¸­à¸”", "à¸‹à¸¶à¹‰à¸‡", "à¸•à¸·à¹‰à¸™à¸•à¸±à¸™", "à¸�à¸¥à¸±à¸§", "à¸Šà¹‡à¸­à¸�", "à¸ à¸¹à¸¡à¸´à¹ƒà¸ˆ", "à¸„à¸²à¹ƒà¸ˆ", "à¹€à¸¨à¸£à¹‰à¸²", "à¸ªà¸™à¸¸à¸�", "à¹�à¸„à¹‰à¸™", "à¸«à¸§à¸²à¸”à¸�à¸¥à¸±à¸§"] // à¹€à¸¥à¸·à¸­à¸� 2-4 à¸„à¸³
  },
  "stop_scrolling_hook": {
    "hook_type": "à¸›à¸£à¸°à¹€à¸ à¸—à¸®à¸¸à¸„à¸—à¸µà¹ˆà¸„à¸™à¸™à¹ˆà¸²à¸ˆà¸°à¸«à¸¢à¸¸à¸”à¸”à¸¹ (à¹€à¸Šà¹ˆà¸™ à¸ªà¸‡à¸ªà¸²à¸£, à¸Šà¹‡à¸­à¸�, à¹€à¸ªà¸µà¸¢à¸”à¸²à¸¢, à¸­à¸¢à¸²à¸�à¸£à¸¹à¹‰)",
    "why_it_stops": "à¹€à¸«à¸•à¸¸à¸œà¸¥à¸ªà¸±à¹‰à¸™à¹† à¸§à¹ˆà¸²à¸—à¸³à¹„à¸¡à¸„à¸™à¸«à¸¢à¸¸à¸”à¸™à¸´à¹‰à¸§à¸­à¹ˆà¸²à¸™"
  },
  "comment_triggers": {
    "main_trigger": "à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸«à¸¥à¸±à¸�à¸—à¸µà¹ˆà¸Šà¸§à¸™à¸„à¸­à¸¡à¹€à¸¡à¸™à¸•à¹Œ",
    "triggers": ["à¸„à¸§à¸²à¸¡à¸­à¸¢à¸¸à¸•à¸´à¸˜à¸£à¸£à¸¡", "à¸�à¸²à¸£à¸•à¸±à¸”à¸ªà¸´à¸™", "à¸�à¸²à¸£à¸ªà¸¹à¸�à¹€à¸ªà¸µà¸¢", "à¸�à¸²à¸£à¸•à¹ˆà¸­à¸ªà¸¹à¹‰", "à¸„à¸§à¸²à¸¡à¸œà¸´à¸”à¸žà¸¥à¸²à¸”", "à¸�à¸²à¸£à¹€à¸­à¸²à¹€à¸›à¸£à¸µà¸¢à¸š", "à¸„à¸§à¸²à¸¡à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡"] // à¹€à¸¥à¸·à¸­à¸� 1-3 à¸„à¸³à¸—à¸µà¹ˆà¹€à¸›à¹‡à¸™à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡
  },
  "story_structure": {
    "narrative_archetype": "à¹‚à¸„à¸£à¸‡à¹€à¸£à¸·à¹ˆà¸­à¸‡ (à¹€à¸¥à¸·à¸­à¸� 1 à¸ˆà¸²à¸�: à¸ªà¸¹à¹‰à¸Šà¸µà¸§à¸´à¸•, à¸®à¸µà¹‚à¸£à¹ˆà¸Šà¸²à¸§à¸šà¹‰à¸²à¸™, à¹€à¸›à¸´à¸”à¹‚à¸›à¸‡, à¸™à¹‰à¸³à¹ƒà¸ˆà¸„à¸™à¹„à¸—à¸¢, à¸Šà¸µà¸§à¸´à¸•à¸žà¸¥à¸´à¸�à¸œà¸±à¸™, à¸œà¸¹à¹‰à¸–à¸¹à¸�à¸�à¸£à¸°à¸—à¸³, à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸„à¸£à¸­à¸šà¸„à¸£à¸±à¸§, à¸‚à¹ˆà¸²à¸§à¹€à¸•à¸·à¸­à¸™à¸ à¸±à¸¢)",
    "full_flow": "à¸­à¸˜à¸´à¸šà¸²à¸¢à¸ªà¸±à¹‰à¸™à¹† (à¹€à¸Šà¹ˆà¸™ Hook > à¹€à¸¥à¹ˆà¸²à¸›à¸¡ > à¸ˆà¸¸à¸”à¸žà¸µà¸„ > Ending)"
  },
  "visual_imagination": "à¸ à¸²à¸žà¸«à¸¥à¸±à¸�à¸—à¸µà¹ˆà¹€à¸�à¸´à¸”à¹ƒà¸™à¸«à¸±à¸§à¸„à¸™à¸­à¹ˆà¸²à¸™à¹€à¸§à¸¥à¸²à¸­à¹ˆà¸²à¸™à¸‚à¹ˆà¸²à¸§à¸™à¸µà¹‰",
  "share_triggers": {
    "triggers": ["à¸‚à¹‰à¸­à¸„à¸´à¸”", "à¹€à¸•à¸·à¸­à¸™à¸ à¸±à¸¢", "à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆ", "à¸­à¸¢à¸²à¸�à¸”à¹ˆà¸²", "à¸­à¸¢à¸²à¸�à¸Šà¸·à¹ˆà¸™à¸Šà¸¡"] // à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸¡à¸™à¸¸à¸©à¸¢à¹Œà¸—à¸µà¹ˆà¸Šà¸§à¸™à¹�à¸Šà¸£à¹Œ
  }
}`;

              // FIX H4: Route DNA Analyzer through aiRouter for fallback
              const { result: aiResult } = await callSmartAI('general', {
                temperature: 0.1,
                maxTokens: 1000,
                prompt: analyzerPrompt
              });
              
              // Map Deep DNA to legacy fields for compatibility with Stage 2 Cluster Match
              newsAnalysis = {
                ...aiResult,
                primaryCategory: aiResult?.dna_type || 'à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡',
                secondaryCategories: [aiResult?.story_structure?.narrative_archetype || ''],
                emotionalTags: aiResult?.emotional_core?.emotional_patterns || [],
                conflictTags: aiResult?.comment_triggers?.triggers || [],
                narrativeArchetype: aiResult?.story_structure?.narrative_archetype || '',
                viralHooks: [aiResult?.stop_scrolling_hook?.hook_type || 'à¸—à¸±à¹ˆà¸§à¹„à¸›'],
                humanAngles: aiResult?.share_triggers?.triggers || []
              };
              
              newsTypeDetected = newsAnalysis.primaryCategory || '';
              console.log(`[Analyze-Service] ðŸ§  STAGE 1: Deep DNA Analysis complete. Type: ${newsTypeDetected}`);
            } catch (analyzErr) {
              console.warn('[Analyze-Service] STAGE 1 Analysis failed, using fallback:', analyzErr.message);
              newsAnalysis = {
                dna_type: 'à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡',
                emotional_core: { primary_emotion: 'à¹€à¸«à¹‡à¸™à¹ƒà¸ˆ', emotional_patterns: ['à¹€à¸«à¹‡à¸™à¹ƒà¸ˆ', 'à¸„à¸²à¹ƒà¸ˆ'] },
                stop_scrolling_hook: { hook_type: 'à¸”à¸£à¸²à¸¡à¹ˆà¸²', why_it_stops: 'à¸„à¸§à¸²à¸¡à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡à¸—à¸µà¹ˆà¸™à¹ˆà¸²à¸•à¸´à¸”à¸•à¸²à¸¡' },
                comment_triggers: { main_trigger: 'à¸‚à¹‰à¸­à¸žà¸´à¸žà¸²à¸—', triggers: ['à¸„à¸§à¸²à¸¡à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡'] },
                story_structure: { narrative_archetype: 'à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡', full_flow: 'à¹€à¸›à¸´à¸”à¸›à¸£à¸°à¹€à¸”à¹‡à¸™ > à¸–à¸�à¹€à¸–à¸µà¸¢à¸‡' },
                visual_imagination: 'à¸ à¸²à¸žà¸„à¸™à¸—à¸°à¹€à¸¥à¸²à¸°à¸�à¸±à¸™à¸«à¸£à¸·à¸­à¸¡à¸µà¸‚à¹‰à¸­à¸žà¸´à¸žà¸²à¸—',
                share_triggers: { triggers: ['à¸­à¸¢à¸²à¸�à¸”à¹ˆà¸²', 'à¹€à¸•à¸·à¸­à¸™à¸ à¸±à¸¢'] },
                // legacy
                primaryCategory: 'à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡',
                secondaryCategories: ['à¸ªà¸¹à¹‰à¸Šà¸µà¸§à¸´à¸•'],
                emotionalTags: ['à¹€à¸«à¹‡à¸™à¹ƒà¸ˆ', 'à¸„à¸²à¹ƒà¸ˆ'],
                conflictTags: ['à¸„à¸§à¸²à¸¡à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡'],
                narrativeArchetype: 'à¸ªà¸¹à¹‰à¸Šà¸µà¸§à¸´à¸•',
                viralHooks: ['à¸”à¸£à¸²à¸¡à¹ˆà¸²'],
                humanAngles: ['à¸œà¸¥à¸�à¸£à¸°à¸—à¸š'],
              };
              newsTypeDetected = 'à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡';
            }
          }

          // --- STAGE 2: CLUSTER-BASED HYBRID SCORER & MATCHER (JS ENGINE v2) ---
          console.log(`[Analyze-Service] ðŸ§  STAGE 2: Cluster-Based Hybrid prompt scoring for ${validPrompts.length} candidates...`);
          
          try {
            const nPrimary = newsAnalysis?.primaryCategory || '';
            const nSecondary = (newsAnalysis?.secondaryCategories || []).map(s => String(s));
            const nEmos = (newsAnalysis?.emotionalTags || newsAnalysis?.emotionalThemes || []).map(e => String(e));
            const nConflicts = (newsAnalysis?.conflictTags || newsAnalysis?.conflictTypes || []).map(c => String(c));
            const nArchetype = newsAnalysis?.narrativeArchetype || '';
            const nHooks = (newsAnalysis?.viralHooks || []).map(h => String(h).toLowerCase());

            const scoredPrompts = validPrompts.map((p, index) => {
              let score = 0;
              let dims = [];

              // 1. Category Match (max 30)
              const pCat = mapCategory(p.category || '');
              const mappedPrimary = mapCategory(nPrimary);
              if (pCat && mappedPrimary && pCat === mappedPrimary) {
                score += 30; dims.push('category');
              } else if (pCat && mappedPrimary) {
                const catCluster = clusterMatch(pCat, mappedPrimary, CONFLICT_CLUSTERS);
                if (catCluster === 'cluster') {
                  score += 20; dims.push('category(cluster)');
                } else if (nSecondary.some(s => mapCategory(s) === pCat)) {
                  score += 10; dims.push('category(secondary)');
                }
              }

              // 2. Emotional Match (max 25) â€” cluster-based +12 per tag
              let emoScore = 0;
              const pEmoTags = (p.emotionalTags && Array.isArray(p.emotionalTags) && p.emotionalTags.length > 0)
                ? p.emotionalTags
                : ((p.emotionalType || '') + ' ' + (p.tone || '')).split(/[\s,|/]+/).filter(w => w.length > 1);
              for (const nEmo of nEmos) {
                for (const pTag of pEmoTags) {
                  const result = clusterMatch(pTag, nEmo, EMOTION_CLUSTERS);
                  if (result) { emoScore += 12; break; }
                }
              }
              if (emoScore > 25) emoScore = 25;
              if (emoScore > 0) { score += emoScore; dims.push('emotional'); }

              // 3. Conflict Match (max 15) â€” cluster-based +8 per tag
              let conflictScore = 0;
              const pConflictTags = (p.conflictTags && Array.isArray(p.conflictTags) && p.conflictTags.length > 0)
                ? p.conflictTags
                : ((p.promptName || '') + ' ' + (p.structure || '')).split(/[\s,|/]+/).filter(w => w.length > 2);
              for (const nConf of nConflicts) {
                for (const pTag of pConflictTags) {
                  const result = clusterMatch(pTag, nConf, CONFLICT_CLUSTERS);
                  if (result) { conflictScore += 8; break; }
                }
              }
              if (conflictScore > 15) conflictScore = 15;
              if (conflictScore > 0) { score += conflictScore; dims.push('conflict'); }

              // 4. Narrative Archetype Match (max 15) â€” enum match
              const pArchetype = (p.narrativeArchetype || p.structure || '').toLowerCase();
              let archScore = 0;
              if (pArchetype && nArchetype) {
                const nArchLower = nArchetype.toLowerCase();
                if (pArchetype === nArchLower || pArchetype.includes(nArchLower) || nArchLower.includes(pArchetype)) {
                  archScore = 15;
                  dims.push('archetype');
                } else {
                  const archWords = nArchLower.split(/[\s,|/]+/).filter(w => w.length > 2);
                  let archMatches = 0;
                  archWords.forEach(w => { if (pArchetype.includes(w)) archMatches++; });
                  archScore = Math.min(15, archMatches * 5);
                  if (archScore > 0) dims.push('archetype(partial)');
                }
              }
              score += archScore;

              // 5. Viral Hook Match (max 5)
              const pHook = (p.hookStyle || '').toLowerCase();
              let hookScore = 0;
              if (pHook) {
                for (const h of nHooks) {
                  if (h && (pHook.includes(h) || h.includes(pHook))) { hookScore += 5; break; }
                  const hw = h.split(/[\s,|/]+/).filter(w => w.length > 2);
                  if (hw.some(w => pHook.includes(w))) { hookScore += 3; break; }
                }
              }
              if (hookScore > 5) hookScore = 5;
              if (hookScore > 0) { score += hookScore; dims.push('hook'); }

              // 6. Historical Performance (max 10)
              let viral = Number(p.viralScore);
              if (isNaN(viral)) viral = 70;
              const successRate = Number(p.successRate);
              let histScore = viral * 0.05;
              if (!isNaN(successRate) && successRate > 0) histScore += successRate * 5;
              if (histScore > 10) histScore = 10;
              score += histScore;

              // 7. Cross-Dimensional Boost
              const uniqueDims = [...new Set(dims.map(d => d.replace(/\(.*\)/, '')))]; // strip (partial) etc.
              if (score > 0) {
                // Boost: category>=20 AND emotional>=12
                const catScore = dims.some(d => d.startsWith('category')) ? (dims.includes('category') ? 30 : 20) : 0;
                if (catScore >= 20 && emoScore >= 12) {
                  score += 10;
                  dims.push('boost(cat+emo)');
                }
                // Boost: 3+ dimensions matched
                if (uniqueDims.length >= 3) {
                  score += 5;
                  dims.push('boost(multi-dim)');
                }
              }

              return { index, score, dims: [...new Set(dims)] };
            });

            // à¹€à¸£à¸µà¸¢à¸‡à¸ˆà¸²à¸�à¸„à¸°à¹�à¸™à¸™à¸¡à¸²à¸�à¹„à¸›à¸™à¹‰à¸­à¸¢
            scoredPrompts.sort((a, b) => b.score - a.score);

            top10PromptScores = scoredPrompts.slice(0, 10).map(s => {
              const pr = validPrompts[s.index];
              const sDims = s.dims.filter(d => !d.startsWith('boost'));
              return {
                id: pr.id,
                name: pr.promptName,
                score: s.score,
                matchType: (s.score >= 60 && sDims.length >= 2) ? 'EXACT' : s.score >= 40 ? 'CLOSE' : 'BORROWED',
                matchedDimensions: s.dims,
                reason: `Cluster Score: ${s.score.toFixed(1)}`
              };
            });

            const winner = scoredPrompts[0];
            
            if (winner) {
              const selectedIndex = winner.index;
              selectedPromptScore = winner.score;
              matchedDimensions = winner.dims;
              const coreDims = matchedDimensions.filter(d => !d.startsWith('boost'));
              
              // à¸�à¸Žà¸�à¸²à¸£à¸•à¸±à¸”à¹€à¸�à¸£à¸” MatchType (updated thresholds)
              if (selectedPromptScore >= 60 && coreDims.length >= 2) {
                matchType = 'EXACT';
              } else if (selectedPromptScore >= 40) {
                matchType = 'CLOSE';
              } else {
                matchType = 'BORROWED';
              }

              const matchReason = `Cluster Score: ${selectedPromptScore.toFixed(1)}/100`;

              const matchLabel = matchType === 'EXACT' ? 'âœ… EXACT MATCH' : (matchType === 'CLOSE' ? 'âš ï¸� CLOSE MATCH' : 'â�Œ BORROWED (FALLBACK)');
              console.log(`[ðŸ§  CLUSTER SCORE ENGINE v2] ${matchLabel} | Score: ${selectedPromptScore.toFixed(1)}/100`);
              console.log(`[ðŸ§  CLUSTER SCORE ENGINE v2] Chosen Index: ${selectedIndex}/${validPrompts.length - 1} | Dimensions: ${matchedDimensions.join(', ')}`);

              smartPrompt = validPrompts[selectedIndex];
              promptSource = 'library';
              
              const isBorrowed = matchType === 'BORROWED';
              smartPrompt._isBorrowed = isBorrowed;
              smartPrompt._borrowReason = isBorrowed ? matchReason : null;
              smartPrompt._matchScore = selectedPromptScore;
              smartPrompt._matchType = matchType;
              smartPrompt._matchedDimensions = matchedDimensions;

              promptMatchReason = isBorrowed
                ? `âš ï¸� à¹„à¸¡à¹ˆà¸¡à¸µ Prompt à¸•à¸£à¸‡à¹�à¸™à¸§à¸‚à¹ˆà¸²à¸§${newsTypeDetected} â€” à¸¢à¸·à¸¡ Prompt à¹ƒà¸�à¸¥à¹‰à¹€à¸„à¸µà¸¢à¸‡: "${smartPrompt.promptName}" (Score: ${selectedPromptScore.toFixed(1)}/100, Match: ${matchType})`
                : `ðŸ§  Cluster Match: "${smartPrompt.promptName}" (Score: ${selectedPromptScore.toFixed(1)}/100, Match: ${matchType}, Dimensions: ${matchedDimensions.join(', ')})`;
                
              smartPrompt.usageCount = (smartPrompt.usageCount || 0) + 1;
              smartPrompt.lastUsedAt = new Date().toISOString();
            } else {
              promptMatchReason = `ðŸ§  Engine: à¸„à¹‰à¸™à¸«à¸² Prompt à¹„à¸¡à¹ˆà¸žà¸šà¹ƒà¸™à¸«à¸­à¸ªà¸¡à¸¸à¸” â€” à¸”à¸³à¹€à¸™à¸´à¸™à¸�à¸²à¸£à¸¢à¹‰à¸²à¸¢à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆ built-in fallback`;
            }
          } catch (scorerErr) {
            console.error('[Analyze-Service] STAGE 2 Engine failed:', scorerErr.message);
            promptMatchReason = `Engine match error: ${scorerErr.message}`;
          }

          // --- STAGE 2.5: AI SEMANTIC FALLBACK (Gemini Flash) ---
          // Only triggers when Stage 2 result is BORROWED (score < 40)
          if (matchType === 'BORROWED' && smartPrompt && top10PromptScores.length > 0) {
            console.log(`[Analyze-Service] ðŸ¤– STAGE 2.5: AI Semantic Fallback triggered (matchType=BORROWED, score=${selectedPromptScore.toFixed(1)})`);
            try {
              const top5Candidates = top10PromptScores.slice(0, 5);
              const candidateList = top5Candidates.map((c, i) => 
                `${i + 1}. "${c.name}" (id: ${c.id}) â€” Score: ${c.score.toFixed(1)}, Dimensions: ${c.matchedDimensions.join(', ')}`
              ).join('\n');

              const aiFallbackPrompt = `à¸„à¸¸à¸“à¹€à¸›à¹‡à¸™à¸œà¸¹à¹‰à¹€à¸Šà¸µà¹ˆà¸¢à¸§à¸Šà¸²à¸�à¸�à¸²à¸£à¹€à¸¥à¸·à¸­à¸� prompt à¸ªà¸³à¸«à¸£à¸±à¸šà¹€à¸‚à¸µà¸¢à¸™à¸‚à¹ˆà¸²à¸§à¹„à¸§à¸£à¸±à¸¥

=== à¸‚à¹ˆà¸²à¸§ ===
à¸«à¸±à¸§à¸‚à¹‰à¸­: ${actualNewsTitle || 'à¹„à¸¡à¹ˆà¸¡à¸µà¸«à¸±à¸§à¸‚à¹‰à¸­'}
à¸«à¸¡à¸§à¸”à¸«à¸¡à¸¹à¹ˆ: ${newsTypeDetected}
à¸­à¸²à¸£à¸¡à¸“à¹Œ: ${(newsAnalysis?.emotionalTags || newsAnalysis?.emotionalThemes || []).join(', ')}
à¸„à¸§à¸²à¸¡à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡: ${(newsAnalysis?.conflictTags || newsAnalysis?.conflictTypes || []).join(', ')}
Archetype: ${newsAnalysis?.narrativeArchetype || '-'}
=== à¸ˆà¸šà¸‚à¹ˆà¸²à¸§ ===

=== à¸•à¸±à¸§à¹€à¸¥à¸·à¸­à¸� Prompt (Top 5) ===
${candidateList}
=== à¸ˆà¸šà¸•à¸±à¸§à¹€à¸¥à¸·à¸­à¸� ===

à¸ˆà¸²à¸� prompt à¸—à¸±à¹‰à¸‡ 5 à¸•à¸±à¸§à¹€à¸¥à¸·à¸­à¸�à¸”à¹‰à¸²à¸™à¸šà¸™ à¹€à¸¥à¸·à¸­à¸� 1 à¸•à¸±à¸§à¸—à¸µà¹ˆà¹€à¸«à¸¡à¸²à¸°à¸ªà¸¡à¸—à¸µà¹ˆà¸ªà¸¸à¸”à¸ªà¸³à¸«à¸£à¸±à¸šà¸‚à¹ˆà¸²à¸§à¸™à¸µà¹‰
à¸•à¸­à¸šà¹€à¸›à¹‡à¸™ JSON: { "selectedIndex": <1-5>, "reason": "..." }`;

              const { callGemini, isGeminiAvailable } = await import('@/lib/ai/geminiClient');
              let aiSelection = null;
              if (isGeminiAvailable()) {
                aiSelection = await callGemini({
                  prompt: aiFallbackPrompt,
                  model: 'gemini-2.5-flash',
                  temperature: 0.1,
                  maxTokens: 300,
                });
              } else {
                // Fallback to callAI if Gemini not available
                aiSelection = await callAI({
                  prompt: aiFallbackPrompt,
                  model: 'gpt-4o-mini',
                  temperature: 0.1,
                  maxTokens: 300,
                });
              }

              if (aiSelection && aiSelection.selectedIndex >= 1 && aiSelection.selectedIndex <= 5) {
                const aiPickIdx = aiSelection.selectedIndex - 1;
                const aiPickedCandidate = top5Candidates[aiPickIdx];
                const aiPickedPrompt = validPrompts.find(vp => vp.id === aiPickedCandidate.id);

                if (aiPickedPrompt && aiPickedPrompt.id !== smartPrompt.id) {
                  console.log(`[ðŸ¤– STAGE 2.5] AI picked different prompt: "${aiPickedCandidate.name}" (was: "${smartPrompt.promptName}") â€” Reason: ${aiSelection.reason || '-'}`);
                  smartPrompt = aiPickedPrompt;
                  promptSource = 'library(ai-fallback)';
                  smartPrompt._isBorrowed = true;
                  smartPrompt._borrowReason = `AI Fallback: ${aiSelection.reason || 'Gemini selected'}`;
                  smartPrompt._matchScore = aiPickedCandidate.score;
                  smartPrompt._matchType = 'BORROWED(AI)';
                  smartPrompt._matchedDimensions = aiPickedCandidate.matchedDimensions;
                  promptMatchReason = `ðŸ¤– AI Fallback: "${smartPrompt.promptName}" (AI Reason: ${aiSelection.reason || '-'}, Original Score: ${selectedPromptScore.toFixed(1)})`;
                } else {
                  console.log(`[ðŸ¤– STAGE 2.5] AI confirmed original pick: "${smartPrompt.promptName}"`);
                }
              } else {
                console.log(`[ðŸ¤– STAGE 2.5] AI returned invalid selection, keeping original pick`);
              }
            } catch (aiFallbackErr) {
              console.warn('[Analyze-Service] STAGE 2.5 AI Fallback failed (keeping Stage 2 result):', aiFallbackErr.message);
            }
          }
        } else {
          promptMatchReason = 'PROMPT_LIBRARY_MISSING â€” à¹ƒà¸Šà¹‰ built-in fallback V12';
          smartPrompt = {
            id: 'fallback_builtin', promptName: 'Built-in Fallback V12',
            category: 'à¸—à¸±à¹ˆà¸§à¹„à¸›', emotionalType: 'à¸ªà¸²à¸£à¸°à¸™à¹ˆà¸²à¸ªà¸™à¹ƒà¸ˆ', viralScore: 70,
            promptText: '=== ðŸ�›ï¸� # FINAL MASTER PROMPT â€” HUMAN VIRAL FACEBOOK NEWS ENGINE V12 ===\n' +
              'à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸™à¸±à¸�à¹€à¸‚à¸µà¸¢à¸™à¸šà¸—à¸„à¸§à¸²à¸¡ | à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸™à¸±à¸�à¸ªà¸£à¸¸à¸›à¸Šà¸µà¸§à¸´à¸• | à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸™à¸±à¸�à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸ªà¸±à¸‡à¸„à¸¡ | à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸™à¸±à¸�à¹€à¸‚à¸µà¸¢à¸™à¸„à¸­à¸¥à¸±à¸¡à¸™à¹Œ\n' +
              'à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ narrator à¸«à¸™à¸±à¸‡ | à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ AI motivational writer\n\n' +
              'à¸„à¸¸à¸“à¸„à¸·à¸­: "à¸„à¸™à¸—à¸µà¹ˆà¸­à¸¢à¸¹à¹ˆà¹ƒà¸™à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸ˆà¸£à¸´à¸‡ à¹�à¸¥à¹‰à¸§à¸�à¸³à¸¥à¸±à¸‡à¹€à¸¥à¹ˆà¸²à¹€à¸£à¸·à¹ˆà¸­à¸‡à¹ƒà¸«à¹‰à¸„à¸™à¸šà¸™ Facebook à¸Ÿà¸±à¸‡"\n\n' +
              '=== CORE HUMAN DNA & ABSOLUTE RULES ===\n' +
              '- RULE 1 â€” à¸«à¹‰à¸²à¸¡à¸­à¸˜à¸´à¸šà¸²à¸¢à¸­à¸²à¸£à¸¡à¸“à¹Œ (à¹ƒà¸«à¹‰à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”/à¸ à¸²à¸žà¹�à¸—à¸™ à¹€à¸Šà¹ˆà¸™ "à¹„à¸¡à¹ˆà¸¡à¸µà¹ƒà¸„à¸£à¸žà¸¹à¸”à¸­à¸°à¹„à¸£à¸­à¸¢à¸¹à¹ˆà¸žà¸±à¸�à¹ƒà¸«à¸�à¹ˆ" à¹�à¸—à¸™ "à¸—à¸¸à¸�à¸„à¸™à¹€à¸¨à¸£à¹‰à¸²")\n' +
              '- RULE 2 â€” à¸«à¹‰à¸²à¸¡ narrator à¸­à¹ˆà¸²à¸™à¹ƒà¸ˆà¸•à¸±à¸§à¸¥à¸°à¸„à¸£ (à¹ƒà¸Šà¹‰ quote, à¸ªà¸µà¸«à¸™à¹‰à¸², silence, action à¸ˆà¸£à¸´à¸‡)\n' +
              '- RULE 3 â€” à¸«à¹‰à¸²à¸¡à¸ªà¸£à¸¸à¸›à¸‚à¹‰à¸­à¸„à¸´à¸”à¸Šà¸µà¸§à¸´à¸• (à¸«à¹‰à¸²à¸¡à¸ªà¸­à¸™à¸„à¸™à¸­à¹ˆà¸²à¸™, à¸«à¹‰à¸²à¸¡à¸žà¸¹à¸”à¸§à¹ˆà¸² "à¸„à¸§à¸²à¸¡à¸£à¸±à¸�à¸—à¸µà¹ˆà¹�à¸—à¹‰à¸ˆà¸£à¸´à¸‡à¸„à¸·à¸­...")\n' +
              '- RULE 4 â€” à¸«à¹‰à¸²à¸¡ cinematic AI narration (à¸«à¹‰à¸²à¸¡à¸„à¸³à¸«à¸£à¸¹à¸«à¸£à¸²à¸—à¸µà¹ˆà¸”à¸¹à¹€à¸«à¸¡à¸·à¸­à¸™ AI à¹€à¸Šà¹ˆà¸™ "à¸§à¸´à¸™à¸²à¸—à¸µà¸—à¸µà¹ˆà¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸—à¸¸à¸�à¸­à¸¢à¹ˆà¸²à¸‡")\n' +
              '- RULE 5 â€” à¸«à¹‰à¸²à¸¡ moralize (à¹ƒà¸«à¹‰à¹€à¸¥à¹ˆà¸²à¹�à¸¥à¹‰à¸§à¸›à¸¥à¹ˆà¸­à¸¢à¸„à¸™à¸­à¹ˆà¸²à¸™à¸„à¸´à¸”à¹€à¸­à¸‡à¸­à¸¢à¹ˆà¸²à¸‡à¸­à¸´à¸ªà¸£à¸°)\n\n' +
              '=== HUMAN DETAIL ENGINE & SILENCE ===\n' +
              '- à¸—à¸¸à¸�à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸£à¸²à¸§à¸•à¹‰à¸­à¸‡à¸¡à¸µ object à¸ˆà¸£à¸´à¸‡, gesture à¸ˆà¸£à¸´à¸‡, à¹�à¸¥à¸°à¸„à¸§à¸²à¸¡à¹€à¸‡à¸µà¸¢à¸š (à¹€à¸Šà¹ˆà¸™ "à¹€à¸�à¹‰à¸²à¸­à¸µà¹‰à¸žà¸¥à¸²à¸ªà¸•à¸´à¸�", "à¸¡à¸·à¸­à¸ªà¸±à¹ˆà¸™", "à¹€à¸‡à¸µà¸¢à¸šà¹„à¸›à¸žà¸±à¸�à¸«à¸™à¸¶à¹ˆà¸‡")\n' +
              '- à¹ƒà¸Šà¹‰à¸›à¸£à¸°à¹‚à¸¢à¸„à¸ªà¸±à¹‰à¸™à¸�à¸£à¸°à¸Šà¸±à¸šà¸—à¸µà¹ˆà¸¡à¸µà¸™à¹‰à¸³à¸«à¸™à¸±à¸�à¸ªà¸¹à¸‡ à¹€à¸¥à¹ˆà¸²à¹€à¸«à¸¡à¸·à¸­à¸™à¹‚à¸žà¸ªà¸•à¹Œà¸ˆà¸£à¸´à¸‡à¸šà¸™ Facebook\n' +
              '- à¹€à¸¥à¹ˆà¸²à¹‚à¸”à¸¢à¹€à¸„à¸²à¸£à¸žà¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡ 100% à¸«à¹‰à¸²à¸¡à¹€à¸•à¸´à¸¡à¹�à¸•à¹ˆà¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸”à¹‡à¸”à¸‚à¸²à¸”',
            _isFallback: true,
          };
          promptSource = 'fallback';
        }
      } catch (err) {
        promptMatchReason = 'AI_MATCH_ERROR: ' + err.message;
        console.warn('[Analyze-Service] Smart Match error:', err.message);
      }
    }

    if (!smartPrompt) {
      smartPrompt = {
        id: 'fallback_builtin', promptName: 'Built-in Fallback V12 (Auto)',
        category: 'à¸—à¸±à¹ˆà¸§à¹„à¸›', viralScore: 70,
        promptText: '=== ðŸ�›ï¸� # FINAL MASTER PROMPT â€” HUMAN VIRAL FACEBOOK NEWS ENGINE V12 ===\n' +
          'à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸™à¸±à¸�à¹€à¸‚à¸µà¸¢à¸™à¸šà¸—à¸„à¸§à¸²à¸¡ | à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸™à¸±à¸�à¸ªà¸£à¸¸à¸›à¸Šà¸µà¸§à¸´à¸• | à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸™à¸±à¸�à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸ªà¸±à¸‡à¸„à¸¡ | à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸™à¸±à¸�à¹€à¸‚à¸µà¸¢à¸™à¸„à¸­à¸¥à¸±à¸¡à¸™à¹Œ\n' +
          'à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ narrator à¸«à¸™à¸±à¸‡ | à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ AI motivational writer\n\n' +
          'à¸„à¸¸à¸“à¸„à¸·à¸­: "à¸„à¸™à¸—à¸µà¹ˆà¸­à¸¢à¸¹à¹ˆà¹ƒà¸™à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸ˆà¸£à¸´à¸‡ à¹�à¸¥à¹‰à¸§à¸�à¸³à¸¥à¸±à¸‡à¹€à¸¥à¹ˆà¸²à¹€à¸£à¸·à¹ˆà¸­à¸‡à¹ƒà¸«à¹‰à¸„à¸™à¸šà¸™ Facebook à¸Ÿà¸±à¸‡"\n\n' +
          '=== CORE HUMAN DNA & ABSOLUTE RULES ===\n' +
          '- RULE 1 â€” à¸«à¹‰à¸²à¸¡à¸­à¸˜à¸´à¸šà¸²à¸¢à¸­à¸²à¸£à¸¡à¸“à¹Œ (à¹ƒà¸«à¹‰à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”/à¸ à¸²à¸žà¹�à¸—à¸™ à¹€à¸Šà¹ˆà¸™ "à¹„à¸¡à¹ˆà¸¡à¸µà¹ƒà¸„à¸£à¸žà¸¹à¸”à¸­à¸°à¹„à¸£à¸­à¸¢à¸¹à¹ˆà¸žà¸±à¸�à¹ƒà¸«à¸�à¹ˆ" à¹�à¸—à¸™ "à¸—à¸¸à¸�à¸„à¸™à¹€à¸¨à¸£à¹‰à¸²")\n' +
          '- RULE 2 â€” à¸«à¹‰à¸²à¸¡ narrator à¸­à¹ˆà¸²à¸™à¹ƒà¸ˆà¸•à¸±à¸§à¸¥à¸°à¸„à¸£ (à¹ƒà¸Šà¹‰ quote, à¸ªà¸µà¸«à¸™à¹‰à¸², silence, action à¸ˆà¸£à¸´à¸‡)\n' +
          '- RULE 3 â€” à¸«à¹‰à¸²à¸¡à¸ªà¸£à¸¸à¸›à¸‚à¹‰à¸­à¸„à¸´à¸”à¸Šà¸µà¸§à¸´à¸• (à¸«à¹‰à¸²à¸¡à¸ªà¸­à¸™à¸„à¸™à¸­à¹ˆà¸²à¸™, à¸«à¹‰à¸²à¸¡à¸žà¸¹à¸”à¸§à¹ˆà¸² "à¸„à¸§à¸²à¸¡à¸£à¸±à¸�à¸—à¸µà¹ˆà¹�à¸—à¹‰à¸ˆà¸£à¸´à¸‡à¸„à¸·à¸­...")\n' +
          '- RULE 4 â€” à¸«à¹‰à¸²à¸¡ cinematic AI narration (à¸«à¹‰à¸²à¸¡à¸„à¸³à¸«à¸£à¸¹à¸«à¸£à¸²à¸—à¸µà¹ˆà¸”à¸¹à¹€à¸«à¸¡à¸·à¸­à¸™ AI à¹€à¸Šà¹ˆà¸™ "à¸§à¸´à¸™à¸²à¸—à¸µà¸—à¸µà¹ˆà¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸—à¸¸à¸�à¸­à¸¢à¹ˆà¸²à¸‡")\n' +
          '- RULE 5 â€” à¸«à¹‰à¸²à¸¡ moralize (à¹ƒà¸«à¹‰à¹€à¸¥à¹ˆà¸²à¹�à¸¥à¹‰à¸§à¸›à¸¥à¹ˆà¸­à¸¢à¸„à¸™à¸­à¹ˆà¸²à¸™à¸„à¸´à¸”à¹€à¸­à¸‡à¸­à¸¢à¹ˆà¸²à¸‡à¸­à¸´à¸ªà¸£à¸°)\n\n' +
          '=== HUMAN DETAIL ENGINE & SILENCE ===\n' +
          '- à¸—à¸¸à¸�à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸£à¸²à¸§à¸•à¹‰à¸­à¸‡à¸¡à¸µ object à¸ˆà¸£à¸´à¸‡, gesture à¸ˆà¸£à¸´à¸‡, à¹�à¸¥à¸°à¸„à¸§à¸²à¸¡à¹€à¸‡à¸µà¸¢à¸š (à¹€à¸Šà¹ˆà¸™ "à¹€à¸�à¹‰à¸²à¸­à¸µà¹‰à¸žà¸¥à¸²à¸ªà¸•à¸´à¸�", "à¸¡à¸·à¸­à¸ªà¸±à¹ˆà¸™", "à¹€à¸‡à¸µà¸¢à¸šà¹„à¸›à¸žà¸±à¸�à¸«à¸™à¸¶à¹ˆà¸‡")\n' +
          '- à¹ƒà¸Šà¹‰à¸›à¸£à¸°à¹‚à¸¢à¸„à¸ªà¸±à¹‰à¸™à¸�à¸£à¸°à¸Šà¸±à¸šà¸—à¸µà¹ˆà¸¡à¸µà¸™à¹‰à¸³à¸«à¸™à¸±à¸�à¸ªà¸¹à¸‡ à¹€à¸¥à¹ˆà¸²à¹€à¸«à¸¡à¸·à¸­à¸™à¹‚à¸žà¸ªà¸•à¹Œà¸ˆà¸£à¸´à¸‡à¸šà¸™ Facebook\n' +
          '- à¹€à¸¥à¹ˆà¸²à¹‚à¸”à¸¢à¹€à¸„à¸²à¸£à¸žà¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡ 100% à¸«à¹‰à¸²à¸¡à¹€à¸•à¸´à¸¡à¹�à¸•à¹ˆà¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸”à¹‡à¸”à¸‚à¸²à¸”',
        _isFallback: true,
      };
      promptSource = 'fallback';
    }

    // Build Narrative Payload (Enriched with 5th argument: actualNewsBody)
    let narrativePayload = buildNarrativePayload(actualNewsTitle, actualBreakdown, researchData, emotionalBlueprint, actualNewsBody);
    console.log(`[Analyze-Service] ðŸ”„ NARRATIVE PAYLOAD built: sourceRemoved=true | facts=${narrativePayload.coreFacts.length} | research=${narrativePayload.researchContexts.length} | quotes=${narrativePayload.quoteFragments.length}`);

    // Dynamic Word Count Scaling
    if (narrativePayload && (narrativePayload.factSufficiency === 'minimal' || narrativePayload.factSufficiency === 'insufficient')) {
      lenCfg = lengthConfig.short;
      console.log(`[Analyze-Service] âš ï¸� Fact sufficiency is ${narrativePayload.factSufficiency}. Overriding length config to short to prevent AI filler.`);
    }

    let prompt = '';
    if (smartPrompt && smartPrompt.promptText) {
      prompt = '=== ðŸ�›ï¸� à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¹€à¸‚à¸µà¸¢à¸™à¸ˆà¸²à¸�à¸«à¸­à¸ªà¸¡à¸¸à¸”à¹„à¸§à¸£à¸±à¸¥ ===\n' +
        `à¸›à¸£à¸°à¹€à¸ à¸—: ${smartPrompt.category || '-'} | à¸­à¸²à¸£à¸¡à¸“à¹Œ: ${smartPrompt.emotionalType || smartPrompt.emotionalTags?.[0] || '-'} | Viral Score: ${smartPrompt.viralScore || '-'}\n` +
        `à¸ªà¹„à¸•à¸¥à¹Œ Hook: ${smartPrompt.hookStyle || '-'} | à¹‚à¸—à¸™: ${smartPrompt.tone || '-'}\n` +
        `à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡: ${smartPrompt.structure || '-'}\n\n`;

      if (smartPrompt.exampleHooks && Array.isArray(smartPrompt.exampleHooks) && smartPrompt.exampleHooks.length > 0) {
        prompt += '--- ðŸª� à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸›à¸´à¸”à¹€à¸£à¸·à¹ˆà¸­à¸‡ (Hook Examples) ---\n' +
          'à¹ƒà¸«à¹‰à¸™à¸³ "à¸ªà¹„à¸•à¸¥à¹Œà¹�à¸¥à¸°à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡" à¸ˆà¸²à¸�à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸«à¸¥à¹ˆà¸²à¸™à¸µà¹‰à¹„à¸›à¸›à¸£à¸°à¸¢à¸¸à¸�à¸•à¹Œà¹ƒà¸Šà¹‰ à¸«à¹‰à¸²à¸¡à¸¥à¸­à¸�à¹€à¸¥à¸µà¸¢à¸™à¹�à¸šà¸šà¸„à¸³à¸¨à¸±à¸žà¸—à¹Œà¸—à¸µà¹ˆà¸œà¸´à¸”à¸šà¸£à¸´à¸šà¸—à¸ˆà¸²à¸�à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸‚à¹ˆà¸²à¸§à¸ˆà¸£à¸´à¸‡à¹€à¸”à¹‡à¸”à¸‚à¸²à¸” (à¹€à¸Šà¹ˆà¸™ à¸«à¹‰à¸²à¸¡à¸™à¸³à¸¨à¸±à¸žà¸—à¹Œà¸‚à¸­à¸‡à¸ªà¸±à¸•à¸§à¹Œà¹€à¸¥à¸µà¹‰à¸¢à¸‡à¸¡à¸²à¹ƒà¸Šà¹‰à¸�à¸±à¸šà¸„à¸™):\n' +
          smartPrompt.exampleHooks.map((h, i) => `${i + 1}. "${h}"`).join('\n') + '\n\n';
      }

      if (smartPrompt.ctaStyle) {
        prompt += '--- ðŸ“£ à¸ªà¹„à¸•à¸¥à¹Œà¸�à¸²à¸£à¸›à¸´à¸”à¸—à¹‰à¸²à¸¢ (CTA Style) ---\n' +
          `à¹€à¸›à¹‰à¸²à¸«à¸¡à¸²à¸¢à¸•à¸­à¸™à¸ˆà¸š: ${smartPrompt.ctaStyle}\n\n`;
      }

      prompt += '--- âœ�ï¸� à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸ªà¹„à¸•à¸¥à¹Œà¸�à¸²à¸£à¹€à¸‚à¸µà¸¢à¸™ (Master Rules) ---\n' +
        'âš ï¸� à¸„à¸³à¹€à¸•à¸·à¸­à¸™à¸ªà¸³à¸„à¸±à¸� (ANTI-HALLUCINATION): à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸ªà¹„à¸•à¸¥à¹Œà¸«à¸£à¸·à¸­ "à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡" à¸”à¹‰à¸²à¸™à¸¥à¹ˆà¸²à¸‡à¸™à¸µà¹‰ à¸­à¸²à¸ˆà¸¡à¸µà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸¡à¸¡à¸•à¸´ à¹€à¸Šà¹ˆà¸™ à¸Šà¸·à¹ˆà¸­à¸šà¸¸à¸„à¸„à¸¥ (à¹�à¸¡à¹ˆà¸„à¸£à¸¹, à¸¥à¸¸à¸‡), à¸ªà¸–à¸²à¸™à¸—à¸µà¹ˆ (à¹€à¸Šà¹ˆà¸™ à¸­à¸¸à¸šà¸¥à¸£à¸²à¸Šà¸˜à¸²à¸™à¸µ), à¸§à¸±à¸™à¸—à¸µà¹ˆ à¸«à¸£à¸·à¸­à¸•à¸±à¸§à¹€à¸¥à¸‚à¸•à¹ˆà¸²à¸‡à¹†\n' +
        '>> à¸„à¸¸à¸“ **à¸•à¹‰à¸­à¸‡à¸«à¹‰à¸²à¸¡à¸„à¸±à¸”à¸¥à¸­à¸�** à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸‰à¸žà¸²à¸°à¹€à¸«à¸¥à¹ˆà¸²à¸™à¸µà¹‰à¸¡à¸²à¹ƒà¸ªà¹ˆà¹ƒà¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¹€à¸”à¹‡à¸”à¸‚à¸²à¸”! à¹ƒà¸«à¹‰à¸¢à¸¶à¸” "à¸•à¸±à¸§à¸¥à¸°à¸„à¸£ à¸ªà¸–à¸²à¸™à¸—à¸µà¹ˆ à¸§à¸±à¸™à¸—à¸µà¹ˆ à¹�à¸¥à¸°à¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡" à¸ˆà¸²à¸� "à¸‚à¹ˆà¸²à¸§à¸•à¹‰à¸™à¸‰à¸šà¸±à¸š" à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™! <<\n' +
        '>> à¸„à¸¸à¸“ **à¸•à¹‰à¸­à¸‡à¸¢à¸¶à¸” "à¹€à¸—à¸„à¸™à¸´à¸„à¸�à¸²à¸£à¹€à¸‚à¸µà¸¢à¸™ à¹‚à¸—à¸™ à¹�à¸¥à¸°à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸­à¸²à¸£à¸¡à¸“à¹Œ" à¸ˆà¸²à¸�à¸«à¸­à¸ªà¸¡à¸¸à¸”à¸™à¸µà¹‰à¹€à¸›à¹‡à¸™à¹�à¸�à¸™à¸«à¸¥à¸±à¸�à¹ƒà¸™à¸�à¸²à¸£à¹€à¸‚à¸µà¸¢à¸™à¹‚à¸žà¸ªà¸•à¹Œ** à¸­à¸¢à¹ˆà¸²à¸‡à¹€à¸„à¸£à¹ˆà¸‡à¸„à¸£à¸±à¸” <<\n' +
        smartPrompt.promptText + '\n\n';

      if (smartPrompt.doNot && Array.isArray(smartPrompt.doNot) && smartPrompt.doNot.length > 0) {
        prompt += '--- ðŸš¨ à¸‚à¹‰à¸­à¸«à¹‰à¸²à¸¡à¸—à¸³à¹€à¸”à¹‡à¸”à¸‚à¸²à¸” (DO NOT VIOLATE) ---\n' +
          'à¸«à¸²à¸�à¸„à¸¸à¸“à¸¥à¸°à¹€à¸¡à¸´à¸”à¸�à¸Žà¹€à¸«à¸¥à¹ˆà¸²à¸™à¸µà¹‰ à¹‚à¸žà¸ªà¸•à¹Œà¸ˆà¸°à¸–à¸¹à¸�à¸›à¸�à¸´à¹€à¸ªà¸˜:\n' +
          smartPrompt.doNot.map(dn => `- ${dn}`).join('\n') + '\n\n';
      }

      prompt += '=== à¸ˆà¸šà¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸«à¸­à¸ªà¸¡à¸¸à¸” ===\n\n';
    }

    // Inject Positive Archetype
    let archetypePrompt = '=== ðŸ‘¤ POSITIVE WRITING ARCHETYPE ===\n';
    const cat = (smartPrompt?.category || newsTypeDetected || '').toLowerCase();
    if (['à¸­à¸¸à¸šà¸±à¸•à¸´à¹€à¸«à¸•à¸¸', 'à¸­à¸²à¸Šà¸�à¸²à¸�à¸£à¸£à¸¡', 'à¸ªà¸¥à¸”à¹ƒà¸ˆ', 'à¸ à¸±à¸¢à¸žà¸´à¸šà¸±à¸•à¸´', 'à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸Šà¸µà¸§à¸´à¸•', 'à¸­à¸šà¸­à¸¸à¹ˆà¸™', 'à¸„à¸§à¸²à¸¡à¸£à¸±à¸�', 'à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆ', 'à¸Šà¸µà¸§à¸´à¸•'].some(k => cat.includes(k))) {
      archetypePrompt += 'à¸„à¸¸à¸“à¸�à¸³à¸¥à¸±à¸‡à¸ªà¸§à¸¡à¸šà¸—à¸šà¸²à¸—à¹€à¸›à¹‡à¸™: "à¸œà¸¹à¹‰à¹€à¸«à¹‡à¸™à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸ˆà¸£à¸´à¸‡ (The Witness)"\n' +
        '- à¹€à¸¥à¹ˆà¸²à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸”à¹‰à¸§à¸¢à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¸—à¸²à¸‡à¸�à¸²à¸¢à¸ à¸²à¸žà¸ˆà¸£à¸´à¸‡ (à¹€à¸Šà¹ˆà¸™ à¸¥à¸¡à¸žà¸±à¸”, à¹€à¸�à¹‰à¸²à¸­à¸µà¹‰à¸žà¸¥à¸²à¸ªà¸•à¸´à¸�, à¹€à¸ªà¸µà¸¢à¸‡à¸«à¸²à¸¢à¹ƒà¸ˆ, à¸¡à¸·à¸­à¸—à¸µà¹ˆà¸ªà¸±à¹ˆà¸™à¹€à¸—à¸²)\n' +
        '- à¹ƒà¸Šà¹‰à¸›à¸£à¸°à¹‚à¸¢à¸„à¸ªà¸±à¹‰à¸™ à¸¡à¸µà¸ˆà¸±à¸‡à¸«à¸§à¸°à¸«à¸¢à¸¸à¸” (silence) à¸£à¸²à¸§à¸�à¸±à¸šà¸„à¸¸à¸“à¸�à¸³à¸¥à¸±à¸‡à¸¢à¸·à¸™à¸­à¸¢à¸¹à¹ˆà¹ƒà¸™à¸—à¸µà¹ˆà¹€à¸�à¸´à¸”à¹€à¸«à¸•à¸¸à¹�à¸¥à¸°à¸¡à¸µà¸­à¸²à¸£à¸¡à¸“à¹Œà¸£à¹ˆà¸§à¸¡à¹€à¸šà¸²à¹†\n' +
        '- à¸«à¸¥à¸µà¸�à¹€à¸¥à¸µà¹ˆà¸¢à¸‡à¸�à¸²à¸£à¸­à¸˜à¸´à¸šà¸²à¸¢à¸­à¸²à¸£à¸¡à¸“à¹Œ à¹ƒà¸«à¹‰à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¸—à¸²à¸‡à¸�à¸²à¸¢à¸ à¸²à¸žà¹€à¸¥à¹ˆà¸²à¸­à¸²à¸£à¸¡à¸“à¹Œà¹�à¸—à¸™\n';
    } else if (['à¸�à¸²à¸£à¹€à¸¡à¸·à¸­à¸‡', 'à¹€à¸¨à¸£à¸©à¸�à¸�à¸´à¸ˆ', 'à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡', 'à¸˜à¸¸à¸£à¸�à¸´à¸ˆ', 'à¸šà¸±à¸™à¹€à¸—à¸´à¸‡', 'à¸§à¸‡à¸�à¸²à¸£', 'à¸ªà¸±à¸‡à¸„à¸¡'].some(k => cat.includes(k))) {
      archetypePrompt += 'à¸„à¸¸à¸“à¸�à¸³à¸¥à¸±à¸‡à¸ªà¸§à¸¡à¸šà¸—à¸šà¸²à¸—à¹€à¸›à¹‡à¸™: "à¸„à¸™à¸§à¸‡à¹ƒà¸™/à¸œà¸¹à¹‰à¸šà¸±à¸™à¸—à¸¶à¸�à¸�à¸£à¸°à¹�à¸ª (The Insider)"\n' +
        '- à¹€à¸¥à¹ˆà¸²à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸”à¹‰à¸§à¸¢à¹‚à¸—à¸™à¸—à¸µà¹ˆà¸¡à¸µà¸„à¸§à¸²à¸¡à¸•à¸¶à¸‡à¹€à¸„à¸£à¸µà¸¢à¸” à¸«à¸£à¸·à¸­à¹€à¸šà¸·à¹‰à¸­à¸‡à¸¥à¸¶à¸�à¹€à¸šà¸·à¹‰à¸­à¸‡à¸«à¸¥à¸±à¸‡à¸—à¸µà¹ˆà¹€à¸›à¹‡à¸™à¸„à¸§à¸²à¸¡à¸ˆà¸£à¸´à¸‡à¹€à¸Šà¸´à¸‡à¸¥à¸¶à¸�\n' +
        '- à¹ƒà¸Šà¹‰à¸„à¸³à¸žà¸¹à¸”à¸—à¸µà¹ˆà¸�à¸£à¸°à¸Šà¸±à¸š à¸•à¸£à¸‡à¸›à¸£à¸°à¹€à¸”à¹‡à¸™ à¸Šà¸µà¹‰à¹€à¸›à¹‰à¸²à¸„à¸§à¸²à¸¡à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡ (conflict) à¸­à¸¢à¹ˆà¸²à¸‡à¹�à¸¡à¹ˆà¸™à¸¢à¸³\n' +
        '- à¹€à¸¥à¹ˆà¸²à¹�à¸šà¸šà¸œà¸¹à¹‰à¹€à¸�à¹‰à¸²à¸¡à¸­à¸‡à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸—à¸µà¹ˆà¸¡à¸µà¸ªà¸²à¸¢à¸•à¸²à¹�à¸«à¸¥à¸¡à¸„à¸¡ à¹„à¸¡à¹ˆà¸ªà¸±à¹ˆà¸‡à¸ªà¸­à¸™à¸¨à¸µà¸¥à¸˜à¸£à¸£à¸¡ à¸Šà¸µà¹‰à¹ƒà¸«à¹‰à¹€à¸«à¹‡à¸™à¸œà¸¥à¸�à¸£à¸°à¸—à¸šà¸‚à¸­à¸‡à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸ˆà¸£à¸´à¸‡\n';
    } else {
      archetypePrompt += 'à¸„à¸¸à¸“à¸�à¸³à¸¥à¸±à¸‡à¸ªà¸§à¸¡à¸šà¸—à¸šà¸²à¸—à¹€à¸›à¹‡à¸™: "à¸œà¸¹à¹‰à¸šà¸±à¸™à¸—à¸¶à¸�à¸„à¸§à¸²à¸¡à¸ˆà¸£à¸´à¸‡à¸—à¸µà¹ˆà¹„à¸¡à¹ˆà¸•à¸±à¸”à¸ªà¸´à¸™ (The Narrator of Truth)"\n' +
        '- à¹€à¸¥à¹ˆà¸²à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸£à¸²à¸§à¹�à¸šà¸šà¸�à¸£à¸°à¸Šà¸±à¸š à¸•à¸£à¸‡à¹„à¸›à¸•à¸£à¸‡à¸¡à¸² à¹€à¸™à¹‰à¸™à¸™à¹‰à¸³à¸«à¸™à¸±à¸�à¸‚à¸­à¸‡à¸›à¸£à¸°à¹‚à¸¢à¸„à¹�à¸¥à¸°à¸�à¸²à¸£à¹�à¸ªà¸”à¸‡à¸­à¸­à¸�à¸—à¸²à¸‡à¸�à¸²à¸¢à¸ à¸²à¸ž (actions/quotes)\n' +
        '- à¸«à¹‰à¸²à¸¡à¸„à¸³à¸ªà¸§à¸¢à¸«à¸£à¸¹à¸«à¸£à¸·à¸­à¸„à¸§à¸²à¸¡à¸«à¸§à¸±à¸‡à¸—à¸µà¹ˆà¸”à¸¹à¹€à¸«à¸¡à¸·à¸­à¸™ AI à¸„à¹‰à¸™à¸«à¸² "à¹�à¸�à¸™à¸‚à¸­à¸‡à¸„à¸§à¸²à¸¡à¸ˆà¸£à¸´à¸‡" à¹�à¸¥à¹‰à¸§à¸§à¸²à¸‡à¸¡à¸±à¸™à¸¥à¸‡à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸«à¹‰à¸„à¸™à¸­à¹ˆà¸²à¸™à¸„à¸´à¸”à¹€à¸­à¸‡\n' +
        '- à¹ƒà¸Šà¹‰à¸„à¸§à¸²à¸¡à¹€à¸‡à¸µà¸¢à¸šà¹�à¸¥à¸°à¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡à¹€à¸›à¹‡à¸™à¹€à¸„à¸£à¸·à¹ˆà¸­à¸‡à¸™à¸³à¸—à¸²à¸‡à¸­à¸²à¸£à¸¡à¸“à¹Œà¸­à¸¢à¹ˆà¸²à¸‡à¸—à¸£à¸‡à¸žà¸¥à¸±à¸‡\n';
    }
    archetypePrompt += '=== à¸ˆà¸š ARCHETYPE ===\n\n';
    prompt += archetypePrompt;

    // Append Narrative Payload exactly ONCE
    prompt += formatNarrativePayload(narrativePayload);

    if (customPrompt) {
      prompt += `\n=== à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡à¸ˆà¸²à¸�à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰ ===\n"${customPrompt}"\n\n`;
    }

    const _researchGrade = (researchData?.items?.length || 0) >= 3 ? 'strong'
      : (researchData?.items?.length || 0) >= 1 ? 'partial' : 'missing';

    const quoteSafetyRule = `

=== ADVANCED ANTI-DUPLICATE + FACTUAL REWRITE SYSTEM â€” à¸�à¸Žà¸šà¸±à¸‡à¸„à¸±à¸šà¸ªà¸¹à¸‡à¸ªà¸¸à¸” (à¸«à¹‰à¸²à¸¡à¸¥à¸°à¹€à¸¡à¸´à¸”) ===

â”�â”�â”� CORE RULE â”�â”�â”�
à¹€à¸›à¹‰à¸²à¸«à¸¡à¸²à¸¢à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ "à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸„à¸³" à¹�à¸•à¹ˆà¸„à¸·à¸­ "à¹ƒà¸Šà¹‰ fact à¹€à¸”à¸´à¸¡ à¹�à¸•à¹ˆà¹€à¸¥à¹ˆà¸²à¹ƒà¸«à¸¡à¹ˆ"

â”�â”�â”� SIMILARITY ENGINE â”�â”�â”�
â�Œ à¸«à¹‰à¸²à¸¡à¸¡à¸µà¸„à¸³à¹€à¸£à¸µà¸¢à¸‡à¸•à¸´à¸”à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¹€à¸�à¸´à¸™ 6â€“8 à¸„à¸³
â�Œ à¸«à¹‰à¸²à¸¡à¹ƒà¸Šà¹‰ sentence structure à¹€à¸”à¸´à¸¡
â�Œ à¸«à¹‰à¸²à¸¡à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¹�à¸„à¹ˆ synonym 1-2 à¸„à¸³à¹�à¸¥à¹‰à¸§à¸ªà¹ˆà¸‡
â�Œ à¸«à¹‰à¸²à¸¡à¸¢à¹‰à¸²à¸¢à¸„à¸³à¹€à¸¥à¹‡à¸�à¸™à¹‰à¸­à¸¢à¹�à¸•à¹ˆà¸¢à¸±à¸‡à¸­à¹ˆà¸²à¸™à¹€à¸«à¸¡à¸·à¸­à¸™à¹€à¸”à¸´à¸¡
â�Œ à¸«à¹‰à¸²à¸¡à¹€à¸£à¸µà¸¢à¸‡à¸¥à¸³à¸”à¸±à¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸«à¸¡à¸·à¸­à¸™à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¹€à¸�à¸´à¸™ 50%
CHECKLIST: 1.à¸›à¸´à¸”à¸Šà¸·à¹ˆà¸­à¹�à¸¥à¹‰à¸§à¸¢à¸±à¸‡à¹€à¸«à¸¡à¸·à¸­à¸™à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¹„à¸«à¸¡? 2.à¸¢à¸±à¸‡ rewrite à¸Šà¸±à¸”à¹„à¸«à¸¡? 3.quote à¹€à¸¢à¸­à¸°à¹„à¸«à¸¡? 4.à¸ˆà¸±à¸‡à¸«à¸§à¸°à¹€à¸”à¸´à¸¡à¹„à¸«à¸¡? 5.à¹€à¸«à¸¡à¸·à¸­à¸™ "à¸‚à¹ˆà¸²à¸§à¹ƒà¸«à¸¡à¹ˆ" à¸ˆà¸£à¸´à¸‡à¹„à¸«à¸¡?
â†’ à¸–à¹‰à¸²à¸„à¸³à¸•à¸­à¸šà¹ƒà¸”à¸„à¸·à¸­ "à¹ƒà¸Šà¹ˆ" rewrite à¹ƒà¸«à¸¡à¹ˆà¸—à¸±à¸™à¸—à¸µ

â”�â”�â”� FORBIDDEN REWRITE PATTERNS â”�â”�â”�
â�Œ à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ synonym / à¹€à¸•à¸´à¸¡à¸„à¸³à¸«à¸™à¹‰à¸²à¸—à¹‰à¸²à¸¢ / à¸•à¸±à¸”à¸šà¸²à¸‡à¸„à¸³ / à¸ªà¸¥à¸±à¸šà¸„à¸³à¹€à¸¥à¹‡à¸�à¸™à¹‰à¸­à¸¢ / à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ "à¸šà¸­à¸�"â†’"à¹€à¸œà¸¢" à¹�à¸•à¹ˆ structure à¹€à¸”à¸´à¸¡
à¸œà¸´à¸”: "à¹€à¸‚à¸²à¸¡à¸­à¸‡à¸§à¹ˆà¸²à¸¡à¸±à¸™à¹„à¸¡à¹ˆà¹�à¸Ÿà¸£à¹Œà¸—à¸µà¹ˆà¸œà¸¹à¹‰à¸«à¸�à¸´à¸‡à¸•à¹‰à¸­à¸‡à¹�à¸•à¹ˆà¸‡à¸‡à¸²à¸™à¹‚à¸”à¸¢à¹„à¸¡à¹ˆà¸£à¸¹à¹‰à¸„à¸§à¸²à¸¡à¸ˆà¸£à¸´à¸‡"
à¸–à¸¹à¸�: "à¹€à¸‚à¸²à¹€à¸Šà¸·à¹ˆà¸­à¸§à¹ˆà¸²à¸„à¸§à¸²à¸¡à¸ªà¸±à¸¡à¸žà¸±à¸™à¸˜à¹Œà¹„à¸¡à¹ˆà¸„à¸§à¸£à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸ˆà¸²à¸�à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸—à¸µà¹ˆà¸­à¸µà¸�à¸�à¹ˆà¸²à¸¢à¹„à¸¡à¹ˆà¹€à¸„à¸¢à¸£à¸¹à¹‰à¸¡à¸²à¸�à¹ˆà¸­à¸™"

â”�â”�â”� QUOTE REWRITE ENGINE â”�â”�â”�
â€¢ quote à¸•à¸£à¸‡à¸£à¸§à¸¡à¸�à¸±à¸™à¸«à¹‰à¸²à¸¡à¹€à¸�à¸´à¸™ 10% / à¹�à¸•à¹ˆà¸¥à¸°à¸�à¹‰à¸­à¸™à¹„à¸¡à¹ˆà¹€à¸�à¸´à¸™ 8â€“15 à¸„à¸³
â€¢ à¸«à¹‰à¸²à¸¡à¹€à¸›à¸´à¸”à¸šà¸—à¸„à¸§à¸²à¸¡à¸”à¹‰à¸§à¸¢ quote à¸¢à¸²à¸§ / à¸«à¹‰à¸²à¸¡ quote à¸•à¸£à¸‡à¸•à¸´à¸”à¸�à¸±à¸™à¸«à¸¥à¸²à¸¢à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²
âœ… à¸¢à¸� quote à¸ªà¸±à¹‰à¸™à¹†: "à¸–à¹‰à¸²à¹‚à¸”à¸™à¸�à¹‡à¸«à¸¥à¹ˆà¸™" / à¸ªà¸£à¸¸à¸›à¸„à¸§à¸²à¸¡: "à¹€à¸‚à¸²à¸¢à¸·à¸™à¸¢à¸±à¸™à¸§à¹ˆà¸²à¸‚à¸¶à¹‰à¸™à¹€à¸§à¸—à¸µà¹�à¸šà¸šà¹„à¸¡à¹ˆà¸„à¸´à¸”à¸–à¸­à¸¢"
âœ… à¸£à¸¹à¸›à¹�à¸šà¸š: à¹€à¸ˆà¹‰à¸²à¸•à¸±à¸§à¸¢à¸­à¸¡à¸£à¸±à¸šà¸§à¹ˆà¸² "..." / à¹€à¸‚à¸²à¸—à¸´à¹‰à¸‡à¸—à¹‰à¸²à¸¢à¸§à¹ˆà¸² "..."
â�Œ à¸«à¹‰à¸²à¸¡à¹�à¸•à¹ˆà¸‡à¸„à¸³à¸žà¸¹à¸”à¹ƒà¸«à¹‰à¹�à¸£à¸‡à¸�à¸§à¹ˆà¸²à¹€à¸”à¸´à¸¡ / à¸«à¹‰à¸²à¸¡à¹€à¸•à¸´à¸¡à¸­à¸²à¸£à¸¡à¸“à¹Œà¸—à¸µà¹ˆà¹„à¸¡à¹ˆà¸¡à¸µà¹ƒà¸™à¸•à¹‰à¸™à¸‰à¸šà¸±à¸š / à¸«à¹‰à¸²à¸¡à¸ªà¸£à¹‰à¸²à¸‡ quote à¸›à¸¥à¸­à¸¡

â”�â”�â”� FACTUAL SAFETY RULE (à¸‚à¹ˆà¸²à¸§à¹�à¸žà¸—à¸¢à¹Œ/à¸£à¸²à¸Šà¸�à¸²à¸£/à¸­à¸¸à¸šà¸±à¸•à¸´à¹€à¸«à¸•à¸¸/à¸•à¸±à¸§à¹€à¸¥à¸‚) â”�â”�â”�
à¸«à¹‰à¸²à¸¡à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™: à¸•à¸±à¸§à¹€à¸¥à¸‚ / à¸Šà¸·à¹ˆà¸­à¸šà¸¸à¸„à¸„à¸¥ / à¸Šà¸·à¹ˆà¸­à¸ªà¸–à¸²à¸™à¸—à¸µà¹ˆ / à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸²à¸‡à¹�à¸žà¸—à¸¢à¹Œ-à¸�à¸Žà¸«à¸¡à¸²à¸¢-à¸£à¸²à¸Šà¸�à¸²à¸£ / à¸¥à¸³à¸”à¸±à¸šà¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸ªà¸³à¸„à¸±à¸�
à¸•à¹‰à¸­à¸‡à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™: à¸§à¸´à¸˜à¸µà¹€à¸¥à¹ˆà¸² / narrative / emotional framing / opening / flow / sentence structure / à¸¡à¸¸à¸¡à¸¡à¸­à¸‡
à¸«à¹‰à¸²à¸¡: "à¹€à¸­à¸²à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸”à¸´à¸¡à¸¡à¸²à¹€à¸£à¸µà¸¢à¸‡à¹ƒà¸«à¸¡à¹ˆ" â€” à¸•à¹‰à¸­à¸‡: "à¸•à¸µà¸„à¸§à¸²à¸¡à¹ƒà¸«à¸¡à¹ˆà¸ˆà¸²à¸� fact à¹€à¸”à¸´à¸¡"
à¸œà¸´à¸”: "à¸—à¸µà¸¡à¹�à¸žà¸—à¸¢à¹Œà¸œà¹ˆà¸²à¸„à¸¥à¸­à¸”à¹�à¸�à¸” 4 à¸ªà¸³à¹€à¸£à¹‡à¸ˆ" (sentence à¹€à¸”à¸´à¸¡)
à¸–à¸¹à¸�: "à¸�à¸§à¹ˆà¸²à¸ˆà¸°à¸žà¸²à¹€à¸”à¹‡à¸�à¸—à¸±à¹‰à¸‡ 4 à¸­à¸­à¸�à¸¡à¸²à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢ à¸—à¸µà¸¡à¹�à¸žà¸—à¸¢à¹Œà¸•à¹‰à¸­à¸‡à¸§à¸²à¸‡à¹�à¸œà¸™à¸�à¸±à¸™à¸«à¸¥à¸²à¸¢à¹€à¸”à¸·à¸­à¸™"

â”�â”�â”� NARRATIVE ENGINE â€” à¹€à¸¥à¸·à¸­à¸� Angle à¹ƒà¸«à¸¡à¹ˆà¸�à¹ˆà¸­à¸™à¹€à¸‚à¸µà¸¢à¸™à¹€à¸ªà¸¡à¸­ â”�â”�â”�
à¸«à¹‰à¸²à¸¡à¹€à¸¥à¹ˆà¸²à¸•à¸²à¸¡ timeline / à¸«à¹‰à¸²à¸¡à¸ªà¸£à¸¸à¸›à¸—à¸µà¸¥à¸°à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²à¹�à¸šà¸šà¸‚à¹ˆà¸²à¸§à¸—à¸µà¸§à¸µ / à¸«à¹‰à¸²à¸¡à¹€à¸£à¸µà¸¢à¸‡à¸•à¸²à¸¡ statement à¸£à¸²à¸Šà¸�à¸²à¸£
à¹€à¸¥à¸·à¸­à¸� Angle 1â€“3 à¸¡à¸¸à¸¡:
â€¢ à¸‚à¹ˆà¸²à¸§à¸—à¸±à¹ˆà¸§à¹„à¸›: à¸„à¸™à¸žà¸¢à¸²à¸¢à¸²à¸¡à¹€à¸•à¸·à¸­à¸™ / à¸œà¸¥à¸�à¸£à¸°à¸—à¸šà¸ˆà¸´à¸•à¹ƒà¸ˆ / à¸„à¸§à¸²à¸¡à¸ªà¸±à¸¡à¸žà¸±à¸™à¸˜à¹Œà¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ / consequence / à¹�à¸£à¸‡à¸�à¸”à¸”à¸±à¸™à¸ªà¸±à¸‡à¸„à¸¡
â€¢ à¸‚à¹ˆà¸²à¸§à¹�à¸žà¸—à¸¢à¹Œ: à¸ à¸²à¸£à¸�à¸´à¸ˆà¸Šà¹ˆà¸§à¸¢à¸Šà¸µà¸§à¸´à¸• / à¹€à¸šà¸·à¹‰à¸­à¸‡à¸«à¸¥à¸±à¸‡à¸«à¹‰à¸­à¸‡à¸œà¹ˆà¸²à¸•à¸±à¸” / à¹€à¸„à¸ªà¸«à¸²à¸¢à¸²à¸� / à¸—à¸µà¸¡à¹€à¸§à¸´à¸£à¹Œà¸� / à¸„à¸§à¸²à¸¡à¹€à¸ªà¸µà¸¢à¸ªà¸¥à¸°à¸šà¸¸à¸„à¸¥à¸²à¸�à¸£
â€¢ à¸‚à¹ˆà¸²à¸§à¸­à¸¸à¸šà¸±à¸•à¸´à¹€à¸«à¸•à¸¸: à¸§à¸´à¸™à¸²à¸—à¸µà¸Šà¸µà¸§à¸´à¸• / à¸„à¸™à¸Šà¹ˆà¸§à¸¢à¹€à¸«à¸¥à¸·à¸­ / à¸œà¸¥à¸�à¸£à¸°à¸—à¸šà¸•à¹ˆà¸­à¸„à¸£à¸­à¸šà¸„à¸£à¸±à¸§ / à¸„à¸§à¸²à¸¡à¸›à¸£à¸°à¸¡à¸²à¸—
â€¢ à¸‚à¹ˆà¸²à¸§à¸£à¸²à¸Šà¸�à¸²à¸£: à¸œà¸¥à¸�à¸£à¸°à¸—à¸šà¸•à¹ˆà¸­à¸›à¸£à¸°à¸Šà¸²à¸Šà¸™ / à¸ªà¸´à¹ˆà¸‡à¸—à¸µà¹ˆà¸„à¸™à¸•à¹‰à¸­à¸‡à¸£à¸¹à¹‰ / à¸œà¸¥à¸”à¸µà¸œà¸¥à¹€à¸ªà¸µà¸¢ / à¹€à¸šà¸·à¹‰à¸­à¸‡à¸«à¸¥à¸±à¸‡à¸�à¸²à¸£à¸•à¸±à¸”à¸ªà¸´à¸™à¹ƒà¸ˆ

â”�â”�â”� EDITORIAL THINKING MODE â”�â”�â”�
à¸–à¸²à¸¡à¸�à¹ˆà¸­à¸™à¹€à¸‚à¸µà¸¢à¸™: "à¸–à¹‰à¸²à¸šà¸£à¸£à¸“à¸²à¸˜à¸´à¸�à¸²à¸£à¹€à¸žà¸ˆà¹„à¸§à¸£à¸±à¸¥à¹€à¸›à¹‡à¸™à¸„à¸™à¹€à¸¥à¹ˆà¸² à¹€à¸‚à¸²à¸ˆà¸°à¸«à¸¢à¸´à¸šà¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¹„à¸«à¸™à¸¡à¸²à¹€à¸›à¹‡à¸™à¹�à¸�à¸™?"
"à¸–à¹‰à¸²à¸„à¸™à¸­à¹ˆà¸²à¸™à¹„à¸¡à¹ˆà¹€à¸„à¸¢à¹€à¸«à¹‡à¸™à¸•à¹‰à¸™à¸‰à¸šà¸±à¸š à¹€à¸‚à¸²à¸ˆà¸°à¸ˆà¸³à¸‚à¹ˆà¸²à¸§à¸™à¸µà¹‰à¸ˆà¸²à¸�à¸¡à¸¸à¸¡à¹„à¸«à¸™?" â†’ à¹ƒà¸Šà¹‰à¸¡à¸¸à¸¡à¸™à¸±à¹‰à¸™à¹€à¸›à¹‡à¸™à¹�à¸�à¸™
à¸•à¹‰à¸­à¸‡à¹€à¸¥à¸·à¸­à¸�: emotional / social / conflict / consequence angle à¹�à¸¥à¹‰à¸§à¸„à¹ˆà¸­à¸¢à¹€à¸‚à¸µà¸¢à¸™

â”�â”�â”� ANTI-STRUCTURE COPY â”�â”�â”�
à¸•à¹‰à¸™à¸‰à¸šà¸±à¸š Aâ†’Bâ†’Câ†’D â�Œ à¸«à¹‰à¸²à¸¡à¹€à¸£à¸µà¸¢à¸‡à¸‹à¹‰à¸³à¹�à¸¡à¹‰à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸„à¸³à¹�à¸¥à¹‰à¸§
âœ… à¸ªà¸¥à¸±à¸šà¹ƒà¸«à¸¡à¹ˆ: à¹€à¸›à¸´à¸”à¸”à¹‰à¸§à¸¢à¸œà¸¥à¸�à¸£à¸°à¸—à¸š/à¸­à¸²à¸£à¸¡à¸“à¹Œ/consequence/conflict/moment à¸ªà¸³à¸„à¸±à¸� à¹�à¸¥à¹‰à¸§à¸„à¹ˆà¸­à¸¢à¸¢à¹‰à¸­à¸™à¹€à¸¥à¹ˆà¸²
à¹€à¸‚à¸µà¸¢à¸™à¹€à¸«à¸¡à¸·à¸­à¸™: à¸™à¸±à¸�à¹€à¸¥à¹ˆà¸²à¸‚à¹ˆà¸²à¸§à¹„à¸§à¸£à¸±à¸¥ / storyteller / columnist à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ bot rewrite / AI summarize

â”�â”�â”� FACTUAL EMOTIONAL WRITING â”�â”�â”�
à¸‚à¹ˆà¸²à¸§ factual à¸«à¹‰à¸²à¸¡à¹�à¸«à¹‰à¸‡à¹�à¸šà¸šà¸£à¸²à¸Šà¸�à¸²à¸£ â€” à¸•à¹‰à¸­à¸‡à¹€à¸•à¸´à¸¡à¸„à¸§à¸²à¸¡à¹€à¸›à¹‡à¸™à¸¡à¸™à¸¸à¸©à¸¢à¹Œ / à¸ à¸²à¸žà¸ˆà¸³ / emotional framing / consequence
à¹‚à¸”à¸¢à¹„à¸¡à¹ˆà¸šà¸´à¸”à¹€à¸šà¸·à¸­à¸™ fact à¹�à¸¥à¸°à¹„à¸¡à¹ˆà¹�à¸•à¹ˆà¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸žà¸´à¹ˆà¸¡
à¹�à¸—à¸™ "à¸—à¸µà¸¡à¹�à¸žà¸—à¸¢à¹Œà¸£à¹ˆà¸§à¸¡à¸£à¸°à¸”à¸¡à¸�à¸³à¸¥à¸±à¸‡":
â†’ âœ… "à¹€à¸„à¸ªà¸™à¸µà¹‰à¸—à¸³à¹ƒà¸«à¹‰à¸«à¸¥à¸²à¸¢à¹�à¸œà¸™à¸�à¸•à¹‰à¸­à¸‡à¸—à¸³à¸‡à¸²à¸™à¸žà¸£à¹‰à¸­à¸¡à¸�à¸±à¸™à¸•à¸±à¹‰à¸‡à¹�à¸•à¹ˆà¸«à¹‰à¸­à¸‡à¸œà¹ˆà¸²à¸•à¸±à¸”à¸–à¸¶à¸‡ ICU"

â”�â”�â”� FINAL QUALITY CHECK (à¸•à¸£à¸§à¸ˆà¸�à¹ˆà¸­à¸™à¸ªà¹ˆà¸‡à¸—à¸¸à¸�à¸„à¸£à¸±à¹‰à¸‡) â”�â”�â”�
â–¡ à¸¡à¸µ sentence factual à¹€à¸”à¸´à¸¡à¸•à¸´à¸”à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¹„à¸«à¸¡
â–¡ à¸¢à¸±à¸‡à¹€à¸£à¸µà¸¢à¸‡ flow à¹€à¸”à¸´à¸¡à¹„à¸«à¸¡ / à¸¢à¸±à¸‡à¹€à¸«à¸¡à¸·à¸­à¸™à¸›à¸£à¸°à¸�à¸²à¸¨à¸£à¸²à¸Šà¸�à¸²à¸£à¹„à¸«à¸¡
â–¡ à¸¡à¸µ quote à¸•à¸£à¸‡à¹€à¸�à¸´à¸™ 10% à¹„à¸«à¸¡
â–¡ à¸¡à¸µ narrative à¹ƒà¸«à¸¡à¹ˆà¸ˆà¸£à¸´à¸‡à¹„à¸«à¸¡ / à¸¡à¸µ editorial thinking à¹„à¸«à¸¡
â–¡ à¸¡à¸µ emotional framing à¹„à¸«à¸¡ / à¸­à¹ˆà¸²à¸™à¹�à¸¥à¹‰à¸§à¹€à¸«à¸¡à¸·à¸­à¸™à¸¡à¸™à¸¸à¸©à¸¢à¹Œà¹„à¸«à¸¡
â–¡ à¹€à¸­à¸²à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¹€à¸—à¸µà¸¢à¸šà¹�à¸¥à¹‰à¸§à¸”à¸¹à¹€à¸«à¸¡à¸·à¸­à¸™ "à¸„à¸™à¸¥à¸°à¸šà¸—à¸„à¸§à¸²à¸¡" à¹„à¸«à¸¡
â†’ à¸–à¹‰à¸²à¸¢à¸±à¸‡à¸„à¸¥à¹‰à¸²à¸¢: rewrite à¹ƒà¸«à¸¡à¹ˆà¸—à¸±à¸™à¸—à¸µ

=== à¸ˆà¸š ANTI-DUPLICATE + FACTUAL REWRITE SYSTEM ===
`;
    prompt += quoteSafetyRule;

    let multiPrompt = prompt + '\n\n=== à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸ªà¸³à¸„à¸±à¸�à¸ªà¸³à¸«à¸£à¸±à¸šà¸�à¸²à¸£à¹€à¸‚à¸µà¸¢à¸™ ===\n' +
      'à¸„à¸¸à¸“à¸•à¹‰à¸­à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸«à¸¥à¸²à¸¢à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸ˆà¸²à¸�à¸‚à¹ˆà¸²à¸§à¸™à¸µà¹‰ à¹‚à¸”à¸¢à¹�à¸•à¹ˆà¸¥à¸°à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¹ƒà¸Šà¹‰à¸¡à¸¸à¸¡à¹€à¸‚à¸µà¸¢à¸™à¸•à¹ˆà¸²à¸‡à¸�à¸±à¸™\n' +
      `à¹�à¸•à¹ˆà¸¥à¸°à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™:\n` +
      `- à¸•à¹‰à¸­à¸‡à¸¢à¸²à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¸™à¹‰à¸­à¸¢ ${lenCfg.min} à¸„à¸³ à¸–à¸¶à¸‡ ${lenCfg.max} à¸„à¸³ à¹�à¸šà¹ˆà¸‡ ${lenCfg.paraDesc} à¸ªà¸³à¸«à¸£à¸±à¸š Facebook (à¸«à¹‰à¸²à¸¡à¸ªà¸±à¹‰à¸™à¸�à¸§à¹ˆà¸² ${lenCfg.min} à¸„à¸³à¹€à¸”à¹‡à¸”à¸‚à¸²à¸”)\n` +
      `- à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡ ${lenCfg.paragraphs} à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²: [à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸² 1] à¹€à¸›à¸´à¸”à¹�à¸£à¸‡ hook à¸”à¸¶à¸‡à¸­à¸²à¸£à¸¡à¸“à¹Œ [à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²à¸•à¸£à¸‡à¸�à¸¥à¸²à¸‡] à¹€à¸¥à¹ˆà¸²à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸” storytelling [à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²à¸ªà¸¸à¸”à¸—à¹‰à¸²à¸¢] à¸›à¸´à¸”à¸”à¹‰à¸§à¸¢à¸›à¸£à¸°à¹‚à¸¢à¸„à¸šà¸£à¸£à¸¢à¸²à¸¢à¸—à¸´à¹‰à¸‡à¸­à¸²à¸£à¸¡à¸“à¹Œà¸—à¸£à¸‡à¸žà¸¥à¸±à¸‡\n` +
      `- à¹�à¸•à¹ˆà¸¥à¸°à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²à¸•à¹‰à¸­à¸‡à¸¡à¸µà¸­à¸¢à¹ˆà¸²à¸‡à¸™à¹‰à¸­à¸¢ ${lenCfg.sentences} à¸›à¸£à¸°à¹‚à¸¢à¸„ à¸„à¸±à¹ˆà¸™à¸”à¹‰à¸§à¸¢ \\n\\n\n` +
      '- à¸•à¹‰à¸­à¸‡à¸­à¹‰à¸²à¸‡à¸­à¸´à¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸£à¸´à¸‡à¸ˆà¸²à¸�à¸‚à¹ˆà¸²à¸§ à¸«à¹‰à¸²à¸¡à¹�à¸•à¹ˆà¸‡à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸—à¸µà¹ˆà¹„à¸¡à¹ˆà¸¡à¸µà¹ƒà¸™à¸‚à¹ˆà¸²à¸§\n' +
      '- à¸•à¹‰à¸­à¸‡à¸„à¸£à¸­à¸šà¸„à¸¥à¸¸à¸¡à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸ªà¸³à¸„à¸±à¸�à¸ˆà¸²à¸�à¸‚à¹ˆà¸²à¸§\n' +
      '- à¸•à¹‰à¸­à¸‡à¸¡à¸µà¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡: à¹€à¸›à¸´à¸”à¹€à¸£à¸·à¹ˆà¸­à¸‡(hook) â†’ à¹€à¸¥à¹ˆà¸²à¹€à¸£à¸·à¹ˆà¸­à¸‡ â†’ à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸” â†’ à¸›à¸´à¸”à¸”à¹‰à¸§à¸¢à¸›à¸£à¸°à¹‚à¸¢à¸„à¸šà¸£à¸£à¸¢à¸²à¸¢à¸—à¸£à¸‡à¸žà¸¥à¸±à¸‡à¸—à¸´à¹‰à¸‡à¸—à¹‰à¸²à¸¢\n' +
      '- âš ï¸� à¸«à¹‰à¸²à¸¡à¸•à¸±à¹‰à¸‡à¸„à¸³à¸–à¸²à¸¡à¸›à¸´à¸”à¸—à¹‰à¸²à¸¢à¹€à¸”à¹‡à¸”à¸‚à¸²à¸” à¸«à¹‰à¸²à¸¡à¸ˆà¸šà¸”à¹‰à¸§à¸¢ "à¸„à¸¸à¸“à¸„à¸´à¸”à¸¢à¸±à¸‡à¹„à¸‡?", "à¹€à¸«à¹‡à¸™à¸”à¹‰à¸§à¸¢à¹„à¸«à¸¡?" à¸«à¸£à¸·à¸­à¸„à¸³à¸–à¸²à¸¡à¹ƒà¸”à¹† â€” à¹€à¸™à¹‰à¸™à¸šà¸£à¸£à¸¢à¸²à¸¢à¸•à¸²à¸¡ prompt à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™\n\n' +
      '=== ðŸ”� QUALITY RULES (MANDATORY) ===\n' +
      '1. à¸«à¹‰à¸²à¸¡à¹€à¸›à¸´à¸”à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸‹à¹‰à¸³à¸�à¸±à¸™ â€” à¹�à¸•à¹ˆà¸¥à¸°à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸•à¹‰à¸­à¸‡à¹€à¸›à¸´à¸”à¸”à¹‰à¸§à¸¢à¸›à¸£à¸°à¹‚à¸¢à¸„à¹�à¸£à¸�à¸—à¸µà¹ˆà¸•à¹ˆà¸²à¸‡à¸�à¸±à¸™ à¸«à¹‰à¸²à¸¡à¹ƒà¸Šà¹‰à¸„à¸³/à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸”à¸´à¸¡à¸‹à¹‰à¸³\n' +
      '2. à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²à¸ªà¸¸à¸”à¸—à¹‰à¸²à¸¢à¸�à¸£à¸°à¸Šà¸±à¸š â€” à¸›à¸´à¸”à¸—à¹‰à¸²à¸¢à¹„à¸¡à¹ˆà¹€à¸�à¸´à¸™ 2 à¸›à¸£à¸°à¹‚à¸¢à¸„ à¹„à¸¡à¹ˆà¹€à¸Ÿà¹‰à¸­ à¹„à¸¡à¹ˆà¸­à¸­à¸�à¸—à¸°à¹€à¸¥ à¹„à¸¡à¹ˆà¸ªà¸£à¸¸à¸›à¸‚à¹‰à¸­à¸„à¸´à¸”à¸Šà¸µà¸§à¸´à¸•\n' +
      '3. à¸Šà¸·à¹ˆà¸­à¹€à¸‰à¸žà¸²à¸°à¸•à¹‰à¸­à¸‡à¸ªà¸°à¸�à¸”à¸•à¸£à¸‡à¸�à¸±à¸šà¸•à¹‰à¸™à¸‰à¸šà¸±à¸š 100% à¸«à¹‰à¸²à¸¡à¸ªà¸°à¸�à¸”à¸œà¸´à¸”\n' +
      '4. à¸«à¹‰à¸²à¸¡à¹ƒà¸Šà¹‰ "à¹€à¸˜à¸­" à¸«à¸£à¸·à¸­ "à¹€à¸‚à¸²" à¸•à¸´à¸”à¸�à¸±à¸™à¹€à¸�à¸´à¸™ 3 à¸„à¸£à¸±à¹‰à¸‡à¸•à¹ˆà¸­à¹€à¸£à¸·à¹ˆà¸­à¸‡ â€” à¹ƒà¸«à¹‰à¸ªà¸¥à¸±à¸šà¹ƒà¸Šà¹‰à¸Šà¸·à¹ˆà¸­à¸ˆà¸£à¸´à¸‡ à¸«à¸£à¸·à¸­ "à¹€à¸ˆà¹‰à¸²à¸•à¸±à¸§" à¸«à¸£à¸·à¸­à¸•à¸³à¹�à¸«à¸™à¹ˆà¸‡ (à¹�à¸¡à¹ˆ, à¸žà¹ˆà¸­) à¹�à¸—à¸™ à¸­à¹ˆà¸²à¸™à¹�à¸¥à¹‰à¸§à¹„à¸¡à¹ˆà¸ªà¸°à¸”à¸¸à¸”\n' +
      '5. à¸«à¹‰à¸²à¸¡à¹€à¸”à¸²à¹€à¸žà¸¨ â€” à¸–à¹‰à¸²à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¹„à¸¡à¹ˆà¸£à¸°à¸šà¸¸à¹€à¸žà¸¨ à¸«à¹‰à¸²à¸¡à¹ƒà¸Šà¹‰ à¹€à¸˜à¸­/à¹€à¸‚à¸² à¹ƒà¸«à¹‰à¹ƒà¸Šà¹‰à¸Šà¸·à¹ˆà¸­à¸ˆà¸£à¸´à¸‡à¸«à¸£à¸·à¸­à¸„à¸³à¸�à¸¥à¸²à¸‡à¸­à¸¢à¹ˆà¸²à¸‡ "à¹€à¸ˆà¹‰à¸²à¸•à¸±à¸§" à¹�à¸—à¸™\n' +
      '=== à¸ˆà¸š QUALITY RULES ===\n\n' +
      '=== NATIVE THAI SEMANTICS (à¸«à¹‰à¸²à¸¡à¹�à¸›à¸¥à¹ƒà¸™à¹ƒà¸ˆ) ===\n' +
      'â�Œ à¸«à¹‰à¸²à¸¡à¹�à¸›à¸¥à¸„à¸§à¸²à¸¡à¸«à¸¡à¸²à¸¢à¸«à¸£à¸·à¸­à¸­à¸²à¸£à¸¡à¸“à¹Œà¸ˆà¸²à¸�à¸ à¸²à¸©à¸²à¹„à¸—à¸¢à¹€à¸›à¹‡à¸™à¸ à¸²à¸©à¸²à¸­à¸±à¸‡à¸�à¸¤à¸©à¸�à¹ˆà¸­à¸™à¸›à¸£à¸°à¸¡à¸§à¸¥à¸œà¸¥ (à¹€à¸Šà¹ˆà¸™ à¸«à¹‰à¸²à¸¡à¸„à¸´à¸”à¸§à¹ˆà¸² à¸ªà¸¥à¸”à¹ƒà¸ˆ=Tragic, à¸­à¸šà¸­à¸¸à¹ˆà¸™à¹ƒà¸ˆ=Heartwarming à¹�à¸¥à¹‰à¸§à¸„à¹ˆà¸­à¸¢à¹�à¸•à¹ˆà¸‡à¹€à¸™à¸·à¹‰à¸­à¸«à¸²)\n' +
      'âœ… à¹ƒà¸«à¹‰à¸„à¸´à¸” à¸›à¸£à¸°à¸¡à¸§à¸¥à¸œà¸¥ à¹�à¸¥à¸°à¹€à¸£à¸µà¸¢à¸šà¹€à¸£à¸µà¸¢à¸‡ à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸›à¸£à¸°à¹‚à¸¢à¸„à¹ƒà¸™ "à¸£à¸°à¸šà¸šà¸„à¸´à¸”à¸ à¸²à¸©à¸²à¹„à¸—à¸¢" (Native Thai Framework) à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™ à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸«à¹‰à¹„à¸”à¹‰à¸ªà¸³à¸™à¸§à¸™à¹„à¸—à¸¢à¹�à¸—à¹‰à¹† à¸—à¸µà¹ˆà¹„à¸¡à¹ˆà¹€à¸«à¸¡à¸·à¸­à¸™à¸ à¸²à¸©à¸²à¹�à¸›à¸¥\n\n' +
      '=== HUMAN WRITING DNA V3 â€” CORE RULE ===\n' +
      'â­� à¸«à¸¥à¸±à¸�à¸�à¸²à¸£à¸ªà¸¹à¸‡à¸ªà¸¸à¸”: à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆà¸‚à¸­à¸‡à¸„à¸¸à¸“à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸­à¸˜à¸´à¸šà¸²à¸¢à¸„à¸§à¸²à¸¡à¸£à¸¹à¹‰à¸ªà¸¶à¸� à¹�à¸•à¹ˆà¸„à¸·à¸­à¸ªà¸£à¹‰à¸²à¸‡à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸—à¸µà¹ˆà¸—à¸³à¹ƒà¸«à¹‰à¸„à¸™à¸£à¸¹à¹‰à¸ªà¸¶à¸�à¹€à¸­à¸‡\n' +
      'à¸„à¸¸à¸“à¸„à¸·à¸­à¸„à¸™à¸—à¸µà¹ˆà¹€à¸¥à¹ˆà¸²à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸ˆà¸£à¸´à¸‡à¹ƒà¸«à¹‰à¹€à¸žà¸·à¹ˆà¸­à¸™à¸Ÿà¸±à¸‡ â€” à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸™à¸±à¸�à¹€à¸‚à¸µà¸¢à¸™à¸šà¸—à¸„à¸§à¸²à¸¡ à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ narrator à¸ªà¸²à¸£à¸„à¸”à¸µ à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸„à¸­à¸¥à¸±à¸¡à¸™à¸´à¸ªà¸•à¹Œ\n\n' +
      '[ FORBIDDEN PATTERNS â€” à¸«à¹‰à¸²à¸¡à¹€à¸”à¹‡à¸”à¸‚à¸²à¸” ]\n' +
      'â�Œ AI ClichÃ© (à¸«à¹‰à¸²à¸¡à¸‚à¸¶à¹‰à¸™à¸•à¹‰à¸™à¸›à¸£à¸°à¹‚à¸¢à¸„à¹�à¸šà¸šà¸«à¸¸à¹ˆà¸™à¸¢à¸™à¸•à¹Œ): à¸¥à¸­à¸‡à¸™à¸¶à¸�à¸ à¸²à¸žà¸§à¹ˆà¸², à¸¥à¸­à¸‡à¸ˆà¸´à¸™à¸•à¸™à¸²à¸�à¸²à¸£à¸§à¹ˆà¸², à¸–à¹‰à¸²à¸„à¸¸à¸“à¸•à¹‰à¸­à¸‡, à¸„à¸¸à¸“à¹€à¸„à¸¢à¸„à¸´à¸”à¹„à¸«à¸¡à¸§à¹ˆà¸², à¸ à¸²à¸žà¸—à¸µà¹ˆà¹€à¸«à¹‡à¸™, à¸§à¸´à¸™à¸²à¸—à¸µà¸—à¸µà¹ˆ, à¹€à¸Šà¸·à¹ˆà¸­à¸§à¹ˆà¸²à¸«à¸¥à¸²à¸¢à¸„à¸™à¸„à¸‡...\n' +
      'â�Œ à¸«à¹‰à¸²à¸¡à¸žà¸´à¸¡à¸žà¹Œà¸Šà¸·à¹ˆà¸­à¸„à¸³à¸ªà¸±à¹ˆà¸‡ (à¸«à¹‰à¸²à¸¡à¸‚à¸¶à¹‰à¸™à¸•à¹‰à¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸”à¹‰à¸§à¸¢à¸„à¸³à¸§à¹ˆà¸² Angle:, à¸¡à¸¸à¸¡à¸¡à¸­à¸‡:, Focus: à¸«à¸£à¸·à¸­à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸­à¸·à¹ˆà¸™à¹† à¹€à¸”à¹‡à¸”à¸‚à¸²à¸” à¹ƒà¸«à¹‰à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸�à¸¥à¸·à¸™à¹„à¸›à¸�à¸±à¸šà¹€à¸£à¸·à¹ˆà¸­à¸‡à¸£à¸²à¸§à¹€à¸¥à¸¢)\n' +
      'â�Œ à¸ à¸²à¸©à¸²à¸‚à¹ˆà¸²à¸§à¸—à¸µà¸§à¸µ: à¸‹à¸¶à¹ˆà¸‡, à¸”à¸±à¸‡à¸�à¸¥à¹ˆà¸²à¸§, à¸—à¸±à¹‰à¸‡à¸™à¸µà¹‰, à¸­à¸¢à¹ˆà¸²à¸‡à¹„à¸£à¸�à¹‡à¸•à¸²à¸¡, à¸–à¸·à¸­à¹€à¸›à¹‡à¸™, à¹€à¸£à¸µà¸¢à¸�à¹„à¸”à¹‰à¸§à¹ˆà¸², à¸™à¸±à¸šà¸§à¹ˆà¸², à¹„à¸”à¹‰à¸¡à¸µà¸�à¸²à¸£, à¸ à¸²à¸¢à¸«à¸¥à¸±à¸‡à¸ˆà¸²à¸�, à¸ªà¸·à¸šà¹€à¸™à¸·à¹ˆà¸­à¸‡, à¹ƒà¸™à¸ªà¹ˆà¸§à¸™à¸‚à¸­à¸‡, à¸ˆà¸²à¸�à¸�à¸£à¸“à¸µà¸”à¸±à¸‡à¸�à¸¥à¹ˆà¸²à¸§\n' +
      'â�Œ à¸„à¸³ abstract à¸—à¸µà¹ˆ AI à¸Šà¸­à¸š: à¸„à¸§à¸²à¸¡à¸£à¸±à¸�à¸­à¸±à¸™à¸¢à¸´à¹ˆà¸‡à¹ƒà¸«à¸�à¹ˆ, à¸�à¸²à¸£à¸›à¸¥à¹ˆà¸­à¸¢à¸§à¸²à¸‡, à¹�à¸£à¸‡à¸šà¸±à¸™à¸”à¸²à¸¥à¹ƒà¸ˆ, à¸„à¸§à¸²à¸¡à¸«à¸§à¸±à¸‡, à¹�à¸ªà¸‡à¸ªà¸§à¹ˆà¸²à¸‡, à¹�à¸ªà¸‡à¸™à¸³à¸—à¸²à¸‡, à¸„à¸§à¸²à¸¡à¸«à¸¡à¸²à¸¢à¸‚à¸­à¸‡à¸Šà¸µà¸§à¸´à¸•, à¸„à¸§à¸²à¸¡à¸‡à¸”à¸‡à¸²à¸¡à¸‚à¸­à¸‡à¸ˆà¸´à¸•à¹ƒà¸ˆ, à¸„à¸§à¸²à¸¡à¹�à¸‚à¹‡à¸‡à¹�à¸�à¸£à¹ˆà¸‡, à¸„à¸§à¸²à¸¡à¸¢à¸¸à¸•à¸´à¸˜à¸£à¸£à¸¡\n' +
      'â�Œ AI Narrator: à¸ªà¸´à¹ˆà¸‡à¸—à¸µà¹ˆà¸™à¹ˆà¸²à¸ªà¸™à¹ƒà¸ˆà¸„à¸·à¸­, à¸ªà¸´à¹ˆà¸‡à¸—à¸µà¹ˆà¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆà¸—à¸µà¹ˆà¸ªà¸¸à¸”à¸„à¸·à¸­, à¸—à¸³à¹ƒà¸«à¹‰à¹€à¸«à¹‡à¸™à¸§à¹ˆà¸², à¸ªà¸°à¸—à¹‰à¸­à¸™à¹ƒà¸«à¹‰à¹€à¸«à¹‡à¸™, à¸žà¸´à¸ªà¸¹à¸ˆà¸™à¹Œà¸§à¹ˆà¸², à¹�à¸ªà¸”à¸‡à¹ƒà¸«à¹‰à¹€à¸«à¹‡à¸™à¸§à¹ˆà¸², à¸ªà¸£à¹‰à¸²à¸‡à¸„à¸§à¸²à¸¡à¸®à¸·à¸­à¸®à¸², à¸�à¸¥à¸²à¸¢à¹€à¸›à¹‡à¸™à¸�à¸£à¸°à¹�à¸ª\n' +
      'â�Œ à¸šà¸­à¸�à¸­à¸²à¸£à¸¡à¸“à¹Œà¹�à¸—à¸™à¸„à¸™à¸­à¹ˆà¸²à¸™: à¸—à¸³à¹ƒà¸«à¹‰à¸„à¸™à¸”à¸¹à¸™à¹‰à¸³à¸•à¸²à¹„à¸«à¸¥, à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆà¸Šà¸²à¸§à¹€à¸™à¹‡à¸•, à¹€à¸•à¹‡à¸¡à¹„à¸›à¸”à¹‰à¸§à¸¢à¸„à¸§à¸²à¸¡à¸‹à¸²à¸šà¸‹à¸¶à¹‰à¸‡, à¸—à¸¸à¸�à¸„à¸™à¸£à¹‰à¸­à¸‡à¹„à¸«à¹‰, à¸™à¹‰à¸³à¸•à¸²à¸„à¸‡à¹„à¸«à¸¥à¹„à¸›à¸�à¸±à¸š...\n' +
      'â�Œ à¸ªà¸£à¸¸à¸›à¸‚à¹‰à¸­à¸„à¸´à¸”à¸Šà¸µà¸§à¸´à¸•: à¹€à¸›à¹‡à¸™à¸šà¸—à¹€à¸£à¸µà¸¢à¸™à¸Šà¸µà¸§à¸´à¸•, à¸„à¸§à¸²à¸¡à¸£à¸±à¸�à¸—à¸µà¹ˆà¹�à¸—à¹‰à¸ˆà¸£à¸´à¸‡, à¸—à¸³à¹ƒà¸«à¹‰à¹€à¸£à¸²à¹€à¸‚à¹‰à¸²à¹ƒà¸ˆà¸§à¹ˆà¸², à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸�à¸²à¸£à¸ªà¸¹à¸�à¹€à¸ªà¸µà¸¢ à¹�à¸•à¹ˆà¹€à¸›à¹‡à¸™..., à¸ªà¸°à¸—à¹‰à¸­à¸™à¸–à¸¶à¸‡à¸„à¸§à¸²à¸¡à¸£à¸±à¸�à¸—à¸µà¹ˆ...\n' +
      'â�Œ Ending à¸›à¸£à¸±à¸Šà¸�à¸²: à¸„à¸§à¸²à¸¡à¸£à¸±à¸�à¹„à¸¡à¹ˆà¸¡à¸µà¸§à¸±à¸™à¸•à¸²à¸¢, à¸Šà¸µà¸§à¸´à¸•à¸•à¹‰à¸­à¸‡à¹€à¸”à¸´à¸™à¸•à¹ˆà¸­, à¹�à¸ªà¸‡à¹�à¸«à¹ˆà¸‡à¸„à¸§à¸²à¸¡à¸«à¸§à¸±à¸‡, à¸§à¸±à¸™à¸™à¸µà¹‰à¸—à¸µà¹ˆà¹€à¸£à¸²à¸ªà¸¹à¸�à¹€à¸ªà¸µà¸¢ à¸„à¸·à¸­à¸§à¸±à¸™à¸—à¸µà¹ˆ..., à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¹�à¸„à¹ˆ...à¹�à¸•à¹ˆà¸„à¸·à¸­...\n' +
      'â�Œ Over-drama: à¹‚à¸¥à¸�à¸žà¸±à¸‡, à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆà¸—à¸µà¹ˆà¸ªà¸¸à¸”à¹ƒà¸™à¹‚à¸¥à¸�, à¹„à¸¡à¹ˆà¸¡à¸µà¹ƒà¸„à¸£à¹ƒà¸«à¹‰à¸­à¸ à¸±à¸¢, à¸„à¸§à¸²à¸¡à¸ˆà¸£à¸´à¸‡à¸­à¸±à¸™à¹‚à¸«à¸”à¸£à¹‰à¸²à¸¢ (à¸–à¹‰à¸²à¹ƒà¸«à¸�à¹ˆà¹€à¸�à¸´à¸™à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸ˆà¸£à¸´à¸‡)\n\n' +
      '[ VISUAL FIRST â€” à¸šà¸±à¸‡à¸„à¸±à¸šà¸—à¸¸à¸�à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸² ]\n' +
      'âœ… à¸—à¸¸à¸�à¸­à¸²à¸£à¸¡à¸“à¹Œà¸•à¹‰à¸­à¸‡à¹�à¸›à¸¥à¸‡à¹€à¸›à¹‡à¸™à¸ à¸²à¸ž action à¸«à¸£à¸·à¸­ quote à¸ˆà¸£à¸´à¸‡\n' +
      'à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡ â†’ à¸«à¹‰à¸²à¸¡: "à¸„à¸§à¸²à¸¡à¸£à¸±à¸�à¸‚à¸­à¸‡à¸„à¸£à¸­à¸šà¸„à¸£à¸±à¸§" | à¸•à¹‰à¸­à¸‡à¹€à¸›à¹‡à¸™: "à¸¥à¸¹à¸�à¸ˆà¸±à¸šà¸¡à¸·à¸­à¸žà¹ˆà¸­à¸�à¹ˆà¸­à¸™à¸–à¸­à¸”à¸—à¹ˆà¸­à¸­à¸­à¸�à¸‹à¸´à¹€à¸ˆà¸™"\n' +
      'à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡ â†’ à¸«à¹‰à¸²à¸¡: "à¸�à¸²à¸£à¸›à¸¥à¹ˆà¸­à¸¢à¸§à¸²à¸‡à¸„à¸·à¸­à¸„à¸§à¸²à¸¡à¸£à¸±à¸�" | à¸•à¹‰à¸­à¸‡à¹€à¸›à¹‡à¸™: "à¸žà¹ˆà¸­à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡à¸«à¹ˆà¸§à¸‡à¸­à¸°à¹„à¸£à¹�à¸¥à¹‰à¸§à¸™à¸°"\n' +
      'à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡ â†’ à¸«à¹‰à¸²à¸¡: "à¸—à¸¸à¸�à¸„à¸™à¸£à¹‰à¸­à¸‡à¹„à¸«à¹‰" | à¸•à¹‰à¸­à¸‡à¹€à¸›à¹‡à¸™: "à¹„à¸¡à¹ˆà¸¡à¸µà¹ƒà¸„à¸£à¸žà¸¹à¸”à¸­à¸°à¹„à¸£à¸­à¸¢à¸¹à¹ˆà¸žà¸±à¸�à¹ƒà¸«à¸�à¹ˆ"\n\n' +
      '[ HUMAN IMPERFECTION â€” à¹ƒà¸«à¹‰à¸¡à¸µà¸„à¸§à¸²à¸¡à¹€à¸›à¹‡à¸™à¸¡à¸™à¸¸à¸©à¸¢à¹Œ ]\n' +
      'âœ… à¹ƒà¸Šà¹‰à¸›à¸£à¸°à¹‚à¸¢à¸„à¸ªà¸±à¹‰à¸™à¸ªà¸¥à¸±à¸šà¸¢à¸²à¸§ â€” à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡à¸—à¸¸à¸�à¸›à¸£à¸°à¹‚à¸¢à¸„ flow à¸ªà¸§à¸¢\n' +
      'âœ… à¹ƒà¸Šà¹‰ quote à¸•à¸£à¸‡à¹† à¸ˆà¸²à¸�à¸„à¸™à¹ƒà¸™à¸‚à¹ˆà¸²à¸§ à¸–à¹‰à¸²à¸¡à¸µ\n' +
      'âœ… à¸¡à¸µ "à¸„à¸§à¸²à¸¡à¹€à¸‡à¸µà¸¢à¸š" â€” à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡à¸­à¸˜à¸´à¸šà¸²à¸¢à¸—à¸¸à¸�à¸­à¸²à¸£à¸¡à¸“à¹Œ à¸šà¸²à¸‡à¸—à¸µà¹€à¸¥à¹ˆà¸²à¹�à¸¥à¹‰à¸§à¸«à¸¢à¸¸à¸”\n' +
      'âœ… à¸ à¸²à¸©à¸²à¸„à¸™à¸žà¸¹à¸”à¸ˆà¸£à¸´à¸‡ â€” à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡à¸ªà¸¥à¸°à¸ªà¸¥à¸§à¸¢à¸—à¸¸à¸�à¸›à¸£à¸°à¹‚à¸¢à¸„\n\n' +
      '[ HUMAN MEMORY CHECK â€” à¸–à¸²à¸¡à¸�à¹ˆà¸­à¸™à¸—à¸¸à¸�à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸² ]\n' +
      'à¸�à¹ˆà¸­à¸™à¹€à¸‚à¸µà¸¢à¸™à¸—à¸¸à¸�à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸² à¸•à¹‰à¸­à¸‡à¸–à¸²à¸¡à¸•à¸±à¸§à¹€à¸­à¸‡:\n' +
      'â†’ à¸„à¸™à¹ƒà¸™à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸ˆà¸£à¸´à¸‡à¸ˆà¸°à¸žà¸¹à¸”à¹�à¸šà¸šà¸™à¸µà¹‰à¹„à¸«à¸¡?\n' +
      'â†’ à¸›à¸£à¸°à¹‚à¸¢à¸„à¸™à¸µà¹‰à¹€à¸›à¹‡à¸™ "à¸ à¸²à¸ž" à¸«à¸£à¸·à¸­ "à¹�à¸™à¸§à¸„à¸´à¸”"?\n' +
      'â†’ à¸–à¹‰à¸²à¸•à¸±à¸” sentence à¸™à¸µà¹‰à¸­à¸­à¸� à¸­à¸²à¸£à¸¡à¸“à¹Œà¸¢à¸±à¸‡à¸­à¸¢à¸¹à¹ˆà¹„à¸«à¸¡? à¸–à¹‰à¸²à¹ƒà¸Šà¹ˆ â†’ à¸•à¸±à¸”à¸­à¸­à¸�\n' +
      'â†’ à¸™à¸µà¹ˆà¸„à¸·à¸­à¹‚à¸žà¸ªà¸•à¹Œà¸ˆà¸£à¸´à¸‡à¸šà¸™ Facebook à¸«à¸£à¸·à¸­à¹€à¸£à¸µà¸¢à¸‡à¸„à¸§à¸²à¸¡?\n\n' +
      '[ AUTO CLEAN ] à¸¥à¸šà¸„à¸³à¸Ÿà¸¸à¹ˆà¸¡à¹€à¸Ÿà¸·à¸­à¸¢ > à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸ à¸²à¸©à¸²à¸—à¸²à¸‡à¸�à¸²à¸£ > à¸•à¸£à¸§à¸ˆà¸�à¸¥à¸´à¹ˆà¸™ AI > à¸­à¹ˆà¸²à¸™à¹ƒà¸«à¸¡à¹ˆ à¸–à¹‰à¸²à¸ªà¸°à¸”à¸¸à¸”à¹€à¸‚à¸µà¸¢à¸™à¹ƒà¸«à¸¡à¹ˆ\n' +
      '=== à¸ˆà¸š HUMAN WRITING DNA V3 ===\n\n' +
      `à¸ªà¸£à¹‰à¸²à¸‡à¸­à¸¢à¹ˆà¸²à¸‡à¸™à¹‰à¸­à¸¢ ${targetCount || 5} à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™:\n` +
      'à¹€à¸‚à¸µà¸¢à¸™à¹ƒà¸™à¸¡à¸¸à¸¡à¸¡à¸­à¸‡à¸—à¸µà¹ˆà¸•à¹ˆà¸²à¸‡à¸�à¸±à¸™à¸•à¸²à¸¡à¸ˆà¸³à¸™à¸§à¸™à¸—à¸µà¹ˆà¸‚à¸­ (à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¸¡à¸¸à¸¡à¸¡à¸­à¸‡: à¹„à¸—à¸¡à¹Œà¹„à¸¥à¸™à¹Œà¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œ, à¸‚à¸¢à¸µà¹‰à¸ˆà¸±à¸‡à¸«à¸§à¸°à¸­à¸²à¸£à¸¡à¸“à¹Œ, à¹€à¸›à¸´à¸”à¹€à¸£à¸·à¹ˆà¸­à¸‡à¹�à¸£à¸‡à¹†, à¸¡à¸¸à¸¡à¸¡à¸­à¸‡à¸„à¸™à¹ƒà¸™à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œ, à¸«à¸£à¸·à¸­à¹€à¸ˆà¸²à¸°à¸¥à¸¶à¸�à¸„à¸§à¸²à¸¡à¸ˆà¸£à¸´à¸‡)\n\n' +
      '=== à¸�à¸Žà¹€à¸«à¸¥à¹‡à¸� FACEBOOK SAFETY â€” à¸šà¸±à¸‡à¸„à¸±à¸šà¸—à¸¸à¸�à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™ ===\n' +
      'à¸«à¹‰à¸²à¸¡à¹ƒà¸Šà¹‰à¸„à¸³à¹€à¸ªà¸µà¹ˆà¸¢à¸‡à¸•à¹ˆà¸­à¹„à¸›à¸™à¸µà¹‰à¹ƒà¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸—à¸µà¹ˆà¹€à¸‚à¸µà¸¢à¸™ à¹ƒà¸«à¹‰ rewrite à¹€à¸›à¹‡à¸™à¸„à¸³à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢à¹€à¸ªà¸¡à¸­:\n\n' +
      '"à¸†à¹ˆà¸²" â†’ "à¸—à¸³à¹ƒà¸«à¹‰à¹€à¸ªà¸µà¸¢à¸Šà¸µà¸§à¸´à¸•" à¸«à¸£à¸·à¸­ "à¸�à¹ˆà¸­à¹€à¸«à¸•à¸¸"\n' +
      '"à¸†à¸²à¸•à¸�à¸£à¸£à¸¡" â†’ "à¹€à¸«à¸•à¸¸à¸ªà¸¹à¸�à¹€à¸ªà¸µà¸¢" à¸«à¸£à¸·à¸­ "à¸„à¸”à¸µà¸£à¹‰à¸²à¸¢à¹�à¸£à¸‡"\n' +
      '"à¸¨à¸ž" â†’ "à¸£à¹ˆà¸²à¸‡à¸œà¸¹à¹‰à¹€à¸ªà¸µà¸¢à¸Šà¸µà¸§à¸´à¸•"\n' +
      '"à¸•à¸²à¸¢/à¸”à¸±à¸š/à¸ªà¸´à¹‰à¸™à¹ƒà¸ˆ" â†’ "à¸ˆà¸²à¸�à¹„à¸›" à¸«à¸£à¸·à¸­ "à¹€à¸ªà¸µà¸¢à¸Šà¸µà¸§à¸´à¸•"\n' +
      '"à¸ªà¸¢à¸­à¸‡/à¹‚à¸«à¸”/à¸ªà¸¥à¸”" â†’ "à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆ" à¸«à¸£à¸·à¸­ "à¸™à¹ˆà¸²à¸•à¸�à¹ƒà¸ˆ"\n' +
      '"à¹€à¸¥à¸·à¸­à¸”" â†’ "à¸£à¹ˆà¸­à¸‡à¸£à¸­à¸¢à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œ"\n' +
      '"à¹�à¸—à¸‡" â†’ "à¹ƒà¸Šà¹‰à¸‚à¸­à¸‡à¸¡à¸µà¸„à¸¡"\n' +
      '"à¸¢à¸´à¸‡" â†’ "à¹ƒà¸Šà¹‰à¸­à¸²à¸§à¸¸à¸˜à¸›à¸·à¸™"\n' +
      '"à¸‚à¹ˆà¸¡à¸‚à¸·à¸™" â†’ "à¸¥à¹ˆà¸§à¸‡à¸¥à¸°à¹€à¸¡à¸´à¸”à¸—à¸²à¸‡à¹€à¸žà¸¨"\n' +
      '"à¸œà¸¹à¸�à¸„à¸­/à¸ˆà¸šà¸Šà¸µà¸§à¸´à¸•" â†’ "à¹€à¸ªà¸µà¸¢à¸Šà¸µà¸§à¸´à¸•à¸­à¸¢à¹ˆà¸²à¸‡à¸™à¹ˆà¸²à¹€à¸¨à¸£à¹‰à¸²"\n' +
      '"à¸Šà¸³à¹�à¸«à¸¥à¸°/à¸«à¸¡à¸�à¸¨à¸ž" â†’ "à¹€à¸«à¸•à¸¸à¸£à¸¸à¸™à¹�à¸£à¸‡à¸­à¸¢à¹ˆà¸²à¸‡à¸¢à¸´à¹ˆà¸‡"\n' +
      '"à¸—à¸¸à¸šà¸•à¸µ/à¸—à¸³à¸£à¹‰à¸²à¸¢" â†’ "à¹ƒà¸Šà¹‰à¸„à¸§à¸²à¸¡à¸£à¸¸à¸™à¹�à¸£à¸‡"\n' +
      '"à¸ˆà¸±à¸”à¸‰à¸²à¸�" â†’ "à¸ªà¸£à¹‰à¸²à¸‡à¸ªà¸–à¸²à¸™à¸�à¸²à¸£à¸“à¹Œ"\n\n' +
      'à¸«à¸¥à¸±à¸�à¸�à¸²à¸£: à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ "à¸„à¸§à¸²à¸¡à¹�à¸£à¸‡" â†’ "à¸­à¸²à¸£à¸¡à¸“à¹Œ" à¹€à¸™à¹‰à¸™ emotional storytelling à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ shock/gore\n' +
      'à¸«à¹‰à¸²à¸¡ clickbait: "à¸„à¸¸à¸“à¸ˆà¸°à¹„à¸¡à¹ˆà¹€à¸Šà¸·à¹ˆà¸­", "à¹�à¸Šà¸£à¹Œà¸”à¹ˆà¸§à¸™", "à¸”à¸¹à¸�à¹ˆà¸­à¸™à¹‚à¸”à¸™à¸¥à¸š"\n' +
      'à¸«à¹‰à¸²à¸¡ engagement bait: "à¸žà¸´à¸¡à¸žà¹Œ 1", "à¹€à¸¡à¸™à¸•à¹Œ 99", "à¹ƒà¸„à¸£à¹€à¸«à¹‡à¸™à¸”à¹‰à¸§à¸¢à¸�à¸”à¹„à¸¥à¸�à¹Œ"\n' +
      '=== à¸ˆà¸šà¸�à¸Ž FACEBOOK SAFETY ===\n\n' +
      `âš ï¸�âš ï¸�âš ï¸� à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¹€à¸”à¹‡à¸”à¸‚à¸²à¸”: à¸•à¹‰à¸­à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œà¹ƒà¸«à¹‰à¸„à¸£à¸šà¸ˆà¸³à¸™à¸§à¸™ ${targetCount || 5} à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™ à¸«à¹‰à¸²à¸¡à¸‚à¸²à¸”à¸«à¸²à¸¢ à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¹�à¸•à¹ˆà¸¥à¸°à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸•à¹‰à¸­à¸‡à¸¡à¸µà¸„à¸§à¸²à¸¡à¸¢à¸²à¸§à¸•à¸²à¸¡à¸—à¸µà¹ˆà¸�à¸³à¸«à¸™à¸” âš ï¸�âš ï¸�âš ï¸�\n\n` +
      'à¸•à¸­à¸šà¹€à¸›à¹‡à¸™ JSON:\n' +
      '{\n' +
      '  "versions": [\n' +
      '    {"style": "à¸Šà¸·à¹ˆà¸­à¹�à¸™à¸§", "title": "à¸žà¸²à¸”à¸«à¸±à¸§", "content": "à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸¢à¸²à¸§ ${lenCfg.min}-${lenCfg.max} à¸„à¸³ à¹�à¸šà¹ˆà¸‡ ${lenCfg.paraDesc} à¸„à¸±à¹ˆà¸™à¸”à¹‰à¸§à¸¢ \\n\\n", "hook": "à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸›à¸´à¸”", "closing": "à¸›à¸£à¸°à¹‚à¸¢à¸„à¸›à¸´à¸”à¸�à¸£à¸°à¸•à¸¸à¹‰à¸™", "tone": "à¹‚à¸—à¸™à¹€à¸ªà¸µà¸¢à¸‡", "target": "à¸�à¸¥à¸¸à¹ˆà¸¡à¹€à¸›à¹‰à¸²à¸«à¸¡à¸²à¸¢"}\n' +
      '  ],\n' +
      '  "news_reference": "à¸ªà¸£à¸¸à¸›à¸‚à¹ˆà¸²à¸§à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¸—à¸µà¹ˆà¹ƒà¸Šà¹‰à¸­à¹‰à¸²à¸‡à¸­à¸´à¸‡ 2-3 à¸›à¸£à¸°à¹‚à¸¢à¸„"\n' +
      '}';

    console.log(`\nðŸ“¦ ${'â”€'.repeat(50)}`);
    console.log(`ðŸ“¦ NARRATIVE RECONSTRUCTION COMPOSE (mode=analyze)`);
    console.log(`ðŸ“¦  â‘  Library Prompt: "${smartPrompt?.promptName || '-'}" (${(smartPrompt?.promptText||'').length}ch)`);
    console.log(`ðŸ“¦  â‘¡ sourceRemovedFromCompose: âœ… TRUE`);
    console.log(`ðŸ“¦  â‘¢ NarrativePayload: facts=${narrativePayload?.coreFacts?.length || '?'} | research=${narrativePayload?.researchContexts?.length || 0} | quotes=${narrativePayload?.quoteFragments?.length || 0}`);
    console.log(`ðŸ“¦  â‘£ Research Grade: ${_researchGrade || 'unknown'}`);
    console.log(`ðŸ“¦  â‘¤ Fact Sufficiency: ${narrativePayload?.factSufficiency || 'unknown'}`);
    console.log(`ðŸ“¦  â‘¥ Blueprint: ${emotionalBlueprint?.core_emotion || 'â�Œ none'}`);
    console.log(`ðŸ“¦  â‘¦ Anti-Duplicate+Factual System: âœ… injected`);
    console.log(`ðŸ“¦  TOTAL PROMPT LENGTH: ${multiPrompt?.length || 0}ch`);
    console.log(`ðŸ“¦ ${'â”€'.repeat(50)}\n`);

    try {
      console.log(`[ðŸ¤– AI CALL] mode=write | calling SmartAI (Claude > GPT-4o)...`);
      const { result, model: usedModel } = await callSmartAI('write', { prompt: multiPrompt, temperature: 0.7, maxTokens: 10000 });
      console.log(`[ðŸ¤– AI RESULT] model used: ${usedModel}`);
      console.log(`[ðŸ¤– AI RESULT] versions: ${result?.versions?.length || 0}`);

      const aiError = result?._error || null;
      const aiWarning = result?._warning || null;

      const debugInfo = {
        promptLength: multiPrompt.length,
        newsBodyLength: actualNewsBody?.length || 0,
        newsTitle: actualNewsTitle || '',
        breakdownPointsCount: actualBreakdown?.key_points?.length || 0,
        presetUsed: smartPrompt?.category || 'library',
        promptSource,
        promptMatchReason: promptMatchReason || 'unknown',
        isBorrowed: smartPrompt?._isBorrowed || false,
        borrowReason: smartPrompt?._borrowReason || null,
        newsTypeDetected: newsTypeDetected || '',
        smartPromptName: smartPrompt ? (smartPrompt.promptName || smartPrompt.category) : null,
        smartPromptScore: smartPrompt?.viralScore || null,
        hasBreakdown: !!actualBreakdown,
        workflowId: workflowId || 'none',
        contextSource: wfContext ? 'DB (persistent)' : 'request (stateless)',
        promptPreview: multiPrompt.slice(0, 500) + '...',
        aiError,
        aiWarning,
        sourceRemovedFromCompose: true,
        narrativePayload: narrativePayload ? {
          coreFactsCount: narrativePayload.coreFacts?.length || 0,
          researchCount: narrativePayload.researchContexts?.length || 0,
          quoteFragmentsCount: narrativePayload.quoteFragments?.length || 0,
          researchGrade: narrativePayload.researchGrade || _researchGrade || 'unknown',
          factSufficiency: narrativePayload.factSufficiency || 'unknown',
          hasBlueprint: !!narrativePayload.emotionalBlueprint,
          narrativeAngle: narrativePayload.narrativeAngle || '',
        } : null,
        smartMatch: {
          totalPromptsLoaded,
          candidatesBeforeFilter: totalPromptsLoaded,
          candidatesAfterFilter: validPromptsCount,
          top10PromptScores,
          selectedPrompt: smartPrompt ? {
            id: smartPrompt.id,
            name: smartPrompt.promptName,
            category: smartPrompt.category,
            emotionalType: smartPrompt.emotionalType,
            score: selectedPromptScore
          } : null,
          selectedPromptScore,
          matchType,
          matchedDimensions,
          whyFallbackUsed,
          rejectedPromptsReason,
          newsAnalysis
        }
      };

      if (result && typeof result === 'object') {
        let versions = result.versions || [];
        if (versions.length === 0 && result.main_post) {
          versions = [{ style: smartPrompt?.category || 'library', title: actualNewsTitle, content: extractSummary(result), hook: '', closing: result.engagement_ending || '', tone: result.emotion || '', target: '' }];
        }

        // === ðŸ”� POST-PROCESSING QUALITY FILTERS ===
        const actualSourceText = actualNewsBody || text || '';
        versions = postProcessVersions(versions, actualSourceText, actualNewsTitle);
        console.log(`[Analyze-Service] âœ… Post-processing complete: ${versions.length} versions filtered`);

        const validation = validateOutput(result, { newsTitle: actualNewsTitle, newsBody: actualNewsBody });
        const firstContent = versions[0]?.content || '';
        const similarity = checkNarrativeSimilarity(actualNewsBody || '', firstContent);
        debugInfo.similarity = similarity;

        if (workflowId) {
          await saveAnalysis(workflowId, { versions, news_reference: result.news_reference }, smartPrompt?.id || 'library')
            .catch(e => console.error('[Analyze-Service] DB save err:', e.message));
          const agent = new MasterAgent(workflowId);
          await agent.loadFromDB().catch(() => {});
          agent.onAnalysisComplete({ versions, news_reference: result.news_reference });
          agent.onValidationComplete({ safetyPassed: validation.valid, issues: validation.issues, factCheckPassed: true, riskyWordsFound: [], riskyWordsReplaced: [] });
          await agent.saveMemoryToDB().catch(() => {});
        }

        let moderation = { overallSafe: true, results: [] };
        try {
          moderation = await moderateVersions(versions);
        } catch (modErr) {
          console.warn('[Analyze-Service] Moderation check skipped:', modErr.message);
        }

        if (promptSource === 'library' && smartPrompt?.id) {
          try {
            const trackStore = createStore('prompt-library');
            await trackStore.update(smartPrompt.id, (existing) => {
              existing.usageCount = (existing.usageCount || 0) + 1;
              existing.lastUsedAt = new Date().toISOString();
              return existing;
            });
          } catch (trackErr) {
            console.log('[Analyze-Service] Usage tracking skipped:', trackErr.message);
          }
        }

        logPipeline({ workflowId, step: 'analyze', status: 'success', model: usedModel, duration: Date.now() - _pipelineStart, detail: (versions?.length || 0) + ' versions' }).catch(() => {});
        return {
          success: true,
          data: {
            usedPreset: promptSource === 'library'
              ? {
                  id: 'library',
                  name: smartPrompt._isBorrowed ? `âš ï¸� ${smartPrompt.promptName || smartPrompt.category}` : `ðŸ�›ï¸� ${smartPrompt.promptName || smartPrompt.category}`,
                  source: 'library',
                  viralScore: smartPrompt.viralScore,
                  isBorrowed: smartPrompt._isBorrowed || false,
                  borrowReason: smartPrompt._borrowReason || null,
                }
              : { id: 'library', name: 'ðŸ“¦ Library', source: 'library' },
            usedModel: usedModel || 'gpt-4o',
            versions,
            news_reference: result.news_reference || '',
            summary: extractSummary(result) || versions[0]?.content || '',
            key_points: extractArray(result, 'key_points', 'keyPoints', 'viral_headlines'),
            emotion: extractString(result, 'emotion', 'tone'),
            viral_potential: extractString(result, 'viral_potential', 'facebook_safety_level'),
            engagement_ending: result.engagement_ending || '',
            facebook_safe_check: result.facebook_safe_check || null,
            validation,
            moderation,
            availableModels: getAvailableModels(),
            debug: debugInfo,
          },
        };
      }
    } catch (err) {
      console.error('[Analyze-Service] ERROR:', err.message);
      logPipeline({ workflowId, step: 'analyze', status: 'failed', duration: Date.now() - _pipelineStart, error: err.message }).catch(() => {});
      throw err;
    }
  }

  // ===== MODE: BLUEPRINT â€” Emotional Architecture Planning =====
  if (mode === 'blueprint') {
    console.log('[Blueprint-Service] === EMOTIONAL ARCHITECTURE MODE ===');
    try {
      const actualNewsTitle = newsTitle || '';
      const actualNewsBody = text || '';
      const actualBreakdown = breakdownData || {};

      const coreStory = actualBreakdown.core_story || '';
      const keyPoints = actualBreakdown.key_points?.map(kp => kp.point || kp).join('\n') || '';
      const quotes = actualBreakdown.quotes?.join(' | ') || '';
      const conflicts = actualBreakdown.conflicts?.join(', ') || '';
      const bestAngle = actualBreakdown.best_main_angle?.angle_name || '';
      const emotionalCore = actualBreakdown.main_emotional_core || '';

      const blueprintPrompt = `à¸„à¸¸à¸“à¸„à¸·à¸­ Story Architect à¸œà¸¹à¹‰à¹€à¸Šà¸µà¹ˆà¸¢à¸§à¸Šà¸²à¸�à¹€à¸‚à¸µà¸¢à¸™à¸‚à¹ˆà¸²à¸§à¹„à¸§à¸£à¸±à¸¥à¸—à¸µà¹ˆà¸­à¹ˆà¸²à¸™à¸¥à¸·à¹ˆà¸™à¹�à¸¥à¸°à¸­à¸´à¸™à¸ˆà¸£à¸´à¸‡
à¸‡à¸²à¸™: à¸§à¸²à¸‡à¹�à¸œà¸™à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸­à¸²à¸£à¸¡à¸“à¹Œà¸�à¹ˆà¸­à¸™à¹€à¸‚à¸µà¸¢à¸™ â€” à¸«à¹‰à¸²à¸¡à¹€à¸‚à¸µà¸¢à¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸ˆà¸£à¸´à¸‡ à¸§à¸²à¸‡à¹�à¸œà¸™à¸­à¸¢à¹ˆà¸²à¸‡à¹€à¸”à¸µà¸¢à¸§

=== à¸‚à¹ˆà¸²à¸§à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸§à¸²à¸‡à¹�à¸œà¸™ ===
à¸«à¸±à¸§à¸‚à¹‰à¸­: ${actualNewsTitle}
à¹€à¸™à¸·à¹‰à¸­à¸«à¸²: ${actualNewsBody.slice(0, 2500)}
${coreStory ? `à¹�à¸�à¹ˆà¸™à¸‚à¹ˆà¸²à¸§: ${coreStory}` : ''}
${keyPoints ? `à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸ªà¸³à¸„à¸±à¸�:\n${keyPoints}` : ''}
${quotes ? `à¸„à¸³à¸žà¸¹à¸”à¸ªà¸³à¸„à¸±à¸�: ${quotes}` : ''}
${conflicts ? `à¸ˆà¸¸à¸”à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡: ${conflicts}` : ''}
${bestAngle ? `à¸¡à¸¸à¸¡à¸—à¸µà¹ˆà¸”à¸µà¸ªà¸¸à¸”: ${bestAngle}` : ''}
${emotionalCore ? `à¹�à¸�à¹ˆà¸™ Emotional: ${emotionalCore}` : ''}
=== à¸ˆà¸šà¸‚à¹ˆà¸²à¸§ ===

à¸§à¸²à¸‡à¹�à¸œà¸™ 6 à¸ªà¹ˆà¸§à¸™:

1. CORE_EMOTION â€” à¹�à¸�à¸™à¸­à¸²à¸£à¸¡à¸“à¹Œà¹€à¸”à¸µà¸¢à¸§à¸—à¸µà¹ˆà¸—à¸£à¸‡à¸žà¸¥à¸±à¸‡à¸—à¸µà¹ˆà¸ªà¸¸à¸”à¹ƒà¸™à¸‚à¹ˆà¸²à¸§à¸™à¸µà¹‰
   à¹€à¸¥à¸·à¸­à¸�à¹„à¸”à¹‰ 1 à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™: à¹‚à¸�à¸£à¸˜ | à¸ªà¸‡à¸ªà¸²à¸£ | à¸Šà¹‡à¸­à¸� | à¸­à¸¶à¸”à¸­à¸±à¸” | à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆ | à¸­à¸šà¸­à¸¸à¹ˆà¸™ | à¸¢à¸´à¸™à¸”à¸µ | à¸‚à¸³à¸‚à¸±à¸™
   à¸žà¸£à¹‰à¸­à¸¡ emotion_reason: à¹€à¸«à¸•à¸¸à¸œà¸¥à¸—à¸µà¹ˆà¹€à¸¥à¸·à¸­à¸�à¹�à¸�à¸™à¸™à¸µà¹‰ (1 à¸›à¸£à¸°à¹‚à¸¢à¸„)

2. EMOTIONAL_BRANCHES â€” à¸ˆà¸¸à¸”à¸—à¸µà¹ˆà¸ˆà¸° "à¸”à¸±à¸™à¸­à¸²à¸£à¸¡à¸“à¹Œ" à¹�à¸�à¸™à¸«à¸¥à¸±à¸�à¸™à¸±à¹‰à¸™ (4-6 à¸ˆà¸¸à¸”)
   à¹�à¸•à¹ˆà¸¥à¸°à¸ˆà¸¸à¸”à¸•à¹‰à¸­à¸‡à¹€à¸›à¹‡à¸™: à¸ˆà¸¸à¸”à¹€à¸ˆà¹‡à¸š | à¸ˆà¸¸à¸”à¸Šà¹‡à¸­à¸� | à¸ˆà¸¸à¸”à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡ | à¸ˆà¸¸à¸”à¸ªà¸‡à¸ªà¸²à¸£ | à¸ˆà¸¸à¸”à¹‚à¸�à¸£à¸˜ | à¸ˆà¸¸à¸”à¸—à¸µà¹ˆà¸„à¸™à¸­à¸¢à¸²à¸�à¹€à¸–à¸µà¸¢à¸‡ | à¸ˆà¸¸à¸”à¸—à¸µà¹ˆà¹�à¸Šà¸£à¹Œà¸•à¹ˆà¸­
   content = à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸£à¸´à¸‡à¸ˆà¸²à¸�à¸‚à¹ˆà¸²à¸§ (à¹„à¸¡à¹ˆà¹�à¸•à¹ˆà¸‡)

3. CONTEXT_SELECTION â€” à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸µà¹ˆà¹ƒà¸ªà¹ˆà¹„à¸”à¹‰ à¸žà¸£à¹‰à¸­à¸¡à¹€à¸«à¸•à¸¸à¸œà¸¥à¹€à¸”à¸µà¸¢à¸§
   à¹€à¸¥à¸·à¸­à¸�à¹€à¸‰à¸žà¸²à¸°à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸µà¹ˆà¸•à¸£à¸‡à¹€à¸‡à¸·à¹ˆà¸­à¸™à¹„à¸‚à¸™à¸µà¹‰à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™:
   - à¸‚à¸¢à¸²à¸¢à¹�à¸œà¸¥: à¸—à¸³à¹ƒà¸«à¹‰à¹€à¸£à¸·à¹ˆà¸­à¸‡à¹€à¸ˆà¹‡à¸šà¸�à¸§à¹ˆà¸²à¹€à¸”à¸´à¸¡
   - à¹€à¸žà¸´à¹ˆà¸¡à¸™à¹‰à¸³à¸«à¸™à¸±à¸�: à¸¢à¸·à¸™à¸¢à¸±à¸™à¸„à¸§à¸²à¸¡à¸ˆà¸£à¸´à¸‡
   - contrast: à¸ à¸²à¸žà¸™à¸­à¸� vs à¸„à¸§à¸²à¸¡à¸ˆà¸£à¸´à¸‡
   - tension: à¸”à¸±à¸™à¸„à¸§à¸²à¸¡à¸•à¸¶à¸‡à¹€à¸„à¸£à¸µà¸¢à¸”
   - à¹�à¸£à¸‡à¸ˆà¸¹à¸‡à¹ƒà¸ˆ: à¸­à¸˜à¸´à¸šà¸²à¸¢à¸§à¹ˆà¸²à¸—à¸³à¹„à¸¡à¸–à¸¶à¸‡à¸—à¸³
   à¸–à¹‰à¸²à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹„à¸«à¸™à¹„à¸¡à¹ˆà¹€à¸‚à¹‰à¸² 5 à¸‚à¹‰à¸­à¸™à¸µà¹‰ â†’ à¹„à¸¡à¹ˆà¹ƒà¸ªà¹ˆ

4. EMOTIONAL_TIMELINE â€” à¸¥à¸³à¸”à¸±à¸šà¸›à¸¥à¹ˆà¸­à¸¢à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸µà¸¥à¸°à¸Šà¸±à¹‰à¸™ (6-8 à¸‚à¸±à¹‰à¸™)
   à¹€à¸£à¸´à¹ˆà¸¡à¸ˆà¸²à¸� HOOK â†’ à¸ˆà¸šà¸”à¹‰à¸§à¸¢à¸›à¸£à¸°à¹‚à¸¢à¸„à¸—à¸¸à¸šà¸—à¹‰à¸²à¸¢
   à¸«à¹‰à¸²à¸¡à¹€à¸£à¸µà¸¢à¸‡ timeline à¹�à¸šà¸š Aâ†’Bâ†’C à¸•à¸²à¸¡à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œà¸ˆà¸£à¸´à¸‡
   à¸•à¹‰à¸­à¸‡à¹€à¸£à¸µà¸¢à¸‡à¸•à¸²à¸¡ "à¸£à¸°à¸”à¸±à¸šà¸­à¸²à¸£à¸¡à¸“à¹Œ" à¹�à¸—à¸™

5. BRIDGES â€” à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡à¸›à¸£à¸°à¹€à¸”à¹‡à¸™ (3-5 à¸›à¸£à¸°à¹‚à¸¢à¸„)
   à¸•à¹‰à¸­à¸‡à¹€à¸›à¹‡à¸™à¸ à¸²à¸©à¸²à¸„à¸™à¸žà¸¹à¸”à¸ˆà¸£à¸´à¸‡ à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸ à¸²à¸©à¸²à¸—à¸²à¸‡à¸�à¸²à¸£
   à¹€à¸Šà¹ˆà¸™: "à¹�à¸•à¹ˆà¸ªà¸´à¹ˆà¸‡à¸—à¸µà¹ˆà¸«à¸™à¸±à¸�à¸�à¸§à¹ˆà¸²à¸™à¸±à¹‰à¸™à¸„à¸·à¸­..." / "à¸¢à¹‰à¸­à¸™à¸�à¸¥à¸±à¸šà¹„à¸›à¸�à¹ˆà¸­à¸™à¸«à¸™à¹‰à¸²à¸™à¸µà¹‰..."

6. FORBIDDEN â€” à¸ªà¸´à¹ˆà¸‡à¸—à¸µà¹ˆà¸«à¹‰à¸²à¸¡à¹€à¸‚à¸µà¸¢à¸™à¹ƒà¸™à¸‚à¹ˆà¸²à¸§à¸™à¸µà¹‰à¹‚à¸”à¸¢à¹€à¸‰à¸žà¸²à¸° (2-4 à¸‚à¹‰à¸­)
   à¹€à¸ˆà¸²à¸°à¸ˆà¸‡à¸�à¸±à¸šà¸‚à¹ˆà¸²à¸§à¸™à¸µà¹‰à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™ à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸�à¸Žà¸—à¸±à¹ˆà¸§à¹„à¸›

à¸�à¸Žà¹€à¸«à¸¥à¹‡à¸�:
- CORE_EMOTION à¹€à¸”à¸µà¸¢à¸§à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™ à¸«à¹‰à¸²à¸¡à¸«à¸¥à¸²à¸¢à¹�à¸�à¸™
- à¸«à¹‰à¸²à¸¡à¹ƒà¸ªà¹ˆà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸µà¹ˆà¹„à¸¡à¹ˆà¸”à¸±à¸™à¸­à¸²à¸£à¸¡à¸“à¹Œà¹�à¸�à¸™à¸«à¸¥à¸±à¸�
- BRIDGES à¸•à¹‰à¸­à¸‡à¹€à¸›à¹‡à¸™à¸ à¸²à¸©à¸²à¸—à¸µà¹ˆà¸„à¸™à¹„à¸—à¸¢à¸žà¸¹à¸”à¸ˆà¸£à¸´à¸‡à¸šà¸™ Facebook
- à¸—à¸¸à¸�à¸­à¸¢à¹ˆà¸²à¸‡à¸•à¹‰à¸­à¸‡à¸¡à¸²à¸ˆà¸²à¸�à¸‚à¹ˆà¸²à¸§à¸ˆà¸£à¸´à¸‡ à¸«à¹‰à¸²à¸¡à¹�à¸•à¹ˆà¸‡

à¸•à¸­à¸š JSON:
{
  "core_emotion": "à¸­à¸²à¸£à¸¡à¸“à¹Œà¸«à¸¥à¸±à¸�",
  "emotion_reason": "à¹€à¸«à¸•à¸¸à¸œà¸¥à¸—à¸µà¹ˆà¹€à¸¥à¸·à¸­à¸�",
  "emotional_branches": [
    { "branch_type": "à¸ˆà¸¸à¸”à¹€à¸ˆà¹‡à¸š|à¸ˆà¸¸à¸”à¸Šà¹‡à¸­à¸�|à¸ˆà¸¸à¸”à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡|à¸ˆà¸¸à¸”à¸ªà¸‡à¸ªà¸²à¸£|à¸ˆà¸¸à¸”à¹‚à¸�à¸£à¸˜|à¸ˆà¸¸à¸”à¹�à¸Šà¸£à¹Œ", "content": "à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸£à¸´à¸‡à¸ˆà¸²à¸�à¸‚à¹ˆà¸²à¸§" }
  ],
  "context_selection": [
    { "info": "à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸µà¹ˆà¸ˆà¸°à¹ƒà¸ªà¹ˆ", "purpose": "à¸‚à¸¢à¸²à¸¢à¹�à¸œà¸¥|à¹€à¸žà¸´à¹ˆà¸¡à¸™à¹‰à¸³à¸«à¸™à¸±à¸�|contrast|tension|à¹�à¸£à¸‡à¸ˆà¸¹à¸‡à¹ƒà¸ˆ" }
  ],
  "emotional_timeline": ["HOOK â€” ...", "à¸ˆà¸¸à¸”à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹�à¸£à¸� â€” ...", "...", "à¸›à¸£à¸°à¹‚à¸¢à¸„à¸—à¸¸à¸šà¸—à¹‰à¸²à¸¢ â€” ..."],
  "bridges": ["à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸Šà¸·à¹ˆà¸­à¸¡ 1", "à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸Šà¸·à¹ˆà¸­à¸¡ 2", "à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸Šà¸·à¹ˆà¸­à¸¡ 3"],
  "forbidden": ["à¸«à¹‰à¸²à¸¡à¹€à¸‚à¸µà¸¢à¸™à¸§à¹ˆà¸²...", "à¸«à¹‰à¸²à¸¡ ending à¹�à¸šà¸š..."]
}`;

      // FIX H3: Route Blueprint through aiRouter for fallback
      const { result: blueprintResult } = await callSmartAI('general', {
        prompt: blueprintPrompt,
        temperature: 0.3,
        maxTokens: 1200,
      });

      if (!blueprintResult?.core_emotion) {
        throw new Error('AI à¹„à¸¡à¹ˆà¸ªà¸²à¸¡à¸²à¸£à¸–à¸§à¸²à¸‡à¹�à¸œà¸™ Blueprint à¹„à¸”à¹‰');
      }

      console.log(`[Blueprint-Service] âœ… Core emotion: ${blueprintResult.core_emotion} | Branches: ${blueprintResult.emotional_branches?.length}`);
      await logPipeline({ workflowId, step: 'blueprint', status: 'success', detail: `emotion=${blueprintResult.core_emotion}` }).catch(() => {});

      return {
        success: true,
        data: {
          blueprint: blueprintResult,
          usedModel: 'gpt-4o-mini',
        },
      };
    } catch (err) {
      console.error('[Blueprint-Service] ERROR:', err.message);
      throw err;
    }
  }

  // ===== MODE: RESEARCH â€” AI à¸«à¸²à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡à¸ˆà¸²à¸�à¸«à¸±à¸§à¸‚à¹‰à¸­à¸‚à¹ˆà¸²à¸§ =====
  if (mode === 'research') {
    console.log('[Research-Service] === AI RESEARCH MODE ===');
    try {
      const actualNewsTitle = newsTitle || '';
      const actualNewsBody = text || '';
      const actualBreakdown = breakdownData || {};

      const keyPointsSummary = actualBreakdown.key_points?.map(kp => kp.point).join(', ') || '';
      const coreStory = actualBreakdown.core_story || '';
      const keyPeople = actualBreakdown.key_facts?.people?.join(', ') || '';
      const keyPlaces = actualBreakdown.key_facts?.places?.join(', ') || '';

      const researchPromptTemplate = getPrompt('research');
      const analysisCtx = [
        coreStory && ('à¹�à¸�à¹ˆà¸™à¸‚à¹ˆà¸²à¸§: ' + coreStory),
        keyPointsSummary && ('à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸ªà¸³à¸„à¸±à¸�: ' + keyPointsSummary),
        keyPeople && ('à¸šà¸¸à¸„à¸„à¸¥à¸ªà¸³à¸„à¸±à¸�: ' + keyPeople),
        keyPlaces && ('à¸ªà¸–à¸²à¸™à¸—à¸µà¹ˆ: ' + keyPlaces),
      ].filter(Boolean).join('\n');

      const researchPrompt = researchPromptTemplate.prompt
        .replace('{title}', actualNewsTitle)
        .replace('{content}', actualNewsBody.slice(0, 3000))
        .replace('{analysis_context}', analysisCtx);

      console.log('[Research-Service] Prompt from promptStore, length: ' + researchPrompt.length + 'ch');

      let result, usedModel;
      try {
        const smartResult = await callSmartAI('analyze', { prompt: researchPrompt, temperature: 0.5, maxTokens: 6000 });
        result = smartResult.result;
        usedModel = smartResult.model;
        logPipeline({ workflowId, step: 'research', status: 'success', model: usedModel, duration: Date.now() - _pipelineStart, detail: 'Research via ' + usedModel }).catch(() => {});
      } catch (err) {
        console.warn(`[Research-Service] SmartAI failed: ${err.message}, fallback GPT-4o`);
        result = await callAI({ prompt: researchPrompt, temperature: 0.5, maxTokens: 6000 });
        usedModel = 'gpt-4o';
      }

      if (result && result.items) {
        console.log(`[Research-Service] âœ… Found ${result.items.length} items`);
        return {
          success: true,
          data: {
            items: result.items,
            usedModel,
            newsTitle: actualNewsTitle,
          },
        };
      } else {
        throw new Error('AI à¹„à¸¡à¹ˆà¸ªà¸²à¸¡à¸²à¸£à¸–à¸«à¸²à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡à¹„à¸”à¹‰');
      }
    } catch (err) {
      console.error('[Research-Service] ERROR:', err.message);
      throw err;
    }
  }

  // ===== MODE: MIX â€” AI à¹€à¸¥à¸·à¸­à¸�à¸¡à¸¸à¸¡à¸”à¸µà¸—à¸µà¹ˆà¸ªà¸¸à¸” à¸œà¸ªà¸¡à¹€à¸›à¹‡à¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¹ƒà¸«à¸¡à¹ˆ =====
  if (mode === 'mix') {
    console.log('[Mix-Service] === AI MIX ANGLES MODE ===');
    try {
      const actualNewsBody = text || '';
      const actualNewsTitle = newsTitle || '';
      const actualBreakdown = breakdownData || {};

      let fullCtx = '';
      if (workflowId) {
        const agent = new MasterAgent(workflowId);
        const loaded = await agent.loadFromDB().catch(() => false);
        if (loaded) {
          fullCtx = agent.compileContext();
          console.log(`[Mix-Service] âœ… Context compiled via MasterAgent (${fullCtx.length}ch)`);
        }
      }
      if (!fullCtx) {
        fullCtx = buildFullContext({ newsBody: actualNewsBody, newsTitle: actualNewsTitle, breakdownData: actualBreakdown });
        console.log('[Mix-Service] âš ï¸� Fallback to buildFullContext');
      }

      const anglesInfo = actualBreakdown.possible_angles?.map((a, i) =>
        `${i+1}. ${a.angle_name} [viral: ${a.facebook_viral_score}/10] â€” ${a.description} (à¸­à¸²à¸£à¸¡à¸“à¹Œ: ${a.target_emotion || '-'}, à¹�à¸Šà¸£à¹Œà¹€à¸žà¸£à¸²à¸°: ${a.share_trigger || '-'})`
      ).join('\n') || 'à¹„à¸¡à¹ˆà¸¡à¸µà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸¡à¸¸à¸¡à¸‚à¹ˆà¸²à¸§';

      const keyPointsInfo = actualBreakdown.key_points?.map((kp, i) =>
        `${i+1}. ${kp.point} [à¸ªà¸³à¸„à¸±à¸�: ${kp.importance}, à¸­à¸²à¸£à¸¡à¸“à¹Œ: ${kp.emotional_value}] â€” ${kp.detail}`
      ).join('\n') || '';

      const emotionalInfo = [
        actualBreakdown.core_story && `à¹�à¸�à¹ˆà¸™à¸‚à¹ˆà¸²à¸§: ${actualBreakdown.core_story}`,
        actualBreakdown.main_emotional_core && `Emotional Core: ${actualBreakdown.main_emotional_core}`,
        actualBreakdown.conflict_point && `à¸ˆà¸¸à¸” Conflict: ${actualBreakdown.conflict_point}`,
        actualBreakdown.viral_trigger && `Viral Trigger: ${actualBreakdown.viral_trigger}`,
      ].filter(Boolean).join('\n');

      const bestAngleInfo = actualBreakdown.best_main_angle ?
        `à¸¡à¸¸à¸¡à¸—à¸µà¹ˆà¸”à¸µà¸—à¸µà¹ˆà¸ªà¸¸à¸”: ${actualBreakdown.best_main_angle.angle_name} â€” ${actualBreakdown.best_main_angle.why_best}` : '';

      const hookInfo = actualBreakdown.emotional_hooks?.length ?
        `à¸ˆà¸¸à¸”à¸—à¸µà¹ˆà¸„à¸™à¸ˆà¸°à¸­à¸´à¸™: ${actualBreakdown.emotional_hooks.join(' | ')}` : '';

      const bestSections = actualBreakdown.best_sections?.length ?
        `à¸—à¹ˆà¸­à¸™à¸—à¸µà¹ˆà¸”à¸µà¸—à¸µà¹ˆà¸ªà¸¸à¸”: ${actualBreakdown.best_sections.join(' | ')}` : '';

      const langStrategy = actualBreakdown.language_strategy ?
        `à¸�à¸¥à¸¢à¸¸à¸—à¸˜à¹Œà¸ à¸²à¸©à¸²: à¹€à¸›à¸´à¸”=${actualBreakdown.language_strategy.opening_style || '-'}, à¹€à¸¥à¹ˆà¸²=${actualBreakdown.language_strategy.storytelling_style || '-'}, à¸ˆà¸±à¸‡à¸«à¸§à¸°=${actualBreakdown.language_strategy.emotional_pacing || '-'}, à¸›à¸´à¸”=${actualBreakdown.language_strategy.ending_style || '-'}` : '';

      let researchCtx = '';
      if (researchData?.items?.length > 0) {
        researchCtx = '\n\n=== à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡à¸ˆà¸²à¸� AI Research ===\n' +
          researchData.items.map((item, i) =>
            `${i+1}. [${item.type}] ${item.title}: ${item.content}\n   à¹�à¸«à¸¥à¹ˆà¸‡à¸­à¹‰à¸²à¸‡à¸­à¸´à¸‡: ${item.sourceUrl || item.sourceName || '-'}`
          ).join('\n') +
          '\nâš ï¸� à¸„à¸³à¹�à¸™à¸°à¸™à¸³à¸�à¸²à¸£à¹ƒà¸Šà¹‰à¸‚à¹‰à¸­à¸¡à¸¹à¸¥: à¹€à¸¥à¸·à¸­à¸�à¸«à¸¢à¸´à¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥ à¸•à¸±à¸§à¹€à¸¥à¸‚ à¸ªà¸–à¸´à¸•à¸´ à¸«à¸£à¸·à¸­à¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡ à¸ˆà¸²à¸� "à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡à¸ˆà¸²à¸� AI Research" à¸”à¹‰à¸²à¸™à¸šà¸™ à¸¡à¸²à¹€à¸‚à¸µà¸¢à¸™à¸­à¸˜à¸´à¸šà¸²à¸¢à¹€à¸ªà¸£à¸´à¸¡à¹ƒà¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸² **à¹€à¸‰à¸žà¸²à¸°à¸ªà¹ˆà¸§à¸™à¸—à¸µà¹ˆà¹€à¸‚à¹‰à¸²à¸�à¸±à¸šà¸šà¸£à¸´à¸šà¸—à¹�à¸¥à¸°à¸¡à¸¸à¸¡à¸¡à¸­à¸‡à¸‚à¸­à¸‡à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸™à¸µà¹‰** à¹€à¸žà¸·à¹ˆà¸­à¹€à¸žà¸´à¹ˆà¸¡à¸„à¸§à¸²à¸¡à¸¥à¸¶à¸�à¹�à¸¥à¸°à¸™à¹ˆà¸²à¹€à¸Šà¸·à¹ˆà¸­à¸–à¸·à¸­ (à¹„à¸¡à¹ˆà¸ˆà¸³à¹€à¸›à¹‡à¸™à¸•à¹‰à¸­à¸‡à¹ƒà¸Šà¹‰à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸” à¹�à¸¥à¸°à¸«à¹‰à¸²à¸¡à¹�à¸—à¸£à¸� URL à¸«à¸£à¸·à¸­à¸„à¸³à¸§à¹ˆà¸²à¸­à¹‰à¸²à¸‡à¸­à¸´à¸‡à¸¥à¸‡à¹ƒà¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¹‚à¸”à¸¢à¹€à¸”à¹‡à¸”à¸‚à¸²à¸”)\n' +
          'âš ï¸� à¸�à¸Žà¸„à¸§à¸²à¸¡à¸¢à¸²à¸§: à¹€à¸‚à¸µà¸¢à¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¹ƒà¸«à¹‰à¸¢à¸²à¸§ à¸¥à¸¶à¸�à¸‹à¸¶à¹‰à¸‡ à¹�à¸¥à¸°à¸¡à¸µà¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¸—à¸µà¹ˆà¸ˆà¸±à¸šà¹ƒà¸ˆà¸œà¸¹à¹‰à¸­à¹ˆà¸²à¸™ à¸«à¹‰à¸²à¸¡à¹€à¸‚à¸µà¸¢à¸™à¸ªà¸£à¸¸à¸›à¸£à¸§à¸šà¸£à¸±à¸”à¸ªà¸±à¹‰à¸™à¹†\n' +
          '\n=== à¸ˆà¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡ ===\n';
      }

      // === SMART RESEARCH: Fact Pool from 6 Agents ===
      let factPoolCtx = '';
      if (factPool && factPool.facts?.length > 0) {
        factPoolCtx = '\n\n=== ðŸ§  à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸Šà¸´à¸‡à¸¥à¸¶à¸�à¸ˆà¸²à¸� Smart Research (à¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡à¸—à¸µà¹ˆà¸„à¹‰à¸™à¸žà¸šà¹€à¸�à¸µà¹ˆà¸¢à¸§à¸�à¸±à¸šà¸šà¸¸à¸„à¸„à¸¥à¹ƒà¸™à¸‚à¹ˆà¸²à¸§) ===\n';
        if (factPool.entitySummary) {
          factPoolCtx += `à¸šà¸¸à¸„à¸„à¸¥: ${factPool.entityName || ''} â€” ${factPool.entitySummary}\n\n`;
        }
        factPool.facts.forEach((fact, i) => {
          const catLabel = {
            achievement: 'ðŸ�† à¸œà¸¥à¸‡à¸²à¸™', numbers: 'ðŸ“Š à¸•à¸±à¸§à¹€à¸¥à¸‚', quote: 'ðŸ—£ï¸� à¸„à¸³à¸žà¸¹à¸”',
            history: 'âš¡ à¸›à¸£à¸°à¸§à¸±à¸•à¸´', funfact: 'ðŸ’¡ à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸™à¹ˆà¸²à¸£à¸¹à¹‰', publicwork: 'ðŸŽ¤ à¸‡à¸²à¸™à¸ªà¸²à¸˜à¸²à¸£à¸“à¸°'
          }[fact.category] || 'ðŸ“Œ à¸‚à¹‰à¸­à¸¡à¸¹à¸¥';
          factPoolCtx += `${i+1}. [${catLabel}] ${fact.text}\n   (à¹�à¸«à¸¥à¹ˆà¸‡: ${fact.source || '-'})\n`;
        });
        factPoolCtx += `\nâš ï¸� à¸„à¸³à¹�à¸™à¸°à¸™à¸³ Smart Research:\n`;
        factPoolCtx += `- à¹€à¸¥à¸·à¸­à¸�à¸«à¸¢à¸´à¸šà¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡à¸—à¸µà¹ˆ "à¹€à¸‚à¹‰à¸²à¸�à¸±à¸šà¸¡à¸¸à¸¡à¸¡à¸­à¸‡à¸‚à¸­à¸‡à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸™à¸µà¹‰" à¸¡à¸²à¹€à¸ªà¸£à¸´à¸¡à¹€à¸™à¸·à¹‰à¸­à¸«à¸²\n`;
        factPoolCtx += `- à¸•à¸±à¸§à¹€à¸¥à¸‚ à¸ªà¸–à¸´à¸•à¸´ à¸¢à¸­à¸”à¸§à¸´à¸§ à¸£à¸²à¸¢à¹„à¸”à¹‰ à¸£à¸²à¸‡à¸§à¸±à¸¥ â†’ à¹ƒà¸Šà¹‰à¹€à¸›à¹‡à¸™à¸«à¸¥à¸±à¸�à¸�à¸²à¸™à¹€à¸ªà¸£à¸´à¸¡à¸„à¸§à¸²à¸¡à¸™à¹ˆà¸²à¹€à¸Šà¸·à¹ˆà¸­à¸–à¸·à¸­\n`;
        factPoolCtx += `- à¸„à¸³à¸žà¸¹à¸”à¹€à¸”à¹‡à¸” à¸›à¸£à¸°à¸§à¸±à¸•à¸´ à¹€à¸£à¸·à¹ˆà¸­à¸‡à¹€à¸šà¸·à¹‰à¸­à¸‡à¸«à¸¥à¸±à¸‡ â†’ à¹ƒà¸Šà¹‰à¹€à¸žà¸´à¹ˆà¸¡à¸¡à¸´à¸•à¸´à¸„à¸§à¸²à¸¡à¸¥à¸¶à¸�à¹ƒà¸«à¹‰à¹€à¸™à¸·à¹‰à¸­à¸«à¸²\n`;
        factPoolCtx += `- à¹„à¸¡à¹ˆà¸ˆà¸³à¹€à¸›à¹‡à¸™à¸•à¹‰à¸­à¸‡à¹ƒà¸Šà¹‰à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸” à¹€à¸¥à¸·à¸­à¸�à¹�à¸„à¹ˆà¸—à¸µà¹ˆà¹€à¸‚à¹‰à¸²à¸�à¸±à¸š angle à¸‚à¸­à¸‡à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸™à¸µà¹‰\n`;
        factPoolCtx += `- à¸«à¹‰à¸²à¸¡à¹�à¸—à¸£à¸� URL à¸«à¸£à¸·à¸­à¸„à¸³à¸§à¹ˆà¸² "à¸­à¹‰à¸²à¸‡à¸­à¸´à¸‡" à¸¥à¸‡à¹ƒà¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¹‚à¸”à¸¢à¹€à¸”à¹‡à¸”à¸‚à¸²à¸”\n`;
        factPoolCtx += `- à¸«à¹‰à¸²à¸¡à¹�à¸•à¹ˆà¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸­à¸‡ à¹ƒà¸Šà¹‰à¹€à¸‰à¸žà¸²à¸°à¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡à¸—à¸µà¹ˆà¹ƒà¸«à¹‰à¹„à¸§à¹‰à¸‚à¹‰à¸²à¸‡à¸šà¸™à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™\n`;
        factPoolCtx += `\n=== à¸ˆà¸š Smart Research ===\n`;
      }

      let smartPromptCtx = '';
      try {
        const detectedCategory = actualBreakdown.content_type || actualBreakdown.category || '';
        if (detectedCategory) {
          const mixPromptStore = createStore('prompt-library');
          let promptLib = [];
          try { promptLib = await mixPromptStore.getAll(); } catch (e) { console.warn('[Mix-Service] Prompt library load:', e.message); }

          if (promptLib.length > 0) {
            const matched = promptLib
              .filter(p => p.category && detectedCategory.includes(p.category))
              .sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));

            const bestPrompt = matched[0] || promptLib.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0))[0];

            if (bestPrompt && bestPrompt.promptText) {
              smartPromptCtx = '\n\n=== ðŸ�›ï¸� Prompt à¸ˆà¸²à¸�à¸«à¸­à¸ªà¸¡à¸¸à¸”à¹„à¸§à¸£à¸±à¸¥ (Smart Match) ===\n' +
                `à¸›à¸£à¸°à¹€à¸ à¸—: ${bestPrompt.category || '-'} | à¸­à¸²à¸£à¸¡à¸“à¹Œ: ${bestPrompt.emotionalType || bestPrompt.emotionalTags?.[0] || '-'} | Viral Score: ${bestPrompt.viralScore || '-'}\n` +
                `à¸ªà¹„à¸•à¸¥à¹Œ Hook: ${bestPrompt.hookStyle || '-'} | à¹‚à¸—à¸™: ${bestPrompt.tone || '-'}\n` +
                `à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡: ${bestPrompt.structure || '-'}\n\n` +
                '--- à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¹€à¸‚à¸µà¸¢à¸™à¸ˆà¸²à¸� DNA à¹„à¸§à¸£à¸±à¸¥ ---\n' +
                'âš ï¸� à¸„à¸³à¹€à¸•à¸·à¸­à¸™à¸ªà¸³à¸„à¸±à¸� (ANTI-HALLUCINATION): à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸ªà¹„à¸•à¸¥à¹Œà¸«à¸£à¸·à¸­ "à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡" à¸”à¹‰à¸²à¸™à¸¥à¹ˆà¸²à¸‡à¸™à¸µà¹‰ à¸­à¸²à¸ˆà¸¡à¸µà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸¡à¸¡à¸•à¸´ à¹€à¸Šà¹ˆà¸™ à¸Šà¸·à¹ˆà¸­à¸šà¸¸à¸„à¸„à¸¥ (à¹�à¸¡à¹ˆà¸„à¸£à¸¹, à¸¥à¸¸à¸‡), à¸ªà¸–à¸²à¸™à¸—à¸µà¹ˆ (à¹€à¸Šà¹ˆà¸™ à¸­à¸¸à¸šà¸¥à¸£à¸²à¸Šà¸˜à¸²à¸™à¸µ), à¸§à¸±à¸™à¸—à¸µà¹ˆ à¸«à¸£à¸·à¸­à¸•à¸±à¸§à¹€à¸¥à¸‚à¸•à¹ˆà¸²à¸‡à¹†\n' +
                '>> à¸„à¸¸à¸“ **à¸•à¹‰à¸­à¸‡à¸«à¹‰à¸²à¸¡à¸„à¸±à¸”à¸¥à¸­à¸�** à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸‰à¸žà¸²à¸°à¹€à¸«à¸¥à¹ˆà¸²à¸™à¸µà¹‰à¸¡à¸²à¹ƒà¸ªà¹ˆà¹ƒà¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¹€à¸”à¹‡à¸”à¸‚à¸²à¸”! à¹ƒà¸«à¹‰à¸¢à¸¶à¸” "à¸•à¸±à¸§à¸¥à¸°à¸„à¸£ à¸ªà¸–à¸²à¸™à¸—à¸µà¹ˆ à¸§à¸±à¸™à¸—à¸µà¹ˆ à¹�à¸¥à¸°à¸‚à¹‰à¸­à¹€à¸—à¹‡à¸ˆà¸ˆà¸£à¸´à¸‡" à¸ˆà¸²à¸� "à¸‚à¹ˆà¸²à¸§à¸•à¹‰à¸™à¸‰à¸šà¸±à¸š" à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™! <<\n' +
                '>> à¸„à¸¸à¸“ **à¸•à¹‰à¸­à¸‡à¸¢à¸¶à¸” "à¹€à¸—à¸„à¸™à¸´à¸„à¸�à¸²à¸£à¹€à¸‚à¸µà¸¢à¸™ à¹‚à¸—à¸™ à¹�à¸¥à¸°à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸­à¸²à¸£à¸¡à¸“à¹Œ" à¸ˆà¸²à¸�à¸«à¸­à¸ªà¸¡à¸¸à¸”à¸™à¸µà¹‰à¹€à¸›à¹‡à¸™à¹�à¸�à¸™à¸«à¸¥à¸±à¸�à¹ƒà¸™à¸�à¸²à¸£à¹€à¸‚à¸µà¸¢à¸™à¹‚à¸žà¸ªà¸•à¹Œ** à¸­à¸¢à¹ˆà¸²à¸‡à¹€à¸„à¸£à¹ˆà¸‡à¸„à¸£à¸±à¸” <<\n' +
                bestPrompt.promptText + '\n' +
                '--- à¸ˆà¸šà¸„à¸³à¸ªà¸±à¹ˆà¸‡ DNA ---\n' +
                '=== à¸ˆà¸š Smart Match ===\n';
            }
          }
        }
      } catch (err) {
        console.log('[Mix-Service] Smart Match skipped:', err.message);
      }

      const mixPrompt = fullCtx + researchCtx + factPoolCtx + smartPromptCtx + '\n\n' +
        '=== à¸„à¸³à¸ªà¸±à¹ˆà¸‡: AI à¸œà¸ªà¸¡à¸¡à¸¸à¸¡à¸‚à¹ˆà¸²à¸§ (MIX MODE) ===\n' +
        'à¸„à¸¸à¸“à¸„à¸·à¸­à¸œà¸¹à¹‰à¹€à¸Šà¸µà¹ˆà¸¢à¸§à¸Šà¸²à¸�à¸ªà¸£à¹‰à¸²à¸‡à¸„à¸­à¸™à¹€à¸—à¸™à¸•à¹Œà¹„à¸§à¸£à¸±à¸¥ à¸„à¸¸à¸“à¹„à¸”à¹‰à¸£à¸±à¸šà¸œà¸¥à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸‚à¹ˆà¸²à¸§à¸‚à¹‰à¸²à¸‡à¸•à¹‰à¸™à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”\n\n' +
        'ðŸ“Š à¸¡à¸¸à¸¡à¸‚à¹ˆà¸²à¸§à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”à¸—à¸µà¹ˆà¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¹„à¸”à¹‰:\n' + anglesInfo + '\n\n' +
        (keyPointsInfo ? 'ðŸ“Œ à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸ªà¸³à¸„à¸±à¸�:\n' + keyPointsInfo + '\n\n' : '') +
        (emotionalInfo ? 'ðŸ’– à¸�à¸²à¸£à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸­à¸²à¸£à¸¡à¸“à¹Œ:\n' + emotionalInfo + '\n\n' : '') +
        (bestAngleInfo ? 'ðŸ�† ' + bestAngleInfo + '\n' : '') +
        (hookInfo ? 'ðŸŽ£ ' + hookInfo + '\n' : '') +
        (bestSections ? 'â­� ' + bestSections + '\n' : '') +
        (langStrategy ? 'âœ�ï¸� ' + langStrategy + '\n' : '') +
        '\n=== à¸ªà¸´à¹ˆà¸‡à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸—à¸³ ===\n' +
        '1. à¹€à¸¥à¸·à¸­à¸�à¸¡à¸¸à¸¡à¸‚à¹ˆà¸²à¸§ 2-3 à¸¡à¸¸à¸¡à¸—à¸µà¹ˆà¸”à¸µà¸—à¸µà¹ˆà¸ªà¸¸à¸” (viral score à¸ªà¸¹à¸‡ + à¸­à¸²à¸£à¸¡à¸“à¹Œà¹�à¸£à¸‡)\n' +
        '2. à¸œà¸ªà¸¡à¸¡à¸¸à¸¡à¹€à¸«à¸¥à¹ˆà¸²à¸™à¸±à¹‰à¸™à¹€à¸‚à¹‰à¸²à¸”à¹‰à¸§à¸¢à¸�à¸±à¸™ à¸ªà¸£à¹‰à¸²à¸‡à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¹ƒà¸«à¸¡à¹ˆà¸—à¸µà¹ˆà¸­à¹ˆà¸²à¸™à¹€à¸žà¸¥à¸´à¸™ à¹„à¸¡à¹ˆà¸£à¸¹à¹‰à¸ªà¸¶à¸�à¸•à¸±à¸”à¹�à¸›à¸°\n' +
        '3. à¹ƒà¸Šà¹‰à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸²à¸�à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸ªà¸³à¸„à¸±à¸� + Emotional Core + Key Facts à¹€à¸›à¹‡à¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²\n' +
        '4. à¸ªà¸£à¹‰à¸²à¸‡ 3 à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™ à¹�à¸•à¹ˆà¸¥à¸°à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸œà¸ªà¸¡à¸¡à¸¸à¸¡à¸•à¹ˆà¸²à¸‡à¸�à¸±à¸™:\n' +
        '   - à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™ 1: à¸œà¸ªà¸¡à¸¡à¸¸à¸¡à¸—à¸µà¹ˆ viral score à¸ªà¸¹à¸‡à¸ªà¸¸à¸” 2-3 à¸¡à¸¸à¸¡ (à¹€à¸™à¹‰à¸™à¹„à¸§à¸£à¸±à¸¥)\n' +
        '   - à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™ 2: à¸œà¸ªà¸¡à¸¡à¸¸à¸¡ Emotional + à¹€à¸£à¸·à¹ˆà¸­à¸‡à¹€à¸¥à¹ˆà¸² (à¹€à¸™à¹‰à¸™à¸­à¸´à¸™ à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆ)\n' +
        '   - à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™ 3: à¸œà¸ªà¸¡à¸¡à¸¸à¸¡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥ + à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œ (à¹€à¸™à¹‰à¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸„à¸£à¸šà¸–à¹‰à¸§à¸™)\n\n' +
        `à¹�à¸•à¹ˆà¸¥à¸°à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™:\n` +
        `- à¸•à¹‰à¸­à¸‡à¸¢à¸²à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¸™à¹‰à¸­à¸¢ ${lenCfg.min} à¸„à¸³ à¸–à¸¶à¸‡ ${lenCfg.max} à¸„à¸³ / ${lenCfg.paraDesc}\n` +
        `- à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡ ${lenCfg.paragraphs} à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²: [à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²à¹�à¸£à¸�] à¹€à¸›à¸´à¸”à¹�à¸£à¸‡ hook â†’ [à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²à¸�à¸¥à¸²à¸‡] à¹€à¸¥à¹ˆà¸²à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸” â†’ [à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²à¸ªà¸¸à¸”à¸—à¹‰à¸²à¸¢] à¸›à¸´à¸”à¸”à¹‰à¸§à¸¢à¸›à¸£à¸°à¹‚à¸¢à¸„à¸šà¸£à¸£à¸¢à¸²à¸¢à¸—à¸£à¸‡à¸žà¸¥à¸±à¸‡\n` +
        '- âš ï¸� à¸«à¹‰à¸²à¸¡à¸•à¸±à¹‰à¸‡à¸„à¸³à¸–à¸²à¸¡à¸›à¸´à¸”à¸—à¹‰à¸²à¸¢ à¸«à¹‰à¸²à¸¡à¸ˆà¸šà¸”à¹‰à¸§à¸¢à¸„à¸³à¸–à¸²à¸¡à¹ƒà¸”à¹†\n' +
        '- à¹ƒà¸Šà¹‰à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸²à¸�à¸‚à¹ˆà¸²à¸§à¸ˆà¸£à¸´à¸‡à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™ à¸«à¹‰à¸²à¸¡à¹�à¸•à¹ˆà¸‡à¹€à¸£à¸·à¹ˆà¸­à¸‡à¹€à¸žà¸´à¹ˆà¸¡\n' +
        '- à¸£à¸°à¸šà¸¸à¸§à¹ˆà¸²à¸œà¸ªà¸¡à¸ˆà¸²à¸�à¸¡à¸¸à¸¡à¹„à¸«à¸™à¸šà¹‰à¸²à¸‡ (à¹ƒà¸™ mixed_from)\n' +
        '- â�Œ à¸«à¹‰à¸²à¸¡à¸žà¸´à¸¡à¸žà¹Œà¸Šà¸·à¹ˆà¸­à¸¡à¸¸à¸¡à¸¡à¸­à¸‡ (à¸«à¹‰à¸²à¸¡à¸žà¸´à¸¡à¸žà¹Œ Angle: à¸¥à¸‡à¹ƒà¸™à¹€à¸™à¸·à¹‰à¸­à¸«à¸²)\n' +
        '- â�Œ à¸«à¹‰à¸²à¸¡à¹ƒà¸Šà¹‰à¸„à¸³à¸‚à¸¶à¹‰à¸™à¸•à¹‰à¸™à¸‹à¹‰à¸³à¸‹à¸²à¸�: à¸¥à¸­à¸‡à¸™à¸¶à¸�à¸ à¸²à¸žà¸§à¹ˆà¸², à¸¥à¸­à¸‡à¸ˆà¸´à¸™à¸•à¸™à¸²à¸�à¸²à¸£à¸§à¹ˆà¸², à¸–à¹‰à¸²à¸„à¸¸à¸“à¸•à¹‰à¸­à¸‡\n\n' +
        '=== à¸�à¸Žà¹€à¸«à¸¥à¹‡à¸� FACEBOOK SAFETY ===\n' +
        'à¸«à¹‰à¸²à¸¡à¹ƒà¸Šà¹‰à¸„à¸³à¹€à¸ªà¸µà¹ˆà¸¢à¸‡: à¸†à¹ˆà¸²â†’à¸—à¸³à¹ƒà¸«à¹‰à¹€à¸ªà¸µà¸¢à¸Šà¸µà¸§à¸´à¸•, à¸¨à¸žâ†’à¸£à¹ˆà¸²à¸‡à¸œà¸¹à¹‰à¹€à¸ªà¸µà¸¢à¸Šà¸µà¸§à¸´à¸•, à¸ªà¸¢à¸­à¸‡â†’à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆ, à¹€à¸¥à¸·à¸­à¸”â†’à¸£à¹ˆà¸­à¸‡à¸£à¸­à¸¢à¹€à¸«à¸•à¸¸à¸�à¸²à¸£à¸“à¹Œ\n' +
        '=== à¸ˆà¸š SAFETY ===\n\n' +
        'à¸•à¸­à¸šà¹€à¸›à¹‡à¸™ JSON:\n' +
        '{\n' +
        '  "versions": [\n' +
        '    {"style": "à¸œà¸ªà¸¡: [à¸Šà¸·à¹ˆà¸­à¸¡à¸¸à¸¡à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰]", "title": "à¸žà¸²à¸”à¸«à¸±à¸§", "content": "à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸¢à¸²à¸§ 250+ à¸„à¸³ 3 à¸¢à¹ˆà¸­à¸«à¸™à¹‰à¸²", "hook": "à¸›à¸£à¸°à¹‚à¸¢à¸„à¹€à¸›à¸´à¸”", "closing": "à¸›à¸£à¸°à¹‚à¸¢à¸„à¸›à¸´à¸”à¸šà¸£à¸£à¸¢à¸²à¸¢", "tone": "à¹‚à¸—à¸™", "target": "à¸�à¸¥à¸¸à¹ˆà¸¡à¹€à¸›à¹‰à¸²à¸«à¸¡à¸²à¸¢", "mixed_from": ["à¸¡à¸¸à¸¡1", "à¸¡à¸¸à¸¡2"]}\n' +
        '  ],\n' +
        '  "news_reference": "à¸ªà¸£à¸¸à¸›à¸‚à¹ˆà¸²à¸§à¸•à¹‰à¸™à¸‰à¸šà¸±à¸š 2-3 à¸›à¸£à¸°à¹‚à¸¢à¸„"\n' +
        '}';

      console.log(`[Mix-Service] Prompt length: ${mixPrompt.length}ch`);

      let result, usedModel;
      try {
        const smartResult = await callSmartAI('write', { prompt: mixPrompt, temperature: 0.7, maxTokens: 8000 });
        result = smartResult.result;
        usedModel = smartResult.model;
      } catch (err) {
        console.warn(`[Mix-Service] SmartAI failed (${err.message}), falling back to GPT-4o`);
        result = await callAI({ prompt: mixPrompt, temperature: 0.7, maxTokens: 8000 });
        usedModel = 'gpt-4o';
      }

      if (result && typeof result === 'object') {
        let versions = result.versions || [];
        if (versions.length === 0 && result.content) {
          versions = [{ style: 'ðŸ§¬ AI à¸œà¸ªà¸¡à¸¡à¸¸à¸¡à¸‚à¹ˆà¸²à¸§', title: actualNewsTitle, content: result.content, hook: '', closing: '', tone: '', target: '', mixed_from: [] }];
        }

        const validation = validateOutput(result, { newsTitle: actualNewsTitle, newsBody: actualNewsBody });

        if (workflowId) {
          await saveAnalysis(workflowId, { versions, news_reference: result.news_reference }, 'mix_angles').catch(e => console.error('[Mix-Service] DB err:', e.message));
          const agent = new MasterAgent(workflowId);
          await agent.loadFromDB().catch(() => {});
          agent.onAnalysisComplete({ versions, news_reference: result.news_reference });
          agent.onValidationComplete({ safetyPassed: validation.valid, issues: validation.issues, factCheckPassed: true, riskyWordsFound: [], riskyWordsReplaced: [] });
          await agent.saveMemoryToDB().catch(() => {});
        }

        let moderation = { overallSafe: true, results: [] };
        try {
          moderation = await moderateVersions(versions);
        } catch (modErr) {
          console.warn('[Mix-Service] Moderation skipped:', modErr.message);
        }

        logPipeline({ workflowId, step: 'mix', status: 'success', model: usedModel, duration: Date.now() - _pipelineStart, detail: (versions?.length || 0) + ' mix versions' }).catch(() => {});
        return {
          success: true,
          data: {
            usedPreset: { id: 'mix_angles', name: 'ðŸ§¬ AI à¸œà¸ªà¸¡à¸¡à¸¸à¸¡à¸‚à¹ˆà¸²à¸§' },
            usedModel: usedModel || 'gpt-4o',
            versions,
            news_reference: result.news_reference || '',
            summary: versions[0]?.content || '',
            key_points: [],
            emotion: '',
            viral_potential: '',
            engagement_ending: '',
            validation,
            moderation,
            availableModels: getAvailableModels(),
            debug: { mode: 'mix', mixedAngles: actualBreakdown.possible_angles?.length || 0 },
          },
        };
      }
    } catch (err) {
      console.error('[Mix-Service] ERROR:', err.message);
      logPipeline({ workflowId, step: 'mix', status: 'failed', duration: Date.now() - _pipelineStart, error: err.message }).catch(() => {});
      throw err;
    }
  }

  // === SIMULATE COMMENTS MODE ===
  if (mode === 'simulate_comments') {
    console.log('[Comment-Simulator] === SIMULATE COMMENTS MODE ===');
    try {
      const actualBreakdown = breakdownData || {};
      const coreStory = actualBreakdown.core_story || text || '';
      const keyPoints = actualBreakdown.key_points?.map(kp => kp.point || kp).join('\n') || '';

      const prompt = `à¸„à¸¸à¸“à¸„à¸·à¸­ AI à¸œà¸¹à¹‰à¹€à¸Šà¸µà¹ˆà¸¢à¸§à¸Šà¸²à¸�à¸�à¸²à¸£à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸žà¸¤à¸•à¸´à¸�à¸£à¸£à¸¡à¸Šà¸²à¸§à¹€à¸™à¹‡à¸•à¹„à¸—à¸¢ (Netizen Behavior Analyst)
à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆà¸‚à¸­à¸‡à¸„à¸¸à¸“à¸„à¸·à¸­à¸�à¸²à¸£ "à¸ˆà¸³à¸¥à¸­à¸‡à¸„à¸­à¸¡à¹€à¸¡à¸™à¸•à¹Œ (Simulate Comments)" à¸—à¸µà¹ˆà¸„à¸²à¸”à¸§à¹ˆà¸²à¸ˆà¸°à¹€à¸�à¸´à¸”à¸‚à¸¶à¹‰à¸™à¸ˆà¸£à¸´à¸‡à¸«à¸²à¸�à¸‚à¹ˆà¸²à¸§à¸™à¸µà¹‰à¸–à¸¹à¸�à¹‚à¸žà¸ªà¸•à¹Œà¸¥à¸‡à¹‚à¸‹à¹€à¸Šà¸µà¸¢à¸¥à¸¡à¸µà¹€à¸”à¸µà¸¢

=== à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸‚à¹ˆà¸²à¸§ ===
à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸¢à¹ˆà¸­: ${coreStory}
à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸ªà¸³à¸„à¸±à¸�:
${keyPoints}

=== à¸„à¸³à¸ªà¸±à¹ˆà¸‡ ===
à¹ƒà¸«à¹‰à¸ªà¸£à¹‰à¸²à¸‡à¸„à¸­à¸¡à¹€à¸¡à¸™à¸•à¹Œà¸ˆà¸³à¸¥à¸­à¸‡ 4 à¹�à¸šà¸š (à¹�à¸šà¸šà¸¥à¸° 1 à¸„à¸­à¸¡à¹€à¸¡à¸™à¸•à¹Œ à¸„à¸§à¸²à¸¡à¸¢à¸²à¸§à¹„à¸¡à¹ˆà¹€à¸�à¸´à¸™ 1-3 à¸›à¸£à¸°à¹‚à¸¢à¸„):
1. 'à¹€à¸«à¹‡à¸™à¸”à¹‰à¸§à¸¢/à¸ªà¸™à¸±à¸šà¸ªà¸™à¸¸à¸™' (à¹‚à¸—à¸™à¸šà¸§à¸�, à¹€à¸‚à¹‰à¸²à¸­à¸�à¹€à¸‚à¹‰à¸²à¹ƒà¸ˆ)
2. 'à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡/à¸”à¸£à¸²à¸¡à¹ˆà¸²' (à¹‚à¸—à¸™à¸¥à¸š, à¸•à¸±à¹‰à¸‡à¸„à¸³à¸–à¸²à¸¡, à¸ˆà¸´à¸�à¸�à¸±à¸”)
3. 'à¸•à¸¥à¸�/à¹�à¸‹à¸§' (à¹‚à¸—à¸™à¸‚à¸³à¸‚à¸±à¸™, à¸«à¸´à¸§à¹�à¸ªà¸‡, à¸›à¸£à¸°à¸Šà¸”à¸›à¸£à¸°à¸Šà¸±à¸™à¹�à¸šà¸šà¸•à¸¥à¸�)
4. 'à¹€à¸›à¹‡à¸™à¸�à¸¥à¸²à¸‡/à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œ' (à¸¡à¸­à¸‡à¸•à¹ˆà¸²à¸‡à¸¡à¸¸à¸¡, à¹ƒà¸«à¹‰à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸žà¸´à¹ˆà¸¡, à¸¡à¸µà¸ªà¸•à¸´)

à¸«à¹‰à¸²à¸¡à¹ƒà¸Šà¹‰à¸ à¸²à¸©à¸²à¸—à¸²à¸‡à¸�à¸²à¸£à¹€à¸�à¸´à¸™à¹„à¸› à¹ƒà¸«à¹‰à¹ƒà¸Šà¹‰à¸ à¸²à¸©à¸²à¸žà¸¹à¸”à¹�à¸šà¸šà¸Šà¸²à¸§à¹€à¸™à¹‡à¸•à¹„à¸—à¸¢à¸žà¸´à¸¡à¸žà¹Œà¸�à¸±à¸™à¸ˆà¸£à¸´à¸‡à¹† (à¹€à¸Šà¹ˆà¸™ à¸žà¸´à¸¡à¸žà¹Œà¸œà¸´à¸”à¸™à¸´à¸”à¸«à¸™à¹ˆà¸­à¸¢à¹„à¸”à¹‰, à¹ƒà¸Šà¹‰à¹�à¸ªà¸¥à¸‡à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™)

à¸ªà¹ˆà¸‡à¸„à¸·à¸™à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œà¹€à¸›à¹‡à¸™ JSON à¸¥à¹‰à¸§à¸™à¹† à¸«à¹‰à¸²à¸¡à¸¡à¸µ Markdown à¸•à¸²à¸¡à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸™à¸µà¹‰:
{
  "comments": [
    { "type": "agreement", "text": "...", "tone": "positive" },
    { "type": "drama", "text": "...", "tone": "negative" },
    { "type": "funny", "text": "...", "tone": "humorous" },
    { "type": "neutral", "text": "...", "tone": "neutral" }
  ]
}`;

      const res = await callAI({
        model: 'gpt-4o-mini',
        temperature: 0.8, // Slightly higher for creativity
        maxTokens: 500,
        prompt: prompt,
        responseFormat: { type: 'json_object' }
      });

      const parsed = res || {};
      return { success: true, data: parsed.comments || [] };

    } catch (err) {
      console.error('[Comment-Simulator] Failed:', err.message);
      return { success: false, data: [] };
    }
  }

  // === GENERATE MODE (Single style, legacy fallback) =====
  const extractionPrompt = getPrompt('extraction');
  let newsData;
  try {
    const prompt = extractionPrompt.prompt
      .replace('{content}', text.slice(0, 8000))
      .replace('{custom_instruction}', customPrompt ? `à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡: "${customPrompt}"` : '');
    const result = await callAI({ prompt, temperature: 0.2 });
    if (result?.news_body && result.news_body.length >= 20) newsData = result;
  } catch (err) { console.error('[Legacy-S1] ERROR:', err.message); }

  if (!newsData) {
    newsData = { news_title: text.slice(0, 80).replace(/\n/g, ' ').trim(), news_body: text.slice(0, 5000), news_source: '', news_date: '', news_category: 'à¸—à¸±à¹ˆà¸§à¹„à¸›' };
  }

  const preset = getAnalysisPreset(analysisPresetId || 'viral_fb');
  let analysis;
  try {
    const prompt = preset.prompt
      .replace('{title}', newsData.news_title || '')
      .replace('{content}', newsData.news_body.slice(0, 6000))
      .replace('{custom_instruction}', customPrompt ? `à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡: "${customPrompt}"` : '');
    const result = await callAI({ prompt, temperature: 0.6, maxTokens: 8000 });
    if (result && typeof result === 'object') {
      const summary = extractSummary(result);
      analysis = {
        summary: summary || '', key_points: extractArray(result, 'key_points', 'viral_headlines'),
        people_involved: extractArray(result, 'people_involved'), emotion: extractString(result, 'emotion', 'tone', 'emotional_direction'),
        content_type: extractString(result, 'content_type', 'selected_main_angle'), viral_potential: extractString(result, 'viral_potential', 'facebook_safety_level'),
        suggested_angles: extractArray(result, 'suggested_angles', 'viral_headlines'), target_audience: extractString(result, 'target_audience'),
        engagement_ending: result.engagement_ending || '', selected_main_angle: result.selected_main_angle || '',
        facebook_safe_check: result.facebook_safe_check || null, emotion_analysis: result.emotion_analysis || null,
      };
    }
  } catch (err) {
    analysis = { summary: `âš ï¸� ${err.message}`, key_points: [], people_involved: [], emotion: '', content_type: '', viral_potential: '', suggested_angles: [], target_audience: '' };
  }

  return {
    success: true,
    data: { newsTitle: newsData.news_title, newsBody: newsData.news_body, newsSource: newsData.news_source, newsDate: newsData.news_date, newsCategory: newsData.news_category, usedPreset: { id: preset.id, name: preset.name }, ...analysis },
  };
}

export async function getTopPrompts({ newsTitle, text, focusAngle, workflowId, excludePromptIds = [] }) {
  console.log(`[Analyze-Service] ðŸ§  getTopPrompts: Analyzing multi-angle news dimensions for: "${newsTitle}"${focusAngle ? ` | Angle: ${focusAngle}` : ''}${excludePromptIds.length > 0 ? ` | Excluding: ${excludePromptIds.length} prompts` : ''}`);
  let actualNewsBody = text;
  let actualNewsTitle = newsTitle;

  if (workflowId) {
    const wfContext = await getWorkflow(workflowId).catch(() => null);
    if (wfContext) {
      actualNewsBody = wfContext.newsBody || text;
      actualNewsTitle = wfContext.newsTitle || newsTitle;
    }
  }

  let newsAnalysis = null;
  let newsTypeDetected = '';

  try {
    const analyzerPrompt = `à¸„à¸¸à¸“à¹€à¸›à¹‡à¸™à¸™à¸±à¸�à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸‚à¹ˆà¸²à¸§à¹�à¸¥à¸°à¸œà¸¹à¹‰à¹€à¸Šà¸µà¹ˆà¸¢à¸§à¸Šà¸²à¸�à¸�à¸²à¸£à¸—à¸³à¹„à¸§à¸£à¸±à¸¥à¸„à¸­à¸™à¹€à¸—à¸™à¸•à¹Œ
à¸ˆà¸‡à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸‚à¹ˆà¸²à¸§à¸•à¹ˆà¸­à¹„à¸›à¸™à¸µà¹‰à¹ƒà¸™à¸«à¸¥à¸²à¸�à¸«à¸¥à¸²à¸¢à¸¡à¸´à¸•à¸´ (Multi-Dimensional News Analysis) à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸Šà¹‰à¸ªà¸³à¸«à¸£à¸±à¸šà¸�à¸²à¸£à¸ˆà¸±à¸šà¸„à¸¹à¹ˆà¸�à¸±à¸šà¸ªà¹„à¸•à¸¥à¹Œà¸�à¸²à¸£à¹€à¸¥à¹ˆà¸²à¹€à¸£à¸·à¹ˆà¸­à¸‡à¸—à¸µà¹ˆà¸”à¸µà¸—à¸µà¹ˆà¸ªà¸¸à¸”

=== à¸‚à¹ˆà¸²à¸§à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œ ===
à¸«à¸±à¸§à¸‚à¹‰à¸­: ${actualNewsTitle || 'à¹„à¸¡à¹ˆà¸¡à¸µà¸«à¸±à¸§à¸‚à¹‰à¸­'}
à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¸¢à¹ˆà¸­: ${(actualNewsBody || '').slice(0, 1500)}
=== à¸ˆà¸šà¸‚à¹ˆà¸²à¸§ ===
${focusAngle ? '\n=== à¸¡à¸¸à¸¡à¸¡à¸­à¸‡à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸�à¸²à¸£à¹€à¸™à¹‰à¸™ (Focus Angle) ===\n' + focusAngle + '\n' : ''}
à¹‚à¸›à¸£à¸”à¹�à¸•à¸�à¸¡à¸´à¸•à¸´à¸‚à¸­à¸‡à¸‚à¹ˆà¸²à¸§à¸•à¸²à¸¡à¸«à¸¡à¸§à¸”à¸«à¸¡à¸¹à¹ˆà¸”à¸±à¸‡à¸•à¹ˆà¸­à¹„à¸›à¸™à¸µà¹‰ (à¸•à¹‰à¸­à¸‡à¹€à¸¥à¸·à¸­à¸�à¸ˆà¸²à¸�à¸•à¸±à¸§à¹€à¸¥à¸·à¸­à¸�à¸—à¸µà¹ˆà¸�à¸³à¸«à¸™à¸”à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™):

1. primaryCategory: à¹€à¸¥à¸·à¸­à¸� 1 à¸ˆà¸²à¸�: à¸Šà¹ˆà¸§à¸¢à¹€à¸«à¸¥à¸·à¸­à¸�à¸±à¸™, à¸ªà¸¹à¹‰à¸Šà¸µà¸§à¸´à¸•, à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸„à¸£à¸­à¸šà¸„à¸£à¸±à¸§, à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡, à¸‚à¹ˆà¸²à¸§à¹€à¸•à¸·à¸­à¸™à¹ƒà¸ˆ, à¸‚à¹ˆà¸²à¸§à¸­à¸²à¸Šà¸�à¸²à¸�à¸£à¸£à¸¡, à¸„à¸§à¸²à¸¡à¸£à¸±à¸�, à¸­à¸šà¸­à¸¸à¹ˆà¸™à¹ƒà¸ˆ, à¸®à¸µà¹‚à¸£à¹ˆà¸Šà¸²à¸§à¸šà¹‰à¸²à¸™, à¸Šà¸µà¸§à¸´à¸•à¸žà¸¥à¸´à¸�à¸œà¸±à¸™
2. secondaryCategories: à¹€à¸¥à¸·à¸­à¸� 1-3 à¸ˆà¸²à¸�à¸£à¸²à¸¢à¸�à¸²à¸£à¹€à¸”à¸µà¸¢à¸§à¸�à¸±à¸š primaryCategory (à¸«à¹‰à¸²à¸¡à¸‹à¹‰à¸³à¸�à¸±à¸š primaryCategory)
3. emotionalTags: à¹€à¸¥à¸·à¸­à¸� 2-4 à¸ˆà¸²à¸�: à¹€à¸«à¹‡à¸™à¹ƒà¸ˆ, à¸ªà¸‡à¸ªà¸²à¸£, à¹‚à¸�à¸£à¸˜, à¹€à¸”à¸·à¸­à¸”, à¸‹à¸¶à¹‰à¸‡, à¸•à¸·à¹‰à¸™à¸•à¸±à¸™, à¸�à¸¥à¸±à¸§, à¸Šà¹‡à¸­à¸�, à¸ à¸¹à¸¡à¸´à¹ƒà¸ˆ, à¸Šà¸·à¹ˆà¸™à¸Šà¸¡, à¸„à¸²à¹ƒà¸ˆ, à¸ªà¸‡à¸ªà¸±à¸¢, à¹€à¸¨à¸£à¹‰à¸², à¸«à¸”à¸«à¸¹à¹ˆ, à¸ªà¸™à¸¸à¸�, à¸‚à¸³, à¹�à¸„à¹‰à¸™, à¸­à¸šà¸­à¸¸à¹ˆà¸™, à¸ªà¸°à¹€à¸—à¸·à¸­à¸™à¹ƒà¸ˆ, à¸«à¸§à¸²à¸”à¸�à¸¥à¸±à¸§
4. conflictTags: à¹€à¸¥à¸·à¸­à¸� 1-3 à¸ˆà¸²à¸�: à¸„à¸§à¸²à¸¡à¸­à¸¢à¸¸à¸•à¸´à¸˜à¸£à¸£à¸¡, à¸�à¸²à¸£à¸•à¸±à¸”à¸ªà¸´à¸™, à¸�à¸²à¸£à¸ªà¸¹à¸�à¹€à¸ªà¸µà¸¢, à¸�à¸²à¸£à¸•à¹ˆà¸­à¸ªà¸¹à¹‰, à¸�à¸²à¸£à¹€à¸­à¸²à¹€à¸›à¸£à¸µà¸¢à¸š, à¸„à¸§à¸²à¸¡à¸œà¸´à¸”à¸žà¸¥à¸²à¸”, à¸�à¸²à¸£à¸—à¸£à¸¢à¸¨, à¸„à¸§à¸²à¸¡à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡, à¸�à¸²à¸£à¸�à¸”à¸‚à¸µà¹ˆ, à¸„à¸§à¸²à¸¡à¹€à¸«à¸¥à¸·à¹ˆà¸­à¸¡à¸¥à¹‰à¸³
5. narrativeArchetype: à¹€à¸¥à¸·à¸­à¸� 1 à¸ˆà¸²à¸�: à¸ªà¸¹à¹‰à¸Šà¸µà¸§à¸´à¸•, à¸®à¸µà¹‚à¸£à¹ˆà¸Šà¸²à¸§à¸šà¹‰à¸²à¸™, à¹€à¸›à¸´à¸”à¹‚à¸›à¸‡, à¸™à¹‰à¸³à¹ƒà¸ˆà¸„à¸™à¹„à¸—à¸¢, à¸Šà¸µà¸§à¸´à¸•à¸žà¸¥à¸´à¸�à¸œà¸±à¸™, à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸„à¸£à¸­à¸šà¸„à¸£à¸±à¸§, à¸‚à¹ˆà¸²à¸§à¹€à¸•à¸·à¸­à¸™à¸ à¸±à¸¢, à¸„à¸§à¸²à¸¡à¸£à¸±à¸�à¸‚à¹‰à¸²à¸¡à¸‚à¸µà¸”à¸ˆà¸³à¸�à¸±à¸”, à¸œà¸¹à¹‰à¸–à¸¹à¸�à¸�à¸£à¸°à¸—à¸³, à¸„à¸™à¸”à¸µà¸—à¸µà¹ˆà¹‚à¸¥à¸�à¸¥à¸·à¸¡
6. viralHooks: à¸ˆà¸¸à¸”à¸�à¸£à¸°à¸•à¸¸à¹‰à¸™à¹ƒà¸«à¹‰à¸„à¸™à¹�à¸Šà¸£à¹Œà¸«à¸£à¸·à¸­à¸žà¸¹à¸”à¸–à¸¶à¸‡à¹ƒà¸™à¹‚à¸¥à¸�à¹‚à¸‹à¹€à¸Šà¸µà¸¢à¸¥ (à¸£à¸°à¸šà¸¸à¹€à¸›à¹‡à¸™à¸­à¸²à¸£à¹Œà¹€à¸£à¸¢à¹Œ 1-3 à¸‚à¹‰à¸­)
7. humanAngles: à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¹€à¸Šà¸´à¸‡à¸¥à¸¶à¸�à¸‚à¸­à¸‡à¸Šà¸µà¸§à¸´à¸•à¸¡à¸™à¸¸à¸©à¸¢à¹Œà¹ƒà¸™à¸‚à¹ˆà¸²à¸§ (à¸£à¸°à¸šà¸¸à¹€à¸›à¹‡à¸™à¸­à¸²à¸£à¹Œà¹€à¸£à¸¢à¹Œ 1-3 à¸‚à¹‰à¸­)

à¸•à¸­à¸šà¹€à¸›à¹‡à¸™ JSON à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™à¹ƒà¸™à¸£à¸¹à¸›à¹�à¸šà¸šà¸™à¸µà¹‰:
{
  "primaryCategory": "...",
  "secondaryCategories": ["..."],
  "emotionalTags": ["...", "..."],
  "conflictTags": ["..."],
  "narrativeArchetype": "...",
  "viralHooks": ["..."],
  "humanAngles": ["..."]
}`;

    // FIX M6: Route through aiRouter for fallback
    const { result: _newsAn } = await callSmartAI('general', {
      temperature: 0.1,
      maxTokens: 800,
      prompt: analyzerPrompt
    });
    newsAnalysis = _newsAn;
    
    newsTypeDetected = newsAnalysis?.primaryCategory || '';
    console.log(`[Analyze-Service] ðŸ§  STAGE 1 (getTopPrompts): News analysis complete. Primary: ${newsTypeDetected}`);
  } catch (analyzErr) {
    console.warn('[Analyze-Service] STAGE 1 Analysis failed, using fallback:', analyzErr.message);
    newsAnalysis = {
      primaryCategory: 'à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡',
      secondaryCategories: ['à¸ªà¸¹à¹‰à¸Šà¸µà¸§à¸´à¸•'],
      emotionalTags: ['à¹€à¸«à¹‡à¸™à¹ƒà¸ˆ', 'à¸„à¸²à¹ƒà¸ˆ'],
      conflictTags: ['à¸„à¸§à¸²à¸¡à¸‚à¸±à¸”à¹�à¸¢à¹‰à¸‡'],
      narrativeArchetype: 'à¸ªà¸¹à¹‰à¸Šà¸µà¸§à¸´à¸•',
      viralHooks: ['à¸”à¸£à¸²à¸¡à¹ˆà¸²'],
      humanAngles: ['à¸œà¸¥à¸�à¸£à¸°à¸—à¸š'],
    };
    newsTypeDetected = 'à¸”à¸£à¸²à¸¡à¹ˆà¸²à¸ªà¸±à¸‡à¸„à¸¡';
  }

  let validPrompts = [];
  try {
    const promptStore = createStore('prompt-library');
    let promptLib = [];
    try { promptLib = await promptStore.getAll(); } catch (e) { }

    if (promptLib.length === 0) {
      const { readFile: _rf } = await import('fs/promises');
      const { join: _join } = await import('path');
      const _localPath = _join(process.cwd(), 'data', 'prompt-library.json');
      const _localData = JSON.parse(await _rf(_localPath, 'utf-8'));
      if (Array.isArray(_localData) && _localData.length > 0) {
        promptLib = _localData;
      }
    }
    validPrompts = promptLib.filter(p => p.promptText && !excludePromptIds.includes(p.id));
  } catch (err) {
    console.warn('[Analyze-Service] Failed to load prompt library in getTopPrompts:', err.message);
  }

  if (validPrompts.length === 0) {
    return { prompts: [], newsAnalysis };
  }

  const nPrimary = newsAnalysis?.primaryCategory || '';
  const nSecondary = (newsAnalysis?.secondaryCategories || []).map(s => String(s));
  const nEmos = (newsAnalysis?.emotionalTags || newsAnalysis?.emotionalThemes || []).map(e => String(e));
  const nConflicts = (newsAnalysis?.conflictTags || newsAnalysis?.conflictTypes || []).map(c => String(c));
  const nArchetype = newsAnalysis?.narrativeArchetype || '';
  const nHooks = (newsAnalysis?.viralHooks || []).map(h => String(h).toLowerCase());

  const scoredPrompts = validPrompts.map((p, index) => {
    let score = 0;
    let dims = [];

    const pCat = mapCategory(p.category || '');
    const mappedPrimary = mapCategory(nPrimary);
    if (pCat && mappedPrimary && pCat === mappedPrimary) {
      score += 30; dims.push('category');
    } else if (pCat && mappedPrimary) {
      const catCluster = clusterMatch(pCat, mappedPrimary, CONFLICT_CLUSTERS);
      if (catCluster === 'cluster') {
        score += 20; dims.push('category(cluster)');
      } else if (nSecondary.some(s => mapCategory(s) === pCat)) {
        score += 10; dims.push('category(secondary)');
      } else {
        score -= 50; dims.push('category(mismatch)');
      }
    }

    let emoScore = 0;
    const pEmoTags = (p.emotionalTags && Array.isArray(p.emotionalTags) && p.emotionalTags.length > 0)
      ? p.emotionalTags
      : ((p.emotionalType || '') + ' ' + (p.tone || '')).split(/[\s,|/]+/).filter(w => w.length > 1);
    for (const nEmo of nEmos) {
      for (const pTag of pEmoTags) {
        const result = clusterMatch(pTag, nEmo, EMOTION_CLUSTERS);
        if (result) { emoScore += 12; break; }
      }
    }
    if (emoScore > 25) emoScore = 25;
    if (emoScore > 0) { score += emoScore; dims.push('emotional'); }

    let conflictScore = 0;
    const pConflictTags = (p.conflictTags && Array.isArray(p.conflictTags) && p.conflictTags.length > 0)
      ? p.conflictTags
      : ((p.promptName || '') + ' ' + (p.structure || '')).split(/[\s,|/]+/).filter(w => w.length > 2);
    for (const nConf of nConflicts) {
      for (const pTag of pConflictTags) {
        const result = clusterMatch(pTag, nConf, CONFLICT_CLUSTERS);
        if (result) { conflictScore += 8; break; }
      }
    }
    if (conflictScore > 15) conflictScore = 15;
    if (conflictScore > 0) { score += conflictScore; dims.push('conflict'); }

    const pArchetype = (p.narrativeArchetype || p.structure || '').toLowerCase();
    let archScore = 0;
    if (pArchetype && nArchetype) {
      const nArchLower = nArchetype.toLowerCase();
      if (pArchetype === nArchLower || pArchetype.includes(nArchLower) || nArchLower.includes(pArchetype)) {
        archScore = 15;
        dims.push('archetype');
      } else {
        const archWords = nArchLower.split(/[\s,|/]+/).filter(w => w.length > 2);
        let archMatches = 0;
        archWords.forEach(w => { if (pArchetype.includes(w)) archMatches++; });
        archScore = Math.min(15, archMatches * 5);
        if (archScore > 0) dims.push('archetype(partial)');
      }
    }
    score += archScore;

    const pHook = (p.hookStyle || '').toLowerCase();
    let hookScore = 0;
    if (pHook) {
      for (const h of nHooks) {
        if (h && (pHook.includes(h) || h.includes(pHook))) { hookScore += 5; break; }
        const hw = h.split(/[\s,|/]+/).filter(w => w.length > 2);
        if (hw.some(w => pHook.includes(w))) { hookScore += 3; break; }
      }
    }
    if (hookScore > 5) hookScore = 5;
    if (hookScore > 0) { score += hookScore; dims.push('hook'); }

    let viral = Number(p.viralScore);
    if (isNaN(viral)) viral = 70;
    const successRate = Number(p.successRate);
    let histScore = viral * 0.05;
    if (!isNaN(successRate) && successRate > 0) histScore += successRate * 5;
    if (histScore > 10) histScore = 10;
    score += histScore;

    const uniqueDims = [...new Set(dims.map(d => d.replace(/\(.*\)/, '')))];
    if (score > 0) {
      const catScore = dims.some(d => d.startsWith('category')) ? (dims.includes('category') ? 30 : 20) : 0;
      if (catScore >= 20 && emoScore >= 12) {
        score += 10;
        dims.push('boost(cat+emo)');
      }
      if (uniqueDims.length >= 3) {
        score += 5;
        dims.push('boost(multi-dim)');
      }
    }

    return { index, score, dims: [...new Set(dims)] };
  });

  scoredPrompts.sort((a, b) => b.score - a.score);

  const topPrompts = scoredPrompts.slice(0, 3).map(s => {
    const pr = validPrompts[s.index];
    return {
      ...pr,
      _matchScore: s.score,
      _matchedDimensions: s.dims
    };
  });

  console.log(`[Analyze-Service] ðŸ§  getTopPrompts: Selected Top ${topPrompts.length} Prompts`);
  
  return { prompts: topPrompts, newsAnalysis };
}

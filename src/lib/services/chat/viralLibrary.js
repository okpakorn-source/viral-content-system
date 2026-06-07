/**
 * Viral Library Service — คลังตัวอย่างข่าวไวรัล
 * 
 * เก็บตัวอย่างข่าวที่เคยทำยอดสูงใน Supabase
 * ใช้สำหรับ AI reviewer อ้างอิงตอนวิเคราะห์/แนะนำ
 */
import { getSupabase } from '@/lib/supabase';
import { callAI } from '@/lib/ai/openai';
import { MODEL_PRIMARY } from '@/lib/ai/modelConfig';

// =============================================
// Categories — หมวดหมู่ข่าว
// =============================================

export const VIRAL_CATEGORIES = [
  'death',        // ข่าวคนเสียชีวิต
  'crime',        // อาชญากรรม
  'accident',     // อุบัติเหตุ
  'celebrity',    // ดารา/คนดัง
  'feel_good',    // ข่าวดีๆ อบอุ่น
  'scandal',      // เรื่องฉาว
  'politics',     // การเมือง
  'health',       // สุขภาพ
  'education',    // การศึกษา
  'sports',       // กีฬา
  'technology',   // เทคโนโลยี
  'other',        // อื่นๆ
];

// =============================================
// addExample — เพิ่มตัวอย่างข่าวไวรัล
// =============================================

/**
 * เพิ่มตัวอย่างข่าวไวรัลเข้าคลัง
 * @param {{ category: string, title: string, content: string, sourceUrl?: string, likes?: number, shares?: number, comments?: number, tags?: string[], writingNotes?: string, uploadedBy?: string }} example
 * @returns {Promise<{ success: boolean, data?: object, error?: string, errorType?: string }>}
 */
export async function addExample({ category, title, content, sourceUrl, likes, shares, comments, tags, writingNotes, uploadedBy }) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase ไม่พร้อมใช้งาน', errorType: 'SUPABASE_NOT_READY' };
    }

    if (!title || !content) {
      return { success: false, error: 'title และ content จำเป็นต้องกรอก', errorType: 'VALIDATION_ERROR' };
    }

    const validCategory = VIRAL_CATEGORIES.includes(category) ? category : 'other';

    const { data, error } = await supabase
      .from('viral_examples')
      .insert({
        category: validCategory,
        title,
        content,
        source_url: sourceUrl || null,
        likes: likes || 0,
        shares: shares || 0,
        comments: comments || 0,
        tags: tags || [],
        writing_notes: writingNotes || null,
        uploaded_by: uploadedBy || 'system',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[viralLibrary] addExample error:', error.message);
      return { success: false, error: error.message, errorType: 'DB_INSERT_ERROR' };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[viralLibrary] addExample exception:', err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

// =============================================
// getExamples — ดึงตัวอย่างตามหมวดหมู่
// =============================================

/**
 * ดึงตัวอย่างข่าวไวรัลจากคลัง
 * @param {{ category?: string, limit?: number }} options
 * @returns {Promise<Array>}
 */
export async function getExamples({ category, limit = 10 } = {}) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      console.warn('[viralLibrary] Supabase not available');
      return [];
    }

    let query = supabase
      .from('viral_examples')
      .select('*')
      .order('shares', { ascending: false })
      .limit(limit);

    if (category && VIRAL_CATEGORIES.includes(category)) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[viralLibrary] getExamples error:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[viralLibrary] getExamples exception:', err.message);
    return [];
  }
}

// =============================================
// searchSimilar — หาข่าวไวรัลที่คล้าย
// =============================================

/**
 * หาตัวอย่างข่าวไวรัลที่เกี่ยวข้อง
 * ใช้ category + keyword matching
 * @param {string} newsText - เนื้อข่าวที่ต้องการหาตัวอย่างคล้าย
 * @param {string} category - หมวดหมู่ข่าว
 * @returns {Promise<Array>}
 */
export async function searchSimilar(newsText, category) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return [];
    }

    // Extract keywords from newsText (top frequent Thai words > 3 chars)
    const keywords = extractKeywords(newsText);

    // 1. ดึงตัวอย่างจากหมวดเดียวกัน (max 5)
    let categoryExamples = [];
    if (category && VIRAL_CATEGORIES.includes(category)) {
      const { data } = await supabase
        .from('viral_examples')
        .select('*')
        .eq('category', category)
        .order('shares', { ascending: false })
        .limit(5);
      categoryExamples = data || [];
    }

    // 2. ค้นด้วย keywords (ilike search on title + content)
    let keywordExamples = [];
    if (keywords.length > 0) {
      // Search with top 3 keywords
      const searchKeywords = keywords.slice(0, 3);
      for (const kw of searchKeywords) {
        const { data } = await supabase
          .from('viral_examples')
          .select('*')
          .or(`title.ilike.%${kw}%,content.ilike.%${kw}%`)
          .limit(3);
        if (data) {
          keywordExamples.push(...data);
        }
      }
    }

    // 3. Deduplicate + merge, prioritize category matches
    const seen = new Set();
    const results = [];

    for (const ex of [...categoryExamples, ...keywordExamples]) {
      if (!seen.has(ex.id)) {
        seen.add(ex.id);
        results.push(ex);
      }
    }

    // Return top 5
    return results.slice(0, 5);
  } catch (err) {
    console.error('[viralLibrary] searchSimilar exception:', err.message);
    return [];
  }
}

// =============================================
// getCategories — ดึงหมวดหมู่ที่มีตัวอย่าง
// =============================================

/**
 * ดึงหมวดหมู่ทั้งหมดที่มีตัวอย่างอยู่ใน DB
 * @returns {Promise<Array<string>>}
 */
export async function getCategories() {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return VIRAL_CATEGORIES; // Fallback ส่ง static list
    }

    const { data, error } = await supabase
      .from('viral_examples')
      .select('category')
      .order('category');

    if (error) {
      console.error('[viralLibrary] getCategories error:', error.message);
      return VIRAL_CATEGORIES;
    }

    // Extract distinct categories
    const categories = [...new Set((data || []).map(d => d.category).filter(Boolean))];
    return categories.length > 0 ? categories : VIRAL_CATEGORIES;
  } catch (err) {
    console.error('[viralLibrary] getCategories exception:', err.message);
    return VIRAL_CATEGORIES;
  }
}

// =============================================
// deleteExample — ลบตัวอย่าง
// =============================================

/**
 * ลบตัวอย่างข่าวไวรัลจากคลัง
 * @param {string} id
 * @returns {Promise<{ success: boolean, error?: string, errorType?: string }>}
 */
export async function deleteExample(id) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase ไม่พร้อมใช้งาน', errorType: 'SUPABASE_NOT_READY' };
    }

    if (!id) {
      return { success: false, error: 'ต้องระบุ example ID', errorType: 'VALIDATION_ERROR' };
    }

    const { error } = await supabase
      .from('viral_examples')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[viralLibrary] deleteExample error:', error.message);
      return { success: false, error: error.message, errorType: 'DB_DELETE_ERROR' };
    }

    return { success: true };
  } catch (err) {
    console.error('[viralLibrary] deleteExample exception:', err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

// =============================================
// analyzeExample — AI วิเคราะห์ pattern
// =============================================

/**
 * ใช้ AI วิเคราะห์ patterns/style จากเนื้อหาไวรัล
 * @param {string} content - เนื้อหาที่ต้องการวิเคราะห์
 * @returns {Promise<{ success: boolean, analysis?: object, error?: string, errorType?: string }>}
 */
export async function analyzeExample(content) {
  try {
    if (!content || content.trim().length < 50) {
      return { success: false, error: 'เนื้อหาสั้นเกินไป (ต้อง > 50 ตัวอักษร)', errorType: 'VALIDATION_ERROR' };
    }

    const prompt = `วิเคราะห์เนื้อหาข่าวไวรัลต่อไปนี้ แล้วสกัดเทคนิคการเขียนที่ทำให้มันได้ยอดสูง

=== เนื้อหา ===
${content}
=== จบเนื้อหา ===

วิเคราะห์และตอบเป็น JSON ตามนี้:
{
  "hookType": "ประเภท hook ที่ใช้เปิด (เช่น: คำถาม, ตัวเลข, อารมณ์, เซอร์ไพรส์)",
  "hookText": "ข้อความ hook ที่ใช้",
  "emotionalTone": "อารมณ์หลักของเนื้อหา (เช่น: สะเทือนใจ, ซาบซึ้ง, ตกใจ, ชื่นชม)",
  "writingTechniques": ["เทคนิคที่ 1", "เทคนิคที่ 2"],
  "structureNotes": "โครงสร้างการเล่าเรื่อง",
  "wordEconomy": "ประเมินความกระชับ (กระชับดี / มีคำเปลือง / ยืดเยื้อ)",
  "viralFactors": ["ปัจจัยที่ทำให้ viral ข้อ 1", "ข้อ 2"],
  "suggestedCategory": "หมวดที่เหมาะสม (death|crime|accident|celebrity|feel_good|scandal|politics|health|education|sports|technology|other)",
  "keyTakeaway": "บทเรียนสำคัญที่เอาไปใช้ได้"
}`;

    const result = await callAI({
      prompt,
      model: MODEL_PRIMARY,
      temperature: 0.3,
      maxTokens: 2000,
    });

    return { success: true, analysis: result };
  } catch (err) {
    console.error('[viralLibrary] analyzeExample exception:', err.message);
    return { success: false, error: err.message, errorType: 'AI_ANALYSIS_ERROR' };
  }
}

// =============================================
// Helper — extractKeywords
// =============================================

/**
 * สกัด keywords จากข้อความภาษาไทย (simple frequency-based)
 * @param {string} text
 * @returns {string[]}
 */
function extractKeywords(text) {
  if (!text) return [];

  // Common Thai stop words to exclude
  const stopWords = new Set([
    'ที่', 'การ', 'ของ', 'ใน', 'ให้', 'ได้', 'จะ', 'ไม่', 'มี', 'เป็น',
    'และ', 'กับ', 'คือ', 'หรือ', 'แต่', 'ว่า', 'จาก', 'โดย', 'ก็', 'ยัง',
    'แล้ว', 'เมื่อ', 'ถึง', 'ไป', 'มา', 'ขึ้น', 'ลง', 'ออก', 'เข้า', 'กัน',
    'อยู่', 'บน', 'ใต้', 'หน้า', 'หลัง', 'ด้วย', 'ตาม', 'เอา', 'ทำ', 'คน',
    'อย่าง', 'ซึ่ง', 'เรื่อง', 'ครั้ง', 'วัน', 'กว่า', 'เพื่อ', 'ทั้ง', 'แบบ',
    'ต้อง', 'นี้', 'นั้น', 'เขา', 'เธอ', 'พวก', 'สิ่ง', 'อะไร', 'ทุก', 'คง',
  ]);

  // Split by spaces and common Thai delimiters, filter words > 3 chars
  const words = text
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  // Count frequency
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  // Sort by frequency desc, return top keywords
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

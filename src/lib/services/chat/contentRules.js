/**
 * Content Rules Service — ตรวจคำต้องห้ามและกฎเนื้อหา
 * 
 * Built-in banned words + custom rules จาก Supabase
 * ใช้สำหรับ AI Content Review Chat
 */
import { getSupabase } from '@/lib/supabase';

// =============================================
// Built-in Banned Words — กฎเหล็กที่แก้ไม่ได้
// =============================================

const BUILT_IN_RULES = {
  CRITICAL: {
    severity: 'CRITICAL',
    action: 'block',
    description: 'คำหยาบคาย/คำด่าร้ายแรง — บล็อกทันที',
    words: [
      'เหี้ย', 'สัตว์', 'ควาย', 'อีดอก', 'อีสัตว์', 'อีเหี้ย',
      'ไอ้สัตว์', 'ไอ้เหี้ย', 'มึง', 'กู', 'เย็ด', 'หี', 'ควย',
      'สันดาน', 'ชาติหมา', 'ไอ้หน้าหี', 'อีหน้าหี', 'แม่ง',
      'เชี่ย', 'อีดอกทอง', 'อีตอแหล', 'กระหรี่', 'อีกระหรี่',
    ],
  },
  HIGH: {
    severity: 'HIGH',
    action: 'flag',
    description: 'คำอ่อนไหว — ต้อง flag ให้ reviewer ตรวจสอบ',
    words: [
      'ตาย', 'ฆ่า', 'ทำร้ายร่างกาย', 'ข่มขืน', 'ล่วงละเมิด',
      'แอลกอฮอล์', 'ยาเสพติด', 'เมายา', 'เมาแล้วขับ',
      'ฆาตกรรม', 'อาวุธ', 'ศพ', 'ยิง', 'แทง', 'ระเบิด',
      'ฆ่าตัวตาย', 'ผูกคอ', 'กระโดดตึก',
    ],
  },
  STYLE: {
    severity: 'STYLE',
    action: 'warn',
    description: 'คำเปลือง/สำนวนราชการ — แนะนำให้ตัดออก',
    words: [
      'ทั้งนี้', 'อย่างไรก็ตาม', 'กล่าวคือ', 'ซึ่งจะ', 'สำหรับ',
      'ในส่วนของ', 'ดังกล่าว', 'ถือเป็น', 'เรียกได้ว่า', 'นับว่า',
      'ได้มีการ', 'ภายหลังจาก', 'เพื่อเป็นการ', 'จากกรณีดังกล่าว',
      'สร้างความฮือฮา', 'กลายเป็นกระแส', 'เป็นอย่างมาก',
      'เป็นจำนวนมาก', 'ท่ามกลาง', 'สร้างความประทับใจ',
      'ได้ออกมาเปิดเผย', 'ถูกพูดถึง', 'สร้างเสียงฮือฮา',
      'ในขณะเดียวกัน', 'ซึ่งถือว่า', 'อันเนื่องมาจาก',
      'โดยเฉพาะอย่างยิ่ง', 'ณ ขณะนี้', 'สืบเนื่องจาก',
      'กล่าวได้ว่า', 'จึงส่งผลให้', 'เป็นอย่างยิ่ง',
      'อย่างแท้จริง', 'อย่างไม่น่าเชื่อ', 'สร้างความตื่นตะลึง',
      'สะท้อนให้เห็น', 'เป็นเครื่องยืนยัน', 'ชี้ให้เห็นว่า',
    ],
  },
};

// =============================================
// checkBannedWords — ตรวจ built-in words เท่านั้น
// =============================================

/**
 * ตรวจคำต้องห้ามจาก built-in rules
 * @param {string} text - ข้อความที่ต้องการตรวจ
 * @returns {{ found: Array<{word: string, severity: string, action: string}>, clean: boolean }}
 */
export function checkBannedWords(text) {
  if (!text || typeof text !== 'string') {
    return { found: [], clean: true };
  }

  const normalizedText = text.toLowerCase().trim();
  const found = [];

  for (const [, rule] of Object.entries(BUILT_IN_RULES)) {
    for (const word of rule.words) {
      if (normalizedText.includes(word.toLowerCase())) {
        found.push({
          word,
          severity: rule.severity,
          action: rule.action,
          description: rule.description,
        });
      }
    }
  }

  // เรียงตาม severity: CRITICAL > HIGH > STYLE
  const severityOrder = { CRITICAL: 0, HIGH: 1, STYLE: 2 };
  found.sort((a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99));

  return {
    found,
    clean: found.length === 0,
  };
}

// =============================================
// Custom Rules — CRUD จาก Supabase review_rules
// =============================================

/**
 * ดึง custom rules ทั้งหมดจาก Supabase
 * @returns {Promise<Array>}
 */
export async function getCustomRules() {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      console.warn('[contentRules] Supabase not available, returning empty rules');
      return [];
    }

    const { data, error } = await supabase
      .from('review_rules')
      .select('*')
      .eq('is_active', true)
      .order('severity', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[contentRules] getCustomRules error:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[contentRules] getCustomRules exception:', err.message);
    return [];
  }
}

/**
 * เพิ่ม custom rule
 * @param {{ ruleType: string, content: string, keywords: string[], action: string, severity: string, createdBy: string }} rule
 * @returns {Promise<{ success: boolean, data?: object, error?: string, errorType?: string }>}
 */
export async function addRule({ ruleType, content, keywords, action, severity, createdBy }) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase ไม่พร้อมใช้งาน', errorType: 'SUPABASE_NOT_READY' };
    }

    // Validate required fields
    if (!ruleType || !content) {
      return { success: false, error: 'ruleType และ content จำเป็นต้องกรอก', errorType: 'VALIDATION_ERROR' };
    }

    const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'STYLE'];
    const validActions = ['block', 'flag', 'warn', 'info'];

    const { data, error } = await supabase
      .from('review_rules')
      .insert({
        rule_type: ruleType,
        content,
        keywords: keywords || [],
        action: validActions.includes(action) ? action : 'flag',
        severity: validSeverities.includes(severity) ? severity : 'MEDIUM',
        created_by: createdBy || 'system',
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[contentRules] addRule error:', error.message);
      return { success: false, error: error.message, errorType: 'DB_INSERT_ERROR' };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[contentRules] addRule exception:', err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

/**
 * อัปเดต custom rule
 * @param {string} id - rule ID
 * @param {object} updates - fields to update
 * @returns {Promise<{ success: boolean, data?: object, error?: string, errorType?: string }>}
 */
export async function updateRule(id, updates) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase ไม่พร้อมใช้งาน', errorType: 'SUPABASE_NOT_READY' };
    }

    if (!id) {
      return { success: false, error: 'ต้องระบุ rule ID', errorType: 'VALIDATION_ERROR' };
    }

    // Only allow safe fields to be updated
    const allowedFields = ['rule_type', 'content', 'keywords', 'action', 'severity', 'is_active'];
    const safeUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        safeUpdates[key] = value;
      }
    }

    safeUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('review_rules')
      .update(safeUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[contentRules] updateRule error:', error.message);
      return { success: false, error: error.message, errorType: 'DB_UPDATE_ERROR' };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[contentRules] updateRule exception:', err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

/**
 * ลบ custom rule (soft delete)
 * @param {string} id - rule ID
 * @returns {Promise<{ success: boolean, error?: string, errorType?: string }>}
 */
export async function deleteRule(id) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase ไม่พร้อมใช้งาน', errorType: 'SUPABASE_NOT_READY' };
    }

    if (!id) {
      return { success: false, error: 'ต้องระบุ rule ID', errorType: 'VALIDATION_ERROR' };
    }

    // Soft delete — set is_active to false
    const { error } = await supabase
      .from('review_rules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('[contentRules] deleteRule error:', error.message);
      return { success: false, error: error.message, errorType: 'DB_DELETE_ERROR' };
    }

    return { success: true };
  } catch (err) {
    console.error('[contentRules] deleteRule exception:', err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

// =============================================
// checkAllRules — รวม built-in + custom rules
// =============================================

/**
 * ตรวจข้อความด้วย built-in rules + custom rules ทั้งหมด
 * @param {string} text - ข้อความที่ต้องการตรวจ
 * @returns {Promise<{ violations: Array, clean: boolean, hasCritical: boolean, summary: string }>}
 */
export async function checkAllRules(text) {
  if (!text || typeof text !== 'string') {
    return { violations: [], clean: true, hasCritical: false, summary: 'ไม่มีข้อความให้ตรวจ' };
  }

  const normalizedText = text.toLowerCase().trim();
  const violations = [];

  // 1. ตรวจ built-in banned words
  const builtInResult = checkBannedWords(text);
  for (const item of builtInResult.found) {
    violations.push({
      source: 'built-in',
      type: 'banned_word',
      word: item.word,
      severity: item.severity,
      action: item.action,
      description: item.description,
    });
  }

  // 2. ตรวจ custom rules จาก Supabase
  try {
    const customRules = await getCustomRules();
    for (const rule of customRules) {
      let matched = false;

      // Check keywords array
      if (rule.keywords && Array.isArray(rule.keywords) && rule.keywords.length > 0) {
        for (const keyword of rule.keywords) {
          if (keyword && normalizedText.includes(keyword.toLowerCase())) {
            matched = true;
            violations.push({
              source: 'custom',
              ruleId: rule.id,
              type: rule.rule_type || 'custom',
              word: keyword,
              severity: rule.severity || 'MEDIUM',
              action: rule.action || 'flag',
              description: rule.content || '',
            });
          }
        }
      }

      // Check content-based rule (regex pattern)
      if (!matched && rule.rule_type === 'regex' && rule.content) {
        try {
          const regex = new RegExp(rule.content, 'gi');
          const matches = normalizedText.match(regex);
          if (matches) {
            for (const match of matches) {
              violations.push({
                source: 'custom',
                ruleId: rule.id,
                type: 'regex',
                word: match,
                severity: rule.severity || 'MEDIUM',
                action: rule.action || 'flag',
                description: `Pattern matched: ${rule.content}`,
              });
            }
          }
        } catch {
          // Invalid regex — skip silently
        }
      }
    }
  } catch (err) {
    console.error('[contentRules] custom rules check failed:', err.message);
    // Continue with built-in results only
  }

  // Sort by severity
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, STYLE: 4 };
  violations.sort((a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99));

  const hasCritical = violations.some(v => v.severity === 'CRITICAL');
  const hasHigh = violations.some(v => v.severity === 'HIGH');
  const styleCount = violations.filter(v => v.severity === 'STYLE').length;

  // Build summary
  let summary = '';
  if (hasCritical) {
    summary = `⛔ พบคำต้องห้ามร้ายแรง ${violations.filter(v => v.severity === 'CRITICAL').length} คำ — ต้องแก้ไขก่อนเผยแพร่`;
  } else if (hasHigh) {
    summary = `⚠️ พบคำอ่อนไหว ${violations.filter(v => v.severity === 'HIGH').length} คำ — ต้องตรวจสอบบริบท`;
  } else if (styleCount > 0) {
    summary = `💡 พบคำเปลือง ${styleCount} คำ — แนะนำให้ตัดเพื่อความกระชับ`;
  } else {
    summary = '✅ ไม่พบคำต้องห้ามหรือคำเปลือง';
  }

  return {
    violations,
    clean: violations.length === 0,
    hasCritical,
    summary,
  };
}

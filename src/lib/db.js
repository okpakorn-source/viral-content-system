import { v4 as uuidv4 } from 'uuid';
import { getSupabase, isSupabaseReady } from './supabase.js';

/**
 * ========================================
 * DATABASE LAYER — Supabase + Memory Fallback
 * ========================================
 * 
 * บน Vercel: ใช้ Supabase PostgreSQL → ข้อมูลถาวร ไม่หายตอน deploy
 * บน Local:  ใช้ memoryStore fallback → dev สะดวก
 * 
 * API เหมือน Prisma: create, findUnique, findMany, update, delete, count
 * ไฟล์ที่ import db.js ไม่ต้องแก้โค้ดเลย
 */

// ===== Memory Fallback (local dev) =====
const memoryStore = {
  workflow_runs: [],
  contents: [],
  angles: [],
  articles: [],
  sources: [],
};

function createMemoryModel(storeName) {
  return {
    async create({ data }) {
      const record = {
        ...data,
        id: data.id || uuidv4(),
        createdAt: data.createdAt || new Date(),
        updatedAt: new Date(),
      };
      if (!memoryStore[storeName]) memoryStore[storeName] = [];
      memoryStore[storeName].push(record);
      return record;
    },
    async findUnique({ where }) {
      if (!memoryStore[storeName]) return null;
      return memoryStore[storeName].find(r => r.id === where.id) || null;
    },
    async findMany({ where = {}, orderBy } = {}) {
      if (!memoryStore[storeName]) return [];
      let results = [...memoryStore[storeName]];
      for (const [key, value] of Object.entries(where)) {
        results = results.filter(r => r[key] === value);
      }
      if (orderBy?.createdAt === 'desc') {
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }
      return results;
    },
    async update({ where, data }) {
      if (!memoryStore[storeName]) return null;
      const index = memoryStore[storeName].findIndex(r => r.id === where.id);
      if (index === -1) return null;
      memoryStore[storeName][index] = { ...memoryStore[storeName][index], ...data, updatedAt: new Date() };
      return memoryStore[storeName][index];
    },
    async count({ where = {} } = {}) {
      if (!memoryStore[storeName]) return 0;
      let results = memoryStore[storeName];
      for (const [key, value] of Object.entries(where)) {
        results = results.filter(r => r[key] === value);
      }
      return results.length;
    },
    async delete({ where }) {
      if (!memoryStore[storeName]) return null;
      const index = memoryStore[storeName].findIndex(r => r.id === where.id);
      if (index === -1) return null;
      const [deleted] = memoryStore[storeName].splice(index, 1);
      return deleted;
    },
  };
}

// ===== Supabase Model — Prisma-compatible API =====

// Map: camelCase field → snake_case column
const FIELD_MAP = {
  // WorkflowRun
  currentStep: 'current_step',
  newsTitle: 'news_title',
  newsBody: 'news_body',
  newsSource: 'news_source',
  newsDate: 'news_date',
  newsCategory: 'news_category',
  rawInput: 'raw_input',
  sourceType: 'source_type',
  breakdownData: 'breakdown_data',
  analysisResult: 'analysis_result',
  presetUsed: 'preset_used',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  // Content
  sourceId: 'source_id',
  originalText: 'original_text',
  cleanedText: 'cleaned_text',
  viralScores: 'viral_scores',
  emotionalAnalysis: 'emotional_analysis',
  viralProbability: 'viral_probability',
  // Angle
  contentId: 'content_id',
  emotionalDirections: 'emotional_directions',
  commentBaits: 'comment_baits',
  discussionAngles: 'discussion_angles',
  selectedHeadlineIndex: 'selected_headline_index',
  selectedHookIndex: 'selected_hook_index',
  // Article
  angleId: 'angle_id',
  qualityScore: 'quality_score',
  isSelected: 'is_selected',
  rawContent: 'raw_content',
  isActive: 'is_active',
  // ApiUsageLog
  inputTokens: 'input_tokens',
  outputTokens: 'output_tokens',
  costUsd: 'cost_usd',
  userId: 'user_id',
};

// camelCase → snake_case
function toSnake(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = FIELD_MAP[key] || key;
    result[snakeKey] = value;
  }
  return result;
}

// snake_case → camelCase
const REVERSE_MAP = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([k, v]) => [v, k])
);

function toCamel(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = REVERSE_MAP[key] || key;
    result[camelKey] = value;
  }
  return result;
}

function createSupabaseModel(tableName) {
  return {
    async create({ data }) {
      const sb = getSupabase();
      const id = data.id || uuidv4();
      const rowData = { ...data, id };
      if (tableName !== 'api_usage_logs') {
        rowData.updatedAt = new Date().toISOString();
      }
      const row = toSnake(rowData);
      // ลบ created_at ถ้าไม่ได้ส่งมา (ให้ DB ใช้ default)
      if (!data.createdAt) delete row.created_at;
      
      const { data: inserted, error } = await sb
        .from(tableName)
        .insert(row)
        .select()
        .single();
      
      if (error) {
        console.error(`[DB:${tableName}] CREATE error:`, error.message);
        throw new Error(error.message);
      }
      console.log(`[DB:${tableName}] ✅ Created: ${id}`);
      return toCamel(inserted);
    },

    async findUnique({ where }) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from(tableName)
        .select('*')
        .eq('id', where.id)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') return null; // not found
        console.error(`[DB:${tableName}] FIND error:`, error.message);
        return null;
      }
      return data ? toCamel(data) : null;
    },

    async findMany({ where = {}, orderBy } = {}) {
      const sb = getSupabase();
      let query = sb.from(tableName).select('*');
      
      // Apply filters
      for (const [key, value] of Object.entries(where)) {
        const snakeKey = FIELD_MAP[key] || key;
        query = query.eq(snakeKey, value);
      }
      
      // Apply ordering
      if (orderBy) {
        const [field, direction] = Object.entries(orderBy)[0] || [];
        if (field) {
          const snakeField = FIELD_MAP[field] || field;
          query = query.order(snakeField, { ascending: direction === 'asc' });
        }
      } else {
        query = query.order('created_at', { ascending: false });
      }
      
      const { data, error } = await query;
      if (error) {
        console.error(`[DB:${tableName}] FIND_MANY error:`, error.message);
        return [];
      }
      return (data || []).map(toCamel);
    },

    async update({ where, data }) {
      const sb = getSupabase();
      const rowData = { ...data };
      if (tableName !== 'api_usage_logs') {
        rowData.updatedAt = new Date().toISOString();
      }
      const row = toSnake(rowData);
      
      const { data: updatedData, error } = await sb
        .from(tableName)
        .update(row)
        .eq('id', where.id)
        .select();
      
      if (error) {
        console.error(`[DB:${tableName}] UPDATE error:`, error.message);
        return null;
      }
      
      const updated = updatedData && updatedData.length > 0 ? updatedData[0] : null;
      if (!updated) {
        console.warn(`[DB:${tableName}] UPDATE warning: No row found with id ${where.id}`);
        return null;
      }

      console.log(`[DB:${tableName}] ✅ Updated: ${where.id}`);
      return toCamel(updated);
    },

    async count({ where = {} } = {}) {
      const sb = getSupabase();
      let query = sb.from(tableName).select('*', { count: 'exact', head: true });
      
      for (const [key, value] of Object.entries(where)) {
        const snakeKey = FIELD_MAP[key] || key;
        query = query.eq(snakeKey, value);
      }
      
      const { count, error } = await query;
      if (error) return 0;
      return count || 0;
    },

    async delete({ where }) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from(tableName)
        .delete()
        .eq('id', where.id)
        .select()
        .single();
      
      if (error) {
        console.error(`[DB:${tableName}] DELETE error:`, error.message);
        return null;
      }
      console.log(`[DB:${tableName}] ✅ Deleted: ${where.id}`);
      return data ? toCamel(data) : null;
    },
  };
}

// ===== Export: เลือก Supabase หรือ Memory =====

let prismaInstance;

if (isSupabaseReady()) {
  console.log('[DB] ✅ Using Supabase PostgreSQL (persistent)');
  prismaInstance = {
    workflowRun: createSupabaseModel('workflow_runs'),
    content: createSupabaseModel('contents'),
    source: createSupabaseModel('sources'), // sources table — fixed: was incorrectly mapped to 'contents'
    angle: createSupabaseModel('angles'),
    article: createSupabaseModel('articles'),
    apiUsageLog: createSupabaseModel('api_usage_logs'),
  };
} else {
  console.log('[DB] ⚠️ No Supabase — using in-memory store (data will be lost on cold start)');
  prismaInstance = {
    workflowRun: createMemoryModel('workflow_runs'),
    content: createMemoryModel('contents'),
    source: createMemoryModel('sources'),
    angle: createMemoryModel('angles'),
    article: createMemoryModel('articles'),
    apiUsageLog: createMemoryModel('api_usage_logs'),
  };
}

export const prisma = prismaInstance;
export default prisma;

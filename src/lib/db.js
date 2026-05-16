import { v4 as uuidv4 } from 'uuid';

// ===== In-Memory Store สำหรับ Vercel (serverless) =====
// บน Vercel ไม่มี SQLite — ใช้ memory store แทน
// ข้อมูลจะหายเมื่อ function หมดอายุ (cold start ใหม่)
// สำหรับ production จริง → ใช้ Turso, Neon, หรือ Supabase

const memoryStore = {
  contents: [],
  angles: [],
  articles: [],
  sources: [],
};

// สร้าง Prisma-like API ที่ทำงานกับ memory
function createMemoryModel(storeName) {
  return {
    async create({ data }) {
      const record = {
        ...data,
        id: data.id || uuidv4(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryStore[storeName].push(record);
      return record;
    },
    async findUnique({ where }) {
      return memoryStore[storeName].find(r => r.id === where.id) || null;
    },
    async findMany({ where = {}, orderBy } = {}) {
      let results = [...memoryStore[storeName]];
      // Basic filtering
      for (const [key, value] of Object.entries(where)) {
        results = results.filter(r => r[key] === value);
      }
      // Basic ordering
      if (orderBy?.createdAt === 'desc') {
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }
      return results;
    },
    async update({ where, data }) {
      const index = memoryStore[storeName].findIndex(r => r.id === where.id);
      if (index === -1) return null;
      memoryStore[storeName][index] = { ...memoryStore[storeName][index], ...data, updatedAt: new Date() };
      return memoryStore[storeName][index];
    },
    async count({ where = {} } = {}) {
      let results = memoryStore[storeName];
      for (const [key, value] of Object.entries(where)) {
        results = results.filter(r => r[key] === value);
      }
      return results.length;
    },
    async delete({ where }) {
      const index = memoryStore[storeName].findIndex(r => r.id === where.id);
      if (index === -1) return null;
      const [deleted] = memoryStore[storeName].splice(index, 1);
      return deleted;
    },
  };
}

// Memory-based prisma replacement
const memoryPrisma = {
  content: createMemoryModel('contents'),
  source: createMemoryModel('sources'),
  angle: createMemoryModel('angles'),
  article: createMemoryModel('articles'),
};

// ลองโหลด Prisma จริง (จะทำงานเฉพาะ local dev)
let prismaInstance = null;

try {
  if (process.env.NODE_ENV === 'development' || process.env.USE_SQLITE === 'true') {
    const { PrismaClient } = await import('@prisma/client');
    const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3');
    const pathModule = await import('path');
    
    const dbPath = process.env.DATABASE_URL?.replace('file:', '') || pathModule.default.join(process.cwd(), 'prisma', 'dev.db');
    const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
    prismaInstance = new PrismaClient({ adapter });
    console.log('✅ Using SQLite database');
  }
} catch (e) {
  console.log('ℹ️ SQLite not available — using in-memory store (Vercel mode)');
}

export const prisma = prismaInstance || memoryPrisma;
export default prisma;

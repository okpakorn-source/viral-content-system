/**
 * Cover Case Archive — บันทึกปกทุกครั้งที่สร้าง เป็น CASE-001, CASE-002, ...
 * Primary: Supabase | Fallback: Local JSON + files
 */
import { getSupabase } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

const LOCAL_JSON_PATH = path.join(process.cwd(), 'data', 'cover-cases.json');
const LOCAL_IMAGES_DIR = path.join(process.cwd(), 'public', 'cover-cases');

// ============ Local Helpers ============
function ensureDirs() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(LOCAL_IMAGES_DIR)) fs.mkdirSync(LOCAL_IMAGES_DIR, { recursive: true });
}

function loadLocalCases() {
  try {
    if (fs.existsSync(LOCAL_JSON_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_JSON_PATH, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveLocalCases(cases) {
  ensureDirs();
  fs.writeFileSync(LOCAL_JSON_PATH, JSON.stringify(cases, null, 2), 'utf-8');
}

// ============ Case ID ============
function formatCaseId(num) {
  return `CASE-${String(num).padStart(3, '0')}`;
}

/**
 * หา case ID ถัดไป
 */
export async function getNextCaseId() {
  let maxNum = 0;

  // 1. Try Supabase
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('cover_cases')
        .select('case_id')
        .order('case_number', { ascending: false })
        .limit(1);
      
      if (error) {
        console.log(`[CaseArchive] ⚠️ Supabase cover_cases query error: ${error.message}`);
        throw error;
      }

      if (data && data.length > 0) {
        const lastNum = parseInt(data[0].case_id.replace('CASE-', ''), 10);
        if (!isNaN(lastNum) && lastNum > maxNum) {
          maxNum = lastNum;
        }
      }
    } catch (err) {
      console.log(`[CaseArchive] ⚠️ Supabase getNextCaseId failed, falling back: ${err.message || err}`);
    }
  }

  // 2. Try Local JSON
  try {
    const cases = loadLocalCases();
    if (cases && cases.length > 0) {
      const localLastNum = Math.max(...cases.map(c => c.caseNumber || 0));
      if (!isNaN(localLastNum) && localLastNum > maxNum) {
        maxNum = localLastNum;
      }
    }
  } catch (err) {
    console.log(`[CaseArchive] ⚠️ Local JSON load/parse failed: ${err.message}`);
  }

  const nextNum = maxNum + 1;
  return { caseId: formatCaseId(nextNum), caseNumber: nextNum };
}

/**
 * บันทึก case ใหม่
 * @param {Buffer} coverBuffer — ภาพปก JPEG
 * @param {Object} metadata — ข้อมูลปก
 */
export async function saveCase(coverBuffer, metadata) {
  let { caseId, caseNumber } = await getNextCaseId();
  const now = new Date().toISOString();

  const caseData = {
    caseId,
    caseNumber,
    newsTitle: metadata.newsTitle || '',
    content: (metadata.content || '').substring(0, 5000), // จำกัด 5000 ตัวอักษร
    score: metadata.score || 0,
    templateUsed: metadata.templateUsed || '',
    elapsed: metadata.elapsed || '',
    imageCount: metadata.imageCount || 0,
    identity: metadata.identity || {},
    batchId: metadata.batchId || null,
    createdAt: now,
  };

  // ★ Save image locally
  ensureDirs();
  const localImagePath = path.join(LOCAL_IMAGES_DIR, `${caseId}.jpg`);
  try {
    fs.writeFileSync(localImagePath, coverBuffer);
    caseData.coverImagePath = `/cover-cases/${caseId}.jpg`;
    console.log(`[CaseArchive] 💾 Saved image: ${localImagePath}`);
  } catch (e) {
    console.log(`[CaseArchive] ⚠️ Image save failed: ${e.message}`);
    caseData.coverImagePath = '';
  }

  // ★ Save to Supabase (primary)
  const sb = getSupabase();
  let savedToSupabase = false;
  if (sb) {
    try {
      // Upload image to Supabase Storage
      const storagePath = `cover-cases/${caseId}.jpg`;
      const { error: uploadErr } = await sb.storage
        .from('images')
        .upload(storagePath, coverBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });
      
      if (!uploadErr) {
        const { data: urlData } = sb.storage.from('images').getPublicUrl(storagePath);
        caseData.supabaseImageUrl = urlData?.publicUrl || '';
      }

      // Insert case record — with retry on duplicate key (C-18 race condition fix)
      const insertPayload = {
        case_id: caseId,
        case_number: caseNumber,
        news_title: caseData.newsTitle,
        content: caseData.content,
        score: caseData.score,
        template_used: caseData.templateUsed,
        elapsed: caseData.elapsed,
        image_count: caseData.imageCount,
        identity: {
          ...caseData.identity,
          news_url: metadata.newsUrl || '',  // เก็บ news_url ใน JSONB identity
        },
        batch_id: caseData.batchId,
        cover_image_url: caseData.supabaseImageUrl || caseData.coverImagePath,
        created_at: now,
      };

      let { error: insertErr } = await sb
        .from('cover_cases')
        .insert(insertPayload);

      // ★ C-18: Retry once on duplicate key (race condition between concurrent requests)
      if (insertErr?.code === '23505') {
        console.log(`[CaseArchive] ⚠️ Duplicate case_id ${caseId}, retrying with new ID...`);
        const retry = await getNextCaseId();
        caseId = retry.caseId;
        caseNumber = retry.caseNumber;
        caseData.caseId = caseId;
        caseData.caseNumber = caseNumber;
        insertPayload.case_id = caseId;
        insertPayload.case_number = caseNumber;

        const retryResult = await sb
          .from('cover_cases')
          .insert(insertPayload);
        insertErr = retryResult.error;
      }

      if (!insertErr) {
        savedToSupabase = true;
        console.log(`[CaseArchive] ☁️ Saved to Supabase: ${caseId}`);
      } else {
        console.log(`[CaseArchive] ⚠️ Supabase insert failed: ${insertErr.message}`);
      }
    } catch (e) {
      console.log(`[CaseArchive] ⚠️ Supabase error: ${e.message}`);
    }
  }

  // ★ Always save to local JSON (fallback / backup)
  const cases = loadLocalCases();
  cases.push(caseData);
  saveLocalCases(cases);
  console.log(`[CaseArchive] 📁 Saved to local: ${caseId} (total: ${cases.length} cases)`);

  return { caseId, caseNumber, savedToSupabase };
}

/**
 * ดึงรายการ cases ทั้งหมด
 */
export async function listCases(limit = 50, offset = 0) {
  // ลอง Supabase ก่อน
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('cover_cases')
        .select('*')
        .order('case_number', { ascending: false })
        .range(offset, offset + limit - 1);
      
      if (!error && data && data.length > 0) {
        return data.map(row => ({
          caseId: row.case_id,
          caseNumber: row.case_number,
          newsTitle: row.news_title,
          score: row.score,
          templateUsed: row.template_used,
          elapsed: row.elapsed,
          imageCount: row.image_count,
          identity: row.identity,
          batchId: row.batch_id,
          coverImageUrl: row.cover_image_url,
          createdAt: row.created_at,
          // fields added by migration (may be null if not yet populated)
          analysis: row.analysis ?? null,
          subjects: row.subjects ?? null,
          emotion: row.emotion ?? null,
          newsBody: row.news_body ?? null,
          newsUrl: row.news_url ?? null,
        }));
      }
    } catch {}
  }

  // Fallback: local
  const cases = loadLocalCases();
  return cases
    .sort((a, b) => (b.caseNumber || 0) - (a.caseNumber || 0))
    .slice(offset, offset + limit);
}

/**
 * ดึง case เดียว
 */
export async function getCase(caseId) {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('cover_cases')
        .select('*')
        .eq('case_id', caseId)
        .single();
      
      if (!error && data) {
        return {
          caseId: data.case_id,
          caseNumber: data.case_number,
          newsTitle: data.news_title,
          content: data.content,
          score: data.score,
          templateUsed: data.template_used,
          elapsed: data.elapsed,
          imageCount: data.image_count,
          identity: data.identity,
          batchId: data.batch_id,
          coverImageUrl: data.cover_image_url,
          createdAt: data.created_at,
          // fields added by migration (may be null if not yet populated)
          analysis: data.analysis ?? null,
          subjects: data.subjects ?? null,
          emotion: data.emotion ?? null,
          newsBody: data.news_body ?? null,
          newsUrl: data.news_url ?? null,
        };
      }
    } catch {}
  }

  // Fallback: local
  const cases = loadLocalCases();
  return cases.find(c => c.caseId === caseId) || null;
}

/**
 * สถิติรวม
 */
export async function getStatistics() {
  let cases = [];

  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('cover_cases')
        .select('case_number, score, template_used, created_at')
        .order('case_number', { ascending: true });
      
      if (!error && data && data.length > 0) {
        cases = data.map(r => ({
          caseNumber: r.case_number,
          score: r.score,
          templateUsed: r.template_used,
          createdAt: r.created_at,
        }));
      }
    } catch {}
  }

  // Fallback
  if (cases.length === 0) {
    cases = loadLocalCases().map(c => ({
      caseNumber: c.caseNumber,
      score: c.score,
      templateUsed: c.templateUsed,
      createdAt: c.createdAt,
    }));
  }

  if (cases.length === 0) {
    return { totalCases: 0, avgScore: 0, scores: [], trend: 'stable', templateDistribution: {} };
  }

  const scores = cases.map(c => c.score).filter(s => s > 0);
  const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;

  // Trend: compare last 5 vs previous 5
  let trend = 'stable';
  if (scores.length >= 10) {
    const recent5 = scores.slice(-5);
    const prev5 = scores.slice(-10, -5);
    const recentAvg = recent5.reduce((a, b) => a + b, 0) / 5;
    const prevAvg = prev5.reduce((a, b) => a + b, 0) / 5;
    if (recentAvg > prevAvg + 0.5) trend = 'improving';
    else if (recentAvg < prevAvg - 0.5) trend = 'declining';
  }

  // Template distribution
  const templateDistribution = {};
  cases.forEach(c => {
    const t = c.templateUsed || 'unknown';
    templateDistribution[t] = (templateDistribution[t] || 0) + 1;
  });

  // Score distribution
  const scoreDistribution = { high: 0, mid: 0, low: 0 };
  scores.forEach(s => {
    if (s >= 8) scoreDistribution.high++;
    else if (s >= 5) scoreDistribution.mid++;
    else scoreDistribution.low++;
  });

  return {
    totalCases: cases.length,
    avgScore: parseFloat(avgScore),
    trend,
    scores: cases.map(c => ({ caseNumber: c.caseNumber, score: c.score })),
    scoreDistribution,
    templateDistribution,
  };
}

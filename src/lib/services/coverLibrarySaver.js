/**
 * coverLibrarySaver.js
 *
 * บันทึกปกที่ระบบสร้างอัตโนมัติ (auto-cover) เข้า "คลังปก" (cover_examples table)
 * พร้อม metadata ครบชุดเพื่อติดตามพัฒนาการของแต่ละปก
 *
 * ออกแบบให้ใช้แบบ fire-and-forget (ไม่ block response หลัก)
 * ถ้า save ล้มเหลว → log warning แต่ไม่ throw
 */
import { getSupabase } from '../supabase.js';
import sharp from 'sharp';

/**
 * คำนวณ version ถัดไปสำหรับ caseId เดิม
 * ถ้าไม่มี caseId หรือ Supabase ล้มเหลว → return 1
 */
async function getNextVersionForCase(supabase, caseId) {
  if (!caseId || !supabase) return 1;
  try {
    const { data } = await supabase
      .from('cover_examples')
      .select('version')
      .eq('case_id', caseId)
      .order('version', { ascending: false })
      .limit(1);
    if (data && data.length > 0 && data[0].version) {
      return (data[0].version || 0) + 1;
    }
  } catch {
    // ถ้า column ยังไม่มี → ใช้ 1
  }
  return 1;
}

/**
 * สร้าง thumbnail JPEG base64 (data URI) จาก buffer ขนาดใหญ่
 * → resize เป็น 400x400 เพื่อประหยัด storage
 */
async function makeThumbnail(imageBase64) {
  try {
    // imageBase64 อาจมี "data:image/jpeg;base64," prefix หรือไม่มีก็ได้
    const rawB64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(rawB64, 'base64');
    const thumbBuf = await sharp(buf)
      .resize(400, 400, { fit: 'inside' })
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;
  } catch {
    // ถ้า resize ล้มเหลว → ใช้ original แบบตัดสั้น (ไม่ควรเกิด)
    return imageBase64.substring(0, 50000);
  }
}

/**
 * auto-save ปกที่สร้างเสร็จแล้ว เข้า cover_examples table
 *
 * @param {Object} params
 * @param {string}   params.imageBase64   — base64 ภาพปก (data URI หรือ raw)
 * @param {Buffer}  [params.coverBuffer]  — buffer ต้นฉบับ (ใช้แทน imageBase64 ถ้ามี)
 * @param {string}   params.templateId    — template ที่ใช้ เช่น 'builtin_3'
 * @param {string}   params.newsTitle     — หัวข้อข่าว
 * @param {string}  [params.newsUrl]      — URL ต้นทาง (optional)
 * @param {string}  [params.newsBody]     — เนื้อหาข่าวที่ใช้เจนปก (optional)
 * @param {string}  [params.caseId]       — case ID เช่น 'CASE-042'
 * @param {number}  [params.score]        — คะแนนจาก Gemini (1-10)
 * @param {string[]}[params.subjects]     — ชื่อตัวละครหลัก เช่น ['ชมพู่', 'อารยา']
 * @param {string}  [params.emotion]      — อารมณ์หลัก เช่น 'shocked'
 * @param {number}  [params.imageCount]   — จำนวนภาพที่ใช้สร้างปก
 * @param {number}  [params.version]      — เวอร์ชัน (คำนวณอัตโนมัติถ้าไม่ระบุ)
 * @returns {Promise<{success: boolean, id?: string|number, error?: string}>}
 */
export async function saveGeneratedCoverToLibrary(params) {
  console.log('[CoverLibrarySaver] 🔄 saveGeneratedCoverToLibrary called with:', {
    hasImageBase64: !!params.imageBase64,
    hasCoverBuffer: !!params.coverBuffer,
    coverBufferLength: params.coverBuffer?.length || 0,
    templateId: params.templateId,
    newsTitle: (params.newsTitle || '').substring(0, 60),
    caseId: params.caseId,
    score: params.score,
    subjects: params.subjects,
    emotion: params.emotion,
    imageCount: params.imageCount,
  });

  const {
    imageBase64,
    coverBuffer,
    templateId = 'auto',
    newsTitle = '',
    newsUrl = '',
    newsBody = '',
    caseId = null,
    score = 7,
    subjects = [],
    emotion = '',
    imageCount = 0,
  } = params;

  const supabase = getSupabase();
  if (!supabase) {
    console.warn('[CoverLibrarySaver] ⚠️ Supabase not configured — skipping auto-save');
    return { success: false, error: 'SUPABASE_NOT_READY' };
  }

  try {
    // แปลง base64 จาก coverBuffer ถ้าไม่มี imageBase64
    let b64 = imageBase64;
    if (!b64 && coverBuffer) {
      b64 = `data:image/jpeg;base64,${coverBuffer.toString('base64')}`;
    }
    if (!b64) {
      return { success: false, error: 'NO_IMAGE' };
    }

    // สร้าง thumbnail เพื่อเก็บในฟิลด์ thumbnail (เล็กกว่า full image)
    const thumbnail = await makeThumbnail(b64);

    // คำนวณ version
    const version = await getNextVersionForCase(supabase, caseId);

    // สร้าง composition summary พื้นฐาน (ไม่ผ่าน AI วิเคราะห์ — ใช้ข้อมูลที่มี)
    const composition = {
      layout_type: templateId,
      source_type: 'auto_generated', // แยกจาก manual upload
      slot_count: imageCount,
      has_circle: templateId.includes('circle') || ['builtin_3', 'builtin_4', 'builtin_5', 'builtin_6'].includes(templateId),
      has_text: true,
      color_scheme: { mood: emotion || 'drama' },
      // ข้อมูลเพิ่มเติมเก็บใน JSONB (ไม่ต้องการ column ใหม่)
      case_id: caseId || null,
      subjects: subjects || [],
    };

    // Insert เข้า cover_examples
    // เขียนทั้ง real columns (หลัง migration) และ JSONB backup (compat)
    console.log('[CoverLibrarySaver] 📝 Inserting into cover_examples...', {
      title: (newsTitle || 'ปกอัตโนมัติ').substring(0, 40),
      category: 'auto_generated',
      thumbnailSize: thumbnail?.length || 0,
      quality_score: score,
      caseId,
      version,
    });
    const { data, error } = await supabase
      .from('cover_examples')
      .insert({
        title: newsTitle || 'ปกอัตโนมัติ',
        category: 'auto_generated',
        notes: newsUrl || '',
        thumbnail,
        image_width: 1080,
        image_height: 1080,
        // ── Real columns (ต้องรัน sql/migrations/add-cover-examples-columns.sql ก่อน) ──
        source_type: 'auto_generated',
        case_id: caseId || null,
        news_url: newsUrl || null,
        subjects: subjects.length > 0 ? subjects : null,
        emotion: emotion || null,
        image_count: imageCount || 0,
        version: version || 1,
        // ── JSONB backup (compat กับ code เก่าที่อ่านจาก analysis) ──
        analysis: {
          suggested_title: newsTitle,
          layout_type: templateId,
          quality_score: score,
          what_makes_it_viral: '',
          tags: subjects.length > 0 ? subjects : [],
          slot_assignment_guide: '',
          source_type: 'auto_generated',
          case_id: caseId || null,
          news_url: newsUrl || null,
          news_body: newsBody || null,
          subjects: subjects || [],
          emotion: emotion || null,
          image_count: imageCount || 0,
          version: version || 1,
          created_at: new Date().toISOString(),
        },
        composition,
        tags: subjects.length > 0 ? subjects : [],
        quality_score: score,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // ถ้าเป็น column-not-found error → ลอง insert แบบ minimal fields (backward compat)
      if (error.code === '42703' || error.message?.includes('column')) {
        console.warn('[CoverLibrarySaver] ⚠️ Extra columns not in table — falling back to minimal insert (JSONB only)');
        const { data: d2, error: e2 } = await supabase
          .from('cover_examples')
          .insert({
            title: newsTitle || 'ปกอัตโนมัติ',
            category: 'auto_generated',
            notes: newsUrl || '',
            thumbnail,
            image_width: 1080,
            image_height: 1080,
            // JSONB fallback เท่านั้น — ไม่ใส่ real columns เพราะ column ยังไม่มี
            analysis: {
              suggested_title: newsTitle,
              layout_type: templateId,
              quality_score: score,
              tags: subjects,
              source_type: 'auto_generated',
              case_id: caseId || null,
              news_url: newsUrl || null,
              news_body: newsBody || null,
              subjects: subjects || [],
              emotion: emotion || null,
              image_count: imageCount || 0,
              version: version || 1,
              created_at: new Date().toISOString(),
            },
            composition,
            tags: subjects.length > 0 ? subjects : [],
            quality_score: score,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (e2) throw e2;
        console.log(`[CoverLibrarySaver] ✅ Saved (minimal) to cover_library, id=${d2?.id}`);
        return { success: true, id: d2?.id };
      }
      throw error;
    }

    console.log(`[CoverLibrarySaver] ✅ Auto-saved cover to library: id=${data?.id}, case=${caseId || '-'}, score=${score}, v${version}`);
    return { success: true, id: data?.id, version };
  } catch (err) {
    console.warn(`[CoverLibrarySaver] ⚠️ Failed to save cover to library: ${err.message}`);
    return { success: false, error: err.message };
  }
}

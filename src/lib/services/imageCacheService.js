import crypto from 'crypto';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

/**
 * ============================================
 * Image Cache Service
 * ============================================
 * เก็บรูปที่ capture มาได้ไว้ใน Supabase เพื่อนำกลับมาใช้ซ้ำ
 * - Table: image_cache (metadata + keywords สำหรับค้นหา)
 * - Storage: bucket "image-cache" (เก็บไฟล์จริง)
 * 
 * ถ้า Storage upload ล้มเหลว จะยังบันทึก metadata ลง table ได้
 * ถ้า Supabase ไม่พร้อม จะ return ผลว่างแทน error
 */

const TABLE = 'image_cache';
const BUCKET = 'image-cache';

// ═══════════════════════════════════════════════
// generateNewsHash — สร้าง hash จาก title เพื่อ lookup
// ═══════════════════════════════════════════════
export function generateNewsHash(newsTitle) {
  if (!newsTitle) return '';
  // normalize: trim + lowercase เพื่อให้ hash เหมือนกันแม้มี whitespace ต่าง
  const normalized = newsTitle.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ═══════════════════════════════════════════════
// uploadToStorage — อัพโหลด buffer ไป Supabase Storage
// ═══════════════════════════════════════════════
export async function uploadToStorage(buffer, filename) {
  try {
    if (!isSupabaseReady()) {
      console.log('[ImageCache] ⚠️ Supabase not ready, skip storage upload');
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    const sb = getSupabase();
    const storagePath = `cache/${Date.now()}_${filename}`;

    const { data, error } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) {
      console.log(`[ImageCache] ❌ Storage upload failed: ${error.message}`);
      return { success: false, error: error.message, errorType: 'STORAGE_UPLOAD_FAILED' };
    }

    // สร้าง public URL
    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl || '';

    console.log(`[ImageCache] ✅ Uploaded to storage: ${storagePath}`);
    return { success: true, storagePath, publicUrl };
  } catch (err) {
    console.log(`[ImageCache] ❌ Storage upload error: ${err.message}`);
    return { success: false, error: err.message, errorType: 'STORAGE_UPLOAD_ERROR' };
  }
}

// ═══════════════════════════════════════════════
// downloadFromStorage — ดาวน์โหลด buffer จาก storage path
// ═══════════════════════════════════════════════
export async function downloadFromStorage(storagePath) {
  try {
    if (!isSupabaseReady()) {
      console.log('[ImageCache] ⚠️ Supabase not ready, cannot download');
      return null;
    }

    const sb = getSupabase();
    const { data, error } = await sb.storage
      .from(BUCKET)
      .download(storagePath);

    if (error) {
      console.log(`[ImageCache] ❌ Storage download failed: ${error.message}`);
      return null;
    }

    // data เป็น Blob → แปลงเป็น Buffer
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[ImageCache] ✅ Downloaded from storage: ${storagePath} (${buffer.length} bytes)`);
    return buffer;
  } catch (err) {
    console.log(`[ImageCache] ❌ Storage download error: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════
// saveToCache — บันทึกรูปหลายรูปลง cache
// ═══════════════════════════════════════════════
export async function saveToCache(images, newsTitle, identity = {}) {
  try {
    if (!isSupabaseReady()) {
      console.log('[ImageCache] ⚠️ Supabase not ready, skip cache save');
      return { success: false, saved: 0, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    const sb = getSupabase();
    const newsHash = generateNewsHash(newsTitle);
    const records = [];
    let savedCount = 0;

    for (let i = 0; i < images.length; i++) {
      const img = images[i];

      try {
        // ดึงขนาดรูปด้วย sharp (ถ้ามี buffer)
        let width = 0;
        let height = 0;
        let fileSize = 0;

        if (img.buffer && Buffer.isBuffer(img.buffer)) {
          try {
            const metadata = await sharp(img.buffer).metadata();
            width = metadata.width || 0;
            height = metadata.height || 0;
            fileSize = img.buffer.length;
          } catch (sharpErr) {
            console.log(`[ImageCache] ⚠️ sharp metadata failed for image ${i}: ${sharpErr.message}`);
          }
        }

        // อัพโหลดไป Storage (graceful — ล้มเหลวได้)
        let storagePath = null;
        if (img.buffer && Buffer.isBuffer(img.buffer)) {
          const ext = 'jpg';
          const filename = `${newsHash.slice(0, 12)}_${i}_${uuidv4().slice(0, 8)}.${ext}`;
          const uploadResult = await uploadToStorage(img.buffer, filename);
          if (uploadResult.success) {
            storagePath = uploadResult.storagePath;
          }
          // ถ้า upload ล้มเหลว ยัง save metadata ต่อได้
        }

        // สร้าง keywords จาก identity
        const keywords = buildKeywords(newsTitle, identity);

        const record = {
          id: uuidv4(),
          news_title: newsTitle,
          news_hash: newsHash,
          image_url: img.url || '',
          storage_path: storagePath,
          source: img.source || 'google',
          role: img.role || 'SUPPORT',
          ai_score: img.score || 0,
          keywords,
          characters: identity.characters || identity.people || [],
          emotion: identity.coverEmotion || identity.emotion || '',
          location: identity.location || '',
          scene_desc: identity.sceneDescription || '',
          width,
          height,
          file_size: fileSize,
          is_used: false,
          metadata: {
            originalSource: img.source || 'unknown',
            capturedAt: new Date().toISOString(),
            identitySnapshot: {
              mainCharacter: identity.mainCharacter || identity.mainSubject || '',
              emotion: identity.coverEmotion || '',
            },
          },
        };

        const { error } = await sb.from(TABLE).insert(record);
        if (error) {
          console.log(`[ImageCache] ❌ DB insert failed for image ${i}: ${error.message}`);
        } else {
          savedCount++;
        }

        records.push(record);
      } catch (imgErr) {
        console.log(`[ImageCache] ❌ Failed to process image ${i}: ${imgErr.message}`);
      }
    }

    console.log(`[ImageCache] 💾 Saved ${savedCount}/${images.length} images to cache (hash: ${newsHash.slice(0, 12)}...)`);
    return { success: true, saved: savedCount, total: images.length, newsHash, records };
  } catch (err) {
    console.log(`[ImageCache] ❌ saveToCache error: ${err.message}`);
    return { success: false, saved: 0, error: err.message, errorType: 'CACHE_SAVE_ERROR' };
  }
}

// ═══════════════════════════════════════════════
// getFromCache — ดึงรูปที่ cache ไว้ตาม news hash
// ═══════════════════════════════════════════════
export async function getFromCache(newsHash) {
  try {
    if (!isSupabaseReady()) {
      console.log('[ImageCache] ⚠️ Supabase not ready');
      return [];
    }

    const sb = getSupabase();
    const { data, error } = await sb
      .from(TABLE)
      .select('*')
      .eq('news_hash', newsHash)
      .order('ai_score', { ascending: false });

    if (error) {
      console.log(`[ImageCache] ❌ getFromCache error: ${error.message}`);
      return [];
    }

    console.log(`[ImageCache] 📦 Found ${data?.length || 0} cached images for hash ${newsHash.slice(0, 12)}...`);
    return data || [];
  } catch (err) {
    console.log(`[ImageCache] ❌ getFromCache error: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════
// searchCacheByKeywords — ค้นรูปจาก keyword array (ใช้ @> operator)
// ═══════════════════════════════════════════════
export async function searchCacheByKeywords(keywords, limit = 20) {
  try {
    if (!isSupabaseReady() || !keywords || keywords.length === 0) {
      return [];
    }

    const sb = getSupabase();

    // ใช้ contains (@>) สำหรับ TEXT[] column — หา rows ที่ keywords มีทุกคำที่ส่งมา
    const { data, error } = await sb
      .from(TABLE)
      .select('*')
      .contains('keywords', keywords)
      .order('ai_score', { ascending: false })
      .limit(limit);

    if (error) {
      console.log(`[ImageCache] ❌ searchCacheByKeywords error: ${error.message}`);
      return [];
    }

    console.log(`[ImageCache] 🔍 Keyword search [${keywords.join(', ')}] → ${data?.length || 0} results`);
    return data || [];
  } catch (err) {
    console.log(`[ImageCache] ❌ searchCacheByKeywords error: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════
// searchCacheBySimilar — ค้นรูปคล้ายจากชื่อตัวละคร + อารมณ์
// ═══════════════════════════════════════════════
export async function searchCacheBySimilar(characters, emotion, limit = 20) {
  try {
    if (!isSupabaseReady()) {
      return [];
    }

    const sb = getSupabase();
    let query = sb
      .from(TABLE)
      .select('*')
      .order('ai_score', { ascending: false })
      .limit(limit);

    // ค้นจากตัวละคร (ถ้ามี)
    if (characters && characters.length > 0) {
      query = query.contains('characters', characters);
    }

    // กรองตาม emotion (ถ้าระบุ)
    if (emotion) {
      query = query.eq('emotion', emotion);
    }

    const { data, error } = await query;

    if (error) {
      console.log(`[ImageCache] ❌ searchCacheBySimilar error: ${error.message}`);
      return [];
    }

    console.log(`[ImageCache] 🔍 Similar search (chars: [${(characters || []).join(', ')}], emotion: ${emotion || 'any'}) → ${data?.length || 0} results`);
    return data || [];
  } catch (err) {
    console.log(`[ImageCache] ❌ searchCacheBySimilar error: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════
// getCacheStats — สถิติรวมของ cache
// ═══════════════════════════════════════════════
export async function getCacheStats() {
  try {
    if (!isSupabaseReady()) {
      return { totalImages: 0, totalSize: 0, bySource: {}, byEmotion: {} };
    }

    const sb = getSupabase();
    const { data, error } = await sb
      .from(TABLE)
      .select('source, emotion, file_size');

    if (error) {
      console.log(`[ImageCache] ❌ getCacheStats error: ${error.message}`);
      return { totalImages: 0, totalSize: 0, bySource: {}, byEmotion: {} };
    }

    const rows = data || [];
    const totalImages = rows.length;
    let totalSize = 0;
    const bySource = {};
    const byEmotion = {};

    for (const row of rows) {
      totalSize += row.file_size || 0;

      const src = row.source || 'unknown';
      bySource[src] = (bySource[src] || 0) + 1;

      const emo = row.emotion || 'unset';
      byEmotion[emo] = (byEmotion[emo] || 0) + 1;
    }

    console.log(`[ImageCache] 📊 Stats: ${totalImages} images, ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
    return { totalImages, totalSize, bySource, byEmotion };
  } catch (err) {
    console.log(`[ImageCache] ❌ getCacheStats error: ${err.message}`);
    return { totalImages: 0, totalSize: 0, bySource: {}, byEmotion: {} };
  }
}

// ═══════════════════════════════════════════════
// buildKeywords — สร้าง keyword array จาก title + identity
// ═══════════════════════════════════════════════
function buildKeywords(newsTitle, identity = {}) {
  const keywords = new Set();

  // แยกคำจาก title (ตัดคำที่สั้นเกินไป)
  if (newsTitle) {
    const words = newsTitle
      .replace(/["""''!?.,;:()[\]{}]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);
    for (const w of words) {
      keywords.add(w.toLowerCase());
    }
  }

  // เพิ่มจาก identity
  if (identity.mainCharacter) keywords.add(identity.mainCharacter);
  if (identity.mainSubject) keywords.add(identity.mainSubject);
  if (identity.coverEmotion) keywords.add(identity.coverEmotion);
  if (identity.location) keywords.add(identity.location);

  // เพิ่มชื่อบุคคล
  const people = identity.characters || identity.people || [];
  for (const p of people) {
    if (p) keywords.add(p);
  }

  // เพิ่ม key scenes
  const scenes = identity.keyScenes || [];
  for (const s of scenes) {
    if (s) keywords.add(String(s).toLowerCase());
  }

  return [...keywords].slice(0, 30); // จำกัด 30 keywords
}

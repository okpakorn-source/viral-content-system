import { v4 as uuidv4 } from 'uuid';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

/**
 * ============================================
 * Image Gallery Service
 * ============================================
 * เก็บรูปทั้งหมดที่ Agent ค้นมาได้ ใน Supabase
 * ใช้ memory store เป็น fallback สำหรับ local dev
 * 
 * Schema: cover_images
 * - id, session_id, news_title
 * - source_agent (google/youtube/tiktok/web)
 * - source_url, image_url
 * - thumbnail_base64 (ย่อเก็บ 200x200 สำหรับแสดง UI)
 * - width, height
 * - ai_score (0-10), ai_role (hero/support/rejected)
 * - ai_reason, is_selected, created_at
 */

// Memory fallback for local dev
const memoryGallery = [];

// ═══ Save images to gallery ═══
export async function saveToGallery(sessionId, newsTitle, images) {
  // images = [{ url, sourceAgent, role, score, reason, width, height, thumbnailBase64 }]
  const records = [];
  
  for (const img of images) {
    const record = {
      id: uuidv4(),
      session_id: sessionId,
      news_title: newsTitle,
      source_agent: img.sourceAgent || 'unknown',
      source_url: img.sourceUrl || '',
      image_url: img.url,
      thumbnail_base64: img.thumbnailBase64 || null,
      width: img.width || 0,
      height: img.height || 0,
      ai_score: img.score || 0,
      ai_role: img.role || 'support',
      ai_reason: img.reason || '',
      is_selected: img.isSelected || false,
      created_at: new Date().toISOString(),
    };
    
    if (isSupabaseReady()) {
      try {
        const sb = getSupabase();
        const { error } = await sb.from('cover_images').insert(record);
        if (error) {
          console.log(`[Gallery] Supabase insert error:`, error.message);
          memoryGallery.push(record); // fallback
        }
      } catch (e) {
        memoryGallery.push(record);
      }
    } else {
      memoryGallery.push(record);
    }
    
    records.push(record);
  }
  
  console.log(`[Gallery] 💾 Saved ${records.length} images to gallery (session: ${sessionId.slice(0, 8)}...)`);
  return records;
}

// ═══ Get all images for a session ═══
export async function getGalleryBySession(sessionId) {
  if (isSupabaseReady()) {
    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('cover_images')
        .select('*')
        .eq('session_id', sessionId)
        .order('ai_score', { ascending: false });
      
      if (error) {
        console.log(`[Gallery] Supabase query error:`, error.message);
        return memoryGallery.filter(r => r.session_id === sessionId);
      }
      return data || [];
    } catch (e) {
      return memoryGallery.filter(r => r.session_id === sessionId);
    }
  }
  
  return memoryGallery.filter(r => r.session_id === sessionId);
}

// ═══ Get all sessions (for gallery overview) ═══
export async function getAllGallerySessions() {
  if (isSupabaseReady()) {
    try {
      const sb = getSupabase();
      // Get unique sessions with their titles and image counts
      const { data, error } = await sb
        .from('cover_images')
        .select('session_id, news_title, created_at, ai_role, is_selected')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.log(`[Gallery] Supabase sessions error:`, error.message);
        return groupBySession(memoryGallery);
      }
      return groupBySession(data || []);
    } catch (e) {
      return groupBySession(memoryGallery);
    }
  }
  
  return groupBySession(memoryGallery);
}

function groupBySession(records) {
  const sessions = {};
  for (const r of records) {
    if (!sessions[r.session_id]) {
      sessions[r.session_id] = {
        sessionId: r.session_id,
        newsTitle: r.news_title,
        createdAt: r.created_at,
        totalImages: 0,
        selectedImages: 0,
        heroCount: 0,
      };
    }
    sessions[r.session_id].totalImages++;
    if (r.is_selected) sessions[r.session_id].selectedImages++;
    if (r.ai_role === 'hero') sessions[r.session_id].heroCount++;
  }
  return Object.values(sessions);
}

// ═══ Mark images as selected ═══
export async function markSelected(sessionId, imageIds) {
  if (isSupabaseReady()) {
    try {
      const sb = getSupabase();
      // Reset all selections for this session
      await sb
        .from('cover_images')
        .update({ is_selected: false })
        .eq('session_id', sessionId);
      
      // Set selected
      for (const id of imageIds) {
        await sb
          .from('cover_images')
          .update({ is_selected: true })
          .eq('id', id);
      }
    } catch (e) {
      console.log(`[Gallery] Mark selected error:`, e.message);
    }
  } else {
    // Memory fallback
    for (const r of memoryGallery) {
      if (r.session_id === sessionId) {
        r.is_selected = imageIds.includes(r.id);
      }
    }
  }
}

// ═══ Get latest images (for gallery page) ═══
export async function getLatestGalleryImages(limit = 100) {
  if (isSupabaseReady()) {
    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('cover_images')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) return memoryGallery.slice(-limit);
      return data || [];
    } catch (e) {
      return memoryGallery.slice(-limit);
    }
  }
  
  return memoryGallery.slice(-limit);
}

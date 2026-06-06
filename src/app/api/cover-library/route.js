/**
 * Cover Library API — /api/cover-library
 * 
 * ระบบคลังปกไวรัล: อัปโหลดภาพปกตัวอย่าง → AI วิเคราะห์องค์ประกอบ → เก็บเรียนรู้
 * 
 * POST: อัปโหลด + วิเคราะห์ปกใหม่
 * GET: ดึงปกในคลัง (ค้นหา/กรอง)
 * DELETE: ลบปก
 */
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import sharp from 'sharp';

// =============================================
// POST — อัปโหลดภาพปก + AI วิเคราะห์องค์ประกอบ
// =============================================
export async function POST(request) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image');
    const title = formData.get('title') || '';
    const category = formData.get('category') || 'ทั่วไป';
    const notes = formData.get('notes') || '';

    if (!imageFile) {
      return NextResponse.json(
        { success: false, error: 'ต้องอัปโหลดภาพปก', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // อ่าน image buffer
    const arrayBuffer = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const metadata = await sharp(imageBuffer).metadata();

    console.log(`[CoverLibrary] Analyzing cover: ${title || 'untitled'} (${metadata.width}x${metadata.height})`);

    // Resize สำหรับ AI Vision (ลด cost)
    const resizedBuffer = await sharp(imageBuffer)
      .resize(1024, 1024, { fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    const base64 = resizedBuffer.toString('base64');

    // AI วิเคราะห์องค์ประกอบปก
    const analysis = await analyzeCoverComposition(base64);

    // เก็บ thumbnail สำหรับ preview
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(400, 400, { fit: 'inside' })
      .jpeg({ quality: 70 })
      .toBuffer();
    const thumbnailBase64 = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;

    // บันทึกลง Supabase
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('cover_examples')
      .insert({
        title: title || analysis.suggested_title || 'ปกไม่มีชื่อ',
        category,
        notes,
        thumbnail: thumbnailBase64,
        image_width: metadata.width,
        image_height: metadata.height,
        analysis: analysis,
        composition: {
          layout_type: analysis.layout_type,
          slot_count: analysis.slots?.length || 0,
          has_circle: analysis.has_circle,
          has_text: analysis.has_text,
          color_scheme: analysis.color_scheme,
        },
        tags: analysis.tags || [],
        quality_score: analysis.quality_score || 7,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[CoverLibrary] ✅ Saved cover #${data.id}: ${data.title}`);

    return NextResponse.json({
      success: true,
      cover: {
        id: data.id,
        title: data.title,
        analysis,
      },
    });
  } catch (error) {
    console.error('[CoverLibrary] POST error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'COVER_LIBRARY_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================
// GET — ดึงปกจากคลัง
// =============================================
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '50');
    const forReference = searchParams.get('forReference') === 'true';

    const supabase = getSupabase();
    let query = supabase
      .from('cover_examples')
      .select(forReference 
        ? 'id, title, category, analysis, composition, quality_score' 
        : '*'
      )
      .order('quality_score', { ascending: false })
      .limit(limit);

    if (category) {
      query = query.eq('category', category);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,category.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      covers: data || [],
      total: data?.length || 0,
    });
  } catch (error) {
    console.error('[CoverLibrary] GET error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'COVER_LIBRARY_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================
// DELETE — ลบปก
// =============================================
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ id', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from('cover_examples')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CoverLibrary] DELETE error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'COVER_LIBRARY_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================
// AI วิเคราะห์องค์ประกอบปก — GPT-4o Vision
// =============================================
async function analyzeCoverComposition(base64Image) {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Image,
        },
      },
      {
        text: `คุณเป็นผู้เชี่ยวชาญด้านการออกแบบปกข่าวไวรัลบน Facebook
วิเคราะห์ภาพปกนี้อย่างละเอียด ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown

{
  "suggested_title": "ชื่อข่าวที่เดาได้จากปก",
  "layout_type": "grid_2x2_circle | hero_left | hero_top | tri_panel | collage | single_hero | other",
  
  "slots": [
    {
      "position": "top-left | top-right | bottom-left | bottom-right | left | right | top | bottom | center | full",
      "content_type": "face_closeup | face_emotion | person_full | scene | event | text_overlay | logo | object",
      "size_pct": 25,
      "description": "อธิบายภาพในช่องนี้สั้นๆ",
      "is_main_subject": true,
      "crop_style": "tight_face | medium_shot | wide_shot | full_body",
      "emotional_tone": "happy | sad | angry | shocked | neutral | dramatic"
    }
  ],
  
  "has_circle": true,
  "circle_content": "face_closeup | logo | text | none",
  "circle_position": "center | top-right | bottom-left",
  
  "has_text": true,
  "text_style": "overlay_bottom | overlay_top | side_panel | banner | none",
  "text_color": "#ffffff",
  "text_bg_color": "#ff0000 or transparent",
  
  "color_scheme": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "mood": "dark | bright | warm | cool | dramatic"
  },
  
  "composition_rules": [
    "กฎที่สังเกตได้ เช่น 'ภาพหลักเป็นหน้าคนชัด ครอบ tight'",
    "เช่น 'ใช้ภาพเหตุการณ์เป็น background blur'",
    "เช่น 'มี gradient fade ระหว่างภาพ'"
  ],
  
  "what_makes_it_viral": "อธิบายว่าทำไมปกนี้ถึงดึงดูดคนคลิก",
  
  "quality_score": 8,
  
  "tags": ["ข่าวบันเทิง", "ดราม่า", "ปกหน้าคน", "2x2"],
  
  "slot_assignment_guide": "คำแนะนำสำหรับ AI ว่าถ้าเจอข่าวแบบนี้ ควรจัดภาพยังไง เช่น 'slot หลักใส่หน้าคนหลัก tight crop, slot รองใส่ภาพเหตุการณ์, circle ใส่หน้าคนรอง'"
}`,
      },
    ]);

    const text = result.response.text();
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('[analyzeCoverComposition] Error:', err.message);
    return {
      suggested_title: '',
      layout_type: 'other',
      slots: [],
      has_circle: false,
      has_text: false,
      color_scheme: { primary: '#000', secondary: '#fff', accent: '#f00', mood: 'dark' },
      composition_rules: [],
      what_makes_it_viral: '',
      quality_score: 5,
      tags: [],
      slot_assignment_guide: '',
    };
  }
}

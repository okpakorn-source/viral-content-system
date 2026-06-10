/**
 * Review API Route — /api/chat/review
 * 
 * POST: Trigger AI review (news, caption, image) OR general chat
 * Saves result as AI message in chat_messages
 */
import { NextResponse } from 'next/server';
import { MODEL_PRIMARY } from '@/lib/ai/modelConfig';
import { getSupabase } from '@/lib/supabase';
import { reviewNews, reviewCaption, reviewImage } from '@/lib/services/chat/aiReviewer';
import { callAI } from '@/lib/ai/openai';
import { checkAllRules } from '@/lib/services/chat/contentRules';

const CLAUDE_SONNET = 'claude-sonnet-4-6';

// =============================================
// General AI Chat — ตอบแชททั่วไป (อ้างอิงคลังไวรัลจริง ไม่ด้นสด)
// =============================================

// ค้นหาคอนเทนต์ไวรัลที่ตรงกับข่าวที่ส่งมา
async function searchViralLibrary(content, supabase) {
  try {
    // ดึง viral examples ทั้งหมด (170 ชิ้น — cached in Supabase)
    const { data: allExamples } = await supabase
      .from('viral_examples')
      .select('id, title, content, category, tags, writing_notes, engagement_likes, engagement_shares')
      .order('engagement_likes', { ascending: false });

    if (!allExamples || allExamples.length === 0) return [];

    const normalizedInput = content.toLowerCase();
    
    // คำสำคัญจากข้อความที่ส่งมา
    const inputWords = normalizedInput
      .replace(/[^\u0E00-\u0E7Fa-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);

    // ให้คะแนนแต่ละคอนเทนต์
    const scored = allExamples.map(ex => {
      let score = 0;
      const tags = ex.tags || {};
      const exContent = (ex.content || '').toLowerCase();
      const exTitle = (ex.title || '').toLowerCase();
      const category = (tags.category || ex.category || '').toLowerCase();
      const subType = (tags.sub_type || '').toLowerCase();
      const emotionalTags = (tags.emotional_tags || []).map(t => t.toLowerCase());
      const conflictTags = (tags.conflict_tags || []).map(t => t.toLowerCase());
      const targetCats = (tags.target_categories || []).map(t => t.toLowerCase());

      // 1. Category keyword matching
      const categoryKeywords = {
        'เสียชีวิต': ['ข่าวเศร้า', 'ข่าวเสียดายชีวิต'],
        'จากไป': ['ข่าวเศร้า'],
        'ตาย': ['ข่าวเศร้า'],
        'ทำร้าย': ['ดราม่าครอบครัว', 'ข่าวอาชญากรรม'],
        'ตบ': ['ดราม่าครอบครัว'],
        'ตี': ['ดราม่าครอบครัว'],
        'สามี': ['ดราม่าครอบครัว'],
        'ภรรยา': ['ดราม่าครอบครัว'],
        'หย่า': ['ดราม่าครอบครัว'],
        'นอกใจ': ['ดราม่าครอบครัว'],
        'ดารา': ['ข่าวบันเทิง', 'คนดังตกต่ำ'],
        'นักร้อง': ['ข่าวบันเทิง'],
        'นักแสดง': ['ข่าวบันเทิง'],
        'การเมือง': ['ข่าวการเมือง'],
        'นายก': ['ข่าวการเมือง'],
        'สู้ชีวิต': ['สู้ชีวิต', 'พลิกชีวิต'],
        'ยากจน': ['สู้ชีวิต'],
        'ช่วย': ['ช่วยเหลือกัน'],
        'ช่วยเหลือ': ['ช่วยเหลือกัน'],
        'อุบัติเหตุ': ['ข่าวอุบัติเหตุ'],
        'ชน': ['ข่าวอุบัติเหตุ'],
        'เตือน': ['ข่าวเตือนใจ'],
        'สัตว์': ['ความรักสัตว์'],
        'หมา': ['ความรักสัตว์'],
        'แมว': ['ความรักสัตว์'],
      };

      for (const [keyword, matchCategories] of Object.entries(categoryKeywords)) {
        if (normalizedInput.includes(keyword)) {
          for (const mc of matchCategories) {
            if (category.includes(mc.toLowerCase()) || targetCats.some(t => t.includes(mc.toLowerCase()))) {
              score += 15; // Strong category match
            }
          }
        }
      }

      // 2. Direct word matching in content
      for (const word of inputWords) {
        if (exContent.includes(word)) score += 2;
        if (exTitle.includes(word)) score += 5;
        if (category.includes(word)) score += 8;
        if (subType.includes(word)) score += 8;
        if (emotionalTags.some(t => t.includes(word))) score += 4;
        if (conflictTags.some(t => t.includes(word))) score += 4;
      }

      // 3. Viral score bonus
      score += (tags.viral_score || 0) / 20;

      return { ...ex, matchScore: score };
    });

    // เรียงตามคะแนน เอา top 3
    return scored
      .filter(s => s.matchScore > 5)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3);
  } catch (err) {
    console.error('[searchViralLibrary] Error:', err.message);
    return [];
  }
}

async function handleGeneralChat(roomId, content, supabase) {
  // 1. ดึงข้อความล่าสุด 10 ข้อความ
  const { data: recentMsgs } = await supabase
    .from('chat_messages')
    .select('sender_type, content, message_type, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(10);

  const chatHistory = (recentMsgs || []).reverse().map(m => {
    const role = m.sender_type === 'ai' ? 'AI' : m.sender_type === 'manager' ? 'ผู้จัดการ' : 'พนักงาน';
    return `[${role}]: ${m.content?.substring(0, 300)}`;
  }).join('\n');

  // 2. ตรวจคำต้องห้าม
  const rulesCheck = await checkAllRules(content);
  
  // 3. ดึง custom rules
  const { data: customRules } = await supabase
    .from('review_rules')
    .select('content, rule_type')
    .eq('active', true)
    .limit(20);

  const rulesText = (customRules || []).map(r => `- [${r.rule_type}] ${r.content}`).join('\n');

  // 4. ★ ค้นหาคลังไวรัลที่ตรงกับเนื้อหา ★
  const viralMatches = await searchViralLibrary(content, supabase);
  
  let viralRefText = '';
  if (viralMatches.length > 0) {
    viralRefText = viralMatches.map((m) => {
      const tags = m.tags || {};
      const index = tags.index || '?';
      return `📌 คอนเทนต์ #${index} | ${tags.category || m.category}${tags.sub_type ? ` — ${tags.sub_type}` : ''} | Viral Score: ${tags.viral_score || 0}/100`;
    }).join('\n');
  }

  const systemPrompt = `คุณเป็น "AI คัดข่าว" ประจำห้องแชทของทีมคอนเทนต์ข่าวไวรัลบน Facebook

★★★ หน้าที่ของคุณ: คัดข่าว + เช็คความเสี่ยง เท่านั้น ★★★

ห้ามแนะนำวิธีเขียน ห้ามแนะนำ hook ห้ามแนะนำโครงสร้างเนื้อหา ห้ามเขียนตัวอย่างให้
(ทีมมีระบบ AI สร้างคอนเทนต์อยู่แล้ว ไม่ต้องสอนเขียน)

=== สิ่งที่ต้องทำเมื่อพนักงานส่งข่าวมา ===

1. ✅❌ ตัดสิน: ข่าวนี้ผ่านหรือไม่ผ่าน?
   - ผ่าน ✅ = เนื้อข่าวมีประเด็นชัด เนื้อหาเพียงพอ ไม่ผิดกฎ
   - ไม่ผ่าน ❌ = เนื้อหาน้อยเกินไป / งงจับใจความไม่ได้ / ผิดกฎ Meta ทั้งหมด

2. ⚠️ เช็คความเสี่ยงทุกจุด — list ออกมาให้หมด:
   คำ/เนื้อหาเสี่ยงที่ต้องตรวจ:
   - เหล้า เบียร์ แอลกอฮอล์ เครื่องดื่มแอลกอฮอล์ → ผิดกฎ Meta
   - บุหรี่ บุหรี่ไฟฟ้า พอต vape → ผิดกฎ Meta
   - ทำร้ายร่างกาย ตบตี ทุบตี ทำร้าย → ต้องเขียนทางอ้อม เน้นเห็นใจ
   - ข่มขืน ลวนลาม ล่วงละเมิดทางเพศ → ต้องเขียนอ้อมมาก ห้ามรายละเอียด
   - โป๊ เปลือย ล่อแหลม 18+ OnlyFans → ผิดกฎ Meta
   - ฆ่า ฆาตกรรม เชือด แทง ยิง → ห้ามรายละเอียดความรุนแรง
   - ยาเสพติด ยาบ้า ไอซ์ กัญชา → ผิดกฎ Meta
   - การพนัน สล็อต บาคาร่า → ผิดกฎ Meta
   - ฆ่าตัวตาย ผูกคอ กระโดดตึก → ผิดกฎ Meta อย่างร้ายแรง
   - เลือด ศพ อวัยวะ สยอง → ผิดกฎ Meta
   ถ้าพบ → ระบุทุกจุดว่าอยู่ตรงไหน + ระดับความเสี่ยง (สูง/กลาง/ต่ำ)

3. 📋 ประเด็นน่าสนใจ — list ประเด็นที่เจอในข่าว:
   - อ่านข่าวแล้วเห็นประเด็นอะไรบ้างที่เอาไปเล่าในคอนเทนต์ได้
   - ระบุเป็นข้อๆ สั้นๆ ชัดเจน
   - ถ้าเห็นประเด็นเยอะ = ข่าวดี น่าทำ
   - ถ้าเห็นประเด็นน้อย = ข่าวอาจไม่คุ้มทำ

4. 📌 จับคู่คลังไวรัล — บอกว่าข่าวนี้คล้ายคอนเทนต์ไหนในคลัง 170 ชิ้น
   (อ้างอิงเลข #XXX ถ้าพบ)

=== กรณีตีกลับ ❌ ===
ถ้าเนื้อหาที่ส่งมา:
- สั้นเกินไป (ไม่ถึง 2 ประโยค)
- งงมาก จับใจความไม่ได้
- ไม่มีประเด็นน่าสนใจเลย
- ผิดกฎ Meta ทุกจุด ไม่มีทางเลี่ยง
→ ตอบชัดเจนว่า ❌ ไม่ผ่าน + บอกเหตุผล + บอกให้ไปหาข่าวอื่น

=== รูปแบบการตอบ ===
✅ ผ่าน! / ❌ ไม่ผ่าน!

⚠️ ความเสี่ยง:
- [สูง/กลาง/ต่ำ] คำ/เนื้อหาเสี่ยงที่พบ → วิธีเลี่ยง

📋 ประเด็นน่าสนใจ:
1. ...
2. ...
3. ...

📌 คล้ายคอนเทนต์: #XXX [หมวด]

=== กฎเพิ่มเติมจากผู้จัดการ ===
${rulesText || '(ยังไม่มีกฎเพิ่มเติม)'}

=== สไตล์การตอบ ===
- ตอบเป็นภาษาไทย เป็นกันเอง ตรงไปตรงมา
- ห้ามแนะนำวิธีเขียน hook โครงสร้าง สไตล์เขียน
- เน้นเรื่องความเสี่ยง + ประเด็นเท่านั้น
- พูดแบบเพื่อนร่วมงาน ไม่ต้องทางการ`;

  // สร้าง user message
  let userMsg = '';
  
  if (chatHistory) {
    userMsg += `=== ประวัติแชทล่าสุด ===\n${chatHistory}\n=== จบประวัติ ===\n\n`;
  }
  
  if (rulesCheck.violations.length > 0) {
    userMsg += `⚠️ ระบบตรวจจับคำเสี่ยงอัตโนมัติพบ: ${rulesCheck.violations.map(v => `"${v.word}" [${v.severity}]`).join(', ')}\n\n`;
  }
  
  if (viralRefText) {
    userMsg += `=== คอนเทนต์ไวรัลที่คล้ายจากคลัง 170 ชิ้น ===\n${viralRefText}\n=== จบ ===\n\n`;
  }
  
  userMsg += `=== ข้อความจากพนักงาน ===\n${content}`;

  // ใช้ Claude → fallback GPT-4o
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      
      const response = await claude.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      });

      return response.content?.[0]?.text || 'ขออภัย ไม่สามารถตอบได้ในขณะนี้';
    } catch (claudeErr) {
      console.warn('[GeneralChat] Claude failed, falling back to GPT-4o:', claudeErr.message);
    }
  }

  // Fallback: GPT — ★ ใช้ callAI() ที่รองรับ GPT-5.5 แล้ว
  const result = await callAI({ prompt: userMsg, systemPrompt, temperature: 0.3, maxTokens: 2000 });

  return result?.reply || result?.text || (typeof result === 'string' ? result : 'ขออภัย ไม่สามารถตอบได้ในขณะนี้');
}

// =============================================
// POST — Trigger AI Review or Chat
// =============================================
export async function POST(request) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Database ไม่พร้อมใช้งาน', errorType: 'SUPABASE_NOT_READY' },
        { status: 503 }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', errorType: 'INVALID_JSON' },
        { status: 400 }
      );
    }

    const { roomId, type, data } = body;

    if (!roomId) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ roomId', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Verify room exists
    const { data: room, error: roomError } = await supabase
      .from('chat_rooms')
      .select('id, room_name, status')
      .eq('id', roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบห้องแชท', errorType: 'ROOM_NOT_FOUND' },
        { status: 404 }
      );
    }

    let reviewResult;
    let aiContent = '';
    let reviewData = null;

    // === General Chat (type = 'chat' or missing) ===
    if (!type || type === 'chat') {
      const content = data?.content || '';
      if (!content) {
        return NextResponse.json(
          { success: false, error: 'ต้องมีเนื้อหาข้อความ', errorType: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      const aiResponse = await handleGeneralChat(roomId, content, supabase);
      aiContent = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.text || aiResponse?.content || JSON.stringify(aiResponse));

    // === News Review ===
    } else if (type === 'news') {
      const content = data?.content || data?.body || '';
      reviewResult = await reviewNews({
        title: data?.title || content.substring(0, 100),
        body: content,
        url: data?.url,
        roomId,
      });

      if (!reviewResult.success) {
        return NextResponse.json({ success: false, error: reviewResult.error, errorType: 'REVIEW_FAILED' }, { status: 500 });
      }

      const review = reviewResult.review || {};
      const verdict = review.verdict || 'N/A';
      const score = review.viralScore || review.score || '-';
      const reasoning = review.reasoning || '';
      const guide = review.writingGuide || {};

      aiContent = `📰 **วิเคราะห์ข่าว**\n\n${verdict === 'GO' ? '✅' : verdict === 'CAUTION' ? '⚠️' : '❌'} Verdict: ${verdict}  |  Viral Score: ${score}/10\n\n💡 ${reasoning}\n\n${guide.hookSuggestion ? `🎣 Hook แนะนำ: "${guide.hookSuggestion}"` : ''}\n${guide.tone ? `🎨 โทน: ${guide.tone}` : ''}\n${guide.angle ? `📐 มุมเล่า: ${guide.angle}` : ''}\n${(guide.avoidTopics || []).length > 0 ? `⛔ หลีกเลี่ยง: ${guide.avoidTopics.join(', ')}` : ''}`;
      
      reviewData = review;

    // === Caption Review ===
    } else if (type === 'caption') {
      reviewResult = await reviewCaption({
        caption: data?.content || data?.caption || '',
        newsTitle: data?.newsTitle,
        newsBody: data?.newsBody,
        roomId,
      });

      if (!reviewResult.success) {
        return NextResponse.json({ success: false, error: reviewResult.error, errorType: 'REVIEW_FAILED' }, { status: 500 });
      }

      const review = reviewResult.review || {};
      const verdict = review.verdict || 'N/A';
      const score = review.score || '-';
      const issues = review.issues || [];

      aiContent = `✍️ **ตรวจ Caption**\n\n${verdict === 'PASS' ? '✅' : verdict === 'NEEDS_EDIT' ? '⚠️' : '❌'} Verdict: ${verdict}  |  Score: ${score}/10\n\n${issues.length > 0 ? '❗ ปัญหาที่พบ:\n' + issues.map(i => `• ${i.text || i.type}: ${i.fix || ''}`).join('\n') : '✅ ไม่พบปัญหา'}\n\n${review.improvedVersion ? `\n📝 **แนะนำเขียนแบบนี้:**\n${review.improvedVersion}` : ''}`;

      reviewData = review;

    // === Image Review ===
    } else if (type === 'image') {
      reviewResult = await reviewImage({
        imageBase64: data?.imageBase64 || data?.content,
        newsTitle: data?.newsTitle,
        roomId,
      });

      if (!reviewResult.success) {
        return NextResponse.json({ success: false, error: reviewResult.error, errorType: 'REVIEW_FAILED' }, { status: 500 });
      }

      const review = reviewResult.review || {};
      aiContent = `🖼️ **ตรวจภาพปก**\n\n${review.verdict === 'PASS' ? '✅' : review.verdict === 'NEEDS_EDIT' ? '⚠️' : '❌'} Verdict: ${review.verdict}  |  Score: ${review.score || '-'}/10\n\n${review.imageDescription || ''}\n\n${(review.issues || []).map(i => `• ${i.description}: ${i.suggestion || ''}`).join('\n')}`;

      reviewData = review;

    } else {
      return NextResponse.json(
        { success: false, error: 'type ไม่ถูกต้อง (ใช้ chat, news, caption, image)', errorType: 'INVALID_TYPE' },
        { status: 400 }
      );
    }

    // Save AI message to chat
    const msgInsert = {
      room_id: roomId,
      sender_id: null,
      sender_type: 'ai',
      content: aiContent,
      message_type: reviewData ? 'ai_review' : 'text',
      review_result: reviewData || null,
    };

    const { error: saveError } = await supabase.from('chat_messages').insert(msgInsert);
    if (saveError) {
      console.error('[review API] Failed to save AI message:', saveError.message);
    }

    return NextResponse.json({
      success: true,
      type: type || 'chat',
      aiMessage: aiContent,
      review: reviewData,
    });

  } catch (err) {
    console.error('[review API] Unhandled error:', err.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาด: ' + err.message, errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * Rules API Route — /api/chat/rules
 * 
 * GET: List all rules (built-in + custom)
 * POST: Add custom rule (manager only)
 * PUT: Update custom rule (manager only)
 * DELETE: Delete custom rule (manager only)
 */
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  checkBannedWords,
  getCustomRules,
  addRule,
  updateRule,
  deleteRule,
} from '@/lib/services/chat/contentRules';

// =============================================
// Helper — ตรวจสิทธิ์ manager
// =============================================

async function verifyManager(request) {
  try {
    const supabase = getSupabase();
    if (!supabase) return { authorized: false, error: 'Database ไม่พร้อมใช้งาน', errorType: 'SUPABASE_NOT_READY' };

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return { authorized: false, error: 'ต้องล็อกอินก่อน', errorType: 'UNAUTHORIZED' };
    }

    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return { authorized: false, error: 'Token ไม่ถูกต้องหรือหมดอายุ', errorType: 'INVALID_TOKEN' };
    }

    const userId = userData.user.id;

    // Check if user is manager (check user profile/role)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    const role = profile?.role || 'member';
    if (!['manager', 'admin', 'owner'].includes(role)) {
      return { authorized: false, error: 'ต้องเป็น manager ขึ้นไปเท่านั้น', errorType: 'FORBIDDEN' };
    }

    return { authorized: true, userId, role };
  } catch (err) {
    console.error('[rules API] verifyManager error:', err.message);
    return { authorized: false, error: 'เกิดข้อผิดพลาดในการตรวจสิทธิ์', errorType: 'AUTH_ERROR' };
  }
}

// =============================================
// GET — List all rules
// =============================================

export async function GET() {
  try {
    // Built-in rules (always available)
    const builtInRules = [
      {
        id: 'built-in-critical',
        source: 'built-in',
        ruleType: 'banned_word',
        severity: 'CRITICAL',
        action: 'block',
        description: 'คำหยาบคาย/คำด่าร้ายแรง — บล็อกทันที',
        editable: false,
      },
      {
        id: 'built-in-high',
        source: 'built-in',
        ruleType: 'banned_word',
        severity: 'HIGH',
        action: 'flag',
        description: 'คำอ่อนไหว — ต้อง flag ให้ reviewer ตรวจสอบ',
        editable: false,
      },
      {
        id: 'built-in-style',
        source: 'built-in',
        ruleType: 'banned_word',
        severity: 'STYLE',
        action: 'warn',
        description: 'คำเปลือง/สำนวนราชการ — แนะนำให้ตัดออก',
        editable: false,
      },
    ];

    // Custom rules from Supabase
    const customRules = await getCustomRules();
    const formattedCustom = customRules.map(rule => ({
      id: rule.id,
      source: 'custom',
      ruleType: rule.rule_type,
      severity: rule.severity,
      action: rule.action,
      content: rule.content,
      keywords: rule.keywords,
      createdBy: rule.created_by,
      createdAt: rule.created_at,
      editable: true,
    }));

    return NextResponse.json({
      success: true,
      rules: {
        builtIn: builtInRules,
        custom: formattedCustom,
        total: builtInRules.length + formattedCustom.length,
      },
    });
  } catch (err) {
    console.error('[rules API] GET error:', err.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดในการดึงกฎ', errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================
// POST — Add custom rule (manager only)
// =============================================

export async function POST(request) {
  try {
    // Verify manager
    const auth = await verifyManager(request);
    if (!auth.authorized) {
      const status = auth.errorType === 'UNAUTHORIZED' ? 401
        : auth.errorType === 'FORBIDDEN' ? 403
        : auth.errorType === 'SUPABASE_NOT_READY' ? 503
        : 400;
      return NextResponse.json(
        { success: false, error: auth.error, errorType: auth.errorType },
        { status }
      );
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', errorType: 'INVALID_JSON' },
        { status: 400 }
      );
    }

    const { ruleType, content, keywords, action, severity } = body;

    if (!ruleType || !content) {
      return NextResponse.json(
        { success: false, error: 'ruleType และ content จำเป็นต้องกรอก', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const result = await addRule({
      ruleType,
      content,
      keywords: keywords || [],
      action: action || 'flag',
      severity: severity || 'MEDIUM',
      createdBy: auth.userId,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, errorType: result.errorType },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      rule: result.data,
    }, { status: 201 });
  } catch (err) {
    console.error('[rules API] POST error:', err.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดในการเพิ่มกฎ', errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================
// PUT — Update custom rule (manager only)
// =============================================

export async function PUT(request) {
  try {
    // Verify manager
    const auth = await verifyManager(request);
    if (!auth.authorized) {
      const status = auth.errorType === 'UNAUTHORIZED' ? 401
        : auth.errorType === 'FORBIDDEN' ? 403
        : auth.errorType === 'SUPABASE_NOT_READY' ? 503
        : 400;
      return NextResponse.json(
        { success: false, error: auth.error, errorType: auth.errorType },
        { status }
      );
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', errorType: 'INVALID_JSON' },
        { status: 400 }
      );
    }

    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ rule ID', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Map camelCase to snake_case for DB
    const dbUpdates = {};
    if (updates.ruleType !== undefined) dbUpdates.rule_type = updates.ruleType;
    if (updates.content !== undefined) dbUpdates.content = updates.content;
    if (updates.keywords !== undefined) dbUpdates.keywords = updates.keywords;
    if (updates.action !== undefined) dbUpdates.action = updates.action;
    if (updates.severity !== undefined) dbUpdates.severity = updates.severity;
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;

    const result = await updateRule(id, dbUpdates);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, errorType: result.errorType },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      rule: result.data,
    });
  } catch (err) {
    console.error('[rules API] PUT error:', err.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดในการอัปเดตกฎ', errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================
// DELETE — Delete custom rule (manager only)
// =============================================

export async function DELETE(request) {
  try {
    // Verify manager
    const auth = await verifyManager(request);
    if (!auth.authorized) {
      const status = auth.errorType === 'UNAUTHORIZED' ? 401
        : auth.errorType === 'FORBIDDEN' ? 403
        : auth.errorType === 'SUPABASE_NOT_READY' ? 503
        : 400;
      return NextResponse.json(
        { success: false, error: auth.error, errorType: auth.errorType },
        { status }
      );
    }

    // Get id from search params
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ rule ID ใน query parameter ?id=xxx', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const result = await deleteRule(id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, errorType: result.errorType },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      deleted: id,
    });
  } catch (err) {
    console.error('[rules API] DELETE error:', err.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดในการลบกฎ', errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

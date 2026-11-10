/**
 * News Studio — ตัวตนของผู้เรียก API (10 พ.ย. 69)
 * ทุก route ใต้ /api/news-studio ต้องล็อกอิน: อ่านคลัง/ประวัติ = ทุกบทบาท · สั่งเขียน/รีวิว = admin, editor
 * (สั่งเขียน 1 งาน = เรียกโมเดลราว 10–20 ครั้ง จึงไม่เปิดให้คนนอกหรือบทบาทดูอย่างเดียว)
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSession, hasPermission } from '@/lib/auth';

export async function studioSession() {
  try {
    const c = await cookies();
    const token = c.get('auth_token')?.value;
    return token ? await getSession(token) : null;
  } catch {
    return null;
  }
}

export const canWrite = (session) => !!session && hasPermission(session.role, 'create');

export const errorJson = (error, errorType, status) => NextResponse.json({ success: false, error, errorType }, { status });
export const unauthorized = () => errorJson('ต้องล็อกอินก่อนใช้ระบบเขียนข่าว', 'UNAUTHORIZED', 401);
export const forbidden = () => errorJson('บัญชีนี้ดูได้อย่างเดียว — สั่งเขียนหรือรีวิวต้องเป็นบทบาท admin หรือ editor', 'FORBIDDEN', 403);

/** แปลง error ของชั้นบริการเป็นคำตอบ (คงเหตุและรหัสไว้ ไม่กลบเป็นข้อความกลางๆ) */
export function serviceError(e, fallbackType) {
  const status = Number.isInteger(e?.status) && e.status >= 400 && e.status < 600 ? e.status : 500;
  return errorJson(String(e?.message || e).slice(0, 400), e?.errorType || fallbackType, status);
}

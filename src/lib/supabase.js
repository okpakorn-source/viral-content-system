/**
 * Supabase Client — ฐานข้อมูลถาวร
 * 
 * ใช้ Supabase (PostgreSQL) เก็บข้อมูลถาวรบน cloud
 * ไม่หายเมื่อ deploy, ไม่มี race condition, รองรับหลาย instance
 */
import { createClient } from '@supabase/supabase-js';

let _supabase = null;

export function getSupabase() {
  if (_supabase) return _supabase;
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    console.warn('[Supabase] ⚠️ SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
    return null;
  }
  
  _supabase = createClient(url, key);
  console.log('[Supabase] ✅ Connected');
  return _supabase;
}

export function isSupabaseReady() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!(url && key);
}

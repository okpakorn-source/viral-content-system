import { NextResponse } from 'next/server';

/**
 * ★ 22 มิ.ย. 69: ปิดระบบ "เรดาร์หากระแส" (เลิกใช้แล้ว — ใช้ "โต๊ะข่าวกลาง" แทน)
 * เหตุผล: ระบบเก่าที่ไม่ได้ใช้ แต่เปิดหน้าทีไรยิง API หลายแหล่ง (Serper/Tavily/RSS) + AI ขยายคีย์ = กินโทเคน/เครดิตฟรีๆ
 * กลไก: kill-switch ที่ API ทุกตัวของเรดาร์ → คืน disabled ทันที ไม่แตะแหล่งข้อมูล/AI เลย = ไม่กินโทเคน
 *
 * 🔴 ขอบเขต: เฉพาะระบบเรดาร์ (src/lib/services/radar/* + src/app/api/radar/*) เท่านั้น
 *    ไม่เกี่ยวกับ "เรดาร์เทรนด์" ในโต๊ะข่าวกลาง (goodNewsScout: generateTrendRadarQueries / FIELD_RADAR ฯลฯ)
 *    ซึ่งเป็นแค่ชื่อฟังก์ชันคนละระบบ — โต๊ะข่าวกลางทำงานปกติ ไม่กระทบ
 *
 * เปิดคืน: ตั้ง env  RADAR_ENABLED=1  (ไม่ต้องแก้โค้ด)
 */
export const RADAR_ENABLED = process.env.RADAR_ENABLED === '1';

export function radarDisabledResponse() {
  return NextResponse.json({
    success: false,
    disabled: true,
    error: 'ระบบ "เรดาร์หากระแส" ปิดใช้งานแล้ว — ใช้ "โต๊ะข่าวกลาง" แทน',
    errorType: 'RADAR_DISABLED',
  }, { status: 200 });
}

/**
 * News Studio — สวิตช์ของท่อ Discord และแผนโมเดลหลัก (อัปเกรด 16 พ.ย. 69: Plan B Gemini 4 Carbon + Argon + Hydrogen)
 * ฟังก์ชันล้วน ไม่มี import (ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และในเทส)
 *   NEWS_STUDIO_DISCORD=0            ถอยงานจากบอทกลับไปใช้นักเขียนชุดเดิม (ค่าตั้งต้น = เปิดใช้ News Studio)
 *   NEWS_STUDIO_PLAN=plan_b          แผนโมเดลใน News Studio (ค่าตั้งต้น = 'plan_b' [Gemini 4 Carbon+Argon+Hydrogen] · ตั้ง 'v1' เพื่อย้อนกลับท่อเดิม)
 *   NEWS_STUDIO_DISCORD_RESEARCH=1   เปิดค้นข้อมูลเสริมจากเว็บในท่อ Discord (ค่าตั้งต้น = ปิด)
 */
const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();

/** เปิดอยู่เป็นค่าตั้งต้น · ปิดด้วย NEWS_STUDIO_DISCORD=0 (0/off/false/no/legacy) */
export function isStudioDiscordEnabled(env = process.env) {
  return !['0', 'off', 'false', 'no', 'legacy'].includes(clean(env.NEWS_STUDIO_DISCORD));
}

/**
 * แผนโมเดลที่ทำงานอยู่ในท่อหลักของ News Studio (ทั้งหน้าเว็บและท่อ Discord):
 *   - ค่าตั้งต้น = 'plan_b' (Gemini 4 Hydrogen + Carbon + Argon + GPT-5.6-Sol Critic)
 *   - ถอยกลับไปใช้ท่อ v1 เดิมโดยไม่แก้โค้ด: ตั้ง env NEWS_STUDIO_PLAN=v1 (หรือ legacy / old / 0)
 */
export function studioActivePlan(env = process.env) {
  const v = clean(env.NEWS_STUDIO_PLAN);
  if (['v1', 'legacy', 'old', '0', 'off'].includes(v)) return 'v1';
  if (['plan_a', 'plana', 'a'].includes(v)) return 'plan_a';
  if (['plan_c', 'planc', 'c', 'hybrid'].includes(v)) return 'plan_c';
  return 'plan_b';
}

/** เปิดใช้ Plan B (Gemini 4 Carbon + Argon + Hydrogen) เป็นค่าตั้งต้นในท่อหลัก */
export function isPlanBEnabled(env = process.env) {
  return studioActivePlan(env) === 'plan_b';
}

/** ค้นข้อมูลเสริมจากเว็บในท่อ Discord — ปิดเป็นค่าตั้งต้น · เปิดด้วย NEWS_STUDIO_DISCORD_RESEARCH=1 */
export function isStudioDiscordResearchOn(env = process.env) {
  return ['1', 'on', 'true', 'yes'].includes(clean(env.NEWS_STUDIO_DISCORD_RESEARCH));
}

/** งานนี้มาจากบอท Discord ไหม (บอทส่ง userId 'discord-<id>' และ _botInstance มากับทุกงาน) */
export function isDiscordJob(body) {
  return String(body?.userId ?? '').startsWith('discord-') || !!body?._botInstance;
}

/** ใช้ระบบเขียนตัวใหม่กับงานนี้ไหม: เฉพาะงานจากบอท และสวิตช์ไม่ได้ถูกปิด */
export function shouldUseStudioForJob(body, env = process.env) {
  return isStudioDiscordEnabled(env) && isDiscordJob(body);
}

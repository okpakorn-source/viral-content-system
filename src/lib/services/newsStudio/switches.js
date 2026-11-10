/**
 * News Studio — สวิตช์ของท่อ Discord (10 พ.ย. 69) · ฟังก์ชันล้วน ไม่มี import (ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และในเทส)
 *   NEWS_STUDIO_DISCORD=0            ถอยงานจากบอทกลับไปใช้นักเขียนชุดเดิม (ค่าตั้งต้น = ใช้ระบบเขียนตัวใหม่)
 *   NEWS_STUDIO_DISCORD_RESEARCH=1   เปิดค้นข้อมูลเสริมจากเว็บในท่อ Discord (ค่าตั้งต้น = ปิด)
 */
const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();

/** เปิดอยู่เป็นค่าตั้งต้น · ปิดด้วย NEWS_STUDIO_DISCORD=0 (0/off/false/no/legacy) */
export function isStudioDiscordEnabled(env = process.env) {
  return !['0', 'off', 'false', 'no', 'legacy'].includes(clean(env.NEWS_STUDIO_DISCORD));
}

/** ค้นข้อมูลเสริมจากเว็บในท่อ Discord — ปิดเป็นค่าตั้งต้น (ยังไม่ผ่านการทดสอบกับข่าวจริง) · เปิดด้วย NEWS_STUDIO_DISCORD_RESEARCH=1 */
export function isStudioDiscordResearchOn(env = process.env) {
  return ['1', 'on', 'true', 'yes'].includes(clean(env.NEWS_STUDIO_DISCORD_RESEARCH));
}

/** งานนี้มาจากบอท Discord ไหม (บอทส่ง userId 'discord-<id>' และ _botInstance มากับทุกงาน) */
export function isDiscordJob(body) {
  return String(body?.userId ?? '').startsWith('discord-') || !!body?._botInstance;
}

/** ใช้ระบบเขียนตัวใหม่กับงานนี้ไหม: เฉพาะงานจากบอท และสวิตช์ไม่ได้ถูกปิด (งานจากหน้าเว็บ/แอปมือถือยังใช้ท่อเดิม — หน้าพวกนั้นอ่านผลของขั้นแตกประเด็นที่ระบบใหม่ไม่มี) */
export function shouldUseStudioForJob(body, env = process.env) {
  return isStudioDiscordEnabled(env) && isDiscordJob(body);
}

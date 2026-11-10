/**
 * =====================================================
 * News Studio — ทางเข้าของท่อ Discord (10 พ.ย. 69)
 * =====================================================
 * เจ้าของเคาะ 10 พ.ย. 69: ข่าวที่พนักงานส่งทาง Discord ให้เขียนด้วยระบบเขียนตัวใหม่ แทนนักเขียนชุดเดิม (ไม่มีโหมดเทียบสองระบบ)
 *
 * ใช้ที่เดียว: src/app/api/auto/process/route.js (กิ่งข้อความล้วนของงานจากบอท)
 * ไฟล์นี้แค่ต่อของจริงเข้ากับแกนใน discordCore.js (ตรรกะและสัญญาอยู่ที่นั่น — มีเทสพฤติกรรมครอบ)
 *
 * ทางถอย (ไม่ต้องแก้โค้ด): ตั้ง env NEWS_STUDIO_DISCORD=0 แล้ว redeploy → งานจากบอทกลับไปใช้นักเขียนชุดเดิมทุกไบต์
 * ระบบใหม่ล้มกลางงาน: route ส่งงานนั้นต่อให้นักเขียนชุดเดิมพร้อมคำเตือนถึงพนักงาน (ดู fallbackWarning)
 */
import { logGeneration } from '@/lib/services/era/generationLogger';
import { logPipeline } from '@/lib/pipelineLogger';
import { runStudioJob, attachCaseId } from './server';
import { isStudioDiscordResearchOn } from './switches';
import { runDiscordStudioJob } from './discordCore';

export { isStudioDiscordEnabled, isStudioDiscordResearchOn, isDiscordJob, shouldUseStudioForJob } from './switches';
export { fallbackWarning } from './discordCore';

/**
 * เขียนข่าว 1 งานจากท่อ Discord ด้วยระบบเขียนตัวใหม่
 * @param {{text:string, user?:{userId?:string,userName?:string}, workflowId?:string, deskMeta?:object|null}} p
 * @returns {Promise<{success:true, data:object}>}  ล้ม = โยน Error ที่มี failedStep + errorType
 */
export async function processNewsStudioText(p) {
  return runDiscordStudioJob(p, { runStudioJob, logGeneration, attachCaseId, logPipeline, useResearch: isStudioDiscordResearchOn() });
}

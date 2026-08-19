/**
 * CARD_AUTHORITY — จุดอ่านสวิตช์อำนาจการ์ดกลางเพียงจุดเดียวของระบบ
 *
 * เปิดทั้งหมด: CARD_AUTHORITY=1
 * เปิดรายข้อ: CARD_AUTH_R2=1 ... CARD_AUTH_RXC=1
 * สาย URL: R2/R3 ต้องเปิด CARD_AUTH_URL=1 เพิ่ม และเรียกด้วย { url: true }
 * ถอด/ย้อนกลับ: ลบ env เหล่านี้ หรือกำหนดเป็นค่าอื่นที่ไม่ใช่ "1" ทุกตัวจะปิด
 *
 * ⚠️ ห้ามอ่าน process.env ชุด CARD_AUTHORITY / CARD_AUTH_* / CARD_AUTH_URL
 *    จากไฟล์อื่น ให้ import ฟังก์ชันจากไฟล์นี้เท่านั้น เพื่อไม่ให้แต่ละท่อตีความสวิตช์ต่างกัน
 *
 * ตัวอย่าง:
 * import { isCardAuthorityR3Enabled, isCardAuthorityR4Enabled, getCardAuthorityStatus } from '@/lib/ai/cardAuthority';
 * const r3UrlRule = isCardAuthorityR3Enabled({ url: true }) ? '' : ORIGINAL_R3_RULE;
 * const r4Rule = isCardAuthorityR4Enabled() ? '' : ORIGINAL_R4_RULE;
 * console.info('[cardAuthority]', getCardAuthorityStatus());
 */

const ENV = Object.freeze({
  master: 'CARD_AUTHORITY',
  url: 'CARD_AUTH_URL',
  rules: Object.freeze({
    R2: 'CARD_AUTH_R2',
    R3: 'CARD_AUTH_R3',
    R4: 'CARD_AUTH_R4',
    R5A: 'CARD_AUTH_R5A',
    R5B: 'CARD_AUTH_R5B',
    R6: 'CARD_AUTH_R6',
    R7: 'CARD_AUTH_R7',
    R8: 'CARD_AUTH_R8',
    RXC: 'CARD_AUTH_RXC',
  }),
});

const RULE_CODES = Object.freeze(Object.keys(ENV.rules));

/** อ่านค่าปัจจุบันทุกครั้ง และยอมรับเฉพาะสตริง "1" เท่านั้น */
function isSwitchEnabled(envName) {
  return process.env[envName] === '1';
}

/** แม่เปิดทุกข้อ หรือลูกเปิดเฉพาะข้อนั้น */
function isRuleEnabled(ruleCode) {
  return isSwitchEnabled(ENV.master) || isSwitchEnabled(ENV.rules[ruleCode]);
}

/** R2/R3 ในสาย URL ต้องผ่านประตู URL เพิ่มอีกชั้น */
function isRuleEnabledForContext(ruleCode, { url = false } = {}) {
  return isRuleEnabled(ruleCode) && (!url || isSwitchEnabled(ENV.url));
}

/** R2: ปลดกฎบังคับลำดับ timeline */
export function isCardAuthorityR2Enabled(options) {
  return isRuleEnabledForContext('R2', options);
}

/** R3: ปลดกฎบังคับลำดับ facts / moment-conflict */
export function isCardAuthorityR3Enabled(options) {
  return isRuleEnabledForContext('R3', options);
}

/** R4: ปลดคำสั่งเปิดย่อหน้าแรกด้วย hook ที่กำหนด */
export function isCardAuthorityR4Enabled() {
  return isRuleEnabled('R4');
}

/** R5A: ปลดหัวประกาศอำนาจและเป้าอารมณ์ positive reframing */
export function isCardAuthorityR5AEnabled() {
  return isRuleEnabled('R5A');
}

/** R5B: ปลดข้อบังคับเปลี่ยนมุมข่าวเสียชีวิต */
export function isCardAuthorityR5BEnabled() {
  return isRuleEnabled('R5B');
}

/** R6: ปลดกฎห้ามเปิดด้วยวันที่ */
export function isCardAuthorityR6Enabled() {
  return isRuleEnabled('R6');
}

/** R7: ปลด VIRAL STYLE PACK ข้อบังคับเลือก hook */
export function isCardAuthorityR7Enabled() {
  return isRuleEnabled('R7');
}

/** R8: ปลด VIRAL STYLE PACK ข้อบังคับจบด้วยสัจธรรม */
export function isCardAuthorityR8Enabled() {
  return isRuleEnabled('R8');
}

/** RXC: ปลดเฉพาะท่อนที่บังคับทุกองค์ประกอบให้รับใช้มุมเดียว */
export function isCardAuthorityRXCEnabled() {
  return isRuleEnabled('RXC');
}

/**
 * สรุปสถานะสำหรับ log โดยแยกสวิตช์ที่เปิดกับผลจริงในสาย URL
 * @returns {{
 *   masterEnabled: boolean,
 *   urlGateEnabled: boolean,
 *   enabledRules: string[],
 *   enabledUrlRules: string[],
 * }}
 */
export function getCardAuthorityStatus() {
  const enabledRules = RULE_CODES.filter((ruleCode) => isRuleEnabled(ruleCode));
  const enabledUrlRules = [
    isCardAuthorityR2Enabled({ url: true }) && 'R2',
    isCardAuthorityR3Enabled({ url: true }) && 'R3',
  ].filter(Boolean);

  return {
    masterEnabled: isSwitchEnabled(ENV.master),
    urlGateEnabled: isSwitchEnabled(ENV.url),
    enabledRules,
    enabledUrlRules,
  };
}

// ============================================================
// [ระบบทำปกออโต้] บัญชี "แหล่งแคตตาล็อก/โฆษณา/อสังหา/รับสร้างบ้าน"
// ------------------------------------------------------------
// โดเมน/ชื่อแหล่งที่ให้แต่ "ภาพวัตถุมั่ว" (บ้าน/โครงการ/แบบบ้าน ของใครก็ไม่รู้)
// แทบไม่มีทางเป็นภาพ "บุคคล/ทรัพย์สินจริง" ในข่าว → บล็อกตั้งแต่ตอนค้น กันเข้าคลัง
// ใช้ร่วม: search route (กันเข้า) + clean route (ล้างที่มีอยู่แบบ deterministic ฟรี)
// ============================================================

// จับทั้ง "ชื่อแหล่ง" (source name) และ "โดเมนในลิงก์" (sourceLink) — เทียบแบบ lowercase/substring
export const CATALOG_PATTERNS = [
  // ── ดีเวลอปเปอร์/โครงการบ้าน-คอนโด ──
  'sansiri', 'แสนสิริ', 'pruksa', 'พฤกษา', 'supalai', 'ศุภาลัย', 'ananda', 'อนันดา',
  'ap thai', 'apthai', 'ap (thailand)', 'lalin', 'ลลิล', 'land and houses', 'แลนด์ แอนด์ เฮ้าส์',
  'quality houses', 'ควอลิตี้เฮ้าส์', 'sc asset', 'เอสซี แอสเสท',
  // ── พอร์ทัลประกาศขาย/รวมแบบบ้าน ──
  'dotproperty', 'dot property', 'ddproperty', 'ดีดีพร็อพเพอร์ตี้', 'livinginsider',
  'thinkofliving', 'baania', 'บาเนีย', 'home.co.th', 'yusabuy', 'ยูสะบายดี', 'propertyhub',
  'naibann', 'ในบ้าน', 'checkraka', 'เช็คราคา', 'homethaidd', 'homenayoo',
  'ศูนย์รวมแบบบ้าน', 'รับสร้างบ้าน', 'แบบบ้าน', 'แปลนบ้าน', 'ไอเดียบ้าน', 'แบบก่อสร้าง',
  'estate', 'เอสเตท', 'baan finder', 'baanfinder', 'lnwshop', 'ขายบ้าน', 'ขายที่ดิน',
  'ประกาศขาย', 'บ้านมือสอง', 'บ้านจัดสรร', 'หมู่บ้าน', 'realtor', 'พร็อพเพอร์ตี้', 'property',
  // ── วัสดุก่อสร้าง/โฮมสโตร์ (ภาพโฆษณาบ้านตัวอย่าง) ──
  'shera', 'เฌอร่า', 'scg', 'เอสซีจี', 'cotto', 'ไทวัสดุ', 'thaiwatsadu', 'globalhouse',
  'โกลบอลเฮ้าส์', 'boonthavorn', 'บุญถาวร', 'megahome', 'เมกาโฮม', 'dohome', 'ดูโฮม',
  // ── ท่องเที่ยว/โรงแรม/รีสอร์ต (ไม่ใช่บ้านคนในข่าว) ──
  'trip.com', 'agoda', 'booking.com', 'airbnb', 'traveloka',
];

// "หมวดบ้าน" ของพอร์ทัล (เช่น "บ้าน - Kapook") = แคตตาล็อกแน่นอน → บล็อก
// ⚠️ ไม่บล็อก source "บ้าน" เดี่ยวๆ — Google ใช้ label นี้กับ "บ้านจริงของคนในข่าว" ได้
//    ปล่อยให้ Gemini (ตา+บริบท) ตัดสิน กันลบบ้านจริงทิ้ง
function isHouseSectionName(src) {
  const low = (src || '').trim().toLowerCase();
  return low.startsWith('บ้าน -') || low.startsWith('บ้าน-');
}

// true = เป็นแหล่งแคตตาล็อก/โฆษณา/อสังหา → ควรบล็อก (ภาพวัตถุมั่ว ไม่ใช่ของคนในข่าว)
export function isCatalogSource(im) {
  if (!im) return false;
  if (isHouseSectionName(im.source)) return true;
  const hay = `${im.source || ''} ${im.sourceLink || ''}`.toLowerCase();
  return CATALOG_PATTERNS.some((p) => hay.includes(p));
}

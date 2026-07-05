// ============================================================
// [ระบบทำปกออโต้] ฝากรูปขึ้นโฮสต์สาธารณะชั่วคราว
// ------------------------------------------------------------
// ใช้ตอน "ค้นย้อนกลับจากรูปที่อัปโหลด/local" — Google Lens ต้องการ
// URL สาธารณะ แต่รูป local (localhost) SerpApi เข้าไม่ถึง
// → อัปขึ้นโฮสต์ฟรีชั่วคราว (tmpfiles.org หลัก, catbox สำรอง)
// ============================================================

async function viaTmpfiles(buffer, filename) {
  try {
    const fd = new FormData();
    fd.append('file', new Blob([buffer]), filename);
    const r = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: fd });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const url = j?.data?.url;
    if (!url) return null;
    // แปลงเป็นลิงก์ดาวน์โหลดตรง (Lens ต้องการไฟล์รูปจริง ไม่ใช่หน้าดู)
    return url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
  } catch {
    return null;
  }
}

async function viaCatbox(buffer, filename) {
  try {
    const fd = new FormData();
    fd.append('reqtype', 'fileupload');
    fd.append('fileToUpload', new Blob([buffer]), filename);
    const r = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: fd });
    if (!r.ok) return null;
    const url = (await r.text()).trim();
    return /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

export async function hostImagePublic(buffer, filename = 'seed.jpg') {
  return (await viaTmpfiles(buffer, filename)) || (await viaCatbox(buffer, filename));
}

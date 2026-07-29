// 🧪 img-airlock-bootcrash-worker.mjs — worker ปลอมที่ "ตายตั้งแต่บูต ก่อนรับใบแรก"
// (Opus audit 30 ก.ค. เคสขอบ: child ตายก่อนเริ่มใบแรก — parent ต้องรอด ไม่แขวน ไม่ throw
//  และเมื่อ respawn แล้วตายซ้ำจนชนเพดาน MAX_SPAWNS ทุกใบต้องได้ผลลัพธ์ safe-default ครบ)
process.exit(1);

import fs from 'fs';

const res = await fetch('http://localhost:3000/api/auto-cover', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://www.matichon.co.th/entertainment/news_4972498',
    newsTitle: 'ชมพู่ อารยา พาลูกๆ เรียนรู้ธรรมชาติกับยายหนิง ปลูกผักสวนครัว',
    content: 'ชมพู่ อารยา เอ ฮาร์เก็ต พาลูกๆ สายฟ้า-พายุ ไปเยี่ยมคุณยายหนิง ปลูกผักสวนครัว เรียนรู้ธรรมชาติ ทำกิจกรรมในสวน ภาพน่ารักอบอุ่น ครอบครัวสุขสันต์',
    mode: 'auto'
  }),
  signal: AbortSignal.timeout(180000)
});

const d = await res.json();

// Show key fields
const out = {
  success: d.success,
  error: d.error || null,
  errorType: d.errorType || null,
  score: d.score,
  storyMatchScore: d.storyMatchScore,
  storyMatchReason: d.storyMatchReason,
  identity: d.identity ? {
    storyType: d.identity.storyType,
    mainVisualShouldBe: d.identity.mainVisualShouldBe,
    normalizedStoryType: d.identity.normalizedStoryType,
  } : null,
  template: d.template,
  coverImageLength: d.coverImage?.length || 0,
  compositionQA: d.compositionQA || null,
  visualWeightReport: d.visualWeightReport || null,
  perSlotCropMode: d.perSlotCropMode || null,
  cropQuality: d.cropQuality || null,
  repairPassApplied: d.repairPassApplied ?? null,
  circleSlotReason: d.circleSlotReason || null,
  slotSwapReason: d.slotSwapReason || null,
};

console.log(JSON.stringify(out, null, 2));

if (d.coverImage) {
  const b64 = d.coverImage.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync('C:/Users/User/.gemini/antigravity/brain/443dcfba-2880-4027-bd97-5cef1291ce02/CASE-002-fix29-32.jpg', buf);
  console.log('Cover saved to CASE-002-fix29-32.jpg');
}

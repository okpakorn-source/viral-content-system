import { runMultiAgentImageSearch } from '@/lib/services/multiAgentImageScraper';
import { composeCover } from '@/lib/coverComposer';
import { downloadAndValidateImage } from '@/lib/services/imageSearchService';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const newsTitle = "โชคชัย 4 อึ้ง! แม่ค้าลูกชิ้นทอด ยืนขายกลางสายฝน ไม่ย่อท้อแม้ขาดทุน ทวงคืนวันวานสุดสู้ชีวิต";
  
  // Updated to match new storyIdentityService schema
  const identities = [
    {
      mainCharacter: "แม่ค้าลูกชิ้นทอด",
      story: "แม่ค้ายืนสู้ชีวิตกลางฝน",
      searchGoogle: "โชคชัย 4 แม่ค้าลูกชิ้นทอด ยืนขายกลางสายฝน",
      searchYouTube: "แม่ค้าลูกชิ้น โชคชัย4 สายฝน",
      searchTikTok: "แม่ค้าลูกชิ้น โชคชัย4",
      coverEmotion: "tragedy",
      emotion: "sad",
      keyScenes: ["ยืนขายกลางฝน", "เปียกฝน"],
      typography: { hook: "สู้ชีวิต!", main: "ยืนขายกลางสายฝน", punch: "ไม่ย่อท้อแม้ขาดทุน" }
    },
    {
      mainCharacter: "แม่ค้าลูกชิ้นทอด",
      story: "ดราม่าแม่ค้าลูกชิ้นโชคชัย 4",
      searchGoogle: "แม่ค้าลูกชิ้นทอด โชคชัย 4",
      searchYouTube: "ดราม่า แม่ค้าลูกชิ้น โชคชัย4",
      searchTikTok: "แม่ค้าลูกชิ้น โชคชัย4 ดราม่า",
      coverEmotion: "drama",
      emotion: "angry",
      keyScenes: ["ขายของ", "ยืนตากฝน"],
      typography: { hook: "ดราม่า", main: "ยอดขายตกหนัก", punch: "แม่ค้าโชคชัย 4" }
    },
    {
      mainCharacter: "แม่ค้าเปียกฝน",
      story: "สุดรันทด แม่ค้ายืนขายกลางฝน",
      searchGoogle: "ยืนกลางสายฝน แม่ค้า",
      searchYouTube: "แม่ค้า ยืนตากฝน ขายของ",
      searchTikTok: "แม่ค้า สายฝน ไวรัล",
      coverEmotion: "tragedy",
      emotion: "sad",
      keyScenes: ["ร้องไห้", "เปียกฝน"],
      typography: { hook: "น้ำตาซึม", main: "สู้ฝน ทวงคืนวันวาน", punch: "คลิปไวรัล" }
    },
    {
      mainCharacter: "แม่ค้าลูกชิ้น",
      story: "โซเชียลแห่แชร์ แม่ค้าสู้ชีวิต",
      searchGoogle: "คลิปไวรัล แม่ค้าลูกชิ้น",
      searchYouTube: "แม่ค้าลูกชิ้น ไวรัล โซเชียล",
      searchTikTok: "แม่ค้าลูกชิ้น ไวรัล",
      coverEmotion: "shocking",
      emotion: "shocked",
      keyScenes: ["ยืนตากฝน", "ยอดแชร์พุ่ง"],
      typography: { hook: "ไวรัล!", main: "โซเชียลแห่แชร์", punch: "อึ้งกันทั้งโซเชียล" }
    },
    {
      mainCharacter: "แม่ค้าลูกชิ้นทอด",
      story: "แม่ค้าลูกชิ้น โชคชัย 4 เรื่องจริง",
      searchGoogle: "แม่ค้าลูกชิ้น โชคชัย 4",
      searchYouTube: "แม่ค้าลูกชิ้น โชคชัย4 เรื่องจริง",
      searchTikTok: "แม่ค้าลูกชิ้น จัดฉาก",
      coverEmotion: "neutral",
      emotion: "neutral",
      keyScenes: ["สัมภาษณ์", "หลักฐาน"],
      typography: { hook: "หลักฐาน", main: "เรื่องจริงหรือจัดฉาก?", punch: "สืบจากโซเชียล" }
    }
  ];

  try {
    const bestImages = await runMultiAgentImageSearch('', 'url', [], newsTitle, identities[0]);
    
    const validImageBuffers = [];
    const imageRoles = [];
    const heroes = bestImages.filter(img => img.role === 'HERO');
    const supports = bestImages.filter(img => img.role !== 'HERO');
    const candidates = [...heroes, ...supports];
    
    for (const img of candidates) {
      const buf = await downloadAndValidateImage(img.url);
      if (buf) {
        validImageBuffers.push(buf);
        imageRoles.push({ role: img.role });
        if (validImageBuffers.length >= 5) break;
      }
    }
    
    if (validImageBuffers.length === 0) return new Response("No images", { status: 400 });

    const results = [];
    
    for (let i=0; i<identities.length; i++) {
      const iden = identities[i];
      let plan = {
        width: 1080, height: 1080,
        layout: 'news-grid-circle',  // Always use news-grid-circle
        borderColor: '#111827',
        accentColor: iden.coverEmotion === 'tragedy' ? '#4b5563' : iden.coverEmotion === 'shocking' ? '#fbbf24' : '#e11d48',
        typography: iden.typography,
        circlePhotoIndex: 0,
        photoOrder: [0, 1, 2, 3]
      };
      
      const finalBuffer = await composeCover(plan, validImageBuffers);
      const outPath = path.join(process.cwd(), 'public', `cover_${i+1}.jpg`);
      fs.writeFileSync(outPath, finalBuffer);
      results.push(`/cover_${i+1}.jpg`);
    }
    
    return new Response(JSON.stringify(results), { status: 200 });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}

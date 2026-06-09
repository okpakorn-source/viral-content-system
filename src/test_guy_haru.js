const http = require('http');

function test() {
  const news = `การเลี้ยงลูกบ้านของ "กาย-ฮารุ" ไม่ได้สอนให้ลูกเป็นเด็กที่เก่งที่สุด แต่สอนให้เติบโตผ่านประสบการณ์จริงของชีวิต ให้ได้ลองผิดลองถูก ได้ล้มแล้วลุกด้วยตัวเองเพราะทั้งคู่เชื่อว่าบทเรียนสำคัญหลายอย่างไม่มีอยู่ในตำรา
พวกเขาเชื่อในศักยภาพของลูกๆ เลยไม่คอยปกป้องจากทุกอุปสรรคเล็กๆ แต่ก็ไม่ได้ละเลย เปิดโอกาสให้คิริน ไนร่า และเอเดน ได้เรียนรู้จากสิ่งที่พบเจอจริง เพราะเชื่อว่าทุกประสบการณ์ ไม่ว่าจะสุขหรือทุกข์ ล้วนเป็นส่วนหนึ่งของการเติบโต และช่วยให้เด็กๆ เข้าใจทั้งโลกและตัวเองมากขึ้นในทุกวัน
สิ่งที่หลายคนชื่นชอบครอบครัวนี้ ไม่ใช่เพราะความสมบูรณ์แบบ แต่เพราะความจริงใจที่ดูแล้วอบอุ่น เพราะสุดท้ายแล้ว สิ่งที่พ่อแม่อยากมอบให้ลูก คือบ้านที่พร้อมเป็นพื้นที่ปลอดภัย ให้ลูกได้เป็นตัวของตัวเอง และเติบโตอย่างมีความสุขในแบบที่ควรจะเป็นที่สุด`;
  
  const postData = JSON.stringify({
    content: news,
    newsTitle: "การเลี้ยงลูกบ้านของ กาย-ฮารุ",
    templateId: "template_8",
    regenerate: true
  });

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/auto-cover',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 300000 // 5 minutes
  };

  console.log("Triggering auto-cover API for Guy-Haru via http module...");
  const startTime = Date.now();

  const req = http.request(options, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n=== Response (Took ${elapsed}s) ===`);
      console.log(`Status Code: ${res.statusCode}`);
      try {
        const data = JSON.parse(body);
        console.log(`Success: ${data.success}`);
        if (data.success) {
          console.log(`Score: ${data.score}`);
          console.log(`Template Used: ${data.templateUsed}`);
          console.log(`Image Count: ${data.imageCount}`);
          console.log(`Case ID: ${data.caseId}`);
          if (data.gallery) {
            console.log("\n=== Gallery Saved Images ===");
            data.gallery.forEach((img, idx) => {
              console.log(`[${idx}] Score: ${img.score}, Role: ${img.role}, Faces: ${img.faceCount}, URL: ${img.url ? img.url.substring(0, 80) + '...' : 'null'}`);
            });
          }
        } else {
          console.log(`Error: ${data.error}`);
          console.log(`ErrorType: ${data.errorType}`);
        }
      } catch (e) {
        console.log("Response body could not be parsed as JSON:");
        console.log(body.substring(0, 500));
      }
    });
  });

  req.on('error', (e) => {
    console.error(`Request error: ${e.message}`);
  });

  req.on('timeout', () => {
    console.error('Request timed out!');
    req.destroy();
  });

  req.write(postData);
  req.end();
}

test();

const http = require('http');

function test() {
  const news = "หมอโบว์ดูแลแม่ป่วยอัลไซเมอร์มา 9 ปี สูญเงินไปแล้วเกือบ 10,000,000 แต่ถึงต้องจ่ายหรือออกจากราชการก็ยอม เพราะเงินหาใหม่ได้แต่แม่มีคนเดียว\nแม้วันนี้แม่อาจลืมทุกอย่างรวมถึงลูกสาวคนนี้ แต่หมอโบว์ไม่เคยลืมค่าน้ำนมที่สร้างเธอมา 20 ปีก่อนแม่หมอโบว์เคยเป็นอดีตครูราชการ แต่เมื่อรู้ว่าลูกติดสัตวแพทย์ก็ไม่อายไปกู้ เพื่อให้ลูกได้เรียนจนจบหมอ 3 ปีก่อนคุณแม่เริ่มป่วยหนัก หมอโบว์จึงไม่ลังเลทิ้งความมั่นคง ออกราชการ มาขายเสื้อ เปิดช่วยช้าง ทั้งทำงานดูแลแม่ไปพร้อมกัน\nนี่คือตัวอย่างของรักแท้ที่ไม่มีข้อแม้ แม้ต้องสละบางอย่าง แม้วันนี้คุณแม่อาจไม่เหลือแม้แต่เสี้ยวความทรงจำ แต่โชคดีที่สุดที่เธอมีลูกสาวอยู่เคียงข้าง ไม่ปล่อยมือ ในวันที่ลำบากที่สุด";
  
  const postData = JSON.stringify({
    content: news,
    newsTitle: "หมอโบว์ดูแลแม่ป่วยอัลไซเมอร์",
    templateId: "template_3",
    caseId: "CASE-001"
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

  console.log("Triggering auto-cover API via http module...");
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

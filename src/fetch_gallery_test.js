const http = require('http');

function getGallery(sessionId) {
  const url = `http://localhost:3000/api/cover-gallery?session=${sessionId}`;
  console.log(`Fetching gallery for session ${sessionId} from ${url}...`);
  
  http.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log(`Success: ${json.success}`);
        if (json.success && json.images) {
          const selected = json.images.filter(img => img.is_selected || img.isSelected);
          console.log(`Selected images count: ${selected.length}`);
          console.log("\nSelected images:");
          selected.forEach((img, idx) => {
            console.log(`[${idx}] role=${img.ai_role}, score=${img.ai_score}, url=${img.image_url}`);
          });
        } else {
          console.log("Error or no images:", json);
        }
      } catch (err) {
        console.error("Failed to parse response:", err.message);
        console.log("Raw response:", data.substring(0, 500));
      }
    });
  }).on('error', (err) => {
    console.error("HTTP request error:", err.message);
  });
}

const args = process.argv.slice(2);
const session = args[0] || 'CASE-011';
getGallery(session);

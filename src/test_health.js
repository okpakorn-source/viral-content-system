const http = require('http');

function checkHealth(path) {
  const url = `http://localhost:3000${path}`;
  console.log(`Checking health endpoint: ${url}`);
  
  http.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`Status Code for ${path}: ${res.statusCode}`);
      try {
        const json = JSON.parse(data);
        console.log(`Response:`, JSON.stringify(json, null, 2));
      } catch (err) {
        console.log("Raw response (not JSON):", data.substring(0, 300));
      }
    });
  }).on('error', (err) => {
    console.error(`Error connecting to ${path}:`, err.message);
  });
}

checkHealth('/api/health');
checkHealth('/api/system-health');

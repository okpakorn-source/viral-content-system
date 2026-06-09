const fs = require('fs');

const logPath = 'C:\\Users\\User\\.gemini\\antigravity\\brain\\443dcfba-2880-4027-bd97-5cef1291ce02\\.system_generated\\tasks\\task-10026.log';
if (fs.existsSync(logPath)) {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  
  // Find lines with assignSlots or Curator or Judge for หมอโบว์ run (near the end)
  let printIdx = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.includes('[assignSlots]') || l.includes('[Curator]') || l.includes('[AutoCover Judge]') || l.includes('[FaceDetector]')) {
      printIdx.unshift(i);
      if (printIdx.length >= 80) break;
    }
  }
  
  printIdx.forEach(idx => {
    console.log(`${idx}: ${lines[idx]}`);
  });
} else {
  console.log('Log not found.');
}

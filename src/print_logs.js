const fs = require('fs');

const logPath = 'C:\\Users\\User\\.gemini\\antigravity\\brain\\443dcfba-2880-4027-bd97-5cef1291ce02\\.system_generated\\tasks\\task-10026.log';
if (fs.existsSync(logPath)) {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  console.log(`Total lines: ${lines.length}`);
  
  // Find lines containing "STORY FOCUS" for หมอโบว์
  let startIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('STORY FOCUS') && lines[i].includes('หมอโบว์')) {
      startIndex = i;
      break;
    }
  }
  
  if (startIndex !== -1) {
    console.log(`Found หมอโบว์ log starting at line ${startIndex}`);
    const printLines = lines.slice(startIndex, startIndex + 150);
    printLines.forEach((l, idx) => {
      console.log(`${startIndex + idx}: ${l}`);
    });
  } else {
    console.log('หมอโบว์ STORY FOCUS not found in logs.');
  }
} else {
  console.log('Log file not found.');
}

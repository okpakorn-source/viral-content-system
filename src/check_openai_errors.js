const fs = require('fs');

const logPath = 'C:\\Users\\User\\.gemini\\antigravity\\brain\\443dcfba-2880-4027-bd97-5cef1291ce02\\.system_generated\\tasks\\task-10026.log';
if (fs.existsSync(logPath)) {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  
  // Find lines with openai, callAI, gpt-5.5, or errors from OpenAI
  let matchCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('openai') || l.includes('callAI') || l.includes('gpt-5.5') || l.includes('gpt-5.4-mini') || l.includes('OpenAIError') || l.includes('404')) {
      console.log(`${i}: ${l}`);
      matchCount++;
      if (matchCount >= 80) break;
    }
  }
} else {
  console.log('Log not found.');
}

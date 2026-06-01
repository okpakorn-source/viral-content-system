const fs = require('fs');
const content = fs.readFileSync('src/components/content/ExtractedView.js', 'utf8');

const startIndex = content.indexOf('return (');
const jsxContent = content.slice(startIndex);

let openDivs = 0;
let lines = jsxContent.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const opens = (line.match(/<div/g) || []).length;
  const closes = (line.match(/<\/div>/g) || []).length;
  
  openDivs += opens;
  openDivs -= closes;
  
  if (opens > 0 || closes > 0) {
    console.log(`Line ${i + 8}: +${opens} -${closes} | Total: ${openDivs}`);
  }
}
console.log("Final unmatched:", openDivs);

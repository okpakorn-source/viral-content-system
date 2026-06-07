import { config } from 'dotenv';
config({ path: '.env.local' });

const keys = ['SERPER_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','YOUTUBE_API_KEY','PEXELS_API_KEY','FIRECRAWL_API_KEY','REPLICATE_API_TOKEN','APIFY_API_KEY'];

console.log('=== ENV VALUES ===');
for (const k of keys) {
  const v = process.env[k];
  if (!v) { console.log(`❌ ${k} = MISSING`); continue; }
  const hasQuotes = v.startsWith('"') || v.endsWith('"');
  const clean = v.replace(/"/g, '');
  console.log(`${hasQuotes ? '⚠️ QUOTED' : '✅ OK'}: ${k} = "${clean.substring(0,12)}..." (len=${clean.length})`);
}

// Test each API with clean values
async function testAPIs() {
  console.log('\n=== LIVE API TEST ===');
  const clean = (k) => (process.env[k] || '').replace(/"/g, '').trim();

  // Serper
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': clean('SERPER_API_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'test', num: 1 })
    });
    const data = await res.json();
    console.log(res.ok ? `✅ Serper: OK (${data.images?.length} imgs)` : `❌ Serper: ${res.status} — ${data.message || ''}`);
  } catch(e) { console.log(`❌ Serper: ${e.message.substring(0, 60)}`); }

  // Gemini
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${clean('GEMINI_API_KEY')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }] })
    });
    const data = await res.json();
    console.log(res.ok ? '✅ Gemini: OK' : `❌ Gemini: ${res.status} — ${data.error?.message?.substring(0,80) || ''}`);
  } catch(e) { console.log(`❌ Gemini: ${e.message.substring(0, 60)}`); }

  // OpenAI
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${clean('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 })
    });
    const data = await res.json();
    console.log(res.ok ? '✅ OpenAI: OK' : `❌ OpenAI: ${res.status} — ${data.error?.message?.substring(0,80) || ''}`);
  } catch(e) { console.log(`❌ OpenAI: ${e.message.substring(0, 60)}`); }

  // Anthropic  
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': clean('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] })
    });
    const data = await res.json();
    console.log(res.ok ? '✅ Anthropic: OK' : `❌ Anthropic: ${res.status} — ${(data.error?.message || JSON.stringify(data.error)).substring(0,80)}`);
  } catch(e) { console.log(`❌ Anthropic: ${e.message.substring(0, 60)}`); }

  // YouTube
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&type=video&key=${clean('YOUTUBE_API_KEY')}&maxResults=1`);
    const data = await res.json();
    console.log(res.ok ? `✅ YouTube: OK (${data.items?.length} items)` : `❌ YouTube: ${res.status} — ${data.error?.message?.substring(0,80) || ''}`);
  } catch(e) { console.log(`❌ YouTube: ${e.message.substring(0, 60)}`); }

  // Pexels
  try {
    const res = await fetch('https://api.pexels.com/v1/search?query=test&per_page=1', {
      headers: { 'Authorization': clean('PEXELS_API_KEY') }
    });
    const data = await res.json();
    console.log(res.ok ? `✅ Pexels: OK (${data.total_results} total)` : `❌ Pexels: ${res.status}`);
  } catch(e) { console.log(`❌ Pexels: ${e.message.substring(0, 60)}`); }

  // Firecrawl
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${clean('FIRECRAWL_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] })
    });
    const data = await res.json();
    console.log(res.ok ? '✅ Firecrawl: OK' : `❌ Firecrawl: ${res.status} — ${(data.error || data.message || '').substring(0,80)}`);
  } catch(e) { console.log(`❌ Firecrawl: ${e.message.substring(0, 60)}`); }
}

testAPIs();

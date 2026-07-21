// เซิร์ฟเวอร์ออฟฟิศ Fable & Co. — static + แชทโต้ตอบ (POST) | ใช้ในบ้าน/LAN เท่านั้น
// รัน: node public/company/server.mjs  (ผ่าน .claude/launch.json ชื่อ "office")
import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';

const ROOT = path.dirname(url.fileURLToPath(import.meta.url)); // = public/company
const PORT = 8787;
const TYPES = { '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };

function scopeFiles(scope) {
  const base = scope === 'newsdesk' ? path.join(ROOT, 'departments', 'newsdesk') : path.join(ROOT, 'office');
  return { chat: path.join(base, 'chat.md'), pending: path.join(base, '_pending.jsonl') };
}
function hhmm() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); }
function readBody(req) { return new Promise(res => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => res(b)); }); }

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    // ---- POST: แชท/เรียกประชุม ----
    if (req.method === 'POST' && (u.pathname === '/api/say' || u.pathname === '/api/meeting')) {
      const body = JSON.parse((await readBody(req)) || '{}');
      const scope = body.scope === 'newsdesk' ? 'newsdesk' : 'main';
      const f = scopeFiles(scope);
      let line, pend;
      if (u.pathname === '/api/meeting') {
        const topic = String(body.topic || '').slice(0, 500);
        line = '\n[' + hhmm() + '] 📣 **ผู้ใช้เรียกประชุม**: ' + topic;
        pend = { type: 'meeting', topic: topic, ts: Date.now() };
      } else {
        const to = String(body.to || '@all').slice(0, 40);
        const text = String(body.text || '').slice(0, 1000);
        line = '\n[' + hhmm() + '] 🧑 **ผู้ใช้** → ' + to + ': ' + text;
        pend = { type: 'say', to: to, text: text, ts: Date.now() };
      }
      if (!fs.existsSync(f.chat)) fs.writeFileSync(f.chat, '# 💬 แชทกับพนักงาน (' + scope + ')\n', 'utf8');
      fs.appendFileSync(f.chat, line + '\n', 'utf8');
      fs.appendFileSync(f.pending, JSON.stringify(pend) + '\n', 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, note: 'ส่งแล้ว — พนักงานจะตอบเมื่อประมวลแชท (company-reply)' }));
      return;
    }
    // ---- GET: static ----
    let p = decodeURIComponent(u.pathname);
    if (p === '/' ) p = '/office-ui/office.html';
    const full = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
    if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  }
});
server.listen(PORT, '0.0.0.0', () => console.log('Fable & Co. office server → http://localhost:' + PORT + ' (POST /api/say, /api/meeting)'));

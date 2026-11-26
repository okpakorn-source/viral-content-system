/**
 * =====================================================
 * Sub-Ultra Callers — ตัวเรียกโมเดลผ่านแพ็กเกจรายเดือน (Sub Ultra 100% · ค่า API = 0 บาท)
 * =====================================================
 * รองรับแผนที่ 1 (Dual-Sub Masterpiece):
 *   1. Google AI Ultra ผ่าน Antigravity CLI (`agy.exe` · stream-json stdin ไม่จำกัดความยาว):
 *      - gemini-4-neon-high / medium / low
 *      - gemini-4-carbon-high / medium / low
 *      - gemini-4-argon-high / medium / low
 *      - gemini-4-hydrogen-high / medium / low
 *   2. ChatGPT Pro/Plus Subscription ผ่าน Codex CLI (`codex.exe exec` · โปรไฟล์คลีนปลอดปลั๊กอิน):
 *      - gpt-6.2-astra
 *      - gpt-5.6-sol
 *
 * คุณสมบัติความปลอดภัยระดับ Production:
 *   - รันในโฟลเดอร์ว่างแยกขาด (`viralflow-sub-empty-cwd`) ไม่โหลด AGENTS.md ของโปรเจกต์ไปปนกับคำสั่งเขียนข่าว
 *   - ส่งข้อความผ่าน stdin ทั้งคู่ ไม่มีเพดาน 32KB ของบรรทัดคำสั่ง Windows
 *   - ตัดโปรเซสทั้งต้นไม้ (`taskkill /T /F`) ทันทีเมื่อเกิน timeoutMs ป้องกันโปรเซสค้างสะสม
 *   - มีโซ่สลับรุ่นสำรองอัตโนมัติ (Neon -> Carbon -> Argon และ GPT Sub -> Gemini 4 Neon/Carbon)
 *   - ไม่มี import แบบ alias (`@/...`) จึงรันได้ทั้งใน Next.js และใน standalone worker (`node` ตรงๆ)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const NO_TOOLS_GUARD = '[โหมดประมวลผลข้อความล้วน: ห้ามเรียกใช้เครื่องมือ คำสั่งเทอร์มินัล หรืออ่าน/เขียนไฟล์ใดๆ เด็ดขาด ให้ประมวลผลจากข้อความที่ส่งให้และตอบกลับทันทีในรอบเดียว]';

export function extractSubJson(text) {
  if (text && typeof text === 'object') return text;
  const raw = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!raw) throw new Error('โมเดลตอบว่างเปล่า (ไม่มี JSON)');
  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const slice = raw.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(slice);
      } catch {
        const cleaned = slice.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(cleaned);
      }
    }
    throw new Error(`แปลง JSON จาก Sub Ultra ไม่สำเร็จ: ${raw.slice(0, 160)}`);
  }
}

function killProcessTree(child) {
  if (!child || child.killed) return;
  const pid = child.pid;
  try {
    if (process.platform === 'win32' && pid) {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.unref?.();
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch {}
  }
}

function defaultSpawnRunner(cmd, args, { cwd, env, input = '', timeoutMs = 75000 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      const err = new Error(`Sub Ultra CLI หมดเวลา (${Math.round(timeoutMs / 1000)}s)`);
      err.code = 'SUB_ULTRA_TIMEOUT';
      err.errorType = 'SUB_ULTRA_TIMEOUT';
      reject(err);
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, ms: Date.now() - startedAt, stdout, stderr });
    });

    try {
      if (input) child.stdin.write(input, 'utf8');
      child.stdin.end();
    } catch {
      // ถ้าโปรเซสปิดเร็ว ไม่ต้องโยนซ้ำ รออ่านจาก close
    }
  });
}

// ตัวช่วยต่อพาธแบบ runtime-only เพื่อไม่ให้ Turbopack สแกนดิสก์นอกโปรเจกต์ตอน build
function rtPath(...segments) {
  return segments.filter(Boolean).join(path.sep);
}

export function resolveAgyBinary(env = process.env) {
  if (env?.AGY_BIN && fs.existsSync(env.AGY_BIN)) return env.AGY_BIN;
  const localAgy = rtPath(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
  if (fs.existsSync(localAgy)) return localAgy;
  return 'agy';
}

export function resolveCodexBinary(env = process.env) {
  if (env?.CODEX_BIN && fs.existsSync(env.CODEX_BIN)) {
    return { cmd: env.CODEX_BIN, prefixArgs: [] };
  }
  // อ่านพาธ codex.exe จาก ~/.codex/config.toml (ถ้ามี) โดยไม่ต้องสแกน WindowsApps
  try {
    const cfgPath = rtPath(os.homedir(), '.codex', 'config.toml');
    if (fs.existsSync(cfgPath)) {
      const cfgText = fs.readFileSync(cfgPath, 'utf8');
      const m = cfgText.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+codex\.exe)['"]/i);
      if (m && m[1] && fs.existsSync(m[1])) {
        return { cmd: m[1], prefixArgs: [] };
      }
    }
  } catch { /* ถอยไปหาใน npm global */ }

  const npmCodexJs = rtPath(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (fs.existsSync(npmCodexJs)) {
    return { cmd: process.execPath, prefixArgs: [npmCodexJs] };
  }
  return { cmd: 'codex', prefixArgs: [] };
}

function ensureSlotEmptyWorkDir(slotIdx = 0) {
  const dir = rtPath(os.tmpdir(), `viralflow-sub-empty-cwd-${slotIdx}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createSlotPool(size = 2) {
  const cap = Math.max(1, size);
  const freeSlots = Array.from({ length: cap }, (_, i) => i);
  const waiters = [];
  return {
    acquire() {
      if (freeSlots.length > 0) return Promise.resolve(freeSlots.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
    release(slot) {
      if (waiters.length > 0) {
        const next = waiters.shift();
        next(slot);
      } else {
        freeSlots.push(slot);
      }
    },
  };
}

function prepareCleanCodexHome({ model = 'gpt-6.2-astra', effort = 'medium', slotIdx = 0, sourceHome } = {}) {
  const origHome = sourceHome || rtPath(os.homedir(), '.codex');
  const origAuth = rtPath(origHome, 'auth.json');
  if (!fs.existsSync(origAuth)) {
    const err = new Error('ไม่พบไฟล์ยืนยันตัวตน ChatGPT Sub (~/.codex/auth.json)');
    err.errorType = 'CODEX_AUTH_MISSING';
    throw err;
  }
  const safeTag = `slot${slotIdx}_${model}_${effort}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const targetHome = rtPath(os.tmpdir(), 'viralflow-codex-clean-homes', safeTag);
  fs.mkdirSync(targetHome, { recursive: true });

  // คัดลอก auth.json เฉพาะสล็อตของตัวเอง (ไม่ชน EBUSY ข้ามโปรเซสบน Windows)
  fs.copyFileSync(origAuth, rtPath(targetHome, 'auth.json'));
  const toml = [
    'service_tier = "priority"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    `model = "${model}"`,
    `model_reasoning_effort = "${effort}"`,
    '[agents]',
    'enabled = false',
    '[features]',
    'js_repl = false',
    '',
  ].join('\n');
  fs.writeFileSync(rtPath(targetHome, 'config.toml'), toml, 'utf8');
  return targetHome;
}

export function defaultGeminiFallbackChain(primaryModel) {
  const m = String(primaryModel || 'gemini-4-carbon-high').trim();
  const chain = [m];
  const pushUnique = (x) => { if (x && !chain.includes(x)) chain.push(x); };

  if (m.startsWith('gemini-4-neon')) {
    pushUnique('gemini-4-carbon-high');
    pushUnique('gemini-4-argon-high');
  } else if (m.startsWith('gemini-4-carbon')) {
    pushUnique('gemini-4-neon-medium');
    pushUnique('gemini-4-argon-high');
  } else if (m.startsWith('gemini-4-argon')) {
    pushUnique('gemini-4-carbon-medium');
    pushUnique('gemini-4-hydrogen-high');
  } else if (m.startsWith('gemini-4-hydrogen')) {
    pushUnique('gemini-4-argon-low');
  } else {
    pushUnique('gemini-4-argon-high');
  }
  return chain;
}

function parseAgyStreamOutput(stdout, stderr, code) {
  const lines = String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let resultObj = null;
  let deltaText = '';

  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.event === 'result' && evt.result) {
        resultObj = evt.result;
      } else if (evt.event === 'step_update' && evt.step_update?.step_type === 'agent_response') {
        if (typeof evt.step_update.text_delta === 'string') {
          deltaText += evt.step_update.text_delta;
        }
      }
    } catch { /* ข้ามบรรทัดที่ไม่ใช่ JSON */ }
  }

  if (resultObj) {
    if (resultObj.status && resultObj.status !== 'SUCCESS') {
      throw new Error(`agy status=${resultObj.status}: ${resultObj.error || stderr || 'ไม่ทราบสาเหตุ'}`);
    }
    const text = String(resultObj.response ?? deltaText ?? '').trim();
    return {
      text,
      structured: resultObj.structured_output || null,
      usage: resultObj.usage || {},
    };
  }

  if (code !== 0) {
    throw new Error(`agy exited code=${code}: ${String(stderr || stdout || '').slice(0, 200)}`);
  }
  return { text: deltaText.trim(), structured: null, usage: {} };
}

function composeFullPrompt({ system = '', user = '', json = false }) {
  const parts = [NO_TOOLS_GUARD];
  if (json) {
    parts.push('[สำคัญ: ตอบกลับเป็น JSON ที่ถูกต้องตามโครงสร้างเท่านั้น ห้ามมีคำอธิบายนำหน้าหรือต่อท้าย]');
  }
  if (system) parts.push(`=== บทบาทและกฎการทำงาน ===\n${String(system).trim()}`);
  if (user) parts.push(String(user).trim());
  return parts.join('\n\n');
}

/**
 * สร้างตัวจัดการเรียกโมเดลผ่าน Sub Ultra ทั้งสองค่าย
 * @param {object} [opts]
 * @param {function} [opts.logUsage]   บันทึกจำนวนโทเค็นลงระบบ (cost = 0)
 * @param {function} [opts.runCommand] ตัวรันโปรเซส (ฉีดของจำลองใน unit test ได้)
 * @param {object}   [opts.env]        ตัวแปรแวดล้อม
 */
export function createSubUltraHub({
  logUsage,
  runCommand = defaultSpawnRunner,
  env = process.env,
  maxParallelGemini = 2,
  maxParallelGpt = 2,
} = {}) {
  const agyBin = resolveAgyBinary(env);
  const codexSpec = resolveCodexBinary(env);
  const geminiPool = createSlotPool(maxParallelGemini);
  const gptPool = createSlotPool(maxParallelGpt);

  const safeLog = (payload) => {
    try {
      const p = logUsage?.(payload);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* บันทึก log พังห้ามทำให้งานเขียนข่าวล้ม */ }
  };

  /**
   * เรียกตระกูล Gemini 4 (Neon / Carbon / Argon / Hydrogen) ผ่าน Antigravity Sub Ultra (`agy`)
   */
  async function callGeminiSub({
    model = 'gemini-4-neon-high',
    models = null,
    system = '',
    user = '',
    json = false,
    jsonSchema = null,
    validate = null,
    timeoutMs = 75000,
    role = 'gemini-sub-ultra',
  } = {}) {
    const chain = Array.isArray(models) && models.length > 0
      ? models
      : defaultGeminiFallbackChain(model);
    let fullPrompt = composeFullPrompt({ system, user, json });
    // ป้องกันเพดาน 46,080 ไบต์ต่อข้อความของ agy CLI (รักษาเพดานปลอดภัย ≤ 43,000 ไบต์ UTF-8 เสมอ)
    if (Buffer.byteLength(fullPrompt, 'utf8') > 43000) {
      let trimmed = fullPrompt;
      while (Buffer.byteLength(trimmed, 'utf8') > 42500) {
        trimmed = trimmed.slice(0, Math.floor(trimmed.length * 0.92));
      }
      fullPrompt = trimmed;
    }
    const stdinPayload = JSON.stringify({ event: 'user', message: { content: fullPrompt } }) + '\n';

    const errors = [];
    for (let i = 0; i < chain.length; i++) {
      const targetModel = chain[i];
      const args = [
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--model', targetModel,
        '--disable-slash-commands',
        '--sandbox',
      ];
      if (jsonSchema) {
        args.push('--json-schema', typeof jsonSchema === 'string' ? jsonSchema : JSON.stringify(jsonSchema));
      }

      try {
        const slotIdx = await geminiPool.acquire();
        let res;
        try {
          res = await runCommand(agyBin, args, {
            cwd: ensureSlotEmptyWorkDir(slotIdx),
            env,
            input: stdinPayload,
            timeoutMs,
          });
        } finally {
          geminiPool.release(slotIdx);
        }
        const parsed = parseAgyStreamOutput(res.stdout, res.stderr, res.code);
        safeLog({
          provider: 'sub_ultra_gemini',
          model: targetModel,
          inputTokens: parsed.usage?.input_tokens || 0,
          outputTokens: parsed.usage?.output_tokens || 0,
          costUsd: 0,
          feature: `newsStudio:${role}${i > 0 ? ` (fallback#${i})` : ''}`,
        });

        if (json) {
          const obj = (parsed.structured && typeof parsed.structured === 'object')
            ? parsed.structured
            : extractSubJson(parsed.text);
          if (typeof validate === 'function' && !validate(obj)) {
            throw new Error(`ผลลัพธ์ JSON จาก ${targetModel} ไม่ผ่านเงื่อนไขตรวจสอบ`);
          }
          return { data: obj, modelUsed: targetModel, fallbackIndex: i };
        }

        if (!parsed.text) throw new Error(`โมเดล ${targetModel} ตอบว่างเปล่า`);
        if (typeof validate === 'function' && !validate(parsed.text)) {
          throw new Error(`ข้อความตอบกลับจาก ${targetModel} ไม่ผ่านเงื่อนไขตรวจสอบ`);
        }
        return { data: parsed.text, modelUsed: targetModel, fallbackIndex: i };
      } catch (err) {
        errors.push(`${targetModel}: ${String(err?.message || err).slice(0, 120)}`);
      }
    }

    const finalErr = new Error(`เรียก Gemini 4 Sub Ultra (${role}) ไม่สำเร็จทุกรุ่นในโซ่: ${errors.join(' | ')}`);
    finalErr.errorType = 'SUB_ULTRA_GEMINI_EXHAUSTED';
    throw finalErr;
  }

  /**
   * เรียกตระกูล GPT (`gpt-6.2-astra` / `gpt-5.6-sol`) ผ่าน ChatGPT Sub (`codex exec`)
   * พร้อมระบบสลับข้ามค่ายอัตโนมัติ (ถ้า ChatGPT Sub สะดุด/หมดเวลา จะสลับให้ Gemini 4 Neon/Carbon ทำหน้าที่แทนทันที)
   */
  async function callGptSub({
    model = 'gpt-6.2-astra',
    models = null,
    effort = 'medium',
    system = '',
    user = '',
    json = false,
    timeoutMs = 55000,
    role = 'gpt-sub-critic',
    allowGeminiFallback = true,
    geminiFallbackModels = ['gemini-4-neon-high', 'gemini-4-carbon-high'],
  } = {}) {
    const chain = Array.isArray(models) && models.length > 0
      ? models
      : (model === 'gpt-5.6-sol' ? ['gpt-5.6-sol', 'gpt-6.2-astra'] : ['gpt-6.2-astra', 'gpt-5.6-sol']);
    const fullPrompt = composeFullPrompt({ system, user, json });
    const errors = [];

    for (let i = 0; i < chain.length; i++) {
      const targetModel = chain[i];
      try {
        const slotIdx = await gptPool.acquire();
        let res;
        try {
          const cleanHome = prepareCleanCodexHome({ model: targetModel, effort, slotIdx, sourceHome: env?.CODEX_SOURCE_HOME });
          const args = [
            ...codexSpec.prefixArgs,
            'exec',
            '--ephemeral',
            '--skip-git-repo-check',
            '-s', 'read-only',
            '-',
          ];
          res = await runCommand(codexSpec.cmd, args, {
            cwd: ensureSlotEmptyWorkDir(10 + slotIdx),
            env: { ...env, CODEX_HOME: cleanHome },
            input: fullPrompt,
            timeoutMs,
          });
        } finally {
          gptPool.release(slotIdx);
        }
        if (res.code !== 0 && !String(res.stdout || '').trim()) {
          throw new Error(`codex exited code=${res.code}: ${String(res.stderr || '').slice(-160)}`);
        }
        const text = String(res.stdout || '').trim();
        if (!text) throw new Error(`โมเดล ${targetModel} ตอบว่างเปล่า`);

        // ดึงจำนวน tokens used จากท้าย stderr ของ codex (ถ้ามี)
        const tokMatch = String(res.stderr || '').match(/tokens used\s+([\d,]+)/i);
        const totalTok = tokMatch ? parseInt(tokMatch[1].replace(/,/g, ''), 10) || 0 : 0;
        safeLog({
          provider: 'sub_ultra_gpt',
          model: targetModel,
          inputTokens: totalTok,
          outputTokens: 0,
          costUsd: 0,
          feature: `newsStudio:${role}${i > 0 ? ` (fallback#${i})` : ''}`,
        });

        const data = json ? extractSubJson(text) : text;
        return { data, modelUsed: targetModel, providerUsed: 'gpt_sub', fallbackIndex: i };
      } catch (err) {
        errors.push(`${targetModel}: ${String(err?.message || err).slice(0, 120)}`);
      }
    }

    if (allowGeminiFallback) {
      const gemRes = await callGeminiSub({
        models: geminiFallbackModels,
        system,
        user,
        json,
        timeoutMs: Math.max(timeoutMs, 65000),
        role: `${role} (Gemini-Fallback)`,
      });
      return {
        data: gemRes.data,
        modelUsed: gemRes.modelUsed,
        providerUsed: 'gemini_sub_fallback',
        fallbackIndex: chain.length + gemRes.fallbackIndex,
        gptErrors: errors,
      };
    }

    const finalErr = new Error(`เรียก GPT Sub (${role}) ไม่สำเร็จ: ${errors.join(' | ')}`);
    finalErr.errorType = 'SUB_ULTRA_GPT_EXHAUSTED';
    throw finalErr;
  }

  return {
    callGeminiSub,
    callGptSub,
    extractSubJson,
  };
}

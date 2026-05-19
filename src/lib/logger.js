/**
 * Real-Time Pipeline Logger
 * ใช้ log ทุก step ทุก API ทุก prompt ที่ถูกเรียกใช้
 *
 * Format:
 *   [HH:MM:SS.ms] [API_NAME] ICON message
 *
 * Usage:
 *   import { createLogger } from '@/lib/logger';
 *   const log = createLogger('AUTO');
 *   log.start('เริ่ม pipeline...');
 *   log.api('summarize', 'mode=ANALYZE');
 */

function ts() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
}

export function createLogger(name) {
  const prefix = (icon) => `[${ts()}] [${name}] ${icon}`;

  return {
    start:    (msg) => console.log(`\n${'='.repeat(60)}\n${prefix('🚀')} START | ${msg}\n${'='.repeat(60)}`),
    done:     (msg) => console.log(`${prefix('✅')} DONE  | ${msg}\n${'─'.repeat(60)}`),
    step:     (step, msg) => console.log(`${prefix('➡️ ')} [${step}] ${msg}`),
    api:      (api, msg) => console.log(`${prefix('📡')} → /api/${api} | ${msg}`),
    prompt:   (name, detail) => console.log(`${prefix('📝')} PROMPT: "${name}" | ${detail}`),
    model:    (model, detail) => console.log(`${prefix('🤖')} MODEL: ${model} | ${detail}`),
    inject:   (part, detail) => console.log(`${prefix('📦')} INJECT [${part}] ${detail}`),
    research: (msg) => console.log(`${prefix('🔍')} RESEARCH | ${msg}`),
    blueprint:(msg) => console.log(`${prefix('🧬')} BLUEPRINT | ${msg}`),
    info:     (msg) => console.log(`${prefix('ℹ️ ')} ${msg}`),
    warn:     (msg) => console.warn(`${prefix('⚠️ ')} WARN  | ${msg}`),
    error:    (msg) => console.error(`${prefix('❌')} ERROR | ${msg}`),
    divider:  (label = '') => console.log(`\n${'─'.repeat(30)} ${label} ${'─'.repeat(30)}`),
  };
}

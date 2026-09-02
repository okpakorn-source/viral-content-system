#!/usr/bin/env node
// ============================================================
// 🧮 scripts/train-viral-score.mjs — เทรนตัวทำนาย "โอกาสปัง" จากโพสต์จริง (2 ก.ย. 69)
// ------------------------------------------------------------
// ข้อมูล: C:\tmp\news-r233-run\fb-posts.json (1,927 โพสต์ มิ.ย.–ก.ค. 69 {text, reactions, ...})
// เป้าหมาย: y = log10(reactions + 1)
// โมเดล: ridge regression บนฟีเจอร์จาก src/lib/feedback/viralFeatures.js (มาตรฐาน z-score จากชุดเทรน)
//   เขียนสมการเอง ไม่มี dependency — แก้ระบบ (XᵀX + λI) w = Xᵀ(y − ȳ) ด้วย Gaussian elimination
//   เลือก λ ด้วย 5-fold CV บนชุดเทรน (RMSE ต่ำสุด) แล้วเทรนใหม่บนชุดเทรนทั้งก้อน
// แบ่ง train/valid 80/20 แบบสุ่มคงที่ (seed) — ตัวเลขทุกครั้งเท่าเดิม
// รายงานบน valid: Spearman ρ · Pearson r · RMSE · top-decile precision (ทายท็อป 10% ถูกกี่ %) · pairwise accuracy
// ผล: data/viral-score-model.json {features, weights, bias, scale{mean,std}, calibration, trainedAt, metrics}
//
// ใช้: node scripts/train-viral-score.mjs [--posts=path] [--out=path] [--seed=20260902] [--dry]
// ไฟล์นี้ import ได้จากเทส (ฟังก์ชันคณิตศาสตร์ทุกตัว export) — main() รันเฉพาะตอนเรียกตรง
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractFeatures, MODEL_FEATURES, featureVector } from '../src/lib/feedback/viralFeatures.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_POSTS_PATH = 'C:/tmp/news-r233-run/fb-posts.json';
export const DEFAULT_OUT_PATH = join(ROOT, 'data', 'viral-score-model.json');
export const DEFAULT_SEED = 20260902;
// ★ กริด λ กว้างถึง 10000 — จากการเทรนจริง 2 ก.ย. 69 CV เลือก 1000 (กริดเดิมสุดที่ 300 = ติดขอบ) · ฟีเจอร์ 53 ตัวบน 1,542 แถว
//   ต้องหดแรง เพราะสัญญาณจากข้อความล้วนอ่อน (ρ valid ≈ 0.30) — ทดลองแล้ว log1p/words²/density ไม่ช่วย (0.30–0.31 ทุกแบบ)
export const DEFAULT_LAMBDAS = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
export const BANDS = { high: 70, mid: 35 }; // เปอร์เซ็นไทล์ ≥70 = สูง · ≥35 = กลาง · ต่ำกว่า = ต่ำ
export const MODEL_VERSION = 1;

// ---------- สุ่มคงที่ (mulberry32) ----------
export function seededRandom(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleIndices(n, seed) {
  const rnd = seededRandom(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

export function splitTrainValid(n, { seed = DEFAULT_SEED, validRatio = 0.2 } = {}) {
  const idx = shuffleIndices(n, seed);
  const nValid = Math.max(1, Math.round(n * validRatio));
  return { valid: idx.slice(0, nValid), train: idx.slice(nValid) };
}

// ---------- มาตรฐาน z-score ----------
export function fitScale(X) {
  const n = X.length;
  const p = n ? X[0].length : 0;
  const mean = new Array(p).fill(0);
  const std = new Array(p).fill(1);
  if (!n) return { mean, std };
  for (const row of X) for (let j = 0; j < p; j++) mean[j] += row[j];
  for (let j = 0; j < p; j++) mean[j] /= n;
  const sq = new Array(p).fill(0);
  for (const row of X) for (let j = 0; j < p; j++) sq[j] += (row[j] - mean[j]) ** 2;
  for (let j = 0; j < p; j++) {
    std[j] = Math.sqrt(sq[j] / n);
    if (!(std[j] > 1e-9)) std[j] = 1; // ฟีเจอร์คงที่ → ไม่หาร 0 (น้ำหนักจะเป็น 0 เอง)
  }
  return { mean, std };
}

export function applyScale(row, scale) {
  return row.map((v, j) => (v - scale.mean[j]) / scale.std[j]);
}

// ---------- แก้ระบบสมการเชิงเส้น A x = b (Gaussian elimination + partial pivot) ----------
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error(`singular matrix at column ${col}`);
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

/** ridge บน X ที่มาตรฐานแล้ว: คืน {weights, bias} · bias = ค่าเฉลี่ย y (X กลางศูนย์แล้ว ไม่ลงโทษ intercept) */
export function ridgeFit(Xz, y, lambda) {
  const n = Xz.length;
  const p = n ? Xz[0].length : 0;
  const yMean = y.reduce((a, b) => a + b, 0) / (n || 1);
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = Xz[i];
    const yc = y[i] - yMean;
    for (let a = 0; a < p; a++) {
      const ra = row[a];
      if (ra === 0) continue;
      Xty[a] += ra * yc;
      for (let b = a; b < p; b++) XtX[a][b] += ra * row[b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    XtX[a][a] += lambda;
  }
  const weights = p ? solveLinear(XtX, Xty) : [];
  return { weights, bias: yMean };
}

export function predictRow(rowRaw, model) {
  const z = applyScale(rowRaw, model.scale);
  let s = model.bias;
  for (let j = 0; j < z.length; j++) s += model.weights[j] * z[j];
  return s;
}

// ---------- ตัววัด ----------
function ranks(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(a, b) {
  const n = a.length;
  if (n < 2) return 0;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

export function spearman(a, b) {
  return pearson(ranks(a), ranks(b));
}

export function rmse(pred, actual) {
  const n = pred.length;
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += (pred[i] - actual[i]) ** 2;
  return Math.sqrt(s / n);
}

/** ทำนายว่าอยู่ท็อป frac ของชุด: จากที่ทายว่าท็อป มีกี่ % ที่ท็อปจริง */
export function topDecilePrecision(pred, actual, frac = 0.1) {
  const n = pred.length;
  if (!n) return 0;
  const k = Math.max(1, Math.round(n * frac));
  const byPred = pred.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]).slice(0, k).map(x => x[1]);
  const actualSorted = [...actual].sort((x, y) => y - x);
  const threshold = actualSorted[k - 1];
  let hit = 0;
  for (const i of byPred) if (actual[i] >= threshold) hit++;
  return hit / k;
}

/** สัดส่วนคู่ที่เรียงลำดับถูก (ไม่นับคู่ที่เท่ากัน) */
export function pairwiseAccuracy(pred, actual) {
  const n = pred.length;
  let ok = 0, total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const da = actual[i] - actual[j];
      const dp = pred[i] - pred[j];
      if (da === 0 || dp === 0) continue;
      total++;
      if ((da > 0) === (dp > 0)) ok++;
    }
  }
  return total ? ok / total : 0;
}

export function quantiles(values, steps = 100) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return new Array(steps + 1).fill(0);
  const out = [];
  for (let q = 0; q <= steps; q++) {
    const pos = (q / steps) * (s.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    out.push(+(s[lo] + (s[hi] - s[lo]) * (pos - lo)).toFixed(6));
  }
  return out;
}

// ---------- เลือก λ ด้วย k-fold บนชุดเทรน ----------
export function crossValidateLambda(Xtrain, ytrain, { lambdas = DEFAULT_LAMBDAS, folds = 5, seed = DEFAULT_SEED } = {}) {
  const n = Xtrain.length;
  const order = shuffleIndices(n, seed + 1);
  const results = {};
  for (const lambda of lambdas) {
    let se = 0, cnt = 0;
    for (let f = 0; f < folds; f++) {
      const holdout = new Set(order.filter((_, i) => i % folds === f));
      const trIdx = order.filter(i => !holdout.has(i));
      const hoIdx = [...holdout];
      if (!trIdx.length || !hoIdx.length) continue;
      const scale = fitScale(trIdx.map(i => Xtrain[i]));
      const Xz = trIdx.map(i => applyScale(Xtrain[i], scale));
      const fit = ridgeFit(Xz, trIdx.map(i => ytrain[i]), lambda);
      const m = { ...fit, scale };
      for (const i of hoIdx) { se += (predictRow(Xtrain[i], m) - ytrain[i]) ** 2; cnt++; }
    }
    results[String(lambda)] = +Math.sqrt(se / (cnt || 1)).toFixed(6);
  }
  let best = lambdas[0];
  for (const l of lambdas) if (results[String(l)] < results[String(best)]) best = l;
  return { best, cvRmseByLambda: results };
}

// ---------- ประกอบโมเดลจากแถวข้อมูล ----------
/**
 * @param {Array<{text?:string, features?:object, reactions:number}>} rows
 * @param {object} opts { seed, validRatio, lambdas, featureNames, source }
 * @returns {{model:object, metrics:object, predictionsAll:number[]}}
 */
export function buildModel(rows, opts = {}) {
  const seed = opts.seed ?? DEFAULT_SEED;
  const featureNames = opts.featureNames || MODEL_FEATURES;
  const lambdas = opts.lambdas || DEFAULT_LAMBDAS;
  const usable = rows.filter(r => r && Number.isFinite(Number(r.reactions)) && Number(r.reactions) >= 0
    && ((typeof r.text === 'string' && r.text.trim()) || (r.features && typeof r.features === 'object')));
  if (usable.length < 20) throw new Error(`ข้อมูลน้อยเกินไป: ${usable.length} แถว (ต้อง ≥ 20)`);
  const feats = usable.map(r => r.features || extractFeatures(r.text));
  const X = feats.map(f => featureVector(f, featureNames));
  const y = usable.map(r => Math.log10(Number(r.reactions) + 1));
  const split = splitTrainValid(usable.length, { seed, validRatio: opts.validRatio ?? 0.2 });
  const Xtr = split.train.map(i => X[i]), ytr = split.train.map(i => y[i]);
  const Xva = split.valid.map(i => X[i]), yva = split.valid.map(i => y[i]);

  const cv = crossValidateLambda(Xtr, ytr, { lambdas, seed });
  const scale = fitScale(Xtr);
  const fit = ridgeFit(Xtr.map(r => applyScale(r, scale)), ytr, cv.best);
  const core = { weights: fit.weights, bias: fit.bias, scale };

  const predTr = Xtr.map(r => predictRow(r, core));
  const predVa = Xva.map(r => predictRow(r, core));
  const predAll = X.map(r => predictRow(r, core));

  const wordsIdx = featureNames.indexOf('words');
  const metrics = {
    target: 'log10(reactions+1)',
    n: usable.length, nTrain: Xtr.length, nValid: Xva.length, lambda: cv.best, cvRmseByLambda: cv.cvRmseByLambda,
    valid: {
      n: Xva.length,
      spearman: +spearman(predVa, yva).toFixed(4),
      pearson: +pearson(predVa, yva).toFixed(4),
      rmse: +rmse(predVa, yva).toFixed(4),
      topDecilePrecision: +topDecilePrecision(predVa, yva, 0.1).toFixed(4),
      topDecileLift: +(topDecilePrecision(predVa, yva, 0.1) / 0.1).toFixed(2),
      topQuartilePrecision: +topDecilePrecision(predVa, yva, 0.25).toFixed(4),
      pairwiseAccuracy: +pairwiseAccuracy(predVa, yva).toFixed(4),
      baselineWordsSpearman: wordsIdx >= 0 ? +spearman(Xva.map(r => r[wordsIdx]), yva).toFixed(4) : null,
      stdActual: +Math.sqrt(yva.reduce((a, v) => a + (v - yva.reduce((p, q) => p + q, 0) / yva.length) ** 2, 0) / yva.length).toFixed(4),
    },
    train: {
      n: Xtr.length,
      spearman: +spearman(predTr, ytr).toFixed(4),
      pearson: +pearson(predTr, ytr).toFixed(4),
      rmse: +rmse(predTr, ytr).toFixed(4),
      topDecilePrecision: +topDecilePrecision(predTr, ytr, 0.1).toFixed(4),
    },
    featureCorrelations: featureNames.map((name, j) => ({
      feature: name,
      spearmanWithTarget: +spearman(X.map(r => r[j]), y).toFixed(4),
      weight: +fit.weights[j].toFixed(5),
      mean: +scale.mean[j].toFixed(4),
    })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
  };

  const model = {
    version: MODEL_VERSION,
    target: 'log10(reactions+1)',
    source: opts.source || 'fb-posts.json',
    trainedAt: opts.trainedAt || new Date().toISOString(),
    seed,
    nAll: usable.length, nTrain: Xtr.length, nValid: Xva.length,
    lambda: cv.best,
    features: featureNames,
    weights: fit.weights.map(w => +w.toFixed(8)),
    bias: +fit.bias.toFixed(8),
    scale: { mean: scale.mean.map(v => +v.toFixed(8)), std: scale.std.map(v => +v.toFixed(8)) },
    calibration: {
      // แมป "คะแนนดิบ log10" → เปอร์เซ็นไทล์เทียบทุกโพสต์ของเพจ (101 จุด 0..100)
      quantiles: quantiles(predAll, 100),
      reactionsQuantiles: quantiles(y, 100),
    },
    bands: { ...BANDS },
    metrics,
  };
  return { model, metrics, predictionsAll: predAll, split };
}

// ---------- CLI ----------
function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const postsPath = resolve(String(args.posts || DEFAULT_POSTS_PATH));
  const outPath = resolve(String(args.out || DEFAULT_OUT_PATH));
  const seed = Number(args.seed) || DEFAULT_SEED;
  if (!existsSync(postsPath)) {
    console.error(`[train-viral-score] ไม่พบไฟล์ข้อมูล: ${postsPath}`);
    process.exitCode = 1;
    return null;
  }
  const raw = JSON.parse(readFileSync(postsPath, 'utf8'));
  const posts = Array.isArray(raw) ? raw : (raw.posts || raw.items || []);
  const rows = posts.filter(p => p && typeof p.text === 'string' && p.shared !== true);
  console.log(`[train-viral-score] โพสต์ทั้งหมด ${posts.length} · ใช้ได้ ${rows.length} · seed ${seed}`);
  const t0 = Date.now();
  const { model, metrics } = buildModel(rows, { seed, source: `${postsPath.replace(/\\/g, '/').split('/').pop()} (${rows.length} โพสต์)` });
  console.log(`[train-viral-score] เทรนเสร็จ ${((Date.now() - t0) / 1000).toFixed(1)}s · ฟีเจอร์ ${model.features.length} · λ=${model.lambda}`);
  console.log(`  CV RMSE ตาม λ: ${Object.entries(metrics.cvRmseByLambda).map(([l, v]) => `${l}→${v}`).join(' · ')}`);
  console.log(`  VALID n=${metrics.valid.n}: Spearman ${metrics.valid.spearman} · Pearson ${metrics.valid.pearson} · RMSE ${metrics.valid.rmse} (std จริง ${metrics.valid.stdActual})`);
  console.log(`  VALID top-decile precision ${metrics.valid.topDecilePrecision} (lift ×${metrics.valid.topDecileLift}) · top-quartile ${metrics.valid.topQuartilePrecision} · pairwise ${metrics.valid.pairwiseAccuracy}`);
  console.log(`  baseline (words อย่างเดียว) Spearman ${metrics.valid.baselineWordsSpearman}`);
  console.log(`  TRAIN n=${metrics.train.n}: Spearman ${metrics.train.spearman} · RMSE ${metrics.train.rmse}`);
  console.log('  น้ำหนักแรงสุด 12 ตัว (z-space):');
  for (const f of metrics.featureCorrelations.slice(0, 12)) {
    console.log(`    ${f.weight >= 0 ? '+' : ''}${f.weight.toFixed(4)}  ${f.feature}  (ρ เดี่ยว ${f.spearmanWithTarget}, mean ${f.mean})`);
  }
  if (args.dry) {
    console.log('[train-viral-score] --dry: ไม่เขียนไฟล์');
    return model;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(model, null, 2) + '\n', 'utf8');
  console.log(`[train-viral-score] เขียนโมเดล → ${outPath}`);
  return model;
}

const invokedDirectly = (() => {
  try { return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url; } catch { return false; }
})();
if (invokedDirectly) {
  main().catch(err => { console.error('[train-viral-score] ล้ม:', err?.message || err); process.exitCode = 1; });
}

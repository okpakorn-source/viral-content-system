/* eslint-disable no-console -- This CLI must report match evidence and warnings to the operator. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT_POSTS = path.join(PROJECT_ROOT, '_hits-formula-workspace', 'fb-posts-parsed.json');
// ★ Fable เติม (รีวิวร่วม 14 ส.ค.): คลังครูตัวจริง = ตาราง viral_examples (202 ใบ) ไม่ใช่ไฟล์หน้าบ้าน 71 ใบ
//   ชี้ไฟล์ส่งออกด้วย MATCH_LIBRARY_FILE (สร้างโดย scripts/export-viral-examples.mjs — อ่าน Supabase อย่างเดียว)
const INPUT_LIBRARY = process.env.MATCH_LIBRARY_FILE
  ? path.resolve(process.env.MATCH_LIBRARY_FILE)
  : path.join(PROJECT_ROOT, 'data', 'viral-library.json');
const OUTPUT_LIKES = path.join(PROJECT_ROOT, 'data', 'viral-likes-real.json');

// Task-level thresholds. None of these values is tied to a particular story.
const MATCH_CONFIG = Object.freeze({
  contentKeyLength: 120,
  expectedPostCount: 1422,
  expectedLibraryCount: 202,
  minimumExactKeyLength: 80,
  gramSize: 4,
  comparedTextLength: 900,
  comparedPrefixLength: 240,
  maximumDistinctiveDocumentFrequency: 12,
  minimumSharedDistinctiveTokens: 3,
  minimumDistinctiveWeight: 13,
  minimumFullTextSimilarity: 0.14,
  minimumCompositeScore: 0.22,
  minimumScoreMargin: 0.035,
  keyCoverageWeight: 0.5,
  fullTextWeight: 0.4,
  prefixWeight: 0.1,
});

const THAI_SEGMENTER = new Intl.Segmenter('th', { granularity: 'word' });
const STOP_WORDS = new Set([
  'การ', 'ของ', 'ที่', 'ใน', 'เป็น', 'และ', 'ได้', 'ให้', 'มี', 'กับ', 'ก็', 'จะ', 'จาก',
  'แต่', 'ไม่', 'ไป', 'มา', 'นี้', 'นั้น', 'ซึ่ง', 'โดย', 'เพื่อ', 'เพราะ', 'คน', 'เรื่อง',
  'ว่า', 'แล้ว', 'ยัง', 'เรา', 'เขา', 'เธอ', 'ผม', 'ฉัน', 'มัน', 'วัน', 'ปี', 'ครั้ง',
  'หนึ่ง', 'เมื่อ', 'หลัง', 'ก่อน', 'ทุก', 'ทำ', 'อยู่', 'ถึง', 'แบบ', 'มาก', 'แค่', 'อย่าง',
  'ตัว', 'เอง', 'ใคร', 'อะไร', 'ต้อง', 'เคย', 'เลย', 'หรือ', 'จริง', 'กว่า', 'อีก', 'จน',
  'คำ', 'ความ', 'หาก', 'แม้', 'ส่วน', 'บอก', 'ใช้', 'ทาง', 'ชีวิต', 'บ้าน', 'ลูก', 'พ่อ',
  'แม่', 'อายุ', 'วันนี้', 'ตอน',
].map(normalizeSearchText));

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

// This intentionally mirrors viralFewshot.js::_normLikeKey, the current consumer contract.
function normalizeOverlayKey(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function contentKeyOf(value, config = MATCH_CONFIG) {
  return normalizeOverlayKey(value).slice(0, config.contentKeyLength);
}

// Search normalization preserves Thai combining marks. They are evidence during matching even
// though the current overlay consumer omits them from its lookup key.
function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('th-TH')
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

function tokenLength(token) {
  return Array.from(token).length;
}

function tokenize(value) {
  const normalized = String(value ?? '').normalize('NFKC').toLocaleLowerCase('th-TH');
  const tokens = [];
  for (const segment of THAI_SEGMENTER.segment(normalized)) {
    if (!segment.isWordLike) continue;
    const token = normalizeSearchText(segment.segment);
    if (!token || STOP_WORDS.has(token)) continue;
    if (!/^\d{2,}$/u.test(token) && tokenLength(token) < 3) continue;
    tokens.push(token);
  }
  return new Set(tokens);
}

function shingles(value, size) {
  const result = new Set();
  for (let index = 0; index <= value.length - size; index += 1) {
    result.add(value.slice(index, index + size));
  }
  return result;
}

function diceSimilarity(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return (2 * intersection) / (left.size + right.size);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a JSON array`);
}

function validateFacebookPosts(rows, label = 'Facebook posts') {
  requireArray(rows, label);
  const seenIds = new Set();
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError(`${label}[${index}] must be an object`);
    }
    const id = String(row.id ?? '').trim();
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    const likes = Number(row.likes);
    if (!id) throw new TypeError(`${label}[${index}].id is required`);
    if (seenIds.has(id)) throw new TypeError(`${label} contains duplicate id ${id}`);
    if (!text) throw new TypeError(`${label}[${index}].text is required`);
    if (!Number.isSafeInteger(likes) || likes < 0) {
      throw new TypeError(`${label}[${index}].likes must be a non-negative safe integer`);
    }
    seenIds.add(id);
    return { ...row, id, text, likes };
  });
}

function validateLibraryRows(rows, label = 'Viral library') {
  requireArray(rows, label);
  const seenIds = new Set();
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError(`${label}[${index}] must be an object`);
    }
    const id = String(row.id ?? '').trim();
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!id) throw new TypeError(`${label}[${index}].id is required`);
    if (seenIds.has(id)) throw new TypeError(`${label} contains duplicate id ${id}`);
    if (!content && !title) throw new TypeError(`${label}[${index}] needs content or title`);
    seenIds.add(id);
    return { ...row, id, content, title };
  });
}

function preparePosts(posts, config) {
  return posts.map((post) => {
    const normalizedText = normalizeSearchText(post.text);
    return {
      post,
      contentKey: contentKeyOf(post.text, config),
      tokens: tokenize(post.text),
      fullGrams: shingles(normalizedText.slice(0, config.comparedTextLength), config.gramSize),
      prefixGrams: shingles(normalizedText.slice(0, config.comparedPrefixLength), config.gramSize),
    };
  });
}

function comparePreparedPosts(left, right) {
  return right.score - left.score
    || right.fullTextSimilarity - left.fullTextSimilarity
    || right.distinctiveWeight - left.distinctiveWeight
    || left.prepared.post.id.localeCompare(right.prepared.post.id);
}

function matchRows(posts, libraryRows, config = MATCH_CONFIG) {
  const preparedPosts = preparePosts(posts, config);
  const exactIndex = new Map();
  const documentFrequency = new Map();

  for (const prepared of preparedPosts) {
    const bucket = exactIndex.get(prepared.contentKey) ?? [];
    bucket.push(prepared);
    exactIndex.set(prepared.contentKey, bucket);
    for (const token of prepared.tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const matches = [];
  const ambiguous = [];
  const unmatched = [];

  for (const library of libraryRows) {
    const sourceText = library.content || library.title;
    const contentKey = contentKeyOf(sourceText, config);
    const exactCandidates = exactIndex.get(contentKey) ?? [];

    if (contentKey.length >= config.minimumExactKeyLength && exactCandidates.length === 1) {
      matches.push({
        library,
        post: exactCandidates[0].post,
        contentKey,
        matchedBy: 'contentKey120',
        score: 1,
        margin: 1,
        sharedDistinctiveTokens: [],
      });
      continue;
    }

    if (contentKey.length >= config.minimumExactKeyLength && exactCandidates.length > 1) {
      ambiguous.push({
        library,
        contentKey,
        reason: 'duplicate-content-key',
        candidateIds: exactCandidates.map(({ post }) => post.id),
      });
      continue;
    }

    const normalizedSource = normalizeSearchText(sourceText);
    const queryTokens = tokenize(`${library.title} ${library.content}`);
    const distinctiveTokens = [...queryTokens].filter((token) => {
      const frequency = documentFrequency.get(token) ?? 0;
      return frequency > 0 && frequency <= config.maximumDistinctiveDocumentFrequency;
    });
    const weights = new Map(distinctiveTokens.map((token) => [
      token,
      Math.log((posts.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1,
    ]));
    const totalDistinctiveWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    const sourceFullGrams = shingles(
      normalizedSource.slice(0, config.comparedTextLength),
      config.gramSize,
    );
    const sourcePrefixGrams = shingles(
      normalizedSource.slice(0, config.comparedPrefixLength),
      config.gramSize,
    );

    const scored = preparedPosts.map((prepared) => {
      const sharedDistinctiveTokens = distinctiveTokens.filter((token) => prepared.tokens.has(token));
      const distinctiveWeight = sharedDistinctiveTokens.reduce(
        (sum, token) => sum + weights.get(token),
        0,
      );
      const keyCoverage = totalDistinctiveWeight > 0
        ? distinctiveWeight / totalDistinctiveWeight
        : 0;
      const fullTextSimilarity = diceSimilarity(sourceFullGrams, prepared.fullGrams);
      const prefixSimilarity = diceSimilarity(sourcePrefixGrams, prepared.prefixGrams);
      const score = config.keyCoverageWeight * keyCoverage
        + config.fullTextWeight * fullTextSimilarity
        + config.prefixWeight * prefixSimilarity;
      return {
        prepared,
        sharedDistinctiveTokens,
        distinctiveWeight,
        keyCoverage,
        fullTextSimilarity,
        prefixSimilarity,
        score,
      };
    }).sort(comparePreparedPosts);

    const best = scored[0];
    const runnerUp = scored[1];
    const margin = best ? best.score - (runnerUp?.score ?? 0) : 0;
    const hasEnoughEvidence = Boolean(best)
      && best.sharedDistinctiveTokens.length >= config.minimumSharedDistinctiveTokens
      && best.distinctiveWeight >= config.minimumDistinctiveWeight
      && best.fullTextSimilarity >= config.minimumFullTextSimilarity
      && best.score >= config.minimumCompositeScore;

    if (hasEnoughEvidence && margin >= config.minimumScoreMargin) {
      matches.push({
        library,
        post: best.prepared.post,
        contentKey,
        matchedBy: 'distinctiveKeys',
        score: best.score,
        margin,
        sharedDistinctiveTokens: best.sharedDistinctiveTokens,
      });
    } else if (hasEnoughEvidence) {
      ambiguous.push({
        library,
        contentKey,
        reason: 'candidate-score-margin-too-small',
        candidateIds: [best.prepared.post.id, runnerUp?.prepared.post.id].filter(Boolean),
        score: best.score,
        margin,
      });
    } else {
      unmatched.push({
        library,
        contentKey,
        reason: 'insufficient-distinctive-evidence',
        candidateIds: best ? [best.prepared.post.id] : [],
        score: best?.score ?? 0,
        margin,
      });
    }
  }

  return { matches, ambiguous, unmatched };
}

function sameEntry(left, right) {
  return left.likes === right.likes && left.matchedBy === right.matchedBy;
}

function addOutputEntry(target, key, entry, label) {
  if (!key) throw new Error(`Cannot write an empty ${label} key`);
  if (target[key] && !sameEntry(target[key], entry)) {
    throw new Error(`Conflicting ${label} mapping for ${key}`);
  }
  target[key] = entry;
}

function sortObjectKeys(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function buildOutput(matches) {
  const byId = {};
  const byKey = {};
  for (const match of matches) {
    const entry = { likes: match.post.likes, matchedBy: match.matchedBy };
    addOutputEntry(byId, match.library.id, entry, 'id');
    addOutputEntry(byKey, match.contentKey, entry, 'contentKey');
  }
  return { byId: sortObjectKeys(byId), byKey: sortObjectKeys(byKey) };
}

function writeJsonAtomically(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    assert.deepEqual(readJson(tempPath), value, 'temporary output failed read-back verification');
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function printSummary(posts, libraryRows, result, output) {
  const skipped = result.ambiguous.length + result.unmatched.length;
  console.log(`[match-real-likes] inputs: posts=${posts.length}, library=${libraryRows.length}`);
  if (posts.length !== MATCH_CONFIG.expectedPostCount) {
    console.warn(`[match-real-likes] WARNING: brief expects ${MATCH_CONFIG.expectedPostCount} posts, file has ${posts.length}`);
  }
  if (libraryRows.length !== MATCH_CONFIG.expectedLibraryCount) {
    console.warn(`[match-real-likes] WARNING: brief expects ${MATCH_CONFIG.expectedLibraryCount} library rows, file has ${libraryRows.length}`);
  }
  console.log(
    `[match-real-likes] result: matched=${result.matches.length}/${libraryRows.length}, `
      + `ambiguous=${result.ambiguous.length}, noReliableCandidate=${result.unmatched.length}, skipped=${skipped}`,
  );
  console.log(
    `[match-real-likes] methods: contentKey120=${result.matches.filter((row) => row.matchedBy === 'contentKey120').length}, `
      + `distinctiveKeys=${result.matches.filter((row) => row.matchedBy === 'distinctiveKeys').length}`,
  );

  const examples = [...result.matches]
    .sort((left, right) => right.score - left.score
      || right.post.likes - left.post.likes
      || left.library.id.localeCompare(right.library.id))
    .slice(0, 5);
  console.log('[match-real-likes] high-confidence examples:');
  examples.forEach((match, index) => {
    console.log(
      `  ${index + 1}. ${match.library.id} -> ${match.post.id} | likes=${match.post.likes} `
        + `| via=${match.matchedBy} | score=${match.score.toFixed(3)} | ${match.library.title.slice(0, 72)}`,
    );
  });
  console.log(
    `[match-real-likes] output: ${OUTPUT_LIKES} `
      + `(byId=${Object.keys(output.byId).length}, byKey=${Object.keys(output.byKey).length})`,
  );
}

function runSelfTests() {
  let passed = 0;
  const test = (name, callback) => {
    callback();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  };

  test('overlay normalization removes whitespace, punctuation, emoji, and mirrors Thai-mark behavior', () => {
    assert.equal(normalizeOverlayKey(' A😀- B\n'), 'AB');
    assert.equal(normalizeOverlayKey('ก้อย'), 'กอย');
    assert.equal(normalizeSearchText('ก้อย').includes('้'), true);
  });

  test('contentKey is capped at exactly 120 normalized characters', () => {
    assert.equal(contentKeyOf('ก'.repeat(140)).length, 120);
  });

  test('input validation rejects unsafe likes', () => {
    assert.throws(
      () => validateFacebookPosts([{ id: 'p1', text: 'valid text', likes: -1 }], 'fixture'),
      /non-negative safe integer/,
    );
  });

  const exactConfig = { ...MATCH_CONFIG, minimumExactKeyLength: 20 };
  test('unique normalized prefix produces an exact match', () => {
    const repeated = 'เคน ภูภูมิ ซื้อสวนทุเรียนที่สงขลา '.repeat(6);
    const posts = validateFacebookPosts([{ id: 'p1', text: repeated, likes: 100 }], 'fixture');
    const library = validateLibraryRows([{ id: 'l1', title: 'เคน', content: `เคน-ภูภูมิ😀 ซื้อสวนทุเรียนที่สงขลา ${' '.repeat(2)}${repeated.slice(34)}` }], 'fixture');
    const result = matchRows(posts, library, exactConfig);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].matchedBy, 'contentKey120');
  });

  const heuristicConfig = {
    ...MATCH_CONFIG,
    minimumExactKeyLength: 999,
    maximumDistinctiveDocumentFrequency: 10,
    minimumSharedDistinctiveTokens: 3,
    minimumDistinctiveWeight: 0,
    minimumFullTextSimilarity: 0,
    minimumCompositeScore: 0,
    minimumScoreMargin: 0.01,
  };
  test('distinctive person and event keys recover a rewritten opening', () => {
    const posts = validateFacebookPosts([
      { id: 'right', text: '34 ปี เคน ภูภูมิ ลงมือทำสวนทุเรียน 200 ไร่ที่สงขลา ไม่ซื้อรถหรู', likes: 200 },
      { id: 'wrong', text: '20 ปี เวียร์ เลือกซื้อสวนทุเรียน 20 ไร่ และไม่ซื้อรถหรู', likes: 300 },
    ], 'fixture');
    const library = validateLibraryRows([{
      id: 'l1',
      title: 'เคน ภูภูมิ 200 ไร่',
      content: 'ไม่ซื้อแบรนด์เนม เคน ภูภูมิ อายุ 34 เลือกที่ดินสงขลา 200 ไร่ทำสวนทุเรียน',
    }], 'fixture');
    const result = matchRows(posts, library, heuristicConfig);
    assert.equal(result.matches[0]?.post.id, 'right');
    assert.equal(result.matches[0]?.matchedBy, 'distinctiveKeys');
  });

  test('equal plausible candidates are skipped as ambiguous', () => {
    const duplicated = 'เคน ภูภูมิ ทำสวนทุเรียน 200 ไร่ ที่สงขลา';
    const posts = validateFacebookPosts([
      { id: 'p1', text: duplicated, likes: 100 },
      { id: 'p2', text: duplicated, likes: 200 },
    ], 'fixture');
    const library = validateLibraryRows([{ id: 'l1', title: 'เคน ภูภูมิ', content: duplicated }], 'fixture');
    const result = matchRows(posts, library, heuristicConfig);
    assert.equal(result.matches.length, 0);
    assert.equal(result.ambiguous.length, 1);
  });

  test('conflicting contentKey output cannot be written', () => {
    const sharedLibrary = { id: 'l1', content: 'same content', title: '' };
    assert.throws(() => buildOutput([
      { library: sharedLibrary, post: { likes: 1 }, contentKey: 'same', matchedBy: 'contentKey120' },
      { library: { ...sharedLibrary, id: 'l2' }, post: { likes: 2 }, contentKey: 'same', matchedBy: 'distinctiveKeys' },
    ]), /Conflicting contentKey/);
  });

  console.log(`[match-real-likes] self-test passed ${passed}/${passed}`);
}

function main() {
  const posts = validateFacebookPosts(readJson(INPUT_POSTS));
  const libraryRows = validateLibraryRows(readJson(INPUT_LIBRARY));
  // ★ Sol DB-audit ข้อ 7 (14 ส.ค.): กันหยิบคลังผิดชุด — ไฟล์หน้าบ้าน 71 ใบ (id คนละชุดกับตาราง 202 ทั้งหมด)
  //   คลังครูตัวจริง = viral_examples 202 ใบ → รัน scripts/export-viral-examples.mjs แล้วตั้ง MATCH_LIBRARY_FILE
  if (!process.env.MATCH_LIBRARY_FILE && libraryRows.length < 100) {
    throw new Error(`คลังอินพุตมีแค่ ${libraryRows.length} ใบ — นี่คือไฟล์หน้าบ้าน ไม่ใช่คลังครูจริง 202 ใบ · รัน scripts/export-viral-examples.mjs แล้วตั้ง MATCH_LIBRARY_FILE ชี้ไฟล์ส่งออกก่อน`);
  }
  const result = matchRows(posts, libraryRows);
  const output = buildOutput(result.matches);
  writeJsonAtomically(OUTPUT_LIKES, output);
  assert.deepEqual(readJson(OUTPUT_LIKES), output, 'final output failed read-back verification');
  printSummary(posts, libraryRows, result, output);
}

const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === '--self-test') {
    runSelfTests();
  } else if (args.length === 0) {
    main();
  } else {
    throw new Error(`unknown arguments: ${args.join(' ')}`);
  }
} catch (error) {
  console.error(`[match-real-likes] ERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
}

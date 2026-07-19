// ============================================================
// 🧪 Research Sources (เฟส 4) — offline unit test (pure-ish, mock fetch/deps)
// ------------------------------------------------------------
// Target: src/lib/services/deskV2/researchSources.js
//   • classifyFreshness(publishedAt, policy, now)
//   • normalizeSourceItem(raw, context)
//   • searchSource({ source, queries, maxResults, maxAgeDays, now, fetchImpl, deps })
// 🔴 ห้ามยิง network จริง — ทุกเทสฉีด fetchImpl/deps เป็น mock ทั้งหมด
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FRESHNESS_POLICY,
  classifyFreshness,
  normalizeSourceItem,
  searchSource,
} from '../src/lib/services/deskV2/researchSources.js';

const NOW = new Date('2026-07-19T00:00:00Z');
const IMAGE_KEYS = ['imageUrl', 'thumbnail', 'image', 'img', 'enclosure', 'thumbnails'];

function assertNoImageKeys(item, label = '') {
  for (const k of IMAGE_KEYS) {
    assert.ok(!(k in item), `${label} must not carry image key: ${k}`);
  }
}

// ================================================================
// FRESHNESS_POLICY
// ================================================================
test('FRESHNESS_POLICY: ค่า maxAgeDays ต่อแหล่งตามที่ตกลง', () => {
  assert.deepEqual(FRESHNESS_POLICY, {
    directRss: 3, serperNews: 7, googleNewsRss: 7, youtubeWatch: 21, interview: 45,
  });
});

// ================================================================
// classifyFreshness — ครบทุกป้าย (policy คงที่: fresh<=2, recent<=5, stale<=7)
// ================================================================
const POLICY_7 = { fresh: 2, recent: 5, stale: 7 };

test('classifyFreshness: fresh เมื่ออายุ <= policy.fresh', () => {
  assert.equal(classifyFreshness('2026-07-19T00:00:00Z', POLICY_7, NOW), 'fresh'); // ageDays=0
  assert.equal(classifyFreshness('2026-07-17T00:00:00Z', POLICY_7, NOW), 'fresh'); // ageDays=2
});

test('classifyFreshness: recent เมื่อ policy.fresh < อายุ <= policy.recent', () => {
  assert.equal(classifyFreshness('2026-07-16T00:00:00Z', POLICY_7, NOW), 'recent'); // ageDays=3
  assert.equal(classifyFreshness('2026-07-14T00:00:00Z', POLICY_7, NOW), 'recent'); // ageDays=5
});

test('classifyFreshness: evergreen เมื่อ policy.recent < อายุ <= policy.stale', () => {
  assert.equal(classifyFreshness('2026-07-13T00:00:00Z', POLICY_7, NOW), 'evergreen'); // ageDays=6
  assert.equal(classifyFreshness('2026-07-12T00:00:00Z', POLICY_7, NOW), 'evergreen'); // ageDays=7
});

test('classifyFreshness: stale เมื่ออายุ > policy.stale', () => {
  assert.equal(classifyFreshness('2026-07-11T00:00:00Z', POLICY_7, NOW), 'stale'); // ageDays=8
  assert.equal(classifyFreshness('2026-06-01T00:00:00Z', POLICY_7, NOW), 'stale'); // เก่ามาก
});

test('classifyFreshness: unknown เมื่อไม่มีวันที่/parse ไม่ได้', () => {
  assert.equal(classifyFreshness(null, POLICY_7, NOW), 'unknown');
  assert.equal(classifyFreshness('', POLICY_7, NOW), 'unknown');
  assert.equal(classifyFreshness('not-a-date', POLICY_7, NOW), 'unknown');
  assert.equal(classifyFreshness(undefined, POLICY_7, NOW), 'unknown');
});

// ================================================================
// normalizeSourceItem
// ================================================================
test('normalizeSourceItem: ทิ้ง field ภาพทุกตัว (loop ทุก key ของ raw)', () => {
  const raw = {
    url: 'https://example.com/a', title: 'test title A',
    imageUrl: 'https://img/1.jpg', thumbnail: 'https://img/2.jpg', image: 'https://img/3.jpg',
    img: 'https://img/4.jpg', enclosure: 'https://img/5.jpg', thumbnails: { small: 'https://img/6.jpg' },
    publishedAt: '2026-07-18T00:00:00.000Z', source: 'unit-test-source',
  };
  const item = normalizeSourceItem(raw, { sourceType: 'direct-rss', discoveredVia: 'direct-rss', maxAgeDays: 3, now: NOW });
  // (ก) loop ทุก key ของ raw เอง — ตัวที่เป็นชื่อ field ภาพต้องไม่หลุดเข้า item
  for (const k of Object.keys(raw)) {
    if (IMAGE_KEYS.includes(k)) assert.ok(!(k in item), `raw image key '${k}' must not leak into item`);
  }
  assertNoImageKeys(item, 'normalizeSourceItem');
  assert.equal(item.url, 'https://example.com/a');
  assert.equal(item.title, 'test title A');
});

test('normalizeSourceItem: sanitize ตัด control/zero-width char + ยุบช่องว่าง', () => {
  // สร้างอักขระล่องหน/ควบคุมด้วย String.fromCharCode (กันคลาดเคลื่อนตอนเขียนไฟล์ต้นฉบับ)
  const ZWSP = String.fromCharCode(0x200b); // zero-width space
  const CTRL = String.fromCharCode(0);      // control char (NUL)
  const raw = {
    url: '  https://example.com/x  ',
    title: 'AAA' + ZWSP + 'BBB   CCC',
    snippet: 'DDD' + CTRL + 'EEE  FFF',
  };
  const item = normalizeSourceItem(raw, { sourceType: 'serper-news', discoveredVia: 'serper-news', maxAgeDays: 7, now: NOW });
  assert.equal(item.url, 'https://example.com/x');
  assert.equal(item.title, 'AAA BBB CCC');
  assert.equal(item.snippet, 'DDD EEE FFF');
});

test('normalizeSourceItem: ใส่ ageDays/freshness ถูกต้องตาม maxAgeDays', () => {
  const raw = { url: 'https://example.com/a', title: 'news A', publishedAt: '2026-07-13T00:00:00.000Z' };
  const item = normalizeSourceItem(raw, { sourceType: 'serper-news', discoveredVia: 'serper-news', maxAgeDays: 7, now: NOW });
  assert.equal(item.ageDays, 6);
  assert.equal(item.freshness, 'evergreen'); // maxAgeDays=7 → เกณฑ์ภายใน {fresh:2,recent:5,stale:7} → 6 อยู่ช่วง evergreen
  assert.equal(item.publishedAt, '2026-07-13T00:00:00.000Z');
});

test('normalizeSourceItem: ไม่มี publishedAt → ageDays null, freshness unknown', () => {
  const item = normalizeSourceItem({ url: 'https://example.com/b', title: 'news B' }, { sourceType: 'direct-rss', maxAgeDays: 3, now: NOW });
  assert.equal(item.publishedAt, null);
  assert.equal(item.ageDays, null);
  assert.equal(item.freshness, 'unknown');
});

test('normalizeSourceItem: เดา channel/platformGroup แบบง่าย', () => {
  const yt = normalizeSourceItem({ url: 'https://youtu.be/abc123', title: 'clip test' }, { sourceType: 'youtube-watch', discoveredVia: 'youtube-watch', maxAgeDays: 21, now: NOW });
  assert.equal(yt.channel, 'youtube');
  assert.equal(yt.platformGroup, 'youtube');

  const web = normalizeSourceItem({ url: 'https://www.thairath.co.th/entertain/x', title: 'web news' }, { sourceType: 'direct-rss', discoveredVia: 'direct-rss', maxAgeDays: 3, now: NOW });
  assert.equal(web.channel, 'google');
  assert.equal(web.platformGroup, 'web');

  const broken = normalizeSourceItem({ url: '', title: 'broken link' }, { sourceType: 'serper-news', discoveredVia: 'serper-news', maxAgeDays: 7, now: NOW });
  assert.equal(broken.channel, 'serper-news'); // ไม่รู้จัก host → ใช้ discoveredVia เดิม (ไม่มโน)
  assert.equal(broken.platformGroup, 'web');
});

// ================================================================
// searchSource — serper-news
// ================================================================
test('searchSource(serper-news): normalize ถูก, ไม่มีภาพ, calls = จำนวนคำค้น', async () => {
  let receivedCalls = 0;
  const mockFetch = async (url, opts) => {
    receivedCalls++;
    assert.equal(url, 'https://google.serper.dev/news');
    assert.equal(opts.method, 'POST');
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        news: [{
          title: `news for ${body.q}`,
          link: `https://example.com/news/${encodeURIComponent(body.q)}`,
          snippet: 'short summary',
          date: '3 hours ago',
          source: 'Example News',
          imageUrl: 'https://example.com/img/cover.jpg',
        }],
      }),
    };
  };

  const result = await searchSource({
    source: 'serper-news', queries: ['query-one', 'query-two'], maxResults: 10, maxAgeDays: 7, now: NOW, fetchImpl: mockFetch,
  });

  assert.equal(result.failed, false);
  assert.equal(result.sourceType, 'serper-news');
  assert.equal(result.calls, 2);
  assert.equal(receivedCalls, 2);
  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assertNoImageKeys(item, 'serper-news item');
    assert.equal(item.sourceType, 'serper-news');
    assert.equal(item.discoveredVia, 'serper-news');
    assert.equal(item.sourceName, 'Example News');
    // "3 hours ago" เทียบกับ NOW → ageDays คำนวณได้ ไม่ null
    assert.equal(item.ageDays, 0);
    assert.equal(item.freshness, 'fresh');
  }
  assert.equal(result.items[0].title, 'news for query-one');
  assert.equal(result.items[1].title, 'news for query-two');
});

// ================================================================
// searchSource — google-news-rss
// ================================================================
const GNEWS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Google News</title>
<item>
<title><![CDATA[test news from Google News RSS]]></title>
<link>https://example.com/news/gnews-1</link>
<pubDate>Sat, 18 Jul 2026 10:00:00 GMT</pubDate>
<description><![CDATA[short rss description]]></description>
<source url="https://example.com">Example Source</source>
<enclosure url="https://example.com/img/thumb.jpg" type="image/jpeg"/>
</item>
</channel></rss>`;

test('searchSource(google-news-rss): parse XML fixture ได้ถูกต้อง, ไม่มีภาพ', async () => {
  const mockFetch = async (url) => {
    assert.ok(String(url).startsWith('https://news.google.com/rss/search?q='));
    return { ok: true, status: 200, text: async () => GNEWS_XML };
  };

  const result = await searchSource({
    source: 'google-news-rss', queries: ['test-query'], maxAgeDays: 7, now: NOW, fetchImpl: mockFetch,
  });

  assert.equal(result.failed, false);
  assert.equal(result.sourceType, 'google-news-rss');
  assert.equal(result.calls, 1);
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assertNoImageKeys(item, 'google-news-rss item');
  assert.equal(item.title, 'test news from Google News RSS');
  assert.equal(item.url, 'https://example.com/news/gnews-1');
  assert.equal(item.publishedAt, '2026-07-18T10:00:00.000Z');
  assert.equal(item.ageDays, 0); // 14 ชม. ก่อน NOW → ปัดลง 0 วัน
  assert.equal(item.freshness, 'fresh');
});

// ================================================================
// searchSource — direct-rss
// ================================================================
test('searchSource(direct-rss): เรียก deps.fetchEntRss, normalize ถูก, ไม่มีภาพ', async () => {
  const mockFetchEntRss = async ({ maxAgeDays } = {}) => {
    assert.equal(maxAgeDays, 3);
    return [{
      url: 'https://example.com/ent/1', title: 'entertainment news test',
      publishedAt: '2026-07-18T00:00:00.000Z', source: 'Thairath Entertain',
      imageUrl: 'https://example.com/img/ent1.jpg', lane: 'entrss',
    }];
  };

  const result = await searchSource({
    source: 'direct-rss', maxAgeDays: 3, now: NOW, deps: { fetchEntRss: mockFetchEntRss },
  });

  assert.equal(result.failed, false);
  assert.equal(result.sourceType, 'direct-rss');
  assert.equal(result.calls, 1);
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assertNoImageKeys(item, 'direct-rss item');
  assert.equal(item.sourceName, 'Thairath Entertain');
  assert.equal(item.sourceType, 'direct-rss');
  assert.equal(item.discoveredVia, 'direct-rss');
});

// ================================================================
// searchSource — youtube-watch
// ================================================================
test('searchSource(youtube-watch): เรียก deps.fetchYouTubeChannels, normalize ถูก, ไม่มีภาพ', async () => {
  const mockFetchYouTubeChannels = async ({ maxAgeDays } = {}) => {
    assert.equal(maxAgeDays, 21);
    return [{
      url: 'https://www.youtube.com/watch?v=abc123', title: 'interview test clip',
      publishedAt: '2026-07-10T00:00:00.000Z', source: 'Hone Krasae', watchChannel: 'Hone Krasae',
      views: 12000, imageUrl: 'https://example.com/img/yt1.jpg', lane: 'video',
    }];
  };

  const result = await searchSource({
    source: 'youtube-watch', maxAgeDays: 21, now: NOW, deps: { fetchYouTubeChannels: mockFetchYouTubeChannels },
  });

  assert.equal(result.failed, false);
  assert.equal(result.sourceType, 'youtube-watch');
  assert.equal(result.calls, 1);
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assertNoImageKeys(item, 'youtube-watch item');
  assert.equal(item.sourceName, 'Hone Krasae');
  assert.equal(item.channel, 'youtube');
  assert.equal(item.platformGroup, 'youtube');
  assert.equal(item.ageDays, 9);
  assert.equal(item.freshness, 'recent'); // maxAgeDays=21 → {fresh:7,recent:14,stale:21} → 9 อยู่ recent
});

// ================================================================
// searchSource — partial failure (ห้าม throw, error ต้องไม่มีคีย์)
// ================================================================
test('searchSource(serper-news): fetchImpl โยน error → {failed:true} ไม่ throw, error ไม่มีคีย์', async () => {
  const throwingFetch = async () => { throw new Error('mock-network-unreachable'); };
  const result = await searchSource({
    source: 'serper-news', queries: ['broken-query'], maxAgeDays: 7, now: NOW, fetchImpl: throwingFetch,
  });
  assert.equal(result.failed, true);
  assert.deepEqual(result.items, []);
  assert.equal(result.sourceType, 'serper-news');
  assert.ok(result.error && result.error.length > 0);
  assert.ok(!/key/i.test(result.error), `error must not contain "key": ${result.error}`);
  assert.ok(!/SERPER_API_KEY/i.test(result.error), `error must not contain SERPER_API_KEY: ${result.error}`);
});

test('searchSource(google-news-rss): HTTP error (res.ok=false) → {failed:true} ไม่ throw', async () => {
  const badFetch = async () => ({ ok: false, status: 500, text: async () => '' });
  const result = await searchSource({
    source: 'google-news-rss', queries: ['broken-query'], maxAgeDays: 7, now: NOW, fetchImpl: badFetch,
  });
  assert.equal(result.failed, true);
  assert.deepEqual(result.items, []);
});

test('searchSource(direct-rss): deps.fetchEntRss โยน error → {failed:true} ไม่ throw', async () => {
  const throwingDeps = async () => { throw new Error('feed-down'); };
  const result = await searchSource({
    source: 'direct-rss', maxAgeDays: 3, now: NOW, deps: { fetchEntRss: throwingDeps },
  });
  assert.equal(result.failed, true);
  assert.deepEqual(result.items, []);
  assert.equal(result.sourceType, 'direct-rss');
});

// ================================================================
// searchSource — instagram (stub เฉยๆ ยังไม่ยิงจริง)
// ================================================================
test('searchSource(instagram): คืน items ว่าง, failed=false, note ต้องเครื่องทีม', async () => {
  const result = await searchSource({ source: 'instagram', now: NOW });
  assert.deepEqual(result, { items: [], failed: false, sourceType: 'instagram', calls: 0, note: 'ต้องเครื่องทีม' });
});

// ================================================================
// static self-check — ห้าม import * และห้ามพึ่งชั้นเก็บข้อมูล/ตัวเรียกโมเดลเอไอ/ระบบจัดคิวต้องห้าม
// ================================================================
test('static: researchSources.js ไม่มี import * และไม่อ้างถึงโมดูลต้องห้าม', () => {
  const modPath = fileURLToPath(new URL('../src/lib/services/deskV2/researchSources.js', import.meta.url));
  const src = readFileSync(modPath, 'utf8');
  assert.ok(!/import\s*\*/.test(src), 'must not import *');
  assert.ok(!/openai/i.test(src), 'must not reference openai');
  assert.ok(!/aiRouter/i.test(src), 'must not reference aiRouter');
  assert.ok(!/persistStore/i.test(src), 'must not reference persistStore');
  assert.ok(!/interviewMiner/i.test(src), 'must not reference interviewMiner');
  assert.ok(!/callAI/i.test(src), 'must not reference callAI');
});

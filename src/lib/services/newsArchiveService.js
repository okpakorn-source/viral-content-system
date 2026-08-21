import { createHash } from 'node:crypto';
import { createStore } from '@/lib/persistStore';
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

const STORE = 'news-archive';
const DUPLICATE_KEY_RE = /duplicate key|_pkey|23505|already exists|unique/i;

/**
 * Canonical archive writer shared by the archive API and the real auto pipeline.
 * Exact-content requests use one deterministic revision id, so concurrent callers
 * either create one row or reuse the row that won the primary-key race.
 */
export async function saveNewsArchive({
  title,
  newsBody,
  sourceUrl = '',
  sourceType = 'web',
  sourceName,
  breakdownData,
  workflowId,
  archivedBy = 'system',
  coverImage,
  classifyTimeoutMs = null,
}) {
  if (!title && !newsBody) {
    throw new Error('ต้องมี title หรือ newsBody');
  }

  const canonicalBody = String(newsBody || '');
  const canonicalTitle = String(title || canonicalBody.slice(0, 100) || 'ไม่มีหัวข้อ');
  const archiveFingerprint = createHash('sha256')
    .update(`${canonicalTitle.length}:${canonicalTitle}\u0000${canonicalBody}`)
    .digest('hex')
    .slice(0, 24);
  const revisionPattern = new RegExp(`^archive_${archiveFingerprint}_(\\d+)$`);
  const dedupCutoff = Date.now() - 10 * 60 * 1000;
  const store = createStore(STORE);

  // ต้องอ่าน primary จริงก่อนตัดสินใจเขียน ห้ามใช้ cache เก่าหรือเขียนต่อเมื่ออ่านไม่ได้
  const existing = await store.getAll({ authoritative: true });
  const exactMatches = existing.filter(item => (
    String(item.title || '') === canonicalTitle
    && String(item.body || '') === canonicalBody
  ));
  const exactMatchesWithTime = exactMatches.map((item) => {
    const timestamp = new Date(item.archived_at || item.createdAt || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error(`Archive existing timestamp invalid: ${String(item.id || 'unknown')}`);
    }
    return { item, timestamp };
  });
  const recentMatch = exactMatchesWithTime
    .filter(match => match.timestamp > dedupCutoff)
    .sort((a, b) => b.timestamp - a.timestamp)[0]?.item;
  if (recentMatch) return { item: recentMatch, deduped: true };

  const maxRevision = exactMatches.reduce((max, item) => {
    const explicit = Number(item.archive_revision || 0);
    const fromId = Number(revisionPattern.exec(String(item.id || ''))?.[1] || 0);
    return Math.max(max, Number.isInteger(explicit) ? explicit : 0, fromId);
  }, 0);
  let archiveRevision = maxRevision + 1;

  let category = 'ทั่วไป';
  let summary = '';
  let tags = [];
  try {
    const timeout = Number(classifyTimeoutMs);
    const timeoutSignal = Number.isFinite(timeout) && timeout > 0
      && typeof globalThis.AbortSignal?.timeout === 'function'
      ? globalThis.AbortSignal.timeout(timeout)
      : undefined;
    const aiResult = await callAI({
      model: MODEL_FAST,
      temperature: 0.1,
      maxTokens: 400,
      ...(timeoutSignal ? { signal: timeoutSignal } : {}),
      prompt: `วิเคราะห์ข่าวนี้แล้วตอบเป็น JSON

หัวข้อ: ${canonicalTitle}
เนื้อหา: ${canonicalBody.slice(0, 1500)}

ตอบ JSON:
{
  "category": "หมวดหมู่ข่าว (เลือก 1: การเมือง|สังคม|อาชญากรรม|อุบัติเหตุ|บันเทิง|กีฬา|เศรษฐกิจ|สุขภาพ|ต่างประเทศ|เทคโนโลยี|สิ่งแวดล้อม|ศาสนา|ทั่วไป)",
  "summary": "สรุปข่าว 1-2 ประโยค (ไม่เกิน 100 คำ)",
  "tags": ["tag1", "tag2", "tag3"]
}`,
    });
    if (aiResult?.category) category = aiResult.category;
    if (aiResult?.summary) summary = aiResult.summary;
    if (aiResult?.tags) tags = aiResult.tags;
  } catch (error) {
    console.warn('[Archive] AI classify failed:', error.message);
  }

  const keyPeople = breakdownData?.key_facts?.people || [];
  const keyPlaces = breakdownData?.key_facts?.places || [];
  const viralScore = breakdownData?.possible_angles?.[0]?.facebook_viral_score || null;
  const wordCount = canonicalBody.split(/\s+/).filter(Boolean).length;
  let sourceDomain = '';
  if (sourceUrl) {
    try {
      sourceDomain = new URL(sourceUrl).hostname.replace('www.', '');
    } catch {
      // Invalid URL — preserve an empty source domain.
    }
  }

  const now = new Date().toISOString();
  let item = {
    id: `archive_${archiveFingerprint}_${String(archiveRevision).padStart(4, '0')}`,
    title: canonicalTitle,
    body: canonicalBody,
    source_url: sourceUrl || '',
    source_type: sourceType || 'web',
    source_name: sourceName ?? sourceDomain,
    category,
    tags,
    summary,
    key_people: keyPeople,
    key_places: keyPlaces,
    viral_score: viralScore,
    word_count: wordCount,
    used_count: 0,
    last_used_at: null,
    archived_by: archivedBy || 'system',
    archived_at: now,
    workflow_id: workflowId || null,
    archive_fingerprint: archiveFingerprint,
    archive_revision: archiveRevision,
    cover_image: coverImage || null,
    createdAt: now,
    updatedAt: now,
  };

  const maxArchiveRevisionRetries = 50;
  for (let attempt = 0; attempt < maxArchiveRevisionRetries; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- revision collisions must be resolved in strict sequence
      await store.add(item);
      return { item, deduped: false };
    } catch (addError) {
      if (!DUPLICATE_KEY_RE.test(addError.message || '')) throw addError;
      // eslint-disable-next-line no-await-in-loop -- inspect the exact id that collided before retrying
      const winner = await store.findById(item.id);
      if (!winner
          || String(winner.title || '') !== canonicalTitle
          || String(winner.body || '') !== canonicalBody) {
        throw addError;
      }
      const winnerTime = new Date(winner.archived_at || winner.createdAt || 0).getTime();
      if (!Number.isFinite(winnerTime) || winnerTime <= 0) {
        throw new Error(`Archive collision timestamp invalid: ${item.id}`);
      }
      if (winnerTime > dedupCutoff) return { item: winner, deduped: true };

      const explicitRevision = Number(winner.archive_revision || 0);
      const idRevision = Number(revisionPattern.exec(String(winner.id || ''))?.[1] || 0);
      archiveRevision = Math.max(
        archiveRevision + 1,
        Number.isInteger(explicitRevision) ? explicitRevision + 1 : 1,
        idRevision + 1,
      );
      item = {
        ...item,
        id: `archive_${archiveFingerprint}_${String(archiveRevision).padStart(4, '0')}`,
        archive_revision: archiveRevision,
      };
    }
  }
  throw new Error(`Archive revision collision retry limit reached: ${archiveFingerprint}`);
}

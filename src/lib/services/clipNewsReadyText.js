const clean = (value) => String(value || '').trim();

function cleanQuote(value) {
  return clean(value?.quote || value).replace(/^[“\"']+|[”\"']+$/g, '').trim();
}

function missingQuoteText(body, quoteSources = []) {
  const normalizedBody = clean(body).replace(/\s+/g, ' ');
  const seen = new Set();
  const quotes = quoteSources
    .flatMap((source) => Array.isArray(source) ? source : [])
    .map(cleanQuote)
    .filter((quote) => {
      if (!quote || seen.has(quote)) return false;
      seen.add(quote);
      return !normalizedBody.includes(quote.replace(/\s+/g, ' '));
    });
  return quotes.length
    ? `คำพูดสำคัญจากคลิป:\n${quotes.map((quote) => `“${quote}”`).join('\n')}`
    : '';
}

function timeLabel(start, end) {
  const a = clean(start);
  const b = clean(end);
  if (!a && !b) return '';
  return `${a || '?'}–${b || '?'}`;
}

export function buildClipSubStoryText(story, index = 0) {
  const topic = clean(story?.topic || story?.title);
  const body = clean(story?.rawData || story?.summary);
  if (!body) return '';
  const no = Number(story?.no) || index + 1;
  const time = clean(story?.timeRange) || timeLabel(story?.timeStart, story?.timeEnd);
  const label = topic ? `ประเด็น ${no}: ${topic}${time ? ` (${time})` : ''}` : '';
  return [label, body, missingQuoteText(body, [story?.quotes])].filter(Boolean).join('\n\n');
}

function buildLegacyTopicText(topic, index) {
  const no = Number(topic?.no) || index + 1;
  const title = clean(topic?.title || topic?.topic);
  const time = clean(topic?.timeRange) || timeLabel(topic?.timeStart, topic?.timeEnd);
  const label = `ประเด็น ${no}${title ? `: ${title}` : ''}${time ? ` (${time})` : ''}`;
  const summary = clean(topic?.summary || topic?.rawData);
  const points = Array.isArray(topic?.keyPoints)
    ? topic.keyPoints.map((point) => clean(point?.point || point)).filter(Boolean).map((point) => `• ${point}`).join('\n')
    : '';
  const quotes = Array.isArray(topic?.quotes)
    ? topic.quotes.map(clean).filter(Boolean).map((quote) => `“${quote}”`).join('\n')
    : '';
  return [label, summary, points, quotes].filter(Boolean).join('\n');
}

/**
 * ข้อความหลักสำหรับพนักงานนำไปเข้าระบบทำข่าว:
 * - เรื่องเดียว: ใช้ rawData เพียงก้อนเดียว
 * - หลายเรื่อง: ใช้ subStories ที่ครบในตัวเอง ไม่ต่อ rawData/quote รวมซ้ำหรือปนข้ามเรื่อง
 * - รองรับผล multiTopic รุ่นเก่าที่ยังอาจค้างในคลัง
 */
export function buildClipNewsReadyText(insight) {
  if (!insight || typeof insight !== 'object') return '';

  if (insight.multiTopic && Array.isArray(insight.topics) && insight.topics.length) {
    return insight.topics.map(buildLegacyTopicText).filter(Boolean).join('\n\n');
  }

  const subStories = Array.isArray(insight.subStories)
    ? insight.subStories.filter((story) => clean(story?.rawData))
    : [];
  if (subStories.length >= 2) {
    return subStories.map(buildClipSubStoryText).filter(Boolean).join('\n\n');
  }

  const rawData = clean(insight.rawData);
  if (rawData) {
    return [
      rawData,
      missingQuoteText(rawData, [insight.quotes, subStories[0]?.quotes]),
    ].filter(Boolean).join('\n\n');
  }
  return subStories[0] ? buildClipSubStoryText(subStories[0], 0) : '';
}

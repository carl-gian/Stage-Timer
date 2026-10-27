'use strict';

const fs = require('fs');
const { mondayKey } = require('./schedule');

const DEFAULT_FEED_URL = 'https://soundbox.blob.core.windows.net/meeting-feeds/feed.json';
const TOO_OLD_MS = 20 * 24 * 3600 * 1000; // same refresh window as OnlyT

// The feed uses camelCase keys (OnlyT's JSON parser ignores case); accept either.
const pick = (o, name) => (o ? o[name] ?? o[name[0].toUpperCase() + name.slice(1)] : undefined);

function normaliseMeeting(m) {
  const date = pick(m, 'date');
  if (typeof date !== 'string') return null;
  const talks = pick(m, 'talks') || [];
  return {
    Date: date,
    Talks: talks.map((t) => ({
      TalkType: pick(t, 'talkType'),
      Minutes: Number(pick(t, 'minutes')) || 0,
      IsStudentTalk: !!pick(t, 'isStudentTalk'),
    })),
  };
}

function findWeek(list, now) {
  if (!Array.isArray(list)) return null;
  const key = mondayKey(now);
  const hit = list.find((m) => {
    const d = pick(m, 'date');
    return typeof d === 'string' && d.slice(0, 10) === key;
  });
  const meeting = hit && normaliseMeeting(hit);
  // A week with no talks listed (e.g. a Sunday entry or an unpublished week) is as good as missing.
  return meeting && meeting.Talks.length ? meeting : null;
}

function readCache(path) {
  try {
    const stat = fs.statSync(path);
    return { list: JSON.parse(fs.readFileSync(path, 'utf8')), mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Finds this week's meeting in the feed, using the local cache when it is fresh
 * and falling back to a stale cache if the download fails.
 * @returns {Promise<{meeting: object|null, source: 'cache'|'network'|'stale-cache'|'none'}>}
 */
async function getMeetingForWeek({ feedUrl = DEFAULT_FEED_URL, cachePath, now = new Date(), fetchImpl = fetch, force = false }) {
  const cache = readCache(cachePath);
  const cached = cache && findWeek(cache.list, now);

  if (!force && cached && now.getTime() - cache.mtime <= TOO_OLD_MS) {
    return { meeting: cached, source: 'cache' };
  }

  try {
    const res = await fetchImpl(feedUrl, {
      headers: { 'User-Agent': 'StageTimer/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const list = JSON.parse(text);
    fs.writeFileSync(cachePath, text, 'utf8');
    return { meeting: findWeek(list, now), source: 'network' };
  } catch (err) {
    return { meeting: cached || null, source: cached ? 'stale-cache' : 'none', error: String(err.message || err) };
  }
}

module.exports = { getMeetingForWeek, DEFAULT_FEED_URL };

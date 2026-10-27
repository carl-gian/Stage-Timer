'use strict';

// Builds the list of timed parts for a meeting. Ported from OnlyT's TalkScheduleAuto
// (post-January-2020 midweek format and the weekend meeting).

// Talk type numbers used by the online feed.
const FEED = { MINISTRY: [100, 101, 102, 103], LIVING1: 300, LIVING2: 301 };

const pad = (n) => String(n).padStart(2, '0');

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local-date key (YYYY-MM-DD) of the Monday of the week containing `date`. */
function mondayKey(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const back = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - back);
  return dateKey(d);
}

/** Saturday / Sunday -> weekend meeting, otherwise midweek. */
function detectMeetingType(date) {
  const day = date.getDay();
  return day === 0 || day === 6 ? 'weekend' : 'midweek';
}

// startOffsetSecs is where the part sits in the meeting (OnlyT's StartOffsetIntoMeeting);
// the gaps between parts are what the adaptive timer treats as changeover time.
function item(key, name, section, minutes, startOffsetSecs, extra = {}) {
  return {
    key,
    name,
    section,
    durationSecs: Math.round(minutes * 60),
    originalSecs: Math.round(minutes * 60),
    startOffsetSecs,
    allowAdaptive: false,
    adaptedSecs: null,
    isStudentTalk: false,
    ...extra,
  };
}

const SECTIONS = {
  treasures: 'Treasures from God’s Word',
  ministry: 'Apply Yourself to the Field Ministry',
  living: 'Living as Christians',
  weekend: 'Weekend Meeting',
};

function buildMidweek({ meeting, circuitVisit = false } = {}) {
  const items = [
    item('opening', 'Opening Comments', 'treasures', 1, 5 * 60),
    item('treasures', 'Treasures Talk', 'treasures', 10, 6 * 60 + 20),
    item('digging', 'Spiritual Gems', 'treasures', 10, 16 * 60 + 40),
    item('reading', 'Bible Reading', 'treasures', 4, 27 * 60, { isStudentTalk: true }),
  ];

  let offset = 32 * 60 + 20; // ministry section starts here
  FEED.MINISTRY.forEach((type, i) => {
    const t = meeting ? (meeting.Talks || []).find((x) => x.TalkType === type) : { Minutes: 3, IsStudentTalk: true };
    if (!t) return;
    items.push(item(`ministry${i + 1}`, `Ministry Item ${i + 1}`, 'ministry', t.Minutes, offset, { isStudentTalk: !!t.IsStudentTalk }));
    offset += t.Minutes * 60 + (t.IsStudentTalk ? 60 : 0) + 20; // +1 min counsel, +20 s changeover
  });

  const talks = meeting ? meeting.Talks || [] : [];
  const l1 = talks.find((x) => x.TalkType === FEED.LIVING1);
  const l2 = talks.find((x) => x.TalkType === FEED.LIVING2);
  const l1Mins = l1 ? l1.Minutes : 15;
  const living = { allowAdaptive: true };
  items.push(item('living1', 'Living as Christians 1', 'living', l1Mins, 51 * 60 + 40, living));
  if (l2 && l2.Minutes > 0) items.push(item('living2', 'Living as Christians 2', 'living', l2.Minutes, 51 * 60 + 40 + l1Mins * 60, living));

  if (circuitVisit) {
    items.push(item('concluding', 'Concluding Comments', 'living', 3, 67 * 60, living));
    items.push(item('coTalk', 'Circuit Overseer’s Talk', 'living', 30, 70 * 60, living));
  } else {
    items.push(item('study', 'Congregation Bible Study', 'living', 30, 67 * 60, living));
    items.push(item('concluding', 'Concluding Comments', 'living', 3, 97 * 60, living));
  }
  return items;
}

function buildWeekend({ circuitVisit = false } = {}) {
  const adaptive = { allowAdaptive: true };
  if (circuitVisit) {
    return [
      item('public', 'Public Talk', 'weekend', 30, 5 * 60),
      item('watchtower', 'Watchtower Study', 'weekend', 30, 40 * 60, adaptive),
      item('coTalk', 'Circuit Overseer’s Concluding Talk', 'weekend', 30, 70 * 60, adaptive),
    ];
  }
  return [item('public', 'Public Talk', 'weekend', 30, 5 * 60), item('watchtower', 'Watchtower Study', 'weekend', 60, 40 * 60, adaptive)];
}

/** Returns items with stable numeric ids and section titles attached. */
function buildSchedule({ type, meeting, circuitVisit }) {
  const items = type === 'weekend' ? buildWeekend({ circuitVisit }) : buildMidweek({ meeting, circuitVisit });
  return items.map((it, i) => ({ id: i + 1, sectionTitle: SECTIONS[it.section], ...it }));
}

module.exports = { buildSchedule, detectMeetingType, mondayKey, dateKey, SECTIONS };

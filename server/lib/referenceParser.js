import { QURAN_DATA, ayahByRef } from './quranData.js';

// Normalizes an English surah-name spelling so common transliteration
// variance (doubled vowels, trailing ta-marbuta "h", definite-article
// prefixes, apostrophes/hyphens) collapses to the same key - lets "Baqara",
// "Baqarah", and "Al-Baqara" all resolve to the same alias without having
// to hand-enumerate every spelling.
function normalizeSurahName(raw) {
  return raw
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/^(al|an|as|ash|at|ad|adh|ar|az)-/, '')
    .replace(/-/g, ' ')
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/h$/, '');
}

// A handful of genuinely alternate titles (not just spelling variance).
const MANUAL_ALIASES = {
  9: ["bara'ah", 'baraah'], // At-Tawba is also known as Al-Bara'ah
};

let aliasMap = null;
function getAliasMap() {
  if (aliasMap) return aliasMap;
  aliasMap = new Map();
  for (const surah of QURAN_DATA) {
    aliasMap.set(normalizeSurahName(surah.englishName), surah.number);
    for (const extra of MANUAL_ALIASES[surah.number] || []) {
      aliasMap.set(normalizeSurahName(extra), surah.number);
    }
  }
  return aliasMap;
}

function lookupSurah(nameText) {
  return getAliasMap().get(normalizeSurahName(nameText)) || null;
}

const NUM = '([1-9]\\d{0,2})';
const RANGE_SEP = '(?:\\s*(?:[-\\u2013\\u2014]|to)\\s*';
const NAME = "[A-Za-z][A-Za-z'-]*(?:\\s+[A-Za-z][A-Za-z'-]*){0,2}";

const NUMERIC_RE = new RegExp(`\\b${NUM}\\s*:\\s*${NUM}${RANGE_SEP}${NUM})?\\b`, 'g');
const NAMED_RE = new RegExp(`\\bsurah\\s+(${NAME})(?:\\s*,?\\s*(?:ayah|verse|ayat)?\\s*#?\\s*${NUM}${RANGE_SEP}${NUM})?)?`, 'gi');
const NAMEFIRST_RE = new RegExp(`\\b(${NAME}),?\\s+(?:ayah|verse|ayat)\\s+${NUM}${RANGE_SEP}${NUM})?`, 'gi');
const BARE_RE = new RegExp(`\\b(?:ayah|verse|ayat)\\s*#?\\s*${NUM}${RANGE_SEP}${NUM})?\\b`, 'gi');

function collectCandidates(text) {
  const candidates = [];

  for (const m of text.matchAll(NUMERIC_RE)) {
    candidates.push({ start: m.index, end: m.index + m[0].length, priority: 3, type: 'numeric', groups: m });
  }
  for (const m of text.matchAll(NAMED_RE)) {
    candidates.push({ start: m.index, end: m.index + m[0].length, priority: 2, type: 'named', groups: m });
  }
  for (const m of text.matchAll(NAMEFIRST_RE)) {
    candidates.push({ start: m.index, end: m.index + m[0].length, priority: 1, type: 'namefirst', groups: m });
  }
  for (const m of text.matchAll(BARE_RE)) {
    candidates.push({ start: m.index, end: m.index + m[0].length, priority: 0, type: 'bare', groups: m });
  }

  // Greedy sweep: earliest start wins; ties broken by priority (numeric >
  // named > namefirst > bare); anything overlapping an already-picked span
  // is dropped so the same characters are never claimed twice.
  candidates.sort((a, b) => a.start - b.start || b.priority - a.priority);
  const picked = [];
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.start < lastEnd) continue;
    picked.push(c);
    lastEnd = c.end;
  }
  return picked;
}

function expandRange(surah, start, end) {
  const refs = [];
  const last = end && end >= start ? Math.min(end, start + 50) : start; // sane upper bound on a single range
  for (let n = start; n <= last; n++) {
    const hit = ayahByRef(surah, n);
    if (hit) refs.push({ surah, ayah: n });
  }
  return refs;
}

// Scans passage text for explicit Quran references, threading a "current
// surah" context across passages (in document order) so a bare "Ayah 23"
// resolves using the nearest prior named/numeric reference. Returns
// { matches, context } - pass `context` back in as `priorContext` for the
// next passage in the same document.
export function detectExplicitReferences(text, priorContext = null) {
  const matches = [];
  let context = priorContext;

  for (const c of collectCandidates(text)) {
    const g = c.groups;

    if (c.type === 'numeric') {
      const surah = parseInt(g[1], 10);
      if (!ayahByRef(surah, parseInt(g[2], 10))) continue; // reject invalid surah/ayah (requirement #15)
      matches.push(...expandRange(surah, parseInt(g[2], 10), g[3] ? parseInt(g[3], 10) : null));
      context = surah;
      continue;
    }

    if (c.type === 'named') {
      const surah = lookupSurah(g[1]);
      if (!surah || !g[2]) continue; // unrecognized name, or no ayah number given
      matches.push(...expandRange(surah, parseInt(g[2], 10), g[3] ? parseInt(g[3], 10) : null));
      context = surah;
      continue;
    }

    if (c.type === 'namefirst') {
      const surah = lookupSurah(g[1]);
      if (surah) {
        matches.push(...expandRange(surah, parseInt(g[2], 10), g[3] ? parseInt(g[3], 10) : null));
        context = surah;
      } else if (context) {
        // Name wasn't a recognized surah - fall back to treating it as a
        // bare "ayah N" using whatever surah context is already active.
        matches.push(...expandRange(context, parseInt(g[2], 10), g[3] ? parseInt(g[3], 10) : null));
      }
      continue;
    }

    if (c.type === 'bare' && context) {
      matches.push(...expandRange(context, parseInt(g[1], 10), g[2] ? parseInt(g[2], 10) : null));
    }
  }

  // De-dupe (a range and a later single mention could both hit the same ayah).
  const seen = new Set();
  const deduped = matches.filter(m => {
    const key = `${m.surah}:${m.ayah}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { matches: deduped, context };
}

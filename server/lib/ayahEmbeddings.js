import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QURAN_DATA } from './quranData.js';
import { embed, cosineSim } from './search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'data', 'ayah-embeddings.json');

// { surah, ayah, en, vector }[] - built once (embedding all 6236 ayahs takes
// a couple of minutes) and cached to disk permanently after that.
let cache = null;
let buildPromise = null;

function loadFromDisk() {
  if (fs.existsSync(CACHE_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      if (Array.isArray(raw) && raw.length > 0) return raw;
    } catch { /* fall through to rebuild */ }
  }
  return null;
}

async function build() {
  const disk = loadFromDisk();
  if (disk) {
    cache = disk;
    return cache;
  }
  console.log('Building ayah embedding index (one-time, ~6236 ayahs)...');
  const entries = [];
  for (const surah of QURAN_DATA) {
    for (const ayah of surah.ayahs) {
      const vector = await embed(ayah.en);
      entries.push({ surah: surah.number, ayah: ayah.n, en: ayah.en, vector });
    }
  }
  cache = entries;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(entries), 'utf8');
  console.log('Ayah embedding index built and cached.');
  return cache;
}

async function getCache() {
  if (cache) return cache;
  if (!buildPromise) buildPromise = build();
  return buildPromise;
}

// Top-K ayahs whose English translation is most semantically similar to the
// given text - used to ground LLM classification in real, verified ayahs
// instead of letting it recall surah:ayah numbers from memory.
export async function topCandidateAyahs(text, k = 5) {
  const entries = await getCache();
  const qVec = await embed(text);
  const scored = entries.map(e => ({
    surah: e.surah,
    ayah: e.ayah,
    en: e.en,
    score: cosineSim(qVec, e.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export async function ensureAyahEmbeddingsReady() {
  await getCache();
}

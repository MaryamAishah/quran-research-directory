import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', '..', 'assets', 'js', 'quran-data.js');

// The frontend loads this as a plain <script> global (`const QURAN_DATA = [...];`).
// Reuse the same file server-side instead of maintaining a second copy.
const raw = fs.readFileSync(DATA_FILE, 'utf8');
const jsonText = raw.slice(raw.indexOf('=') + 1, raw.lastIndexOf(';')).trim();
export const QURAN_DATA = JSON.parse(jsonText);

export function surahByNumber(num) {
  return QURAN_DATA.find(s => s.number === num);
}

export function ayahByRef(surah, ayah) {
  const s = surahByNumber(surah);
  if (!s) return null;
  const a = s.ayahs.find(x => x.n === ayah);
  if (!a) return null;
  return { surah: s, ayah: a };
}

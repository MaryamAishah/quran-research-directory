import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ayahByRef } from './quranData.js';
import { docsForAyah, IMAGES_PREFIX } from './docStore.js';
import * as storage from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.join(__dirname, '..', '..', 'assets', 'fonts', 'AmiriQuran.ttf');

let fontBase64Cache = null;
function fontBase64() {
  if (!fontBase64Cache) {
    fontBase64Cache = fs.readFileSync(FONT_PATH).toString('base64');
  }
  return fontBase64Cache;
}

// Rewrite <img src="/media/..."> to embedded base64 data URIs so the export
// is a fully self-contained file (no dependency on the running server).
async function inlineImages(html) {
  const matches = [...html.matchAll(/src="\/media\/([^"]+)"/g)];
  let result = html;
  for (const match of matches) {
    const rel = match[1];
    try {
      const ext = path.extname(rel).slice(1) || 'png';
      const file = await storage.readBinary(`${IMAGES_PREFIX}${rel}`);
      if (!file) continue;
      result = result.replace(match[0], `src="data:image/${ext};base64,${file.buffer.toString('base64')}"`);
    } catch { /* leave original src if the image can't be read */ }
  }
  return result;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Builds the full sectioned HTML for the selected ayaat: each section leads
// with the ayah reference, Arabic text, and translation, followed by every
// document linked to that ayah.
export async function buildExportHtml(ayat) {
  const sorted = [...ayat].sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
  const seenDocIds = new Set();

  const sections = [];
  for (const { surah: surahNum, ayah: ayahNum } of sorted) {
    const ref = ayahByRef(surahNum, ayahNum);
    if (!ref) continue;
    const { surah, ayah } = ref;
    const docs = await docsForAyah(surahNum, ayahNum);

    let docsHtml;
    if (docs.length) {
      const docBlocks = [];
      for (const d of docs) {
        seenDocIds.add(d.id);
        docBlocks.push(`
          <div class="doc-block">
            <div class="doc-title">${escapeHtml(d.title)}</div>
            <div class="doc-body">${await inlineImages(d.html || '')}</div>
          </div>
        `);
      }
      docsHtml = docBlocks.join('');
    } else {
      docsHtml = `<div class="doc-empty">No documents linked to this ayah.</div>`;
    }

    sections.push(`
      <section class="ayah-section">
        <div class="ayah-ref">Surah ${surah.number} &middot; ${escapeHtml(surah.englishName)} (${escapeHtml(surah.englishNameTranslation)}) &mdash; Ayah ${ayah.n}</div>
        <div class="ayah-arabic">${ayah.ar}</div>
        <div class="ayah-translation"><span class="label">Sahih International</span>${escapeHtml(ayah.en)}</div>
        <div class="docs-wrap">${docsHtml}</div>
      </section>
    `);
  }

  const generatedAt = new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Quran Research Export</title>
<style>
  @font-face {
    font-family: 'AmiriQuran';
    src: url(data:font/ttf;base64,${fontBase64()}) format('truetype');
  }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1a1a1a;
    line-height: 1.6;
    margin: 0;
    padding: 0 8mm;
  }
  .export-title {
    font-size: 24px;
    font-weight: bold;
    margin: 10mm 0 2mm;
  }
  .export-meta {
    font-size: 11px;
    color: #666;
    margin-bottom: 12mm;
  }
  .ayah-section {
    margin-bottom: 10mm;
    page-break-inside: avoid;
  }
  .ayah-ref {
    font-size: 13px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #5b3fa3;
    border-bottom: 2px solid #5b3fa3;
    padding-bottom: 3mm;
    margin-bottom: 4mm;
  }
  .ayah-arabic {
    font-family: 'AmiriQuran', 'Traditional Arabic', serif;
    font-size: 26px;
    direction: rtl;
    text-align: right;
    line-height: 2;
    margin-bottom: 4mm;
  }
  .ayah-translation {
    font-size: 13px;
    font-style: italic;
    color: #444;
    margin-bottom: 6mm;
  }
  .ayah-translation .label {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    font-style: normal;
    color: #999;
    margin-bottom: 1mm;
  }
  .doc-block {
    background: #f7f5fb;
    border-left: 3px solid #5b3fa3;
    padding: 4mm 5mm;
    margin-bottom: 4mm;
  }
  .doc-title {
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 2mm;
  }
  .doc-body { font-size: 13px; }
  .doc-body img { max-width: 100%; }
  .doc-empty {
    font-size: 12px;
    color: #999;
    font-style: italic;
  }
  hr.section-divider {
    border: none;
    border-top: 1px solid #ddd;
    margin: 8mm 0;
  }
</style>
</head>
<body>
  <div class="export-title">Quran Research Export</div>
  <div class="export-meta">Generated ${generatedAt} &middot; ${sorted.length} ayah${sorted.length === 1 ? '' : 's'} &middot; ${seenDocIds.size} document${seenDocIds.size === 1 ? '' : 's'}</div>
  ${sections.join('\n')}
</body>
</html>`;
}

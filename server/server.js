import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

import {
  listDocs, getDoc, createDoc, updateDoc, deleteDoc,
  docsForAyah, backlinksFor, IMAGES_DIR,
} from './lib/docStore.js';
import { reindexDoc, removeDocFromIndex, semanticSearch, ensureModelWarm } from './lib/search.js';
import { buildExportHtml } from './lib/exportBuilder.js';
import { htmlToPdf } from './lib/pdfExport.js';
import { htmlToDocx } from './lib/docxExport.js';
import { fileToHtml } from './lib/fileImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 5678;

const app = express();
app.use(express.json({ limit: '15mb' }));

// ---------- Static site ----------
// Only the public site files are served - not node_modules, server source, or raw document JSON.
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.use('/media', express.static(IMAGES_DIR));

// ---------- Documents CRUD ----------
app.get('/api/docs', (req, res) => {
  res.json(listDocs());
});

app.get('/api/docs/:id', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

app.get('/api/docs/:id/backlinks', (req, res) => {
  res.json(backlinksFor(req.params.id));
});

app.post('/api/docs', async (req, res) => {
  const { title, html, linkedAyat, id } = req.body;
  const doc = createDoc({ title, html, linkedAyat, id });
  reindexDoc(doc).catch(err => console.error('reindex failed', err));
  res.json(doc);
});

app.put('/api/docs/:id', async (req, res) => {
  const { title, html, linkedAyat } = req.body;
  const doc = updateDoc(req.params.id, { title, html, linkedAyat });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  reindexDoc(doc).catch(err => console.error('reindex failed', err));
  res.json(doc);
});

app.delete('/api/docs/:id', (req, res) => {
  const ok = deleteDoc(req.params.id);
  removeDocFromIndex(req.params.id);
  res.json({ ok });
});

// ---------- Ayah linking ----------
app.get('/api/ayah/:surah/:ayah/docs', (req, res) => {
  const surah = parseInt(req.params.surah, 10);
  const ayah = parseInt(req.params.ayah, 10);
  res.json(docsForAyah(surah, ayah));
});

// ---------- Semantic search ----------
app.get('/api/search', async (req, res) => {
  try {
    const results = await semanticSearch(req.query.q || '', 12);
    const docsById = new Map(listDocs().map(d => [d.id, d]));
    const enriched = results
      .map(r => ({ ...r, doc: docsById.get(r.docId) }))
      .filter(r => r.doc);
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ---------- Image upload (from editor toolbar) ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/upload-image', upload.single('image'), (req, res) => {
  const docId = req.body.docId || 'unlinked';
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const dir = path.join(IMAGES_DIR, docId);
  fs.mkdirSync(dir, { recursive: true });
  const safeExt = (path.extname(req.file.originalname) || '.png').slice(0, 10);
  const filename = `${crypto.randomUUID()}${safeExt}`;
  fs.writeFileSync(path.join(dir, filename), req.file.buffer);
  res.json({ url: `/media/${docId}/${filename}` });
});

// ---------- Upload PDF/DOCX/TXT as a new document ----------
app.post('/api/docs/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.pdf', '.docx', '.txt'].includes(ext)) {
      return res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, or TXT.' });
    }

    let linkedAyat = [];
    try { linkedAyat = JSON.parse(req.body.linkedAyat || '[]'); } catch { /* default to [] */ }

    const id = crypto.randomUUID();
    const html = await fileToHtml(req.file.buffer, req.file.originalname, id);
    const title = (req.body.title || '').trim() || path.basename(req.file.originalname, ext);

    const doc = createDoc({ id, title, html, linkedAyat });
    reindexDoc(doc).catch(err => console.error('reindex failed', err));
    res.json(doc);
  } catch (err) {
    console.error('doc upload failed', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ---------- Import pasted images (from external URL or base64 data URI) ----------
app.post('/api/import-image', async (req, res) => {
  try {
    const { docId, dataUrl, sourceUrl } = req.body;
    const dir = path.join(IMAGES_DIR, docId || 'unlinked');
    fs.mkdirSync(dir, { recursive: true });

    if (dataUrl && dataUrl.startsWith('data:')) {
      const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
      if (!match) return res.status(400).json({ error: 'Bad data URL' });
      const ext = '.' + match[1].split('+')[0];
      const filename = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(dir, filename), Buffer.from(match[2], 'base64'));
      return res.json({ url: `/media/${docId}/${filename}` });
    }

    if (sourceUrl && /^https?:\/\//.test(sourceUrl)) {
      const client = sourceUrl.startsWith('https') ? https : http;
      const buf = await new Promise((resolve, reject) => {
        client.get(sourceUrl, (r) => {
          if (r.statusCode >= 400) return reject(new Error('fetch failed ' + r.statusCode));
          const chunks = [];
          r.on('data', c => chunks.push(c));
          r.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
      });
      const ext = path.extname(new URL(sourceUrl).pathname) || '.png';
      const filename = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(dir, filename), buf);
      return res.json({ url: `/media/${docId}/${filename}` });
    }

    res.status(400).json({ error: 'No image source provided' });
  } catch (err) {
    console.error('import-image failed', err.message);
    res.status(500).json({ error: 'Import failed' });
  }
});

// ---------- Export selected ayaat + linked documents ----------
app.post('/api/export', async (req, res) => {
  try {
    const { ayat, format } = req.body;
    if (!Array.isArray(ayat) || !ayat.length) {
      return res.status(400).json({ error: 'No ayaat selected' });
    }
    const html = buildExportHtml(ayat);

    if (format === 'docx') {
      const buffer = await htmlToDocx(html);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="quran-research-export.docx"');
      return res.send(buffer);
    }

    const buffer = await htmlToPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="quran-research-export.pdf"');
    res.send(buffer);
  } catch (err) {
    console.error('export failed', err);
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Quran Research Directory running at http://localhost:${PORT}`);
  ensureModelWarm().then(() => console.log('Semantic search model ready.'));
});

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

import {
  listDocs, getDoc, createDoc, updateDoc, deleteDoc,
  docsForAyah, docsForSurah, backlinksFor, IMAGES_PREFIX, ORIGINALS_PREFIX,
} from './lib/docStore.js';
import { reindexDoc, removeDocFromIndex, semanticSearch, ensureModelWarm } from './lib/search.js';
import { buildExportHtml } from './lib/exportBuilder.js';
import { htmlToPdf } from './lib/pdfExport.js';
import { htmlToDocx } from './lib/docxExport.js';
import { fileToHtml } from './lib/fileImport.js';
import { processDocument } from './lib/passagePipeline.js';
import { ensureAyahEmbeddingsReady } from './lib/ayahEmbeddings.js';
import { passagesForDoc, passagesForAyah, passagesNeedingReview, getPassage, updatePassage } from './lib/passageStore.js';
import { ayahByRef } from './lib/quranData.js';
import * as storage from './lib/storage.js';
import * as auth from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 5678;

const app = express();
app.use(express.json({ limit: '15mb' }));

// ---------- Auth ----------
// Entirely opt-in via APP_PASSWORD - unset locally, so local use is
// unaffected; set on the hosted deployment to gate access.
const PUBLIC_PATHS = new Set(['/login', '/api/login', '/api/logout', '/api/auth-status', '/healthz']);
app.use((req, res, next) => {
  if (!auth.isAuthRequired()) return next();
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith('/assets/')) return next();
  if (auth.isRequestAuthenticated(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Authentication required' });
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
});

app.get('/login', (req, res) => res.sendFile(path.join(ROOT, 'login.html')));

app.post('/api/login', (req, res) => {
  if (!auth.verifyPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  auth.setSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth-status', (req, res) => {
  res.json({ required: auth.isAuthRequired(), authenticated: auth.isRequestAuthenticated(req) });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- Static site ----------
// Only the public site files are served - not node_modules, server source, or raw document JSON.
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.use('/assets', express.static(path.join(ROOT, 'assets')));

function guessContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
    '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

// Images/originals are proxied (not statically served) since R2 objects
// aren't public - this is the same code path for local and cloud storage,
// and sits behind the auth middleware above like everything else.
app.get('/media/:docId/:filename', async (req, res) => {
  const file = await storage.readBinary(`${IMAGES_PREFIX}${req.params.docId}/${req.params.filename}`);
  if (!file) return res.status(404).send('Not found');
  res.setHeader('Content-Type', file.contentType || guessContentType(req.params.filename));
  res.send(file.buffer);
});

app.get('/originals/:docId/:filename', async (req, res) => {
  const file = await storage.readBinary(`${ORIGINALS_PREFIX}${req.params.docId}/${req.params.filename}`);
  if (!file) return res.status(404).send('Not found');
  res.setHeader('Content-Type', file.contentType || guessContentType(req.params.filename));
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
  res.send(file.buffer);
});

// ---------- Documents CRUD ----------
app.get('/api/docs', async (req, res) => {
  res.json(await listDocs());
});

app.get('/api/docs/:id', async (req, res) => {
  const doc = await getDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

app.get('/api/docs/:id/backlinks', async (req, res) => {
  res.json(await backlinksFor(req.params.id));
});

app.post('/api/docs', async (req, res) => {
  const { title, html, linkedAyat, linkedSurahs, id, autoDetect } = req.body;
  const doc = await createDoc({ title, html, linkedAyat, linkedSurahs, id, autoDetect });
  reindexDoc(doc).catch(err => console.error('reindex failed', err));
  if (doc.autoDetect) {
    processDocument(doc.id).catch(err => console.error('passage processing failed', err));
  }
  res.json(doc);
});

app.put('/api/docs/:id', async (req, res) => {
  const { title, html, linkedAyat, linkedSurahs, autoDetect } = req.body;
  const doc = await updateDoc(req.params.id, { title, html, linkedAyat, linkedSurahs, autoDetect });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  reindexDoc(doc).catch(err => console.error('reindex failed', err));
  // Only processes when the document is (now) opted in - covers both new
  // documents and pre-existing ones the user has explicitly turned on.
  if (doc.autoDetect) {
    processDocument(doc.id).catch(err => console.error('passage processing failed', err));
  }
  res.json(doc);
});

app.delete('/api/docs/:id', async (req, res) => {
  const ok = await deleteDoc(req.params.id);
  removeDocFromIndex(req.params.id);
  res.json({ ok });
});

// ---------- Ayah linking ----------
app.get('/api/ayah/:surah/:ayah/docs', async (req, res) => {
  const surah = parseInt(req.params.surah, 10);
  const ayah = parseInt(req.params.ayah, 10);
  res.json(await docsForAyah(surah, ayah));
});

app.get('/api/surah/:surah/docs', async (req, res) => {
  res.json(await docsForSurah(parseInt(req.params.surah, 10)));
});

// ---------- Passage-to-ayah matching pipeline ----------
app.post('/api/docs/:id/process', async (req, res) => {
  const doc = await getDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  try {
    await processDocument(req.params.id, { force: !!req.body?.force });
    res.json(await getDoc(req.params.id));
  } catch (err) {
    console.error('manual process failed', err);
    res.status(500).json({ error: err.message || 'Processing failed' });
  }
});

app.get('/api/docs/:id/passages', async (req, res) => {
  res.json(await passagesForDoc(req.params.id));
});

app.get('/api/ayah/:surah/:ayah/passages', async (req, res) => {
  const surah = parseInt(req.params.surah, 10);
  const ayah = parseInt(req.params.ayah, 10);
  const hits = await passagesForAyah(surah, ayah);
  const docsById = new Map((await listDocs()).map(d => [d.id, d]));
  const enriched = hits
    .map(h => ({ ...h, doc: docsById.get(h.passage.docId) }))
    .filter(h => h.doc);
  res.json(enriched);
});

app.get('/api/review-queue', async (req, res) => {
  const docsById = new Map((await listDocs()).map(d => [d.id, d]));
  const enriched = (await passagesNeedingReview())
    .map(p => ({ passage: p, doc: docsById.get(p.docId) }))
    .filter(p => p.doc);
  res.json(enriched);
});

app.post('/api/passages/:id/review', async (req, res) => {
  const passage = await getPassage(req.params.id);
  if (!passage) return res.status(404).json({ error: 'Not found' });
  const { action, matchIndex, matches } = req.body;

  if (action === 'accept' || action === 'reject') {
    if (typeof matchIndex !== 'number' || !passage.matches[matchIndex]) {
      return res.status(400).json({ error: 'Invalid matchIndex' });
    }
    const updated = [...passage.matches];
    updated[matchIndex] = { ...updated[matchIndex], status: action === 'accept' ? 'accepted' : 'rejected' };
    return res.json(await updatePassage(passage.id, { matches: updated }));
  }

  if (action === 'set') {
    if (!Array.isArray(matches)) return res.status(400).json({ error: 'matches must be an array' });
    const validated = [];
    for (const m of matches) {
      const surah = parseInt(m.surah, 10);
      const ayah = parseInt(m.ayah, 10);
      if (!ayahByRef(surah, ayah)) continue; // reject invalid refs (requirement #15)
      validated.push({ surah, ayah, confidence: 1, source: 'manual', status: 'accepted' });
    }
    return res.json(await updatePassage(passage.id, { matches: validated }));
  }

  res.status(400).json({ error: 'Unknown action' });
});

// ---------- Semantic search ----------
app.get('/api/search', async (req, res) => {
  try {
    const results = await semanticSearch(req.query.q || '', 12);
    const docsById = new Map((await listDocs()).map(d => [d.id, d]));
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

app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  const docId = req.body.docId || 'unlinked';
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const safeExt = (path.extname(req.file.originalname) || '.png').slice(0, 10);
  const filename = `${crypto.randomUUID()}${safeExt}`;
  await storage.writeBinary(`${IMAGES_PREFIX}${docId}/${filename}`, req.file.buffer, req.file.mimetype);
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
    let linkedSurahs = [];
    try { linkedSurahs = JSON.parse(req.body.linkedSurahs || '[]'); } catch { /* default to [] */ }
    const autoDetect = req.body.autoDetect !== 'false';

    const id = crypto.randomUUID();
    const html = await fileToHtml(req.file.buffer, req.file.originalname, id);
    const title = (req.body.title || '').trim() || path.basename(req.file.originalname, ext);

    // Preserve the original upload untouched, regardless of what the HTML
    // conversion produced (requirement: source traceability).
    const storedName = `original${ext}`;
    await storage.writeBinary(`${ORIGINALS_PREFIX}${id}/${storedName}`, req.file.buffer, req.file.mimetype);
    const sourceFile = {
      originalName: req.file.originalname,
      storedName,
      mimeType: req.file.mimetype,
      size: req.file.size,
    };

    const doc = await createDoc({ id, title, html, linkedAyat, linkedSurahs, sourceFile, autoDetect });
    reindexDoc(doc).catch(err => console.error('reindex failed', err));
    if (doc.autoDetect) {
      processDocument(doc.id).catch(err => console.error('passage processing failed', err));
    }
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
    const dir = docId || 'unlinked';

    if (dataUrl && dataUrl.startsWith('data:')) {
      const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
      if (!match) return res.status(400).json({ error: 'Bad data URL' });
      const ext = match[1].split('+')[0];
      const filename = `${crypto.randomUUID()}.${ext}`;
      await storage.writeBinary(`${IMAGES_PREFIX}${dir}/${filename}`, Buffer.from(match[2], 'base64'), `image/${ext}`);
      return res.json({ url: `/media/${dir}/${filename}` });
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
      await storage.writeBinary(`${IMAGES_PREFIX}${dir}/${filename}`, buf, guessContentType(filename));
      return res.json({ url: `/media/${dir}/${filename}` });
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
    const html = await buildExportHtml(ayat);

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
  console.log(`Storage backend: ${storage.isCloudStorage() ? 'Cloudflare R2' : 'local filesystem'}`);
  console.log(`Login required: ${auth.isAuthRequired()}`);
  ensureModelWarm().then(() => console.log('Semantic search model ready.'));
  ensureAyahEmbeddingsReady().then(() => console.log('Ayah embedding index ready.'));
});

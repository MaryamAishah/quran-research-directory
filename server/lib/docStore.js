import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DOCS_DIR = path.join(DATA_DIR, 'documents');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

fs.mkdirSync(DOCS_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const DOC_LINK_RE = /href="#\/doc\/([a-f0-9-]{36})"/g;

function docPath(id) {
  return path.join(DOCS_DIR, `${id}.json`);
}

function extractWikiLinks(html) {
  const links = new Set();
  let m;
  DOC_LINK_RE.lastIndex = 0;
  while ((m = DOC_LINK_RE.exec(html))) {
    links.add(m[1]);
  }
  return [...links];
}

// Strips HTML tags to plain text for previews/search chunking.
function htmlToText(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function listDocs() {
  return fs.readdirSync(DOCS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(DOCS_DIR, f), 'utf8')))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getDoc(id) {
  const p = docPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function createDoc({ title, html, linkedAyat, id }) {
  id = id && /^[a-f0-9-]{36}$/.test(id) ? id : crypto.randomUUID();
  const now = Date.now();
  const doc = {
    id,
    title: (title || 'Untitled document').trim(),
    html: html || '',
    linkedAyat: Array.isArray(linkedAyat) ? linkedAyat : [],
    wikiLinks: extractWikiLinks(html || ''),
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(docPath(id), JSON.stringify(doc, null, 2), 'utf8');
  return doc;
}

export function updateDoc(id, { title, html, linkedAyat }) {
  const existing = getDoc(id);
  if (!existing) return null;
  const updated = {
    ...existing,
    title: title !== undefined ? title.trim() || 'Untitled document' : existing.title,
    html: html !== undefined ? html : existing.html,
    linkedAyat: linkedAyat !== undefined ? linkedAyat : existing.linkedAyat,
    updatedAt: Date.now(),
  };
  updated.wikiLinks = extractWikiLinks(updated.html);
  fs.writeFileSync(docPath(id), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

export function deleteDoc(id) {
  const p = docPath(id);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  const imgDir = path.join(IMAGES_DIR, id);
  if (fs.existsSync(imgDir)) fs.rmSync(imgDir, { recursive: true, force: true });
  return true;
}

export function docsForAyah(surah, ayah) {
  return listDocs().filter(d =>
    d.linkedAyat.some(a => a.surah === surah && a.ayah === ayah)
  );
}

export function backlinksFor(id) {
  return listDocs().filter(d => d.id !== id && d.wikiLinks.includes(id));
}

export { htmlToText, IMAGES_DIR, DOCS_DIR };

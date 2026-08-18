import crypto from 'crypto';
import * as storage from './storage.js';
import { deletePassagesForDoc } from './passageStore.js';

const DOCS_PREFIX = 'documents/';
const IMAGES_PREFIX = 'images/';
const ORIGINALS_PREFIX = 'originals/';

function docKey(id) {
  return `${DOCS_PREFIX}${id}.json`;
}

const DOC_LINK_RE = /href="#\/doc\/([a-f0-9-]{36})"/g;

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

// In-memory write-through cache. The document list is read constantly
// (reader page alone hits it 3-4x per ayah) but written rarely, and R2
// round-trips dominate load time - caching this is what actually fixes
// the sluggishness rather than shaving individual request latency.
// Safe for a single-process app (the normal way this runs); every write
// here updates the cache in the same step it writes to storage, so it
// never serves stale data to itself.
let cache = null; // Map<id, doc> | null (null = not yet loaded)

async function ensureCache() {
  if (cache) return cache;
  const docs = await storage.listJson(DOCS_PREFIX);
  cache = new Map(docs.map(d => [d.id, d]));
  return cache;
}

export async function listDocs() {
  const c = await ensureCache();
  return [...c.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDoc(id) {
  const c = await ensureCache();
  return c.get(id) || null;
}

export async function createDoc({ title, html, linkedAyat, linkedSurahs, id, sourceFile, autoDetect }) {
  id = id && /^[a-f0-9-]{36}$/.test(id) ? id : crypto.randomUUID();
  const now = Date.now();
  const doc = {
    id,
    title: (title || 'Untitled document').trim(),
    html: html || '',
    linkedAyat: Array.isArray(linkedAyat) ? linkedAyat : [],
    linkedSurahs: Array.isArray(linkedSurahs) ? linkedSurahs : [],
    wikiLinks: extractWikiLinks(html || ''),
    sourceFile: sourceFile || null,
    autoDetect: autoDetect !== false, // opt-out (defaults on for new documents)
    processing: { status: 'none', error: null, contentHash: null, updatedAt: now },
    createdAt: now,
    updatedAt: now,
  };
  await storage.writeJson(docKey(id), doc);
  (await ensureCache()).set(id, doc);
  return doc;
}

export async function updateDoc(id, { title, html, linkedAyat, linkedSurahs, autoDetect }) {
  const existing = await getDoc(id);
  if (!existing) return null;
  const updated = {
    ...existing,
    title: title !== undefined ? title.trim() || 'Untitled document' : existing.title,
    html: html !== undefined ? html : existing.html,
    linkedAyat: linkedAyat !== undefined ? linkedAyat : existing.linkedAyat,
    linkedSurahs: linkedSurahs !== undefined ? linkedSurahs : (existing.linkedSurahs || []),
    // Pre-existing documents (from before this feature) have no autoDetect
    // field at all - treat that as opted-out until explicitly turned on.
    autoDetect: autoDetect !== undefined ? autoDetect : (existing.autoDetect ?? false),
    updatedAt: Date.now(),
  };
  updated.wikiLinks = extractWikiLinks(updated.html);
  await storage.writeJson(docKey(id), updated);
  (await ensureCache()).set(id, updated);
  return updated;
}

export async function setProcessing(id, patch) {
  const existing = await getDoc(id);
  if (!existing) return null;
  const updated = {
    ...existing,
    processing: { ...(existing.processing || {}), ...patch, updatedAt: Date.now() },
  };
  await storage.writeJson(docKey(id), updated);
  (await ensureCache()).set(id, updated);
  return updated;
}

export async function deleteDoc(id) {
  const deleted = await storage.deleteObject(docKey(id));
  if (!deleted) return false;
  await storage.deletePrefix(`${IMAGES_PREFIX}${id}/`);
  await storage.deletePrefix(`${ORIGINALS_PREFIX}${id}/`);
  await deletePassagesForDoc(id);
  (await ensureCache()).delete(id);
  return true;
}

export async function docsForAyah(surah, ayah) {
  const docs = await listDocs();
  return docs.filter(d => d.linkedAyat.some(a => a.surah === surah && a.ayah === ayah));
}

export async function docsForSurah(surah) {
  const docs = await listDocs();
  return docs.filter(d => (d.linkedSurahs || []).includes(surah));
}

export async function backlinksFor(id) {
  const docs = await listDocs();
  return docs.filter(d => d.id !== id && d.wikiLinks.includes(id));
}

export { htmlToText, IMAGES_PREFIX, ORIGINALS_PREFIX };

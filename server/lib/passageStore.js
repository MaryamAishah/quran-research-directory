import crypto from 'crypto';
import * as storage from './storage.js';

const PASSAGES_PREFIX = 'passages/';

function passageKey(id) {
  return `${PASSAGES_PREFIX}${id}.json`;
}

// Same write-through in-memory cache strategy as docStore.js - see the
// comment there for why. Passages are read even more often than docs
// (every ayah page queries matches across the whole passage set).
let cache = null; // Map<id, passage> | null

async function ensureCache() {
  if (cache) return cache;
  const passages = await storage.listJson(PASSAGES_PREFIX);
  cache = new Map(passages.map(p => [p.id, p]));
  return cache;
}

async function listPassages() {
  const c = await ensureCache();
  return [...c.values()].sort((a, b) => a.docId.localeCompare(b.docId) || a.order - b.order);
}

async function getPassage(id) {
  const c = await ensureCache();
  return c.get(id) || null;
}

async function createPassage({ docId, order, location, html, text }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const passage = {
    id,
    docId,
    order,
    location: location || { page: null, section: null },
    html: html || '',
    text: text || '',
    matches: [],
    matchStatus: 'pending', // 'pending' | 'matched' | 'error'
    createdAt: now,
    updatedAt: now,
  };
  await storage.writeJson(passageKey(id), passage);
  (await ensureCache()).set(id, passage);
  return passage;
}

async function updatePassage(id, patch) {
  const existing = await getPassage(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
  await storage.writeJson(passageKey(id), updated);
  (await ensureCache()).set(id, updated);
  return updated;
}

async function deletePassage(id) {
  const deleted = await storage.deleteObject(passageKey(id));
  if (deleted) (await ensureCache()).delete(id);
  return deleted;
}

async function deletePassagesForDoc(docId) {
  const passages = await listPassages();
  for (const passage of passages) {
    if (passage.docId === docId) await deletePassage(passage.id);
  }
}

async function passagesForDoc(docId) {
  const passages = await listPassages();
  return passages.filter(p => p.docId === docId).sort((a, b) => a.order - b.order);
}

// Only matches a caller-facing consumer (reader page) should ever see:
// auto-saved (high-confidence or explicit) or explicitly user-accepted.
async function passagesForAyah(surah, ayah) {
  const passages = await listPassages();
  const results = [];
  for (const passage of passages) {
    const hits = passage.matches.filter(m =>
      m.surah === surah && m.ayah === ayah && (m.status === 'auto' || m.status === 'accepted')
    );
    if (hits.length) results.push({ passage, matches: hits });
  }
  return results;
}

async function passagesNeedingReview() {
  const passages = await listPassages();
  return passages.filter(p => p.matches.some(m => m.status === 'pending-review'));
}

export {
  listPassages, getPassage, createPassage, updatePassage, deletePassage,
  deletePassagesForDoc, passagesForDoc, passagesForAyah, passagesNeedingReview,
};

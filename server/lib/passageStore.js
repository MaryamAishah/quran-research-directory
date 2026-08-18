import crypto from 'crypto';
import * as storage from './storage.js';

const PASSAGES_PREFIX = 'passages/';

function passageKey(id) {
  return `${PASSAGES_PREFIX}${id}.json`;
}

async function listPassages() {
  const passages = await storage.listJson(PASSAGES_PREFIX);
  return passages.sort((a, b) => a.docId.localeCompare(b.docId) || a.order - b.order);
}

async function getPassage(id) {
  return storage.readJson(passageKey(id));
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
  return passage;
}

async function updatePassage(id, patch) {
  const existing = await getPassage(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
  await storage.writeJson(passageKey(id), updated);
  return updated;
}

async function deletePassage(id) {
  return storage.deleteObject(passageKey(id));
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

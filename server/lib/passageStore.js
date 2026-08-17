import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASSAGES_DIR = path.join(__dirname, '..', 'data', 'passages');

fs.mkdirSync(PASSAGES_DIR, { recursive: true });

function passagePath(id) {
  return path.join(PASSAGES_DIR, `${id}.json`);
}

// In-memory cache of the whole store, since passage counts stay small
// (personal research vault) and most operations need to scan/filter anyway -
// mirrors the read-everything-then-filter pattern already used in docStore.js.
function listPassages() {
  return fs.readdirSync(PASSAGES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(PASSAGES_DIR, f), 'utf8')))
    .sort((a, b) => a.docId.localeCompare(b.docId) || a.order - b.order);
}

function getPassage(id) {
  const p = passagePath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function createPassage({ docId, order, location, html, text }) {
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
  fs.writeFileSync(passagePath(id), JSON.stringify(passage, null, 2), 'utf8');
  return passage;
}

function updatePassage(id, patch) {
  const existing = getPassage(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
  fs.writeFileSync(passagePath(id), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

function deletePassage(id) {
  const p = passagePath(id);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

function deletePassagesForDoc(docId) {
  for (const passage of listPassages()) {
    if (passage.docId === docId) deletePassage(passage.id);
  }
}

function passagesForDoc(docId) {
  return listPassages().filter(p => p.docId === docId).sort((a, b) => a.order - b.order);
}

// Only matches a caller-facing consumer (reader page) should ever see:
// auto-saved (high-confidence or explicit) or explicitly user-accepted.
function passagesForAyah(surah, ayah) {
  const results = [];
  for (const passage of listPassages()) {
    const hits = passage.matches.filter(m =>
      m.surah === surah && m.ayah === ayah && (m.status === 'auto' || m.status === 'accepted')
    );
    if (hits.length) results.push({ passage, matches: hits });
  }
  return results;
}

function passagesNeedingReview() {
  return listPassages().filter(p => p.matches.some(m => m.status === 'pending-review'));
}

export {
  listPassages, getPassage, createPassage, updatePassage, deletePassage,
  deletePassagesForDoc, passagesForDoc, passagesForAyah, passagesNeedingReview,
};

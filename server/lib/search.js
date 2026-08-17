import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env, pipeline } from '@xenova/transformers';
import { htmlToText } from './docStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, '..', 'data', 'search-index.json');

// Keep the model cache inside the project so the vault is self-contained.
env.cacheDir = path.join(__dirname, '..', 'model-cache');
env.allowRemoteModels = true;

let extractorPromise = null;
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  }
  return extractorPromise;
}

// chunkId -> { docId, text, vector }
let index = new Map();

function loadIndex() {
  if (fs.existsSync(INDEX_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
      index = new Map(raw.map(c => [c.chunkId, c]));
    } catch {
      index = new Map();
    }
  }
}

let saveTimer = null;
function persistIndex() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(INDEX_PATH, JSON.stringify([...index.values()]), 'utf8');
  }, 300);
}

function splitIntoChunks(html) {
  const text = htmlToText(html);
  if (!text) return [];
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  for (const para of paragraphs) {
    const sentences = para.match(/[^.!?]+[.!?]*/g) || [para];
    let buffer = '';
    for (const s of sentences) {
      buffer += s;
      if (buffer.trim().length >= 25) {
        chunks.push(buffer.trim());
        buffer = '';
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
  }
  return chunks.filter(c => c.length >= 3);
}

export async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export async function reindexDoc(doc) {
  for (const key of [...index.keys()]) {
    if (index.get(key).docId === doc.id) index.delete(key);
  }
  const chunks = splitIntoChunks(doc.html);
  let i = 0;
  for (const text of chunks) {
    const vector = await embed(text);
    const chunkId = `${doc.id}::${i++}`;
    index.set(chunkId, { chunkId, docId: doc.id, text, vector });
  }
  persistIndex();
}

export function removeDocFromIndex(docId) {
  for (const key of [...index.keys()]) {
    if (index.get(key).docId === docId) index.delete(key);
  }
  persistIndex();
}

export function cosineSim(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum; // vectors are already normalized
}

export async function semanticSearch(query, topK = 10) {
  if (!query || !query.trim()) return [];
  const qVec = await embed(query);
  const scored = [...index.values()].map(c => ({
    docId: c.docId,
    text: c.text,
    score: cosineSim(qVec, c.vector),
  }));
  scored.sort((a, b) => b.score - a.score);

  const bestPerDoc = new Map();
  for (const s of scored) {
    if (!bestPerDoc.has(s.docId) || bestPerDoc.get(s.docId).score < s.score) {
      bestPerDoc.set(s.docId, s);
    }
  }
  return [...bestPerDoc.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

export async function ensureModelWarm() {
  await getExtractor();
}

loadIndex();

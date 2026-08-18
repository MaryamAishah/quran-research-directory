import crypto from 'crypto';
import { getDoc, setProcessing } from './docStore.js';
import {
  createPassage, updatePassage, deletePassagesForDoc, passagesForDoc,
} from './passageStore.js';
import { extractPassages } from './passageSplitter.js';
import { detectExplicitReferences } from './referenceParser.js';
import { isLlmConfigured, classifyPassageBatch, batchArray } from './llm.js';

function contentHash(html) {
  return crypto.createHash('sha256').update(html || '').digest('hex');
}

// Resumable orchestrator: safe to call repeatedly for the same document.
// Already-matched passages are never reprocessed unless the document's
// content actually changed (or `force` is passed) - this is what keeps
// edits/retries cheap and makes a failed run resumable from where it left
// off rather than starting over.
export async function processDocument(docId, { force = false } = {}) {
  const doc = await getDoc(docId);
  if (!doc) return;

  const hash = contentHash(doc.html);
  const unchanged = !force && doc.processing?.contentHash === hash
    && ['complete', 'needs-review'].includes(doc.processing?.status);
  if (unchanged) return;

  await setProcessing(docId, { status: 'processing', error: null });

  const isNewContent = force || doc.processing?.contentHash !== hash;
  if (isNewContent) {
    await deletePassagesForDoc(docId);
    const extracted = extractPassages(doc.html);
    for (const p of extracted) {
      await createPassage({ docId, order: p.order, location: p.location, html: p.html, text: p.text });
    }
  }

  let passages = await passagesForDoc(docId);
  const pending = passages.filter(p => p.matchStatus === 'pending');

  // Deterministic pass first (requirement #13: never spend an LLM call on
  // something regex can resolve), threading surah context across passages
  // in document order.
  let context = null;
  const stillAmbiguous = [];
  for (const passage of pending) {
    const { matches, context: nextContext } = detectExplicitReferences(passage.text, context);
    context = nextContext;
    if (matches.length) {
      await updatePassage(passage.id, {
        matches: matches.map(m => ({ ...m, confidence: 1, source: 'explicit', status: 'auto' })),
        matchStatus: 'matched',
      });
    } else {
      stillAmbiguous.push(passage);
    }
  }

  if (!isLlmConfigured()) {
    // No key configured: leave these for manual review rather than blocking
    // the pipeline (requirement #8 works with or without an LLM key).
    for (const passage of stillAmbiguous) {
      await updatePassage(passage.id, { matches: [], matchStatus: 'matched' });
    }
  } else {
    for (const batch of batchArray(stillAmbiguous)) {
      try {
        const results = await classifyPassageBatch(batch);
        for (const passage of batch) {
          await updatePassage(passage.id, { matches: results.get(passage.id) || [], matchStatus: 'matched' });
        }
      } catch (err) {
        // Leave this batch (and any not yet attempted) as 'pending' so the
        // next call to processDocument only retries what's left undone.
        await setProcessing(docId, { status: 'error', error: err.message, contentHash: hash });
        return;
      }
    }
  }

  passages = await passagesForDoc(docId);
  const needsReview = passages.some(p => p.matches.some(m => m.status === 'pending-review'));
  await setProcessing(docId, {
    status: needsReview ? 'needs-review' : 'complete',
    error: null,
    contentHash: hash,
  });
}

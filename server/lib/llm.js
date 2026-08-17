import { ayahByRef } from './quranData.js';
import { topCandidateAyahs } from './ayahEmbeddings.js';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CANDIDATES_PER_PASSAGE = 5;
const DEFAULT_BATCH_SIZE = 6;

const AUTO_SAVE_THRESHOLD = 0.85;
const REVIEW_MIN_THRESHOLD = 0.5;

export function isLlmConfigured() {
  return !!process.env.OPENROUTER_API_KEY;
}

const SYSTEM_PROMPT = `You are a conservative Quran-reference classifier for a personal research tool.

For each numbered passage below, you are given a short list of CANDIDATE ayahs (verse number + English translation) that were retrieved by semantic search as the most likely matches. Your job is only to VERIFY which, if any, of these specific candidates the passage is clearly and specifically discussing - never invent a surah/ayah number that is not in the candidate list.

Rules (follow strictly):
- Only select a candidate if the passage's content clearly corresponds to what that specific ayah says, or is direct commentary/tafsir/analysis of that specific ayah.
- Sharing a THEME or TOPIC (e.g. "patience", "mercy", a prophet's name) with a candidate is NOT enough by itself - do not select a candidate on topical similarity alone.
- If none of the candidates are a clear, specific match, or several are equally plausible, return no_match: true instead of guessing.
- A passage may legitimately match zero, one, or a few (rarely more than 2) of its candidates.
- confidence must reflect true certainty: 0.9+ only when nearly certain; use lower values honestly; prefer a lower confidence or no_match over a hopeful guess.
- You may ONLY return surah/ayah numbers that appear in that passage's candidate list.

Respond ONLY with JSON matching this exact shape:
{"results": [{"index": 0, "no_match": false, "matches": [{"surah": 12, "ayah": 4, "confidence": 0.9}]}]}`;

function buildUserMessage(items) {
  return items.map((item, i) => {
    const candidateLines = item.candidates
      .map((c, ci) => `  ${String.fromCharCode(65 + ci)}) ${c.surah}:${c.ayah} - "${c.en}"`)
      .join('\n');
    return `[${i}] Passage: "${item.text}"\nCandidates:\n${candidateLines}`;
  }).join('\n\n');
}

function extractJson(content) {
  if (!content) return null;
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : content;
  try {
    return JSON.parse(raw);
  } catch {
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (!braceMatch) return null;
    try { return JSON.parse(braceMatch[0]); } catch { return null; }
  }
}

async function callOpenRouter(items) {
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-oss-20b:free';
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(items) },
      ],
      temperature: 0.1,
      max_tokens: 400 * items.length + 200,
      reasoning: { effort: 'low' },
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`OpenRouter request failed (${res.status}): ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = extractJson(content);
  if (!parsed || !Array.isArray(parsed.results)) {
    throw new Error('OpenRouter returned an unparseable response');
  }
  return parsed.results;
}

// Classifies one batch of passages (default up to 6) that had no explicit
// reference. Each passage is first grounded with its own top semantically-
// similar candidate ayahs (RAG-style retrieval) so the model verifies/ranks
// real candidates instead of recalling surah:ayah numbers from memory - this
// is what keeps hallucinated references out, on top of the validation below.
export async function classifyPassageBatch(passages) {
  const items = [];
  for (const p of passages) {
    const candidates = await topCandidateAyahs(p.text, CANDIDATES_PER_PASSAGE);
    items.push({ passageId: p.id, text: p.text, candidates });
  }

  const results = await callOpenRouter(items);

  const byId = new Map();
  for (const item of items) byId.set(item.passageId, item);

  const output = new Map(); // passageId -> matches[]
  for (const passage of passages) output.set(passage.id, []);

  for (const result of results) {
    const item = items[result.index];
    if (!item || result.no_match) continue;
    if (!Array.isArray(result.matches)) continue;

    const candidateSet = new Set(item.candidates.map(c => `${c.surah}:${c.ayah}`));
    const matches = [];
    for (const m of result.matches) {
      const surah = parseInt(m.surah, 10);
      const ayah = parseInt(m.ayah, 10);
      const confidence = Math.max(0, Math.min(1, Number(m.confidence) || 0));
      // Reject anything not a real, validated ayah, and anything outside
      // the candidate set we actually offered (requirement #15).
      if (!ayahByRef(surah, ayah)) continue;
      if (!candidateSet.has(`${surah}:${ayah}`)) continue;
      if (confidence < REVIEW_MIN_THRESHOLD) continue;
      matches.push({
        surah, ayah, confidence, source: 'llm',
        status: confidence >= AUTO_SAVE_THRESHOLD ? 'auto' : 'pending-review',
      });
    }
    output.set(item.passageId, matches);
  }

  return output; // Map<passageId, match[]>
}

export function batchArray(arr, size = DEFAULT_BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < arr.length; i += size) batches.push(arr.slice(i, i + size));
  return batches;
}

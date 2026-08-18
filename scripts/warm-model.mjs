// Run at Docker build time to bake the semantic-search embedding model into
// the image, so cold starts on the hosted deployment don't depend on
// downloading it from Hugging Face on every wake-up.
import { ensureModelWarm } from '../server/lib/search.js';

await ensureModelWarm();
console.log('Embedding model downloaded and cached.');

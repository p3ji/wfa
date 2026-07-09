/**
 * build_embeddings.js -- ONE-TIME local script to generate semantic embeddings.
 *
 * Run with: node --env-file=.env build_embeddings.js
 *
 * Reads:  public/children.json  (2418 chunks)
 * Writes: api/embeddings.json   ({ ids: string[], embeddings: number[][] })
 *
 * Re-run this script whenever you add new policy documents and regenerate children.json.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -- Config --
const EMBEDDING_MODEL   = 'gemini-embedding-001';
const OUTPUT_DIM        = 256;   // reduces file size; still highly accurate
const BATCH_SIZE        = 1;     // one at a time to stay well under 100 RPM free tier
const DELAY_MS          = 750;   // ~80 req/min — safely under the 100 RPM free-tier cap
const MAX_CONTENT_CHARS = 2000;  // truncate very long chunks

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY not found. Run with: node --env-file=.env build_embeddings.js');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  const chunksPath = join(__dirname, 'public', 'children.json');
  const outputPath = join(__dirname, 'api', 'embeddings.json');

  if (!existsSync(chunksPath)) {
    console.error('ERROR: children.json not found at: ' + chunksPath);
    process.exit(1);
  }

  const chunks = JSON.parse(readFileSync(chunksPath, 'utf-8'));
  console.log('Loaded ' + chunks.length + ' chunks from children.json');

  // Load existing embeddings so we can resume without re-embedding already-done chunks
  let existingIds = new Map();  // id -> embedding array
  if (existsSync(outputPath)) {
    const existing = JSON.parse(readFileSync(outputPath, 'utf-8'));
    existing.ids.forEach((id, i) => {
      const emb = existing.embeddings[i];
      // Only keep non-zero vectors (zero = failed placeholder)
      const isValid = emb && emb.some(v => v !== 0);
      if (isValid) existingIds.set(id, emb);
    });
    console.log('Resuming: ' + existingIds.size + ' already embedded, ' +
                (chunks.length - existingIds.size) + ' remaining.');
  }

  const todo = chunks.filter(c => !existingIds.has(c.id));
  console.log('Output dimensions: ' + OUTPUT_DIM);
  console.log('Chunks to embed: ' + todo.length);
  console.log('Estimated time: ~' + Math.ceil(todo.length * DELAY_MS / 60000) + ' minutes\n');

  let errors = 0;
  const newEmbeddings = new Map(); // id -> embedding

  for (let i = 0; i < todo.length; i++) {
    const chunk = todo[i];
    process.stdout.write('\r' + (i+1) + '/' + todo.length + ' (' + errors + ' errors)...');
    try {
      const text = (chunk.content || '').slice(0, MAX_CONTENT_CHARS);
      const result = await model.embedContent({
        content: { parts: [{ text }], role: 'user' },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: OUTPUT_DIM,
      });
      newEmbeddings.set(chunk.id, result.embedding.values);
    } catch (err) {
      errors++;
      console.error('\nError on chunk ' + chunk.id + ': ' + err.message);
      newEmbeddings.set(chunk.id, new Array(OUTPUT_DIM).fill(0)); // zero placeholder
    }
    if (i < todo.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log('\n\nEmbedded ' + todo.length + ' chunks (' + errors + ' errors).');

  // Merge: existing valid + newly embedded, in original chunk order
  const ids = [];
  const embeddings = [];
  for (const chunk of chunks) {
    ids.push(chunk.id);
    embeddings.push(existingIds.get(chunk.id) || newEmbeddings.get(chunk.id) || new Array(OUTPUT_DIM).fill(0));
  }

  const validCount = embeddings.filter(e => e.some(v => v !== 0)).length;
  console.log('Valid embeddings: ' + validCount + '/' + chunks.length);

  const index = { ids, embeddings };
  const json = JSON.stringify(index);
  writeFileSync(outputPath, json);

  const sizeMB = (json.length / 1024 / 1024).toFixed(2);
  console.log('Saved api/embeddings.json (' + sizeMB + ' MB)');
  console.log('Commit api/embeddings.json and push to deploy!');
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});

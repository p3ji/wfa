import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// -- Module-level cache (persists across warm serverless invocations) ---------
let embeddingsIndex = null;  // { ids: string[], embeddings: number[][] }
let chunksMap = null;        // Map<id, chunk>

function loadData() {
  if (!embeddingsIndex) {
    const embPath = join(__dirname, "embeddings.json");
    embeddingsIndex = JSON.parse(readFileSync(embPath, "utf-8"));
    console.log("Loaded " + embeddingsIndex.ids.length + " embeddings into cache");
  }
  if (!chunksMap) {
    // public/children.json is accessible from the project root on Vercel
    const chunksPath = join(process.cwd(), "public", "children.json");
    const chunks = JSON.parse(readFileSync(chunksPath, "utf-8"));
    chunksMap = new Map(chunks.map(c => [c.id, c]));
    console.log("Loaded " + chunksMap.size + " chunks into cache");
  }
}

// -- Cosine similarity ---------------------------------------------------------
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// -- Keyword fallback (used when chunks have zero embeddings or to boost search) ──
function keywordSearch(query, topK = 8) {
  const terms = query.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/[\s-]+/)
    .map(w => {
      if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
      if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
      if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
      if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
      return w;
    })
    .filter(w => w.length > 2 && !['the','and','for','are','that','this','with','from','have','they','what','when','where','which','will','can','does','not','you','your'].includes(w));

  if (terms.length === 0) return [];

  const scored = [];
  for (const [id, chunk] of chunksMap) {
    const text = chunk.content.toLowerCase();
    let score = 0;
    for (const term of terms) {
      let count = 0;
      let pos = text.indexOf(term);
      while (pos !== -1) {
        count++;
        pos = text.indexOf(term, pos + 1);
      }
      score += count;
    }
    // Boost matching document title / section names
    const docLower = (chunk.metadata.document || '').toLowerCase();
    const secLower = (chunk.metadata.section || '').toLowerCase();
    for (const term of terms) {
      if (docLower.includes(term)) score += 3;
      if (secLower.includes(term)) score += 2;
    }

    if (score > 0) {
      scored.push({ chunk, score: score / 10 }); // scale to comparable range
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// -- Semantic search with keyword blending ────────────────────────────────────
async function semanticSearch(query, genAI, topK = 8) {
  let queryVec = null;
  try {
    const embModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const result = await embModel.embedContent({
      content: { parts: [{ text: query.slice(0, 2000) }], role: "user" },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 256,
    });
    queryVec = result.embedding.values;
  } catch (err) {
    console.error("Embedding API error, falling back completely to keyword:", err.message);
    return keywordSearch(query, topK);
  }

  const { ids, embeddings } = embeddingsIndex;
  
  // 1. Get semantic scores only for embedded chunks (non-zero vectors)
  const semanticResults = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const emb = embeddings[i];
    const hasEmbedding = emb && emb.some(v => v !== 0);
    if (hasEmbedding) {
      const score = cosineSimilarity(queryVec, emb);
      semanticResults.push({ id, score });
    }
  }
  
  // Sort semantic results by score descending
  semanticResults.sort((a, b) => b.score - a.score);
  
  const topSemantic = semanticResults.slice(0, topK).map(({ id, score }) => {
    const chunk = chunksMap.get(id);
    if (!chunk) return null;
    return { chunk, score };
  }).filter(Boolean);

  // 2. Get keyword search results across ALL chunks
  const kwResults = keywordSearch(query, topK);

  // 3. Blend them:
  // We want to return a mix of both. If there are high-scoring keyword matches (especially for unembedded chunks),
  // they must be included.
  const blended = [];
  const seenIds = new Set();

  // Add the top 4 semantic results first (if they have decent similarity, e.g. > 0.3)
  for (const sem of topSemantic) {
    if (sem.score > 0.3 && blended.length < Math.floor(topK / 2)) {
      blended.push(sem);
      seenIds.add(sem.chunk.id);
    }
  }

  // Next, add keyword results (prioritising those not already added)
  for (const kw of kwResults) {
    if (!seenIds.has(kw.chunk.id) && blended.length < topK) {
      blended.push(kw);
      seenIds.add(kw.chunk.id);
    }
  }

  // Fill up any remaining slots with the remaining semantic results
  for (const sem of topSemantic) {
    if (!seenIds.has(sem.chunk.id) && blended.length < topK) {
      blended.push(sem);
      seenIds.add(sem.chunk.id);
    }
  }

  return blended;
}


// -- Request handler -----------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, equivalencyContext, model, systemInstruction } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!query) return res.status(400).json({ error: "Missing query" });
  if (!apiKey) return res.status(500).json({
    error: "GEMINI_API_KEY environment variable is not configured on the server. Please add it in your Vercel project settings."
  });

  try {
    loadData();

    const genAI = new GoogleGenerativeAI(apiKey);

    // 1. Semantic search for relevant chunks
    const scoredChunks = await semanticSearch(query, genAI, 8);

    // 2. Build context string for the LLM
    let context = "";
    if (equivalencyContext) {
      context += equivalencyContext + "\n\n";
    }
    scoredChunks.forEach(({ chunk }, i) => {
      context += `[Source ${i + 1} - ${chunk.metadata.document}, Section: ${chunk.metadata.section}, URL: ${chunk.metadata.url}]\n"${chunk.content}"\n\n`;
    });

    const fullPrompt = `CONTEXT FROM WFA POLICY SOURCES:\n\n${context}---\n\nQUESTION: ${query}`;

    // 3. Generate answer with Gemini
    const genModel = genAI.getGenerativeModel({
      model: model || "gemini-2.5-flash",
      systemInstruction: systemInstruction,
    });

    const genResult = await genModel.generateContent(fullPrompt);
    const text = genResult.response.text();

    // 4. Return answer + chunk metadata so the client can populate the context drawer
    const retrievedChunks = scoredChunks.map(({ chunk, score }) => ({
      id:         chunk.id,
      score:      parseFloat(score.toFixed(4)),
      document:   chunk.metadata.document,
      section:    chunk.metadata.section,
      subsection: chunk.metadata.subsection || null,
      content:    chunk.content,
    }));

    return res.status(200).json({ text, retrievedChunks });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message || "Error generating response" });
  }
}

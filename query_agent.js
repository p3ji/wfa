import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Stop words for search tokenization
const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'cant', 'cannot', 'could',
  'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell', 'hes', 'her', 'here',
  'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill', 'im', 'ive', 'if', 'in',
  'into', 'is', 'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt', 'my', 'myself', 'no', 'nor',
  'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so', 'some', 'such', 'than', 'that', 'thats',
  'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'theres', 'these', 'they', 'theyd', 'theyll',
  'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasnt', 'we',
  'wed', 'well', 'were', 'weve', 'werent', 'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which', 'while',
  'who', 'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldnt', 'you', 'youd', 'youll', 'youre', 'youve',
  'your', 'yours', 'yourself', 'yourselves'
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/[\s_]+/)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

function retrieveChunks(query, chunks, topK = 5) {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) {
    return chunks.slice(0, topK);
  }

  const scoredChunks = chunks.map(chunk => {
    let score = 0;
    const content = chunk.content || '';
    const section = (chunk.metadata && chunk.metadata.section) || '';
    const subsection = (chunk.metadata && chunk.metadata.subsection) || '';
    
    const contentLower = content.toLowerCase();
    const sectionLower = section.toLowerCase();
    const subsectionLower = subsection.toLowerCase();
    
    queryTerms.forEach(term => {
      const regex = new RegExp('\\b' + term + '\\b', 'g');
      const contentMatches = contentLower.match(regex);
      if (contentMatches) {
        score += contentMatches.length * 1.0;
      }
      if (sectionLower.includes(term)) score += 3.0;
      if (subsectionLower.includes(term)) score += 4.0;
    });
    
    for (let i = 0; i < queryTerms.length - 1; i++) {
      const phrase = `${queryTerms[i]} ${queryTerms[i+1]}`;
      if (contentLower.includes(phrase)) score += 5.0;
      if (sectionLower.includes(phrase)) score += 10.0;
      if (subsectionLower.includes(phrase)) score += 15.0;
    }
    
    return { chunk, score };
  });
  
  const sorted = scoredChunks
    .filter(sc => sc.score > 0)
    .sort((a, b) => b.score - a.score);
    
  if (sorted.length === 0) {
    console.log("No keyword matches found. Falling back to default chunks.");
    return chunks.slice(0, topK);
  }
  
  return sorted.slice(0, topK).map(sc => sc.chunk);
}

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Error: Please provide a question as a CLI argument.");
    console.error("Example: node query_agent.js \"How many days do I get to choose WFA options?\"");
    process.exit(1);
  }
  
  // Load local .env file if it exists and process.env key is not set
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const parts = trimmed.split('=');
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY environment variable is not set.");
    process.exit(1);
  }
  
  const childrenPath = path.join(__dirname, 'children.json');
  const systemPromptPath = path.join(__dirname, 'wfa_agent_system_prompt.md');
  
  if (!fs.existsSync(childrenPath) || !fs.existsSync(systemPromptPath)) {
    console.error("Error: database files (children.json or wfa_agent_system_prompt.md) missing.");
    process.exit(1);
  }
  
  const chunks = JSON.parse(fs.readFileSync(childrenPath, 'utf-8'));
  const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');
  
  console.log(`Searching for relevant chunks for query: "${query}"...`);
  const retrieved = retrieveChunks(query, chunks, 5);
  
  console.log(`\nRetrieved ${retrieved.length} relevant chunks:`);
  retrieved.forEach((c, idx) => {
    console.log(`  [${idx + 1}] ID: ${c.id} - Source: ${c.metadata.document} (${c.metadata.section} -> ${c.metadata.subsection || ''})`);
  });
  
  let formattedContext = "CONTEXT:\n\n";
  retrieved.forEach((chunk, index) => {
    formattedContext += `[Chunk #${index + 1} - Document: ${chunk.metadata.document}, Section: ${chunk.metadata.section}, Subsection: ${chunk.metadata.subsection || 'None'}, Source URL: ${chunk.metadata.url}]\n`;
    formattedContext += `"${chunk.content}"\n\n`;
  });
  
  const promptContent = `${formattedContext}QUESTION:\n${query}`;
  
  try {
    console.log("\nSending query to Gemini API...");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });
    
    const result = await model.generateContent(promptContent);
    const response = await result.response;
    const answer = response.text();
    
    console.log("\n========================================================");
    console.log("AGENT RESPONSE (GEMINI):");
    console.log("========================================================");
    console.log(answer);
    console.log("========================================================");
  } catch (error) {
    console.error("Error querying Gemini API:", error);
    process.exit(1);
  }
}

main();

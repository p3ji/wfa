import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// Global function to auto-fill and submit suggested questions
window.askSuggestedQuestion = function(questionText) {
  const cleanText = questionText
    .replace(/^[-\*\d\.\s\?\"\'“‘]+|[”’\"\'\?]+$/g, '')
    .trim() + '?';
  const queryInput = document.getElementById('queryInput');
  if (queryInput) {
    queryInput.value = cleanText;
    queryInput.style.height = 'auto';
    queryInput.style.height = (queryInput.scrollHeight) + 'px';
  }
  const inputForm = document.getElementById('inputForm');
  if (inputForm) {
    inputForm.requestSubmit();
  }
};

// Stop words for search tokenization
const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'cant', 'cannot', 'could',
  'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell', 'hes', 'her', 'here',
  'heres', 'heres', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill', 'im', 'ive', 'if', 'in',
  'into', 'is', 'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt', 'my', 'myself', 'no', 'nor',
  'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so', 'some', 'such', 'than', 'that', 'thats',
  'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'theres', 'these', 'they', 'theyd', 'theyll',
  'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasnt', 'we',
  'wed', 'well', 'were', 'weve', 'werent', 'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which', 'while',
  'who', 'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldnt', 'you', 'youd', 'youll', 'youre', 'youve',
  'your', 'yours', 'yourself', 'yourselves'
]);

// WFA agent system prompt
const SYSTEM_PROMPT = `You are a strict, authoritative assistant specializing in the Work Force Adjustment (WFA) process for the Canadian Federal Public Service. Your sole purpose is to provide accurate, factual information regarding WFA policies, directives, and official clarifications based only on the provided sources.

Core Directives:
1. Strict Source Constraint: Answer queries using ONLY the provided policy sources. Do not assume or extrapolate. Never mention terms like "context", "context blocks", "database", or "provided chunks" in your conversations. Instead, refer to "the provided WFA policies", "the official guidelines", or "the sources provided". If the sources do not contain the answer, explain that the provided WFA policies do not contain this information, and suggest 3 related questions/topics covered in the WFA policies that you can answer (e.g., opting options, alternation rules, retraining/education allowance, transition support, or classification equivalencies).
2. Resolution of Conflict: Prioritize the most recent directive or clarification.
3. Mandatory Citations: Every factual claim or quote you write MUST be followed by a citation containing the source document URL. Format: ([Source Name]([URL])).
4. No Personal Speculation: Explain general rules, never make guarantees.
5. Style and Tone: Objective, formal, neutral. Use lists to break down complex text.`;

// State Variables
let chunks = [];
let wfaEquivalencies = {};
let apiKey = localStorage.getItem('GEMINI_API_KEY') || '';
let selectedModel = localStorage.getItem('GEMINI_MODEL') || 'gemini-2.5-flash';

// DOM Elements
const docListEl = document.getElementById('docList');
const btnToggleContext = document.getElementById('btnToggleContext');
const btnCloseDrawer = document.getElementById('btnCloseDrawer');
const contextDrawer = document.getElementById('contextDrawer');
const contextContent = document.getElementById('contextContent');
const chatFeed = document.getElementById('chatFeed');
const inputForm = document.getElementById('inputForm');
const queryInput = document.getElementById('queryInput');
const btnSend = document.getElementById('btnSend');

// Initialization
async function init() {
  // Enable send button by default (the app will use Vercel Serverless Function /api/chat if no local key is set)
  btnSend.removeAttribute('disabled');

  // Load databases
  try {
    const response = await fetch('./children.json');
    chunks = await response.json();
    populateSourceDocuments();
  } catch (error) {
    console.error('Failed to load children.json database:', error);
    appendSystemMessage('System Error', 'Failed to load policy knowledge base. Please check if children.json exists in the project folder.', 'danger');
  }

  try {
    const equivResponse = await fetch('./wfa_equivalencies.json');
    wfaEquivalencies = await equivResponse.json();
    console.log('Loaded WFA equivalencies database:', Object.keys(wfaEquivalencies).length, 'classifications');
  } catch (error) {
    console.error('Failed to load wfa_equivalencies.json database:', error);
  }

  // Setup Event Listeners
  btnToggleContext.addEventListener('click', () => contextDrawer.classList.toggle('collapsed'));
  btnCloseDrawer.addEventListener('click', () => contextDrawer.classList.add('collapsed'));
  
  inputForm.addEventListener('submit', handleQuerySubmit);
  queryInput.addEventListener('input', autoResizeTextArea);
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputForm.requestSubmit();
    }
  });
}

// Populate Document list in sidebar
function populateSourceDocuments() {
  const documents = [
    { name: "WFA Directive (NJC)", url: "https://www.njc-cnm.gc.ca/directive/d12/v239/en", type: "Baseline" },
    { name: "WFA TSM Scale Annex C", url: "https://www.njc-cnm.gc.ca/directive/d12/v239/en", type: "Baseline" },
    { name: "WFA Policy Info (TBS)", url: "https://www.canada.ca/en/government/publicservice/workforce/workforce-adjustment.html", type: "Policy" },
    { name: "PSC Retention/Layoff Guide", url: "https://www.canada.ca/en/public-service-commission/services/public-service-hiring-guides/selection-employees-retention-layoff-guide-managers-hr.html", type: "Guide" },
    { name: "CAPE Member Guide 2025", url: "https://www.acep-cape.ca/sites/default/files/2025-12/WFA2025MemberGuideEN20250530.pdf", type: "Union" },
    { name: "PSAC Member Guide 2025", url: "https://psacunion.ca/sites/psac/files/2025-psac-wfa-members-guide.pdf", type: "Union" }
  ];

  docListEl.innerHTML = documents.map(doc => `
    <li class="doc-item">
      <h4>${doc.name}</h4>
      <div class="doc-meta">
        <span class="doc-type">${doc.type}</span>
        <a href="${doc.url}" target="_blank" rel="noopener" class="btn-link">
          Source <i class="fa-solid fa-external-link"></i>
        </a>
      </div>
    </li>
  `).join('');
}

// Textarea auto-resize
function autoResizeTextArea() {
  queryInput.style.height = 'auto';
  queryInput.style.height = (queryInput.scrollHeight) + 'px';
}

// RAG Search Tokenizer
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/[\s_]+/)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

// Look up a classification code in the user query
function findClassificationInQuery(query) {
  if (!wfaEquivalencies || Object.keys(wfaEquivalencies).length === 0) return null;
  const normalizedQuery = query.toUpperCase();
  for (const key of Object.keys(wfaEquivalencies)) {
    const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp('\\b' + escapedKey + '\\b', 'i');
    if (regex.test(normalizedQuery)) {
      return key;
    }
    const noHyphenKey = key.replace('-', '');
    const noHyphenRegex = new RegExp('\\b' + noHyphenKey + '\\b', 'i');
    if (noHyphenRegex.test(normalizedQuery)) {
      return key;
    }
  }
  return null;
}

// RAG Retrieval Engine
function retrieveChunks(query, topK = 5) {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || chunks.length === 0) {
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
    
    // Check term matches
    queryTerms.forEach(term => {
      const regex = new RegExp('\\b' + term + '\\b', 'g');
      const matches = contentLower.match(regex);
      if (matches) {
        score += matches.length * 1.0;
      }
      if (sectionLower.includes(term)) score += 3.0;
      if (subsectionLower.includes(term)) score += 4.0;
    });
    
    // Multi-term phrase matches
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
    return chunks.slice(0, topK);
  }

  return sorted.slice(0, topK);
}

// Update Search Context Drawer
function updateContextDrawer(scoredChunks, equivalencyInfo = null) {
  let cardsHtml = '';
  
  if (equivalencyInfo) {
    const totalCount = equivalencyInfo.equivalents.length;
    const top5 = equivalencyInfo.equivalents.slice(0, 5);
    const top5Html = top5.map(eq => `
      <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.85rem;">
        <span><strong>${eq.classification}</strong> (${eq.group})</span>
        <span>${eq.is_hourly ? '$' + eq.max_salary + '/hr' : '$' + eq.max_salary.toLocaleString()} (${eq.diff_percent >= 0 ? '+' : ''}${eq.diff_percent}%)</span>
      </div>
    `).join('');
    
    cardsHtml += `
      <div class="context-card" style="border-left: 3px solid var(--primary);">
        <div class="context-card-header">
          <span>Database Lookup</span>
          <span class="context-score" style="background: var(--primary); color: #000; font-weight: bold; border: none;">Direct Match</span>
        </div>
        <div class="context-title">
          WFA Equivalency: ${equivalencyInfo.classification}<br>
          <small>Max salary: ${equivalencyInfo.is_hourly ? '$' + equivalencyInfo.max_salary + '/hr' : '$' + equivalencyInfo.max_salary.toLocaleString()}</small>
        </div>
        <div class="context-content" style="font-family: inherit;">
          <div style="margin-bottom: 8px; font-weight: 500; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">
            Top 5 of ${totalCount} Equivalent Classifications (within 6%):
          </div>
          ${top5Html}
          ${totalCount > 5 ? `<div style="text-align: center; margin-top: 6px; font-size: 0.8rem; opacity: 0.7;">+ ${totalCount - 5} more equivalent classifications</div>` : ''}
        </div>
      </div>
    `;
  }

  if (scoredChunks.length === 0 && !equivalencyInfo) {
    contextContent.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>No keyword matches found. Falling back to default baseline chunks.</p>
      </div>
    `;
    return;
  }

  cardsHtml += scoredChunks.map(sc => `
    <div class="context-card">
      <div class="context-card-header">
        <span>Chunk ID: ${sc.chunk.id}</span>
        <span class="context-score">Score: ${sc.score.toFixed(1)}</span>
      </div>
      <div class="context-title">
        ${sc.chunk.metadata.document}<br>
        <small>${sc.chunk.metadata.section} &rarr; ${sc.chunk.metadata.subsection || 'General'}</small>
      </div>
      <div class="context-content">
        "${sc.chunk.content}"
      </div>
    </div>
  `).join('');
  
  contextContent.innerHTML = cardsHtml;
}

// Send user query and fetch response from Gemini
async function handleQuerySubmit(e) {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;

  // Clear query and reset textarea size
  queryInput.value = '';
  queryInput.style.height = 'auto';

  // Add User Message
  appendMessage('user', query);

  // Show Typing Indicator
  const typingIndicator = appendTypingIndicator();

  // WFA Equivalency lookup check
  const isEquivalencyQuery = /equiv|alternate|alternation|at-level|deploy/i.test(query);
  const matchedClass = findClassificationInQuery(query);
  let equivalencyInfo = null;
  let equivalencyContext = "";
  
  if (isEquivalencyQuery && matchedClass && wfaEquivalencies[matchedClass]) {
    equivalencyInfo = wfaEquivalencies[matchedClass];
    equivalencyContext = `[Source: Treasury Board Secretariat Pay Rates Database, WFA Equivalency Calculator]\n`;
    equivalencyContext += `The official equivalent classifications for WFA alternation/at-level deployment for ${matchedClass} (Pay Group: ${equivalencyInfo.group}, Maximum Salary: ${equivalencyInfo.is_hourly ? '$' + equivalencyInfo.max_salary + '/hr' : '$' + equivalencyInfo.max_salary.toLocaleString()}) are:\n`;
    
    equivalencyInfo.equivalents.forEach(eq => {
      equivalencyContext += `- ${eq.classification} (Group: ${eq.group}, Max Salary: ${eq.is_hourly ? '$' + eq.max_salary + '/hr' : '$' + eq.max_salary.toLocaleString()}, Difference: ${eq.diff_percent >= 0 ? '+' : ''}${eq.diff_percent}%)\n`;
    });
    
    equivalencyContext += `\nINSTRUCTIONS FOR AGENT: Use this database data to list equivalents or deployment options for ${matchedClass}. Explain that equivalents are based on maximum rates of pay within 6%. State that there are ${equivalencyInfo.equivalents.length} equivalents in total. Cite this data as coming from the Treasury Board Rates of Pay database.\n\n`;
    
    // Slide open the context drawer
    contextDrawer.classList.remove('collapsed');
  }

  // 1. Retrieve RAG Chunks
  const scoredRetrieved = retrieveChunks(query, 5);
  updateContextDrawer(scoredRetrieved, equivalencyInfo);
  const retrievedChunks = scoredRetrieved.map(sc => sc.chunk);

  // 2. Format context for prompt
  let formattedContext = "CONTEXT:\n\n";
  if (equivalencyContext) {
    formattedContext += equivalencyContext;
  }
  retrievedChunks.forEach((chunk, index) => {
    formattedContext += `[Chunk #${index + 1} - Document: ${chunk.metadata.document}, Section: ${chunk.metadata.section}, Subsection: ${chunk.metadata.subsection || 'None'}, Source URL: ${chunk.metadata.url}]\n`;
    formattedContext += `"${chunk.content}"\n\n`;
  });

  const promptContent = `${formattedContext}QUESTION:\n${query}`;

  // 3. Call Gemini API
  try {
    let answer = "";
    
    if (!apiKey) {
      // Send request to Vercel Serverless Function backend
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: promptContent,
          model: selectedModel,
          systemInstruction: SYSTEM_PROMPT
        })
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      answer = data.text;
    } else {
      // Direct client-side SDK call
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: selectedModel,
        systemInstruction: SYSTEM_PROMPT,
      });

      const result = await model.generateContent(promptContent);
      const response = await result.response;
      answer = response.text();
    }

    // Remove typing indicator and append answer
    typingIndicator.remove();
    appendMessage('assistant', answer);
  } catch (error) {
    console.error('Gemini API Error:', error);
    typingIndicator.remove();
    appendSystemMessage(
      'API Request Failed',
      `Error calling Gemini API: ${error.message || 'Unknown network error'}. Please verify your API Key and network connection in Settings.`,
      'danger'
    );
  }
}

// Append typical messages (user or assistant)
function appendMessage(role, text) {
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = role === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  
  if (role === 'assistant') {
    bubble.innerHTML = formatMarkdownAndCitations(text);
  } else {
    bubble.textContent = text;
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  chatFeed.appendChild(wrapper);
  scrollToBottom();
  
  return wrapper;
}

// Append simple system messages
function appendSystemMessage(title, text, type = 'info') {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = '<i class="fa-solid fa-shield-halved"></i>';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.style.borderLeft = `3px solid var(--${type === 'danger' ? 'danger' : 'primary'})`;
  bubble.innerHTML = `<strong>${title}</strong><br><p>${text}</p>`;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  chatFeed.appendChild(wrapper);
  scrollToBottom();
}

// Append Typing indicator
function appendTypingIndicator() {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.innerHTML = '<i class="fa-solid fa-robot"></i>';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = `
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  `;
  
  bubble.appendChild(indicator);
  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  chatFeed.appendChild(wrapper);
  scrollToBottom();

  return wrapper;
}

function scrollToBottom() {
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

// Basic markdown formatting and citation button replacement
function formatMarkdownAndCitations(text) {
  // Escaping characters to prevent XSS (allowing standard formatting replacements afterwards)
  let clean = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Format bold (**text** or __text__)
  clean = clean.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  clean = clean.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // Format lists: bullet lists
  clean = clean.replace(/^\s*-\s+(.*?)$/gm, '<li>$1</li>');
  clean = clean.replace(/^\s*\*\s+(.*?)$/gm, '<li>$1</li>');
  // Group consecutive list items into ul
  clean = clean.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');

  // Format lists: numbered lists
  clean = clean.replace(/^\s*(\d+)\.\s+(.*?)$/gm, '<li>$2</li>');
  // Group consecutive list items into ol (using custom class to avoid tag overlap)
  clean = clean.replace(/(<li>.*?<\/li>)/g, '$1');

  // Format code blocks (`code`)
  clean = clean.replace(/`(.*?)`/g, '<code>$1</code>');

  // Parse citations: e.g. ([Source Name](https://...))
  // We extract them and replace them with interactive button elements
  const citationRegex = /\(\[([^\]]+)\]\((https?:\/\/[^\)]+)\)\)/g;
  clean = clean.replace(citationRegex, (match, name, url) => {
    return `<button class="citation-btn" onclick="window.open('${url}', '_blank')"><i class="fa-solid fa-external-link"></i> ${name}</button>`;
  });

  // Parse standard markdown links [text](url)
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
  clean = clean.replace(linkRegex, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Identify suggested questions in list items and make them clickable
  clean = clean.replace(/<li>(.*?)<\/li>/g, (match, content) => {
    // Strip HTML tags to check if the plain text ends with a question mark
    const stripped = content.replace(/<[^>]*>/g, '').trim();
    if (stripped.endsWith('?')) {
      const safeText = stripped.replace(/'/g, "\\'").replace(/"/g, "&quot;");
      return `<li><span class="suggested-question-link" onclick="window.askSuggestedQuestion('${safeText}')">${content}</span></li>`;
    }
    return match;
  });

  // Paragraph formatting: convert double line breaks to paragraphs
  const paragraphs = clean.split(/\n\n+/);
  return paragraphs.map(p => {
    // If it's already list tags, don't wrap in p
    if (p.trim().startsWith('<ul>') || p.trim().startsWith('<ol>')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

// Window init
window.addEventListener('DOMContentLoaded', init);

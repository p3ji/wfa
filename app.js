import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

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
const SYSTEM_PROMPT = `You are a strict, authoritative assistant specializing in the Work Force Adjustment (WFA) process for the Canadian Federal Public Service. Your sole purpose is to provide accurate, factual information regarding WFA policies, directives, and official clarifications based only on the provided context.

Core Directives:
1. Strict Context Constraint: Answer queries using ONLY the provided context blocks. Do not assume or extrapolate. If the context does not contain the answer, you must respond with: "I am sorry, but I cannot find that information in the official policy documents provided. If this is a specific case, please consult your union representative or departmental Human Resources advisor."
2. Resolution of Conflict: Prioritize the most recent directive or clarification.
3. Mandatory Citations: Every factual claim or quote you write MUST be followed by a citation containing the source document URL. Format: ([Source Name]([URL])).
4. No Personal Speculation: Explain general rules, never make guarantees.
5. Style and Tone: Objective, formal, neutral. Use lists to break down complex text.`;

// State Variables
let chunks = [];
let apiKey = localStorage.getItem('GEMINI_API_KEY') || '';
let selectedModel = localStorage.getItem('GEMINI_MODEL') || 'gemini-2.5-flash';

// DOM Elements
const docListEl = document.getElementById('docList');
const btnSettings = document.getElementById('btnSettings');
const btnToggleContext = document.getElementById('btnToggleContext');
const btnCloseDrawer = document.getElementById('btnCloseDrawer');
const contextDrawer = document.getElementById('contextDrawer');
const contextContent = document.getElementById('contextContent');
const chatFeed = document.getElementById('chatFeed');
const inputForm = document.getElementById('inputForm');
const queryInput = document.getElementById('queryInput');
const btnSend = document.getElementById('btnSend');
const settingsModal = document.getElementById('settingsModal');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const btnCancelSettings = document.getElementById('btnCancelSettings');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelSelect = document.getElementById('modelSelect');
const btnTogglePassword = document.getElementById('btnTogglePassword');

// Initialization
async function init() {
  // Load configuration
  if (apiKey) {
    apiKeyInput.value = apiKey;
    btnSend.removeAttribute('disabled');
  } else {
    showSettingsModal();
  }
  modelSelect.value = selectedModel;

  // Load database
  try {
    const response = await fetch('./children.json');
    chunks = await response.json();
    populateSourceDocuments();
  } catch (error) {
    console.error('Failed to load children.json database:', error);
    appendSystemMessage('System Error', 'Failed to load policy knowledge base. Please check if children.json exists in the project folder.', 'danger');
  }

  // Setup Event Listeners
  btnSettings.addEventListener('click', showSettingsModal);
  btnCloseSettings.addEventListener('click', hideSettingsModal);
  btnCancelSettings.addEventListener('click', hideSettingsModal);
  btnSaveSettings.addEventListener('click', saveSettings);
  btnTogglePassword.addEventListener('click', togglePasswordVisibility);
  
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

// Password hide/show toggle
function togglePasswordVisibility() {
  const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
  apiKeyInput.setAttribute('type', type);
  btnTogglePassword.querySelector('i').classList.toggle('fa-eye');
  btnTogglePassword.querySelector('i').classList.toggle('fa-eye-slash');
}

// Modal Visibility Helpers
function showSettingsModal() {
  settingsModal.classList.add('active');
}

function hideSettingsModal() {
  settingsModal.classList.remove('active');
}

function saveSettings() {
  const key = apiKeyInput.value.trim();
  const model = modelSelect.value;
  
  if (key) {
    localStorage.setItem('GEMINI_API_KEY', key);
    localStorage.setItem('GEMINI_MODEL', model);
    apiKey = key;
    selectedModel = model;
    btnSend.removeAttribute('disabled');
    hideSettingsModal();
    appendSystemMessage('Settings Saved', 'API Configuration successfully updated.', 'success');
  } else {
    alert('Please enter a valid Gemini API Key.');
  }
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
function updateContextDrawer(scoredChunks) {
  if (scoredChunks.length === 0) {
    contextContent.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>No keyword matches found. Falling back to default baseline chunks.</p>
      </div>
    `;
    return;
  }

  contextContent.innerHTML = scoredChunks.map(sc => `
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

  // 1. Retrieve RAG Chunks
  const scoredRetrieved = retrieveChunks(query, 5);
  updateContextDrawer(scoredRetrieved);
  const retrievedChunks = scoredRetrieved.map(sc => sc.chunk);

  // 2. Format context for prompt
  let formattedContext = "CONTEXT:\n\n";
  retrievedChunks.forEach((chunk, index) => {
    formattedContext += `[Chunk #${index + 1} - Document: ${chunk.metadata.document}, Section: ${chunk.metadata.section}, Subsection: ${chunk.metadata.subsection || 'None'}, Source URL: ${chunk.metadata.url}]\n`;
    formattedContext += `"${chunk.content}"\n\n`;
  });

  const promptContent = `${formattedContext}QUESTION:\n${query}`;

  // 3. Call Gemini API
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: selectedModel,
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent(promptContent);
    const response = await result.response;
    const answer = response.text();

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

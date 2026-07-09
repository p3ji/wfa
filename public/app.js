// Populate the prompt box with a suggested question
function submitQuestion(questionText) {
  const queryInput = document.getElementById('queryInput');
  if (queryInput) {
    queryInput.value = questionText.trim();
    queryInput.style.height = 'auto';
    queryInput.style.height = (queryInput.scrollHeight) + 'px';
    queryInput.focus();
    
    // Smoothly scroll down to the input area so the user knows it was populated
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'smooth'
    });
  }
}

// (Keyword search removed — retrieval is now handled server-side via semantic embeddings)

// WFA agent system prompt
const SYSTEM_PROMPT = `You are a strict, authoritative assistant specializing in the Work Force Adjustment (WFA) process for the Canadian Federal Public Service. Your sole purpose is to provide accurate, factual information regarding WFA policies, directives, and official clarifications based only on the provided sources.

Core Directives:
1. Strict Source Constraint: Answer queries using ONLY the provided policy sources. Do not assume or extrapolate. Never mention terms like "context", "context blocks", "database", or "provided chunks" in your conversations. Instead, refer to "the provided WFA policies", "the official guidelines", or "the sources provided". If the sources do not contain the answer, explain that the provided WFA policies do not contain this information, then suggest 3 related questions that you CAN answer from the WFA policies. IMPORTANT: Each suggested question MUST be phrased as a complete, standalone question ending with a question mark (?). For example: "What are the opting options available under WFA?" — never use topic headings or themes like "Opting Options" alone.
2. Resolution of Conflict: Prioritize the most recent directive or clarification.
3. Mandatory Citations: Every factual claim or quote you write MUST be followed by a citation containing the source document URL. Format: ([Source Name]([URL])).
4. No Personal Speculation: Explain general rules, never make guarantees.
5. Style and Tone: Objective, formal, neutral. Use lists to break down complex text.
6. Suggested Questions: Whenever you end a response (even a successful one), you may optionally include a "You might also want to know:" section with 2-3 follow-up questions formatted as a bulleted list. Each bullet must be a complete question ending with "?".`;

// State Variables
let wfaEquivalencies = {};
const selectedModel = 'gemini-2.5-flash';

// DOM Elements
const docListEl = document.getElementById('docList');
const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const btnCloseSidebar = document.getElementById('btnCloseSidebar');
const sidebar = document.getElementById('sidebar');
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

  // Populate sidebar source documents list
  populateSourceDocuments();

  try {
    const equivResponse = await fetch('./wfa_equivalencies.json');
    wfaEquivalencies = await equivResponse.json();
    console.log('Loaded WFA equivalencies database:', Object.keys(wfaEquivalencies).length, 'classifications');
  } catch (error) {
    console.error('Failed to load wfa_equivalencies.json database:', error);
  }

  // Setup Event Listeners
  btnToggleContext.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      contextDrawer.classList.toggle('open');
    } else {
      contextDrawer.classList.toggle('collapsed');
    }
  });
  btnCloseDrawer.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      contextDrawer.classList.remove('open');
    } else {
      contextDrawer.classList.add('collapsed');
    }
  });
  
  btnToggleSidebar.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  btnCloseSidebar.addEventListener('click', () => {
    sidebar.classList.remove('open');
  });
  
  inputForm.addEventListener('submit', handleQuerySubmit);
  queryInput.addEventListener('input', autoResizeTextArea);
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputForm.requestSubmit();
    }
  });

  // Event delegation for suggested question chips (uses data-question attribute)
  chatFeed.addEventListener('click', (e) => {
    const chip = e.target.closest('.suggested-question-link');
    if (chip) {
      const question = chip.getAttribute('data-question');
      if (question) submitQuestion(question);
    }
  });
  chatFeed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const chip = e.target.closest('.suggested-question-link');
      if (chip) {
        e.preventDefault();
        const question = chip.getAttribute('data-question');
        if (question) submitQuestion(question);
      }
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
    { name: "NJC Relocation Directive", url: "https://www.njc-cnm.gc.ca/directive/nrd-drc/index-eng.php", type: "Policy" },
    { name: "CAPE Member Guide 2025", url: "https://www.acep-cape.ca/sites/default/files/2025-12/WFA2025MemberGuideEN20250530.pdf", type: "Union" },
    { name: "PSAC Member Guide 2025", url: "https://psacunion.ca/sites/psac/files/2025-psac-wfa-members-guide.pdf", type: "Union" },
    { name: "EC Collective Agreement", url: "https://www.canada.ca/en/treasury-board-secretariat/topics/pay/collective-agreements/ec.html", type: "Union" },
    { name: "Directive on Leave", url: "https://www.tbs-sct.canada.ca/pol/doc-eng.aspx?id=15774", type: "Policy" }
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

// Look up a classification code in the user query (still client-side — exact key lookup)
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

// Update Search Context Drawer (now receives flat chunk objects from server with cosine scores)
function updateContextDrawer(retrievedChunks, equivalencyInfo = null) {
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

  if ((!retrievedChunks || retrievedChunks.length === 0) && !equivalencyInfo) {
    contextContent.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-magnifying-glass"></i>
        <p>Ask a question to see the sources used to generate the answer.</p>
      </div>
    `;
    return;
  }

  if (retrievedChunks && retrievedChunks.length > 0) {
    cardsHtml += retrievedChunks.map(rc => `
      <div class="context-card">
        <div class="context-card-header">
          <span>${rc.document || 'Source'}</span>
          <span class="context-score">Similarity: ${Math.round(rc.score * 100)}%</span>
        </div>
        <div class="context-title">
          <small>${rc.section || ''} &rarr; ${rc.subsection || 'General'}</small>
        </div>
        <div class="context-content">
          &ldquo;${rc.content}&rdquo;
        </div>
      </div>
    `).join('');
  }
  
  contextContent.innerHTML = cardsHtml;
}

// Send user query — retrieval is now handled server-side via semantic embeddings
async function handleQuerySubmit(e) {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;

  queryInput.value = '';
  queryInput.style.height = 'auto';

  appendMessage('user', query);
  const typingIndicator = appendTypingIndicator();

  // WFA Equivalency lookup (client-side exact key match — fast & accurate)
  const isEquivalencyQuery = /equiv|alternate|alternation|at-level|deploy/i.test(query);
  const matchedClass = findClassificationInQuery(query);
  let equivalencyInfo = null;
  let equivalencyContext = '';

  if (isEquivalencyQuery && matchedClass && wfaEquivalencies[matchedClass]) {
    equivalencyInfo = wfaEquivalencies[matchedClass];
    equivalencyContext = `[Source: Treasury Board Secretariat Pay Rates Database, WFA Equivalency Calculator]\n`;
    equivalencyContext += `The official equivalent classifications for WFA alternation/at-level deployment for ${matchedClass} (Pay Group: ${equivalencyInfo.group}, Maximum Salary: ${equivalencyInfo.is_hourly ? '$' + equivalencyInfo.max_salary + '/hr' : '$' + equivalencyInfo.max_salary.toLocaleString()}) are:\n`;
    equivalencyInfo.equivalents.forEach(eq => {
      equivalencyContext += `- ${eq.classification} (Group: ${eq.group}, Max Salary: ${eq.is_hourly ? '$' + eq.max_salary + '/hr' : '$' + eq.max_salary.toLocaleString()}, Difference: ${eq.diff_percent >= 0 ? '+' : ''}${eq.diff_percent}%)\n`;
    });
    equivalencyContext += `\nINSTRUCTIONS FOR AGENT: Use this database data to list equivalents or deployment options for ${matchedClass}. Explain that equivalents are based on maximum rates of pay within 6%. State that there are ${equivalencyInfo.equivalents.length} equivalents in total. Cite this data as coming from the Treasury Board Rates of Pay database.\n\n`;
    contextDrawer.classList.remove('collapsed');
  }

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        equivalencyContext,
        model: selectedModel,
        systemInstruction: SYSTEM_PROMPT
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    // Update context drawer with semantic search results returned from server
    updateContextDrawer(data.retrievedChunks || [], equivalencyInfo);

    typingIndicator.remove();
    appendMessage('assistant', data.text);
  } catch (error) {
    console.error('API Error:', error);
    typingIndicator.remove();
    appendSystemMessage(
      'Request Failed',
      `Error generating response: ${error.message || 'Unknown network error'}. Please check your network connection or verify that the server API key is set.`,
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

  // Identify suggested questions in list items and make them clickable via data-question attribute
  clean = clean.replace(/<li>(.*?)<\/li>/g, (match, content) => {
    // Strip HTML tags to check if the plain text ends with a question mark
    const stripped = content.replace(/<[^>]*>/g, '').trim();
    if (stripped.endsWith('?')) {
      // Use data attribute to safely pass question text; click handled via event delegation
      const safeAttr = stripped.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<li><span class="suggested-question-link" data-question="${safeAttr}" role="button" tabindex="0">${content}</span></li>`;
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

/* ========================================
   Ata - Learning Assistant
   Frontend Application (SPA)
   ======================================== */

// --- Error Reason Type System ---
const ERROR_REASON_TYPES = [
  { value: '知识性错误', icon: '🔴', color: '#dc3545', weight: 0.7, desc: '完全不理解公式、定理、原理，零基础漏洞' },
  { value: '概念混淆', icon: '🟠', color: '#fd7e14', weight: 0.85, desc: '两个相近知识点都学过，但定义、适用场景搞混' },
  { value: '方法错误', icon: '🔵', color: '#0d6efd', weight: 1.0, desc: '知识点完全掌握，但选错解题模型，用错公式套路' },
  { value: '粗心失误', icon: '⚪', color: '#6c757d', weight: 1.3, desc: '看错题干、计算出错、漏写步骤、忽略限定条件' },
];

function renderErrorReasonTypeSelect(id, selectedValue, onChange) {
  const options = ERROR_REASON_TYPES.map(t =>
    `<option value="${t.value}" ${selectedValue === t.value ? 'selected' : ''}>${t.icon} ${t.value}（${t.desc}）</option>`
  ).join('');
  return `<select id="${id}" class="form-input" style="font-size:0.85rem;padding:8px;border-radius:8px;border:1px solid #ddd;width:100%;" ${onChange ? `onchange="${onChange}"` : ''}>
    <option value="">— 选择错因类型 —</option>
    ${options}
  </select>`;
}

function renderErrorReasonTypeBadge(type) {
  if (!type) return '';
  const t = ERROR_REASON_TYPES.find(e => e.value === type);
  if (!t) return '';
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:0.75rem;background:${t.color}20;color:${t.color};font-weight:600;">${t.icon} ${t.value}</span>`;
}

// --- State ---
const state = {
  token: localStorage.getItem('ata_token') || '',
  user: JSON.parse(localStorage.getItem('ata_user') || 'null'),
  currentPage: 'home',
  subjects: [],
  currentSubject: null,
  currentChapter: null,
  currentQuiz: null,
  quizAnswers: {},
  quizSubmitted: false,
  // Favorites
  favFolders: [],
  currentFavFolder: null,
  favManageMode: false,
  selectedFolders: new Set(),
  selectedFavItems: new Set(),
  favCache: {}, // { "mistake-123": [folderId1, folderId2], "quiz-456": [...] }
};

let savedQuizFormState = null;
let _mistakeBatchMode = false; // batch manage mode for mistakes
let _mistakeBatchSelected = new Set(); // selected mistake IDs
let _mistakesLoading = false; // track if loadMistakes API call is in progress
let _mistakePage = 1; // pagination: current page
let _mistakeTotal = 0; // pagination: total count from API
let _mistakeAllLoaded = false; // pagination: all items loaded
let _mistakeCurrentFilter = 'pending'; // track current filter for load-more
let _mistakeCurrentSort = 'error_count'; // track current sort for load-more
let _quizBatchMode = false;
let _quizBatchSelected = new Set();
let _quizPage = 1; // pagination: current page
let _quizTotal = 0; // pagination: total count from API
let _quizAllLoaded = false; // pagination: all items loaded

// --- Tag Input System ---
let _allTagsCache = []; // cached tags from /api/tags (legacy, kept for compatibility)
let _tagsByChapterCache = {}; // cached tags by chapter_id: { chapterId: [tag1, tag2, ...] }

// Frontend cache for mistakes list (avoid redundant API calls on page revisits)
let _mistakesPageCache = {}; // { cacheKey: { data, timestamp } }
const _MISTAKES_PAGE_CACHE_TTL = 15000; // 15 seconds

async function loadAllTags() {
  try {
    const data = await API.get('/api/tags');
    _allTagsCache = data.tags || [];
  } catch(e) { _allTagsCache = []; }
  return _allTagsCache;
}

async function loadTagsByChapter(subjectId = null) {
  try {
    const url = subjectId ? `/api/tags-by-chapter?subject_id=${subjectId}` : '/api/tags-by-chapter';
    const data = await API.get(url);
    _tagsByChapterCache = {};
    if (data.chapters && Array.isArray(data.chapters)) {
      data.chapters.forEach(ch => {
        _tagsByChapterCache[ch.id] = Object.keys(ch.tags || {}).sort();
      });
    }
  } catch(e) { _tagsByChapterCache = {}; }
  return _tagsByChapterCache;
}

function getTagsForChapter(chapterId) {
  // Return tags for the given chapter, or all tags if chapter not found or is "mixed"
  if (chapterId && chapterId !== 'mixed' && _tagsByChapterCache[chapterId]) {
    return _tagsByChapterCache[chapterId];
  }
  // Fallback: return all tags from cache (for mixed mode or no chapter selected)
  return _allTagsCache;
}

function getTagsFromChips(containerId) {
  const chipsEl = document.getElementById(containerId);
  if (!chipsEl) return [];
  return Array.from(chipsEl.querySelectorAll('.tag-chip')).map(chip => chip.dataset.tag);
}

function addTagToChips(containerId, inputId, tag) {
  tag = tag.trim();
  if (!tag) return;
  const chipsEl = document.getElementById(containerId);
  if (!chipsEl) return;
  // Don't add duplicate
  const existing = getTagsFromChips(containerId);
  if (existing.includes(tag)) return;
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.dataset.tag = tag;
  chip.innerHTML = `${escapeHtml(tag)} <span class="tag-chip-remove" style="cursor:pointer;margin-left:4px;font-weight:700;">×</span>`;
  chip.querySelector('.tag-chip-remove').onclick = (e) => {
    e.stopPropagation();
    chip.remove();
  };
  chipsEl.appendChild(chip);
}

// Keywords that suggest "error reason" rather than "knowledge point tag"
const wrongTagKeywords = ['粗心', '马虎', '计算错误', '公式记错', '概念混淆', '审题不清', '没看清', '笔误', '单位没换算', '忘了', '不会', '不懂', '易错', '容易错', '忘记了', '算错', '写错', '看错', '记错', '搞混', '混淆', '没注意', '不小心'];

function isWrongTagKeyword(tag) {
  const lowerTag = tag.toLowerCase();
  return wrongTagKeywords.some(kw => lowerTag.includes(kw));
}

function showTagHintDialog(tag) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:320px;padding:20px;">
        <div style="font-size:1rem;font-weight:600;margin-bottom:12px;">💡 小提示</div>
        <div style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">
          「${escapeHtml(tag)}」看起来更像是<b>错因分析</b>的内容哦～<br><br>
          标签建议写<b>知识点名称</b>，比如：<br>
          • 牛顿第二定律<br>
          • 电场强度<br>
          • 导数运算法则<br><br>
          要继续添加这个标签吗？
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" id="tag-hint-cancel" style="flex:1;">去写错因</button>
          <button class="btn btn-primary" id="tag-hint-confirm" style="flex:1;">仍要添加</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    overlay.querySelector('#tag-hint-confirm').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    overlay.querySelector('#tag-hint-cancel').onclick = () => {
      overlay.remove();
      resolve(false);
    };
  });
}

function initTagInput(containerId, inputId, autocompleteId, chapterId = null) {
  const input = document.getElementById(inputId);
  if (!input) return;
  
  input.onkeydown = async (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.replace(/,/g, '').trim();
      if (val) {
        // Check if it's a wrong keyword
        if (isWrongTagKeyword(val)) {
          const shouldAdd = await showTagHintDialog(val);
          if (!shouldAdd) {
            input.value = '';
            return;
          }
        }
        addTagToChips(containerId, inputId, val);
        input.value = '';
        hideTagAutocomplete(autocompleteId);
      }
    } else if (e.key === 'Backspace' && !input.value) {
      // Remove last chip
      const chipsEl = document.getElementById(containerId);
      if (chipsEl) {
        const chips = chipsEl.querySelectorAll('.tag-chip');
        if (chips.length > 0) chips[chips.length - 1].remove();
      }
    }
  };
  
  input.oninput = () => {
    const val = input.value.trim().toLowerCase();
    if (!val) { hideTagAutocomplete(autocompleteId); return; }
    
    // Get tags for current chapter
    const availableTags = getTagsForChapter(chapterId);
    const matches = availableTags.filter(t => t.toLowerCase().includes(val) && !getTagsFromChips(containerId).includes(t)).slice(0, 6);
    
    if (matches.length === 0) { hideTagAutocomplete(autocompleteId); return; }
    const acEl = document.getElementById(autocompleteId);
    if (!acEl) return;
    acEl.style.display = 'block';
    acEl.innerHTML = matches.map(t => `<div class="tag-ac-item" data-tag="${escapeHtml(t)}" style="padding:6px 10px;cursor:pointer;font-size:0.85rem;border-bottom:1px solid var(--border);">${escapeHtml(t)}</div>`).join('');
    acEl.querySelectorAll('.tag-ac-item').forEach(item => {
      item.onmousedown = async (e) => {
        e.preventDefault();
        const tag = item.dataset.tag;
        // Check if it's a wrong keyword (shouldn't happen for existing tags, but just in case)
        if (isWrongTagKeyword(tag)) {
          const shouldAdd = await showTagHintDialog(tag);
          if (!shouldAdd) {
            input.value = '';
            hideTagAutocomplete(autocompleteId);
            return;
          }
        }
        addTagToChips(containerId, inputId, tag);
        input.value = '';
        hideTagAutocomplete(autocompleteId);
      };
    });
  };
  input.onblur = () => {
    setTimeout(() => hideTagAutocomplete(autocompleteId), 200);
  };
}

function hideTagAutocomplete(autocompleteId) {
  const acEl = document.getElementById(autocompleteId);
  if (acEl) acEl.style.display = 'none';
}

// --- Auth guard: only clear login after consecutive 401s ---
let _consecutive401s = 0;
let _authCleared = false;
function _handle401() {
  _consecutive401s++;
  if (_consecutive401s >= 3 && !_authCleared) {
    _authCleared = true;
    state.token = '';
    state.user = null;
    localStorage.removeItem('ata_token');
    localStorage.removeItem('ata_user');
    navigate('login');
  }
}
function _reset401Counter() { _consecutive401s = 0; }

// --- API ---
const API = {
  async request(url, options = {}) {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (state.token) headers['X-Auth-Token'] = state.token;
        const res = await fetch(url, { ...options, headers });
        if (res.status === 401) {
          // Don't immediately clear auth — retry first (server may be restarting)
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
            continue;
          }
          _handle401();
          throw new Error('Unauthorized');
        }
        _reset401Counter(); // success resets the counter
        let data;
        const text = await res.text();
        try { data = JSON.parse(text); } catch(e) { throw new Error('服务器返回错误(非JSON): ' + text.substring(0, 200)); }
        if (!res.ok) {
          // Retry on 5xx errors
          if (res.status >= 500 && attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          throw new Error(data.error || 'Request failed');
        }
        return data;
      } catch(e) {
        // Retry on network errors and server timeouts
        if (attempt < maxRetries && (
          e.message.includes('Failed to fetch') ||
          e.message.includes('timeout') ||
          e.message.includes('502') ||
          e.message.includes('503') ||
          e.message.includes('504') ||
          e.message.includes('服务器返回错误')
        )) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
  },
  get: (url) => API.request(url),
  post: (url, body) => API.request(url, { method: 'POST', body: JSON.stringify(body) }),
  put: (url, body) => API.request(url, { method: 'PUT', body: JSON.stringify(body) }),
  del: (url) => API.request(url, { method: 'DELETE' }),
};

// --- Router ---
async function navigate(page, data = {}) {
  state.currentPage = page;
  if (data) Object.assign(state, data);
  const app = document.getElementById('app');
  try {
    render();
    window.scrollTo(0, 0);
    if (['home', 'subjects', 'mistakes', 'quizzes', 'chapters', 'chapter-quizzes', 'add-mistake', 'add-quiz', 'edit-quiz', 'settings', 'batch-mistakes'].includes(page)) {
      await loadPageData();
    }
  } catch(e) {
    console.error('navigate error:', e);
    app.innerHTML = '<div style="padding:20px;color:red;">页面加载错误: ' + e.message + '<br><pre>' + e.stack + '</pre></div>';
    app.style.opacity = '1';
    return;
  }
  app.style.opacity = '1';
}

// --- Toast ---
function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function showConfirmModal(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:90vw;width:340px;text-align:center;">
      <h3 style="margin-bottom:12px;font-size:1.1rem;">${escapeHtml(title)}</h3>
      <p style="margin-bottom:20px;font-size:0.9rem;color:var(--text-secondary);line-height:1.5;">${escapeHtml(message)}</p>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-secondary" id="confirm-cancel" style="flex:1;">取消</button>
        <button class="btn" id="confirm-ok" style="flex:1;background:#e74c3c;color:#fff;">确认</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#confirm-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#confirm-ok').onclick = () => { overlay.remove(); onConfirm(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function showInputDialog(title, placeholder, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:90vw;width:340px;text-align:center;">
      <h3 style="margin-bottom:16px;font-size:1.1rem;">${escapeHtml(title)}</h3>
      <input type="text" id="modal-input-field" placeholder="${escapeHtml(placeholder)}" style="width:100%;padding:10px 14px;border:1.5px solid #d0d0d0;border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;margin-bottom:18px;" />
      <div style="display:flex;gap:10px;">
        <button class="btn btn-secondary" id="input-cancel" style="flex:1;">取消</button>
        <button class="btn btn-primary" id="input-ok" style="flex:1;">确定</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#modal-input-field');
  setTimeout(() => input.focus(), 100);
  overlay.querySelector('#input-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#input-ok').onclick = () => {
    const val = input.value.trim();
    overlay.remove();
    if (val) onConfirm(val);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') overlay.querySelector('#input-ok').click(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

async function showQuizPrintDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:90vw;width:380px;max-height:80vh;overflow-y:auto;">
      <h3 style="margin-bottom:16px;font-size:1.1rem;">🖨️ 选择要打印的 Quiz</h3>
      <div id="quiz-print-list" style="display:flex;flex-direction:column;gap:8px;">
        <div style="text-align:center;padding:20px;color:var(--text-tertiary);">加载中...</div>
      </div>
      <button class="btn btn-secondary" id="quiz-print-cancel" style="margin-top:14px;width:100%;">取消</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#quiz-print-cancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Load quizzes
  try {
    const data = await API.get('/api/quizzes?sort_by=created_at');
    const list = overlay.querySelector('#quiz-print-list');
    if (!data.quizzes || data.quizzes.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">还没有 Quiz</div>';
      return;
    }
    list.innerHTML = data.quizzes.map(q => `
      <div class="quiz-print-item" data-quiz-id="${q.id}" style="padding:12px;background:var(--bg-card);border-radius:10px;border:1px solid #e8e8e0;cursor:pointer;transition:all 0.15s;">
        <div style="font-weight:600;font-size:0.95rem;">${escapeHtml(q.title)}</div>
        <div style="font-size:0.8rem;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(q.subject_name || '')} · ${q.question_count || (q.questions||[]).length} 题 · ${q.created_at ? q.created_at.split(' ')[0] : ''}</div>
      </div>
    `).join('');

    list.querySelectorAll('.quiz-print-item').forEach(item => {
      item.onclick = () => {
        const quizId = item.dataset.quizId;
        overlay.remove();
        printQuizContent(parseInt(quizId));
      };
    });
  } catch (e) {
    overlay.querySelector('#quiz-print-list').innerHTML = '<div style="text-align:center;padding:20px;color:#dc3545;">加载失败</div>';
  }
}

async function printQuizContent(quizId) {
  try {
    const quiz = await API.get(`/api/quizzes/${quizId}`);
    if (!quiz || !quiz.questions || quiz.questions.length === 0) {
      showToast('该 Quiz 没有题目');
      return;
    }
    // Reuse the existing print mode dialog
    _printDialogQuiz = quiz;
    showPrintModeDialog();
  } catch (e) {
    showToast('加载 Quiz 失败');
  }
}

// Print mode dialog state (set before calling showPrintModeDialog)
var _printDialogQuiz = null;
var _printDialogOverlay = null;

function _doPrintQuiz(mode) {
  if (_printDialogOverlay) { _printDialogOverlay.remove(); _printDialogOverlay = null; }
  const quiz = _printDialogQuiz;
  _printDialogQuiz = null;
  if (!quiz) return;
  const questions = quiz.questions || [];
  const showAnswers = mode === 'answers';

  let printHTML = '<div id="print-quiz-area" style="padding:20px;font-family:sans-serif;max-width:800px;margin:0 auto;">';
  printHTML += '<h2 style="text-align:center;margin-bottom:4px;">' + escapeHtml(quiz.title) + '</h2>';
  printHTML += '<div style="text-align:center;color:#666;font-size:0.85rem;margin-bottom:20px;">' + escapeHtml(quiz.subject_name || '') + (quiz.chapter_title ? ' &gt; ' + escapeHtml(quiz.chapter_title) : '') + ' &middot; ' + questions.length + ' 题</div>';

  questions.forEach((q, i) => {
    printHTML += '<div style="margin-bottom:20px;padding:12px;border:1px solid #e0e0e0;border-radius:8px;page-break-inside:avoid;">';
    printHTML += '<div style="font-weight:600;margin-bottom:8px;">' + (i + 1) + '. ' + renderSubSup(q.question_text) + '</div>';
    if (q.question_type === 'choice' && q.options) {
      let opts = [];
      try { opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options; } catch(e) { opts = []; }
      opts.forEach((opt, j) => {
        const letter = String.fromCharCode(65 + j);
        const isCorrect = letter === q.correct_answer;
        const st = (showAnswers && isCorrect) ? 'color:#2e7d32;font-weight:600;' : '';
        printHTML += '<div style="padding:4px 8px;margin-bottom:4px;font-size:0.9rem;' + st + '"><span style="font-weight:600;margin-right:4px;">' + letter + '.</span> ' + renderSubSup(opt) + '</div>';
      });
    }
    if (showAnswers) {
      printHTML += '<div style="margin-top:8px;font-size:0.85rem;"><span style="color:#2e7d32;font-weight:600;">答案：</span>' + renderSubSup(q.correct_answer || '') + '</div>';
      if (q.explanation) {
        printHTML += '<div style="margin-top:4px;font-size:0.85rem;color:#666;"><span style="font-weight:600;">解析：</span>' + renderSubSup(q.explanation) + '</div>';
      }
    } else {
      if (q.question_type === 'choice') {
        printHTML += '<div style="margin-top:8px;font-size:0.85rem;color:#999;">答案：________</div>';
      } else {
        for (let li = 0; li < 3; li++) {
          printHTML += '<div style="margin-top:' + (li === 0 ? '12px' : '20px') + ';border-bottom:1px solid #ccc;min-height:50px;"></div>';
        }
      }
    }
    printHTML += '</div>';
  });
  printHTML += '</div>';

  const printOverlay = document.createElement('div');
  printOverlay.id = 'print-quiz-overlay';
  printOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#fff;z-index:99999;overflow-y:auto;';
  const topBarHTML = '<div style="position:fixed;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fff;border-bottom:1px solid #e0e0e0;z-index:100001;">' +
    '<button onclick="document.getElementById(\'print-quiz-overlay\').remove()" style="padding:8px 16px;background:none;border:none;font-size:1rem;cursor:pointer;color:#333;">&larr; 返回</button>' +
    '<div style="display:flex;gap:8px;">' +
    '<button onclick="window.print()" style="padding:8px 20px;background:#4a90d9;color:#fff;border:none;border-radius:8px;font-size:0.9rem;cursor:pointer;">&#128424; 打印</button>' +
    '</div></div>';
  printOverlay.innerHTML = topBarHTML + '<div style="padding-top:60px;">' + printHTML + '</div>' +
    '<div style="position:fixed;bottom:20px;right:20px;display:flex;gap:8px;z-index:100000;">' +
    '<button onclick="window.print()" style="padding:10px 24px;background:#4a90d9;color:#fff;border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;">&#128424; 打印</button>' +
    '<button onclick="document.getElementById(\'print-quiz-overlay\').remove()" style="padding:10px 24px;background:#f0f0f0;color:#333;border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;">关闭</button>' +
    '</div>';
  document.body.appendChild(printOverlay);
}

function _doPrintPage(mode) {
  if (_printDialogOverlay) { _printDialogOverlay.remove(); _printDialogOverlay = null; }
  if (mode === 'blank') {
    document.body.classList.add('print-blank');
  }
  window.print();
  setTimeout(() => { document.body.classList.remove('print-blank'); }, 500);
}

function showPrintModeDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'print-mode-overlay';
  _printDialogOverlay = overlay;
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:90vw;width:340px;text-align:center;padding:24px 20px;">
      <h3 style="margin-bottom:16px;font-size:1.1rem;">&#128424; 选择打印模式</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <button type="button" class="btn print-mode-btn" onclick="_doPrintQuiz('blank')" style="width:100%;background:#4a90d9;color:#fff;padding:14px;font-size:0.95rem;border-radius:10px;cursor:pointer;pointer-events:auto;">
          &#128221; 空白练习<br><span style="font-size:0.75rem;opacity:0.85;">只显示题目和选项，留出书写空间</span>
        </button>
        <button type="button" class="btn print-mode-btn" onclick="_doPrintQuiz('answers')" style="width:100%;background:#f0f0f0;color:#333;padding:14px;font-size:0.95rem;border-radius:10px;cursor:pointer;pointer-events:auto;">
          &#9989; 带答案复习<br><span style="font-size:0.75rem;opacity:0.7;">显示题目、答案和解析</span>
        </button>
      </div>
      <button type="button" class="btn btn-secondary" onclick="document.getElementById('print-mode-overlay').remove()" style="margin-top:14px;width:100%;cursor:pointer;pointer-events:auto;">取消</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

// --- Text rendering for display ---
// Symbols are now real Unicode characters (no LaTeX parsing needed)
// Only converts a/b fractions to visual fraction display
// --- Answer normalization and comparison ---
function normalizeForCompare(str) {
  if (!str) return '';
  let s = str.toLowerCase().replace(/\s+/g, '').replace(/\{\}/g, '');
  // Convert Unicode superscript/subscript digits to caret/underscore notation
  const supMap = {'⁰':'^0','¹':'^1','²':'^2','³':'^3','⁴':'^4','⁵':'^5','⁶':'^6','⁷':'^7','⁸':'^8','⁹':'^9','⁻':'^-','⁺':'^+'};
  const subMap = {'₀':'_0','₁':'_1','₂':'_2','₃':'_3','₄':'_4','₅':'_5','₆':'_6','₇':'_7','₈':'_8','₉':'_9'};
  for (const [k,v] of Object.entries(supMap)) s = s.split(k).join(v);
  for (const [k,v] of Object.entries(subMap)) s = s.split(k).join(v);
  // Handle legacy LaTeX \frac{}{} → a/b
  s = s.replace(/\\(?:d)?frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');
  s = s.replace(/\\[a-zA-Z]+/g, '');
  s = s.replace(/[{}]/g, '');
  // Strip common answer prefixes like f'(x)=, f(x)=, y=, g(x)=, h(x)=, etc.
  s = s.replace(/^[a-z]'?\([^)]*\)\s*=\s*/i, '');  // f(x)=, f'(x)=, g'(x)= etc.
  s = s.replace(/^[a-z]\s*=\s*/i, '');              // y=, x= etc.
  return s.trim();
}

function answersMatch(userAns, correctAns) {
  if (!userAns || !correctAns) return false;
  const userNorm = normalizeForCompare(userAns);
  // Try exact match first
  if (userNorm === normalizeForCompare(correctAns)) return true;
  // Handle JSON array or pipe-separated multiple accepted answers
  let accepted = [];
  try {
    const parsed = JSON.parse(correctAns);
    if (Array.isArray(parsed)) accepted = parsed;
  } catch (e) {
    accepted = correctAns.split('|');
  }
  if (accepted.length > 1) {
    return accepted.some(a => normalizeForCompare(a) === userNorm);
  }
  // Also try ignoring spaces
  return userNorm.replace(/\s/g, '') === normalizeForCompare(correctAns).replace(/\s/g, '');
}

const LATEX_MAP = {
  '\\alpha':'α','\\beta':'β','\\gamma':'γ','\\delta':'δ','\\epsilon':'ε','\\varepsilon':'ε',
  '\\zeta':'ζ','\\eta':'η','\\theta':'θ','\\vartheta':'ϑ','\\iota':'ι','\\kappa':'κ',
  '\\lambda':'λ','\\mu':'μ','\\nu':'ν','\\xi':'ξ','\\pi':'π','\\varpi':'ϖ',
  '\\rho':'ρ','\\varrho':'ϱ','\\sigma':'σ','\\varsigma':'ς','\\tau':'τ',
  '\\upsilon':'υ','\\phi':'φ','\\varphi':'φ','\\chi':'χ','\\psi':'ψ','\\omega':'ω',
  '\\Gamma':'Γ','\\Delta':'Δ','\\Theta':'Θ','\\Lambda':'Λ','\\Xi':'Ξ','\\Pi':'Π',
  '\\Sigma':'Σ','\\Upsilon':'Υ','\\Phi':'Φ','\\Psi':'Ψ','\\Omega':'Ω',
  '\\times':'×','\\div':'÷','\\pm':'±','\\mp':'∓','\\cdot':'·','\\ast':'∗',
  '\\leq':'≤','\\geq':'≥','\\neq':'≠','\\approx':'≈','\\equiv':'≡','\\sim':'∼',
  '\\simeq':'≃','\\cong':'≅','\\propto':'∝','\\infty':'∞','\\partial':'∂','\\nabla':'∇',
  '\\int':'∫','\\iint':'∬','\\iiint':'∭','\\oint':'∮',
  '\\sum':'∑','\\prod':'∏','\\coprod':'∐',
  '\\sqrt':'√','\\in':'∈','\\notin':'∉','\\ni':'∋',
  '\\subset':'⊂','\\supset':'⊃','\\subseteq':'⊆','\\supseteq':'⊇',
  '\\cup':'∪','\\cap':'∩','\\emptyset':'∅','\\varnothing':'∅',
  '\\forall':'∀','\\exists':'∃','\\nexists':'∄',
  '\\rightarrow':'→','\\leftarrow':'←','\\leftrightarrow':'↔',
  '\\Rightarrow':'⇒','\\Leftarrow':'⇐','\\Leftrightarrow':'⇔',
  '\\longrightarrow':'→','\\longleftarrow':'←','\\longleftrightarrow':'↔',
  '\\uparrow':'↑','\\downarrow':'↓','\\updownarrow':'↕',
  '\\to':'→','\\gets':'←','\\mapsto':'↦',
  '\\rightleftharpoons':'⇌','\\leftrightharpoons':'⇋',
  '\\circ':'°','\\degree':'°','\\angle':'∠','\\triangle':'△','\\perp':'⊥','\\parallel':'∥',
  '\\odot':'⊙','\\otimes':'⊗','\\oplus':'⊕','\\ominus':'⊖','\\oslash':'⊘',
  '\\overrightarrow':'⃗','\\overleftarrow':'⃖','\\bar':'‾','\\hat':'^','\\vec':'⃗','\\tilde':'~',
  '\\ldots':'…','\\cdots':'⋯','\\vdots':'⋮','\\ddots':'⋱',
  '\\quad':' ','\\qquad':'  ','\\;':' ','\\:':' ','\\!':'',
  '\\le':'≤','\\ge':'≥','\\ne':'≠','\\doteq':'≐',
  '\\star':'⋆','\\bullet':'•',
  '\\ell':'ℓ','\\Re':'ℜ','\\Im':'ℑ','\\aleph':'ℵ','\\wp':'℘','\\hbar':'ℏ',
  '\\iff':'⟺','\\implies':'⟹','\\impliedby':'⟸',
  '\\sin':'sin','\\cos':'cos','\\tan':'tan','\\cot':'cot','\\sec':'sec','\\csc':'csc',
  '\\arcsin':'arcsin','\\arccos':'arccos','\\arctan':'arctan',
  '\\sinh':'sinh','\\cosh':'cosh','\\tanh':'tanh',
  '\\log':'log','\\ln':'ln','\\lg':'lg','\\exp':'exp',
  '\\lim':'lim','\\liminf':'lim inf','\\limsup':'lim sup',
  '\\min':'min','\\max':'max','\\sup':'sup','\\inf':'inf',
  '\\det':'det','\\dim':'dim','\\ker':'ker','\\deg':'deg',
  '\\mod':'mod','\\gcd':'gcd',
  '\\left':'','\\right':'','\\big':'','\\Big':'','\\bigg':'','\\Bigg':'',
  '\\,':' ','\\;':' ','\\!':'',
};

function convertLatex(s) {
  if (!s) return '';
  // 1. Strip text wrappers: \mathrm{...}, \text{...}, etc. → keep content
  s = s.replace(/\\(?:mathrm|text|textrm|textit|textbf|mathit|mathbf|mathcal|mathsf|operatorname|mbox|hbox)\{([^}]*)\}/g, '$1');

  // 1.1. Handle \vec{X} and \overrightarrow{X} → X⃗ (arrow after the content)
  s = s.replace(/\\overrightarrow\{([^}]*)\}/g, '$1⃗');
  s = s.replace(/\\vec\{([^}]*)\}/g, '$1⃗');

  // 1.5. Handle bare dfrac{...}{...} and frac{...}{...} (no backslash) — common when copying from AI
  s = s.replace(/(?:^|[^\\a-zA-Z])(dfrac|frac)\{([^}]*)\}\{([^}]*)\}/g, function(m, prefix, arg1, arg2) {
    return '\\\\' + prefix + '{' + arg1 + '}{' + arg2 + '}';
  });

  // 2. \frac{a}{b} → FRAC markers. Must consume the full \frac{...}{...} from the string.
  function replaceFrac(str) {
    var out = '';
    var i = 0;
    while (i < str.length) {
      // Look for \dfrac{ or \frac{
      var isDfrac = (str[i] === '\\' && str.substring(i, i + 7) === '\\dfrac{');
      var isFrac = (!isDfrac && str[i] === '\\' && str.substring(i, i + 6) === '\\frac{');
      if (isDfrac || isFrac) {
        var skip = isDfrac ? 7 : 6;
        var label = isDfrac ? '\\dfrac{' : '\\frac{';
        i += skip; // skip past the command
        // Find balanced close for first arg
        var depth = 1;
        var start1 = i;
        while (i < str.length && depth > 0) {
          if (str[i] === '{') depth++;
          else if (str[i] === '}') depth--;
          i++;
        }
        if (depth !== 0) { out += label; continue; }
        var arg1 = str.substring(start1, i - 1);
        // Expect { for second arg
        if (i >= str.length || str[i] !== '{') { out += '\\FRAC_START{' + arg1 + '}'; continue; }
        i++; // skip {
        var depth2 = 1;
        var start2 = i;
        while (i < str.length && depth2 > 0) {
          if (str[i] === '{') depth2++;
          else if (str[i] === '}') depth2--;
          i++;
        }
        if (depth2 !== 0) { out += '\\FRAC_START{' + arg1 + '}\\FRAC_MID{' + start2; continue; }
        var arg2 = str.substring(start2, i - 1);
        out += '\\FRAC_START{' + arg1 + '}\\FRAC_MID{' + arg2 + '}\\FRAC_END';
      } else {
        out += str[i];
        i++;
      }
    }
    return out;
  }
  s = replaceFrac(s);

  // 3. \sqrt[n]{x} → nroot
  s = s.replace(/\\sqrt\[([^\]]*)\]\{([^}]*)\}/g, '^{$1}√($2)');
  // \sqrt{x} → √(x)  — wrap content in parens for clarity
  s = s.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');
  // \sqrt followed by single char
  s = s.replace(/\\sqrt([A-Za-z0-9])/g, '√$1');

  // 4. Handle \int_{a}^{b} → ∫ with sub/sup preserved
  // Already handled by ^{} and _{} rendering below

  // 5. Handle H_2O style: letter_digit-letter → letter_{digit}letter
  s = s.replace(/([A-Za-z])_([0-9])(?=[A-Za-z])/g, '$1_{$2}');

  // 6. Remove \left, \right, \big, etc. (already in map as empty strings)

  // 7. Simple \command → Unicode via LATEX_MAP
  // Sort keys by length descending to match longer commands first
  var keys = Object.keys(LATEX_MAP).sort(function(a, b) { return b.length - a.length; });
  for (var ki = 0; ki < keys.length; ki++) {
    var cmd = keys[ki];
    var uni = LATEX_MAP[cmd];
    // Use split/join for literal string replacement (no regex escaping needed)
    if (s.indexOf(cmd) !== -1) {
      s = s.split(cmd).join(uni);
    }
  }

  // 8. Render FRAC markers (before backslash stripping)
  // Use [\s\S]*? (lazy match) to handle nested braces like e^{x^3} inside frac args
  s = s.replace(/\\?FRAC_START\{([\s\S]*?)\}\\?FRAC_MID\{([\s\S]*?)\}\\?FRAC_END/g, '<span class="frac"><span class="frac-num">$1</span><span class="frac-bar"></span><span class="frac-den">$2</span></span>');

  // 9. Clean up remaining backslash commands we don't know: \foo → foo
  s = s.replace(/\\([A-Za-z]+)/g, '$1');
  // Remove stray backslashes
  s = s.replace(/\\/g, '');

  return s;
}
function renderSubSup(text) {
  if (!text) return '';
  try {
    // 1. Escape HTML first (to prevent XSS from user input)
    var s = escapeHtml(text);
    // 2. Convert escaped LaTeX commands to Unicode/HTML
    // After escapeHtml: \frac → &amp;frac, \int → &amp;int, etc.
    // We need convertLatex to handle &amp;-escaped commands
    s = convertLatex(s);
    // 1. Render FRAC markers FIRST (before ^/_ replacements would mangle FRAC_START etc.)
    // Use [\s\S]*? to handle nested braces in frac args (e.g. e^{x^3})
    s = s.replace(/\\?FRAC_START\{([\s\S]*?)\}\\?FRAC_MID\{([\s\S]*?)\}\\?FRAC_END/g, '<span class="frac"><span class="frac-num">$1</span><span class="frac-bar"></span><span class="frac-den">$2</span></span>');
    // 2. n-th root: ^{n}√ → special span
    s = s.replace(/\^\{([^}]*)\}√/g, function(m, idx) {
      return idx === '2' ? '√' : '<span class="nroot"><span class="nroot-index">' + idx + '</span>√</span>';
    });
    // 2b. √{...} → √... (strip curly braces after square/n-th root symbol)
    s = s.replace(/√\{([^}]*)\}/g, '√$1');
    // 3. Overline: char^{-} → char with bar
    s = s.replace(/(.)\^\{-\}/g, '<span class="overline">$1</span>');
    // 4. Superscript: ^{...} → <sup>
    s = s.replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>');
    // 5. Subscript: _{...} → <sub>
    s = s.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>');
    // 5. Simple superscript: ^X (single char, not preceded by \)
    s = s.replace(/\^([^{\\\s])/g, '<sup>$1</sup>');
    // 6. Simple subscript: _X (single char)
    s = s.replace(/_([^{\\\s])/g, '<sub>$1</sub>');
    // 7. Complex fractions: (num)/(den) — both parenthesized
    s = s.replace(/\(([^()]+)\)\/\(([^()]+)\)/g, '<span class="frac"><span class="frac-num">$1</span><span class="frac-bar"></span><span class="frac-den">$2</span></span>');
    // 8. Semi-complex: (num)/token
    s = s.replace(/\(([^()]+)\)\/([A-Za-z0-9]+)/g, '<span class="frac"><span class="frac-num">$1</span><span class="frac-bar"></span><span class="frac-den">$2</span></span>');
    // 9. Simple fractions: digit/digit
    s = s.replace(/(\d+)\s*\/\s*(\d+)/g, '<span class="frac"><span class="frac-num">$1</span><span class="frac-bar"></span><span class="frac-den">$2</span></span>');
    // 9b. digit/letter fractions: 2/x, 3/y etc
    s = s.replace(/(\d+)\s*\/\s*([A-Za-z]+)/g, '<span class="frac"><span class="frac-num">$1</span><span class="frac-bar"></span><span class="frac-den">$2</span></span>');
    // 9c. letter/letter fractions: a/b, x/y (single letters only, avoid matching words)
    s = s.replace(/(^|[^A-Za-z])([A-Za-z])\s*\/\s*([A-Za-z])([^A-Za-z]|$)/g, '$1<span class="frac"><span class="frac-num">$2</span><span class="frac-bar"></span><span class="frac-den">$3</span></span>$4');
    // 10. (FRAC markers already rendered in convertLatex)
    // 11. Clean up remaining stray curly braces that weren't consumed by ^{}/_{} (e.g. from \vec{F} after map conversion)
    s = s.replace(/\{([^{}]*)\}/g, '$1');
    return s;
  } catch (e) {
    return escapeHtml(text);
  }
}

// --- Universal categorized symbols (all subjects share the same set) ---
const QUICK_SYMBOLS = ['+','−','×','÷','>','<','≥','≤','=','±'];
const SYMBOL_CATEGORIES = {
  '运算': ['+','−','×','÷','±','·','=','≠','≡'],
  '比较': ['>','<','≥','≤','≈','∝'],
  '箭头': ['→','←','↑','↓','↔','⇌','⇒','⇔'],
  '希腊小写': ['α','β','γ','δ','ε','ζ','η','θ','κ','λ','μ','ν','ξ','π','ρ','σ','τ','φ','χ','ψ','ω'],
  '希腊大写': ['Γ','Δ','Θ','Λ','Ξ','Π','Σ','Φ','Ψ','Ω'],
  '微积分': ['∫','∑','∏','∂','∇','lim','∞','dx','dy','dt'],
  '几何': ['∠','△','⊥','∥','°','√','²','³'],
  '集合': ['∈','∉','⊂','⊃','⊆','⊇','∪','∩','∀','∃','∅'],
  '物理': ['Δx','Δt','Δv','ΔE','v₀','F⃗','a⃗','v⃗','m·s⁻¹','kg','N','J','W','Pa','Hz'],
  '化学': ['⇌','→','ΔH','ΔG','ΔS','°C','mol','L','atm','M','pH','e⁻','↓','↑','ppm','kJ'],
  '统计': ['x̄','σ','μ','χ²','p̂','P(A)','E(X)','n!','≥','≤','s²','z','Σ','∞','∈','∪'],
};

function renderSymbolBar(subjectId) {
  const quickBtns = QUICK_SYMBOLS.map(s =>
    `<button type="button" class="sym-btn" data-sym="${s}">${s}</button>`
  ).join('');
  return `<div class="symbol-bar"><button type="button" class="sym-btn special-btn frac-btn" data-sym="/">a/b</button><button type="button" class="sym-btn special-btn supsub-btn">xⁿ</button><button type="button" class="sym-btn special-btn nroot-btn">ⁿ√</button>${quickBtns}<button type="button" class="sym-btn special-btn more-sym-btn">⊞</button></div>`;
}

// --- Format ---
function formatDate(str) {
  if (!str) return '';
  try {
    const d = new Date(str.includes('Z') || str.includes('+') ? str : str + 'Z');
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch(e) { return str; }
}

// --- Render ---
function render() {
  const app = document.getElementById('app');
  const loggedIn = state.token && state.user;

  let html = '';

  if (!loggedIn) {
    html = renderAuth();
  } else {
    switch (state.currentPage) {
      case 'home': html = renderHome(); break;
      case 'subjects': html = renderSubjects(); break;
      case 'chapters': html = renderChapters(); break;
      case 'mistakes': html = renderMistakes(); break;
      case 'add-mistake': html = renderAddMistake(); break;
      case 'quizzes': html = renderQuizzes(); break;
      case 'add-quiz': html = renderAddQuiz(); break;
      case 'edit-quiz': html = renderEditQuiz(); break;
      case 'take-quiz': html = renderTakeQuiz(); break;
      case 'quiz-result': html = renderQuizResult(); break;
      case 'chapter-quizzes': html = renderChapterQuizzes(); break;
      case 'review': html = renderReview(); break;
      case 'settings': html = renderSettings(); break;
      case 'trash': html = renderTrash(); break;
      case 'batch-mistakes': html = renderBatchMistakes(); break;
      default: html = renderHome();
    }
    if (!['take-quiz', 'quiz-result', 'edit-quiz'].includes(state.currentPage)) {
      html += renderBottomNav();
    }
  }

  app.innerHTML = html;
  bindEvents();
  // Initialize symbol bars for quiz-taking page based on quiz subject
  if (state.currentPage === 'take-quiz' && state.currentQuiz) {
    updateSymbolBars(state.currentQuiz.subject_id || 0);
    // DEBUG removed - truncation fixed
  }
}

// --- Auth ---
function renderAuth() {
  const isRegister = state.currentPage === 'register';
  return `
    <div class="auth-page">
      <div class="auth-logo">📐</div>
      <h1 class="auth-title">Ata</h1>
      <p class="auth-subtitle">Your learning companion</p>
      <div class="auth-form">
        ${isRegister ? `
          <div class="form-group">
            <label class="form-label">Nickname</label>
            <input class="form-input" id="auth-nickname" placeholder="What should we call you?" />
          </div>
        ` : ''}
        <div class="form-group">
          <label class="form-label">Username</label>
          <input class="form-input" id="auth-username" placeholder="Enter username" autocomplete="username" />
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input class="form-input" id="auth-password" type="password" placeholder="Enter password" autocomplete="current-password" />
        </div>
        <button class="btn btn-primary btn-block" id="auth-submit">
          ${isRegister ? 'Create Account' : 'Sign In'}
        </button>
        <p class="auth-switch">
          ${isRegister
            ? 'Already have an account? <a href="#" data-action="goto-login">Sign In</a>'
            : 'New here? <a href="#" data-action="goto-register">Create Account</a>'}
        </p>
      </div>
    </div>
  `;
}

// --- Home ---
function renderHome() {
  const user = state.user;
  return `
    <div class="page">
      <div class="top-bar">
        <div>
          <h1>Hello, ${escapeHtml(user.nickname || user.username)} 👋</h1>
        </div>
        <button class="icon-btn" data-action="nav-settings" title="Settings" style="margin-right:4px;">⚙️</button>
        <button class="icon-btn" data-action="logout" title="Logout">🚪</button>
      </div>

      <div id="stats-container">
        <div class="stats-grid">
          <div class="skeleton" style="height:80px"></div>
          <div class="skeleton" style="height:80px"></div>
        </div>
      </div>

      <div class="section-header">
        <span class="section-title">Quick Actions</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px;">
        <button class="btn btn-primary btn-sm" data-action="nav-subjects" style="flex:1;">📚 Subjects</button>
        <button class="btn btn-secondary btn-sm" data-action="nav-mistakes" style="flex:1;">📝 Mistakes</button>
        <button class="btn btn-secondary btn-sm" data-action="nav-quizzes" style="flex:1;">🧪 Quizzes</button>
      </div>

      <div class="section-header">
        <span class="section-title">📖 今日复习</span>
        <button class="btn btn-sm" data-action="nav-review" style="font-size:0.8rem;padding:4px 12px;">开始复习 →</button>
      </div>
      <div id="today-review-container"></div>

      <div class="section-header">
        <span class="section-title">⚙️ 设置</span>
      </div>
      <div class="card" style="padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.9rem;">每日复习上限</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="number" id="daily-limit-input" min="1" max="200" value="20" style="width:60px;text-align:center;padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;">
            <button class="btn btn-primary btn-sm" data-action="save-daily-limit" style="font-size:0.8rem;">保存</button>
          </div>
        </div>
        <div id="daily-limit-msg" style="font-size:0.8rem;color:var(--text-tertiary);margin-top:6px;"></div>
      </div>
    </div>
  `;
}

// --- Subjects ---
const SUBJECT_META = {
  1: { icon: '∫', bg: '#FDF0E8' },
  2: { icon: '⚡', bg: '#E8F0FD' },
  3: { icon: '🔧', bg: '#EEF8F0' },
  4: { icon: '📊', bg: '#F8E8FD' },
  5: { icon: '🧪', bg: '#FDF8E8' },
  6: { icon: '📐', bg: '#FDE8EE' },
};

function renderSubjects() {
  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" data-action="nav-home">←</button>
        <h1>Subjects</h1>
        <div></div>
      </div>
      <div id="subjects-list"></div>
    </div>
  `;
}

async function loadSubjectsList() {
  const container = document.getElementById('subjects-list');
  if (!container) return;
  try {
    // Reuse home cache if available to avoid extra API calls
    let subjects, userSubjectsData;
    if (_homeDataCache && _homeDataCache.user_subjects) {
      userSubjectsData = _homeDataCache.user_subjects;
      subjects = _homeDataCache.user_subjects.all_subjects;
    } else {
      const [usd, asd] = await Promise.all([
        API.get('/api/user/subjects').catch(() => null),
        API.get('/api/subjects')
      ]);
      userSubjectsData = usd;
      subjects = asd.subjects;
    }
    
    // Filter by user's selected subjects if available
    if (userSubjectsData && userSubjectsData.selected_subjects && userSubjectsData.selected_subjects.length > 0) {
      const selectedIds = userSubjectsData.selected_subjects;
      subjects = subjects.filter(s => selectedIds.includes(s.id));
    }
    // If no selected subjects (empty array or fetch failed), show all (degradation)
    
    container.innerHTML = subjects.map(s => {
      const meta = SUBJECT_META[s.id] || { icon: '📖', bg: '#F0F0F0' };
      const count = s.chapter_count || 0;
      return `
        <div class="subject-card" data-action="select-subject" data-id="${s.id}">
          <div class="subject-icon" style="background:${meta.bg};">${meta.icon}</div>
          <div class="subject-info">
            <div class="subject-name">${escapeHtml(s.name)}</div>
            <div class="subject-desc">${count} unit${count !== 1 ? 's' : ''}</div>
          </div>
          <span class="subject-arrow">→</span>
        </div>
      `;
    }).join('');
    container.querySelectorAll('[data-action]').forEach(el => {
      el.onclick = (e) => {
        e.preventDefault();
        handleAction(el.dataset.action, el.dataset);
      };
    });
  } catch (err) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary);">Failed to load subjects</div>';
  }
}

// --- Chapters ---
function renderChapters() {
  const subject = state.currentSubject;
  if (!subject) return renderSubjects();



  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" data-action="nav-subjects">←</button>
        <h1>${escapeHtml(subject.name)}</h1>
        <div></div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button class="btn btn-outline btn-sm" data-action="add-quiz-from-chapter">
          + New Quiz
        </button>
      </div>

      <div id="chapters-container">
        ${subject.chapters ? subject.chapters.map(ch => `
          <div class="chapter-item" data-action="select-chapter" data-id="${ch.id}">
            <div class="chapter-num">${ch.unit_number}</div>
            <div class="chapter-title">${escapeHtml(ch.title)}</div>
            ${ch.mistake_count > 0 ? `<span style="color:var(--text-tertiary);font-size:0.85rem;margin-left:auto;margin-right:8px;">${ch.mistake_count} 题</span>` : ''}
            <span style="color:var(--text-tertiary);font-size:0.9rem;">→</span>
          </div>
        `).join('') : '<div class="skeleton" style="height:400px"></div>'}
      </div>
    </div>
  `;
}

// --- Mistakes ---
function renderMistakes() {
  return `
    <div class="page">
      <div class="top-bar">
        <h1>Mistake Book</h1>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-outline btn-sm" data-action="batch-entry" style="font-size:0.8rem;padding:4px 10px;min-width:auto;">批量录入</button>
          <button class="btn btn-outline btn-sm" id="batch-manage-btn" onclick="toggleMistakeBatchMode()" style="font-size:0.8rem;padding:4px 10px;min-width:auto;">批量选择</button>
        </div>
      </div>

      <!-- Batch manage bar (hidden by default) -->
      <div id="batch-manage-bar" class="batch-manage-bar" style="display:none;">
        <div class="batch-manage-bar-inner">
          <label class="batch-select-all-label">
            <input type="checkbox" id="batch-select-all-mistakes" />
            全选
          </label>
          <div style="flex:1"></div>
          <button class="batch-icon-btn batch-fav-icon-btn" data-action="batch-fav-mistakes" title="收藏">📁</button>
          <button class="batch-icon-btn batch-delete-icon-btn" data-action="batch-delete-mistakes" title="删除">♻️</button>
        </div>
      </div>

      <!-- Level 1: Subject chips -->
      <div id="mistake-subject-chips" class="nav-chip-bar" style="padding:0 12px 8px;"></div>

      <!-- Level 2: Chapter chips (shown after subject selected) -->
      <div id="mistake-chapter-chips" class="nav-chip-bar" style="padding:0 12px 8px;display:none;"></div>

      <!-- Level 3: Tag chips (shown after chapter clicked) -->
      <div id="mistake-tag-chips" class="nav-chip-bar nav-chip-bar-tags" style="padding:0 12px 8px;display:none;"></div>
      <div id="mistake-tag-chips-bar" style="padding:0 12px 8px;display:none;flex-wrap:wrap;gap:6px;"></div>
      <input type="hidden" id="mistake-tag-search-input" value="" />

      <div class="filter-bar" id="mistake-filters">
        <button class="filter-chip active" data-filter="pending">📋 待复习</button>
        <button class="filter-chip" data-filter="today_mastered">✅ 今日已掌握</button>
        <button class="filter-chip" data-filter="all">📝 全部错题</button>
        <button class="filter-chip" data-filter="mastered">📚 已掌握</button>
      </div>

      <!-- Mistake Bookmarks bar -->
      <div id="mistake-bookmarks-bar" style="padding:0 12px 8px;display:none;flex-wrap:wrap;gap:6px;align-items:center;"></div>

      <div class="sort-bar" id="mistake-sort">
        <span style="font-size:0.8rem;color:var(--text-tertiary);">排序:</span>
        <button class="sort-chip active" data-sort="error_count">🔥 高频</button>
        <button class="sort-chip" data-sort="created_at">🆕 最新</button>
        <button class="sort-chip" data-sort="created_at_asc">📅 最早</button>
        <button class="sort-chip" data-sort="updated_at">🕐 最近修改</button>
      </div>

      <!-- Hidden selects for backward compat with loadMistakes() -->
      <div style="display:none;">
        <select id="mistake-subject-select"><option value="">全部学科</option></select>
        <select id="mistake-chapter-select"><option value="">全部单元</option></select>
      </div>

      <div id="mistakes-container" style="padding:0 12px;">
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <div class="empty-title">No mistakes yet</div>
          <div class="empty-desc">Your mistakes will appear here when you add them or take quizzes</div>
        </div>
      </div>
    </div>
  `;
}

// --- Add Mistake ---
function renderAddMistake() {
  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" data-action="nav-mistakes">←</button>
        <h1>Add Mistake</h1>
        <div></div>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">Subject</label>
          <select class="form-input" id="mistake-subject">
            <option value="">Select subject</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Chapter</label>
          <select class="form-input" id="mistake-chapter">
            <option value="">Select subject first</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">标签 <span style="font-weight:400;font-size:0.8rem;color:var(--text-tertiary);">回车或逗号分隔</span></label>
          <div class="tag-input-container" id="mistake-tags-container">
            <div class="tag-chips" id="mistake-tag-chips"></div>
            <input type="text" class="tag-input" id="mistake-tags-input" placeholder="输入标签..." autocomplete="off" />
            <div class="tag-autocomplete" id="mistake-tags-autocomplete" style="display:none;"></div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Question</label>
          <textarea class="form-input sym-target" id="mistake-question" placeholder="What was the question?"></textarea>
          <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:6px 10px;margin-top:6px;font-size:0.8rem;color:#856404;">💡 不知道怎么排版？拍照上传题目给豆包，让它帮你整理成下面的格式再粘贴回来就行</div>
          <div id="mistake-symbol-bar" class="symbol-bar-wrap"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Correct Answer</label>
          <input class="form-input sym-target" id="mistake-correct" placeholder="The correct answer" />
          <div id="mistake-ans-symbol-bar" class="symbol-bar-wrap"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Your Wrong Answer</label>
          <input class="form-input sym-target" id="mistake-wrong" placeholder="What did you answer?" />
        </div>
        <div class="form-group">
          <label class="form-label">预览</label>
          <div id="mistake-preview" style="min-height:60px;padding:12px;background:var(--bg-secondary);border-radius:10px;font-size:0.9rem;line-height:1.6;white-space:pre-wrap;word-break:break-word;">输入内容后自动预览...</div>
        </div>
        <button class="btn btn-primary btn-block" id="save-mistake">Save Mistake</button>
      </div>
    </div>
  `;
}

// --- Quizzes ---
function renderQuizzes() {
  return `
    <div class="page">
      <div class="top-bar">
        <h1>Quizzes</h1>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-outline btn-sm" data-action="batch-entry" style="font-size:0.8rem;padding:4px 10px;min-width:auto;">批量录入</button>
          <button class="btn btn-outline btn-sm" id="quiz-batch-manage-btn" onclick="toggleQuizBatchMode()" style="font-size:0.8rem;padding:4px 10px;min-width:auto;">批量选择</button>
        </div>
      </div>

      <!-- Level 1: Subject chips -->
      <div id="quiz-subject-chips" class="nav-chip-bar" style="padding:0 12px 8px;"></div>

      <!-- Quiz Bookmarks bar -->
      <div id="quiz-bookmarks-bar" style="padding:0 12px 8px;display:none;flex-wrap:wrap;gap:6px;align-items:center;"></div>

      <div id="quiz-search-bar" style="margin-bottom:8px;padding:0 12px;">
        <input type="text" id="quiz-search-input" placeholder="🔍 搜索 quiz 标题或题目..." style="width:100%;padding:8px 12px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:0.9rem;background:var(--bg-card);outline:none;" />
      </div>

      <div class="sort-bar" id="quiz-sort">
        <span style="font-size:0.8rem;color:var(--text-tertiary);">Sort:</span>
        <button class="sort-chip active" data-sort="created_at">🕐 Recent</button>
        <button class="sort-chip" data-sort="title">🔤 A-Z</button>
      </div>

      <!-- Hidden selects for backward compat with loadQuizzes() -->
      <div style="display:none;">
        <select id="quiz-subject-select"><option value="">全部学科</option></select>
      </div>

      <div id="quiz-batch-bar" class="batch-manage-bar" style="display:none;">
        <div class="batch-manage-bar-inner">
          <label class="batch-select-all-label">
            <input type="checkbox" id="batch-select-all-quizzes" />
            全选
          </label>
          <div style="flex:1"></div>
          <button class="batch-icon-btn batch-fav-icon-btn" data-action="batch-fav-quizzes" title="收藏">📁</button>
          <button class="batch-icon-btn batch-delete-icon-btn" data-action="batch-delete-quizzes" title="删除">♻️</button>
        </div>
      </div>

      <div id="quizzes-container">
        <div class="empty-state">
          <div class="empty-icon">🧪</div>
          <div class="empty-title">No quizzes yet</div>
          <div class="empty-desc">Create your first quiz to start practicing</div>
          <button class="btn btn-primary" data-action="add-quiz">Create Quiz</button>
        </div>
      </div>
    </div>
  `;
}

// --- Chapter Quizzes ---
function renderChapterQuizzes() {
  const chapter = state.currentChapter;
  if (!chapter) return renderQuizzes();
  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" data-action="nav-back-chapters">←</button>
        <h1 style="font-size:1.1rem;">Unit ${chapter.unit_number}</h1>
        <div></div>
      </div>
      <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:16px;">${escapeHtml(chapter.title)}</p>

      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button class="btn btn-primary btn-sm" data-action="add-quiz-chapter" style="flex:1;">+ New Quiz</button>
      </div>

      <!-- Tabs for Quizzes and Mistakes -->
      <div class="filter-bar" id="chapter-tabs" style="margin-bottom:16px;">
        <button class="filter-chip active" data-chapter-tab="quizzes">Quizzes</button>
        <button class="filter-chip" data-chapter-tab="mistakes">Mistakes (${chapter.mistake_count || 0})</button>
      </div>

      <div id="chapter-quizzes-section">
        <div id="chapter-quizzes-container"></div>
      </div>

      <div id="chapter-mistakes-section" style="display:none;">
        <div id="chapter-mistakes-container"></div>
      </div>
    </div>
  `;
}

// --- Add Quiz ---
let quizQuestions = [];
let batchParsedQuestions = [];
let batchMode = 'manual'; // 'manual' or 'batch'


// Chapter tab switching
document.querySelectorAll('[data-chapter-tab]').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('[data-chapter-tab]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const tabName = tab.dataset.chapterTab;
    document.getElementById('chapter-quizzes-section').style.display = tabName === 'quizzes' ? 'block' : 'none';
    document.getElementById('chapter-mistakes-section').style.display = tabName === 'mistakes' ? 'block' : 'none';
    if (tabName === 'mistakes') {
      loadChapterMistakes();
    }
  };
});

function renderAddQuiz() {
  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" onclick="quizQuestions=[];batchParsedQuestions=[];navigate(state.currentChapter?'chapter-quizzes':'quizzes')">←</button>
        <h1>New Quiz</h1>
        <div></div>
      </div>

      <div class="card mb-16">
        <div class="form-group">
          <label class="form-label">Quiz Title</label>
          <input class="form-input" id="quiz-title" placeholder="e.g. Unit 3 Practice" />
        </div>
        <div class="form-group">
          <label class="form-label">Subject</label>
          <select class="form-input" id="quiz-subject">
            <option value="">Select subject</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Chapter</label>
          <select class="form-input" id="quiz-chapter">
            <option value="">Select subject first</option>
          </select>
        </div>
        <div class="form-group" id="mixed-mode-section" style="display:none;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">
            <input type="checkbox" id="mixed-mode-check" style="width:18px;height:18px;accent-color:#4a90d9;" />
            <span>🔀 混合模式 — 从多个章节抽题</span>
          </label>
          <div id="mixed-chapters-grid" style="display:none;margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;"></div>
        </div>
      </div>

      <div id="quiz-mistakes-pool" class="card mb-16" style="display:none;">
        <div class="section-header" style="margin-bottom:8px;">
          <span class="section-title">📝 Add from Mistakes</span>
          <span id="pool-selected-count" style="font-size:0.8rem;color:var(--accent);font-weight:600;"></span>
        </div>
        <div id="pool-tag-filter" style="margin-bottom:8px;display:flex;flex-wrap:wrap;gap:6px;"></div>
        <div id="mistakes-pool-list"></div>
      </div>

      <!-- Batch Import Mode (only mode) -->
      <div id="batch-import-panel">
        <div class="card mb-16">
          <details class="batch-format-guide show-single" id="quiz-batch-format-guide">
            <summary>📖 格式说明（点击展开）</summary>
            <div class="batch-guide-content">
              <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:0.85rem;color:#856404;">💡 不知道怎么排版？拍照上传题目给豆包，让它帮你整理成下面的格式再粘贴回来就行</div>
              <p><b>支持的格式：</b>每道题用题号开头（1. 2. 3. 或 一、二、三、），答案用"答案："或"Answer:"标记。</p>
              <div class="guide-single">
                <p><b>可选字段：</b>标签：可写在每道题后面。单章节模式无需写章节。</p>
                <p><b>填空题示例：</b></p>
                <pre>1. 求函数f(x)=x²+2x的导数
答案：f'(x)=2x+2
标签：导数

2. sin(π/6) = ?
答案：1/2
标签：三角函数</pre>
                <p><b>选择题示例：</b></p>
                <pre>3. 下列哪个是质数？
A. 4
B. 7
C. 9
D. 15
答案：B
标签：质数与合数</pre>
              </div>
              <div class="guide-mixed">
                <p><b>可选字段：</b>章节：/ 标签：可写在每道题后面。混合模式每题<b>必须写章节</b>。</p>
                <p><b>填空题示例：</b></p>
                <pre>1. 求函数f(x)=x²+2x的导数
答案：f'(x)=2x+2
章节：chapter3
标签：导数

2. sin(π/6) = ?
答案：1/2
章节：chapter3
标签：三角函数</pre>
                <p><b>选择题示例：</b></p>
                <pre>3. 下列哪个是质数？
A. 4
B. 7
C. 9
D. 15
答案：B
章节：chapter1
标签：质数与合数</pre>
              </div>
              <p>系统会自动识别题型（有ABCD选项→选择题，否则→填空题）。</p>
              <p><b>多小题大题：</b>在一道题内用 (a) (b) (c) 或 (1) (2) (3) 标记小题，每个小题单独写答案。</p>
              <pre>1. 物体从静止开始做匀加速直线运动，加速度为2m/s²，求：
(a) 3秒后的速度
答案：6m/s
(b) 3秒内的位移
答案：9m
(c) 第3秒内的位移
答案：5m
标签：匀加速直线运动</pre>
              <p><b>章节格式：</b>支持 chapter1、chapter 1、章节一、U1 等多种写法。</p>
              <p><b>标签：</b>写具体知识点（如"牛顿第二定律"），不要写"粗心""易错"等。</p>
            </div>
          </details>
          <!-- Tag reference area for quiz batch -->
          <div id="quiz-batch-tag-reference"></div>
          <div class="form-group" style="margin-top:12px;">
            <label class="form-label">粘贴题目内容</label>
            <textarea class="form-input batch-textarea" id="batch-input" placeholder="在此粘贴题目文本..." rows="10"></textarea>
          </div>
          <button class="btn btn-primary btn-block" id="batch-parse-btn">🔍 解析题目</button>
        </div>

        <div id="batch-result-area" style="display:none;">
          <div class="section-header">
            <span class="section-title">解析结果 (<span id="batch-q-count">0</span> 题)</span>
          </div>
          <div id="batch-questions-list"></div>
          <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="btn btn-secondary btn-sm" id="batch-add-choice" style="flex:1;">+ 选择题</button>
            <button class="btn btn-secondary btn-sm" id="batch-add-fill" style="flex:1;">+ 填空题</button>
          </div>
        </div>
      </div>

      <button class="btn btn-primary btn-block mt-16" id="save-quiz">Create Quiz</button>
    </div>
  `;
}

function renderQuestionBuilder(q, index) {
  const ans = Array.isArray(q.correct) ? (q.correct[0] || '') : (q.correct || '');
  if (q.type === 'fill') {
    return `
      <div class="question-builder">
        <button class="remove-btn" data-remove-q="${index}">×</button>
        <div class="form-group">
          <label class="form-label">Question ${index + 1} (Fill-in)</label>
          <textarea class="form-input sym-target" data-q-text="${index}" placeholder="Enter question" oninput="this.closest('.question-builder').querySelector('.q-preview').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>预览区</span>'">${escapeHtml(q.text)}</textarea>
          <div class="edit-preview-box q-preview">${renderSubSup(q.text) || '<span style="color:#bbb">预览区</span>'}</div>
          <div class="symbol-bar-wrap"></div>
        </div>
        <div class="form-group">
          <label class="form-label">
            Correct Answer
            <span class="answer-toggle" onclick="var s=this.nextElementSibling;var p=s.nextElementSibling;if(!s||!p)return;if(s.style.display==='none'){s.style.display='';p.style.display='none';this.textContent='隐藏答案'}else{s.style.display='none';p.style.display='';this.textContent='显示答案'}" style="float:right;font-size:0.75rem;cursor:pointer;color:var(--text-secondary);user-select:none;">隐藏答案</span>
          </label>
          <div class="answer-body">
            <input class="form-input sym-target" data-q-answer="${index}" value="${escapeHtml(ans)}" placeholder="The correct answer" oninput="this.closest('.question-builder').querySelector('.a-preview').innerHTML=renderSubSup(this.value)" />
            <div class="edit-preview-box a-preview">${renderSubSup(ans)}</div>
          </div>
          <div class="answer-hidden-placeholder" style="padding:8px 10px;background:var(--bg-secondary,#f5f5f0);border-radius:6px;font-size:0.82rem;color:var(--text-secondary);display:none;">答案已隐藏，点击上方「显示答案」</div>
          <div class="symbol-bar-wrap"></div>
        </div>
      </div>
    `;
  }
  return `
    <div class="question-builder">
      <button class="remove-btn" data-remove-q="${index}">×</button>
      <div class="form-group">
        <label class="form-label">Question ${index + 1} (Multiple Choice)</label>
        <textarea class="form-input sym-target" data-q-text="${index}" placeholder="Enter question" oninput="this.closest('.question-builder').querySelector('.q-preview').innerHTML=renderSubSup(this.value)">${escapeHtml(q.text)}</textarea>
        <div class="edit-preview-box q-preview">${renderSubSup(q.text)}</div>
        <div class="symbol-bar-wrap"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Options
          <span class="opt-code-toggle" onclick="var grp=this.closest('.form-group');var rows=grp.querySelectorAll('.opt-edit-row');var showing=rows[0]&&rows[0].style.display!=='none';rows.forEach(function(r){r.style.display=showing?'none':'flex';});this.textContent=showing?'编辑选项代码 ▸':'隐藏代码 ▾';" style="float:right;font-size:0.75rem;cursor:pointer;color:var(--text-secondary);user-select:none;">编辑选项代码 ▸</span>
        </label>
        <div style="font-size:0.75rem;color:var(--text-tertiary);margin-bottom:6px;line-height:1.4;">💡 不知道怎么排版？拍照上传题目给豆包，让它帮你整理好格式再粘贴回来就行</div>
        ${q.options.map((opt, oi) => `
          <div class="option-builder" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="font-weight:600;color:var(--text-tertiary);width:20px;">${String.fromCharCode(65+oi)}.</span>
            <div class="edit-preview-box opt-preview" style="flex:1;margin:0;padding:6px 10px;font-size:0.9rem;min-height:auto;">${renderSubSup(opt) || '<span style="color:#bbb">预览</span>'}</div>
          </div>
          <div class="opt-edit-row" style="display:none;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="width:20px;"></span>
            <input class="form-input sym-target" data-q-opt="${index}-${oi}" value="${escapeHtml(opt)}" placeholder="Option ${String.fromCharCode(65+oi)}" style="flex:1;" oninput="this.closest('.question-builder').querySelectorAll('.option-builder')[${oi}].querySelector('.opt-preview').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>预览</span>'" />
          </div>
        `).join('')}
      </div>
      <div class="form-group">
        <label class="form-label">
          Correct Option
          <span class="answer-toggle" onclick="var s=this.nextElementSibling;var p=s.nextElementSibling;if(!s||!p)return;if(s.style.display==='none'){s.style.display='';p.style.display='none';this.textContent='隐藏答案'}else{s.style.display='none';p.style.display='';this.textContent='显示答案'}" style="float:right;font-size:0.75rem;cursor:pointer;color:var(--text-secondary);user-select:none;">隐藏答案</span>
        </label>
        <div class="answer-body">
        <select class="form-input" data-q-correct="${index}">
          <option value="" ${!q.correct ? 'selected' : ''} style="color:#999;">— 未填写 —</option>
          ${q.options.map((_, oi) => `
            <option value="${String.fromCharCode(65+oi)}" ${q.correct === String.fromCharCode(65+oi) ? 'selected' : ''}>
              ${String.fromCharCode(65+oi)}
            </option>
          `).join('')}
        </select>
        </div>
        <div class="answer-hidden-placeholder" style="padding:8px 10px;background:var(--bg-secondary,#f5f5f0);border-radius:6px;font-size:0.82rem;color:var(--text-secondary);display:none;">答案已隐藏，点击上方「显示答案」</div>
      </div>
    </div>
  `;
}

// --- Batch Import Parser ---
function parseBatchText(text) {
  if (!text || !text.trim()) return [];
  
  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Split into question blocks by numbered items
  // Support: 1. 2. 3. or 1、2、3、or 一、二、三、
  // Note: (1)(2)(3) are NOT block starters — they are sub-question markers inside a block
  const cnNums = '一二三四五六七八九十百千';
  const blocks = [];
  const lines = text.split('\n');
  let currentBlock = null;
  
  const isQuestionStart = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Arabic numerals: 1. 2. 12. etc.
    if (/^\d{1,3}\s*[\.、)\）]/.test(trimmed)) return true;
    // Chinese numerals: 一、二、三、
    if (/^[一二三四五六七八九十]+\s*[\.、]/.test(trimmed)) return true;
    return false;
  };
  
  const stripQuestionNumber = (line) => {
    return line.trim()
      .replace(/^\d{1,3}\s*[\.、)\）]\s*/, '')
      .replace(/^[一二三四五六七八九十]+\s*[\.、]\s*/, '');
  };
  
  for (const line of lines) {
    if (isQuestionStart(line)) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = stripQuestionNumber(line);
    } else if (currentBlock !== null) {
      currentBlock += '\n' + line;
    }
    // Lines before first question number are ignored
  }
  if (currentBlock) blocks.push(currentBlock);
  
  // Parse each block into a question
  const questions = [];
  for (const block of blocks) {
    const q = parseQuestionBlock(block);
    if (q) questions.push(q);
  }
  
  return questions;
}

function parseQuestionBlock(block) {
  const lines = block.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return null;
  
  // --- Sub-question detection: (a) (b) (c) or (1) (2) (3) ---
  const subQMarker = /^\(([a-z]{1,2}|\d{1,2})\)\s*/;
  const subQStartIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (subQMarker.test(lines[i])) {
      subQStartIndices.push(i);
    }
  }
  
  // --- Inline sub-question detection: (a) (b) within a single line or mid-line ---
  // If no line-start sub-questions found, check for inline markers like "...(a) xxx (b) yyy"
  if (subQStartIndices.length < 2) {
    const inlineSubQPattern = /\(([a-z]{1,2}|\d{1,2})\)\s*/g;
    // Check if any line contains 2+ inline sub-question markers
    for (let i = 0; i < lines.length; i++) {
      const matches = [];
      let m;
      inlineSubQPattern.lastIndex = 0;
      while ((m = inlineSubQPattern.exec(lines[i])) !== null) {
        matches.push({ index: m.index, label: m[0].trim(), marker: m[1] });
      }
      if (matches.length >= 2) {
        // This line has inline sub-questions — split the text
        const parentText = lines.slice(0, i).join('\n').trim() || lines[i].substring(0, matches[0].index).trim();
        
        const subQuestions = [];
        for (let mi = 0; mi < matches.length; mi++) {
          const start = matches[mi].index + matches[mi].label.length;
          const end = mi + 1 < matches.length ? matches[mi + 1].index : lines[i].length;
          const subText = lines[i].substring(start, end).trim();
          
          // Look for answer within sub-text (答案：xxx pattern)
          let subAnswer = '';
          let subQuestionText = subText;
          const ansMatch = subText.match(/(?:答案\s*[：:]|正确[答案]\s*[：:]|Answer\s*[：:])\s*(.+)/i);
          if (ansMatch) {
            subAnswer = ansMatch[1].trim();
            subQuestionText = subText.substring(0, ansMatch.index).trim();
          }
          
          subQuestions.push({
            label: matches[mi].label,
            question: subQuestionText,
            correct: subAnswer
          });
        }
        
        if (parentText && subQuestions.length > 0) {
          return {
            type: 'fill',
            text: parentText,
            correct: '',
            sub_questions: subQuestions,
            _raw: block
          };
        }
        break; // Only process the first line with inline sub-questions
      }
    }
  }
  
  if (subQStartIndices.length >= 2 || (subQStartIndices.length === 1 && subQStartIndices[0] > 0)) {
    // Has sub-questions — parse in sub-question mode
    const parentLines = lines.slice(0, subQStartIndices[0]);
    const parentText = parentLines.join('\n').trim();
    if (!parentText) return null;
    
    const subQuestions = [];
    for (let si = 0; si < subQStartIndices.length; si++) {
      const start = subQStartIndices[si];
      const end = si + 1 < subQStartIndices.length ? subQStartIndices[si + 1] : lines.length;
      const sectionLines = lines.slice(start, end);
      
      // Extract label
      const labelMatch = sectionLines[0].match(subQMarker);
      const label = labelMatch ? labelMatch[0].trim() : '';
      const firstLineWithoutLabel = sectionLines[0].replace(subQMarker, '').trim();
      
      // Parse answer from sub-section
      const subLines = [firstLineWithoutLabel, ...sectionLines.slice(1)];
      let subAnswer = '';
      let subAnswerIdx = -1;
      for (let j = subLines.length - 1; j >= 0; j--) {
        const ansMatch = subLines[j].match(/^(?:【答案】|答案\s*[：:]|正确[答案]\s*[：:]|Answer\s*[：:])\s*(.+)/i);
        if (ansMatch) {
          subAnswer = ansMatch[1].trim();
          subAnswerIdx = j;
          break;
        }
      }
      
      // Question text = lines before answer
      const subQLines = subAnswerIdx >= 0 ? subLines.slice(0, subAnswerIdx) : subLines;
      const subQuestionText = subQLines.join('\n').trim();
      
      subQuestions.push({
        label: label,
        question: subQuestionText,
        correct: subAnswer
      });
    }
    
    return {
      type: 'fill',
      text: parentText,
      correct: '',
      sub_questions: subQuestions,
      _raw: block
    };
  }
  
  // --- Standard single-question parsing (no sub-questions) ---
  
  // Try to find answer line
  let answerLineIdx = -1;
  let answer = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    // Match: 答案：xxx / 答案:xxx / Answer: xxx / 正确答案：xxx / 【答案】xxx
    const ansMatch = line.match(/^(?:【答案】|答案\s*[：:]|正确[答案]\s*[：:]|Answer\s*[：:])\s*(.+)/i);
    if (ansMatch) {
      answer = ansMatch[1].trim();
      answerLineIdx = i;
      break;
    }
  }
  
  // Get lines before answer (question + options)
  const qLines = answerLineIdx >= 0 ? lines.slice(0, answerLineIdx) : lines;
  
  // Detect if there are choice options (A. B. C. D.)
  const optionPattern = /^[A-Ea-e]\s*[\.、)\）]\s*/;
  const optionLines = [];
  let questionTextLines = [];
  let foundOptions = false;
  
  for (const line of qLines) {
    if (optionPattern.test(line.trim())) {
      foundOptions = true;
      optionLines.push(line.trim());
    } else if (!foundOptions) {
      questionTextLines.push(line);
    } else {
      // After options started but this line doesn't match - might be continuation of last option
      if (optionLines.length > 0) {
        optionLines[optionLines.length - 1] += ' ' + line.trim();
      }
    }
  }
  
  const questionText = questionTextLines.join('\n').trim();
  if (!questionText) return null;
  
  if (foundOptions && optionLines.length >= 2) {
    // Choice question
    const options = optionLines.map(l => l.replace(optionPattern, '').trim());
    // Normalize answer to A/B/C/D
    let correctOpt = answer.trim().toUpperCase();
    // Handle "A" or "A." or "选A" etc.
    const letterMatch = correctOpt.match(/([A-E])/);
    correctOpt = letterMatch ? letterMatch[1] : '';
    
    // Pad options to 4 if needed
    while (options.length < 4) options.push('');
    
    return {
      type: 'choice',
      text: questionText,
      options: options.slice(0, 4),
      correct: correctOpt,
      sub_questions: [],
      _raw: questionText + '\n' + optionLines.join('\n') + '\n答案：' + answer
    };
  } else {
    // Fill-in question
    return {
      type: 'fill',
      text: questionText,
      correct: answer || '',
      sub_questions: [],
      _raw: block
    };
  }
}

// Render a parsed batch question for editing
function renderBatchQuestion(q, index) {
  const ans = Array.isArray(q.correct) ? (q.correct[0] || '') : (q.correct || '');
  const subQs = q.sub_questions || [];
  const hasSubQs = subQs.length > 0;
  
  // Generate sub-questions HTML if present
  let subQsHTML = '';
  if (hasSubQs) {
    subQsHTML = `
      <div class="form-group" style="margin-top:12px;">
        <label class="form-label" style="font-size:0.9rem;color:var(--text-secondary);">📝 包含 ${subQs.length} 道小题</label>
        <div style="background:#f8f9fa;border-radius:8px;padding:12px;border:1px solid #e8e8e0;">
          ${subQs.map((sq, si) => `
            <div style="margin-bottom:12px;${si < subQs.length - 1 ? 'border-bottom:1px dashed #ddd;padding-bottom:12px;' : ''}">
              <div style="font-weight:600;color:var(--accent);margin-bottom:4px;">${sq.label || `小题${si+1}`}</div>
              <div style="font-size:0.9rem;margin-bottom:4px;">${escapeHtml(sq.question || '')}</div>
              <div style="font-size:0.85rem;color:#28a745;">✓ 答案：${escapeHtml(sq.correct || '')}</div>
              ${sq.wrong_answer ? `<div style="font-size:0.85rem;color:#dc3545;">✗ 你的答案：${escapeHtml(sq.wrong_answer)}</div>` : ''}
              ${sq.error_reason ? `<div style="font-size:0.85rem;color:var(--text-secondary);margin-top:2px;">错因：${escapeHtml(sq.error_reason)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  if (q.type === 'fill') {
    return `
      <div class="question-builder" data-batch-idx="${index}" style="background:white;border-radius:12px;padding:14px;border:1px solid #e8e8e0;margin-bottom:10px;">
        <button class="remove-btn" data-remove-batch="${index}">×</button>
        <div class="batch-q-type-badge">${hasSubQs ? '多小题大题' : '填空题'}</div>
        <div class="form-group">
          <label class="form-label">题目 ${index + 1}</label>
          <div class="edit-preview-box batch-q-preview" style="font-size:0.95rem;line-height:1.6;">${renderSubSup(q.text) || '<span style="color:#bbb">题目内容</span>'}</div>
          <textarea class="form-input sym-target batch-q-text" data-batch-q-text="${index}" style="display:none;" placeholder="题目内容">${escapeHtml(q.text)}</textarea>
          <button type="button" class="batch-edit-btn" style="font-size:0.75rem;color:var(--accent);background:none;border:none;cursor:pointer;margin-top:4px;padding:2px 0;" onclick="var t=this.previousElementSibling;p=t.previousElementSibling;if(t.style.display==='none'){t.style.display='';p.style.display='none';this.textContent='完成编辑';}else{p.innerHTML=renderSubSup(t.value)||'<span style=color:#bbb>题目内容</span>';t.style.display='none';p.style.display='';this.textContent='编辑题目';}">编辑题目</button>
          <div class="symbol-bar-wrap"></div>
        </div>
        <div class="form-group answer-section" style="position:relative;">
          <label class="form-label">
            答案
            <span class="answer-toggle" onclick="var g=this.closest('.answer-section');var els=g.querySelectorAll('.answer-body');var showing=els[0]&&els[0].style.display!=='none';els.forEach(function(e){e.style.display=showing?'none':'';});this.textContent=showing?'显示答案':'隐藏答案';" style="float:right;font-size:0.75rem;cursor:pointer;color:var(--text-secondary);user-select:none;">隐藏答案</span>
          </label>
          <div class="answer-body">
            <div class="edit-preview-box batch-a-preview" style="font-size:0.95rem;">${renderSubSup(ans) || '<span style="color:#bbb">答案</span>'}</div>
            <input class="form-input sym-target batch-q-answer" data-batch-q-answer="${index}" style="display:none;" value="${escapeHtml(ans)}" placeholder="正确答案" />
            <button type="button" class="batch-edit-answer-btn" style="font-size:0.75rem;color:var(--accent);background:none;border:none;cursor:pointer;margin-top:4px;padding:2px 0;" onclick="var inp=this.previousElementSibling;prev=inp.previousElementSibling;if(inp.style.display==='none'){inp.style.display='';prev.style.display='none';this.textContent='完成编辑';}else{prev.innerHTML=renderSubSup(inp.value)||'<span style=color:#bbb>答案</span>';inp.style.display='none';prev.style.display='';this.textContent='编辑答案';}">编辑答案</button>
            <div class="symbol-bar-wrap"></div>
          </div>
          <div class="answer-hidden-placeholder" style="padding:8px 10px;background:var(--bg-secondary,#f5f5f0);border-radius:6px;font-size:0.82rem;color:var(--text-secondary);display:none;">答案已隐藏，点击上方「显示答案」</div>
        </div>
        ${subQsHTML}
      </div>
    `;
  }
  // Choice question
  const opts = q.options || ['', '', '', ''];
  return `
    <div class="question-builder" data-batch-idx="${index}" style="background:white;border-radius:12px;padding:14px;border:1px solid #e8e8e0;margin-bottom:10px;">
      <button class="remove-btn" data-remove-batch="${index}">×</button>
      <div class="batch-q-type-badge">选择题</div>
      <div class="form-group">
        <label class="form-label">题目 ${index + 1}</label>
        <div class="edit-preview-box batch-q-preview" style="font-size:0.95rem;line-height:1.6;">${renderSubSup(q.text) || '<span style="color:#bbb">题目内容</span>'}</div>
        <textarea class="form-input sym-target batch-q-text" data-batch-q-text="${index}" style="display:none;" placeholder="题目内容">${escapeHtml(q.text)}</textarea>
        <button type="button" class="batch-edit-btn" style="font-size:0.75rem;color:var(--accent);background:none;border:none;cursor:pointer;margin-top:4px;padding:2px 0;" onclick="var t=this.previousElementSibling;p=t.previousElementSibling;if(t.style.display==='none'){t.style.display='';p.style.display='none';this.textContent='完成编辑';}else{t.style.display='none';p.style.display='';this.textContent='编辑题目';}">编辑题目</button>
        <div class="symbol-bar-wrap"></div>
      </div>
      <div class="form-group">
        <label class="form-label">选项</label>
        ${opts.map((opt, oi) => `
          <div class="option-builder" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="font-weight:600;color:var(--text-tertiary);width:20px;">${String.fromCharCode(65+oi)}.</span>
            <div class="edit-preview-box" style="flex:1;margin:0;padding:6px 10px;font-size:0.9rem;min-height:auto;">${renderSubSup(opt) || '<span style="color:#ccc">—</span>'}</div>
          </div>
        `).join('')}
        <button type="button" style="font-size:0.75rem;color:var(--accent);background:none;border:none;cursor:pointer;margin-top:4px;padding:2px 0;" onclick="var card=this.closest('.question-builder');var inputs=card.querySelectorAll('input[data-batch-q-opt]');var previews=card.querySelectorAll('.option-builder .edit-preview-box');inputs.forEach(function(inp){inp.style.display=inp.style.display==='none'?'':'none';});previews.forEach(function(p){p.style.display=p.style.display==='none'?'':'none';});this.textContent=this.textContent==='编辑选项'?'完成编辑':'编辑选项';">编辑选项</button>
        ${opts.map((opt, oi) => `
          <input class="form-input sym-target" data-batch-q-opt="${index}-${oi}" style="display:none;margin-top:4px;" value="${escapeHtml(opt)}" placeholder="选项 ${String.fromCharCode(65+oi)}" />
        `).join('')}
      </div>
      <div class="form-group">
        <label class="form-label">
          正确选项
          <span class="answer-toggle" onclick="var s=this.nextElementSibling;if(!s)return;s.style.display=s.style.display==='none'?'':'none';this.textContent=s.style.display==='none'?'显示答案':'隐藏答案';" style="float:right;font-size:0.75rem;cursor:pointer;color:var(--text-secondary);user-select:none;">隐藏答案</span>
        </label>
        <div class="answer-body" style="padding:8px 10px;background:var(--bg-secondary,#f5f5f0);border-radius:6px;">
          <strong style="color:var(--accent);">正确答案：${ans || '未选择'}</strong>
        </div>
        <select class="form-input" data-batch-q-correct="${index}" style="display:none;">
          <option value="" ${!ans ? 'selected' : ''} style="color:#999;">— 未选择 —</option>
          ${opts.map((_, oi) => `
            <option value="${String.fromCharCode(65+oi)}" ${ans === String.fromCharCode(65+oi) ? 'selected' : ''}>
              ${String.fromCharCode(65+oi)}
            </option>
          `).join('')}
        </select>
      </div>
      ${subQsHTML}
    </div>
  `;
}

function renderBatchQuestionsList() {
  const list = document.getElementById('batch-questions-list');
  if (!list) return;
  list.innerHTML = batchParsedQuestions.map((q, i) => renderBatchQuestion(q, i)).join('');
  const countEl = document.getElementById('batch-q-count');
  if (countEl) countEl.textContent = batchParsedQuestions.length;
  // Update symbol bars
  const subjectSelect = document.getElementById('quiz-subject');
  if (subjectSelect && subjectSelect.value) {
    updateSymbolBars(parseInt(subjectSelect.value));
  }
}

function syncBatchQuestions() {
  batchParsedQuestions.forEach((q, i) => {
    const textEl = document.querySelector(`[data-batch-q-text="${i}"]`);
    if (textEl) q.text = textEl.value;
    if (q.type === 'fill') {
      const ansEl = document.querySelector(`[data-batch-q-answer="${i}"]`);
      if (ansEl) q.correct = ansEl.value;
    } else {
      q.options = (q.options || []).map((_, oi) => {
        const optEl = document.querySelector(`[data-batch-q-opt="${i}-${oi}"]`);
        return optEl ? optEl.value : '';
      });
      const correctEl = document.querySelector(`[data-batch-q-correct="${i}"]`);
      if (correctEl) q.correct = correctEl.value;
    }
  });
}

// Helper: refresh quiz questions list in-place without re-rendering the whole page
function refreshQuizQuestionsDOM() {
  const list = document.getElementById('quiz-questions-list');
  if (list) list.innerHTML = quizQuestions.map((q, i) => renderQuestionBuilder(q, i)).join('');
  // Update count in section header
  const headers = document.querySelectorAll('.section-title');
  headers.forEach(h => {
    if (h.textContent.startsWith('Questions')) {
      h.textContent = `Questions (${quizQuestions.length})`;
    }
  });
  // Update symbol bars based on current subject selection
  const subjectSelect = document.getElementById('quiz-subject');
  if (subjectSelect && subjectSelect.value) {
    updateSymbolBars(parseInt(subjectSelect.value));
  } else {
    updateSymbolBars(0);
  }
}

// --- Edit Quiz ---
function renderEditQuiz() {
  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" data-action="nav-quizzes">←</button>
        <h1>Edit Quiz</h1>
        <div></div>
      </div>
      <div id="edit-quiz-loading" style="text-align:center;padding:40px;color:var(--text-tertiary);">加载中...</div>
      <div id="edit-quiz-form" style="display:none;">
        <div class="card">
          <div class="form-group">
            <label class="form-label">Quiz Title</label>
            <input class="form-input" id="edit-quiz-title" placeholder="e.g. Unit 3 Practice" />
          </div>
          <div class="section-header" style="margin-top:16px;">
            <span class="section-title">Questions (<span id="edit-q-count">0</span>)</span>
          </div>
          <div id="edit-quiz-questions-list"></div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" id="add-edit-choice">+ Choice</button>
            <button class="btn btn-outline btn-sm" id="add-edit-fill">+ Fill-in</button>
          </div>
          <button class="btn btn-primary btn-block mt-16" id="save-edit-quiz">💾 Save Changes</button>
        </div>
      </div>
    </div>
  `;
}

let editQuizQuestions = [];

async function loadEditQuiz() {
  const quizId = state.editingQuizId;
  if (!quizId) return;
  try {
    const quiz = await API.get(`/api/quizzes/${quizId}`);
    state.editingQuizSubjectId = quiz.subject_id;
    state.editingQuizChapterId = quiz.chapter_id;

    const titleEl = document.getElementById('edit-quiz-title');
    if (titleEl) titleEl.value = quiz.title || '';

    // Load questions
    editQuizQuestions = (quiz.questions || []).map(q => ({
      type: q.question_type || 'fill',
      text: q.question_text || '',
      options: q.question_type === 'choice' ? (typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || [])) : [],
      correct: q.correct_answer || ''
    }));

    document.getElementById('edit-quiz-loading').style.display = 'none';
    document.getElementById('edit-quiz-form').style.display = 'block';

    refreshEditQuizDOM();
    bindEditQuizEvents();
  } catch (err) {
    showToast('Failed to load quiz: ' + err.message);
  }
}

function refreshEditQuizDOM() {
  const list = document.getElementById('edit-quiz-questions-list');
  if (!list) return;
  list.innerHTML = editQuizQuestions.map((q, i) => renderEditQuestionBuilder(q, i)).join('');
  const countEl = document.getElementById('edit-q-count');
  if (countEl) countEl.textContent = editQuizQuestions.length;
  updateSymbolBars(state.editingQuizSubjectId || 0);
}

function renderEditQuestionBuilder(q, index) {
  const ans = Array.isArray(q.correct) ? (q.correct[0] || '') : (q.correct || '');
  if (q.type === 'fill') {
    return `
      <div class="question-builder">
        <div style="overflow:hidden;">
          <button class="remove-btn" data-remove-edit-q="${index}">×</button>
        </div>
        <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:6px 10px;margin-bottom:8px;font-size:0.8rem;color:#856404;">💡 不知道怎么排版？拍照上传题目给豆包，让它帮你整理好格式再粘贴回来就行</div>
        <div class="form-group">
          <label class="form-label">Question ${index + 1} (Fill-in)</label>
          <textarea class="form-input sym-target" data-edit-q-text="${index}" placeholder="Enter question" oninput="document.getElementById('edit-preview-${index}').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>预览区</span>'">${escapeHtml(q.text)}</textarea>
          <div id="edit-preview-${index}" class="edit-preview-box">${renderSubSup(q.text) || '<span style="color:#bbb">预览区</span>'}</div>
          <div class="symbol-bar-wrap"></div>
        </div>
        <div class="form-group">
          <label class="form-label">
            Correct Answer
            <span class="answer-toggle" onclick="var s=this.nextElementSibling;var p=s.nextElementSibling;if(!s||!p)return;if(s.style.display==='none'){s.style.display='';p.style.display='none';this.textContent='隐藏答案'}else{s.style.display='none';p.style.display='';this.textContent='显示答案'}" style="float:right;font-size:0.75rem;cursor:pointer;color:var(--text-secondary);user-select:none;">隐藏答案</span>
          </label>
          <div class="answer-body">
            <input class="form-input sym-target" data-edit-q-answer="${index}" value="${escapeHtml(ans)}" placeholder="The correct answer" oninput="document.getElementById('edit-ans-preview-${index}').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>答案预览</span>'" />
            <div id="edit-ans-preview-${index}" class="edit-preview-box">${renderSubSup(ans) || '<span style="color:#bbb">答案预览</span>'}</div>
          </div>
          <div class="answer-hidden-placeholder" style="padding:8px 10px;background:var(--bg-secondary,#f5f5f0);border-radius:6px;font-size:0.82rem;color:var(--text-secondary);display:none;">答案已隐藏，点击上方「显示答案」</div>
          <div class="symbol-bar-wrap"></div>
        </div>
      </div>
    `;
  }
  return `
    <div class="question-builder">
      <div style="overflow:hidden;">
        <button class="remove-btn" data-remove-edit-q="${index}">×</button>
      </div>
      <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:6px 10px;margin-bottom:8px;font-size:0.8rem;color:#856404;">💡 不知道怎么排版？拍照上传题目给豆包，让它帮你整理好格式再粘贴回来就行</div>
      <div class="form-group">
        <label class="form-label">Question ${index + 1} (Multiple Choice)</label>
        <textarea class="form-input sym-target" data-edit-q-text="${index}" placeholder="Enter question" oninput="document.getElementById('edit-preview-${index}').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>预览区</span>'">${escapeHtml(q.text)}</textarea>
        <div id="edit-preview-${index}" class="edit-preview-box">${renderSubSup(q.text) || '<span style="color:#bbb">预览区</span>'}</div>
        <div class="symbol-bar-wrap"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Options
          <span class="opt-code-toggle" onclick="var grp=this.closest('.form-group');var rows=grp.querySelectorAll('.opt-edit-row');var showing=rows[0]&&rows[0].style.display!=='none';rows.forEach(function(r){r.style.display=showing?'none':'flex';});this.textContent=showing?'编辑选项代码 ▸':'隐藏代码 ▾';" style="float:right;font-size:0.75rem;cursor:pointer;color:var(--text-secondary);user-select:none;">编辑选项代码 ▸</span>
        </label>
        <div style="font-size:0.75rem;color:var(--text-tertiary);margin-bottom:6px;line-height:1.4;">💡 不知道怎么排版？拍照上传题目给豆包，让它帮你整理好格式再粘贴回来就行</div>
        ${q.options.map((opt, oi) => `
          <div class="option-builder" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="font-weight:600;color:var(--text-tertiary);width:20px;">${String.fromCharCode(65+oi)}.</span>
            <div class="edit-preview-box opt-preview" style="flex:1;margin:0;padding:6px 10px;font-size:0.9rem;min-height:auto;">${renderSubSup(opt) || '<span style="color:#bbb">预览</span>'}</div>
          </div>
          <div class="opt-edit-row" style="display:none;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="width:20px;"></span>
            <input class="form-input sym-target" data-edit-q-opt="${index}-${oi}" value="${escapeHtml(opt)}" placeholder="Option ${String.fromCharCode(65+oi)}" style="flex:1;" oninput="this.closest('.question-builder').querySelectorAll('.option-builder')[${oi}].querySelector('.opt-preview').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>预览</span>'" />
          </div>
        `).join('')}
      </div>
      <div class="form-group">
        <label class="form-label">Correct Option</label>
        <select class="form-input" data-edit-q-correct="${index}">
          <option value="" ${!q.correct ? 'selected' : ''} style="color:#999;">— 未填写 —</option>
          ${q.options.map((_, oi) => `
            <option value="${String.fromCharCode(65+oi)}" ${q.correct === String.fromCharCode(65+oi) ? 'selected' : ''}>
              ${String.fromCharCode(65+oi)}
            </option>
          `).join('')}
        </select>
      </div>
    </div>
  `;
}

function syncEditQuizQuestions() {
  editQuizQuestions.forEach((q, i) => {
    const textEl = document.querySelector(`[data-edit-q-text="${i}"]`);
    if (textEl) q.text = textEl.value;
    if (q.type === 'choice') {
      const correctEl = document.querySelector(`[data-edit-q-correct="${i}"]`);
      if (correctEl) q.correct = correctEl.value;
      q.options = q.options.map((_, oi) => {
        const optEl = document.querySelector(`[data-edit-q-opt="${i}-${oi}"]`);
        return optEl ? optEl.value : '';
      });
    } else {
      const ansEl = document.querySelector(`[data-edit-q-answer="${i}"]`);
      if (ansEl) q.correct = ansEl.value;
    }
  });
}

function bindEditQuizEvents() {
  // Remove question
  document.querySelectorAll('[data-remove-edit-q]').forEach(btn => {
    btn.onclick = () => {
      syncEditQuizQuestions();
      editQuizQuestions.splice(parseInt(btn.dataset.removeEditQ), 1);
      refreshEditQuizDOM();
      bindEditQuizEvents();
    };
  });

  // Add choice question
  const addChoice = document.getElementById('add-edit-choice');
  if (addChoice) addChoice.onclick = () => {
    syncEditQuizQuestions();
    editQuizQuestions.push({ type: 'choice', text: '', options: ['', '', '', ''], correct: '' });
    refreshEditQuizDOM();
    bindEditQuizEvents();
  };

  // Add fill question
  const addFill = document.getElementById('add-edit-fill');
  if (addFill) addFill.onclick = () => {
    syncEditQuizQuestions();
    editQuizQuestions.push({ type: 'fill', text: '', correct: '' });
    refreshEditQuizDOM();
    bindEditQuizEvents();
  };



  // Save
  const saveBtn = document.getElementById('save-edit-quiz');
  if (saveBtn) saveBtn.onclick = handleSaveEditQuiz;

  updateSymbolBars(state.editingQuizSubjectId || 0);
}

async function handleSaveEditQuiz() {
  syncEditQuizQuestions();
  const title = document.getElementById('edit-quiz-title').value.trim();
  if (!title) { showToast('Please enter a quiz title'); return; }
  if (editQuizQuestions.length === 0) { showToast('Please add at least one question'); return; }

  // Validate
  for (let i = 0; i < editQuizQuestions.length; i++) {
    const q = editQuizQuestions[i];
    if (!q.text.trim()) { showToast(`Question ${i+1} is empty`); return; }
    if (q.type === 'choice' && !q.correct) { showToast(`Question ${i+1}: please select the correct option`); return; }
    if (q.type === 'fill' && !q.correct.trim()) { showToast(`Question ${i+1}: please enter the correct answer`); return; }
  }

  try {
    await API.put(`/api/quizzes/${state.editingQuizId}`, {
      title,
      questions: editQuizQuestions.map(q => ({
        type: q.type,
        text: q.text.trim(),
        options: q.type === 'choice' ? q.options : [],
        correct: q.correct
      }))
    });
    showToast('Quiz updated ✅');
    navigate('quizzes');
  } catch (err) {
    showToast('Save failed: ' + err.message);
  }
}

// --- Take Quiz ---
function renderTakeQuiz() {
  const quiz = state.currentQuiz;
  if (!quiz) return renderQuizzes();

  const questions = quiz.questions || [];
  const submitted = state.quizSubmitted;
  const total = questions.length;
  const answered = Object.keys(state.quizAnswers).length;

  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" onclick="state.quizSubmitted=false;state.quizAnswers={};navigate('quizzes')">←</button>
        <h1 style="font-size:1.1rem;">${escapeHtml(quiz.title || 'Quiz')}</h1>
        <div></div>
      </div>

      ${!submitted ? `
        <div class="quiz-progress">
          <span>${answered}/${total}</span>
          <div class="quiz-progress-bar">
            <div class="quiz-progress-fill" style="width:${total ? (answered/total*100) : 0}%"></div>
          </div>
        </div>
      ` : ''}

      ${questions.map((q, qi) => {
        const answer = state.quizAnswers[q.id];
        const isCorrect = submitted && answer && answersMatch(answer, q.correct_answer);
        const isWrong = submitted && answer && !answersMatch(answer, q.correct_answer);

        return `
          <div class="quiz-question-card" style="animation-delay:${qi * 0.05}s">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div class="quiz-question-num">Question ${qi + 1}</div>
              <button class="fav-btn ${isFav(q.id, 'quiz') ? 'favorited' : ''}" data-action="open-fav-modal" data-target-type="quiz" data-target-id="${q.id}" title="收藏">${isFav(q.id, 'quiz') ? '⭐' : '☆'}</button>
            </div>
            <div class="quiz-question-text">${renderSubSup(q.question_text)}</div>

            ${q.question_type === 'choice' ? renderQuizOptions(q, answer, submitted) : `
              <input class="fill-input sym-target ${submitted ? (isCorrect ? 'correct' : isWrong ? 'wrong' : '') : ''}"
                data-fill-q="${q.id}"
                placeholder="Your answer"
                value="${escapeHtml(answer || '')}"
                ${submitted ? 'disabled' : ''}

                style="${submitted && isCorrect ? 'border-color:#aaa;background:#f9f9f9;' : submitted && isWrong ? 'border-color:#aaa;background:#f9f9f9;' : ''}"
              />
              ${!submitted ? `<div class="edit-preview-box" data-fill-preview="${q.id}">${renderSubSup(answer || '') || '<span style="color:#bbb">答案预览</span>'}</div>` : ''}
              ${!submitted ? `<div class="symbol-bar-wrap"></div>` : ''}
              ${submitted && isWrong ? `<p class="mt-8" style="font-size:0.85rem;color:#5a9a6a;">Correct: ${renderSubSup(q.correct_answer)}</p>` : ''}
            `}
          </div>
        `;
      }).join('')}

      ${!submitted ? `
        <button class="btn btn-primary btn-block mt-16" id="submit-quiz">Submit Answers</button>
      ` : `
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button class="btn print-btn" onclick="_printDialogQuiz=state.currentQuiz;showPrintModeDialog()" style="flex:1;background:#f0f0f0;color:#333;border:1px solid #ddd;">🖨️ 打印</button>
          <button class="btn btn-secondary" data-action="nav-quizzes" style="flex:1;">Back to Quizzes</button>
        </div>
      `}
    </div>
  `;
}

function renderQuizOptions(q, answer, submitted) {
  const options = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []);
  const letters = options.map((_, i) => String.fromCharCode(65 + i));

  return `
    <div class="option-list">
      ${options.map((opt, i) => {
        const letter = letters[i];
        let cls = '';
        if (submitted) {
          if (letter === q.correct_answer) cls = 'correct';
          else if (letter === answer && letter !== q.correct_answer) cls = 'wrong';
        } else if (letter === answer) {
          cls = 'selected';
        }
        return `
          <div class="option-item ${cls}" data-option-q="${q.id}" data-option="${letter}">
            <span class="option-letter">${letter}</span>
            <span>${renderSubSup(opt)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// --- Quiz Result ---
function renderQuizResult() {
  const result = state.quizResult;
  if (!result) return renderQuizzes();

  const pct = result.total ? Math.round(result.score / result.total * 100) : 0;
  const emoji = pct >= 90 ? '🎉' : pct >= 70 ? '👍' : pct >= 50 ? '💪' : '📚';
  const msg = pct >= 90 ? 'Excellent!' : pct >= 70 ? 'Good job!' : pct >= 50 ? 'Keep practicing!' : 'Review your mistakes!';

  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" data-action="nav-quizzes">←</button>
        <h1>Results</h1>
        <div></div>
      </div>

      <div class="card result-card">
        <div style="font-size:3rem;margin-bottom:12px;">${emoji}</div>
        <div class="result-score">${result.score}/${result.total}</div>
        <div class="result-total">${pct}%</div>
        <div class="result-message">${msg}</div>
      </div>

      ${result.answers ? result.answers.map((a, i) => {
        // Build options HTML for choice questions
        let optsHTML = '';
        if (a.question_type === 'choice' && a.options) {
          let opts = [];
          try { opts = typeof a.options === 'string' ? JSON.parse(a.options) : a.options; } catch(e) { opts = []; }
          optsHTML = '<div class="mistake-options" style="margin-top:6px;font-size:0.82rem;color:var(--text-secondary);line-height:1.6;">' +
            opts.map((o, j) => {
              const letter = String.fromCharCode(65 + j);
              const isCorrect = letter === a.correct_answer;
              const isWrong = letter === a.user_answer;
              const st = isCorrect ? 'font-weight:600;' : isWrong ? 'text-decoration:underline;' : '';
              return '<div style="' + st + '"><span style="font-weight:600;margin-right:2px;">' + letter + '.</span> ' + renderSubSup(o) + '</div>';
            }).join('') + '</div>';
        }
        return '<div class="quiz-question-card" style="animation-delay:' + (i * 0.05) + 's">' +
          '<div class="quiz-question-num">' +
          (a.is_correct ? '<span class="result-icon">✅</span>' : '<span class="result-icon">❌</span>') + ' Question ' + (i + 1) +
          '</div>' +
          '<div class="quiz-question-text" style="display:block;max-width:100%;overflow-wrap:anywhere;word-break:break-all;">' + renderSubSup(a.question_text) + '</div>' +
          optsHTML +
          '<div class="mistake-details">' +
          '<div class="mistake-detail" style="min-height:50px;">' +
          '<div class="mistake-detail-label">Your Answer</div>' +
          renderSubSup(a.user_answer || '(empty)') +
          '</div>' +
          '<div class="mistake-detail">' +
          '<div class="mistake-detail-label">Correct Answer</div>' +
          renderSubSup(a.correct_answer) +
          '</div></div></div>';
      }).join('') : ''}

      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn print-btn" onclick="_printDialogQuiz=state.currentQuiz;showPrintModeDialog()" style="flex:1;background:#f0f0f0;color:#333;border:1px solid #ddd;">🖨️ 打印结果</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-primary" data-action="nav-quizzes" style="flex:1;">Back to Quizzes</button>
        <button class="btn btn-secondary" data-action="nav-mistakes" style="flex:1;">View Mistakes</button>
      </div>
    </div>
  `;
}

// --- Ebbinghaus Review ---
function renderReview() {
  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" data-action="nav-home">←</button>
        <h1>今日复习</h1>
        <div></div>
      </div>
      <div id="review-content" style="padding:16px;">
        <div style="text-align:center;padding:40px;color:var(--text-tertiary);">加载中...</div>
      </div>
    </div>
  `;
}

async function loadReviewDue() {
  const container = document.getElementById('review-content');
  if (!container) return;
  try {
    const data = await API.get('/api/mistakes/due');
    state.reviewItems = data.due || [];
    state.reviewTotal = data.total_due || 0;
    state.reviewRemaining = data.remaining || 0;
    state.reviewCurrentSubject = 0;
    state.reviewCurrentIndex = 0;
    state.reviewTodayMastered = 0;
    renderReviewContent();
    updateSymbolBars(0);
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:red;">加载失败: ${err.message}</div>`;
  }
}

function renderReviewContent() {
  const container = document.getElementById('review-content');
  if (!container) return;

  // Flatten all items across subjects
  const allItems = [];
  state.reviewItems.forEach(group => {
    group.items.forEach(item => {
      allItems.push({ ...item, subject_name: group.subject_name });
    });
  });
  state.reviewFlat = allItems;

  if (allItems.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <div style="font-size:2rem;margin-bottom:12px;">🎉</div>
        <div style="font-size:1.1rem;font-weight:600;margin-bottom:4px;">今日复习已完成！</div><div style="color:var(--accent);font-size:0.9rem;margin-bottom:8px;">🎉 今日已掌握 ${state.reviewTodayMastered || 0} 题</div>
        <div style="color:var(--text-tertiary);font-size:0.9rem;">明天再来复习吧</div>
        <button class="btn btn-primary btn-block mt-16" data-action="nav-home">返回首页</button>
      </div>
    `;
    return;
  }

  const idx = state.reviewCurrentIndex || 0;
  const total = allItems.length;
  const item = allItems[idx];

  // If idx exceeded (all done), show completion
  if (!item) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <div style="font-size:2rem;margin-bottom:12px;">🎉</div>
        <div style="font-size:1.1rem;font-weight:600;margin-bottom:4px;">今日复习已完成！</div><div style="color:var(--accent);font-size:0.9rem;margin-bottom:8px;">🎉 今日已掌握 ${state.reviewTodayMastered || 0} 题</div>
        <div style="color:var(--text-tertiary);font-size:0.9rem;">明天再来复习吧</div>
        <button class="btn btn-primary btn-block mt-16" data-action="nav-home">返回首页</button>
      </div>
    `;
    return;
  }

  // Parse solution_versions for history display
  let versions = [];
  try { versions = JSON.parse(item.solution_versions || '[]'); } catch(e) {}
  const hasHistory = versions.length > 0;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <span style="font-size:0.85rem;color:var(--text-tertiary);">${item.subject_name}</span>
      <span style="font-size:0.82rem;color:var(--accent);font-weight:600;">今日已掌握 ${state.reviewTodayMastered || 0} 题</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-size:0.8rem;color:var(--text-tertiary);">剩余 ${total} 题</span>
      <span style="font-size:0.85rem;color:var(--text-tertiary);">${idx + 1} / ${state.reviewTotal || total}</span>
    </div>
    <div style="background:#f0f0f0;border-radius:4px;height:4px;margin-bottom:16px;overflow:hidden;">
      <div style="background:var(--accent);height:100%;width:${Math.round((idx / total) * 100)}%;transition:width 0.3s;"></div>
    </div>
    <div class="card" style="padding:16px;">
      <div style="font-size:0.8rem;color:var(--text-tertiary);margin-bottom:4px;">题目 · ${item.chapter_title || ''}</div>
      <div id="review-question" style="font-size:1rem;line-height:1.6;margin-bottom:16px;min-height:40px;word-break:break-word;">
        ${renderSubSup(item.question)}
      </div>
      ${(() => {
        let subQs = [];
        try { subQs = typeof item.sub_questions === 'string' ? JSON.parse(item.sub_questions) : (item.sub_questions || []); } catch(e) { subQs = []; }
        if (!Array.isArray(subQs) || subQs.length === 0) return '';
        return `<div class="sub-questions-panel" style="margin-bottom:16px;border-radius:10px;background:var(--bg-input,#f5f6f8);overflow:hidden;">
          <div style="padding:8px 12px;font-size:0.82rem;font-weight:600;color:var(--text-secondary);background:var(--bg-card,#fff);border-bottom:1px solid var(--border,#eee);">📝 本题含 ${subQs.length} 道小题</div>
          ${subQs.map((sq, si) => `
            <div style="padding:10px 12px;${si < subQs.length - 1 ? 'border-bottom:1px solid var(--border,#eee);' : ''}">
              <div style="display:flex;align-items:flex-start;gap:6px;">
                <span style="font-weight:700;color:var(--accent,#5b7fd9);white-space:nowrap;font-size:0.9rem;">${escapeHtml(sq.label || `(${si+1})`)}</span>
                <span style="font-size:0.9rem;line-height:1.5;">${renderSubSup(sq.question || '')}</span>
              </div>
              <div style="margin-top:4px;margin-left:28px;font-size:0.82rem;">
                <span style="color:#2e7d32;">✅ ${renderSubSup(sq.correct_answer || '')}</span>
                ${sq.wrong_answer ? `<span style="margin-left:12px;color:#c62828;">❌ ${renderSubSup(sq.wrong_answer)}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>`;
      })()}
      <div id="review-answer-area">
        <textarea id="review-answer-input" class="sym-target" placeholder="输入你的答案..." style="width:100%;min-height:60px;padding:10px;border:1px solid #e0e0e0;border-radius:8px;font-size:0.95rem;resize:vertical;box-sizing:border-box;" autocomplete="off"></textarea>
        <div id="review-mcq-options" style="display:none;"></div>
        <div class="symbol-bar-wrap"></div>

        <div id="review-feedback" style="margin-top:8px;display:none;"></div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn btn-primary" id="review-submit-btn" style="flex:1;">提交答案</button>
        </div>
        <div id="review-result-btns" style="display:none;gap:8px;margin-top:10px;">
          <button class="btn" data-review-result="wrong" style="flex:1;background:#ffebee;color:#c62828;border:1px solid #ef9a9a;">😅 不会/错了</button>
          <button class="btn" data-review-result="correct" style="flex:1;background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;">✅ 对了</button>
        </div>
      </div>
    </div>
    ${hasHistory ? `
    <details style="margin-top:12px;border-radius:10px;background:#f8f9fa;overflow:hidden;">
      <summary style="padding:10px 14px;font-size:0.85rem;font-weight:600;color:var(--text-secondary);cursor:pointer;user-select:none;">📖 历程 · ${versions.length}次复习记录</summary>
      <div style="padding:8px 12px 12px;">
        ${versions.slice().reverse().map((v, i) => {
          return `
          <div style="padding:8px 10px;margin-bottom:6px;background:#fff;border-radius:8px;border-left:3px solid ${v.correct ? '#4caf50' : '#ff9800'};font-size:0.82rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-weight:600;color:${v.correct ? '#2e7d32' : '#e65100'};">${v.correct ? '✅ 做对了' : '❌ 做错了'}</span>
              <span style="color:var(--text-tertiary);font-size:0.75rem;">${v.time || ''}</span>
            </div>
            ${v.user_answer ? `<div style="color:var(--text-secondary);">答案：${renderSubSup(v.user_answer)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </details>` : ''}
  `;

  // Bind review submit
  const submitBtn = document.getElementById('review-submit-btn');
  const answerInput = document.getElementById('review-answer-input');
  const feedback = document.getElementById('review-feedback');
  const resultBtns = document.getElementById('review-result-btns');

  submitBtn.onclick = () => {
    // For MCQ, get answer from radio button
    const mcqSelected = document.querySelector('.review-mcq-radio:checked');
    const userAnswer = mcqSelected ? mcqSelected.value : answerInput.value.trim();
    if (!userAnswer) return;
    const isCorrect = answersMatch(userAnswer, item.correct_answer);
    feedback.style.display = 'block';
    if (isCorrect) {
      feedback.innerHTML = `<div style="color:#2e7d32;font-weight:600;">✅ 正确！</div>
        <div style="margin-top:4px;font-size:0.85rem;color:var(--text-secondary);">你的答案：<strong>${renderSubSup(userAnswer)}</strong></div>`;
    } else {
      feedback.innerHTML = `<div style="color:#c62828;font-weight:600;">❌ 不对哦</div>
        <div style="margin-top:4px;font-size:0.85rem;color:var(--text-secondary);">你的答案：${renderSubSup(userAnswer)}</div>
        <div style="margin-top:2px;font-size:0.85rem;color:var(--text-secondary);">正确答案：<strong>${renderSubSup(item.correct_answer)}</strong></div>`;
    }
    submitBtn.style.display = 'none';
    answerInput.disabled = true;
    resultBtns.style.display = 'flex';
    if (isCorrect) {
      resultBtns.querySelector('[data-review-result="correct"]').focus();
    }
  };

  // Bind result buttons
  resultBtns.querySelectorAll('[data-review-result]').forEach(btn => {
    btn.onclick = async () => {
      const correct = btn.dataset.reviewResult === 'correct';
      const mcqSelected = document.querySelector('.review-mcq-radio:checked');
      const userAnswer = mcqSelected ? mcqSelected.value : answerInput.value.trim();
      try {
        await API.post(`/api/mistakes/${item.id}/review`, {
          correct,
          user_answer: userAnswer
        });
        // Remove reviewed item from today's list
        const reviewedId = item.id;
        state.reviewItems.forEach(group => {
          group.items = group.items.filter(it => it.id !== reviewedId);
        });
        state.reviewTodayMastered = (state.reviewTodayMastered || 0) + 1;
        // Re-flatten
        state.reviewFlat = [];
        state.reviewItems.forEach(group => {
          group.items.forEach(it => {
            state.reviewFlat.push({ ...it, subject_name: group.subject_name });
          });
        });
        state.reviewCurrentIndex = 0;
        renderReviewContent();
        updateSymbolBars(0);
      } catch (err) {
        showToast('提交失败: ' + err.message);
      }
    };
  });

  // MCQ rendering: if question has options, show radio buttons instead of textarea
  const mcqContainer = document.getElementById('review-mcq-options');
  const mcqOptions = item.options;
  const hasOptions = mcqOptions && Array.isArray(mcqOptions) && mcqOptions.length > 0 && mcqOptions.some(o => o && o.trim());
  if (hasOptions && mcqContainer) {
    answerInput.style.display = 'none';
    // Hide symbol bar for MCQ
    const symWrap = answerInput.parentElement.querySelector('.symbol-bar-wrap');
    if (symWrap) symWrap.style.display = 'none';
    mcqContainer.style.display = 'block';
    mcqContainer.innerHTML = mcqOptions.map((opt, oi) => {
      const label = String.fromCharCode(65 + oi);
      return `<label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;margin-bottom:6px;background:#fff;border:1.5px solid #e0e0e0;border-radius:10px;cursor:pointer;font-size:0.92rem;line-height:1.5;" onclick="document.querySelectorAll('.review-mcq-radio').forEach(r=>r.checked=false);this.querySelector('input').checked=true;">
        <input type="radio" name="review-mcq" class="review-mcq-radio" value="${label}" style="margin-top:3px;flex-shrink:0;accent-color:var(--accent);" />
        <span><strong style="color:var(--accent);margin-right:4px;">${label}.</strong> ${renderSubSup(opt)}</span>
      </label>`;
    }).join('');
  }

  answerInput.focus();
}

// --- Bottom Nav ---
function renderBottomNav() {
  const pages = [
    { id: 'home', icon: '🏠', label: 'Home' },
    { id: 'subjects', icon: '📚', label: 'Subjects' },
    { id: 'mistakes', icon: '📝', label: 'Mistakes' },
    { id: 'quizzes', icon: '🧪', label: 'Quizzes' },
  ];
  return `
    <div class="bottom-nav">
      ${pages.map(p => `
        <button class="nav-item ${state.currentPage === p.id ? 'active' : ''}" data-action="nav-${p.id}">
          <span class="nav-icon">${p.icon}</span>
          <span>${p.label}</span>
        </button>
      `).join('')}
    </div>
  `;
}

// --- HTML Escape ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Symbol bar logic ---
let _lastFocusedInput = null;

// Helper: find the input associated with a symbol bar (previous sibling)
function _findInputForBar(btn) {
  const wrap = btn.closest('.symbol-bar-wrap') || btn.closest('.symbol-bar') || btn.closest('#redo-sym-bar');
  let el = wrap || btn.parentElement;
  if (el.classList.contains('symbol-bar')) el = el.parentElement;
  if (el) {
    // First check: input inside same parent (new option-builder structure)
    const parentInput = el.parentElement && (el.parentElement.querySelector('input.sym-target, textarea.sym-target'));
    if (parentInput && parentInput !== btn) return parentInput;
    // Second check: previous sibling is an input/textarea (original structure)
    const prev = el.previousElementSibling;
    if (prev && (prev.tagName === 'INPUT' || prev.tagName === 'TEXTAREA')) return prev;
  }
  return null;
}

function _openSupSubPopup(btn) {
  _closePopup();
  _closeCategoryPanel();
  const targetInput = _lastFocusedInput || _findInputForBar(btn);
  if (!targetInput) return;
  const popup = document.createElement('div');
  popup.id = 'sym-popup';
  popup.className = 'sym-popup';
  popup.innerHTML = `
    <div class="sym-popup-header">
      <span class="sym-popup-title">xⁿ 上下标</span>
      <button type="button" class="sym-popup-close" id="sym-popup-ss-close">✕</button>
    </div>
    <div class="sym-popup-fields">
      <div class="sym-popup-field">
        <label>上标</label>
        <input type="text" id="sym-ss-sup" placeholder="如 2" inputmode="text" autocomplete="off">
      </div>
      <div class="sym-popup-field">
        <label>下标</label>
        <input type="text" id="sym-ss-sub" placeholder="如 n" inputmode="text" autocomplete="off">
      </div>
    </div>
    <div class="sym-popup-actions">
      <button type="button" class="sym-popup-insert" id="sym-ss-insert">插入</button>
    </div>
  `;
  document.body.appendChild(popup);
  popup.addEventListener('click', e => e.stopPropagation());
  popup.addEventListener('touchstart', e => e.stopPropagation(), {passive: true});
  const rect = btn.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.zIndex = '9999';
  let top = rect.bottom + 4;
  if (top + 200 > window.innerHeight) top = Math.max(8, rect.top - 200 - 4);
  popup.style.top = top + 'px';
  popup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 260)) + 'px';
  setTimeout(() => popup.querySelector('#sym-ss-sup').focus(), 100);
  popup.querySelector('#sym-popup-ss-close').onclick = () => _closePopup();
  const doInsert = () => {
    const sup = popup.querySelector('#sym-ss-sup').value.trim();
    const sub = popup.querySelector('#sym-ss-sub').value.trim();
    if (!sup && !sub) return;
    let result = '';
    if (sup) result += '^{' + sup + '}';
    if (sub) result += '_{' + sub + '}';
    _insertAtCursor(targetInput, result);
    _closePopup();
  };
  popup.querySelector('#sym-ss-insert').onclick = doInsert;
  popup.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') doInsert();
      if (ev.key === 'Escape') _closePopup();
    });
  });
}

function _openNrootPopup(btn) {
  _closePopup();
  _closeCategoryPanel();
  const targetInput = _lastFocusedInput || _findInputForBar(btn);
  if (!targetInput) return;
  const popup = document.createElement('div');
  popup.id = 'sym-popup';
  popup.className = 'sym-popup';
  popup.innerHTML = `
    <div class="sym-popup-header">
      <span class="sym-popup-title">ⁿ√ 根号</span>
      <button type="button" class="sym-popup-close" id="sym-popup-nroot-close">✕</button>
    </div>
    <div class="sym-popup-quick-row">
      <button type="button" class="sym-popup-quick" data-n="2">√2</button>
      <button type="button" class="sym-popup-quick" data-n="3">√3</button>
    </div>
    <div class="sym-popup-fields">
      <div class="sym-popup-field">
        <label>根指数</label>
        <input type="text" id="sym-nroot-index" placeholder="如 3" inputmode="numeric" autocomplete="off">
      </div>
      <div class="sym-popup-field">
        <label>根号内</label>
        <input type="text" id="sym-nroot-radicand" placeholder="如 x" inputmode="text" autocomplete="off">
      </div>
    </div>
    <div class="sym-popup-actions">
      <button type="button" class="sym-popup-insert" id="sym-popup-nroot-insert">插入</button>
    </div>
  `;
  document.body.appendChild(popup);
  popup.addEventListener('click', e => e.stopPropagation());
  popup.addEventListener('touchstart', e => e.stopPropagation(), {passive: true});
  const rect = btn.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.zIndex = '9999';
  let top = rect.bottom + 4;
  if (top + 200 > window.innerHeight) top = Math.max(8, rect.top - 200 - 4);
  popup.style.top = top + 'px';
  popup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 260)) + 'px';
  setTimeout(() => popup.querySelector('#sym-nroot-index').focus(), 100);
  // Quick buttons √2 √3
  popup.querySelectorAll('.sym-popup-quick').forEach(nb => {
    nb.addEventListener('click', () => {
      _insertAtCursor(targetInput, `√${nb.dataset.n}`);
      _closePopup();
    });
  });
  // Insert
  const doInsert = () => {
    const idx = popup.querySelector('#sym-nroot-index').value.trim() || '2';
    const radicand = popup.querySelector('#sym-nroot-radicand').value.trim();
    if (radicand) {
      _insertAtCursor(targetInput, `^{${idx}}√{${radicand}}`);
    } else {
      _insertAtCursor(targetInput, `^{${idx}}√`);
    }
    _closePopup();
  };
  popup.querySelector('#sym-popup-nroot-insert').onclick = doInsert;
  popup.querySelector('#sym-popup-nroot-close').onclick = () => _closePopup();
  // Enter on either field triggers insert
  popup.querySelectorAll('.sym-popup-field input').forEach(inp => {
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') doInsert();
      if (ev.key === 'Escape') _closePopup();
    });
  });
}

function _closeCategoryPanel() {
  const panel = document.getElementById('sym-category-panel');
  if (panel) panel.remove();
}

function _openCategoryPanel(btn) {
  _closeCategoryPanel();
  _closePopup();
  const targetInput = _lastFocusedInput || _findInputForBar(btn);

  const panel = document.createElement('div');
  panel.id = 'sym-category-panel';
  panel.className = 'sym-category-panel';

  const categories = Object.keys(SYMBOL_CATEGORIES);
  const tabsHtml = categories.map((cat, i) =>
    `<button type="button" class="sym-cat-tab${i === 0 ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
  ).join('');

  const firstCatSymbols = SYMBOL_CATEGORIES[categories[0]].map(s =>
    `<button type="button" class="sym-btn sym-cat-btn" data-sym="${s}">${s}</button>`
  ).join('');

  panel.innerHTML = `
    <div class="sym-cat-tabs">${tabsHtml}</div>
    <div class="sym-cat-symbols">${firstCatSymbols}</div>
    <button type="button" class="sym-cat-close" id="sym-cat-close-btn">关闭</button>
  `;

  document.body.appendChild(panel);
  // Prevent events from bubbling to document handlers
  panel.addEventListener('click', e => e.stopPropagation());
  panel.addEventListener('touchstart', e => e.stopPropagation(), {passive: true});

  // Position near the button
  const rect = btn.getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.zIndex = '9999';
  const panelH = 280;
  let top = rect.bottom + 4;
  if (top + panelH > window.innerHeight) top = Math.max(8, rect.top - panelH - 4);
  panel.style.top = top + 'px';
  panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 310)) + 'px';

  // Helper: bind symbol button clicks
  function bindCatBtnClicks() {
    panel.querySelectorAll('.sym-cat-btn').forEach(b => {
      b.addEventListener('click', () => {
        _insertAtCursor(_lastFocusedInput || targetInput, b.dataset.sym);
        _closeCategoryPanel();
      });
    });
  }
  bindCatBtnClicks();

  // Tab switching
  panel.querySelectorAll('.sym-cat-tab').forEach(tab => {
    tab.onclick = () => {
      panel.querySelectorAll('.sym-cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const cat = tab.dataset.cat;
      const syms = SYMBOL_CATEGORIES[cat];
      panel.querySelector('.sym-cat-symbols').innerHTML = syms.map(s =>
        `<button type="button" class="sym-btn sym-cat-btn" data-sym="${s}">${s}</button>`
      ).join('');
      bindCatBtnClicks();
    };
  });

  // Close button
  panel.querySelector('#sym-cat-close-btn').onclick = _closeCategoryPanel;
}

function updateSymbolBars(subjectId) {
  const bars = document.querySelectorAll('.symbol-bar-wrap');
  bars.forEach(bar => {
    const quickBtns = QUICK_SYMBOLS.map(s =>
      `<button type="button" class="sym-btn" data-sym="${s}">${s}</button>`
    ).join('');
    bar.innerHTML = `<button type="button" class="sym-btn special-btn frac-btn" data-sym="/">a/b</button><button type="button" class="sym-btn special-btn supsub-btn">xⁿ</button><button type="button" class="sym-btn special-btn nroot-btn">ⁿ√</button>${quickBtns}<button type="button" class="sym-btn special-btn more-sym-btn">⊞</button>`;
    const ssBtn = bar.querySelector('.supsub-btn');
    const nrBtn = bar.querySelector('.nroot-btn');
    const moreBtn = bar.querySelector('.more-sym-btn');
    if (ssBtn) ssBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); _openSupSubPopup(ssBtn); };
    if (nrBtn) nrBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); _openNrootPopup(nrBtn); };
    if (moreBtn) moreBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); _openCategoryPanel(moreBtn); };
    // frac-btn: insert / at cursor
    bar.querySelectorAll('.frac-btn').forEach(fb => {
      fb.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!_lastFocusedInput) return;
        const input = _lastFocusedInput;
        const start = input.selectionStart || input.value.length;
        input.value = input.value.slice(0, start) + '/' + input.value.slice(start);
        input.selectionStart = input.selectionEnd = start + 1;
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
    });
  });
}

// Track last focused input for symbol insertion
document.addEventListener('focusin', (e) => {
  if (e.target.classList.contains('sym-target') || e.target.classList.contains('fill-input') || e.target.matches('textarea.form-input, input.form-input[data-q-text], input.form-input[data-q-answer]')) {
    _lastFocusedInput = e.target;
  }
});

// ⊞ button on options: show edit row + focus input + open category panel
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.opt-sym-btn');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const key = btn.dataset.optSym || btn.dataset.editOptSym;
  if (!key) return;
  const input = document.querySelector(`.opt-edit-row input[data-q-opt="${key}"], .opt-edit-row input[data-edit-q-opt="${key}"]`);
  if (!input) return;
  // Show the edit row
  const editRow = input.closest('.opt-edit-row');
  if (editRow) editRow.style.display = 'flex';
  // Focus and track
  input.focus();
  _lastFocusedInput = input;
  // Open shared category panel
  _openCategoryPanel(btn);
});

// Symbol bar click handler (delegated) — regular symbol buttons only
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.sym-btn');
  if (btn && _lastFocusedInput) {
    // Skip special buttons (they have their own popup handlers)
    if (btn.classList.contains('supsub-btn') || btn.classList.contains('nroot-btn') || btn.classList.contains('frac-btn') || btn.classList.contains('more-sym-btn')) return;
    e.preventDefault();
    const sym = btn.dataset.sym;
    // Insert the raw text at cursor position
    const input = _lastFocusedInput;
    if (!input || !document.contains(input)) return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const val = input.value;
    input.value = val.slice(0, start) + sym + val.slice(end);
    input.selectionStart = input.selectionEnd = start + sym.length;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

// --- xⁿ and ⁿ√ popup handlers (delegated) ---
function _insertAtCursor(input, text) {
  if (!input) return;
  if (!document.contains(input)) { _lastFocusedInput = null; return; }
  let start = input.selectionStart;
  if (start == null) start = input.value.length;
  let end = input.selectionEnd;
  if (end == null) end = start;
  const val = input.value;
  input.value = val.slice(0, start) + text + val.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function _closePopup() {
  const existing = document.getElementById('sym-popup');
  if (existing) existing.remove();
}

// Close popup if clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('#sym-popup') && !e.target.closest('#sym-category-panel') && !e.target.closest('.supsub-btn') && !e.target.closest('.nroot-btn') && !e.target.closest('.more-sym-btn')) {
    _closePopup();
    _closeCategoryPanel();
  }
});

// --- Events ---

// Global event delegation for data-action elements
// This uses event bubbling so dynamically added elements work without re-binding
function setupEventDelegation() {
  const app = document.getElementById('app');
  if (!app || app._delegationSet) return;
  app._delegationSet = true;

  app.addEventListener('click', (e) => {
    // Batch mode: clicking on mistake/quiz card should toggle checkbox, not navigate
    if (_mistakeBatchMode) {
      const mistakeCard = e.target.closest('.mistake-card');
      if (mistakeCard) {
        // In batch mode: only allow checkbox, bookmark-star-btn clicks through
        if (!e.target.closest('.batch-cb-wrap') && !e.target.closest('.batch-mistake-cb') && !e.target.closest('.bookmark-star-btn')) {
          // Toggle checkbox on any other click
          const cb = mistakeCard.querySelector('.batch-mistake-cb');
          if (cb) {
            cb.checked = !cb.checked;
            const id = parseInt(cb.dataset.id);
            if (cb.checked) _mistakeBatchSelected.add(id);
            else _mistakeBatchSelected.delete(id);
            updateBatchCount();
            mistakeCard.classList.toggle('batch-selected', cb.checked);
          }
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }
    if (_quizBatchMode) {
      const quizCard = e.target.closest('.quiz-card-batch');
      if (quizCard) {
        // In batch mode: only allow checkbox, bookmark-star-btn clicks through
        if (!e.target.closest('.quiz-batch-cb-wrap') && !e.target.closest('.quiz-batch-cb') && !e.target.closest('.bookmark-star-btn')) {
          const cb = quizCard.querySelector('.quiz-batch-cb');
          if (cb) {
            cb.checked = !cb.checked;
            const id = parseInt(cb.dataset.id);
            if (cb.checked) _quizBatchSelected.add(id);
            else _quizBatchSelected.delete(id);
            updateQuizBatchCount();
            quizCard.classList.toggle('batch-selected', cb.checked);
          }
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }
    const target = e.target.closest('[data-action]');
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      handleAction(target.dataset.action, target.dataset);
      return;
    }

    // Remove question buttons
    const removeBtn = e.target.closest('[data-remove-q]');
    if (removeBtn) {
      e.preventDefault();
      syncQuizQuestions();
      quizQuestions.splice(parseInt(removeBtn.dataset.removeQ), 1);
      refreshQuizQuestionsDOM();
      return;
    }

    // Quiz option selection (radio buttons for choice questions)
    if (!state.quizSubmitted) {
      const optBtn = e.target.closest('[data-option-q]');
      if (optBtn) {
        const qId = optBtn.dataset.optionQ;
        state.quizAnswers[qId] = optBtn.dataset.option;
        // Local UI update only — no full page re-render
        optBtn.closest('.option-list').querySelectorAll('.option-item').forEach(item => {
          if (item.dataset.optionQ === qId) {
            item.classList.toggle('selected', item.dataset.option === optBtn.dataset.option);
          }
        });
        return;
      }
    }
  });

  // Fill-in input changes (delegated input event)
  app.addEventListener('input', (e) => {
    const fillInput = e.target.closest('[data-fill-q]');
    if (fillInput) {
      state.quizAnswers[fillInput.dataset.fillQ] = fillInput.value;
      // Update answer preview
      const card = fillInput.closest('.quiz-question-card');
      if (card) {
        const preview = card.querySelector('[data-fill-preview]');
        if (preview) {
          const val = fillInput.value;
          preview.innerHTML = val ? (renderSubSup(val) || '<span style="color:#bbb">答案预览</span>') : '<span style="color:#bbb">答案预览</span>';
        }
      }
    }
  });
}

function bindEvents() {
  // Auth
  const authSubmit = document.getElementById('auth-submit');
  if (authSubmit) {
    authSubmit.onclick = handleAuth;
    // Enter key support
    ['auth-username', 'auth-password', 'auth-nickname'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onkeydown = (e) => { if (e.key === 'Enter') handleAuth(); };
    });
  }

  // Data actions are now handled by event delegation (see setupEventDelegation below)

  // Mistake subject change
  const mistakeSubject = document.getElementById('mistake-subject');
  if (mistakeSubject) {
    mistakeSubject.onchange = () => {
      loadChaptersForSelect(mistakeSubject.value, 'mistake-chapter');
      updateSymbolBars(parseInt(mistakeSubject.value));
    };
    // Initial symbol bar render
    updateSymbolBars(0);
  }

  // Quiz subject change
  const quizSubject = document.getElementById('quiz-subject');
  if (quizSubject) {
    quizSubject.onchange = () => {
      loadChaptersForSelect(quizSubject.value, 'quiz-chapter');
      // Hide mistakes pool when subject changes
      const pool = document.getElementById('quiz-mistakes-pool');
      if (pool) pool.style.display = 'none';
      // Update symbol bars in question builders
      updateSymbolBars(parseInt(quizSubject.value) || 0);
    };
  }

  // Quiz chapter change - load mistakes pool for selected chapter
  const quizChapter = document.getElementById('quiz-chapter');
  if (quizChapter) {
    quizChapter.onchange = () => {
      const chId = quizChapter.value;
      if (chId) {
        loadMistakesForQuiz(chId);
      } else {
        const pool = document.getElementById('quiz-mistakes-pool');
        if (pool) pool.style.display = 'none';
      }
    };
  }

  // Mistake checkbox change - add/remove from quizQuestions
  // (Mistake pool selection is now handled by click in renderPoolList)

  // Save mistake
  const saveMistake = document.getElementById('save-mistake');
  if (saveMistake) {
  // Mistake preview update
  const previewEl = document.getElementById('mistake-preview');
  if (previewEl) {
    const updatePreview = () => {
      const q = document.getElementById('mistake-question')?.value || '';
      const correct = document.getElementById('mistake-correct')?.value || '';
      const wrong = document.getElementById('mistake-wrong')?.value || '';
      let html = '';
      if (q) html += '<div style="margin-bottom:8px;"><strong>题目:</strong><br/>' + renderSubSup(q) + '</div>';
      if (correct) html += '<div style="margin-bottom:8px;color:var(--accent);"><strong>正确答案:</strong> ' + renderSubSup(correct) + '</div>';
      if (wrong) html += '<div style="color:#e74c3c;"><strong>你的答案:</strong> ' + renderSubSup(wrong) + '</div>';
      if (!html) html = '输入内容后自动预览...';
      previewEl.innerHTML = html;
    };
    ['mistake-question', 'mistake-correct', 'mistake-wrong'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updatePreview);
    });
  }

  saveMistake.onclick = handleSaveMistake;
  }

  // Save quiz
  const saveQuiz = document.getElementById('save-quiz');
  if (saveQuiz) saveQuiz.onclick = handleSaveQuiz;

  // Add question buttons
  const addChoice = document.getElementById('add-choice-question');
  if (addChoice) addChoice.onclick = () => {
      // Save current form state
      syncQuizQuestions();
      quizQuestions.push({ type: 'choice', text: '', options: ['', '', '', ''], correct: '' });
      refreshQuizQuestionsDOM();
    };

  const addFill = document.getElementById('add-fill-question');
  if (addFill) addFill.onclick = () => {
      syncQuizQuestions();
      quizQuestions.push({ type: 'fill', text: '', correct: '' });
      refreshQuizQuestionsDOM();
    };

  // --- Batch Import Tab Switching ---
  document.querySelectorAll('[data-batch-tab]').forEach(tab => {
    tab.onclick = () => {
      const mode = tab.dataset.batchTab;
      batchMode = mode;
      document.querySelectorAll('[data-batch-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('batch-manual-panel').style.display = mode === 'manual' ? 'block' : 'none';
      document.getElementById('batch-import-panel').style.display = mode === 'batch' ? 'block' : 'none';
    };
  });

  // Batch parse button
  const batchParseBtn = document.getElementById('batch-parse-btn');
  if (batchParseBtn) {
    batchParseBtn.onclick = () => {
      const input = document.getElementById('batch-input');
      if (!input || !input.value.trim()) {
        showToast('请先粘贴题目内容');
        return;
      }
      const parsed = parseBatchText(input.value);
      if (parsed.length === 0) {
        showToast('未能识别出题目，请检查格式');
        return;
      }
      batchParsedQuestions = parsed;
      const resultArea = document.getElementById('batch-result-area');
      if (resultArea) resultArea.style.display = 'block';
      renderBatchQuestionsList();
      showToast(`成功解析 ${parsed.length} 道题目`);
    };
  }

  // Batch add buttons
  const batchAddChoice = document.getElementById('batch-add-choice');
  if (batchAddChoice) {
    batchAddChoice.onclick = () => {
      syncBatchQuestions();
      batchParsedQuestions.push({ type: 'choice', text: '', options: ['', '', '', ''], correct: '' });
      renderBatchQuestionsList();
    };
  }
  const batchAddFill = document.getElementById('batch-add-fill');
  if (batchAddFill) {
    batchAddFill.onclick = () => {
      syncBatchQuestions();
      batchParsedQuestions.push({ type: 'fill', text: '', correct: '' });
      renderBatchQuestionsList();
    };
  }

  // Batch remove question
  document.addEventListener('click', (e) => {
    if (e.target.dataset.removeBatch !== undefined) {
      syncBatchQuestions();
      batchParsedQuestions.splice(parseInt(e.target.dataset.removeBatch), 1);
      renderBatchQuestionsList();
    }
  });

  // Batch question live preview (delegated)
  document.addEventListener('input', (e) => {
    const textEl = e.target.closest('[data-batch-q-text]');
    if (textEl) {
      const card = textEl.closest('.question-builder');
      if (card) {
        const preview = card.querySelector('.batch-q-preview');
        if (preview) preview.innerHTML = renderSubSup(textEl.value) || '<span style="color:#bbb">预览区</span>';
      }
    }
    const ansEl = e.target.closest('[data-batch-q-answer]');
    if (ansEl) {
      const card = ansEl.closest('.question-builder');
      if (card) {
        const preview = card.querySelector('.batch-a-preview');
        if (preview) preview.innerHTML = renderSubSup(ansEl.value) || '<span style="color:#bbb">答案预览</span>';
      }
    }
  });

  // Submit quiz
  const submitQuiz = document.getElementById('submit-quiz');
  if (submitQuiz) submitQuiz.onclick = handleSubmitQuiz;

  // Quiz back
  const quizBack = document.getElementById('quiz-back');
  if (quizBack) quizBack.onclick = () => { state.quizSubmitted = false; state.quizAnswers = {}; navigate('quizzes'); };

  // Add quiz back
  const addQuizBack = document.getElementById('add-quiz-back');
  if (addQuizBack) addQuizBack.onclick = () => { quizQuestions = []; navigate(state.currentChapter ? 'chapter-quizzes' : 'quizzes'); };

  // Quiz options
  document.querySelectorAll('[data-option-q]').forEach(el => {
    if (!state.quizSubmitted) {
      el.onclick = () => {
        state.quizAnswers[el.dataset.optionQ] = el.dataset.option;
        render();
      };
    }
  });

  // Fill-in inputs
  document.querySelectorAll('[data-fill-q]').forEach(el => {
    el.oninput = () => {
      state.quizAnswers[el.dataset.fillQ] = el.value;
    };
  });

  // xⁿ buttons in quiz fill-in questions
  document.querySelectorAll('.quiz-supsub-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const qid = btn.dataset.qid;
      const container = document.querySelector(`.frac-popup-container[data-frac-for="${qid}"]`);
      if (!container) return;
      if (container.innerHTML) { container.innerHTML = ''; return; }
      container.innerHTML = `
        <div class="sym-popup" style="margin-top:6px;">
          <input type="text" id="quiz-ss-content-${qid}" placeholder="内容" class="sym-popup-input">
          <label class="sym-popup-radio"><input type="radio" name="quiz-ss-mode-${qid}" value="sup" checked> 上标</label>
          <label class="sym-popup-radio"><input type="radio" name="quiz-ss-mode-${qid}" value="sub"> 下标</label>
          <button type="button" class="sym-popup-insert" id="quiz-ss-insert-${qid}">插入</button>
          <button type="button" class="sym-popup-close" id="quiz-ss-close-${qid}">✕</button>
        </div>
      `;
      container.querySelector(`#quiz-ss-insert-${qid}`).onclick = () => {
        const content = container.querySelector(`#quiz-ss-content-${qid}`).value.trim();
        if (!content) return;
        const mode = container.querySelector(`input[name="quiz-ss-mode-${qid}"]:checked`).value;
        const marker = mode === 'sup' ? `^{${content}}` : `_{${content}}`;
        const input = document.querySelector(`[data-fill-q="${qid}"]`);
        if (!input) return;
        _insertAtCursor(input, marker);
        state.quizAnswers[qid] = input.value;
        container.innerHTML = '';
      };
      container.querySelector(`#quiz-ss-close-${qid}`).onclick = () => { container.innerHTML = ''; };
      container.querySelector(`#quiz-ss-content-${qid}`).focus();
    };
  });

  // ⁿ√ buttons in quiz fill-in questions
  document.querySelectorAll('.quiz-nroot-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const qid = btn.dataset.qid;
      const container = document.querySelector(`.frac-popup-container[data-frac-for="${qid}"]`);
      if (!container) return;
      if (container.innerHTML) { container.innerHTML = ''; return; }
      container.innerHTML = `
        <div class="sym-popup" style="margin-top:6px;">
          <input type="text" id="quiz-nr-content-${qid}" placeholder="根指数 (如 3)" class="sym-popup-input">
          <button type="button" class="sym-popup-insert" id="quiz-nr-insert-${qid}">插入</button>
          <button type="button" class="sym-popup-close" id="quiz-nr-close-${qid}">✕</button>
        </div>
      `;
      container.querySelector(`#quiz-nr-insert-${qid}`).onclick = () => {
        const n = container.querySelector(`#quiz-nr-content-${qid}`).value.trim();
        if (!n) return;
        const marker = `^{${n}}√`;
        const input = document.querySelector(`[data-fill-q="${qid}"]`);
        if (!input) return;
        _insertAtCursor(input, marker);
        state.quizAnswers[qid] = input.value;
        container.innerHTML = '';
      };
      container.querySelector(`#quiz-nr-close-${qid}`).onclick = () => { container.innerHTML = ''; };
      container.querySelector(`#quiz-nr-content-${qid}`).focus();
    };
  });

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(el => {
    el.onclick = () => {
      el.parentElement.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      handleFilter(el.dataset.filter);
    };
  });

  // Sort chips
  document.querySelectorAll('.sort-chip').forEach(el => {
    el.onclick = () => {
      el.parentElement.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      handleSort(el.dataset.sort);
    };
  });

  // Category color picker buttons
  document.querySelectorAll('#new-cat-colors .cat-color-btn').forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      document.querySelectorAll('#new-cat-colors .cat-color-btn').forEach(b => {
        b.classList.remove('selected');
        b.style.border = '2px solid transparent';
      });
      el.classList.add('selected');
      el.style.border = '2px solid #333';
    };
  });
}

async function handleAuth() {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  const nicknameEl = document.getElementById('auth-nickname');
  const nickname = nicknameEl ? nicknameEl.value.trim() : '';
  const isRegister = state.currentPage === 'register';

  if (!username || !password) {
    showToast('Please fill in all fields');
    return;
  }

  try {
    const data = isRegister
      ? await API.post('/api/auth/register', { username, password, nickname })
      : await API.post('/api/auth/login', { username, password });

    state.token = data.token;
    state.user = data.user;
    _authCleared = false; _consecutive401s = 0; // reset auth guard
    localStorage.setItem('ata_token', data.token);
    localStorage.setItem('ata_user', JSON.stringify(data.user));
    navigate('home');
    showToast(isRegister ? 'Welcome to Ata! 🎉' : 'Welcome back! 👋');
  } catch (err) {
    showToast(err.message);
  }
}

async function handleAction(action, dataset) {
  switch (action) {
    case 'goto-login': navigate('login'); break;
    case 'goto-register': navigate('register'); break;
    case 'logout':
      state.token = '';
      state.user = null;
      localStorage.removeItem('ata_token');
      localStorage.removeItem('ata_user');
      navigate('login');
      break;
    case 'nav-home': navigate('home'); break;
    case 'nav-subjects': navigate('subjects'); break;
    case 'nav-mistakes': navigate('mistakes'); break;
    case 'nav-quizzes': navigate('quizzes'); break;
    case 'nav-settings': navigate('settings'); break;

    case 'nav-trash': navigate('trash'); loadTrash(); break;
    case 'restore-trash': handleRestoreTrash(dataset.type, parseInt(dataset.id)); break;
    case 'permanent-delete': handlePermanentDelete(dataset.type, parseInt(dataset.id)); break;
    case 'empty-trash': handleEmptyTrash(); break;
    case 'batch-entry': navigate('batch-mistakes'); break;
    case 'batch-manage-mistakes': toggleMistakeBatchMode(); break;
    case 'exit-batch-manage': exitMistakeBatchMode(); break;
    case 'batch-delete-mistakes': handleBatchDeleteMistakes(); break;
    case 'batch-delete-quizzes': handleBatchDeleteQuizzes(); break;
    case 'batch-fav-mistakes': handleBatchFavMistakes(); break;
    case 'batch-fav-quizzes': handleBatchFavQuizzes(); break;
    case 'exit-quiz-batch-manage': toggleQuizBatchMode(); break;
    case 'save-subjects': handleSaveSubjects(); break;
    case 'submit-batch': handleSubmitBatch(); break;
    case 'add-batch-card': addBatchCard(); break;
    case 'nav-review': navigate('review'); loadReviewDue(); break;
    case 'save-daily-limit': {
      const input = document.getElementById('daily-limit-input') || document.getElementById('settings-daily-limit');
      const msg = document.getElementById('daily-limit-msg') || document.getElementById('settings-save-msg');
      if (!input) { showToast('找不到输入框'); break; }
      const val = parseInt(input.value) || 20;
      API.post('/api/settings/daily-limit', { daily_review_limit: val })
        .then(() => { if (msg) msg.textContent = '已保存 ✓'; showToast('已保存 ✓'); })
        .catch(err => { if (msg) msg.textContent = '保存失败'; showToast('保存失败: ' + err.message); });
      break;
    }
    case 'save-rename': {
      const renameInput = document.getElementById('rename-input');
      const renameMsg = document.getElementById('rename-msg');
      if (!renameInput) break;
      const newNick = renameInput.value.trim();
      if (!newNick) { showToast('请输入新昵称'); break; }
      try {
        const res = await API.post('/api/user/rename', { nickname: newNick });
        if (renameMsg) renameMsg.textContent = res.message || '改名成功 ✓';
        showToast('改名成功 ✓');
        state.user = { ...state.user, nickname: newNick };
        localStorage.setItem('user', JSON.stringify(state.user));
        render();
      } catch(err) {
        if (renameMsg) renameMsg.textContent = err.message || '改名失败';
        showToast('改名失败: ' + err.message);
      }
      break;
    }
    case 'replay-onboarding':
      localStorage.removeItem('onboarding_done');
      showOnboarding();
      break;
    case 'clear-all-data':
      showConfirmModal('清空所有数据', '确定要清空所有错题和Quiz数据吗？此操作不可恢复！', async () => {
        try {
          await API.del('/api/user/data');
          showToast('所有数据已清空');
          navigate('home');
        } catch(err) {
          showToast('清空失败: ' + err.message);
        }
      });
      break;
    case 'create-backup': {
      const backupBtn = document.getElementById('create-backup-btn');
      if (backupBtn) { backupBtn.disabled = true; backupBtn.textContent = '备份中...'; }
      try {
        const result = await API.post('/api/backup');
        if (result.success) {
          showToast('备份成功! ' + result.message);
          await loadBackupList();
        } else {
          showToast('备份失败: ' + (result.error || '未知错误'));
        }
      } catch(err) {
        showToast('备份失败: ' + err.message);
      } finally {
        if (backupBtn) { backupBtn.disabled = false; backupBtn.textContent = '立即备份'; }
      }
      break;
    }
    case 'restore-backup': {
      const fn = dataset.filename;
      if (!fn) break;
      showConfirmModal('恢复备份', '确定要从该备份恢复数据库吗？当前数据将被覆盖（系统会先自动保存一份安全备份）。', async () => {
        try {
          const result = await API.post('/api/backup/restore/' + encodeURIComponent(fn));
          if (result.success) {
            showToast('恢复成功! ' + result.message);
            await loadBackupList();
          } else {
            showToast('恢复失败: ' + (result.error || '未知错误'));
          }
        } catch(err) {
          showToast('恢复失败: ' + err.message);
        }
      });
      break;
    }
    case 'add-mistake': navigate('add-mistake'); break;
    case 'add-quiz': quizQuestions = []; navigate('add-quiz'); break;
    case 'print-quiz': showQuizPrintDialog(); break;
    case 'edit-quiz': state.editingQuizId = parseInt(dataset.id); navigate('edit-quiz'); break;
    case 'add-mistake-from-chapter':
    case 'add-mistake-chapter':
      state.preSelectSubject = state.currentSubject ? state.currentSubject.id : null;
      state.preSelectChapter = state.currentChapter ? state.currentChapter.id : null;
      navigate('add-mistake');
      break;
    case 'add-quiz-from-chapter':
    case 'add-quiz-chapter':
      state.preSelectSubject = state.currentSubject ? state.currentSubject.id : null;
      state.preSelectChapter = state.currentChapter ? state.currentChapter.id : null;
      quizQuestions = [];
      navigate('add-quiz');
      break;
    case 'select-subject': loadSubjectChapters(parseInt(dataset.id)); break;
    case 'select-chapter': loadChapterDetail(parseInt(dataset.id)); break;
    case 'nav-back-chapters': navigate('chapters'); break;
    case 'take-quiz': loadQuizForTaking(parseInt(dataset.id)); break;
    case 'delete-quiz': handleDeleteQuiz(parseInt(dataset.id)); break;
    case 'mark-mastered': handleMarkMastered(parseInt(dataset.id)); break;
    case 'unmark-mastered': handleUnmarkMastered(parseInt(dataset.id)); break;
    case 'mark-reviewing': handleMarkReviewing(parseInt(dataset.id)); break;
    case 'delete-mistake': handleDeleteMistake(parseInt(dataset.id)); break;
    case 'redo-mistake': handleRedoMistake(parseInt(dataset.id)); break;
    case 'edit-mistake': handleEditMistake(parseInt(dataset.id)); break;
    case 'view-detail': handleViewDetail(parseInt(dataset.id)); break;
    case 'toggle-subject-chip': toggleSubjectChip(parseInt(dataset.id)); break;
    case 'open-fav-modal': showFavoriteModal(dataset.targetType, parseInt(dataset.targetId)); break;
    case 'fav-toggle-manage': toggleFavManageMode(); break;
    case 'fav-folder-click': handleFavFolderClick(parseInt(dataset.folderId)); break;
    case 'fav-folder-checkbox': toggleFolderCheckbox(parseInt(dataset.folderId)); break;
    case 'fav-item-checkbox': toggleFavItemCheckbox(parseInt(dataset.favId)); break;
    case 'fav-delete-item': handleDeleteFavItem(parseInt(dataset.favId)); break;
    case 'fav-delete-folder': handleDeleteFavFolder(parseInt(dataset.folderId)); break;
    case 'fav-batch-delete': handleFavBatchDelete(); break;
    case 'fav-batch-move': showFavMoveModal(); break;
    case 'fav-batch-delete-folders': handleFavBatchDeleteFolders(); break;
    case 'fav-batch-move-folders': showFavFolderMoveModal(); break;
    case 'fav-back': navigate('favorites'); break;
    case 'fav-edit-folder': handleFavEditFolder(parseInt(dataset.folderId)); break;
    default: break;
  }
}

// --- Data Loading ---
async function loadPageData() {
  if (!state.token) return;

  switch (state.currentPage) {
    case 'home': await loadStats(); break;
    case 'subjects': await loadSubjectsList(); break;
    case 'mistakes':
      // Show skeleton screen immediately while data loads in parallel
      _showMistakeSkeleton();
      await Promise.all([
        initMistakeFilters(),
        loadFavCacheLight(),
        loadMistakes()
      ]);
      break;
    case 'quizzes': await initQuizFilters(); await loadQuizzes(); break;
    case 'chapter-quizzes': await loadChapterQuizzes(); break;
    case 'add-mistake': await loadSubjectsForSelect('mistake-subject'); await handleAddMistakePreSelect(); await loadTagsByChapter(); initTagInput('mistake-tag-chips', 'mistake-tags-input', 'mistake-tags-autocomplete', document.getElementById('mistake-chapter') && document.getElementById('mistake-chapter').value ? parseInt(document.getElementById('mistake-chapter').value) : null); 
      // Add chapter change listener for single mistake add
      const singleMistakeChapterSelect = document.getElementById('mistake-chapter');
      if (singleMistakeChapterSelect) {
        singleMistakeChapterSelect.onchange = () => {
          initTagInput('mistake-tag-chips', 'mistake-tags-input', 'mistake-tags-autocomplete', singleMistakeChapterSelect.value ? parseInt(singleMistakeChapterSelect.value) : null);
        };
      }
      break;
    case 'add-quiz': await loadSubjectsForSelect('quiz-subject'); await handleAddQuizPreSelect(); break;
    case 'edit-quiz': await loadEditQuiz(); break;
    case 'settings': await loadSettings(); break;
    case 'batch-mistakes': await loadBatchMistakesInit(); break;
  }
}

// --- Three-level navigation state for Mistakes page ---
let _mistakeNavSubjects = []; // [{id, name, icon, bg}]
let _mistakeNavSelectedSubjectId = null;
let _mistakeNavChapters = []; // [{id, title, unit_number, tags:[{name,count}]}]
let _mistakeNavSelectedChapterId = null;
let _mistakeNavSelectedTag = ''; // currently selected tag

// Quiz navigation state
let _quizNavSubjects = [];
let _quizNavSelectedSubjectId = null;
let _quizNavChapters = []; // [{id, title, unit_number}]
let _quizNavSelectedChapterId = null;
let _quizBookmarkSelectedId = null; // currently selected quiz bookmark ID

const _subjectMeta = {
  1: { icon: '📐', bg: '#E3F2FD', short: 'Calc BC' },
  2: { icon: '⚛️', bg: '#F3E5F5', short: 'Physics 1' },
  3: { icon: '⚡', bg: '#FFF3E0', short: 'Physics C' },
  4: { icon: '📊', bg: '#E8F5E9', short: 'Statistics' },
  5: { icon: '🧪', bg: '#FCE4EC', short: 'Chemistry' },
  6: { icon: '📏', bg: '#E0F7FA', short: 'Calc AB' },
};

// Show skeleton loading cards for mistakes page
function _showMistakeSkeleton() {
  const container = document.getElementById('mistakes-container');
  if (!container) return;
  container.innerHTML = Array.from({length: 3}, () => `
    <div class="mistake-card" style="padding:16px;margin-bottom:10px;background:var(--bg-card);border-radius:var(--radius);box-shadow:var(--shadow);">
      <div class="skeleton" style="height:18px;width:70%;margin-bottom:10px;"></div>
      <div class="skeleton" style="height:14px;width:90%;margin-bottom:6px;"></div>
      <div class="skeleton" style="height:14px;width:50%;margin-bottom:12px;"></div>
      <div style="display:flex;gap:8px;">
        <div class="skeleton" style="height:22px;width:60px;border-radius:10px;"></div>
        <div class="skeleton" style="height:22px;width:50px;border-radius:10px;"></div>
      </div>
    </div>
  `).join('');
}

function _renderSubjectChips() {
  const container = document.getElementById('mistake-subject-chips');
  if (!container) return;

  let html = '';
  // "All" chip
  html += `<button class="nav-chip nav-chip-subject${_mistakeNavSelectedSubjectId === null ? ' active' : ''}" data-nav-action="select-subject" data-id="">全部</button>`;
  for (const s of _mistakeNavSubjects) {
    const meta = _subjectMeta[s.id] || { icon: '📚', short: s.name };
    const isActive = _mistakeNavSelectedSubjectId === s.id;
    html += `<button class="nav-chip nav-chip-subject${isActive ? ' active' : ''}" data-nav-action="select-subject" data-id="${s.id}">${meta.icon} ${escapeHtml(meta.short)}</button>`;
  }
  container.innerHTML = html;

  // Bind click events
  container.querySelectorAll('[data-nav-action="select-subject"]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      _mistakeNavSelectedSubjectId = id ? parseInt(id) : null;
      _mistakeNavSelectedChapterId = null;
      _mistakeNavSelectedTag = '';
      _mistakeSelectedTag = '';
      // Sync hidden selects for loadMistakes
      const subjectSelect = document.getElementById('mistake-subject-select');
      const chapterSelect = document.getElementById('mistake-chapter-select');
      if (subjectSelect) subjectSelect.value = id || '';
      if (chapterSelect) chapterSelect.value = '';
      // Clear tag search input
      const searchInput = document.getElementById('mistake-tag-search-input');
      if (searchInput) searchInput.value = '';
      // Re-render subject chips, hide chapter/tags
      _renderSubjectChips();
      _renderChapterChips([]);
      _renderTagChips([]);
      // Reset bookmark selection and re-render bookmarks for new subject
      _mistakeBookmarkSelectedId = null;
      _renderMistakeBookmarks();
      // Load chapters for this subject
      if (_mistakeNavSelectedSubjectId) {
        _loadChaptersForNav(_mistakeNavSelectedSubjectId);
      }
      loadMistakes();
    };
  });
}

function _renderChapterChips(chapters) {
  _mistakeNavChapters = chapters;
  const container = document.getElementById('mistake-chapter-chips');
  if (!container) return;

  if (!chapters || chapters.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  let html = '';
  // "All chapters" chip
  html += `<button class="nav-chip nav-chip-chapter${_mistakeNavSelectedChapterId === null ? ' active' : ''}" data-nav-action="select-chapter" data-id="">全部单元</button>`;
  for (const ch of chapters) {
    const isActive = _mistakeNavSelectedChapterId === ch.id;
    html += `<button class="nav-chip nav-chip-chapter${isActive ? ' active' : ''}" data-nav-action="select-chapter" data-id="${ch.id}">U${ch.unit_number}</button>`;
  }
  container.innerHTML = html;

  // Bind click events
  container.querySelectorAll('[data-nav-action="select-chapter"]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      _mistakeNavSelectedChapterId = id ? parseInt(id) : null;
      _mistakeNavSelectedTag = '';
      _mistakeSelectedTag = '';
      // Sync hidden selects for loadMistakes
      const chapterSelect = document.getElementById('mistake-chapter-select');
      if (chapterSelect) chapterSelect.value = id || '';
      // Clear tag search input
      const searchInput = document.getElementById('mistake-tag-search-input');
      if (searchInput) searchInput.value = '';
      // Re-render chapter chips
      _renderChapterChips(_mistakeNavChapters);
      // Show tags for selected chapter
      if (_mistakeNavSelectedChapterId) {
        const ch = _mistakeNavChapters.find(c => c.id === _mistakeNavSelectedChapterId);
        _renderTagChips(ch ? ch.tags : []);
        _loadChapterTagChips();
      } else {
        _renderTagChips([]);
        const tagChipsBar = document.getElementById('mistake-tag-chips-bar');
        if (tagChipsBar) { tagChipsBar.style.display = 'none'; tagChipsBar.innerHTML = ''; }
      }
      loadMistakes();
    };
  });
}

function _renderTagChips(tags) {
  const container = document.getElementById('mistake-tag-chips');
  if (!container) return;

  if (!tags || tags.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  let html = '';
  // Only show "全部标签" reset button; individual tag chips are in the 🏷️ bar below
  html += `<button class="nav-chip nav-chip-tag${_mistakeNavSelectedTag === '' ? ' active' : ''}" data-nav-action="select-tag" data-tag="">全部标签</button>`;
  container.innerHTML = html;

  // Bind click events
  container.querySelectorAll('[data-nav-action="select-tag"]').forEach(btn => {
    btn.onclick = () => {
      const tag = btn.dataset.tag;
      _mistakeNavSelectedTag = tag;
      _mistakeSelectedTag = tag;
      // Update search input
      const searchInput = document.getElementById('mistake-tag-search-input');
      if (searchInput) searchInput.value = tag;
      // Re-render tag chips (only "全部标签" reset)
      const ch = _mistakeNavChapters.find(c => c.id === _mistakeNavSelectedChapterId);
      _renderTagChips(ch ? ch.tags : []);
      // Sync the 🏷️ tag library bar
      _loadChapterTagChips();
      loadMistakes();
    };
  });
}

async function _loadChaptersForNav(subjectId) {
  try {
    const data = await API.get(`/api/chapter-tags-nav?subject_id=${subjectId}`);
    _renderChapterChips(data.chapters || []);
    // If a chapter was previously selected, try to restore it
    if (_mistakeNavSelectedChapterId) {
      const ch = (data.chapters || []).find(c => c.id === _mistakeNavSelectedChapterId);
      if (ch) {
        _renderTagChips(ch.tags || []);
      } else {
        _mistakeNavSelectedChapterId = null;
        _renderTagChips([]);
      }
    }
  } catch (e) {
    console.error('Failed to load chapters for nav:', e);
    _renderChapterChips([]);
  }
}

// --- Quiz Navigation Chips (2-level: subject → chapter) ---

function _renderQuizSubjectChips() {
  const container = document.getElementById('quiz-subject-chips');
  if (!container) return;

  let html = '';
  // "All" chip
  html += `<button class="nav-chip nav-chip-subject${_quizNavSelectedSubjectId === null ? ' active' : ''}" data-quiz-nav-action="select-subject" data-id="">全部</button>`;
  for (const s of _quizNavSubjects) {
    const meta = _subjectMeta[s.id] || { icon: '📚', short: s.name };
    const isActive = _quizNavSelectedSubjectId === s.id;
    html += `<button class="nav-chip nav-chip-subject${isActive ? ' active' : ''}" data-quiz-nav-action="select-subject" data-id="${s.id}">${meta.icon} ${escapeHtml(meta.short)}</button>`;
  }
  container.innerHTML = html;

  // Bind click events
  container.querySelectorAll('[data-quiz-nav-action="select-subject"]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      _quizNavSelectedSubjectId = id ? parseInt(id) : null;
      _quizNavSelectedChapterId = null;
      // Sync hidden selects for loadQuizzes
      const subjectSelect = document.getElementById('quiz-subject-select');
      if (subjectSelect) subjectSelect.value = id || '';
      // Re-render subject chips
      _renderQuizSubjectChips();
      // Reset bookmark selection and re-render bookmarks for new subject
      _quizBookmarkSelectedId = null;
      _renderQuizBookmarks();
      loadQuizzes();
    };
  });
}

function _renderQuizChapterChips(chapters) {
  _quizNavChapters = chapters;
  const container = document.getElementById('quiz-chapter-chips');
  if (!container) return;

  if (!chapters || chapters.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  let html = '';
  // "All chapters" chip
  html += `<button class="nav-chip nav-chip-chapter${_quizNavSelectedChapterId === null ? ' active' : ''}" data-quiz-nav-action="select-chapter" data-id="">全部单元</button>`;
  for (const ch of chapters) {
    const isActive = _quizNavSelectedChapterId === ch.id;
    html += `<button class="nav-chip nav-chip-chapter${isActive ? ' active' : ''}" data-quiz-nav-action="select-chapter" data-id="${ch.id}">U${ch.unit_number}</button>`;
  }
  container.innerHTML = html;

  // Bind click events
  container.querySelectorAll('[data-quiz-nav-action="select-chapter"]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      _quizNavSelectedChapterId = id ? parseInt(id) : null;
      // Sync hidden selects for loadQuizzes
      const chapterSelect = document.getElementById('quiz-chapter-select');
      if (chapterSelect) chapterSelect.value = id || '';
      // Re-render chapter chips
      _renderQuizChapterChips(_quizNavChapters);
      _quizBookmarkSelectedId = null;
      _renderQuizBookmarks();
      loadQuizzes();
    };
  });
}

async function _loadQuizChaptersForNav(subjectId) {
  try {
    const data = await API.get(`/api/chapter-tags-nav?subject_id=${subjectId}`);
    _renderQuizChapterChips(data.chapters || []);
    // If a chapter was previously selected, try to restore it
    if (_quizNavSelectedChapterId) {
      const ch = (data.chapters || []).find(c => c.id === _quizNavSelectedChapterId);
      if (!ch) {
        _quizNavSelectedChapterId = null;
      }
    }
  } catch (e) {
    console.error('Failed to load quiz chapters for nav:', e);
    _renderQuizChapterChips([]);
  }
}


// --- Chapter Tag Chips (from tag_library) ---
function _loadChapterTagChips() {
  const bar = document.getElementById('mistake-tag-chips-bar');
  if (!bar) return;
  if (!_mistakeNavSelectedSubjectId || !_mistakeNavSelectedChapterId) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  const subjectId = _mistakeNavSelectedSubjectId;
  const chapterId = _mistakeNavSelectedChapterId;
  API.get('/api/chapter-tags-nav?subject_id=' + subjectId).then(data => {
    const chapters = data.chapters || [];
    const chapter = chapters.find(c => c.id === chapterId);
    const tags = chapter ? (chapter.tags || []) : [];
    // tags is [{name, count}] array
    const tagNames = tags.map(t => t.name || t);
    if (tagNames.length === 0) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }
    bar.style.display = 'flex';
    let html = '<span style="font-size:0.75rem;color:var(--text-tertiary);margin-right:2px;">🏷️</span>';
    for (const t of tagNames) {
      const isActive = _mistakeSelectedTag === t;
      html += '<button class="nav-chip nav-chip-tag' + (isActive ? ' active' : '') + '" data-chapter-tag-action="select" data-chapter-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
    }
    bar.innerHTML = html;
    // Bind click events
    bar.querySelectorAll('[data-chapter-tag-action="select"]').forEach(btn => {
      btn.onclick = () => {
        const tag = btn.dataset.chapterTag;
        if (_mistakeSelectedTag === tag) {
          _mistakeSelectedTag = '';
          _mistakeNavSelectedTag = '';
        } else {
          _mistakeSelectedTag = tag;
          _mistakeNavSelectedTag = tag;
        }
        const searchInput = document.getElementById('mistake-tag-search-input');
        if (searchInput) searchInput.value = _mistakeSelectedTag;
        _loadChapterTagChips();
        const ch = _mistakeNavChapters.find(c => c.id === _mistakeNavSelectedChapterId);
        _renderTagChips(ch ? ch.tags : []);
        loadMistakes();
      };
    });
  }).catch(() => {
    bar.style.display = 'none';
    bar.innerHTML = '';
  });
}

async function initMistakeFilters() {
  const subjectSelect = document.getElementById('mistake-subject-select');
  const chapterSelect = document.getElementById('mistake-chapter-select');

  try {
    // Fetch user's preferred subjects and all subjects
    const [userSubjectsData, allSubjectsData] = await Promise.all([
      API.get('/api/user/subjects').catch(() => null),
      API.get('/api/subjects')
    ]);

    let subjects = allSubjectsData.subjects;
    if (userSubjectsData && userSubjectsData.selected_subjects && userSubjectsData.selected_subjects.length > 0) {
      subjects = subjects.filter(s => userSubjectsData.selected_subjects.includes(s.id));
    }
    _mistakeNavSubjects = subjects;

    // Populate hidden selects for backward compat
    if (subjectSelect) {
      subjectSelect.innerHTML = '<option value="">全部学科</option>' +
        subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    }
    if (chapterSelect) {
      chapterSelect.innerHTML = '<option value="">全部单元</option>';
    }

    // Render subject chips
    _renderSubjectChips();

    // Render mistake bookmarks bar
    _renderMistakeBookmarks();

    // If subject was previously selected, restore state
    if (_mistakeNavSelectedSubjectId) {
      if (subjectSelect) subjectSelect.value = _mistakeNavSelectedSubjectId;
      await _loadChaptersForNav(_mistakeNavSelectedSubjectId);
    }

    // Bind search input (tag search - works alongside chip selection)
    const searchInput = document.getElementById('mistake-tag-search-input');
    if (searchInput) {
      let searchTimeout;
      searchInput.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          _mistakeSelectedTag = searchInput.value.trim();
          _mistakeNavSelectedTag = _mistakeSelectedTag;
          // Re-render tag chips to reflect selection
          if (_mistakeNavSelectedChapterId) {
            const ch = _mistakeNavChapters.find(c => c.id === _mistakeNavSelectedChapterId);
            _renderTagChips(ch ? ch.tags : []);
          }
          loadMistakes();
        }, 300);
      };
    }

  } catch (e) { console.error(e); }
}

function bindQuizChapterOnChange(subjectSelect) {
  const quizChapterSelect = document.getElementById('quiz-chapter');
  if (quizChapterSelect) {
    quizChapterSelect.onchange = () => {
      const isMixed = quizChapterSelect.value === 'mixed';
      updateTagReference('quiz-batch-tag-reference', subjectSelect?.value, 'quiz-chapter');
      updateFormatGuide('quiz-batch-format-guide', isMixed);
    };
  }
}

async function loadSubjectsForSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  try {
    // Fetch user's selected subjects to filter dropdown
    const [userSubjectsData, allData] = await Promise.all([
      API.get('/api/user/subjects').catch(() => null),
      API.get('/api/subjects')
    ]);
    let subjects = allData.subjects;
    if (userSubjectsData && userSubjectsData.selected_subjects && userSubjectsData.selected_subjects.length > 0) {
      subjects = subjects.filter(s => userSubjectsData.selected_subjects.includes(s.id));
    }
    // Use saved form state value if available, otherwise keep current
    const current = (savedQuizFormState && selectId === 'quiz-subject' && savedQuizFormState.subject)
      ? savedQuizFormState.subject
      : select.value;
    select.innerHTML = '<option value="">Select subject</option>' +
      subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    if (current) select.value = current;

    // Bind onchange for quiz-subject (must be done here since element is dynamic)
    if (selectId === 'quiz-subject') {
      select.onchange = () => {
        loadChaptersForSelect(select.value, 'quiz-chapter').then(() => {
          // Bind quiz-chapter onchange after chapters are loaded
          bindQuizChapterOnChange(select);
        });
        // Hide mistakes pool when subject changes
        const pool = document.getElementById('quiz-mistakes-pool');
        if (pool) pool.style.display = 'none';
        // Update symbol bars in question builders
        updateSymbolBars(parseInt(select.value) || 0);
        // Update tag reference for quiz batch
        updateTagReference('quiz-batch-tag-reference', select.value, 'quiz-chapter');
      };
      // Bind quiz-chapter onchange initially
      bindQuizChapterOnChange(select);
    }

    // Bind onchange for mistake-subject
    if (selectId === 'mistake-subject') {
      select.onchange = () => {
        loadChaptersForSelect(select.value, 'mistake-chapter');
        updateSymbolBars(parseInt(select.value));
      };
      // Initial symbol bar render
      updateSymbolBars(0);
    }

    // If we restored subject from saved state, also load chapters
    if (savedQuizFormState && selectId === 'quiz-subject' && savedQuizFormState.subject) {
      await loadChaptersForSelect(savedQuizFormState.subject, 'quiz-chapter');
      const chapterSelect = document.getElementById('quiz-chapter');
      if (chapterSelect && savedQuizFormState.chapter) {
        chapterSelect.value = savedQuizFormState.chapter;
      }
      // Restore title
      const titleInput = document.getElementById('quiz-title');
      if (titleInput && savedQuizFormState.title) {
        titleInput.value = savedQuizFormState.title;
      }
      // Load tag reference for restored state
      updateTagReference('quiz-batch-tag-reference', savedQuizFormState.subject, 'quiz-chapter');
      if (chapterSelect) {
        updateFormatGuide('quiz-batch-format-guide', chapterSelect.value === 'mixed');
      }
      savedQuizFormState = null;
    }
  } catch (err) { /* ignore */ }
}


// --- Unified Bookmark System (subject-bound, with item mapping) ---
// Data structure in localStorage:
//   ata_quiz_bookmarks = { "1": [{id:1, name:"测试卷"}], "_global": [...] }
//   ata_quiz_bookmark_items = { "1": [quizId1, quizId2], "2": [quizId3] }
// Same pattern for mistakes.

let _mistakeBookmarkSelectedId = null; // currently selected mistake bookmark ID

// --- Migration: convert old flat array format to new subject-bound format ---
function _migrateBookmarks(lsKey, itemsLsKey) {
  try {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Old format: flat array of {id, name}
      // Migrate to _global
      const newFormat = { "_global": parsed };
      localStorage.setItem(lsKey, JSON.stringify(newFormat));
      // Also create empty items mapping
      const itemsRaw = localStorage.getItem(itemsLsKey);
      if (itemsRaw) {
        try {
          const itemsParsed = JSON.parse(itemsRaw);
          if (!Array.isArray(Object.keys(itemsParsed).length !== undefined ? itemsParsed : [])) {
            // Already object format, keep it
          } else {
            localStorage.setItem(itemsLsKey, '{}');
          }
        } catch(e) {
          localStorage.setItem(itemsLsKey, '{}');
        }
      }
    }
  } catch(e) { /* ignore migration errors */ }
}

// Run migrations on load
_migrateBookmarks('ata_quiz_bookmarks', 'ata_quiz_bookmark_items');
_migrateBookmarks('ata_mistake_bookmarks', 'ata_mistake_bookmark_items');

// --- Quiz Bookmarks ---
function _getQuizBookmarksMap() {
  try {
    const val = JSON.parse(localStorage.getItem('ata_quiz_bookmarks') || '{}');
    // Ensure it's object format (not old array)
    if (Array.isArray(val)) return { "_global": val };
    return val;
  } catch(e) { return {}; }
}

function _saveQuizBookmarksMap(map) {
  localStorage.setItem('ata_quiz_bookmarks', JSON.stringify(map));
}

function _getQuizBookmarksForSubject(subjectId) {
  const map = _getQuizBookmarksMap();
  if (!subjectId) {
    // "全部" selected: collect bookmarks from all subjects + _global
    let all = [];
    for (const key of Object.keys(map)) {
      if (key === '_global') all = all.concat(map[key] || []);
      else all = all.concat(map[key] || []);
    }
    // Deduplicate by id
    const seen = new Set();
    return all.filter(bm => { if (seen.has(bm.id)) return false; seen.add(bm.id); return true; });
  }
  const key = String(subjectId);
  // Show bookmarks for this subject + _global
  const subjectBm = map[key] || [];
  const globalBm = map['_global'] || [];
  // Deduplicate by id
  const seen = new Set();
  return [...subjectBm, ...globalBm].filter(bm => { if (seen.has(bm.id)) return false; seen.add(bm.id); return true; });
}

function _getSubjectKeyForBookmark(type, subjectId) {
  // Returns the subject key where new bookmarks should be stored
  if (!subjectId) return '_global';
  return String(subjectId);
}

// --- Quiz Bookmark Items (which quiz belongs to which bookmark) ---
function _getQuizBookmarkItems() {
  try {
    return JSON.parse(localStorage.getItem('ata_quiz_bookmark_items') || '{}');
  } catch(e) { return {}; }
}

function _saveQuizBookmarkItems(items) {
  localStorage.setItem('ata_quiz_bookmark_items', JSON.stringify(items));
}

function _isQuizInBookmark(quizId, bookmarkId) {
  const items = _getQuizBookmarkItems();
  const key = String(bookmarkId);
  return (items[key] || []).includes(quizId);
}

function _getQuizBookmarkIdsForQuiz(quizId) {
  // Returns array of bookmark IDs that contain this quiz, filtered by current subject context
  const items = _getQuizBookmarkItems();
  const subjectBookmarks = _getQuizBookmarksForSubject(_quizNavSelectedSubjectId);
  const subjectBookmarkIds = new Set(subjectBookmarks.map(bm => bm.id));
  const result = [];
  for (const [bmId, ids] of Object.entries(items)) {
    if ((ids || []).includes(quizId)) {
      const id = parseInt(bmId);
      if (subjectBookmarkIds.has(id)) result.push(id);
    }
  }
  return result;
}

function _toggleQuizInBookmark(quizId, bookmarkId) {
  const items = _getQuizBookmarkItems();
  const key = String(bookmarkId);
  if (!items[key]) items[key] = [];
  const idx = items[key].indexOf(quizId);
  if (idx >= 0) {
    items[key].splice(idx, 1);
  } else {
    items[key].push(quizId);
  }
  _saveQuizBookmarkItems(items);
}

function _addQuizToBookmark(quizId, bookmarkId) {
  const items = _getQuizBookmarkItems();
  const key = String(bookmarkId);
  if (!items[key]) items[key] = [];
  if (!items[key].includes(quizId)) items[key].push(quizId);
  _saveQuizBookmarkItems(items);
}

function _removeQuizFromBookmark(quizId, bookmarkId) {
  const items = _getQuizBookmarkItems();
  const key = String(bookmarkId);
  if (items[key]) {
    const idx = items[key].indexOf(quizId);
    if (idx >= 0) items[key].splice(idx, 1);
  }
  _saveQuizBookmarkItems(items);
}

// Filter quiz IDs by selected bookmark
function _filterQuizzesByBookmark(quizzes) {
  if (!_quizBookmarkSelectedId) return quizzes;
  const items = _getQuizBookmarkItems();
  const key = String(_quizBookmarkSelectedId);
  const allowedIds = new Set(items[key] || []);
  return quizzes.filter(q => allowedIds.has(q.id));
}

// --- Mistake Bookmark Items ---
function _getMistakeBookmarksMap() {
  try {
    const val = JSON.parse(localStorage.getItem('ata_mistake_bookmarks') || '{}');
    if (Array.isArray(val)) return { "_global": val };
    return val;
  } catch(e) { return {}; }
}

function _saveMistakeBookmarksMap(map) {
  localStorage.setItem('ata_mistake_bookmarks', JSON.stringify(map));
}

function _getMistakeBookmarksForSubject(subjectId) {
  const map = _getMistakeBookmarksMap();
  if (!subjectId) {
    let all = [];
    for (const key of Object.keys(map)) {
      all = all.concat(map[key] || []);
    }
    const seen = new Set();
    return all.filter(bm => { if (seen.has(bm.id)) return false; seen.add(bm.id); return true; });
  }
  const key = String(subjectId);
  const subjectBm = map[key] || [];
  const globalBm = map['_global'] || [];
  const seen = new Set();
  return [...subjectBm, ...globalBm].filter(bm => { if (seen.has(bm.id)) return false; seen.add(bm.id); return true; });
}

function _getMistakeBookmarkItems() {
  try {
    return JSON.parse(localStorage.getItem('ata_mistake_bookmark_items') || '{}');
  } catch(e) { return {}; }
}

function _saveMistakeBookmarkItems(items) {
  localStorage.setItem('ata_mistake_bookmark_items', JSON.stringify(items));
}

function _isMistakeInBookmark(mistakeId, bookmarkId) {
  const items = _getMistakeBookmarkItems();
  const key = String(bookmarkId);
  return (items[key] || []).includes(mistakeId);
}

function _getMistakeBookmarkIdsForMistake(mistakeId) {
  // Returns array of bookmark IDs that contain this mistake, filtered by current subject context
  const items = _getMistakeBookmarkItems();
  const subjectBookmarks = _getMistakeBookmarksForSubject(_mistakeNavSelectedSubjectId);
  const subjectBookmarkIds = new Set(subjectBookmarks.map(bm => bm.id));
  const result = [];
  for (const [bmId, ids] of Object.entries(items)) {
    if ((ids || []).includes(mistakeId)) {
      const id = parseInt(bmId);
      if (subjectBookmarkIds.has(id)) result.push(id);
    }
  }
  return result;
}

function _toggleMistakeInBookmark(mistakeId, bookmarkId) {
  const items = _getMistakeBookmarkItems();
  const key = String(bookmarkId);
  if (!items[key]) items[key] = [];
  const idx = items[key].indexOf(mistakeId);
  if (idx >= 0) {
    items[key].splice(idx, 1);
  } else {
    items[key].push(mistakeId);
  }
  _saveMistakeBookmarkItems(items);
}

function _addMistakeToBookmark(mistakeId, bookmarkId) {
  const items = _getMistakeBookmarkItems();
  const key = String(bookmarkId);
  if (!items[key]) items[key] = [];
  if (!items[key].includes(mistakeId)) items[key].push(mistakeId);
  _saveMistakeBookmarkItems(items);
}

function _removeMistakeFromBookmark(mistakeId, bookmarkId) {
  const items = _getMistakeBookmarkItems();
  const key = String(bookmarkId);
  if (items[key]) {
    const idx = items[key].indexOf(mistakeId);
    if (idx >= 0) items[key].splice(idx, 1);
  }
  _saveMistakeBookmarkItems(items);
}

function _filterMistakesByBookmark(mistakes) {
  if (!_mistakeBookmarkSelectedId) return mistakes;
  const items = _getMistakeBookmarkItems();
  const key = String(_mistakeBookmarkSelectedId);
  const allowedIds = new Set(items[key] || []);
  return mistakes.filter(m => allowedIds.has(m.id));
}

// --- Render Bookmark Chips ---
function _renderQuizBookmarks() {
  const bar = document.getElementById('quiz-bookmarks-bar');
  if (!bar) return;
  const bookmarks = _getQuizBookmarksForSubject(_quizNavSelectedSubjectId);
  bar.style.display = 'flex';
  let html = '';
  for (const bm of bookmarks) {
    const isActive = _quizBookmarkSelectedId === bm.id;
    html += '<button class="bookmark-chip' + (isActive ? ' active' : '') + '" data-bookmark-id="' + bm.id + '">' + escapeHtml(bm.name) + '</button>';
  }
  html += '<button class="bookmark-manage-btn" id="quiz-bookmark-manage-btn" title="管理收藏夹">📁</button>';
  bar.innerHTML = html;
  bar.querySelectorAll('.bookmark-chip').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.bookmarkId);
      if (_quizBookmarkSelectedId === id) {
        _quizBookmarkSelectedId = null;
      } else {
        _quizBookmarkSelectedId = id;
      }
      _renderQuizBookmarks();
      loadQuizzes();
    };
  });
  const manageBtn = bar.querySelector('#quiz-bookmark-manage-btn');
  if (manageBtn) {
    manageBtn.onclick = () => _showBookmarkManageDialog('quiz');
  }
}

function _renderMistakeBookmarks() {
  const bar = document.getElementById('mistake-bookmarks-bar');
  if (!bar) return;
  const bookmarks = _getMistakeBookmarksForSubject(_mistakeNavSelectedSubjectId);
  bar.style.display = 'flex';
  let html = '';
  for (const bm of bookmarks) {
    const isActive = _mistakeBookmarkSelectedId === bm.id;
    html += '<button class="bookmark-chip' + (isActive ? ' active' : '') + '" data-bookmark-id="' + bm.id + '">' + escapeHtml(bm.name) + '</button>';
  }
  html += '<button class="bookmark-manage-btn" id="mistake-bookmark-manage-btn" title="管理收藏夹">📁</button>';
  bar.innerHTML = html;
  bar.querySelectorAll('.bookmark-chip').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.bookmarkId);
      if (_mistakeBookmarkSelectedId === id) {
        _mistakeBookmarkSelectedId = null;
      } else {
        _mistakeBookmarkSelectedId = id;
      }
      _renderMistakeBookmarks();
      loadMistakes();
    };
  });
  const manageBtn = bar.querySelector('#mistake-bookmark-manage-btn');
  if (manageBtn) {
    manageBtn.onclick = () => _showBookmarkManageDialog('mistake');
  }
}

// --- Unified Bookmark Manage Dialog ---
function _showBookmarkManageDialog(type) {
  const isQuiz = type === 'quiz';
  const subjectId = isQuiz ? _quizNavSelectedSubjectId : _mistakeNavSelectedSubjectId;
  const subjectKey = _getSubjectKeyForBookmark(type, subjectId);

  const getMap = isQuiz ? _getQuizBookmarksMap : _getMistakeBookmarksMap;
  const saveMap = isQuiz ? _saveQuizBookmarksMap : _saveMistakeBookmarksMap;
  const getItems = isQuiz ? _getQuizBookmarkItems : _getMistakeBookmarkItems;
  const saveItems = isQuiz ? _saveQuizBookmarkItems : _saveMistakeBookmarkItems;
  const renderFn = isQuiz ? _renderQuizBookmarks : _renderMistakeBookmarks;
  const loadFn = isQuiz ? loadQuizzes : loadMistakes;
  const selectedIdRef = isQuiz ? '_quizBookmarkSelectedId' : '_mistakeBookmarkSelectedId';

  const map = getMap();
  const bookmarks = map[subjectKey] || [];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  let listHTML = '';
  if (bookmarks.length === 0) {
    listHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:16px 0;">暂无收藏夹</div>';
  } else {
    listHTML = bookmarks.map(bm => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f0f0f0;">
        <span style="flex:1;font-size:0.9rem;">${escapeHtml(bm.name)}</span>
        <span style="font-size:0.75rem;color:var(--text-tertiary);">${((getItems()[String(bm.id)]) || []).length}项</span>
        <button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;padding:2px 10px;font-size:0.8rem;" data-bm-delete-id="${bm.id}">删除</button>
      </div>
    `).join('');
  }
  const title = isQuiz ? '📁 管理 Quiz 收藏夹' : '📁 管理错题收藏夹';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:90vw;width:340px;text-align:left;">
      <h3 style="margin-bottom:12px;font-size:1.05rem;text-align:center;">${title}</h3>
      <div id="bookmark-manage-list" style="max-height:200px;overflow-y:auto;margin-bottom:12px;">${listHTML}</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="text" id="bookmark-new-name" placeholder="新建收藏夹名称..." style="flex:1;padding:8px 12px;border:1.5px solid #d0d0d0;border-radius:8px;font-size:0.9rem;outline:none;" />
        <button class="btn btn-primary btn-sm" id="bookmark-add-confirm">添加</button>
      </div>
      <button class="btn btn-secondary" id="bookmark-manage-close" style="margin-top:12px;width:100%;">关闭</button>
    </div>
  `;
  document.body.appendChild(overlay);
  // Bind delete
  overlay.querySelectorAll('[data-bm-delete-id]').forEach(btn => {
    btn.onclick = () => {
      const delId = parseInt(btn.dataset.bmDeleteId);
      const currentMap = getMap();
      const arr = currentMap[subjectKey] || [];
      currentMap[subjectKey] = arr.filter(b => b.id !== delId);
      saveMap(currentMap);
      // Also remove items mapping for this bookmark
      const items = getItems();
      delete items[String(delId)];
      saveItems(items);
      // Reset selected if it was this bookmark
      if (isQuiz && _quizBookmarkSelectedId === delId) _quizBookmarkSelectedId = null;
      if (!isQuiz && _mistakeBookmarkSelectedId === delId) _mistakeBookmarkSelectedId = null;
      renderFn();
      loadFn();
      overlay.remove();
      showToast('已删除收藏夹');
    };
  });
  // Bind add
  const addBtn = overlay.querySelector('#bookmark-add-confirm');
  const nameInput = overlay.querySelector('#bookmark-new-name');
  addBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const currentMap = getMap();
    if (!currentMap[subjectKey]) currentMap[subjectKey] = [];
    const arr = currentMap[subjectKey];
    if (arr.length >= 10) { showToast('最多10个收藏夹'); return; }
    if (arr.find(b => b.name === name)) { showToast('收藏夹已存在'); return; }
    // Generate globally unique ID across all subjects
    let maxId = 0;
    for (const key of Object.keys(currentMap)) {
      for (const bm of (currentMap[key] || [])) {
        if (bm.id > maxId) maxId = bm.id;
      }
    }
    arr.push({ id: maxId + 1, name: name });
    saveMap(currentMap);
    renderFn();
    overlay.remove();
    showToast('已创建收藏夹: ' + name);
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
  overlay.querySelector('#bookmark-manage-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// --- Bookmark Star Picker (for ⭐ on cards) ---
function _showBookmarkStarPicker(type, itemIds) {
  // Supports both single item (number) and batch (array of numbers)
  const isQuiz = type === 'quiz';
  const subjectId = isQuiz ? _quizNavSelectedSubjectId : _mistakeNavSelectedSubjectId;
  const bookmarks = isQuiz ? _getQuizBookmarksForSubject(subjectId) : _getMistakeBookmarksForSubject(subjectId);
  const getIdsFn = isQuiz ? _getQuizBookmarkIdsForQuiz : _getMistakeBookmarkIdsForMistake;
  // Normalize to array
  const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
  // For single item, get current bookmark memberships; for batch, empty
  const currentIds = ids.length === 1 ? getIdsFn(ids[0]) : [];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  let listHTML = '';
  if (bookmarks.length === 0) {
    listHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:16px 0;">暂无收藏夹，请先在📁中创建</div>';
  } else {
    listHTML = bookmarks.map(bm => {
      const isBookmarked = ids.length === 1 && currentIds.includes(bm.id);
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 6px;border-bottom:1px solid #f0f0f0;cursor:pointer;" data-bm-toggle-id="${bm.id}">
          <span style="font-size:1.2rem;color:${isBookmarked ? '#f59e0b' : '#bbb'};">${isBookmarked ? '★' : '☆'}</span>
          <span style="flex:1;font-size:0.9rem;">${escapeHtml(bm.name)}</span>
        </div>
      `;
    }).join('');
  }
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:90vw;width:320px;text-align:left;">
      <h3 style="margin-bottom:12px;font-size:1.05rem;text-align:center;">📁 收藏到收藏夹</h3>
      <div style="max-height:250px;overflow-y:auto;">${listHTML}</div>
      <button class="btn btn-secondary" id="bookmark-star-close" style="margin-top:12px;width:100%;">关闭</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-bm-toggle-id]').forEach(row => {
    row.onclick = () => {
      const bmId = parseInt(row.dataset.bmToggleId);
      // For batch: add all selected items to this bookmark
      // For single: toggle the item in this bookmark
      if (ids.length > 1) {
        // Batch mode: add all items to this bookmark
        for (const id of ids) {
          if (isQuiz) {
            _addQuizToBookmark(id, bmId);
          } else {
            _addMistakeToBookmark(id, bmId);
          }
        }
        overlay.remove();
        showToast(`已收藏 ${ids.length} ${isQuiz ? '个 quiz' : '道错题'}`);
        // Exit batch mode and refresh
        if (isQuiz) {
          _quizBatchMode = false;
          _quizBatchSelected.clear();
          const bar = document.getElementById('quiz-batch-bar');
          if (bar) bar.style.display = 'none';
          const btn = document.getElementById('quiz-batch-manage-btn');
          if (btn) { btn.textContent = '批量选择'; btn.style.background = ''; btn.style.color = ''; }
          const container = document.getElementById('quizzes-container');
          if (container) container.classList.remove('batch-mode');
          _clearQuizBatchSelection();
          loadQuizzes();
        } else {
          _mistakeBatchMode = false;
          _mistakeBatchSelected.clear();
          const bar = document.getElementById('batch-manage-bar');
          if (bar) bar.style.display = 'none';
          const btn = document.getElementById('batch-manage-btn');
          if (btn) { btn.textContent = '批量选择'; btn.style.background = ''; btn.style.color = ''; }
          const mContainer = document.getElementById('mistakes-container');
          if (mContainer) mContainer.classList.remove('batch-mode');
          _clearMistakeBatchSelection();
          loadMistakes();
        }
      } else {
        // Single item toggle
        const itemId = ids[0];
        if (isQuiz) {
          _toggleQuizInBookmark(itemId, bmId);
        } else {
          _toggleMistakeInBookmark(itemId, bmId);
        }
        // Re-render the picker
        overlay.remove();
        _showBookmarkStarPicker(type, itemId);
        // Refresh card star status
        if (isQuiz) {
          const starBtn = document.querySelector(`.quiz-card-batch[data-quiz-id="${itemId}"] .bookmark-star-btn`);
          if (starBtn) {
            const newIds = _getQuizBookmarkIdsForQuiz(itemId);
            starBtn.textContent = newIds.length > 0 ? '⭐' : '☆';
            starBtn.classList.toggle('bookmarked', newIds.length > 0);
          }
        } else {
          const starBtn = document.querySelector(`.mistake-card[data-mistake-id="${itemId}"] .bookmark-star-btn`);
          if (starBtn) {
            const newIds = _getMistakeBookmarkIdsForMistake(itemId);
            starBtn.textContent = newIds.length > 0 ? '⭐' : '☆';
            starBtn.classList.toggle('bookmarked', newIds.length > 0);
          }
        }
      }
    };
  });
  overlay.querySelector('#bookmark-star-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// Keep old function names for backward compat (used by batch-fav buttons)
function _getQuizBookmarks() { return _getQuizBookmarksForSubject(_quizNavSelectedSubjectId); }
function _saveQuizBookmarks(bookmarks) {
  const map = _getQuizBookmarksMap();
  const key = _getSubjectKeyForBookmark('quiz', _quizNavSelectedSubjectId);
  map[key] = bookmarks;
  _saveQuizBookmarksMap(map);
}
function _getMistakeBookmarks() { return _getMistakeBookmarksForSubject(_mistakeNavSelectedSubjectId); }
function _saveMistakeBookmarks(bookmarks) {
  const map = _getMistakeBookmarksMap();
  const key = _getSubjectKeyForBookmark('mistake', _mistakeNavSelectedSubjectId);
  map[key] = bookmarks;
  _saveMistakeBookmarksMap(map);
}


async function initQuizFilters() {
  const subjectSelect = document.getElementById('quiz-subject-select');

  try {
    // Fetch user's preferred subjects and all subjects
    const [userSubjectsData, allSubjectsData] = await Promise.all([
      API.get('/api/user/subjects').catch(() => null),
      API.get('/api/subjects')
    ]);

    let subjects = allSubjectsData.subjects;
    if (userSubjectsData && userSubjectsData.selected_subjects && userSubjectsData.selected_subjects.length > 0) {
      subjects = subjects.filter(s => userSubjectsData.selected_subjects.includes(s.id));
    }
    _quizNavSubjects = subjects;

    // Populate hidden selects for backward compat
    if (subjectSelect) {
      subjectSelect.innerHTML = '<option value="">全部学科</option>' +
        subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    }
    // Render subject chips
    _renderQuizSubjectChips();

    // If subject was previously selected, restore state
    if (_quizNavSelectedSubjectId) {
      if (subjectSelect) subjectSelect.value = _quizNavSelectedSubjectId;
    }

    // Render bookmarks bar
    _renderQuizBookmarks();

    // Bind search input
    const searchInput = document.getElementById('quiz-search-input');
    if (searchInput) {
      let searchTimeout;
      searchInput.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          loadQuizzes();
        }, 300);
      };
    }

  } catch (e) { console.error(e); }
}

// DEPRECATED: Category chips no longer shown on Quiz page (replaced by subject→chapter chip navigation)
async function loadCategoryChips() {
  const container = document.getElementById('quiz-category-chips');
  if (!container) return;
  try {
    const data = await API.get('/api/quiz-categories');
    const cats = data.categories || [];
    state.quizCategories = cats;
    container.innerHTML =
      '<button class="quiz-cat-chip active" data-cat="all">全部</button>' +
      '<button class="quiz-cat-chip" data-cat="uncategorized">未分类</button>' +
      cats.map(c =>
        `<button class="quiz-cat-chip" data-cat="${c.id}" style="--cat-color:${c.color};">
          <span class="quiz-cat-dot" style="background:${c.color};"></span>${escapeHtml(c.name)}
        </button>`
      ).join('');
    container.querySelectorAll('.quiz-cat-chip').forEach(el => {
      el.onclick = () => {
        container.querySelectorAll('.quiz-cat-chip').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        handleCategoryFilter(el.dataset.cat);
      };
    });
  } catch (err) { /* ignore */ }
}

// handleCategoryFilter removed - Quiz page no longer uses category filtering

async function handleAddMistakePreSelect() {
  if (state.preSelectSubject) {
    const subjectSelect = document.getElementById('mistake-subject');
    if (subjectSelect) {
      subjectSelect.value = state.preSelectSubject;
      if (state.preSelectChapter) {
        await loadChaptersForSelect(state.preSelectSubject, 'mistake-chapter');
        const chapterSelect = document.getElementById('mistake-chapter');
        if (chapterSelect) chapterSelect.value = state.preSelectChapter;
      } else {
        await loadChaptersForSelect(state.preSelectSubject, 'mistake-chapter');
      }
    }
    state.preSelectSubject = null;
    state.preSelectChapter = null;
  }
}

async function handleAddQuizPreSelect() {
  if (state.preSelectSubject) {
    const subjectSelect = document.getElementById('quiz-subject');
    if (subjectSelect) {
      subjectSelect.value = state.preSelectSubject;
      if (state.preSelectChapter) {
        await loadChaptersForSelect(state.preSelectSubject, 'quiz-chapter');
        const chapterSelect = document.getElementById('quiz-chapter');
        if (chapterSelect) chapterSelect.value = state.preSelectChapter;
        // Load existing mistakes for this chapter to select from
        await loadMistakesForQuiz(state.preSelectChapter);
      } else {
        await loadChaptersForSelect(state.preSelectSubject, 'quiz-chapter');
      }
      // Load tag reference for quiz batch after pre-select
      bindQuizChapterOnChange(subjectSelect);
      updateTagReference('quiz-batch-tag-reference', state.preSelectSubject, 'quiz-chapter');
      const chapterSelect = document.getElementById('quiz-chapter');
      if (chapterSelect) {
        updateFormatGuide('quiz-batch-format-guide', chapterSelect.value === 'mixed');
      }
    }
    state.preSelectSubject = null;
    state.preSelectChapter = null;
  }
}

let _poolMistakes = []; // cache for tag filtering
let _poolSelectedTag = ''; // currently selected tag filter
let _mistakeSelectedTag = ''; // currently selected tag in mistakes page

function renderTagNav(chapters, untaggedCount, containerId, selectedTag, onTagSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html = '<div class="tag-nav-group">';
  html += '<button class="tag-nav-toggle" data-group="tagged">📁 已分类</button>';
  html += '<div class="tag-nav-content" style="display:none;">';
  for (const ch of chapters) {
    if (ch.tags.length === 0) continue;
    html += `<div class="tag-nav-chapter" data-chapter-id="${ch.id}">U${ch.unit_number}: ${escapeHtml(ch.title)}</div>`;
    html += `<div class="tag-nav-tags" data-chapter-tags="${ch.id}" style="display:none;">`;
    for (const t of ch.tags) {
      const isActive = selectedTag === t.name;
      html += `<span class="tag-nav-tag${isActive ? ' active' : ''}" data-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}<span class="tag-count">${t.count}</span></span>`;
    }
    html += '</div>';
  }
  html += '</div></div>';

  html += '<div class="tag-nav-group">';
  html += `<button class="tag-nav-toggle" data-group="untagged">📄 未分类${untaggedCount > 0 ? ` (${untaggedCount})` : ''}</button>`;
  html += '<div class="tag-nav-content" style="display:none;">';
  if (untaggedCount > 0) {
    const isActive = selectedTag === '__untagged__';
    html += `<span class="tag-nav-tag${isActive ? ' active' : ''}" data-tag="__untagged__">查看未分类错题 (${untaggedCount})</span>`;
  } else {
    html += '<span style="font-size:0.8rem;color:var(--text-tertiary);padding:4px 10px;">暂无未分类错题</span>';
  }
  html += '</div></div>';

  container.innerHTML = html;

  // Bind toggle expand/collapse
  container.querySelectorAll('.tag-nav-toggle').forEach(btn => {
    btn.onclick = () => {
      const content = btn.nextElementSibling;
      const expanded = btn.classList.toggle('expanded');
      content.style.display = expanded ? 'block' : 'none';
    };
  });

  // Bind chapter expand/collapse
  container.querySelectorAll('.tag-nav-chapter').forEach(ch => {
    ch.onclick = () => {
      const tagsEl = ch.nextElementSibling;
      const expanded = ch.classList.toggle('expanded');
      tagsEl.style.display = expanded ? 'flex' : 'none';
    };
  });

  // Bind tag selection
  container.querySelectorAll('.tag-nav-tag').forEach(tag => {
    tag.onclick = (e) => {
      e.stopPropagation();
      const tagName = tag.dataset.tag;
      if (onTagSelect) onTagSelect(tagName);
    };
  });
}

async function loadMistakeTagNav() {
  try {
    const data = await API.get('/api/tags-by-chapter');
    function onTagSelect(tagName) {
      if (_mistakeSelectedTag === tagName) {
        _mistakeSelectedTag = '';
      } else {
        _mistakeSelectedTag = tagName;
      }
      // Update search input
      const searchInput = document.getElementById('mistake-tag-search-input');
      if (searchInput) searchInput.value = _mistakeSelectedTag === '__untagged__' ? '' : _mistakeSelectedTag;
      // Re-render tag nav to update active state
      renderTagNav(data.chapters, data.untagged_count, 'mistake-tag-nav', _mistakeSelectedTag, onTagSelect);
      loadMistakes();
    }
    renderTagNav(data.chapters, data.untagged_count, 'mistake-tag-nav', _mistakeSelectedTag, onTagSelect);
  } catch(e) {
    console.error('loadMistakeTagNav error:', e);
  }
}

function renderPoolList() {
  const listEl = document.getElementById('pool-items') || document.getElementById('mistakes-pool-list');
  if (!listEl) return;
  let list = [..._poolMistakes];
  // Filter by tag
  if (_poolSelectedTag) {
    if (_poolSelectedTag === '__untagged__') {
      list = list.filter(m => !m.tags || !m.tags.trim());
    } else {
      list = list.filter(m => m.tags && m.tags.split(',').map(t => t.trim()).includes(_poolSelectedTag));
    }
  }
  // Sort by tag group first (tagged items grouped, untagged at end), then by error count within group
  list.sort((a,b) => {
    const aHasTag = a.tags && a.tags.trim();
    const bHasTag = b.tags && b.tags.trim();
    if (aHasTag && !bHasTag) return -1;
    if (!aHasTag && bHasTag) return 1;
    if (aHasTag && bHasTag) {
      const aFirstTag = a.tags.split(',')[0].trim().toLowerCase();
      const bFirstTag = b.tags.split(',')[0].trim().toLowerCase();
      if (aFirstTag !== bFirstTag) return aFirstTag.localeCompare(bFirstTag);
    }
    return b.error_count - a.error_count;
  });

  // Update selected count
  const countEl = document.getElementById('pool-selected-count');
  if (countEl) {
    const selectedFromPool = quizQuestions.filter(q => q.fromMistake).length;
    countEl.textContent = selectedFromPool > 0 ? `已选 ${selectedFromPool} 题` : '';
  }

  if (list.length === 0) {
    listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-tertiary);font-size:0.85rem;">没有符合条件的错题</div>';
    return;
  }
  listEl.innerHTML = `<div style="max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch;"><div id="pool-items">${list.map(m => {
    const isChecked = quizQuestions.some(q => q.mistakeId == m.id);
    const mTags = (m.tags || '').split(',').map(t => t.trim()).filter(t => t);
    return `
    <div class="mistake-select-item ${isChecked ? 'selected' : ''}" data-mistake-id="${m.id}" data-question="${escapeHtml(m.question)}" data-answer="${escapeHtml(m.correct_answer)}" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;background:${isChecked ? 'var(--accent-light)' : 'var(--bg-card)'};margin-bottom:6px;border:1.5px solid ${isChecked ? 'var(--accent)' : 'var(--border)'};transition:all 0.15s;">
      <div style="width:20px;height:20px;flex-shrink:0;margin-top:2px;border-radius:5px;border:2px solid ${isChecked ? 'var(--accent)' : '#ccc'};background:${isChecked ? 'var(--accent)' : '#fff'};display:flex;align-items:center;justify-content:center;transition:all 0.15s;">${isChecked ? '<span style="color:#fff;font-size:12px;font-weight:700;">✓</span>' : ''}</div>
      <div style="flex:1;font-size:0.85rem;min-width:0;">
        <div style="color:var(--text-primary);line-height:1.5;">${renderSubSup(m.question)}</div>
        <div style="color:var(--text-tertiary);font-size:0.75rem;display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap;">
          <span>答: ${renderSubSup(m.correct_answer)}</span>
          <span style="padding:1px 6px;border-radius:8px;background:${m.error_count >= 3 ? '#fce4ec' : '#f5f5f5'};color:${m.error_count >= 3 ? '#c62828' : '#666'};font-weight:${m.error_count >= 3 ? '600' : '400'};">🔄${m.error_count}次</span>
          ${mTags.map(t => `<span style="padding:1px 6px;border-radius:8px;background:#e8f0fe;color:#4a90d9;font-size:0.7rem;">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
    </div>
  `}).join('')}</div></div>`;
  // Bind click on mistake items
  listEl.querySelectorAll('.mistake-select-item').forEach(item => {
    item.onclick = (e) => {
      e.preventDefault();
      const mistakeId = item.dataset.mistakeId;
      const question = item.dataset.question || '';
      const answer = item.dataset.answer || '';
      const isChecked = quizQuestions.some(q => q.mistakeId == mistakeId);
      if (!isChecked) {
        quizQuestions.push({
          type: 'fill',
          text: question,
          correct: answer,
          mistakeId: mistakeId,
          fromMistake: true
        });
      } else {
        quizQuestions = quizQuestions.filter(q => q.mistakeId != mistakeId);
      }
      renderPoolList();
      refreshQuizQuestionsDOM();
    };
  });
}

async function loadMistakesForQuiz(chapterId) {
  const container = document.getElementById('quiz-mistakes-pool');
  const listEl = document.getElementById('mistakes-pool-list');
  if (!container || !listEl) return;
  try {
    const data = await API.get(`/api/mistakes?chapter_id=${chapterId}&sort_by=error_count`);
    container.style.display = 'block';
    if (data.mistakes.length === 0) {
      listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-tertiary);font-size:0.85rem;">该单元暂无错题</div>';
      return;
    }
    _poolMistakes = data.mistakes;
    _poolSelectedTag = '';

    // Load tags-by-chapter for hierarchical filtering
    const subjectSelect = document.getElementById('quiz-subject');
    const subjectId = subjectSelect ? subjectSelect.value : '';
    let tagNavData = { chapters: [], untagged_count: 0 };
    try {
      const tagUrl = subjectId ? `/api/tags-by-chapter?subject_id=${subjectId}` : '/api/tags-by-chapter';
      tagNavData = await API.get(tagUrl);
    } catch(e) { /* ignore */ }

    // Render hierarchical tag filter
    const tagFilterEl = document.getElementById('pool-tag-filter');
    if (tagFilterEl) {
      let html = '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
      html += '<button class="tag-filter-chip active" data-pool-tag="" style="font-size:0.75rem;padding:3px 10px;border-radius:12px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;transition:all 0.15s;">全部</button>';
      html += '<button class="tag-filter-chip" data-pool-tag="__grouped__" style="font-size:0.75rem;padding:3px 10px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-secondary);cursor:pointer;transition:all 0.15s;">📁 已分组 ▾</button>';
      html += '<button class="tag-filter-chip" data-pool-tag="__untagged__" style="font-size:0.75rem;padding:3px 10px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-secondary);cursor:pointer;transition:all 0.15s;">📄 未分组</button>';
      html += '</div>';
      // Search box for tags
      html += '<input type="text" id="pool-tag-search" placeholder="🔍 搜索标签..." style="width:100%;padding:6px 10px;border:1px solid #e0e0e0;border-radius:8px;font-size:0.8rem;background:var(--bg-card);outline:none;margin-top:6px;" />';
      // Hierarchical tag content
      html += '<div id="pool-tag-hierarchy" style="display:none;margin-top:6px;">';
      for (const ch of tagNavData.chapters) {
        if (ch.tags.length === 0) continue;
        html += `<div class="pool-tag-chapter-group">`;
        html += `<div class="tag-nav-chapter" data-pool-chapter="${ch.id}">U${ch.unit_number}: ${escapeHtml(ch.title)}</div>`;
        html += `<div class="tag-nav-tags pool-chapter-tags" data-pool-chapter-tags="${ch.id}" style="display:none;">`;
        for (const t of ch.tags) {
          html += `<span class="tag-nav-tag pool-tag-chip" data-pool-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}<span class="tag-count">${t.count}</span></span>`;
        }
        html += '</div></div>';
      }
      if (tagNavData.untagged_count > 0) {
        html += `<div style="padding:4px 10px 4px 24px;"><span class="tag-nav-tag pool-tag-chip" data-pool-tag="__untagged__">未添加标签 (${tagNavData.untagged_count})</span></div>`;
      }
      html += '</div>';
      tagFilterEl.innerHTML = html;

      // Bind chip clicks (全部/已分组/未分组)
      const mainChips = tagFilterEl.querySelectorAll('.tag-filter-chip');
      function activateChip(chip) {
        mainChips.forEach(c => {
          c.style.border = '1px solid var(--border)';
          c.style.background = 'var(--bg-card)';
          c.style.color = 'var(--text-secondary)';
          c.classList.remove('active');
        });
        chip.style.border = '1px solid var(--accent)';
        chip.style.background = 'var(--accent)';
        chip.style.color = '#fff';
        chip.classList.add('active');
      }

      mainChips.forEach(chip => {
        chip.onclick = () => {
          const tag = chip.dataset.poolTag;
          if (tag === '__grouped__') {
            // Toggle hierarchy display
            const hierarchy = document.getElementById('pool-tag-hierarchy');
            if (hierarchy) {
              hierarchy.style.display = hierarchy.style.display === 'none' ? 'block' : 'none';
            }
            return;
          }
          activateChip(chip);
          _poolSelectedTag = tag;
          // Deselect any pool-tag-chip
          tagFilterEl.querySelectorAll('.pool-tag-chip').forEach(c => c.classList.remove('active'));
          renderPoolList();
        };
      });

      // Bind chapter expand/collapse
      tagFilterEl.querySelectorAll('.tag-nav-chapter[data-pool-chapter]').forEach(ch => {
        ch.onclick = () => {
          const tagsEl = ch.nextElementSibling;
          const expanded = ch.classList.toggle('expanded');
          tagsEl.style.display = expanded ? 'flex' : 'none';
        };
      });

      // Bind hierarchical tag chip clicks
      tagFilterEl.querySelectorAll('.pool-tag-chip').forEach(chip => {
        chip.onclick = (e) => {
          e.stopPropagation();
          const tag = chip.dataset.poolTag;
          _poolSelectedTag = tag;
          // Deselect main chips
          mainChips.forEach(c => {
            c.style.border = '1px solid var(--border)';
            c.style.background = 'var(--bg-card)';
            c.style.color = 'var(--text-secondary)';
            c.classList.remove('active');
          });
          // Toggle active on pool-tag-chips
          tagFilterEl.querySelectorAll('.pool-tag-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          renderPoolList();
        };
      });

      // Bind search for tags
      const poolTagSearch = document.getElementById('pool-tag-search');
      if (poolTagSearch) {
        poolTagSearch.oninput = () => {
          const query = poolTagSearch.value.trim().toLowerCase();
          tagFilterEl.querySelectorAll('.pool-tag-chip').forEach(chip => {
            const tagName = (chip.dataset.poolTag || '').toLowerCase();
            chip.style.display = (!query || tagName.includes(query)) ? '' : 'none';
          });
          // Hide empty chapter groups
          tagFilterEl.querySelectorAll('.pool-tag-chapter-group').forEach(group => {
            const visibleTags = group.querySelectorAll('.pool-tag-chip[style*="display: none"]');
            const allTags = group.querySelectorAll('.pool-tag-chip');
            if (query && visibleTags.length === allTags.length) {
              group.style.display = 'none';
            } else {
              group.style.display = '';
            }
          });
        };
      }
    }

    // Render mistake list (no truncation for quiz page)
    renderPoolList();
  } catch (err) {
    console.error('loadMistakesForQuiz error:', err);
  }
}

async function loadStats() {
  try {
    // Use combined /api/home endpoint to reduce round trips
    const homeData = await API.get('/api/home');
    _homeDataCache = homeData; // cache for checkAndPromptSubjects
    const data = homeData.stats;
    const container = document.getElementById('stats-container');
    if (container) {
      const dueCount = data.total_due || 0;
      const upcomingCount = data.upcoming_due !== undefined ? data.upcoming_due : dueCount;
      container.innerHTML = `
        <div class="stats-grid" style="grid-template-columns: 1fr 1fr 1fr;">
          <div class="stat-card">
            <div class="stat-value">${data.today_added !== undefined ? data.today_added : '-'}</div>
            <div class="stat-label">今日录入</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:${upcomingCount > 0 ? 'var(--accent)' : '#4caf50'}">${upcomingCount}</div>
            <div class="stat-label">待复习</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${data.today_reviewed || 0}</div>
            <div class="stat-label">已复习</div>
          </div>
        </div>
      `;
      // Show per-subject breakdown if available
      if (data.by_subject && data.by_subject.length > 0) {
        const subjectBars = data.by_subject.map(s => {
          const meta = SUBJECT_META[s.subject_id] || { icon: '📚', bg: '#f5f5f5' };
          const subjDue = s.upcoming_due_count || s.due_count || 0;
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f5f5;">
            <span style="width:24px;height:24px;border-radius:6px;background:${meta.bg};display:flex;align-items:center;justify-content:center;font-size:0.75rem;">${meta.icon}</span>
            <span style="flex:1;font-size:0.85rem;">${escapeHtml(s.subject_name)}</span>
            <span style="font-size:0.8rem;color:var(--text-tertiary);">${s.total_mistakes} 题</span>
            ${subjDue > 0 ? `<span style="font-size:0.75rem;background:var(--accent);color:white;padding:2px 6px;border-radius:10px;">${subjDue} 待复习</span>` : ''}
          </div>`;
        }).join('');
        container.innerHTML += `<div class="card" style="padding:12px;margin-top:8px;">${subjectBars}</div>`;
      }
    }

    // Use daily_limit from /api/stats response (already included, no extra API call needed)
    const limitInput = document.getElementById('daily-limit-input');
    if (limitInput) {
      limitInput.value = data.daily_review_limit || 20;
    }

    const todayContainer = document.getElementById('today-review-container');
    if (todayContainer) {
      const todayReviewed = data.today_reviewed || 0;
      const dueCount = data.total_due || 0;
      const upcomingCount = data.upcoming_due !== undefined ? data.upcoming_due : dueCount;
      
      if (upcomingCount === 0) {
        // Truly nothing to review (no items with next_review_date <= tomorrow)
        todayContainer.innerHTML = `
          <div class="card" style="text-align:center;padding:24px;color:var(--text-tertiary);">
            今天没有待复习的题目 ✨<br>
            <span style="font-size:0.85rem;">去做几道题或者导入错题开始复习吧</span>
          </div>
        `;
      } else {
        // Show upcoming count, with progress toward daily limit
        todayContainer.innerHTML = `
          <div class="card" style="padding:16px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:700;color:var(--accent);margin-bottom:4px;">${upcomingCount} 题待复习</div>
            <div style="font-size:0.85rem;color:var(--text-tertiary);margin-bottom:12px;">今日已复习 ${todayReviewed} / ${data.daily_review_limit || 20} 题</div>
            <button class="btn btn-primary btn-block" data-action="nav-review" style="font-size:0.95rem;">
              开始复习 →
            </button>
          </div>
        `;
      }
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
    const container = document.getElementById('stats-container');
    if (container) {
      container.innerHTML = '<div style="padding:10px;color:red;font-size:0.8rem;">Stats error: ' + err.message + '</div>';
    }
  }
}

async function loadSubjectChapters(subjectId) {
  try {
    const data = await API.get(`/api/subjects/${subjectId}/chapters`);
    const subjects = await API.get('/api/subjects');
    const subject = subjects.subjects.find(s => s.id === subjectId);
    state.currentSubject = { ...subject, chapters: data.chapters };
    navigate('chapters');
  } catch (err) {
    showToast('Failed to load chapters');
  }
}

async function loadChapterDetail(chapterId) {
  const subject = state.currentSubject;
  if (!subject) return;
  const chapter = subject.chapters.find(c => c.id === chapterId);
  if (!chapter) return;
  state.currentChapter = chapter;
  navigate('chapter-quizzes');
}

function numToChinese(n) {
  const chineseNum = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三'];
  return chineseNum[n] || String(n);
}

async function loadChaptersForSelect(subjectId, selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '<option value="">Loading...</option>';
  try {
    const data = await API.get(`/api/subjects/${subjectId}/chapters`);
    select.innerHTML = '<option value="">选择章节</option>' +
      '<option value="mixed"> 混合章节（随机抽题）</option>' +
      data.chapters.map(c => `<option value="${c.id}">章节${numToChinese(c.unit_number)}：${escapeHtml(c.title)}</option>`).join('');
  } catch (err) {
    select.innerHTML = '<option value="">加载失败</option>';
  }
}

// Helper: add checkboxes to existing cards via DOM manipulation
function _addBatchCheckboxesToCards() {
  const cards = document.querySelectorAll('#mistakes-container .mistake-card');
  console.log('[batch] _addBatchCheckboxesToCards: found ' + cards.length + ' cards');
  cards.forEach(card => {
    let wrap = card.querySelector('.batch-cb-wrap');
    if (!wrap) {
      const id = card.dataset.mistakeId;
      if (!id) return;
      wrap = document.createElement('div');
      wrap.className = 'batch-cb-wrap';
      wrap.innerHTML = '<input type="checkbox" class="batch-mistake-cb" data-id="' + id + '" style="width:18px;height:18px;accent-color:#4a90d9;cursor:pointer;" />';
      card.insertBefore(wrap, card.firstChild);
    }
    // Always force show when in batch mode
    wrap.style.display = 'block';
    wrap.style.position = 'absolute';
    wrap.style.top = '10px';
    wrap.style.left = '10px';
    wrap.style.zIndex = '10';
  });
  setupBatchCheckboxes();
}

// --- Batch Manage Mode ---
function toggleMistakeBatchMode() {
  _mistakeBatchMode = !_mistakeBatchMode;
  _mistakeBatchSelected.clear();
  console.log('[batch] toggle, _mistakeBatchMode=' + _mistakeBatchMode + ', loading=' + _mistakesLoading);
  // Show/hide batch bar (instant visual feedback)
  const bar = document.getElementById('batch-manage-bar');
  if (bar) bar.style.display = _mistakeBatchMode ? 'block' : 'none';
  // Update button text
  const btn = document.getElementById('batch-manage-btn');
  if (btn) {
    btn.textContent = _mistakeBatchMode ? '退出选择' : '批量选择';
    btn.style.background = _mistakeBatchMode ? '#4a90d9' : '';
    btn.style.color = _mistakeBatchMode ? '#fff' : '';
  }

  if (_mistakeBatchMode) {
    // Entering batch mode: add CSS class for checkbox visibility
    const mContainer = document.getElementById('mistakes-container');
    if (mContainer) mContainer.classList.add('batch-mode');
    // Entering batch mode: directly add checkboxes
    _addBatchCheckboxesToCards();
    // If loadMistakes is still running, wait for it then re-add
    if (_mistakesLoading) {
      const waitForLoad = setInterval(() => {
        if (!_mistakesLoading) {
          clearInterval(waitForLoad);
          if (_mistakeBatchMode) _addBatchCheckboxesToCards();
        }
      }, 100);
      // Safety timeout
      setTimeout(() => clearInterval(waitForLoad), 10000);
    }
  } else {
    // Exiting batch mode: clear selection and hide checkboxes
    const mContainer = document.getElementById('mistakes-container');
    if (mContainer) mContainer.classList.remove('batch-mode');
    _clearMistakeBatchSelection();
    document.querySelectorAll('.batch-cb-wrap').forEach(el => {
      el.style.display = 'none';
    });
  }
}

function _clearMistakeBatchSelection() {
  // Remove batch-selected class from all mistake cards
  document.querySelectorAll('.mistake-card.batch-selected').forEach(el => el.classList.remove('batch-selected'));
  // Uncheck all batch checkboxes
  document.querySelectorAll('.batch-mistake-cb').forEach(cb => { cb.checked = false; });
  // Uncheck select-all
  const sa = document.getElementById('batch-select-all-mistakes');
  if (sa) sa.checked = false;
  // Hide checkboxes
  document.querySelectorAll('.batch-cb-wrap').forEach(el => { el.style.display = 'none'; });
}

function exitMistakeBatchMode() {
  _mistakeBatchMode = false;
  _mistakeBatchSelected.clear();
  const bar = document.getElementById('batch-manage-bar');
  if (bar) bar.style.display = 'none';
  const btn = document.getElementById('batch-manage-btn');
  if (btn) {
    btn.textContent = '批量选择';
    btn.style.background = '';
    btn.style.color = '';
  }
  const mContainer = document.getElementById('mistakes-container');
  if (mContainer) mContainer.classList.remove('batch-mode');
  _clearMistakeBatchSelection();
  document.querySelectorAll('.batch-cb-wrap').forEach(el => el.remove());
}



function _clearQuizBatchSelection() {
  // Remove batch-selected class from all quiz cards
  document.querySelectorAll('.quiz-card-batch.batch-selected').forEach(el => el.classList.remove('batch-selected'));
  // Uncheck all quiz batch checkboxes
  document.querySelectorAll('.quiz-batch-cb').forEach(cb => { cb.checked = false; });
  // Uncheck select-all
  const sa = document.getElementById('batch-select-all-quizzes');
  if (sa) sa.checked = false;
  // Hide checkboxes
  document.querySelectorAll('.quiz-batch-cb-wrap').forEach(el => { el.style.display = 'none'; });
}

function toggleQuizBatchMode() {
  _quizBatchMode = !_quizBatchMode;
  _quizBatchSelected.clear();
  const bar = document.getElementById('quiz-batch-bar');
  if (bar) bar.style.display = _quizBatchMode ? 'block' : 'none';
  const btn = document.getElementById('quiz-batch-manage-btn');
  if (btn) {
    btn.textContent = _quizBatchMode ? '退出选择' : '批量选择';
    btn.style.background = _quizBatchMode ? '#4a90d9' : '';
    btn.style.color = _quizBatchMode ? '#fff' : '';
  }
  // Toggle CSS class on container
  const container = document.getElementById('quizzes-container');
  if (container) container.classList.toggle('batch-mode', _quizBatchMode);
  if (_quizBatchMode) {
    setupQuizBatchCheckboxes();
  } else {
    _clearQuizBatchSelection();
  }
}

function setupQuizBatchCheckboxes() {
  const selectAll = document.getElementById('batch-select-all-quizzes');
  if (selectAll) {
    selectAll.onchange = (e) => {
      document.querySelectorAll('.quiz-batch-cb').forEach(cb => {
        cb.checked = e.target.checked;
        const id = parseInt(cb.dataset.id);
        if (e.target.checked) _quizBatchSelected.add(id);
        else _quizBatchSelected.delete(id);
      });
      updateQuizBatchCount();
    };
  }
  document.querySelectorAll('.quiz-batch-cb').forEach(cb => {
    cb.onclick = (e) => {
      e.stopPropagation();
      const id = parseInt(cb.dataset.id);
      if (cb.checked) _quizBatchSelected.add(id);
      else _quizBatchSelected.delete(id);
      updateQuizBatchCount();
      // Toggle card highlight
      const card = cb.closest('.quiz-card-batch');
      if (card) card.classList.toggle('batch-selected', cb.checked);
      const allCbs = document.querySelectorAll('.quiz-batch-cb');
      const allChecked = document.querySelectorAll('.quiz-batch-cb:checked');
      if (selectAll) selectAll.checked = allCbs.length > 0 && allCbs.length === allChecked.length;
    };
  });
}

function updateQuizBatchCount() {
  const el = document.getElementById('quiz-batch-selected-count');
  if (el) el.textContent = _quizBatchSelected.size > 0 ? `已选 ${_quizBatchSelected.size} 题` : '';
}
function setupBatchCheckboxes() {
  // Select all checkbox
  const selectAll = document.getElementById('batch-select-all-mistakes');
  if (selectAll) {
    selectAll.onchange = (e) => {
      document.querySelectorAll('.batch-mistake-cb').forEach(cb => {
        cb.checked = e.target.checked;
        const id = parseInt(cb.dataset.id);
        if (e.target.checked) _mistakeBatchSelected.add(id);
        else _mistakeBatchSelected.delete(id);
      });
      updateBatchCount();
    };
  }
  // Individual checkboxes
  document.querySelectorAll('.batch-mistake-cb').forEach(cb => {
    cb.onclick = (e) => {
      e.stopPropagation();
      const id = parseInt(cb.dataset.id);
      if (cb.checked) _mistakeBatchSelected.add(id);
      else _mistakeBatchSelected.delete(id);
      updateBatchCount();
      // Toggle card highlight
      const card = cb.closest('.mistake-card');
      if (card) card.classList.toggle('batch-selected', cb.checked);
      // Update select-all state
      const allCbs = document.querySelectorAll('.batch-mistake-cb');
      const allChecked = document.querySelectorAll('.batch-mistake-cb:checked');
      if (selectAll) selectAll.checked = allCbs.length > 0 && allCbs.length === allChecked.length;
    };
  });
}

function updateBatchCount() {
  const el = document.getElementById('batch-selected-count');
  if (el) el.textContent = _mistakeBatchSelected.size > 0 ? `已选 ${_mistakeBatchSelected.size} 题` : '';
}

async function handleBatchDeleteMistakes() {
  if (_mistakeBatchSelected.size === 0) {
    showToast('请先选择要删除的错题');
    return;
  }
  showConfirmModal('删除确认', `确定删除选中的 ${_mistakeBatchSelected.size} 道错题？删除后可在回收站恢复。`, async () => {
    try {
      const ids = Array.from(_mistakeBatchSelected);
      const result = await API.post('/api/mistakes/batch-delete', { ids: ids });
      showToast(`已删除 ${result.deleted || ids.length} 道错题`);
      _mistakeBatchSelected.clear();
      const bar = document.getElementById('batch-manage-bar');
      if (bar) bar.style.display = 'none';
      const btn = document.getElementById('batch-manage-btn');
      if (btn) {
        btn.textContent = '批量选择';
        btn.style.background = '';
        btn.style.color = '';
      }
      _mistakeBatchMode = false;
      document.querySelectorAll('.batch-cb-wrap').forEach(el => el.remove());
      loadMistakes();
    } catch(e) {
      showToast('批量删除失败: ' + e.message);
    }
  });
}


async function handleBatchDeleteQuizzes() {
  if (_quizBatchSelected.size === 0) {
    showToast('请先勾选要删除的 quiz');
    return;
  }
  showConfirmModal('删除确认', `确定要删除选中的 ${_quizBatchSelected.size} 个 quiz 吗？`, async () => {
    try {
      await API.post('/api/quizzes/batch-delete', { ids: Array.from(_quizBatchSelected) });
      showToast(`已删除 ${_quizBatchSelected.size} 个 quiz`);
      _quizBatchMode = false;
      _quizBatchSelected.clear();
      const bar = document.getElementById('quiz-batch-bar');
      if (bar) bar.style.display = 'none';
      const btn = document.getElementById('quiz-batch-manage-btn');
      if (btn) { btn.textContent = '批量选择'; btn.style.background = ''; btn.style.color = ''; }
      const container = document.getElementById('quizzes-container');
      if (container) container.classList.remove('batch-mode');
      await loadQuizzes();
    } catch (e) {
      showToast('批量删除失败: ' + e.message);
    }
  });
}

async function handleBatchFavMistakes() {
  if (_mistakeBatchSelected.size === 0) {
    showToast('请先选择要收藏的错题');
    return;
  }
  const bookmarks = _getMistakeBookmarksForSubject(_mistakeNavSelectedSubjectId);
  if (bookmarks.length === 0) {
    showToast('请先在📁中创建收藏夹');
    return;
  }
  // Use unified bookmark star picker with batch IDs
  _showBookmarkStarPicker('mistake', Array.from(_mistakeBatchSelected));
}

async function handleBatchFavQuizzes() {
  if (_quizBatchSelected.size === 0) {
    showToast('请先选择要收藏的 quiz');
    return;
  }
  const bookmarks = _getQuizBookmarksForSubject(_quizNavSelectedSubjectId);
  if (bookmarks.length === 0) {
    showToast('请先在📁中创建收藏夹');
    return;
  }
  // Use unified bookmark star picker with batch IDs
  _showBookmarkStarPicker('quiz', Array.from(_quizBatchSelected));
}

async function loadMistakes(filter = 'pending', sortBy = 'error_count', append = false) {
  _mistakesLoading = true;
  // Track current filter/sort for load-more
  if (!append) {
    _mistakePage = 1;
    _mistakeAllLoaded = false;
    _mistakeCurrentFilter = filter;
    _mistakeCurrentSort = sortBy;
  }
  try {
    let url = `/api/mistakes?sort_by=${sortBy}&page=${_mistakePage}&page_size=30`;

    // Map filter to API filter_mode
    if (filter === 'pending') {
      url += '&filter_mode=pending';
    } else if (filter === 'today_mastered') {
      url += '&filter_mode=today_mastered';
    } else if (filter === 'mastered') {
      url += '&filter_mode=mastered';
    }
    // 'all' shows everything (no filter_mode)

    // Add tag filter
    if (_mistakeSelectedTag) {
      url += `&tag=${encodeURIComponent(_mistakeSelectedTag)}`;
    }

    // Add subject/chapter filter
    const subjectSelect = document.getElementById('mistake-subject-select');
    const chapterSelect = document.getElementById('mistake-chapter-select');
    if (subjectSelect && subjectSelect.value) {
      url += `&subject_id=${subjectSelect.value}`;
    }
    if (chapterSelect && chapterSelect.value) {
      url += `&chapter_id=${chapterSelect.value}`;
    }

    // Check frontend cache for non-append requests
    let data;
    if (!append) {
      const cacheKey = url;
      const cached = _mistakesPageCache[cacheKey];
      if (cached && Date.now() - cached.timestamp < _MISTAKES_PAGE_CACHE_TTL) {
        data = cached.data;
      }
    }
    if (!data) {
      data = await API.get(url);
      // Cache first page results
      if (!append) {
        _mistakesPageCache[url] = { data, timestamp: Date.now() };
        // Evict old entries if cache grows too large
        const keys = Object.keys(_mistakesPageCache);
        if (keys.length > 50) {
          const now = Date.now();
          keys.forEach(k => {
            if (now - _mistakesPageCache[k].timestamp > _MISTAKES_PAGE_CACHE_TTL) {
              delete _mistakesPageCache[k];
            }
          });
        }
      }
    }
    // Apply bookmark filter client-side
    if (_mistakeBookmarkSelectedId) {
      data.mistakes = _filterMistakesByBookmark(data.mistakes);
      data.total = data.mistakes.length;
    }
    _mistakeTotal = data.total || 0;
    const container = document.getElementById('mistakes-container');
    if (!container) return;

    if (!append) {
      container.innerHTML = '';
    }

    // Remove existing load-more element if present
    const existingLoadMore = document.getElementById('mistake-load-more');
    if (existingLoadMore) existingLoadMore.remove();

    if (data.mistakes.length === 0 && !append) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <div class="empty-title">No mistakes found</div>
          <div class="empty-desc">${filter === 'pending' ? '今天没有待复习的题目' : filter === 'today_mastered' ? '今天还没有已掌握的题目' : filter === 'mastered' ? '还没有已掌握的题目' : '暂无错题'}</div>
        </div>
      `;
    } else if (data.mistakes.length > 0) {
      const cardsHTML = data.mistakes.map(m => {
        const versionCount = m.version_count || 0;
        const qText = m.question.length > 60 ? m.question.substring(0, 60) + '...' : m.question;
        const isMastered = m.review_status === 'mastered';
        let opts = [];
        try {
          const rawOpts = typeof m.options === 'string' ? JSON.parse(m.options) : m.options;
          if (Array.isArray(rawOpts) && rawOpts.length > 0 && rawOpts.some(o => o && String(o).trim())) {
            opts = rawOpts;
          }
        } catch(e) { opts = []; }
        const isChoice = opts.length > 0;
        const consecutiveCorrect = m.review_level || 0;
        const progressHTML = (!isMastered && consecutiveCorrect > 0) ? `<span style="font-size:0.75rem;color:#4caf50;margin-left:6px;">🔥连续正确 ${consecutiveCorrect}/3</span>` : '';
        return `
        <div class="mistake-card ${m.review_status}" data-mistake-id="${m.id}" style="${isMastered ? 'border-left:3px solid #5a9a6a;opacity:0.85;' : ''}">
          <div class="batch-cb-wrap"><input type="checkbox" class="batch-mistake-cb" data-id="${m.id}" ${_mistakeBatchSelected.has(m.id)?'checked':''} /></div>
          <div class="mistake-header">
            <div class="mistake-question">${isMastered ? '<span style="color:#5a9a6a;font-size:0.8rem;margin-right:4px;">✅</span>' : ''}${renderSubSup(qText)}${progressHTML}</div>
            <span class="badge badge-${m.review_status}">${m.review_status === 'pending' ? '待复习' : m.review_status === 'reviewing' ? '复习中' : '已掌握'}</span>
          </div>
          <div class="mistake-meta">
            <span class="badge badge-subject">${escapeHtml(m.subject_name)}</span>
            <span class="mistake-chapter">U${m.unit_number}: ${escapeHtml(m.chapter_title)}</span>
            <span class="error-count">🔄 ${m.error_count}次错误${versionCount > 0 ? ` · 重做过${versionCount}次` : ''}</span>
          </div>
          <div class="mistake-actions">
            <button class="btn btn-primary btn-sm" data-action="redo-mistake" data-id="${m.id}">重做</button>
            <button class="btn btn-sm btn-outline" data-action="view-detail" data-id="${m.id}">详情</button>
            <button class="bookmark-star-btn${_getMistakeBookmarkIdsForMistake(m.id).length > 0 ? ' bookmarked' : ''}" onclick="event.stopPropagation();_showBookmarkStarPicker('mistake',${m.id})" title="收藏到收藏夹" style="font-size:1.1rem;padding:2px 6px;cursor:pointer;border:none;background:none;color:${_getMistakeBookmarkIdsForMistake(m.id).length > 0 ? '#f59e0b' : '#bbb'};">${_getMistakeBookmarkIdsForMistake(m.id).length > 0 ? '⭐' : '☆'}</button>
            ${isMastered ? `<button class="btn btn-outline btn-sm" data-action="unmark-mastered" data-id="${m.id}" style="border-color:#5a9a6a;color:#5a9a6a;">↩️ 撤回已掌握</button>` : ''}
            <div style="flex:1"></div>
            <button class="btn btn-danger btn-sm" onclick="handleDeleteMistake(${m.id})">删除</button>
          </div>
        </div>
      `}).join('');
      container.insertAdjacentHTML('beforeend', cardsHTML);

      // Add load-more indicator
      const loadMoreEl = document.createElement('div');
      loadMoreEl.id = 'mistake-load-more';
      container.appendChild(loadMoreEl);

      const loaded = container.querySelectorAll('.mistake-card').length;
      if (loaded >= _mistakeTotal || _mistakeTotal === 0) {
        _mistakeAllLoaded = true;
        if (_mistakeTotal > 30) {
          loadMoreEl.className = 'load-more-count';
          loadMoreEl.textContent = `全部 ${_mistakeTotal} 条已加载`;
        }
      } else {
        _mistakeAllLoaded = false;
        loadMoreEl.className = 'load-more-btn';
        loadMoreEl.textContent = `已加载 ${loaded}/${_mistakeTotal} 条，点击加载更多`;
        loadMoreEl.onclick = () => {
          if (_mistakesLoading) return;
          _mistakePage++;
          loadMistakes(_mistakeCurrentFilter, _mistakeCurrentSort, true);
        };
        // IntersectionObserver for auto-load on scroll
        if (!window._mistakeScrollObserver) {
          window._mistakeScrollObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !_mistakeAllLoaded && !_mistakesLoading) {
              _mistakePage++;
              loadMistakes(_mistakeCurrentFilter, _mistakeCurrentSort, true);
            }
          }, { threshold: 0.5, rootMargin: '200px' });
        }
        window._mistakeScrollObserver.observe(loadMoreEl);
      }
    }

    // If in batch mode, re-setup checkbox listeners after re-render
    console.log('[batch] loadMistakes rendered, _mistakeBatchMode=' + _mistakeBatchMode + ', container children=' + container.querySelectorAll('.mistake-card').length);
    if (_mistakeBatchMode) {
      setupBatchCheckboxes();
      const mContainer = document.getElementById('mistakes-container');
      if (mContainer) mContainer.classList.add('batch-mode');
    }
    _mistakesLoading = false;
  } catch (err) {
    _mistakesLoading = false;
    console.error('Failed to load mistakes:', err);
    const errContainer = document.getElementById('mistakes-container');
    if (errContainer) {
      errContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-title">加载失败</div>
          <div class="empty-desc">网络可能不稳定，请重试</div>
          <button class="btn btn-primary btn-sm" onclick="loadMistakes()" style="margin-top:12px;">点击重试</button>
        </div>
      `;
    }
  }
}

async function loadQuizzes(sortBy, append = false) {
  try {
    // Determine sort from UI if not provided
    if (!sortBy) {
      const sortChip = document.querySelector('#quiz-sort .sort-chip.active');
      sortBy = sortChip ? sortChip.dataset.sort : 'created_at';
    }
    if (!append) {
      _quizPage = 1;
      _quizAllLoaded = false;
    }
    let url = `/api/quizzes?sort_by=${sortBy}&page=${_quizPage}&page_size=20`;
    const searchInput = document.getElementById('quiz-search-input');
    const searchQuery = searchInput ? searchInput.value.trim() : '';
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
    // Use nav state for subject filtering (no chapter filter for quizzes)
    if (_quizNavSelectedSubjectId) url += `&subject_id=${_quizNavSelectedSubjectId}`;
    const data = await API.get(url);
    // Apply bookmark filter client-side
    if (_quizBookmarkSelectedId) {
      data.quizzes = _filterQuizzesByBookmark(data.quizzes);
      data.total = data.quizzes.length;
    }
    _quizTotal = data.total || 0;
    const container = document.getElementById('quizzes-container');
    if (!container) return;

    if (!append) {
      container.innerHTML = '';
    }

    // Remove existing load-more element if present
    const existingLoadMore = document.getElementById('quiz-load-more');
    if (existingLoadMore) existingLoadMore.remove();

    if (data.quizzes.length === 0 && !append) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🧪</div>
          <div class="empty-title">No quizzes found</div>
          <div class="empty-desc">${searchQuery ? '没有找到匹配的 quiz' : 'Create your first quiz to start practicing'}</div>
          ${!searchQuery ? '<button class="btn btn-primary" data-action="add-quiz">Create Quiz</button>' : ''}
        </div>
      `;
      container.querySelectorAll('[data-action]').forEach(el => {
        el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handleAction(el.dataset.action, el.dataset); };
      });
    } else if (data.quizzes.length > 0) {
      const cardsHTML = data.quizzes.map((q, i) => renderQuizCard(q, i, data.quizzes.length)).join('');
      container.insertAdjacentHTML('beforeend', cardsHTML);

      // Add load-more indicator
      const loadMoreEl = document.createElement('div');
      loadMoreEl.id = 'quiz-load-more';
      container.appendChild(loadMoreEl);

      const loaded = container.querySelectorAll('.card.quiz-card-batch').length;
      if (loaded >= _quizTotal || _quizTotal === 0) {
        _quizAllLoaded = true;
        if (_quizTotal > 20) {
          loadMoreEl.className = 'load-more-count';
          loadMoreEl.textContent = `全部 ${_quizTotal} 条已加载`;
        }
      } else {
        _quizAllLoaded = false;
        loadMoreEl.className = 'load-more-btn';
        loadMoreEl.textContent = `已加载 ${loaded}/${_quizTotal} 条，点击加载更多`;
        loadMoreEl.onclick = () => {
          _quizPage++;
          loadQuizzes(sortBy, true);
        };
        // IntersectionObserver for auto-load on scroll
        if (!window._quizScrollObserver) {
          window._quizScrollObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !_quizAllLoaded) {
              _quizPage++;
              loadQuizzes(sortBy, true);
            }
          }, { threshold: 0.5, rootMargin: '200px' });
        }
        window._quizScrollObserver.observe(loadMoreEl);
      }
    }
  } catch (err) {
    console.error('Failed to load quizzes:', err);
  }
  // Re-setup quiz batch checkboxes if in batch mode
  if (_quizBatchMode) {
    const container = document.getElementById('quizzes-container');
    if (container) container.classList.add('batch-mode');
    setupQuizBatchCheckboxes();
  }
}

function renderQuizCard(q, index, total) {
  return `
    <div class="card quiz-card-batch" data-quiz-id="${q.id}" style="animation-delay:${index * 0.05}s">
      <div class="quiz-batch-cb-wrap"><input type="checkbox" class="quiz-batch-cb" data-id="${q.id}" ${_quizBatchSelected.has(q.id)?'checked':''} /></div>
      <div style="cursor:pointer;" onclick="if(_quizBatchMode)return;handleAction('take-quiz',{id:'${q.id}'})">
        <div class="card-title">${escapeHtml(q.title || 'Untitled Quiz')}</div>
        <div class="card-subtitle">
          <span class="badge badge-subject">${escapeHtml(q.subject_name)}</span>
          <span style="color:var(--text-tertiary);font-size:0.8rem;margin-left:6px;">U${q.unit_number}: ${escapeHtml(q.chapter_title)}</span>
          ${(q.tags || []).length ? q.tags.map(t => '<span class="badge" style="background:#f0f0f0;color:#666;font-size:0.7rem;padding:1px 6px;border-radius:4px;margin-left:4px;">' + escapeHtml(t) + '</span>').join('') : ''}
        </div>
        <div style="font-size:0.8rem;color:var(--text-tertiary);margin-top:6px;">
          ${q.question_count} question${q.question_count !== 1 ? 's' : ''} · ${formatDate(q.created_at)}
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid #f0f0f0;flex-wrap:wrap;align-items:center;">
        <button class="btn btn-primary btn-sm" data-action="take-quiz" data-id="${q.id}">▶ Start</button>
        <button class="btn btn-secondary btn-sm" data-action="edit-quiz" data-id="${q.id}">✏️ Edit</button>
        <button class="btn btn-sm" style="background:#e8f5e9;color:#2e7d32;border:1px solid #c8e6c9;padding:4px 10px;font-size:0.85rem;" onclick="event.stopPropagation();printQuizContent(${q.id})" title="打印练习">🖨️ 打印</button>
        <button class="bookmark-star-btn${_getQuizBookmarkIdsForQuiz(q.id).length > 0 ? ' bookmarked' : ''}" onclick="event.stopPropagation();_showBookmarkStarPicker('quiz',${q.id})" title="收藏到收藏夹" style="font-size:1.1rem;padding:2px 6px;cursor:pointer;border:none;background:none;color:${_getQuizBookmarkIdsForQuiz(q.id).length > 0 ? '#f59e0b' : '#bbb'};">${_getQuizBookmarkIdsForQuiz(q.id).length > 0 ? '⭐' : '☆'}</button>
        <button class="btn btn-danger btn-sm" style="margin-left:auto;" onclick="event.stopPropagation();handleDeleteQuiz(${q.id})">Delete</button>
      </div>
    </div>
  `;
}

async function loadQuizzesByCategory(categoryId, sortBy) {
  try {
    let url = `/api/quizzes?sort_by=${sortBy}&category_id=${categoryId}`;
    const searchInput = document.getElementById('quiz-search-input');
    const searchQuery = searchInput ? searchInput.value.trim() : '';
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
    const data = await API.get(url);
    renderQuizList(data.quizzes, '分类筛选');
  } catch (err) {
    console.error('Failed to load quizzes by category:', err);
  }
}

async function loadQuizzesUncategorized(sortBy) {
  try {
    let url = `/api/quizzes?sort_by=${sortBy}&uncategorized=1`;
    const searchInput = document.getElementById('quiz-search-input');
    const searchQuery = searchInput ? searchInput.value.trim() : '';
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
    const data = await API.get(url);
    renderQuizList(data.quizzes, '未分类');
  } catch (err) {
    console.error('Failed to load uncategorized quizzes:', err);
  }
}

function renderQuizList(quizzes, label) {
  const container = document.getElementById('quizzes-container');
  if (!container) return;
  if (quizzes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🧪</div>
        <div class="empty-title">No quizzes found</div>
        <div class="empty-desc">${label === '未分类' ? '没有未分类的 quiz' : '该分类下没有 quiz'}</div>
      </div>
    `;
  } else {
    container.innerHTML = quizzes.map((q, i) => renderQuizCard(q, i, quizzes.length)).join('');
  }
  container.querySelectorAll('[data-action]').forEach(el => {
    el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handleAction(el.dataset.action, el.dataset); };
  });
}

async function loadChapterMistakes() {
  if (!state.currentChapter) return;
  try {
    const data = await API.get(`/api/mistakes?chapter_id=${state.currentChapter.id}&sort_by=updated_at`);
    const container = document.getElementById('chapter-mistakes-container');
    if (!container) return;

    if (data.mistakes.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px;">
          <div class="empty-icon">📝</div>
          <div class="empty-title">No mistakes for this chapter</div>
          <div class="empty-desc">Add one to start tracking</div>
          <button class="btn btn-primary btn-sm" id="empty-add-mistake" style="margin-top:12px;">+ Add Mistake</button>
        </div>
      `;
      const emptyBtn = document.getElementById('empty-add-mistake');
      if (emptyBtn) {
        emptyBtn.onclick = () => {
          navigate('add-mistake');
          setTimeout(() => handleAddMistakePreSelect(), 100);
        };
      }
    } else {
      container.innerHTML = data.mistakes.map(m => `
        <div class="card" style="margin-bottom:8px;">
          <div style="font-size:0.9rem;margin-bottom:6px;">${escapeHtml(m.question)}</div>
          <div style="display:flex;gap:12px;font-size:0.8rem;color:var(--text-tertiary);">
            <span>错误答案：${escapeHtml(m.wrong_answer || '')}</span>
            <span>正确答案：${escapeHtml(m.correct_answer)}</span>
          </div>
          <div style="font-size:0.75rem;color:var(--text-tertiary);margin-top:4px;">
            错误次数：${m.error_count || 1} · ${formatDate(m.created_at)}
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load chapter mistakes:', err);
  }
}

async function loadChapterQuizzes() {
  if (!state.currentChapter) return;
  try {
    const data = await API.get(`/api/quizzes?chapter_id=${state.currentChapter.id}`);
    const container = document.getElementById('chapter-quizzes-container');
    if (!container) return;

    if (data.quizzes.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px;">
          <div class="empty-icon">🧪</div>
          <div class="empty-title">No quizzes for this chapter</div>
          <div class="empty-desc">Create one to start practicing</div>
          <button class="btn btn-primary btn-sm" id="empty-create-quiz" style="margin-top:12px;">+ Create Quiz</button>
        </div>
      `;
      const emptyBtn = document.getElementById('empty-create-quiz');
      if (emptyBtn) {
        emptyBtn.onclick = () => {
          navigate('add-quiz');
          setTimeout(() => handleAddQuizPreSelect(), 100);
        };
      }
    } else {
      container.innerHTML = data.quizzes.map(q => `
        <div class="card" style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="flex:1;">
              <div class="card-title" style="font-size:0.95rem;">${escapeHtml(q.title || 'Untitled Quiz')}</div>
              <div style="font-size:0.8rem;color:var(--text-tertiary);">${q.question_count} questions · ${formatDate(q.created_at)}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
              <button class="btn btn-primary btn-sm" data-action="take-quiz" data-id="${q.id}">Start</button>
              <button class="btn btn-secondary btn-sm" data-action="edit-quiz" data-id="${q.id}">Edit</button>
              <button class="btn btn-sm" style="background:#e8f5e9;color:#2e7d32;" onclick="printQuizContent(${q.id})">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="handleDeleteQuiz(${q.id})">Delete</button>
            </div>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load chapter quizzes:', err);
  }
}

// --- Handlers ---
async function handleSaveMistake() {
  const chapterId = document.getElementById('mistake-chapter').value;
  const question = document.getElementById('mistake-question').value.trim();
  const correct = document.getElementById('mistake-correct').value.trim();
  const wrong = document.getElementById('mistake-wrong').value.trim();
  const tags = getTagsFromChips('mistake-tag-chips').join(',');

  if (!chapterId || !question || !correct) {
    showToast('Please fill in all required fields');
    return;
  }

  if (wrong && correct.toLowerCase() === wrong.toLowerCase()) {
    showToast('正确答案和错误答案不能一样哦');
    return;
  }

  try {
    await API.post('/api/mistakes', {
      chapter_id: parseInt(chapterId),
      question, correct_answer: correct, wrong_answer: wrong,
      tags,
    });
    showToast('Mistake saved! 📝');
    await navigate('mistakes');
  } catch (err) {
    showToast(err.message);
  }
}

function syncQuizQuestions() {
  quizQuestions.forEach((q, i) => {
    const textEl = document.querySelector(`[data-q-text="${i}"]`);
    if (textEl) q.text = textEl.value;
    if (q.type === 'fill') {
      const ansEl = document.querySelector(`[data-q-answer="${i}"]`);
      if (ansEl) q.correct = ansEl.value;
    } else {
      q.options = q.options.map((_, oi) => {
        const optEl = document.querySelector(`[data-q-opt="${i}-${oi}"]`);
        return optEl ? optEl.value : '';
      });
      const correctEl = document.querySelector(`[data-q-correct="${i}"]`);
      if (correctEl) q.correct = correctEl.value;
    }
  });
}

async function handleSaveQuiz() {
  // Sync both modes
  syncQuizQuestions();
  if (batchMode === 'batch') syncBatchQuestions();

  const title = document.getElementById('quiz-title').value.trim();
  const chapterEl = document.getElementById('quiz-chapter');
  let chapterId = chapterEl ? chapterEl.value : '';

  // Handle "mixed" chapter selection
  let isMixed = false;
  let chapterIds = [];
  if (chapterId === 'mixed') {
    isMixed = true;
    // Get all chapters for the current subject
    const subjectId = document.getElementById('quiz-subject')?.value;
    if (subjectId) {
      try {
        const data = await API.get(`/api/subjects/${subjectId}/chapters`);
        chapterIds = data.chapters.map(c => c.id);
        if (chapterIds.length > 0) {
          chapterId = chapterIds[0]; // Use first as primary for DB
        }
      } catch (e) {
        showToast('Failed to load chapters');
        return;
      }
    }
  }

  // Check mixed mode checkbox (legacy)
  const mixedCheck = document.getElementById('mixed-mode-check');
  if (mixedCheck && mixedCheck.checked) {
    document.querySelectorAll('.mixed-ch-cb:checked').forEach(cb => {
      if (!chapterIds.includes(parseInt(cb.value))) {
        chapterIds.push(parseInt(cb.value));
      }
    });
    if (chapterIds.length > 0 && !chapterId) {
      chapterId = chapterIds[0]; // Use first as primary
    }
  }

  if (!chapterId && chapterIds.length === 0 && !isMixed) {
    showToast('Please select a subject and chapter');
    return;
  }

  // Determine which question set to use
  let finalQuestions;
  if (batchMode === 'batch' && batchParsedQuestions.length > 0) {
    finalQuestions = batchParsedQuestions;
  } else if (batchMode === 'manual' && quizQuestions.length > 0) {
    finalQuestions = quizQuestions;
  } else if (quizQuestions.length > 0) {
    finalQuestions = quizQuestions;
  } else if (batchParsedQuestions.length > 0) {
    finalQuestions = batchParsedQuestions;
  } else {
    showToast('Please add at least one question');
    return;
  }

  // Validate questions
  for (let i = 0; i < finalQuestions.length; i++) {
    const q = finalQuestions[i];
    if (!q.text.trim()) {
      showToast(`Question ${i + 1} is empty`);
      return;
    }
    if (!q.correct || !q.correct.toString().trim()) {
      showToast(`Question ${i + 1} needs a correct answer`);
      return;
    }
    if (q.type === 'choice' && q.options.some(o => !o.trim())) {
      showToast(`Question ${i + 1} has empty options`);
      return;
    }
  }

  const questions = finalQuestions.map(q => ({
    question_text: q.text,
    question_type: q.type,
    options: q.type === 'choice' ? q.options : [],
    correct_answer: q.correct,
  }));

  try {
    const quizPayload = {
      title: title || 'Untitled Quiz',
      chapter_id: parseInt(chapterId),
      questions,
    };
    if (chapterIds.length > 0) {
      quizPayload.chapter_ids = chapterIds;
      quizPayload.title = quizPayload.title || 'Mixed Quiz';
    }
    await API.post('/api/quizzes', quizPayload);
    quizQuestions = [];
    batchParsedQuestions = [];
    showToast('Quiz created! 🧪');
    await navigate('quizzes');
  } catch (err) {
    showToast(err.message);
  }
}

async function loadQuizForTaking(quizId) {
  try {
    const data = await API.get(`/api/quizzes/${quizId}`);
    state.currentQuiz = data;
    state.quizAnswers = {};
    state.quizSubmitted = false;
    navigate('take-quiz');
  } catch (err) {
    showToast('Failed to load quiz');
  }
}

async function handleSubmitQuiz() {
  const quiz = state.currentQuiz;
  if (!quiz) return;

  const questions = quiz.questions || [];
  const answers = [];
  for (const q of questions) {
    const ans = state.quizAnswers[q.id] || '';
    answers.push({ question_id: q.id, user_answer: ans });
  }

  const unanswered = answers.filter(a => !a.user_answer.trim()).length;
  if (unanswered > 0) {
    if (!confirm(`You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Submit anyway?`)) return;
  }

  try {
    const result = await API.post(`/api/quizzes/${quiz.id}/submit`, { answers });
    state.quizResult = result;
    state.quizSubmitted = true;
    navigate('quiz-result');
  } catch (err) {
    showToast(err.message);
  }
}

async function handleDeleteQuiz(quizId) {
  showConfirmModal('删除确认', '确定要删除这条 quiz 吗？', async () => {
    try {
      await API.del(`/api/quizzes/${quizId}`);
      showToast('Quiz deleted ✅');
      await navigate(state.currentPage);
    } catch (err) {
      showToast('Delete failed: ' + err.message);
    }
  });
}

async function handleToggleFavorite(quizId) {
  try {
    const data = await API.post(`/api/quizzes/${quizId}/favorite`, {});
    showToast(data.is_favorite ? '已收藏 ⭐' : '已取消收藏');
    // Reload quiz list with current sort
    const sortChip = document.querySelector('#quiz-sort .sort-chip.active');
    const sortBy = sortChip ? sortChip.dataset.sort : 'created_at';
    await loadQuizzes(sortBy);
  } catch (err) {
    showToast('操作失败: ' + err.message);
  }
}

async function handleMarkMastered(mistakeId) {
  try {
    const result = await API.put(`/api/mistakes/${mistakeId}`, { review_status: 'mastered' });
    showToast('已标记为掌握 ✅');
    // Update today's mastered count from API response (authoritative)
    if (result && result.today_reviewed !== undefined) {
      state.reviewTodayMastered = result.today_reviewed;
    } else {
      state.reviewTodayMastered = (state.reviewTodayMastered || 0) + 1;
    }
    // Remove the mastered card from DOM and update badge without full reload
    const card = document.querySelector(`[data-mistake-id="${mistakeId}"]`);
    if (card) {
      card.style.transition = 'opacity 0.3s, transform 0.3s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      setTimeout(() => card.remove(), 300);
    }
    // Refresh stats silently
    await loadStats();
  } catch (err) {
    showToast(err.message);
  }
}

async function handleUnmarkMastered(mistakeId) {
  try {
    const result = await API.put(`/api/mistakes/${mistakeId}`, { review_status: 'pending' });
    showToast('已撤回，明天重新出现 🔄');
    // Update today's mastered count from API response (authoritative)
    if (result && result.today_reviewed !== undefined) {
      state.reviewTodayMastered = result.today_reviewed;
    } else {
      state.reviewTodayMastered = Math.max(0, (state.reviewTodayMastered || 0) - 1);
    }
    await navigate(state.currentPage);
  } catch (err) {
    showToast(err.message);
  }
}

async function handleMarkReviewing(mistakeId) {
  try {
    await API.put(`/api/mistakes/${mistakeId}`, { review_status: 'reviewing' });
    showToast('Marked as reviewing 📖');
    await navigate(state.currentPage);
  } catch (err) {
    showToast(err.message);
  }
}

async function handleDeleteMistake(mistakeId) {
  showConfirmModal('删除确认', '确定要删除这条错题吗？', async () => {
    try {
      await API.del(`/api/mistakes/${mistakeId}`);
      // 直接从 DOM 移除卡片，避免整页重渲染闪烁
      const card = document.querySelector(`.mistake-card[data-mistake-id="${mistakeId}"]`);
      if (card) {
        card.style.transition = 'opacity 0.3s, transform 0.3s, margin 0.3s, max-height 0.3s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        card.style.maxHeight = '0';
        card.style.margin = '0';
        card.style.overflow = 'hidden';
        setTimeout(() => {
          card.remove();
          // 如果列表空了，显示空状态
          const container = document.getElementById('mistakes-container');
          if (container && !container.querySelector('.mistake-card')) {
            container.innerHTML = `
              <div class="empty-state">
                <div class="empty-icon">📝</div>
                <div class="empty-title">No mistakes found</div>
                <div class="empty-desc">暂无错题</div>
              </div>
            `;
          }
        }, 300);
      }
      showToast('Mistake deleted ✅');
    } catch (err) {
      showToast('Delete failed: ' + err.message);
    }
  });
}

async function handleRedoMistake(mistakeId) {
  try {
    // Fetch only the specific mistake detail instead of loading ALL mistakes
    const mistake = await API.get(`/api/mistakes/${mistakeId}`);
    if (!mistake) { showToast('找不到该错题'); return; }

    const versions = JSON.parse(mistake.solution_versions || '[]');

    // Detect choice question: try parsing options regardless of question_type
    // (some mistakes may have question_type='fill' but still have valid options)
    let redoOpts = [];
    try {
      const rawOpts = typeof mistake.options === 'string' ? JSON.parse(mistake.options) : mistake.options;
      if (Array.isArray(rawOpts) && rawOpts.length > 0 && rawOpts.some(o => o && String(o).trim())) {
        redoOpts = rawOpts;
      }
    } catch(e) { redoOpts = []; }
    const isChoiceMistake = redoOpts.length > 0;

    // 符号栏（精简版，适合答案输入）
    const redoSymbols = QUICK_SYMBOLS;

    // Choice question: show option buttons; Fill question: show input + symbol bar
    const choiceDoingHTML = redoOpts.length > 0 ? `
      <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:6px;">🔲 选择答案：</label>
      <div class="option-list" id="redo-choice-options">
        ${redoOpts.map((o, i) => {
          const letter = String.fromCharCode(65 + i);
          return `<div class="option-item" data-redo-option="${letter}" style="cursor:pointer;padding:10px 12px;margin-bottom:6px;border:1px solid #ddd;border-radius:8px;display:flex;align-items:center;gap:8px;transition:all 0.15s;">
            <span class="option-letter" style="font-weight:600;min-width:24px;">${letter}</span>
            <span style="flex:1;">${renderSubSup(o)}</span>
          </div>`;
        }).join('')}
      </div>
    ` : '';

    const fillDoingHTML = `
      <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:6px;">✏️ 你的答案：</label>
      <input type="text" id="redo-answer-input" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;font-size:1rem;" placeholder="输入你的答案...">
      <div id="redo-sym-bar" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
        <button type="button" id="redo-frac-btn" class="sym-btn special-btn frac-btn" style="min-width:48px;height:32px;">a/b</button>
        <button type="button" class="sym-btn special-btn supsub-btn" style="min-width:40px;height:32px;">xⁿ</button>
        <button type="button" class="sym-btn special-btn nroot-btn" style="min-width:40px;height:32px;">ⁿ√</button>
        ${redoSymbols.map(s => `<button type="button" class="sym-btn" data-sym="${s}" style="min-width:32px;height:32px;border:1px solid #ddd;border-radius:6px;background:#f8f9fa;font-size:0.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">${s}</button>`).join('')}
        <button type="button" class="sym-btn special-btn more-sym-btn" style="min-width:40px;height:32px;">⊞</button>
      </div>
    `;

    // Format answer display for choice questions
    function formatRedoAnswer(ans) {
      if (isChoiceMistake && redoOpts.length > 0 && ans && ans.length === 1) {
        const idx = ans.charCodeAt(0) - 65;
        if (idx >= 0 && idx < redoOpts.length) return `${ans}. ${redoOpts[idx]}`;
      }
      return ans;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:92vw;width:420px;max-height:85vh;overflow-y:auto;">
        <h3 style="margin-bottom:12px;">重做错题${isChoiceMistake ? ' <span style="font-size:0.8rem;color:#3a5ba0;">🔲 选择题</span>' : ''}</h3>
        <div style="margin-bottom:12px;padding:10px;background:#f8f9fa;border-radius:8px;font-size:0.9rem;word-wrap:break-word;overflow-wrap:break-word;line-height:1.6;">
          <strong>题目：</strong>${renderSubSup(mistake.question)}
        </div>

        <div id="redo-phase-doing">
          <div style="margin-bottom:12px;">
            ${isChoiceMistake ? choiceDoingHTML : fillDoingHTML}
          </div>

          <div style="display:flex;gap:8px;margin-top:16px;">
            <button id="redo-cancel-btn" class="btn btn-secondary" style="flex:1;">取消</button>
            <button id="redo-submit-btn" class="btn btn-primary" style="flex:1;">✅ 提交</button>
          </div>
        </div>

        <div id="redo-phase-review" style="display:none;">
          <div style="margin-bottom:14px;padding:12px;background:#f0f4ff;border-radius:8px;font-size:0.95rem;font-weight:600;text-align:center;color:#3a5ba0;">
            📝 对比一下，你做对了吗？
          </div>
          <div id="redo-review-question"></div>
          <div id="redo-review-options"></div>
          <div style="display:flex;gap:10px;margin-bottom:14px;">
            <div style="flex:1;padding:10px;background:#fff3e0;border-radius:8px;font-size:0.9rem;min-width:0;">
              <div style="font-weight:600;color:#e65100;margin-bottom:4px;font-size:0.8rem;">✏️ 你的答案</div>
              <div id="redo-your-answer-display" style="word-break:break-all;"></div>
            </div>
            <div style="flex:1;padding:10px;background:#e8f5e9;border-radius:8px;font-size:0.9rem;min-width:0;">
              <div style="font-weight:600;color:#2e7d32;margin-bottom:4px;font-size:0.8rem;">✅ 正确答案</div>
              <div style="word-break:break-all;">${renderSubSup(formatRedoAnswer(mistake.correct_answer))}</div>
            </div>
          </div>
          ${mistake.error_reason_type ? `
          <div style="margin-bottom:8px;padding:8px 12px;background:#fef3cd;border-radius:8px;font-size:0.85rem;">
            <div style="font-weight:600;color:#856404;">错因类型</div>
            <div style="margin-top:4px;">${renderErrorReasonTypeBadge(mistake.error_reason_type)}</div>
          </div>` : ''}
          ${mistake.error_reason ? `
          <div style="margin-bottom:8px;padding:8px 12px;background:#fef3cd;border-radius:8px;font-size:0.85rem;">
            <div style="font-weight:600;color:#856404;">错因补充</div>
            <div style="margin-top:4px;color:#664d03;">${escapeHtml(mistake.error_reason)}</div>
          </div>` : ''}
          ${mistake.key_insight ? `
          <div style="margin-bottom:8px;padding:8px 12px;background:#d1ecf1;border-radius:8px;font-size:0.85rem;">
            <div style="font-weight:600;color:#0c5460;">关键思路</div>
            <div style="margin-top:4px;color:#0c5460;">${escapeHtml(mistake.key_insight)}</div>
          </div>` : ''}
          ${versions.length > 0 ? `
          <div style="margin-bottom:12px;">
            <div style="font-weight:600;font-size:0.85rem;color:var(--text-secondary);margin-bottom:6px;">历史做题记录 (${versions.length}次)</div>
            ${versions.slice(-3).map((v, i) => `
              <div style="margin-bottom:6px;padding:8px 10px;background:#f8f9fa;border-radius:6px;font-size:0.82rem;">
                <span style="color:${v.correct ? '#28a745' : '#dc3545'};font-weight:600;">${v.correct ? '✅' : '❌'} #${versions.length - 2 + i}</span>
                <span style="color:var(--text-tertiary);margin-left:6px;">${v.time || ''}</span>
              </div>
            `).join('')}
          </div>` : ''}
          <div style="display:flex;gap:10px;margin-top:16px;">
            <button id="redo-self-correct" class="btn" style="flex:1;padding:12px;font-size:1rem;font-weight:600;border:none;border-radius:10px;background:#4caf50;color:white;cursor:pointer;">✓ 做对了</button>
            <button id="redo-self-wrong" class="btn" style="flex:1;padding:12px;font-size:1rem;font-weight:600;border:none;border-radius:10px;background:#f44336;color:white;cursor:pointer;">✗ 做错了</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Track selected choice answer
    let redoSelectedChoice = '';

    // Choice question: click handlers for option buttons
    if (isChoiceMistake && redoOpts.length > 0) {
      const choiceItems = overlay.querySelectorAll('[data-redo-option]');
      choiceItems.forEach(item => {
        item.addEventListener('click', () => {
          choiceItems.forEach(ci => {
            ci.style.background = '';
            ci.style.borderColor = '#ddd';
            ci.classList.remove('selected');
          });
          item.style.background = '#e3f2fd';
          item.style.borderColor = '#3a5ba0';
          item.classList.add('selected');
          redoSelectedChoice = item.dataset.redoOption;
        });
      });
    }

    // 符号栏点击插入 — 智能识别当前焦点输入框
    let redoActiveInput = overlay.querySelector('#redo-answer-input') || overlay.querySelector('#redo-choice-options');
    // 用事件委托监听所有当前和未来 input 的 focus
    overlay.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'text') {
        redoActiveInput = e.target;
      }
    });
    overlay.querySelectorAll('#redo-sym-bar .sym-btn').forEach(btn => {
      // Skip special buttons — they have their own popup handlers
      if (btn.classList.contains('supsub-btn') || btn.classList.contains('nroot-btn') || btn.classList.contains('frac-btn') || btn.classList.contains('more-sym-btn')) return;
      btn.onclick = (e) => {
        e.preventDefault();
        const input = redoActiveInput || overlay.querySelector('#redo-answer-input');
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const val = input.value;
        input.value = val.substring(0, start) + btn.dataset.sym + val.substring(end);
        input.focus();
        input.selectionStart = input.selectionEnd = start + btn.dataset.sym.length;
        // 触发答案输入框的 input 事件让预览更新
        overlay.querySelector('#redo-answer-input').dispatchEvent(new Event('input', { bubbles: true }));
      };
    });

    // xⁿ and ⁿ√ popup handlers for redo overlay
    const redoSupsubBtn = overlay.querySelector('#redo-sym-bar .supsub-btn');
    const redoNrootBtn = overlay.querySelector('#redo-sym-bar .nroot-btn');
    if (redoSupsubBtn) {
      redoSupsubBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = redoActiveInput || overlay.querySelector('#redo-answer-input');
        _lastFocusedInput = input;
        _openSupSubPopup(redoSupsubBtn);
      };
    }
    if (redoNrootBtn) {
      redoNrootBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = redoActiveInput || overlay.querySelector('#redo-answer-input');
        _lastFocusedInput = input;
        _openNrootPopup(redoNrootBtn);
      };
    }
    // ⊞ category panel handler for redo overlay
    const redoMoreBtn = overlay.querySelector('#redo-sym-bar .more-sym-btn');
    if (redoMoreBtn) {
      redoMoreBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = redoActiveInput || overlay.querySelector('#redo-answer-input');
        _lastFocusedInput = input;
        _openCategoryPanel(redoMoreBtn);
      };
    }

    // 答案输入实时预览（把 LaTeX 渲染成分数等格式）- 仅填空题有输入框
    const answerInput = overlay.querySelector('#redo-answer-input');
    if (answerInput) {
      const answerPreview = document.createElement('div');
      answerPreview.id = 'redo-answer-preview';
      answerPreview.style.cssText = 'min-height:32px;padding:8px 10px;margin-top:4px;background:#f0f7ff;border-radius:8px;font-size:1rem;color:#333;border:1px solid #d0e0f0;';
      answerPreview.textContent = '（预览将显示在这里）';
      answerInput.after(answerPreview);
      answerInput.addEventListener('input', () => {
        const val = answerInput.value.trim();
        answerPreview.innerHTML = val ? renderSubSup(val) : '<span style="color:#aaa;">（预览将显示在这里）</span>';
      });
    }

    // 分数输入按钮 - 直接插入 /
    const fracBtn = overlay.querySelector('#redo-frac-btn');
    if (fracBtn) {
      fracBtn.onclick = (e) => {
        e.preventDefault();
        const start = answerInput.selectionStart || answerInput.value.length;
        const val = answerInput.value;
        answerInput.value = val.substring(0, start) + '/' + val.substring(start);
        answerInput.focus();
        answerInput.selectionStart = answerInput.selectionEnd = start + 1;
        answerInput.dispatchEvent(new Event('input', { bubbles: true }));
      };
    }

    // 取消
    overlay.querySelector('#redo-cancel-btn').onclick = () => overlay.remove();

    // 提交 → 展示对比，由用户自行判断对错
    overlay.querySelector('#redo-submit-btn').onclick = () => {
      const userAnswer = isChoiceMistake ? redoSelectedChoice : (overlay.querySelector('#redo-answer-input') ? overlay.querySelector('#redo-answer-input').value.trim() : '');
      if (!userAnswer) { showToast(isChoiceMistake ? '请先选择答案' : '请先输入答案'); return; }

      // 切换到review阶段
      overlay.querySelector('#redo-phase-doing').style.display = 'none';
      overlay.querySelector('#redo-phase-review').style.display = 'block';

      // 显示题目（填空题加空白指示符）
      const qContainer = overlay.querySelector('#redo-review-question');
      if (qContainer && !isChoiceMistake) {
        qContainer.innerHTML = '<div style="margin-bottom:10px;padding:10px;background:#f8f9fa;border-radius:8px;font-size:0.9rem;">' +
          '<strong>题目：</strong>' + renderSubSup(mistake.question) + ' <span style="display:inline-block;min-width:60px;border-bottom:2px solid #999;margin-left:4px;">&nbsp;</span>' +
          '</div>';
      }

      // 显示选项（选择题时）
      const optsContainer = overlay.querySelector('#redo-review-options');
      if (optsContainer && redoOpts.length > 0) {
        optsContainer.innerHTML = '<div style="margin-bottom:12px;padding:10px;background:#f8f9fa;border-radius:8px;">' +
          redoOpts.map((o, i) => {
            const letter = String.fromCharCode(65 + i);
            const isCorrect = letter === mistake.correct_answer;
            const st = isCorrect ? 'color:#2e7d32;font-weight:600;background:#e8f5e9;' : '';
            return '<div style="padding:6px 10px;margin-bottom:4px;border-radius:6px;font-size:0.88rem;' + st + '"><span style="font-weight:600;margin-right:4px;">' + letter + '.</span> ' + renderSubSup(o) + '</div>';
          }).join('') + '</div>';
      }

      //显示答案用户的答案
      const yourAnswerDisplay = overlay.querySelector('#redo-your-answer-display');
      yourAnswerDisplay.innerHTML = renderSubSup(formatRedoAnswer(userAnswer));



      // 自判按钮
      overlay.querySelector('#redo-self-correct').onclick = async () => {
        const versions = JSON.parse(mistake.solution_versions || '[]');
        versions.push({
          time: new Date().toLocaleString('zh-CN'),
          solution: userAnswer,
          correct: true
        });
        // Count consecutive correct from the end of solution_versions
        let consecutiveCorrect = 0;
        for (let i = versions.length - 1; i >= 0; i--) {
          if (versions[i].correct) consecutiveCorrect++;
          else break;
        }
        const mastered = consecutiveCorrect >= 3;
        await API.put(`/api/mistakes/${mistakeId}`, {
          solution_versions: versions,
          error_count: mistake.error_count + 1,
          review_status: mastered ? 'mastered' : 'pending',
          review_level: consecutiveCorrect
        });
        overlay.remove();
        if (mastered) {
          showToast(`连续做对 ${consecutiveCorrect} 次，已自动标记为掌握 🎉`);
        } else {
          showToast(`做对了！连续正确 ${consecutiveCorrect}/3，再坚持 ${3 - consecutiveCorrect} 次即可掌握 💪`);
        }
        loadMistakes();
      };

      overlay.querySelector('#redo-self-wrong').onclick = async () => {
        const versions = JSON.parse(mistake.solution_versions || '[]');
        versions.push({
          time: new Date().toLocaleString('zh-CN'),
          solution: userAnswer,
          correct: false
        });
        await API.put(`/api/mistakes/${mistakeId}`, {
          solution_versions: versions,
          error_count: mistake.error_count + 1,
          review_status: 'pending',
          review_level: 0
        });
        overlay.remove();
        showToast('做错了没关系，连续正确计数已重置，下次继续加油！🔄');
        loadMistakes();
      };
    };
  } catch (err) {
    showToast('重做失败: ' + err.message);
  }
}

async function handleEditMistake(mistakeId) {
  try {
    const data = await API.get(`/api/mistakes?review_status=pending,reviewing,mastered`);
    const mistake = data.mistakes.find(m => m.id === mistakeId);
    if (!mistake) { showToast('找不到该错题'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:90vw;width:420px;max-height:85vh;overflow-y:auto;">
        <h3 style="margin-bottom:12px;">✏️ 编辑错题</h3>
        <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:0.82rem;color:#856404;">💡 不知道怎么排版？拍照上传题目给豆包，让它帮你整理好格式再粘贴回来就行</div>
        <div class="form-group">
          <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:4px;">题目</label>
          <textarea id="edit-question-text" style="width:100%;min-height:80px;padding:8px;border-radius:8px;border:1px solid #ddd;font-size:0.85rem;resize:vertical;" placeholder="题目内容..." oninput="document.getElementById('edit-q-preview').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>预览区</span>'">${escapeHtml(mistake.question)}</textarea>
          <div id="edit-q-preview" class="edit-preview-box" style="margin-top:6px;">${renderSubSup(mistake.question) || '<span style="color:#bbb">预览区</span>'}</div>
        </div>
        <div class="form-group">
          <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:4px;">正确答案</label>
          <input id="edit-correct-answer" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ddd;font-size:0.85rem;" value="${escapeHtml(mistake.correct_answer)}" placeholder="正确答案" oninput="document.getElementById('edit-ca-preview').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>答案预览</span>'" />
          <div id="edit-ca-preview" class="edit-preview-box" style="margin-top:6px;padding:8px 12px;min-height:28px;">${renderSubSup(mistake.correct_answer) || '<span style="color:#bbb">答案预览</span>'}</div>
        </div>
        <div class="form-group">
          <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:4px;">我的错误答案</label>
          <input id="edit-wrong-answer" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ddd;font-size:0.85rem;" value="${escapeHtml(mistake.wrong_answer || '')}" placeholder="你写的答案" oninput="document.getElementById('edit-wa-preview').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>答案预览</span>'" />
          <div id="edit-wa-preview" class="edit-preview-box" style="margin-top:6px;padding:8px 12px;min-height:28px;background:var(--danger-light,#FDF0EE);color:var(--danger,#E07A6F);">${renderSubSup(mistake.wrong_answer) || '<span style="color:#bbb">答案预览</span>'}</div>
        </div>
        <div class="form-group">
          <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:4px;">错因类型（为什么做错了）：</label>
          ${renderErrorReasonTypeSelect('edit-error-reason-type', mistake.error_reason_type || '')}
          <div style="margin-top:4px;font-size:0.75rem;color:var(--text-tertiary);">🔴知识性(0.7x) 🟠混淆(0.85x) 🟡方法(1.0x) 🟢粗心(1.3x) — 数字为复习间隔权重</div>
        </div>
        <div class="form-group">
          <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:4px;">错因补充说明：</label>
          <textarea id="edit-error-reason" style="width:100%;min-height:40px;padding:8px;border-radius:8px;border:1px solid #ddd;font-size:0.85rem;resize:vertical;" placeholder="补充说明（可选）">${escapeHtml(mistake.error_reason || '')}</textarea>
        </div>
        <div class="form-group">
          <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:4px;">关键思路（解题要点）：</label>
          <textarea id="edit-key-insight" style="width:100%;min-height:60px;padding:8px;border-radius:8px;border:1px solid #ddd;font-size:0.85rem;resize:vertical;" placeholder="例如：这题需要用链式法则、注意单位转换...">${escapeHtml(mistake.key_insight || '')}</textarea>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="edit-cancel-btn" class="btn btn-secondary" style="flex:1;">取消</button>
          <button id="edit-save-btn" class="btn btn-primary" style="flex:1;">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#edit-cancel-btn').onclick = () => overlay.remove();
    overlay.querySelector('#edit-save-btn').onclick = async () => {
      const question = overlay.querySelector('#edit-question-text').value.trim();
      const correctAnswer = overlay.querySelector('#edit-correct-answer').value.trim();
      const wrongAnswer = overlay.querySelector('#edit-wrong-answer').value.trim();
      const errorReason = overlay.querySelector('#edit-error-reason').value.trim();
      const errorReasonType = overlay.querySelector('#edit-error-reason-type').value;
      const keyInsight = overlay.querySelector('#edit-key-insight').value.trim();
      try {
        await API.put(`/api/mistakes/${mistakeId}`, {
          question: question,
          correct_answer: correctAnswer,
          wrong_answer: wrongAnswer,
          error_reason: errorReason,
          error_reason_type: errorReasonType,
          key_insight: keyInsight
        });
        overlay.remove();
        showToast('编辑已保存 ✅');
        loadMistakes();
      } catch (err) {
        showToast('保存失败: ' + err.message);
      }
    };
  } catch (err) {
    showToast('打开编辑失败: ' + err.message);
  }
}


async function handleViewDetail(mistakeId) {
  try {
    const mistake = await API.get(`/api/mistakes/${mistakeId}`);

    const rawVersions = JSON.parse(mistake.solution_versions || '[]');
    // Keep original indices for note API
    let versions = rawVersions.map((v, idx) => ({ ...v, _origIdx: idx }));
    let timelineSortDesc = true; // default: newest first (fold: show first attempt)
    function sortVersions() {
      versions.sort((a, b) => {
        const ta = a.time ? new Date(a.time).getTime() : 0;
        const tb = b.time ? new Date(b.time).getTime() : 0;
        return timelineSortDesc ? (tb - ta) : (ta - tb);
      });
    }
    sortVersions();

    function formatVersionDate(timeStr) {
      if (!timeStr) return '未知时间';
      try {
        const d = new Date(timeStr.includes('Z') || timeStr.includes('+') ? timeStr : timeStr + 'Z');
        return d.toLocaleDateString('zh-CN', {month:'short', day:'numeric'}) + ' ' + d.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
      } catch(e) { return timeStr; }
    }

    function renderNotesHTML(v) {
      const notes = Array.isArray(v.notes) ? v.notes : [];
      return `
        <div class="timeline-notes">
          ${notes.length > 0 ? notes.map((n, ni) => `
            <div class="timeline-note-item">
              <span class="timeline-note-icon">📝</span>
              <div style="flex:1;">
                <div class="timeline-note-content">${escapeHtml(n.content)}</div>
                <div class="timeline-note-time">${escapeHtml(n.created_at || '')}</div>
              </div>
              <button class="timeline-note-del" data-action="delete-note" data-mistake-id="${mistakeId}" data-version-idx="${v._origIdx}" data-note-idx="${ni}" title="删除">×</button>
            </div>
          `).join('') : ''}
          <div class="timeline-note-input-row">
            <textarea class="timeline-note-input" data-version-idx="${v._origIdx}" placeholder="添加批注..." rows="1" maxlength="500"></textarea>
            <button class="timeline-note-btn" data-action="submit-note" data-version-idx="${v._origIdx}" data-mistake-id="${mistakeId}">添加</button>
          </div>
        </div>
      `;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    let detailOpts = [];
    try {
      const rawOpts = typeof mistake.options === 'string' ? JSON.parse(mistake.options) : mistake.options;
      if (Array.isArray(rawOpts) && rawOpts.length > 0 && rawOpts.some(o => o && String(o).trim())) {
        detailOpts = rawOpts;
      }
    } catch(e) { detailOpts = []; }
    const isChoice = detailOpts.length > 0;
    // Parse sub_questions for detail view
    let detailSubQs = [];
    try { detailSubQs = typeof mistake.sub_questions === 'string' ? JSON.parse(mistake.sub_questions) : (mistake.sub_questions || []); } catch(e) { detailSubQs = []; }
    if (!Array.isArray(detailSubQs)) detailSubQs = [];
    const detailSubQsHTML = detailSubQs.length > 0 ? `
      <div style="margin-bottom:8px;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border,#eee);">
        <div style="padding:8px 12px;font-size:0.82rem;font-weight:600;color:var(--text-secondary);background:var(--bg-card,#fff);border-bottom:1px solid var(--border,#eee);">📝 小题 (${detailSubQs.length}道)</div>
        ${detailSubQs.map((sq, si) => `
          <div style="padding:8px 12px;${si < detailSubQs.length - 1 ? 'border-bottom:1px solid var(--border,#eee);' : ''}background:var(--bg-input,#f5f6f8);">
            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="font-weight:700;color:var(--accent,#5b7fd9);white-space:nowrap;font-size:0.88rem;">${escapeHtml(sq.label || `(${si+1})`)}</span>
              <span style="font-size:0.88rem;line-height:1.5;">${renderSubSup(sq.question || '')}</span>
            </div>
            <div style="margin-top:3px;margin-left:28px;font-size:0.82rem;">
              <span style="color:#2e7d32;">✅ ${renderSubSup(sq.correct_answer || '')}</span>
              ${sq.wrong_answer ? `<span style="margin-left:10px;color:#c62828;">❌ ${renderSubSup(sq.wrong_answer)}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>` : '';
    const detailOptionsHTML = (detailOpts.length > 0) ? `
      <div style="margin-bottom:8px;padding:10px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:0.88rem;">
        <strong>选项：</strong>
        ${detailOpts.map((o, i) => {
          const letter = String.fromCharCode(65 + i);
          const isCorrect = letter === mistake.correct_answer;
          const isWrong = letter === mistake.wrong_answer;
          const style = isCorrect ? 'color:#2e7d32;font-weight:600;' : isWrong ? 'color:#dc3545;' : '';
          return `<div style="${style}margin-top:3px;"><span style="font-weight:600;">${letter}.</span> ${renderSubSup(o)}${isCorrect ? ' ✅' : ''}${isWrong ? ' ❌' : ''}</div>`;
        }).join('')}
      </div>` : '';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:90vw;width:400px;max-height:85vh;overflow-y:auto;">
        <h3 style="margin-bottom:12px;">错题详情${isChoice ? ' <span style="font-size:0.8rem;color:#3a5ba0;">🔲 选择题</span>' : ''}</h3>
        <div style="margin-bottom:12px;padding:10px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:0.9rem;">
          <strong>题目：</strong>${renderSubSup(mistake.question)}
        </div>
        ${detailOptionsHTML}
        ${detailSubQsHTML}
        <div class="detail-answer-section" style="margin-bottom:8px;padding:10px;background:var(--success-light);border-radius:var(--radius-sm);font-size:0.9rem;">
          <strong>正确答案：</strong>${isChoice && detailOpts.length > 0 ? (() => { const ci = mistake.correct_answer ? mistake.correct_answer.charCodeAt(0) - 65 : -1; return ci >= 0 && ci < detailOpts.length ? renderSubSup(mistake.correct_answer + '. ' + detailOpts[ci]) : renderSubSup(mistake.correct_answer); })() : renderSubSup(mistake.correct_answer)}
        </div>
        <div class="detail-answer-section" style="margin-bottom:8px;padding:10px;background:var(--danger-light);border-radius:var(--radius-sm);font-size:0.9rem;">
          <strong>首次错误答案：</strong>${isChoice && detailOpts.length > 0 ? (() => { const wi = mistake.wrong_answer ? mistake.wrong_answer.charCodeAt(0) - 65 : -1; return wi >= 0 && wi < detailOpts.length ? renderSubSup(mistake.wrong_answer + '. ' + detailOpts[wi]) : renderSubSup(mistake.wrong_answer || '(空)'); })() : renderSubSup(mistake.wrong_answer || '(空)')}
        </div>
        ${mistake.error_reason_type ? `
        <div class="detail-answer-section" style="margin-bottom:8px;padding:8px 12px;background:var(--warning-light);border-radius:var(--radius-sm);font-size:0.85rem;">
          <div style="font-weight:600;color:#856404;">错因类型</div>
          <div style="margin-top:4px;">${renderErrorReasonTypeBadge(mistake.error_reason_type)}</div>
        </div>` : ''}
        ${mistake.error_reason ? `
        <div class="detail-answer-section" style="margin-bottom:8px;padding:8px 12px;background:var(--warning-light);border-radius:var(--radius-sm);font-size:0.85rem;">
          <div style="font-weight:600;color:#856404;">错因补充</div>
          <div style="margin-top:4px;color:#664d03;">${escapeHtml(mistake.error_reason)}</div>
        </div>` : ''}
        ${mistake.key_insight ? `
        <div class="detail-answer-section" style="margin-bottom:8px;padding:8px 12px;background:var(--info-light);border-radius:var(--radius-sm);font-size:0.85rem;">
          <div style="font-weight:600;color:#0c5460;">关键思路</div>
          <div style="margin-top:4px;color:#0c5460;">${escapeHtml(mistake.key_insight)}</div>
        </div>` : ''}
        <div class="timeline-panel">
          <div class="timeline-panel-header">
            <span class="panel-title" data-action="toggle-timeline" style="cursor:pointer;">复习历史 (${versions.length}次)</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <button class="timeline-sort-btn" data-action="toggle-timeline-sort" title="切换排序" style="background:none;border:1px solid #ddd;border-radius:4px;padding:2px 6px;font-size:0.7rem;cursor:pointer;color:var(--text-secondary);">↓新→旧</button>
              <span class="panel-toggle" data-action="toggle-timeline" style="cursor:pointer;">▼</span>
            </div>
          </div>
          <div class="timeline-body">
            ${versions.length > 0 ? `
            <div class="timeline-container">
              ${versions.map((v) => {
                return `
                <div class="timeline-node">
                  <div class="timeline-dot ${v.correct ? 'correct' : 'wrong'}">${v.correct ? '✓' : '✗'}</div>
                  <div class="timeline-card">
                    <div class="timeline-card-header">
                      <span class="timeline-result ${v.correct ? 'correct' : 'wrong'}">${v.correct ? '✅ 做对了' : '❌ 做错了'}</span>
                      <span class="timeline-time">${formatVersionDate(v.time)}</span>
                    </div>
                    ${(v.solution || v.user_answer) ? `
                    <div class="timeline-answer">
                      <span style="color:var(--text-tertiary);font-size:0.75rem;">答案：</span>${renderSubSup(v.solution || v.user_answer)}
                    </div>` : ''}
                    ${renderNotesHTML(v)}
                  </div>
                </div>
              `}).join('')}
            </div>
            ` : '<div class="timeline-empty">暂无重做记录</div>'}
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="detail-toggle-ans" class="btn" style="flex:1;background:#fff3e0;color:#e65100;border:1px solid #ffcc80;font-size:0.85rem;">显示答案</button>
          <button class="fav-btn ${isFav(mistake.id, 'mistake') ? 'favorited' : ''}" data-action="open-fav-modal" data-target-type="mistake" data-target-id="${mistake.id}" title="收藏" style="font-size:1.3rem;flex-shrink:0;">${isFav(mistake.id, 'mistake') ? '⭐' : '☆'}</button>
          <button id="detail-close-btn" class="btn btn-secondary" style="flex:1;">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#detail-close-btn').onclick = () => overlay.remove();
    overlay.querySelector('#detail-toggle-ans').onclick = function() {
      const sections = overlay.querySelectorAll('.detail-answer-section');
      const isHidden = sections.length > 0 && sections[0].style.display === 'none';
      sections.forEach(s => { if(s) s.style.display = isHidden ? '' : 'none'; });
      this.textContent = isHidden ? '隐藏答案' : '显示答案';
    };
    // Fav button in detail modal (outside #app, needs direct binding)
    const detailFavBtn = overlay.querySelector('[data-action="open-fav-modal"]');
    if (detailFavBtn) {
      detailFavBtn.onclick = (e) => {
        e.stopPropagation();
        showFavoriteModal(detailFavBtn.dataset.targetType, parseInt(detailFavBtn.dataset.targetId));
      };
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Event: toggle timeline panel
    const timelineBody = overlay.querySelector('.timeline-body');
    const panelToggle = overlay.querySelector('.panel-toggle');
    overlay.querySelectorAll('[data-action="toggle-timeline"]').forEach(el => {
      el.addEventListener('click', () => {
        timelineBody.classList.toggle('open');
        if (panelToggle) panelToggle.classList.toggle('open');
      });
    });
    // Auto-open timeline if there are versions
    if (versions.length > 0) {
      timelineBody.classList.add('open');
      if (panelToggle) panelToggle.classList.add('open');
    }

    // Event: toggle timeline sort
    const sortBtn = overlay.querySelector('[data-action="toggle-timeline-sort"]');
    if (sortBtn) {
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        timelineSortDesc = !timelineSortDesc;
        sortVersions();
        sortBtn.textContent = timelineSortDesc ? '↓新→旧' : '↑旧→新';
        // Re-render timeline container
        const container = overlay.querySelector('.timeline-container');
        if (container) {
          container.innerHTML = versions.map(v => `
            <div class="timeline-node">
              <div class="timeline-dot ${v.correct ? 'correct' : 'wrong'}">${v.correct ? '✓' : '✗'}</div>
              <div class="timeline-card">
                <div class="timeline-card-header">
                  <span class="timeline-result ${v.correct ? 'correct' : 'wrong'}">${v.correct ? '✅ 做对了' : '❌ 做错了'}</span>
                  <span class="timeline-time">${formatVersionDate(v.time)}</span>
                </div>
                ${(v.solution || v.user_answer) ? `<div class="timeline-answer"><span style="color:var(--text-tertiary);font-size:0.75rem;">答案：</span>${renderSubSup(v.solution || v.user_answer)}</div>` : ''}
                ${renderNotesHTML(v)}
              </div>
            </div>
          `).join('');
          // Re-attach note event listeners
          container.querySelectorAll('[data-action="submit-note"]').forEach(btn => {
            btn.addEventListener('click', (ev) => { ev.stopPropagation(); handleSubmitNote(parseInt(btn.dataset.mistakeId), parseInt(btn.dataset.versionIdx)); });
          });
          container.querySelectorAll('[data-action="delete-note"]').forEach(btn => {
            btn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const mId = parseInt(btn.dataset.mistakeId);
              const vIdx = parseInt(btn.dataset.versionIdx);
              const nIdx = parseInt(btn.dataset.noteIdx);
              showConfirmModal('删除批注', '确定要删除这条批注吗？', async () => {
                try {
                  await API.post(`/api/mistakes/${mId}/note/delete`, { version_index: vIdx, note_index: nIdx });
                  // Remove just this note from DOM (no full refresh)
                  const noteItem = btn.closest('.timeline-note-item');
                  if (noteItem) {
                    noteItem.style.transition = 'opacity 0.2s, max-height 0.2s';
                    noteItem.style.opacity = '0';
                    noteItem.style.maxHeight = '0';
                    noteItem.style.overflow = 'hidden';
                    setTimeout(() => noteItem.remove(), 200);
                  }
                  showToast('批注已删除');
                } catch(err) { showToast('删除失败: ' + (err.message || '请重试')); }
              });
            });
          });
        }
      });
    }

    // Event: submit note buttons
    overlay.querySelectorAll('[data-action="submit-note"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const vIdx = parseInt(btn.dataset.versionIdx);
        const mId = parseInt(btn.dataset.mistakeId);
        handleSubmitNote(mId, vIdx);
      });
    });

    // Event: delete note buttons
    overlay.querySelectorAll('[data-action="delete-note"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mId = parseInt(btn.dataset.mistakeId);
        const vIdx = parseInt(btn.dataset.versionIdx);
        const nIdx = parseInt(btn.dataset.noteIdx);
        showConfirmModal('删除批注', '确定要删除这条批注吗？', async () => {
          try {
            await API.post(`/api/mistakes/${mId}/note/delete`, { version_index: vIdx, note_index: nIdx });
            // Remove just this note from DOM (no full refresh)
            const noteItem = btn.closest('.timeline-note-item');
            if (noteItem) {
              noteItem.style.transition = 'opacity 0.2s, max-height 0.2s';
              noteItem.style.opacity = '0';
              noteItem.style.maxHeight = '0';
              noteItem.style.overflow = 'hidden';
              setTimeout(() => noteItem.remove(), 200);
            }
            showToast('批注已删除');
          } catch(err) {
            showToast('删除失败: ' + (err.message || '请重试'));
          }
        });
      });
    });
  } catch (err) {
    showToast('查看详情失败: ' + err.message);
  }
}

async function handleSubmitNote(mistakeId, versionIdx) {
  const textarea = document.querySelector(`textarea.timeline-note-input[data-version-idx="${versionIdx}"]`);
  const btn = document.querySelector(`button[data-action="submit-note"][data-version-idx="${versionIdx}"]`);
  if (!textarea || !btn) return;
  const content = textarea.value.trim();
  if (!content) { showToast('请输入批注内容'); return; }

  btn.disabled = true;
  btn.textContent = '...';
  try {
    const result = await API.post(`/api/mistakes/${mistakeId}/note`, { version_index: versionIdx, content });
    // Insert new note directly into DOM (no full refresh)
    const noteContent = (result && result.content) || content;
    const noteTime = (result && result.created_at) || '';
    const newItem = document.createElement('div');
    newItem.className = 'timeline-note-item';
    newItem.style.animation = 'fadeIn 0.25s ease-out';
    newItem.innerHTML = `
      <span class="timeline-note-icon">📝</span>
      <div style="flex:1;">
        <div class="timeline-note-content">${escapeHtml(noteContent)}</div>
        <div class="timeline-note-time">${escapeHtml(noteTime)}</div>
      </div>
      <button class="timeline-note-del" data-action="delete-note" data-mistake-id="${mistakeId}" data-version-idx="${versionIdx}" data-note-idx="0" title="删除">×</button>
    `;
    const container = textarea.closest('.timeline-notes');
    if (container) {
      const inputRow = textarea.closest('.timeline-note-input-row');
      container.insertBefore(newItem, inputRow);
    }
    textarea.value = '';
    btn.disabled = false;
    btn.textContent = '添加';
    showToast('批注已添加');
  } catch (err) {
    showToast('添加批注失败: ' + err.message);
    btn.disabled = false;
    btn.textContent = '添加';
  }
}

// --- Trash / Recently Deleted ---
function renderTrash() {
  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" data-action="nav-settings">←</button>
        <h1 style="font-size:1.1rem;">🗑️ 最近删除</h1>
        <div></div>
      </div>
      <div style="padding:12px 16px;font-size:0.85rem;color:var(--text-tertiary);text-align:center;">
        删除的项目会在 30 天后自动清除
      </div>
      <div id="trash-content" style="padding:0 16px;">
        <div style="color:var(--text-tertiary);text-align:center;padding:40px 0;">加载中...</div>
      </div>
      <div id="trash-actions" style="padding:16px;display:none;">
        <button class="btn btn-danger btn-block" data-action="empty-trash" style="background:#e74c3c;color:#fff;border:none;">🗑️ 清空回收站</button>
      </div>
      ${renderBottomNav()}
    </div>
  `;
}

async function loadTrash() {
  const container = document.getElementById('trash-content');
  const actionsDiv = document.getElementById('trash-actions');
  if (!container) return;
  try {
    const data = await API.get('/api/trash');
    const mistakes = data.mistakes || [];
    const quizzes = data.quizzes || [];
    if (mistakes.length === 0 && quizzes.length === 0) {
      container.innerHTML = '<div style="color:var(--text-tertiary);text-align:center;padding:60px 0;font-size:0.95rem;">🎉 回收站是空的</div>';
      if (actionsDiv) actionsDiv.style.display = 'none';
      return;
    }
    if (actionsDiv) actionsDiv.style.display = 'block';
    let html = '';
    if (quizzes.length > 0) {
      html += '<div class="section-header"><span class="section-title">🧪 Quiz</span></div>';
      quizzes.forEach(q => {
        const daysLeft = q.days_left || 0;
        html += `
          <div class="card trash-item" style="padding:12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(q.title || 'Untitled Quiz')}</div>
                <div style="font-size:0.75rem;color:var(--text-tertiary);margin-top:4px;">${q.question_count || 0} 题 · 删除于 ${escapeHtml(q.deleted_at || '')} · ${daysLeft}天后清除</div>
              </div>
              <div style="display:flex;gap:6px;margin-left:8px;">
                <button class="btn btn-sm" data-action="restore-trash" data-type="quiz" data-id="${q.id}" style="background:#27ae60;color:#fff;border:none;font-size:0.75rem;">恢复</button>
                <button class="btn btn-sm" data-action="permanent-delete" data-type="quiz" data-id="${q.id}" style="background:#e74c3c;color:#fff;border:none;font-size:0.75rem;">删除</button>
              </div>
            </div>
          </div>
        `;
      });
    }
    if (mistakes.length > 0) {
      html += '<div class="section-header" style="margin-top:16px;"><span class="section-title">📝 错题</span></div>';
      mistakes.forEach(m => {
        const daysLeft = m.days_left || 0;
        const preview = (m.question || '').substring(0, 50) + ((m.question || '').length > 50 ? '...' : '');
        html += `
          <div class="card trash-item" style="padding:12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(preview)}</div>
                <div style="font-size:0.75rem;color:var(--text-tertiary);margin-top:4px;">错误${m.error_count || 1}次 · 删除于 ${escapeHtml(m.deleted_at || '')} · ${daysLeft}天后清除</div>
              </div>
              <div style="display:flex;gap:6px;margin-left:8px;">
                <button class="btn btn-sm" data-action="restore-trash" data-type="mistake" data-id="${m.id}" style="background:#27ae60;color:#fff;border:none;font-size:0.75rem;">恢复</button>
                <button class="btn btn-sm" data-action="permanent-delete" data-type="mistake" data-id="${m.id}" style="background:#e74c3c;color:#fff;border:none;font-size:0.75rem;">删除</button>
              </div>
            </div>
          </div>
        `;
      });
    }
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div style="color:#e74c3c;text-align:center;padding:40px 0;">加载失败: ' + escapeHtml(err.message) + '</div>';
  }
}

async function handleRestoreTrash(type, id) {
  try {
    await API.post('/api/trash/restore', { type, id });
    showToast('已恢复');
    loadTrash();
  } catch (err) {
    showToast('恢复失败: ' + err.message);
  }
}

async function handlePermanentDelete(type, id) {
  showConfirmModal('永久删除', '确定要永久删除吗？此操作不可恢复！', async () => {
    try {
      await API.request('/api/trash/permanent', { method: 'DELETE', body: JSON.stringify({ type, id }) });
      showToast('已永久删除');
      loadTrash();
    } catch (err) {
      showToast('删除失败: ' + err.message);
    }
  });
}

async function handleEmptyTrash() {
  showConfirmModal('清空回收站', '确定要清空回收站吗？所有项目将被永久删除，无法恢复！', async () => {
    try {
      await API.request('/api/trash/empty', { method: 'DELETE' });
      showToast('回收站已清空');
      loadTrash();
    } catch (err) {
      showToast('清空失败: ' + err.message);
    }
  });
}

function handleFilter(filter) {
  if (state.currentPage === 'mistakes') {
    const sortChip = document.querySelector('#mistake-sort .sort-chip.active');
    const sortBy = sortChip ? sortChip.dataset.sort : 'error_count';
    loadMistakes(filter, sortBy);
  }
  // Quiz page no longer uses filter bar - filtering is via subject/chapter chips
}

function handleSort(sortBy) {
  if (state.currentPage === 'mistakes') {
    const filterChip = document.querySelector('#mistake-filters .filter-chip.active');
    const filter = filterChip ? filterChip.dataset.filter : 'pending';
    loadMistakes(filter, sortBy);
  } else if (state.currentPage === 'quizzes') {
    loadQuizzes(sortBy);
  }
}


// ============================================================
// FEATURE: Quiz Categories / Folders
// ============================================================

const CATEGORY_COLORS = ['#4a90d9','#f5a623','#e74c3c','#2ecc71','#9b59b6','#1abc9c','#e67e22','#3498db','#e91e63','#00bcd4','#ff5722','#607d8b'];

function renderManageCategories() {
  return `
    <div class="page">
      <div class="top-bar">
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="icon-btn" data-action="nav-back-from-categories" style="font-size:1.1rem;">←</button>
          <h1>管理分类</h1>
        </div>
        <div></div>
      </div>
      <div style="padding:0 16px 8px;">
        <div class="card" style="background:var(--bg-card);border:1.5px dashed #d0d0d0;">
          <div style="font-size:0.9rem;font-weight:600;margin-bottom:10px;">📁 新建分类</div>
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <input type="text" id="new-cat-name" class="form-input" placeholder="分类名称" style="flex:1;" />
          </div>
          <div id="new-cat-colors" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
            ${CATEGORY_COLORS.map((c, i) =>
              `<button class="cat-color-btn${i===0?' selected':''}" data-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};border:2px solid ${i===0?'#333':'transparent'};cursor:pointer;"></button>`
            ).join('')}
          </div>
          <button class="btn btn-primary btn-block" data-action="create-category">+ 创建分类</button>
        </div>
      </div>
      <div id="categories-list" style="padding:0 16px;">
        <div style="text-align:center;color:var(--text-tertiary);padding:20px;">加载中...</div>
      </div>
    </div>
  `;
}

async function loadManageCategories() {
  const container = document.getElementById('categories-list');
  if (!container) return;
  try {
    const data = await API.get('/api/quiz-categories');
    const cats = data.categories || [];
    state.quizCategories = cats;
    if (cats.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;color:var(--text-tertiary);padding:30px;">
          <div style="font-size:2rem;margin-bottom:8px;">📂</div>
          <div>还没有分类，创建一个吧！</div>
        </div>
      `;
      return;
    }
    container.innerHTML = cats.map(c => `
      <div class="card" style="display:flex;align-items:center;gap:12px;padding:12px;">
        <div class="cat-color-preview" style="width:36px;height:36px;border-radius:10px;background:${c.color};flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:0.95rem;">${escapeHtml(c.name)}</div>
          <div style="font-size:0.8rem;color:var(--text-tertiary);">${c.quiz_count} 个 quiz</div>
        </div>
        <button class="btn btn-sm" style="background:none;font-size:1rem;color:var(--text-secondary);" data-action="delete-category" data-id="${c.id}" title="删除">🗑️</button>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">加载失败</div>';
  }
}

async function handleCreateCategory() {
  const nameInput = document.getElementById('new-cat-name');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { showToast('请输入分类名称'); return; }
  const selectedColor = document.querySelector('#new-cat-colors .cat-color-btn.selected');
  const color = selectedColor ? selectedColor.dataset.color : '#4a90d9';
  try {
    await API.post('/api/quiz-categories', { name, color });
    showToast('分类已创建 ✅');
    if (nameInput) nameInput.value = '';
    await loadManageCategories();
    await loadCategoryChips();
  } catch (err) {
    showToast('创建失败: ' + err.message);
  }
}

async function handleDeleteCategory(catId) {
  showConfirmModal('删除分类', '确定删除这个分类吗？Quiz 不会被删除。', async () => {
    try {
      await API.del(`/api/quiz-categories/${catId}`);
      showToast('分类已删除');
      await loadManageCategories();
      await loadCategoryChips();
    } catch (err) {
      showToast('删除失败: ' + err.message);
    }
  });
}

function showCategorizeModal(quizId) {
  const cats = state.quizCategories || [];
  // Remove existing modal
  const existing = document.getElementById('categorize-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'categorize-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:340px;width:90%;padding:20px;border-radius:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-weight:700;font-size:1.05rem;">🏷️ 选择分类</div>
        <button id="categorize-close" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-secondary);">✕</button>
      </div>
      <div id="categorize-options" style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto;">
        ${cats.length === 0 ? '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">还没有分类，<br>请先去管理分类创建</div>' :
          cats.map(c => `
            <label class="categorize-option" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;background:var(--bg-main);transition:background 0.15s;">
              <input type="checkbox" value="${c.id}" style="width:18px;height:18px;accent-color:${c.color};" />
              <span class="cat-color-preview" style="width:24px;height:24px;border-radius:7px;background:${c.color};flex-shrink:0;"></span>
              <span style="font-size:0.9rem;font-weight:500;">${escapeHtml(c.name)}</span>
            </label>
          `).join('')
        }
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-secondary" id="categorize-cancel" style="flex:1;">取消</button>
        <button class="btn btn-primary" id="categorize-save" style="flex:1;">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close handlers
  const closeModal = () => modal.remove();
  modal.querySelector('#categorize-close').onclick = closeModal;
  modal.querySelector('#categorize-cancel').onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };

  // Load current categories for this quiz
  loadQuizCategoriesForModal(quizId);

  // Save handler
  modal.querySelector('#categorize-save').onclick = async () => {
    const checked = [...modal.querySelectorAll('#categorize-options input:checked')].map(el => parseInt(el.value));
    try {
      await API.post(`/api/quizzes/${quizId}/categorize`, { category_ids: checked });
      showToast('分类已更新 ✅');
      closeModal();
      // Reload quiz list
      await loadQuizzes();
    } catch (err) {
      showToast('保存失败: ' + err.message);
    }
  };
}

async function loadQuizCategoriesForModal(quizId) {
  try {
    const data = await API.get(`/api/quizzes`);
    const quiz = (data.quizzes || []).find(q => q.id === quizId);
    if (quiz && quiz.categories) {
      const modal = document.getElementById('categorize-modal');
      if (!modal) return;
      const catIds = quiz.categories.map(c => c.id);
      modal.querySelectorAll('#categorize-options input[type="checkbox"]').forEach(el => {
        if (catIds.includes(parseInt(el.value))) el.checked = true;
      });
    }
  } catch (err) { /* ignore */ }
}

// ============================================================
// FEATURE 2: Settings / Subject Preferences
// ============================================================

function renderSettings() {
  return `
    <div class="page">
      <div class="top-bar">
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="icon-btn" data-action="nav-home" style="font-size:1.1rem;">←</button>
          <h1>Settings</h1>
        </div>
        <div></div>
      </div>

      <div class="section-header">
        <span class="section-title">📚 学科偏好</span>
        <span style="font-size:0.8rem;color:var(--text-tertiary);">选择你在学的学科</span>
      </div>
      <div id="settings-subjects-grid" style="display:flex;flex-wrap:wrap;gap:10px;padding:0 16px 16px;">
        <div style="color:var(--text-tertiary);font-size:0.9rem;">加载中...</div>
      </div>
      <div style="padding:0 16px;">
        <button class="btn btn-primary btn-block" data-action="save-subjects" id="save-subjects-btn">💾 保存学科选择</button>
        <div id="settings-save-msg" style="font-size:0.85rem;color:var(--text-tertiary);margin-top:8px;text-align:center;"></div>
      </div>

      <div class="section-header" style="margin-top:24px;">
        <span class="section-title">✏️ 改名</span>
        <span style="font-size:0.8rem;color:var(--text-tertiary);">每年最多3次</span>
      </div>
      <div class="card" style="padding:14px;margin:0 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <input type="text" id="rename-input" placeholder="输入新昵称" maxlength="30" style="flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:0.9rem;" />
          <button class="btn btn-primary btn-sm" data-action="save-rename" style="font-size:0.8rem;white-space:nowrap;">改名</button>
        </div>
        <div id="rename-msg" style="font-size:0.8rem;color:var(--text-tertiary);margin-top:6px;"></div>
      </div>

      <div class="section-header" style="margin-top:24px;">
        <span class="section-title">⚙️ 其他设置</span>
      </div>
      <div class="card" style="padding:14px;margin:0 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.9rem;">每日复习上限</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="number" id="settings-daily-limit" min="1" max="200" value="20" style="width:60px;text-align:center;padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;">
            <button class="btn btn-primary btn-sm" data-action="save-daily-limit" style="font-size:0.8rem;">保存</button>
          </div>
        </div>
      </div>

      <div class="section-header" style="margin-top:24px;">
        <span class="section-title">🔧 快捷操作</span>
      </div>
      <div class="card settings-actions-card" style="padding:0;margin:0 16px;overflow:hidden;">
        <button class="settings-action-btn" data-action="replay-onboarding">📖 重新查看引导</button>
        <button class="settings-action-btn" data-action="nav-trash">🗑️ 打开回收站</button>
        <button class="settings-action-btn" data-action="logout">🚪 退出登录</button>
        <div class="settings-action-divider"></div>
        <button class="settings-action-btn settings-action-danger" data-action="clear-all-data">🗑️ 清空所有数据</button>
        <div style="font-size:0.72rem;color:var(--text-tertiary);padding:0 14px 10px;text-align:center;">删除所有错题和Quiz，账号保留</div>
      </div>

      <div class="section-header" style="margin-top:24px;">
        <span class="section-title">💾 数据备份</span>
        <span style="font-size:0.8rem;color:var(--text-tertiary);">防止数据丢失</span>
      </div>
      <div class="card" style="padding:14px;margin:0 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.9rem;">手动备份</span>
          <button class="btn btn-primary btn-sm" data-action="create-backup" id="create-backup-btn" style="font-size:0.8rem;">立即备份</button>
        </div>
        <div style="font-size:0.75rem;color:var(--text-tertiary);margin-top:4px;">每次应用启动也会自动备份，最多保留3个</div>
      </div>
      <div id="backup-list-container" style="padding:0 16px;">
        <div style="color:var(--text-tertiary);font-size:0.85rem;padding:8px 0;">加载中...</div>
      </div>

    </div>
  `;
}

async function loadSettings() {
  try {
    // Load user subjects
    const data = await API.get('/api/user/subjects');
    const grid = document.getElementById('settings-subjects-grid');
    if (!grid) return;
    
    const selected = data.selected_subjects || [];
    state._selectedSubjectIds = new Set(selected);
    
    grid.innerHTML = data.all_subjects.map(s => {
      const isSelected = selected.includes(s.id);
      return `<button class="subject-chip ${isSelected ? 'selected' : ''}" data-action="toggle-subject-chip" data-id="${s.id}" style="
        padding:10px 18px;border-radius:20px;font-size:0.9rem;border:2px solid ${isSelected ? '#4a90d9' : '#e0e0e0'};
        background:${isSelected ? '#4a90d9' : '#fff'};color:${isSelected ? '#fff' : '#333'};
        cursor:pointer;transition:all 0.2s;font-weight:${isSelected ? '600' : '400'};
      ">${escapeHtml(s.name)}</button>`;
    }).join('');

    // Load daily limit
    const limitData = await API.get('/api/settings/daily-limit');
    const limitInput = document.getElementById('settings-daily-limit');
    if (limitInput) limitInput.value = limitData.daily_review_limit || 20;

    // Load rename info
    try {
      const renameData = await API.get('/api/user/rename');
      const renameMsg = document.getElementById('rename-msg');
      const renameInput = document.getElementById('rename-input');
      if (renameInput) renameInput.placeholder = `当前: ${renameData.nickname || '未设置'}`;
      if (renameMsg) renameMsg.textContent = `今年还剩 ${renameData.remaining_renames} 次改名机会`;
    } catch(e) {}

    // Load backup list
    await loadBackupList();
  } catch (e) {
    console.error('loadSettings error:', e);
  }
}

async function loadBackupList() {
  const container = document.getElementById('backup-list-container');
  if (!container) return;
  try {
    const data = await API.get('/api/backups');
    const backups = data.backups || [];
    if (backups.length === 0) {
      container.innerHTML = '<div style="font-size:0.85rem;color:var(--text-tertiary);padding:8px 0;">暂无备份记录</div>';
      return;
    }
    container.innerHTML = '<div style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">备份记录 (' + backups.length + '/' + data.max_backups + ')</div>' +
      backups.map(b => '<div class="card" style="padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">' +
        '<div>' +
          '<div style="font-size:0.85rem;">' + escapeHtml(b.created_at) + '</div>' +
          '<div style="font-size:0.75rem;color:var(--text-tertiary);">' + b.size_kb + ' KB</div>' +
        '</div>' +
        '<button class="btn btn-outline btn-sm" data-action="restore-backup" data-filename="' + escapeHtml(b.filename) + '" style="font-size:0.75rem;color:#e67e22;border-color:#e67e22;padding:4px 10px;">恢复</button>' +
      '</div>').join('');
  } catch (e) {
    container.innerHTML = '<div style="font-size:0.85rem;color:#e74c3c;padding:8px 0;">加载备份列表失败</div>';
  }
}

function toggleSubjectChip(subjectId) {
  if (!state._selectedSubjectIds) state._selectedSubjectIds = new Set();
  if (state._selectedSubjectIds.has(subjectId)) {
    state._selectedSubjectIds.delete(subjectId);
  } else {
    state._selectedSubjectIds.add(subjectId);
  }
  // Update visual
  const grid = document.getElementById('settings-subjects-grid');
  if (!grid) return;
  grid.querySelectorAll('.subject-chip').forEach(chip => {
    const id = parseInt(chip.dataset.id);
    const isSelected = state._selectedSubjectIds.has(id);
    chip.style.borderColor = isSelected ? '#4a90d9' : '#e0e0e0';
    chip.style.background = isSelected ? '#4a90d9' : '#fff';
    chip.style.color = isSelected ? '#fff' : '#333';
    chip.style.fontWeight = isSelected ? '600' : '400';
  });
}

async function handleSaveSubjects() {
  const btn = document.getElementById('save-subjects-btn');
  const msg = document.getElementById('settings-save-msg');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '保存中...';
  try {
    const ids = Array.from(state._selectedSubjectIds || []);
    await API.put('/api/user/subjects', { selected_subjects: ids });
    if (msg) msg.textContent = '已保存 ✓';
    if (msg) msg.style.color = '#5a9a6a';
    showToast('学科偏好已保存 ✓');
  } catch (e) {
    if (msg) msg.textContent = '保存失败: ' + e.message;
    if (msg) msg.style.color = '#e74c3c';
  }
  btn.disabled = false;
  btn.textContent = '💾 保存学科选择';
}

// Check and prompt subject selection after login
// Cache for home data (from /api/home) to avoid redundant requests
let _homeDataCache = null;

async function checkAndPromptSubjects() {
  try {
    // Reuse cached home data if available, otherwise fetch
    let userSubjectsData;
    if (_homeDataCache && _homeDataCache.user_subjects) {
      userSubjectsData = _homeDataCache.user_subjects;
    } else {
      userSubjectsData = await API.get('/api/user/subjects');
    }
    const selected = userSubjectsData.selected_subjects || [];
    if (selected.length === 0) {
      // Show inline subject picker on home page
      setTimeout(() => showSubjectPickerOverlay(userSubjectsData.all_subjects), 500);
    }
  } catch (e) {
    console.error('check subjects error:', e);
  }
}

function showSubjectPickerOverlay(allSubjects) {
  const overlay = document.createElement('div');
  overlay.id = 'subject-picker-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px 24px;max-width:380px;width:100%;max-height:80vh;overflow-y:auto;">
      <h2 style="text-align:center;margin:0 0 8px;font-size:1.3rem;">📚 选择你的学科</h2>
      <p style="text-align:center;color:#888;font-size:0.9rem;margin:0 0 20px;">至少选择一个学科开始使用</p>
      <div id="picker-subjects-grid" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:20px;">
        ${allSubjects.map(s => `
          <button class="picker-subject-btn" data-sid="${s.id}" style="
            padding:10px 18px;border-radius:20px;font-size:0.9rem;border:2px solid #e0e0e0;
            background:#fff;color:#333;cursor:pointer;transition:all 0.2s;
          ">${escapeHtml(s.name)}</button>
        `).join('')}
      </div>
      <button id="picker-confirm-btn" class="btn btn-primary btn-block" disabled style="opacity:0.5;">确认选择</button>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  const selectedIds = new Set();
  const grid = overlay.querySelector('#picker-subjects-grid');
  const confirmBtn = overlay.querySelector('#picker-confirm-btn');
  
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.picker-subject-btn');
    if (!btn) return;
    const sid = parseInt(btn.dataset.sid);
    if (selectedIds.has(sid)) {
      selectedIds.delete(sid);
      btn.style.borderColor = '#e0e0e0';
      btn.style.background = '#fff';
      btn.style.color = '#333';
    } else {
      selectedIds.add(sid);
      btn.style.borderColor = '#4a90d9';
      btn.style.background = '#4a90d9';
      btn.style.color = '#fff';
    }
    confirmBtn.disabled = selectedIds.size === 0;
    confirmBtn.style.opacity = selectedIds.size === 0 ? '0.5' : '1';
  });
  
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '保存中...';
    try {
      await API.put('/api/user/subjects', { selected_subjects: Array.from(selectedIds) });
      overlay.remove();
      showToast('学科已设置 ✓');
    } catch (e) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认选择';
    }
  };
}

// ============================================================
// FEATURE 3: Batch Mistake Entry
// ============================================================

let batchCards = [{ question: '', correct_answer: '', wrong_answer: '', error_reason: '', error_reason_type: '', tags: [] }];
let mistakeBatchMode = 'manual'; // 'manual' or 'batch'
let mistakeBatchParsed = []; // parsed cards from text import
let _batchChaptersCache = []; // cached chapters for batch form subject {id, title, unit_number}

// --- Tag Library Cache & Reference ---
const _tagLibraryCache = {}; // { subjectId: { "chapter_title": ["tag1","tag2"], ... } }

async function loadTagLibrary(subjectId) {
  if (!subjectId) return null;
  if (_tagLibraryCache[subjectId]) return _tagLibraryCache[subjectId];
  try {
    const data = await API.get(`/api/tag-library?subject_id=${subjectId}`);
    _tagLibraryCache[subjectId] = data.tags || {};
    return _tagLibraryCache[subjectId];
  } catch (e) {
    console.error('Failed to load tag library:', e);
    return null;
  }
}

function renderTagReferenceHTML(tagsByChapter, options = {}) {
  const { isMixed, currentChapterTitle, maxVisible = 30 } = options;
  if (!tagsByChapter || Object.keys(tagsByChapter).length === 0) {
    return `<div class="tag-reference-area"><div class="tag-reference-title">🏷️ 可用标签</div><div class="tag-reference-empty">暂无预定义标签</div></div>`;
  }

  let chaptersToShow = {};
  if (!isMixed && currentChapterTitle) {
    // Single chapter mode: show only the current chapter's tags
    const tags = tagsByChapter[currentChapterTitle];
    if (tags && tags.length > 0) {
      chaptersToShow = { [currentChapterTitle]: tags };
    }
  } else {
    // Mixed mode or no chapter selected: show all
    chaptersToShow = tagsByChapter;
  }

  const chapterNames = Object.keys(chaptersToShow);
  if (chapterNames.length === 0) {
    return `<div class="tag-reference-area"><div class="tag-reference-title">🏷️ 可用标签</div><div class="tag-reference-empty">当前章节暂无预定义标签</div></div>`;
  }

  let totalTags = 0;
  let chaptersHTML = '';
  for (const [chName, tags] of Object.entries(chaptersToShow)) {
    if (!tags || tags.length === 0) continue;
    totalTags += tags.length;
    const chipsHTML = tags.map(t => `<span class="tag-ref-chip">${escapeHtml(t)}</span>`).join('');
    const showChapterHeader = isMixed || chapterNames.length > 1;
    chaptersHTML += `
      <div class="tag-reference-chapter">
        ${showChapterHeader ? `<div class="tag-reference-chapter-name">${escapeHtml(chName)}</div>` : ''}
        <div class="tag-reference-tags">${chipsHTML}</div>
      </div>`;
  }

  if (totalTags === 0) {
    return `<div class="tag-reference-area"><div class="tag-reference-title">🏷️ 可用标签</div><div class="tag-reference-empty">当前章节暂无预定义标签</div></div>`;
  }

  const modeLabel = isMixed ? '（混合模式 · 全部章节）' : (currentChapterTitle ? `（${currentChapterTitle}）` : '');
  return `
    <div class="tag-reference-area">
      <div class="tag-reference-title">🏷️ 可用标签 ${modeLabel} <span style="font-weight:400;font-size:0.75rem;">共 ${totalTags} 个</span></div>
      ${chaptersHTML}
      <div class="tag-reference-hint">💡 不确定怎么选？把题目发给豆包，让它帮你按上面的标签归类后复制过来～</div>
    </div>`;
}

function updateTagReference(containerId, subjectId, chapterSelectId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const chapterSelect = document.getElementById(chapterSelectId);
  const isMixed = chapterSelect && chapterSelect.value === 'mixed';
  const chapterTitle = chapterSelect && chapterSelect.value && chapterSelect.value !== 'mixed'
    ? chapterSelect.options[chapterSelect.selectedIndex]?.text : null;

  if (!subjectId) {
    container.innerHTML = '';
    return;
  }

  loadTagLibrary(subjectId).then(tags => {
    if (!tags) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = renderTagReferenceHTML(tags, {
      isMixed,
      currentChapterTitle: isMixed ? null : chapterTitle
    });
  });
}

function updateFormatGuide(guideId, isMixed) {
  const guide = document.getElementById(guideId);
  if (!guide) return;
  if (isMixed) {
    guide.classList.remove('show-single');
    guide.classList.add('show-mixed');
  } else {
    guide.classList.remove('show-mixed');
    guide.classList.add('show-single');
  }
}

function renderBatchMistakes() {
  return `
    <div class="page">
      <div class="top-bar">
        <button class="back-btn" data-action="nav-mistakes">←</button>
        <h1>批量录入</h1>
        <div></div>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <div class="form-group">
          <label class="form-label">学科</label>
          <select class="form-input" id="batch-subject">
            <option value="">Select subject</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">章节</label>
          <select class="form-input" id="batch-chapter">
            <option value="">Select subject first</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <!-- Tags input removed - now per-question -->
        </div>
        <!-- Mixed mode chapter-tag panel -->
        <div id="mixed-chapter-tag-panel" style="display:none;margin-top:12px;padding:12px;background:#f8f9fa;border-radius:8px;border:1px solid #e0e0e0;">
          <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:8px;">🔀 混合模式：选择章节和标签</div>
          <div id="mixed-chapter-list" style="max-height:200px;overflow-y:auto;"></div>
        </div>
        <!-- Tag reference area -->
        <div id="batch-tag-reference"></div>
      </div>

      <!-- Text Batch Import Mode (only mode) -->
      <div id="mistake-batch-panel">
        <div class="card mb-16">
          <details class="batch-format-guide show-single" id="mistake-batch-format-guide">
            <summary>📖 格式说明（点击展开）</summary>
            <div class="batch-guide-content">
              <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:0.85rem;color:#856404;">💡 不知道怎么排版？拍照上传题目给豆包，让它帮你整理成下面的格式再粘贴回来就行</div>
              <p><b>支持的格式：</b>每道题用题号开头（1. 2. 3. 或 一、二、三、），答案用"答案："标记，错误答案用"我写了："标记。</p>
              <div class="guide-single">
                <p><b>可选字段：</b>标签：可写在每道题后面。错因：必填，仅限四种类型。单章节模式无需写章节。</p>
                <p><b>错因类型（必填）：</b>仅限以下四种，写"错因：知识性错误 / 概念混淆 / 方法错误 / 粗心失误"即可。也支持模糊关键词（如"计算粗心"→粗心失误，"公式记错"→知识性错误）自动归类。</p>
                <p><b>填空题示例：</b></p>
<pre>1. 求函数f(x)=x²+2x的导数
答案：f'(x)=2x+2
我写了：f'(x)=2x
错因：知识性错误
标签：导数

2. sin(π/6) = ?
答案：1/2
我的答案：√3/2
标签：三角函数</pre>
                <p><b>选择题示例：</b></p>
<pre>3. 下列哪个是质数？
A. 4
B. 7
C. 9
D. 15
答案：B
我写了：C
错因：粗心失误
标签：质数与合数</pre>
              </div>
              <div class="guide-mixed">
                <p><b>可选字段：</b>标签：可写在每道题后面。错因：必填，仅限四种类型。章节：混合模式每题<b>必须写章节</b>。</p>
                <p><b>填空题示例：</b></p>
<pre>1. 求函数f(x)=x²+2x的导数
答案：f'(x)=2x+2
我写了：f'(x)=2x
错因：知识性错误
章节：chapter3
标签：导数

2. sin(π/6) = ?
答案：1/2
我的答案：√3/2
章节：chapter3
标签：三角函数</pre>
                <p><b>选择题示例：</b></p>
<pre>3. 下列哪个是质数？
A. 4
B. 7
C. 9
D. 15
答案：B
我写了：C
错因：粗心失误
章节：chapter1
标签：质数与合数</pre>
              </div>
              <p><b>自动识别题型：</b>有 ABCD 选项 → 选择题，否则 → 填空题。</p>
              <p><b>多小题大题：</b>在一道题内用 (a) (b) (c) 或 (1) (2) (3) 标记小题，每个小题单独写答案和错因。</p>
<pre>1. 物体从静止开始做匀加速直线运动，加速度为2m/s²，求：
(a) 3秒后的速度
答案：6m/s
我写了：5m/s
错因：粗心失误
(b) 3秒内的位移
答案：9m
我写了：9m
(c) 第3秒内的位移
答案：5m
我写了：6m
错因：概念混淆
标签：匀加速直线运动</pre>
              <p><b>答案标记：</b>答案：/ Answer: / 正确答案：均可</p>
              <p><b>错误答案标记：</b>我写了：/ 我的答案：/ 错误答案：/ 我答的：均可</p>
              <p><b>章节格式：</b>支持 chapter1、chapter 1、章节一、U1 等多种写法。混合章节模式时每道题可写不同章节。</p>
              <p><b>标签：</b>写具体知识点（如"牛顿第二定律"），不要写"粗心""易错"等主观评价，那些写在错因里。</p>
            </div>
          </details>
          <div class="form-group" style="margin-top:12px;">
            <label class="form-label">粘贴错题内容</label>
            <textarea class="form-input batch-textarea" id="mistake-batch-input" placeholder="在此粘贴错题文本..." rows="10"></textarea>
          </div>
          <button class="btn btn-primary btn-block" id="mistake-batch-parse-btn">🔍 解析错题</button>
        </div>

        <div id="mistake-batch-result-area" style="display:none;">
          <div class="section-header">
            <span class="section-title">解析结果 (<span id="mistake-batch-count">0</span> 题)</span>
          </div>
          <div id="mistake-batch-cards-list"></div>
          <div style="padding:0 12px;margin-top:12px;">
            <button class="btn btn-secondary btn-block" id="mistake-batch-add-btn" style="margin-bottom:12px;">+ 再加一道</button>
            <button class="btn btn-primary btn-block" data-action="submit-batch" id="submit-batch-btn-2">📤 提交全部</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderBatchCards() {
  return batchCards.map((card, i) => `
    <div class="card" style="margin-bottom:10px;position:relative;">
      ${batchCards.length > 1 ? `<button onclick="removeBatchCard(${i})" style="position:absolute;top:8px;right:8px;background:none;border:none;font-size:1.2rem;color:#999;cursor:pointer;padding:4px;">✕</button>` : ''}
      <div style="font-size:0.8rem;color:var(--text-tertiary);margin-bottom:8px;">第 ${i + 1} 题</div>
      <div class="form-group">
        <label class="form-label" style="font-size:0.85rem;">题目</label>
        <textarea class="form-input" id="batch-q-${i}" placeholder="输入题目内容..." rows="6" style="min-height:120px;" oninput="batchCards[${i}].question=this.value;document.getElementById('batch-q-preview-${i}').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>预览区</span>'" style="font-size:0.9rem;">${escapeHtml(card.question)}</textarea>
        <div id="batch-q-preview-${i}" class="edit-preview-box">${renderSubSup(card.question) || '<span style="color:#bbb">预览区</span>'}</div>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size:0.85rem;">正确答案</label>
        <input class="form-input" id="batch-ca-${i}" placeholder="正确答案" value="${escapeHtml(card.correct_answer)}" oninput="batchCards[${i}].correct_answer=this.value;document.getElementById('batch-ca-preview-${i}').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>答案预览</span>'" style="font-size:0.9rem;" />
        <div id="batch-ca-preview-${i}" class="edit-preview-box" style="margin-top:6px;padding:8px 12px;min-height:28px;">${renderSubSup(card.correct_answer) || '<span style="color:#bbb">答案预览</span>'}</div>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size:0.85rem;">你的错误答案 <span style="color:var(--danger,#E07A6F);font-weight:400;font-size:0.75rem;">*必填</span></label>
        <input class="form-input sym-target" id="batch-wa-${i}" placeholder="你写的答案" value="${escapeHtml(card.wrong_answer)}" oninput="batchCards[${i}].wrong_answer=this.value;document.getElementById('batch-wa-preview-${i}').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>答案预览</span>'" style="font-size:0.9rem;" />
        <div id="batch-wa-preview-${i}" class="edit-preview-box" style="margin-top:6px;padding:8px 12px;min-height:28px;background:var(--danger-light,#FDF0EE);color:var(--danger,#E07A6F);">${renderSubSup(card.wrong_answer) || '<span style="color:#bbb">答案预览</span>'}</div>
        <div class="symbol-bar-wrap"></div>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label" style="font-size:0.85rem;">标签 <span style="font-weight:400;font-size:0.75rem;color:var(--text-tertiary);">回车或逗号添加</span></label>
        <div class="tag-input-container" id="batch-card-tags-${i}">
          <div class="tag-chips" id="batch-card-chips-${i}"></div>
          <input type="text" class="tag-input" id="batch-card-tag-input-${i}" placeholder="输入标签..." autocomplete="off" />
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label" style="font-size:0.85rem;">错因类型 <span style="color:var(--danger,#E07A6F);font-weight:400;font-size:0.75rem;">*必填</span> <span style="font-weight:400;font-size:0.75rem;color:var(--text-tertiary);">（仅限：知识性错误/概念混淆/方法错误/粗心失误）</span></label>
        ${renderErrorReasonTypeSelect(`batch-ert-${i}`, card.error_reason_type || '', `batchCards[${i}].error_reason_type=this.value`)}
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label" style="font-size:0.85rem;">错因补充</label>
        <textarea class="form-input" id="batch-er-${i}" placeholder="补充说明(可选)" rows="2" oninput="batchCards[${i}].error_reason=this.value" style="font-size:0.9rem;">${escapeHtml(card.error_reason)}</textarea>
      </div>
    </div>
  `).join('');
}

function addBatchCard() {
  batchCards.push({ question: '', correct_answer: '', wrong_answer: '', error_reason: '', error_reason_type: '', tags: [] });
  const container = document.getElementById('batch-cards-container');
  if (container) {
    container.innerHTML = renderBatchCards();
    initAutoExpandTextareas();
    initBatchCardTagInputs();
    const cards = container.querySelectorAll('.card');
    if (cards.length > 0) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function removeBatchCard(index) {
  if (batchCards.length <= 1) return;
  batchCards.splice(index, 1);
  const container = document.getElementById('batch-cards-container');
  if (container) {
    container.innerHTML = renderBatchCards();
    initBatchCardTagInputs();
  }
}

function initBatchCardTagInputs() {
  batchCards.forEach((card, i) => {
    const chipsId = `batch-card-chips-${i}`;
    const inputId = `batch-card-tag-input-${i}`;
    const chipsEl = document.getElementById(chipsId);
    const inputEl = document.getElementById(inputId);
    if (chipsEl && inputEl) {
      // Render existing tags as chips
      renderBatchCardTagChips(i);
      // Add input handler
      inputEl.onkeydown = (e) => {
        if ((e.key === 'Enter' || e.key === ',') && inputEl.value.trim()) {
          e.preventDefault();
          const tag = inputEl.value.trim().replace(/,/g, '');
          if (tag && !batchCards[i].tags.includes(tag)) {
            batchCards[i].tags.push(tag);
            renderBatchCardTagChips(i);
          }
          inputEl.value = '';
        }
      };
    }
  });
}

function renderBatchCardTagChips(cardIndex) {
  const chipsEl = document.getElementById(`batch-card-chips-${cardIndex}`);
  if (!chipsEl) return;
  chipsEl.innerHTML = batchCards[cardIndex].tags.map((tag, ti) => 
    `<span class="tag-chip" onclick="batchCards[${cardIndex}].tags.splice(${ti},1);renderBatchCardTagChips(${cardIndex});">${escapeHtml(tag)} ✕</span>`
  ).join('');
}

// --- Mistake Text Batch Import Parser ---
function parseMistakeBatchText(text) {
  if (!text || !text.trim()) return [];
  
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Split into question blocks by numbered items
  // Note: (1)(2)(3) are NOT block starters — they are sub-question markers inside a block
  const blocks = [];
  const lines = text.split('\n');
  let currentBlock = null;
  
  const isQuestionStart = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\d{1,3}\s*[\.、)\）]/.test(trimmed)) return true;
    if (/^[一二三四五六七八九十]+\s*[\.、]/.test(trimmed)) return true;
    return false;
  };
  
  const stripQuestionNumber = (line) => {
    return line.trim()
      .replace(/^\d{1,3}\s*[\.、)\）]\s*/, '')
      .replace(/^[一二三四五六七八九十]+\s*[\.、]\s*/, '');
  };
  
  for (const line of lines) {
    if (isQuestionStart(line)) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = stripQuestionNumber(line);
    } else if (currentBlock !== null) {
      currentBlock += '\n' + line;
    }
  }
  if (currentBlock) blocks.push(currentBlock);
  
  const mistakes = [];
  for (const block of blocks) {
    const m = parseMistakeBlock(block);
    if (m) mistakes.push(m);
  }
  
  return mistakes;
}

function parseMistakeBlock(block) {
  const lines = block.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return null;
  
  // Find answer line: 答案：/ Answer: / 正确答案：
  let answer = '';
  let answerLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const ansMatch = line.match(/^(?:【答案】|正确答案\s*[：:]|答案\s*[：:]|Answer\s*[：:])\s*(.+)/i);
    if (ansMatch) {
      answer = ansMatch[1].trim();
      answerLineIdx = i;
      break;
    }
  }
  
  // Find wrong answer line: 我写了：/ 我的答案：/ 错误答案：/ 我答的：
  let wrongAnswer = '';
  let wrongLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (i === answerLineIdx) continue;
    const line = lines[i];
    const wrongMatch = line.match(/^(?:我写了\s*[：:]|我的答案\s*[：:]|错误答案\s*[：:]|我答的\s*[：:])\s*(.+)/i);
    if (wrongMatch) {
      wrongAnswer = wrongMatch[1].trim();
      wrongLineIdx = i;
      break;
    }
  }
  
  // Collect lines that are NOT answer, wrong answer, or error reason
  const skipIdxs = new Set();
  if (answerLineIdx >= 0) skipIdxs.add(answerLineIdx);
  if (wrongLineIdx >= 0) skipIdxs.add(wrongLineIdx);
  
  // Also look for error reason: 错因：/ 错因分析：
  let errorReason = '';
  let errorReasonType = '';
  let errorReasonIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (skipIdxs.has(i)) continue;
    const line = lines[i];
    const errMatch = line.match(/^(?:错因(?:分析)?(?:类型)?\s*[：:])\s*(.+)/);
    if (errMatch) {
      const raw = errMatch[1].trim();
      // Try to match to a known error_reason_type
      const matchedType = ERROR_REASON_TYPES.find(t => t.value === raw || raw.includes(t.value));
      if (matchedType) {
        errorReasonType = matchedType.value;
        // Any remaining text after the type match goes to errorReason
        const remainder = raw.replace(matchedType.value, '').replace(/[，,、]/, '').trim();
        if (remainder) errorReason = remainder;
      } else {
        // Try fuzzy matching
        const fuzzyMap = {
          '知识': '知识性错误', '基础': '知识性错误', '不会': '知识性错误', '不懂': '知识性错误', '零基础': '知识性错误',
          '混淆': '概念混淆', '搞混': '概念混淆', '记混': '概念混淆', '分不清': '概念混淆',
          '方法': '方法错误', '用错': '方法错误', '选错': '方法错误', '套路': '方法错误',
          '粗心': '粗心失误', '计算': '粗心失误', '看错': '粗心失误', '漏写': '粗心失误', '审题': '粗心失误', '忽略': '粗心失误',
        };
        let fuzzyMatch = null;
        for (const [kw, type] of Object.entries(fuzzyMap)) {
          if (raw.includes(kw)) { fuzzyMatch = type; break; }
        }
        if (fuzzyMatch) {
          errorReasonType = fuzzyMatch;
        }
        errorReason = raw; // Keep original text as supplementary
      }
      errorReasonIdx = i;
      skipIdxs.add(i);
      break;
    }
  }
  
  // Look for chapter: 章节：chapter1 / 章节一 / chapter 一
  let chapterTitle = '';
  let chapterIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (skipIdxs.has(i)) continue;
    const line = lines[i];
    const chapMatch = line.match(/^(?:章节\s*[：:]\s*)(.+)/);
    if (chapMatch) {
      chapterTitle = chapMatch[1].trim();
      chapterIdx = i;
      skipIdxs.add(i);
      break;
    }
  }
  
  // Look for tags: 标签：xxx, yyy
  let tagsStr = '';
  let tagsIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (skipIdxs.has(i)) continue;
    const line = lines[i];
    const tagMatch = line.match(/^(?:标签\s*[：:]\s*)(.+)/);
    if (tagMatch) {
      tagsStr = tagMatch[1].trim();
      tagsIdx = i;
      skipIdxs.add(i);
      break;
    }
  }
  
  // Remaining lines: question text + possible options
  const qLines = lines.filter((_, i) => !skipIdxs.has(i));
  
  // Detect choice options (A. B. C. D.)
  const optionPattern = /^[A-Ea-e]\s*[\.、)\）]\s*/;
  const optionLines = [];
  let questionTextLines = [];
  let foundOptions = false;
  
  for (const line of qLines) {
    if (optionPattern.test(line.trim())) {
      foundOptions = true;
      optionLines.push(line.trim());
    } else if (!foundOptions) {
      questionTextLines.push(line);
    } else {
      // Continuation of last option
      if (optionLines.length > 0) {
        optionLines[optionLines.length - 1] += ' ' + line.trim();
      }
    }
  }
  
  let questionText = questionTextLines.join('\n').trim();
  if (!questionText) return null;
  
  if (foundOptions && optionLines.length >= 2) {
    // Choice question - build full question with options
    const options = optionLines.map(l => l.replace(optionPattern, '').trim());
    // Normalize answer to letter
    let correctOpt = answer.trim().toUpperCase();
    const letterMatch = correctOpt.match(/([A-E])/);
    correctOpt = letterMatch ? letterMatch[1] : answer;
    
    // Build full question text including options
    const fullQuestion = questionText + '\n' + optionLines.join('\n');
    
    // Also normalize wrong answer
    let wrongOpt = wrongAnswer.trim().toUpperCase();
    const wrongLetterMatch = wrongOpt.match(/([A-E])/);
    if (wrongLetterMatch) {
      wrongOpt = wrongLetterMatch[1];
    }
    
    return {
      type: 'choice',
      question: fullQuestion,
      correct_answer: correctOpt,
      wrong_answer: wrongOpt,
      error_reason: errorReason,
      error_reason_type: errorReasonType,
      chapter_title: chapterTitle,
      tags: tagsStr,
      _options: options
    };
  } else {
    // Fill-in question
    return {
      type: 'fill',
      question: questionText,
      correct_answer: answer,
      wrong_answer: wrongAnswer,
      error_reason: errorReason,
      error_reason_type: errorReasonType,
      chapter_title: chapterTitle,
      tags: tagsStr
    };
  }
}

// Toggle a parsed card between render and edit mode
function toggleMistakeBatchCardEdit(i) {
  if (mistakeBatchParsed[i]._editing) {
    // Currently editing → save values back and switch to render
    const q = document.getElementById(`mb-q-${i}`);
    const ca = document.getElementById(`mb-ca-${i}`);
    const wa = document.getElementById(`mb-wa-${i}`);
    const er = document.getElementById(`mb-er-${i}`);
    const ert = document.getElementById(`mb-ert-${i}`);
    if (q) mistakeBatchParsed[i].question = q.value;
    if (ca) mistakeBatchParsed[i].correct_answer = ca.value;
    if (wa) mistakeBatchParsed[i].wrong_answer = wa.value;
    if (er) mistakeBatchParsed[i].error_reason = er.value;
    if (ert) mistakeBatchParsed[i].error_reason_type = ert.value;
    mistakeBatchParsed[i]._editing = false;
  } else {
    // Render mode → switch to edit
    mistakeBatchParsed[i]._editing = true;
  }
  refreshMistakeBatchCardsDOM();
}

// Render parsed mistake cards with render/edit dual mode
function renderMistakeBatchParsedCards() {
  return mistakeBatchParsed.map((card, i) => {
    const typeBadge = card.type === 'choice' 
      ? '<span class="batch-q-type-badge" style="background:#e3f2fd;color:#1976d2;">选择题</span>'
      : '<span class="batch-q-type-badge">填空题</span>';
    
    const isEditing = card._editing === true;

    if (isEditing) {
      // --- EDIT MODE: textarea / input ---
      return `
        <div class="card" data-mistake-batch-idx="${i}" style="margin-bottom:10px;position:relative;">
          ${mistakeBatchParsed.length > 1 ? `<button onclick="removeMistakeBatchCard(${i})" style="position:absolute;top:8px;right:44px;background:none;border:none;font-size:1.2rem;color:#999;cursor:pointer;padding:4px;">✕</button>` : ''}
          <button onclick="toggleMistakeBatchCardEdit(${i})" class="mb-edit-btn" title="完成编辑">✓ 完成</button>
          <div style="margin-bottom:8px;">${typeBadge} <span style="font-size:0.8rem;color:var(--text-tertiary);">第 ${i + 1} 题</span></div>
          <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:6px 10px;margin-bottom:8px;font-size:0.78rem;color:#856404;">💡 不知道怎么排版？拍照上传题目给豆包，让它帮你整理好格式再粘贴回来就行</div>
          <div class="form-group">
            <label class="form-label" style="font-size:0.85rem;">题目</label>
            <textarea class="form-input" id="mb-q-${i}" placeholder="题目内容..." rows="8" style="min-height:160px;" oninput="mistakeBatchParsed[${i}].question=this.value;document.getElementById('mb-q-preview-${i}').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>预览区</span>'" style="font-size:0.9rem;">${escapeHtml(card.question)}</textarea>
            <div id="mb-q-preview-${i}" class="edit-preview-box">${renderSubSup(card.question) || '<span style="color:#bbb">预览区</span>'}</div>
          </div>
          <div class="form-group">
            <label class="form-label" style="font-size:0.85rem;">正确答案</label>
            <input class="form-input" id="mb-ca-${i}" placeholder="正确答案" value="${escapeHtml(card.correct_answer)}" oninput="mistakeBatchParsed[${i}].correct_answer=this.value;document.getElementById('mb-ca-preview-${i}').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>答案预览</span>'" style="font-size:0.9rem;" />
            <div id="mb-ca-preview-${i}" class="edit-preview-box" style="margin-top:6px;padding:8px 12px;min-height:28px;">${renderSubSup(card.correct_answer) || '<span style="color:#bbb">答案预览</span>'}</div>
          </div>
          <div class="form-group">
            <label class="form-label" style="font-size:0.85rem;">我的错误答案 <span style="color:var(--danger,#E07A6F);font-weight:400;font-size:0.75rem;">*必填</span></label>
            <input class="form-input sym-target" id="mb-wa-${i}" placeholder="你写的答案" value="${escapeHtml(card.wrong_answer)}" oninput="mistakeBatchParsed[${i}].wrong_answer=this.value;document.getElementById('mb-wa-preview-${i}').innerHTML=renderSubSup(this.value)||'<span style=color:#bbb>答案预览</span>'" style="font-size:0.9rem;" />
            <div id="mb-wa-preview-${i}" class="edit-preview-box" style="margin-top:6px;padding:8px 12px;min-height:28px;background:var(--danger-light,#FDF0EE);color:var(--danger,#E07A6F);">${renderSubSup(card.wrong_answer) || '<span style="color:#bbb">答案预览</span>'}</div>
            <div class="symbol-bar-wrap"></div>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" style="font-size:0.85rem;">错因类型 <span style="color:var(--danger,#E07A6F);font-weight:400;font-size:0.75rem;">*必填</span> <span style="font-weight:400;font-size:0.75rem;color:var(--text-tertiary);">（仅限四种）</span></label>
            ${renderErrorReasonTypeSelect(`mb-ert-${i}`, card.error_reason_type || '', `mistakeBatchParsed[${i}].error_reason_type=this.value`)}
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" style="font-size:0.85rem;">错因补充</label>
            <textarea class="form-input" id="mb-er-${i}" placeholder="补充说明(可选)" rows="2" oninput="mistakeBatchParsed[${i}].error_reason=this.value" style="font-size:0.9rem;">${escapeHtml(card.error_reason || '')}</textarea>
          </div>
        </div>
      `;
    }

    // --- RENDER MODE: rendered math preview ---
    const qHtml = renderSubSup(card.question || '');
    const caHtml = renderSubSup(card.correct_answer || '');
    const waHtml = renderSubSup(card.wrong_answer || '');
    const erHtml = renderSubSup(card.error_reason || '');
    const chapterHtml = card.chapter_display || card.chapter_title || '';
    const tagsHtml = card.tags || '';

    return `
      <div class="card mb-preview-card" data-mistake-batch-idx="${i}" style="margin-bottom:10px;position:relative;">
        ${mistakeBatchParsed.length > 1 ? `<button onclick="removeMistakeBatchCard(${i})" style="position:absolute;top:8px;right:44px;background:none;border:none;font-size:1.2rem;color:#999;cursor:pointer;padding:4px;">✕</button>` : ''}
        <button onclick="toggleMistakeBatchCardEdit(${i})" class="mb-edit-btn" title="编辑">✎ 编辑</button>
        <div style="margin-bottom:8px;">${typeBadge} <span style="font-size:0.8rem;color:var(--text-tertiary);">第 ${i + 1} 题</span></div>
        <div class="form-group">
          <label class="form-label" style="font-size:0.85rem;">题目</label>
          <div class="mb-render-field mb-render-question">${qHtml}</div>
        </div>
        <div class="form-group">
          <label class="form-label" style="font-size:0.85rem;">正确答案</label>
          <div class="mb-render-field mb-render-answer">${caHtml}</div>
        </div>
        <div class="form-group">
          <label class="form-label" style="font-size:0.85rem;">我的错误答案 <span style="color:var(--danger,#E07A6F);font-weight:400;font-size:0.75rem;">*必填</span></label>
          <div class="mb-render-field mb-render-answer mb-render-wrong mb-click-edit" data-field="wrong_answer" data-index="${i}" style="cursor:pointer;min-height:32px;${waHtml ? 'color:var(--danger,#E07A6F);' : ''}">${waHtml || '<span style="color:var(--text-tertiary);font-style:italic;">未填写错误答案</span>'}</div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" style="font-size:0.85rem;">错因类型 <span style="color:var(--danger,#E07A6F);font-weight:400;font-size:0.75rem;">*必填</span> <span style="font-weight:400;font-size:0.75rem;color:var(--text-tertiary);">（仅限：知识性错误/概念混淆/方法错误/粗心失误）</span></label>
          <div class="mb-render-field mb-render-answer" style="min-height:32px;">${renderErrorReasonTypeBadge(card.error_reason_type) || '<span style="color:var(--text-tertiary);font-style:italic;">未选择</span>'}</div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" style="font-size:0.85rem;">错因补充</label>
          <div class="mb-render-field mb-render-answer mb-click-edit" data-field="error_reason" data-index="${i}" style="cursor:pointer;min-height:32px;">${erHtml || '<span style="color:var(--text-tertiary);font-style:italic;">点击填写...</span>'}</div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" style="font-size:0.85rem;">章节</label>
          <div class="mb-render-field mb-render-answer mb-click-edit" data-field="chapter_title" data-index="${i}" style="cursor:pointer;min-height:32px;">${chapterHtml ? renderSubSup(chapterHtml) : '<span style="color:var(--text-tertiary);font-style:italic;">点击选择章节...</span>'}</div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" style="font-size:0.85rem;">标签</label>
          <div class="mb-render-field mb-render-answer mb-click-edit" data-field="tags" data-index="${i}" style="cursor:pointer;min-height:32px;">${tagsHtml ? renderSubSup(tagsHtml) : '<span style="color:var(--text-tertiary);font-style:italic;">点击添加标签...</span>'}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Get recent tags from localStorage
function getRecentTags() {
  try { return JSON.parse(localStorage.getItem('ata_recent_tags') || '[]'); } catch(e) { return []; }
}
function addRecentTag(tag) {
  if (!tag || !tag.trim()) return;
  let tags = getRecentTags().filter(t => t !== tag.trim());
  tags.unshift(tag.trim());
  if (tags.length > 10) tags = tags.slice(0, 10);
  localStorage.setItem('ata_recent_tags', JSON.stringify(tags));
}

// Click-to-edit for error reason, chapter, and tags in batch preview
function initBatchClickToEdit() {
  document.querySelectorAll('.mb-click-edit').forEach(div => {
    div.onclick = async (e) => {
      if (div.querySelector('textarea') || div.querySelector('select')) return;
      const idx = parseInt(div.dataset.index);
      const field = div.dataset.field;
      const currentVal = mistakeBatchParsed[idx][field] || '';
      
      div.style.cursor = 'default';
      
      if (field === 'wrong_answer') {
        // Click-to-edit for wrong answer field
        const input = document.createElement('input');
        input.className = 'form-input sym-target';
        input.value = currentVal;
        input.placeholder = '你写的答案';
        input.style.cssText = 'width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid #d0d0d0;font-size:0.9rem;margin-bottom:4px;box-sizing:border-box;';
        const preview = document.createElement('div');
        preview.className = 'edit-preview-box';
        preview.style.cssText = 'margin-top:4px;padding:6px 10px;min-height:24px;background:var(--danger-light,#FDF0EE);color:var(--danger,#E07A6F);';
        preview.innerHTML = renderSubSup(currentVal) || '<span style="color:#bbb">答案预览</span>';
        const symBar = document.createElement('div');
        symBar.className = 'symbol-bar-wrap';
        const finishBtn = document.createElement('button');
        finishBtn.textContent = '✓ 完成';
        finishBtn.style.cssText = 'font-size:0.75rem;color:var(--accent);background:none;border:none;cursor:pointer;margin-top:4px;padding:2px 0;';
        div.innerHTML = '';
        div.style.cursor = 'default';
        div.appendChild(input);
        div.appendChild(preview);
        div.appendChild(symBar);
        div.appendChild(finishBtn);
        updateSymbolBars(0);
        input.focus();
        input.oninput = () => {
          mistakeBatchParsed[idx].wrong_answer = input.value;
          preview.innerHTML = renderSubSup(input.value) || '<span style="color:#bbb">答案预览</span>';
        };
        finishBtn.onclick = () => {
          mistakeBatchParsed[idx].wrong_answer = input.value;
          const val = input.value.trim();
          div.innerHTML = val ? renderSubSup(val) : '<span style="color:var(--text-tertiary);font-style:italic;">未填写错误答案</span>';
          div.style.cursor = 'pointer';
          div.style.color = val ? 'var(--danger,#E07A6F)' : '';
        };
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finishBtn.onclick(); } };
      } else if (field === 'chapter_title') {
        // Chapter field: show select dropdown with all chapters
        const subjectSelect = document.getElementById('batch-subject');
        const subjectId = subjectSelect ? subjectSelect.value : '';
        let chapters = [];
        if (subjectId) {
          try {
            const data = await API.get(`/api/subjects/${subjectId}/chapters`);
            chapters = data.chapters || [];
          } catch(e) { console.error(e); }
        }
        const options = '<option value="">选择章节...</option>' + 
          chapters.map(c => `<option value="${c.id}" ${currentVal == c.id ? 'selected' : ''}>U${c.unit_number}: ${escapeHtml(c.title)}</option>`).join('');
        div.innerHTML = `<select class="form-input" style="font-size:0.85rem;min-height:32px;border:1px solid #4a90d9;" autofocus>${options}</select>`;
        const sel = div.querySelector('select');
        sel.focus();
        
        sel.onblur = () => {
          const selectedId = sel.value;
          if (selectedId) {
            const selectedChapter = chapters.find(c => c.id == selectedId);
            if (selectedChapter) {
              mistakeBatchParsed[idx].chapter_title = selectedChapter.id;
              mistakeBatchParsed[idx].chapter_display = `U${selectedChapter.unit_number}: ${selectedChapter.title}`;
              div.style.cursor = 'pointer';
              div.innerHTML = renderSubSup(`U${selectedChapter.unit_number}: ${selectedChapter.title}`);
              return;
            }
          }
          div.style.cursor = 'pointer';
          div.innerHTML = '<span style="color:var(--text-tertiary);font-style:italic;">点击选择章节...</span>';
        };
        
        sel.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            sel.blur();
          }
        };
      } else if (field === 'tags') {
        // Tags field: show textarea + recent tags suggestions
        const recentTags = getRecentTags();
        const tagChips = recentTags.length > 0 
          ? '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">' + 
            recentTags.map(t => '<span class="recent-tag-chip" style="background:#e3f2fd;color:#1976d2;padding:2px 8px;border-radius:12px;font-size:0.75rem;cursor:pointer;">' + t + '</span>').join('') + 
            '</div>'
          : '';
        div.innerHTML = '<textarea class="form-input" style="font-size:0.85rem;min-height:32px;border:1px solid #4a90d9;resize:none;" autofocus>' + currentVal + '</textarea>' + tagChips;
        const ta = div.querySelector('textarea');
        ta.focus();
        // Click on tag chip to fill
        div.querySelectorAll('.recent-tag-chip').forEach(chip => {
          chip.onclick = (ev) => {
            ev.stopPropagation();
            ta.value = chip.textContent;
            ta.blur();
          };
        });
        
        ta.onblur = () => {
          let val = ta.value.trim();
          if (val) {
            // 标签识别机制：检测不该写在标签里的内容
            const wrongTagKeywords = ['粗心', '马虎', '计算错误', '公式记错', '概念混淆', '审题不清', '没看清', '笔误', '单位没换算', '忘了', '不会', '不懂', '易错', '容易错'];
            const matched = wrongTagKeywords.find(kw => val.includes(kw));
            if (matched) {
              if (confirm(`"${matched}"这类内容建议写在「错因分析」里，标签应该写具体知识点名称（如"牛顿第二定律"）。\n\n确定要用作标签吗？`)) {
                mistakeBatchParsed[idx][field] = val;
                addRecentTag(val);
              } else {
                mistakeBatchParsed[idx][field] = '';
                val = '';
              }
            } else {
              mistakeBatchParsed[idx][field] = val;
              addRecentTag(val);
            }
          } else {
            mistakeBatchParsed[idx][field] = val;
          }
          div.style.cursor = 'pointer';
          if (val) {
            div.innerHTML = renderSubSup(val);
          } else {
            div.innerHTML = '<span style="color:var(--text-tertiary);font-style:italic;">点击添加标签...</span>';
          }
        };
        
        ta.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            ta.blur();
          }
        };
      } else {
        // Error reason field
        div.innerHTML = '<textarea class="form-input" style="font-size:0.85rem;min-height:60px;border:1px solid #4a90d9;resize:vertical;" autofocus>' + currentVal + '</textarea>';
        const ta = div.querySelector('textarea');
        ta.focus();
        
        ta.onblur = () => {
          mistakeBatchParsed[idx][field] = ta.value;
          div.style.cursor = 'pointer';
          const val = ta.value.trim();
          if (val) {
            div.innerHTML = renderSubSup(val);
          } else {
            div.innerHTML = '<span style="color:var(--text-tertiary);font-style:italic;">点击填写...</span>';
          }
        };
        
        ta.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            ta.blur();
          }
        };
      }
    };
  });
}



// Auto-expand textareas
function autoExpandTextarea(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function initAutoExpandTextareas() {
  document.querySelectorAll('textarea.form-input').forEach(ta => {
    autoExpandTextarea(ta);
    ta.oninput = function() {
      autoExpandTextarea(this);
      // Also call the original oninput handler if it exists
      const origHandler = this.getAttribute('oninput');
      if (origHandler && !origHandler.includes('autoExpand')) {
        // The inline oninput will still fire
      }
    };
    ta.onfocus = function() { autoExpandTextarea(this); };
  });
}

function removeMistakeBatchCard(index) {
  if (mistakeBatchParsed.length <= 1) return;
  mistakeBatchParsed.splice(index, 1);
  const list = document.getElementById('mistake-batch-cards-list');
  if (list) {
    list.innerHTML = renderMistakeBatchParsedCards();
    initBatchClickToEdit();
    initBatchClickToEdit();
    initAutoExpandTextareas();
  }
  const countEl = document.getElementById('mistake-batch-count');
  if (countEl) countEl.textContent = mistakeBatchParsed.length;
}

function refreshMistakeBatchCardsDOM() {
  const list = document.getElementById('mistake-batch-cards-list');
  if (list) list.innerHTML = renderMistakeBatchParsedCards();
  const countEl = document.getElementById('mistake-batch-count');
  if (countEl) countEl.textContent = mistakeBatchParsed.length;
  initBatchClickToEdit();
}

function syncMistakeBatchParsedCards() {
  mistakeBatchParsed.forEach((card, i) => {
    // Only sync from DOM if currently in edit mode (DOM has textarea/input)
    if (card._editing) {
      const q = document.getElementById(`mb-q-${i}`);
      const ca = document.getElementById(`mb-ca-${i}`);
      const wa = document.getElementById(`mb-wa-${i}`);
      const er = document.getElementById(`mb-er-${i}`);
      const ert = document.getElementById(`mb-ert-${i}`);
      if (q) card.question = q.value;
      if (ca) card.correct_answer = ca.value;
      if (wa) card.wrong_answer = wa.value;
      if (er) card.error_reason = er.value;
      if (ert) card.error_reason_type = ert.value;
    }
    // In render mode, data is already up-to-date in mistakeBatchParsed[]
  });
}

// Resolve parsed chapter_title (e.g. "chapter6") to display name using cached chapter data
function resolveParsedChapterTitles() {
  if (_batchChaptersCache.length === 0 || mistakeBatchParsed.length === 0) return;
  const cnMap = {1:'一',2:'二',3:'三',4:'四',5:'五',6:'六',7:'七',8:'八',9:'九',10:'十',11:'十一',12:'十二'};
  
  mistakeBatchParsed.forEach(card => {
    if (!card.chapter_title) return;
    const raw = card.chapter_title.trim();
    
    // Extract unit number from various formats: "chapter6", "chapter 6", "章节六", "u6", etc.
    let unitNum = null;
    const numMatch = raw.match(/(\d{1,2})/);
    if (numMatch) {
      unitNum = parseInt(numMatch[1]);
    } else {
      // Try Chinese numerals
      for (const [num, cn] of Object.entries(cnMap)) {
        if (raw.includes(cn) || raw.includes(`章节${cn}`)) {
          unitNum = parseInt(num);
          break;
        }
      }
    }
    
    if (unitNum !== null) {
      // Find matching chapter in cache
      const matched = _batchChaptersCache.find(c => c.unit_number === unitNum);
      if (matched) {
        card.chapter_display = `章节${cnMap[unitNum] || unitNum}：${matched.title}`;
        // Keep chapter_title as-is for backend submission
      }
    }
  });
}

async function loadBatchMistakesInit() {
  const subjectSelect = document.getElementById('batch-subject');
  if (!subjectSelect) return;
  try {
    const [userData, allData] = await Promise.all([
      API.get('/api/user/subjects'),
      API.get('/api/subjects')
    ]);
    const selectedIds = userData.selected_subjects || [];
    const filtered = allData.subjects.filter(s => selectedIds.includes(s.id));
    subjectSelect.innerHTML = '<option value="">Select subject</option>' +
      filtered.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    subjectSelect.onchange = async () => {
      await loadChaptersForSelect(subjectSelect.value, 'batch-chapter');
      // Cache chapter data for title resolution
      try {
        const chapData = await API.get(`/api/subjects/${subjectSelect.value}/chapters`);
        _batchChaptersCache = chapData.chapters || [];
        // Resolve parsed chapter titles to real names
        resolveParsedChapterTitles();
        refreshMistakeBatchCardsDOM();
      } catch(e) { console.error('Failed to cache chapters:', e); }
      // Reload tags by chapter when subject changes
      await loadTagsByChapter(subjectSelect.value);
      // Re-init tag input with current chapter (will be null if no chapter selected yet)
      const chapterSelect = document.getElementById('batch-chapter');
      initTagInput('batch-tag-chips', 'batch-tags-input', 'batch-tags-autocomplete', chapterSelect && chapterSelect.value ? parseInt(chapterSelect.value) : null);
      // Update tag reference
      updateTagReference('batch-tag-reference', subjectSelect.value, 'batch-chapter');
    };
  } catch (e) { console.error(e); }

  // Tab switching for mistake batch mode
  document.querySelectorAll('[data-mistake-batch-tab]').forEach(tab => {
    tab.onclick = () => {
      const mode = tab.dataset.mistakeBatchTab;
      mistakeBatchMode = mode;
      document.querySelectorAll('[data-mistake-batch-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const manualPanel = document.getElementById('mistake-manual-panel');
      const batchPanel = document.getElementById('mistake-batch-panel');
      if (manualPanel) manualPanel.style.display = mode === 'manual' ? 'block' : 'none';
      if (batchPanel) batchPanel.style.display = mode === 'batch' ? 'block' : 'none';
    };
  });

  // Batch parse button
  const parseBtn = document.getElementById('mistake-batch-parse-btn');
  if (parseBtn) {
    parseBtn.onclick = () => {
      const input = document.getElementById('mistake-batch-input');
      if (!input || !input.value.trim()) {
        showToast('请先粘贴错题内容');
        return;
      }
      const parsed = parseMistakeBatchText(input.value);
      if (parsed.length === 0) {
        showToast('未能识别出错题，请检查格式');
        return;
      }
      mistakeBatchParsed = parsed;
      // Resolve chapter titles to display names if chapters are cached
      resolveParsedChapterTitles();
      const resultArea = document.getElementById('mistake-batch-result-area');
      if (resultArea) resultArea.style.display = 'block';
      refreshMistakeBatchCardsDOM();
      showToast(`成功解析 ${parsed.length} 道错题`);
    };
  }

  // Batch add button
  const addBtn = document.getElementById('mistake-batch-add-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      syncMistakeBatchParsedCards();
      mistakeBatchParsed.push({ type: 'fill', question: '', correct_answer: '', wrong_answer: '', error_reason: '', error_reason_type: '' });
      refreshMistakeBatchCardsDOM();
      const list = document.getElementById('mistake-batch-cards-list');
      if (list) {
        const cards = list.querySelectorAll('.card');
        if (cards.length > 0) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
  }

  // Initialize tag input for batch mistakes - load tags by chapter
  await loadTagsByChapter();
  const batchChapterSelect = document.getElementById('batch-chapter');
  initTagInput('batch-tag-chips', 'batch-tags-input', 'batch-tags-autocomplete', batchChapterSelect && batchChapterSelect.value ? parseInt(batchChapterSelect.value) : null);
  
  // Add chapter change listener to re-init tag input with new chapter
  if (batchChapterSelect) {
    const origOnchange = batchChapterSelect.onchange;
    batchChapterSelect.onchange = () => {
      if (origOnchange) origOnchange.call(batchChapterSelect);
      // Re-init tag input with new chapter
      initTagInput('batch-tag-chips', 'batch-tags-input', 'batch-tags-autocomplete', batchChapterSelect.value ? parseInt(batchChapterSelect.value) : null);
      // Update tag reference & format guide
      const subjectSelect = document.getElementById('batch-subject');
      const isMixed = batchChapterSelect.value === 'mixed';
      updateTagReference('batch-tag-reference', subjectSelect?.value, 'batch-chapter');
      updateFormatGuide('mistake-batch-format-guide', isMixed);
    };
  }

  // Initial tag reference load if subject/chapter already selected
  const initSubjectId = subjectSelect?.value;
  if (initSubjectId) {
    updateTagReference('batch-tag-reference', initSubjectId, 'batch-chapter');
    const initIsMixed = batchChapterSelect && batchChapterSelect.value === 'mixed';
    updateFormatGuide('mistake-batch-format-guide', initIsMixed);
  }
}

function highlightMissingChapterCards(allCards, validCards) {
  clearMissingChapterHighlights();
  // Find indices of valid cards missing chapter_title
  let validIdx = 0;
  allCards.forEach((card, i) => {
    if (card.question.trim() && card.correct_answer.trim() && !card.chapter_title) {
      // For batch parsed mode, look for the card by data attribute
      const el = document.querySelector(`[data-batch-idx="${i}"]`) ||
                 document.querySelector(`[data-mistake-batch-idx="${i}"]`);
      if (el) {
        el.classList.add('batch-q-missing-chapter');
        // Add hint if not already present
        if (!el.querySelector('.batch-q-missing-chapter-hint')) {
          const hint = document.createElement('div');
          hint.className = 'batch-q-missing-chapter-hint';
          hint.textContent = '⚠️ 混合模式下每题必须指定章节';
          el.appendChild(hint);
        }
      }
    }
  });
}

function clearMissingChapterHighlights() {
  document.querySelectorAll('.batch-q-missing-chapter').forEach(el => {
    el.classList.remove('batch-q-missing-chapter');
    const hint = el.querySelector('.batch-q-missing-chapter-hint');
    if (hint) hint.remove();
  });
}

async function handleSubmitBatch() {
  // Clear any previous missing-chapter highlights
  clearMissingChapterHighlights();
  const chapterSelect = document.getElementById('batch-chapter');
  if (!chapterSelect || !chapterSelect.value) {
    showToast('请先选择章节');
    return;
  }
  
  const isMixedMode = chapterSelect.value === 'mixed';
  
  // Read cards directly from DOM — always the source of truth
  // Count how many card containers exist in the batch panel
  const cardContainers = document.querySelectorAll('[data-mistake-batch-idx]');
  let cardsToSubmit = [];
  
  cardContainers.forEach((container, i) => {
    // Check if card is in edit mode (has textarea/input) or render mode (preview)
    const isEditing = mistakeBatchParsed[i] && mistakeBatchParsed[i]._editing === true;
    
    if (isEditing) {
      // EDIT MODE: read from DOM textarea/input elements
      const q = document.getElementById(`mb-q-${i}`) || document.getElementById(`batch-q-${i}`);
      const ca = document.getElementById(`mb-ca-${i}`) || document.getElementById(`batch-ca-${i}`);
      const wa = document.getElementById(`mb-wa-${i}`) || document.getElementById(`batch-wa-${i}`);
      const er = document.getElementById(`mb-er-${i}`) || document.getElementById(`batch-er-${i}`);
      const ert = document.getElementById(`mb-ert-${i}`) || document.getElementById(`batch-ert-${i}`);
      const ch = document.getElementById(`mb-ch-${i}`) || document.getElementById(`batch-ch-${i}`);
      const tg = document.getElementById(`mb-tg-${i}`) || document.getElementById(`batch-tg-${i}`);
      
      cardsToSubmit.push({
        question: q ? q.value.trim() : (mistakeBatchParsed[i]?.question || ''),
        correct_answer: ca ? ca.value.trim() : (mistakeBatchParsed[i]?.correct_answer || ''),
        wrong_answer: wa ? wa.value.trim() : (mistakeBatchParsed[i]?.wrong_answer || ''),
        error_reason: er ? er.value.trim() : (mistakeBatchParsed[i]?.error_reason || ''),
        error_reason_type: ert ? ert.value : (mistakeBatchParsed[i]?.error_reason_type || ''),
        chapter_title: ch ? ch.value.trim() : (mistakeBatchParsed[i]?.chapter_title || ''),
        tags: tg ? tg.value.trim() : (mistakeBatchParsed[i]?.tags || '')
      });
    } else {
      // RENDER MODE: no input elements, read directly from mistakeBatchParsed array
      const card = mistakeBatchParsed[i] || {};
      cardsToSubmit.push({
        question: card.question || '',
        correct_answer: card.correct_answer || '',
        wrong_answer: card.wrong_answer || '',
        error_reason: card.error_reason || '',
        error_reason_type: card.error_reason_type || '',
        chapter_title: card.chapter_title || '',
        tags: card.tags || ''
      });
    }
  });
  
  // Fallback: if no DOM cards found, try arrays
  if (cardsToSubmit.length === 0 && mistakeBatchParsed.length > 0) {
    syncMistakeBatchParsedCards();
    cardsToSubmit = mistakeBatchParsed;
  } else if (cardsToSubmit.length === 0 && batchCards.length > 0) {
    cardsToSubmit = batchCards;
  }
  
  // Validate - check if any card has question and correct_answer
  const validCards = cardsToSubmit.filter(c => c.question && c.question.trim() && c.correct_answer && c.correct_answer.trim());
  // Check for missing wrong_answer on fill-in-the-blank questions
  const missingWrongAnswer = cardsToSubmit.filter(c => c.question && c.question.trim() && c.correct_answer && c.correct_answer.trim() && (!c.wrong_answer || !c.wrong_answer.trim()) && (!c.type || c.type === 'fill'));
  if (missingWrongAnswer.length > 0) {
    showToast(`有 ${missingWrongAnswer.length} 道填空题未填写错误答案，请补充后再提交`);
    // Highlight the cards missing wrong_answer
    missingWrongAnswer.forEach((c, ci) => {
      const idx = cardsToSubmit.indexOf(c);
      const cardEl = document.querySelector(`[data-mistake-batch-idx="${idx}"] .mb-render-wrong, [data-mistake-batch-idx="${idx}"] #mb-wa-${idx}`);
      if (cardEl) {
        cardEl.style.outline = '2px solid var(--danger,#E07A6F)';
        cardEl.style.outlineOffset = '2px';
        setTimeout(() => { cardEl.style.outline = ''; cardEl.style.outlineOffset = ''; }, 3000);
      }
    });
    return;
  }
  // Check for missing error_reason_type (required)
  const missingERT = validCards.filter(c => !c.error_reason_type || !c.error_reason_type.trim());
  if (missingERT.length > 0) {
    showToast(`有 ${missingERT.length} 题未选择错因类型（知识性错误/概念混淆/方法错误/粗心失误），请补充后再提交`);
    missingERT.forEach((c, ci) => {
      const idx = validCards.indexOf(c);
      const cardEl = document.querySelector(`[data-mistake-batch-idx="${idx}"] .mb-render-answer, [data-mistake-batch-idx="${idx}"] #mb-ert-${idx}, [data-mistake-batch-idx="${idx}"] #batch-ert-${idx}`);
      if (cardEl) {
        cardEl.style.outline = '2px solid var(--danger,#E07A6F)';
        cardEl.style.outlineOffset = '2px';
        setTimeout(() => { cardEl.style.outline = ''; cardEl.style.outlineOffset = ''; }, 3000);
      }
    });
    return;
  }
  if (validCards.length === 0) {
    console.log('Submit validation failed. cardsToSubmit:', cardsToSubmit);
    console.log('DOM card containers:', cardContainers.length);
    console.log('mistakeBatchParsed.length:', mistakeBatchParsed.length);
    console.log('batchCards.length:', batchCards.length);
    showToast('至少填写一道题的题目和正确答案');
    return;
  }
  
  // In mixed mode, check if each card has a chapter
  if (isMixedMode) {
    const noChapterCards = validCards.filter(c => !c.chapter_title);
    if (noChapterCards.length > 0) {
      showToast(`有 ${noChapterCards.length} 题未选择章节，请在混合模式下为每题选择章节`);
      // Highlight cards missing chapter
      highlightMissingChapterCards(cardsToSubmit, validCards);
      return;
    }
    // Clear any previous highlights
    clearMissingChapterHighlights();
  }
  
  const btn1 = document.getElementById('submit-batch-btn');
  const btn2 = document.getElementById('submit-batch-btn-2');
  const activeBtn = mistakeBatchMode === 'batch' ? btn2 : btn1;
  if (activeBtn) { activeBtn.disabled = true; activeBtn.textContent = '提交中...'; }
  
  try {
    // Collect per-question tags (manual mode has tags array, parsed mode may not)
    const subjectSelect = document.getElementById('batch-subject');
    const selectedSubjectId = subjectSelect && subjectSelect.value ? parseInt(subjectSelect.value) : null;
    const result = await API.post('/api/mistakes/batch', {
      chapter_id: isMixedMode ? null : parseInt(chapterSelect.value),
      subject_id: isMixedMode ? selectedSubjectId : null,
      tags: '', // no global tags anymore
      mistakes: validCards.map(c => {
        // Handle tags: can be string (from parser) or array (from manual mode)
        let tagsStr = '';
        if (Array.isArray(c.tags)) {
          tagsStr = c.tags.join(',');
        } else if (typeof c.tags === 'string') {
          tagsStr = c.tags;
        }
        
        return {
          question: c.question.trim(),
          correct_answer: c.correct_answer.trim(),
          wrong_answer: (c.wrong_answer || '').trim(),
          error_reason: (c.error_reason || '').trim(),
          error_reason_type: c.error_reason_type || '',
          tags: tagsStr,
          key_insight: '',
          question_type: c.type || 'fill',
          options: c._options || [],
          // For mixed mode, include chapter_title for backend to resolve
          chapter_title: isMixedMode ? c.chapter_title : null
        };
      })
    });
    
    // Check how many submitted cards have no tags
    const noTagCount = validCards.filter(c => !c.tags || c.tags.length === 0 || (typeof c.tags === 'string' && !c.tags.trim())).length;
    
    showToast(`成功录入 ${result.created} 道错题 ✓`);
    
    // Show uncategorized reminder if needed
    if (noTagCount > 0) {
      setTimeout(() => {
        showToast(`还有 ${noTagCount} 题未分类标签，可在错题本中编辑补充`);
      }, 1500);
    }
    
    batchCards = [{ question: '', correct_answer: '', wrong_answer: '', error_reason: '', error_reason_type: '', tags: [] }];
    mistakeBatchParsed = [];
    mistakeBatchMode = 'manual';
    await navigate('mistakes');
    // Force refresh mistakes list after navigation
    await loadMistakes();
  } catch (e) {
    console.error('[handleSubmitBatch] Error:', e);
    showToast('提交失败: ' + (e.message || '未知错误，请重试'));
    if (btn1) { btn1.disabled = false; btn1.textContent = '📤 提交全部'; }
    if (btn2) { btn2.disabled = false; btn2.textContent = '📤 提交全部'; }
  }
}

// ============================================================
// FEATURE 4: Mixed Chapter Quiz Mode
// ============================================================

// We'll modify the quiz chapter selection to add a mixed mode option
// This is done by modifying loadChaptersForSelect to add the mixed option

// Store selected mixed chapters
let mixedChapterIds = [];

// ============================================================
// FEATURE 5: Onboarding
// ============================================================

function checkOnboarding() {
  if (localStorage.getItem('onboarding_done') === 'true') return;
  showOnboarding();
}

function showOnboarding() {
  const slides = [
    { icon: '🎯', title: '欢迎来到 ATA', desc: '你的错题管家', bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
    { icon: '📚', title: '先选你在学的学科', desc: '支持 AP 数学、物理、化学、统计', bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
    { icon: '✏️', title: '遇到不会的？记下来', desc: '快速录入错题，不错过每一个知识点', bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
    { icon: '🏷️', title: '标签 = 知识点', desc: '给每道题打上一个知识点标签，如「牛顿第二定律」。同一知识点会自动归类，方便你集中突破薄弱点', bg: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
    { icon: '💡', title: '错因 = 为什么错', desc: '写清错因：粗心、公式记混、计算失误……标签管「考什么」，错因管「为什么错」，配合使用效果最佳', bg: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
    { icon: '🧠', title: '遗忘曲线帮你记住', desc: '科学间隔复习，事半功倍', bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
    { icon: '⚡', title: '反复练到真正掌握', desc: 'Quiz 巩固，直到满分', bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
  ];
  
  let currentSlide = 0;
  let startX = 0;
  let currentX = 0;
  let isDragging = false;
  
  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10001;background:#fff;display:flex;flex-direction:column;';
  
  function renderSlide() {
    const s = slides[currentSlide];
    const isLast = currentSlide === slides.length - 1;
    overlay.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;">
        <div style="width:180px;height:180px;border-radius:40px;background:${s.bg};display:flex;align-items:center;justify-content:center;font-size:80px;margin-bottom:40px;box-shadow:0 20px 60px rgba(0,0,0,0.15);">
          ${s.icon}
        </div>
        <h2 style="font-size:1.6rem;margin:0 0 12px;color:#333;text-align:center;">${s.title}</h2>
        <p style="font-size:1.05rem;color:#888;text-align:center;margin:0;line-height:1.6;">${s.desc}</p>
      </div>
      <div style="padding:20px 24px 40px;text-align:center;">
        <div style="display:flex;justify-content:center;gap:8px;margin-bottom:24px;">
          ${slides.map((_, i) => `<div style="width:${i === currentSlide ? '24px' : '8px'};height:8px;border-radius:4px;background:${i === currentSlide ? '#4a90d9' : '#ddd'};transition:all 0.3s;"></div>`).join('')}
        </div>
        <div style="display:flex;gap:12px;justify-content:center;">
          ${!isLast ? `<button id="onboarding-skip" style="padding:12px 32px;border:none;background:none;color:#999;font-size:1rem;cursor:pointer;border-radius:12px;">跳过</button>` : ''}
          <button id="onboarding-next" style="padding:14px 40px;border:none;background:linear-gradient(135deg, #4a90d9, #357abd);color:#fff;font-size:1.05rem;font-weight:600;cursor:pointer;border-radius:14px;box-shadow:0 4px 15px rgba(74,144,217,0.4);">
            ${isLast ? '开始使用 🚀' : '下一步 →'}
          </button>
        </div>
      </div>
    `;
    
    const nextBtn = overlay.querySelector('#onboarding-next');
    const skipBtn = overlay.querySelector('#onboarding-skip');
    
    if (nextBtn) nextBtn.onclick = () => {
      if (isLast) {
        finishOnboarding();
      } else {
        currentSlide++;
        renderSlide();
      }
    };
    if (skipBtn) skipBtn.onclick = finishOnboarding;
    
    // Touch swipe support
    let touchStartX = 0;
    overlay.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) {
        if (diff > 0 && currentSlide < slides.length - 1) { currentSlide++; renderSlide(); }
        else if (diff < 0 && currentSlide > 0) { currentSlide--; renderSlide(); }
      }
    }, { passive: true });
  }
  
  function finishOnboarding() {
    localStorage.setItem('onboarding_done', 'true');
    overlay.style.transition = 'opacity 0.3s';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }
  
  document.body.appendChild(overlay);
  renderSlide();
}



// ========================================
// Favorites System
// ========================================

// Cache key helper
function _favKey(targetType, targetId) {
  return targetType + '-' + targetId;
}

// Check if a target is favorited
function isFav(targetId, targetType) {
  return !!state.favCache[_favKey(targetType, targetId)];
}

// Lightweight cache loader for star status on mistakes/quizzes pages
// Uses localStorage cache (5-min TTL) to avoid API calls on tab switch
async function loadFavCacheLight() {
  if (Object.keys(state.favCache).length > 0) return; // already loaded
  try {
    // Check localStorage cache first
    const cached = localStorage.getItem('ata_fav_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.folders && parsed.cache && (Date.now() - parsed.timestamp < 5 * 60 * 1000)) {
          state.favFolders = parsed.folders;
          state.favCache = parsed.cache;
          return; // Cache hit - no API calls needed
        }
      } catch(e) { /* invalid cache, fall through to API */ }
    }
    // Cache miss or expired - fetch from API
    const data = await API.get('/api/favorites/folders');
    state.favFolders = data.folders || [];
    if (state.favFolders.length === 0) {
      state.favCache = {};
      _saveFavCacheToStorage();
      return;
    }
    // Load all favorites across folders to populate cache
    await loadFavCache();
    // Save to localStorage for next tab switch
    _saveFavCacheToStorage();
  } catch(e) {
    // Silently fail - stars just won't show as filled
  }
}

// Save fav cache to localStorage
function _saveFavCacheToStorage() {
  try {
    localStorage.setItem('ata_fav_cache', JSON.stringify({
      folders: state.favFolders,
      cache: state.favCache,
      timestamp: Date.now()
    }));
  } catch(e) { /* storage full or unavailable */ }
}

// Load favorites cache (all favorites across all folders) - parallelized
async function loadFavCache() {
  try {
    const folders = state.favFolders.length ? state.favFolders : (await API.get('/api/favorites/folders')).folders || [];
    state.favCache = {};
    // Fetch all folders in parallel instead of serial for loop
    const results = await Promise.all(folders.map(folder =>
      API.get(`/api/favorites?folder_id=${folder.id}`).then(data => ({folder, favorites: data.favorites || []})).catch(() => null)
    ));
    for (const result of results) {
      if (!result) continue;
      for (const fav of result.favorites) {
        const key = _favKey(fav.target_type, fav.target_id);
        if (!state.favCache[key]) state.favCache[key] = [];
        state.favCache[key].push(result.folder.id);
      }
    }
  } catch(e) {
    console.error('loadFavCache error:', e);
  }
}

// --- Favorite Modal ---
async function showFavoriteModal(targetType, targetId) {
  const key = _favKey(targetType, targetId);
  const existingFolders = state.favCache[key] || [];

  const overlay = document.createElement('div');
  overlay.className = 'fav-modal-overlay';
  overlay.id = 'fav-modal';

  let folders = [];
  try {
    const data = await API.get('/api/favorites/folders');
    folders = data.folders || [];
    state.favFolders = folders;
  } catch(e) {
    showToast('加载收藏夹失败');
    return;
  }

  function renderFolderList() {
    return folders.map(f => {
      const isExisting = existingFolders.includes(f.id);
      return `
        <div class="fav-folder-item ${isExisting ? 'fav-folder-existing' : ''}" data-fav-folder-id="${f.id}">
          <div class="fav-folder-icon">📁</div>
          <div class="fav-folder-info">
            <div class="fav-folder-name">${escapeHtml(f.name)}</div>
            <div class="fav-folder-count">${f.item_count || 0} 题目${f.subject_name ? ' \u00b7 ' + escapeHtml(f.subject_name) : ''}</div>
          </div>
          <button class="fav-folder-action ${isExisting ? 'added' : 'add'}">${isExisting ? '✓ 已收藏' : '收藏到'}</button>
        </div>
      `;
    }).join('');
  }

  overlay.innerHTML = `
    <div class="fav-modal-card">
      <div class="fav-modal-header">
        <span class="fav-modal-title">⭐ 收藏到收藏夹</span>
        <button class="fav-modal-close" id="fav-modal-close">✕</button>
      </div>
      <div class="fav-modal-body" id="fav-modal-body">
        ${folders.length === 0 ? '<div style="text-align:center;padding:24px;color:var(--text-tertiary);">还没有收藏夹，先创建一个吧</div>' : renderFolderList()}
      </div>
      <div class="fav-modal-footer">
        <button class="fav-new-folder-btn" id="fav-new-folder-toggle">➕ 新建收藏夹</button>
        <div id="fav-new-folder-form" style="display:none;">
          <div class="fav-new-folder-form">
            <input class="form-input" id="fav-new-folder-name" placeholder="收藏夹名称，如\u201c微积分经典题\u201d" maxlength="50" />
            <select class="form-input" id="fav-new-folder-subject">
              <option value="">不关联科目</option>
            </select>
            <div class="form-actions">
              <button class="btn btn-secondary btn-sm" id="fav-new-folder-cancel" style="flex:1;">取消</button>
              <button class="btn btn-primary btn-sm" id="fav-new-folder-submit" style="flex:1;">创建并收藏</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Folder item click delegation (inside modal, not in #app)
  overlay.addEventListener('click', (e) => {
    const folderItem = e.target.closest('.fav-folder-item');
    if (folderItem && folderItem.dataset.favFolderId) {
      e.stopPropagation();
      const fid = parseInt(folderItem.dataset.favFolderId);
      handleFavFolderSelect(fid, targetType, targetId);
      return;
    }
  });

  // Close handlers
  overlay.querySelector('#fav-modal-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Load subjects for select
  try {
    const subjData = await API.get('/api/subjects');
    const subjSelect = overlay.querySelector('#fav-new-folder-subject');
    if (subjSelect && subjData.subjects) {
      subjSelect.innerHTML = '<option value="">不关联科目</option>' +
        subjData.subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    }
  } catch(e) { /* skip */ }

  // Toggle new folder form
  overlay.querySelector('#fav-new-folder-toggle').onclick = () => {
    const form = overlay.querySelector('#fav-new-folder-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  };

  // Cancel new folder
  overlay.querySelector('#fav-new-folder-cancel').onclick = () => {
    overlay.querySelector('#fav-new-folder-form').style.display = 'none';
  };

  // Submit new folder
  overlay.querySelector('#fav-new-folder-submit').onclick = async () => {
    const nameInput = overlay.querySelector('#fav-new-folder-name');
    const subjSelect = overlay.querySelector('#fav-new-folder-subject');
    const name = nameInput.value.trim();
    if (!name) { showToast('请输入收藏夹名称'); return; }
    try {
      const body = { name };
      if (subjSelect.value) body.subject_id = parseInt(subjSelect.value);
      const result = await API.post('/api/favorites/folders', body);
      // Auto-favorite to new folder
      await API.post('/api/favorites', { folder_id: result.folder.id, target_type: targetType, target_id: targetId, note: '' });
      // Update cache
      const key2 = _favKey(targetType, targetId);
      if (!state.favCache[key2]) state.favCache[key2] = [];
      state.favCache[key2].push(result.folder.id);
      _saveFavCacheToStorage();
      showToast('已创建并收藏 ✓');
      overlay.remove();
      // Refresh current page to update star status
      if (state.currentPage === 'mistakes') loadMistakes();
    } catch(e) {
      showToast('创建失败: ' + e.message);
    }
  };
}

// Handle folder select in modal
async function handleFavFolderSelect(folderId, targetType, targetId) {
  const key = _favKey(targetType, targetId);
  const existing = state.favCache[key] || [];

  if (existing.includes(folderId)) {
    showToast('该题目已在此收藏夹中');
    return;
  }

  try {
    await API.post('/api/favorites', { folder_id: folderId, target_type: targetType, target_id: targetId, note: '' });
    if (!state.favCache[key]) state.favCache[key] = [];
    state.favCache[key].push(folderId);
    _saveFavCacheToStorage();
    showToast('收藏成功 ⭐');
    // Close modal
    const modal = document.getElementById('fav-modal');
    if (modal) modal.remove();
    // Refresh current page
    if (state.currentPage === 'mistakes') loadMistakes();
    else if (state.currentPage === 'take-quiz') render();
  } catch(e) {
    showToast('收藏失败: ' + e.message);
  }
}

// --- Favorites Page ---
function renderFavorites() {
  return `
    <div class="page ${state.favManageMode ? 'manage-mode' : ''}" id="favorites-page">
      <div class="top-bar">
        <h1>⭐ 收藏夹</h1>
        <button class="fav-manage-toggle ${state.favManageMode ? 'active' : ''}" data-action="fav-toggle-manage">${state.favManageMode ? '完成' : '管理'}</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:0.82rem;color:var(--text-tertiary);">点击收藏夹查看详情</span>
        <button class="btn btn-sm btn-outline" style="font-size:0.78rem;padding:4px 10px;" onclick="showCreateFolderInline()">➕ 新建</button>
      </div>
      <div id="fav-create-inline" style="display:none;margin-bottom:12px;">
        <div class="card" style="padding:14px;">
          <input class="form-input" id="fav-inline-name" placeholder="收藏夹名称" maxlength="50" />
          <div style="display:flex;gap:8px;margin-top:8px;">
            <select class="form-input" id="fav-inline-subject" style="flex:1;">
              <option value="">不关联科目</option>
            </select>
            <button class="btn btn-primary btn-sm" id="fav-inline-create">创建</button>
          </div>
        </div>
      </div>
      <div id="fav-folders-container">
        <div class="empty-state">
          <div class="empty-icon">⭐</div>
          <div class="empty-title">加载中...</div>
        </div>
      </div>
    </div>
  `;
}

function renderFavBatchBar(type) {
  const count = type === 'folders' ? state.selectedFolders.size : state.selectedFavItems.size;
  if (count === 0) return '';
  const deleteAction = type === 'folders' ? 'fav-batch-delete-folders' : 'fav-batch-delete';
  const moveAction = type === 'folders' ? 'fav-batch-move-folders' : 'fav-batch-move';
  return `
    <div class="fav-batch-bar">
      <span class="batch-info">已选 ${count} 项</span>
      <div class="batch-actions">
        <button class="batch-btn move" data-action="${moveAction}">📂 移动</button>
        <button class="batch-btn delete" data-action="${deleteAction}">🗑️ 删除</button>
      </div>
    </div>
  `;
}

async function loadFavoritesPage() {
  state.favManageMode = false;
  state.selectedFolders = new Set();
  try {
    const data = await API.get('/api/favorites/folders');
    state.favFolders = data.folders || [];
    await loadFavCache();
  } catch(e) {
    console.error('loadFavoritesPage error:', e);
  }
  renderFavFoldersList();

  // Load subjects for inline create form
  try {
    const subjData = await API.get('/api/subjects');
    const subjSelect = document.getElementById('fav-inline-subject');
    if (subjSelect && subjData.subjects) {
      subjSelect.innerHTML = '<option value="">不关联科目</option>' +
        subjData.subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    }
  } catch(e) { /* skip */ }

  // Bind inline create button
  const createBtn = document.getElementById('fav-inline-create');
  if (createBtn) {
    createBtn.onclick = async () => {
      const name = (document.getElementById('fav-inline-name')?.value || '').trim();
      if (!name) { showToast('请输入名称'); return; }
      const subjId = document.getElementById('fav-inline-subject')?.value;
      try {
        const body = { name };
        if (subjId) body.subject_id = parseInt(subjId);
        await API.post('/api/favorites/folders', body);
        showToast('创建成功 ✓');
        document.getElementById('fav-inline-name').value = '';
        document.getElementById('fav-create-inline').style.display = 'none';
        await loadFavoritesPage();
      } catch(e) { showToast('创建失败: ' + e.message); }
    };
  }
}

function renderFavFoldersList() {
  const container = document.getElementById('fav-folders-container');
  if (!container) return;

  if (state.favFolders.length === 0) {
    container.innerHTML = `
      <div class="fav-empty">
        <div style="font-size:2.5rem;margin-bottom:12px;">📁</div>
        <div style="font-size:1.1rem;font-weight:600;margin-bottom:8px;">还没有收藏夹</div>
        <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px;">创建收藏夹来整理你收藏的题目</div>
      </div>
    `;
    return;
  }

  container.innerHTML = state.favFolders.map((f, i) => `
    <div class="fav-folder-card" style="animation-delay:${i * 0.04}s" data-folder-id="${f.id}">
      ${state.favManageMode ? `<div class="fav-checkbox ${state.selectedFolders.has(f.id) ? 'checked' : ''}" data-action="fav-folder-checkbox" data-folder-id="${f.id}">${state.selectedFolders.has(f.id) ? '✓' : ''}</div>` : ''}
      <div class="fav-folder-card-icon">📁</div>
      <div class="fav-folder-card-info" ${!state.favManageMode ? `data-action="fav-folder-click" data-folder-id="${f.id}"` : ''}>
        <div class="fav-folder-card-name">${escapeHtml(f.name)}</div>
        <div class="fav-folder-card-meta">
          <span>${f.item_count || 0} 题</span>
          ${f.subject_name ? `<span>\u00b7 ${escapeHtml(f.subject_name)}</span>` : ''}
          <span>\u00b7 ${formatDate(f.updated_at || f.created_at)}</span>
        </div>
      </div>
      <span class="fav-folder-card-arrow">\u203a</span>
    </div>
  `).join('');
}

// Show inline create folder form
function showCreateFolderInline() {
  const el = document.getElementById('fav-create-inline');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// Toggle manage mode
function toggleFavManageMode() {
  state.favManageMode = !state.favManageMode;
  state.selectedFolders = new Set();
  render();
  // Re-render folders list
  renderFavFoldersList();
  const page = document.getElementById('favorites-page');
  if (page) page.classList.toggle('manage-mode', state.favManageMode);
}

// Toggle folder checkbox
function toggleFolderCheckbox(folderId) {
  if (state.selectedFolders.has(folderId)) {
    state.selectedFolders.delete(folderId);
  } else {
    state.selectedFolders.add(folderId);
  }
  renderFavFoldersList();
  _updateFavBatchBar('folders');
}

function _updateFavBatchBar(type) {
  const existing = document.querySelector('.fav-batch-bar');
  if (existing) existing.remove();

  const count = type === 'folders' ? state.selectedFolders.size : state.selectedFavItems.size;
  if (count === 0) return;

  const page = document.getElementById('favorites-page') || document.getElementById('fav-detail-page');
  if (!page) return;
  const deleteAction = type === 'folders' ? 'fav-batch-delete-folders' : 'fav-batch-delete';
  const moveAction = type === 'folders' ? 'fav-batch-move-folders' : 'fav-batch-move';
  const bar = document.createElement('div');
  bar.className = 'fav-batch-bar';
  bar.innerHTML = `
    <span class="batch-info">已选 ${count} 项</span>
    <div class="batch-actions">
      <button class="batch-btn move" data-action="${moveAction}">📂 移动</button>
      <button class="batch-btn delete" data-action="${deleteAction}">🗑️ 删除</button>
    </div>
  `;
  page.appendChild(bar);
}

// Handle folder click (navigate to detail)
function handleFavFolderClick(folderId) {
  if (state.favManageMode) return;
  state.currentFavFolder = state.favFolders.find(f => f.id === folderId) || null;
  state.selectedFavItems = new Set();
  navigate('favorites-detail');
}

// Batch delete folders
async function handleFavBatchDeleteFolders() {
  if (state.selectedFolders.size === 0) return;
  showConfirmModal('删除收藏夹', `确定要删除选中的 ${state.selectedFolders.size} 个收藏夹吗？收藏夹中的题目也会被移除。`, async () => {
    let deleted = 0;
    for (const fid of state.selectedFolders) {
      try {
        await API.del(`/api/favorites/folders/${fid}`);
        deleted++;
      } catch(e) { /* skip */ }
    }
    showToast(`已删除 ${deleted} 个收藏夹`);
    localStorage.removeItem('ata_fav_cache'); // Invalidate fav cache
    state.selectedFolders = new Set();
    state.favManageMode = false;
    await loadFavoritesPage();
    render();
  });
}

// Batch move folder items
async function showFavFolderMoveModal() {
  if (state.selectedFolders.size === 0) return;
  const folders = state.favFolders.filter(f => !state.selectedFolders.has(f.id));
  if (folders.length === 0) { showToast('没有可移动到的收藏夹'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'fav-move-modal';
  overlay.innerHTML = `
    <div class="fav-move-card">
      <div class="fav-move-header">📂 移动到收藏夹</div>
      <div class="fav-move-body">
        ${folders.map(f => `
          <div class="fav-move-item" data-move-folder-id="${f.id}">
            <span>📁</span>
            <span style="font-size:0.9rem;font-weight:500;">${escapeHtml(f.name)}</span>
            <span style="font-size:0.75rem;color:var(--text-tertiary);margin-left:auto;">${f.item_count || 0} 题</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('.fav-move-item').forEach(item => {
    item.onclick = async () => {
      const targetFolderId = parseInt(item.dataset.moveFolderId);
      let allFavIds = [];
      for (const fid of state.selectedFolders) {
        try {
          const data = await API.get(`/api/favorites?folder_id=${fid}`);
          (data.favorites || []).forEach(fav => allFavIds.push(fav.id));
        } catch(e) { /* skip */ }
      }
      if (allFavIds.length === 0) { showToast('选中的收藏夹中没有题目'); overlay.remove(); return; }
      try {
        await API.post('/api/favorites/batch-move', { favorite_ids: allFavIds, target_folder_id: targetFolderId });
        showToast(`已移动 ${allFavIds.length} 个题目`);
        state.selectedFolders = new Set();
        state.favManageMode = false;
        overlay.remove();
        await loadFavoritesPage();
        render();
      } catch(e) { showToast('移动失败: ' + e.message); }
    };
  });
}

// Delete single folder
async function handleDeleteFavFolder(folderId) {
  showConfirmModal('删除收藏夹', '确定要删除该收藏夹吗？其中的收藏项也会被移除。', async () => {
    try {
      await API.del(`/api/favorites/folders/${folderId}`);
      showToast('已删除');
      localStorage.removeItem('ata_fav_cache'); // Invalidate fav cache
      await loadFavoritesPage();
      render();
    } catch(e) { showToast('删除失败: ' + e.message); }
  });
}

// Edit folder
async function handleFavEditFolder(folderId) {
  const folder = state.favFolders.find(f => f.id === folderId);
  if (!folder) return;

  const overlay = document.createElement('div');
  overlay.className = 'fav-modal-overlay';
  overlay.innerHTML = `
    <div class="fav-modal-card" style="max-width:360px;">
      <div class="fav-modal-header">
        <span class="fav-modal-title">✏️ 编辑收藏夹</span>
        <button class="fav-modal-close" id="fav-edit-close">✕</button>
      </div>
      <div style="padding:16px 20px;">
        <div class="form-group">
          <label class="form-label">名称</label>
          <input class="form-input" id="fav-edit-name" value="${escapeHtml(folder.name)}" maxlength="50" />
        </div>
        <div class="form-group">
          <label class="form-label">关联科目</label>
          <select class="form-input" id="fav-edit-subject">
            <option value="">不关联科目</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" id="fav-edit-save" style="flex:1;">保存</button>
          <button class="btn btn-danger btn-sm" id="fav-edit-delete" style="flex:1;">删除收藏夹</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Load subjects
  try {
    const subjData = await API.get('/api/subjects');
    const subjSelect = overlay.querySelector('#fav-edit-subject');
    if (subjSelect && subjData.subjects) {
      subjSelect.innerHTML = '<option value="">不关联科目</option>' +
        subjData.subjects.map(s => `<option value="${s.id}" ${s.id === folder.subject_id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
    }
  } catch(e) { /* skip */ }

  overlay.querySelector('#fav-edit-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#fav-edit-save').onclick = async () => {
    const name = overlay.querySelector('#fav-edit-name').value.trim();
    if (!name) { showToast('请输入名称'); return; }
    const subjId = overlay.querySelector('#fav-edit-subject').value;
    try {
      const body = { name };
      if (subjId) body.subject_id = parseInt(subjId);
      await API.put(`/api/favorites/folders/${folderId}`, body);
      showToast('已保存 ✓');
      overlay.remove();
      await loadFavoritesPage();
      render();
    } catch(e) { showToast('保存失败: ' + e.message); }
  };

  overlay.querySelector('#fav-edit-delete').onclick = () => {
    overlay.remove();
    handleDeleteFavFolder(folderId);
  };
}

// --- Favorites Detail Page ---
function renderFavoritesDetail() {
  const folder = state.currentFavFolder;
  if (!folder) return renderFavorites();
  return `
    <div class="page" id="fav-detail-page">
      <div class="top-bar">
        <button class="back-btn" data-action="fav-back">←</button>
        <h1 style="font-size:1.1rem;">📁 ${escapeHtml(folder.name)}</h1>
        <button class="icon-btn" data-action="fav-edit-folder" data-folder-id="${folder.id}" title="编辑">✏️</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:0.82rem;color:var(--text-tertiary);">${folder.subject_name ? escapeHtml(folder.subject_name) + ' \u00b7 ' : ''}${folder.item_count || 0} 题</span>
      </div>
      <div id="fav-items-container">
        <div class="empty-state">
          <div class="empty-icon">⏳</div>
          <div class="empty-title">加载中...</div>
        </div>
      </div>
    </div>
  `;
}

async function loadFavoritesDetailPage() {
  const folder = state.currentFavFolder;
  if (!folder) { navigate('favorites'); return; }
  state.selectedFavItems = new Set();

  try {
    const data = await API.get(`/api/favorites?folder_id=${folder.id}`);
    const container = document.getElementById('fav-items-container');
    if (!container) return;

    const favorites = data.favorites || [];
    if (favorites.length === 0) {
      container.innerHTML = `
        <div class="fav-empty">
          <div style="font-size:2.5rem;margin-bottom:12px;">📭</div>
          <div style="font-size:1.1rem;font-weight:600;margin-bottom:8px;">这个收藏夹还是空的</div>
          <div style="font-size:0.85rem;color:var(--text-secondary);">去错题本或 Quiz 页面收藏题目吧</div>
        </div>
      `;
      return;
    }

    container.innerHTML = favorites.map((fav, i) => {
      const qData = fav.question_data || {};
      const qText = qData.question || qData.question_text || '(题目内容不可用)';
      const truncated = qText.length > 80 ? qText.substring(0, 80) + '...' : qText;
      const chapter = qData.chapter_title || '';
      const tags = qData.tags || [];

      return `
        <div class="fav-item-card" style="animation-delay:${i * 0.04}s">
          <div class="fav-item-header">
            <div class="fav-item-checkbox ${state.selectedFavItems.has(fav.id) ? 'checked' : ''}" data-action="fav-item-checkbox" data-fav-id="${fav.id}">${state.selectedFavItems.has(fav.id) ? '✓' : ''}</div>
            <div class="fav-item-content">
              <div class="fav-item-question">${renderSubSup(truncated)}</div>
              <div class="fav-item-meta">
                <span class="fav-item-type ${fav.target_type}">${fav.target_type === 'mistake' ? '📝 错题' : '🧪 Quiz'}</span>
                ${chapter ? `<span class="fav-item-chapter">${escapeHtml(chapter)}</span>` : ''}
                ${tags.length ? tags.slice(0, 2).map(t => `<span style="font-size:0.7rem;color:var(--text-tertiary);background:var(--bg-input);padding:1px 6px;border-radius:4px;">${escapeHtml(t)}</span>`).join('') : ''}
                <span class="fav-item-time">${formatDate(fav.created_at)}</span>
              </div>
            </div>
          </div>
          <button class="fav-item-delete" data-action="fav-delete-item" data-fav-id="${fav.id}" title="移除">🗑️</button>
        </div>
      `;
    }).join('');
  } catch(e) {
    const container = document.getElementById('fav-items-container');
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-title">加载失败</div>
          <div class="empty-desc">${escapeHtml(e.message)}</div>
        </div>
      `;
    }
  }
}

// Toggle fav item checkbox
function toggleFavItemCheckbox(favId) {
  if (state.selectedFavItems.has(favId)) {
    state.selectedFavItems.delete(favId);
  } else {
    state.selectedFavItems.add(favId);
  }
  // Re-render items
  loadFavoritesDetailPage();
  // Show batch bar if needed
  setTimeout(() => _updateFavBatchBar('items'), 100);
}

// Delete single favorite item
async function handleDeleteFavItem(favId) {
  try {
    await API.del(`/api/favorites/${favId}`);
    showToast('已移除');
    await loadFavCache();
    _saveFavCacheToStorage();
    try {
      const data = await API.get('/api/favorites/folders');
      state.favFolders = data.folders || [];
      if (state.currentFavFolder) {
        state.currentFavFolder = state.favFolders.find(f => f.id === state.currentFavFolder.id) || state.currentFavFolder;
      }
    } catch(e) { /* skip */ }
    await loadFavoritesDetailPage();
  } catch(e) { showToast('移除失败: ' + e.message); }
}

// Batch delete favorite items
async function handleFavBatchDelete() {
  if (state.selectedFavItems.size === 0) return;
  showConfirmModal('删除收藏项', `确定要移除选中的 ${state.selectedFavItems.size} 个收藏项吗？`, async () => {
    try {
      await API.post('/api/favorites/batch-delete', { favorite_ids: Array.from(state.selectedFavItems) });
      showToast('已移除');
      state.selectedFavItems = new Set();
      await loadFavCache();
      _saveFavCacheToStorage();
      try {
        const data = await API.get('/api/favorites/folders');
        state.favFolders = data.folders || [];
        if (state.currentFavFolder) {
          state.currentFavFolder = state.favFolders.find(f => f.id === state.currentFavFolder.id) || state.currentFavFolder;
        }
      } catch(e) { /* skip */ }
      await loadFavoritesDetailPage();
    } catch(e) { showToast('删除失败: ' + e.message); }
  });
}

// Show move modal for favorite items
async function showFavMoveModal() {
  if (state.selectedFavItems.size === 0) return;
  const folders = state.favFolders.filter(f => !state.currentFavFolder || f.id !== state.currentFavFolder.id);

  const overlay = document.createElement('div');
  overlay.className = 'fav-move-modal';
  overlay.innerHTML = `
    <div class="fav-move-card">
      <div class="fav-move-header">📂 移动到收藏夹</div>
      <div class="fav-move-body">
        ${folders.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">没有其他收藏夹</div>' : folders.map(f => `
          <div class="fav-move-item" data-move-folder-id="${f.id}">
            <span>📁</span>
            <span style="font-size:0.9rem;font-weight:500;">${escapeHtml(f.name)}</span>
            <span style="font-size:0.75rem;color:var(--text-tertiary);margin-left:auto;">${f.item_count || 0} 题</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('.fav-move-item').forEach(item => {
    item.onclick = async () => {
      const targetFolderId = parseInt(item.dataset.moveFolderId);
      try {
        const result = await API.post('/api/favorites/batch-move', {
          favorite_ids: Array.from(state.selectedFavItems),
          target_folder_id: targetFolderId
        });
        showToast(`已移动 ${result.moved_count || state.selectedFavItems.size} 个题目`);
        state.selectedFavItems = new Set();
        overlay.remove();
        await loadFavCache();
        try {
          const data = await API.get('/api/favorites/folders');
          state.favFolders = data.folders || [];
          if (state.currentFavFolder) {
            state.currentFavFolder = state.favFolders.find(f => f.id === state.currentFavFolder.id) || state.currentFavFolder;
          }
        } catch(e) { /* skip */ }
        await loadFavoritesDetailPage();
      } catch(e) { showToast('移动失败: ' + e.message); }
    };
  });
}


// --- Init ---
function init() {
  setupEventDelegation();
  if (state.token && state.user) {
    navigate('home');
    // Auto-seed tag library if needed (silently)
    API.post('/api/tag-library/seed', {}).catch(() => {});
    // Check onboarding (lightweight, localStorage-only)
    checkOnboarding();
    // Defer subject check — not critical for initial render
    setTimeout(() => checkAndPromptSubjects(), 1000);
    // One-time migration: fix choice-type mistakes saved as fill
    if (!localStorage.getItem('ata_migrated_choice_type')) {
      API.post('/api/migrate-choice-type', {}).then(res => {
        if (res.fixed > 0) console.log(`Migrated ${res.fixed} choice-type mistakes`);
      }).catch(() => {}).finally(() => {
        localStorage.setItem('ata_migrated_choice_type', '1');
      });
    }
    // One-time migration: fix mistakes assigned to wrong subject's chapters
    if (!localStorage.getItem('ata_migrated_chapter_subject')) {
      API.post('/api/migrate-chapter-subject', {}).then(res => {
        if (res.fixed > 0) console.log(`Fixed ${res.fixed} wrong-subject mistakes`);
      }).catch(() => {}).finally(() => {
        localStorage.setItem('ata_migrated_chapter_subject', '1');
      });
    }
  } else {
    navigate('login');
  }
}

// Service Worker Registration - DISABLED for now
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js').catch(() => {});
//   });
// }

// Tag chip flash effect (display-only, no click action)
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.tag-ref-chip');
  if (!chip || chip.classList.contains('chip-flash')) return;
  chip.classList.add('chip-flash');
  setTimeout(() => chip.classList.remove('chip-flash'), 400);
});

// Wrap init in try-catch to see errors
try {
  init();
} catch(e) {
  document.getElementById('app').innerHTML = '<div style="padding:20px;color:red;font-size:14px;">init() 错误: ' + e.message + '<br>堆栈: ' + e.stack + '</div>';
  console.error('init() failed:', e);
}

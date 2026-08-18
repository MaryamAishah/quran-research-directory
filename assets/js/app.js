// Quran Research Directory - app logic
// QURAN_DATA is loaded globally from quran-data.js

const app = document.getElementById('app');

function surahByNumber(num) {
  return QURAN_DATA.find(s => s.number === num);
}

// ---------- Backend capability detection ----------
// The document/notes system needs the local Node server. When this site is
// deployed statically (e.g. Vercel) with no backend, detect that once at
// load time and gracefully fall back to a read-only reader.
let HAS_BACKEND = true;

// Returns true if a redirect to /login was triggered (caller should bail
// out and skip rendering, since navigation is about to happen).
async function detectBackend() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch('/api/docs', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (r.status === 401) {
      const dest = window.location.pathname + window.location.search + window.location.hash;
      window.location.href = `/login?next=${encodeURIComponent(dest)}`;
      return true;
    }
    HAS_BACKEND = r.ok;
  } catch {
    HAS_BACKEND = false;
  }
  document.body.classList.toggle('no-backend', !HAS_BACKEND);

  if (HAS_BACKEND) {
    try {
      const status = await (await fetch('/api/auth-status', { cache: 'no-store' })).json();
      document.getElementById('logout-link').style.display = status.required ? '' : 'none';
    } catch { /* logout link just stays hidden */ }
  }
  return false;
}

// ---------- Router ----------
function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');

  if (parts[0] === 'surah' && parts[1]) {
    const surahNum = parseInt(parts[1], 10);
    const ayahNum = parts[2] === 'ayah' && parts[3] ? parseInt(parts[3], 10) : 1;
    return { view: 'reader', surahNum, ayahNum };
  }
  if (parts[0] === 'doc' && parts[1] === 'new') {
    const surah = parseInt(query.get('surah'), 10);
    const ayah = parseInt(query.get('ayah'), 10);
    return { view: 'doc-new', prefillSurah: surah || null, prefillAyah: ayah || null };
  }
  if (parts[0] === 'doc' && parts[1] === 'upload') {
    return { view: 'doc-upload' };
  }
  if (parts[0] === 'doc' && parts[1] && parts[2] === 'edit') {
    return { view: 'doc-edit', id: parts[1] };
  }
  if (parts[0] === 'doc' && parts[1]) {
    return { view: 'doc-view', id: parts[1] };
  }
  if (parts[0] === 'library') {
    return { view: 'library' };
  }
  if (parts[0] === 'search') {
    return { view: 'search' };
  }
  if (parts[0] === 'export') {
    return { view: 'export' };
  }
  if (parts[0] === 'review') {
    return { view: 'review' };
  }
  return { view: 'dashboard' };
}

function navigate(hash) {
  window.location.hash = hash;
}

// ---------- Theme toggle ----------
function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('qrd-theme', next);
  });
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('brand').addEventListener('click', () => navigate('#/'));
  document.getElementById('search-box').addEventListener('input', onSearch);
  document.getElementById('logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });
  initThemeToggle();
  const redirecting = await detectBackend();
  if (redirecting) return;
  render();
});

const BACKEND_ONLY_VIEWS = new Set(['doc-new', 'doc-edit', 'doc-view', 'doc-upload', 'library', 'search', 'export', 'review']);

function render() {
  const route = parseHash();
  document.onkeydown = null;
  if (!HAS_BACKEND && BACKEND_ONLY_VIEWS.has(route.view)) {
    navigate('#/');
    return;
  }
  if (route.view === 'reader') {
    const surah = surahByNumber(route.surahNum);
    if (!surah) { navigate('#/'); return; }
    let ayahNum = route.ayahNum;
    if (ayahNum < 1) ayahNum = 1;
    if (ayahNum > surah.ayahCount) ayahNum = surah.ayahCount;
    renderReader(surah, ayahNum);
  } else if (route.view === 'doc-new') {
    renderEditor({ mode: 'new', prefillSurah: route.prefillSurah, prefillAyah: route.prefillAyah });
  } else if (route.view === 'doc-edit') {
    renderEditor({ mode: 'edit', id: route.id });
  } else if (route.view === 'doc-upload') {
    renderUploadPage();
  } else if (route.view === 'doc-view') {
    renderDocView(route.id);
  } else if (route.view === 'library') {
    renderLibrary();
  } else if (route.view === 'search') {
    renderSearchPage();
  } else if (route.view === 'export') {
    renderExportPage();
  } else if (route.view === 'review') {
    renderReviewPage();
  } else {
    renderDashboard();
  }
  window.scrollTo(0, 0);
}

// ---------- Dashboard ----------
function renderDashboard(filter) {
  document.onkeydown = null;
  document.getElementById('search-box').style.display = '';
  const q = (filter || '').trim().toLowerCase();

  const cards = QURAN_DATA.filter(s => {
    if (!q) return true;
    return (
      String(s.number) === q ||
      s.englishName.toLowerCase().includes(q) ||
      s.englishNameTranslation.toLowerCase().includes(q) ||
      s.name.includes(filter.trim())
    );
  });

  const cardsHtml = cards.map(s => `
    <div class="surah-card" data-surah="${s.number}">
      <div class="surah-card-top">
        <div class="surah-num">${s.number}</div>
        <div class="surah-name-ar">${s.name}</div>
      </div>
      <div class="surah-card-names">
        <div class="surah-name-en">${s.englishName}</div>
        <div class="surah-name-translation">${s.englishNameTranslation}</div>
      </div>
      <div class="surah-card-meta">
        <span class="badge ${s.revelationType.toLowerCase()}">${s.revelationType}</span>
        <span class="badge">${s.ayahCount} ayahs</span>
      </div>
    </div>
  `).join('');

  app.innerHTML = `
    <div class="container">
      <div class="page-title">Surah Dashboard</div>
      <div class="page-subtitle">${QURAN_DATA.length} surahs · ${QURAN_DATA.reduce((n, s) => n + s.ayahCount, 0)} ayahs · Arabic text (Uthmani) with Sahih International translation</div>
      <div class="surah-grid">
        ${cardsHtml || '<div class="empty-state">No surahs match your search.</div>'}
      </div>
    </div>
  `;

  app.querySelectorAll('.surah-card').forEach(el => {
    el.addEventListener('click', () => {
      navigate(`#/surah/${el.dataset.surah}/ayah/1`);
    });
  });
}

function onSearch(e) {
  renderDashboard(e.target.value);
}

// ---------- Reader ----------
function renderReader(surah, ayahNum) {
  document.getElementById('search-box').style.display = 'none';
  const ayah = surah.ayahs.find(a => a.n === ayahNum);

  const options = surah.ayahs.map(a =>
    `<option value="${a.n}" ${a.n === ayahNum ? 'selected' : ''}>Ayah ${a.n}</option>`
  ).join('');

  const prevSurah = surahByNumber(surah.number - 1);
  const nextSurah = surahByNumber(surah.number + 1);

  const atFirstAyah = ayahNum === 1;
  const atLastAyah = ayahNum === surah.ayahCount;

  app.innerHTML = `
    <div class="container">
      <div class="reader-header">
        <a href="#/" class="back-link">&larr; Dashboard</a>
        <div class="reader-titleblock">
          <div class="reader-title-ar">${surah.name}</div>
          <div class="reader-title-en">${surah.number}. ${surah.englishName} &middot; ${surah.englishNameTranslation} &middot; ${surah.revelationType}</div>
        </div>
      </div>

      ${HAS_BACKEND ? `
      <div class="notes-panel">
        <div class="notes-label-row">
          <span class="notes-label">About ${surah.englishName} &middot; General</span>
          <button class="nav-btn primary" id="add-surah-doc-btn">+ Add Document</button>
        </div>
        <div id="surah-docs-list" class="linked-docs-list">
          <div class="empty-state" style="padding:14px 0;">Loading...</div>
        </div>
      </div>
      ` : ''}

      <div class="reader-controls">
        <button class="nav-btn" id="prev-btn" ${atFirstAyah && !prevSurah ? 'disabled' : ''}>&larr; Prev</button>
        <select class="ayah-select" id="ayah-select">${options}</select>
        <button class="nav-btn" id="next-btn" ${atLastAyah && !nextSurah ? 'disabled' : ''}>Next &rarr;</button>
        <div class="controls-spacer"></div>
        <form class="jump-form" id="jump-form">
          <input class="jump-input" id="jump-input" type="number" min="1" max="${surah.ayahCount}" placeholder="#" />
          <button class="nav-btn" type="submit">Go</button>
        </form>
        <div class="ayah-progress">Ayah ${ayahNum} of ${surah.ayahCount}</div>
      </div>

      <div class="ayah-panel">
        <div class="ayah-badge-row">
          <span class="ayah-number-badge">${surah.number}:${ayah.n}</span>
          ${ayah.sajda ? '<span class="sajda-badge">Sajda</span>' : ''}
        </div>
        <div class="ayah-arabic">${ayah.ar}</div>
        <div class="ayah-translation">
          <span class="label">Sahih International</span>
          ${ayah.en}
        </div>
      </div>

      ${HAS_BACKEND ? `
      <div class="notes-panel">
        <div class="notes-label-row">
          <span class="notes-label">Linked Documents &middot; ${surah.number}:${ayah.n}</span>
          <button class="nav-btn primary" id="add-doc-btn">+ Add Document</button>
        </div>
        <div id="linked-docs-list" class="linked-docs-list">
          <div class="empty-state" style="padding:14px 0;">Loading...</div>
        </div>
      </div>

      <div class="notes-panel">
        <div class="notes-label-row">
          <span class="notes-label">Matched Passages &middot; ${surah.number}:${ayah.n}</span>
        </div>
        <div id="matched-passages-list" class="linked-docs-list">
          <div class="empty-state" style="padding:14px 0;">Loading...</div>
        </div>
      </div>
      ` : ''}

      <div class="reader-footer-nav">
        <button class="nav-btn" id="prev-btn-2" ${atFirstAyah && !prevSurah ? 'disabled' : ''}>&larr; Previous Ayah</button>
        <button class="nav-btn" id="next-btn-2" ${atLastAyah && !nextSurah ? 'disabled' : ''}>Next Ayah &rarr;</button>
      </div>
    </div>
  `;

  function goPrev() {
    if (!atFirstAyah) {
      navigate(`#/surah/${surah.number}/ayah/${ayahNum - 1}`);
    } else if (prevSurah) {
      navigate(`#/surah/${prevSurah.number}/ayah/${prevSurah.ayahCount}`);
    }
  }
  function goNext() {
    if (!atLastAyah) {
      navigate(`#/surah/${surah.number}/ayah/${ayahNum + 1}`);
    } else if (nextSurah) {
      navigate(`#/surah/${nextSurah.number}/ayah/1`);
    }
  }

  document.getElementById('prev-btn').addEventListener('click', goPrev);
  document.getElementById('next-btn').addEventListener('click', goNext);
  document.getElementById('prev-btn-2').addEventListener('click', goPrev);
  document.getElementById('next-btn-2').addEventListener('click', goNext);

  document.getElementById('ayah-select').addEventListener('change', (e) => {
    navigate(`#/surah/${surah.number}/ayah/${e.target.value}`);
  });

  document.getElementById('jump-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = parseInt(document.getElementById('jump-input').value, 10);
    if (val >= 1 && val <= surah.ayahCount) {
      navigate(`#/surah/${surah.number}/ayah/${val}`);
    }
  });

  if (HAS_BACKEND) {
    document.getElementById('add-doc-btn').addEventListener('click', () => {
      navigate(`#/doc/new?surah=${surah.number}&ayah=${ayah.n}`);
    });
    document.getElementById('add-surah-doc-btn').addEventListener('click', () => {
      navigate(`#/doc/new?surah=${surah.number}`);
    });
    loadLinkedDocs(surah.number, ayah.n);
    loadMatchedPassages(surah.number, ayah.n);
    loadSurahDocs(surah.number);
  }

  // Keyboard navigation (ignore when typing in inputs)
  document.onkeydown = (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input' || tag === 'select') return;
    if (e.key === 'ArrowLeft') goNext();   // Arabic RTL reading: left arrow = next ayah
    if (e.key === 'ArrowRight') goPrev();  // right arrow = previous ayah
  };
}

async function loadSurahDocs(surahNum) {
  const listEl = document.getElementById('surah-docs-list');
  if (!listEl) return;
  let docs;
  try {
    docs = await API.docsForSurah(surahNum);
  } catch {
    listEl.innerHTML = '<div class="empty-state" style="padding:14px 0;">Can\'t reach the local server.</div>';
    return;
  }
  if (!docs.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:14px 0;">No general documents for this surah yet.</div>';
    return;
  }
  listEl.innerHTML = docs.map(d => `
    <a class="linked-doc-item" href="#/doc/${d.id}">
      <span class="linked-doc-title">${escapeHtml(d.title)}</span>
      <span class="linked-doc-date">Updated ${new Date(d.updatedAt).toLocaleDateString()}</span>
    </a>
  `).join('');
}

async function loadLinkedDocs(surahNum, ayahNum) {
  const listEl = document.getElementById('linked-docs-list');
  if (!listEl) return;
  let docs;
  try {
    docs = await API.docsForAyah(surahNum, ayahNum);
  } catch {
    listEl.innerHTML = '<div class="empty-state" style="padding:14px 0;">Can\'t reach the local server. Start it with start.bat, then reload this page.</div>';
    return;
  }
  if (!docs.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:14px 0;">No documents linked to this ayah yet.</div>';
    return;
  }
  listEl.innerHTML = docs.map(d => `
    <a class="linked-doc-item" href="#/doc/${d.id}">
      <span class="linked-doc-title">${escapeHtml(d.title)}</span>
      <span class="linked-doc-date">Updated ${new Date(d.updatedAt).toLocaleDateString()}</span>
    </a>
  `).join('');
}

async function loadMatchedPassages(surahNum, ayahNum) {
  const listEl = document.getElementById('matched-passages-list');
  if (!listEl) return;
  let hits;
  try {
    hits = await API.passagesForAyah(surahNum, ayahNum);
  } catch {
    listEl.innerHTML = '<div class="empty-state" style="padding:14px 0;">Can\'t reach the local server.</div>';
    return;
  }
  if (!hits.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:14px 0;">No matched passages for this ayah yet.</div>';
    return;
  }
  listEl.innerHTML = hits.map(({ passage, doc, matches }) => {
    const match = matches[0];
    const badge = match.source === 'explicit'
      ? '<span class="badge match-badge explicit">Explicit reference</span>'
      : match.source === 'manual'
        ? '<span class="badge match-badge manual">Manually added</span>'
        : `<span class="badge match-badge llm">${Math.round(match.confidence * 100)}% match</span>`;
    const locBits = [];
    if (passage.location?.page) locBits.push(`p. ${passage.location.page}`);
    if (passage.location?.section) locBits.push(passage.location.section);
    return `
      <a class="linked-doc-item passage-item" href="#/doc/${doc.id}">
        <div class="passage-item-main">
          <span class="linked-doc-title">${escapeHtml(doc.title)}</span>
          <p class="passage-snippet">${escapeHtml(passage.text.slice(0, 220))}${passage.text.length > 220 ? '…' : ''}</p>
          ${locBits.length ? `<span class="passage-location">${locBits.map(escapeHtml).join(' &middot; ')}</span>` : ''}
        </div>
        ${badge}
      </a>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

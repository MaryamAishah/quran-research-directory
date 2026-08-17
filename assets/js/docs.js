// Document view, library browser, and semantic search pages.

function ayahChipsHtml(linkedAyat) {
  if (!linkedAyat || !linkedAyat.length) return '<span class="badge">General</span>';
  return linkedAyat
    .slice()
    .sort((a, b) => a.surah - b.surah || a.ayah - b.ayah)
    .map(a => `<a class="badge ayah-chip" href="#/surah/${a.surah}/ayah/${a.ayah}">${a.surah}:${a.ayah}</a>`)
    .join('');
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------- Document view ----------
async function renderDocView(id) {
  document.getElementById('search-box').style.display = 'none';
  const doc = await API.getDoc(id);
  if (!doc) { navigate('#/library'); return; }
  const backlinks = await API.backlinks(id);

  app.innerHTML = `
    <div class="container">
      <div class="reader-header">
        <a href="#/library" class="back-link">&larr; Library</a>
        <div class="reader-titleblock">
          <div class="page-title" style="margin:0;">${escapeHtml(doc.title)}</div>
          <div class="reader-title-en">Updated ${formatDate(doc.updatedAt)}</div>
        </div>
        <button class="nav-btn" id="doc-edit-btn">Edit</button>
        <button class="nav-btn danger" id="doc-delete-btn">Delete</button>
      </div>

      <div class="chip-row">${ayahChipsHtml(doc.linkedAyat)}</div>

      <div class="doc-content ql-editor">${doc.html || '<p class="empty-state">Empty document.</p>'}</div>

      <div class="notes-panel" style="margin-top:20px;">
        <div class="notes-label">Linked From (${backlinks.length})</div>
        ${backlinks.length ? `<div class="backlink-list">${backlinks.map(d =>
          `<a class="backlink-item" href="#/doc/${d.id}">${escapeHtml(d.title)}</a>`
        ).join('')}</div>` : '<div class="empty-state" style="padding:14px 0;">No other documents link here yet.</div>'}
      </div>
    </div>
  `;

  document.getElementById('doc-edit-btn').addEventListener('click', () => navigate(`#/doc/${id}/edit`));
  document.getElementById('doc-delete-btn').addEventListener('click', async () => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    await API.deleteDoc(id);
    navigate('#/library');
  });
}

// ---------- Library ----------
async function renderLibrary(filter) {
  document.getElementById('search-box').style.display = 'none';
  const all = await API.listDocs();
  const q = (filter || '').trim().toLowerCase();
  const docsFiltered = q ? all.filter(d => d.title.toLowerCase().includes(q)) : all;

  app.innerHTML = `
    <div class="container">
      <div class="reader-header">
        <a href="#/" class="back-link">&larr; Dashboard</a>
        <div class="reader-titleblock">
          <div class="page-title" style="margin:0;">Document Library</div>
          <div class="reader-title-en">${all.length} document${all.length === 1 ? '' : 's'}</div>
        </div>
        <button class="nav-btn primary" id="lib-new-btn">+ New Document</button>
      </div>

      <input class="search-box lib-search" id="lib-search" type="text" placeholder="Filter by title..." value="${escapeAttr(filter || '')}" style="display:block; width:100%; margin-bottom:18px;" />

      <div class="doc-list">
        ${docsFiltered.map(d => `
          <div class="doc-list-item" data-id="${d.id}">
            <div class="doc-list-title">${escapeHtml(d.title)}</div>
            <div class="chip-row">${ayahChipsHtml(d.linkedAyat)}</div>
            <div class="doc-list-date">Updated ${formatDate(d.updatedAt)}</div>
          </div>
        `).join('') || '<div class="empty-state">No documents yet. Create your first one.</div>'}
      </div>
    </div>
  `;

  document.getElementById('lib-new-btn').addEventListener('click', () => navigate('#/doc/new'));
  document.getElementById('lib-search').addEventListener('input', (e) => renderLibrary(e.target.value));
  app.querySelectorAll('.doc-list-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.ayah-chip')) return; // let chip link handle its own navigation
      navigate(`#/doc/${el.dataset.id}`);
    });
  });
}

// ---------- Semantic search ----------
async function renderSearchPage(initialQuery) {
  document.getElementById('search-box').style.display = 'none';

  app.innerHTML = `
    <div class="container">
      <div class="page-title">Semantic Search</div>
      <div class="page-subtitle">Search across all your research documents by meaning, not just exact words.</div>
      <form id="search-form" class="search-form">
        <input class="search-box" id="search-query" type="text" placeholder="e.g. patience during hardship" style="width:100%; max-width:500px;" value="${escapeAttr(initialQuery || '')}" />
        <button class="nav-btn primary" type="submit">Search</button>
      </form>
      <div id="search-results" class="search-results"></div>
    </div>
  `;

  const resultsEl = document.getElementById('search-results');

  document.getElementById('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = document.getElementById('search-query').value.trim();
    if (!q) return;
    resultsEl.innerHTML = '<div class="empty-state">Searching...</div>';
    const results = await API.search(q);
    if (!results.length) {
      resultsEl.innerHTML = '<div class="empty-state">No matching documents found.</div>';
      return;
    }
    resultsEl.innerHTML = results.map(r => `
      <div class="search-result-item" data-id="${r.doc.id}">
        <div class="doc-list-title">${escapeHtml(r.doc.title)}</div>
        <div class="search-snippet">&ldquo;${escapeHtml(r.text)}&rdquo;</div>
        <div class="chip-row">${ayahChipsHtml(r.doc.linkedAyat)} <span class="badge score-badge">${Math.round(r.score * 100)}% match</span></div>
      </div>
    `).join('');
    resultsEl.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.ayah-chip')) return;
        navigate(`#/doc/${el.dataset.id}`);
      });
    });
  });

  if (initialQuery) {
    document.getElementById('search-form').dispatchEvent(new Event('submit'));
  }
}

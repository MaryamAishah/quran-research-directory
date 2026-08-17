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
        <button class="nav-btn" id="lib-upload-btn">Upload File</button>
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
  document.getElementById('lib-upload-btn').addEventListener('click', () => navigate('#/doc/upload'));
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

// ---------- Upload PDF/DOCX/TXT as a document ----------
async function renderUploadPage() {
  document.getElementById('search-box').style.display = 'none';

  app.innerHTML = `
    <div class="container editor-container">
      <div class="reader-header">
        <a href="#/library" class="back-link">&larr; Cancel</a>
        <div class="reader-titleblock">
          <div class="page-title" style="margin:0;">Upload Document</div>
        </div>
      </div>
      <div class="page-subtitle">Upload a PDF, Word (.docx), or text file to import it as a research document. Its content becomes a normal, editable document you can refine, link, and search afterward.</div>

      <div class="editor-section-label">File</div>
      <label class="upload-dropzone" id="upload-dropzone" for="upload-file-input">
        <input type="file" id="upload-file-input" accept=".pdf,.docx,.txt" hidden />
        <span id="upload-file-name">Click to choose a PDF, DOCX, or TXT file&hellip;</span>
      </label>

      <div class="editor-section-label">Title</div>
      <input class="title-input" id="upload-title" type="text" placeholder="Defaults to the filename" />

      <div class="editor-section-label">Linked Ayaat</div>
      <div id="upload-ayah-picker-mount"></div>

      <div class="export-actions">
        <button class="nav-btn primary" id="upload-btn">Upload</button>
        <span id="upload-status" class="export-status"></span>
      </div>
    </div>
  `;

  const picker = createAyahPicker(document.getElementById('upload-ayah-picker-mount'), []);

  const fileInput = document.getElementById('upload-file-input');
  const fileNameEl = document.getElementById('upload-file-name');
  const titleInput = document.getElementById('upload-title');

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) {
      fileNameEl.textContent = 'Click to choose a PDF, DOCX, or TXT file…';
      return;
    }
    fileNameEl.textContent = f.name;
    if (!titleInput.value) titleInput.value = f.name.replace(/\.[^.]+$/, '');
  });

  document.getElementById('upload-btn').addEventListener('click', async () => {
    const file = fileInput.files[0];
    const statusEl = document.getElementById('upload-status');
    if (!file) { statusEl.textContent = 'Choose a file first.'; return; }
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) {
      statusEl.textContent = 'Only PDF, DOCX, or TXT files are supported.';
      return;
    }
    const btn = document.getElementById('upload-btn');
    btn.disabled = true;
    statusEl.textContent = 'Uploading and converting…';
    try {
      const linkedAyat = picker.isGeneral() ? [] : picker.getAyat();
      const doc = await API.uploadDoc({ file, title: titleInput.value.trim(), linkedAyat });
      navigate(`#/doc/${doc.id}`);
    } catch (e) {
      statusEl.textContent = 'Upload failed: ' + e.message;
      btn.disabled = false;
    }
  });
}

// ---------- Export ----------
async function renderExportPage() {
  document.getElementById('search-box').style.display = 'none';

  app.innerHTML = `
    <div class="container editor-container">
      <div class="page-title">Export Documents</div>
      <div class="page-subtitle">Pick the ayaat you want to export. Every document linked to any of them is included, organized ayah by ayah &mdash; a document linked to more than one selected ayah appears under each.</div>

      <div class="editor-section-label">Ayaat to include</div>
      <div id="export-ayah-picker-mount"></div>

      <div class="editor-section-label">Format</div>
      <div class="export-format-row">
        <label class="format-option"><input type="radio" name="export-format" value="pdf" checked /> PDF</label>
        <label class="format-option"><input type="radio" name="export-format" value="docx" /> Word (.docx)</label>
      </div>

      <div class="export-actions">
        <button class="nav-btn primary" id="export-btn">Export</button>
        <span id="export-status" class="export-status"></span>
      </div>
    </div>
  `;

  const picker = createAyahPicker(document.getElementById('export-ayah-picker-mount'), [], { hideGeneralOption: true });

  document.getElementById('export-btn').addEventListener('click', async () => {
    const ayat = picker.getAyat();
    const statusEl = document.getElementById('export-status');
    if (!ayat.length) {
      statusEl.textContent = 'Select at least one ayah first.';
      return;
    }
    const format = document.querySelector('input[name="export-format"]:checked').value;
    const btn = document.getElementById('export-btn');
    btn.disabled = true;
    statusEl.textContent = 'Generating export…';
    try {
      const blob = await API.exportDocs(ayat, format);
      downloadBlob(blob, `quran-research-export.${format}`);
      statusEl.textContent = 'Downloaded.';
    } catch (e) {
      statusEl.textContent = 'Export failed: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

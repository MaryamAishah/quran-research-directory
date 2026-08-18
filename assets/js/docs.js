// Document view, library browser, and semantic search pages.

function ayahChipsHtml(doc) {
  const linkedAyat = doc?.linkedAyat || [];
  const linkedSurahs = doc?.linkedSurahs || [];
  if (!linkedAyat.length && !linkedSurahs.length) return '<span class="badge">General</span>';
  const surahChips = [...linkedSurahs].sort((a, b) => a - b).map(s => {
    const info = surahByNumber(s);
    return `<a class="badge ayah-chip surah-chip" href="#/surah/${s}/ayah/1">${s}. ${info ? escapeHtml(info.englishName) : ''} (whole)</a>`;
  }).join('');
  const ayahChips = [...linkedAyat]
    .sort((a, b) => a.surah - b.surah || a.ayah - b.ayah)
    .map(a => `<a class="badge ayah-chip" href="#/surah/${a.surah}/ayah/${a.ayah}">${a.surah}:${a.ayah}</a>`)
    .join('');
  return surahChips + ayahChips;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------- Document view ----------
function processingBadgeHtml(processing) {
  if (!processing || processing.status === 'none') return '';
  const map = {
    processing: ['Processing…', 'processing'],
    'needs-review': ['Needs review', 'needs-review'],
    complete: ['Processed', 'complete'],
    error: ['Processing error', 'error'],
  };
  const [label, cls] = map[processing.status] || [processing.status, ''];
  return `<span class="badge processing-badge ${cls}">${label}</span>`;
}

async function renderDocView(id) {
  document.getElementById('search-box').style.display = 'none';
  const doc = await API.getDoc(id);
  if (!doc) { navigate('#/library'); return; }
  const backlinks = await API.backlinks(id);
  const hasPipeline = doc.processing !== undefined;
  const passages = hasPipeline ? await API.docPassages(id) : [];

  app.innerHTML = `
    <div class="container">
      <div class="reader-header">
        <a href="#/library" class="back-link">&larr; Library</a>
        <div class="reader-titleblock">
          <div class="page-title" style="margin:0;">${escapeHtml(doc.title)}</div>
          <div class="reader-title-en">Updated ${formatDate(doc.updatedAt)}</div>
        </div>
        ${processingBadgeHtml(doc.processing)}
        ${doc.processing?.status === 'error' ? '<button class="nav-btn" id="doc-retry-btn">Retry processing</button>' : ''}
        <button class="nav-btn" id="doc-edit-btn">Edit</button>
        <button class="nav-btn danger" id="doc-delete-btn">Delete</button>
      </div>

      <div class="chip-row">${ayahChipsHtml(doc)}</div>

      ${doc.processing?.status === 'error' ? `<div class="empty-state processing-error-msg">${escapeHtml(doc.processing.error || 'Processing failed.')}</div>` : ''}

      ${doc.sourceFile ? `
        <a class="original-file-link" href="/originals/${doc.id}/${encodeURIComponent(doc.sourceFile.storedName)}" target="_blank" rel="noopener">
          Download original file: ${escapeHtml(doc.sourceFile.originalName)}
        </a>
      ` : ''}

      <div class="doc-content ql-editor">${doc.html || '<p class="empty-state">Empty document.</p>'}</div>

      ${hasPipeline ? `
      <div class="notes-panel" style="margin-top:20px;">
        <div class="notes-label">Source Passages (${passages.length})</div>
        ${passages.length ? `<div class="passage-source-list">${passages.map(p => {
          const goodMatches = p.matches.filter(m => m.status === 'auto' || m.status === 'accepted');
          const locBits = [];
          if (p.location?.page) locBits.push(`p. ${p.location.page}`);
          if (p.location?.section) locBits.push(p.location.section);
          return `
            <div class="passage-source-item">
              <p class="passage-snippet">${escapeHtml(p.text.slice(0, 200))}${p.text.length > 200 ? '…' : ''}</p>
              <div class="chip-row">
                ${locBits.length ? `<span class="badge">${locBits.map(escapeHtml).join(' &middot; ')}</span>` : ''}
                ${goodMatches.map(m => `<a class="badge ayah-chip" href="#/surah/${m.surah}/ayah/${m.ayah}">${m.surah}:${m.ayah}</a>`).join('')}
                ${!goodMatches.length ? '<span class="badge">No ayah matched</span>' : ''}
              </div>
            </div>
          `;
        }).join('')}</div>` : '<div class="empty-state" style="padding:14px 0;">No passages extracted.</div>'}
      </div>
      ` : ''}

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
  const retryBtn = document.getElementById('doc-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying…';
      try {
        await API.processDoc(id);
      } catch { /* surfaced via re-render below */ }
      renderDocView(id);
    });
  }

  if (doc.processing?.status === 'processing') {
    const poll = setInterval(async () => {
      const fresh = await API.getDoc(id);
      if (!fresh || fresh.processing?.status !== 'processing') {
        clearInterval(poll);
        if (window.location.hash === `#/doc/${id}`) renderDocView(id);
      }
    }, 2000);
  }
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
            <div class="chip-row">${ayahChipsHtml(d)}</div>
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
        <div class="chip-row">${ayahChipsHtml(r.doc)} <span class="badge score-badge">${Math.round(r.score * 100)}% match</span></div>
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

      <div class="editor-section-label">Linked Ayaat &amp; Surahs</div>
      <div id="upload-ayah-picker-mount"></div>

      <label class="general-toggle auto-detect-toggle">
        <input type="checkbox" id="upload-auto-detect-toggle" checked />
        Automatically detect ayah references in this document (splits it into passages and matches them to specific ayaat)
      </label>

      <div class="export-actions">
        <button class="nav-btn primary" id="upload-btn">
          <span class="btn-spinner" id="upload-spinner" style="display:none;"></span>
          <span id="upload-btn-label">Upload</span>
        </button>
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
    const spinner = document.getElementById('upload-spinner');
    const btnLabel = document.getElementById('upload-btn-label');
    btn.disabled = true;
    spinner.style.display = '';
    btnLabel.textContent = 'Uploading…';
    statusEl.textContent = 'Uploading and converting…';
    try {
      const linkedAyat = picker.isGeneral() ? [] : picker.getAyat();
      const linkedSurahs = picker.isGeneral() ? [] : picker.getSurahs();
      const autoDetect = document.getElementById('upload-auto-detect-toggle').checked;
      const doc = await API.uploadDoc({ file, title: titleInput.value.trim(), linkedAyat, linkedSurahs, autoDetect });
      navigate(`#/doc/${doc.id}`);
    } catch (e) {
      statusEl.textContent = 'Upload failed: ' + e.message;
      btn.disabled = false;
      spinner.style.display = 'none';
      btnLabel.textContent = 'Upload';
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

// ---------- Review queue ----------
async function renderReviewPage() {
  document.getElementById('search-box').style.display = 'none';

  app.innerHTML = `
    <div class="container">
      <div class="page-title">Review Queue</div>
      <div class="page-subtitle">Uncertain ayah matches found by the document pipeline, waiting on your confirmation.</div>
      <div id="review-list"></div>
    </div>
  `;

  await loadReviewQueue();
}

async function loadReviewQueue() {
  const listEl = document.getElementById('review-list');
  if (!listEl) return;
  const items = await API.reviewQueue();
  if (!items.length) {
    listEl.innerHTML = '<div class="empty-state">Nothing needs review right now.</div>';
    return;
  }

  listEl.innerHTML = items.map(({ passage, doc }) => {
    const locBits = [];
    if (passage.location?.page) locBits.push(`p. ${passage.location.page}`);
    if (passage.location?.section) locBits.push(passage.location.section);
    const candidates = passage.matches
      .map((m, idx) => ({ ...m, idx }))
      .filter(m => m.status === 'pending-review');

    return `
      <div class="review-card" data-passage-id="${passage.id}">
        <div class="review-card-header">
          <a href="#/doc/${doc.id}">${escapeHtml(doc.title)}</a>
          ${locBits.length ? `<span class="passage-location">${locBits.map(escapeHtml).join(' &middot; ')}</span>` : ''}
        </div>
        <p class="passage-snippet">${escapeHtml(passage.text.slice(0, 400))}${passage.text.length > 400 ? '…' : ''}</p>
        <div class="review-candidates">
          ${candidates.map(c => `
            <div class="review-candidate">
              <a class="badge ayah-chip" href="#/surah/${c.surah}/ayah/${c.ayah}">${c.surah}:${c.ayah}</a>
              <span class="review-confidence">${Math.round(c.confidence * 100)}% confidence</span>
              <button class="nav-btn" data-action="accept" data-idx="${c.idx}">Accept</button>
              <button class="nav-btn danger" data-action="reject" data-idx="${c.idx}">Reject</button>
            </div>
          `).join('')}
        </div>
        <button class="nav-btn" data-action="toggle-manual">+ Add / change ayaat manually</button>
        <div class="manual-picker-mount" style="display:none;"></div>
        <button class="nav-btn primary" data-action="save-manual" style="display:none;">Save</button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.review-card').forEach(card => {
    const passageId = card.dataset.passageId;

    card.querySelectorAll('[data-action="accept"], [data-action="reject"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await API.reviewPassage(passageId, { action: btn.dataset.action, matchIndex: parseInt(btn.dataset.idx, 10) });
        loadReviewQueue();
      });
    });

    const toggleBtn = card.querySelector('[data-action="toggle-manual"]');
    const pickerMount = card.querySelector('.manual-picker-mount');
    const saveBtn = card.querySelector('[data-action="save-manual"]');
    let picker = null;

    toggleBtn.addEventListener('click', () => {
      const showing = pickerMount.style.display !== 'none';
      if (showing) {
        pickerMount.style.display = 'none';
        saveBtn.style.display = 'none';
        return;
      }
      pickerMount.style.display = '';
      saveBtn.style.display = '';
      if (!picker) picker = createAyahPicker(pickerMount, [], { hideGeneralOption: true });
    });

    saveBtn.addEventListener('click', async () => {
      if (!picker) return;
      const matches = picker.getAyat();
      if (!matches.length) return;
      saveBtn.disabled = true;
      await API.reviewPassage(passageId, { action: 'set', matches });
      loadReviewQueue();
    });
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

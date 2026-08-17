// Document editor: create/edit a research document with rich formatting,
// image paste-import, ayah linking, and [[doc]]-style linking.

async function renderEditor({ mode, id, prefillSurah, prefillAyah }) {
  document.getElementById('search-box').style.display = 'none';

  let doc = null;
  if (mode === 'edit') {
    doc = await API.getDoc(id);
    if (!doc) { navigate('#/library'); return; }
  }

  const draftId = mode === 'edit' ? id : crypto.randomUUID();
  const isNew = mode !== 'edit';

  app.innerHTML = `
    <div class="container editor-container">
      <div class="reader-header">
        <a href="#/" class="back-link" id="editor-cancel">&larr; Cancel</a>
        <div class="reader-titleblock">
          <div class="page-title" style="margin:0;">${isNew ? 'New Document' : 'Edit Document'}</div>
        </div>
        ${!isNew ? '<button class="nav-btn danger" id="editor-delete">Delete</button>' : ''}
        <button class="nav-btn primary" id="editor-save">Save</button>
      </div>

      <input class="title-input" id="doc-title" type="text" placeholder="Document title" value="${escapeAttr(doc?.title || '')}" />

      <div class="editor-section-label">Linked Ayaat</div>
      <div id="ayah-picker-mount"></div>

      <div class="editor-section-label">Content</div>
      <div id="quill-toolbar">
        <span class="ql-formats">
          <select class="ql-header">
            <option value="1"></option>
            <option value="2"></option>
            <option value="3"></option>
            <option selected></option>
          </select>
        </span>
        <span class="ql-formats">
          <button class="ql-bold"></button>
          <button class="ql-italic"></button>
          <button class="ql-underline"></button>
          <button class="ql-strike"></button>
        </span>
        <span class="ql-formats">
          <select class="ql-color"></select>
          <select class="ql-background"></select>
        </span>
        <span class="ql-formats">
          <button class="ql-list" value="ordered"></button>
          <button class="ql-list" value="bullet"></button>
          <button class="ql-blockquote"></button>
        </span>
        <span class="ql-formats">
          <button class="ql-link"></button>
          <button class="ql-image"></button>
        </span>
        <span class="ql-formats">
          <button type="button" class="ql-doclink" title="Link to another document">Link doc</button>
        </span>
        <span class="ql-formats">
          <button class="ql-clean"></button>
        </span>
      </div>
      <div id="quill-editor">${doc?.html || ''}</div>
    </div>
  `;

  const pickerMount = document.getElementById('ayah-picker-mount');
  const picker = createAyahPicker(pickerMount, doc?.linkedAyat || (prefillSurah ? [{ surah: prefillSurah, ayah: prefillAyah }] : []));
  if (isNew && prefillSurah) picker.setInitial([{ surah: prefillSurah, ayah: prefillAyah }]);

  const quill = new Quill('#quill-editor', {
    theme: 'snow',
    modules: { toolbar: '#quill-toolbar' },
  });

  // ---- Image upload via toolbar button ----
  const toolbar = quill.getModule('toolbar');
  toolbar.addHandler('image', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const range = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
      const { url } = await API.uploadImage(draftId, file);
      if (url) quill.insertEmbed(range.index, 'image', url, 'user');
    };
    input.click();
  });

  // ---- Import pasted images (Google Docs / web) into local storage ----
  quill.root.addEventListener('paste', () => {
    setTimeout(async () => {
      const imgs = quill.root.querySelectorAll('img');
      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        if (!src || src.startsWith('/media/')) continue;
        try {
          if (src.startsWith('data:')) {
            const { url } = await API.importImage(draftId, { dataUrl: src });
            if (url) img.setAttribute('src', url);
          } else if (/^https?:\/\//.test(src)) {
            const { url } = await API.importImage(draftId, { sourceUrl: src });
            if (url) img.setAttribute('src', url);
          }
        } catch (e) { /* leave original src if import fails */ }
      }
    }, 150);
  });

  // ---- Link-to-document button ----
  const allDocs = await API.listDocs();
  const docLinkBtn = document.querySelector('.ql-doclink');
  docLinkBtn.addEventListener('click', () => {
    const range = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
    openDocLinkPopover(docLinkBtn, allDocs.filter(d => d.id !== draftId), (picked) => {
      quill.clipboard.dangerouslyPasteHTML(range.index, `<a href="#/doc/${picked.id}">${escapeHtml(picked.title)}</a>&nbsp;`, 'user');
      quill.setSelection(range.index + picked.title.length + 1, 0, 'silent');
    });
  });

  // ---- Save / Cancel / Delete ----
  document.getElementById('editor-cancel').addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  document.getElementById('editor-save').addEventListener('click', async () => {
    const title = document.getElementById('doc-title').value.trim() || 'Untitled document';
    const html = quill.root.innerHTML;
    const linkedAyat = picker.isGeneral() ? [] : picker.getAyat();
    let saved;
    if (isNew) {
      saved = await API.createDoc({ id: draftId, title, html, linkedAyat });
    } else {
      saved = await API.updateDoc(id, { title, html, linkedAyat });
    }
    navigate(`#/doc/${saved.id}`);
  });

  if (!isNew) {
    document.getElementById('editor-delete').addEventListener('click', async () => {
      if (!confirm('Delete this document? This cannot be undone.')) return;
      await API.deleteDoc(id);
      navigate('#/library');
    });
  }
}

function openDocLinkPopover(anchorEl, docs, onPick) {
  closeDocLinkPopover();
  const rect = anchorEl.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'doclink-popover';
  pop.id = 'doclink-popover';
  pop.style.top = `${rect.bottom + window.scrollY + 6}px`;
  pop.style.left = `${rect.left + window.scrollX}px`;
  pop.innerHTML = `
    <input class="doclink-search" type="text" placeholder="Search documents..." />
    <div class="doclink-results"></div>
  `;
  document.body.appendChild(pop);

  const input = pop.querySelector('.doclink-search');
  const results = pop.querySelector('.doclink-results');

  function renderResults(q) {
    const filtered = docs.filter(d => d.title.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
    results.innerHTML = filtered.map(d =>
      `<div class="doclink-result" data-id="${d.id}">${escapeHtml(d.title)}</div>`
    ).join('') || '<div class="doclink-empty">No matching documents</div>';
    results.querySelectorAll('.doclink-result').forEach(el => {
      el.addEventListener('click', () => {
        const doc = docs.find(d => d.id === el.dataset.id);
        onPick(doc);
        closeDocLinkPopover();
      });
    });
  }

  input.addEventListener('input', () => renderResults(input.value));
  renderResults('');
  input.focus();

  setTimeout(() => {
    document.addEventListener('mousedown', outsideClickHandler);
    document.addEventListener('keydown', escHandler);
  }, 0);

  function outsideClickHandler(e) {
    if (!pop.contains(e.target)) closeDocLinkPopover();
  }
  function escHandler(e) {
    if (e.key === 'Escape') closeDocLinkPopover();
  }
}

function closeDocLinkPopover() {
  const existing = document.getElementById('doclink-popover');
  if (existing) existing.remove();
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

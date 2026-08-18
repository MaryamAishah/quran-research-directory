const API = {
  async listDocs() {
    return (await fetch('/api/docs')).json();
  },
  async getDoc(id) {
    const r = await fetch(`/api/docs/${id}`);
    if (!r.ok) return null;
    return r.json();
  },
  async backlinks(id) {
    return (await fetch(`/api/docs/${id}/backlinks`)).json();
  },
  async createDoc({ id, title, html, linkedAyat, linkedSurahs, autoDetect }) {
    const r = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title, html, linkedAyat, linkedSurahs, autoDetect }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Save failed');
    }
    return r.json();
  },
  async updateDoc(id, { title, html, linkedAyat, linkedSurahs, autoDetect }) {
    const r = await fetch(`/api/docs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, html, linkedAyat, linkedSurahs, autoDetect }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Save failed');
    }
    return r.json();
  },
  async deleteDoc(id) {
    const r = await fetch(`/api/docs/${id}`, { method: 'DELETE' });
    return r.json();
  },
  async docsForAyah(surah, ayah) {
    return (await fetch(`/api/ayah/${surah}/${ayah}/docs`)).json();
  },
  async docsForSurah(surah) {
    return (await fetch(`/api/surah/${surah}/docs`)).json();
  },
  async search(q) {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    return r.json();
  },
  async uploadImage(docId, file) {
    const fd = new FormData();
    fd.append('docId', docId);
    fd.append('image', file);
    const r = await fetch('/api/upload-image', { method: 'POST', body: fd });
    return r.json();
  },
  async importImage(docId, { dataUrl, sourceUrl }) {
    const r = await fetch('/api/import-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId, dataUrl, sourceUrl }),
    });
    return r.json();
  },
  async uploadDoc({ file, title, linkedAyat, linkedSurahs, autoDetect }) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title || '');
    fd.append('linkedAyat', JSON.stringify(linkedAyat || []));
    fd.append('linkedSurahs', JSON.stringify(linkedSurahs || []));
    fd.append('autoDetect', autoDetect === false ? 'false' : 'true');
    const r = await fetch('/api/docs/upload', { method: 'POST', body: fd });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Upload failed');
    }
    return r.json();
  },
  async exportDocs(ayat, format) {
    const r = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ayat, format }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Export failed');
    }
    return r.blob();
  },
  async processDoc(id, force) {
    const r = await fetch(`/api/docs/${id}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: !!force }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Processing failed');
    }
    return r.json();
  },
  async docPassages(id) {
    return (await fetch(`/api/docs/${id}/passages`)).json();
  },
  async passagesForAyah(surah, ayah) {
    return (await fetch(`/api/ayah/${surah}/${ayah}/passages`)).json();
  },
  async reviewQueue() {
    return (await fetch('/api/review-queue')).json();
  },
  async reviewPassage(id, body) {
    const r = await fetch(`/api/passages/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Review action failed');
    }
    return r.json();
  },
};

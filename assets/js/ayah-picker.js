// Reusable ayah-linking widget: lets the user attach a doc to one or more
// specific ayaat (individually or by range), to one or more whole surahs
// (general commentary on the surah, not tied to one ayah), or mark it fully
// general (no ayaat, no surahs).
function createAyahPicker(container, initialAyat = [], options = {}) {
  const { hideGeneralOption = false } = options;
  let ayat = [...initialAyat]; // [{surah, ayah}]
  let surahs = [...(options.initialSurahs || [])]; // [surahNumber]

  const surahOptions = QURAN_DATA.map(s =>
    `<option value="${s.number}">${s.number}. ${s.englishName}</option>`
  ).join('');

  container.innerHTML = `
    <div class="ayah-picker">
      ${hideGeneralOption ? '' : `
      <label class="general-toggle">
        <input type="checkbox" id="ap-general" />
        General document (not linked to specific ayaat or surahs)
      </label>
      `}
      <div class="ap-form" id="ap-form">
        <select class="ap-select" id="ap-surah">${surahOptions}</select>
        <input class="ap-input" id="ap-start" type="number" min="1" placeholder="Ayah" title="Start ayah" />
        <span class="ap-to">to</span>
        <input class="ap-input" id="ap-end" type="number" min="1" placeholder="(optional)" title="End ayah (optional)" />
        <button type="button" class="nav-btn" id="ap-add">+ Add Ayaat</button>
        <button type="button" class="nav-btn" id="ap-add-surah" title="Link to this whole surah, not a specific ayah">+ Add Whole Surah</button>
      </div>
      <div class="ap-chip-group">
        <div class="ap-chip-label">Ayaat</div>
        <div class="ap-chips" id="ap-chips"></div>
      </div>
      <div class="ap-chip-group">
        <div class="ap-chip-label">Whole surahs</div>
        <div class="ap-chips" id="ap-surah-chips"></div>
      </div>
    </div>
  `;

  const generalCb = container.querySelector('#ap-general'); // null when hideGeneralOption
  const form = container.querySelector('#ap-form');
  const chipsEl = container.querySelector('#ap-chips');
  const surahChipsEl = container.querySelector('#ap-surah-chips');
  const chipGroups = container.querySelectorAll('.ap-chip-group');
  const surahSel = container.querySelector('#ap-surah');
  const startInput = container.querySelector('#ap-start');
  const endInput = container.querySelector('#ap-end');

  function renderChips() {
    if (!ayat.length) {
      chipsEl.innerHTML = '<span class="ap-empty">None yet.</span>';
    } else {
      const sorted = [...ayat].sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
      chipsEl.innerHTML = sorted.map(a =>
        `<span class="ap-chip" data-s="${a.surah}" data-a="${a.ayah}">${a.surah}:${a.ayah} <button type="button" class="ap-chip-x">&times;</button></span>`
      ).join('');
      chipsEl.querySelectorAll('.ap-chip-x').forEach(btn => {
        btn.addEventListener('click', () => {
          const chip = btn.closest('.ap-chip');
          const s = parseInt(chip.dataset.s, 10);
          const a = parseInt(chip.dataset.a, 10);
          ayat = ayat.filter(x => !(x.surah === s && x.ayah === a));
          renderChips();
        });
      });
    }

    if (!surahs.length) {
      surahChipsEl.innerHTML = '<span class="ap-empty">None yet.</span>';
    } else {
      const sortedSurahs = [...surahs].sort((a, b) => a - b);
      surahChipsEl.innerHTML = sortedSurahs.map(s => {
        const info = surahByNumber(s);
        return `<span class="ap-chip ap-chip-surah" data-s="${s}">${s}. ${info ? info.englishName : ''} <button type="button" class="ap-chip-x">&times;</button></span>`;
      }).join('');
      surahChipsEl.querySelectorAll('.ap-chip-x').forEach(btn => {
        btn.addEventListener('click', () => {
          const s = parseInt(btn.closest('.ap-chip').dataset.s, 10);
          surahs = surahs.filter(x => x !== s);
          renderChips();
        });
      });
    }
  }

  function setGeneral(isGeneral) {
    if (generalCb) generalCb.checked = isGeneral;
    form.style.display = isGeneral ? 'none' : '';
    chipGroups.forEach(el => { el.style.display = isGeneral ? 'none' : ''; });
  }

  if (generalCb) {
    generalCb.addEventListener('change', () => {
      if (generalCb.checked) { ayat = []; surahs = []; }
      setGeneral(generalCb.checked);
      renderChips();
    });
  }

  container.querySelector('#ap-add').addEventListener('click', () => {
    const surah = parseInt(surahSel.value, 10);
    const surahInfo = surahByNumber(surah);
    let start = parseInt(startInput.value, 10);
    let end = parseInt(endInput.value, 10) || start;
    if (!start || start < 1) return;
    if (end < start) end = start;
    end = Math.min(end, surahInfo.ayahCount);
    start = Math.min(start, surahInfo.ayahCount);
    for (let n = start; n <= end; n++) {
      if (!ayat.some(x => x.surah === surah && x.ayah === n)) {
        ayat.push({ surah, ayah: n });
      }
    }
    startInput.value = '';
    endInput.value = '';
    renderChips();
  });

  container.querySelector('#ap-add-surah').addEventListener('click', () => {
    const surah = parseInt(surahSel.value, 10);
    if (!surahs.includes(surah)) surahs.push(surah);
    renderChips();
  });

  setGeneral(false);
  renderChips();

  return {
    getAyat: () => [...ayat],
    getSurahs: () => [...surahs],
    isGeneral: () => !!(generalCb && generalCb.checked),
    setInitial(list, surahList = []) {
      ayat = [...list];
      surahs = [...surahList];
      setGeneral(false);
      renderChips();
    },
    markGeneral() {
      ayat = [];
      surahs = [];
      setGeneral(true);
      renderChips();
    },
  };
}

// Reusable ayah-linking widget: lets the user attach a doc to one or more
// specific ayaat (individually or by range), or mark it general (no ayaat).
function createAyahPicker(container, initialAyat = []) {
  let ayat = [...initialAyat]; // [{surah, ayah}]

  const surahOptions = QURAN_DATA.map(s =>
    `<option value="${s.number}">${s.number}. ${s.englishName}</option>`
  ).join('');

  container.innerHTML = `
    <div class="ayah-picker">
      <label class="general-toggle">
        <input type="checkbox" id="ap-general" />
        General document (not linked to specific ayaat)
      </label>
      <div class="ap-form" id="ap-form">
        <select class="ap-select" id="ap-surah">${surahOptions}</select>
        <input class="ap-input" id="ap-start" type="number" min="1" placeholder="Ayah" title="Start ayah" />
        <span class="ap-to">to</span>
        <input class="ap-input" id="ap-end" type="number" min="1" placeholder="(optional)" title="End ayah (optional)" />
        <button type="button" class="nav-btn" id="ap-add">+ Add</button>
      </div>
      <div class="ap-chips" id="ap-chips"></div>
    </div>
  `;

  const generalCb = container.querySelector('#ap-general');
  const form = container.querySelector('#ap-form');
  const chipsEl = container.querySelector('#ap-chips');
  const surahSel = container.querySelector('#ap-surah');
  const startInput = container.querySelector('#ap-start');
  const endInput = container.querySelector('#ap-end');

  function renderChips() {
    if (!ayat.length) {
      chipsEl.innerHTML = '<span class="ap-empty">No ayaat linked yet.</span>';
      return;
    }
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

  function setGeneral(isGeneral) {
    generalCb.checked = isGeneral;
    form.style.display = isGeneral ? 'none' : '';
    chipsEl.style.display = isGeneral ? 'none' : '';
  }

  generalCb.addEventListener('change', () => {
    if (generalCb.checked) ayat = [];
    setGeneral(generalCb.checked);
    renderChips();
  });

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

  setGeneral(false);
  renderChips();

  return {
    getAyat: () => [...ayat],
    isGeneral: () => generalCb.checked,
    setInitial(list) {
      ayat = [...list];
      setGeneral(false);
      renderChips();
    },
    markGeneral() {
      ayat = [];
      setGeneral(true);
      renderChips();
    },
  };
}

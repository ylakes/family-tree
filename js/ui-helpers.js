// Small rendering helpers shared across views.
const UiHelpers = (() => {
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function photoHtml(person, t, sizeClass) {
    if (person.photo) return `<img src="${person.photo}" alt="">`;
    return `<span>${t('person.noPhoto')}</span>`;
  }

  function lifespanLabel(person, t) {
    const hasBirthInfo = DataModel.hasDate(person.birthDate);
    const born = hasBirthInfo ? DataModel.formatDate(person.birthDate, t) : null;
    if (person.isDeceased) {
      const died = DataModel.hasDate(person.deathDate) ? DataModel.formatDate(person.deathDate, t) : t('person.unknown');
      const age = DataModel.computeAge(person.birthDate, new Date(), person.deathDate);
      const ageStr = age !== null ? ` (${t('person.ageAtDeath')}: ${age})` : '';
      return `${born ? `${t('person.born')} ${born} — ` : ''}${t('person.died')} ${died}${ageStr}`;
    }
    if (!hasBirthInfo) return '';
    const age = DataModel.computeAge(person.birthDate, new Date());
    const ageStr = age !== null ? ` (${t('person.age')}: ${age})` : '';
    return `${t('person.born')} ${born}${ageStr}`;
  }

  // Exactly 1-3 forced-separate lines: name, then "* <born>" (always,
  // falling back to "Unknown"), then "† <died>" only if deceased. No age,
  // no em dash — the compact genealogical convention used by the full tree
  // view, shared here so the small cards (parents/partners/children) match.
  function personLines(person, t) {
    const name = DataModel.fullName(person) || t('person.unnamed');
    const born = `* ${DataModel.formatDate(person.birthDate, t)}`;
    const died = person.isDeceased ? `† ${DataModel.formatDate(person.deathDate, t)}` : null;
    return died ? [name, born, died] : [name, born];
  }

  // Card with photo, name, and born/died lines. Clicking calls onClick(person.id).
  function personCard(person, t, onClick, options = {}) {
    const div = document.createElement('button');
    div.type = 'button';
    div.className = 'person-card';
    div.innerHTML = personCardHtml(person, t);
    if (onClick) div.onclick = () => onClick(person.id);
    return div;
  }

  function personCardHtml(person, t) {
    const [name, ...metaLines] = personLines(person, t);
    return `<span class="person-photo">${photoHtml(person, t)}</span>
      <span>
        <span class="person-card__name">${escapeHtml(name)}</span>
        ${metaLines.map((line) => `<span class="person-card__meta">${escapeHtml(line)}</span>`).join('')}
      </span>`;
  }

  // Every view's "download as PDF" control, as a single small icon button
  // (matching the app header's Save/Export icon-btn styling) instead of
  // each view rolling its own text button — that duplication is exactly
  // what let the six-plus copies drift out of sync with each other
  // (different placement, different markup) in the first place. The
  // button triggers the browser's print dialog, hence a printer icon
  // rather than a download arrow — same "icon matches the actual
  // mechanism" logic as the floppy-disk Save icon next to it.
  function printButtonHtml(t) {
    return `<button type="button" class="icon-btn no-print" id="btn-print" title="${t('actions.downloadPdf')}" aria-label="${t('actions.downloadPdf')}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 6 2 18 2 18 9"/>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
        <rect x="6" y="14" width="12" height="8"/>
      </svg>
    </button>`;
  }

  // Wires the button rendered by printButtonHtml — call once per render
  // after the view's markup is in the DOM.
  function wirePrintButton(container) {
    const btn = container.querySelector('#btn-print');
    if (btn) btn.onclick = () => window.print();
  }

  return {
    escapeHtml, photoHtml, lifespanLabel, personLines, personCard, personCardHtml,
    printButtonHtml, wirePrintButton,
  };
})();

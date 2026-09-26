const ViewAnniversaries = (() => {
  function nextOccurrence(month, day, today) {
    let year = today.getFullYear();
    let candidate = new Date(year, month - 1, day);
    if (candidate < stripTime(today)) candidate = new Date(year + 1, month - 1, day);
    return candidate;
  }
  function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function formatMonthDay(d) {
    return d.toLocaleDateString(DataModel.currentLocale(), { month: 'long', day: 'numeric' });
  }

  function render(container) {
    const t = App.t;
    const { data } = App.getState();
    const today = new Date();

    const eligible = DataModel.allUnions(data)
      .filter((u) => u.status === 'current' && DataModel.hasMonthDay(u.startDate))
      .map((u) => {
        const occurrence = nextOccurrence(u.startDate.month, u.startDate.day, today);
        const years = DataModel.hasYear(u.startDate) ? occurrence.getFullYear() - u.startDate.year : null;
        return { union: u, occurrence, years };
      })
      .sort((a, b) => a.occurrence - b.occurrence);

    container.innerHTML = `
      <div class="view-header">
        <h2>${t('anniversaries.heading')}</h2>
        ${UiHelpers.printButtonHtml(t)}
      </div>
      <div class="list-section" id="anniv-list"></div>`;
    UiHelpers.wirePrintButton(container);

    const listBox = container.querySelector('#anniv-list');
    if (eligible.length === 0) {
      listBox.innerHTML = `<p class="empty-note">${t('anniversaries.noUpcoming')}</p>`;
      return;
    }
    listBox.innerHTML = `<div class="boxed-list">${eligible.map(({ union, occurrence, years }) => {
      const names = union.partners.map((pid) => `<span class="date-row__name" data-goto="${pid}">${UiHelpers.escapeHtml(DataModel.fullName(DataModel.getPerson(data, pid)) || t('person.unnamed'))}</span>`).join(' & ');
      const yearsStr = years !== null ? `<span>${years} ${t('anniversaries.years')}</span>` : '';
      return `<div class="date-row">
        <span class="date-row__date">${formatMonthDay(occurrence)}</span>
        <span>${names} — ${t(`union.${union.type}`)}</span>
        ${yearsStr}
      </div>`;
    }).join('')}</div>`;

    listBox.querySelectorAll('.date-row__name[data-goto]').forEach((span) => {
      span.onclick = (e) => { e.stopPropagation(); App.setFocusedPerson(span.dataset.goto); };
      span.style.cursor = 'pointer';
    });
  }

  return { render };
})();

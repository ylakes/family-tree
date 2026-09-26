const ViewCalendar = (() => {
  function nextOccurrence(month, day, today) {
    let year = today.getFullYear();
    let candidate = new Date(year, month - 1, day);
    if (candidate < stripTime(today)) candidate = new Date(year + 1, month - 1, day);
    return candidate;
  }

  function stripTime(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function formatMonthDay(d) {
    return d.toLocaleDateString(DataModel.currentLocale(), { month: 'long', day: 'numeric' });
  }

  function render(container) {
    const t = App.t;
    const { data } = App.getState();
    const today = new Date();
    const withMonthDay = DataModel.allPeople(data).filter((p) => DataModel.hasMonthDay(p.birthDate));

    const living = withMonthDay.filter((p) => !p.isDeceased).map((p) => ({
      person: p, occurrence: nextOccurrence(p.birthDate.month, p.birthDate.day, today),
    })).sort((a, b) => a.occurrence - b.occurrence);

    const deceased = withMonthDay.filter((p) => p.isDeceased).map((p) => ({
      person: p, occurrence: nextOccurrence(p.birthDate.month, p.birthDate.day, today),
    })).sort((a, b) => a.occurrence - b.occurrence);

    container.innerHTML = `
      <div class="view-header">
        <h2>${t('calendar.heading')}</h2>
        ${UiHelpers.printButtonHtml(t)}
      </div>
      <div class="list-section">
        <h3>${t('calendar.upcoming')}</h3>
        <div id="living-list"></div>
      </div>
      <div class="list-section">
        <h3>${t('calendar.rememberedOnThisDay')}</h3>
        <div id="deceased-list"></div>
      </div>`;

    UiHelpers.wirePrintButton(container);

    const livingBox = container.querySelector('#living-list');
    livingBox.innerHTML = living.length ? `<div class="boxed-list">${living.map(({ person, occurrence }) => {
      const turns = DataModel.computeAge(person.birthDate, occurrence);
      const turnsStr = turns !== null ? `<span>${t('calendar.turns')} ${turns}</span>` : '';
      return `<div class="date-row" data-goto="${person.id}">
        <span class="date-row__date">${formatMonthDay(occurrence)}</span>
        <span class="date-row__name">${UiHelpers.escapeHtml(DataModel.fullName(person))}</span>
        ${turnsStr}
      </div>`;
    }).join('')}</div>` : `<p class="empty-note">${t('calendar.noUpcoming')}</p>`;

    const deceasedBox = container.querySelector('#deceased-list');
    deceasedBox.innerHTML = deceased.length ? `<div class="boxed-list">${deceased.map(({ person, occurrence }) => {
      return `<div class="date-row" data-goto="${person.id}">
        <span class="date-row__date">${formatMonthDay(occurrence)}</span>
        <span class="date-row__name">${UiHelpers.escapeHtml(DataModel.fullName(person))}</span>
        <span class="badge badge--deceased">${t('person.isDeceased')}</span>
      </div>`;
    }).join('')}</div>` : `<p class="empty-note">${t('calendar.noRemembered')}</p>`;

    container.querySelectorAll('.date-row[data-goto]').forEach((row) => {
      row.onclick = () => App.setFocusedPerson(row.dataset.goto);
      row.style.cursor = 'pointer';
    });
  }

  return { render };
})();

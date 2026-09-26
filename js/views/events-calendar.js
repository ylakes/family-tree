// Combined calendar: a month-grid view showing both birthdays (living and
// deceased/"remembered") and current unions' anniversaries on their
// recurring day, alongside the existing separate list-based Birthdays and
// Anniversaries views (this doesn't replace either — see settings.js if
// you want to hide the list views once this covers what you need).
const ViewEventsCalendar = (() => {
  let viewYear = null;
  let viewMonth = null; // 0-indexed, JS Date convention

  function collectEventsByDay(data, t) {
    const map = new Map();
    const add = (month, day, entry) => {
      const key = `${month}-${day}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    };
    DataModel.allPeople(data).forEach((p) => {
      if (!DataModel.hasMonthDay(p.birthDate)) return;
      add(p.birthDate.month, p.birthDate.day, {
        type: p.isDeceased ? 'remembered' : 'birthday',
        id: p.id,
        label: DataModel.fullName(p) || t('person.unnamed'),
      });
    });
    DataModel.allUnions(data).forEach((u) => {
      if (u.status !== 'current' || !DataModel.hasMonthDay(u.startDate)) return;
      const names = u.partners.map((pid) => DataModel.fullName(DataModel.getPerson(data, pid)) || t('person.unnamed')).join(' & ');
      add(u.startDate.month, u.startDate.day, { type: 'anniversary', id: u.partners[0], label: names });
    });
    return map;
  }

  // Reference week of Monday 1 Jan 2024 to pull locale-correct short
  // weekday names in order, then arranged Mon-first or Sun-first as needed.
  function weekdayHeaderLabels(locale, mondayFirst) {
    const labels = [];
    for (let i = 0; i < 7; i++) {
      labels.push(new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }));
    }
    return mondayFirst ? labels : [labels[6], ...labels.slice(0, 6)];
  }

  function buildCells(year, month, mondayFirst) {
    const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun..6=Sat
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leading = mondayFirst ? (firstWeekday + 6) % 7 : firstWeekday;
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function monthYearLabel(year, month, locale) {
    return new Date(year, month, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }

  function renderTag(ev) {
    return `<button type="button" class="events-cal-tag events-cal-tag--${ev.type}" data-goto="${ev.id}">${UiHelpers.escapeHtml(ev.label)}</button>`;
  }

  function render(container) {
    const t = App.t;
    const { data } = App.getState();
    const today = new Date();
    if (viewYear === null) { viewYear = today.getFullYear(); viewMonth = today.getMonth(); }

    const locale = DataModel.currentLocale();
    const mondayFirst = locale.startsWith('de');
    const eventsByDay = collectEventsByDay(data, t);

    container.innerHTML = `
      <div class="view-header">
        <h2>${t('eventsCalendar.heading')}</h2>
        ${UiHelpers.printButtonHtml(t)}
      </div>
      <div class="events-cal-toolbar">
        <div class="no-print">
          <button class="btn btn--small" id="cal-prev">‹ ${t('eventsCalendar.previousMonth')}</button>
          <button class="btn btn--small" id="cal-today">${t('eventsCalendar.today')}</button>
          <button class="btn btn--small" id="cal-next">${t('eventsCalendar.nextMonth')} ›</button>
        </div>
        <span class="events-cal-toolbar__month">${UiHelpers.escapeHtml(monthYearLabel(viewYear, viewMonth, locale))}</span>
      </div>
      <div class="events-cal-legend no-print">
        <span><span class="events-cal-legend__dot events-cal-legend__dot--birthday"></span>${t('eventsCalendar.legendBirthday')}</span>
        <span><span class="events-cal-legend__dot events-cal-legend__dot--anniversary"></span>${t('eventsCalendar.legendAnniversary')}</span>
        <span><span class="events-cal-legend__dot events-cal-legend__dot--remembered"></span>${t('eventsCalendar.legendRemembered')}</span>
      </div>
      <div class="events-cal-grid" id="cal-grid"></div>`;

    UiHelpers.wirePrintButton(container);
    container.querySelector('#cal-prev').onclick = () => {
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      App.rerender();
    };
    container.querySelector('#cal-next').onclick = () => {
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      App.rerender();
    };
    container.querySelector('#cal-today').onclick = () => {
      viewYear = today.getFullYear();
      viewMonth = today.getMonth();
      App.rerender();
    };

    const grid = container.querySelector('#cal-grid');
    const weekdayLabels = weekdayHeaderLabels(locale, mondayFirst);
    const cells = buildCells(viewYear, viewMonth, mondayFirst);

    let html = weekdayLabels.map((w) => `<div class="events-cal-weekday">${UiHelpers.escapeHtml(w)}</div>`).join('');
    cells.forEach((day) => {
      if (day === null) { html += '<div class="events-cal-day is-empty"></div>'; return; }
      const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
      const dayEvents = eventsByDay.get(`${viewMonth + 1}-${day}`) || [];
      const tags = dayEvents.map(renderTag).join('');
      html += `<div class="events-cal-day${isToday ? ' is-today' : ''}">
        <span class="events-cal-day__number">${day}</span>
        ${tags}
      </div>`;
    });
    grid.innerHTML = html;

    grid.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.onclick = () => App.setFocusedPerson(btn.dataset.goto);
    });
  }

  return { render };
})();

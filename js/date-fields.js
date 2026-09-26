// Shared partial-date input widget (year/month/day, all optional) used by
// the person form and relationship editor. There's no separate "how much
// do you know" selector — whatever fields are filled in determine what the
// app can show or compute (see hasYear/hasMonthDay in data-model.js).
const DateFieldsUI = (() => {
  function html(prefix, date, t) {
    const locale = DataModel.currentLocale();
    const monthOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
      const name = new Date(2000, m - 1, 1).toLocaleString(locale, { month: 'long' });
      return `<option value="${m}" ${date.month === m ? 'selected' : ''}>${name}</option>`;
    }).join('');
    return `
      <div class="date-fields" data-date-group="${prefix}">
        <input type="number" placeholder="${t('date.year')}" data-field="${prefix}-year" value="${date.year ?? ''}" min="1" max="2200">
        <select data-field="${prefix}-month">
          <option value="">${t('date.month')}</option>
          ${monthOptions}
        </select>
        <input type="number" placeholder="${t('date.day')}" data-field="${prefix}-day" value="${date.day ?? ''}" min="1" max="31">
      </div>`;
  }

  function read(box, prefix) {
    const yearRaw = box.querySelector(`[data-field="${prefix}-year"]`).value;
    const monthRaw = box.querySelector(`[data-field="${prefix}-month"]`).value;
    const dayRaw = box.querySelector(`[data-field="${prefix}-day"]`).value;
    return {
      year: yearRaw ? parseInt(yearRaw, 10) : null,
      month: monthRaw ? parseInt(monthRaw, 10) : null,
      day: dayRaw ? parseInt(dayRaw, 10) : null,
    };
  }

  return { html, read };
})();

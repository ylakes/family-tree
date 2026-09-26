const ViewContacts = (() => {
  let sortKey = 'name';
  let sortAsc = true;

  function render(container) {
    const t = App.t;
    const { data } = App.getState();
    const people = DataModel.allPeople(data).filter((p) => p.email || p.phone);

    container.innerHTML = `
      <div class="view-header">
        <h2>${t('contacts.heading')}</h2>
        ${UiHelpers.printButtonHtml(t)}
      </div>
      <div class="search-bar no-print">
        <input type="text" id="contacts-search" placeholder="${t('contacts.search')}">
      </div>
      <div id="contacts-table-wrap"></div>`;

    UiHelpers.wirePrintButton(container);
    const searchInput = container.querySelector('#contacts-search');
    searchInput.oninput = () => renderTable(container, people, searchInput.value.trim().toLowerCase(), t);
    renderTable(container, people, '', t);
  }

  function renderTable(container, people, query, t) {
    const wrap = container.querySelector('#contacts-table-wrap');
    let filtered = people.filter((p) => {
      if (!query) return true;
      const hay = `${p.firstName} ${p.lastName} ${p.email || ''} ${p.phone || ''}`.toLowerCase();
      return hay.includes(query);
    });
    filtered = filtered.slice().sort((a, b) => {
      const av = sortKey === 'name' ? DataModel.fullName(a) || '' : (a[sortKey] || '');
      const bv = sortKey === 'name' ? DataModel.fullName(b) || '' : (b[sortKey] || '');
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    if (filtered.length === 0) {
      wrap.innerHTML = `<p class="empty-note">${t('contacts.noContacts')}</p>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th data-sort="name">${t('contacts.name')}</th>
          <th data-sort="email">${t('contacts.email')}</th>
          <th data-sort="phone">${t('contacts.phone')}</th>
        </tr></thead>
        <tbody>
          ${filtered.map((p) => `<tr data-goto="${p.id}">
            <td>${UiHelpers.escapeHtml(DataModel.fullName(p) || t('person.unnamed'))}</td>
            <td>${UiHelpers.escapeHtml(p.email || '')}</td>
            <td>${UiHelpers.escapeHtml(p.phone || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('[data-sort]').forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        sortAsc = sortKey === key ? !sortAsc : true;
        sortKey = key;
        renderTable(container, people, container.querySelector('#contacts-search')?.value.trim().toLowerCase() || '', t);
      };
    });
    wrap.querySelectorAll('[data-goto]').forEach((tr) => {
      tr.onclick = () => App.setFocusedPerson(tr.dataset.goto);
      tr.style.cursor = 'pointer';
    });
  }

  return { render };
})();

const ViewRelationships = (() => {
  function render(container) {
    const t = App.t;
    const { data, focusedPersonId } = App.getState();
    const people = DataModel.allPeople(data).sort((a, b) => (DataModel.fullName(a) || '').localeCompare(DataModel.fullName(b) || ''));

    container.innerHTML = `
      <div class="view-header">
        <h2>${t('relationships.heading')}</h2>
        ${UiHelpers.printButtonHtml(t)}
      </div>
      <div class="search-bar no-print">
        <select id="rel-person-select">
          <option value="">${t('relationships.selectPerson')}</option>
          ${people.map((p) => `<option value="${p.id}" ${p.id === focusedPersonId ? 'selected' : ''}>${UiHelpers.escapeHtml(DataModel.fullName(p) || t('person.unnamed'))}</option>`).join('')}
        </select>
      </div>
      <div id="rel-body"></div>`;

    UiHelpers.wirePrintButton(container);
    const select = container.querySelector('#rel-person-select');
    select.onchange = () => renderBody(container, select.value, t);
    if (focusedPersonId && DataModel.getPerson(data, focusedPersonId)) renderBody(container, focusedPersonId, t);
    else container.querySelector('#rel-body').innerHTML = `<p class="empty-note">${t('relationships.selectPerson')}</p>`;
  }

  function renderBody(container, personId, t) {
    const body = container.querySelector('#rel-body');
    if (!personId) { body.innerHTML = `<p class="empty-note">${t('relationships.selectPerson')}</p>`; return; }
    const { data } = App.getState();
    const person = DataModel.getPerson(data, personId);
    if (!person) return;
    const buckets = DataModel.getAllRelationships(data, personId, t);

    const bucketDefs = [
      ['partners', 'relationships.partners'],
      ['parents', 'relationships.parents'],
      ['children', 'relationships.children'],
      ['siblings', 'relationships.siblings'],
      ['halfSiblings', 'relationships.halfSiblings'],
      ['grandparents', 'relationships.grandparents'],
      ['grandchildren', 'relationships.grandchildren'],
      ['auntsUncles', 'relationships.auntsUncles'],
      ['niecesNephews', 'relationships.niecesNephews'],
      ['cousins', 'relationships.cousins'],
      ['inLaws', 'relationships.inLaws'],
    ];

    body.innerHTML = `<h3 style="margin-top:0">${UiHelpers.escapeHtml(DataModel.fullName(person) || t('person.unnamed'))}</h3>` +
      bucketDefs.map(([key, labelKey]) => {
        const items = buckets[key] || [];
        return `<div class="relationship-bucket">
          <h3>${t(labelKey)} ${items.length ? `(${items.length})` : ''}</h3>
          ${items.length ? `<ul class="boxed-list">${items.map((item) => `<li data-goto="${item.person.id}">
                <span>${UiHelpers.escapeHtml(DataModel.fullName(item.person) || t('person.unnamed'))}</span>
                <span>${UiHelpers.escapeHtml(item.label)}</span>
              </li>`).join('')}</ul>` : `<p class="empty-note">${t('relationships.none')}</p>`}
        </div>`;
      }).join('');

    body.querySelectorAll('li[data-goto]').forEach((row) => {
      row.onclick = () => App.setFocusedPerson(row.dataset.goto);
      row.style.cursor = 'pointer';
    });
  }

  return { render };
})();

const ViewFocus = (() => {
  let outsideMenuClickHandler = null;

  function render(container) {
    const t = App.t;
    const { data, focusedPersonId } = App.getState();

    container.innerHTML = `
      <div class="view-header">
        <h2>${t('nav.focus')}</h2>
        ${UiHelpers.printButtonHtml(t)}
      </div>
      <div class="focus-search no-print">
        <input type="text" id="focus-search-input" placeholder="${t('focus.search')}" autocomplete="off">
        <button type="button" class="focus-search__add" id="btn-add-person" title="${t('actions.addPerson')}" aria-label="${t('actions.addPerson')}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
        <div class="focus-search__results hidden" id="focus-search-results"></div>
      </div>
      <div id="focus-body"></div>
      <div class="print-only" id="print-view-title" style="display:none">${t('nav.focus')}</div>
    `;

    container.querySelector('#btn-add-person').onclick = () => PersonForm.open(null, (id) => App.setFocusedPerson(id));
    UiHelpers.wirePrintButton(container);

    const searchInput = container.querySelector('#focus-search-input');
    const resultsBox = container.querySelector('#focus-search-results');
    searchInput.oninput = () => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) { resultsBox.classList.add('hidden'); resultsBox.innerHTML = ''; return; }
      const matches = DataModel.allPeople(data).filter((p) => {
        const name = `${p.firstName} ${p.lastName} ${p.maidenName || ''}`.toLowerCase();
        return name.includes(q);
      }).slice(0, 20);
      if (matches.length === 0) {
        resultsBox.innerHTML = `<button disabled>${t('focus.noResults')}</button>`;
      } else {
        resultsBox.innerHTML = matches.map((p) =>
          `<button data-goto="${p.id}">${UiHelpers.escapeHtml(DataModel.fullName(p) || t('person.unnamed'))}</button>`).join('');
      }
      resultsBox.classList.remove('hidden');
      resultsBox.querySelectorAll('[data-goto]').forEach((btn) => {
        btn.onclick = () => {
          searchInput.value = '';
          resultsBox.classList.add('hidden');
          App.setFocusedPerson(btn.dataset.goto);
        };
      });
    };

    const body = container.querySelector('#focus-body');
    if (!focusedPersonId || !DataModel.getPerson(data, focusedPersonId)) {
      body.innerHTML = `<p class="empty-note">${t('focus.selectPerson')}</p>`;
      return;
    }
    renderBody(body, data, focusedPersonId, t);
  }

  function openPhotoLightbox(person, t) {
    App.openModal((box) => {
      box.classList.add('modal-box--photo');
      const name = DataModel.fullName(person) || t('person.unnamed');
      box.innerHTML = `
        <button type="button" class="photo-lightbox-close" id="close-lightbox" aria-label="${t('actions.close')}">&times;</button>
        <img class="photo-lightbox-img" src="${person.photo}" alt="${UiHelpers.escapeHtml(name)}">`;
      box.querySelector('#close-lightbox').onclick = () => App.closeModal();
    });
  }

  function renderBody(body, data, personId, t) {
    const person = DataModel.getPerson(data, personId);
    const parents = DataModel.getParents(data, personId);
    const currentUnions = DataModel.getPartnerUnions(data, personId, 'current');
    const formerUnions = DataModel.getPartnerUnions(data, personId, 'former');
    const children = DataModel.getChildren(data, personId);

    body.innerHTML = `
      <div class="focus-layout">
        <div class="focus-section" id="parents-section">
          <h3>${t('focus.parents')}</h3>
          <div class="person-card-list" id="parents-list"></div>
        </div>
        <div class="focus-row">
          <div class="focus-center" id="center-panel"></div>
          <div class="focus-section" id="current-partners-section">
            <h3>${t('focus.currentPartners')}</h3>
            <div class="person-card-list" id="current-partners-list"></div>
          </div>
        </div>
        <div class="focus-section" id="children-section">
          <h3>${t('focus.children')}</h3>
          <div id="children-list"></div>
        </div>
        <div class="focus-section" id="former-section">
          <h3>${t('focus.formerPartners')}</h3>
          <div id="former-list"></div>
        </div>
      </div>`;

    // Parents
    const parentsList = body.querySelector('#parents-list');
    if (parents.length === 0) {
      parentsList.innerHTML = `<p class="empty-note">${t('focus.noParents')}</p>`;
    } else {
      parents.forEach((p) => parentsList.appendChild(UiHelpers.personCard(p, t, App.setFocusedPerson)));
    }

    // Center panel
    const center = body.querySelector('#center-panel');
    const genderLabel = DataModel.genderDisplayLabel(person.gender, t);
    const photoBlock = person.photo
      ? `<button type="button" class="person-photo person-photo--clickable" id="btn-view-photo">${UiHelpers.photoHtml(person, t)}</button>`
      : `<span class="person-photo">${UiHelpers.photoHtml(person, t)}</span>`;
    center.innerHTML = `
      ${photoBlock}
      <div class="focus-center__info">
        <h2>${UiHelpers.escapeHtml(DataModel.fullName(person) || t('person.unnamed'))}
          ${person.isDeceased ? `<span class="badge badge--deceased">${t('person.isDeceased')}</span>` : ''}
        </h2>
        <p class="focus-center__facts">${UiHelpers.lifespanLabel(person, t)}</p>
        ${genderLabel ? `<p class="focus-center__facts">${t('person.gender')}: ${UiHelpers.escapeHtml(genderLabel)}</p>` : ''}
        ${person.occupation ? `<p class="focus-center__facts">${t('person.occupation')}: ${UiHelpers.escapeHtml(person.occupation)}</p>` : ''}
        ${person.birthPlace ? `<p class="focus-center__facts">${t('person.birthPlace')}: ${UiHelpers.escapeHtml(person.birthPlace)}</p>` : ''}
        ${person.isDeceased && person.deathPlace ? `<p class="focus-center__facts">${t('person.deathPlace')}: ${UiHelpers.escapeHtml(person.deathPlace)}</p>` : ''}
        ${person.notes ? `<p class="focus-center__notes">${UiHelpers.escapeHtml(person.notes)}</p>` : ''}
      </div>
      <button type="button" class="focus-center__menu-btn no-print" id="btn-person-menu"
        aria-haspopup="true" aria-label="${t('focus.personMenu')}" title="${t('focus.personMenu')}">&#8942;</button>
      <div class="focus-center__dropdown hidden no-print" id="person-menu-dropdown">
        <button type="button" id="btn-edit-person">${t('focus.editThisPerson')}</button>
        <button type="button" id="btn-manage-rel">${t('focus.manageRelationships')}</button>
        <button type="button" class="focus-center__dropdown-danger" id="btn-delete-person">${t('focus.deleteThisPerson')}</button>
      </div>`;

    const menuBtn = center.querySelector('#btn-person-menu');
    const dropdown = center.querySelector('#person-menu-dropdown');
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    };
    center.querySelector('#btn-edit-person').onclick = () => {
      dropdown.classList.add('hidden');
      PersonForm.open(personId, () => App.rerender());
    };
    center.querySelector('#btn-manage-rel').onclick = () => {
      dropdown.classList.add('hidden');
      RelationshipEditor.open(personId);
    };
    center.querySelector('#btn-delete-person').onclick = () => {
      dropdown.classList.add('hidden');
      RelationshipEditor.confirmDelete(personId);
    };
    if (person.photo) {
      center.querySelector('#btn-view-photo').onclick = () => openPhotoLightbox(person, t);
    }

    // Re-rendered every focus switch, so the previous listener must be torn
    // down first — otherwise each render stacks another document-level
    // click listener that never gets cleaned up.
    if (outsideMenuClickHandler) document.removeEventListener('click', outsideMenuClickHandler);
    outsideMenuClickHandler = (e) => {
      if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && e.target !== menuBtn) {
        dropdown.classList.add('hidden');
      }
    };
    document.addEventListener('click', outsideMenuClickHandler);

    // Current partners
    const curList = body.querySelector('#current-partners-list');
    if (currentUnions.length === 0) {
      curList.innerHTML = `<p class="empty-note">${t('focus.noCurrentPartner')}</p>`;
    } else {
      currentUnions.forEach((u) => {
        const otherId = DataModel.otherPartner(u, personId);
        const other = otherId ? DataModel.getPerson(data, otherId) : null;
        if (other) curList.appendChild(UiHelpers.personCard(other, t, App.setFocusedPerson));
      });
    }

    // Former unions
    const formerList = body.querySelector('#former-list');
    if (formerUnions.length === 0) {
      formerList.innerHTML = `<p class="empty-note">${t('focus.formerPartners')}: ${t('relationships.none')}</p>`;
    } else {
      formerList.innerHTML = formerUnions.map((u) => {
        const otherId = DataModel.otherPartner(u, personId);
        const other = otherId ? DataModel.getPerson(data, otherId) : null;
        const range = `${DataModel.formatDate(u.startDate, t)} – ${DataModel.hasDate(u.endDate) ? DataModel.formatDate(u.endDate, t) : t('person.unknown')}`;
        return `<div class="union-block">
          <div class="union-block__label">${t(`union.${u.status}`)} ${t(`union.${u.type}`)} · ${range}</div>
          <div class="person-card-list" data-union="${u.id}"></div>
        </div>`;
      }).join('');
      formerUnions.forEach((u) => {
        const otherId = DataModel.otherPartner(u, personId);
        const other = otherId ? DataModel.getPerson(data, otherId) : null;
        const slot = formerList.querySelector(`[data-union="${u.id}"]`);
        if (other && slot) slot.appendChild(UiHelpers.personCard(other, t, App.setFocusedPerson));
      });
    }

    // Children
    const childrenList = body.querySelector('#children-list');
    if (children.length === 0) {
      childrenList.innerHTML = `<p class="empty-note">${t('focus.noChildren')}</p>`;
    } else if (children.length <= 6) {
      const wrap = document.createElement('div');
      wrap.className = 'person-card-list';
      children.forEach((c) => wrap.appendChild(UiHelpers.personCard(c, t, App.setFocusedPerson)));
      childrenList.appendChild(wrap);
    } else {
      childrenList.innerHTML = `<ul class="compact-list">${children.map((c) =>
        `<li><button class="btn--link" data-goto="${c.id}">${UiHelpers.escapeHtml(DataModel.fullName(c) || t('person.unnamed'))}</button>
          <span class="person-card__meta">${UiHelpers.lifespanLabel(c, t)}</span></li>`).join('')}</ul>`;
      childrenList.querySelectorAll('[data-goto]').forEach((btn) => {
        btn.onclick = () => App.setFocusedPerson(btn.dataset.goto);
      });
    }
  }

  return { render };
})();

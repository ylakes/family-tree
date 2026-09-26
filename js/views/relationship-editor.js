// Relationship editor: add/remove parents, children, partners for a person;
// edit a union's type/status/start-date/end-date (marriage and divorce
// dates included); delete a person with a cascade-impact warning.
const RelationshipEditor = (() => {
  const NEW_PERSON = '__new__';

  function personOptions(data, excludeIds, t) {
    const excluded = new Set(excludeIds);
    const opts = DataModel.allPeople(data)
      .filter((p) => !excluded.has(p.id))
      .sort((a, b) => DataModel.fullName(a).localeCompare(DataModel.fullName(b)))
      .map((p) => `<option value="${p.id}">${escapeHtml(DataModel.fullName(p) || t('person.unnamed'))}</option>`)
      .join('');
    return `<option value="${NEW_PERSON}">${t('relationForm.createNewPerson')}</option>${opts}`;
  }

  function descendantIds(data, personId) {
    const out = new Set();
    let frontier = [personId];
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        for (const child of DataModel.getChildren(data, id)) {
          if (!out.has(child.id)) { out.add(child.id); next.push(child.id); }
        }
      }
      frontier = next;
    }
    return out;
  }

  function resolvePersonChoice(box, selectEl, onGotId) {
    const val = selectEl.value;
    if (val === NEW_PERSON) {
      PersonForm.open(null, (newId) => onGotId(newId));
    } else {
      onGotId(val);
    }
  }

  function open(personId) {
    const t = App.t;
    const { data } = App.getState();
    const person = DataModel.getPerson(data, personId);
    if (!person) return;

    App.openModal((box) => {
      box.innerHTML = `
        <h3>${t('relationForm.title')} — ${escapeHtml(DataModel.fullName(person) || t('person.unnamed'))}</h3>
        <fieldset>
          <legend>${t('focus.parents')}</legend>
          <ul class="rel-existing-list" id="parents-list"></ul>
          <div class="rel-add-row">
            <select id="new-parent-select"></select>
            <button class="btn btn--edit" id="add-parent-btn">${t('actions.addParent')}</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>${t('union.partners')}</legend>
          <ul class="rel-existing-list" id="partners-list"></ul>
          <div class="rel-add-row">
            <select id="new-partner-select"></select>
            <select id="new-partner-type">
              <option value="marriage">${t('union.marriage')}</option>
              <option value="partnership">${t('union.partnership')}</option>
            </select>
            <label class="rel-inline-label">${t('union.startDate')} ${DateFieldsUI.html('new-partner-start', DataModel.createEmptyDate(), t)}</label>
            <button class="btn btn--edit" id="add-partner-btn">${t('actions.addPartner')}</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>${t('focus.children')}</legend>
          <ul class="rel-existing-list" id="children-list"></ul>
          <div class="rel-add-row">
            <select id="new-child-union"></select>
            <select id="new-child-select"></select>
            <select id="new-child-relation">
              <option value="biological">${t('relationType.biological')}</option>
              <option value="adopted">${t('relationType.adopted')}</option>
              <option value="step">${t('relationType.step')}</option>
            </select>
            <button class="btn btn--edit" id="add-child-btn">${t('actions.addChild')}</button>
          </div>
        </fieldset>
        <div class="modal-actions">
          <button type="button" class="btn" id="close-btn">${t('actions.close')}</button>
        </div>`;

      renderParents(box, data, personId, t);
      renderPartners(box, data, personId, t);
      renderChildren(box, data, personId, t);

      box.querySelector('#new-parent-select').innerHTML = personOptions(
        data, [personId, ...descendantIds(data, personId)], t,
      );
      box.querySelector('#new-partner-select').innerHTML = personOptions(data, [personId], t);
      refreshChildUnionSelect(box, data, personId, t);
      box.querySelector('#new-child-select').innerHTML = personOptions(
        data, [personId, ...ancestorIds(data, personId)], t,
      );

      box.querySelector('#add-parent-btn').onclick = () => {
        const sel = box.querySelector('#new-parent-select');
        resolvePersonChoice(box, sel, (newParentId) => addParent(personId, newParentId));
      };
      box.querySelector('#add-partner-btn').onclick = () => {
        const sel = box.querySelector('#new-partner-select');
        const type = box.querySelector('#new-partner-type').value;
        const startDate = DateFieldsUI.read(box, 'new-partner-start');
        resolvePersonChoice(box, sel, (newPartnerId) => addPartner(personId, newPartnerId, type, startDate));
      };
      box.querySelector('#add-child-btn').onclick = () => {
        const sel = box.querySelector('#new-child-select');
        const unionChoice = box.querySelector('#new-child-union').value;
        const relType = box.querySelector('#new-child-relation').value;
        resolvePersonChoice(box, sel, (childId) => addChild(personId, unionChoice, childId, relType));
      };
      box.querySelector('#close-btn').onclick = () => { App.closeModal(); App.rerender(); };
    });
  }

  function ancestorIds(data, personId) {
    return new Set(DataModel.ancestorDepths(data, personId).keys());
  }

  function refreshChildUnionSelect(box, data, personId, t) {
    const unions = DataModel.unionsAsPartner(data, personId);
    const sel = box.querySelector('#new-child-union');
    if (unions.length === 0) {
      sel.innerHTML = `<option value="__new_union__">${t('relationForm.newUnionWithSelf')}</option>`;
      return;
    }
    sel.innerHTML = unions.map((u) => {
      const otherId = DataModel.otherPartner(u, personId);
      const other = otherId ? DataModel.getPerson(data, otherId) : null;
      const label = other ? `${t('union.with')} ${DataModel.fullName(other)}` : t('relationForm.newUnionWithSelf');
      return `<option value="${u.id}">${escapeHtml(label)} (${t(`union.${u.status}`)})</option>`;
    }).join('') + `<option value="__new_union__">${t('relationForm.newUnionWithSelf')}</option>`;
  }

  function renderParents(box, data, personId, t) {
    const unions = DataModel.unionsAsChild(data, personId);
    const list = box.querySelector('#parents-list');
    const rows = [];
    unions.forEach((u) => {
      u.partners.forEach((pid) => {
        const p = DataModel.getPerson(data, pid);
        if (!p) return;
        rows.push(`<li><span>${escapeHtml(DataModel.fullName(p) || t('person.unnamed'))}</span>
          <button class="btn btn--edit" data-remove-parent="${u.id}:${pid}">${t('actions.remove')}</button></li>`);
      });
    });
    list.innerHTML = rows.join('') || `<li class="empty-note">${t('focus.noParents')}</li>`;
    list.querySelectorAll('[data-remove-parent]').forEach((btn) => {
      btn.onclick = () => {
        const [unionId, pid] = btn.dataset.removeParent.split(':');
        removeParent(personId, unionId, pid);
      };
    });
  }

  function renderPartners(box, data, personId, t) {
    // A union with only one recorded partner exists purely to link a
    // child to that lone parent (see addParent below) — it isn't a
    // partner relationship at all, so it must not be listed as one here
    // (it would otherwise render as a bogus "Unnamed" partner entry).
    const unions = DataModel.unionsAsPartner(data, personId).filter((u) => DataModel.otherPartner(u, personId));
    const list = box.querySelector('#partners-list');
    const rows = unions.map((u) => {
      const otherId = DataModel.otherPartner(u, personId);
      const other = otherId ? DataModel.getPerson(data, otherId) : null;
      const name = other ? DataModel.fullName(other) : t('person.unnamed');
      const range = DataModel.hasDate(u.startDate) || DataModel.hasDate(u.endDate)
        ? ` · ${DataModel.formatDate(u.startDate, t)}${DataModel.hasDate(u.endDate) ? ` – ${DataModel.formatDate(u.endDate, t)}` : ''}`
        : '';
      return `<li><span>${escapeHtml(name)} — ${t(`union.${u.type}`)}, ${t(`union.${u.status}`)}${range}</span>
        <span>
          <button class="btn btn--edit" data-edit-union="${u.id}">${t('actions.edit')}</button>
          <button class="btn btn--edit" data-remove-union="${u.id}">${t('actions.remove')}</button>
        </span></li>`;
    });
    list.innerHTML = rows.join('') || `<li class="empty-note">${t('focus.noCurrentPartner')}</li>`;
    list.querySelectorAll('[data-remove-union]').forEach((btn) => {
      btn.onclick = () => removeUnion(personId, btn.dataset.removeUnion);
    });
    list.querySelectorAll('[data-edit-union]').forEach((btn) => {
      btn.onclick = () => openUnionEditor(personId, btn.dataset.editUnion);
    });
  }

  function renderChildren(box, data, personId, t) {
    const unions = DataModel.unionsAsPartner(data, personId);
    const list = box.querySelector('#children-list');
    const rows = [];
    unions.forEach((u) => {
      u.children.forEach((cid) => {
        const c = DataModel.getPerson(data, cid);
        if (!c) return;
        const relType = (u.childRelationType && u.childRelationType[cid]) || 'biological';
        rows.push(`<li><span>${escapeHtml(DataModel.fullName(c) || t('person.unnamed'))} (${t(`relationType.${relType}`)})</span>
          <button class="btn btn--edit" data-remove-child="${u.id}:${cid}">${t('actions.remove')}</button></li>`);
      });
    });
    list.innerHTML = rows.join('') || `<li class="empty-note">${t('focus.noChildren')}</li>`;
    list.querySelectorAll('[data-remove-child]').forEach((btn) => {
      btn.onclick = () => {
        const [unionId, cid] = btn.dataset.removeChild.split(':');
        removeChild(personId, unionId, cid);
      };
    });
  }

  // Type, status, and both dates together — this is the only place marriage
  // and divorce/end dates get entered for an existing union (new unions can
  // also get a start date up front via the "Add Partner" row).
  function openUnionEditor(personId, unionId) {
    const t = App.t;
    const { data } = App.getState();
    const union = DataModel.getUnion(data, unionId);
    if (!union) return;

    App.openModal((box) => {
      box.innerHTML = `
        <h3>${t('relationForm.editUnionTitle')}</h3>
        <div class="form-grid">
          <div class="form-field"><label>${t('union.type')}</label>
            <select id="edit-union-type">
              <option value="marriage" ${union.type === 'marriage' ? 'selected' : ''}>${t('union.marriage')}</option>
              <option value="partnership" ${union.type === 'partnership' ? 'selected' : ''}>${t('union.partnership')}</option>
            </select>
          </div>
          <div class="form-field"><label>${t('union.status')}</label>
            <select id="edit-union-status">
              <option value="current" ${union.status === 'current' ? 'selected' : ''}>${t('union.current')}</option>
              <option value="divorced" ${union.status === 'divorced' ? 'selected' : ''}>${t('union.divorced')}</option>
              <option value="separated" ${union.status === 'separated' ? 'selected' : ''}>${t('union.separated')}</option>
              <option value="widowed" ${union.status === 'widowed' ? 'selected' : ''}>${t('union.widowed')}</option>
              <option value="ended" ${union.status === 'ended' ? 'selected' : ''}>${t('union.ended')}</option>
            </select>
          </div>
          <div class="form-field full-width"><label>${t('union.startDate')}</label>
            ${DateFieldsUI.html('edit-union-start', union.startDate, t)}
          </div>
          <div class="form-field full-width"><label>${t('union.endDate')}</label>
            ${DateFieldsUI.html('edit-union-end', union.endDate, t)}
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" id="cancel-union-edit">${t('actions.cancel')}</button>
          <button type="button" class="btn btn--primary" id="save-union-edit">${t('actions.confirm')}</button>
        </div>`;

      box.querySelector('#cancel-union-edit').onclick = () => open(personId);
      box.querySelector('#save-union-edit').onclick = () => {
        union.type = box.querySelector('#edit-union-type').value;
        union.status = box.querySelector('#edit-union-status').value;
        union.startDate = DateFieldsUI.read(box, 'edit-union-start');
        union.endDate = DateFieldsUI.read(box, 'edit-union-end');
        App.markDirty(true);
        App.rerender();
        open(personId);
      };
    });
  }

  // ---- Mutations ----

  function addParent(personId, newParentId) {
    const { data } = App.getState();
    if (DataModel.wouldCreateCycle(data, personId, newParentId)) {
      alert(App.t('validation.cycleDetected'));
      return;
    }
    const childUnions = DataModel.unionsAsChild(data, personId).filter((u) => u.partners.length < 2 && !u.partners.includes(newParentId));

    // If personId already has one recorded parent who's ALREADY partnered
    // with newParentId via some other (real) union, move personId into
    // that union instead of adding newParentId to this placeholder one —
    // otherwise the couple ends up linked by two separate unions, each
    // listing the other as a partner twice.
    const mergeTarget = childUnions
      .map((u) => ({ u, real: u.partners[0] ? DataModel.findUnionBetween(data, u.partners[0], newParentId) : null }))
      .find((x) => x.real && x.real.id !== x.u.id);

    if (mergeTarget) {
      const { u: openUnion, real: realCoupleUnion } = mergeTarget;
      openUnion.children = openUnion.children.filter((c) => c !== personId);
      if (!realCoupleUnion.children.includes(personId)) realCoupleUnion.children.push(personId);
      // openUnion had fewer than 2 partners by construction (that's how it
      // qualified as a merge candidate above) — with personId now its only
      // possible child gone too, it represents nothing on its own and
      // would otherwise show up as a ghost "Unnamed" partner entry for
      // whichever single parent it still lists.
      if (openUnion.children.length === 0) delete data.unions[openUnion.id];
    } else {
      let union = childUnions[0];
      if (!union) {
        union = DataModel.createUnion({ status: 'current', partners: [] });
        data.unions[union.id] = union;
        union.children.push(personId);
      }
      union.partners.push(newParentId);
    }
    App.markDirty(true);
    App.rerender();
    open(personId);
  }

  // Finds an existing union with EXACTLY this partner set — reusing one
  // already recorded for any of these partners (e.g. from a sibling) —
  // creating a new one only if none exists. Same de-duplication addParent
  // relies on, reused here to re-home a child under whichever parent(s)
  // remain after removeParent.
  function findOrCreateUnionWithPartners(data, partnerIds) {
    for (const pid of partnerIds) {
      const match = DataModel.unionsAsPartner(data, pid).find((u) =>
        u.partners.length === partnerIds.length && partnerIds.every((p) => u.partners.includes(p)));
      if (match) return match;
    }
    const created = DataModel.createUnion({ status: 'current', partners: [...partnerIds] });
    data.unions[created.id] = created;
    return created;
  }

  function removeParent(personId, unionId, parentId) {
    const { data } = App.getState();
    const union = DataModel.getUnion(data, unionId);
    if (!union) return;
    const remainingParents = union.partners.filter((p) => p !== parentId);

    // Detach personId from this union's CHILDREN only — the union's own
    // partner list is left untouched, since it may represent a real
    // couple relationship (or other children) independent of this one
    // parent-child link. Removing "parent A" from X must never also
    // un-partner A and B from each other.
    union.children = union.children.filter((c) => c !== personId);
    if (union.childRelationType) delete union.childRelationType[personId];

    // personId keeps whichever parent(s) besides the removed one — move
    // them to a union for just those remaining parent(s), so removing
    // one parent doesn't leave personId with none recorded at all.
    if (remainingParents.length > 0) {
      const target = findOrCreateUnionWithPartners(data, remainingParents);
      if (!target.children.includes(personId)) target.children.push(personId);
    }

    if (union.partners.length === 0 && union.children.length === 0) delete data.unions[unionId];
    App.markDirty(true);
    App.rerender();
    open(personId);
  }

  function addPartner(personId, newPartnerId, type, startDate) {
    const { data } = App.getState();
    if (DataModel.findUnionBetween(data, personId, newPartnerId)) {
      alert(App.t('validation.alreadyPartnered'));
      return;
    }
    const union = DataModel.createUnion({
      partners: [personId, newPartnerId], type, status: 'current',
      startDate: startDate || DataModel.createEmptyDate(),
    });
    data.unions[union.id] = union;
    App.markDirty(true);
    App.rerender();
    open(personId);
  }

  function removeUnion(personId, unionId) {
    const { data } = App.getState();
    const union = DataModel.getUnion(data, unionId);
    if (!union) return;
    const childCount = union.children.length;
    const msg = childCount > 0
      ? `${App.t('actions.remove')} ${App.t('union.partners')}? (${childCount} ${App.t('union.children').toLowerCase()})`
      : `${App.t('actions.remove')} ${App.t('union.partners')}?`;
    if (!confirm(msg)) return;
    delete data.unions[unionId];
    App.markDirty(true);
    App.rerender();
    open(personId);
  }

  function addChild(personId, unionChoice, childId, relType) {
    const { data } = App.getState();
    if (DataModel.wouldCreateCycle(data, childId, personId)) {
      alert(App.t('validation.cycleDetected'));
      return;
    }
    let union;
    if (unionChoice === '__new_union__') {
      union = DataModel.createUnion({ partners: [personId], status: 'current' });
      data.unions[union.id] = union;
    } else {
      union = DataModel.getUnion(data, unionChoice);
    }
    if (!union) return;
    if (!union.children.includes(childId)) union.children.push(childId);
    union.childRelationType = union.childRelationType || {};
    union.childRelationType[childId] = relType;
    App.markDirty(true);
    App.rerender();
    open(personId);
  }

  function removeChild(personId, unionId, childId) {
    const { data } = App.getState();
    const union = DataModel.getUnion(data, unionId);
    if (!union) return;
    union.children = union.children.filter((c) => c !== childId);
    if (union.childRelationType) delete union.childRelationType[childId];
    App.markDirty(true);
    App.rerender();
    open(personId);
  }

  // ---- Deletion ----

  function confirmDelete(personId, onDeleted) {
    const t = App.t;
    const { data } = App.getState();
    const person = DataModel.getPerson(data, personId);
    if (!person) return;
    const impact = DataModel.describeDeletionImpact(data, personId);
    App.openModal((box) => {
      const items = [];
      if (impact.asPartner.length) {
        items.push(`<li>${t('confirm.deletePersonAsParent', { name: DataModel.fullName(person), count: impact.asPartner.length })}</li>`);
      }
      if (impact.asChild.length) {
        items.push(`<li>${t('confirm.deletePersonAsChild', { name: DataModel.fullName(person), count: impact.asChild.length })}</li>`);
      }
      box.innerHTML = `
        <h3>${t('confirm.deletePersonTitle')}</h3>
        <p>${t('confirm.deletePersonBody', { name: escapeHtml(DataModel.fullName(person) || t('person.unnamed')) })}</p>
        <ul class="impact-list">${items.join('') || `<li>${t('relationships.none')}</li>`}</ul>
        <div class="modal-actions">
          <button type="button" class="btn" id="cancel-delete">${t('actions.cancel')}</button>
          <button type="button" class="btn btn--danger" id="confirm-delete">${t('actions.delete')}</button>
        </div>`;
      box.querySelector('#cancel-delete').onclick = () => App.closeModal();
      box.querySelector('#confirm-delete').onclick = () => {
        DataModel.cascadeDeletePerson(data, personId);
        App.markDirty(true);
        App.closeModal();
        if (onDeleted) onDeleted();
        else App.rerender();
      };
    });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  return { open, confirmDelete };
})();

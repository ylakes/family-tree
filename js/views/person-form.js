// Add/Edit person modal. Covers every field in the schema.
const PersonForm = (() => {
  const dateFieldsHtml = DateFieldsUI.html;
  const readDateFields = DateFieldsUI.read;

  function open(personId, onSaved) {
    const t = App.t;
    const { data } = App.getState();
    const isEdit = !!personId;
    const person = isEdit ? DataModel.getPerson(data, personId) : DataModel.createPerson();

    App.openModal((box) => {
      box.innerHTML = `
        <h3>${isEdit ? t('actions.edit') : t('actions.addPerson')}</h3>
        <form id="person-form">
          <div class="form-grid">
            <div class="form-field"><label>${t('person.firstName')}</label>
              <input required data-field="firstName" value="${escapeAttr(person.firstName)}"></div>
            <div class="form-field"><label>${t('person.lastName')}</label>
              <input data-field="lastName" value="${escapeAttr(person.lastName)}"></div>
            <div class="form-field"><label>${t('person.maidenName')}</label>
              <input data-field="maidenName" value="${escapeAttr(person.maidenName || '')}"></div>
            <div class="form-field"><label>${t('person.gender')}</label>
              <input data-field="gender" list="gender-suggestions" value="${escapeAttr(person.gender || '')}">
              <datalist id="gender-suggestions">
                <option value="${t('gender.male')}"></option>
                <option value="${t('gender.female')}"></option>
                <option value="${t('gender.other')}"></option>
                <option value="${t('gender.unknown')}"></option>
              </datalist>
            </div>
            <div class="form-field full-width"><label>${t('person.birthDate')}</label>
              ${dateFieldsHtml('birth', person.birthDate, t)}</div>
            <div class="form-field"><label>${t('person.birthPlace')}</label>
              <input data-field="birthPlace" value="${escapeAttr(person.birthPlace || '')}"></div>
            <div class="form-field"><label>${t('person.occupation')}</label>
              <input data-field="occupation" value="${escapeAttr(person.occupation || '')}"></div>
            <div class="form-field checkbox-field full-width">
              <input type="checkbox" id="is-deceased" ${person.isDeceased ? 'checked' : ''}>
              <label for="is-deceased" style="margin:0">${t('person.isDeceased')}</label>
            </div>
            <div class="form-field full-width" id="death-fields-wrap" style="${person.isDeceased ? '' : 'display:none'}">
              <label>${t('person.deathDate')}</label>
              ${dateFieldsHtml('death', person.deathDate || DataModel.createEmptyDate(), t)}
            </div>
            <div class="form-field" id="death-place-wrap" style="${person.isDeceased ? '' : 'display:none'}">
              <label>${t('person.deathPlace')}</label>
              <input data-field="deathPlace" value="${escapeAttr(person.deathPlace || '')}">
            </div>
            <div class="form-field"><label>${t('person.email')}</label>
              <input type="email" data-field="email" value="${escapeAttr(person.email || '')}"></div>
            <div class="form-field"><label>${t('person.phone')}</label>
              <input data-field="phone" value="${escapeAttr(person.phone || '')}"></div>
            <div class="form-field full-width"><label>${t('person.notes')}</label>
              <textarea data-field="notes" rows="3">${escapeHtml(person.notes || '')}</textarea></div>
            <div class="form-field full-width"><label>${t('person.photo')}</label>
              <div class="photo-upload">
                <div class="person-photo" id="photo-preview">${person.photo ? `<img src="${person.photo}">` : t('person.noPhoto')}</div>
                <input type="file" accept="image/*" id="photo-input">
                <button type="button" class="btn btn--edit" id="remove-photo" ${person.photo ? '' : 'style=display:none'}>${t('person.removePhoto')}</button>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" id="cancel-btn">${t('actions.cancel')}</button>
            <button type="submit" class="btn btn--primary">${t('actions.confirm')}</button>
          </div>
        </form>`;

      let photoData = person.photo || '';
      const deceasedCheckbox = box.querySelector('#is-deceased');
      deceasedCheckbox.onchange = () => {
        box.querySelector('#death-fields-wrap').style.display = deceasedCheckbox.checked ? '' : 'none';
        box.querySelector('#death-place-wrap').style.display = deceasedCheckbox.checked ? '' : 'none';
      };
      box.querySelector('#cancel-btn').onclick = () => App.closeModal();
      box.querySelector('#photo-input').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        photoData = await ImageUtils.resizeAndCompress(file);
        box.querySelector('#photo-preview').innerHTML = `<img src="${photoData}">`;
        box.querySelector('#remove-photo').style.display = '';
      };
      box.querySelector('#remove-photo').onclick = () => {
        photoData = '';
        box.querySelector('#photo-preview').innerHTML = t('person.noPhoto');
        box.querySelector('#remove-photo').style.display = 'none';
      };

      box.querySelector('#person-form').onsubmit = (e) => {
        e.preventDefault();
        const firstName = box.querySelector('[data-field="firstName"]').value.trim();
        if (!firstName) { alert(t('validation.required')); return; }
        const isDeceased = deceasedCheckbox.checked;
        const updated = {
          ...person,
          firstName,
          lastName: box.querySelector('[data-field="lastName"]').value.trim(),
          maidenName: box.querySelector('[data-field="maidenName"]').value.trim(),
          gender: box.querySelector('[data-field="gender"]').value.trim(),
          birthDate: readDateFields(box, 'birth'),
          birthPlace: box.querySelector('[data-field="birthPlace"]').value.trim(),
          occupation: box.querySelector('[data-field="occupation"]').value.trim(),
          isDeceased,
          deathDate: isDeceased ? readDateFields(box, 'death') : { year: null, month: null, day: null },
          deathPlace: isDeceased ? box.querySelector('[data-field="deathPlace"]').value.trim() : '',
          email: box.querySelector('[data-field="email"]').value.trim(),
          phone: box.querySelector('[data-field="phone"]').value.trim(),
          notes: box.querySelector('[data-field="notes"]').value.trim(),
          photo: photoData,
        };
        data.people[updated.id] = updated;
        App.markDirty(true);
        App.closeModal();
        if (onSaved) onSaved(updated.id);
      };
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  return { open };
})();

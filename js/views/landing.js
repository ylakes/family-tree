const ViewLanding = (() => {
  let errorEl = null;

  function render(container, opts) {
    const t = I18n.t;
    if (opts.unsupported) {
      container.innerHTML = `
        <div class="landing-card">
          <h1>${t('landing.heading')}</h1>
          <p class="landing-error">${t('landing.unsupportedBrowser')}</p>
        </div>`;
      return;
    }
    container.innerHTML = `
      <div class="landing-card">
        <h1>${t('landing.heading')}</h1>
        <p class="subhead">${t('landing.subheading')}</p>
        <div class="landing-options">
          <button class="landing-option" id="btn-create-new">
            <strong>${t('landing.createNew')}</strong>
            <span>${t('landing.createNewHint')}</span>
          </button>
          <button class="landing-option" id="btn-import-existing">
            <strong>${t('landing.importExisting')}</strong>
            <span>${t('landing.importExistingHint')}</span>
          </button>
        </div>
        <p class="landing-note">${t('landing.folderNote')}</p>
        <div id="landing-error" class="landing-error"></div>
      </div>`;
    errorEl = container.querySelector('#landing-error');
    if (opts.error) errorEl.textContent = opts.error;
    container.querySelector('#btn-create-new').onclick = opts.onCreate;
    container.querySelector('#btn-import-existing').onclick = opts.onImport;
  }

  // A previously-used folder was found but needs one click to reconfirm
  // access — browsers require a fresh user gesture each session before a
  // page can regain filesystem access; this is the smallest possible ask.
  function renderReconnect(container, opts) {
    const t = I18n.t;
    // cachedTitle is null only if nothing was ever cached (e.g. site data
    // cleared) — then fall back to the generic name. An empty string means
    // the family tree's title really is blank, so show it blank, not the
    // generic name.
    const heading = opts.cachedTitle != null ? opts.cachedTitle : t('landing.heading');
    container.innerHTML = `
      <div class="landing-card">
        <h1>${UiHelpers.escapeHtml(heading)}</h1>
        <p class="subhead">${t('landing.reconnectBody')}</p>
        <div class="landing-options">
          <button class="landing-option" id="btn-reconnect">
            <strong>${t('landing.reconnectButton')}</strong>
          </button>
        </div>
        <br><br>
        <button class="btn--link" id="btn-start-over">${t('landing.useDifferentFolder')}</button>
        <div id="landing-error" class="landing-error"></div>
      </div>`;
    errorEl = container.querySelector('#landing-error');
    container.querySelector('#btn-reconnect').onclick = opts.onReconnect;
    container.querySelector('#btn-start-over').onclick = opts.onStartOver;
  }

  function showError(msg) {
    if (errorEl) errorEl.textContent = msg;
  }

  return { render, renderReconnect, showError };
})();

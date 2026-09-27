// Main application controller: state, routing, file actions, modal helper.
// Views are plain globals (ViewFocus, ViewTree, ...) each exposing render(container).
const App = (() => {
  const state = {
    data: null,
    currentView: 'focus',
    focusedPersonId: null,
    dirty: false,
  };

  // Writes are chained through this promise so autosave calls triggered in
  // quick succession (e.g. several relationship edits) hit disk in the
  // order they happened, never overlapping.
  let saveChain = Promise.resolve();
  let statusHideTimer = null;

  const VIEWS = [
    { key: 'focus', mod: () => ViewFocus },
    { key: 'tree', mod: () => ViewTree },
    { key: 'eventsCalendar', mod: () => ViewEventsCalendar },
    { key: 'contacts', mod: () => ViewContacts },
    { key: 'calendar', mod: () => ViewCalendar },
    { key: 'anniversaries', mod: () => ViewAnniversaries },
    { key: 'relationships', mod: () => ViewRelationships },
    { key: 'stats', mod: () => ViewStats },
  ];

  function t(key, vars) {
    return I18n.t(key, vars);
  }

  function getState() {
    return state;
  }

  // Every mutation in the app calls markDirty(true) right after changing
  // state.data (see relationship-editor.js and person-form.js) — that's
  // already the discrete "a complete edit just happened" signal, so it
  // doubles as the autosave trigger. Nothing keystroke-level calls this.
  function markDirty(isDirty = true) {
    state.dirty = isDirty;
    if (isDirty) {
      showStatus(t('app.saving'));
      queueSave();
    }
  }

  function showStatus(text, autoHideMs) {
    const el = document.getElementById('dirty-indicator');
    if (statusHideTimer) { clearTimeout(statusHideTimer); statusHideTimer = null; }
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.remove('hidden');
    if (autoHideMs) statusHideTimer = setTimeout(() => el.classList.add('hidden'), autoHideMs);
  }

  function queueSave() {
    saveChain = saveChain.then(performSave, performSave);
    return saveChain;
  }

  async function performSave() {
    if (!state.data) return;
    try {
      await Storage.writeDataFile(state.data);
      state.dirty = false;
      showStatus(t('app.saved'), 1500);
      cacheTitle(state.data.title);
    } catch (err) {
      showStatus(null);
      if (err.name !== 'AbortError') alert(err.message);
    }
  }

  const LANG_STORAGE_KEY = 'familyTreeLang';
  // Mirrors data.title outside the data file itself so the reconnect landing
  // screen (shown before the file can be read again — see init()) can still
  // show last-known title instead of the generic app name. Distinguishing
  // "never cached" (null, e.g. cleared site data) from "cached as empty" is
  // exactly what localStorage.getItem already gives us for free.
  const TITLE_STORAGE_KEY = 'familyTreeLastTitle';

  function cacheTitle(title) {
    try { localStorage.setItem(TITLE_STORAGE_KEY, title || ''); } catch { /* ignore */ }
  }

  async function init() {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    const available = I18n.availableLanguages().map((l) => l.code);
    // Falls back to whichever language actually loaded first (script-tag
    // order in index.html), not a hardcoded 'en' — so removing English
    // entirely (see README "Making German the only option") still boots
    // instead of crashing on I18n.load('en') for a file that no longer exists.
    const defaultLang = available[0] || 'en';
    await I18n.load(available.includes(stored) ? stored : defaultLang);
    wireGlobalHandlers();
    if (!Storage.isSupported()) {
      ViewLanding.render(document.getElementById('landing-screen'), { unsupported: true });
      return;
    }
    const reconnect = await Storage.tryReconnect();
    if (reconnect.status === 'granted') {
      try {
        const data = await Storage.readDataFile();
        if (data) { onDataReady(data, false); return; }
      } catch (err) {
        showLanding({ error: err.message });
        return;
      }
      // Folder is known and already granted, but has no data file yet —
      // fall straight to create/import, reusing that same folder.
      showLanding();
      return;
    }
    if (reconnect.status === 'prompt' || reconnect.status === 'denied') {
      ViewLanding.renderReconnect(document.getElementById('landing-screen'), {
        onReconnect: handleReconnect,
        onStartOver: handleStartOver,
        cachedTitle: localStorage.getItem(TITLE_STORAGE_KEY),
      });
      return;
    }
    showLanding();
  }

  function wireGlobalHandlers() {
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (state.data) save();
      }
    });
  }

  function showLanding(opts = {}) {
    ViewLanding.render(document.getElementById('landing-screen'), {
      onCreate: handleCreateNew,
      onImport: handleImportExisting,
      onBack: opts.onBack,
      error: opts.error,
    });
  }

  async function handleReconnect() {
    try {
      await Storage.reconnect();
      const data = await Storage.readDataFile();
      if (!data) { showLanding(); return; }
      onDataReady(data, false);
    } catch (err) {
      ViewLanding.showError(err.message);
    }
  }

  async function handleStartOver() {
    await Storage.forgetFolder();
    showLanding();
  }

  async function handleCreateNew() {
    try {
      if (!Storage.hasFolder()) await Storage.pickAppFolder();
      const backup = await Storage.backupDataFile();
      await Storage.writeDataFile(DataModel.createEmptyData());
      const data = await Storage.readDataFile();
      onDataReady(data, false);
      announceBackup(backup);
    } catch (err) {
      if (err.name !== 'AbortError') ViewLanding.showError(err.message);
    }
  }

  async function handleImportExisting() {
    try {
      const imported = await Storage.pickExternalFileToImport();
      if (!Storage.hasFolder()) await Storage.pickAppFolder();
      const backup = await Storage.backupDataFile();
      await Storage.writeDataFile(imported);
      onDataReady(imported, false);
      announceBackup(backup);
    } catch (err) {
      if (err.name !== 'AbortError') ViewLanding.showError(err.message);
    }
  }

  function onDataReady(data, isNew) {
    state.data = data;
    cacheTitle(data.title);
    state.focusedPersonId = Object.keys(data.people)[0] || null;
    document.getElementById('landing-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('app-title').textContent = appTitle();
    labelIconButtons();
    document.getElementById('btn-save').onclick = save;
    wireHeaderMenu();
    buildNav();
    buildLangSwitcher();
    markDirty(isNew);
    switchView(firstVisibleTab());
  }

  // The switcher only appears once a second i18n/<lang>.js file has
  // registered itself (see the bottom of i18n/en.js) — with just one
  // language there's nothing to switch between.
  function buildLangSwitcher() {
    const sel = document.getElementById('lang-switcher');
    const langs = I18n.availableLanguages();
    if (langs.length <= 1) {
      sel.classList.add('hidden');
      sel.innerHTML = '';
      return;
    }
    sel.innerHTML = langs.map(({ code, label }) =>
      `<option value="${code}" ${code === I18n.getCurrentLang() ? 'selected' : ''}>${label}</option>`).join('');
    sel.classList.remove('hidden');
    sel.onchange = () => switchLanguage(sel.value);
  }

  async function switchLanguage(langCode) {
    await I18n.load(langCode);
    localStorage.setItem(LANG_STORAGE_KEY, langCode);
    document.getElementById('app-title').textContent = appTitle();
    labelIconButtons();
    buildNav();
    rerender();
  }

  // An advanced, JSON-only override: family-data.json ships a "title"
  // field (empty by default). Set it to a non-empty string and it replaces
  // the active language's app.title everywhere the header shows it —
  // there's no UI for this, it's meant to be edited directly in the file.
  function appTitle() {
    return (state.data && state.data.title) ? state.data.title : t('app.title');
  }

  function labelIconButtons() {
    const save = document.getElementById('btn-save');
    save.title = t('actions.save');
    save.setAttribute('aria-label', t('actions.save'));
    const menuBtn = document.getElementById('btn-menu');
    menuBtn.title = t('actions.more');
    menuBtn.setAttribute('aria-label', t('actions.more'));
    document.getElementById('menu-start-over').textContent = t('menu.startOver');
    document.getElementById('menu-export').textContent = t('menu.exportCopy');
  }

  // The "⋯" menu in the header. The list closes on any click outside it
  // and on Escape.
  let headerMenuWired = false;
  function wireHeaderMenu() {
    const btn = document.getElementById('btn-menu');
    const list = document.getElementById('header-menu-list');
    const setOpen = (open) => {
      list.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.onclick = (e) => { e.stopPropagation(); setOpen(list.classList.contains('hidden')); };
    document.getElementById('menu-start-over').onclick = () => { setOpen(false); confirmStartOver(); };
    document.getElementById('menu-export').onclick = () => { setOpen(false); exportCopy(); };
    if (headerMenuWired) return;
    headerMenuWired = true;
    document.addEventListener('click', (e) => { if (!e.target.closest('.header-menu')) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }

  // "Start new or open another family tree": after confirming, the start
  // screen (create / import) is shown again. Nothing is replaced until one
  // of those is actually chosen, and handleCreateNew/handleImportExisting
  // back the current file up first; until then "Back to current family
  // tree" returns to it unchanged.
  function confirmStartOver() {
    const count = Object.keys(state.data.people).length;
    openModal((box) => {
      box.innerHTML = `
        <h3>${t('startOver.title')}</h3>
        <p>${t('startOver.body', { count })}</p>
        <div class="modal-actions">
          <button type="button" class="btn" id="start-over-cancel">${t('actions.cancel')}</button>
          <button type="button" class="btn btn--primary" id="start-over-continue">${t('actions.continue')}</button>
        </div>`;
      box.querySelector('#start-over-cancel').onclick = closeModal;
      box.querySelector('#start-over-continue').onclick = async () => {
        closeModal();
        // Make sure the latest edits are on disk before they get backed up.
        if (state.dirty) await queueSave(); else await saveChain;
        showLanding({ onBack: returnToCurrentTree });
        document.getElementById('app-shell').classList.add('hidden');
        document.getElementById('landing-screen').classList.remove('hidden');
      };
    });
  }

  function returnToCurrentTree() {
    document.getElementById('landing-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
  }

  function announceBackup(fileName) {
    if (fileName) showStatus(t('app.backupSaved', { file: fileName }), 8000);
  }

  // Settings live in js/settings.js (window.AppSettings.visibleTabs), edited
  // directly in that file — a tab set to false is only removed from the nav
  // bar, not blocked outright (e.g. clicking a person's name elsewhere can
  // still open Focus even if it's hidden from the menu).
  function isTabVisible(key) {
    const visible = window.AppSettings && window.AppSettings.visibleTabs;
    return !visible || visible[key] !== false;
  }

  function firstVisibleTab() {
    const found = VIEWS.find(({ key }) => isTabVisible(key));
    return found ? found.key : 'focus';
  }

  function buildNav() {
    const nav = document.getElementById('main-nav');
    nav.innerHTML = '';
    VIEWS.filter(({ key }) => isTabVisible(key)).forEach(({ key }) => {
      const btn = document.createElement('button');
      btn.textContent = t(`nav.${key}`);
      btn.dataset.view = key;
      btn.onclick = () => switchView(key);
      nav.appendChild(btn);
    });
    updateNavActive();
  }

  function updateNavActive() {
    document.querySelectorAll('#main-nav button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === state.currentView);
    });
  }

  function switchView(viewKey, params) {
    state.currentView = viewKey;
    updateNavActive();
    render(params);
  }

  function render(params) {
    const container = document.getElementById('view-root');
    const entry = VIEWS.find((v) => v.key === state.currentView);
    if (!entry) return;
    container.innerHTML = '';
    entry.mod().render(container, params);
  }

  function rerender() {
    render();
  }

  // Manual save button — joins the same queue autosave uses, so it never
  // races an autosave that's already in flight, and gives an explicit
  // "Saved" flash even when nothing was actually dirty.
  async function save() {
    return queueSave();
  }

  // Exports a standalone copy elsewhere, independent of the managed folder
  // — future saves (auto or manual) keep writing to the app's own
  // family-data.json regardless of where a copy was exported to.
  async function exportCopy() {
    try {
      await Storage.saveCopyAs(state.data);
    } catch (err) {
      if (err.name !== 'AbortError') alert(err.message);
    }
  }

  function openModal(renderFn) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'modal-box';
    root.appendChild(box);
    root.classList.remove('hidden');
    root.onclick = (e) => { if (e.target === root) closeModal(); };
    renderFn(box);
  }

  function closeModal() {
    const root = document.getElementById('modal-root');
    root.classList.add('hidden');
    root.innerHTML = '';
  }

  function setFocusedPerson(personId) {
    state.focusedPersonId = personId;
    switchView('focus');
  }

  return {
    init, t, getState, markDirty, switchView, rerender,
    openModal, closeModal, setFocusedPerson, save, exportCopy,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());

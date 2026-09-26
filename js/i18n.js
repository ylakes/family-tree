// i18n loader. Language files live in /i18n/<lang>.js and assign their
// strings object to window.I18N_DATA[lang]. A <script> tag loads them (see
// index.html) rather than fetch(), because Chrome's CORS policy blocks
// fetch()/XHR of local files when the app is opened directly via file://
// with no server — script tags are unaffected. Each file is otherwise a
// plain nested key-value map, structurally identical to a JSON file.
const I18n = (() => {
  let strings = {};
  let currentLang = 'en';

  async function load(lang) {
    const data = window.I18N_DATA && window.I18N_DATA[lang];
    if (!data) throw new Error(`Language file not loaded: ${lang}`);
    strings = data;
    currentLang = lang;
  }

  function lookup(key) {
    return key.split('.').reduce((obj, part) => (obj && obj[part] !== undefined ? obj[part] : undefined), strings);
  }

  // key is dot-path, e.g. "person.firstName"; vars fills {placeholders}
  function t(key, vars) {
    let str = lookup(key);
    if (str === undefined) return key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      }
    }
    return str;
  }

  // Each i18n/<lang>.js file registers itself into window.I18N_LANGUAGES
  // (see i18n/en.js) — that's the actual registration point, not anything
  // in app.js. This just reads whatever's been registered so far.
  function availableLanguages() {
    return (window.I18N_LANGUAGES || []).slice();
  }

  function getCurrentLang() {
    return currentLang;
  }

  return { load, t, availableLanguages, getCurrentLang };
})();

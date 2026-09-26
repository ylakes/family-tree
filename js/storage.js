// File System Access API wrapper. The app's data lives in a single
// family-data.json file inside a `database` subfolder of a folder the user
// grants access to once (normally the app's own folder). The chosen folder
// handle is persisted in IndexedDB so later launches can reuse it —
// browsers still require one user gesture per session to re-confirm
// filesystem access (a security boundary, not something a page can
// bypass), so App wires that gesture to a single "reconnect" click rather
// than the full create/import picker.
const Storage = (() => {
  const DB_NAME = 'family-tree-app-db';
  const STORE_NAME = 'handles';
  const DIR_KEY = 'appDirectory';
  const DATA_FILENAME = 'family-data.json';
  const DATA_SUBDIR = 'database';

  let dirHandle = null;

  // Data lives in a `database` subfolder of the granted app folder, kept
  // separate from the app's own code files. Created silently the first
  // time it's needed — no extra permission prompt, since write access to
  // a folder already covers everything created underneath it.
  async function getDataDirHandle() {
    return dirHandle.getDirectoryHandle(DATA_SUBDIR, { create: true });
  }

  // One-time upgrade path: earlier versions of this app stored
  // family-data.json directly in the app's root folder. If a file is
  // already there and nothing has been written to database/ yet, copy it
  // in and remove the old copy, so there's a single source of truth from
  // then on. Returns the migrated file handle, or null if there was
  // nothing to migrate.
  async function migrateLegacyFile(dataDir) {
    const legacyHandle = await dirHandle.getFileHandle(DATA_FILENAME, { create: false }).catch(() => null);
    if (!legacyHandle) return null;
    const text = await (await legacyHandle.getFile()).text();
    if (!text.trim()) return null;
    const newHandle = await dataDir.getFileHandle(DATA_FILENAME, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(text);
    await writable.close();
    await dirHandle.removeEntry(DATA_FILENAME).catch(() => {});
    return newHandle;
  }

  function isSupported() {
    return typeof window.showDirectoryPicker === 'function' &&
      typeof window.showOpenFilePicker === 'function' &&
      typeof window.showSaveFilePicker === 'function';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Looks for a previously-granted folder. Returns one of:
  // 'granted' (ready to use immediately), 'prompt' (needs one click to
  // reconfirm), 'denied', or 'none' (never set up).
  async function tryReconnect() {
    let stored;
    try {
      stored = await idbGet(DIR_KEY);
    } catch {
      return { status: 'none' };
    }
    if (!stored) return { status: 'none' };
    dirHandle = stored;
    const perm = await stored.queryPermission({ mode: 'readwrite' });
    return { status: perm };
  }

  // Re-confirms access to the remembered folder. Must run inside a user
  // gesture (e.g. a click handler) — browsers require this every session.
  async function reconnect() {
    if (!dirHandle) throw new Error('No remembered folder to reconnect to.');
    const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('Folder access was not granted.');
  }

  function hasFolder() {
    return !!dirHandle;
  }

  async function pickAppFolder() {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    dirHandle = handle;
    await idbSet(DIR_KEY, handle);
  }

  function validateSchema(data) {
    if (!data || !data.schemaVersion || !data.people || !data.unions) {
      throw new Error('That file does not look like a valid family tree data file.');
    }
    return data;
  }

  // Reads family-data.json from the database/ subfolder. Returns null if
  // there's no data file yet (fresh folder) or it's an empty placeholder.
  async function readDataFile() {
    if (!dirHandle) throw new Error('No folder selected yet.');
    const dataDir = await getDataDirHandle();
    let fileHandle = await dataDir.getFileHandle(DATA_FILENAME, { create: false }).catch(() => null);
    if (!fileHandle) fileHandle = await migrateLegacyFile(dataDir);
    if (!fileHandle) return null;
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return null;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('family-data.json in this folder is not valid JSON.');
    }
    return validateSchema(data);
  }

  async function writeDataFile(data) {
    if (!dirHandle) throw new Error('No folder selected yet.');
    data.meta.lastModified = new Date().toISOString();
    // Files saved before the title-override field existed won't have it —
    // add it (empty, meaning "no override") so it's visible for anyone
    // editing the JSON directly, rather than silently missing.
    if (data.title === undefined) data.title = '';
    if (!Array.isArray(data.treeViewHiddenPeople)) data.treeViewHiddenPeople = [];
    const dataDir = await getDataDirHandle();
    const fileHandle = await dataDir.getFileHandle(DATA_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  // Reads and validates an external file WITHOUT touching the managed
  // folder — the caller copies it in via writeDataFile() afterward.
  async function pickExternalFileToImport() {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Family tree data', accept: { 'application/json': ['.json'] } }],
      excludeAcceptAllOption: false,
      multiple: false,
    });
    const file = await handle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);
    return validateSchema(data);
  }

  // Manual "save a copy elsewhere" — independent of the managed folder;
  // does not change where future Save calls write to.
  async function saveCopyAs(data) {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'family-data.json',
      types: [{ description: 'Family tree data', accept: { 'application/json': ['.json'] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  async function forgetFolder() {
    dirHandle = null;
    await idbDelete(DIR_KEY).catch(() => {});
  }

  return {
    isSupported, tryReconnect, reconnect, hasFolder, pickAppFolder,
    readDataFile, writeDataFile, pickExternalFileToImport, saveCopyAs,
    forgetFolder,
  };
})();

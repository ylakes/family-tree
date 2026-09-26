# Family Tree

A private, fully offline family tree app. Everything runs in your browser
with no server, no build step, and no account — your data lives in one
JSON file on your own computer.

## Requirements

A **Chromium-based desktop browser**: Chrome, Edge, Brave, or Opera. The app
uses the File System Access API to read and write your data file directly,
which only Chromium browsers support. Safari and Firefox are not supported.

## Opening the app

Double-click `index.html`, or drag it into an open browser window. There is
nothing to install and nothing to run from a terminal.

**The first time**, you'll see two options:

- **Create new family tree** — you'll be asked to pick a folder; choose
  this app's own folder (the one containing `index.html`). The app creates
  `database/family-data.json` inside it and starts empty.
- **Import existing family tree** — pick a `family-data.json` file from
  anywhere, then pick this app's folder; the file is copied in and becomes
  the app's working data from then on.

Either way, your data ends up as `family-data.json` inside a `database`
subfolder next to `index.html` — the whole app folder is still
self-contained and portable, just with your data kept separate from the
app's own code files instead of sitting loose at the top level. This
subfolder is created automatically the first time it's needed; there's
nothing to set up yourself. (If you're upgrading from an older version
that kept `family-data.json` directly in the app folder, it's moved into
`database/` automatically the next time the app opens it — nothing to do
manually.)

**Every time after that**, the app remembers the folder and loads straight
into your tree — no picker, no landing screen. The one exception is
browser security: after a full browser restart, Chrome requires one click
to reconfirm folder access (it will never silently hand a page filesystem
access back — that's a deliberate browser safeguard, not something this
app can skip). You'll see a single "Continue with My Family Tree" button
for that; click it and you're in.

## Saving

- Every change (adding a person, editing a field, adding or removing a
  relationship, deleting someone) is written straight to
  `database/family-data.json` automatically — no button needed. A brief
  "Saving…" / "Saved" label appears next to the header icons while that
  happens.
- The disk icon in the header (or `Ctrl/Cmd+S`) re-saves manually — mostly
  useful as a way to retry if autosave ever fails (e.g. folder permission
  was revoked mid-session), since it's otherwise redundant with autosave.
- The export icon opens a picker to write a one-off copy of your data
  anywhere you choose, without changing where autosave writes to. Handy for
  sending someone a copy or dropping a dated backup snapshot.
- If a save is still in flight, the browser will warn you if you try to
  close the tab before it finishes — with autosave this window is normally
  well under a second.

Everything — every person, every relationship, every photo — lives in that
one JSON file, kept in the `database` subfolder. Nothing else is stored
outside the app folder, so the folder is the entire, portable backup.

## Moving to another computer

Copy (or zip) the whole `family-tree-app` folder — `database/family-data.json`
is already inside it. On the other computer, open `index.html`; since this is
a browser profile it's never seen before, it'll ask you to reconnect —
choose **Import existing family tree**, pick the `family-data.json` that's
already sitting in the `database` folder you just copied, and pick that
same top-level folder to save into. A USB stick, a shared drive, or a
zipped email attachment all work identically — nothing needs installing.

## Backing up

Because the data is a single JSON file, backing up is just keeping copies
of that file. Two easy habits:

- Use the export icon periodically to drop a dated snapshot next to your
  working file (or move those snapshots to a separate backups folder).
- Before major edits (a big reorganization, bulk deletes), make a manual
  copy of `database/family-data.json`.

Photos are embedded as base64 directly inside the JSON, so a single file
copy is a complete backup — there's no separate photos folder to remember.

## Adding a second language

All interface text lives in `/i18n/<lang>.js`, one file per language, each
assigning a flat key-value strings object to `window.I18N_DATA[langCode]`.
To add a language:

1. Copy `i18n/en.js` to `i18n/<code>.js` (e.g. `i18n/de.js`) and translate
   the values, keeping the keys identical.
2. Change its assignment to `window.I18N_DATA.<code> = { ... }`.
3. At the bottom of that same file, change the registration line to
   `window.I18N_LANGUAGES.push({ code: '<code>', label: '<name in that language>' })`
   — e.g. `{ code: 'de', label: 'Deutsch' }`. **This line is the actual
   "registration" step** — it's what makes the language switcher and the
   locale-aware date formatting aware the language exists.
4. Add a `<script src="i18n/<code>.js"></script>` tag in `index.html`,
   right after the `i18n/en.js` one.

That's it — nothing to touch in `js/app.js`. Once a second language is
registered this way, a dropdown automatically appears in the header next
to Save, and the choice is remembered across visits (stored in the
browser's local storage for this app).

**Why `.js` instead of `.json`:** Chrome's CORS policy blocks `fetch()`/XHR
requests to local files when a page is opened directly via `file://` (no
server). A `.json` file loaded with `fetch()` would fail silently in that
setup. `<script src="...">` tags aren't subject to that restriction, so
each language file is a plain JS file whose only content is a flat
key-value object assigned to a global — functionally identical to a JSON
strings file, just loaded in a way that works with no server.

**Dates follow the active language automatically.** Month names and
day/month ordering come from the browser's built-in locale data
(`Intl`/`toLocaleDateString`) keyed to whichever language file is loaded —
not from anything in the language file itself, and not a literal
word-for-word substitution. Switching to German, for example, renders
"6. Januar 2020" (day before month, the correct German order), not
"Januar 6, 2020". There's nothing to configure for this — it comes for
free as soon as a language's code (e.g. `de`) is registered, since that
code doubles as the locale passed to the browser's date formatter.

## Making one language the only option

The app ships with `i18n/de.js`, `i18n/en.js`, and `i18n/it.js` all
registered, so a switcher appears in the header with all three. To reduce
this to a single language (no switcher, no other language anywhere) — say,
German only:

1. Remove the `<script src="i18n/en.js"></script>` and
   `<script src="i18n/it.js"></script>` tags from `index.html`, keeping only
   `i18n/de.js`. Deleting the files themselves is optional — either way,
   nothing loads them.

That's the only change needed. With only one language registered, the
switcher automatically hides itself (the same rule that makes it appear
once a second language exists, in reverse), and the app boots straight
into that language — including for a visitor with no stored language
preference, since the startup fallback is "whichever language actually
loaded first" (script-tag order in `index.html`), not a hardcoded default.

To go back to offering both later, just restore that `<script>` tag.

## Entering dates

Birth and death dates just have Year / Month / Day fields — fill in
whatever you actually know and leave the rest blank. The app figures out
what it can do with what you gave it: a year alone gives an approximate
age with no calendar birthday; a month and day with no year gives a
recurring birthday with no age; all three gives both.

## Entering marriage/divorce dates

A union's start date (marriage/partnership date) and end date (divorce,
separation, or a spouse's death) live on the union itself, not on either
person. To set them: open a person's **Manage Relationships**, and either
- fill in the start date right in the **Add Partner** row when creating the
  union, or
- click **Edit** next to an existing partner to open its type, status,
  start date, and end date together (this is also where you mark a current
  union as divorced/separated/widowed).

Only unions with both a start date's month and day set show up in the
Anniversaries view, the same rule birthdays follow.

## Relationship terms

The Relationships view and in-law calculations use gendered terms (father/
mother, brother/sister, aunt/uncle, son-in-law/daughter-in-law, ...) based
on each person's own `gender` field. If a person's gender is blank or not
recognized as male/female, their relationship is shown with the neutral
term instead (parent, sibling, aunt/uncle, ...) rather than guessing.

## Showing/hiding tabs

Which of the 8 tabs appear in the nav bar is controlled by `js/settings.js`
— open it in a text editor and set any tab to `false`:

```js
window.AppSettings = {
  visibleTabs: {
    focus: true,
    tree: true,
    calendar: true,
    eventsCalendar: true,
    contacts: true,
    anniversaries: false,   // e.g. hides the Anniversaries tab
    stats: true,
    relationships: true,
  },
};
```

`calendar` is the Birthdays list; `eventsCalendar` is the combined
month-grid Calendar (see below) — they're independent tabs covering
overlapping data in different layouts, so hide whichever one you don't
need.

There's no in-app settings screen — it's a plain config file, edited
directly, the same way language files work. Hiding a tab only removes it
from the menu; it doesn't block the view if something else links to it
directly (for example, a person's name is always clickable to their Focus
view, even if you've hidden the Focus tab).

## Custom app title

`database/family-data.json` has a `"title"` field, empty by default. Leave
it empty and the header shows the active language's normal title
("Familienstammbaum" / "Family Tree"); set it to any non-empty string —
e.g. `"title": "The Smith Family"` — and that replaces the title
everywhere it's shown, regardless of language. This is an advanced,
JSON-only option with no in-app control for it; edit the file directly in
a text editor while the app is closed (or after saving, before reopening)
to avoid it being overwritten by an in-progress autosave.

## Calendar tab

A month-grid view combining birthdays and current unions' anniversaries —
living birthdays, deceased ("remembered") birthdays, and anniversaries each
get their own tag color (see the legend above the grid). Use the arrows to
move between months, "Today" to jump back to the current one, and click
any name to open their Focus view. It respects the active language for
month/weekday names and first-day-of-week — German starts weeks on Monday,
for example. This is additive: the existing Birthdays and Anniversaries
list views are untouched, so use whichever layout you prefer (or hide the
ones you don't via `js/settings.js`, above).

## Notes on the full tree view

The full-tree view uses a small in-house SVG layout (generation rows, pan
by dragging, zoom with the scroll wheel or the toolbar buttons) rather than
a vendored charting library, so the app has no third-party runtime
dependency to keep offline. Click any person's box to jump to their focus
view.

A `cytoscape.js`-based rewrite (canvas rendering, HTML photo cards) was
tried and reverted — it looked worse on screen for no real layout benefit,
and the actual hard problem (keeping married couples and siblings both
visually grouped without connector lines crossing between families) is
solved by the generation/clustering logic in `js/views/tree.js` itself,
not by the rendering layer. See that file's comments for the reasoning,
including why graph layout libraries like dagre couldn't help either
(forcing two spouses onto the same row needs a "same rank" edge
constraint dagre doesn't actually support).

If a tree is still hard to read even with correct layout — usually because
it blends several distantly-related family lines — **Personen
auswählen / Select People** in the tree's toolbar lets you hide specific
people from this view only. The hidden list is saved in
`treeViewHiddenPeople` in the data file itself (so it travels with the
tree across computers, like everything else), and doesn't affect any
other view — Statistics' generation counts, for example, always use the
complete tree regardless of what's hidden here.

## Project structure

```
family-tree-app/
  index.html
  css/
    style.css        screen styles
    print.css         @media print styles used by every view's "Download as PDF"
  js/
    app.js            state, routing, file actions, modal helper
    settings.js        tab visibility config (see "Showing/hiding tabs" above)
    data-model.js      schema helpers, dates, validation, relationship inference
    storage.js         File System Access API wrapper
    image-utils.js      photo resize/compression before embedding
    date-fields.js      shared partial-date input widget
    ui-helpers.js      shared person-card rendering
    views/            one file per view + the person form and relationship editor
  i18n/
    de.js             German strings (see "Adding a second language" above)
    en.js             English strings
    it.js             Italian strings
  vendor/             (empty — no third-party runtime dependencies)
  database/
    family-data.json  your data, once you save (not included — created by you)
```

#!/usr/bin/env node
// Regression check for the Full Tree layout (js/views/tree.js).
//
// Runs the real, unmodified source files against hand-built scenarios
// (tools/tree-test-lib.js), a batch of seeded synthetic families, and —
// if given — a real data file, then measures the actual drawn geometry:
// line crossings, lines touching/running on top of each other, lines
// through boxes, and box overlaps.
//
//   node tools/tree-layout-check.js [path/to/family-data.json]
// or, with no Node installed, macOS's built-in JavaScriptCore:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc \
//     tools/tree-layout-check.js -- [path/to/family-data.json]
// (run from the repository root either way).

var IS_NODE = typeof process !== 'undefined' && typeof require === 'function';
var ARGS = IS_NODE ? process.argv.slice(2) : (typeof arguments !== 'undefined' ? Array.prototype.slice.call(arguments) : []);
var log = IS_NODE ? console.log : print;
var readText = IS_NODE ? (p) => require('fs').readFileSync(p, 'utf8') : (p) => readFile(p);

var document = {
  createElement: () => ({ getContext: () => ({ font: '', measureText: (s) => ({ width: String(s).length * 6.5 }) }) }),
};
var LIB_FILES = ['js/data-model.js', 'js/ui-helpers.js', 'js/views/tree.js', 'tools/tree-test-lib.js'];
var env;
if (IS_NODE) {
  const vm = require('vm');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const ctx = { console, document };
  vm.createContext(ctx);
  LIB_FILES.forEach((f) => vm.runInContext(readText(path.join(root, f)), ctx, { filename: f }));
  env = vm.runInContext('({ DataModel, ViewTree, TreeTestLib })', ctx);
} else {
  LIB_FILES.forEach((f) => load(f));
  env = { DataModel, ViewTree, TreeTestLib };
}

var NODE_H = 72;
var t = (key) => key;

function visible(data) {
  const hidden = new Set(data.treeViewHiddenPeople || []);
  if (!hidden.size) return data;
  const people = {};
  Object.keys(data.people).forEach((id) => { if (!hidden.has(id)) people[id] = data.people[id]; });
  const unions = {};
  Object.values(data.unions).forEach((u) => {
    unions[u.id] = Object.assign({}, u, { partners: u.partners.filter((p) => !hidden.has(p)), children: u.children.filter((c) => !hidden.has(c)) });
  });
  return Object.assign({}, data, { people, unions });
}

function evaluate(data) {
  const start = Date.now();
  const r = env.ViewTree.layout(data, t);
  const ms = Date.now() - start;
  const boxes = [];
  r.centers.forEach((c, id) => {
    const w = r.widths.get(id);
    boxes.push({ id, x0: c.x - w / 2, y0: c.y - NODE_H / 2, x1: c.x + w / 2, y1: c.y + NODE_H / 2 });
  });
  const m = env.TreeTestLib.measure(boxes, r.links);
  // Every same-row couple whose block is a simple chain should stand side by side.
  let apartCouples = 0;
  Object.values(data.unions).forEach((u) => {
    if (u.partners.length !== 2) return;
    const [a, b] = u.partners.map((p) => r.centers.get(p));
    if (!a || !b || a.y !== b.y) return;
    const between = [...r.centers.values()].filter((c) => c.y === a.y && c.x > Math.min(a.x, b.x) + 1 && c.x < Math.max(a.x, b.x) - 1).length;
    if (between > 0) apartCouples += 1;
  });
  return Object.assign(m, { ms, apartCouples, width: Math.round(r.totalWidth), height: Math.round(r.totalHeight), people: Object.keys(data.people).length });
}

var failures = 0;
var totals = { crossings: 0, touches: 0, overlaps: 0, throughBox: 0, boxOverlaps: 0 };
function report(name, m) {
  Object.keys(totals).forEach((k) => { totals[k] += m[k]; });
  const bad = m.overlaps + m.throughBox + m.boxOverlaps + m.touches;
  if (bad) failures += 1;
  const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
  log(`${bad ? 'FAIL' : 'ok  '} ${pad(name, 34)} people=${pad(m.people, 4)} crossings=${pad(m.crossings, 3)} touches=${pad(m.touches, 3)} overlaps=${pad(m.overlaps, 3)} throughBox=${pad(m.throughBox, 3)} boxOverlaps=${pad(m.boxOverlaps, 3)} apartCouples=${pad(m.apartCouples, 2)} ${m.width}x${m.height} ${m.ms}ms`);
  if (bad) log(`       examples: ${JSON.stringify({ touches: m.examples.touches, overlaps: m.examples.overlaps })}`);
}

log('-- hand-built scenarios');
Object.keys(env.TreeTestLib.SCENARIOS).forEach((name) => report(name, evaluate(env.TreeTestLib.fromSpec(env.TreeTestLib.SCENARIOS[name]))));

log('-- synthetic families');
var SIZES = [
  { generations: 3, founders: 2, maxPeople: 40 },
  { generations: 4, founders: 3, maxPeople: 80 },
  { generations: 5, founders: 4, maxPeople: 150 },
];
for (var seed = 1; seed <= 12; seed += 1) {
  const cfg = SIZES[seed % SIZES.length];
  report(`synthetic seed=${seed} g=${cfg.generations}`, evaluate(env.TreeTestLib.generate(seed, cfg)));
}

var dataFile = ARGS.filter((a) => a !== '--')[0];
if (dataFile) {
  log('-- real data');
  const raw = JSON.parse(readText(dataFile));
  report('real (hidden people applied)', evaluate(visible(raw)));
  report('real (everyone visible)', evaluate(Object.assign({}, raw, { treeViewHiddenPeople: [] })));
}

log('');
log(`totals: ${JSON.stringify(totals)}`);
log(failures ? `${failures} scenario(s) with overlapping/touching lines, lines through boxes or box overlaps` : 'no overlapping lines, no lines through boxes, no box overlaps');
if (IS_NODE && failures) process.exitCode = 1;

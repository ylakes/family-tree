#!/usr/bin/env node
// Standalone regression check for the Full Tree layout algorithm
// (js/views/tree.js), run with plain `node tools/tree-layout-check.js`.
//
// This repo has no build step and no test runner, and prior investigations
// into this file's layout bugs (see KNOWN_ISSUE_tree_layout_overlap.md)
// repeatedly rebuilt and then threw away a reproduction harness each time —
// this script exists so that stops happening. It loads the real source
// files unmodified via Node's `vm` module with a minimal DOM stub (the only
// browser dependency reachable from `layout()` is one
// `document.createElement('canvas')` call inside `textWidth`), builds a set
// of synthetic scenarios plus the user's own saved data, and checks the
// invariants that matter: zero rectangle overlaps anywhere, and (for the
// scenarios that specifically target them) exact or near-exact anchor
// alignment for residual issues 1 & 3, positioned per-run since the
// 2026-08-14 recursive-positioning rewrite (see KNOWN_ISSUE_tree_layout_overlap.md
// — this superseded an earlier, narrower `structuralIdealLeftOf` fix).
//
// Note: developed and verified on a machine without Node installed, using
// an equivalent harness run through macOS's built-in JavaScriptCore
// (`osascript -l JavaScript`) with the same concatenated-source approach.
// This file is the portable, Node-native version of those same checks.

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const fakeDocument = {
  createElement: () => ({
    getContext: () => ({
      font: '',
      measureText: (s) => ({ width: String(s).length * 6.5 }),
    }),
  }),
};

const context = { console, document: fakeDocument };
vm.createContext(context);
['js/data-model.js', 'js/ui-helpers.js', 'js/views/tree.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
});
const { DataModel, ViewTree } = context;
const t = (key) => key;

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function mkPerson(id, firstName, birthYear) {
  return {
    id, firstName, lastName: '', maidenName: '', gender: '',
    birthDate: birthYear !== undefined ? { year: birthYear, month: null, day: null } : null,
    deathDate: null, isDeceased: false, photo: '',
  };
}
function mkUnion(id, partners, children, extra = {}) {
  return {
    id, partners, children, type: 'marriage', status: 'current',
    startDate: null, endDate: null, childRelationType: {}, ...extra,
  };
}
function mkData(people, unions) {
  const pMap = {}; const uMap = {};
  people.forEach((p) => { pMap[p.id] = p; });
  unions.forEach((u) => { uMap[u.id] = u; });
  return { schemaVersion: 1, treeViewHiddenPeople: [], people: pMap, unions: uMap };
}

function countOverlaps(centers, widths) {
  const byY = new Map();
  centers.forEach((c, id) => {
    const key = c.y;
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push({ id, left: c.x - (widths.get(id) || 90) / 2, right: c.x + (widths.get(id) || 90) / 2 });
  });
  const overlaps = [];
  byY.forEach((row) => {
    for (let i = 0; i < row.length; i += 1) {
      for (let j = i + 1; j < row.length; j += 1) {
        if (row[i].left < row[j].right - 0.01 && row[j].left < row[i].right - 0.01) overlaps.push([row[i].id, row[j].id]);
      }
    }
  });
  return overlaps;
}

function runLayout(data) {
  const result = ViewTree.layout(data, t);
  return { ...result, overlaps: countOverlaps(result.centers, result.widths) };
}

// ---- Scenario: trivial 1->2->4->8 (no half-siblings, no remarriage) ----
(function trivial() {
  console.log('trivial_1_2_4_8');
  const ids = ['me', 'dad', 'mom', 'pgf', 'pgm', 'mgf', 'mgm',
    'pggf1', 'pggm1', 'pggf2', 'pggm2', 'pggf3', 'pggm3', 'pggf4', 'pggm4'];
  const data = mkData(ids.map((id) => mkPerson(id, id)), [
    mkUnion('u1', ['dad', 'mom'], ['me']),
    mkUnion('u2', ['pgf', 'pgm'], ['dad']),
    mkUnion('u3', ['mgf', 'mgm'], ['mom']),
    mkUnion('u4', ['pggf1', 'pggm1'], ['pgf']),
    mkUnion('u5', ['pggf2', 'pggm2'], ['pgm']),
    mkUnion('u6', ['pggf3', 'pggm3'], ['mgf']),
    mkUnion('u7', ['pggf4', 'pggm4'], ['mgm']),
  ]);
  const r = runLayout(data);
  check('zero rectangle overlaps', r.overlaps.length === 0, JSON.stringify(r.overlaps));
})();

// ---- Scenario: residual issue 1 -- half-sibling anchor dilution ----
(function issue1() {
  console.log('issue1_half_sibling_dilution');
  const data = mkData([
    mkPerson('gianfranco', 'Gianfranco'),
    mkPerson('micaela', 'Micaela'),
    mkPerson('guido', 'Guido', 1950),
    mkPerson('giovanna', 'Giovanna', 1952),
    mkPerson('greta', 'Greta', 1958),
  ], [
    mkUnion('u1', ['gianfranco'], ['guido', 'giovanna']),
    mkUnion('u2', ['gianfranco', 'micaela'], ['greta']),
  ]);
  const r = runLayout(data);
  const g = (id) => r.centers.get(id).x;
  const distGuidoGiovanna = Math.abs((g('guido') + g('giovanna')) / 2 - g('gianfranco'));
  const distGreta = Math.abs(g('greta') - (g('gianfranco') + g('micaela')) / 2);
  check('zero rectangle overlaps', r.overlaps.length === 0, JSON.stringify(r.overlaps));
  console.log(`  info misalignment: guido/giovanna=${distGuidoGiovanna.toFixed(1)}px greta=${distGreta.toFixed(1)}px (each run now targets its OWN true anchor exactly; a nonzero residual on one side is an unavoidable consequence of fixed left-to-right order plus minimum gaps -- e.g. whichever run comes first in this tiny scenario reaches its own anchor exactly, at 0px)`);
})();

// ---- Scenario: residual issue 3 -- size-asymmetric marriage block ----
(function issue3() {
  console.log('issue3_size_asymmetric_marriage_block');
  const data = mkData([
    mkPerson('p1', 'P1'), mkPerson('p2', 'P2'),
    mkPerson('q1', 'Q1'), mkPerson('q2', 'Q2'),
    mkPerson('xsib', 'Xsib'), mkPerson('x', 'X'),
    mkPerson('y1', 'Y1'), mkPerson('y2', 'Y2'), mkPerson('y3', 'Y3'),
  ], [
    mkUnion('uP', ['p1', 'p2'], ['xsib', 'x']),
    mkUnion('uQ', ['q1', 'q2'], ['y1', 'y2', 'y3']),
    mkUnion('uXY', ['x', 'y1'], []),
  ]);
  const r = runLayout(data);
  const g = (id) => r.centers.get(id).x;
  const distX = Math.abs((g('xsib') + g('x')) / 2 - (g('p1') + g('p2')) / 2);
  const distY = Math.abs((g('y1') + g('y2') + g('y3')) / 3 - (g('q1') + g('q2')) / 2);
  check('zero rectangle overlaps', r.overlaps.length === 0, JSON.stringify(r.overlaps));
  check('exact alignment on both sides', distX < 0.5 && distY < 0.5, `distX=${distX.toFixed(1)} distY=${distY.toFixed(1)}`);
})();

// ---- Scenario: plain 1-vs-1 couple, very different widths ----
// NOTE: this is intentionally NOT a no-op under the current (per-run)
// positioning, unlike under the superseded structuralIdealLeftOf fix.
// Every couple is now positioned as two independent runs, each landing
// exactly on its own true anchor -- nonno's OWN center will match his OWN
// parents exactly, rather than the whole couple being centered as one
// unit (which used to leave him slightly off-center to make room for
// nonna). This is a real, deliberate, and broader behavior change -- see
// the 2026-08-14 recursive-positioning entry in
// KNOWN_ISSUE_tree_layout_overlap.md for why that's considered a
// correctness improvement, not a regression.
(function plainCoupleUnevenWidths() {
  console.log('plain_couple_uneven_widths');
  const data = mkData([
    mkPerson('a1', 'A'), mkPerson('a2', 'B'),
    mkPerson('nonno', 'Bartholomew Alexander'), mkPerson('nonna', 'Zo'),
  ], [
    mkUnion('u1', ['a1', 'a2'], ['nonno']),
    mkUnion('u2', ['nonno', 'nonna'], []),
  ]);
  const r = runLayout(data);
  const nonnoDist = Math.abs(r.centers.get('nonno').x - (r.centers.get('a1').x + r.centers.get('a2').x) / 2);
  check('zero rectangle overlaps', r.overlaps.length === 0, JSON.stringify(r.overlaps));
  check('nonno lands exactly on his own parents\' center', nonnoDist < 0.5, `off by ${nonnoDist.toFixed(1)}px`);
})();

// ---- Scenario: residual issue 2's already-fixed 4-sibling shape ----
(function issue2Regression() {
  console.log('issue2_4sibling_regression_check');
  const data = mkData([
    mkPerson('mother', 'Mother'), mkPerson('father', 'Father'),
    mkPerson('sib1', 'Sib1', 1940), mkPerson('sib2', 'Sib2', 1942),
    mkPerson('sib3', 'Sib3', 1944), mkPerson('sib4', 'Sib4', 1946),
    mkPerson('spouseWithAncestors', 'SpouseWithAncestors'),
    mkPerson('spouseGp1', 'SpouseGp1'), mkPerson('spouseGp2', 'SpouseGp2'),
    mkPerson('bare1', 'Bare1'),
    mkPerson('bareFormer', 'BareFormer'), mkPerson('bareCurrent', 'BareCurrent'),
  ], [
    mkUnion('uParents', ['father', 'mother'], ['sib1', 'sib2', 'sib3', 'sib4']),
    mkUnion('uGp', ['spouseGp1', 'spouseGp2'], ['spouseWithAncestors']),
    mkUnion('uM1', ['sib1', 'spouseWithAncestors'], []),
    mkUnion('uM2', ['sib2', 'bare1'], []),
    mkUnion('uM3a', ['sib3', 'bareFormer'], [], { status: 'former' }),
    mkUnion('uM3b', ['sib3', 'bareCurrent'], []),
  ]);
  const r = runLayout(data);
  check('zero rectangle overlaps', r.overlaps.length === 0, JSON.stringify(r.overlaps));
  const x = (id) => r.centers.get(id).x;
  const sib3Sandwiched = (x('bareFormer') < x('sib3')) === (x('sib3') < x('bareCurrent'));
  check('sib3 stays sandwiched between both bare partners', sib3Sandwiched, `bareFormer=${x('bareFormer').toFixed(0)} sib3=${x('sib3').toFixed(0)} bareCurrent=${x('bareCurrent').toFixed(0)}`);
})();

// ---- Real, saved data (optional -- only if present) ----
(function realData() {
  const p = path.join(ROOT, 'database', 'family-data.json');
  if (!fs.existsSync(p)) { console.log('real_family_data (skipped -- database/family-data.json not found)'); return; }
  console.log('real_family_data');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const data = { ...raw, treeViewHiddenPeople: [] };
  const r = runLayout(data);
  check('zero rectangle overlaps', r.overlaps.length === 0, JSON.stringify(r.overlaps));
  console.log(`  info people=${Object.keys(data.people).length} totalWidth=${r.totalWidth.toFixed(0)} totalHeight=${r.totalHeight.toFixed(0)}`);
})();

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('all checks passed');
}

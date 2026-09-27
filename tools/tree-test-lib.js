// Shared helpers for the Full Tree layout checks: geometry metrics,
// hand-built scenarios and a seeded synthetic family generator. Plain
// script (no modules) so it runs both under Node and under macOS's built-in
// JavaScriptCore (`jsc`) — see tools/tree-layout-check.js.

var TreeTestLib = (function () {
  // ---- Geometry metrics -------------------------------------------------
  //
  // Input: boxes [{id, x0, y0, x1, y1}] and links [{group, pair, segs:
  // [[x1,y1,x2,y2], ...]}] — a link's unbroken `rawSegs` are measured when
  // present (the drawn `segs` have gaps where lines cross). `group` identifies which family/couple a line
  // belongs to; a family connector's `pair` equals its couple's marriage
  // group, so a drop starting on its own parents' marriage line is not
  // counted as touching a foreign line.
  //   crossings: two different groups' segments properly crossing
  //   touches:   one group's segment ending ON another group's segment
  //              (reads as if they were connected)
  //   overlaps:  two different groups' segments running along each other
  //              (the "lines on top of each other" defect)
  //   nearOverlaps: two different groups' parallel segments running side
  //              by side less than 6px apart (read as one line)
  //   throughBox: a segment passing through a person's box
  //   boxOverlaps: two boxes intersecting
  function measure(boxes, links) {
    const EPS = 0.5;
    const segs = [];
    links.forEach((l) => (l.rawSegs || l.segs).forEach((s) => {
      if (Math.abs(s[0] - s[2]) < 0.01 && Math.abs(s[1] - s[3]) < 0.01) return;
      segs.push({ s, g: l.group, pair: l.pair || l.group });
    }));
    const related = (a, b) => a.g === b.g || a.pair === b.g || b.pair === a.g;
    let crossings = 0, touches = 0, overlaps = 0;
    const examples = { crossings: [], touches: [], overlaps: [], nearOverlaps: [] };
    for (let i = 0; i < segs.length; i += 1) {
      for (let j = i + 1; j < segs.length; j += 1) {
        const A = segs[i], B = segs[j];
        if (related(A, B)) continue;
        const r = relate(A.s, B.s, EPS);
        if (r === 'cross') { crossings += 1; if (examples.crossings.length < 5) examples.crossings.push([A.g, B.g]); }
        else if (r === 'touch') { touches += 1; if (examples.touches.length < 5) examples.touches.push([A.g, B.g]); }
        else if (r === 'overlap') { overlaps += 1; if (examples.overlaps.length < 5) examples.overlaps.push([A.g, B.g]); }
      }
    }
    // Parallel lines of different families closer than NEAR px along a
    // shared stretch: not touching, but they read as one line.
    const NEAR = 6;
    let nearOverlaps = 0;
    for (let i = 0; i < segs.length; i += 1) {
      for (let j = i + 1; j < segs.length; j += 1) {
        const A = segs[i], B = segs[j];
        if (related(A, B)) continue;
        const [ax1, ay1, ax2, ay2] = A.s, [bx1, by1, bx2, by2] = B.s;
        const av = Math.abs(ax1 - ax2) < 0.01, bv = Math.abs(bx1 - bx2) < 0.01;
        const ah = Math.abs(ay1 - ay2) < 0.01, bh = Math.abs(by1 - by2) < 0.01;
        let close = false;
        if (av && bv && Math.abs(ax1 - bx1) > EPS && Math.abs(ax1 - bx1) < NEAR) {
          close = Math.min(Math.max(ay1, ay2), Math.max(by1, by2)) - Math.max(Math.min(ay1, ay2), Math.min(by1, by2)) > 1;
        } else if (ah && bh && Math.abs(ay1 - by1) > EPS && Math.abs(ay1 - by1) < NEAR) {
          close = Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2)) - Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2)) > 1;
        }
        if (close) { nearOverlaps += 1; if (examples.nearOverlaps.length < 5) examples.nearOverlaps.push([A.g, B.g]); }
      }
    }
    let throughBox = 0;
    segs.forEach(({ s }) => {
      boxes.forEach((b) => { if (segThroughRect(s, b.x0 + 1, b.y0 + 1, b.x1 - 1, b.y1 - 1)) throughBox += 1; });
    });
    let boxOverlaps = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i], b = boxes[j];
        if (a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01) boxOverlaps += 1;
      }
    }
    return { crossings, touches, overlaps, nearOverlaps, throughBox, boxOverlaps, examples };
  }

  function relate(a, b, eps) {
    const [x1, y1, x2, y2] = a, [x3, y3, x4, y4] = b;
    const dx1 = x2 - x1, dy1 = y2 - y1, dx2 = x4 - x3, dy2 = y4 - y3;
    const den = dx1 * dy2 - dy1 * dx2;
    const len1 = Math.hypot(dx1, dy1), len2 = Math.hypot(dx2, dy2);
    if (Math.abs(den) < 1e-9 * len1 * len2) {
      // parallel: collinear?
      const cross = (x3 - x1) * dy1 - (y3 - y1) * dx1;
      if (Math.abs(cross) / len1 > eps) return null;
      const ux = dx1 / len1, uy = dy1 / len1;
      const p3 = (x3 - x1) * ux + (y3 - y1) * uy, p4 = (x4 - x1) * ux + (y4 - y1) * uy;
      const lo = Math.max(0, Math.min(p3, p4)), hi = Math.min(len1, Math.max(p3, p4));
      if (hi - lo > eps) return 'overlap';
      return null;
    }
    const t = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / den;
    const u = ((x3 - x1) * dy1 - (y3 - y1) * dx1) / den;
    const et = eps / len1, eu = eps / len2;
    if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return null;
    const tIn = t > et && t < 1 - et, uIn = u > eu && u < 1 - eu;
    if (tIn && uIn) return 'cross';
    if (tIn || uIn) return 'touch';
    return null; // endpoints meeting endpoints
  }

  function segThroughRect(s, x0, y0, x1, y1) {
    if (x1 <= x0 || y1 <= y0) return false;
    // Liang-Barsky clip; positive-length interior overlap means "through".
    let [ax, ay, bx, by] = s;
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    for (let i = 0; i < 4; i += 1) {
      if (p[i] === 0) { if (q[i] <= 0) return false; continue; }
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return (t1 - t0) * Math.hypot(dx, dy) > 1;
  }

  // ---- Data builders ------------------------------------------------------

  function mkPerson(id, firstName, birthYear) {
    return {
      id, firstName, lastName: '', maidenName: '', gender: '',
      birthDate: { year: birthYear === undefined ? null : birthYear, month: null, day: null },
      deathDate: { year: null, month: null, day: null }, isDeceased: false, photo: '',
    };
  }
  function mkUnion(id, partners, children, extra) {
    return Object.assign({
      id, partners, children, type: 'marriage', status: 'current',
      startDate: null, endDate: null, childRelationType: {},
    }, extra || {});
  }
  function mkData(people, unions) {
    const pMap = {}, uMap = {};
    people.forEach((p) => { pMap[p.id] = p; });
    unions.forEach((u) => { uMap[u.id] = u; });
    return { schemaVersion: 1, treeViewHiddenPeople: [], people: pMap, unions: uMap };
  }

  // Tiny DSL: "a+b>c,d" means union of a and b with children c and d;
  // "a+b" a childless union; "a>c" a single-parent union; "a+b~" (or
  // "a+b~>c") a divorced union. Birth years default to declaration order.
  function fromSpec(spec) {
    const people = new Map(), unions = [];
    let year = 1900;
    const person = (id) => { if (!people.has(id)) people.set(id, mkPerson(id, id, year++)); return id; };
    spec.split(/\s*;\s*/).filter(Boolean).forEach((part, i) => {
      const [lhs, rhs] = part.split('>');
      const divorced = lhs.includes('~');
      const partners = lhs.replace('~', '').split('+').map((s) => s.trim()).filter(Boolean).map(person);
      const kids = rhs ? rhs.split(',').map((s) => s.trim()).filter(Boolean).map(person) : [];
      unions.push(mkUnion(`u${i}`, partners, kids, divorced ? { status: 'divorced' } : {}));
    });
    return mkData([...people.values()], unions);
  }

  const SCENARIOS = {
    trivial_1_2_4_8: 'dad+mom>me; pgf+pgm>dad; mgf+mgm>mom; a1+a2>pgf; a3+a4>pgm; a5+a6>mgf; a7+a8>mgm',
    half_siblings: 'gian>guido,giovanna; gian+micaela>greta',
    half_siblings_three_unions: 'p+a~>a1,a2; p+b~>b1; p+c>c1,c2',
    asymmetric_marriage: 'p1+p2>xsib,x; q1+q2>y1,y2,y3; x+y1',
    four_siblings_mixed: 'father+mother>s1,s2,s3,s4; g1+g2>sa; s1+sa; s2+bare1; s3+bf~; s3+bc',
    both_spouses_with_ancestors: 'w+g>b,hp; b+e>y,j; ww+wm>w; gp1+gp2>g; ek+et>e,ez,um; ez+he>mi; um+cf~>mo; um+ca',
    three_partners: 'x+a~>a1,a2; x+b~>b1; x+c>c1; xp1+xp2>x; ap1+ap2>a; cp1+cp2>c',
    cousin_marriage: 'g1+g2>p1,p2; p1+s1>c1,c2; p2+s2>c3,c4; c2+c3>d1,d2',
    double_cousins: 'a1+a2>a,b; b1+b2>c,d; a+c>x1,x2; b+d>y1,y2',
    siblings_marry_siblings: 'f1+m1>a,b,c; f2+m2>d,e,f; a+d>k1; b+e>k2; c+f>k3',
    cross_generation_marriage: 'g1+g2>p,q; p+ps>c1,c2; q+qs>c3; c1+x>z; q+c3s',
    long_edge: 'a+b>c,d; c+e>f; d+f>h; x+y>e',
    single_parents: 'm>a,b; f>c; a+c>k; b>l',
    child_of_two_unions: 'a+b>c; d+e>c,f; c+f',
    remarriage_chain: 'a+b~>c; b+d~>e; d+f>g; f+h~>i; a+j>k',
    pedigree_collapse: 'g1+g2>p1,p2; p1+q1>c1; p2+q2>c2; c1+c2>d; q1p+q1m>q1',
  };

  // ---- Synthetic generator -------------------------------------------------

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Random multi-branch family: a few founding couples, several
  // generations of children who marry into each other's families (or
  // cousins, or rootless spouses who sometimes get their own ancestors
  // and siblings), divorces with half-siblings, 3+ partners, single
  // parents, a child listed under two unions, and occasional marriages
  // across generations.
  function generate(seed, opts) {
    const o = Object.assign({
      founders: 3, generations: 4, maxPeople: 120, kidsMean: 2.2,
      pMarry: 0.75, pInMarriage: 0.25, pCousin: 0.05, pRemarry: 0.2, pThird: 0.05,
      pSingle: 0.05, pAncestors: 0.3, pSpouseSiblings: 0.3, pTwoUnions: 0.02, pCrossGen: 0.03,
    }, opts || {});
    const R = rng(seed);
    const people = [], unions = [];
    let n = 0, u = 0;
    const lineage = new Map();
    const person = (year, lin) => {
      const id = `p${n++}`;
      people.push(mkPerson(id, id, year));
      lineage.set(id, lin);
      return id;
    };
    const union = (partners, kids, status) => { const un = mkUnion(`u${u++}`, partners, kids, status ? { status } : {}); unions.push(un); return un; };
    const kidCount = () => { let k = 0; const lam = o.kidsMean; let p = Math.exp(-lam), s = p; const x = R(); while (x > s && k < 6) { k += 1; p *= lam / k; s += p; } return k; };
    const yearOf = new Map();

    let current = [];
    for (let f = 0; f < o.founders; f += 1) {
      const a = person(1880 + Math.floor(R() * 10), f), b = person(1880 + Math.floor(R() * 10), f);
      current.push(union([a, b], []));
    }
    people.forEach((p) => yearOf.set(p.id, p.birthDate.year));

    const addKids = (un, baseYear, lin) => {
      const k = kidCount();
      for (let i = 0; i < k && people.length < o.maxPeople; i += 1) {
        const id = person(baseYear + 25 + i * 2 + Math.floor(R() * 2), lin);
        yearOf.set(id, baseYear + 25 + i * 2);
        un.children.push(id);
      }
    };
    const giveAncestors = (id) => {
      const y = yearOf.get(id) || 1950;
      const pa = person(y - 28, `a${id}`), pb = person(y - 27, `a${id}`);
      const un = union([pa, pb], [id]);
      if (R() < o.pSpouseSiblings) { const sib = person(y + 2, `a${id}`); un.children.push(sib); }
      if (R() < 0.4) { const ga = person(y - 55, `g${id}`), gb = person(y - 54, `g${id}`); union([ga, gb], [pa]); }
      if (R() < 0.3) { const ga = person(y - 55, `h${id}`), gb = person(y - 54, `h${id}`); union([ga, gb], [pb]); }
    };

    const byGen = [];
    for (let gIdx = 0; gIdx < o.generations && people.length < o.maxPeople; gIdx += 1) {
      const kidsThisGen = [];
      current.forEach((un) => {
        const base = Math.max(...un.partners.map((p) => yearOf.get(p) || 1900));
        addKids(un, base, lineage.get(un.partners[0]));
        un.children.forEach((c) => kidsThisGen.push(c));
      });
      byGen.push(kidsThisGen);
      const next = [];
      const married = new Set();
      kidsThisGen.forEach((kid) => {
        if (people.length >= o.maxPeople) return;
        if (married.has(kid) || R() > o.pMarry) return;
        married.add(kid);
        if (R() < o.pSingle) { next.push(union([kid], [])); return; }
        let spouse = null;
        const x = R();
        if (x < o.pInMarriage + o.pCousin) {
          const wantCousin = x < o.pCousin;
          const pool = kidsThisGen.filter((c) => !married.has(c) && c !== kid
            && (wantCousin ? lineage.get(c) === lineage.get(kid) : lineage.get(c) !== lineage.get(kid))
            && !unions.some((un) => un.children.includes(c) && un.children.includes(kid)));
          if (pool.length) { spouse = pool[Math.floor(R() * pool.length)]; married.add(spouse); }
        } else if (x < o.pInMarriage + o.pCousin + o.pCrossGen && byGen.length >= 2) {
          const pool = byGen[byGen.length - 2].filter((c) => !married.has(c));
          if (pool.length) { spouse = pool[Math.floor(R() * pool.length)]; married.add(spouse); }
        }
        if (!spouse) {
          spouse = person((yearOf.get(kid) || 1950) + Math.floor(R() * 4) - 2, `s${kid}`);
          yearOf.set(spouse, yearOf.get(kid));
          if (R() < o.pAncestors) giveAncestors(spouse);
        }
        if (R() < o.pRemarry) {
          next.push(union([kid, spouse], [], 'divorced'));
          const s2 = person(yearOf.get(kid) || 1950, `s${kid}b`);
          yearOf.set(s2, yearOf.get(kid));
          if (R() < o.pAncestors / 2) giveAncestors(s2);
          if (R() < o.pThird) {
            next.push(union([kid, s2], [], 'divorced'));
            const s3 = person(yearOf.get(kid) || 1950, `s${kid}c`);
            yearOf.set(s3, yearOf.get(kid));
            next.push(union([kid, s3], []));
          } else next.push(union([kid, s2], []));
        } else next.push(union([kid, spouse], []));
      });
      current = next;
    }
    // A few children listed under a second union too (step-parent adoption).
    unions.forEach((un) => {
      if (R() < o.pTwoUnions && un.children.length) {
        const other = unions.find((v) => v !== un && v.partners.some((p) => un.partners.includes(p)));
        if (other && !other.children.includes(un.children[0]) && !other.partners.includes(un.children[0])) other.children.push(un.children[0]);
      }
    });
    return mkData(people, unions);
  }

  return { measure, mkPerson, mkUnion, mkData, fromSpec, SCENARIOS, generate };
})();

if (typeof module !== 'undefined') module.exports = TreeTestLib;

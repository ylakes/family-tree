// Full family tree: a generation-layered layout rendered as plain SVG
// (rect/circle/text — no HTML foreignObject), with mouse-drag pan and
// wheel/button zoom. Built in-house (no vendored charting library) so the
// app has zero runtime dependency risk. See TREE_LAYOUT.md for how the
// layout works and how to test it.
//
// Plain SVG primitives instead of foreignObject+HTML/CSS for two reasons:
// Chrome's print/PDF pipeline can silently drop CSS borders on HTML content
// inside foreignObject (renders fine on screen, vanishes in the PDF), and
// native SVG shapes always print reliably. Node height is a fixed constant
// (not content-driven) so two partners' centers always line up and the
// connecting line stays perfectly horizontal — width is what flexes to fit
// each name.
const ViewTree = (() => {
  const PHOTO_D = 44, PAD = 12, GAP = 10, NODE_H = 72, VIEW_MARGIN = 12;
  const MIN_TEXT_W = 90, TEXT_BUFFER = 10;
  let transform = { x: 40, y: 40, scale: 1 };
  let dragState = null, dragMoved = false;
  let onMouseMove = null, onMouseUp = null;

  let measureCtx = null;
  function textWidth(text, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  }

  const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const NAME_FONT = `600 13px ${FONT_FAMILY}`;
  const META_FONT = `11px ${FONT_FAMILY}`;

  function nodeWidth(lines) {
    const textW = Math.max(
      MIN_TEXT_W,
      textWidth(lines[0], NAME_FONT),
      ...lines.slice(1).map((l) => textWidth(l, META_FONT)),
    );
    return PAD + PHOTO_D + GAP + textW + TEXT_BUFFER + PAD;
  }

  // Person ids hidden from the tree only (data.treeViewHiddenPeople) — a
  // display-simplification preference, not a data change. Filtering
  // happens here, once, up front: everything below (generations,
  // clustering, layout, rendering) operates on the already-filtered data
  // and has no idea filtering exists.
  function buildVisibleData(data, hiddenIds) {
    if (hiddenIds.size === 0) return data;
    const people = {};
    Object.keys(data.people).forEach((id) => { if (!hiddenIds.has(id)) people[id] = data.people[id]; });
    const unions = {};
    Object.values(data.unions).forEach((u) => {
      const partners = u.partners.filter((pid) => !hiddenIds.has(pid));
      const children = u.children.filter((cid) => !hiddenIds.has(cid));
      if (partners.length === 0 && children.length === 0) return;
      unions[u.id] = { ...u, partners, children };
    });
    return { ...data, people, unions };
  }

  // Generation (row) of every person. Rules, in priority order:
  //   1. a child is always at least one row below each of their parents;
  //   2. partners share a row whenever that doesn't contradict rule 1 (it
  //      can't be honored when, e.g., someone partners with a grandchild of
  //      their own sibling — such a couple is simply drawn across rows);
  //   3. parent->child links are kept as short as possible, so a person
  //      without recorded parents sits directly above their children and
  //      a less-researched branch lines up with its in-laws.
  // Partners are merged into shared-row classes one union at a time
  // (current unions first), skipping any merge that would put a class above
  // itself. Rows then come from a longest-path pass over the classes,
  // followed by bounded "pull" passes that move each class within its
  // feasible range toward whichever side has more links. Every step is
  // bounded, so contradictory data can never make it run away.
  function computeGenerations(data) {
    const people = DataModel.allPeople(data).map((p) => p.id);
    const known = new Set(people);
    const unions = DataModel.allUnions(data).map((u) => {
      const partners = [...new Set(u.partners)].filter((id) => known.has(id));
      const children = [...new Set(u.children)].filter((id) => known.has(id) && !partners.includes(id));
      return { partners, children, current: u.status === 'current' };
    });

    // Person-level parent->child links, minus any that close a cycle (a
    // person recorded as their own ancestor).
    const kids = new Map(people.map((id) => [id, new Set()]));
    unions.forEach((u) => u.partners.forEach((p) => u.children.forEach((c) => kids.get(p).add(c))));
    const state = new Map();
    people.forEach((root) => {
      if (state.has(root)) return;
      const stack = [[root, [...kids.get(root)]]];
      state.set(root, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (!top[1].length) { state.set(top[0], 2); stack.pop(); continue; }
        const c = top[1].pop();
        if (state.get(c) === 1) { kids.get(top[0]).delete(c); continue; }
        if (!state.has(c)) { state.set(c, 1); stack.push([c, [...kids.get(c)]]); }
      }
    });

    // Shared-row classes (union-find), merged only when neither class is
    // an ancestor of the other.
    const cls = new Map(people.map((id) => [id, id]));
    const find = (x) => { while (cls.get(x) !== x) { cls.set(x, cls.get(cls.get(x))); x = cls.get(x); } return x; };
    const members = new Map(people.map((id) => [id, [id]]));
    const reaches = (from, to) => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        const c = queue.shift();
        for (const m of members.get(c)) {
          for (const k of kids.get(m)) {
            const kc = find(k);
            if (kc === to) return true;
            if (!seen.has(kc)) { seen.add(kc); queue.push(kc); }
          }
        }
      }
      return false;
    };
    [...unions.filter((u) => u.current), ...unions.filter((u) => !u.current)].forEach((u) => {
      for (let i = 1; i < u.partners.length; i += 1) {
        const a = find(u.partners[0]), b = find(u.partners[i]);
        if (a === b || reaches(a, b) || reaches(b, a)) continue;
        cls.set(a, b);
        members.set(b, [...members.get(b), ...members.get(a)]);
        members.delete(a);
      }
    });

    // Class graph, one edge per person-level link.
    const classes = [...members.keys()];
    const up = new Map(classes.map((c) => [c, []]));
    const down = new Map(classes.map((c) => [c, []]));
    people.forEach((p) => kids.get(p).forEach((k) => {
      const a = find(p), b = find(k);
      if (a === b) return;
      down.get(a).push(b);
      up.get(b).push(a);
    }));

    // Longest path from the top, in topological order.
    const indeg = new Map(classes.map((c) => [c, up.get(c).length]));
    const order = classes.filter((c) => indeg.get(c) === 0);
    for (let i = 0; i < order.length; i += 1) {
      down.get(order[i]).forEach((d) => { indeg.set(d, indeg.get(d) - 1); if (indeg.get(d) === 0) order.push(d); });
    }
    const g = new Map(classes.map((c) => [c, 0]));
    order.forEach((c) => up.get(c).forEach((p) => { g.set(c, Math.max(g.get(c), g.get(p) + 1)); }));

    // Pull passes: each move strictly shortens the total link length, so
    // this terminates; the pass cap is only a safety net.
    for (let pass = 0; pass < 2 * classes.length + 10; pass += 1) {
      let moved = false;
      order.forEach((c) => {
        const ps = up.get(c), ds = down.get(c);
        let target = g.get(c);
        if (ds.length > ps.length) target = Math.min(...ds.map((d) => g.get(d))) - 1;
        else if (ps.length > ds.length) target = Math.max(...ps.map((p) => g.get(p))) + 1;
        if (target !== g.get(c)) { g.set(c, target); moved = true; }
      });
      if (!moved) break;
    }

    // Each connected part of the tree starts at row 0.
    const comp = new Map(people.map((id) => [id, id]));
    const cf = (x) => { while (comp.get(x) !== x) { comp.set(x, comp.get(comp.get(x))); x = comp.get(x); } return x; };
    unions.forEach((u) => {
      const all = [...u.partners, ...u.children];
      all.slice(1).forEach((id) => { const a = cf(all[0]), b = cf(id); if (a !== b) comp.set(a, b); });
    });
    const minOf = new Map();
    people.forEach((id) => {
      const r = cf(id), v = g.get(find(id));
      minOf.set(r, minOf.has(r) ? Math.min(minOf.get(r), v) : v);
    });
    const gen = new Map();
    people.forEach((id) => gen.set(id, g.get(find(id)) - minOf.get(cf(id))));
    return gen;
  }

  // ---- Layout -----------------------------------------------------------
  //
  // A layered ("Sugiyama-style") drawing adapted to family trees, in five
  // independent steps. Each step only consumes the previous step's output,
  // never feeds back into it:
  //
  //   1. Rows: computeGenerations above. A parent->child link that skips
  //      rows (a child pushed deeper to sit next to their spouse) gets an
  //      invisible "dummy" item in every row it passes through, so every
  //      connector only ever spans one row gap.
  //   2. Blocks: people married within the same row are fused into a block
  //      that always stays contiguous (a person with two partners sits
  //      between them). A block may have several valid internal
  //      arrangements (orientation; which side each of 3+ partners is on).
  //   3. Order: left-to-right order of blocks within each row, minimizing
  //      connector crossings, with birth order among siblings as the
  //      secondary goal (barycenter sweeps, then a local search that
  //      accepts a move only if it strictly lowers crossings*1000 +
  //      birth-order inversions). Pure integer order, no pixels.
  //   4. Coordinates: with the order fixed, x positions minimize the
  //      squared distance between every child and their parents' anchor
  //      (and every couple and the center of their children), subject to
  //      minimum gaps. Solved row by row exactly (weighted isotonic
  //      regression), iterated to convergence.
  //   5. Lanes: every family's horizontal connector gets its own height
  //      ("lane") in the gap below the parents. Lane order within a gap is
  //      chosen to minimize crossings (exact search), two families only
  //      share a lane when their lines are far apart horizontally, and each
  //      gap is made just tall enough for its lanes — so two different
  //      families' lines never run on top of each other.
  //
  // Disconnected parts of the tree are laid out independently and placed
  // side by side.

  const PARTNER_GAP = 24, SIBLING_GAP = 30, FAMILY_GAP = 64, COMPONENT_GAP = 120;
  const DUMMY_GAP = 18;
  const MIN_ROW_GAP = 70, LANE_MARGIN = 24, LANE_SPACING = 18, LANE_CLEARANCE = 14;
  const SPREAD = 8, DROP_CLEARANCE = 20, SEPARATION_WEIGHT = 3, CROSSING_GAP = 6, MIN_LINE_DISTANCE = 10;
  const MAX_SWEEPS = 10, MAX_POSITION_ITERS = 200, ORDER_ILS_MAX = 600, ORDER_ILS_WORK = 40000;

  // Deterministic PRNG so the same data always yields the same drawing.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function birthOrderCompare(data, a, b) {
    const pa = data.people[a], pb = data.people[b];
    const ca = DataModel.dateToComparable(pa.birthDate);
    const cb = DataModel.dateToComparable(pb.birthDate);
    if (ca !== null && cb !== null && ca !== cb) return ca - cb;
    if (ca !== null && cb === null) return -1;
    if (cb !== null && ca === null) return 1;
    return (DataModel.fullName(pa) || '').localeCompare(DataModel.fullName(pb) || '');
  }

  // Unions reduced to what the drawing needs. A union with no partners
  // carries no drawable information (there is nothing to connect the
  // children to), and a single-partner union without children draws
  // nothing either.
  function buildFamilies(data) {
    const fams = [];
    DataModel.allUnions(data).forEach((u) => {
      const partners = [...new Set(u.partners)].filter((id) => data.people[id]);
      const kids = [...new Set(u.children)].filter((id) => data.people[id] && !partners.includes(id));
      if (partners.length === 0) return;
      if (partners.length === 1 && kids.length === 0) return;
      fams.push({ id: u.id, partners, kids, current: u.status === 'current' });
    });
    return fams;
  }

  function connectedComponents(personIds, fams) {
    const parent = new Map(personIds.map((id) => [id, id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    fams.forEach((f) => { const all = [...f.partners, ...f.kids]; all.slice(1).forEach((id) => join(all[0], id)); });
    const byRoot = new Map();
    personIds.forEach((id) => {
      const r = find(id);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(id);
    });
    return [...byRoot.values()];
  }

  // ---- Step 1+2: items, connectors, blocks ----------------------------

  // Builds the per-component graph: row items (people + dummies), the
  // connectors of every row gap, and the marriage blocks of every row.
  // A connector is one family's link across ONE row gap: `tops` are items
  // in row r (the parents, or a dummy continuing a longer link), `bottoms`
  // items in row r+1 (children, or the next dummy).
  function buildComponentGraph(data, personIds, fams, gen, widths) {
    const inComp = new Set(personIds);
    const items = new Map();
    personIds.forEach((id) => items.set(id, { id, kind: 'person', r: gen.get(id), w: widths.get(id) }));
    const conns = [];
    const compFams = fams.filter((f) => inComp.has(f.partners[0]));

    compFams.forEach((f) => {
      const rT = Math.max(...f.partners.map((p) => gen.get(p)));
      const tops = f.partners.filter((p) => gen.get(p) === rT);
      const kids = f.kids.filter((k) => gen.get(k) > rT);
      if (kids.length === 0) {
        if (tops.length >= 2) conns.push({ id: `${f.id}@${rT}`, fam: f, r: rT, tops, bottoms: [], first: true });
        return;
      }
      const maxKid = Math.max(...kids.map((k) => gen.get(k)));
      let prevTops = tops;
      for (let r = rT; r < maxKid; r += 1) {
        const bottoms = kids.filter((k) => gen.get(k) === r + 1);
        let dummy = null;
        if (r + 1 < maxKid) {
          dummy = `~${f.id}~${r + 1}`;
          items.set(dummy, { id: dummy, kind: 'dummy', r: r + 1, w: 0, fam: f });
          bottoms.push(dummy);
        }
        conns.push({ id: `${f.id}@${r}`, fam: f, r, tops: prevTops, bottoms, first: r === rT });
        prevTops = dummy ? [dummy] : [];
      }
    });

    let maxRow = 0;
    items.forEach((it) => { maxRow = Math.max(maxRow, it.r); });
    const up = new Map(), down = new Map();
    items.forEach((_, id) => { up.set(id, []); down.set(id, []); });
    conns.forEach((c) => {
      c.tops.forEach((t) => down.get(t).push(c));
      c.bottoms.forEach((b) => up.get(b).push(c));
    });

    // Same-row marriages -> blocks.
    const spouse = new Map();
    compFams.forEach((f) => {
      if (f.partners.length < 2) return;
      for (let i = 0; i < f.partners.length; i += 1) {
        for (let j = i + 1; j < f.partners.length; j += 1) {
          const a = f.partners[i], b = f.partners[j];
          if (gen.get(a) !== gen.get(b)) continue;
          if (!spouse.has(a)) spouse.set(a, new Set());
          if (!spouse.has(b)) spouse.set(b, new Set());
          spouse.get(a).add(b);
          spouse.get(b).add(a);
        }
      }
    });
    const blockOf = new Map();
    const blocks = [];
    items.forEach((it, id) => {
      if (blockOf.has(id)) return;
      const members = [];
      const queue = [id];
      blockOf.set(id, true);
      while (queue.length) {
        const cur = queue.shift();
        members.push(cur);
        (spouse.get(cur) || []).forEach((s) => { if (!blockOf.has(s)) { blockOf.set(s, true); queue.push(s); } });
      }
      const block = { r: it.r, members, alts: blockArrangements(members, spouse), a: 0 };
      members.forEach((m) => blockOf.set(m, block));
      blocks.push(block);
    });

    return { items, conns, up, down, spouse, blocks, blockOf, maxRow };
  }

  // Valid internal orders of a marriage block: a simple chain (by far the
  // most common case: a couple, or someone between a former and a current
  // partner) has exactly two, itself and its mirror image. Anything with
  // a branch (someone with 3+ partners) is enumerated and the arrangements
  // that keep partners closest together are kept — the ordering phase then
  // picks whichever one crosses the least.
  function blockArrangements(members, spouse) {
    if (members.length === 1) return [members];
    const deg = (m) => [...(spouse.get(m) || [])].filter((s) => members.includes(s)).length;
    const edges = [];
    members.forEach((a) => (spouse.get(a) || []).forEach((b) => { if (a < b && members.includes(b)) edges.push([a, b]); }));
    const isPath = edges.length === members.length - 1 && members.every((m) => deg(m) <= 2);
    if (isPath) {
      const start = members.find((m) => deg(m) === 1);
      const path = [start];
      while (path.length < members.length) {
        const last = path[path.length - 1];
        path.push([...spouse.get(last)].find((s) => members.includes(s) && !path.includes(s)));
      }
      return [path, [...path].reverse()];
    }
    if (members.length > 7) {
      const sorted = [...members].sort((a, b) => deg(b) - deg(a));
      return [sorted, [...sorted].reverse()];
    }
    let best = Infinity;
    let out = [];
    const perm = (arr, rest) => {
      if (rest.length === 0) {
        const idx = new Map(arr.map((m, i) => [m, i]));
        const score = edges.reduce((s, [a, b]) => s + Math.abs(idx.get(a) - idx.get(b)) - 1, 0);
        if (score < best) { best = score; out = [arr]; } else if (score === best && out.length < 48) out.push(arr);
        return;
      }
      rest.forEach((m, i) => perm([...arr, m], [...rest.slice(0, i), ...rest.slice(i + 1)]));
    };
    perm([], members);
    return out;
  }

  // ---- Step 3: order --------------------------------------------------

  function rowSeq(row) {
    const seq = [];
    row.forEach((b) => b.alts[b.a].forEach((m) => seq.push(m)));
    return seq;
  }

  function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }

  // Number of pairs i < j with a[i] > a[j] (merge sort, O(n log n)).
  function countInversions(a) {
    if (a.length < 2) return 0;
    let n = 0;
    const buf = new Array(a.length);
    const sort = (lo, hi) => {
      if (hi - lo < 2) return;
      const mid = (lo + hi) >> 1;
      sort(lo, mid); sort(mid, hi);
      let i = lo, j = mid, k = lo;
      while (i < mid && j < hi) {
        if (a[j] < a[i]) { n += mid - i; buf[k++] = a[j++]; } else buf[k++] = a[i++];
      }
      while (i < mid) buf[k++] = a[i++];
      while (j < hi) buf[k++] = a[j++];
      for (k = lo; k < hi; k += 1) a[k] = buf[k];
    };
    sort(0, a.length);
    return n;
  }

  function orderComponent(data, g) {
    const R = g.maxRow;
    const rows = Array.from({ length: R + 1 }, () => []);
    const pos = Array.from({ length: R + 1 }, () => new Map());
    const cache = new Array(R + 1).fill(null);
    const updatePos = (r) => {
      const m = new Map();
      const seq = rowSeq(rows[r]);
      seq.forEach((id, i) => m.set(id, i));
      pos[r] = m;
      cache[r] = null;
      if (r > 0) cache[r - 1] = null;
    };
    const connsByGap = Array.from({ length: R + 1 }, () => []);
    g.conns.forEach((c) => { if (c.tops.length && c.bottoms.length) connsByGap[c.r].push(c); });
    const birthRank = new Map();
    [...g.items.values()].filter((it) => it.kind === 'person').map((it) => it.id)
      .sort((a, b) => birthOrderCompare(data, a, b)).forEach((id, i) => birthRank.set(id, i));
    const personKids = new Map(g.conns.map((c) => [c, c.bottoms.filter((b) => birthRank.has(b))]));

    // Crossings in one gap if every connector were drawn as straight lines
    // from its parents' position to each child — the standard layered-graph
    // crossing count; lanes (step 5) can only avoid what the order allows.
    // Plus birth-order inversions among each family's children, weighted
    // far lower so they only ever break ties.
    const gapCost = (r) => {
      if (cache[r] !== null) return cache[r];
      const conns = connsByGap[r];
      let cost = 0;
      if (conns.length) {
        const pt = pos[r], pb = pos[r + 1];
        const edges = [];
        conns.forEach((c) => {
          let t = 0;
          c.tops.forEach((id) => { t += pt.get(id); });
          t /= c.tops.length;
          c.bottoms.forEach((b) => edges.push([t, pb.get(b)]));
        });
        edges.sort((e1, e2) => (e1[0] - e2[0]) || (e1[1] - e2[1]));
        let inversions = 0;
        conns.forEach((c) => {
          const kids = personKids.get(c);
          if (kids.length < 2) return;
          inversions += countInversions([...kids].sort((a, b) => pb.get(a) - pb.get(b)).map((k) => birthRank.get(k)));
        });
        cost = countInversions(edges.map((e) => e[1])) * 1000 + inversions;
      }
      cache[r] = cost;
      return cost;
    };
    const totalCost = () => { let s = 0; for (let r = 0; r < R; r += 1) s += gapCost(r); return s; };
    const rowCost = (r) => (r > 0 ? gapCost(r - 1) : 0) + (r < R ? gapCost(r) : 0);

    const snapshot = () => rows.map((row) => row.map((b) => ({ b, a: b.a })));
    const restore = (snap) => {
      snap.forEach((row, r) => { rows[r] = row.map((e) => { e.b.a = e.a; return e.b; }); updatePos(r); });
    };

    // Initial order: depth-first walk of the family graph (partners, then
    // children oldest-first, then parents), so relatives start out close
    // together and siblings start in birth order.
    const initialOrder = (startIds) => {
      const seen = new Set();
      const seqByRow = Array.from({ length: R + 1 }, () => []);
      const visit = (id) => {
        const stack = [id];
        while (stack.length) {
          const cur = stack.pop();
          if (seen.has(cur)) continue;
          seen.add(cur);
          seqByRow[g.items.get(cur).r].push(cur);
          const next = [];
          (g.spouse.get(cur) || []).forEach((s) => next.push(s));
          g.down.get(cur).forEach((c) => {
            c.tops.forEach((t) => next.push(t));
            const kids = [...c.bottoms].sort((a, b) => {
              const da = g.items.get(a).kind === 'dummy', db = g.items.get(b).kind === 'dummy';
              if (da || db) return da - db;
              return birthOrderCompare(data, a, b);
            });
            kids.forEach((k) => next.push(k));
          });
          g.up.get(cur).forEach((c) => c.tops.forEach((t) => next.push(t)));
          for (let i = next.length - 1; i >= 0; i -= 1) if (!seen.has(next[i])) stack.push(next[i]);
        }
      };
      startIds.forEach(visit);
      g.items.forEach((_, id) => visit(id));
      for (let r = 0; r <= R; r += 1) {
        const idx = new Map(seqByRow[r].map((id, i) => [id, i]));
        const blocks = g.blocks.filter((b) => b.r === r);
        blocks.forEach((b) => { b.a = 0; b.first = Math.min(...b.members.map((m) => idx.get(m))); });
        rows[r] = blocks.sort((a, b) => a.first - b.first);
        updatePos(r);
      }
    };

    // Barycenter reordering of row r against its neighbor row (above for
    // dir 'down', below for 'up'). A block with no relatives in that
    // direction keeps its current position as its key (both scales are
    // normalized to 0..1, so the comparison is meaningful).
    const reorder = (r, dir) => {
      const nb = dir === 'down' ? pos[r - 1] : pos[r + 1];
      const norm = (m, id) => (m.get(id) + 0.5) / m.size;
      const keyOf = (id) => {
        const conns = (dir === 'down' ? g.up.get(id) : g.down.get(id)).filter((c) => c.tops.length && c.bottoms.length);
        const vals = conns.map((c) => mean((dir === 'down' ? c.tops : c.bottoms).map((x) => norm(nb, x))));
        return vals.length ? mean(vals) : null;
      };
      const entries = rows[r].map((b, i) => {
        const keys = new Map();
        b.members.forEach((m) => { const k = keyOf(m); if (k !== null) keys.set(m, k); });
        const key = keys.size ? mean([...keys.values()]) : mean(b.members.map((m) => norm(pos[r], m)));
        if (b.alts.length > 1 && keys.size > 1) {
          const inv = (alt) => {
            const ks = alt.filter((m) => keys.has(m)).map((m) => keys.get(m));
            let n = 0;
            for (let i2 = 0; i2 < ks.length; i2 += 1) for (let j = i2 + 1; j < ks.length; j += 1) if (ks[i2] > ks[j]) n += 1;
            return n;
          };
          let bestA = b.a, bestInv = inv(b.alts[b.a]);
          b.alts.forEach((alt, ai) => { const v = inv(alt); if (v < bestInv) { bestInv = v; bestA = ai; } });
          b.a = bestA;
        }
        return { b, key, i };
      });
      entries.sort((x, y) => (x.key - y.key) || (x.i - y.i));
      rows[r] = entries.map((e) => e.b);
      updatePos(r);
    };

    // Local search: swap neighboring blocks / try other arrangements,
    // keeping a change only when it strictly improves the cost.
    // Local search: swap neighboring blocks / try other arrangements,
    // keeping a change only when it strictly improves the cost. Rows are
    // revisited only while they or a neighbor keep improving.
    const localSearch = (startRows) => {
      const queued = new Set(startRows || rows.map((_, r) => r));
      let budget = 30 * (R + 1);
      while (queued.size && budget > 0) {
        budget -= 1;
        const r = Math.min(...queued);
        queued.delete(r);
        const row = rows[r];
        let cur = rowCost(r), improved = false;
        for (let i = 0; i < row.length; i += 1) {
          const b = row[i];
          for (let ai = 0; ai < b.alts.length; ai += 1) {
            if (ai === b.a) continue;
            const old = b.a;
            b.a = ai; updatePos(r);
            const c = rowCost(r);
            if (c < cur) { cur = c; improved = true; } else { b.a = old; updatePos(r); }
          }
          if (i + 1 < row.length) {
            [row[i], row[i + 1]] = [row[i + 1], row[i]]; updatePos(r);
            const c = rowCost(r);
            if (c < cur) { cur = c; improved = true; } else { [row[i], row[i + 1]] = [row[i + 1], row[i]]; updatePos(r); }
          }
        }
        if (improved) [r - 1, r, r + 1].forEach((q) => { if (q >= 0 && q <= R) queued.add(q); });
      }
    };

    const run = (startIds) => {
      initialOrder(startIds);
      let best = snapshot(), bestCost = totalCost();
      for (let s = 0; s < MAX_SWEEPS && bestCost > 0; s += 1) {
        for (let r = 1; r <= R; r += 1) reorder(r, 'down');
        for (let r = R - 1; r >= 0; r -= 1) reorder(r, 'up');
        const c = totalCost();
        if (c < bestCost) { bestCost = c; best = snapshot(); }
      }
      restore(best);
      localSearch();
      return { snap: snapshot(), cost: totalCost() };
    };

    // A few differently-seeded starts; keep the best.
    const persons = [...g.items.values()].filter((it) => it.kind === 'person').map((it) => it.id);
    const byAge = [...persons].sort((a, b) => (g.items.get(a).r - g.items.get(b).r) || birthOrderCompare(data, a, b));
    const rand = mulberry32(persons.length * 7919 + g.conns.length);
    const starts = [[byAge[0]], [byAge[byAge.length - 1]], [...byAge].reverse()];
    for (let i = 0; i < 3; i += 1) starts.push([byAge[Math.floor(rand() * byAge.length)]]);
    let best = null;
    starts.forEach((st) => {
      if (best && best.cost === 0) return;
      const res = run(st);
      if (!best || res.cost < best.cost) best = res;
    });
    restore(best.snap);

    // Iterated local search: some improvements need several coordinated
    // moves (e.g. swapping two families in one row only pays off once
    // their children below have followed), which single improving steps
    // can't reach. Randomly perturb one row, re-run the local search, and
    // keep the result if it's no worse. The iteration count depends only
    // on the size of the tree, so the drawing is fully deterministic.
    let bestCost = best.cost;
    const iterations = Math.max(20, Math.min(ORDER_ILS_MAX, Math.round(ORDER_ILS_WORK / Math.max(1, g.items.size))));
    for (let it = 0; it < iterations && bestCost > 0; it += 1) {
      const candidates = rows.map((row, r) => r).filter((r) => rows[r].length > 1);
      if (!candidates.length) break;
      const r = candidates[Math.floor(rand() * candidates.length)];
      const row = rows[r];
      const i = Math.floor(rand() * row.length);
      let j = Math.floor(rand() * (row.length - 1));
      if (j >= i) j += 1;
      if (rand() < 0.5) [row[i], row[j]] = [row[j], row[i]];
      else { const [lo, hi] = i < j ? [i, j] : [j, i]; rows[r] = [...row.slice(0, lo), ...row.slice(lo, hi + 1).reverse(), ...row.slice(hi + 1)]; }
      updatePos(r);
      localSearch([r - 1, r, r + 1].filter((q) => q >= 0 && q <= R));
      const c = totalCost();
      if (c <= bestCost) { bestCost = c; best = { snap: snapshot(), cost: c }; } else restore(best.snap);
    }
    restore(best.snap);
    return rows.map(rowSeq);
  }

  // ---- Step 4: coordinates --------------------------------------------

  function positionComponent(g, seqs) {
    const x = new Map();
    const rowOf = new Map();
    const indexOf = new Map();
    seqs.forEach((seq, r) => seq.forEach((id, i) => { rowOf.set(id, r); indexOf.set(id, i); }));
    const w = (id) => g.items.get(id).w;
    const isDummy = (id) => g.items.get(id).kind === 'dummy';
    const siblings = (a, b) => g.up.get(a).some((c) => c.bottoms.includes(b));
    const minSep = (a, b) => {
      let gap;
      if (isDummy(a) || isDummy(b)) gap = DUMMY_GAP;
      else if ((g.spouse.get(a) || new Set()).has(b)) gap = PARTNER_GAP;
      else if (siblings(a, b)) gap = SIBLING_GAP;
      else gap = FAMILY_GAP;
      return w(a) / 2 + w(b) / 2 + gap;
    };
    const seps = seqs.map((seq) => seq.slice(1).map((id, i) => minSep(seq[i], id)));
    seqs.forEach((seq, r) => {
      let cx = 0;
      seq.forEach((id, i) => { if (i > 0) cx += seps[r][i - 1]; x.set(id, cx); });
    });

    // Two partners side by side attach their children at the middle of the
    // gap between their boxes; anything else attaches at the mean center.
    const adjacentPair = (c) => c.tops.length === 2 && rowOf.get(c.tops[0]) === rowOf.get(c.tops[1])
      && Math.abs(indexOf.get(c.tops[0]) - indexOf.get(c.tops[1])) === 1;
    const anchorX = (c) => {
      if (adjacentPair(c)) {
        const [a, b] = c.tops;
        const [l, rr] = x.get(a) <= x.get(b) ? [a, b] : [b, a];
        return ((x.get(l) + w(l) / 2) + (x.get(rr) - w(rr) / 2)) / 2;
      }
      return mean(c.tops.map((t) => x.get(t)));
    };
    const pullOf = (a, b) => {
      if (isDummy(a) || isDummy(b)) return 0.05;
      if ((g.spouse.get(a) || new Set()).has(b)) return 5;
      return siblings(a, b) ? 0.3 : 0.05;
    };
    const weightOf = (c) => (c.tops.some(isDummy) || c.bottoms.some(isDummy) ? 4 : 1);

    const solveRow = (r) => {
      const seq = seqs[r];
      if (!seq.length) return 0;
      const n = seq.length;
      const target = new Array(n), weight = new Array(n);
      seq.forEach((id, i) => {
        let sw = extraW.get(id) || 0, swt = extraWT.get(id) || 0;
        g.up.get(id).forEach((c) => {
          if (!c.tops.length) return;
          const wt = weightOf(c);
          sw += wt; swt += wt * anchorX(c);
        });
        g.down.get(id).forEach((c) => {
          if (!c.bottoms.length) return;
          const wt = weightOf(c);
          const center = mean(c.bottoms.map((b) => x.get(b)));
          sw += wt; swt += wt * (center + x.get(id) - anchorX(c));
        });
        // Mild pull toward each row neighbor at minimum distance, strongest
        // between partners: removes slack nothing else needs, so couples
        // stay tight and unrelated space doesn't accumulate.
        if (i > 0) {
          const wt = pullOf(seq[i - 1], id);
          sw += wt; swt += wt * (x.get(seq[i - 1]) + seps[r][i - 1]);
        }
        if (i + 1 < n) {
          const wt = pullOf(id, seq[i + 1]);
          sw += wt; swt += wt * (x.get(seq[i + 1]) - seps[r][i]);
        }
        if (sw === 0) { sw = 1e-3; swt = 1e-3 * x.get(id); }
        target[i] = swt / sw; weight[i] = sw;
      });
      // Weighted isotonic regression (pool adjacent violators) on
      // y_i = x_i - S_i, where S_i is the minimum offset of item i from
      // item 0: minimizes sum w_i (x_i - target_i)^2 subject to every
      // minimum gap, exactly.
      const S = [0];
      for (let i = 1; i < n; i += 1) S.push(S[i - 1] + seps[r][i - 1]);
      const stack = [];
      for (let i = 0; i < n; i += 1) {
        stack.push({ w: weight[i], wy: weight[i] * (target[i] - S[i]), count: 1 });
        while (stack.length > 1) {
          const top = stack[stack.length - 1], prev = stack[stack.length - 2];
          if (prev.wy / prev.w <= top.wy / top.w) break;
          stack.pop();
          prev.w += top.w; prev.wy += top.wy; prev.count += top.count;
        }
      }
      let moved = 0, i = 0;
      stack.forEach((blk) => {
        const m = blk.wy / blk.w;
        for (let k = 0; k < blk.count; k += 1, i += 1) {
          const nx = m + S[i];
          moved = Math.max(moved, Math.abs(nx - x.get(seq[i])));
          x.set(seq[i], nx);
        }
      });
      return moved;
    };

    // Keeps every family's drop point out from under a neighboring family's
    // horizontal line in the same gap: if it sat inside, the two lines would
    // have to cross whichever lane order is picked later. Penalty terms,
    // re-derived from the current positions each iteration, push the
    // offending children and parents apart. Pairs that enclose each other's
    // drop points cross anyway, so they're left alone.
    const extraW = new Map(), extraWT = new Map();
    const connsByGap = new Map();
    g.conns.forEach((c) => {
      if (!c.tops.length || !c.bottoms.length) return;
      if (!connsByGap.has(c.r)) connsByGap.set(c.r, []);
      connsByGap.get(c.r).push(c);
    });
    const addPull = (id, t, wt) => {
      extraW.set(id, (extraW.get(id) || 0) + wt);
      extraWT.set(id, (extraWT.get(id) || 0) + wt * t);
    };
    const updateSeparationPulls = () => {
      extraW.clear(); extraWT.clear();
      connsByGap.forEach((conns) => {
        const info = conns.map((c) => {
          const a = anchorX(c);
          const xs = c.bottoms.map((b) => x.get(b));
          return { c, a, min: Math.min(a, ...xs), max: Math.max(a, ...xs) };
        });
        info.forEach((F) => info.forEach((G) => {
          if (F === G || !(G.a > F.min + 1 && G.a < F.max - 1)) return;
          if (F.a > G.min + 1 && F.a < G.max - 1) return;
          const right = F.a < G.a;
          const limit = right ? G.a - DROP_CLEARANCE : G.a + DROP_CLEARANCE;
          F.c.bottoms.forEach((b) => {
            const bx = x.get(b);
            const over = right ? bx - limit : limit - bx;
            if (over <= 0) return;
            addPull(b, limit, SEPARATION_WEIGHT);
            G.c.tops.forEach((t) => addPull(t, x.get(t) + (right ? over : -over), SEPARATION_WEIGHT));
          });
        }));
      });
    };

    for (let iter = 0; iter < MAX_POSITION_ITERS; iter += 1) {
      updateSeparationPulls();
      let moved = 0;
      for (let r = 0; r < seqs.length; r += 1) moved = Math.max(moved, solveRow(r));
      for (let r = seqs.length - 1; r >= 0; r -= 1) moved = Math.max(moved, solveRow(r));
      if (moved < 0.05) break;
    }

    let minX = Infinity, maxX = -Infinity;
    x.forEach((v, id) => { minX = Math.min(minX, v - w(id) / 2); maxX = Math.max(maxX, v + w(id) / 2); });
    x.forEach((v, id) => x.set(id, v - minX));
    return { x, width: maxX - minX, adjacentPair };
  }

  // ---- Step 5: lanes --------------------------------------------------

  // Crossings caused if connector A's lane is ABOVE connector B's: A's
  // horizontal line is crossed by B's vertical drops from B's parents,
  // and A's vertical drops to its children cross B's horizontal line. A
  // drop of A landing exactly on B's drop line would run along it — that
  // is heavily penalized, since hiding one line under another is worse
  // than a crossing.
  function laneCost(A, B) {
    const eps = 0.5;
    const inside = (v, c) => v > c.min + eps && v < c.max - eps;
    let cost = 0;
    B.topXs.forEach((t) => { if (inside(t, A)) cost += 1; });
    A.botXs.forEach((b) => { if (inside(b, B)) cost += 1; });
    B.topXs.forEach((t) => A.botXs.forEach((b) => { if (Math.abs(t - b) < 1) cost += 100; }));
    return cost;
  }

  // Minimum-cost vertical order of connectors that interact (a linear
  // ordering problem): exact dynamic programming over subsets for up to 12
  // connectors, greedy + adjacent swaps beyond that.
  function orderLanes(group) {
    const n = group.length;
    if (n === 1) return group;
    const c = group.map((a) => group.map((b) => (a === b ? 0 : laneCost(a, b))));
    if (n <= 12) {
      const full = (1 << n) - 1;
      const dp = new Float64Array(1 << n).fill(Infinity);
      const choice = new Int8Array(1 << n).fill(-1);
      dp[0] = 0;
      for (let S = 0; S < full; S += 1) {
        if (dp[S] === Infinity) continue;
        for (let j = 0; j < n; j += 1) {
          if (S & (1 << j)) continue;
          let add = 0;
          for (let i = 0; i < n; i += 1) if (S & (1 << i)) add += c[i][j];
          const T = S | (1 << j);
          if (dp[S] + add < dp[T]) { dp[T] = dp[S] + add; choice[T] = j; }
        }
      }
      const order = [];
      let S = full;
      while (S) { const j = choice[S]; order.unshift(group[j]); S &= ~(1 << j); }
      return order;
    }
    const idx = group.map((_, i) => i);
    const placed = [];
    const rest = new Set(idx);
    while (rest.size) {
      let bestJ = -1, bestV = Infinity;
      rest.forEach((j) => {
        let v = 0;
        placed.forEach((i) => { v += c[i][j]; });
        rest.forEach((k) => { if (k !== j) v += c[j][k] - c[k][j]; });
        if (v < bestV) { bestV = v; bestJ = j; }
      });
      placed.push(bestJ); rest.delete(bestJ);
    }
    for (let pass = 0; pass < 20; pass += 1) {
      let improved = false;
      for (let i = 0; i + 1 < placed.length; i += 1) {
        const a = placed[i], b = placed[i + 1];
        if (c[b][a] < c[a][b]) { placed[i] = b; placed[i + 1] = a; improved = true; }
      }
      if (!improved) break;
    }
    return placed.map((i) => group[i]);
  }

  // Nudges points that would coincide (two families dropping from the same
  // person, or into the same child) apart so their lines stay separate.
  function spreadCoincident(points) {
    const groups = new Map();
    points.forEach((p) => {
      const k = Math.round(p.x);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    });
    groups.forEach((ps) => {
      if (ps.length < 2) return;
      ps.sort((a, b) => a.order - b.order);
      ps.forEach((p, i) => { p.x += (i - (ps.length - 1) / 2) * SPREAD; });
    });
  }

  function assignLanes(gapConns) {
    const drawn = gapConns.filter((c) => c.topXs.length && (c.botXs.length || c.topXs.length >= 2));
    drawn.forEach((c) => {
      const xs = [...c.topXs, ...c.botXs];
      c.min = Math.min(...xs); c.max = Math.max(...xs);
    });
    drawn.sort((a, b) => (a.min - b.min) || (a.max - b.max));
    // Interaction groups: connectors whose horizontal extents come within
    // LANE_CLEARANCE of each other.
    const groups = [];
    let cur = [], curMax = -Infinity;
    drawn.forEach((c) => {
      if (cur.length && c.min > curMax + LANE_CLEARANCE) { groups.push(cur); cur = []; curMax = -Infinity; }
      cur.push(c); curMax = Math.max(curMax, c.max);
    });
    if (cur.length) groups.push(cur);
    let levels = 0;
    groups.forEach((grp) => {
      const order = orderLanes(grp);
      const placed = [];
      order.forEach((c) => {
        let lvl = 0;
        placed.forEach((p) => {
          if (c.min <= p.max + LANE_CLEARANCE && p.min <= c.max + LANE_CLEARANCE) lvl = Math.max(lvl, p.level + 1);
        });
        c.level = lvl;
        placed.push(c);
        levels = Math.max(levels, lvl + 1);
      });
    });
    return levels;
  }

  // Where two different families' lines still cross, one of them is drawn
  // with a small gap so it reads as running BEHIND the other. Fixed order,
  // front to back: vertical lines (each leads from a couple down to one
  // child, so they stay unbroken and easy to trace), then horizontal lines,
  // then the rare diagonal line between partners in different rows. Lanes
  // guarantee lines of different families never touch or overlap, so a
  // proper crossing is the only way two of them can meet. Each link keeps
  // its unbroken geometry in `rawSegs` (used by the layout checks); `segs`
  // is what gets drawn. Returns the crossing points.
  function markCrossings(links) {
    const rank = ([x1, y1, x2, y2]) => {
      if (Math.abs(x1 - x2) < 0.01) return 2;
      return Math.abs(y1 - y2) < 0.01 ? 1 : 0;
    };
    const all = [];
    links.forEach((l) => l.segs.forEach((sg) => all.push({ l, sg, rank: rank(sg) })));
    const related = (a, b) => a === b || a.group === b.group || a.pair === b.group || b.pair === a.group;
    const crossings = [];
    links.forEach((l) => {
      l.rawSegs = l.segs;
      const out = [];
      l.segs.forEach((sg) => {
        const [x1, y1, x2, y2] = sg;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        const myRank = rank(sg);
        // Parameters (0..1 along this segment) where a line in front of it
        // properly crosses it, away from both lines' ends.
        const cuts = [];
        if (len > 2 * CROSSING_GAP) {
          all.forEach((o) => {
            if (o.rank <= myRank || related(l, o.l)) return;
            const [x3, y3, x4, y4] = o.sg;
            const ex = x4 - x3, ey = y4 - y3;
            const den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-9) return;
            const t = ((x3 - x1) * ey - (y3 - y1) * ex) / den;
            const u = ((x3 - x1) * dy - (y3 - y1) * dx) / den;
            const olen = Math.hypot(ex, ey);
            if (t * len < CROSSING_GAP || (1 - t) * len < CROSSING_GAP || u * olen < 1 || (1 - u) * olen < 1) return;
            cuts.push(t);
            crossings.push({ x: x1 + t * dx, y: y1 + t * dy });
          });
        }
        if (!cuts.length) { out.push(sg); return; }
        cuts.sort((a, b) => a - b);
        const half = CROSSING_GAP / len;
        let start = 0;
        cuts.forEach((t) => {
          const end = t - half;
          if (end - start > 1e-6) out.push([x1 + start * dx, y1 + start * dy, x1 + end * dx, y1 + end * dy]);
          start = Math.max(start, t + half);
        });
        if (1 - start > 1e-6) out.push([x1 + start * dx, y1 + start * dy, x2, y2]);
      });
      l.segs = out;
    });
    return crossings;
  }

  // The layout depends only on the people's box contents (name, dates) and
  // the unions, so the last result is reused until one of those changes —
  // switching views or tabs doesn't pay for the order search again.
  let layoutCache = { key: null, result: null };

  function layout(data, t) {
    const widths = new Map();
    const lines = new Map();
    DataModel.allPeople(data).forEach((p) => {
      const l = UiHelpers.personLines(p, t);
      lines.set(p.id, l);
      widths.set(p.id, nodeWidth(l));
    });
    const key = JSON.stringify([
      [...lines.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      DataModel.allUnions(data).map((u) => [u.id, u.partners, u.children, u.status]),
    ]);
    if (layoutCache.key !== key) layoutCache = { key, result: computeLayout(data, widths, lines) };
    return layoutCache.result;
  }

  function computeLayout(data, widths, lines) {

    const gen = computeGenerations(data);
    const fams = buildFamilies(data);
    const personIds = DataModel.allPeople(data).map((p) => p.id);
    const components = connectedComponents(personIds, fams)
      .map((ids) => ids.sort((a, b) => birthOrderCompare(data, a, b)));
    // Biggest part of the tree first, then the rest left to right.
    components.sort((a, b) => b.length - a.length);

    const xAll = new Map();
    const rowItems = new Map();
    const allConns = [];
    const itemInfo = new Map();
    let cursor = 0;
    components.forEach((ids) => {
      const g = buildComponentGraph(data, ids, fams, gen, widths);
      const seqs = orderComponent(data, g);
      const { x, width, adjacentPair } = positionComponent(g, seqs);
      x.forEach((v, id) => xAll.set(id, v + cursor));
      g.items.forEach((it, id) => itemInfo.set(id, it));
      seqs.forEach((seq, r) => {
        if (!rowItems.has(r)) rowItems.set(r, []);
        seq.forEach((id) => rowItems.get(r).push(id));
      });
      g.conns.forEach((c) => { c.adjacent = adjacentPair(c); allConns.push(c); });
      cursor += width + COMPONENT_GAP;
    });

    let maxRow = 0;
    rowItems.forEach((_, r) => { maxRow = Math.max(maxRow, r); });
    const w = (id) => itemInfo.get(id).w;

    // Geometry points of every connector (x only; y comes from lanes).
    const connsByGap = new Map();
    allConns.forEach((c) => {
      if (!connsByGap.has(c.r)) connsByGap.set(c.r, []);
      connsByGap.get(c.r).push(c);
    });
    const gapLevels = new Map();
    connsByGap.forEach((conns, r) => {
      const topPts = [], botPts = [];
      conns.forEach((c, ci) => {
        c.topPts = [];
        c.botPts = [];
        if (c.adjacent) {
          const [a, b] = c.tops;
          const [l, rr] = xAll.get(a) <= xAll.get(b) ? [a, b] : [b, a];
          // Anywhere in the gap between the two boxes works as the drop
          // point; lean toward the children to avoid a needless jog.
          const lo = xAll.get(l) + w(l) / 2 + 4, hi = xAll.get(rr) - w(rr) / 2 - 4;
          const want = c.bottoms.length ? mean(c.bottoms.map((id) => xAll.get(id))) : (lo + hi) / 2;
          c.topPts.push({ x: Math.min(hi, Math.max(lo, want)), mid: true, lo, hi, order: ci });
        } else {
          c.tops.forEach((id) => c.topPts.push({ x: xAll.get(id), id, order: ci }));
        }
        c.bottoms.forEach((id) => c.botPts.push({ x: xAll.get(id), id, order: ci }));
        c.topPts.forEach((p) => topPts.push(p));
        c.botPts.forEach((p) => botPts.push(p));
      });
      // A family with one child and one attachment above needs no
      // horizontal line at all if the two can meet vertically: the drop
      // may attach anywhere along the middle half of a box edge.
      conns.forEach((c) => {
        if (c.topPts.length !== 1 || c.botPts.length !== 1) return;
        const span = (p) => {
          if (p.mid) return [p.lo, p.hi];
          const it = itemInfo.get(p.id);
          return [xAll.get(p.id) - it.w / 4, xAll.get(p.id) + it.w / 4];
        };
        const [t0, t1] = span(c.topPts[0]), [b0, b1] = span(c.botPts[0]);
        const lo = Math.max(t0, b0), hi = Math.min(t1, b1);
        if (lo > hi) return;
        const x = Math.min(hi, Math.max(lo, xAll.get(c.botPts[0].id)));
        c.topPts[0].x = x; c.botPts[0].x = x;
        c.straight = [lo, hi];
      });
      spreadCoincident(topPts);
      spreadCoincident(botPts);
      // A couple's drop point may sit anywhere in the gap between their
      // boxes: move it (together with a straight single-child line) so it
      // doesn't run right beside another family's line in this gap.
      conns.forEach((c) => {
        const p = c.topPts[0];
        if (!p || !p.mid) return;
        const [lo, hi] = c.straight || [p.lo, p.hi];
        const others = [];
        conns.forEach((o) => { if (o !== c) [...o.topPts, ...o.botPts].forEach((q) => others.push(q.x)); });
        const clearance = (x) => others.reduce((m, ox) => Math.min(m, Math.abs(ox - x)), Infinity);
        if (clearance(p.x) >= MIN_LINE_DISTANCE) return;
        let best = p.x, bestScore = -Infinity;
        for (let x = lo; x <= hi + 1e-6; x += 0.5) {
          const score = Math.min(clearance(x), MIN_LINE_DISTANCE) * 1000 - Math.abs(x - p.x);
          if (score > bestScore) { bestScore = score; best = x; }
        }
        p.x = best;
        if (c.straight) c.botPts[0].x = best;
      });
      conns.forEach((c) => { c.topXs = c.topPts.map((p) => p.x); c.botXs = c.botPts.map((p) => p.x); });
      gapLevels.set(r, assignLanes(conns));
    });

    // Row y positions: each gap just tall enough for its lanes.
    const gapHeight = (r) => {
      const L = gapLevels.get(r) || 0;
      return Math.max(MIN_ROW_GAP, 2 * LANE_MARGIN + Math.max(0, L - 1) * LANE_SPACING);
    };
    const rowTop = [0];
    for (let r = 1; r <= maxRow + 1; r += 1) rowTop.push(rowTop[r - 1] + NODE_H + gapHeight(r - 1));
    const laneY = (r, level) => {
      const L = gapLevels.get(r) || 1;
      const h = gapHeight(r);
      return rowTop[r] + NODE_H + (h - (L - 1) * LANE_SPACING) / 2 + level * LANE_SPACING;
    };

    const centers = new Map();
    personIds.forEach((id) => {
      const it = itemInfo.get(id);
      centers.set(id, { x: xAll.get(id), y: rowTop[it.r] + NODE_H / 2 });
    });

    // Links: every drawn line, as axis-aligned segments grouped per family
    // (connectors) or per couple (marriage lines).
    const links = [];
    allConns.forEach((c) => {
      if (c.level === undefined) return;
      const y = laneY(c.r, c.level);
      const segs = [];
      const dashTops = !c.fam.current && !c.adjacent;
      c.topPts.forEach((p) => {
        const y0 = p.mid ? rowTop[c.r] + NODE_H / 2 : rowTop[c.r] + NODE_H;
        segs.push([p.x, y0, p.x, y]);
      });
      if (c.max - c.min > 0.5) segs.push([c.min, y, c.max, y]);
      c.botPts.forEach((p) => {
        const dummy = itemInfo.get(p.id).kind === 'dummy';
        segs.push([p.x, y, p.x, rowTop[c.r + 1] + (dummy ? NODE_H : 0)]);
      });
      const pair = c.fam.partners.length === 2 ? `m:${[...c.fam.partners].sort().join('|')}` : c.fam.id;
      const people = [...c.fam.partners, ...c.fam.kids];
      links.push({ group: c.fam.id, pair, people, kind: 'family', dashed: false, segs: dashTops ? segs.slice(c.topPts.length) : segs });
      if (dashTops) links.push({ group: c.fam.id, pair, people, kind: 'family', dashed: true, segs: segs.slice(0, c.topPts.length) });
    });

    // Marriage lines between partners standing side by side (one line per
    // couple, even if they have several unions); partners in different
    // rows get a direct line between their boxes.
    const seenPairs = new Map();
    fams.forEach((f) => {
      if (f.partners.length !== 2) return;
      const [a, b] = f.partners;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entry = seenPairs.get(key);
      if (entry) { if (f.current) entry.dashed = false; return; }
      const ca = centers.get(a), cb = centers.get(b);
      if (ca.y === cb.y) {
        const seq = rowItems.get(itemInfo.get(a).r);
        if (Math.abs(seq.indexOf(a) - seq.indexOf(b)) !== 1) return;
        const [l, r] = ca.x <= cb.x ? [a, b] : [b, a];
        const y = ca.y;
        const link = { group: `m:${key}`, people: [a, b], kind: 'marriage', dashed: !f.current, segs: [[centers.get(l).x + widths.get(l) / 2, y, centers.get(r).x - widths.get(r) / 2, y]] };
        seenPairs.set(key, link);
        links.push(link);
      } else {
        const [hi, lo] = ca.y < cb.y ? [a, b] : [b, a];
        const ch = centers.get(hi), cl = centers.get(lo);
        const link = { group: `m:${key}`, people: [a, b], kind: 'marriage', dashed: !f.current, segs: [[ch.x, ch.y + NODE_H / 2, cl.x, cl.y - NODE_H / 2]] };
        seenPairs.set(key, link);
        links.push(link);
      }
    });

    const crossings = markCrossings(links);

    let totalWidth = 0;
    xAll.forEach((v, id) => { totalWidth = Math.max(totalWidth, v + w(id) / 2); });
    const totalHeight = rowTop[maxRow] + NODE_H + (gapLevels.has(maxRow) ? gapHeight(maxRow) : 0);
    return { centers, widths, lines, maxGen: maxRow, totalWidth, totalHeight, links, crossings };
  }

  function render(container) {
    const t = App.t;
    const { data: fullData } = App.getState();

    // Person ids that no longer exist (deleted since last time) shouldn't
    // linger in the hidden list forever.
    const hiddenIds = new Set((fullData.treeViewHiddenPeople || []).filter((id) => fullData.people[id]));
    if (hiddenIds.size !== (fullData.treeViewHiddenPeople || []).length) {
      fullData.treeViewHiddenPeople = [...hiddenIds];
      App.markDirty(true);
    }

    const data = buildVisibleData(fullData, hiddenIds);

    container.innerHTML = `
      <div class="view-header">
        <h2>${t('tree.heading')}</h2>
        ${UiHelpers.printButtonHtml(t)}
      </div>
      <div class="tree-toolbar no-print">
        <button type="button" class="icon-btn" id="zoom-in" title="${t('tree.zoomIn')}" aria-label="${t('tree.zoomIn')}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button type="button" class="icon-btn" id="zoom-out" title="${t('tree.zoomOut')}" aria-label="${t('tree.zoomOut')}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button type="button" class="icon-btn" id="reset-view" title="${t('tree.resetView')}" aria-label="${t('tree.resetView')}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 9V4h5"/>
            <path d="M15 4h5v5"/>
            <path d="M20 15v5h-5"/>
            <path d="M9 20H4v-5"/>
          </svg>
        </button>
        <button class="btn btn--small" id="btn-filter">${t('tree.filterPeople')}</button>
        ${hiddenIds.size > 0 ? `<span class="filter-toolbar-hint">${t('tree.filterActiveHint', { count: hiddenIds.size })}</span>` : ''}
      </div>
      <div class="tree-canvas-wrap" id="tree-wrap">
        <svg id="tree-svg" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
      <p class="tree-hint no-print">${t('tree.hint')}</p>`;

    container.querySelector('#btn-filter').onclick = () => openFilterModal(fullData, hiddenIds);

    const people = DataModel.allPeople(data);
    if (people.length === 0) {
      const emptyMsg = hiddenIds.size > 0 ? t('tree.emptyFiltered') : t('tree.empty');
      container.querySelector('#tree-wrap').outerHTML = `<p class="empty-note">${emptyMsg}</p>`;
      return;
    }

    const { centers, widths, lines, totalWidth, totalHeight, links } = layout(data, t);
    const svg = container.querySelector('#tree-svg');

    const r1 = (v) => Math.round(v * 10) / 10;
    const pathD = (segs) => segs.map(([x1, y1, x2, y2]) => `M${r1(x1)},${r1(y1)} L${r1(x2)},${r1(y2)}`).join(' ');
    const linksHtml = links.map((link, i) => `<path class="tree-link" data-link="${i}" d="${pathD(link.segs)}"${link.dashed ? ' stroke-dasharray="4,3"' : ''}/>`);
    // Invisible, wider copies of every line so thin lines are easy to point at.
    const hitHtml = links.map((link, i) => `<path class="tree-link-hit" data-link="${i}" d="${pathD(link.rawSegs || link.segs)}"/>`);

    const photoR = PHOTO_D / 2;
    const nodesHtml = people.map((p) => {
      const c = centers.get(p.id);
      if (!c) return '';
      const w = widths.get(p.id);
      const nodeLines = lines.get(p.id);
      const x = c.x - w / 2, y = c.y - NODE_H / 2;

      const photoCx = PAD + photoR, photoCy = NODE_H / 2;
      const noPhotoWords = t('person.noPhoto').split(' ');
      const photoHtml = p.photo
        ? `<image href="${p.photo}" x="${photoCx - photoR}" y="${photoCy - photoR}" width="${PHOTO_D}" height="${PHOTO_D}" clip-path="url(#tree-photo-clip)" preserveAspectRatio="xMidYMid slice"/>`
        : `<text class="tree-photo-label" x="${photoCx}" y="${photoCy - 3}" text-anchor="middle">${UiHelpers.escapeHtml(noPhotoWords[0] || '')}</text>
           <text class="tree-photo-label" x="${photoCx}" y="${photoCy + 9}" text-anchor="middle">${UiHelpers.escapeHtml(noPhotoWords.slice(1).join(' '))}</text>`;

      const textX = PAD + PHOTO_D + GAP;
      const lineHeight = 16;
      const blockH = nodeLines.length * lineHeight;
      const firstBaseline = (NODE_H - blockH) / 2 + lineHeight * 0.75;
      const textLines = nodeLines.map((line, i) => {
        const cls = i === 0 ? 'tree-node-name' : 'tree-node-meta';
        return `<text class="${cls}" x="${textX}" y="${firstBaseline + i * lineHeight}">${UiHelpers.escapeHtml(line)}</text>`;
      }).join('');

      return `<g class="tree-node" data-person="${p.id}" transform="translate(${x},${y})" style="cursor:pointer">
        <rect class="tree-node-frame" width="${w}" height="${NODE_H}" rx="10"></rect>
        <circle class="tree-node-photo-bg" cx="${photoCx}" cy="${photoCy}" r="${photoR}"></circle>
        ${photoHtml}
        ${textLines}
      </g>`;
    }).join('');

    // A small margin around the drawing: box outlines and lines are centered
    // on their edges, so without it the outermost ones would be half clipped
    // (most visibly in print/PDF, where nothing can be panned into view).
    const m = VIEW_MARGIN;
    svg.setAttribute('viewBox', `${-m} ${-m} ${Math.max(totalWidth, 400) + 2 * m} ${Math.max(totalHeight, 300) + 2 * m}`);
    svg.innerHTML = `
      <defs><clipPath id="tree-photo-clip"><circle cx="${photoR}" cy="${photoR}" r="${photoR}" transform="translate(${PAD},${NODE_H / 2 - photoR})"/></clipPath></defs>
      <g id="tree-viewport">${linksHtml.join('')}${hitHtml.join('')}${nodesHtml}</g>`;

    svg.querySelectorAll('[data-person]').forEach((node) => {
      node.onclick = () => { if (!dragMoved) App.setFocusedPerson(node.dataset.person); };
    });
    const clearHighlight = wireHighlighting(svg, links);

    const wrap = container.querySelector('#tree-wrap');
    applyTransform(svg);
    wireInteraction(wrap, svg);

    container.querySelector('#zoom-in').onclick = () => { transform.scale = Math.min(3, transform.scale * 1.2); applyTransform(svg); };
    container.querySelector('#zoom-out').onclick = () => { transform.scale = Math.max(0.2, transform.scale / 1.2); applyTransform(svg); };
    container.querySelector('#reset-view').onclick = () => { transform = { x: 40, y: 40, scale: 1 }; applyTransform(svg); };
    // The print stylesheet ignores the on-screen pan/zoom (css/print.css),
    // so printing shows the whole tree whether started here or with Ctrl/Cmd+P.
    container.querySelector('#btn-print').onclick = () => {
      clearHighlight();
      window.print();
    };
  }

  // A large or heavily-blended tree can still be hard to read even with
  // correct layout — sometimes the real fix is showing fewer people. This
  // lets anyone be hidden from the Full Tree view specifically (the
  // selection lives in data.treeViewHiddenPeople, so it's saved with the
  // file and travels with it, but doesn't affect any other view).
  function openFilterModal(fullData, hiddenIds) {
    const t = App.t;
    const people = DataModel.allPeople(fullData).slice()
      .sort((a, b) => (DataModel.fullName(a) || '').localeCompare(DataModel.fullName(b) || ''));

    App.openModal((box) => {
      box.innerHTML = `
        <h3>${t('tree.filterModalTitle')}</h3>
        <input type="text" class="filter-search" id="filter-search" placeholder="${t('tree.filterSearch')}" autocomplete="off">
        <div class="filter-bulk-actions">
          <button type="button" class="btn btn--small" id="filter-select-all">${t('tree.selectAll')}</button>
          <button type="button" class="btn btn--small" id="filter-deselect-all">${t('tree.deselectAll')}</button>
        </div>
        <ul class="filter-person-list" id="filter-person-list">
          ${people.map((p) => `
            <li data-name="${UiHelpers.escapeHtml((DataModel.fullName(p) || '').toLowerCase())}">
              <label>
                <input type="checkbox" data-person-id="${p.id}" ${hiddenIds.has(p.id) ? '' : 'checked'}>
                <span>${UiHelpers.escapeHtml(DataModel.fullName(p) || t('person.unnamed'))}</span>
                <span class="filter-person-meta">${UiHelpers.escapeHtml(UiHelpers.lifespanLabel(p, t))}</span>
              </label>
            </li>`).join('')}
        </ul>
        <div class="modal-actions">
          <button type="button" class="btn" id="filter-cancel">${t('actions.cancel')}</button>
          <button type="button" class="btn btn--primary" id="filter-apply">${t('actions.confirm')}</button>
        </div>`;

      const searchInput = box.querySelector('#filter-search');
      searchInput.oninput = () => {
        const q = searchInput.value.trim().toLowerCase();
        box.querySelectorAll('#filter-person-list li').forEach((li) => {
          li.classList.toggle('filter-hidden-row', !!q && !li.dataset.name.includes(q));
        });
      };
      box.querySelector('#filter-select-all').onclick = () => {
        box.querySelectorAll('#filter-person-list input[type="checkbox"]').forEach((cb) => { cb.checked = true; });
      };
      box.querySelector('#filter-deselect-all').onclick = () => {
        box.querySelectorAll('#filter-person-list input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
      };
      box.querySelector('#filter-cancel').onclick = () => App.closeModal();
      box.querySelector('#filter-apply').onclick = () => {
        const nowHidden = [];
        box.querySelectorAll('#filter-person-list input[type="checkbox"]').forEach((cb) => {
          if (!cb.checked) nowHidden.push(cb.dataset.personId);
        });
        fullData.treeViewHiddenPeople = nowHidden;
        App.markDirty(true);
        App.closeModal();
        App.rerender();
      };
    });
  }

  function applyTransform(svg) {
    const g = svg.querySelector('#tree-viewport');
    if (g) g.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.scale})`);
  }

  // Pointing at a person lights up every line of their families (as a child
  // and as a partner); pointing at a line lights up that family — for a
  // marriage line, the couple and all their children's lines — and fades
  // everything else. Clicking a line keeps its highlight until that line
  // or empty canvas is clicked again. Returns a function that clears it.
  function wireHighlighting(svg, links) {
    const linkEls = [...svg.querySelectorAll('.tree-link')];
    const nodeEls = [...svg.querySelectorAll('[data-person]')];
    const collect = (match) => {
      const idx = new Set(), people = new Set();
      links.forEach((l, j) => { if (match(l)) { idx.add(j); l.people.forEach((p) => people.add(p)); } });
      return { idx, people };
    };
    const forLink = (i) => {
      const l = links[i];
      const couple = l.kind === 'marriage' ? l.group : l.pair;
      return collect((o) => o.group === l.group || o.group === couple || o.pair === couple);
    };
    const forPerson = (id) => {
      const sel = collect((o) => o.people.includes(id));
      sel.people.add(id);
      return sel;
    };
    let pinned = null;
    const show = (sel) => {
      svg.classList.toggle('is-highlighting', !!sel);
      linkEls.forEach((el) => el.classList.toggle('is-hl', !!sel && sel.idx.has(+el.dataset.link)));
      nodeEls.forEach((el) => el.classList.toggle('is-hl', !!sel && sel.people.has(el.dataset.person)));
    };
    const restore = () => show(pinned && pinned.sel);
    nodeEls.forEach((el) => {
      el.onmouseenter = () => { if (!dragState) show(forPerson(el.dataset.person)); };
      el.onmouseleave = restore;
    });
    svg.querySelectorAll('.tree-link-hit').forEach((el) => {
      const i = +el.dataset.link;
      el.onmouseenter = () => { if (!dragState) show(forLink(i)); };
      el.onmouseleave = restore;
      el.onclick = (e) => {
        e.stopPropagation();
        if (dragMoved) return;
        const key = links[i].kind === 'marriage' ? links[i].group : links[i].pair;
        pinned = pinned && pinned.key === key ? null : { key, sel: forLink(i) };
        restore();
      };
    });
    svg.onclick = (e) => {
      if (dragMoved || e.target.closest('[data-person]')) return;
      pinned = null;
      restore();
    };
    return () => { pinned = null; restore(); };
  }

  function wireInteraction(wrap, svg) {
    if (onMouseMove) window.removeEventListener('mousemove', onMouseMove);
    if (onMouseUp) window.removeEventListener('mouseup', onMouseUp);

    wrap.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      transform.scale = Math.min(3, Math.max(0.2, transform.scale * delta));
      applyTransform(svg);
    };
    // Pan by dragging. The drawing is scaled to fit the canvas (its viewBox),
    // so a mouse move in screen pixels is converted to drawing units —
    // otherwise a wide tree would crawl along at a fraction of the cursor's
    // speed. preventDefault stops the browser from selecting names while
    // dragging (clicks on people and lines still fire normally).
    let frame = null;
    wrap.onmousedown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const ctm = svg.getScreenCTM();
      dragState = {
        startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y,
        unitsPerPx: ctm && ctm.a ? 1 / ctm.a : 1,
      };
      dragMoved = false;
      wrap.classList.add('dragging');
    };
    onMouseMove = (e) => {
      if (!dragState) return;
      // A click that ends a drag isn't a click on whatever is under the
      // pointer (e.g. it mustn't open a person or pin a highlight).
      if (Math.abs(e.clientX - dragState.startX) + Math.abs(e.clientY - dragState.startY) > 4) dragMoved = true;
      transform.x = dragState.origX + (e.clientX - dragState.startX) * dragState.unitsPerPx;
      transform.y = dragState.origY + (e.clientY - dragState.startY) * dragState.unitsPerPx;
      if (!frame) frame = requestAnimationFrame(() => { frame = null; applyTransform(svg); });
    };
    onMouseUp = () => {
      dragState = null;
      wrap.classList.remove('dragging');
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  return { render, computeGenerations, layout };
})();

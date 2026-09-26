// Full family tree: a generation-layered layout rendered as plain SVG
// (rect/circle/text — no HTML foreignObject), with mouse-drag pan and
// wheel/button zoom. Built in-house (no vendored charting library) so the
// app has zero runtime dependency risk and the generation layout can
// special-case remarriage/half-sibling data cleanly.
//
// Plain SVG primitives instead of foreignObject+HTML/CSS for two reasons:
// Chrome's print/PDF pipeline can silently drop CSS borders on HTML content
// inside foreignObject (renders fine on screen, vanishes in the PDF), and
// native SVG shapes always print reliably. Node height is a fixed constant
// (not content-driven) so two partners' centers always line up and the
// connecting line stays perfectly horizontal — width is what flexes to fit
// each name, with per-row packing so widening a node never overlaps its
// neighbors.
//
// (A cytoscape.js + HTML-card rendering was tried and reverted — it looked
// worse on screen and only added a vendored runtime dependency for no real
// layout benefit; the generation/clustering logic below is what actually
// matters and works the same either way.)
const ViewTree = (() => {
  const PHOTO_D = 44, PAD = 12, GAP = 10, NODE_H = 72;
  const ROW_GAP = 70;
  const MIN_TEXT_W = 90, TEXT_BUFFER = 10;
  // Horizontal gap between two adjacent people depends on how they relate —
  // partners sit almost touching, siblings a bit further apart, and two
  // unconnected family branches get real breathing room — rather than one
  // fixed distance applied everywhere regardless of whether that space is
  // actually needed (see gapBetween below).
  const PARTNER_GAP = 16, SIBLING_GAP = 30, FAMILY_GAP = 64;
  let transform = { x: 40, y: 40, scale: 1 };
  let dragState = null;
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

  // Two married partners should land on the same generation whenever
  // possible — not only when one of them has literally no recorded
  // parents. Real trees regularly have one side's ancestry recorded less
  // deep than the other (grandparents never entered, a branch just not
  // researched as far back) even though both people themselves have
  // parents on file; blood generation alone would still show them a row
  // apart with a diagonal marriage connector.
  //
  // Critically, when the person who needs to move deeper HAS recorded
  // parents, the fix is to push those PARENTS deeper (by however much is
  // needed) rather than pulling just that one person away from their own
  // family — otherwise they end up split from their own siblings, who
  // stay behind at the shallower generation. Pushing the parents down
  // cascades to every sibling via the child-must-be-below-parents rule
  // below, so the whole family block moves together and stays intact.
  // Only someone with NO recorded parents (nothing to push instead) is
  // moved directly. Both rules repeat to a fixpoint, since one marriage's
  // adjustment can ripple through several more.
  function computeGenerations(data) {
    const people = DataModel.allPeople(data);
    const gen = new Map();

    function bloodGen(id, visiting) {
      if (gen.has(id)) return gen.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const parents = DataModel.getParents(data, id);
      const g = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((p) => bloodGen(p.id, visiting)));
      gen.set(id, g);
      return g;
    }
    people.forEach((p) => bloodGen(p.id, new Set()));

    let changed = true;
    let guard = 0;
    while (changed && guard < people.length + 8) {
      changed = false;
      guard += 1;
      people.forEach((p) => {
        let maxPartnerGen = null;
        DataModel.unionsAsPartner(data, p.id).forEach((u) => {
          const otherId = DataModel.otherPartner(u, p.id);
          if (otherId && gen.has(otherId)) {
            maxPartnerGen = maxPartnerGen === null ? gen.get(otherId) : Math.max(maxPartnerGen, gen.get(otherId));
          }
        });
        if (maxPartnerGen === null || maxPartnerGen <= gen.get(p.id)) return;
        const parents = DataModel.getParents(data, p.id);
        if (parents.length === 0) {
          gen.set(p.id, maxPartnerGen);
          changed = true;
          return;
        }
        // Raise each parent to AT LEAST what's needed for p to reach
        // maxPartnerGen once cascaded (never lower it) — using max here
        // rather than adding a fixed delta keeps this safe to apply
        // redundantly when more than one sibling pulls on the same
        // parents in the same pass.
        parents.forEach((par) => {
          if (gen.get(par.id) < maxPartnerGen - 1) {
            gen.set(par.id, maxPartnerGen - 1);
            changed = true;
          }
        });
      });
      people.forEach((p) => {
        const parents = DataModel.getParents(data, p.id);
        if (parents.length === 0) return;
        const required = 1 + Math.max(...parents.map((par) => gen.get(par.id)));
        if (required > gen.get(p.id)) {
          gen.set(p.id, required);
          changed = true;
        }
      });
      // Closes any gap the pushes above just opened one level higher: a
      // person pushed deeper (to match a spouse) drags only their DIRECT
      // parents down with them (the block above) — if those parents
      // themselves have recorded parents, THOSE grandparents never get
      // pushed by anything, since the couple they're pushed to match
      // (e.g. two spouses becoming co-parents of the same child) are
      // moved together and never end up individually "behind" each
      // other, so the spousal-mismatch check that would normally trigger
      // a further push never fires again past that point. Left alone,
      // that strands the deeper ancestors 2+ rows above their own
      // descendant instead of the usual 1, and — worse — leaves two
      // recorded-ancestor couples who are meant to be exact generational
      // peers (e.g. two sets of grandparents on either side of the same
      // marriage) sitting at DIFFERENT rows, purely because only one
      // side's chain happened to get a push. Re-checking every parent
      // link on every iteration, to the same fixpoint as everything
      // else, recurses this closure arbitrarily far up any ancestor
      // chain, however deep.
      people.forEach((p) => {
        const parents = DataModel.getParents(data, p.id);
        parents.forEach((par) => {
          if (gen.get(p.id) - 1 > gen.get(par.id)) {
            gen.set(par.id, gen.get(p.id) - 1);
            changed = true;
          }
        });
      });
    }
    return gen;
  }

  // Groups a generation's people into sibling clusters: connected
  // components of the "shares at least one parent" graph. This is NOT the
  // same as grouping by union — two children from DIFFERENT unions that
  // share one parent (half-siblings, e.g. a parent's kids from two
  // relationships) still belong in the same visual group, or they'd be
  // scattered based on nothing more than which union happened to be
  // created first, splitting a couple's parents' descendants across the
  // row and forcing their connector lines to cross everyone else's.
  function clusterSiblings(data, gen, g) {
    const idsAtG = DataModel.allPeople(data).filter((p) => gen.get(p.id) === g).map((p) => p.id);
    const idSet = new Set(idsAtG);
    const adjacency = new Map(idsAtG.map((id) => [id, new Set()]));
    const childrenByParent = new Map();
    DataModel.allUnions(data).forEach((u) => {
      const kids = u.children.filter((c) => idSet.has(c));
      if (kids.length === 0) return;
      u.partners.forEach((pid) => {
        if (!childrenByParent.has(pid)) childrenByParent.set(pid, new Set());
        kids.forEach((k) => childrenByParent.get(pid).add(k));
      });
    });
    childrenByParent.forEach((kidsSet) => {
      const kids = [...kidsSet];
      for (let i = 1; i < kids.length; i += 1) {
        adjacency.get(kids[0]).add(kids[i]);
        adjacency.get(kids[i]).add(kids[0]);
      }
    });
    const visited = new Set();
    const clusters = [];
    idsAtG.forEach((start) => {
      if (visited.has(start)) return;
      const comp = [];
      const queue = [start];
      visited.add(start);
      while (queue.length) {
        const cur = queue.shift();
        comp.push(cur);
        adjacency.get(cur).forEach((n) => { if (!visited.has(n)) { visited.add(n); queue.push(n); } });
      }
      clusters.push(comp);
    });
    return clusters;
  }

  function birthOrderCompare(data, a, b) {
    const pa = DataModel.getPerson(data, a), pb = DataModel.getPerson(data, b);
    const ca = DataModel.dateToComparable(pa.birthDate);
    const cb = DataModel.dateToComparable(pb.birthDate);
    if (ca !== null && cb !== null) return ca - cb;
    if (ca !== null) return -1;
    if (cb !== null) return 1;
    return (DataModel.fullName(pa) || '').localeCompare(DataModel.fullName(pb) || '');
  }

  function nameKeyOf(data, personId) {
    return DataModel.fullName(DataModel.getPerson(data, personId)) || '';
  }

  // ---- Ordering (step 2: decide left-to-right SEQUENCE, ignoring pixel
  // widths entirely) ------------------------------------------------------
  //
  // Every row is built from "clusters" (blood-sibling groups — see
  // clusterSiblings) chained together wherever a marriage links two
  // clusters, so partners always end up adjacent and a person married into
  // two same-generation spouses (current + former) lands strictly between
  // them (see buildChain). The one open question is which END of each
  // chain faces left and which chain comes before which other chain in the
  // row — decided by RANK: each cluster's rank is the average row-position
  // of whichever neighboring row (above or below) is currently fixed.
  //
  // A single top-down pass (rank from the row above only) cannot avoid
  // crossing connectors to the row BELOW, since that row doesn't have an
  // order yet. The reverse (bottom-up only) has the same problem the other
  // direction. So this alternates: a full top-down sweep (each row ranked
  // by the row above, already fixed), then a full bottom-up sweep (each
  // row ranked by the row below, just fixed by the sweep before it),
  // repeated a handful of times. This is the standard "barycenter" method
  // for ordering a layered graph to minimize crossings — deliberately kept
  // to PURE RANK (an integer position within a row), never a pixel
  // coordinate: an earlier version of this algorithm fed real pixel
  // positions back into ordering decisions and produced a genuine
  // two-state oscillation that never settled (a couple's left-right order
  // flipping every single pass, forever) — pixel position depends on text
  // width and a dozen unrelated things that have nothing to do with a
  // discrete left-right choice. Rank has none of that noise, and each
  // sweep direction only ever reads a neighbor that was JUST fixed a
  // moment ago in the same round, not a stale, several-steps-removed
  // result — which is what actually converges.
  //
  // Order, once this settles, is never revisited — positioning (step 3,
  // further down) only ever reserves width and nudges pixel centers within
  // an already-fixed sequence, never reorders anything. That one-way rule
  // is what keeps positioning's inherent messiness (text width, minimum
  // gaps) from ever leaking back into this discrete decision.

  function buildClusters(data, gen, maxGen) {
    const clustersByGen = new Map();
    for (let g = 0; g <= maxGen; g += 1) {
      clustersByGen.set(g, clusterSiblings(data, gen, g).map((members) => ({ members: [...members] })));
    }
    return clustersByGen;
  }

  function buildClusterOf(clustersByGen) {
    const clusterOf = new Map();
    clustersByGen.forEach((clusters) => {
      clusters.forEach((c) => c.members.forEach((m) => clusterOf.set(m, c)));
    });
    return clusterOf;
  }

  // Only same-generation marriages participate in row ordering — a couple
  // split across generations (rare; already given its own diagonal
  // connector by the renderer) has no "adjacent in the row" to optimize.
  function buildSpouseEdges(data, gen) {
    const edges = new Map();
    DataModel.allUnions(data).forEach((u) => {
      if (u.partners.length !== 2) return;
      const [a, b] = u.partners;
      if (gen.get(a) === undefined || gen.get(a) !== gen.get(b)) return;
      if (!edges.has(a)) edges.set(a, new Set());
      if (!edges.has(b)) edges.set(b, new Set());
      edges.get(a).add(b);
      edges.get(b).add(a);
    });
    return edges;
  }

  // Union-find: groups a row's clusters into connected components of the
  // "linked by at least one marriage" graph. Most groups are a single
  // cluster (no cross-family marriage) or a simple pair; chains/branches
  // (blended families with several intermarried branches, or someone with
  // a current AND a former same-generation spouse) fall out of the same
  // union-find naturally — there's no separate "simple couple" special
  // case, a lone person with no siblings is just a cluster of size one,
  // chained exactly like any other.
  function groupClustersByMarriage(clusters, spouseEdges) {
    const parent = clusters.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (i, j) => { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; };
    const clusterIndexOfMember = new Map();
    clusters.forEach((c, i) => c.members.forEach((m) => clusterIndexOfMember.set(m, i)));
    clusters.forEach((c, i) => {
      c.members.forEach((m) => {
        const spouses = spouseEdges.get(m);
        if (!spouses) return;
        spouses.forEach((sp) => {
          const j = clusterIndexOfMember.get(sp);
          if (j !== undefined) union(i, j);
        });
      });
    });
    const groupsByRoot = new Map();
    clusters.forEach((c, i) => {
      const r = find(i);
      if (!groupsByRoot.has(r)) groupsByRoot.set(r, []);
      groupsByRoot.get(r).push(c);
    });
    return [...groupsByRoot.values()];
  }

  // A cluster's rank as seen from one specific neighboring row: the
  // average rank (NOT pixel position — see the file-level comment above)
  // of whichever specific people are actually related across that row
  // boundary. `personRank` is that neighbor row's current Map<personId,
  // rank>; `relatedIds` picks out parents (rank from above) or children
  // (rank from below) of this cluster's own members.
  function clusterRank(cluster, personRank, relatedIdsOf) {
    if (!personRank) return null;
    const ids = new Set();
    cluster.members.forEach((m) => relatedIdsOf(m).forEach((id) => ids.add(id)));
    const ranks = [...ids].map((id) => personRank.get(id)).filter((v) => v !== undefined);
    return ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
  }

  function parentIdsOf(data, personId) {
    return DataModel.getParents(data, personId).map((p) => p.id);
  }
  function childIdsOf(data, personId) {
    return DataModel.getChildren(data, personId).map((c) => c.id);
  }

  // Lays a marriage-linked group's clusters out as a chain by walking the
  // marriage graph breadth-first from whichever cluster ranks lowest
  // (deterministic, and tends to start from a natural "end" of the chain).
  // A simple pair (by far the most common case) always yields the two
  // clusters adjacent; branching/blended cases fall back to a reasonable
  // traversal order rather than a guaranteed-optimal one — true
  // minimum-crossing arrangement of an arbitrary graph is a much bigger
  // problem than the marriages this app models tend to pose.
  // `prevRank` (this row's rank map from immediately before this call) is
  // the same tie-break-of-second-resort used in sortBlocks, and for the
  // exact same reason: two spouses' rank-from-below ties whenever they
  // share a child (the ordinary case), and falling straight to name would
  // let a bottom-up sweep with nothing to say flip a couple's left-right
  // order back and forth against whatever the top-down sweep, moments
  // earlier in the very same round, had just decided from their own
  // (necessarily different) individual ancestors.
  function buildChain(data, groupClusters, spouseEdges, rankOf, prevRank) {
    if (groupClusters.length === 1) return groupClusters;
    const adjacency = groupClusters.map(() => new Set());
    groupClusters.forEach((c, i) => {
      c.members.forEach((m) => {
        const spouses = spouseEdges.get(m);
        if (!spouses) return;
        spouses.forEach((sp) => {
          groupClusters.forEach((c2, j) => {
            if (j !== i && c2.members.includes(sp)) { adjacency[i].add(j); adjacency[j].add(i); }
          });
        });
      });
    });
    // A cluster with no signal at all this direction (e.g. a leaf with no
    // children of its own, during a bottom-up sweep) must never be
    // compared on this scale against a SIBLING cluster that DOES have
    // one — Infinity vs. a real number isn't "no information," it's "you
    // lose, unconditionally," shoving that cluster to whichever end
    // Infinity sorts toward regardless of where it actually belongs. If
    // even one cluster in this group lacks a rank this direction, treat
    // the WHOLE group as unranked and fall through to the stability
    // tie-break instead — the same "don't mix scales" rule the row-level
    // sort below applies for the identical reason.
    const allRanked = groupClusters.every((c) => rankOf(c) !== null);
    const sortKey = (i) => [
      (allRanked ? rankOf(groupClusters[i]) : null) ?? Infinity,
      prevRank ? (prevRank.get(groupClusters[i].members[0]) ?? Infinity) : Infinity,
      nameKeyOf(data, groupClusters[i].members[0]),
    ];
    const byKey = (a, b) => {
      const ka = sortKey(a), kb = sortKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return ka[2].localeCompare(kb[2]);
    };

    // A cluster married to two others WITHIN THIS GROUP (e.g. one partner
    // with two same-generation spouses of their own, current and former)
    // must end up strictly between them: marriage lines are drawn
    // straight between each union's own two partners, so putting a
    // twice-linked cluster at an edge instead forces one of its two
    // marriage lines straight through whichever cluster actually sits at
    // that edge. Walking breadth-first from whichever cluster ranks
    // lowest doesn't guarantee this — if the twice-linked cluster itself
    // happens to sort first, BFS emits it first (an edge), not the
    // middle. When the marriage graph here is a simple path (every
    // cluster linked to at most 2 others in this group, exactly two
    // clusters linked to just 1 — the two ends), walking end-to-end
    // instead guarantees correct middle placement regardless of rank.
    const degree = groupClusters.map((_, i) => adjacency[i].size);
    const ends = groupClusters.map((_, i) => i).filter((i) => degree[i] <= 1);
    if (ends.length === 2 && degree.every((d) => d <= 2)) {
      const start = ends.slice().sort(byKey)[0];
      const order = [start];
      const visited = new Set([start]);
      let cur = start;
      for (;;) {
        const next = [...adjacency[cur]].find((j) => !visited.has(j));
        if (next === undefined) break;
        visited.add(next);
        order.push(next);
        cur = next;
      }
      return order.map((i) => groupClusters[i]);
    }

    // Anything else (a cluster linked to 3+ others, or a marriage cycle —
    // both rare) falls back to a reasonable BFS traversal rather than a
    // guaranteed-optimal one — true minimum-crossing arrangement of an
    // arbitrary graph is a much bigger problem than the marriages this
    // app models tend to pose, and a straight-line renderer can't fully
    // avoid overlap for a cluster linked to 3+ others in one row anyway.
    const indices = groupClusters.map((_, i) => i).sort(byKey);
    const start = indices[0];
    const visited = new Set([start]);
    const order = [start];
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const neighbors = [...adjacency[cur]].filter((j) => !visited.has(j)).sort(byKey);
      neighbors.forEach((j) => { visited.add(j); order.push(j); queue.push(j); });
    }
    // Safety net: a cluster the walk never reached (only possible for a
    // disconnected marriage sub-graph, which union-find already rules out)
    // still needs to appear somewhere.
    groupClusters.forEach((c, i) => { if (!visited.has(i)) { visited.add(i); order.push(i); } });
    return order.map((i) => groupClusters[i]);
  }

  // A bare partner — no recorded ancestors, exactly one same-generation
  // marriage — contributes nothing a real chain slot needs: no parents to
  // rank against the row above, and (since they share every child with
  // whichever family member they married) no rank lost from the row below
  // either — that member's own childIdsOf already returns the identical
  // set (see clusterRank). The only real requirement is sitting directly
  // beside that one person. Pulling every such partner out of the
  // marriage graph before grouping/buildChain runs is what fixes a
  // cluster connected to 3+ others (see buildChain's "anything else"
  // fallback above) for the ordinary case that causes it — 3+ married
  // siblings, or one person married more than twice — without touching
  // any cluster whose degree was already ≤2 (every case that already
  // renders correctly today is completely untouched: the gate below only
  // fires once a cluster's connections exceed what a 2-ended chain can
  // hold).
  //
  // Two things are deliberately NOT covered, matching buildChain's own
  // existing best-effort fallback for the same reason: a mutual pair of
  // two bare partners marrying each other (already a plain, working
  // two-cluster chain) is left alone rather than extracting both and
  // leaving no anchor to dock either onto; and a person with 3+ marriages
  // of their own can only ever have 2 true neighbors in a single row no
  // matter what's done here, so none of THEIR marriages are touched —
  // half-solving an inherently unsolvable case would just trade one bad
  // arrangement for another.
  function classifySatellites(data, clusters, spouseEdges) {
    const clusterIndexOfMember = new Map();
    clusters.forEach((c, i) => c.members.forEach((m) => clusterIndexOfMember.set(m, i)));
    const adjacency = clusters.map(() => new Set());
    clusters.forEach((c, i) => {
      c.members.forEach((m) => {
        const spouses = spouseEdges.get(m);
        if (!spouses) return;
        spouses.forEach((sp) => {
          const j = clusterIndexOfMember.get(sp);
          if (j !== undefined && j !== i) { adjacency[i].add(j); adjacency[j].add(i); }
        });
      });
    });
    const isBare = clusters.map((c, i) => c.members.length === 1
      && parentIdsOf(data, c.members[0]).length === 0
      && adjacency[i].size === 1);

    const satelliteClusterIndexes = new Set();
    const satellitesByMember = new Map();
    clusters.forEach((c, i) => {
      if (!isBare[i]) return;
      const [j] = [...adjacency[i]];
      if (isBare[j] || adjacency[j].size < 3) return;
      const m = c.members[0];
      const partnerId = [...spouseEdges.get(m)].find((sp) => clusterIndexOfMember.get(sp) === j);
      if (partnerId === undefined || spouseEdges.get(partnerId).size > 2) return;
      satelliteClusterIndexes.add(i);
      if (!satellitesByMember.has(partnerId)) satellitesByMember.set(partnerId, []);
      satellitesByMember.get(partnerId).push(m);
    });

    return {
      structuralClusters: clusters.filter((c, i) => !satelliteClusterIndexes.has(i)),
      satellitesByMember,
    };
  }

  // Splices a member's own bare satellite partner(s) — see
  // classifySatellites — immediately beside them: after a lead member
  // (whose OTHER side is the real chain neighbor), before a trail member,
  // and sandwiched one-per-side for a plain member with two, so the
  // couple stays adjacent without needing a whole extra chain slot for a
  // partner with no family of their own to place.
  function spliceSatellites(members, leadMember, trailMember, satellitesByMember) {
    const out = [];
    members.forEach((m) => {
      const sats = satellitesByMember.get(m) || [];
      if (!sats.length) { out.push(m); return; }
      if (m === leadMember) { out.push(m, ...sats); return; }
      if (m === trailMember) { out.push(...sats, m); return; }
      if (sats.length >= 2) { out.push(sats[0], m, ...sats.slice(1)); return; }
      out.push(m, ...sats);
    });
    return out;
  }

  // Within one cluster, moves whichever member is married into the
  // PREVIOUS cluster (in the group's finalized chain order) to this
  // cluster's leading edge, and whichever is married into the NEXT cluster
  // to its trailing edge — everyone else keeps birth order. A cluster with
  // no adjacent-cluster marriage (the common case: no cross-family couple
  // touches it) is untouched, i.e. just sorted by birth order as before.
  // Turns "brother brother PERSON, SPOUSE sister sister" (birth order,
  // ignoring the marriage) into "brother brother PERSON | SPOUSE sister
  // sister" (the couple adjacent, each still with their own siblings).
  //
  // cluster.members itself is set to the plain blood-only order, same as
  // ever — clusters are shared, long-lived objects reused across every
  // sweep (see buildClusters), and splicing bare satellites into that
  // persisted array would compound across sweeps and corrupt every later
  // lead/trail/rank lookup that assumes it holds only blood relatives.
  // The satellite-spliced sequence is returned instead, fresh, for this
  // one row-build to use.
  // Partitions a list of members into groups sharing the exact same
  // recorded parent set (sameParentUnion's own grouping key). Unlike
  // splitIntoAnchorRuns (further down, used at positioning time to recover
  // boundaries from an ALREADY-decided sequence), this doesn't assume the
  // input is in any particular order — it's used here to DECIDE order, by
  // partitioning first and choosing which group goes where after. Each
  // group preserves the relative order its members had in the input.
  function groupByParentSet(data, members) {
    const groups = [];
    members.forEach((m) => {
      const g = groups.find((grp) => sameParentUnion(data, grp[0], m));
      if (g) g.push(m); else groups.push([m]);
    });
    return groups;
  }

  // Orders a cluster's members so that a half-sibling anchor group (the
  // children of one specific recorded union) sits together on whichever
  // side matches where ITS OWN parents rank in the row above — instead of
  // birth date alone, which has nothing to do with which side of the row a
  // specific union's anchor sits on. Ordering purely by birth date is
  // exactly what lets one half-sibling's connector cross a DIFFERENT
  // half-sibling's connector on the way to their own, differently-placed,
  // parents (see KNOWN_ISSUE_tree_layout_overlap.md).
  //
  // `parentRankOf` gives a group's rank purely from the row above (never
  // pixel position, matching this file's core ordering-phase rule) — null
  // when there's nothing to rank against yet (the very first seed pass, or
  // the topmost row, which has no row above at all). Only reorders when
  // there's more than one anchor group AND every one of them has a real
  // rank — the same "don't mix scales" rule used throughout this file's
  // ordering phase (see buildChain/sortBlocks): mixing a ranked group with
  // an unranked one isn't a neutral tie, it's an unconditional loss for
  // whichever group has nothing to compare with. A plain full-sibling
  // cluster (one group) is always a pure birth-date sort, unchanged from
  // before this existed.
  function orderByAnchorGroup(data, members, parentRankOf) {
    const sortedByBirth = [...members].sort((a, b) => birthOrderCompare(data, a, b));
    if (!parentRankOf) return sortedByBirth;
    const groups = groupByParentSet(data, sortedByBirth);
    if (groups.length <= 1) return sortedByBirth;
    const ranks = groups.map((g) => parentRankOf(g));
    if (ranks.some((r) => r === null)) return sortedByBirth;
    const order = groups.map((g, i) => i).sort((i, j) => ranks[i] - ranks[j]);
    return order.flatMap((i) => groups[i]);
  }

  function orderMembersWithinCluster(data, cluster, prevCluster, nextCluster, spouseEdges, satellitesByMember, parentRankOf) {
    const sortedByBirth = orderByAnchorGroup(data, cluster.members, parentRankOf);
    if (cluster.members.length <= 1) {
      cluster.members = sortedByBirth;
      return { leadMember: null, trailMember: null, ordered: spliceSatellites(sortedByBirth, null, null, satellitesByMember) };
    }
    let leadMember = null, trailMember = null;
    cluster.members.forEach((m) => {
      const spouses = spouseEdges.get(m);
      if (!spouses) return;
      if (prevCluster && !leadMember && [...spouses].some((sp) => prevCluster.members.includes(sp))) leadMember = m;
      if (nextCluster && !trailMember && [...spouses].some((sp) => nextCluster.members.includes(sp))) trailMember = m;
    });
    const rest = sortedByBirth.filter((m) => m !== leadMember && m !== trailMember);
    const ordered = [];
    if (leadMember) ordered.push(leadMember);
    ordered.push(...rest);
    if (trailMember && trailMember !== leadMember) ordered.push(trailMember);
    cluster.members = ordered;
    return { leadMember, trailMember, ordered: spliceSatellites(ordered, leadMember, trailMember, satellitesByMember) };
  }

  // One row's clusters, grouped into marriage-chains and internally
  // ordered — everything ordering needs from a row, for one sweep
  // direction's rankOf. `parentRankOf` is ALWAYS the row-above signal
  // (regardless of which direction this particular sweep pass is
  // currently ranking blocks by) — see orderByAnchorGroup for why: a
  // half-sibling run's own side of the row is a property of its parents,
  // never its children, so it doesn't alternate with sweep direction the
  // way block/cluster ordering does.
  function buildBlocksForRow(data, clusters, spouseEdges, rankOf, prevRank, parentRankOf) {
    const { structuralClusters, satellitesByMember } = classifySatellites(data, clusters, spouseEdges);
    const groups = groupClustersByMarriage(structuralClusters, spouseEdges);
    return groups.map((groupClusters) => {
      const chain = buildChain(data, groupClusters, spouseEdges, rankOf, prevRank);

      // A cluster in the MIDDLE of a 3+ chain whose connecting member
      // faces BOTH neighbors at once (someone with a current AND a
      // former same-generation spouse, most commonly) has nowhere left
      // for any OTHER member of that same cluster (a sibling) to go — a
      // cluster only has two edges, and both are already claimed by the
      // one person who has to face each neighbor directly. Left in
      // place, that sibling ends up wedged between the hub and whichever
      // neighbor it's still nominally "facing", forcing that neighbor's
      // marriage line to cross the sibling's own shared-parent connector
      // on its way to the hub. Relocating the sibling to the OUTSIDE of
      // the whole chain instead (past whichever end it sits nearest)
      // keeps the hub properly sandwiched and the sibling still visibly
      // attached to their shared parents, just from the far side.
      // Never mutates cluster.members itself — see orderMembersWithinCluster.
      // hubOnlyClusters/orderedByCluster record this row-build's own
      // results so the final flattened sequence below can use them
      // without touching any shared, persisted state.
      const before = [];
      const after = [];
      const hubOnlyClusters = new Map();
      const orderedByCluster = new Map();
      chain.forEach((cluster, idx) => {
        const { leadMember, trailMember, ordered } = orderMembersWithinCluster(data, cluster, chain[idx - 1] || null, chain[idx + 1] || null, spouseEdges, satellitesByMember, parentRankOf);
        orderedByCluster.set(cluster, ordered);
        if (leadMember && leadMember === trailMember && cluster.members.length > 1) {
          const hub = leadMember;
          const extras = ordered.filter((m) => m !== hub);
          hubOnlyClusters.set(cluster, hub);
          if (idx <= (chain.length - 1) / 2) before.unshift(...extras);
          else after.push(...extras);
        }
      });

      const members = [...before, ...chain.flatMap((c) => (hubOnlyClusters.has(c) ? [hubOnlyClusters.get(c)] : orderedByCluster.get(c))), ...after];
      // True when `members` is a plain concatenation of each chain
      // cluster's own ordered sequence, with cluster boundaries recoverable
      // via sameParentUnion (see splitIntoAnchorRuns/runsOfBlock) — false
      // for the carefully-tuned 3+-way-marriage hub/sandwich cases from
      // residual issue 2's fix, which runsOfBlock skips entirely (treating
      // the whole block as a single run) rather than risk interacting with
      // that fragile logic.
      const simple = before.length === 0 && after.length === 0 && hubOnlyClusters.size === 0;
      return { chain, members, simple };
    });
  }

  function blockRank(block, rankOf) {
    const ranks = block.chain.map(rankOf).filter((v) => v !== null);
    return ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
  }

  // `prevRank` is this SAME row's rank map from immediately before this
  // call (undefined only for the very first, no-information seed pass).
  // A tie on the CURRENT sweep direction's rank — most commonly two
  // parents of the same shared child, whose rank-from-below is
  // necessarily identical — means this direction has nothing to add, not
  // that the row should be re-decided from scratch: falling to name here
  // would let a bottom-up sweep with nothing to say silently overwrite a
  // perfectly good top-down decision from earlier in the very same round
  // (and vice versa). Falling back to the row's existing order instead
  // means a tie simply leaves whatever the OTHER direction already
  // decided alone. Name is still the tie-break of last resort, for
  // whichever block has never been ranked by anything at all yet.
  function sortBlocks(data, blocks, rankOf, prevRank) {
    // Same "don't mix scales" rule as buildChain's allRanked check, one
    // level up: a childless leaf block (no rank-from-below at all) must
    // never be compared directly against a sibling block that DOES have
    // one — Infinity isn't a neutral placeholder there, it's an
    // unconditional loss that shoves the childless block to whichever
    // end Infinity sorts toward, regardless of where it actually
    // belongs. Whenever even one block in this row has no rank this
    // direction, the whole row falls through to the stability tie-break
    // instead of letting the few blocks that DO have a rank decide
    // everyone else's position by default.
    const allRanked = blocks.every((b) => blockRank(b, rankOf) !== null);
    return blocks.slice().sort((a, b) => {
      const ra = (allRanked ? blockRank(a, rankOf) : null) ?? Infinity;
      const rb = (allRanked ? blockRank(b, rankOf) : null) ?? Infinity;
      if (ra !== rb) return ra - rb;
      if (prevRank) {
        const pa = prevRank.get(a.members[0]);
        const pb = prevRank.get(b.members[0]);
        if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb;
      }
      return nameKeyOf(data, a.chain[0].members[0]).localeCompare(nameKeyOf(data, b.chain[0].members[0]));
    });
  }

  // Each PERSON's own sequential position across the whole flattened row —
  // not their block's index. Two people in the same block (a married
  // couple, most commonly) must never collapse to one shared rank: that's
  // exactly the distinction needed both to compare them against a THIRD
  // block elsewhere in the row, and — just as important — to tell them
  // apart from each other as prevRank's stability tie-break (see
  // buildChain/sortBlocks) the next time this exact pair ties again.
  function rankMapOf(blocks) {
    const rank = new Map();
    let i = 0;
    blocks.forEach((block) => block.members.forEach((m) => { rank.set(m, i); i += 1; }));
    return rank;
  }

  // A snapshot of every row's current left-to-right person-id sequence —
  // used only to detect when a sweep round stops changing anything, so
  // the loop can stop as soon as it settles instead of always running the
  // full cap.
  function orderSignature(blocksByGen, maxGen) {
    const parts = [];
    for (let g = 0; g <= maxGen; g += 1) {
      parts.push((blocksByGen.get(g) || []).map((b) => b.members.join(',')).join('|'));
    }
    return parts.join('##');
  }

  // The alternating top-down / bottom-up barycenter sweep described in the
  // comment above buildClusters. Capped at a fixed number of rounds as a
  // safety net (a barycenter sweep is a heuristic — it isn't mathematically
  // guaranteed to settle for every conceivable graph — but converges in
  // practice for the tree-like, mostly-sparse marriage graphs a genealogy
  // actually produces, and this file's whole point is not depending on
  // exact convergence the way the pixel-hint version used to).
  const MAX_ORDER_SWEEPS = 12;

  function computeBlockOrder(data) {
    const gen = computeGenerations(data);
    const maxGen = Math.max(0, ...[...gen.values()]);
    const clustersByGen = buildClusters(data, gen, maxGen);
    const spouseEdges = buildSpouseEdges(data, gen);

    const blocksByGen = new Map();
    const rankByGen = new Map();

    // Initial seed: nothing is fixed yet anywhere, so every row starts
    // ordered by name alone — arbitrary, but deterministic, and only ever
    // matters for however many sweeps it takes to be replaced by rank.
    for (let g = 0; g <= maxGen; g += 1) {
      const parentRankOf = (members) => clusterRank({ members }, rankByGen.get(g - 1), (m) => parentIdsOf(data, m));
      const blocks = sortBlocks(data, buildBlocksForRow(data, clustersByGen.get(g), spouseEdges, () => null, null, parentRankOf), () => null, null);
      blocksByGen.set(g, blocks);
      rankByGen.set(g, rankMapOf(blocks));
    }

    let signature = orderSignature(blocksByGen, maxGen);
    for (let sweep = 0; sweep < MAX_ORDER_SWEEPS; sweep += 1) {
      for (let g = 1; g <= maxGen; g += 1) {
        const aboveRank = rankByGen.get(g - 1);
        const prevRank = rankByGen.get(g);
        const rankOf = (cluster) => clusterRank(cluster, aboveRank, (m) => parentIdsOf(data, m));
        const parentRankOf = (members) => clusterRank({ members }, aboveRank, (m) => parentIdsOf(data, m));
        const blocks = sortBlocks(data, buildBlocksForRow(data, clustersByGen.get(g), spouseEdges, rankOf, prevRank, parentRankOf), rankOf, prevRank);
        blocksByGen.set(g, blocks);
        rankByGen.set(g, rankMapOf(blocks));
      }
      for (let g = maxGen - 1; g >= 0; g -= 1) {
        const belowRank = rankByGen.get(g + 1);
        const prevRank = rankByGen.get(g);
        const rankOf = (cluster) => clusterRank(cluster, belowRank, (m) => childIdsOf(data, m));
        const parentRankOf = (members) => clusterRank({ members }, rankByGen.get(g - 1), (m) => parentIdsOf(data, m));
        const blocks = sortBlocks(data, buildBlocksForRow(data, clustersByGen.get(g), spouseEdges, rankOf, prevRank, parentRankOf), rankOf, prevRank);
        blocksByGen.set(g, blocks);
        rankByGen.set(g, rankMapOf(blocks));
      }
      const nextSignature = orderSignature(blocksByGen, maxGen);
      if (nextSignature === signature) break;
      signature = nextSignature;
    }

    return {
      gen, maxGen, clustersByGen, spouseEdges, blocksByGen,
      clusterOf: buildClusterOf(clustersByGen),
    };
  }

  // ---- Positioning (step 3: reserve width, then place — order from step 2
  // is fixed from here on and never revisited) ----------------------------

  // True full siblings (recorded under the exact same set of parents) —
  // as opposed to half-siblings grouped into the same cluster only because
  // they share ONE parent from otherwise different unions.
  function sameParentUnion(data, a, b) {
    const pa = new Set(DataModel.getParents(data, a).map((p) => p.id));
    const pb = new Set(DataModel.getParents(data, b).map((p) => p.id));
    if (pa.size === 0 || pa.size !== pb.size) return false;
    for (const id of pa) if (!pb.has(id)) return false;
    return true;
  }

  // Splits a block's flat, already-ordered `members` sequence into maximal
  // contiguous runs sharing the exact same recorded parent set —
  // `sameParentUnion`'s own grouping key. Two people from DIFFERENT
  // marriage-chain clusters can never match this test (clusterSiblings only
  // ever merges people who share at least one parent into the same cluster;
  // distinct clusters share none, and a both-no-recorded-parents pair is
  // explicitly treated as "different" by sameParentUnion's `pa.size === 0`
  // check) — so running this directly over a whole block's members, with no
  // other input, recovers both a half-sibling cluster's own anchor-run
  // boundaries (residual issue 1) AND a marriage-fused block's own
  // per-cluster boundaries (residual issue 3) in a single pass, with no new
  // data needing to flow from ordering into positioning.
  function splitIntoAnchorRuns(data, members) {
    const runs = [];
    let current = [];
    members.forEach((m) => {
      if (current.length === 0 || sameParentUnion(data, current[current.length - 1], m)) {
        current.push(m);
      } else {
        runs.push(current);
        current = [m];
      }
    });
    if (current.length) runs.push(current);
    return runs;
  }

  // How far a two-parent union's anchor (the average of both partners'
  // eventual centers) sits from either partner alone — roughly half the
  // width the OTHER partner plus the gap between them takes up. A single-
  // parent union has no such offset (its anchor IS that one parent).
  // Purely a function of node widths, so it's available identically
  // during both width reservation and actual positioning — never a
  // source of mismatch between the two, unlike using real pixel centers
  // (only known well after reservation runs) would be.
  function unionAnchorOffset(data, personId, widths) {
    const parents = DataModel.getParents(data, personId);
    if (parents.length < 2) return 0;
    const totalW = parents.reduce((sum, p) => sum + (widths.get(p.id) || MIN_TEXT_W), 0);
    return totalW / (parents.length * 2) + PARTNER_GAP / 2;
  }

  // Extra clearance added on top of the bare geometric minimum needed to
  // keep two differently-anchored connectors from crossing (see
  // unionAnchorOffset) — there's no reason to cut it close on what's
  // effectively an infinite canvas, and a razor-thin margin leaves no room
  // for the approximation in unionAnchorOffset to be slightly off.
  const HALF_SIBLING_MARGIN = 24;

  // Half-siblings from different unions get their own gap, sized
  // dynamically from how far apart their respective unions' anchors
  // actually sit (see unionAnchorOffset) rather than one fixed distance
  // for every half-sibling pairing, or a live per-pass correction — this
  // is purely a function of node widths, known up front and identical at
  // both reservation and placement time, so there's never a gap between
  // how much room was reserved and how much placement actually needs.
  function gapBetween(a, b, spouseEdges, clusterOf, data, widths) {
    if (spouseEdges.get(a)?.has(b)) return PARTNER_GAP;
    if (clusterOf.get(a) === clusterOf.get(b)) {
      if (sameParentUnion(data, a, b)) return SIBLING_GAP;
      return SIBLING_GAP + HALF_SIBLING_MARGIN + unionAnchorOffset(data, a, widths) + unionAnchorOffset(data, b, widths);
    }
    return FAMILY_GAP;
  }

  function ownWidthOfSequence(members, widths, spouseEdges, clusterOf, data) {
    let w = 0;
    members.forEach((m, i) => {
      w += widths.get(m) || MIN_TEXT_W;
      if (i < members.length - 1) w += gapBetween(m, members[i + 1], spouseEdges, clusterOf, data, widths);
    });
    return w;
  }

  // ---- Runs: the real positioning unit ------------------------------------
  //
  // A "block" (a marriage chain of clusters, already fixed by the ordering
  // phase) is still the right unit for ORDER — partners must always land
  // adjacent — but positioning an entire block as one rigid, single-anchor
  // unit is exactly what left residual issues 1 and 3 only partially fixed
  // (see the 2026-08-14 structuralIdealLeftOf entries in
  // KNOWN_ISSUE_tree_layout_overlap.md, now superseded by this). A block
  // can contain more than one genuinely independent anchor — a half-sibling
  // split within one cluster, or two differently-sized clusters fused by
  // marriage — and no single shared translation can align both at once.
  //
  // A "run" is a block's flat `members` sequence split at every point
  // `sameParentUnion` disagrees (via splitIntoAnchorRuns) — recovering BOTH
  // a half-sibling cluster's own anchor-run boundaries AND a marriage-fused
  // block's own per-cluster boundaries in one pass, with no new data needed
  // (two different marriage-chain clusters can never share a full
  // parent-set match). Each run gets its OWN reservation and its OWN
  // idealCenterOf-driven position — exact per-anchor alignment, not a
  // compromise average across every anchor a block happens to contain.
  // `block.simple` gates this the same way it gated the superseded
  // structuralIdealLeftOf: the hub/sandwich cases from residual issue 2's
  // fix have a hand-tuned member order that doesn't cleanly correspond to
  // "one run per real anchor", so a non-simple block is always exactly one
  // run (today's original, whole-block behavior, untouched).
  //
  // Runs are memoized on the block object (`block.runs`) — computed once,
  // reused by both reservation and positioning, so a run created during
  // reservation is the SAME object positioning later looks up by reference
  // (Maps below are keyed by run identity, not by recomputing the split).
  function runsOfBlock(data, block) {
    if (!block.runs) {
      block.runs = block.simple
        ? splitIntoAnchorRuns(data, block.members).map((members) => ({ members }))
        : [{ members: block.members }];
    }
    return block.runs;
  }

  function buildRunsByGen(data, blocksByGen, maxGen) {
    const runsByGen = new Map();
    for (let g = 0; g <= maxGen; g += 1) {
      const runs = [];
      (blocksByGen.get(g) || []).forEach((block) => runs.push(...runsOfBlock(data, block)));
      runsByGen.set(g, runs);
    }
    return runsByGen;
  }

  // Maps each person to the run they ended up in, per row — the run-level
  // equivalent of the old buildBlockMapByGen, used to find which run(s) a
  // run's children landed in, one row down.
  function buildRunMapByGen(runsByGen, maxGen) {
    const map = new Map();
    for (let g = 0; g <= maxGen; g += 1) {
      const rowMap = new Map();
      (runsByGen.get(g) || []).forEach((run) => run.members.forEach((m) => rowMap.set(m, run)));
      map.set(g, rowMap);
    }
    return map;
  }

  function childRunsOf(data, run, belowRunMap) {
    const result = new Set();
    run.members.forEach((m) => {
      DataModel.getChildren(data, m).forEach((child) => {
        const childRun = belowRunMap.get(child.id);
        if (childRun) result.add(childRun);
      });
    });
    return [...result];
  }

  // How many DISTINCT runs at each generation claim a given child-run as
  // one of their own — see the old buildClaimCounts this replaces for why
  // (almost always 1; a shared child gets claimed once per claimant so a
  // shared claim is divided, not double-reserved).
  function buildRunClaimCounts(data, runsByGen, runMapByGen, maxGen) {
    const counts = new Map();
    for (let g = 0; g < maxGen; g += 1) {
      (runsByGen.get(g) || []).forEach((run) => {
        childRunsOf(data, run, runMapByGen.get(g + 1)).forEach((cr) => counts.set(cr, (counts.get(cr) || 0) + 1));
      });
    }
    return counts;
  }

  // Bottom-up, same rule as the old reserveWidths, now per RUN instead of
  // per block: a run must be at least wide enough for its own members, but
  // if its descendants collectively need more room than that, it reserves
  // the extra space too. Runs from the same block are never merged back
  // into one shared reservation — that's the entire point of positioning
  // by run instead of by block.
  function reserveRunWidths(data, runsByGen, runMapByGen, maxGen, widths, spouseEdges, clusterOf) {
    const claimCounts = buildRunClaimCounts(data, runsByGen, runMapByGen, maxGen);
    const reserved = new Map();
    for (let g = maxGen; g >= 0; g -= 1) {
      (runsByGen.get(g) || []).forEach((run) => {
        const ownW = ownWidthOfSequence(run.members, widths, spouseEdges, clusterOf, data);
        const childRuns = g < maxGen ? childRunsOf(data, run, runMapByGen.get(g + 1)) : [];
        let childrenTotal = 0;
        childRuns.forEach((cr, i) => {
          const full = reserved.get(cr) ?? ownWidthOfSequence(cr.members, widths, spouseEdges, clusterOf, data);
          childrenTotal += full / (claimCounts.get(cr) || 1);
          if (i > 0) childrenTotal += FAMILY_GAP;
        });
        reserved.set(run, Math.max(ownW, childrenTotal));
      });
    }
    return reserved;
  }

  // A run's ideal horizontal center: the average position of its own
  // recorded parents, already placed one row up (null for a run with no
  // parents recorded at all — it just packs sequentially instead). Exactly
  // the superseded idealCenterOf's own math — that was never wrong, only
  // ever applied to a unit too coarse (a whole block) to have just one true
  // anchor. Applied to a run (by construction, every member shares the
  // exact same recorded parent set), it's exact.
  function idealCenterOf(data, run, centers) {
    const parentIds = new Set();
    run.members.forEach((m) => DataModel.getParents(data, m).forEach((par) => parentIds.add(par.id)));
    const xs = [...parentIds].map((pid) => centers.get(pid)).filter(Boolean).map((c) => c.x);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  function placeRunMembers(run, left, widths, spouseEdges, clusterOf, data, y, centers) {
    let x = left;
    run.members.forEach((m, i) => {
      const w = widths.get(m) || MIN_TEXT_W;
      centers.set(m, { x: x + w / 2, y });
      x += w;
      if (i < run.members.length - 1) x += gapBetween(m, run.members[i + 1], spouseEdges, clusterOf, data, widths);
    });
  }

  // Single top-down pass: order from step 2 is already fixed, so every row
  // is just placed once, left to right, using each RUN's own reserved
  // width and nudging toward ITS OWN parents' actual position — no
  // iteration, and nothing here ever changes any run's relative order.
  // Runs from the same original block are never specially glued together
  // here: `gapBetween` already gives the correct gap between any two
  // adjacent members regardless of which run/cluster/block they came from
  // (PARTNER_GAP for a married pair straddling a run boundary, the
  // half-sibling gap within one cluster's own runs, FAMILY_GAP between
  // genuinely different clusters) — so treating a whole row as one flat
  // run sequence, exactly like blocks were treated before, is enough for
  // every run to end up correctly adjacent to its real neighbors.
  //
  // Overlap safety does not depend on reservation being a perfect
  // prediction of what a run will actually need: `left = Math.max(minLeft,
  // targetLeft)` only ever pushes a run FURTHER right than the tight-pack
  // minimum, never left of it, so two adjacent runs can never overlap
  // regardless of how each run's own idealCenterOf pulls it. An imprecise
  // reservation can only cost alignment quality (a run landing further
  // from its true anchor than it would with perfect foreknowledge of every
  // real position two phases away) — never a structural overlap.
  function positionRuns(data, runsByGen, reserved, widths, maxGen, spouseEdges, clusterOf) {
    const centers = new Map();
    let maxRight = 0;
    for (let g = 0; g <= maxGen; g += 1) {
      const runs = runsByGen.get(g) || [];
      let cursor = 0;
      runs.forEach((run, idx) => {
        const w = reserved.get(run);
        const idealCenter = idealCenterOf(data, run, centers);
        const targetLeft = idealCenter !== null ? idealCenter - w / 2 : null;
        let left;
        if (idx === 0) {
          // Not clamped to 0 here — a row's leading run is sometimes
          // pulled slightly negative on purpose when its ideal center
          // sits further left than x=0 (e.g. a narrow ancestor row above
          // a much wider descendant row). Clamping here would silently
          // swallow that room right back up; instead the whole canvas
          // gets shifted back into non-negative space once, after
          // everything is placed (below), which preserves it.
          left = targetLeft !== null ? targetLeft : 0;
        } else {
          const prevRun = runs[idx - 1];
          const gap = gapBetween(
            prevRun.members[prevRun.members.length - 1],
            run.members[0],
            spouseEdges, clusterOf, data, widths,
          );
          const minLeft = cursor + gap;
          left = targetLeft !== null ? Math.max(minLeft, targetLeft) : minLeft;
        }
        const right = left + w;
        cursor = right;
        maxRight = Math.max(maxRight, right);
        const y = g * (NODE_H + ROW_GAP) + NODE_H / 2;
        placeRunMembers(run, left, widths, spouseEdges, clusterOf, data, y, centers);
      });
    }

    let minLeftEdge = 0;
    centers.forEach((c, id) => {
      const w = widths.get(id) || MIN_TEXT_W;
      minLeftEdge = Math.min(minLeftEdge, c.x - w / 2);
    });
    if (minLeftEdge < 0) {
      const shift = -minLeftEdge;
      centers.forEach((c) => { c.x += shift; });
      maxRight += shift;
    }

    return { centers, totalWidth: maxRight };
  }

  function layout(data, t) {
    const widths = new Map();
    const lines = new Map();
    DataModel.allPeople(data).forEach((p) => {
      const l = UiHelpers.personLines(p, t);
      lines.set(p.id, l);
      widths.set(p.id, nodeWidth(l));
    });

    const { maxGen, blocksByGen, spouseEdges, clusterOf } = computeBlockOrder(data);
    const runsByGen = buildRunsByGen(data, blocksByGen, maxGen);
    const runMapByGen = buildRunMapByGen(runsByGen, maxGen);
    const reserved = reserveRunWidths(data, runsByGen, runMapByGen, maxGen, widths, spouseEdges, clusterOf);
    const { centers, totalWidth } = positionRuns(data, runsByGen, reserved, widths, maxGen, spouseEdges, clusterOf);

    return {
      centers, widths, lines, maxGen,
      totalWidth,
      totalHeight: maxGen * (NODE_H + ROW_GAP) + NODE_H,
    };
  }

  // ---- Rendering-only connector bend-height scheduling --------------------
  //
  // Every parent-to-child connector bends once, at some height between the
  // two rows, then runs horizontal to the child's own column. Two DIFFERENT
  // unions sharing a row gap (most commonly a half-sibling split — some of a
  // parent's children from one union, the rest from another) used to always
  // bend at the exact same fixed halfway height, purely because they're the
  // same two rows apart — nothing to do with whether their horizontal runs
  // actually reach into each other's space. When they do reach into each
  // other's space, sharing a bend height draws both lines on the same path
  // for a stretch, reading as one line overlapping another (see
  // KNOWN_ISSUE_tree_layout_overlap.md, "residual issue 1").
  //
  // This entire section is rendering-only: it decides which fraction of a
  // row gap each union's connector bends at, never any x/y position that
  // layout() computed. A first attempt that just staggered heights by reach
  // width (widest bends earliest) fixed the pair it targeted but introduced
  // brand-new genuine line crossings against OTHER, unrelated unions
  // sharing the same row gap — this replaces that with an actual
  // no-crossings search across every union in a row gap at once, not just
  // pairwise, verified by checking real line-segment intersections (not an
  // interval-overlap approximation) between every candidate pair.

  // The three straight-line pieces of one union's connector to one specific
  // child, at a given bend height — used only to test for a real geometric
  // intersection between two connectors, never to decide any layout
  // position.
  function connectorSegments(drop, fraction) {
    const midY = drop.anchorY + (drop.childY - drop.anchorY) * fraction;
    const segs = [];
    drop.childXs.forEach((cx) => {
      segs.push([[drop.anchorX, drop.anchorY], [drop.anchorX, midY]]);
      segs.push([[drop.anchorX, midY], [cx, midY]]);
      segs.push([[cx, midY], [cx, drop.childY]]);
    });
    return segs;
  }

  // A real visual conflict between two straight segments — either a proper
  // crossing (they intersect at a single interior point), or the specific
  // case a plain crossing test misses entirely: two DIFFERENT segments
  // running along the exact same line with overlapping extents (e.g. two
  // unions' horizontal jogs sharing a height — mathematically "parallel,
  // no intersection point" to a standard line-intersection test, but
  // exactly the coincident-line visual overlap this scheduling exists to
  // avoid). Every segment here is axis-aligned (purely horizontal or
  // vertical, see connectorSegments), so the collinear case only ever
  // needs a same-x or same-y overlap check, never a general line-equation
  // comparison.
  function segmentsConflict(a, b) {
    const [[x1, y1], [x2, y2]] = a;
    const [[x3, y3], [x4, y4]] = b;
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (d !== 0) {
      const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
      const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
      return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
    }
    const aVertical = Math.abs(x1 - x2) < 0.01;
    const bVertical = Math.abs(x3 - x4) < 0.01;
    if (aVertical !== bVertical) return false;
    if (aVertical) {
      if (Math.abs(x1 - x3) > 0.01) return false;
      return Math.min(y1, y2) < Math.max(y3, y4) - 0.01 && Math.min(y3, y4) < Math.max(y1, y2) - 0.01;
    }
    if (Math.abs(y1 - y3) > 0.01) return false;
    return Math.min(x1, x2) < Math.max(x3, x4) - 0.01 && Math.min(x3, x4) < Math.max(x1, x2) - 0.01;
  }

  function connectorsConflict(dropA, fracA, dropB, fracB) {
    const segsA = connectorSegments(dropA, fracA);
    const segsB = connectorSegments(dropB, fracB);
    return segsA.some((sa) => segsB.some((sb) => segmentsConflict(sa, sb)));
  }

  // One entry per union that actually draws a parent-to-child connector —
  // everything computeBendFractions/connectorSegments need, grouped by
  // which specific row gap (anchorY -> childY) it belongs to, since only
  // unions sharing a gap can ever visually compete for the same bend
  // height.
  function computeConnectorDrops(data, centers, widths) {
    const dropByUnionId = new Map();
    const dropsByGap = new Map();
    DataModel.allUnions(data).forEach((u) => {
      const partnerEntries = u.partners.map((p) => ({ id: p, c: centers.get(p) })).filter((e) => e.c);
      const partnerCenters = partnerEntries.map((e) => e.c);
      if (!u.children.length || !partnerCenters.length) return;
      let anchorX;
      if (partnerEntries.length === 2) {
        const [pa, pb] = partnerEntries;
        const wa = widths.get(pa.id) || MIN_TEXT_W;
        const wb = widths.get(pb.id) || MIN_TEXT_W;
        const left = pa.c.x <= pb.c.x ? { x: pa.c.x, w: wa } : { x: pb.c.x, w: wb };
        const right = pa.c.x <= pb.c.x ? { x: pb.c.x, w: wb } : { x: pa.c.x, w: wa };
        anchorX = ((left.x + left.w / 2) + (right.x - right.w / 2)) / 2;
      } else {
        anchorX = partnerCenters.reduce((sum, c) => sum + c.x, 0) / partnerCenters.length;
      }
      const anchorY = partnerCenters.reduce((sum, c) => sum + c.y, 0) / partnerCenters.length;
      const childCenters = u.children.map((cid) => centers.get(cid)).filter(Boolean);
      if (!childCenters.length) return;
      const drop = {
        anchorX, anchorY, childY: childCenters[0].y, childXs: childCenters.map((c) => c.x), fraction: 0.5,
      };
      const gapKey = `${anchorY}|${drop.childY}`;
      if (!dropsByGap.has(gapKey)) dropsByGap.set(gapKey, []);
      dropsByGap.get(gapKey).push(drop);
      dropByUnionId.set(u.id, drop);
    });
    return { dropByUnionId, dropsByGap };
  }

  // A handful of candidate bend heights, tried closest-to-default first —
  // deviating from the plain 50% midpoint only for whichever unions
  // actually need it to avoid a real crossing, so an ordinary row gap with
  // no competing union looks exactly as it always has.
  const BEND_FRACTION_CANDIDATES = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85];

  // For each row gap with 2+ competing unions, finds a combination of bend
  // heights (one per union, from BEND_FRACTION_CANDIDATES) with zero real
  // conflicts between any pair — checked directly via connectorsConflict,
  // not approximated from interval overlap alone, so this can't repeat an
  // earlier attempt's mistake of fixing one pair while creating a new
  // conflict against a third, unrelated union sharing the same gap.
  //
  // A simple one-pass greedy (decide each union in turn, keep whatever
  // height doesn't conflict with anything already decided) is NOT enough
  // here: unlike a plain 1-D interval-overlap problem (where processing by
  // start position and always taking the first free "color" is provably
  // optimal), a candidate height here interacts with the OTHER union's
  // OWN chosen height too — a pair can conflict at one combination of
  // heights and not another. A choice that looks conflict-free against
  // whatever came before can still leave no good option for something
  // decided later. Confirmed empirically: a first-pass greedy version of
  // this eliminated the originally-reported same-height overlap but
  // introduced 3 new genuine line crossings elsewhere in the real,
  // reported data (unrelated Lakes/Ertürk unions sharing the same gap).
  //
  // Exhaustive search over every combination instead — small groups (this
  // app's real data never exceeds a handful of unions in one row gap) times
  // a small candidate set is a trivial search at render time, and stops
  // the instant a zero-conflict combination is found. Falls back to the
  // simpler greedy pass only for an unusually large group (more than
  // EXHAUSTIVE_SEARCH_LIMIT unions sharing one gap), where a full search
  // would no longer be cheap — a same-height overlap in that rare case is
  // no worse than what every union already did before this existed.
  const EXHAUSTIVE_SEARCH_LIMIT = 6;

  function greedyBendFractions(drops) {
    const ordered = [...drops].sort((a, b) => a.anchorX - b.anchorX);
    const decided = [];
    ordered.forEach((drop) => {
      let best = BEND_FRACTION_CANDIDATES[0];
      let bestConflicts = Infinity;
      for (const candidate of BEND_FRACTION_CANDIDATES) {
        const conflicts = decided.filter((other) => connectorsConflict(drop, candidate, other, other.fraction)).length;
        if (conflicts === 0) { best = candidate; break; }
        if (conflicts < bestConflicts) { bestConflicts = conflicts; best = candidate; }
      }
      drop.fraction = best;
      decided.push(drop);
    });
  }

  // Whether candidate height `ci` for drop `i` conflicts with candidate
  // height `cj` for drop `j` depends only on that ONE pair, never on
  // anything else in the group — so every pair's conflict, for every
  // combination of the two's candidate heights, can be computed exactly
  // once up front (n*(n-1)/2 pairs times F*F combinations — small even at
  // this function's own group-size cap) and then just looked up during the
  // search below, instead of re-doing the actual line-segment geometry on
  // every single combination the search considers.
  function buildPairConflictTable(drops) {
    const F = BEND_FRACTION_CANDIDATES.length;
    const segsByDropAndCandidate = drops.map((d) => BEND_FRACTION_CANDIDATES.map((f) => connectorSegments(d, f)));
    const conflictBetweenSegs = (segsA, segsB) => segsA.some((sa) => segsB.some((sb) => segmentsConflict(sa, sb)));
    const table = new Map();
    for (let i = 0; i < drops.length; i += 1) {
      for (let j = i + 1; j < drops.length; j += 1) {
        const row = [];
        for (let ci = 0; ci < F; ci += 1) {
          row.push(Array.from({ length: F }, (_, cj) => conflictBetweenSegs(
            segsByDropAndCandidate[i][ci],
            segsByDropAndCandidate[j][cj],
          )));
        }
        table.set(`${i},${j}`, row);
      }
    }
    return (i, ci, j, cj) => (i < j ? table.get(`${i},${j}`)[ci][cj] : table.get(`${j},${i}`)[cj][ci]);
  }

  // Depth-first search over every combination of candidate heights, one
  // per drop, using the precomputed pair table above so exploring the
  // full combination space is cheap integer lookups, not geometry. Prunes
  // as soon as a partial assignment already has at least as many conflicts
  // as the best complete assignment found so far, and stops immediately
  // once a zero-conflict combination is found.
  function exhaustiveBendFractions(drops) {
    const n = drops.length;
    const F = BEND_FRACTION_CANDIDATES.length;
    const conflictOf = buildPairConflictTable(drops);
    const assignment = new Array(n).fill(0);
    let best = assignment.slice();
    let bestConflictCount = Infinity;
    const search = (idx, conflictsSoFar) => {
      if (idx === n) {
        if (conflictsSoFar < bestConflictCount) { bestConflictCount = conflictsSoFar; best = assignment.slice(); }
        return bestConflictCount === 0;
      }
      for (let ci = 0; ci < F; ci += 1) {
        let extra = 0;
        for (let j = 0; j < idx; j += 1) if (conflictOf(idx, ci, j, assignment[j])) extra += 1;
        if (conflictsSoFar + extra >= bestConflictCount) continue;
        assignment[idx] = ci;
        if (search(idx + 1, conflictsSoFar + extra)) return true;
      }
      return false;
    };
    search(0, 0);
    drops.forEach((d, i) => { d.fraction = BEND_FRACTION_CANDIDATES[best[i]]; });
  }

  function assignBendFractions(dropsByGap) {
    dropsByGap.forEach((drops) => {
      if (drops.length <= 1) return;
      if (drops.length <= EXHAUSTIVE_SEARCH_LIMIT) exhaustiveBendFractions(drops);
      else greedyBendFractions(drops);
    });
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

    const { centers, widths, lines, totalWidth, totalHeight } = layout(data, t);
    const svg = container.querySelector('#tree-svg');

    const linksHtml = [];
    const { dropByUnionId, dropsByGap } = computeConnectorDrops(data, centers, widths);
    assignBendFractions(dropsByGap);
    DataModel.allUnions(data).forEach((u) => {
      const partnerEntries = u.partners.map((p) => ({ id: p, c: centers.get(p) })).filter((e) => e.c);
      const partnerCenters = partnerEntries.map((e) => e.c);
      if (partnerCenters.length === 2) {
        const [a, b] = partnerCenters;
        linksHtml.push(`<line class="tree-link" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-dasharray="${u.status === 'current' ? '' : '4,3'}"/>`);
      }
      const drop = dropByUnionId.get(u.id);
      if (u.children.length && drop) {
        const midY = drop.anchorY + (drop.childY - drop.anchorY) * drop.fraction;
        u.children.forEach((cid) => {
          const cc = centers.get(cid);
          if (!cc) return;
          linksHtml.push(`<path class="tree-link" d="M${drop.anchorX},${drop.anchorY} V${midY} H${cc.x} V${cc.y}"/>`);
        });
      }
    });

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

    svg.setAttribute('viewBox', `0 0 ${Math.max(totalWidth, 400)} ${Math.max(totalHeight, 300)}`);
    svg.innerHTML = `
      <defs><clipPath id="tree-photo-clip"><circle cx="${photoR}" cy="${photoR}" r="${photoR}" transform="translate(${PAD},${NODE_H / 2 - photoR})"/></clipPath></defs>
      <g id="tree-viewport">${linksHtml.join('')}${nodesHtml}</g>`;

    svg.querySelectorAll('[data-person]').forEach((node) => {
      node.onclick = () => App.setFocusedPerson(node.dataset.person);
    });

    const wrap = container.querySelector('#tree-wrap');
    applyTransform(svg);
    wireInteraction(wrap, svg);

    container.querySelector('#zoom-in').onclick = () => { transform.scale = Math.min(3, transform.scale * 1.2); applyTransform(svg); };
    container.querySelector('#zoom-out').onclick = () => { transform.scale = Math.max(0.2, transform.scale / 1.2); applyTransform(svg); };
    container.querySelector('#reset-view').onclick = () => { transform = { x: 40, y: 40, scale: 1 }; applyTransform(svg); };
    container.querySelector('#btn-print').onclick = () => {
      // The viewBox is sized to exactly match the tree's content bounding
      // box (0,0 to totalWidth,totalHeight) — any non-zero pan offset here
      // pushes that same amount of content past the viewBox's far edge,
      // clipping it in the printed/PDF output (but not on-screen, since the
      // wrap element there scrolls/overflows instead of clipping to a
      // fixed page). Must be the identity transform for print.
      transform = { x: 0, y: 0, scale: 1 };
      applyTransform(svg);
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

  function wireInteraction(wrap, svg) {
    if (onMouseMove) window.removeEventListener('mousemove', onMouseMove);
    if (onMouseUp) window.removeEventListener('mouseup', onMouseUp);

    wrap.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      transform.scale = Math.min(3, Math.max(0.2, transform.scale * delta));
      applyTransform(svg);
    };
    wrap.onmousedown = (e) => {
      dragState = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
      wrap.classList.add('dragging');
    };
    onMouseMove = (e) => {
      if (!dragState) return;
      transform.x = dragState.origX + (e.clientX - dragState.startX);
      transform.y = dragState.origY + (e.clientY - dragState.startY);
      applyTransform(svg);
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

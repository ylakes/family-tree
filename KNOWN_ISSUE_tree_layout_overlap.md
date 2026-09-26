# Known issues: Full Tree layout overlaps when generations are added

## 2026-08-14 update: the "real spacing fix" ("Option A") — recursive per-run positioning, superseding structuralIdealLeftOf entirely

Attempted after the bend-height scheduler (directly below this entry) turned
out to hit a genuine, verified limit on the reporter's own dense Pintacuda
cluster — 2 unavoidable connector conflicts remained no matter how bend
heights were scheduled, because the underlying POSITIONS were still a
compromise average, not each family's own true anchor. This is the fuller
fix "Option A" flagged as the natural next step in that entry, and in the
residual-issues update below it.

**The core change**: `structuralIdealLeftOf`/`structuralOffsetOf` (the
2026-08-14 "Option B" fix, averaging multiple anchors into one shared
per-block translation) are gone. In their place, the entire reservation and
positioning pipeline now operates on **runs** instead of **blocks**:

- A "run" is a block's flat `members` sequence split at every point
  `sameParentUnion` disagrees (`splitIntoAnchorRuns`, already existed) — the
  same split that recovers both a half-sibling cluster's own anchor-run
  boundaries (residual issue 1) AND a marriage-fused block's own per-cluster
  boundaries (residual issue 3) in one pass, with no new data needed (two
  different marriage-chain clusters can never share a full parent-set
  match). `runsOfBlock` computes this once per block (memoized as
  `block.runs`) — for a non-simple block (the hub/sandwich cases from
  residual issue 2's fix), it's always exactly one run: the whole block,
  untouched, exactly as before.
- Width reservation (`reserveRunWidths`, replacing `reserveWidths`) and
  positioning (`positionRuns`, replacing `positionBlocks`) both now work
  per-run: each run gets its own bottom-up reservation and its own
  `idealCenterOf`-driven position, nudged toward ITS OWN true parents —
  never averaged with a neighboring run's anchor. `idealCenterOf` itself
  didn't need to change at all — as the prior entry's own comment already
  noted, its math was always exactly right when given one true anchor; the
  bug was only ever that it used to be handed a whole block instead.
- Runs from the same original block are never specially glued back
  together — `gapBetween` already gives the right gap between ANY two
  adjacent members regardless of which run/cluster/block they came from
  (`PARTNER_GAP` for a married pair straddling a run boundary, the
  half-sibling margin within one cluster's own runs, `FAMILY_GAP` between
  genuinely different clusters), so treating a whole row as one flat run
  sequence — exactly how blocks were sequenced before — is sufficient.

**Why this is safe despite touching the historically fragile positioning
core**: overlap-safety was re-derived, not assumed. `left = Math.max(minLeft,
targetLeft)` only ever pushes a run FURTHER right than the tight-pack
minimum, never left of it — so two adjacent runs can never overlap
regardless of how far off each run's own `idealCenterOf` pulls it. This
holds with or without a perfectly-accurate width reservation: an imprecise
reservation can only cost ALIGNMENT QUALITY (a run landing further from its
true anchor than perfect foreknowledge would allow), never a structural
overlap. This is why the two-pass width-reservation refinement floated as
part of "Option A" in the prior entries turned out to be unnecessary — the
concern it was meant to address (a run needing more room than a bottom-up
tight-pack estimate predicted) can never produce an overlap, only a
sub-optimal compromise, and testing (below) found no case where the
single-pass version's compromises were actually caused by reservation size
rather than by fixed order and minimum gaps (see the residual, below).

**Verified**, using the same harness described in the entries below:
- Full existing regression suite unaffected: 0 rectangle overlaps on the
  trivial case, the already-fixed 4-sibling shape (and confirmed its
  sib3-sandwiched-between-both-partners arrangement survives), and the real
  47-person data.
- **Residual issue 3's synthetic repro (size-asymmetric marriage) now
  achieves EXACT alignment on both sides — 0.0px misalignment**, down from
  Option B's 28px/28px compromise. This is a full fix, not a reduction, for
  this shape.
- Residual issue 1's synthetic repro (half-sibling dilution): the run that
  sorts first in the row now lands exactly on its own anchor (0px,
  previously 168px under Option B); the other run still carries a
  residual (162.5px in this specific case). Traced directly: this is NOT a
  reservation problem — the first run's own combined width (it has 2
  members) is simply wide enough that, combined with the required minimum
  gap, it leaves less room than the second run's own anchor would ideally
  want. No positioning refinement can eliminate this without either
  reordering (which the ordering phase, deliberately, never revisits once
  fixed) or shrinking a minimum gap below what `HALF_SIBLING_MARGIN`
  requires for connector clearance — both are the wrong trade to make.
  Still a real, substantial improvement over Option B's "both sides
  compromised" outcome (one side now exact; total squared misalignment
  dropped from Option B's 56,448 to 26,406 in this case).
- **A broader, deliberate behavior change, not a bug**: a plain 1-vs-1
  couple is no longer treated as a no-op. Under Option B, a couple with
  differently-sized name boxes was left untouched (gated off on purpose, to
  keep that fix narrowly scoped). Under this rewrite, EVERY couple is two
  independent runs — the partner with recorded parents now lands EXACTLY on
  their own parents' center, rather than being pulled slightly off-center
  to make room for a couple-wide combined translation. Confirmed via a
  dedicated check (`nonno lands exactly on his own parents' center`) that
  this is now always exact, never approximate. This is considered a
  correctness improvement (each person's position now means what it always
  was supposed to mean — their own blood parents' center), not a
  regression, but it is a wider-reaching change than either prior residual
  fix and is called out here explicitly in case anything downstream ever
  assumed the old couple-centering behavior.
- On the real, saved data: canvas width grew modestly (4054px → 4188px,
  +3.3%) from more precise, less-compromised alignment throughout the tree;
  still 0 rectangle overlaps.
- **The specific dense Pintacuda/Ertürk/Lakes row (6 competing unions
  sharing one row gap) is NOT further improved by this change specifically**
  — re-running the connector bend-height scheduler on top of the new
  positions found the exact same mathematical minimum (2 unavoidable
  conflicts) as it found under Option B. Traced directly: in this
  particular row, something ELSE (an unrelated cluster) sits before the
  Pintacuda cluster and claims enough width that Guido/Giovanna's own run —
  though now computed independently and correctly — is itself clamped
  short of ITS OWN true anchor, which cascades into the same shortfall for
  Greta after it. This is the identical "fixed order + minimum gaps forced
  compromise" limit described above, just occurring one link earlier in the
  chain for this specific real row. Positioning refinement alone — Option A
  or otherwise — cannot fully resolve an entire row this densely contested;
  the bend-height scheduler remains the practical mitigation for it.

## 2026-08-14 update: half-sibling connector-line overlap — order fix (safe, didn't hit the reported case) + a rendering-only bend-height scheduler (reduced, not eliminated)

Follow-up to the `structuralIdealLeftOf` update directly below this one, after
visually re-checking the reporter's own Pintacuda cluster and finding the
position fix alone left the reported line overlap looking unchanged. Two
separate, independently-verified pieces of work came out of that:

**1. Sibling order now accounts for which anchor a half-sibling run belongs
to, not just birth date (`orderByAnchorGroup` + `groupByParentSet`, near
`orderMembersWithinCluster`).** Previously, the members of a cluster with no
adjacent-cluster marriage were ordered purely by birth date (or name).
`orderByAnchorGroup` still does exactly that UNLESS the cluster spans more
than one recorded parent set (a half-sibling split) AND every one of those
groups has a real rank from the row above — in which case the GROUPS are
ordered by that rank first, birth date only within each group. Gated the
same "don't mix scales" way as the rest of this file's ordering phase: any
group lacking a rank (e.g. the topmost row) falls straight back to plain
birth-date order, unchanged. `computeBlockOrder` threads a new
`parentRankOf` function through `buildBlocksForRow` for this — always the
row-ABOVE signal specifically (never alternating with sweep direction the
way block/cluster rank does), since which side of the row a half-sibling
run belongs to is a property of its own parents, never its children.

Verified with a constructed case where birth order and parent-anchor order
disagree (an oldest child from the SECOND union, born before the two
children of the FIRST union): before this fix, the mis-ordered sibling
rendered on the wrong side; after, correctly ordered — confirmed via a
Node-style harness, not asserted. Verified as an exact no-op on every other
existing scenario (trivial case, the size-asymmetric-marriage repro, the
plain-couple no-op check, the already-fixed 4-sibling shape, and — for every
person NOT in an affected cluster — the real, saved data).

**Important finding: this did NOT fix the reporter's own case.** Traced
directly: in the real data, Guido/Giovanna and Greta were ALREADY in the
correct order relative to their own parents before this fix — birth order
happened to already agree with anchor order for this specific family. The
visible overlap has a different cause entirely (see #2).

**2. What was actually causing the visible overlap, and the fix
(`computeConnectorDrops` / `assignBendFractions` and helpers, just above
`render`).** Every parent-to-child connector bends at the exact same fixed
50%-of-the-row-gap height, regardless of which union it belongs to. Two
DIFFERENT unions sharing a row gap (a half-sibling split; or, as it turned
out, several unrelated families that happen to occupy the same two rows)
bend at that same height too — and when one's horizontal reach overlaps
another's, both lines run along the exact same path for a stretch before
diverging, which reads as one line overlapping/crossing another even though
no line technically crosses through a node box. This is rendering-only: it
was never a mispositioned box or a wrong x-coordinate, so no position or
order fix (including both `structuralIdealLeftOf` and item #1 above) could
ever have touched it.

Fix: for every row gap with 2+ competing unions, search for a combination of
bend heights (from a small fixed candidate set) with zero real conflicts
between every pair — checked as actual line-segment geometry (a proper
crossing, OR two segments running collinear with overlapping extent — see
`segmentsConflict`), never approximated from x-range overlap alone.

Two dead ends hit and fixed in the same session, worth recording in case
this is ever revisited:
- **A first version staggered heights by a simple width heuristic (widest
  reach bends earliest).** Fixed the one pair it targeted but, verified
  directly against the real data, introduced 3 brand-new genuine line
  crossings against OTHER, unrelated unions sharing the same row gap
  (Lakes/Ertürk branches unrelated to the reported Pintacuda case). Reverted
  in favor of an actual combinatorial search rather than a one-shot
  heuristic — **do not re-attempt a simple pairwise/width-order heuristic**;
  a candidate height's conflict depends on which height the OTHER union in
  a pair also picked, so this isn't a problem a single sort order can solve.
- **A one-pass greedy search (decide each union in turn, keep whatever
  height doesn't conflict with anything decided so far) is provably
  insufficient**, for the same reason: unlike simple 1-D interval coloring
  (where greedy-by-start-position is optimal), a pair's conflict here
  depends on both unions' own chosen heights, so a choice that looks
  conflict-free against everything decided so far can still leave nothing
  good for something decided later. Replaced with an exhaustive search over
  every combination for a row-gap group — cheap in practice (real trees
  never have more than a handful of unions sharing one gap) but ONLY after
  fixing a real performance bug: the first exhaustive version recomputed
  the actual line-segment geometry inside the search loop, which took
  **5.6 seconds** to render the real 47-person tree once it hit a
  genuinely hard 6-union group. Fixed by precomputing every pair's
  conflict for every combination of candidate heights ONCE up front
  (`buildPairConflictTable`), so the search itself is pure integer lookups
  with branch-and-bound pruning — down to ~50ms, matching pre-existing
  render time.
- Also caught (before it shipped): the very first "no crossing" check used
  a standard line-segment-intersection formula, which returns "no
  intersection" for two exactly-parallel (`d === 0`) segments — including
  two DIFFERENT unions' horizontal jogs running collinear with overlapping
  extent, i.e. the EXACT case this exists to catch. `segmentsConflict`
  explicitly special-cases the collinear-overlap case; a plain
  line-intersection test is NOT sufficient here.

**Verified, not just asserted:**
- Full regression suite (trivial case, both synthetic residual-1/3 repros,
  plain-couple no-op, 4-sibling shape) unaffected — this section only
  touches `render()`, never `layout()`.
- Render time back to ~50ms on the real 47-person data (was 5.6s during the
  performance bug above).
- On the real, saved data: one row gap has SIX competing unions at once
  (Pintacuda's two + an unrelated Ertürk child + two Lakes children + a
  Moritz union) — genuinely too dense to fully resolve with a small,
  visually-reasonable candidate set of bend heights. The search still
  finds the mathematical minimum for that group: confirmed directly
  (`baselineAllDefault` vs `bestConflictCount` instrumentation) that the
  plain-default (what rendered before any of this) had **3** union-pair
  conflicts in that one gap; the scheduler gets it down to **2** — a real,
  verified improvement, not a total fix. The reported Pintacuda pair itself
  remains one of the 2 unresolved conflicts in this specific dense cluster;
  a less crowded row gap elsewhere would very likely fully resolve.
- If this is revisited: raising `BEND_FRACTION_CANDIDATES` from 7 to 15
  values was tested and made no difference to this specific 6-union
  group's minimum (still 2) — so the remaining conflict is a genuine
  structural limit of "stagger bend heights" for a cluster this dense,
  not a granularity problem. Fixing this specific case for real would need
  the same kind of real-spacing fix described as "Option A" below (giving
  the tightest cluster more actual horizontal room, not just a different
  bend height) — not attempted here, flagged as the natural next step if
  this dense a cluster recurs.

## 2026-08-14 update: residual issues 1 & 3 reduced (not eliminated) via structuralIdealLeftOf

Both remaining low-priority residuals below (half-sibling anchor dilution,
size-asymmetric marriage block misalignment) were traced to the exact same
root cause: `idealCenterOf` (`js/views/tree.js`) computes ONE flat,
unweighted average across every recorded parent of every member of a whole
block, then translates the entire block — already tightly packed, internal
spacing fixed — as one rigid unit around that single point. The formula
itself is correct when given just one structural sub-unit (a single
marriage-chain cluster, or a same-recorded-parents sibling run within a
cluster); the bug is that it's invoked once, at too coarse a granularity, so
a block with two independently-anchored, differently-sized sub-units can
only satisfy one of them by coincidence.

The fix (`splitIntoAnchorRuns` + `structuralOffsetOf` + `structuralIdealLeftOf`
in `js/views/tree.js`) replaces the single input fed into positioning's
existing one-shot placement — nothing about width reservation, internal
spacing, or the number of positioning passes changes. It splits a block's
flat member sequence into its real structural sub-units by reusing
`sameParentUnion`'s own grouping key (two different marriage-chain clusters
can never share a full parent-set match, so this recovers both a
half-sibling cluster's own anchor-run boundaries AND a marriage-fused
block's own per-cluster boundaries in one pass, with no new data needing to
flow from ordering into positioning), computes each sub-unit's own
already-correct `idealCenterOf`, and averages the implied block-left value
per sub-unit **with one vote per structural unit, not per person** — this is
the exact least-squares solution for minimizing total misalignment across
sub-units, which in practice means it balances the WORST-case misalignment
between sub-units rather than letting one sub-unit's error be arbitrarily
large while the other is coincidentally fine (see verification below). Gated
to activate only on a "simple" block (no interaction with the hub-relocation
machinery from the 3+-marriage fix below) with at least one sub-unit of 2+
members — a plain 1-vs-1 couple, however differently-sized their name boxes,
is untouched and stays byte-for-byte identical to today.

This is deliberately **not** a repeat of either previously-failed fix
attempt documented further down this file (the old algorithm's post-hoc
positional clamp, or the descendant-hint pixel-position pull): it never adds
a correction step after placement and never touches a width/reservation
value — it only changes which single number today's placement was always
going to consume anyway.

**Verified** (no build step or test runner exists in this repo, and `node`
was not installed on the machine this was developed on — verification used
an equivalent harness run through macOS's built-in JavaScriptCore via
`osascript -l JavaScript`; the checked-in `tools/tree-layout-check.js` is the
portable Node version of the same checks, run with `node
tools/tree-layout-check.js`):
- Zero rectangle overlaps, before and after, on every scenario tested
  (trivial 1→2→4→8, a synthetic half-sibling-dilution repro, a synthetic
  size-asymmetric-marriage repro, a plain 1-vs-1 couple with very unequal
  name-box widths, the 4-sibling shape fixed 2026-08-14, and the real,
  saved 47-person `database/family-data.json`).
- The plain-couple and 4-sibling scenarios are **exactly** byte-for-byte
  identical before/after (confirms the no-op guarantee at the two gates,
  not just "close").
- The two synthetic repros show the intended effect: worst-case
  single-sub-unit misalignment drops from 272px→168px (half-sibling
  dilution shape) and 83.5px→28px (size-asymmetric-marriage shape).
- On the real, saved data, the fix engages exactly on the two branches that
  motivated it (Gianfranco Pintacuda's half-sibling cluster; the Ertürk
  siblings-with-spouses cluster) and nowhere else (30 of 47 people's
  positions are untouched, byte-for-byte); overall canvas size
  (`totalWidth`/`totalHeight`) is unchanged; rectangle-overlap count stays
  at 0 before and after.

**Confirmed NOT fixed by this, and out of scope for it**: re-running the
real data's connector-crossing check (grouping same-`midY` connector
segments, flagging genuine interleaving rather than nesting) found the exact
same 3 crossings before and after, byte-for-byte identical pairs — most
notably Greta Pintacuda's connector crossing both Giovanna's and Guido's.
Traced directly: this specific crossing is caused by the ORDER phase (which
member sits left/right within the cluster) disagreeing with which of two
DIFFERENT unions' anchors sits left/right one row up — translating the whole
block, by any amount, preserves the relative order of everything inside it,
so no positioning-phase fix (this one or the fuller recursive one described
below) can ever change whether this specific crossing exists. Fixing it
would mean teaching `orderMembersWithinCluster` (or the barycenter sweep
that decides row order generally) to account for a half-sibling run's own
distinct anchor, not just birth order — a different, deeper change than
either residual issue below describes, and not attempted here. Worth
revisiting as its own issue if it recurs.

**If the remaining misalignment ever needs to go to zero** ("Option A", not
attempted this round): make positioning genuinely recursive instead of
translating a whole block as one rigid unit. `buildBlocksForRow` would need
to additionally return each cluster's own ordered member sequence
(`orderedByCluster`, which it already builds internally but discards);
positioning would generalize its row-of-blocks loop into a shared helper
usable at three nested levels (row→blocks, block→clusters, cluster→anchor-
runs), each sub-unit independently nudged toward its own ideal center using
the exact same unclamped-first/clamped-to-minLeft rule already used one
level up. The hard part: an inner unit can legitimately need MORE width than
today's tight-pack minimum, so this needs a bounded two-pass width
refinement (reserve tight as today, position, inflate any block whose actual
placed width exceeded its reservation, re-run `reserveWidths`'s upward
propagation once, position again — hard-capped at exactly 2 total position
passes, never run to convergence). This is structurally the same
bottom-up-reservation-vs-top-down-real-positions chicken-and-egg problem
Bug 1 below already identified as "not a one-line fix," and touches the
exact machinery (`reserveWidths`) responsible for this file's two worst
historical regressions (the clamp attempt below, and Bug 2's Attempt A) — so
budget a full regression pass (this file's whole scenario table, not just
the two targeted repros) before trusting it, and re-test the Bug 2
oscillation scenario specifically even though the design differs from
Attempt A in two load-bearing ways (a scalar width floor is fed forward,
never a raw pixel position; and it's hard-capped at 2 passes, not run to
convergence).

## 2026-08-14 update: 3+ married siblings fixed (was residual issue 2 below)

A sibling cluster where **3 or more** members each have their own
same-generation marriage (or one person married more than twice) has a
"degree" in the marriage graph exceeding what `buildChain`'s clean two-ended
path logic can place correctly — it fell to the same-file "anything else"
best-effort fallback documented as residual issue 2, producing genuine
crossed marriage lines (a spouse stranded far from their actual partner, or
only one of two remarriage-spouses landing adjacent to their shared partner
— confirmed directly on the reporter's own data: Ezel's spouse and one of
Ümit's two wives were both mis-placed before this fix).

The fix (`classifySatellites` + `spliceSatellites` in `js/views/tree.js`)
narrows the scope precisely to the case that's both common and tractable: a
partner with **no recorded ancestors and only one marriage** contributes
nothing a real chain slot needs — no parents to rank against the row above,
and (since they share every child with whoever they married) no rank lost
from the row below either. Such a partner is pulled out of the marriage
graph entirely before grouping/`buildChain` runs — but only when doing so is
actually necessary, i.e. only for a cluster whose full connection count is
already ≥3 (every cluster that already rendered correctly, degree ≤2, is
completely untouched — zero behavioral change there). Once pulled out, the
bare partner is spliced back in immediately beside their specific spouse
when that row's final member sequence is built: after a lead member, before
a trail member, sandwiched one-per-side for a plain member with two bare
partners (a rootless remarriage) — never mutating the shared, long-lived
cluster object itself (see the non-mutating discipline already established
for the hub-relocation case), only the fresh per-call sequence returned for
that one row-build.

Deliberately still NOT covered, matching the pre-existing best-effort
fallback for the identical reason: two bare partners marrying each other
(already a plain, working pair — nothing to fix), and a person with 3+
marriages of their own (can only ever have 2 true neighbors in one row no
matter what's done here — half-solving it would just trade one bad
arrangement for another). Confirmed via the reporter's own data (a
4-sibling group: one married to a spouse with recorded ancestors of their
own, one married to a bare partner, one married twice to two bare
partners): zero rectangle overlaps and zero marriage-line crossings for this
family. Verifying this fix on the real tree also surfaced a *separate,
pre-existing* crossing one row further down (see residual issue 3 below) —
confirmed independent of this change (reproduces in a minimal synthetic case
with no bare/rootless partner involved at all), not a regression it caused.

## 2026-08-13 update: the layout algorithm was rebuilt from scratch — both bugs below are superseded

Everything from `Bug 1` and `Bug 2` further down in this file describes the
**old** ordering/positioning algorithm in `js/views/tree.js`, which no longer
exists. After the fourth patch attempt on that algorithm (documented under
"Bug 2") caused a *new* regression instead of fixing anything, a test against
the simplest possible tree (one person, two parents, four grandparents, eight
great-grandparents — no half-siblings, no remarriage, nothing unusual) revealed
the deeper problem: months of fixes targeting one specific, unusually complex
real tree had each added a compensating special case, and the accumulated
result could no longer lay out even a trivial tree correctly (6 crossings on
that basic case, versus 0 in a much older, much simpler version of this same
file). The old algorithm was overfit to one dataset rather than correct in
general.

The fix was a full rewrite of the ordering/positioning core (everything from
`computeGenerations` through `layout()` — the rendering shell, filter modal,
print button, and pan/zoom were untouched), following three explicit phases:

1. **Generations** — unchanged from before: blood-depth from parents, then a
   fixpoint pass that pushes a spouse (or their whole ancestor block) to match
   their partner's generation.
2. **Order** (left-to-right sequence within a row, ignoring pixel widths
   entirely) — a standard graph-drawing "barycenter" sweep: alternate a
   top-down pass (each row ranked by the row above, already fixed) and a
   bottom-up pass (each row ranked by the row below, just fixed), repeating a
   handful of times. Deliberately kept to pure integer RANK, never a pixel
   coordinate — the old algorithm's core defect was feeding real pixel
   positions back into an ordering decision, which produced genuine two-state
   oscillations (a couple's left-right order flipping every single pass,
   forever, confirmed via direct pass-by-pass instrumentation). Rank has none
   of that noise.
3. **Position** — a single deterministic top-down pass: reserve width
   bottom-up from each block's own subtree needs, then place left-to-right,
   nudging toward each block's own parents' actual position. Order from step 2
   is never revisited.

Also **dropped entirely** (per explicit instruction to favor general
correctness over any one exotic case): the separate "simple attachment"
splicing subsystem for lone spouses (unified into the same marriage-chain
mechanism every other couple uses — a lone spouse is just a cluster of size
one), and the "in-law docking" mechanism for a rootless family connected only
via a descendant's marriage (the bidirectional rank sweep produces the same
effect for free, without a bespoke search). Both were previously major sources
of bugs in this file.

**Result**, verified on the exact real, saved data that used to produce ~40
connector crossings: **2 remaining crossings**, both a narrow, low-severity
residual (see "Residual issues in the new algorithm" below) — not the
oscillation, not the runaway-canvas-width bug, not the half-sibling overflow.
The trivial 1→2→4→8 case renders with zero crossings.

Three bugs surfaced and were fixed **during** the rewrite itself (i.e. found by
testing the new algorithm, not carried over from the old one) — noted here in
case something regresses:
- `rankMapOf` originally assigned every member of a block the same rank (the
  block's index), not each person's own sequential position — silently
  destroying the one piece of information (which specific spouse is
  numerically ahead of the other) the whole ordering scheme depends on.
- A rank tie (most commonly two parents of the same shared child, whose
  rank-from-below is necessarily identical) must fall back to the row's
  *existing* order, not to name — falling to name lets a sweep with nothing
  new to say silently overwrite a good decision the other sweep direction made
  moments earlier in the very same round.
- When even one cluster/block in a row has NO rank at all for the current
  sweep direction (e.g. a childless leaf during a bottom-up sweep) while its
  neighbors do, comparing them directly is not a neutral tie — Infinity always
  loses, unconditionally, regardless of where that block actually belongs. The
  whole row must fall back to stability once even one member lacks a signal —
  the exact same "don't mix scales" principle the OLD algorithm had already
  learned the hard way (see `allHaveRealAnchor` in the history below) and that
  had to be independently rediscovered here.

## Residual issues in the new algorithm

1. **Half-sibling anchor dilution within one cluster.** ~~When a sibling
   cluster spans a divorced-and-remarried parent's children from both
   relationships (e.g. two kids from a first marriage, one from the second),
   the cluster's overall centering is pulled toward the average of ALL
   recorded parents across every member~~ — **fixed for the common case,
   2026-08-14**, first partially via `structuralIdealLeftOf` (reduced the
   worst-case misalignment 38% in a synthetic repro), then fully superseded
   the same day by the recursive per-run rewrite (see the "real spacing fix"
   update at the top of this file): each half-sibling run now positions
   independently, targeting its own true anchor exactly, rather than voting
   on one shared block-wide translation. Whichever run comes first in a row
   (unconstrained by anything before it) now lands EXACTLY on its own
   anchor; a run after it can still carry a residual if the first run's own
   width plus the required minimum gap leaves less room than the second
   run's anchor would ideally want — traced and confirmed to be a genuine
   consequence of fixed left-to-right order and minimum connector-clearance
   gaps, not a positioning bug, and not fixable without either reordering
   (which the ordering phase deliberately never revisits) or shrinking a
   gap below what's needed to keep connectors legible. Separately: a
   confirmed-independent ORDER-phase issue, where a half-sibling run's row
   position could disagree with which of two unions' anchors sits left/right
   one row up, was ALSO fixed the same day (`orderByAnchorGroup`, see the
   "sibling order" part of the bend-height-scheduler update below) — no
   positioning-phase fix could ever have touched that one, it was a
   genuinely different mechanism. This whole issue is a direct descendant of
   the OLD "Bug 1" below, but far less severe even before today's fixes:
   always a small, position-only spacing gap, never an unbounded shift that
   can overflow into an unrelated neighboring family (the old bug's actual
   failure mode).
2. ~~A sibling group where 3+ members each have their own marriage~~ — **fixed
   2026-08-14** for the common case (see the update at the top of this file):
   any number of a cluster's members may each have their own marriage, as long
   as at most 2 of those marriages are to a partner who has recorded ancestors
   of their own (those 2 still use the pre-existing edge-of-chain mechanism,
   unchanged). A partner with no recorded ancestors never counts against that
   limit — any number of those are fully supported. Genuinely still
   unsupported (best-effort only, matching `buildChain`'s own long-standing
   comment): 3+ siblings each married to a partner who *also* has their own
   recorded ancestors, or one single person married 3+ times.
3. **A block spanning two very differently-sized branches can be pulled off
   its own blood-parent alignment by whichever branch has more members.**
   ~~A marriage fuses two clusters into one block for ordering purposes (so
   partners always land adjacent); that block's rank one row up is a plain
   average across every member's own parents~~ — **fixed, 2026-08-14**, same
   two-stage path as issue 1 above (`structuralIdealLeftOf` first reduced
   the worst-case misalignment 66% in a synthetic repro, then the recursive
   per-run rewrite the same day made it exact): confirmed via the identical
   synthetic repro (a plain 2-sibling family marrying into a plain
   3-sibling family) that BOTH sides now land exactly on their own true
   parents — 0.0px misalignment on both, where Option B's compromise
   average had left 28px on each side. The two-pass width-reservation
   refinement originally floated as necessary for this ("Option A" in the
   now-superseded description) turned out NOT to be needed: overlap-safety
   never depended on reservation being a perfect prediction (a run can only
   ever be pushed further right than a tight-pack estimate, never
   overlapped), so imprecise reservation costs alignment quality at worst,
   never correctness — see the "real spacing fix" update at the top of this
   file for the full reasoning. On the reporter's own densest real cluster
   (6 unions sharing one row gap), this exact-alignment fix doesn't fully
   resolve the connector overlap either, for the same "fixed order + minimum
   gaps" reason described under issue 1 — the bend-height scheduler remains
   the practical mitigation there.

Issue 2's remaining gap (3+ siblings each marrying an ancestor-bearing
partner, or one person married 3+ times) is the only genuinely open item
left in this list — revisit if that shape becomes common enough to matter.
Issues 1 and 3 are considered resolved for the general case as of
2026-08-14; the specific residual each can still carry (a run after the
first absorbing an unavoidable order+gap compromise) is a structural
property of drawing a layered tree with a fixed left-to-right order and
minimum connector-clearance gaps, not a bug being tracked here.

## History (superseded — the algorithm this describes no longer exists)

The sections below document the investigation into the OLD algorithm, kept for
context on what was already ruled out, in case the new algorithm is ever
patched back toward something structurally similar and the same failure modes
start to recur.

---

# Bug 1: half-sibling correction can overlap a neighboring family in the Full Tree view

## The problem, in plain terms

When drawing one generation's row, the layout occasionally needs to nudge a sibling
group sideways so its connector line to their parents doesn't cross a *different*
sibling's connector line — this happens when siblings share one parent but not the
other (a "half-sibling" situation), so they don't sit at exactly the same anchor point.

That nudge doesn't check what's sitting in the neighboring family's space. If the
correction needs more room than was reserved for that group, it shoves the sibling
group sideways into the *next-door, unrelated* family's territory instead — trading one
small, contained crossing for a bigger, uglier one where an unrelated person's
connector now cuts through the middle of a family group that has nothing to do with
them.

### Concrete reproduction (confirmed, reliable)

In the real family data (`/Users/yenal/Downloads/family-data.json` as of 2026-08-12):

- Gianfranco has three recorded children: **Guido** and **Giovanna** (from unions
  where the other parent is unrecorded) and **Greta** (from his union with
  **Micaela**).
- Guido/Giovanna/Greta are one sibling cluster, drawn contiguously.
- Because Greta's parent-pair (Gianfranco *and* Micaela) differs from Guido/Giovanna's
  (Gianfranco alone), the layout nudges Guido/Giovanna sideways to keep their
  connector from crossing Greta's.
- That nudge pushes Guido/Giovanna far enough to collide with **Miriam** (Ezel's
  child, from a completely unrelated branch), who ends up rendered *between* Guido and
  Greta, with her own connector visibly crossing through Gianfranco's family group.

This surfaced originally as two reported "generation" bugs:
- **bug1_gen_gap**: adding a father to Wilhelm Lakes (a root/no-parents person)
  throws off unrelated parts of the tree.
- **bug2_clustering**: adding a full layer of great-grandparents above the existing
  grandparents generation doesn't cluster properly to family subunits.

Both were traced through several layers before landing on this as the actual,
final root cause — see "Investigation trail" below for what was ruled out along the
way, since those turned out to be real (and fixed) but *different* bugs from this one.

## Why it's not tied to "adding a generation" specifically

This is a general layout bug, not a generation-counting bug. It happens whenever:
1. A sibling cluster contains a "half-sibling" split (some siblings share only one
   parent with the others), **and**
2. That cluster ends up sitting immediately next to a narrow, unrelated group in the
   same row.

Adding an ancestor or a whole generation layer is just one way to shuffle the row
enough to put those two conditions together — it happened to be how this was
discovered, but fixing "add a generation" specifically would not fix the underlying
bug, and the bug can in principle recur any time a tree has this kind of half-sibling
shape next to a tight neighbor, with no generation changes involved at all.

## Where the bug lives (confirmed via direct instrumentation, not guesswork)

File: `js/views/tree.js`

- `placeClusterRuns` (~line 1149, at time of writing) splits a cluster's members into
  "anchor runs" (`splitIntoAnchorRuns`) — contiguous siblings that share the exact same
  real parent-position anchor. A half-sibling with a different anchor starts a new run.
- It then applies a correction: if one run's connector would cross the next run's
  anchor, it shifts that run (and everything before it) sideways by exactly the amount
  needed to clear it — with **no bound against the group's own reserved slot**, let
  alone the neighboring group's slot.
- `reserveGroupWidths` (~line 1096) decides how much horizontal room each row group
  gets, but does this in a separate, **bottom-up, position-agnostic** pass — it only
  knows about text widths and subtree width, never actual pixel positions. It has no
  way to know, at reservation time, that a downstream anchor-run correction will need
  extra room, because that correction's size depends on real anchor positions that
  don't exist until the (later, top-down) positioning pass runs.

This split between *when room is reserved* (bottom-up, before any positions exist) and
*when the correction that needs extra room actually runs* (top-down, using real
positions) is the structural reason this isn't a one-line fix.

## What was tried, and why it didn't work

Attempted fix: bound the correction's shift so it can never push a run's start/end
past the enclosing group's own reserved `[left, left + slotWidth)` boundary — i.e.
accept a smaller, residual crossing within the group rather than let it bleed into a
neighbor.

Result: **regressed every previously-clean scenario**, plus made both original bug
scenarios worse:

| Scenario | Before this attempt | After this attempt |
|---|---|---|
| baseline (real data, unmodified) | 0 overlaps | 1 overlap |
| gianfranco_former_wife | 0 | 1 |
| gianfranco_brother_plus_former_wife | 0 | 1 |
| umit_former_wife | 0 | 1 |
| bug1_gen_gap (add Wilhelm's father) | 4 | 9 |
| bug2_clustering (add great-grandparent layer) | 14 | 16 |

Conclusion: ordinary, already-correct trees are *also* relying on some of that same
unclamped "borrowed" space to render correctly today — the group's own reserved slot
is often already tight enough that clamping against it blocks legitimate, harmless
shifts too, not just the problematic ones. **This fix was reverted; nothing from this
attempt is in the real codebase.**

## Investigation trail (for context — these were real, and are already fixed)

Two other, genuinely distinct bugs were found and fixed earlier in the same
investigation, before landing on the issue above. They are **done** and not part of
what's left to solve, but are noted here so the history isn't confusing on re-read:

1. **Docking/merge eligibility was row-relative, not data-based.** In
   `attachRootlessGroups`, whether a couple counts as having a "real ancestor" (and is
   therefore eligible to be a docking target for an unrelated, genuinely-rootless
   couple connected only by a descendant's marriage) depended on `anchorOfCluster`
   resolving against the row *directly above* — which returns "no ancestor" both for a
   truly rootless person *and* for anyone at all when there's no row above yet (e.g.
   the topmost row). Fixed by replacing it with a direct, stable, data-only check
   (`clusterHasBloodAncestor`: does this person have any recorded parent at all,
   period). Verified safe, zero regressions — **this fix is worth keeping** regardless
   of what happens with the rest of this issue.

2. **Bottom-up structural seeding for anchor-less rows — tried, reverted.** To address
   the topmost-row-ordering half of the original two bugs, a `computeBottomUpOrder`
   pre-pass was added: order every row from the deepest generation upward using only
   marriage/sibling structure (ignoring real anchors, which don't exist yet going
   bottom-up), then seed the real top-down pixel layout's first pass with this
   instead of null/alphabetical order. This did NOT fix bug2's mismatch and made its
   overlap count slightly worse (14 → 18), because — once instrumented — it turned out
   the row-to-row *ordering* was already correct in these scenarios (Phase A). The
   actual crossings are a Phase B (pixel positioning) problem, per the sections above.
   **This fix was reverted; nothing from this attempt is in the real codebase either.**

The upshot: **only item 1 above (`clusterHasBloodAncestor`) is worth re-applying** when
this is picked up again — it's a real, safe improvement, just not the fix for the
overlap bug itself. Items 2 and the Phase B clamp attempt were both dead ends and
don't need to be re-tried in the same form.

## Suggested plan for next time

1. **Re-apply the safe fix first** (item 1 above): swap `anchorOfCluster(...) !==
   Infinity` for a direct `clusterHasBloodAncestor` data check in
   `attachRootlessGroups`. Zero risk, already verified.

2. **Rebuild the reproduction harness** before touching anything else. It is not
   saved anywhere (scratch copies were deleted per this session's cleanup discipline).
   Reconstructing it means, starting from `/Users/yenal/Downloads/family-data.json`:
   - `baseline` — unmodified data.
   - `gianfranco_former_wife` — add a parentless "Francesca" as Gianfranco's former
     wife.
   - `gianfranco_brother_plus_former_wife` — also add "Giuseppe" as a second child of
     nonno/nonna Pintacuda.
   - `gianfranco_brother_plus_former_wife_micaela_with_sibling` — also give Micaela a
     sibling.
   - `umit_former_wife` — add a parentless "MoritzMom" as the second partner (status
     `former`) on Ümit's existing single-partner union that has Moritz as a child.
   - `bug1_gen_gap` — add a single-partner union making "WilhelmFather" Wilhelm Lakes's
     father.
   - `bug2_clustering` — add a single-partner-union ancestor above each of: both
     Pintacuda grandparents, both Rossi Nove grandparents, Kemal, Tomris, Wilhelm,
     Gertrud (8 new ancestors total).
   - Serve via `python3 -m http.server <fresh port>`, load via
     `App.getState().data = <scenario>; App.switchView('tree')`, read node positions
     from `[data-person]` `transform` attributes and connector paths from
     `path.tree-link`'s `d` attribute, grouping "crossing" pairs that share a `midY`
     and overlapping horizontal x-ranges but don't share a start anchor (which would
     just be normal same-parent fan-out).
   - Confirm the "before any fix" overlap baseline still matches the table above
     before trying anything new — the app or the sample data may have changed.

3. **Design the real fix around reservation, not correction-time clamping.** The
   clamp approach is a dead end (see above) — it treats the symptom at the wrong
   layer. The actual gap is that `reserveGroupWidths` (bottom-up, no real positions)
   can't currently know that a downstream anchor-run correction (top-down, needs real
   positions) will need extra room. Two directions worth exploring, roughly in order
   of how contained they are:
   - **Two-pass width refinement**: run one full layout pass as today, measure how
     much each anchor-run correction actually had to shift things by (and whether it
     hit a slot boundary), feed that as an extra reservation "pad" into a second
     `reserveGroupWidths` pass, and re-run positioning. This mirrors the existing
     multi-pass convergence pattern already used elsewhere in this file (see
     `rowOrderSignature`-driven convergence in `layout()`) — i.e. don't invent a new
     mechanism, extend the one that already exists for a structurally similar problem
     (settling on a stable arrangement over a few passes rather than getting it right
     in one shot).
   - **Conservative worst-case pre-sizing**: at reservation time, detect clusters that
     contain a half-sibling anchor-run split at all (this doesn't require real
     positions — `splitIntoAnchorRuns`'s grouping key, "same recorded parent set," is
     knowable from the data alone) and reserve some extra fixed padding for them
     up front, sized off `HALF_SIBLING_MARGIN` and typical node width rather than an
     exact real-position computation. Cruder, but avoids restructuring the two-pass
     split entirely.
   - Whichever direction is chosen, **re-run the full regression table above after
     every change**, including the "before this attempt" 0/0/0/0/4/14 baseline —
     the fix isn't done until every one of those is at or below its original count,
     not just the two originally-reported bugs.

4. **Do not re-attempt the plain clamp-after-the-fact approach** in its original form
   — it's confirmed to regress ordinary cases because ordinary cases already rely on
   some of that unclamped borrowed space. Any bound placed on the correction needs to
   come from *more reserved room*, not a tighter ceiling on the existing room.

---

# Bug 2: a couple's own ancestors can end up swapped, and the row order oscillates forever

Status: **unsolved. Root cause precisely confirmed via direct pass-by-pass
instrumentation (not guesswork). Two fix attempts tried, both reverted** — one
caused a canvas-size explosion, the other fixed the narrow case it targeted but
revealed/caused a worse, broader oscillation. Distinct from Bug 1 above (different
mechanism, different code path), though both surface as "connectors overlap when a
generation is added on top."

## The problem, in plain terms

When BOTH partners of a married couple get their own, separate ancestor-couple added
above them (e.g. Wilhelm gets his own parents, Gertrud gets her own, different,
parents) — the two ancestor-couples can render swapped relative to which spouse they
actually belong to. Concretely, in the user's real data (`database/family-data.json`
as of 2026-08-13):

- **nonno pintacuda** sits left in his row, but *his* parents (uroma+uropa pintacuda)
  end up centered to the right — past where his wife nonna sits.
- **nonna pintacuda** sits right, but *her* parents (nonnonna+nonnonno) end up centered
  to the left — past where her husband nonno sits.
- The same exact pattern occurs simultaneously on two other branches in the same
  dataset: Lakes (Wilhelm/Gertrud) and Ertürk (Kemal/Tomris). It does NOT occur on the
  fourth, structurally similar branch (Rossi Nove), because there one partner (nonna
  rossi nove) has no recorded parents at all — see mechanism below for why that
  asymmetry matters.

The connectors themselves are not "wrong" (each ancestor pair does reach its actual
specific child) — the two ancestor-pairs are just positioned in the opposite left-right
order from their children, so the connectors visually cross in an X.

## Root cause (confirmed via direct pass-by-pass instrumentation)

File: `js/views/tree.js`, function `orderClustersWithinGroup` (decides, for a married
couple with no siblings of their own — two single-person clusters joined only by
marriage — which spouse's cluster is positioned left and which is right).

That decision uses, in priority order: (1) `anchorOfCluster` — the spouse's OWN
parents' sequence position in the row above, from the CURRENT layout pass; (2)
`descendantHintAnchor` — the spouse's own children's average position, from the
PREVIOUS layout pass; (3) name, as a last-resort tie-break.

For a plain couple, (2) always ties: both partners share the same children, so "my own
child's position" is identical for both parents of that child. That leaves (1),
`anchorOfCluster`, as the only thing that actually decides left-vs-right — but
`anchorOfCluster` is a sequence index in the row above, and THAT row's own order (it
has no ancestors of its own, so it's ordered by hint, not anchor) is decided using
hint values that are themselves each spouse's OWN specific position from the previous
pass.

This is a closed loop between exactly two adjacent rows: the couple's left-right order
depends on the ancestor row's order (via anchor), and the ancestor row's order depends
on the couple's own left-right order from last pass (via hint, since each spouse's
specific pixel position is what the hint reads). Confirmed directly by logging
`orderClustersWithinGroup`'s actual sort keys on every one of the 9 layout passes: for
`nonno`/`nonna` pintacuda, the decision **flips every single pass** —
`nonna(2.5) < nonno(8.5)` on pass 1, `nonno(10.5) < nonna(12.5)` on pass 2,
`nonna(0.5) < nonno(2.5)` on pass 3, `nonno(0.5) < nonna(2.5)` on pass 4, and so on,
alternating for all 9 passes with no sign of settling. This is a genuine two-state
oscillation, not just "converges to the wrong answer" — the loop simply stops after a
fixed pass count and keeps whatever the last pass happened to land on, which is why the
ancestor row (still reflecting an older, out-of-sync pass) doesn't match the couple's
final order.

The Rossi Nove branch doesn't oscillate because `nonna rossi nove` has no parents at
all — her `anchorOfCluster` is permanently `Infinity`, so `nonno rossi nove` (who has
real parents) always wins the comparison regardless of pass — nothing to flip.

## What was tried, and why it didn't work

### Attempt A: pull a rootless group's pixel position toward its descendant's position

Extended `idealCenterForGroup` (Phase B positioning) to fall back to the group's own
descendant hint (already used for ordering) when it has no parents to position against
— the idea being that a lone new top generation should be pulled toward wherever its
descendants actually rendered, instead of packing from the canvas's left edge with no
relationship to them.

This looked correct on an isolated two-couple synthetic test (0 overlaps, viewBox a
sane size) — that test was NOT representative. Applied to the real, saved data
(45+ people, ancestors added across multiple branches simultaneously), it caused the
canvas width to explode from ~3570px to ~9640px, with all 45 people crammed into the
rightmost ~38% of that canvas and a huge empty gap on the left — reported by the user
as "a tiny family tree squashed into the right side of the window." Root cause: the
multi-pass loop re-runs the full layout several times to let things settle, and once a
rootless group's PIXEL position (not just its order) depends on the previous pass's
result, there is nothing pulling the very first group in a row back toward the left
edge — each pass nudges the whole tree a bit further right than the last, with no
re-centering force, so it walks away from zero across the 8 refinement passes instead
of converging. **Fully reverted; nothing from this attempt is in the real codebase.**
Lesson: test positioning changes against the actual saved data (`database/family-data.json`),
never only a small synthetic scenario — this class of instability only appears once
multiple independently-oscillating parts of the tree exist at once.

### Attempt B: disable the unstable anchor comparison for a plain, tied-hint couple

Directly targeted the confirmed oscillation: when `orderClustersWithinGroup` has
exactly two clusters (a plain couple, no siblings, no hub/chain) and both clusters'
descendant hints are non-null and equal (proof they share the same children — the tied
case described above), force `anchorOfCluster` to `Infinity` for both, so the decision
falls through the same existing tie-break chain straight to name — stable, since name
depends on nothing computed during layout. This is narrowly scoped: it does NOT touch
groups with 3+ clusters (the Ümit/Gianfranco "hub between two spouses" sandwich cases
fixed earlier this session use exactly that shape, and were confirmed unaffected), and
does not touch couples whose hints genuinely differ (e.g. a remarried partner with
children from another relationship).

Tested against the exact 45-person real dataset that reliably reproduces the 3
reported crossings (Pintacuda, Lakes, Ertürk): it DID eliminate the specific
within-couple flip it targeted (confirmed via direct pass logging — no more
alternation for `nonno`/`nonna`). But the FOUR grandparent-generation family groups
(Pintacuda / Rossi Nove / Lakes / Ertürk) then started swapping their OWN relative
order between passes instead — a broader oscillation at the family-group level that
the original, unfixed code did NOT exhibit for this same dataset (confirmed: the
unfixed code renders a stable, consistent [Pintacuda, Rossi Nove, Lakes, Ertürk] order
in both the ancestor row and the grandparent row, every time). Net effect: 3 crossings
→ 50+ crossings across the row. **Fully reverted; nothing from this attempt is in the
real codebase.** Lesson: this tree's specific shape has (at least) two coupled
instabilities — within-couple and between-family — and they interact: damping one
appears to free up degrees of freedom that let the other oscillate more visibly than
before. A fix needs to address the underlying circular row-to-row dependency directly,
not neutralize one specific symptom of it.

## What's confirmed and re-usable for next time

- The **exact reproduction data**: `database/family-data.json` (the user's real,
  live file — check it hasn't moved or been further edited) with
  `data.treeViewHiddenPeople = []` (many of the ancestor/test people are currently
  hidden via the tree's own person-filter, which is a display preference, not part of
  the underlying data — clear it to `[]` when testing this bug specifically, or the
  crossing won't render at all since the people involved won't be drawn).
- The **debug instrumentation pattern** that found this precisely: log
  `orderClustersWithinGroup`'s `sortKey(i)` output (anchor, hint, name) for the
  relevant clusters, tagged with a pass counter incremented once per `runLayoutPass`
  call in `layout()`'s loop (`window.__DEBUG_PASS`). This is what revealed the
  oscillation was a genuine flip-every-pass cycle, not a one-time wrong settle — prior
  reasoning about "which anchor should be stable" repeatedly turned out wrong until
  this was added; don't skip straight to hand-tracing again.
- **`clusterHasBloodAncestor` (Bug 1's Attempt, item 1 in that section) is unrelated
  to this bug and still safe/worth applying independently** if picked up.

## Suggested plan for next time

1. **Rebuild the reproduction environment from `database/family-data.json` directly**
   (not `~/Downloads/family-data.json`, which is a stale, much smaller snapshot from
   earlier in this investigation and does not reproduce Bug 2 at all — it has only 25
   people and none of the multi-branch ancestor additions). Remember to clear
   `treeViewHiddenPeople`. Re-confirm the 3-crossing baseline
   (`wilhelm senior -> Wilhelm Lakes` × `uroma lakes -> Gertrud Lakes`;
   `uropa pintacuda -> nonno pintacuda` × `nonnonna -> nonna pintacuda`;
   `uroma erturk -> Kemal Ertürk` × `annex3 -> Tomris Ertürk`) before trying anything —
   the live file changes as the user keeps working in the app.

2. **Any fix must address the row-to-row circularity directly, at whatever
   granularity it occurs** — not suppress one specific symptom of it. Concretely, that
   likely means: don't let a row's order depend, even indirectly through a chain of
   hints, on a lower row's order that itself depends on the first row's order from the
   same or an adjacent pass. Ideas not yet tried:
   - Detect an oscillating pair of pass-signatures directly (two states that
     alternate — signature at pass N equals signature at pass N-2 but not N-1) in
     `layout()`'s convergence loop, and when detected, deterministically pick ONE of
     the cycle's members (e.g. whichever produces the lexicographically smaller
     `rowOrderSignature`) rather than whatever the fixed pass count happens to stop
     on. This is more general than Attempt B (handles oscillation at ANY granularity —
     within-couple, between-family, or both at once) and touches only the outer
     `layout()` loop, not `orderClustersWithinGroup`'s carefully-tuned internal logic —
     likely lower risk to the Ümit/Gianfranco sandwich cases. Not yet attempted; needs
     the same full regression suite (this session's established scenarios AND the
     45-person real-data 3-crossing case AND a check that family-group order stays
     stable) before trusting it.
   - Alternatively: seed the very FIRST pass (before any hints exist at all) with
     something better than pure alphabetical order, so the oscillation never gets a
     foothold in the first place — but Attempt A already showed that seeding pixel
     POSITION this way is unsafe; seeding at the ORDER/rank level only (never touching
     Phase B positioning) might be safer, but is unverified and was not attempted this
     round given time spent on Attempts A and B.

3. **Test every candidate fix against BOTH the within-couple oscillation AND the
   family-group oscillation simultaneously** — Attempt B proved these can trade off
   against each other. A fix that silences one without checking the other is not done.

4. **Do not re-attempt Attempt A (descendant-hint pixel positioning) or Attempt B
   (disable anchor for tied-hint pairs) in their tried forms** — both are confirmed
   regressions, for the specific reasons above.

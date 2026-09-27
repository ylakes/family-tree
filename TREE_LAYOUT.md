# Full Tree layout

How the Full Tree view (`js/views/tree.js`) places people and draws lines,
and how to check changes to it. This replaces the old
`KNOWN_ISSUE_tree_layout_overlap.md` investigation log, which described a
previous algorithm that no longer exists (see git history if needed).

## Goals, in priority order

1. Lines of different families never run on top of each other, never
   touch each other, and never pass through a person's box.
2. As few line crossings as possible.
3. Partners stand side by side (someone with two partners stands between
   them); children sit under their parents.
4. Siblings in birth order, unless another order avoids a crossing.

Width and height are not constrained: the drawing grows wherever that
buys a cleaner result.

## Pipeline

Every step only consumes the previous step's output — nothing feeds back.

1. **Generations** (`computeGenerations`, also used by Statistics).
   A child is always at least one row below each parent. Partners share a
   row whenever that doesn't contradict the first rule (it can't, e.g.,
   for someone partnered with their sibling's grandchild — that couple is
   drawn with a diagonal line across rows). Parent→child links are then
   kept as short as possible. Every step is bounded, so contradictory
   data can't make it run away (the previous version could produce 160+
   rows for such data).
2. **Items, connectors, blocks** (`buildComponentGraph`). A parent→child
   link that skips rows gets an invisible dummy item in every row it
   passes, so each connector spans exactly one row gap. People married
   within a row form a block that always stays together; a block can have
   several valid internal arrangements (mirror image; which side each of
   3+ partners stands on).
3. **Order** (`orderComponent`). Left-to-right order of blocks in each
   row, minimizing `crossings × 1000 + birth-order inversions` (crossings
   counted as if every connector were straight lines from the parents to
   each child). Barycenter sweeps from several deterministic starts, then
   a local search (swap neighbors / try other arrangements, keep only
   strict improvements), then iterated local search with random
   perturbations from a seeded generator. The iteration count depends
   only on the size of the tree, so the same data always gives the same
   drawing.
4. **Coordinates** (`positionComponent`). With the order fixed, x
   positions minimize the squared distance of each child to their parents'
   drop point and of each couple to the center of their children, plus a
   pull between partners and mild compaction, subject to minimum gaps.
   Each row is solved exactly (weighted isotonic regression) and rows are
   iterated to convergence. A penalty term keeps children from sitting
   under a neighboring family's drop point, which would force a crossing
   no matter how lanes are ordered.
5. **Lanes** (`assignLanes`). Each family's horizontal line gets its own
   height ("lane") in the gap below the parents. The vertical order of
   lanes that overlap horizontally is chosen by exact search (dynamic
   programming over subsets, up to 12 interacting families; greedy + swaps
   beyond that) to minimize crossings, heavily penalizing any order that
   would make two vertical lines coincide. Families far apart horizontally
   share a lane. Each gap is made just tall enough for its lanes, so rows
   with many families get taller and quiet rows stay compact.

Rendering details: a couple's line to their children always starts at
the middle of the line between the two partners. A single child whose box
edge can be reached straight down from there gets a straight line, meeting
the child's box within the middle half of its edge (so the line may land
a little off the child's middle); otherwise the line takes a sideways
step. Several families dropping from the same person, or into the same
child, are nudged apart by a few pixels. Only where a couple's drop would
run less than 10px beside another family's vertical line (checked after
lanes are assigned, so only lines that really run side by side count)
does it move along the couple's line just enough to keep them apart.

Remaining crossings (`markCrossings`): wherever two different families'
lines still cross, one is drawn with a small gap so it reads as running
behind the other. Fixed order, front to back: vertical lines (each leads
from a couple to one child, so it stays unbroken), horizontal lines,
diagonal lines between partners in different rows. Each link keeps its
unbroken geometry in `rawSegs` for the checks.

Highlighting (`wireHighlighting`, in the view): pointing at a person
lights up all lines of their families (as a child and as a partner);
pointing at a line lights up that family (for a marriage line, the couple
and their children's lines) and fades everything else. Clicking a line
keeps the highlight until the line or empty canvas is clicked again. A
click that ends a drag is ignored. Partners who can't stand side by side
(someone with 3+ partners) are joined by a line in the lane area below
them, from which their children hang.

The layout result is cached and recomputed only when a name, a date or a
union changes.

## Checking a change

```bash
node tools/tree-layout-check.js path/to/family-data.json
```

or, without Node, with macOS's built-in JavaScriptCore:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tools/tree-layout-check.js -- path/to/family-data.json
```

(run from the repository root; the data file is optional). It lays out
the hand-built scenarios and 12 seeded synthetic families from
`tools/tree-test-lib.js`, plus the data file (with and without the hidden
people), and measures the actual drawn geometry: crossings, touching
lines, overlapping lines, lines running side by side less than 6px apart,
lines through boxes, box overlaps, and couples not standing side by side.
It also checks that every crossing got its gap (the lines as actually
drawn must not cross or touch at all). Any of these except crossings and
couples apart is reported as a failure. The synthetic generator
covers remarriage with half-siblings, 3+ partners, marriages between
branches and between cousins, spouses with their own ancestors and
siblings, single parents, children listed under two unions, and
marriages across generations.

Text widths are approximated in the check (no browser), so pixel sizes
differ slightly from the app.

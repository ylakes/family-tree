// Data model: schema helpers, date utilities, graph traversal, validation,
// and pure relationship inference over people/unions. Nothing here touches
// the DOM or storage — it's a pure functional layer over the in-memory data.
const DataModel = (() => {
  const SCHEMA_VERSION = 1;

  function uuid() {
    return crypto.randomUUID();
  }

  function createEmptyData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      meta: { lastModified: new Date().toISOString() },
      // Advanced/optional override for the app title shown in the header —
      // empty by default, meaning "use the active language's app.title
      // string." Not exposed anywhere in the UI; edit the JSON file
      // directly to set one.
      title: '',
      // Person ids hidden from the Full Tree view only — a display
      // preference for simplifying a large or heavily-blended tree, not a
      // data change. Lives here (rather than browser localStorage) so it
      // travels with the file across computers, same as everything else.
      treeViewHiddenPeople: [],
      people: {},
      unions: {},
    };
  }

  function createEmptyDate() {
    return { year: null, month: null, day: null };
  }

  function createPerson(overrides = {}) {
    return {
      id: uuid(),
      firstName: '',
      lastName: '',
      maidenName: '',
      gender: '',
      birthDate: createEmptyDate(),
      deathDate: createEmptyDate(),
      isDeceased: false,
      birthPlace: '',
      deathPlace: '',
      occupation: '',
      notes: '',
      email: '',
      phone: '',
      photo: '',
      ...overrides,
    };
  }

  function createUnion(overrides = {}) {
    return {
      id: uuid(),
      partners: [],
      type: 'marriage',
      status: 'current',
      startDate: createEmptyDate(),
      endDate: createEmptyDate(),
      children: [],
      childRelationType: {},
      ...overrides,
    };
  }

  // ---------- Dates ----------
  //
  // Dates carry whatever the user actually entered — any subset of
  // year/month/day, all optional. There is no separate "precision" field to
  // keep in sync; every consumer derives what it can display or compute
  // from whichever fields are present:
  //   - year only          -> approximate age, no calendar birthday
  //   - month + day only   -> calendar birthday, no age
  //   - year + month + day -> both

  function hasYear(d) {
    return !!d && d.year !== null && d.year !== undefined;
  }

  function hasMonthDay(d) {
    return !!d && d.month !== null && d.month !== undefined && d.day !== null && d.day !== undefined;
  }

  // True if there's anything at all worth displaying.
  function hasDate(d) {
    return hasYear(d) || hasMonthDay(d);
  }

  function dateToComparable(d) {
    if (!hasDate(d)) return null;
    const y = d.year ?? 0;
    const m = (d.month ?? 1) - 1;
    const day = d.day ?? 1;
    return new Date(y, m, day).getTime();
  }

  // Locale-aware: month names and day/month ordering follow the active UI
  // language (e.g. German renders "6. Januar" — day before month — not a
  // literal word-for-word swap of the English "January 6" layout).
  function currentLocale() {
    return (typeof I18n !== 'undefined' && I18n.getCurrentLang) ? I18n.getCurrentLang() : 'en';
  }

  function formatDate(d, t) {
    if (!hasDate(d)) return t('person.unknown');
    const locale = currentLocale();
    if (hasYear(d) && hasMonthDay(d)) {
      return new Date(d.year, d.month - 1, d.day).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    }
    if (hasYear(d) && d.month) {
      return new Date(d.year, d.month - 1, 1).toLocaleDateString(locale, { year: 'numeric', month: 'long' });
    }
    if (hasYear(d)) return String(d.year);
    // hasMonthDay(d) must be true here
    return new Date(2000, d.month - 1, d.day).toLocaleDateString(locale, { month: 'long', day: 'numeric' });
  }

  // Age in whole years as of `asOf` (Date object). Returns null when the
  // birth year is unknown — age can't be derived from month/day alone.
  function computeAge(birthDate, asOf, endDate) {
    if (!hasYear(birthDate)) return null;
    // endDate, when passed at all, pins the calculation to that specific
    // date (e.g. age at death) instead of "as of now" — if it's given but
    // its year isn't known, there's no date to measure against, so the
    // age is unknowable too. That's different from endDate simply not
    // being passed (living person, asOf correctly means "now").
    if (endDate && !hasYear(endDate)) return null;
    const end = endDate || null;
    if (!birthDate.month || (end && !end.month)) {
      const endYear = end ? end.year : asOf.getFullYear();
      return endYear - birthDate.year;
    }
    const birthMs = dateToComparable(birthDate);
    const endMs = end ? dateToComparable(end) : asOf.getTime();
    const birth = new Date(birthMs);
    const endD = new Date(endMs);
    let age = endD.getFullYear() - birth.getFullYear();
    const hadBirthdayYet = (endD.getMonth() > birth.getMonth()) ||
      (endD.getMonth() === birth.getMonth() && endD.getDate() >= birth.getDate());
    if (!hadBirthdayYet) age -= 1;
    return age;
  }

  function fullName(person) {
    if (!person) return '';
    const name = `${person.firstName || ''} ${person.lastName || ''}`.trim();
    return name || null;
  }

  // ---------- Graph lookups ----------

  function getPerson(data, id) {
    return data.people[id] || null;
  }

  function getUnion(data, id) {
    return data.unions[id] || null;
  }

  function allPeople(data) {
    return Object.values(data.people);
  }

  function allUnions(data) {
    return Object.values(data.unions);
  }

  // Unions where personId appears as a partner
  function unionsAsPartner(data, personId) {
    return allUnions(data).filter((u) => u.partners.includes(personId));
  }

  // Unions where personId appears as a child
  function unionsAsChild(data, personId) {
    return allUnions(data).filter((u) => u.children.includes(personId));
  }

  function getParents(data, personId) {
    const ids = new Set();
    unionsAsChild(data, personId).forEach((u) => u.partners.forEach((p) => ids.add(p)));
    return [...ids].map((id) => getPerson(data, id)).filter(Boolean);
  }

  function getChildren(data, personId) {
    const ids = new Set();
    unionsAsPartner(data, personId).forEach((u) => u.children.forEach((c) => ids.add(c)));
    return [...ids].map((id) => getPerson(data, id)).filter(Boolean);
  }

  function getPartnerUnions(data, personId, statusFilter) {
    let unions = unionsAsPartner(data, personId);
    if (statusFilter === 'current') unions = unions.filter((u) => u.status === 'current');
    if (statusFilter === 'former') unions = unions.filter((u) => u.status !== 'current');
    return unions;
  }

  function otherPartner(union, personId) {
    return union.partners.find((p) => p !== personId) || null;
  }

  // The existing union (if any) that already has exactly these two people
  // as partners — used before creating a new union between two people, so
  // an already-recorded couple never ends up linked by two separate,
  // duplicate unions (each then listing the other as a partner twice).
  function findUnionBetween(data, aId, bId) {
    return unionsAsPartner(data, aId).find((u) => u.partners.includes(bId)) || null;
  }

  // Full siblings share a union; half-siblings share exactly one parent
  // across different unions.
  function getSiblings(data, personId) {
    const myUnions = unionsAsChild(data, personId);
    const myUnionIds = new Set(myUnions.map((u) => u.id));
    const myParentSets = myUnions.map((u) => new Set(u.partners));

    const full = new Set();
    const half = new Set();

    for (const u of allUnions(data)) {
      for (const childId of u.children) {
        if (childId === personId) continue;
        if (myUnionIds.has(u.id)) {
          full.add(childId);
        } else {
          const theirParents = new Set(u.partners);
          const sharesOne = myParentSets.some((mySet) => {
            let overlap = 0;
            theirParents.forEach((p) => { if (mySet.has(p)) overlap += 1; });
            return overlap === 1;
          });
          if (sharesOne && !full.has(childId)) half.add(childId);
        }
      }
    }
    half.forEach((id) => { if (full.has(id)) half.delete(id); });
    return {
      full: [...full].map((id) => getPerson(data, id)).filter(Boolean),
      half: [...half].map((id) => getPerson(data, id)).filter(Boolean),
    };
  }

  // BFS up the ancestor graph. Returns Map<personId, {depth, via:Set<ancestorAtDepth1>}>
  function ancestorDepths(data, personId) {
    const depths = new Map();
    let frontier = [personId];
    let depth = 0;
    const visited = new Set([personId]);
    while (frontier.length) {
      const next = [];
      depth += 1;
      for (const id of frontier) {
        for (const parent of getParents(data, id)) {
          if (!depths.has(parent.id)) depths.set(parent.id, depth);
          if (!visited.has(parent.id)) {
            visited.add(parent.id);
            next.push(parent.id);
          }
        }
      }
      frontier = next;
      if (depth > 12) break; // safety bound against malformed data
    }
    return depths;
  }

  function wouldCreateCycle(data, childId, parentId) {
    if (childId === parentId) return true;
    // If parentId is a descendant of childId, adding childId->parentId would cycle.
    const descendants = new Set();
    let frontier = [childId];
    const visited = new Set([childId]);
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        for (const child of getChildren(data, id)) {
          if (child.id === parentId) return true;
          if (!visited.has(child.id)) {
            visited.add(child.id);
            next.push(child.id);
            descendants.add(child.id);
          }
        }
      }
      frontier = next;
    }
    return false;
  }

  // ---------- Deletion ----------

  function describeDeletionImpact(data, personId) {
    const asPartner = unionsAsPartner(data, personId);
    const asChild = unionsAsChild(data, personId);
    return { asPartner, asChild };
  }

  function cascadeDeletePerson(data, personId) {
    delete data.people[personId];
    for (const union of allUnions(data)) {
      union.partners = union.partners.filter((p) => p !== personId);
      union.children = union.children.filter((c) => c !== personId);
      if (union.childRelationType && union.childRelationType[personId]) {
        delete union.childRelationType[personId];
      }
    }
    // Remove unions left with no partners and no children — they no longer
    // describe any relationship.
    for (const [id, union] of Object.entries(data.unions)) {
      if (union.partners.length === 0 && union.children.length === 0) {
        delete data.unions[id];
      }
    }
  }

  // ---------- Relationship inference ----------

  // Ordinal suffix rules are language-specific (English "1st/2nd/3rd/4th",
  // German "1./2./3." — always just a period, Italian "1º/2º/3º" — always
  // the masculine ordinal indicator, since every noun this attaches to
  // here — "cugino" — is masculine). Falls back to the English pattern for
  // any locale that isn't specifically handled.
  function ordinal(n) {
    const locale = currentLocale();
    if (locale.startsWith('de')) return `${n}.`;
    if (locale.startsWith('it')) return `${n}º`;
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Gender is free text (schema allows any string, with male/female/other/
  // unknown as suggestions). Normalize to 'male'|'female'|null so gendered
  // terms (father/mother, brother/sister, ...) can be picked when known and
  // fall back to the neutral term otherwise.
  function normalizeGender(gender) {
    if (!gender) return null;
    const g = String(gender).trim().toLowerCase();
    // Recognizes the suggested words from every registered language's
    // gender datalist (see i18n/<lang>.js "gender" keys), not just English —
    // otherwise picking a translated suggestion wouldn't trigger gendered
    // relationship terms.
    if (['male', 'm', 'man', 'boy', 'männlich', 'mann', 'junge', 'maschio', 'uomo', 'ragazzo'].includes(g)) return 'male';
    if (['female', 'f', 'w', 'woman', 'girl', 'weiblich', 'frau', 'mädchen', 'femmina', 'donna', 'ragazza'].includes(g)) return 'female';
    return null;
  }

  // Same idea as normalizeGender, but also recognizes "other"/"unknown"
  // synonyms — used only for re-localizing a stored gender value for
  // display (see genderDisplayLabel), not for relationship-gendering.
  function genderCategory(gender) {
    const known = normalizeGender(gender);
    if (known) return known;
    if (!gender) return null;
    const g = String(gender).trim().toLowerCase();
    if (['other', 'andere', 'anders', 'divers', 'altro'].includes(g)) return 'other';
    if (['unknown', 'unbekannt', 'sconosciuto'].includes(g)) return 'unknown';
    return null;
  }

  // A person's gender is stored as free text, in whichever language was
  // active when it was entered (e.g. "Männlich"). If that text matches one
  // of the suggested male/female/other/unknown values in ANY registered
  // language, show it translated into the CURRENTLY active language
  // instead of the raw stored string — so switching languages relabels it
  // like everything else. Custom free text that doesn't match a known
  // category is shown as-is, since there's nothing to translate it to.
  function genderDisplayLabel(gender, t) {
    if (!gender) return '';
    const cat = genderCategory(gender);
    return cat ? t(`gender.${cat}`) : gender;
  }

  function genderOf(data, personId) {
    return normalizeGender(getPerson(data, personId)?.gender);
  }

  function pickGendered(t, gender, maleKey, femaleKey, neutralKey) {
    if (gender === 'male') return t(`gendered.${maleKey}`);
    if (gender === 'female') return t(`gendered.${femaleKey}`);
    return t(`relationLabel.${neutralKey}`);
  }

  // Returns a descriptive relationship of `other` as seen from `person`, or
  // null if no blood relationship is found. Pure function over the graph;
  // nothing here is persisted. The label is gendered using `other`'s own
  // gender (father/mother, brother/sister, aunt/uncle, ...) when known,
  // falling back to the neutral term (parent/sibling/aunt-uncle) otherwise.
  function computeBloodRelationship(data, personId, otherId, t) {
    if (personId === otherId) return null;
    const depthsA = ancestorDepths(data, personId);
    const depthsB = ancestorDepths(data, otherId);
    const otherGender = genderOf(data, otherId);

    if (depthsA.has(otherId)) {
      const d = depthsA.get(otherId);
      return { category: 'ancestor', depth: d, label: ancestorLabel(d, otherGender, t) };
    }
    if (depthsB.has(personId)) {
      const d = depthsB.get(personId);
      return { category: 'descendant', depth: d, label: descendantLabel(d, otherGender, t) };
    }

    const common = [...depthsA.keys()].filter((id) => depthsB.has(id));
    if (common.length === 0) return null;

    let bestA = Infinity, bestB = Infinity;
    for (const id of common) {
      const a = depthsA.get(id), b = depthsB.get(id);
      if (Math.max(a, b) < Math.max(bestA, bestB) ||
        (Math.max(a, b) === Math.max(bestA, bestB) && a + b < bestA + bestB)) {
        bestA = a; bestB = b;
      }
    }
    const nearest = common.filter((id) => depthsA.get(id) === bestA && depthsB.get(id) === bestB);
    const full = nearest.length >= 2;

    if (bestA === 1 && bestB === 1) {
      const label = full
        ? pickGendered(t, otherGender, 'brother', 'sister', 'sibling')
        : pickGendered(t, otherGender, 'halfBrother', 'halfSister', 'halfSibling');
      return { category: full ? 'sibling' : 'half-sibling', label };
    }
    const min = Math.min(bestA, bestB);
    const max = Math.max(bestA, bestB);
    if (min === 1) {
      const removed = max - 1;
      // person is closer to the shared ancestor (bestA < bestB) => person is
      // the elder generation => `other` is the younger one, i.e. person's
      // niece/nephew. If `other` is closer, `other` is person's aunt/uncle.
      const personIsElder = bestA < bestB;
      if (removed === 1) {
        const label = personIsElder
          ? pickGendered(t, otherGender, 'nephew', 'niece', 'nieceNephew')
          : pickGendered(t, otherGender, 'uncle', 'aunt', 'auntUncle');
        return { category: personIsElder ? 'niece-nephew' : 'aunt-uncle', label };
      }
      const label = personIsElder
        ? pickGendered(t, otherGender, 'grandNephew', 'grandNiece', 'grandNieceNephew')
        : pickGendered(t, otherGender, 'grandUncle', 'grandAunt', 'grandAuntUncle');
      return { category: personIsElder ? 'grand-niece-nephew' : 'grand-aunt-uncle', label, removed: removed - 1 };
    }
    // English has no common single-word gendered form for "cousin" — stays
    // neutral regardless of gender.
    const degree = min - 1;
    const removed = max - min;
    let label = `${ordinal(degree)} ${t('relationLabel.cousin')}`;
    if (removed > 0) label += ` ${removed > 1 ? removed + 'x' : ''} ${t('relationLabel.removed')}`.replace('  ', ' ');
    return { category: 'cousin', degree, removed, full, label: label.trim() };
  }

  function ancestorLabel(depth, gender, t) {
    if (depth === 1) return pickGendered(t, gender, 'father', 'mother', 'parent');
    if (depth === 2) return pickGendered(t, gender, 'grandfather', 'grandmother', 'grandparent');
    if (depth === 3) return pickGendered(t, gender, 'greatGrandfather', 'greatGrandmother', 'greatGrandparent');
    const prefix = 'great-'.repeat(depth - 2);
    if (gender === 'male') return `${prefix}grandfather`;
    if (gender === 'female') return `${prefix}grandmother`;
    return `${prefix}grandparent`;
  }

  function descendantLabel(depth, gender, t) {
    if (depth === 1) return pickGendered(t, gender, 'son', 'daughter', 'child');
    if (depth === 2) return pickGendered(t, gender, 'grandson', 'granddaughter', 'grandchild');
    if (depth === 3) return pickGendered(t, gender, 'greatGrandson', 'greatGranddaughter', 'greatGrandchild');
    const prefix = 'great-'.repeat(depth - 2);
    if (gender === 'male') return `${prefix}grandson`;
    if (gender === 'female') return `${prefix}granddaughter`;
    return `${prefix}grandchild`;
  }

  // Gendered in-law term for a person related to `personId` via `category`
  // (as returned by computeBloodRelationship/getCloseBloodRelatives),
  // gendered using that in-law person's OWN gender — not the connecting
  // relative's gender (e.g. a son's wife is gendered as herself, not as him).
  function inLawLabel(t, category, depth, gender) {
    if (category === 'ancestor') {
      if (depth === 1) return pickGendered(t, gender, 'fatherInLaw', 'motherInLaw', 'parentInLaw');
      if (depth === 2) return pickGendered(t, gender, 'grandfatherInLaw', 'grandmotherInLaw', 'grandparentInLaw');
    }
    if (category === 'descendant') {
      if (depth === 1) return pickGendered(t, gender, 'sonInLaw', 'daughterInLaw', 'childInLaw');
      if (depth === 2) return pickGendered(t, gender, 'grandsonInLaw', 'granddaughterInLaw', 'grandchildInLaw');
    }
    if (category === 'sibling' || category === 'half-sibling') {
      return pickGendered(t, gender, 'brotherInLaw', 'sisterInLaw', 'siblingInLaw');
    }
    return t('relationLabel.inLaw');
  }

  // In-laws: partner's parents/grandparents/siblings, and my children's/
  // grandchildren's/siblings' spouses. One hop only (no chained
  // in-laws-of-in-laws). Partner's children and my parents' newer spouses
  // are deliberately excluded — those are step-relationships, not in-laws.
  function getInLaws(data, personId, t) {
    const results = new Map(); // personId -> label
    const myBloodIds = new Set([personId, ...[...ancestorDepths(data, personId).keys()]]);
    allPeople(data).forEach((p) => {
      if (myBloodIds.has(p.id)) return;
      const rel = computeBloodRelationship(data, personId, p.id, t);
      if (rel) myBloodIds.add(p.id);
    });

    const myPartnerUnions = unionsAsPartner(data, personId);
    for (const u of myPartnerUnions) {
      const partnerId = otherPartner(u, personId);
      if (!partnerId) continue;
      for (const rel of getCloseBloodRelatives(data, partnerId, t)) {
        if (!['ancestor', 'sibling', 'half-sibling'].includes(rel.category)) continue;
        if (myBloodIds.has(rel.person.id) || rel.person.id === personId) continue;
        if (results.has(rel.person.id)) continue;
        results.set(rel.person.id, inLawLabel(t, rel.category, rel.depth, genderOf(data, rel.person.id)));
      }
    }

    for (const rel of getCloseBloodRelatives(data, personId, t)) {
      if (!['descendant', 'sibling', 'half-sibling'].includes(rel.category)) continue;
      const theirUnions = unionsAsPartner(data, rel.person.id);
      for (const u of theirUnions) {
        const partnerId = otherPartner(u, rel.person.id);
        if (!partnerId || partnerId === personId) continue;
        if (myBloodIds.has(partnerId)) continue;
        if (results.has(partnerId)) continue;
        results.set(partnerId, inLawLabel(t, rel.category, rel.depth, genderOf(data, partnerId)));
      }
    }

    return [...results.entries()].map(([id, label]) => ({ person: getPerson(data, id), label })).filter((r) => r.person);
  }

  function getCloseBloodRelatives(data, personId, t) {
    const out = [];
    allPeople(data).forEach((p) => {
      if (p.id === personId) return;
      const rel = computeBloodRelationship(data, personId, p.id, t);
      if (rel && ['ancestor', 'descendant', 'sibling', 'half-sibling'].includes(rel.category) &&
        (rel.depth === undefined || rel.depth <= 2)) {
        out.push({ person: p, ...rel });
      }
    });
    return out;
  }

  function getAllRelationships(data, personId, t) {
    const buckets = {
      partners: [], parents: [], children: [], siblings: [], halfSiblings: [], grandparents: [], grandchildren: [],
      auntsUncles: [], niecesNephews: [], cousins: [], inLaws: [],
    };
    // A person's own partners aren't a blood relationship at all, so
    // computeBloodRelationship below never surfaces them — they have to
    // be collected separately, straight from personId's own unions.
    unionsAsPartner(data, personId).forEach((u) => {
      const partnerId = otherPartner(u, personId);
      const partner = partnerId ? getPerson(data, partnerId) : null;
      if (!partner) return;
      buckets.partners.push({ person: partner, label: `${t(`union.${u.type}`)}, ${t(`union.${u.status}`)}` });
    });
    allPeople(data).forEach((p) => {
      if (p.id === personId) return;
      const rel = computeBloodRelationship(data, personId, p.id, t);
      if (!rel) return;
      const entry = { person: p, label: rel.label };
      if (rel.category === 'sibling') buckets.siblings.push(entry);
      else if (rel.category === 'half-sibling') buckets.halfSiblings.push(entry);
      else if (rel.category === 'ancestor' && rel.depth === 1) buckets.parents.push(entry);
      else if (rel.category === 'descendant' && rel.depth === 1) buckets.children.push(entry);
      else if (rel.category === 'ancestor' && rel.depth === 2) buckets.grandparents.push(entry);
      else if (rel.category === 'descendant' && rel.depth === 2) buckets.grandchildren.push(entry);
      else if (rel.category === 'aunt-uncle' || rel.category === 'grand-aunt-uncle') buckets.auntsUncles.push(entry);
      else if (rel.category === 'niece-nephew' || rel.category === 'grand-niece-nephew') buckets.niecesNephews.push(entry);
      else if (rel.category === 'cousin') buckets.cousins.push(entry);
    });
    buckets.inLaws = getInLaws(data, personId, t);
    return buckets;
  }

  return {
    SCHEMA_VERSION,
    uuid,
    createEmptyData,
    createEmptyDate,
    createPerson,
    createUnion,
    hasDate,
    hasYear,
    hasMonthDay,
    dateToComparable,
    currentLocale,
    formatDate,
    computeAge,
    fullName,
    getPerson,
    getUnion,
    allPeople,
    allUnions,
    unionsAsPartner,
    unionsAsChild,
    getParents,
    getChildren,
    getPartnerUnions,
    otherPartner,
    findUnionBetween,
    getSiblings,
    ancestorDepths,
    genderDisplayLabel,
    wouldCreateCycle,
    describeDeletionImpact,
    cascadeDeletePerson,
    computeBloodRelationship,
    getAllRelationships,
  };
})();

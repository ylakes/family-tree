const ViewStats = (() => {
  function render(container) {
    const t = App.t;
    const { data } = App.getState();
    const people = DataModel.allPeople(data);
    const living = people.filter((p) => !p.isDeceased);
    const deceased = people.filter((p) => p.isDeceased);
    const unions = DataModel.allUnions(data);
    const currentUnions = unions.filter((u) => u.status === 'current');
    const formerUnions = unions.filter((u) => u.status !== 'current');

    const livingAges = living.map((p) => DataModel.computeAge(p.birthDate, new Date())).filter((a) => a !== null);
    const avgAge = livingAges.length ? Math.round(livingAges.reduce((a, b) => a + b, 0) / livingAges.length) : null;

    const deathAges = deceased.map((p) => DataModel.computeAge(p.birthDate, new Date(), p.deathDate)).filter((a) => a !== null);
    const avgAgeAtDeath = deathAges.length ? Math.round(deathAges.reduce((a, b) => a + b, 0) / deathAges.length) : null;

    // Rank by exact birth date, not whole-year age — two people born the
    // same year (or otherwise tied on whole years) still have a real
    // chronological order that age-in-years alone can't distinguish.
    let oldest = null, youngest = null;
    living.forEach((p) => {
      const age = DataModel.computeAge(p.birthDate, new Date());
      if (age === null) return;
      const cmp = DataModel.dateToComparable(p.birthDate);
      if (!oldest || cmp < oldest.cmp) oldest = { person: p, age, cmp };
      if (!youngest || cmp > youngest.cmp) youngest = { person: p, age, cmp };
    });

    const gen = ViewTree.computeGenerations(data);
    const genCounts = new Map();
    gen.forEach((g) => genCounts.set(g, (genCounts.get(g) || 0) + 1));
    let largestGen = null;
    genCounts.forEach((count, g) => { if (!largestGen || count > largestGen.count) largestGen = { gen: g, count }; });

    const tiles = [
      { label: t('stats.totalPeople'), value: people.length },
      { label: t('stats.living'), value: living.length },
      { label: t('stats.deceased'), value: deceased.length },
      { label: t('stats.averageAge'), value: avgAge ?? '—' },
      { label: t('stats.averageAgeAtDeath'), value: avgAgeAtDeath ?? '—' },
      { label: t('stats.oldestLiving'), value: oldest ? `${DataModel.fullName(oldest.person)} (${oldest.age})` : '—' },
      { label: t('stats.youngestLiving'), value: youngest ? `${DataModel.fullName(youngest.person)} (${youngest.age})` : '—' },
 //     { label: t('stats.largestGeneration'), value: largestGen ? `${t('stats.people')}: ${largestGen.count}` : '—' },
      { label: t('stats.totalUnions'), value: unions.length },
      { label: t('stats.currentUnions'), value: currentUnions.length },
      { label: t('stats.formerUnions'), value: formerUnions.length },
    ];

    container.innerHTML = `
      <div class="view-header">
        <h2>${t('stats.heading')}</h2>
        ${UiHelpers.printButtonHtml(t)}
      </div>
      <div class="stats-grid">
        ${tiles.map((tile) => `<div class="stat-tile">
          <div class="stat-tile__value">${UiHelpers.escapeHtml(String(tile.value))}</div>
          <div class="stat-tile__label">${tile.label}</div>
        </div>`).join('')}
      </div>`;
    UiHelpers.wirePrintButton(container);
  }

  return { render };
})();

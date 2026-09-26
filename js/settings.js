// App-wide settings, edited directly in this file (there's no in-app UI for
// it). Set any tab below to false to remove it from the nav bar — the
// underlying view still works if reached indirectly (e.g. clicking a
// person's name from another view still opens Focus), this only controls
// what shows up as a clickable tab in the menu.
window.AppSettings = window.AppSettings || {
  visibleTabs: {
    focus: true,
    tree: true,
    calendar: true,
    eventsCalendar: true,
    contacts: true,
    anniversaries: true,
    stats: true,
    relationships: true,
  },
};

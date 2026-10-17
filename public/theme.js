'use strict';

// Weergave-voorkeuren van dit apparaat (thema, lettergrootte, ruimte) vóór de stijl toepassen, zodat de pagina niet
// eerst in de standaardweergave flitst. Zonder keuze volgt het thema het systeem. Gewoon script in <head>: de CSP
// staat geen inline code toe. Alleen bekende waarden komen op <html>.
try {
  const root = document.documentElement;
  const pick = (key, attr, allowed) => {
    const v = localStorage.getItem(key);
    if (allowed.includes(v)) root.dataset[attr] = v;
  };
  pick('tick.theme', 'theme', ['light', 'dark']);
  pick('tick.font', 'font', ['s', 'm', 'l', 'xl']);
  pick('tick.density', 'density', ['compact', 'normal', 'roomy']);
} catch { /* geen opslag */ }

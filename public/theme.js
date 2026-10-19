'use strict';

// Weergave-voorkeuren van dit apparaat (thema, kleurthema, lettergrootte, ruimte, achtergrondfoto) vóór de stijl toepassen,
// zodat de pagina niet eerst in de standaardweergave flitst. Zonder keuze volgt het thema het systeem. Gewoon script in
// <head>: de CSP staat geen inline code toe. Alleen bekende waarden komen op <html>.
// De achtergrondfoto: `tick.bg` is de versie van de foto (zie src/background.ts); de foto zelf komt van /api/background.
try {
  const root = document.documentElement;
  const pick = (key, attr, allowed) => {
    const v = localStorage.getItem(key);
    if (allowed.includes(v)) root.dataset[attr] = v;
  };
  pick('tick.theme', 'theme', ['light', 'dark']);
  pick('tick.palette', 'palette', ['retro']);
  pick('tick.font', 'font', ['s', 'm', 'l', 'xl']);
  pick('tick.density', 'density', ['compact', 'normal', 'roomy']);
  const bg = localStorage.getItem('tick.bg');
  if (bg && /^\d{1,16}$/.test(bg) && location.pathname !== '/login') {
    root.dataset.bg = '';
    root.style.setProperty('--bg-image', `url(/api/background?v=${bg})`);
  }
} catch { /* geen opslag */ }

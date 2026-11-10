// Editor of the mini-CMS on ticktodo.nl. The Worker only adds it to the page when you are logged in (/beheer).
// Click a block with a dashed line to change its text. Styles are in /beheer/editor.css (CSP: no inline styles).
(function () {
  'use strict';

  var opgeslagen = {};    // key -> html of the edits in KV
  var bewerkenAan = true;
  var huidig = null;      // element being edited
  var beginHtml = '';     // content when the dialog opened, to notice changes
  var tab = 'opmaak';

  function maak(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html) { e.innerHTML = html; }
    return e;
  }

  function api(pad, methode, data) {
    return fetch(pad, {
      method: methode,
      headers: { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (antwoord) {
        if (res.status === 401) { throw new Error('Je bent uitgelogd. Log opnieuw in via /beheer.'); }
        if (!res.ok) { throw new Error(antwoord.fout || 'Opslaan is niet gelukt.'); }
        return antwoord;
      });
    });
  }

  var toastTimer;
  function toast(tekst) {
    var t = document.querySelector('.cms-toast') || document.body.appendChild(maak('div', { 'class': 'cms-toast', role: 'status' }));
    t.textContent = tekst;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function heeft(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

  function markeer() {
    document.querySelectorAll('[data-edit]').forEach(function (e) {
      e.classList.toggle('cms-gewijzigd', heeft(opgeslagen, e.getAttribute('data-edit')));
    });
  }

  // ---------- Bar ----------
  document.documentElement.classList.add('cms-aan');

  var balk = maak('div', { 'class': 'cms-balk' });
  var knopAan = maak('button', { type: 'button', title: 'Stippellijnen tonen of verbergen' });
  var knopUit = maak('button', { type: 'button' });
  knopAan.textContent = 'Bewerken: aan';
  knopUit.textContent = 'Uitloggen';
  balk.appendChild(knopAan);
  balk.appendChild(knopUit);
  document.body.appendChild(balk);

  knopAan.addEventListener('click', function () {
    bewerkenAan = !bewerkenAan;
    document.documentElement.classList.toggle('cms-aan', bewerkenAan);
    knopAan.textContent = bewerkenAan ? 'Bewerken: aan' : 'Bewerken: uit';
  });
  knopUit.addEventListener('click', function () {
    api('/api/logout', 'POST', {}).then(function () { location.reload(); }).catch(function (err) { toast(err.message); });
  });

  // ---------- Text editor ----------
  var dlg = maak('dialog', { 'class': 'cms-modal', 'aria-labelledby': 'cms-titel' },
    '<div class="cms-binnen">' +
      '<div class="cms-kop"><strong id="cms-titel"></strong>' +
        '<div class="cms-tabs"><button type="button" data-tab="opmaak" aria-pressed="true">Opmaak</button><button type="button" data-tab="html" aria-pressed="false">HTML</button></div>' +
      '</div>' +
      '<div class="cms-werkbalk">' +
        '<button type="button" data-cmd="bold" title="Vet (Ctrl+B)"><b>V</b></button>' +
        '<button type="button" data-cmd="italic" title="Cursief (Ctrl+I)"><i>C</i></button>' +
        '<button type="button" data-cmd="createLink">Link</button>' +
        '<button type="button" data-cmd="unlink">Link weg</button>' +
        '<button type="button" data-cmd="removeFormat">Opmaak wissen</button>' +
      '</div>' +
      '<div class="cms-gebied" contenteditable="true" spellcheck="true"></div>' +
      '<textarea class="cms-html" spellcheck="false" hidden aria-label="HTML"></textarea>' +
      '<div class="cms-voet">' +
        '<button type="button" class="cms-licht" data-actie="herstel">Origineel terugzetten</button>' +
        '<span class="cms-status" role="status"></span><span class="cms-ruimte"></span>' +
        '<button type="button" data-actie="annuleer">Annuleren</button>' +
        '<button type="button" class="cms-primair" data-actie="opslaan">Opslaan</button>' +
      '</div>' +
    '</div>');
  document.body.appendChild(dlg);

  var gebied = dlg.querySelector('.cms-gebied');
  var bron = dlg.querySelector('.cms-html');
  var werkbalk = dlg.querySelector('.cms-werkbalk');
  var status = dlg.querySelector('.cms-status');
  var knopHerstel = dlg.querySelector('[data-actie="herstel"]');
  gebied.setAttribute('lang', document.documentElement.lang || 'nl');

  function huidigeHtml() {
    var html = (tab === 'html' ? bron.value : gebied.innerHTML).trim();
    // An empty editor often leaves a <br> or &nbsp; behind: that counts as empty.
    if (!/<(img|svg|video|iframe)\b/i.test(html) && !html.replace(/<[^>]*>|&nbsp;|\s/g, '')) { return ''; }
    return html;
  }

  function zetTab(nieuw) {
    if (nieuw === tab) { return; }
    if (nieuw === 'html') { bron.value = gebied.innerHTML.trim(); } else { gebied.innerHTML = bron.value; }
    tab = nieuw;
    gebied.hidden = tab === 'html';
    werkbalk.hidden = tab === 'html';
    bron.hidden = tab !== 'html';
    dlg.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === tab)); });
    (tab === 'html' ? bron : gebied).focus();
  }

  function openBewerker(el) {
    huidig = el;
    var sleutel = el.getAttribute('data-edit');
    tab = 'html';
    zetTab('opmaak');
    gebied.innerHTML = el.innerHTML.trim();
    beginHtml = huidigeHtml();
    status.textContent = '';
    knopHerstel.hidden = !heeft(opgeslagen, sleutel);
    dlg.querySelector('#cms-titel').textContent = el.getAttribute('data-edit-label') || sleutel;
    dlg.showModal();
    gebied.focus();
  }

  function sluiten(vraag) {
    if (vraag && huidigeHtml() !== beginHtml && !confirm('Je wijzigingen zijn nog niet opgeslagen. Weggooien?')) { return; }
    dlg.close();
    huidig = null;
  }

  function opslaan() {
    if (!huidig) { return; }
    var sleutel = huidig.getAttribute('data-edit');
    var html = huidigeHtml();
    status.textContent = 'Opslaan...';
    api('/api/content', 'PUT', { key: sleutel, html: html }).then(function () {
      huidig.innerHTML = html;
      opgeslagen[sleutel] = html;
      markeer();
      dlg.close();
      huidig = null;
      toast('Opgeslagen. Bezoekers zien het binnen een minuut.');
    }).catch(function (err) { status.textContent = err.message; });
  }

  function herstel() {
    if (!huidig || !confirm('De oorspronkelijke tekst terugzetten? Je aanpassing verdwijnt.')) { return; }
    status.textContent = 'Bezig...';
    api('/api/content', 'PUT', { key: huidig.getAttribute('data-edit'), html: null }).then(function () {
      location.reload();
    }).catch(function (err) { status.textContent = err.message; });
  }

  dlg.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (e.target === dlg) { sluiten(true); return; }   // click on the backdrop
    if (!t) { return; }
    if (t.hasAttribute('data-tab')) { zetTab(t.getAttribute('data-tab')); }
    var actie = t.getAttribute('data-actie');
    if (actie === 'opslaan') { opslaan(); }
    if (actie === 'annuleer') { sluiten(true); }
    if (actie === 'herstel') { herstel(); }
    var cmd = t.getAttribute('data-cmd');
    if (cmd === 'createLink') {
      var adres = prompt('Adres van de link (bijvoorbeeld https://... of mailto:...)');
      if (adres) { document.execCommand('createLink', false, adres); }
    } else if (cmd) {
      document.execCommand(cmd, false, null);
    }
  });
  // Toolbar buttons must not take the selection out of the text.
  werkbalk.addEventListener('mousedown', function (e) { e.preventDefault(); });
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); sluiten(true); });
  dlg.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); opslaan(); }
  });
  // Paste as plain text, so no formatting from Word or a website comes along.
  gebied.addEventListener('paste', function (e) {
    e.preventDefault();
    var tekst = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, tekst);
  });
  gebied.addEventListener('focus', function () {
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (err) { /* older browser */ }
  });

  // Clicking a block opens the editor instead of following links or opening a <details>.
  document.addEventListener('click', function (e) {
    if (!bewerkenAan || e.target.closest('.cms-balk, .cms-modal')) { return; }
    var doel = e.target.closest('[data-edit]');
    if (!doel) { return; }
    e.preventDefault();
    e.stopPropagation();
    openBewerker(doel);
  }, true);

  // ---------- Start ----------
  api('/api/content', 'GET').then(function (d) {
    opgeslagen = d.content || {};
    markeer();
  }).catch(function (err) { toast(err.message); });
  toast('Klik op een tekst met een stippellijn om hem aan te passen.');
})();

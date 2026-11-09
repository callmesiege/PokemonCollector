// "Identify a card": work out which set a physical card belongs to from the number printed on it.
import { api } from './api.js';
import { state, el, $, esc, setTitle, visibleSets, isPocketSet } from './app.js';
import { cardTile, updateTile } from './views-sets.js';
import { modeChips } from './views-more.js';

export async function renderLookup() {
  const view = $('#view'); setTitle('Identify a card');
  view.innerHTML = '';
  const numInput = el('input', { class: 'search', type: 'search', inputmode: 'text', autocapitalize: 'characters', placeholder: 'Card number, e.g. 045/198 or SWSH045', value: sessionStorage.getItem('lookup:num') || '' });
  const nameInput = el('input', { class: 'search', type: 'search', placeholder: 'Pokémon / card name (optional, narrows results)', value: sessionStorage.getItem('lookup:name') || '' });
  const go = el('button', { class: 'btn primary', onclick: run }, 'Find this card');
  const tip = el('div', { class: 'card-box tip' }, el('b', {}, 'Where to look: '), 'the number is printed at the bottom of the card, e.g. ', el('b', {}, '045/198'), '. The part after the slash is the set size and usually pins down the set. Promos and older cards have no slash: type the number as printed (e.g. ', el('b', {}, 'SWSH045'), ' or ', el('b', {}, '25'), ') and add the name.');
  const results = el('div');
  view.append(modeChips('lookup'), el('div', { class: 'lookup-form' }, numInput, nameInput, go), tip, results);
  [numInput, nameInput].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') run(); }));
  if (numInput.value) run();

  async function run() {
    const raw = numInput.value.trim(); const name = nameInput.value.trim().toLowerCase();
    sessionStorage.setItem('lookup:num', raw); sessionStorage.setItem('lookup:name', nameInput.value.trim());
    if (!raw && !name) return;
    results.innerHTML = '<div class="loading"><div class="spinner"></div>Looking it up…</div>';
    try {
      const m = raw.match(/^\s*([A-Za-z]*\s*\d+[a-zA-Z]?)\s*(?:\/\s*(\d+))?\s*$/);
      const num = m ? m[1].replace(/\s+/g, '').toUpperCase() : raw.toUpperCase();
      const denom = m && m[2] ? parseInt(m[2], 10) : null;
      let groups;
      if (denom) groups = await byDenominator(num, denom, name);
      else groups = await byNumber(num, name);
      draw(groups, { num, denom, name });
    } catch (e) { results.innerHTML = `<div class="empty">Lookup needs a connection.<br><span class="small">${esc(e.message)}</span></div>`; }
  }

  // "045/198": find sets whose official size is 198, then card #45 in each.
  async function byDenominator(num, denom, name) {
    const n = parseInt(num.replace(/^[A-Z]+/, ''), 10);
    const sets = visibleSets().filter(s => s.cardCount && (s.cardCount.official === denom || s.cardCount.total === denom));
    const groups = [];
    const details = await Promise.all(sets.slice(0, 12).map(s => api.getSet(s.id).catch(() => null)));
    for (const set of details) {
      if (!set) continue;
      const cards = (set.cards || []).filter(c => parseInt(c.localId, 10) === n || String(c.localId).toUpperCase() === num);
      const hits = name ? cards.filter(c => c.name.toLowerCase().includes(name)) : cards;
      if (hits.length) groups.push({ set, cards: hits });
    }
    if (!groups.length && name) return byNumber(num, name); // promo-style fallback
    return groups;
  }

  // No denominator: ask the API for every card with that number, keep exact matches.
  async function byNumber(num, name) {
    const q = `localId=${encodeURIComponent(num.replace(/^0+(?=\d)/, ''))}` + (name ? `&name=${encodeURIComponent(name)}` : '');
    const res = await fetch(`https://api.tcgdex.net/v2/en/cards?${q}`).then(r => r.json());
    const n = parseInt(num.replace(/^[A-Z]+/, ''), 10);
    const exact = res.filter(c => {
      const lid = String(c.localId).toUpperCase();
      if (lid === num) return true;
      if (/^[A-Z]/.test(num)) return false;                       // user typed a prefix: require exact
      return /^\d+$/.test(lid) && parseInt(lid, 10) === n;        // plain number: 45 == 045
    }).filter(c => state.settings.showPocket || !isPocketSet(c));
    const bySet = new Map();
    for (const c of exact) { const setId = c.id.replace(/-[^-]+$/, ''); if (!bySet.has(setId)) bySet.set(setId, []); bySet.get(setId).push(c); }
    const order = new Map((state.setsList || []).map((s, i) => [s.id, i]));
    const ids = [...bySet.keys()].sort((a, b) => (order.get(b) ?? -1) - (order.get(a) ?? -1)).slice(0, 25);
    const groups = [];
    for (const setId of ids) {
      const brief = (state.setsList || []).find(s => s.id === setId) || { id: setId, name: setId.toUpperCase() };
      groups.push({ set: brief, cards: bySet.get(setId) });
    }
    return groups;
  }

  function draw(groups, { num, denom, name }) {
    results.innerHTML = '';
    if (!groups.length) { results.append(el('div', { class: 'empty' }, el('div', { class: 'big' }, '🤷'), `No card ${denom ? `#${num}/${denom}` : '#' + num}${name ? ` named “${name}”` : ''} found. Double-check the number, or try without the name.`)); return; }
    const total = groups.reduce((n, g) => n + g.cards.length, 0);
    results.append(el('div', { class: 'muted small', style: 'margin:0 4px 4px' }, total === 1 ? 'One match. Tap + to add it to your collection.' : `${total} possible matches in ${groups.length} set${groups.length > 1 ? 's' : ''}. Compare the set symbol next to the card number, then tap + on the right one.`));
    for (const g of groups) {
      const logo = api.logoUrl(g.set.logo);
      results.append(el('div', { class: 'result-set' }, logo && el('img', { src: logo, alt: '' }),
        el('div', {}, el('div', { class: 'nm' }, g.set.name), el('div', { class: 'small muted' }, `${g.set.id.toUpperCase()}${g.set.releaseDate ? ' · ' + g.set.releaseDate : ''}${g.set.cardCount && g.set.cardCount.official ? ` · ${g.set.cardCount.official} cards` : ''}`)),
        el('a', { class: 'btn small', style: 'margin-left:auto', href: `#/set/${encodeURIComponent(g.set.id)}` }, 'Open set')));
      const grid = el('div', { class: 'card-grid' });
      g.cards.forEach(c => grid.append(cardTile(c, g.set.id, g.set.cards ? g.set : null, { showSet: !g.set.cards })));
      results.append(grid);
    }
  }
  const onChange = ev => { const t = results.querySelector(`[data-id="${CSS.escape(ev.detail.id)}"]`); if (t) updateTile(t); };
  document.addEventListener('collection-changed', onChange);
  const obs = new MutationObserver(() => { if (!document.body.contains(results)) { document.removeEventListener('collection-changed', onChange); obs.disconnect(); } });
  obs.observe($('#view'), { childList: true });
}

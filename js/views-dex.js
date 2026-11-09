import { api, REGIONS } from './api.js';
import { state, el, $, esc, setTitle, pct, fmtPct, openModal, closeModal } from './app.js';
import { cardTile, updateTile, byLocalId, openCardSheet } from './views-sets.js';

let dexCache = null;
async function loadDex(view) {
  if (dexCache) return dexCache;
  view.innerHTML = '<div class="loading"><div class="spinner"></div>Loading Pokédex…</div>';
  dexCache = await api.pokedex();
  return dexCache;
}

// dexId -> { cards: n, qty: n } from the local collection
function ownedByDex() {
  const m = new Map();
  for (const e of state.collection.values()) {
    if (e.qty <= 0) continue;
    for (const d of e.dexIds || []) { const r = m.get(d) || { cards: 0, qty: 0 }; r.cards++; r.qty += e.qty; m.set(d, r); }
  }
  return m;
}
function pendingCount() { let n = 0; for (const e of state.collection.values()) if (e.qty > 0 && (!e.dexIds || !e.dexIds.length) && e.category !== 'Trainer' && e.category !== 'Energy') n++; return n; }

// ---------- Region overview ----------
export async function renderDex() {
  const view = $('#view'); setTitle('Pokédex');
  let dex; try { dex = await loadDex(view); } catch (e) { view.innerHTML = `<div class="empty"><div class="big">📡</div>Couldn't load the Pokédex list. Connect once to download it (~70 KB).<br><span class="small muted">${esc(e.message)}</span></div>`; return; }
  const maxId = dex[dex.length - 1].id;
  const owned = ownedByDex();
  view.innerHTML = '';
  const totalSpecies = dex.length, haveSpecies = dex.filter(p => owned.has(p.id)).length;
  view.append(el('div', { class: 'card-box set-item', style: 'margin-bottom:10px' },
    el('div', { class: 'grow' }, el('div', { class: 'set-name' }, el('span', {}, 'National Pokédex')),
      el('div', { class: 'set-meta' }, `Cards for ${haveSpecies} of ${totalSpecies} Pokémon`),
      el('div', { class: 'progress' }, el('i', { style: `width:${pct(haveSpecies, totalSpecies)}%` }))),
    el('div', { class: 'set-pct' }, fmtPct(pct(haveSpecies, totalSpecies)))));
  const pend = pendingCount();
  if (pend) view.append(el('div', { class: 'muted small', style: 'margin:0 4px 8px' }, `${pend} owned card${pend > 1 ? 's' : ''} still syncing Pokédex info…`));

  const grid = el('div', { class: 'region-grid' });
  for (const r of REGIONS) {
    if (r.from > maxId) continue;
    const to = Math.min(r.to, maxId); const n = to - r.from + 1;
    let have = 0; for (let i = r.from; i <= to; i++) if (owned.has(i)) have++;
    grid.append(el('a', { class: 'card-box region-item', href: `#/dex/${r.id}` },
      el('div', { class: 'row' }, el('img', { src: api.spriteUrl(r.from), width: 40, height: 40, style: 'image-rendering:pixelated', alt: '', loading: 'lazy' }),
        el('div', { class: 'grow' }, el('div', { class: 'nm' }, r.name), el('div', { class: 'small muted' }, `Gen ${r.gen} · #${r.from}–${to}`))),
      el('div', { class: 'row', style: 'margin-top:8px' }, el('div', { class: 'progress grow' }, el('i', { style: `width:${pct(have, n)}%` })), el('span', { class: 'small' }, `${have}/${n}`))));
  }
  view.append(el('div', { class: 'section-title' }, 'Regions'), grid);
}

// ---------- One region ----------
export async function renderRegion(regionId) {
  const view = $('#view');
  const r = REGIONS.find(x => x.id === regionId); if (!r) { location.hash = '#/dex'; return; }
  setTitle(r.name, { back: true });
  const dex = await loadDex(view);
  const owned = ownedByDex();
  const list = dex.filter(p => p.id >= r.from && p.id <= r.to);
  view.innerHTML = '';
  let filter = sessionStorage.getItem('dex:filter') || 'all', q = '';
  const chips = el('div', { class: 'chips' });
  const search = el('input', { class: 'search', type: 'search', placeholder: `Search ${r.name} Pokémon…`, oninput: e => { q = e.target.value.toLowerCase(); draw(); } });
  const grid = el('div', { class: 'dex-grid' });
  view.append(chips, search, grid);
  function drawChips() {
    chips.innerHTML = '';
    [['all', 'All'], ['have', 'Have cards'], ['need', 'No cards yet']].forEach(([k, label]) =>
      chips.append(el('button', { class: 'chip' + (filter === k ? ' active' : ''), onclick: () => { filter = k; sessionStorage.setItem('dex:filter', k); drawChips(); draw(); } }, label)));
  }
  function draw() {
    grid.innerHTML = '';
    for (const p of list) {
      const o = owned.get(p.id);
      if (filter === 'have' && !o) continue;
      if (filter === 'need' && o) continue;
      if (q && !p.name.toLowerCase().includes(q) && String(p.id) !== q) continue;
      grid.append(el('a', { class: 'card-box dex-tile' + (o ? '' : ' none'), href: `#/pokemon/${p.id}` },
        o && el('span', { class: 'badge cnt' }, o.cards),
        el('img', { src: api.spriteUrl(p.id), alt: '', loading: 'lazy', decoding: 'async', onerror: e => { e.target.style.visibility = 'hidden'; } }),
        el('div', { class: 'nm' }, p.name), el('div', { class: 'num' }, '#' + String(p.id).padStart(4, '0'))));
    }
    if (!grid.children.length) grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1' }, 'Nothing here.'));
  }
  drawChips(); draw();
}

// ---------- One Pokémon: owned cards + every printed card ----------
export async function renderPokemon(dexId) {
  const view = $('#view');
  const dex = await loadDex(view);
  const p = dex.find(x => x.id === dexId) || { id: dexId, name: `#${dexId}` };
  setTitle(p.name, { back: true });
  view.innerHTML = '';
  const ownedCards = [...state.collection.values()].filter(e => e.qty > 0 && (e.dexIds || []).includes(dexId));
  const totalQty = ownedCards.reduce((n, e) => n + e.qty, 0);
  const head = el('div', { class: 'card-box set-head' },
    el('img', { src: api.spriteUrl(dexId), width: 72, height: 72, style: 'image-rendering:pixelated', alt: '' }),
    el('div', { class: 'grow' }, el('div', { class: 'pct' }, `${ownedCards.length}`),
      el('div', { class: 'set-meta' }, `distinct card${ownedCards.length === 1 ? '' : 's'} owned · ${totalQty} total · National #${String(dexId).padStart(4, '0')}`)));
  view.append(head);

  let filter = 'all';
  const chips = el('div', { class: 'chips' });
  const grid = el('div', { class: 'card-grid' });
  const status = el('div', { class: 'loading' }, el('div', { class: 'spinner' }), 'Loading every card of this Pokémon…');
  view.append(chips, status, grid);
  let all = null;
  try {
    const brief = await api.cardsByDex(dexId);
    // Cards from TCG Pocket (digital) are hidden unless enabled.
    all = brief.filter(c => state.settings.showPocket || !/^(A\d|B\d|P-A)/.test(c.id)).map(c => ({ ...c, setId: c.id.replace(/-[^-]+$/, '') }));
    all.sort((a, b) => setOrder(a.setId) - setOrder(b.setId) || byLocalId(a, b));
    head.querySelector('.set-meta').append(` · ${all.length} printed`);
  } catch { all = ownedCards.map(e => ({ ...e, setId: e.setId })); status.textContent = 'Offline: showing only cards you own.'; }
  status.remove();
  function drawChips() {
    chips.innerHTML = '';
    [['all', 'All cards'], ['owned', 'Owned'], ['missing', 'Missing']].forEach(([k, label]) =>
      chips.append(el('button', { class: 'chip' + (filter === k ? ' active' : ''), onclick: () => { filter = k; drawChips(); draw(); } }, label)));
  }
  function draw() {
    grid.innerHTML = '';
    for (const c of all) {
      const e = state.collection.get(c.id);
      if (filter === 'owned' && !e) continue;
      if (filter === 'missing' && e) continue;
      grid.append(cardTile(c, c.setId, null, { showSet: true }));
    }
    if (!grid.children.length) grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1' }, 'No cards.'));
  }
  drawChips(); draw();
  const onChange = ev => { const t = grid.querySelector(`[data-id="${CSS.escape(ev.detail.id)}"]`); if (t) updateTile(t); };
  document.addEventListener('collection-changed', onChange);
  const obs = new MutationObserver(() => { if (!document.body.contains(grid)) { document.removeEventListener('collection-changed', onChange); obs.disconnect(); } });
  obs.observe($('#view'), { childList: true });
}

// Newest sets first, using the position in the cached set list.
function setOrder(setId) {
  const list = state.setsList || [];
  const i = list.findIndex(s => s.id === setId);
  return i === -1 ? 9999 : list.length - i;
}

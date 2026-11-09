import { api } from './api.js';
import { state, el, $, esc, toast, openModal, closeModal, setTitle, pct, fmtPct, visibleSets, setTotal, setOwned, setQty, toggleWish, marketPrice, clearNewFlag, checkForNewSets } from './app.js';

// ---------- Sets list ----------
export async function renderSets() {
  const view = $('#view');
  const refreshBtn = el('button', { class: 'icon-btn', title: 'Check for new sets', onclick: async () => { refreshBtn.textContent = '…'; await checkForNewSets({ force: true }); renderSets(); } }, '↻');
  setTitle('Sets', { actions: [refreshBtn] });
  if (!state.setsList) { view.innerHTML = '<div class="loading"><div class="spinner"></div>Loading sets…</div>'; await checkForNewSets({ force: true, silent: true }); if (!state.setsList) { view.innerHTML = '<div class="empty"><div class="big">📡</div>Could not load the set list. Check your connection and tap ↻.</div>'; return; } }

  // Newest first, grouped by series (series ordered by their most recent set).
  const chrono = visibleSets().slice().reverse();
  const groups = new Map();
  for (const s of chrono) { const k = serieOf(s.id); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const sets = [...groups.values()].flat();
  const q = (sessionStorage.getItem('sets:q') || '');
  const filter = sessionStorage.getItem('sets:filter') || 'all';
  view.innerHTML = '';
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Filter sets…', value: q, oninput: e => { sessionStorage.setItem('sets:q', e.target.value); draw(); } });
  const chips = el('div', { class: 'chips' }, ...[['all', 'All'], ['started', 'In progress'], ['complete', 'Complete'], ['untouched', 'Not started'], ['new', 'New ✨']].map(([k, label]) =>
    el('button', { class: 'chip' + (filter === k ? ' active' : ''), onclick: () => { sessionStorage.setItem('sets:filter', k); renderSets(); } }, label)));
  const listEl = el('div', { class: 'set-list' });
  view.append(search, chips, listEl);

  // Overall summary
  let totalOwned = 0, totalCards = 0;
  for (const s of sets) { totalOwned += setOwned(s.id, s); totalCards += setTotal(s); }
  view.insertBefore(el('div', { class: 'card-box set-item', style: 'margin-bottom:10px' },
    el('div', { class: 'grow' }, el('div', { class: 'set-name' }, el('span', {}, 'Whole collection')),
      el('div', { class: 'set-meta' }, `${totalOwned} of ${totalCards} cards across ${sets.length} sets`),
      el('div', { class: 'progress' }, el('i', { style: `width:${pct(totalOwned, totalCards)}%` }))),
    el('div', { class: 'set-pct' }, fmtPct(pct(totalOwned, totalCards)))), listEl);

  function draw() {
    listEl.innerHTML = '';
    const needle = (sessionStorage.getItem('sets:q') || '').toLowerCase();
    let lastSerie = null;
    for (const s of sets) {
      if (needle && !s.name.toLowerCase().includes(needle) && !s.id.toLowerCase().includes(needle)) continue;
      const total = setTotal(s), owned = setOwned(s.id, s), p = pct(owned, total);
      const isNew = state.newSetIds.includes(s.id);
      if (filter === 'started' && (owned === 0 || p >= 100)) continue;
      if (filter === 'complete' && p < 100) continue;
      if (filter === 'untouched' && owned > 0) continue;
      if (filter === 'new' && !isNew) continue;
      if (state.settings.hideEmptySets && total === 0) continue;
      const serie = serieOf(s.id);
      if (serie !== lastSerie) { listEl.append(el('div', { class: 'section-title' }, serie)); lastSerie = serie; }
      listEl.append(el('a', { class: 'card-box set-item', href: `#/set/${encodeURIComponent(s.id)}` },
        logoEl(s),
        el('div', { class: 'grow' },
          el('div', { class: 'set-name' }, el('span', {}, s.name), isNew && el('span', { class: 'badge' }, 'NEW')),
          el('div', { class: 'set-meta' }, `${owned} / ${total} cards`),
          el('div', { class: 'progress' + (p >= 100 ? ' done' : '') }, el('i', { style: `width:${Math.min(100, p)}%` }))),
        el('div', { class: 'set-pct' }, fmtPct(p))));
    }
    if (!listEl.children.length) listEl.append(el('div', { class: 'empty' }, 'No sets match.'));
  }
  draw();
}

function logoEl(s, cls = 'set-logo') {
  const url = api.logoUrl(s.logo);
  if (!url) return el('div', { class: cls + ' placeholder' }, s.name);
  const img = el('img', { class: cls, src: url, alt: '', loading: 'lazy', decoding: 'async' });
  img.onerror = () => img.replaceWith(el('div', { class: cls + ' placeholder' }, s.name));
  return img;
}

// Series names derived from set-id prefixes (the brief list has no serie field).
const SERIES = [
  [/^me|^mee|^mep/, 'Mega Evolution'], [/^sv|^svp/, 'Scarlet & Violet'], [/^swsh|^fut|^cel|^pgo|^tk-sw|^swshp/, 'Sword & Shield'],
  [/^sm|^det|^smp/, 'Sun & Moon'], [/^xy|^g1|^dc1|^xyp/, 'XY'], [/^bw|^dv1|^bwp/, 'Black & White'], [/^col/, 'Call of Legends'],
  [/^hgss|^hsp/, 'HeartGold & SoulSilver'], [/^pl|^ru1|^plp/, 'Platinum'], [/^dp|^dpp/, 'Diamond & Pearl'], [/^pop/, 'POP'], [/^ex|^exp|^np/, 'EX'],
  [/^ecard/, 'E-Card'], [/^lc/, 'Legendary Collection'], [/^neo|^si1/, 'Neo'], [/^gym/, 'Gym'], [/^base|^wp|^jumbo/, 'Base'],
  [/^mc/, "McDonald's"], [/^tk/, 'Trainer Kits'], [/^(A\d|B\d|P-A)/, 'TCG Pocket'], [/^30th/, '30th Anniversary'],
];
export function serieOf(id) { for (const [re, n] of SERIES) if (re.test(id)) return n; return 'Other'; }

// ---------- Single set ----------
export async function renderSet(id) {
  const view = $('#view');
  setTitle('Set', { back: true });
  view.innerHTML = '<div class="loading"><div class="spinner"></div>Loading cards…</div>';
  let set;
  try { set = await api.getSet(id); } catch (e) { view.innerHTML = `<div class="empty"><div class="big">📡</div>Couldn't load this set.<br><span class="small muted">${esc(e.message)}</span></div>`; return; }
  clearNewFlag(id);
  const refresh = el('button', { class: 'icon-btn', title: 'Refresh set data', onclick: async () => { await api.getSet(id, true); toast('Set refreshed'); renderSet(id); } }, '↻');
  setTitle(set.name, { back: true, actions: [refresh] });
  view.innerHTML = '';
  const cards = (set.cards || []).slice().sort(byLocalId);
  const total = setTotal(set);

  const head = el('div', { class: 'card-box set-head' });
  const filterKey = `set:${id}:filter`;
  let filter = sessionStorage.getItem(filterKey) || 'all';
  let q = '';
  const chips = el('div', { class: 'chips' });
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Find a card in this set…', oninput: e => { q = e.target.value.toLowerCase(); drawGrid(); } });
  const grid = el('div', { class: 'card-grid' });
  view.append(head, chips, search, grid);

  function drawHead() {
    const owned = setOwned(id, set), p = pct(owned, total);
    const dup = cards.reduce((n, c) => { const e = state.collection.get(c.id); return n + (e ? Math.max(0, e.qty - 1) : 0); }, 0);
    head.innerHTML = '';
    head.append(logoEl(set), el('div', { class: 'grow' },
      el('div', { class: 'pct' }, fmtPct(p)),
      el('div', { class: 'set-meta' }, `${owned} / ${total} cards` + (set.releaseDate ? ` · ${set.releaseDate}` : '') + (dup ? ` · ${dup} duplicate${dup > 1 ? 's' : ''}` : '')),
      el('div', { class: 'progress' + (p >= 100 ? ' done' : '') }, el('i', { style: `width:${Math.min(100, p)}%` }))));
  }
  function drawChips() {
    chips.innerHTML = '';
    [['all', 'All'], ['owned', 'Owned'], ['missing', 'Missing'], ['dupes', 'Duplicates'], ['wish', 'Wishlist ★']].forEach(([k, label]) =>
      chips.append(el('button', { class: 'chip' + (filter === k ? ' active' : ''), onclick: () => { filter = k; sessionStorage.setItem(filterKey, k); drawChips(); drawGrid(); } }, label)));
  }
  function drawGrid() {
    grid.innerHTML = '';
    for (const c of cards) {
      const e = state.collection.get(c.id); const qty = e ? e.qty : 0;
      if (filter === 'owned' && !qty) continue;
      if (filter === 'missing' && qty) continue;
      if (filter === 'dupes' && qty < 2) continue;
      if (filter === 'wish' && !state.wishlist.has(c.id)) continue;
      if (q && !c.name.toLowerCase().includes(q) && !String(c.localId).includes(q)) continue;
      grid.append(cardTile(c, id, set));
    }
    if (!grid.children.length) grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1' }, filter === 'all' ? 'No cards listed for this set yet.' : 'Nothing here.'));
  }
  drawHead(); drawChips(); drawGrid();
  const onChange = ev => { drawHead(); const t = grid.querySelector(`[data-id="${CSS.escape(ev.detail.id)}"]`); if (t) updateTile(t); };
  document.addEventListener('collection-changed', onChange);
  const obs = new MutationObserver(() => { if (!document.body.contains(grid)) { document.removeEventListener('collection-changed', onChange); obs.disconnect(); } });
  obs.observe($('#view'), { childList: true });
}

export const byLocalId = (a, b) => {
  const na = parseInt(a.localId, 10), nb = parseInt(b.localId, 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true });
};

// A card tile with image, name, number and a +/- quantity control.
export function cardTile(c, setId, set, { showSet = false } = {}) {
  const img = api.imageUrl(c.image, 'low');
  const tile = el('div', { class: 'card-tile', 'data-id': c.id },
    el('div', { class: 'img-wrap' }, img ? el('img', { src: img, alt: c.name, loading: 'lazy', decoding: 'async', onerror: e => e.target.replaceWith(el('div', { class: 'noimg' }, 'No image yet')) }) : el('div', { class: 'noimg' }, 'No image yet')),
    el('div', { class: 'info' }, el('div', { class: 'nm' }, c.name), el('div', { class: 'num' }, showSet ? `${setId.toUpperCase()} · #${c.localId}` : `#${c.localId}${set && set.cardCount && set.cardCount.official ? '/' + set.cardCount.official : ''}`)),
    el('div', { class: 'qty-ctl' },
      el('button', { 'aria-label': 'Remove one', onclick: () => change(-1) }, '−'),
      el('div', { class: 'q' }),
      el('button', { 'aria-label': 'Add one', onclick: () => change(1) }, '+')),
    el('div', { class: 'tap', onclick: () => openCardSheet(c, setId, set) }));
  tile._card = c; tile._setId = setId;
  function change(d) { const e = state.collection.get(c.id); setQty(c, setId, (e ? e.qty : 0) + d); }
  updateTile(tile);
  return tile;
}
export function updateTile(tile) {
  const c = tile._card; const e = state.collection.get(c.id); const qty = e ? e.qty : 0;
  tile.classList.toggle('missing', qty === 0);
  tile.classList.toggle('wish', state.wishlist.has(c.id));
  const q = tile.querySelector('.q'); q.textContent = qty ? `×${qty}` : '0'; q.className = 'q ' + (qty ? 'has' : 'zero');
}

// ---------- Card detail sheet ----------
export async function openCardSheet(c, setId, set) {
  const big = el('img', { class: 'bigimg', src: api.imageUrl(c.image, state.settings.imageQuality) || '', alt: c.name });
  big.onerror = () => { if (big.src.includes('/high.webp')) big.src = api.imageUrl(c.image, 'low'); else big.replaceWith(el('div', { class: 'bigimg', style: 'display:grid;place-items:center;color:var(--fg-3)' }, 'No image yet')); };
  const qtyEl = el('div', { class: 'q' });
  const wishBtn = el('button', { class: 'btn small', onclick: async () => { await toggleWish(c, setId); wishBtn.textContent = state.wishlist.has(c.id) ? '★ Wishlisted' : '☆ Wishlist'; } }, state.wishlist.has(c.id) ? '★ Wishlisted' : '☆ Wishlist');
  const details = el('dl', { class: 'kv' });
  const box = el('div', {},
    big,
    el('h2', {}, c.name),
    el('div', { class: 'muted small' }, `${set ? set.name : setId.toUpperCase()} · #${c.localId}${set && set.cardCount && set.cardCount.official ? '/' + set.cardCount.official : ''}`),
    el('div', { class: 'qty-big' },
      el('button', { onclick: () => change(-1) }, '−'), qtyEl, el('button', { onclick: () => change(1) }, '+')),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px' }, wishBtn,
      el('a', { class: 'btn small', href: `#/set/${encodeURIComponent(setId)}`, onclick: closeModal }, 'Open set')),
    details);
  function refreshQty() { const e = state.collection.get(c.id); qtyEl.textContent = e ? e.qty : 0; }
  function change(d) { const e = state.collection.get(c.id); setQty(c, setId, (e ? e.qty : 0) + d).then(refreshQty); }
  refreshQty();
  openModal(box);
  try {
    const full = await api.getCard(c.id);
    const price = marketPrice(full);
    const rows = [
      ['Rarity', full.rarity], ['Type', full.category === 'Pokemon' ? (full.types || []).join(', ') : full.category],
      ['Stage', full.stage], ['HP', full.hp], ['Illustrator', full.illustrator],
      ['Pokédex #', (full.dexId || []).join(', ') || null],
      ['Market price', price ? `${price.unit === 'USD' ? '$' : '€'}${price.value.toFixed(2)}` : null],
      ['Variants', full.variants ? Object.entries(full.variants).filter(([, v]) => v).map(([k]) => k).join(', ') : null],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '');
    details.innerHTML = '';
    rows.forEach(([k, v]) => details.append(el('dt', {}, k), el('dd', {}, String(v))));
    if (full.dexId && full.dexId.length) details.append(el('dt', {}, ''), el('dd', {}, ...full.dexId.map(d => el('a', { class: 'btn small', style: 'margin:2px 4px 0 0;display:inline-block', href: `#/pokemon/${d}`, onclick: closeModal }, `View all #${d} cards`))));
  } catch { details.append(el('dt', {}, ''), el('dd', { class: 'muted small' }, 'Details unavailable offline.')); }
}

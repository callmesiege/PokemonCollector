import { api } from './api.js';
import { db } from './db.js';
import { state, el, $, esc, toast, setTitle, saveSettings, checkForNewSets, visibleSets, setTotal, setOwned, pct, fmtPct, isPocketSet, VARIANTS, variantLabel } from './app.js';
import { cardTile, updateTile, serieOf } from './views-sets.js';

// ---------- Search ----------
export async function renderSearch(initial = '') {
  const view = $('#view'); setTitle('Search');
  view.innerHTML = '';
  const input = el('input', { class: 'search', type: 'search', placeholder: 'Card name, e.g. Charizard…', value: initial, autofocus: true });
  const hint = el('div', { class: 'muted small', style: 'margin:0 4px 10px' }, 'Searches every English card ever printed. Tap + to add one to your collection.');
  const grid = el('div', { class: 'card-grid' });
  view.append(modeChips('search'), input, hint, grid);
  let timer, seq = 0;
  async function run() {
    const q = input.value.trim(); const my = ++seq;
    if (q.length < 2) { grid.innerHTML = ''; return; }
    grid.innerHTML = '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div>Searching…</div>';
    try {
      let res = await api.searchCards(q);
      if (my !== seq) return;
      res = res.filter(c => state.settings.showPocket || !isPocketSet(c)).map(c => ({ ...c, setId: c.id.replace(/-[^-]+$/, '') }));
      const order = new Map((state.setsList || []).map((s, i) => [s.id, i]));
      res.sort((a, b) => (order.get(b.setId) ?? -1) - (order.get(a.setId) ?? -1));
      grid.innerHTML = '';
      res.slice(0, 200).forEach(c => grid.append(cardTile(c, c.setId, null, { showSet: true })));
      if (!res.length) grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1' }, 'No cards found.'));
      else if (res.length > 200) grid.append(el('div', { class: 'muted small', style: 'grid-column:1/-1;text-align:center' }, `Showing 200 of ${res.length}. Refine your search.`));
    } catch (e) { if (my === seq) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Search needs a connection.<br><span class="small">${esc(e.message)}</span></div>`; }
  }
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 350); history.replaceState(null, '', '#/search/' + encodeURIComponent(input.value)); };
  if (initial) run();
  const onChange = ev => { const t = grid.querySelector(`[data-id="${CSS.escape(ev.detail.id)}"]`); if (t) updateTile(t); };
  document.addEventListener('collection-changed', onChange);
  const obs = new MutationObserver(() => { if (!document.body.contains(grid)) { document.removeEventListener('collection-changed', onChange); obs.disconnect(); } });
  obs.observe($('#view'), { childList: true });
}

export function modeChips(active) {
  return el('div', { class: 'chips' },
    el('a', { class: 'chip' + (active === 'search' ? ' active' : ''), href: '#/search' }, 'Search by name'),
    el('a', { class: 'chip' + (active === 'lookup' ? ' active' : ''), href: '#/lookup' }, 'Identify a card 🔎'));
}

// ---------- More: stats, wishlist, backup, settings ----------
export async function renderMore() {
  const view = $('#view'); setTitle('More');
  view.innerHTML = '';
  const entries = [...state.collection.values()].filter(e => e.qty > 0);
  const totalQty = entries.reduce((n, e) => n + e.qty, 0);
  const sets = visibleSets();
  const started = sets.filter(s => setOwned(s.id, s) > 0);
  const complete = sets.filter(s => setTotal(s) > 0 && setOwned(s.id, s) >= setTotal(s));
  const value = entries.reduce((n, e) => n + (e.price && e.price.unit === 'USD' ? e.price.value * e.qty : 0), 0);
  const priced = entries.filter(e => e.price && e.price.unit === 'USD').length;
  const species = new Set(); entries.forEach(e => (e.dexIds || []).forEach(d => species.add(d)));

  view.append(el('div', { class: 'section-title' }, 'Your collection'),
    el('div', { class: 'stat-grid' },
      stat(entries.length, 'distinct cards'), stat(totalQty, 'total cards'),
      stat(species.size, 'Pokémon species'), stat(`${complete.length}/${started.length}`, 'sets complete / started'),
      stat(`$${value.toFixed(0)}`, `est. value (${priced} of ${entries.length} priced)`), stat(totalQty - entries.length, 'duplicates')));

  // Rarity breakdown
  const rar = {}; entries.forEach(e => { const k = e.rarity || 'Unknown'; rar[k] = (rar[k] || 0) + e.qty; });
  const rarRows = Object.entries(rar).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (rarRows.length) view.append(el('div', { class: 'section-title' }, 'By rarity'), el('div', { class: 'card-box list' }, ...rarRows.map(([k, v]) => el('div', { class: 'item' }, el('div', { class: 'l' }, k), el('div', {}, v)))));

  // Variant breakdown
  const vcount = {}; entries.forEach(e => Object.entries(e.variants || {}).forEach(([k, n]) => { vcount[k] = (vcount[k] || 0) + n; }));
  const vrows = VARIANTS.filter(([k]) => vcount[k]).map(([k]) => [variantLabel(k), vcount[k]]);
  if (vrows.length) view.append(el('div', { class: 'section-title' }, 'By variant'), el('div', { class: 'card-box list' }, ...vrows.map(([k, v]) => el('div', { class: 'item' }, el('div', { class: 'l' }, k), el('div', {}, v)))));

  // Wishlist
  const wish = [...state.wishlist.values()];
  view.append(el('div', { class: 'section-title' }, `Wishlist (${wish.length})`));
  if (wish.length) { const g = el('div', { class: 'card-grid' }); wish.forEach(w => g.append(cardTile(w, w.setId, null, { showSet: true }))); view.append(g); }
  else view.append(el('div', { class: 'card-box', style: 'padding:14px' }, el('span', { class: 'muted small' }, 'Star a card from its detail view to track cards you’re hunting for.')));

  // Duplicates for trade
  const dupes = entries.filter(e => e.qty > 1).sort((a, b) => b.qty - a.qty).slice(0, 12);
  if (dupes.length) { view.append(el('div', { class: 'section-title' }, 'Top duplicates (trade bait)')); const g = el('div', { class: 'card-grid' }); dupes.forEach(d => g.append(cardTile(d, d.setId, null, { showSet: true }))); view.append(g); }

  // Backup
  view.append(el('div', { class: 'section-title' }, 'Backup'),
    el('div', { class: 'card-box list' },
      el('div', { class: 'item' }, el('div', { class: 'l' }, 'Export collection', el('div', { class: 'd' }, 'Download a JSON file with every card, quantity and wishlist entry.')), el('button', { class: 'btn small', onclick: exportJSON }, 'Export')),
      el('div', { class: 'item' }, el('div', { class: 'l' }, 'Import collection', el('div', { class: 'd' }, 'Restore from an export. Quantities in the file replace yours.')), importButton()),
      el('div', { class: 'item' }, el('div', { class: 'l' }, 'Export as CSV', el('div', { class: 'd' }, 'For spreadsheets.')), el('button', { class: 'btn small', onclick: exportCSV }, 'CSV'))));

  // Settings
  const s = state.settings;
  view.append(el('div', { class: 'section-title' }, 'Settings'),
    el('div', { class: 'card-box list' },
      settingRow('Count completion against', 'Official = the printed set number (e.g. /198). Total = includes secret rares.',
        select([['total', 'All cards (incl. secrets)'], ['official', 'Official count']], s.countBasis, v => { s.countBasis = v; saveSettings(); })),
      settingRow('Show TCG Pocket sets', 'Digital-only cards from the Pokémon TCG Pocket mobile game.', toggle(s.showPocket, v => { s.showPocket = v; saveSettings(); })),
      settingRow('Hide sets with no cards listed', '', toggle(s.hideEmptySets, v => { s.hideEmptySets = v; saveSettings(); })),
      settingRow('Card detail image', 'High-res uses ~75 KB per card vs ~20 KB.', select([['low', 'Standard (saves data)'], ['high', 'High resolution']], s.imageQuality, v => { s.imageQuality = v; saveSettings(); })),
      settingRow('Theme', '', select([['auto', 'System'], ['dark', 'Dark'], ['light', 'Light']], s.theme, v => { s.theme = v; saveSettings(); })),
      settingRow('Check for new sets every', 'Also checks when the app is opened or returns to the foreground.', select([['6', '6 hours'], ['12', '12 hours'], ['24', 'Day'], ['168', 'Week']], String(s.checkIntervalHours), v => { s.checkIntervalHours = Number(v); saveSettings(); })),
      el('div', { class: 'item' }, el('div', { class: 'l' }, 'New-set notifications', el('div', { class: 'd' }, 'Get a notification when a new set appears.')), el('button', { class: 'btn small', onclick: async () => { if (!('Notification' in window)) return toast('Not supported here'); const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Notifications on' : 'Notifications blocked'); } }, 'Notification' in window && Notification.permission === 'granted' ? 'Enabled' : 'Enable')),
      el('div', { class: 'item' }, el('div', { class: 'l' }, 'Check for new sets now'), el('button', { class: 'btn small', onclick: () => checkForNewSets({ force: true }) }, 'Check'))));

  // Storage
  const usage = await storageUsage();
  view.append(el('div', { class: 'section-title' }, 'Storage'),
    el('div', { class: 'card-box list' },
      el('div', { class: 'item' }, el('div', { class: 'l' }, 'Space used on this device', el('div', { class: 'd' }, usage + ' · card images live in the browser cache and are cleaned up automatically')), el('button', { class: 'btn small', onclick: clearCaches }, 'Clear set & card cache')),
      el('div', { class: 'item' }, el('div', { class: 'l' }, 'Delete entire collection', el('div', { class: 'd' }, 'Cannot be undone. Export first!')), el('button', { class: 'btn small danger', onclick: wipe }, 'Delete'))),
    el('div', { class: 'muted small', style: 'margin:14px 4px' }, 'Card data & images: TCGdex.net · Pokédex names & sprites: PokéAPI. Not affiliated with Nintendo or The Pokémon Company.'));

  const onChange = ev => { const t = view.querySelector(`[data-id="${CSS.escape(ev.detail.id)}"]`); if (t) updateTile(t); };
  document.addEventListener('collection-changed', onChange);
  const obs = new MutationObserver(() => { if (!view.querySelector('.stat-grid')) { document.removeEventListener('collection-changed', onChange); obs.disconnect(); } });
  obs.observe(view, { childList: true });
}

const stat = (v, l) => el('div', { class: 'card-box stat' }, el('div', { class: 'v' }, String(v)), el('div', { class: 'l' }, l));
const settingRow = (label, desc, ctl) => el('div', { class: 'item' }, el('div', { class: 'l' }, label, desc && el('div', { class: 'd' }, desc)), ctl);
function select(opts, value, onchange) { const s = el('select', { onchange: e => onchange(e.target.value) }); opts.forEach(([v, l]) => s.append(el('option', { value: v, selected: v === value }, l))); return s; }
function toggle(value, onchange) { return el('input', { class: 'switch', type: 'checkbox', checked: value, onchange: e => onchange(e.target.checked) }); }

async function storageUsage() {
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); return `${(e.usage / 1048576).toFixed(1)} MB`; } } catch { /* */ }
  return 'unknown';
}
async function clearCaches() {
  await db.clear('sets');
  const all = await db.getAll('cache'); await Promise.all(all.filter(r => r.key.startsWith('card:') || r.key.startsWith('dex:')).map(r => db.delete('cache', r.key)));
  toast('Cache cleared'); renderMore();
}
async function wipe() {
  if (!confirm('Delete your whole collection and wishlist? This cannot be undone.')) return;
  if (!confirm('Really delete everything?')) return;
  await db.clear('collection'); await db.clear('wishlist'); state.collection.clear(); state.wishlist.clear();
  toast('Collection deleted'); renderMore();
}

function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove();
}
function exportJSON() {
  const data = { app: 'pokecollector', version: 2, exportedAt: new Date().toISOString(), collection: [...state.collection.values()], wishlist: [...state.wishlist.values()], settings: state.settings };
  download(`pokemon-collection-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
  toast('Exported');
}
function exportCSV() {
  const rows = [['card_id', 'set', 'number', 'name', 'qty', ...VARIANTS.map(([k]) => 'qty_' + k), 'rarity', 'dex_ids', 'market_price_usd']];
  for (const e of state.collection.values()) rows.push([e.id, e.setId, e.localId, e.name, e.qty, ...VARIANTS.map(([k]) => (e.variants || {})[k] || 0), e.rarity || '', (e.dexIds || []).join(' '), e.price && e.price.unit === 'USD' ? e.price.value : '']);
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`pokemon-collection-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
}
function importButton() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.collection)) throw new Error('Not a collection export');
      const coll = data.collection.filter(x => x && x.id && typeof x.qty === 'number').map(x => {
        if (!x.variants || typeof x.variants !== 'object') x.variants = x.qty > 0 ? { normal: x.qty } : {};
        x.qty = Object.values(x.variants).reduce((n, v) => n + (v | 0), 0); return x;
      }).filter(x => x.qty > 0);
      await db.putMany('collection', coll); coll.forEach(x => state.collection.set(x.id, x));
      if (Array.isArray(data.wishlist)) { await db.putMany('wishlist', data.wishlist); data.wishlist.forEach(x => state.wishlist.set(x.id, x)); }
      toast(`Imported ${coll.length} cards`); renderMore();
    } catch (err) { toast('Import failed: ' + err.message, 4000); }
  } });
  return el('span', {}, input, el('button', { class: 'btn small', onclick: () => input.click() }, 'Import'));
}

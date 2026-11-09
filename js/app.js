import { db } from './db.js';
import { api } from './api.js';
import { renderSets, renderSet } from './views-sets.js';
import { renderDex, renderRegion, renderPokemon } from './views-dex.js';
import { renderSearch, renderMore } from './views-more.js';
import { renderLookup } from './views-lookup.js';

// ---------- Shared state & helpers ----------
export const state = {
  settings: {
    countBasis: 'total',     // 'total' | 'official'
    showPocket: false,       // include Pokémon TCG Pocket (digital game) sets
    hideEmptySets: false,
    imageQuality: 'low',     // 'low' | 'high' for the detail sheet
    theme: 'auto',
    checkIntervalHours: 12,
  },
  collection: new Map(),     // cardId -> entry
  wishlist: new Map(),
  setsList: null,            // brief set list
  knownSetIds: [],
  newSetIds: [],
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

export function openModal(contentEl) {
  const m = $('#modal'); m.innerHTML = '';
  const sheet = el('div', { class: 'sheet' }, el('div', { class: 'handle' }), contentEl);
  m.append(sheet); m.classList.remove('hidden');
  m.onclick = e => { if (e.target === m) closeModal(); };
  document.body.style.overflow = 'hidden';
}
export function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; document.body.style.overflow = ''; }

export function setTitle(t, { back = false, actions = [] } = {}) {
  $('#title').textContent = t;
  $('#backBtn').classList.toggle('hidden', !back);
  const a = $('#topActions'); a.innerHTML = ''; actions.forEach(x => a.append(x));
  document.title = t === 'Sets' ? 'Pokémon Card Collector' : `${t} · Collector`;
}

export const pct = (have, total) => total ? Math.round((have / total) * 1000) / 10 : 0;
export const fmtPct = p => (p >= 100 ? '100' : p.toFixed(p < 10 && p > 0 ? 1 : 0)) + '%';

// Is this a Pokémon TCG Pocket (digital) set? Their ids look like A1, A2a, B1, P-A.
export const isPocketSet = s => /^(A\d|B\d|P-A)/.test(s.id);

export function visibleSets() {
  let list = state.setsList || [];
  if (!state.settings.showPocket) list = list.filter(s => !isPocketSet(s));
  return list;
}

// ---------- Collection operations ----------
export function setTotal(set) {
  const c = set.cardCount || {};
  return state.settings.countBasis === 'official' && c.official ? c.official : (c.total || 0);
}

// Owned count for a set (distinct cards within the counted range).
export function setOwned(setId, set) {
  let n = 0;
  const total = set ? setTotal(set) : Infinity;
  const official = state.settings.countBasis === 'official' && set && set.cardCount && set.cardCount.official;
  for (const e of state.collection.values()) {
    if (e.setId !== setId || e.qty <= 0) continue;
    if (official) { const num = parseInt(e.localId, 10); if (!(num >= 1 && num <= total)) continue; }
    n++;
  }
  return n;
}

// ---- Variants ----
// Each collection entry stores per-variant counts; `qty` is always their sum.
export const VARIANTS = [
  ['normal', 'Normal'], ['reverse', 'Reverse holo'], ['holo', 'Holo'], ['firstEdition', '1st edition'], ['wPromo', 'W promo'],
];
export const variantLabel = k => (VARIANTS.find(v => v[0] === k) || [k, k])[1];
export const variantShort = k => ({ normal: 'N', reverse: 'R', holo: 'H', firstEdition: '1st', wPromo: 'W' })[k] || k;
export const sumVariants = v => Object.values(v || {}).reduce((n, x) => n + (x | 0), 0);

// Which variants exist for a card: from the entry (filled in by enrich), the full card record, or a sensible default.
export function availableVariants(card, entry) {
  const src = (entry && entry.avail && entry.avail.length) ? entry.avail
    : card && card.variants ? Object.keys(card.variants).filter(k => card.variants[k])
    : null;
  if (src && src.length) return src;
  return ['normal', 'reverse', 'holo'];
}
export function defaultVariant(card, entry) {
  const avail = availableVariants(card, entry);
  return avail.includes('normal') ? 'normal' : avail[0];
}

function makeEntry(card, setId) {
  return {
    id: card.id, setId, localId: card.localId, name: card.name, image: card.image || null,
    qty: 0, variants: {}, avail: card.variants ? Object.keys(card.variants).filter(k => card.variants[k]) : [],
    dexIds: card.dexId || [], rarity: card.rarity || null, category: card.category || null,
    price: null, addedAt: Date.now(),
  };
}

async function commitEntry(entry, card) {
  entry.qty = sumVariants(entry.variants);
  const id = entry.id;
  if (entry.qty === 0) {
    state.collection.delete(id);
    await db.delete('collection', id);
  } else {
    state.collection.set(id, entry);
    await db.put('collection', entry);
    if (!entry.dexIds || !entry.dexIds.length || entry.price == null || !entry.avail || !entry.avail.length) enrichEntry(id);
  }
  document.dispatchEvent(new CustomEvent('collection-changed', { detail: { id, qty: entry.qty } }));
  return entry.qty;
}

// Adjust one variant's count by delta.
export async function changeVariant(card, setId, variant, delta) {
  const entry = state.collection.get(card.id) || makeEntry(card, setId);
  entry.variants = { ...(entry.variants || {}) };
  entry.variants[variant] = Math.max(0, Math.min(999, (entry.variants[variant] | 0) + delta));
  if (!entry.variants[variant]) delete entry.variants[variant];
  return commitEntry(entry, card);
}

// Adjust the total by delta, using the card's default variant (what the +/- on a tile does).
export async function changeQty(card, setId, delta) {
  const entry = state.collection.get(card.id);
  let variant = defaultVariant(card, entry);
  if (delta < 0 && entry) {
    // Remove from the default variant if we have one, otherwise from whichever variant has the most.
    if (!entry.variants[variant]) variant = Object.entries(entry.variants).sort((a, b) => b[1] - a[1])[0]?.[0] || variant;
  }
  return changeVariant(card, setId, variant, delta);
}

// Set the total directly (used by import). Keeps existing variant split where possible.
export async function setQty(card, setId, qty) {
  const entry = state.collection.get(card.id) || makeEntry(card, setId);
  const cur = sumVariants(entry.variants);
  if (qty !== cur) { const v = defaultVariant(card, entry); entry.variants = { ...entry.variants, [v]: Math.max(0, (entry.variants[v] | 0) + (qty - cur)) }; if (!entry.variants[v]) delete entry.variants[v]; }
  return commitEntry(entry, card);
}

// Fetch full card detail in the background to fill dexIds/rarity/price (needed for the Pokédex view).
const enriching = new Set();
export async function enrichEntry(id) {
  if (enriching.has(id)) return; enriching.add(id);
  try {
    const full = await api.getCard(id);
    const e = state.collection.get(id); if (!e) return;
    e.dexIds = full.dexId || []; e.rarity = full.rarity || e.rarity; e.category = full.category || e.category;
    e.image = full.image || e.image; e.price = marketPrice(full);
    if (full.variants) e.avail = Object.keys(full.variants).filter(k => full.variants[k]);
    await db.put('collection', e);
    document.dispatchEvent(new CustomEvent('collection-changed', { detail: { id, qty: e.qty, enriched: true } }));
  } catch (e) { /* offline; will retry next time it's touched */ } finally { enriching.delete(id); }
}

export function marketPrice(card) {
  const p = card && card.pricing;
  if (!p) return null;
  if (p.tcgplayer) {
    const v = p.tcgplayer; const variants = Object.keys(v).filter(k => v[k] && typeof v[k] === 'object');
    const prices = variants.map(k => v[k].marketPrice).filter(x => typeof x === 'number');
    if (prices.length) return { value: Math.min(...prices), unit: 'USD' };
  }
  if (p.cardmarket && typeof p.cardmarket.trend === 'number') return { value: p.cardmarket.trend, unit: 'EUR' };
  return null;
}

export async function toggleWish(card, setId) {
  if (state.wishlist.has(card.id)) { state.wishlist.delete(card.id); await db.delete('wishlist', card.id); toast('Removed from wishlist'); }
  else {
    const w = { id: card.id, setId, localId: card.localId, name: card.name, image: card.image || null, dexIds: card.dexId || [] };
    state.wishlist.set(card.id, w); await db.put('wishlist', w); toast('Added to wishlist ★');
  }
  document.dispatchEvent(new CustomEvent('collection-changed', { detail: { id: card.id, wish: true } }));
}

export async function saveSettings() {
  await db.setMeta('settings', state.settings);
  applyTheme();
}
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

// ---------- New-set detection ----------
// Runs on launch (throttled) and whenever the app returns to the foreground.
export async function checkForNewSets({ force = false, silent = false } = {}) {
  const last = await db.getMeta('lastSetCheck', 0);
  const interval = (state.settings.checkIntervalHours || 12) * 3600 * 1000;
  if (!force && Date.now() - last < interval && state.setsList) return state.newSetIds;
  try {
    const sets = await api.listSets(force ? 0 : interval);
    const known = new Set(state.knownSetIds);
    const fresh = sets.filter(s => !known.has(s.id)).map(s => s.id);
    state.setsList = sets;
    if (state.knownSetIds.length && fresh.length) {
      state.newSetIds = Array.from(new Set([...state.newSetIds, ...fresh]));
      await db.setMeta('newSetIds', state.newSetIds);
      showBanner(`${fresh.length} new set${fresh.length > 1 ? 's' : ''} released: ${sets.filter(s => fresh.includes(s.id)).map(s => s.name).join(', ')}`);
      notify('New Pokémon TCG set!', sets.filter(s => fresh.includes(s.id)).map(s => s.name).join(', '));
    } else if (!silent && force) toast('Sets are up to date');
    state.knownSetIds = sets.map(s => s.id);
    await db.setMeta('knownSetIds', state.knownSetIds);
    await db.setMeta('lastSetCheck', Date.now());
  } catch (e) {
    if (!silent) toast('Could not reach the card database (offline?)');
  }
  return state.newSetIds;
}
export async function clearNewFlag(id) {
  if (!state.newSetIds.includes(id)) return;
  state.newSetIds = state.newSetIds.filter(x => x !== id);
  await db.setMeta('newSetIds', state.newSetIds);
}
function showBanner(text) {
  const b = $('#banner'); b.innerHTML = '';
  b.append(el('span', {}, '✨ ' + text), el('span', { class: 'spacer' }),
    el('button', { class: 'btn small', onclick: () => { b.classList.add('hidden'); location.hash = '#/sets'; } }, 'View'));
  b.classList.remove('hidden');
}
async function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
  } catch { /* ignore */ }
}

// ---------- Router ----------
const routes = [
  [/^#\/sets$/, () => renderSets()],
  [/^#\/set\/([^/]+)$/, m => renderSet(decodeURIComponent(m[1]))],
  [/^#\/dex$/, () => renderDex()],
  [/^#\/dex\/([^/]+)$/, m => renderRegion(m[1])],
  [/^#\/pokemon\/(\d+)$/, m => renderPokemon(Number(m[1]))],
  [/^#\/search(?:\/(.*))?$/, m => renderSearch(m[1] ? decodeURIComponent(m[1]) : '')],
  [/^#\/lookup$/, () => renderLookup()],
  [/^#\/more$/, () => renderMore()],
];
const scrollPos = new Map();
let currentHash = '';
async function route() {
  if (currentHash) scrollPos.set(currentHash, window.scrollY);
  const hash = location.hash || '#/sets';
  currentHash = hash;
  const tab = hash.startsWith('#/set') ? 'sets' : hash.startsWith('#/dex') || hash.startsWith('#/pokemon') ? 'dex' : hash.startsWith('#/search') || hash.startsWith('#/lookup') ? 'search' : 'more';
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  const view = $('#view'); view.innerHTML = '';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await fn(m); } catch (e) {
        console.error(e);
        view.innerHTML = `<div class="empty"><div class="big">⚠️</div><div>${esc(e.message || e)}</div><button class="btn" onclick="location.reload()">Reload</button></div>`;
      }
      window.scrollTo(0, scrollPos.get(hash) || 0);
      return;
    }
  }
  location.hash = '#/sets';
}

// ---------- Boot ----------
async function boot() {
  const saved = await db.getMeta('settings');
  if (saved) Object.assign(state.settings, saved);
  applyTheme();
  (await db.getAll('collection')).forEach(e => {
    if (!e.variants) { e.variants = e.qty > 0 ? { normal: e.qty } : {}; e.avail = e.avail || []; db.put('collection', e); }
    state.collection.set(e.id, e);
  });
  (await db.getAll('wishlist')).forEach(e => state.wishlist.set(e.id, e));
  state.knownSetIds = await db.getMeta('knownSetIds', []);
  state.newSetIds = await db.getMeta('newSetIds', []);
  state.setsList = await db.getCached('sets:list', null);

  $('#backBtn').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/sets'; };
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForNewSets({ silent: true }).then(() => { if (location.hash === '#/sets' || !location.hash) route(); }); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(async reg => {
      try { if ('periodicSync' in reg) await reg.periodicSync.register('check-sets', { minInterval: 12 * 3600 * 1000 }); } catch { /* not granted */ }
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', ev => { if (ev.data && ev.data.type === 'sets-updated') checkForNewSets({ force: true, silent: true }).then(route); });
  }

  // First launch: make sure we know the set list, then route.
  if (!state.setsList) await checkForNewSets({ force: true, silent: true });
  else checkForNewSets({ silent: true }).then(() => { if (location.hash === '#/sets' || !location.hash) route(); });
  await route();
}
boot();

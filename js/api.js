// Data sources (all free, no API keys):
//   TCGdex  - sets, cards, card images     https://tcgdex.dev
//   PokéAPI - Pokédex names + tiny sprites https://pokeapi.co
import { db } from './db.js';

const TCG = 'https://api.tcgdex.net/v2/en';
const POKEAPI = 'https://pokeapi.co/api/v2';
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

const DAY = 24 * 60 * 60 * 1000;

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Cached fetch: serve from IndexedDB when fresh, otherwise hit the network.
// If the network fails and we have a stale copy, return the stale copy.
async function cachedJSON(key, url, maxAge) {
  const fresh = await db.getCached(key, maxAge);
  if (fresh) return fresh;
  try {
    const data = await getJSON(url);
    await db.setCached(key, data);
    return data;
  } catch (e) {
    const stale = await db.getCached(key, null);
    if (stale) return stale;
    throw e;
  }
}

export const api = {
  imageUrl(base, quality = 'low') {
    return base ? `${base}/${quality}.webp` : null;
  },
  logoUrl(base) { return base ? `${base}.webp` : null; },

  // All English sets. Refreshed at most once per `maxAge`.
  listSets(maxAge = DAY) { return cachedJSON('sets:list', `${TCG}/sets`, maxAge); },
  listSeries(maxAge = 7 * DAY) { return cachedJSON('series:list', `${TCG}/series`, maxAge); },

  // Full set detail incl. its card list (id, localId, name, image).
  async getSet(id, force = false) {
    if (!force) {
      const row = await db.get('sets', id);
      // Re-check sets younger than ~60 days daily (card images/counts get filled in after release).
      if (row && row.savedAt) {
        const recent = row.releaseDate && (Date.now() - Date.parse(row.releaseDate) < 60 * DAY);
        const age = Date.now() - row.savedAt;
        if (!recent || age < DAY) return row;
      }
    }
    try {
      const data = await getJSON(`${TCG}/sets/${encodeURIComponent(id)}`);
      data.savedAt = Date.now();
      await db.put('sets', data);
      return data;
    } catch (e) {
      const row = await db.get('sets', id);
      if (row) return row;
      throw e;
    }
  },

  // Full card detail (dexId, rarity, pricing...). Cached 7 days.
  getCard(id) { return cachedJSON(`card:${id}`, `${TCG}/cards/${encodeURIComponent(id)}`, 7 * DAY); },

  // Every card featuring a given National Dex number.
  cardsByDex(dexId) { return cachedJSON(`dex:${dexId}`, `${TCG}/cards?dexId=eq:${dexId}`, 3 * DAY); },

  // Name search across all cards (brief records).
  async searchCards(name) {
    const q = encodeURIComponent(name.trim());
    return getJSON(`${TCG}/cards?name=${q}`);
  },

  // National Pokédex: [{ id, name }] for every species. Cached 30 days.
  async pokedex() {
    const cached = await db.getCached('pokedex', 30 * DAY);
    if (cached) return cached;
    const data = await getJSON(`${POKEAPI}/pokemon-species?limit=2000`);
    const list = data.results.map(r => {
      const id = Number(r.url.replace(/\/$/, '').split('/').pop());
      return { id, name: r.name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('-') };
    }).filter(p => p.id > 0).sort((a, b) => a.id - b.id);
    // Tidy a few names that PokéAPI slugifies.
    const fix = { 'Nidoran-f': 'Nidoran♀', 'Nidoran-m': 'Nidoran♂', 'Mr-mime': 'Mr. Mime', 'Mime-jr': 'Mime Jr.',
      'Farfetchd': "Farfetch'd", 'Sirfetchd': "Sirfetch'd", 'Mr-rime': 'Mr. Rime', 'Type-null': 'Type: Null',
      'Ho-oh': 'Ho-Oh', 'Porygon-z': 'Porygon-Z', 'Jangmo-o': 'Jangmo-o', 'Hakamo-o': 'Hakamo-o', 'Kommo-o': 'Kommo-o',
      'Tapu-koko': 'Tapu Koko', 'Tapu-lele': 'Tapu Lele', 'Tapu-bulu': 'Tapu Bulu', 'Tapu-fini': 'Tapu Fini',
      'Great-tusk': 'Great Tusk', 'Scream-tail': 'Scream Tail', 'Brute-bonnet': 'Brute Bonnet', 'Flutter-mane': 'Flutter Mane',
      'Slither-wing': 'Slither Wing', 'Sandy-shocks': 'Sandy Shocks', 'Iron-treads': 'Iron Treads', 'Iron-bundle': 'Iron Bundle',
      'Iron-hands': 'Iron Hands', 'Iron-jugulis': 'Iron Jugulis', 'Iron-moth': 'Iron Moth', 'Iron-thorns': 'Iron Thorns',
      'Roaring-moon': 'Roaring Moon', 'Iron-valiant': 'Iron Valiant', 'Walking-wake': 'Walking Wake', 'Iron-leaves': 'Iron Leaves',
      'Gouging-fire': 'Gouging Fire', 'Raging-bolt': 'Raging Bolt', 'Iron-boulder': 'Iron Boulder', 'Iron-crown': 'Iron Crown',
      'Wo-chien': 'Wo-Chien', 'Chien-pao': 'Chien-Pao', 'Ting-lu': 'Ting-Lu', 'Chi-yu': 'Chi-Yu', 'Flabebe': 'Flabébé' };
    list.forEach(p => { if (fix[p.name]) p.name = fix[p.name]; });
    await db.setCached('pokedex', list);
    return list;
  },

  // ~1-3 KB pixel sprite per species.
  spriteUrl(dexId) { return `${SPRITES}/${dexId}.png`; },
};

// Regions / generations by National Dex range.
export const REGIONS = [
  { id: 'kanto', name: 'Kanto', gen: 1, from: 1, to: 151 },
  { id: 'johto', name: 'Johto', gen: 2, from: 152, to: 251 },
  { id: 'hoenn', name: 'Hoenn', gen: 3, from: 252, to: 386 },
  { id: 'sinnoh', name: 'Sinnoh', gen: 4, from: 387, to: 493 },
  { id: 'unova', name: 'Unova', gen: 5, from: 494, to: 649 },
  { id: 'kalos', name: 'Kalos', gen: 6, from: 650, to: 721 },
  { id: 'alola', name: 'Alola', gen: 7, from: 722, to: 809 },
  { id: 'galar', name: 'Galar & Hisui', gen: 8, from: 810, to: 905 },
  { id: 'paldea', name: 'Paldea', gen: 9, from: 906, to: 1025 },
  { id: 'beyond', name: 'Newer', gen: 10, from: 1026, to: 9999 },
];

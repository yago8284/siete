const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000;

// TMDB Network IDs
const NETWORKS = [
  // Americké prémiové
  { id: 49,   name: 'HBO',        emoji: '🎭' },
  { id: 174,  name: 'AMC',        emoji: '🎬' },
  { id: 56,   name: 'Showtime',   emoji: '🎪' },
  { id: 67,   name: 'Syfy',       emoji: '🚀' },
  { id: 77,   name: 'FX',         emoji: '🔥' },
  { id: 1,    name: 'ABC',        emoji: '📺' },
  { id: 6,    name: 'NBC',        emoji: '📡' },
  { id: 16,   name: 'CBS',        emoji: '👁️' },
  { id: 19,   name: 'FOX',        emoji: '🦊' },
  { id: 30,   name: 'USA Network', emoji: '🇺🇸' },
  { id: 41,   name: 'TNT',        emoji: '💥' },
  { id: 318,  name: 'Starz',      emoji: '⭐' },
  { id: 43,   name: 'Cartoon Network', emoji: '🎨' },
  { id: 2739, name: 'Disney+',    emoji: '✨' },
  { id: 213,  name: 'Netflix',    emoji: '🔴' },
  { id: 1024, name: 'Amazon',     emoji: '📦' },
  { id: 2552, name: 'Apple TV+',  emoji: '🍎' },
  { id: 3353, name: 'Peacock',    emoji: '🦚' },
  { id: 453,  name: 'Hulu',       emoji: '💚' },
  // Britské
  { id: 4,    name: 'BBC One',    emoji: '🇬🇧' },
  { id: 9,    name: 'BBC Two',    emoji: '🇬🇧' },
  { id: 59,   name: 'ITV',        emoji: '🎠' },
  { id: 84,   name: 'Channel 4',  emoji: '4️⃣' },
  { id: 136,  name: 'Sky One',    emoji: '☁️' },
];

const TV_GENRES = [
  { id: 10759, name: 'Akcia'          },
  { id: 16,    name: 'Animácia'       },
  { id: 35,    name: 'Komédia'        },
  { id: 80,    name: 'Krimi'          },
  { id: 99,    name: 'Dokumentárny'   },
  { id: 18,    name: 'Dráma'          },
  { id: 10751, name: 'Rodinný'        },
  { id: 9648,  name: 'Mysteriózny'    },
  { id: 878,   name: 'Sci-Fi'         },
  { id: 10765, name: 'Sci-Fi/Fantasy' },
  { id: 53,    name: 'Thriller'       },
];

// Cache pre každú sieť
var networkCache = {};
NETWORKS.forEach(function(n) {
  networkCache[n.id] = { series: [], lastFetch: 0, building: false };
});

// Manifest
var catalogs = [];
NETWORKS.forEach(function(n) {
  catalogs.push({
    type: 'series',
    id: 'network-' + n.id,
    name: n.emoji + ' ' + n.name,
    extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }]
  });
});

// Žánrové katalógy
TV_GENRES.forEach(function(g) {
  catalogs.push({
    type: 'series',
    id: 'netgenre-' + g.id,
    name: '🎭 ' + g.name + ' (všetky siete)',
    extra: [{ name: 'skip', isRequired: false }]
  });
});

// Špeciálne
catalogs.push({ type: 'series', id: 'net-trending-week', name: '📈 Trending tento týždeň', extra: [{ name: 'skip', isRequired: false }] });
catalogs.push({ type: 'series', id: 'net-top-rated',     name: '⭐ Najlepšie hodnotené',   extra: [{ name: 'skip', isRequired: false }] });
catalogs.push({ type: 'series', id: 'net-new',           name: '🆕 Najnovšie seriály',     extra: [{ name: 'skip', isRequired: false }] });

const MANIFEST = {
  id: 'community.tv-networks-catalog',
  version: '1.0.0',
  name: 'TV Siete – Seriály',
  description: 'Seriály podľa TV sietí — HBO, AMC, SyFy, BBC, FX, Netflix, Disney+ a ďalšie',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/200px-Netflix_2015_logo.svg.png',
  resources: ['catalog'],
  types: ['series'],
  catalogs: catalogs,
  idPrefixes: ['tmdb:'],
};

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

async function tmdbFetch(url) {
  var r = await fetch(url);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

function toItem(item) {
  return {
    id: 'tmdb:' + item.id,
    type: 'series',
    name: item.name || item.original_name || '',
    poster: item.poster_path ? 'https://image.tmdb.org/t/p/w500' + item.poster_path : undefined,
    background: item.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + item.backdrop_path : undefined,
    description: item.overview || '',
    releaseInfo: (item.first_air_date || '').substring(0, 4),
    imdbRating: item.vote_average ? String(item.vote_average.toFixed(1)) : undefined,
  };
}

function parseExtra(extraStr, query) {
  var params = { skip: 0, search: null };
  if (extraStr) {
    extraStr.split('&').forEach(function(part) {
      var kv = part.split('=');
      if (kv.length >= 2) params[kv[0]] = decodeURIComponent(kv.slice(1).join('='));
    });
  }
  if (query.skip)   params.skip   = parseInt(query.skip) || 0;
  if (query.search) params.search = query.search;
  return params;
}

function dedup(arr) {
  var seen = {};
  return arr.filter(function(item) {
    if (!item || !item.id || seen[item.id]) return false;
    seen[item.id] = true;
    return true;
  });
}

// Fetch seriálov pre sieť — viac strán, zoradené podľa popularity
async function fetchNetwork(networkId, maxPages) {
  maxPages = maxPages || 15;
  var results = [];
  var base = 'https://api.themoviedb.org/3/discover/tv'
    + '?api_key=' + TMDB_KEY
    + '&with_networks=' + networkId
    + '&language=cs-CZ&include_adult=false'
    + '&sort_by=popularity.desc';
  for (var p = 1; p <= maxPages; p++) {
    try {
      var d = await tmdbFetch(base + '&page=' + p);
      results = results.concat(d.results || []);
      if (p >= (d.total_pages || 1)) break;
      await new Promise(function(r) { setTimeout(r, 80); });
    } catch(e) { break; }
  }
  return results;
}

var buildPromises = {};

async function buildNetworkCache(network) {
  var c = networkCache[network.id];
  if (c.building) return;
  if (Date.now() - c.lastFetch < CACHE_TTL) return;
  c.building = true;
  console.log('[' + network.name + '] Budovanie cache...');
  try {
    var results = await fetchNetwork(network.id, 15);
    var series = dedup(results);
    series.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    networkCache[network.id] = { series: series, lastFetch: Date.now(), building: false };
    console.log('[' + network.name + '] ' + series.length + ' serialov');
  } catch(e) {
    c.building = false;
    console.error('[' + network.name + '] Chyba: ' + e.message);
  }
}

async function ensureCache(network) {
  var c = networkCache[network.id];
  if (c.series.length > 0 && Date.now() - c.lastFetch < CACHE_TTL) return;
  if (!buildPromises[network.id]) {
    buildPromises[network.id] = buildNetworkCache(network).finally(function() { delete buildPromises[network.id]; });
  }
  await Promise.race([buildPromises[network.id], new Promise(function(r) { setTimeout(r, 120000); })]);
}

async function searchTMDB(query, page) {
  var url = 'https://api.themoviedb.org/3/search/tv'
    + '?api_key=' + TMDB_KEY
    + '&query=' + encodeURIComponent(query)
    + '&language=cs-CZ&include_adult=false&page=' + (page || 1);
  var d = await tmdbFetch(url);
  return (d.results || []).map(toItem);
}

var trendingCache = null;
var trendingFetch = 0;

async function getTrending() {
  if (trendingCache && Date.now() - trendingFetch < 3600000) return trendingCache;
  var results = [];
  for (var p = 1; p <= 5; p++) {
    try {
      var d = await tmdbFetch('https://api.themoviedb.org/3/trending/tv/week?api_key=' + TMDB_KEY + '&language=cs-CZ&page=' + p);
      results = results.concat((d.results || []).map(toItem));
      if (p >= (d.total_pages || 1)) break;
    } catch(e) { break; }
  }
  trendingCache = results;
  trendingFetch = Date.now();
  return results;
}

async function fetchGenre(genreId, skip) {
  var page = Math.floor(skip / 20) + 1;
  var url = 'https://api.themoviedb.org/3/discover/tv'
    + '?api_key=' + TMDB_KEY
    + '&with_genres=' + genreId
    + '&language=cs-CZ&include_adult=false'
    + '&sort_by=popularity.desc&vote_count.gte=20'
    + '&page=' + page;
  var d = await tmdbFetch(url);
  return (d.results || []).map(toItem);
}

async function fetchTopRated(skip) {
  var page = Math.floor(skip / 20) + 1;
  var url = 'https://api.themoviedb.org/3/discover/tv'
    + '?api_key=' + TMDB_KEY
    + '&sort_by=vote_average.desc&vote_count.gte=500'
    + '&language=cs-CZ&include_adult=false'
    + '&page=' + page;
  var d = await tmdbFetch(url);
  return (d.results || []).map(toItem);
}

async function fetchNew(skip) {
  var page = Math.floor(skip / 20) + 1;
  var url = 'https://api.themoviedb.org/3/discover/tv'
    + '?api_key=' + TMDB_KEY
    + '&sort_by=first_air_date.desc&vote_count.gte=10'
    + '&language=cs-CZ&include_adult=false'
    + '&page=' + page;
  var d = await tmdbFetch(url);
  return (d.results || []).map(toItem);
}

app.get('/manifest.json', function(req, res) { res.json(MANIFEST); });

app.get('/catalog/series/:id/:extra?.json', async function(req, res) {
  try {
    var id = req.params.id;
    var extra = parseExtra(req.params.extra || '', req.query);

    // Search
    if (extra.search) {
      var sr = await searchTMDB(extra.search, Math.floor(extra.skip / 20) + 1);
      return res.json({ metas: sr });
    }

    // Trending
    if (id === 'net-trending-week') {
      var tr = await getTrending();
      return res.json({ metas: tr.slice(extra.skip, extra.skip + 20) });
    }

    // Top rated
    if (id === 'net-top-rated') {
      return res.json({ metas: await fetchTopRated(extra.skip) });
    }

    // Najnovšie
    if (id === 'net-new') {
      return res.json({ metas: await fetchNew(extra.skip) });
    }

    // Žáner
    if (id.startsWith('netgenre-')) {
      var genreId = id.replace('netgenre-', '');
      return res.json({ metas: await fetchGenre(genreId, extra.skip) });
    }

    // Sieť
    if (id.startsWith('network-')) {
      var networkId = parseInt(id.replace('network-', ''));
      var network = null;
      for (var i = 0; i < NETWORKS.length; i++) {
        if (NETWORKS[i].id === networkId) { network = NETWORKS[i]; break; }
      }
      if (!network) return res.json({ metas: [] });

      await ensureCache(network);
      var c = networkCache[network.id];
      var items = c.series.map(toItem).slice(extra.skip, extra.skip + 20);
      return res.json({ metas: items });
    }

    res.json({ metas: [] });
  } catch(e) {
    console.error(e);
    res.status(500).json({ metas: [] });
  }
});

app.get('/', function(req, res) {
  var rows = NETWORKS.map(function(n) {
    var c = networkCache[n.id];
    var age = c.lastFetch ? Math.round((Date.now() - c.lastFetch) / 60000) + ' min' : 'nahrava sa';
    return n.emoji + ' ' + n.name + ': ' + c.series.length + ' serialov (' + age + ')';
  }).join('\n');
  res.send('<pre>TV Siete – Seriály v1.0\n\n' + rows + '\n\n<a href="/manifest.json">/manifest.json</a></pre>');
});

app.listen(PORT, function() {
  console.log('Server TV Siete na porte ' + PORT);
  (async function() {
    for (var i = 0; i < NETWORKS.length; i++) {
      await buildNetworkCache(NETWORKS[i]);
    }
  })();
});

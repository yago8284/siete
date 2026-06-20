const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const CACHE_TTL = 6 * 60 * 60 * 1000;

const NETWORKS = [
  { id: 49,   name: 'HBO',             emoji: '🎭' },
  { id: 174,  name: 'AMC',             emoji: '🎬' },
  { id: 56,   name: 'Showtime',        emoji: '🎪' },
  { id: 67,   name: 'Syfy',            emoji: '🚀' },
  { id: 77,   name: 'FX',              emoji: '🔥' },
  { id: 1,    name: 'ABC',             emoji: '📺' },
  { id: 6,    name: 'NBC',             emoji: '📡' },
  { id: 16,   name: 'CBS',             emoji: '👁️' },
  { id: 19,   name: 'FOX',             emoji: '🦊' },
  { id: 30,   name: 'USA Network',     emoji: '🇺🇸' },
  { id: 41,   name: 'TNT',             emoji: '💥' },
  { id: 318,  name: 'Starz',           emoji: '⭐' },
  { id: 43,   name: 'Cartoon Network', emoji: '🎨' },
  { id: 2739, name: 'Disney+',         emoji: '✨' },
  { id: 213,  name: 'Netflix',         emoji: '🔴' },
  { id: 1024, name: 'Amazon',          emoji: '📦' },
  { id: 2552, name: 'Apple TV+',       emoji: '🍎' },
  { id: 3353, name: 'Peacock',         emoji: '🦚' },
  { id: 453,  name: 'Hulu',            emoji: '💚' },
  { id: 4,    name: 'BBC One',         emoji: '🇬🇧' },
  { id: 9,    name: 'BBC Two',         emoji: '🇬🇧' },
  { id: 59,   name: 'ITV',             emoji: '🎠' },
  { id: 84,   name: 'Channel 4',       emoji: '4️⃣' },
  { id: 136,  name: 'Sky One',         emoji: '☁️' },
];

const TV_GENRES = [
  { id: 10759, name: 'Akcia'           },
  { id: 16,    name: 'Animacia'        },
  { id: 35,    name: 'Komedia'         },
  { id: 80,    name: 'Krimi'           },
  { id: 99,    name: 'Dokumentarny'    },
  { id: 18,    name: 'Drama'           },
  { id: 10751, name: 'Rodinny'         },
  { id: 9648,  name: 'Mysteriozny'     },
  { id: 878,   name: 'Sci-Fi'          },
  { id: 10765, name: 'Sci-Fi/Fantasy'  },
  { id: 53,    name: 'Thriller'        },
];

var networkCache = {};
NETWORKS.forEach(function(n) {
  networkCache[n.id] = { series: [], lastFetch: 0, building: false };
});

var genreCache = {};
TV_GENRES.forEach(function(g) {
  genreCache['g'+g.id] = { series: [], lastFetch: 0, building: false };
});

var specialCache = {
  trending: { series: [], lastFetch: 0, building: false },
  toprated: { series: [], lastFetch: 0, building: false },
  newest:   { series: [], lastFetch: 0, building: false },
};

var catalogs = [];
NETWORKS.forEach(function(n) {
  catalogs.push({ type: 'series', id: 'network-' + n.id, name: n.emoji + ' ' + n.name, extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }] });
});
TV_GENRES.forEach(function(g) {
  catalogs.push({ type: 'series', id: 'netgenre-' + g.id, name: '🎭 ' + g.name + ' (vsetky siete)', extra: [{ name: 'skip', isRequired: false }] });
});
catalogs.push({ type: 'series', id: 'net-trending-week', name: '📈 Trending tento tyzden', extra: [{ name: 'skip', isRequired: false }] });
catalogs.push({ type: 'series', id: 'net-top-rated',     name: '⭐ Najlepsie hodnotene',  extra: [{ name: 'skip', isRequired: false }] });
catalogs.push({ type: 'series', id: 'net-new',           name: '🆕 Najnovsie serialy',    extra: [{ name: 'skip', isRequired: false }] });

const MANIFEST = {
  id: 'community.tv-networks-catalog',
  version: '1.1.0',
  name: 'TV Siete - Serialy',
  description: 'Serialy podla TV sieti — HBO, AMC, SyFy, BBC, FX, Netflix, Disney+ a dalsie',
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

async function fetchPages(url, maxPages) {
  var results = [];
  for (var p = 1; p <= maxPages; p++) {
    try {
      var d = await tmdbFetch(url + '&page=' + p);
      results = results.concat(d.results || []);
      if (p >= (d.total_pages || 1)) break;
      await new Promise(function(r) { setTimeout(r, 100); });
    } catch(e) { break; }
  }
  return results;
}

var buildPromises = {};

async function buildNetworkCache(network) {
  var c = networkCache[network.id];
  if (c.building || Date.now() - c.lastFetch < CACHE_TTL) return;
  c.building = true;
  console.log('[' + network.name + '] Budovanie cache...');
  try {
    var url = 'https://api.themoviedb.org/3/discover/tv?api_key=' + TMDB_KEY
      + '&with_networks=' + network.id
      + '&language=cs-CZ&include_adult=false&sort_by=popularity.desc';
    var results = await fetchPages(url, 15);
    var series = dedup(results);
    series.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    networkCache[network.id] = { series: series, lastFetch: Date.now(), building: false };
    console.log('[' + network.name + '] ' + series.length + ' serialov');
  } catch(e) {
    c.building = false;
    console.error('[' + network.name + '] Chyba: ' + e.message);
  }
}

async function buildGenreCache(genre) {
  var c = genreCache['g'+genre.id];
  if (c.building || Date.now() - c.lastFetch < CACHE_TTL) return;
  c.building = true;
  console.log('[zanr ' + genre.name + '] Budovanie cache...');
  try {
    var url = 'https://api.themoviedb.org/3/discover/tv?api_key=' + TMDB_KEY
      + '&with_genres=' + genre.id
      + '&language=cs-CZ&include_adult=false&sort_by=popularity.desc&vote_count.gte=20';
    var results = await fetchPages(url, 10);
    var series = dedup(results);
    genreCache['g'+genre.id] = { series: series, lastFetch: Date.now(), building: false };
    console.log('[zanr ' + genre.name + '] ' + series.length + ' serialov');
  } catch(e) {
    c.building = false;
    console.error('[zanr ' + genre.name + '] Chyba: ' + e.message);
  }
}

async function buildSpecialCache(key, url, maxPages) {
  var c = specialCache[key];
  if (c.building || Date.now() - c.lastFetch < CACHE_TTL) return;
  c.building = true;
  try {
    var results = await fetchPages(url, maxPages);
    specialCache[key] = { series: dedup(results), lastFetch: Date.now(), building: false };
    console.log('[' + key + '] ' + specialCache[key].series.length + ' serialov');
  } catch(e) {
    c.building = false;
    console.error('[' + key + '] Chyba: ' + e.message);
  }
}

async function ensureNetworkCache(network) {
  var c = networkCache[network.id];
  if (c.series.length > 0 && Date.now() - c.lastFetch < CACHE_TTL) return;
  var key = 'n' + network.id;
  if (!buildPromises[key]) buildPromises[key] = buildNetworkCache(network).finally(function() { delete buildPromises[key]; });
  await Promise.race([buildPromises[key], new Promise(function(r) { setTimeout(r, 60000); })]);
}

async function ensureGenreCache(genre) {
  var c = genreCache['g'+genre.id];
  if (c.series.length > 0 && Date.now() - c.lastFetch < CACHE_TTL) return;
  var key = 'g' + genre.id;
  if (!buildPromises[key]) buildPromises[key] = buildGenreCache(genre).finally(function() { delete buildPromises[key]; });
  await Promise.race([buildPromises[key], new Promise(function(r) { setTimeout(r, 60000); })]);
}

async function ensureSpecialCache(key, url, maxPages) {
  var c = specialCache[key];
  if (c.series.length > 0 && Date.now() - c.lastFetch < CACHE_TTL) return;
  var pk = 's' + key;
  if (!buildPromises[pk]) buildPromises[pk] = buildSpecialCache(key, url, maxPages).finally(function() { delete buildPromises[pk]; });
  await Promise.race([buildPromises[pk], new Promise(function(r) { setTimeout(r, 60000); })]);
}

async function searchTMDB(query, page) {
  var url = 'https://api.themoviedb.org/3/search/tv?api_key=' + TMDB_KEY
    + '&query=' + encodeURIComponent(query)
    + '&language=cs-CZ&include_adult=false&page=' + (page || 1);
  var d = await tmdbFetch(url);
  return (d.results || []).map(toItem);
}

app.get('/manifest.json', function(req, res) { res.json(MANIFEST); });

app.get('/catalog/series/:id/:extra?.json', async function(req, res) {
  try {
    var id = req.params.id;
    var extra = parseExtra(req.params.extra || '', req.query);

    if (extra.search) {
      return res.json({ metas: await searchTMDB(extra.search, Math.floor(extra.skip / 20) + 1) });
    }

    if (id === 'net-trending-week') {
      var tUrl = 'https://api.themoviedb.org/3/trending/tv/week?api_key=' + TMDB_KEY + '&language=cs-CZ';
      await ensureSpecialCache('trending', tUrl, 5);
      var tr = specialCache['trending'].series.map(toItem);
      return res.json({ metas: tr.slice(extra.skip, extra.skip + 20) });
    }

    if (id === 'net-top-rated') {
      var trUrl = 'https://api.themoviedb.org/3/discover/tv?api_key=' + TMDB_KEY + '&sort_by=vote_average.desc&vote_count.gte=500&language=cs-CZ&include_adult=false';
      await ensureSpecialCache('toprated', trUrl, 10);
      var top = specialCache['toprated'].series.map(toItem);
      return res.json({ metas: top.slice(extra.skip, extra.skip + 20) });
    }

    if (id === 'net-new') {
      var nUrl = 'https://api.themoviedb.org/3/discover/tv?api_key=' + TMDB_KEY + '&sort_by=first_air_date.desc&vote_count.gte=10&language=cs-CZ&include_adult=false';
      await ensureSpecialCache('newest', nUrl, 10);
      var nw = specialCache['newest'].series.map(toItem);
      return res.json({ metas: nw.slice(extra.skip, extra.skip + 20) });
    }

    if (id.startsWith('netgenre-')) {
      var genreId = parseInt(id.replace('netgenre-', ''));
      var genre = null;
      for (var i = 0; i < TV_GENRES.length; i++) {
        if (TV_GENRES[i].id === genreId) { genre = TV_GENRES[i]; break; }
      }
      if (!genre) return res.json({ metas: [] });
      await ensureGenreCache(genre);
      var gs = genreCache['g'+genreId].series.map(toItem);
      return res.json({ metas: gs.slice(extra.skip, extra.skip + 20) });
    }

    if (id.startsWith('network-')) {
      var networkId = parseInt(id.replace('network-', ''));
      var network = null;
      for (var j = 0; j < NETWORKS.length; j++) {
        if (NETWORKS[j].id === networkId) { network = NETWORKS[j]; break; }
      }
      if (!network) return res.json({ metas: [] });
      await ensureNetworkCache(network);
      var ns = networkCache[network.id].series.map(toItem);
      return res.json({ metas: ns.slice(extra.skip, extra.skip + 20) });
    }

    res.json({ metas: [] });
  } catch(e) {
    console.error('[catalog error] id=' + req.params.id + ' err=' + e.message);
    res.status(500).json({ metas: [] });
  }
});

app.get('/', function(req, res) {
  var rows = NETWORKS.map(function(n) {
    var c = networkCache[n.id];
    var age = c.lastFetch ? Math.round((Date.now() - c.lastFetch) / 60000) + ' min' : 'nahrava sa';
    return n.emoji + ' ' + n.name + ': ' + c.series.length + ' serialov (' + age + ')';
  }).join('\n');
  var gRows = TV_GENRES.map(function(g) {
    var c = genreCache['g'+g.id];
    var age = c.lastFetch ? Math.round((Date.now() - c.lastFetch) / 60000) + ' min' : 'nahrava sa';
    return '🎭 ' + g.name + ': ' + c.series.length + ' serialov (' + age + ')';
  }).join('\n');
  res.send('<pre>TV Siete v1.1\n\n' + rows + '\n\nZANRE:\n' + gRows + '\n\n<a href="/manifest.json">/manifest.json</a></pre>');
});

app.listen(PORT, function() {
  console.log('Server TV Siete na porte ' + PORT);

  (async function() {
    var tUrl  = 'https://api.themoviedb.org/3/trending/tv/week?api_key=' + TMDB_KEY + '&language=cs-CZ';
    var trUrl = 'https://api.themoviedb.org/3/discover/tv?api_key=' + TMDB_KEY + '&sort_by=vote_average.desc&vote_count.gte=500&language=cs-CZ&include_adult=false';
    var nUrl  = 'https://api.themoviedb.org/3/discover/tv?api_key=' + TMDB_KEY + '&sort_by=first_air_date.desc&vote_count.gte=10&language=cs-CZ&include_adult=false';

    await Promise.all(
      TV_GENRES.map(function(g) { return buildGenreCache(g); }).concat([
        buildSpecialCache('trending', tUrl, 5),
        buildSpecialCache('toprated', trUrl, 10),
        buildSpecialCache('newest', nUrl, 10),
      ])
    );
    console.log('Zanre a specialne katalogy hotove');

    for (var i = 0; i < NETWORKS.length; i++) {
      await buildNetworkCache(NETWORKS[i]);
    }
    console.log('Vsetky siete hotove');
  })();
});


const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 4000;

// ─── FEEDS RSS ────────────────────────────────────────────
// Podes adicionar/remover fontes aqui
const FEEDS = [
  // ── Notícias ── Branco
  { id: 'publico',     name: 'Público',         color: '#94a3b8', category: 'noticias', url: 'https://feeds.feedburner.com/PublicoRSS' },
  { id: 'observador',  name: 'Observador',       color: '#64748b', category: 'noticias', url: 'https://observador.pt/feed/' },

  // ── Jogos ── Verde
  { id: 'pcgamer',     name: 'PC Gamer',         color: '#22c55e', category: 'jogos', url: 'https://www.pcgamer.com/rss/' },
  { id: 'eurogamerpt', name: 'Eurogamer PT',     color: '#16a34a', category: 'jogos', url: 'https://www.eurogamer.pt/feed' },
  { id: 'gamerpower',  name: 'Ofertas',          color: '#4ade80', category: 'jogos', url: 'https://www.gamerpower.com/rss/giveaways' },

  // ── Esports ── Laranja
  { id: 'rtparena',    name: 'RTP Arena',        color: '#f97316', category: 'esports', url: 'https://arena.rtp.pt/feed/' },
  { id: 'hltv',        name: 'HLTV',             color: '#ea580c', category: 'esports', url: 'https://www.hltv.org/rss/news' },
  { id: 'cs2updates',  name: 'Counter Strike 2', color: '#fb923c', category: 'esports', url: 'https://steamcommunity.com/games/csgo/rss/' },

  // ── F1 ── Vermelho
  { id: 'autosport',   name: 'Autosport',        color: '#ef4444', category: 'f1', url: 'https://www.autosport.com/rss/f1/news/' },
  { id: 'motorsport',  name: 'Motorsport.com',   color: '#dc2626', category: 'f1', url: 'https://www.motorsport.com/rss/f1/news/' },
  { id: 'f1technical', name: 'F1 Technical',     color: '#b91c1c', category: 'f1', url: 'https://www.f1technical.net/rss/news.xml' },

  // ── Tecnologia ── Azul
  { id: 'pplware',     name: 'Pplware',          color: '#3b82f6', category: 'tech', url: 'https://pplware.sapo.pt/feed/' },
];

// ─── HTTP GET ─────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        zlib.gunzip(buf, (err, decoded) => {
          resolve(err ? buf.toString('utf8') : decoded.toString('utf8'));
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── RSS PARSER ───────────────────────────────────────────
function parseRSS(xml, feed) {
  const items = [];
  const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const block = match[1];

    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
             || block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
    };

    const getAttr = (tag, attr) => {
      const m = block.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i'));
      return m ? m[1] : '';
    };

    // imagem: tenta enclosure, media:content, og, ou thumbnail
    let image = getAttr('enclosure', 'url')
      || getAttr('media:content', 'url')
      || getAttr('media:thumbnail', 'url');

    if (!image) {
      const imgM = block.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgM) image = imgM[1];
    }

    const link  = get('link') || getAttr('link', 'href');
    // extract raw description (CDATA or plain)
    const cdataDesc = block.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i);
    const plainDesc = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const cdataSum  = block.match(/<summary[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/summary>/i);
    const plainSum  = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const rawDesc   = (cdataDesc||plainDesc||cdataSum||plainSum||[])[1] || '';

    // decode entities, strip tags — applied to both title and description
    const cleanText = (raw) => raw
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ').replace(/&ccedil;/g, 'ç').replace(/&atilde;/g, 'ã')
      .replace(/&otilde;/g, 'õ').replace(/&eacute;/g, 'é').replace(/&aacute;/g, 'á')
      .replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú')
      .replace(/&agrave;/g, 'à').replace(/&acirc;/g, 'â').replace(/&ecirc;/g, 'ê')
      .replace(/&ocirc;/g, 'ô').replace(/&uuml;/g, 'ü').replace(/&ntilde;/g, 'ñ')
      .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n)); } catch { return ''; } })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCharCode(parseInt(h,16)); } catch { return ''; } })
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[ [A-Z ]+ \]/g, ' ')  // strip Steam BBCode markers like \[ MAPS \]
      .replace(/\\[.*?\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const desc  = cleanText(rawDesc).slice(0, 350);
    const title = cleanText(get('title'));
    const pub   = get('pubDate') || get('published') || get('dc:date');
    const cat   = get('category');

    if (!title || !link) continue;

    items.push({
      title,
      link,
      description: desc.slice(0, 300),
      image,
      pubDate: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      category: cat,
      source: feed.name,
      sourceId: feed.id,
      sourceColor: feed.color,
    });
  }

  return items;
}

// ─── MATCH CACHE ──────────────────────────────────────────
let matchCache = {};

// ─── CACHE ────────────────────────────────────────────────
const cache = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

async function getFeed(feed) {
  const now = Date.now();
  if (cache[feed.id] && now - cache[feed.id].ts < CACHE_TTL) {
    return cache[feed.id].items;
  }
  try {
    const xml = await fetchUrl(feed.url);
    const items = parseRSS(xml, feed);
    cache[feed.id] = { ts: now, items };
    console.log(`[${feed.name}] ${items.length} artigos`);
    return items;
  } catch(e) {
    console.log(`[${feed.name}] Erro: ${e.message}`);
    return cache[feed.id]?.items || [];
  }
}


// ─── ICS PARSER ───────────────────────────────────────────
// Parses f1.vidmar.net full calendar — all sessions per weekend
function parseICS(ics) {
  const sessions = [];
  const events   = ics.split('BEGIN:VEVENT');

  // session type detection from summary emoji/text
  function getSessionType(summary) {
    if (summary.includes('🏁'))                                      return 'race';
    if (summary.includes('⏱️') && summary.includes('Sprint'))       return 'sprint-quali';
    if (summary.includes('🏃') || summary.toLowerCase().includes('sprint race')) return 'sprint-race';
    if (summary.includes('⏱️'))                                     return 'quali';
    if (summary.includes('🔧') || summary.toLowerCase().includes('practice') || summary.includes('FP') || summary.includes('P1') || summary.includes('P2') || summary.includes('P3')) return 'practice';
    return 'other';
  }

  for (const ev of events.slice(1)) {
    const get = (key) => {
      const m = ev.match(new RegExp(key + '[^:]*:([^\r\n]+)'));
      return m ? m[1].trim() : '';
    };

    const summary  = get('SUMMARY');
    const dtstart  = get('DTSTART');
    const dtend    = get('DTEND');
    const location = get('LOCATION');
    const uid      = get('UID');

    if (!summary || !dtstart) continue;

    // parse DTSTART datetime (UTC): 20260308T040000Z
    const dateStr = dtstart.replace(/T.*/, '');
    if (dateStr.length < 8) continue;
    const date = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;

    // parse time from DTSTART (UTC)
    const timeMatch = dtstart.match(/T(\d{2})(\d{2})/);
    const timeUTC   = timeMatch ? `${timeMatch[1]}:${timeMatch[2]} UTC` : '';

    // GP name: everything before the ":" in summary, strip flag emoji
    const colonIdx = summary.indexOf(':');
    const gpName   = colonIdx > -1
      ? summary.slice(0, colonIdx).replace(/^[^a-zA-Z]+/, '').trim()
      : summary.replace(/^[^a-zA-Z]+/, '').trim();

    // session label: everything after ": "
    const sessionLabel = colonIdx > -1
      ? summary.slice(colonIdx + 1).trim().replace(/[🏁⏱️🔧🏃]/gu, '').trim()
      : summary;

    const type = getSessionType(summary);

    sessions.push({ date, timeUTC, gpName, sessionLabel, location, type, uid });
  }

  sessions.sort((a,b) => a.date.localeCompare(b.date) || a.timeUTC.localeCompare(b.timeUTC));

  // group by GP name
  const weekends = [];
  const gpMap    = {};
  for (const s of sessions) {
    if (!gpMap[s.gpName]) {
      gpMap[s.gpName] = { gpName: s.gpName, location: s.location, sessions: [], date: s.date };
      weekends.push(gpMap[s.gpName]);
    }
    gpMap[s.gpName].sessions.push({ date: s.date, timeUTC: s.timeUTC, label: s.sessionLabel, type: s.type });
  }

  return weekends;
}


// ─── CS2 MATCH PARSER (bo3.gg) ───────────────────────────
function parseBO3Matches(json) {
  const live = [], upcoming = [];
  const matches = Array.isArray(json) ? json : (json.data || json.matches || []);

  for (const m of matches) {
    const team1 = m.team1?.name || m.teams?.[0]?.name || 'TBD';
    const team2 = m.team2?.name || m.teams?.[1]?.name || 'TBD';
    const logo1 = m.team1?.logo || m.teams?.[0]?.logo || null;
    const logo2 = m.team2?.logo || m.teams?.[1]?.logo || null;
    const isLive = m.status === 'live' || m.live === true || m.state === 'live';
    const score1 = m.score1 ?? m.team1Score ?? m.scores?.[0] ?? null;
    const score2 = m.score2 ?? m.team2Score ?? m.scores?.[1] ?? null;
    const format = m.format || m.bestOf ? `BO${m.bestOf || m.format}` : '';
    const event  = m.event?.name || m.tournament?.name || m.league || '';
    const time   = m.startTime || m.scheduledAt || m.begin_at || null;

    const obj = { id: m.id || Math.random(), isLive, team1, team2, logo1, logo2,
                  score1: isLive ? score1 : null, score2: isLive ? score2 : null,
                  format, event, time };
    if (isLive) live.push(obj);
    else upcoming.push(obj);
  }
  return { live: live.slice(0,6), upcoming: upcoming.slice(0,10) };
}

// ─── SERVIDOR ─────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // PWA files
  const pwaFiles = {
    '/manifest.json': ['application/json', 'manifest.json'],
    '/sw.js':         ['application/javascript', 'sw.js'],
    '/icon-192.png':  ['image/png', 'icon-192.png'],
    '/icon-512.png':  ['image/png', 'icon-512.png'],
  };
  if (pwaFiles[url.pathname]) {
    const [mime, fname] = pwaFiles[url.pathname];
    const fpath = path.join(__dirname, fname);
    if (fs.existsSync(fpath)) {
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.writeHead(200);
      return res.end(fs.readFileSync(fpath));
    }
  }

  // Serve o ads.txt
  if (url.pathname === '/ads.txt') {
    const adsPath = path.join(__dirname, 'ads.txt');
    if (fs.existsSync(adsPath)) {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.writeHead(200);
      return res.end(fs.readFileSync(adsPath));
    }
  }

  // Serve o favicon
  if (url.pathname === '/favicon.svg') {
    const favPath = path.join(__dirname, 'favicon.svg');
    if (fs.existsSync(favPath)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.writeHead(200);
      return res.end(fs.readFileSync(favPath));
    }
  }

  // Serve o HTML
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'noticias.html');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    return res.end(fs.readFileSync(htmlPath));
  }

  // API: lista de fontes
  if (url.pathname === '/api/sources') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    return res.end(JSON.stringify(FEEDS.map(f => ({ id: f.id, name: f.name, color: f.color, category: f.category }))));
  }

  // API: artigos (todos ou por fonte)
  if (url.pathname === '/api/news') {
    res.setHeader('Content-Type', 'application/json');
    const sourceFilter   = url.searchParams.get('source');   // ?source=publico
    const categoryFilter = url.searchParams.get('category'); // ?category=jogos
    const page   = parseInt(url.searchParams.get('page')  || '1');
    const limit  = parseInt(url.searchParams.get('limit') || '30');
    const search = (url.searchParams.get('q') || '').toLowerCase();

    const feedsToFetch = sourceFilter
      ? FEEDS.filter(f => f.id === sourceFilter)
      : categoryFilter
        ? FEEDS.filter(f => f.category === categoryFilter)
        : FEEDS;

    const allItems = (await Promise.all(feedsToFetch.map(getFeed))).flat();

    // ordena por data
    allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // filtro de pesquisa
    const filtered = search
      ? allItems.filter(i => i.title.toLowerCase().includes(search) || i.description.toLowerCase().includes(search))
      : allItems;

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    res.writeHead(200);
    return res.end(JSON.stringify({ items, total, page, pages: Math.ceil(total / limit) }));
  }

  // API: F1 calendar from RaceFans iCal
  if (url.pathname === '/api/f1calendar') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const ical = await fetchUrl('https://f1.vidmar.net/calendar.ics');
      const races = parseICS(ical);
      console.log('[F1 Calendar] ' + races.length + ' corridas carregadas');
      res.writeHead(200);
      return res.end(JSON.stringify(races));
    } catch(e) {
      console.log('[F1 Calendar] Erro: ' + e.message);
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // ── CS2 Match Ticker (scrape HLTV) ──────────────────────
  if (url.pathname === '/api/cs2matches') {
    res.setHeader('Content-Type', 'application/json');
    const now = Date.now();

    // cache 90 seconds
    if (matchCache.data && now - matchCache.ts < 90 * 1000) {
      res.writeHead(200);
      return res.end(JSON.stringify(matchCache.data));
    }

    try {
      // Try multiple sources in order
      let data = { live: [], upcoming: [] };

      // Source 1: bo3.gg public API
      try {
        const [liveRaw, upcomingRaw] = await Promise.all([
          fetchUrl('https://bo3.gg/api/matches?status=live&game=cs2&per_page=10'),
          fetchUrl('https://bo3.gg/api/matches?status=upcoming&game=cs2&per_page=10'),
        ]);
        const live     = parseBO3Matches(JSON.parse(liveRaw));
        const upcoming = parseBO3Matches(JSON.parse(upcomingRaw));
        data = { live: live.live, upcoming: upcoming.upcoming };
        console.log(`[CS2 bo3.gg] live:${data.live.length} upcoming:${data.upcoming.length}`);
      } catch(e1) {
        console.log('[CS2 bo3.gg] falhou:', e1.message);

        // Source 2: liquipedia CS2 matches via API
        try {
          const raw = await fetchUrl('https://liquipedia.net/counterstrike/api.php?action=parse&page=Liquipedia:Upcoming_and_ongoing_matches&prop=wikitext&format=json');
          const json = JSON.parse(raw);
          const wikitext = json?.parse?.wikitext?.['*'] || '';
          // parse basic team names from wikitext
          const matches = [];
          const matchRe = /\|team1=([^\|]+)\|team2=([^\|]+)\|([^\}]*)/g;
          let mm;
          while ((mm = matchRe.exec(wikitext)) !== null && matches.length < 8) {
            matches.push({
              id: matches.length,
              isLive: false,
              team1: mm[1].trim() || 'TBD',
              team2: mm[2].trim() || 'TBD',
              logo1: null, logo2: null,
              score1: null, score2: null,
              format: '', event: 'CS2', time: null,
            });
          }
          data = { live: [], upcoming: matches };
          console.log(`[CS2 Liquipedia] upcoming:${matches.length}`);
        } catch(e2) {
          console.log('[CS2 Liquipedia] falhou:', e2.message);
        }
      }

      matchCache = { data, ts: now };
      res.writeHead(200);
      return res.end(JSON.stringify(data));
    } catch(e) {
      console.log('[CS2 Matches] Erro geral:', e.message);
      res.writeHead(200);
      return res.end(JSON.stringify({ live: [], upcoming: [], error: e.message }));
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n✅ Agregador de Notícias a correr!`);
  console.log(`   Abre o browser em: http://localhost:${PORT}\n`);
  // pré-carrega todos os feeds
  FEEDS.forEach(getFeed);
});

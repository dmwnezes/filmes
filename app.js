const CFG = window.CONFIG || {}; // config.js fica fora do git; sem ele, o erro aparece na tela
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w342';
const $ = (s) => document.querySelector(s);

// ---------- armazenamento ----------
// DB: id -> filme. Campos: like (true/false/ausente), list ('later' | 'seen' | ausente), src ('lb' se veio do Letterboxd)
let DB = JSON.parse(localStorage.getItem('filmes:db') || '{}');
const saveDB = () => localStorage.setItem('filmes:db', JSON.stringify(DB));
const CACHE = {}; // id -> filme, para os botões achar o objeto
let GENRES = {};
let deck = [];
let lastResults = [];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, n = 180) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);

// ---------- TMDB ----------
async function tm(path, params = {}) {
  const u = new URL(API + path);
  u.searchParams.set('api_key', CFG.TMDB_KEY);
  u.searchParams.set('language', 'pt-BR');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const key = u.toString();
  if (!TM_CACHE.has(key)) {
    TM_CACHE.set(key, fetch(u).then((r) => {
      if (!r.ok) throw new Error('TMDB ' + r.status);
      return r.json();
    }).catch((e) => { TM_CACHE.delete(key); throw e; }));
  }
  return TM_CACHE.get(key);
}
const TM_CACHE = new Map(); // shortcut: cache só da sessão; some ao fechar o app

function norm(m) {
  const genres = m.genres ? m.genres.map((g) => g.name) : (m.genre_ids || []).map((i) => GENRES[i]).filter(Boolean);
  const f = { id: m.id, title: m.title || m.original_title || '', year: (m.release_date || '').slice(0, 4), poster: m.poster_path, genres, overview: m.overview || '', vote: m.vote_average || 0 };
  CACHE[f.id] = f;
  return f;
}

async function loadGenres() {
  const r = await tm('/genre/movie/list');
  GENRES = Object.fromEntries(r.genres.map((g) => [g.id, g.name]));
}

// ---------- estado ----------
const isSeen = (id) => !!DB[id] && (DB[id].list === 'seen' || DB[id].like !== undefined);
const getM = (id) => CACHE[id] || DB[id];

function mark(m, patch) {
  const base = { ...m, ...(DB[m.id] || {}) };
  if (patch.like !== undefined && !base.addedAt) patch.addedAt = Date.now();
  DB[m.id] = { ...base, ...patch };
  saveDB();
}

function unmark(id) {
  if (!DB[id]) return;
  delete DB[id].like; delete DB[id].list; delete DB[id].src; delete DB[id].addedAt;
  saveDB();
}

function status(id) {
  const d = DB[id];
  if (!d) return '';
  if (d.like === true) return 'Gostei';
  if (d.like === false) return 'Não gostei';
  if (d.list === 'later') return 'Para ver';
  if (d.list === 'seen') return 'Já vi';
  return '';
}

// ---------- ações ----------
function act(id, action) {
  const m = getM(id);
  if (!m) return;
  if (action === 'yes') mark(m, { like: true, list: 'seen' });
  if (action === 'no') mark(m, { like: false, list: 'seen' });
  if (action === 'later') mark(m, { list: 'later' });
  if (action === 'seen') mark(m, { list: 'seen' });
  if (action === 'del') unmark(id);
  // histórico mudou fora do swipe: refaz o deck com o perfil novo
  deck = action === 'later' ? deck.filter((d) => d.id !== id) : [];
  refreshAll();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) { act(Number(b.dataset.id), b.dataset.act); return; }
  const p = e.target.closest('[data-open]');
  if (p) openMovie(Number(p.dataset.open));
});

function refreshAll() {
  renderDeck();
  renderResults();
  renderLists();
  if (deck.length < 4) fillDeck();
}

// ---------- cartões ----------
function card(m, cls = '') {
  const st = status(m.id);
  return `<article class="card ${cls}" data-card="${m.id}">
    <img class="poster" data-open="${m.id}" src="${m.poster ? IMG + m.poster : ''}" alt="" loading="${cls === 'top' ? 'eager' : 'lazy'}">
    <div class="info">
      <h3>${esc(m.title)} <small>${esc(m.year)}</small></h3>
      <p class="genres">${esc(m.genres.join(' · '))}</p>
      ${m.why && cls === 'top' ? `<p class="why">${esc(m.why)}</p>` : ''}
      <p class="syn">${esc(short(m.overview || 'Sem sinopse.'))}</p>
      ${st ? `<span class="status">${st}</span>` : ''}
    </div>
  </article>`;
}

function miniActions(id) {
  return `<div class="mini">
    <button data-act="yes" data-id="${id}">👍</button>
    <button data-act="no" data-id="${id}">👎</button>
    <button data-act="later" data-id="${id}">⏱ Depois</button>
    <button data-act="seen" data-id="${id}">✓ Já vi</button>
    <button data-act="del" data-id="${id}">✕</button>
  </div>`;
}

function gridItem(m) {
  return `<div>${card(m)}${miniActions(m.id)}</div>`;
}

// ---------- descobrir (swipe) ----------
// Perfil do histórico: curtidas puxam, "não gostei" afasta, vistos sem nota (ex.: Letterboxd) pesam pouco.
const known = (id) => !!DB[id] && (!!DB[id].list || DB[id].like !== undefined);
const byRecent = (a, b) => (b.addedAt || 0) - (a.addedAt || 0);

function profile() {
  const all = Object.values(DB);
  const liked = all.filter((x) => x.like === true).sort(byRecent);
  const disliked = all.filter((x) => x.like === false).sort(byRecent);
  const watched = all.filter((x) => x.list === 'seen' && x.like === undefined);
  const genres = {};
  const add = (list, w) => list.forEach((m) => (m.genres || []).forEach((g) => (genres[g] = (genres[g] || 0) + w)));
  add(liked, 1);
  add(watched, 0.3);
  add(disliked, -1);
  return { liked, disliked, watched, genres };
}

const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

// Sementes: as 5 curtidas mais recentes + 3 antigas sorteadas (variedade). Poucas curtidas? Completa com vistos.
function seeds(p) {
  const s = [...p.liked.slice(0, 5), ...shuffle(p.liked.slice(5)).slice(0, 3)].map((m) => ({ m, w: 1 }));
  if (s.length < 3) s.push(...shuffle(p.watched).slice(0, 5 - s.length).map((m) => ({ m, w: 0.5 })));
  return s;
}

// sources: [{ seed, w, kind: 'rec'|'sim'|'neg', results }]. Devolve candidatos ordenados com o motivo.
function rank(p, sources) {
  const max = Math.max(1, ...Object.values(p.genres).map(Math.abs));
  const c = new Map();
  for (const src of sources) {
    const k = src.kind === 'rec' ? 1 : src.kind === 'sim' ? 0.7 : -1;
    for (const x of src.results || []) {
      if (!x.poster_path || known(x.id)) continue;
      // "similar" do TMDB é ruidoso: só vale se dividir ao menos um gênero com o filme de origem
      if (src.kind === 'sim' && !(x.genre_ids || []).some((i) => (src.seed.genres || []).includes(GENRES[i]))) continue;
      const e = c.get(x.id) || { x, s: 0, best: 0, why: '' };
      e.s += k * src.w;
      if (k * src.w > e.best) { e.best = k * src.w; e.why = src.seed.title; }
      c.set(x.id, e);
    }
  }
  return [...c.values()].map((e) => {
    const gs = (e.x.genre_ids || []).map((i) => (p.genres[GENRES[i]] || 0) / max);
    const affinity = gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : 0;
    const quality = (e.x.vote_count || 0) > 50 ? ((e.x.vote_average || 6) - 6) / 4 : -0.2;
    return { ...e, score: e.s + 0.8 * affinity + 0.3 * quality };
  }).filter((e) => e.s > 0).sort((a, b) => b.score - a.score);
}

const topGenres = (p) => Object.entries(p.genres).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
let discoverPage = 1;
let filling = null;

function fillDeck() {
  filling = filling || buildDeck().finally(() => (filling = null)); // evita duas buscas ao mesmo tempo
  return filling;
}

async function buildDeck() {
  const p = profile();
  const add = (x, why) => {
    if (deck.length >= 10 || known(x.id) || deck.some((d) => d.id === x.id) || !x.poster_path) return;
    deck.push({ ...norm(x), why });
  };

  const sd = seeds(p);
  if (sd.length) {
    const jobs = [
      ...sd.flatMap(({ m, w }) => [
        tm(`/movie/${m.id}/recommendations`).then((r) => ({ seed: m, w, kind: 'rec', results: r.results })),
        tm(`/movie/${m.id}/similar`).then((r) => ({ seed: m, w, kind: 'sim', results: r.results })),
      ]),
      ...p.disliked.slice(0, 3).map((m) => tm(`/movie/${m.id}/recommendations`).then((r) => ({ seed: m, w: 0.5, kind: 'neg', results: r.results }))),
    ];
    const sources = (await Promise.allSettled(jobs)).filter((r) => r.status === 'fulfilled').map((r) => r.value);
    for (const e of rank(p, sources)) add(e.x, `Porque você gostou de ${e.why}`);
  }

  // Acabaram as sugestões das sementes: busca pelos gêneros que você mais curte.
  const tg = topGenres(p);
  if (deck.length < 10 && tg.length) {
    const ids = Object.entries(GENRES).filter(([, n]) => tg.includes(n)).map(([i]) => i);
    const r = await tm('/discover/movie', { with_genres: ids.join('|'), sort_by: 'vote_average.desc', 'vote_count.gte': 500, page: discoverPage++ });
    const bad = new Set(Object.entries(p.genres).filter(([, v]) => v < 0).map(([g]) => g));
    for (const x of r.results || []) if (!(x.genre_ids || []).some((i) => bad.has(GENRES[i]))) add(x, `Porque você curte ${tg.join(' e ')}`);
  }

  // Sem histórico nenhum: populares.
  if (!deck.length && !p.liked.length) {
    const r = await tm('/movie/popular', { page: Math.floor(Math.random() * 5) + 1 });
    for (const x of r.results || []) add(x, 'Em alta agora');
  }
  renderDeck();
}

function renderDeck() {
  const el = $('#deck');
  const p = profile();
  $('#perfil').textContent = p.liked.length + p.watched.length
    ? `Baseado no seu histórico: ${p.liked.length} curtidos, ${p.disliked.length} não curtidos, ${p.watched.length} vistos sem nota.`
    : 'Sem histórico ainda: curta alguns filmes ou importe do Letterboxd para personalizar.';
  if (!deck.length) {
    el.innerHTML = `<p class="muted center">${filling ? 'Carregando sugestões…' : 'Sem novas sugestões agora. Curta mais filmes na Busca.'}</p>`;
    return;
  }
  el.innerHTML = card(deck[0], 'top');
  attachDrag(el.querySelector('.card'));
}

function attachDrag(c) {
  let x0 = null;
  let dx = 0;
  c.addEventListener('pointerdown', (e) => { x0 = e.clientX; dx = 0; c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    c.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
  });
  const end = () => {
    if (x0 === null) return;
    const d = dx;
    x0 = null;
    if (d > 90) decide('yes');
    else if (d < -90) decide('no');
    else c.style.transform = '';
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}

function decide(kind) {
  const m = deck.shift();
  if (!m) return;
  const map = { yes: { like: true, list: 'seen' }, no: { like: false, list: 'seen' }, later: { list: 'later' } };
  mark(m, map[kind]);
  renderDeck();
  if (deck.length < 4) fillDeck();
}

$('#bYes').onclick = () => decide('yes');
$('#bNo').onclick = () => decide('no');
$('#bLater').onclick = () => decide('later');
document.addEventListener('keydown', (e) => {
  if (!$('#descobrir').classList.contains('on') || $('#modal').open) return;
  if (e.key === 'ArrowRight') decide('yes');
  if (e.key === 'ArrowLeft') decide('no');
  if (e.key === 'ArrowDown') decide('later');
});

// ---------- buscar ----------
$('#sForm').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  $('#results').innerHTML = '<p class="muted">Buscando…</p>';
  const r = await tm('/search/movie', { query: q, include_adult: 'false' });
  lastResults = r.results.filter((x) => x.poster_path).slice(0, 20).map(norm);
  renderResults();
};

function renderResults() {
  if (!$('#results').innerHTML && !lastResults.length) return;
  $('#results').innerHTML = lastResults.map(gridItem).join('') || '<p class="muted">Nada encontrado.</p>';
}

// ---------- modal: detalhes + semelhantes ----------
async function openMovie(id) {
  const body = $('#mBody');
  body.innerHTML = '<p class="muted">Carregando…</p>';
  $('#modal').showModal();
  const [det, sim] = await Promise.all([tm(`/movie/${id}`), tm(`/movie/${id}/similar`)]);
  const m = norm(det);
  const similar = (sim.results || []).filter((x) => x.poster_path).slice(0, 12).map(norm);
  body.innerHTML = `
    ${m.poster ? `<img src="${IMG + m.poster}" alt="">` : ''}
    <div class="txt">
      <h2 style="margin-top:0">${esc(m.title)} <small>${esc(m.year)}</small></h2>
      <p class="genres">${esc(m.genres.join(' · '))}</p>
      <p>${esc(m.overview || 'Sem sinopse.')}</p>
      ${status(m.id) ? `<p><span class="status">${status(m.id)}</span></p>` : ''}
      ${miniActions(m.id)}
    </div>
    <div class="similar">
      <h2>Filmes semelhantes</h2>
      <div class="grid">${similar.map(gridItem).join('') || '<p class="muted">Sem sugestões.</p>'}</div>
    </div>`;
}
$('#mClose').onclick = () => $('#modal').close();

// ---------- listas ----------
function renderLists() {
  const all = Object.values(DB);
  const later = all.filter((x) => x.list === 'later' && x.like === undefined);
  const seen = all.filter((x) => isSeen(x.id));
  $('#cLater').textContent = `(${later.length})`;
  $('#cSeen').textContent = `(${seen.length})`;
  $('#lLater').innerHTML = later.map(gridItem).join('') || '<p class="muted">Nada salvo ainda.</p>';
  $('#lSeen').innerHTML = seen.map(gridItem).join('') || '<p class="muted">Nada marcado ainda.</p>';
}

// ---------- importar Letterboxd ----------
function parseCSV(t) {
  const out = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); out.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  const head = (out.shift() || []).map((h) => h.trim());
  return out.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
}

async function resolveLb(name, year, cache) {
  const key = name + '|' + year;
  if (key in cache) return cache[key];
  const r = await tm('/search/movie', { query: name, year: year || '' });
  const hit = r.results?.find((x) => x.poster_path) || r.results?.[0];
  cache[key] = hit ? norm(hit) : null;
  return cache[key];
}

$('#lbGo').onclick = async () => {
  const files = [...$('#lbFiles').files];
  const st = $('#lbStatus');
  st.textContent = 'Lendo arquivos…';
  const kinds = {};
  for (const f of files) {
    const n = f.name.toLowerCase();
    const k = n.includes('rating') ? 'ratings' : n.includes('watchlist') ? 'watchlist' : n.includes('watched') ? 'watched' : null;
    if (k) kinds[k] = parseCSV(await f.text());
  }
  if (!Object.keys(kinds).length) { st.textContent = 'Nenhum watched.csv, ratings.csv ou watchlist.csv encontrado.'; return; }

  // limpa o que veio do Letterboxd antes; reimportar atualiza
  for (const id in DB) if (DB[id].src === 'lb') delete DB[id];
  saveDB();

  const cache = JSON.parse(localStorage.getItem('filmes:lbcache') || '{}');
  const jobs = [];
  for (const [k, rows] of Object.entries(kinds)) for (const row of rows) jobs.push({ k, row });

  let done = 0;
  for (let i = 0; i < jobs.length; i += 5) {
    const batch = jobs.slice(i, i + 5);
    await Promise.all(batch.map(async ({ k, row }) => {
      try {
        const m = await resolveLb(row.Name, row.Year, cache);
        if (!m) return;
        const cur = DB[m.id];
        const own = cur && cur.src !== 'lb'; // marcação manual tem prioridade
        if (k === 'watched' && !own) mark(m, { list: 'seen', src: 'lb' });
        if (k === 'ratings') {
          const r = parseFloat(row.Rating);
          const like = r >= 3.5 ? true : r <= 2 ? false : undefined;
          if (!own) mark(m, { list: 'seen', src: 'lb', ...(like !== undefined ? { like } : {}) });
        }
        if (k === 'watchlist' && !own && !(DB[m.id]?.list)) mark(m, { list: 'later', src: 'lb' });
      } catch (err) { /* pula filme que a busca falhou */ }
      done++;
    }));
    st.textContent = `Importando… ${Math.min(done, jobs.length)} de ${jobs.length}`;
    localStorage.setItem('filmes:lbcache', JSON.stringify(cache));
  }
  for (const id in DB) if (DB[id].src === 'lb' && DB[id].like === undefined && !DB[id].list) delete DB[id];
  saveDB();
  st.textContent = `Pronto: ${jobs.length} linhas processadas.`;
  deck = []; // perfil novo vindo do Letterboxd
  refreshAll();
};

// ---------- abas ----------
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button, .tab').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  $('#' + b.dataset.tab).classList.add('on');
  if (b.dataset.tab === 'listas') renderLists();
});

// ---------- início ----------
(async () => {
  try { await loadGenres(); } catch (e) { console.warn('gêneros', e); }
  renderLists();
  await fillDeck().catch((e) => { $('#deck').innerHTML = `<p class="muted center">Erro ao falar com o TMDB: ${esc(e.message)}. Confira a chave em config.js.</p>`; });
})();

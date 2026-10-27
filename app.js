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
  const r = await fetch(u);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

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
  deck = deck.filter((d) => d.id !== id);
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
    <img class="poster" data-open="${m.id}" src="${m.poster ? IMG + m.poster : ''}" alt="" loading="lazy">
    <div class="info">
      <h3>${esc(m.title)} <small>${esc(m.year)}</small></h3>
      <p class="genres">${esc(m.genres.join(' · '))}</p>
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
async function fillDeck() {
  const liked = Object.values(DB).filter((x) => x.like === true).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 5);
  let pool = [];
  if (liked.length) {
    const counts = new Map();
    const res = await Promise.allSettled(liked.flatMap((m) => [tm(`/movie/${m.id}/recommendations`), tm(`/movie/${m.id}/similar`)]));
    for (const r of res) {
      if (r.status !== 'fulfilled') continue;
      for (const x of r.value.results || []) {
        if (!x.poster_path) continue;
        const c = counts.get(x.id) || { n: 0, x };
        c.n++;
        counts.set(x.id, c);
      }
    }
    pool = [...counts.values()].sort((a, b) => b.n - a.n || b.x.vote_average - a.x.vote_average).map((c) => c.x);
  }
  if (pool.length < 10) {
    const p = await tm('/movie/popular', { page: Math.floor(Math.random() * 5) + 1 });
    pool.push(...p.results.filter((x) => x.poster_path));
  }
  for (const x of pool) {
    if (deck.length >= 10) break;
    if (isSeen(x.id) || deck.some((d) => d.id === x.id)) continue;
    deck.push(norm(x));
  }
  renderDeck();
}

function renderDeck() {
  const el = $('#deck');
  if (!deck.length) {
    el.innerHTML = '<p class="muted center">Carregando sugestões…</p>';
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

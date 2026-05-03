/* ─────────────────────────────────────────────
   Steam Backlog Store — frontend logic
   ───────────────────────────────────────────── */

const PAGE_SIZE = 24;

const CC_TO_CURRENCY = {
  us:'USD', gb:'GBP', eu:'EUR', au:'AUD', ca:'CAD',
  br:'BRL', ru:'RUB', tr:'TRY', jp:'JPY', kr:'KRW', cn:'CNY',
};

// ── State ──────────────────────────────────────
const state = {
  allGames: [],
  filtered: [],
  prices:   {},   // appid -> price_overview | null | 'loading'
  reviews:  {},   // appid -> {score, desc, pct, total} | null | 'loading'
  page: 1,
  apiKey: '',
  steamId: '',
  currency: 'us',
  totalCents: 0,
  unplayedCents: 0,
  pricedCount: 0,
};

// ── DOM refs ────────────────────────────────────
const setupSection   = document.getElementById('setupSection');
const storeSection   = document.getElementById('storeSection');
const setupForm      = document.getElementById('setupForm');
const setupError     = document.getElementById('setupError');
const loadBtn        = document.getElementById('loadBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMsg     = document.getElementById('loadingMsg');
const gameGrid       = document.getElementById('gameGrid');
const pagination     = document.getElementById('pagination');
const filterSelect   = document.getElementById('filterSelect');
const sortSelect     = document.getElementById('sortSelect');
const backBtn        = document.getElementById('backBtn');

const elTotalValue    = document.getElementById('totalValue');
const elUnplayedValue = document.getElementById('unplayedValue');
const elStatGames     = document.getElementById('statGames');
const elStatUnplayed  = document.getElementById('statUnplayed');
const elStatPriced    = document.getElementById('statPriced');
const elResultsCount  = document.getElementById('resultsCount');

// ── Utility ─────────────────────────────────────
function setLoading(msg) { loadingMsg.textContent = msg; loadingOverlay.style.display = 'flex'; }
function clearLoading()  { loadingOverlay.style.display = 'none'; }
function showError(msg)  { setupError.textContent = msg; setupError.style.display = 'block'; }
function clearError()    { setupError.style.display = 'none'; }
function delay(ms)       { return new Promise(r => setTimeout(r, ms)); }

function currencyCode() { return CC_TO_CURRENCY[state.currency] || 'USD'; }

function formatCents(cents) {
  if (cents == null) return null;
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency', currency: currencyCode(), maximumFractionDigits: 2,
  });
}

function formatPrice(priceObj) {
  if (!priceObj) return null;
  const final   = priceObj.final_formatted   || formatCents(priceObj.final)   || 'Free';
  const initial = priceObj.initial_formatted || formatCents(priceObj.initial);
  const disc    = priceObj.discount_percent  || 0;
  return { final, initial, disc, finalCents: priceObj.final };
}

function hoursLabel(minutes) {
  if (!minutes) return null;
  const h = minutes / 60;
  if (h < 1)  return `${minutes}m`;
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
}

function imageUrl(appid) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

// ── localStorage ──────────────────────────────────
const LS_KEY = 'sbs_profile';
function saveProfile(steamInput, apiKey, currency) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ steamInput, apiKey, currency })); } catch (_) {}
}
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) { return null; }
}

// ── Animated counter ──────────────────────────────
function animateValue(el, fromCents, toCents) {
  const duration = 500;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const current = fromCents + (toCents - fromCents) * ease;
    el.textContent = (current / 100).toLocaleString('en-US', {
      style: 'currency', currency: currencyCode(), minimumFractionDigits: 2,
    });
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  el.classList.remove('value-bump');
  void el.offsetWidth;
  el.classList.add('value-bump');
}

// ── Price render helpers ──────────────────────────
function renderPriceEl(el, priceData, unplayed) {
  el.innerHTML = '';
  if (priceData === 'loading' || priceData === undefined) {
    const s = document.createElement('span');
    s.className = 'price-loading';
    s.textContent = 'Loading';
    el.appendChild(s);
    return;
  }
  if (priceData === null) {
    const s = document.createElement('span');
    s.className = unplayed ? 'price-free' : 'price-na';
    s.textContent = unplayed ? 'Free / N/A' : 'N/A';
    el.appendChild(s);
    return;
  }
  const fmt = formatPrice(priceData);
  if (!fmt) return;
  if (fmt.disc > 0) {
    const orig = document.createElement('span');
    orig.className = 'price-original';
    orig.textContent = fmt.initial;
    el.appendChild(orig);
  }
  const final = document.createElement('span');
  final.className = 'price-final' + (fmt.disc > 0 ? ' is-sale' : '');
  final.textContent = fmt.finalCents === 0 ? 'Free' : fmt.final;
  el.appendChild(final);
}

function updateCardPrice(appid, priceObj) {
  const priceEl = gameGrid.querySelector(`.card-price[data-appid="${appid}"]`);
  if (!priceEl) return;
  const game = state.allGames.find(g => String(g.appid) === appid);
  renderPriceEl(priceEl, priceObj, game ? !game.playtime_forever : false);
  if (priceObj && priceObj.discount_percent > 0) {
    const card = priceEl.closest('.game-card');
    if (card && !card.querySelector('.badge-top-right')) {
      const wrap = document.createElement('span'); wrap.className = 'badge-top-right';
      const badge = document.createElement('span'); badge.className = 'badge-discount';
      badge.textContent = `-${priceObj.discount_percent}%`;
      wrap.appendChild(badge);
      card.querySelector('.card-image-wrap').appendChild(wrap);
    }
  }
}

// ── Core price fetcher (shared by page-load and background) ──
async function fetchAndApplyPrices(appids) {
  if (!appids.length) return;
  appids.forEach(id => { state.prices[id] = 'loading'; });
  try {
    const params = new URLSearchParams({ appids: appids.join(','), cc: state.currency });
    const resp = await fetch(`/api/prices?${params}`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();

    let totalDelta = 0, unplayedDelta = 0;
    Object.entries(data).forEach(([appid, priceObj]) => {
      state.prices[appid] = priceObj;
      if (priceObj && priceObj.final != null) {
        state.pricedCount++;
        totalDelta += priceObj.final;
        const game = state.allGames.find(g => String(g.appid) === appid);
        if (game && !game.playtime_forever) unplayedDelta += priceObj.final;
      }
      updateCardPrice(appid, priceObj);
    });

    if (totalDelta > 0) {
      const prev = state.totalCents;
      state.totalCents += totalDelta;
      animateValue(elTotalValue, prev, state.totalCents);
    }
    if (unplayedDelta > 0) {
      const prev = state.unplayedCents;
      state.unplayedCents += unplayedDelta;
      animateValue(elUnplayedValue, prev, state.unplayedCents);
    }
    elStatPriced.textContent = `${state.pricedCount} / ${state.allGames.length}`;

  } catch (err) {
    // Reset to undefined so background loader can retry
    appids.forEach(id => { if (state.prices[id] === 'loading') delete state.prices[id]; });
    throw err;
  }
}

// High-priority: current visible page
async function loadPricesForPage(games) {
  const toFetch = games.map(g => String(g.appid)).filter(id => state.prices[id] === undefined);
  if (!toFetch.length) return;
  try { await fetchAndApplyPrices(toFetch); }
  catch (e) { console.error('Page price fetch error:', e); }
}

// Background: all remaining games, progressively
async function backgroundLoadAll() {
  const BATCH = 24;
  const allIds = state.allGames.map(g => String(g.appid));
  for (let i = 0; i < allIds.length; i += BATCH) {
    if (storeSection.style.display === 'none') break;
    const batch = allIds.slice(i, i + BATCH).filter(id => state.prices[id] === undefined);
    if (batch.length) {
      try { await fetchAndApplyPrices(batch); } catch (_) {}
      await delay(250);
    }
  }
}

// ── Review render helpers ─────────────────────────
function reviewClass(score) {
  if (score >= 8) return 'review-positive';
  if (score >= 5) return 'review-mixed';
  return 'review-negative';
}

function renderReviewEl(el, reviewData) {
  el.innerHTML = '';
  if (!reviewData || reviewData === 'loading') return;
  if (reviewData.total < 10) {
    const s = document.createElement('span');
    s.className = 'review-none';
    s.textContent = 'No reviews';
    el.appendChild(s);
    return;
  }
  const s = document.createElement('span');
  s.className = `review-label ${reviewClass(reviewData.score)}`;
  s.textContent = `${reviewData.pct}% · ${reviewData.desc}`;
  s.title = `${reviewData.positive.toLocaleString()} positive out of ${reviewData.total.toLocaleString()} reviews`;
  el.appendChild(s);
}

function updateCardReview(appid, reviewData) {
  const el = gameGrid.querySelector(`.card-review[data-appid="${appid}"]`);
  if (el) renderReviewEl(el, reviewData);
}

// Background: load reviews for all games in batches
async function backgroundLoadReviews() {
  const BATCH = 12;
  const allIds = state.allGames.map(g => String(g.appid));
  for (let i = 0; i < allIds.length; i += BATCH) {
    if (storeSection.style.display === 'none') break;
    const batch = allIds.slice(i, i + BATCH).filter(id => state.reviews[id] === undefined);
    if (!batch.length) continue;
    batch.forEach(id => { state.reviews[id] = 'loading'; });
    try {
      const params = new URLSearchParams({ appids: batch.join(',') });
      const resp = await fetch(`/api/reviews?${params}`);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      Object.entries(data).forEach(([appid, reviewData]) => {
        state.reviews[appid] = reviewData;
        updateCardReview(appid, reviewData);
      });
    } catch (_) {
      batch.forEach(id => { if (state.reviews[id] === 'loading') delete state.reviews[id]; });
    }
    await delay(350);
  }
}

// ── Card building ─────────────────────────────────
function buildCard(game) {
  const appid    = String(game.appid);
  const hours    = hoursLabel(game.playtime_forever);
  const unplayed = !game.playtime_forever;

  const card = document.createElement('div');
  card.className = 'game-card';
  card.dataset.appid = appid;

  // Image
  const imgWrap = document.createElement('div');
  imgWrap.className = 'card-image-wrap';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = game.name || appid;
  img.src = imageUrl(appid);
  img.onerror = () => {
    img.style.display = 'none';
    const ph = document.createElement('div');
    ph.className = 'card-image-placeholder';
    ph.textContent = game.name || appid;
    imgWrap.appendChild(ph);
  };
  imgWrap.appendChild(img);

  const badge = document.createElement('span');
  badge.className = 'card-badge ' + (unplayed ? 'badge-unplayed' : 'badge-hours');
  badge.textContent = unplayed ? 'Unplayed' : hours + ' played';
  imgWrap.appendChild(badge);

  const priceData = state.prices[appid];
  if (priceData && priceData !== 'loading' && priceData?.discount_percent > 0) {
    const discWrap = document.createElement('span'); discWrap.className = 'badge-top-right';
    const discBadge = document.createElement('span'); discBadge.className = 'badge-discount';
    discBadge.textContent = `-${priceData.discount_percent}%`;
    discWrap.appendChild(discBadge);
    imgWrap.appendChild(discWrap);
  }
  card.appendChild(imgWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = game.name || `App ${appid}`;
  body.appendChild(title);

  // Review row
  const reviewEl = document.createElement('div');
  reviewEl.className = 'card-review';
  reviewEl.dataset.appid = appid;
  renderReviewEl(reviewEl, state.reviews[appid]);
  body.appendChild(reviewEl);

  // Price row
  const priceEl = document.createElement('div');
  priceEl.className = 'card-price';
  priceEl.dataset.appid = appid;
  renderPriceEl(priceEl, priceData, unplayed);
  body.appendChild(priceEl);

  card.appendChild(body);
  card.addEventListener('click', () => window.open(`https://store.steampowered.com/app/${appid}`, '_blank'));
  return card;
}

// ── Grid + pagination ─────────────────────────────
function renderGrid() {
  gameGrid.innerHTML = '';
  const start = (state.page - 1) * PAGE_SIZE;
  const page  = state.filtered.slice(start, start + PAGE_SIZE);
  page.forEach(game => gameGrid.appendChild(buildCard(game)));
  loadPricesForPage(page);
}

function renderPagination() {
  pagination.innerHTML = '';
  const totalPages = Math.ceil(state.filtered.length / PAGE_SIZE);
  if (totalPages <= 1) return;

  const makeBtn = (label, p, active = false, disabled = false) => {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (active ? ' active' : '');
    btn.textContent = label;
    btn.disabled = disabled || active;
    if (!disabled && !active) {
      btn.addEventListener('click', () => {
        state.page = p;
        renderGrid();
        renderPagination();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    return btn;
  };

  const ellipsis = () => { const s = document.createElement('span'); s.className = 'page-ellipsis'; s.textContent = '…'; return s; };

  pagination.appendChild(makeBtn('←', state.page - 1, false, state.page === 1));
  if (totalPages <= 9) {
    for (let i = 1; i <= totalPages; i++) pagination.appendChild(makeBtn(i, i, i === state.page));
  } else {
    pagination.appendChild(makeBtn(1, 1, 1 === state.page));
    if (state.page > 4) pagination.appendChild(ellipsis());
    const s = Math.max(2, state.page - 2), e = Math.min(totalPages - 1, state.page + 2);
    for (let i = s; i <= e; i++) pagination.appendChild(makeBtn(i, i, i === state.page));
    if (state.page < totalPages - 3) pagination.appendChild(ellipsis());
    pagination.appendChild(makeBtn(totalPages, totalPages, totalPages === state.page));
  }
  pagination.appendChild(makeBtn('→', state.page + 1, false, state.page === totalPages));
}

function updateResultsCount() {
  const total = state.filtered.length;
  const start = (state.page - 1) * PAGE_SIZE + 1;
  const end   = Math.min(state.page * PAGE_SIZE, total);
  elResultsCount.textContent = total
    ? `Showing ${start}–${end} of ${total} games`
    : 'No games match this filter';
}

function applyFilterSort() {
  const filter = filterSelect.value;
  const sort   = sortSelect.value;
  let list = [...state.allGames];

  if (filter === 'unplayed') list = list.filter(g => !g.playtime_forever);
  if (filter === 'played')   list = list.filter(g =>  g.playtime_forever > 0);

  // null / loading / not-yet-fetched prices sort as 0 (free/unavailable)
  const priceOf = g => {
    const p = state.prices[String(g.appid)];
    return (p && p !== 'loading' && p !== null && p.final != null) ? p.final : 0;
  };

  const reviewOf = g => {
    const r = state.reviews[String(g.appid)];
    return (r && r !== 'loading' && r !== null) ? r.pct : -1;
  };
  const reviewCountOf = g => {
    const r = state.reviews[String(g.appid)];
    return (r && r !== 'loading' && r !== null) ? (r.total || 0) : -1;
  };
  // positive-review count = total × (pct/100); rewards popular AND well-rated games
  const popularityOf = g => {
    const r = state.reviews[String(g.appid)];
    return (r && r !== 'loading' && r !== null && r.total) ? r.total * r.pct / 100 : -1;
  };

  switch (sort) {
    case 'unplayed_first':
      list.sort((a, b) => {
        const ap = a.playtime_forever > 0 ? 1 : 0, bp = b.playtime_forever > 0 ? 1 : 0;
        return ap !== bp ? ap - bp : priceOf(b) - priceOf(a);
      }); break;
    case 'price_desc':    list.sort((a, b) => priceOf(b)      - priceOf(a));      break;
    case 'price_asc':     list.sort((a, b) => priceOf(a)      - priceOf(b));      break;
    case 'review_desc':   list.sort((a, b) => reviewOf(b)     - reviewOf(a));     break;
    case 'most_reviews':  list.sort((a, b) => reviewCountOf(b)- reviewCountOf(a)); break;
    case 'popular':       list.sort((a, b) => popularityOf(b) - popularityOf(a)); break;
    case 'playtime_desc': list.sort((a, b) => (b.playtime_forever||0) - (a.playtime_forever||0)); break;
    case 'playtime_asc':  list.sort((a, b) => (a.playtime_forever||0) - (b.playtime_forever||0)); break;
    case 'name_asc':  list.sort((a, b) => (a.name||'').localeCompare(b.name||'')); break;
    case 'name_desc': list.sort((a, b) => (b.name||'').localeCompare(a.name||'')); break;
  }

  state.filtered = list;
  state.page = 1;
  renderGrid();
  renderPagination();
  updateResultsCount();
}

// ── Main load flow ────────────────────────────────
async function loadLibrary(steamId, apiKey, currency) {
  setLoading('Resolving Steam profile…');
  let resolvedId = steamId;
  if (!steamId.match(/^\d{17}$/)) {
    const params = new URLSearchParams({ id: steamId, key: apiKey });
    const res  = await fetch(`/api/resolve?${params}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    resolvedId = json.steamid;
  }
  setLoading('Fetching your library…');
  const libRes  = await fetch(`/api/library/${resolvedId}?${new URLSearchParams({ key: apiKey })}`);
  const libJson = await libRes.json();
  if (libJson.error) throw new Error(libJson.error);
  return { games: libJson.games, steamId: resolvedId };
}

async function submitLoad(steamInput, apiKey, currency) {
  clearError();
  loadBtn.disabled = true;
  try {
    const { games, steamId } = await loadLibrary(steamInput, apiKey, currency);
    saveProfile(steamInput, apiKey, currency);

    Object.assign(state, {
      allGames: games, apiKey, steamId, currency,
      prices: {}, reviews: {}, page: 1,
      totalCents: 0, unplayedCents: 0, pricedCount: 0,
    });

    const unplayed = games.filter(g => !g.playtime_forever).length;
    elStatGames.textContent     = games.length.toLocaleString();
    elStatUnplayed.textContent  = unplayed.toLocaleString();
    elTotalValue.textContent    = formatCents(0);
    elUnplayedValue.textContent = formatCents(0);
    elStatPriced.textContent    = `0 / ${games.length}`;

    setupSection.style.display = 'none';
    storeSection.style.display = 'block';
    clearLoading();

    applyFilterSort();

    // Kick off background loaders — prices for every game, reviews for every game
    backgroundLoadAll();
    backgroundLoadReviews();

  } catch (err) {
    clearLoading();
    showError(err.message || 'Something went wrong. Please check your details and try again.');
  } finally {
    loadBtn.disabled = false;
  }
}

// ── Events ────────────────────────────────────────
setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const steamInput = document.getElementById('steamInput').value.trim();
  const apiKey     = document.getElementById('apiKeyInput').value.trim();
  const currency   = document.getElementById('currencySelect').value;
  if (!steamInput) return showError('Please enter your Steam ID or username.');
  if (!apiKey)     return showError('Please enter your Steam Web API key.');
  await submitLoad(steamInput, apiKey, currency);
});

filterSelect.addEventListener('change', applyFilterSort);
sortSelect.addEventListener('change', applyFilterSort);

backBtn.addEventListener('click', () => {
  storeSection.style.display = 'none';
  setupSection.style.display = 'flex';
});

// ── Auto-load from localStorage ───────────────────
(function init() {
  const saved = loadProfile();
  if (!saved) return;
  document.getElementById('steamInput').value     = saved.steamInput || '';
  document.getElementById('apiKeyInput').value    = saved.apiKey    || '';
  document.getElementById('currencySelect').value = saved.currency  || 'us';
  if (saved.steamInput && saved.apiKey) {
    submitLoad(saved.steamInput, saved.apiKey, saved.currency || 'us');
  }
})();

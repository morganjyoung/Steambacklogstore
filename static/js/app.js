/* ─────────────────────────────────────────────
   Steam Backlog Store — frontend logic
   ───────────────────────────────────────────── */

const PAGE_SIZE = 24;

// ── State ──────────────────────────────────────
const state = {
  allGames: [],       // raw from API
  filtered: [],       // after filter + sort
  prices: {},         // appid -> price_overview | null | 'loading'
  page: 1,
  apiKey: '',
  steamId: '',
  currency: 'us',
  totalCents: 0,
  unplayedCents: 0,
  pricedCount: 0,
};

// ── DOM refs ────────────────────────────────────
const setupSection  = document.getElementById('setupSection');
const storeSection  = document.getElementById('storeSection');
const setupForm     = document.getElementById('setupForm');
const setupError    = document.getElementById('setupError');
const loadBtn       = document.getElementById('loadBtn');
const loadingOverlay= document.getElementById('loadingOverlay');
const loadingMsg    = document.getElementById('loadingMsg');
const gameGrid      = document.getElementById('gameGrid');
const pagination    = document.getElementById('pagination');
const filterSelect  = document.getElementById('filterSelect');
const sortSelect    = document.getElementById('sortSelect');
const backBtn       = document.getElementById('backBtn');

// Banner stat refs
const elTotalValue   = document.getElementById('totalValue');
const elUnplayedValue= document.getElementById('unplayedValue');
const elStatGames    = document.getElementById('statGames');
const elStatUnplayed = document.getElementById('statUnplayed');
const elStatPriced   = document.getElementById('statPriced');
const elResultsCount = document.getElementById('resultsCount');

// ── Utility ─────────────────────────────────────
function setLoading(msg) {
  loadingMsg.textContent = msg;
  loadingOverlay.style.display = 'flex';
}
function clearLoading() {
  loadingOverlay.style.display = 'none';
}
function showError(msg) {
  setupError.textContent = msg;
  setupError.style.display = 'block';
}
function clearError() {
  setupError.style.display = 'none';
}

function formatCents(cents) {
  if (cents == null) return null;
  const div = cents / 100;
  return div.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function formatPrice(priceObj) {
  if (!priceObj) return null;
  const final = priceObj.final_formatted || formatCents(priceObj.final) || 'Free';
  const initial = priceObj.initial_formatted || formatCents(priceObj.initial);
  const disc = priceObj.discount_percent || 0;
  return { final, initial, disc, finalCents: priceObj.final, initialCents: priceObj.initial };
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

// ── Animated counter ────────────────────────────
function animateValue(el, fromCents, toCents) {
  const duration = 400;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const current = fromCents + (toCents - fromCents) * ease;
    el.textContent = (current / 100).toLocaleString('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2,
    });
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  el.classList.remove('value-bump');
  void el.offsetWidth;
  el.classList.add('value-bump');
}

// ── Build & apply filter/sort ────────────────────
function applyFilterSort() {
  const filter = filterSelect.value;
  const sort   = sortSelect.value;

  let list = [...state.allGames];

  if (filter === 'unplayed') list = list.filter(g => !g.playtime_forever);
  if (filter === 'played')   list = list.filter(g =>  g.playtime_forever > 0);

  const price = (g) => {
    const p = state.prices[String(g.appid)];
    if (p && p !== 'loading') return p.final ?? Infinity;
    return Infinity;
  };

  switch (sort) {
    case 'unplayed_first':
      list.sort((a, b) => {
        const aPlayed = a.playtime_forever > 0 ? 1 : 0;
        const bPlayed = b.playtime_forever > 0 ? 1 : 0;
        if (aPlayed !== bPlayed) return aPlayed - bPlayed;
        return price(b) - price(a);
      });
      break;
    case 'price_desc': list.sort((a, b) => price(b) - price(a)); break;
    case 'price_asc':  list.sort((a, b) => {
      const pa = price(a), pb = price(b);
      if (pa === Infinity && pb === Infinity) return 0;
      if (pa === Infinity) return 1;
      if (pb === Infinity) return -1;
      return pa - pb;
    }); break;
    case 'playtime_desc': list.sort((a, b) => (b.playtime_forever||0) - (a.playtime_forever||0)); break;
    case 'playtime_asc':  list.sort((a, b) => (a.playtime_forever||0) - (b.playtime_forever||0)); break;
    case 'name_asc': list.sort((a, b) => (a.name||'').localeCompare(b.name||'')); break;
    case 'name_desc': list.sort((a, b) => (b.name||'').localeCompare(a.name||'')); break;
  }

  state.filtered = list;
  state.page = 1;
  renderGrid();
  renderPagination();
  updateResultsCount();
}

// ── Render a single card ─────────────────────────
function buildCard(game) {
  const appid   = String(game.appid);
  const hours   = hoursLabel(game.playtime_forever);
  const unplayed = !game.playtime_forever;
  const priceData = state.prices[appid];

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

  // Left badge (played/unplayed)
  const badge = document.createElement('span');
  badge.className = 'card-badge ' + (unplayed ? 'badge-unplayed' : 'badge-hours');
  badge.textContent = unplayed ? 'Unplayed' : hours + ' played';
  imgWrap.appendChild(badge);

  // Right badge (discount)
  if (priceData && priceData !== 'loading' && priceData?.discount_percent > 0) {
    const discWrap = document.createElement('span');
    discWrap.className = 'badge-top-right';
    const discBadge = document.createElement('span');
    discBadge.className = 'badge-discount';
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

  const priceEl = document.createElement('div');
  priceEl.className = 'card-price';
  priceEl.dataset.appid = appid;
  renderPriceEl(priceEl, priceData, unplayed);
  body.appendChild(priceEl);

  card.appendChild(body);

  card.addEventListener('click', () => {
    window.open(`https://store.steampowered.com/app/${appid}`, '_blank');
  });

  return card;
}

function renderPriceEl(el, priceData, unplayed) {
  el.innerHTML = '';

  if (priceData === 'loading' || priceData === undefined) {
    const span = document.createElement('span');
    span.className = 'price-loading';
    span.textContent = 'Loading price';
    el.appendChild(span);
    return;
  }

  if (priceData === null) {
    const span = document.createElement('span');
    if (unplayed) {
      span.className = 'price-free';
      span.textContent = 'Free / N/A';
    } else {
      span.className = 'price-na';
      span.textContent = 'Price unavailable';
    }
    el.appendChild(span);
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

// ── Render current page of grid ──────────────────
function renderGrid() {
  gameGrid.innerHTML = '';
  const start = (state.page - 1) * PAGE_SIZE;
  const page  = state.filtered.slice(start, start + PAGE_SIZE);
  page.forEach(game => gameGrid.appendChild(buildCard(game)));
  loadPricesForPage(page);
}

// ── Load prices for visible page ─────────────────
async function loadPricesForPage(games) {
  const toFetch = games
    .map(g => String(g.appid))
    .filter(id => state.prices[id] === undefined);

  if (!toFetch.length) return;

  // Mark as loading
  toFetch.forEach(id => {
    state.prices[id] = 'loading';
  });

  try {
    const params = new URLSearchParams({
      appids: toFetch.join(','),
      cc: state.currency,
    });
    const resp = await fetch(`/api/prices?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    let totalDelta = 0;
    let unplayedDelta = 0;

    Object.entries(data).forEach(([appid, priceObj]) => {
      state.prices[appid] = priceObj;

      if (priceObj && priceObj.final != null) {
        state.pricedCount++;
        totalDelta += priceObj.final;

        const game = state.allGames.find(g => String(g.appid) === appid);
        if (game && !game.playtime_forever) {
          unplayedDelta += priceObj.final;
        }
      }

      // Update card price element if visible
      const priceEl = gameGrid.querySelector(`.card-price[data-appid="${appid}"]`);
      if (priceEl) {
        const game = state.allGames.find(g => String(g.appid) === appid);
        renderPriceEl(priceEl, priceObj, game ? !game.playtime_forever : false);

        // Add discount badge to card if applicable
        if (priceObj && priceObj.discount_percent > 0) {
          const card = priceEl.closest('.game-card');
          if (card && !card.querySelector('.badge-top-right')) {
            const discWrap = document.createElement('span');
            discWrap.className = 'badge-top-right';
            const discBadge = document.createElement('span');
            discBadge.className = 'badge-discount';
            discBadge.textContent = `-${priceObj.discount_percent}%`;
            discWrap.appendChild(discBadge);
            card.querySelector('.card-image-wrap').appendChild(discWrap);
          }
        }
      }
    });

    // Animate totals
    if (totalDelta > 0) {
      const prevTotal = state.totalCents;
      state.totalCents += totalDelta;
      animateValue(elTotalValue, prevTotal, state.totalCents);
    }
    if (unplayedDelta > 0) {
      const prevUnplayed = state.unplayedCents;
      state.unplayedCents += unplayedDelta;
      animateValue(elUnplayedValue, prevUnplayed, state.unplayedCents);
    }

    elStatPriced.textContent = `${state.pricedCount} / ${state.allGames.length}`;

  } catch (err) {
    toFetch.forEach(id => { state.prices[id] = null; });
    console.error('Price fetch error:', err);
  }
}

// ── Pagination ────────────────────────────────────
function renderPagination() {
  pagination.innerHTML = '';
  const totalPages = Math.ceil(state.filtered.length / PAGE_SIZE);
  if (totalPages <= 1) return;

  const makeBtn = (label, page, active = false, disabled = false) => {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (active ? ' active' : '');
    btn.textContent = label;
    btn.disabled = disabled || active;
    if (!disabled && !active) {
      btn.addEventListener('click', () => {
        state.page = page;
        renderGrid();
        renderPagination();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    return btn;
  };

  pagination.appendChild(makeBtn('←', state.page - 1, false, state.page === 1));

  // Page numbers with ellipsis
  const range = [];
  if (totalPages <= 9) {
    for (let i = 1; i <= totalPages; i++) range.push(i);
  } else {
    range.push(1);
    if (state.page > 4) {
      const el = document.createElement('span');
      el.className = 'page-ellipsis';
      el.textContent = '…';
      pagination.appendChild(el);
    }
    const start = Math.max(2, state.page - 2);
    const end   = Math.min(totalPages - 1, state.page + 2);
    for (let i = start; i <= end; i++) range.push(i);
    range.forEach(p => pagination.appendChild(makeBtn(p, p, p === state.page)));
    if (state.page < totalPages - 3) {
      const el = document.createElement('span');
      el.className = 'page-ellipsis';
      el.textContent = '…';
      pagination.appendChild(el);
    }
    pagination.appendChild(makeBtn(totalPages, totalPages, totalPages === state.page));
    pagination.appendChild(makeBtn('→', state.page + 1, false, state.page === totalPages));
    return;
  }

  range.forEach(p => pagination.appendChild(makeBtn(p, p, p === state.page)));
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

// ── Main load flow ────────────────────────────────
async function loadLibrary(steamId, apiKey, currency) {
  setLoading('Resolving Steam profile…');
  let resolvedId = steamId;

  if (!steamId.match(/^\d{17}$/)) {
    const params = new URLSearchParams({ id: steamId, key: apiKey });
    const res = await fetch(`/api/resolve?${params}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    resolvedId = json.steamid;
  }

  setLoading('Fetching your library…');
  const libParams = new URLSearchParams({ key: apiKey });
  const libRes = await fetch(`/api/library/${resolvedId}?${libParams}`);
  const libJson = await libRes.json();
  if (libJson.error) throw new Error(libJson.error);

  return { games: libJson.games, steamId: resolvedId };
}

// ── Event: form submit ────────────────────────────
setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const steamInput = document.getElementById('steamInput').value.trim();
  const apiKey     = document.getElementById('apiKeyInput').value.trim();
  const currency   = document.getElementById('currencySelect').value;

  if (!steamInput) return showError('Please enter your Steam ID or username.');
  if (!apiKey)     return showError('Please enter your Steam Web API key.');

  loadBtn.disabled = true;

  try {
    const { games, steamId } = await loadLibrary(steamInput, apiKey, currency);

    // Persist state
    state.allGames     = games;
    state.apiKey       = apiKey;
    state.steamId      = steamId;
    state.currency     = currency;
    state.prices       = {};
    state.page         = 1;
    state.totalCents   = 0;
    state.unplayedCents= 0;
    state.pricedCount  = 0;

    // Update banner stats
    const unplayed = games.filter(g => !g.playtime_forever).length;
    elStatGames.textContent    = games.length.toLocaleString();
    elStatUnplayed.textContent = unplayed.toLocaleString();
    elTotalValue.textContent   = '$0.00';
    elUnplayedValue.textContent= '$0.00';
    elStatPriced.textContent   = `0 / ${games.length}`;

    // Show store
    setupSection.style.display = 'none';
    storeSection.style.display = 'block';
    clearLoading();

    applyFilterSort();

  } catch (err) {
    clearLoading();
    showError(err.message || 'Something went wrong. Please check your details and try again.');
  } finally {
    loadBtn.disabled = false;
  }
});

// ── Event: filter / sort change ───────────────────
filterSelect.addEventListener('change', applyFilterSort);
sortSelect.addEventListener('change', applyFilterSort);

// ── Event: back button ────────────────────────────
backBtn.addEventListener('click', () => {
  storeSection.style.display = 'none';
  setupSection.style.display = 'flex';
});

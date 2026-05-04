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
  hltb:     {},   // appid -> {main, extra, complete, matched} | null | 'loading'
  details:  {},   // appid -> { genres:[], release_date:'' } | null | 'loading'
  page: 1,
  apiKey: '',
  steamId: '',
  currency: 'us',
  totalCents: 0,
  unplayedCents: 0,
  uncompletedCents: 0,
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
const sortDirSelect  = document.getElementById('sortDirSelect');
const viewModeSelect = document.getElementById('viewModeSelect');
const searchInput    = document.getElementById('searchInput');
const showIgnoredCheckbox = document.getElementById('showIgnoredCheckbox');
const cphCheckbox    = document.getElementById('cphCheckbox');
const genreFilterInput = document.getElementById('genreFilterInput');
const tagFilterInput = document.getElementById('tagFilterInput');
const recGenreInput = document.getElementById('recGenreInput');
const recTagInput = document.getElementById('recTagInput');
const backBtn        = document.getElementById('backBtn');
const exportCsvBtn   = document.getElementById('exportCsvBtn');
const surpriseMeBtn  = document.getElementById('surpriseMeBtn');
const recommendBtn   = document.getElementById('recommendBtn');
const recommendModal = document.getElementById('recommendModal');
const closeRecommendBtn = document.getElementById('closeRecommendBtn');
const recommendGrid  = document.getElementById('recommendGrid');

const gameDetailsModal = document.getElementById('gameDetailsModal');
const closeGameDetailsBtn = document.getElementById('closeGameDetailsBtn');
const gameDetailsImg = document.getElementById('gameDetailsImg');
const gameDetailsTitle = document.getElementById('gameDetailsTitle');
const gameDetailsDesc = document.getElementById('gameDetailsDesc');
const gameDetailsRelease = document.getElementById('gameDetailsRelease');
const gameDetailsDev = document.getElementById('gameDetailsDev');
const gameDetailsGenres = document.getElementById('gameDetailsGenres');
const gameDetailsPlaytime = document.getElementById('gameDetailsPlaytime');
const gameDetailsAddHoursBtn = document.getElementById('gameDetailsAddHoursBtn');
const gameDetailsPrice = document.getElementById('gameDetailsPrice');
const gameDetailsMetacritic = document.getElementById('gameDetailsMetacritic');
const gameDetailsReview = document.getElementById('gameDetailsReview');
const gameDetailsHltb = document.getElementById('gameDetailsHltb');
const gameDetailsFeatures = document.getElementById('gameDetailsFeatures');
const gameDetailsTags = document.getElementById('gameDetailsTags');
const gameDetailsClientLink = document.getElementById('gameDetailsClientLink');
const gameDetailsStoreLink = document.getElementById('gameDetailsStoreLink');
const gameDetailsCompleteBtn = document.getElementById('gameDetailsCompleteBtn');
const gameDetailsPlayingBtn = document.getElementById('gameDetailsPlayingBtn');
const gameDetailsIgnoreBtn = document.getElementById('gameDetailsIgnoreBtn');

const elTotalValue    = document.getElementById('totalValue');
const elUnplayedValue = document.getElementById('unplayedValue');
const elUncompletedValue = document.getElementById('uncompletedValue');
const elStatGames     = document.getElementById('statGames');
const elStatUnplayed  = document.getElementById('statUnplayed');
const elStatUncompleted = document.getElementById('statUncompleted');
const elUncompletedTime = document.getElementById('uncompletedTime');
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
const LS_KEY           = 'sbs_profile';
const LS_COMPLETED_KEY = 'sbs_completed';

function saveProfile(steamInput, apiKey, currency) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ steamInput, apiKey, currency })); } catch (_) {}
}
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) { return null; }
}

// Completed set persists across sessions, keyed by appid
const completed = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(LS_COMPLETED_KEY) || '[]')); }
  catch (_) { return new Set(); }
})();

function saveCompleted() {
  try { localStorage.setItem(LS_COMPLETED_KEY, JSON.stringify([...completed])); } catch (_) {}
}

const LS_EXTRA_HOURS_KEY = 'sbs_extra_hours';
const extraHours = (() => {
  try { return JSON.parse(localStorage.getItem(LS_EXTRA_HOURS_KEY) || '{}'); }
  catch (_) { return {}; }
})();
function saveExtraHours() {
  try { localStorage.setItem(LS_EXTRA_HOURS_KEY, JSON.stringify(extraHours)); } catch (_) {}
}
function getPlaytime(game) {
  if (!game) return 0;
  const extra = extraHours[game.appid] || 0;
  return (game.playtime_forever || 0) + extra * 60;
}

const LS_PLAYING_KEY = 'sbs_playing';
const playing = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(LS_PLAYING_KEY) || '[]')); }
  catch (_) { return new Set(); }
})();
function savePlaying() {
  try { localStorage.setItem(LS_PLAYING_KEY, JSON.stringify([...playing])); } catch (_) {}
}

const LS_IGNORED_KEY = 'sbs_ignored';

const ignored = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(LS_IGNORED_KEY) || '[]')); }
  catch (_) { return new Set(); }
})();

function saveIgnored() {
  try { localStorage.setItem(LS_IGNORED_KEY, JSON.stringify([...ignored])); } catch (_) {}
}

function updateTotals() {
  let gamesCount = 0;
  let unplayedCount = 0;
  let uncompletedCount = 0;
  let pricedCount = 0;
  
  let newTotal = 0;
  let newUnplayed = 0;
  let newUncompleted = 0;

  state.allGames.forEach(g => {
    const id = String(g.appid);
    if (ignored.has(id)) return;
    
    gamesCount++;
    const isUnplayed = getPlaytime(g) <= 0;
    const isUncompleted = !completed.has(id);
    
    if (isUnplayed) unplayedCount++;
    if (isUncompleted) uncompletedCount++;
    
    const p = state.prices[id];
    if (p && p !== 'loading' && p.final != null) {
      pricedCount++;
      newTotal += p.final;
      if (isUnplayed) newUnplayed += p.final;
      if (isUncompleted) newUncompleted += p.final;
    }
  });

  elStatGames.textContent = gamesCount.toLocaleString();
  elStatUnplayed.textContent = unplayedCount.toLocaleString();
  if (elStatUncompleted) elStatUncompleted.textContent = uncompletedCount.toLocaleString();
  elStatPriced.textContent = `${pricedCount} / ${gamesCount}`;

  if (state.totalCents !== newTotal) {
    animateValue(elTotalValue, state.totalCents, newTotal);
    state.totalCents = newTotal;
  }
  if (state.unplayedCents !== newUnplayed) {
    animateValue(elUnplayedValue, state.unplayedCents, newUnplayed);
    state.unplayedCents = newUnplayed;
  }
  if (state.uncompletedCents !== newUncompleted) {
    if (elUncompletedValue) animateValue(elUncompletedValue, state.uncompletedCents, newUncompleted);
    state.uncompletedCents = newUncompleted;
  }
  state.pricedCount = pricedCount;
  
  updateUncompletedHoursDisplay();
}

function updateCardVisuals(card, appid) {
  const done = completed.has(appid);
  const ign = ignored.has(appid);
  const play = playing.has(appid);
  
  card.classList.toggle('is-complete', done);
  card.classList.toggle('is-ignored', ign);
  card.classList.toggle('is-playing', play);
  
  let doneOverlay = card.querySelector('.badge-completed-overlay');
  if (done && !ign) {
    if (!doneOverlay) {
      doneOverlay = document.createElement('div');
      doneOverlay.className = 'badge-completed-overlay';
      const imgWrap = card.querySelector('.card-image-wrap, .table-image-wrap');
      if (imgWrap) imgWrap.appendChild(doneOverlay);
    }
    doneOverlay.textContent = '✓ Completed';
  } else if (doneOverlay) {
    doneOverlay.remove();
  }
  
  let playOverlay = card.querySelector('.badge-playing-overlay');
  if (play && !done && !ign) {
    if (!playOverlay) {
      playOverlay = document.createElement('div');
      playOverlay.className = 'badge-playing-overlay';
      const imgWrap = card.querySelector('.card-image-wrap, .table-image-wrap');
      if (imgWrap) imgWrap.appendChild(playOverlay);
    }
    playOverlay.textContent = '▶ Playing';
  } else if (playOverlay) {
    playOverlay.remove();
  }

  const btns = card.querySelectorAll('.complete-btn');
  if (btns.length === 3) {
    btns[0].classList.toggle('is-complete', done);
    btns[0].textContent = done ? '✓ Completed' : 'Completed';
    
    btns[1].classList.toggle('is-playing-btn', play);
    btns[1].textContent = play ? '▶ Playing' : 'Playing';
    
    btns[2].classList.toggle('is-ignored-btn', ign);
    btns[2].textContent = ign ? '🚫 Ignored' : 'Ignore';
  }
}

function toggleCompleted(appid) {
  const wasCompleted = completed.has(appid);
  if (wasCompleted) {
    completed.delete(appid);
  } else {
    completed.add(appid);
    playing.delete(appid);
    savePlaying();
  }
  saveCompleted();
  
  const cards = document.querySelectorAll(`.game-card[data-appid="${appid}"], .game-row[data-appid="${appid}"]`);
  cards.forEach(card => updateCardVisuals(card, appid));
  
  updateTotals();
  applyFilterSort(true);

  // Confetti celebration if marking as completed!
  if (!wasCompleted && typeof confetti === 'function') {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#a4d007', '#66c0f4', '#ffffff'],
      zIndex: 2000
    });
  }
}

function togglePlaying(appid) {
  const wasPlaying = playing.has(appid);
  if (wasPlaying) {
    playing.delete(appid);
  } else {
    playing.add(appid);
    completed.delete(appid);
    saveCompleted();
  }
  savePlaying();
  
  const cards = document.querySelectorAll(`.game-card[data-appid="${appid}"], .game-row[data-appid="${appid}"]`);
  cards.forEach(card => updateCardVisuals(card, appid));
  
  updateTotals();
  applyFilterSort(true);
}

function toggleIgnored(appid) {
  const wasIgnored = ignored.has(appid);
  if (wasIgnored) ignored.delete(appid); else ignored.add(appid);
  saveIgnored();
  
  updateTotals();
  
  const showIgnored = showIgnoredCheckbox?.checked;
  if (showIgnored) {
    const cards = document.querySelectorAll(`.game-card[data-appid="${appid}"], .game-row[data-appid="${appid}"]`);
    cards.forEach(card => updateCardVisuals(card, appid));
  } else {
    applyFilterSort(true);
  }
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
function renderPriceEl(el, priceData, game) {
  el.innerHTML = '';
  const unplayed = !game || getPlaytime(game) <= 0;
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
  
  if (cphCheckbox && cphCheckbox.checked && game && fmt.finalCents > 0) {
    const hltb = state.hltb[game.appid];
    const hltbHours = (hltb && hltb !== 'loading' && hltb.main > 0) ? hltb.main : null;
    const playedHours = getPlaytime(game) / 60;
    
    const curCph = playedHours > 0 ? formatCents(fmt.finalCents / playedHours) + '/hr' : 'Unplayed';
    
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'flex-start';
    wrap.style.lineHeight = '1.2';
    
    const curSpan = document.createElement('span');
    curSpan.className = 'price-final';
    curSpan.textContent = curCph;
    wrap.appendChild(curSpan);
    
    if (hltbHours) {
      const potSpan = document.createElement('span');
      potSpan.style.fontSize = '11px';
      potSpan.style.color = 'var(--text-secondary)';
      potSpan.textContent = `Pot: ${formatCents(fmt.finalCents / hltbHours)}/hr`;
      wrap.appendChild(potSpan);
    }
    
    el.appendChild(wrap);
    return;
  }

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
  const els = document.querySelectorAll(`.card-price[data-appid="${appid}"]`);
  els.forEach(priceEl => {
    const game = state.allGames.find(g => String(g.appid) === appid);
    renderPriceEl(priceEl, priceObj, game);
    if (priceObj && priceObj.discount_percent > 0 && !(cphCheckbox && cphCheckbox.checked)) {
        const imgWrap = priceEl.closest('.game-card, .game-row')?.querySelector('.card-image-wrap, .table-image-wrap');
        if (imgWrap && !imgWrap.querySelector('.badge-top-right')) {
        const wrap = document.createElement('span'); wrap.className = 'badge-top-right';
        const badge = document.createElement('span'); badge.className = 'badge-discount';
        badge.textContent = `-${priceObj.discount_percent}%`;
          if (imgWrap.classList.contains('table-image-wrap')) {
            wrap.style.top = '4px'; wrap.style.right = '4px';
            badge.style.fontSize = '10px'; badge.style.padding = '2px 4px';
          }
        wrap.appendChild(badge);
          imgWrap.appendChild(wrap);
      }
    }
  });
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

    let priceUpdated = false;
    Object.entries(data).forEach(([appid, priceObj]) => {
      state.prices[appid] = priceObj;
      updateCardPrice(appid, priceObj);
      priceUpdated = true;
    });

    if (priceUpdated) updateTotals();

  } catch (err) {
    // Reset to undefined so background loader can retry
    appids.forEach(id => { if (state.prices[id] === 'loading') delete state.prices[id]; });
    throw err;
  }
}

// High-priority: current visible page
async function loadPricesForPage(games) {
  // Cap the immediate page fetch to 50 so we don't break URL limits in "Show All" table view
  const toFetch = games.map(g => String(g.appid)).filter(id => state.prices[id] === undefined).slice(0, 50);
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
  const els = document.querySelectorAll(`.card-review[data-appid="${appid}"]`);
  els.forEach(el => renderReviewEl(el, reviewData));
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

// ── HLTB render helpers ───────────────────────────
function formatHours(h) {
  if (!h || h <= 0) return null;
  if (h < 1)  return '<1h';
  if (h < 10) return `${parseFloat(h.toFixed(1))}h`;
  return `${Math.round(h)}h`;
}

function renderHltbEl(el, hltbData) {
  el.innerHTML = '';
  if (!hltbData || hltbData === 'loading') return;
  const main     = formatHours(hltbData.main);
  const extra    = formatHours(hltbData.extra);
  const complete = formatHours(hltbData.complete);
  if (!main && !extra && !complete) return;
  const parts = [];
  if (main)     parts.push(`Main ${main}`);
  if (extra)    parts.push(`+Extra ${extra}`);
  if (complete) parts.push(`100% ${complete}`);
  const s = document.createElement('span');
  s.className = 'hltb-label';
  s.textContent = '⏱ ' + parts.join(' · ');
  s.title = parts.join(' | ') + (hltbData.matched ? ` (matched: ${hltbData.matched})` : '');
  el.appendChild(s);
}

function updateCardHltb(appid, hltbData) {
  const els = document.querySelectorAll(`.card-hltb[data-appid="${appid}"]`);
  els.forEach(el => renderHltbEl(el, hltbData));
}

function renderTagsEl(el, detailsData) {
  el.innerHTML = '';
  if (!detailsData || detailsData === 'loading') return;
  const tags = detailsData.tags || [];
  if (!tags.length) {
    const s = document.createElement('span');
    s.className = 'tags-none';
    s.textContent = 'No tags';
    el.appendChild(s);
    return;
  }
  const topTags = tags.slice(0, 3);
  topTags.forEach(t => {
    const badge = document.createElement('span');
    badge.className = 'tag-badge';
    badge.textContent = t;
    el.appendChild(badge);
  });
}

function updateCardTags(appid, detailsData) {
  const els = document.querySelectorAll(`.card-tags[data-appid="${appid}"]`);
  els.forEach(el => renderTagsEl(el, detailsData));
}

function updateUncompletedHoursDisplay() {
  if (!elUncompletedTime) return;
  let total = 0;
  state.allGames.forEach(g => {
    const id = String(g.appid);
    if (!completed.has(id) && !ignored.has(id)) {
      const hData = state.hltb[id];
      if (hData && hData !== 'loading' && hData.main) {
        total += hData.main;
      }
    }
  });
  elUncompletedTime.textContent = total > 0 ? (Math.round(total).toLocaleString() + 'h') : '0h';
}

async function backgroundLoadHltb() {
  const BATCH = 50;
  const all = state.allGames;
  for (let i = 0; i < all.length; i += BATCH) {
    if (storeSection.style.display === 'none') break;
    const batch = all.slice(i, i + BATCH).filter(g => state.hltb[String(g.appid)] === undefined);
    if (!batch.length) continue;
    batch.forEach(g => { state.hltb[String(g.appid)] = 'loading'; });
    try {
      const payload = batch.map(g => ({ appid: String(g.appid), title: g.name || '' }));
      const resp = await fetch('/api/hltb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      Object.entries(data).forEach(([appid, hltbData]) => {
        state.hltb[appid] = hltbData;
        updateCardHltb(appid, hltbData);
      });
      updateUncompletedHoursDisplay();
    } catch (_) {
      batch.forEach(g => { const id = String(g.appid); if (state.hltb[id] === 'loading') delete state.hltb[id]; });
    }
    await delay(100);  // Now querying local CSV
  }
}

// ── Genre Background Loader & UI ───────────────────
let knownGenres = new Set();
try {
  const savedGenres = JSON.parse(localStorage.getItem('sbs_known_genres') || '[]');
  knownGenres = new Set(savedGenres);
} catch(_) {}

let knownTags = new Set();
try {
  const savedTags = JSON.parse(localStorage.getItem('sbs_known_tags') || '[]');
  knownTags = new Set(savedTags);
} catch(_) {}

function renderGenreDropdowns() {
  const genreCounts = {};
  const tagCounts = {};
  state.allGames.forEach(g => {
    const details = state.details[g.appid];
    if (details && details !== 'loading') {
      if (details.genres) details.genres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
      if (details.tags) details.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    }
  });

  const sortedGenres = Object.keys(genreCounts).sort((a, b) => a.localeCompare(b));

  const sortedTags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b));
  
  let genreList = document.getElementById('genreList');
  if (!genreList) {
    genreList = document.createElement('datalist');
    genreList.id = 'genreList';
    document.body.appendChild(genreList);
  }
  
  genreList.innerHTML = '';
  sortedGenres.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    const count = genreCounts[g] || 0;
    if (count > 0) opt.textContent = `${count} games`;
    genreList.appendChild(opt);
  });

  let tagList = document.getElementById('tagList');
  if (!tagList) {
    tagList = document.createElement('datalist');
    tagList.id = 'tagList';
    document.body.appendChild(tagList);
  }
  
  tagList.innerHTML = '';
  sortedTags.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    const count = tagCounts[t] || 0;
    if (count > 0) opt.textContent = `${count} games`;
    tagList.appendChild(opt);
  });
}

async function backgroundLoadDetails() {
  const BATCH = 4;
  const allIds = state.allGames.map(g => String(g.appid));
  for (let i = 0; i < allIds.length; i += BATCH) {
    if (storeSection.style.display === 'none') break;
    const batch = allIds.slice(i, i + BATCH).filter(id => state.details[id] === undefined);
    if (!batch.length) continue;
    
    batch.forEach(id => { state.details[id] = 'loading'; });
    try {
      const params = new URLSearchParams({ appids: batch.join(','), cc: state.currency });
      const resp = await fetch(`/api/genres?${params}`); // Route is still /api/genres
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      let changed = false;
      batch.forEach(id => {
        if (data[id] !== undefined) {
          state.details[id] = data[id];
          changed = true;
          updateCardTags(id, data[id]);
        } else {
          state.details[id] = null; // Mark as failed so we don't hang the progress bar
        }
      });
      if (changed) renderGenreDropdowns();
      if ((genreFilterInput && genreFilterInput.value.trim()) || (tagFilterInput && tagFilterInput.value.trim()) || sortSelect?.value === 'release') applyFilterSort(true);
      else updateResultsCount();
    } catch (_) { batch.forEach(id => { if (state.details[id] === 'loading') state.details[id] = null; }); }
    await delay(300);
  }
}

function updateCardPlaytimeBadge(appid) {
  const game = state.allGames.find(g => String(g.appid) === appid);
  if (!game) return;
  const cards = document.querySelectorAll(`.game-card[data-appid="${appid}"], .game-row[data-appid="${appid}"]`);
  cards.forEach(card => {
    const unplayed = getPlaytime(game) <= 0;
    const badge = card.querySelector('.card-badge');
    if (badge) {
      badge.className = 'card-badge ' + (unplayed ? 'badge-unplayed' : 'badge-hours');
      badge.textContent = unplayed ? 'Unplayed' : hoursLabel(getPlaytime(game)) + ' played';
    }
  });
}

// ── Game Details Modal ────────────────────────────
function showGameDetails(appid) {
  const game = state.allGames.find(g => String(g.appid) === appid);
  if (!game) return;

  gameDetailsTitle.textContent = game.name || `App ${appid}`;
  gameDetailsImg.src = imageUrl(appid);
  gameDetailsClientLink.href = `steam://run/${appid}`;
  gameDetailsStoreLink.href = `https://store.steampowered.com/app/${appid}`;

  const isPlayed = getPlaytime(game) > 0;
  gameDetailsPlaytime.textContent = isPlayed ? hoursLabel(getPlaytime(game)) + ' played' : 'Unplayed';
  gameDetailsPlaytime.style.color = isPlayed ? 'var(--text-primary)' : '#ff6b6b';

  if (gameDetailsAddHoursBtn) {
    gameDetailsAddHoursBtn.onclick = () => {
      const currentExtra = extraHours[appid] || 0;
      const input = prompt(`Enter additional hours played elsewhere for ${game.name}:\n(Steam logged: ${hoursLabel(game.playtime_forever) || '0h'})\n\nSet to 0 to remove.`, currentExtra);
      if (input !== null) {
        const parsed = parseFloat(input);
        if (!isNaN(parsed)) {
          if (parsed <= 0) {
            delete extraHours[appid];
          } else {
            extraHours[appid] = parsed;
          }
          saveExtraHours();
          showGameDetails(appid);
          updateCardPlaytimeBadge(appid);
          updateCardPrice(appid, state.prices[appid]);
          updateTotals();
        }
      }
    };
  }

  const isCph = cphCheckbox && cphCheckbox.checked;
  const priceData = state.prices[appid];
  if (priceData && priceData !== 'loading') {
    const fmt = formatPrice(priceData);
    if (fmt) {
      if (isCph && fmt.finalCents > 0) {
        const playedHours = getPlaytime(game) / 60;
        const hltb = state.hltb[appid];
        const hltbHours = (hltb && hltb !== 'loading' && hltb.main > 0) ? hltb.main : null;
        
        let cphStr = playedHours > 0 ? formatCents(fmt.finalCents / playedHours) + '/hr' : 'Unplayed';
        if (hltbHours) cphStr += ` (Pot: ${formatCents(fmt.finalCents / hltbHours)}/hr)`;
        
        gameDetailsPrice.textContent = cphStr;
      } else {
        gameDetailsPrice.textContent = fmt.finalCents === 0 ? 'Free' : fmt.final;
        if (fmt.disc > 0) {
          gameDetailsPrice.innerHTML += ` <span style="font-size:12px; color:var(--price-orig); text-decoration:line-through; margin-left:4px;">${fmt.initial}</span> <span style="font-size:12px; color:var(--discount-text); background:var(--discount-bg); padding:2px 4px; border-radius:3px; margin-left:4px;">-${fmt.disc}%</span>`;
        }
      }
    } else {
      gameDetailsPrice.textContent = isPlayed ? 'N/A' : 'Free / N/A';
    }
  } else {
    gameDetailsPrice.textContent = priceData === 'loading' ? 'Loading…' : 'N/A';
  }

  const reviewData = state.reviews[appid];
  if (reviewData && reviewData !== 'loading') {
    if (reviewData.total < 10) {
      gameDetailsReview.textContent = 'No reviews';
      gameDetailsReview.className = 'stat-value';
      gameDetailsReview.style.color = 'var(--text-dim)';
    } else {
      gameDetailsReview.textContent = `${reviewData.pct}% (${reviewData.desc})`;
      gameDetailsReview.className = `stat-value ${reviewClass(reviewData.score)}`;
      gameDetailsReview.title = `${reviewData.positive.toLocaleString()} / ${reviewData.total.toLocaleString()} positive`;
      gameDetailsReview.style.color = '';
    }
  } else {
    gameDetailsReview.textContent = reviewData === 'loading' ? 'Loading…' : 'N/A';
    gameDetailsReview.className = 'stat-value';
    gameDetailsReview.style.color = 'var(--text-dim)';
  }

  const hltbData = state.hltb[appid];
  if (hltbData && hltbData !== 'loading') {
    const main = formatHours(hltbData.main);
    const extra = formatHours(hltbData.extra);
    const complete = formatHours(hltbData.complete);
    const parts = [];
    if (main) parts.push(`Main: ${main}`);
    if (extra) parts.push(`+Extra: ${extra}`);
    if (complete) parts.push(`100%: ${complete}`);
    gameDetailsHltb.textContent = parts.length > 0 ? parts.join(' | ') : 'Unknown';
  } else {
    gameDetailsHltb.textContent = hltbData === 'loading' ? 'Loading…' : 'Unknown';
  }

  // Reset and fetch extended details
  gameDetailsDesc.textContent = 'Loading details...';
  gameDetailsRelease.textContent = '—';
  gameDetailsDev.textContent = '—';
  gameDetailsDev.title = '';
  gameDetailsGenres.textContent = '—';
  gameDetailsGenres.title = '';
  gameDetailsMetacritic.textContent = '—';
  gameDetailsFeatures.textContent = '—';
  gameDetailsTags.textContent = '—';

  fetch(`/api/details/${appid}?cc=${state.currency}`)
    .then(res => res.ok ? res.json() : Promise.reject('Failed to fetch'))
    .then(data => {
      if (Object.keys(data).length === 0) {
        if (gameDetailsDesc.textContent.includes('Loading')) gameDetailsDesc.textContent = 'No additional details available for this title.';
        return;
      }
      if (data.short_description) {
        gameDetailsDesc.innerHTML = data.short_description; // Use innerHTML to handle Steam's <br> and <b> tags
      } else {
        gameDetailsDesc.textContent = 'No description available.';
      }
      gameDetailsRelease.textContent = data.release_date || 'Unknown';
      
      const devs = data.developers && data.developers.length ? data.developers.join(', ') : 'Unknown';
      gameDetailsDev.textContent = devs; gameDetailsDev.title = devs;
      
      const genres = data.genres && data.genres.length ? data.genres.join(', ') : 'Unknown';
      gameDetailsGenres.textContent = genres; gameDetailsGenres.title = genres;
      
      if (data.metacritic) {
        gameDetailsMetacritic.textContent = data.metacritic;
        gameDetailsMetacritic.style.color = data.metacritic >= 75 ? '#66cc33' : (data.metacritic >= 50 ? '#ffcc33' : '#ff0000');
      } else {
        gameDetailsMetacritic.textContent = 'N/A';
        gameDetailsMetacritic.style.color = 'var(--text-dim)';
      }
      
      gameDetailsFeatures.textContent = data.categories && data.categories.length ? data.categories.join(' • ') : 'None listed';
      gameDetailsTags.textContent = data.tags && data.tags.length ? data.tags.join(', ') : 'None listed';
    }).catch(() => gameDetailsDesc.textContent = 'Failed to load extended details.');

  const updateModalButtons = () => {
    const done = completed.has(appid);
    const play = playing.has(appid);
    const ign = ignored.has(appid);
    gameDetailsCompleteBtn.textContent = done ? '✓ Completed' : 'Completed';
    gameDetailsCompleteBtn.className = 'complete-btn' + (done ? ' is-complete' : '');
    if (gameDetailsPlayingBtn) {
      gameDetailsPlayingBtn.textContent = play ? '▶ Playing' : 'Playing';
      gameDetailsPlayingBtn.className = 'complete-btn' + (play ? ' is-playing-btn' : '');
    }
    gameDetailsIgnoreBtn.textContent = ign ? '🚫 Ignored' : 'Ignore';
    gameDetailsIgnoreBtn.className = 'complete-btn' + (ign ? ' is-ignored-btn' : '');
  };
  
  updateModalButtons();
  gameDetailsCompleteBtn.onclick = () => { toggleCompleted(appid); updateModalButtons(); };
  if (gameDetailsPlayingBtn) gameDetailsPlayingBtn.onclick = () => { togglePlaying(appid); updateModalButtons(); };
  gameDetailsIgnoreBtn.onclick = () => { toggleIgnored(appid); updateModalButtons(); };

  if (gameDetailsModal) gameDetailsModal.style.display = 'flex';
}

// ── Card building ─────────────────────────────────
function buildCard(game) {
  const appid    = String(game.appid);
  const hours    = hoursLabel(getPlaytime(game));
  const unplayed = getPlaytime(game) <= 0;

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

  // HLTB row
  const hltbEl = document.createElement('div');
  hltbEl.className = 'card-hltb';
  hltbEl.dataset.appid = appid;
  renderHltbEl(hltbEl, state.hltb[appid]);
  body.appendChild(hltbEl);

  // Tags row
  const tagsEl = document.createElement('div');
  tagsEl.className = 'card-tags';
  tagsEl.dataset.appid = appid;
  renderTagsEl(tagsEl, state.details[appid]);
  body.appendChild(tagsEl);

  // Price row
  const priceEl = document.createElement('div');
  priceEl.className = 'card-price';
  priceEl.dataset.appid = appid;
  renderPriceEl(priceEl, priceData, game);
  body.appendChild(priceEl);

  // Action buttons group
  const btnGroup = document.createElement('div');
  btnGroup.style.display = 'flex';
  btnGroup.style.gap = '6px';
  btnGroup.style.marginTop = '6px';

  const completeBtn = document.createElement('button');
  completeBtn.className = 'complete-btn' + (completed.has(appid) ? ' is-complete' : '');
  completeBtn.textContent = completed.has(appid) ? '✓ Completed' : 'Completed';
  completeBtn.style.flex = '1';
  completeBtn.style.marginTop = '0';
  completeBtn.addEventListener('click', e => { e.stopPropagation(); toggleCompleted(appid); });
  
  const playingBtn = document.createElement('button');
  playingBtn.className = 'complete-btn' + (playing.has(appid) ? ' is-playing-btn' : '');
  playingBtn.textContent = playing.has(appid) ? '▶ Playing' : 'Playing';
  playingBtn.style.flex = '1';
  playingBtn.style.marginTop = '0';
  playingBtn.addEventListener('click', e => { e.stopPropagation(); togglePlaying(appid); });

  const ignoreBtn = document.createElement('button');
  ignoreBtn.className = 'complete-btn' + (ignored.has(appid) ? ' is-ignored-btn' : '');
  ignoreBtn.textContent = ignored.has(appid) ? '🚫 Ignored' : 'Ignore';
  ignoreBtn.style.flex = '1';
  ignoreBtn.style.marginTop = '0';
  ignoreBtn.addEventListener('click', e => { e.stopPropagation(); toggleIgnored(appid); });

  btnGroup.appendChild(completeBtn);
  btnGroup.appendChild(playingBtn);
  btnGroup.appendChild(ignoreBtn);
  body.appendChild(btnGroup);

  card.appendChild(body);

  updateCardVisuals(card, appid);

  card.addEventListener('click', () => showGameDetails(appid));
  return card;
}

function buildTableRow(game) {
  const appid    = String(game.appid);
  const hours    = hoursLabel(getPlaytime(game));
  const unplayed = getPlaytime(game) <= 0;
  const priceData = state.prices[appid];

  const tr = document.createElement('tr');
  tr.className = 'game-row';
  tr.dataset.appid = appid;

  // Image
  const tdImg = document.createElement('td');
  const imgWrap = document.createElement('div');
  imgWrap.className = 'table-image-wrap';
  const img = document.createElement('img');
  img.className = 'table-img';
  img.loading = 'lazy';
  img.alt = game.name || appid;
  img.src = imageUrl(appid);
  img.onerror = () => { img.style.display = 'none'; };
  img.addEventListener('click', () => showGameDetails(appid));
  imgWrap.appendChild(img);
  
  if (priceData && priceData !== 'loading' && priceData.discount_percent > 0 && !(cphCheckbox && cphCheckbox.checked)) {
    const discWrap = document.createElement('span'); 
    discWrap.className = 'badge-top-right';
    discWrap.style.top = '4px'; discWrap.style.right = '4px';
    const discBadge = document.createElement('span'); 
    discBadge.className = 'badge-discount';
    discBadge.style.fontSize = '10px';
    discBadge.style.padding = '2px 4px';
    discBadge.textContent = `-${priceData.discount_percent}%`;
    discWrap.appendChild(discBadge);
    imgWrap.appendChild(discWrap);
  }
  tdImg.appendChild(imgWrap);
  tr.appendChild(tdImg);

  // Title
  const tdTitle = document.createElement('td');
  const titleSpan = document.createElement('span');
  titleSpan.className = 'table-title';
  titleSpan.textContent = game.name || `App ${appid}`;
  titleSpan.addEventListener('click', () => showGameDetails(appid));
  tdTitle.appendChild(titleSpan);
  tr.appendChild(tdTitle);

  // Playtime
  const tdPlaytime = document.createElement('td');
  const ptBadge = document.createElement('span');
  ptBadge.className = 'card-badge ' + (unplayed ? 'badge-unplayed' : 'badge-hours');
  ptBadge.style.position = 'static';
  ptBadge.style.display = 'inline-block';
  ptBadge.textContent = unplayed ? 'Unplayed' : hours + ' played';
  tdPlaytime.appendChild(ptBadge);
  tr.appendChild(tdPlaytime);

  // Price
  const tdPrice = document.createElement('td');
  tdPrice.className = 'card-price';
  tdPrice.dataset.appid = appid;
  renderPriceEl(tdPrice, priceData, game);
  tr.appendChild(tdPrice);

  // Review
  const tdReview = document.createElement('td');
  tdReview.className = 'card-review';
  tdReview.dataset.appid = appid;
  renderReviewEl(tdReview, state.reviews[appid]);
  tr.appendChild(tdReview);

  // HLTB
  const tdHltb = document.createElement('td');
  tdHltb.className = 'card-hltb';
  tdHltb.dataset.appid = appid;
  renderHltbEl(tdHltb, state.hltb[appid]);
  tr.appendChild(tdHltb);

  // Tags
  const tdTags = document.createElement('td');
  tdTags.className = 'card-tags';
  tdTags.dataset.appid = appid;
  renderTagsEl(tdTags, state.details[appid]);
  tr.appendChild(tdTags);

  // Actions
  const tdActions = document.createElement('td');
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'table-actions';
  
  const completeBtn = document.createElement('button');
  completeBtn.className = 'complete-btn' + (completed.has(appid) ? ' is-complete' : '');
  completeBtn.textContent = completed.has(appid) ? '✓ Completed' : 'Completed';
  completeBtn.style.margin = '0';
  completeBtn.addEventListener('click', e => { e.stopPropagation(); toggleCompleted(appid); });
  
  const playingBtn = document.createElement('button');
  playingBtn.className = 'complete-btn' + (playing.has(appid) ? ' is-playing-btn' : '');
  playingBtn.textContent = playing.has(appid) ? '▶ Playing' : 'Playing';
  playingBtn.style.margin = '0';
  playingBtn.addEventListener('click', e => { e.stopPropagation(); togglePlaying(appid); });

  const ignoreBtn = document.createElement('button');
  ignoreBtn.className = 'complete-btn' + (ignored.has(appid) ? ' is-ignored-btn' : '');
  ignoreBtn.textContent = ignored.has(appid) ? '🚫 Ignored' : 'Ignore';
  ignoreBtn.style.margin = '0';
  ignoreBtn.addEventListener('click', e => { e.stopPropagation(); toggleIgnored(appid); });

  actionsWrap.appendChild(completeBtn);
  actionsWrap.appendChild(playingBtn);
  actionsWrap.appendChild(ignoreBtn);
  tdActions.appendChild(actionsWrap);
  tr.appendChild(tdActions);

  updateCardVisuals(tr, appid);
  return tr;
}

// ── Grid + pagination ─────────────────────────────
function renderGrid() {
  gameGrid.innerHTML = '';
  const isTable = viewModeSelect && viewModeSelect.value === 'table';
  
  let page;
  if (isTable) {
    page = state.filtered; // Show all
  } else {
    const start = (state.page - 1) * PAGE_SIZE;
    page = state.filtered.slice(start, start + PAGE_SIZE);
  }
  
  if (isTable) {
    gameGrid.className = 'game-table-wrap';
    const table = document.createElement('table');
    table.className = 'game-table';
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th style="width: 120px;">Image</th>
        <th>Title</th>
        <th>Playtime</th>
        <th>Price</th>
        <th>Steam Score</th>
        <th>Time to Beat</th>
        <th>Top Tags</th>
        <th style="width: 110px;">Actions</th>
      </tr>
    `;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    page.forEach(game => tbody.appendChild(buildTableRow(game)));
    table.appendChild(tbody);
    gameGrid.appendChild(table);
  } else {
    gameGrid.className = 'game-grid';
    page.forEach(game => gameGrid.appendChild(buildCard(game)));
  }
  
  loadPricesForPage(page);
}

function renderPagination() {
  pagination.innerHTML = '';
  const isTable = viewModeSelect && viewModeSelect.value === 'table';
  if (isTable) return; // Hide pagination in table view

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
  const isTable = viewModeSelect && viewModeSelect.value === 'table';
  const start = total === 0 ? 0 : (isTable ? 1 : (state.page - 1) * PAGE_SIZE + 1);
  const end   = isTable ? total : Math.min(state.page * PAGE_SIZE, total);
  
  let text = total
    ? `Showing ${start}–${end} of ${total} games`
    : 'No games match this filter';

  if (state.allGames.length > 0) {
    let detailsLoaded = 0;
    state.allGames.forEach(g => {
      const d = state.details[g.appid];
      if (d !== undefined && d !== 'loading') detailsLoaded++;
    });
    if (detailsLoaded < state.allGames.length) {
      const pct = Math.floor((detailsLoaded / state.allGames.length) * 100);
      text += `  |  ⏳ Scanning library data (${pct}%)`;
    }
  }
  
  if (elResultsCount) elResultsCount.textContent = text;
}

function saveControls() {
  const controls = {
    filter: filterSelect?.value,
    sort: sortSelect?.value,
    sortDir: sortDirSelect?.value,
    viewMode: viewModeSelect?.value,
    showIgnored: showIgnoredCheckbox?.checked,
    cph: cphCheckbox?.checked,
    genre: genreFilterInput?.value || '',
    tag: tagFilterInput?.value || '',
    search: searchInput?.value || ''
  };
  try { localStorage.setItem('sbs_controls', JSON.stringify(controls)); } catch (_) {}
}

function applyFilterSort(preservePage = false) {
  const shouldPreserve = preservePage === true;
  saveControls();
  const filter = filterSelect.value;
  const sort   = sortSelect.value;
  const sortDir= sortDirSelect?.value === 'asc' ? 1 : -1;
  const genreFilter = genreFilterInput ? genreFilterInput.value.trim() : '';
  const tagFilter = tagFilterInput ? tagFilterInput.value.trim() : '';
  const showIgnored = showIgnoredCheckbox?.checked;
  const searchTerm = (searchInput?.value || '').toLowerCase().trim();
  let list = [...state.allGames];

  if (!showIgnored) {
    list = list.filter(g => !ignored.has(String(g.appid)));
  }

  if (searchTerm) {
    const terms = searchTerm.split(/\s+/).filter(t => t);
    list = list.filter(g => {
      const name = (g.name || '').toLowerCase();
      return terms.every(t => name.includes(t));
    });
  }

  if (filter === 'unplayed')     list = list.filter(g => getPlaytime(g) <= 0);
  if (filter === 'played')       list = list.filter(g => getPlaytime(g) > 0);
  if (filter === 'completed')    list = list.filter(g =>  completed.has(String(g.appid)));
  if (filter === 'playing')      list = list.filter(g =>  playing.has(String(g.appid)));
  if (filter === 'not_completed')list = list.filter(g => !completed.has(String(g.appid)));

  if (genreFilter && genreFilter.toLowerCase() !== 'any' && genreFilter.toLowerCase() !== 'all genres') {
    const terms = genreFilter.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
    list = list.filter(g => {
      const details = state.details[String(g.appid)];
      if (!details || details === 'loading') return false;
      return terms.every(term => details.genres?.some(x => x.toLowerCase().includes(term)));
    });
  }

  if (tagFilter && tagFilter.toLowerCase() !== 'any' && tagFilter.toLowerCase() !== 'all tags') {
    const terms = tagFilter.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
    list = list.filter(g => {
      const details = state.details[String(g.appid)];
      if (!details || details === 'loading') return false;
      return terms.every(term => details.tags?.some(x => x.toLowerCase().includes(term)));
    });
  }

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
  const hltbOf = g => {
    const h = state.hltb[String(g.appid)];
    return (h && h !== 'loading' && h !== null && h.main != null) ? h.main : -1;
  };
  // positive-review count = total × (pct/100); rewards popular AND well-rated games
  const popularityOf = g => {
    const r = state.reviews[String(g.appid)];
    return (r && r !== 'loading' && r !== null && r.total) ? r.total * r.pct / 100 : -1;
  };
  
  // SteamDB's algorithm: balances review percentage against the volume of reviews
  const topRatedOf = g => {
    const r = state.reviews[String(g.appid)];
    if (!r || r === 'loading' || r === null || !r.total) return -1;
    return r.pct - (r.pct - 50) * Math.pow(2, -Math.log10(r.total + 1));
  };

  const releaseDateOf = g => {
    const d = state.details[String(g.appid)];
    const dateStr = d && d !== 'loading' ? d.release_date : null;
    return dateStr ? new Date(dateStr).getTime() || 0 : 0;
  };

  const getSortVal = (g) => {
    switch (sort) {
      case 'price': return priceOf(g);
      case 'review': return reviewOf(g);
      case 'review_count': return reviewCountOf(g);
      case 'last_played': return g.rtime_last_played || 0;
      case 'release': return releaseDateOf(g);
      case 'popular': return popularityOf(g);
      case 'top_rated': return topRatedOf(g);
      case 'playtime': return getPlaytime(g);
      case 'hltb': return hltbOf(g);
      default: return 0;
    }
  };

  list.sort((a, b) => {
    if (sort === 'name') {
      const na = (a.name || '').toLowerCase();
      const nb = (b.name || '').toLowerCase();
      return sortDir === 1 ? na.localeCompare(nb) : nb.localeCompare(na);
    }
    
    if (sort === 'unplayed') {
      const ap = getPlaytime(a) > 0 ? 1 : 0;
      const bp = getPlaytime(b) > 0 ? 1 : 0;
      if (ap !== bp) {
        return sortDir === 1 ? ap - bp : bp - ap;
      }
      return priceOf(b) - priceOf(a); // secondary sort by price desc
    }

    const va = getSortVal(a);
    const vb = getSortVal(b);

    const isMissing = (v) => v === -1 || ((sort === 'last_played' || sort === 'release') && v === 0);
    const aMiss = isMissing(va);
    const bMiss = isMissing(vb);
    if (aMiss && bMiss) return 0;
    if (aMiss) return 1;
    if (bMiss) return -1;

    return sortDir === 1 ? va - vb : vb - va;
  });

  state.filtered = list;
  if (!shouldPreserve) {
    state.page = 1;
  } else {
    const maxPage = Math.ceil(state.filtered.length / PAGE_SIZE) || 1;
    if (state.page > maxPage) state.page = maxPage;
  }
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
      prices: {}, reviews: {}, hltb: {}, details: {}, page: 1,
      totalCents: 0, unplayedCents: 0, uncompletedCents: 0, pricedCount: 0,
    });
    
    // Fast preload from backend cache
    try {
      const preloadRes = await fetch(`/api/cache/preload?cc=${currency}`);
      if (preloadRes.ok) {
        const cached = await preloadRes.json();
        const libraryIds = new Set(games.map(g => String(g.appid)));
        
        Object.entries(cached.prices || {}).forEach(([id, p]) => { if (libraryIds.has(id)) state.prices[id] = p; });
        Object.entries(cached.reviews || {}).forEach(([id, r]) => { if (libraryIds.has(id)) state.reviews[id] = r; });
        Object.entries(cached.details || {}).forEach(([id, detailObj]) => { 
          if (libraryIds.has(id)) {
            state.details[id] = detailObj;
          }
        });
      }
    } catch(e) { console.error('Cache preload failed', e); }

    renderGenreDropdowns();

    elTotalValue.textContent    = formatCents(0);
    elUnplayedValue.textContent = formatCents(0);
    if (elUncompletedValue) elUncompletedValue.textContent = formatCents(0);
    if (elUncompletedTime) elUncompletedTime.textContent = '0h';

    updateTotals();

    setupSection.style.display = 'none';
    storeSection.style.display = 'block';
    clearLoading();

    applyFilterSort();

    // Kick off background loaders — prices, reviews, and HLTB for every game
    backgroundLoadAll();
    backgroundLoadReviews();
    backgroundLoadHltb();
    backgroundLoadDetails();

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
if (sortDirSelect) sortDirSelect.addEventListener('change', applyFilterSort);
if (genreFilterInput) {
  genreFilterInput.addEventListener('input', () => applyFilterSort());
}
if (tagFilterInput) {
  tagFilterInput.addEventListener('input', () => applyFilterSort());
}
if (showIgnoredCheckbox) showIgnoredCheckbox.addEventListener('change', applyFilterSort);
if (viewModeSelect) {
  viewModeSelect.addEventListener('change', () => {
    saveControls();
    renderGrid();
    renderPagination();
    updateResultsCount();
  });
}
if (searchInput) {
  searchInput.addEventListener('input', () => applyFilterSort());
}
if (cphCheckbox) {
  cphCheckbox.addEventListener('change', () => {
    saveControls();
    document.querySelectorAll('.card-price').forEach(el => {
      const appid = el.dataset.appid;
      const game = state.allGames.find(g => String(g.appid) === appid);
      renderPriceEl(el, state.prices[appid], game);
    });
  });
}

backBtn.addEventListener('click', () => {
  storeSection.style.display = 'none';
  setupSection.style.display = 'flex';
});

// ── Recommendations ───────────────────────────────
function getRecommendationScore(g) {
  let score = 0;
  const appid = String(g.appid);
  
  // Exclude completed and ignored games entirely
  if (completed.has(appid) || ignored.has(appid)) return -9999;
  
  const recLength = document.getElementById('recLength')?.value || 'any';
  const recPop = document.getElementById('recPopularity')?.value || 'any';
  const recEra = document.getElementById('recEra')?.value || 'any';
  const recVariance = document.getElementById('recVariance')?.value || 'medium';

  // Reviews: always heavily weight positive reviews
  const r = state.reviews[appid];
  if (r && r !== 'loading' && r !== null) {
    if (r.pct >= 90) score += 30;
    else if (r.pct >= 80) score += 15;
    else if (r.pct < 60) score -= 20;
    
    if (recPop === 'high') {
      if (r.total > 50000) score += 30;
      else if (r.total < 5000) score -= 20;
    } else if (recPop === 'low') {
      if (r.total < 5000) score += 30;
      else if (r.total > 50000) score -= 20;
    } else {
      if (r.total > 100000) score += 20;
      else if (r.total > 10000) score += 10;
      else if (r.total > 1000) score += 5;
    }
  }
  
  // HLTB length refinement
  const h = state.hltb[appid];
  if (h && h !== 'loading' && h !== null && h.main != null) {
    if (h.main <= 0) {
      score -= 5;
    } else if (recLength === 'short') {
      if (h.main <= 10) score += 30;
      else score -= 20;
    } else if (recLength === 'medium') {
      if (h.main > 10 && h.main <= 30) score += 30;
      else score -= 20;
    } else if (recLength === 'long') {
      if (h.main > 30) score += 30;
      else score -= 20;
    } else {
      if (h.main <= 5) score += 25;
      else if (h.main <= 12) score += 20;
      else if (h.main <= 25) score += 5;
      else score -= (h.main - 25); // Penalize very long games
    }
  } else {
    score -= 5; // Slight penalty for unknown length
  }
  
  // Era (Using AppID as a reliable proxy for release date: <400k = pre-2015, >1M = post-2019)
  const numId = parseInt(appid, 10);
  if (recEra === 'newer') {
    if (numId > 1000000) score += 20;
    else if (numId < 400000) score -= 15;
  } else if (recEra === 'older') {
    if (numId < 400000) score += 20;
    else if (numId > 1000000) score -= 15;
  }

  // Playtime: Prefer unplayed or barely played
  if (getPlaytime(g) <= 0) score += 15;
  else if (getPlaytime(g) < 120) score += 5; // Less than 2 hours
  else score -= (getPlaytime(g) / 60); // Penalize games already played a lot but not completed
  
  // Priority Genre
  const recGenre = recGenreInput ? recGenreInput.value.trim() : '';
  if (recGenre && recGenre.toLowerCase() !== 'any' && recGenre.toLowerCase() !== 'any genre') {
    const details = state.details[appid];
    if (details && details !== 'loading') {
      const terms = recGenre.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
      const matched = terms.every(term => details.genres?.some(x => x.toLowerCase().includes(term)));
      if (matched) {
        score += 50; // Massive boost for hitting the requested genre
      } else {
        score -= 50; // Huge penalty if it misses the target genre entirely
      }
    } else {
      score -= 50;
    }
  }

  // Priority Tag
  const recTag = recTagInput ? recTagInput.value.trim() : '';
  if (recTag && recTag.toLowerCase() !== 'any' && recTag.toLowerCase() !== 'any tag') {
    const details = state.details[appid];
    if (details && details !== 'loading') {
      const terms = recTag.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
      const matched = terms.every(term => details.tags?.some(x => x.toLowerCase().includes(term)));
      if (matched) {
        score += 50; // Massive boost for hitting the requested genre
      } else {
        score -= 50; // Huge penalty if it misses the target genre entirely
      }
    } else {
      score -= 50;
    }
  }

  // Random noise / variance
  let noise = 5;
  if (recVariance === 'low') noise = 1;
  else if (recVariance === 'high') noise = 40;
  score += Math.random() * noise;

  return score;
}

function generateRecommendations() {
  const candidates = state.allGames.map(g => ({ game: g, score: getRecommendationScore(g) }));
  const top = candidates.filter(c => c.score > -1000).sort((a, b) => b.score - a.score).slice(0, 6).map(c => c.game);
    
  if (recommendGrid) {
    recommendGrid.innerHTML = '';
    if (top.length === 0) {
      recommendGrid.innerHTML = '<p style="color: var(--text-dim); padding: 20px;">No recommendations available matching these criteria.</p>';
    } else {
      top.forEach(game => recommendGrid.appendChild(buildCard(game)));
      loadPricesForPage(top); // Ensure prices are fetched if they weren't visible yet
    }
  }
}

if (surpriseMeBtn) {
  surpriseMeBtn.addEventListener('click', () => {
    const candidates = state.allGames.map(g => ({ game: g, score: getRecommendationScore(g) }));
    const top = candidates.filter(c => c.score > -1000).sort((a, b) => b.score - a.score).slice(0, 10).map(c => c.game);
    if (top.length > 0) {
      const randomGame = top[Math.floor(Math.random() * top.length)];
      showGameDetails(String(randomGame.appid));
    } else {
      alert('No recommended games left to play! Time to buy more games?');
    }
  });
}

if (recommendBtn) {
  recommendBtn.addEventListener('click', () => {
    generateRecommendations();
    if (recommendModal) recommendModal.style.display = 'flex';
  });
}

if (closeRecommendBtn && recommendModal) {
  closeRecommendBtn.addEventListener('click', () => recommendModal.style.display = 'none');
  recommendModal.addEventListener('click', (e) => {
    if (e.target === recommendModal) recommendModal.style.display = 'none';
  });
}

if (closeGameDetailsBtn && gameDetailsModal) {
  closeGameDetailsBtn.addEventListener('click', () => gameDetailsModal.style.display = 'none');
  gameDetailsModal.addEventListener('click', (e) => {
    if (e.target === gameDetailsModal) gameDetailsModal.style.display = 'none';
  });
}

// Bind refine elements
['recLength', 'recPopularity', 'recEra', 'recGenre', 'recVariance'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', generateRecommendations);
});
if (recGenreInput) recGenreInput.addEventListener('input', generateRecommendations);
if (recTagInput) recTagInput.addEventListener('input', generateRecommendations);
const recRefreshBtn = document.getElementById('recRefreshBtn');
if (recRefreshBtn) recRefreshBtn.addEventListener('click', generateRecommendations);

if (exportCsvBtn) {
  exportCsvBtn.addEventListener('click', () => {
    if (!state.filtered || state.filtered.length === 0) {
      alert('No games to export!');
      return;
    }

    const headers = ['AppID', 'Name', 'Playtime (hours)', 'Price', 'Steam Score (%)', 'Time to Beat (Main)', 'Release Date', 'Status'];
    const rows = state.filtered.map(g => {
      const appid = String(g.appid);
      const name = `"${(g.name || '').replace(/"/g, '""')}"`;
      const pt = (getPlaytime(g) / 60).toFixed(1);
      const p = state.prices[appid];
      const price = p && p.final != null ? (p.final / 100).toFixed(2) : '';
      const r = state.reviews[appid];
      const score = r && r.pct != null ? r.pct : '';
      const h = state.hltb[appid];
      const hltb = h && h.main != null ? h.main : '';
      const d = state.details[appid];
      const rel = d && d.release_date ? `"${d.release_date}"` : '';
      
      let status = 'Unplayed';
      if (ignored.has(appid)) status = 'Ignored';
      else if (completed.has(appid)) status = 'Completed';
      else if (playing.has(appid)) status = 'Playing';
      else if (getPlaytime(g) > 0) status = 'Played';

      return [appid, name, pt, price, score, hltb, rel, status].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'steam_backlog.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// ── Auto-load from localStorage ───────────────────
(function init() {
  try {
    const controls = JSON.parse(localStorage.getItem('sbs_controls') || '{}');
    if (controls.filter && filterSelect) filterSelect.value = controls.filter;
    
    // Migration logic for old sort values
    const oldToNewSort = {
      unplayed_first: { sort: 'unplayed', dir: 'asc' },
      price_desc: { sort: 'price', dir: 'desc' },
      price_asc: { sort: 'price', dir: 'asc' },
      review_desc: { sort: 'review', dir: 'desc' },
      most_reviews: { sort: 'review_count', dir: 'desc' },
      recent_played: { sort: 'last_played', dir: 'desc' },
      oldest_played: { sort: 'last_played', dir: 'asc' },
      release_new: { sort: 'release', dir: 'desc' },
      release_old: { sort: 'release', dir: 'asc' },
      popular: { sort: 'popular', dir: 'desc' },
      top_rated: { sort: 'top_rated', dir: 'desc' },
      playtime_desc: { sort: 'playtime', dir: 'desc' },
      playtime_asc: { sort: 'playtime', dir: 'asc' },
      hltb_asc: { sort: 'hltb', dir: 'asc' },
      hltb_desc: { sort: 'hltb', dir: 'desc' },
      name_asc: { sort: 'name', dir: 'asc' },
      name_desc: { sort: 'name', dir: 'desc' }
    };
    
    if (controls.sort) {
      if (oldToNewSort[controls.sort]) {
        if (sortSelect) sortSelect.value = oldToNewSort[controls.sort].sort;
        if (sortDirSelect) sortDirSelect.value = oldToNewSort[controls.sort].dir;
      } else {
        if (sortSelect) sortSelect.value = controls.sort;
        if (controls.sortDir && sortDirSelect) sortDirSelect.value = controls.sortDir;
      }
    }
    
    if (controls.viewMode && viewModeSelect) viewModeSelect.value = controls.viewMode;
    if (controls.showIgnored !== undefined && showIgnoredCheckbox) showIgnoredCheckbox.checked = controls.showIgnored;
    if (controls.cph !== undefined && cphCheckbox) cphCheckbox.checked = controls.cph;
    if (controls.genre && genreFilterInput) genreFilterInput.value = controls.genre;
    if (controls.tag && tagFilterInput) tagFilterInput.value = controls.tag;
    if (controls.search !== undefined && searchInput) searchInput.value = controls.search;
  } catch (_) {}

  const saved = loadProfile();
  if (!saved) return;
  document.getElementById('steamInput').value     = saved.steamInput || '';
  document.getElementById('apiKeyInput').value    = saved.apiKey    || '';
  document.getElementById('currencySelect').value = saved.currency  || 'us';
  if (saved.steamInput && saved.apiKey) {
    submitLoad(saved.steamInput, saved.apiKey, saved.currency || 'us');
  }
})();

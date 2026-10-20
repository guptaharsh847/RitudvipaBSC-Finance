// Backend client: POST {action, token, payload} as text/plain (no CORS preflight).
// Read actions are cached in localStorage so the app can show last-loaded data offline.
const Api = (() => {
  const TOKEN_KEY = 'rbf_token';
  const USER_KEY = 'rbf_user';
  const CACHE_PREFIX = 'rbf_c:';
  const READ_ACTIONS = new Set(['listMonths', 'getMonth', 'listEvents', 'getEvent', 'getCategories', 'getDashboard', 'listUsers']);
  const listeners = { offline: [], authLost: [], updated: [] };
  const REVALIDATE_AFTER_MS = 15000; // cache younger than this is used without re-checking
  const inflight = new Map();
  let offline = false;
  let lastCachedAt = 0;
  let fresh = false;
  let lastWriteAt = 0;
  try { lastWriteAt = Number(localStorage.getItem('rbf_last_write')) || 0; } catch { /* ignore */ }

  class ApiError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  const getToken = () => sessionStorage.getItem(TOKEN_KEY) || '';
  const getUser = () => { try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch { return null; } };
  function setSession(token, user) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    try { localStorage.setItem('rbf_last_user', JSON.stringify(user)); } catch { /* ignore */ }
  }
  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }
  function clearCache() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
      localStorage.removeItem('rbf_last_user');
    } catch { /* ignore */ }
  }
  const hasCache = () => { try { return Object.keys(localStorage).some(k => k.startsWith(CACHE_PREFIX)); } catch { return false; } };
  const lastUser = () => { try { return JSON.parse(localStorage.getItem('rbf_last_user') || 'null'); } catch { return null; } };

  function setOffline(v) {
    if (offline === v) return;
    offline = v;
    listeners.offline.forEach(fn => fn(v));
  }

  function cacheKey(action, payload) { return CACHE_PREFIX + action + ':' + JSON.stringify(payload || {}); }
  function readCache(action, payload) {
    try { const c = localStorage.getItem(cacheKey(action, payload)); return c ? JSON.parse(c) : null; } catch { return null; }
  }
  function writeCache(action, payload, data) {
    try { localStorage.setItem(cacheKey(action, payload), JSON.stringify({ t: Date.now(), data })); }
    catch { /* quota exceeded — offline cache is best effort */ }
  }

  /**
   * Reads are "stale-while-revalidate": saved data is returned instantly and a background request
   * checks the sheet; if anything changed, the cache is updated and onUpdated listeners fire.
   * After this device saves a change, older cache entries are skipped (network first) so you
   * never see your own edit missing. The Refresh button (setFresh) bypasses every cache.
   */
  async function call(action, payload = {}, opts = {}) {
    const cfg = window.APP_CONFIG;
    const isRead = READ_ACTIONS.has(action);
    if (!cfg.API_URL || cfg.API_URL.includes('PASTE_YOUR')) {
      throw new ApiError('CONFIG', 'Backend URL not set. Edit js/config.js → API_URL.');
    }
    if (isRead && !fresh && !opts.noCache) {
      const c = readCache(action, payload);
      if (c && c.t > lastWriteAt) {
        if (Date.now() - c.t > REVALIDATE_AFTER_MS) revalidate(action, payload, c);
        return c.data;
      }
    }
    try {
      const data = await network(action, payload, isRead);
      if (!isRead && action !== 'login' && action !== 'logout') {
        lastWriteAt = Date.now();
        try { localStorage.setItem('rbf_last_write', String(lastWriteAt)); } catch { /* ignore */ }
      }
      return data;
    } catch (e) {
      if (e.code === 'OFFLINE' && isRead && !opts.noCache) {
        const c = readCache(action, payload);
        if (c) { lastCachedAt = c.t; return c.data; }
      }
      throw e;
    }
  }

  function revalidate(action, payload, cached) {
    const key = cacheKey(action, payload);
    if (inflight.has(key)) return;
    const p = network(action, payload, true)
      .then(data => {
        if (JSON.stringify(data) !== JSON.stringify(cached.data)) listeners.updated.forEach(fn => fn(action, payload));
      })
      .catch(() => { /* offline or session issue: keep showing saved data */ })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }

  async function network(action, payload, isRead) {
    const cfg = window.APP_CONFIG;
    // "fresh" also tells the server to skip its own short-lived cache.
    const sent = isRead && fresh ? Object.assign({}, payload, { fresh: true }) : payload;
    const body = JSON.stringify({ action, token: getToken(), payload: sent });
    let res;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.REQUEST_TIMEOUT_MS || 45000);
    try {
      const r = await fetch(cfg.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body, redirect: 'follow', signal: ctrl.signal
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      res = await r.json();
    } catch (e) {
      setOffline(!navigator.onLine || e.name === 'TypeError' || e.name === 'AbortError' || isRead);
      throw new ApiError('OFFLINE', isRead ? 'You are offline and this page has not been loaded before.' : 'You are offline — changes cannot be saved right now.');
    } finally {
      clearTimeout(timer);
    }
    setOffline(false);
    if (!res || !res.ok) {
      const code = (res && res.code) || 'SERVER';
      if (code === 'AUTH') { clearSession(); listeners.authLost.forEach(fn => fn()); }
      throw new ApiError(code, (res && res.error) || 'Something went wrong');
    }
    if (isRead) writeCache(action, payload, res.data);
    return res.data;
  }

  async function login(name, pin) {
    const data = await call('login', { name, pin });
    setSession(data.token, data.user);
    return data.user;
  }

  async function logout() {
    try { await call('logout', {}); } catch { /* ignore */ }
    clearSession();
    clearCache();
  }

  return {
    call, login, logout, getToken, getUser, clearSession, hasCache, lastUser, ApiError,
    isOffline: () => offline,
    lastCachedAt: () => lastCachedAt,
    onOffline: fn => listeners.offline.push(fn),
    onAuthLost: fn => listeners.authLost.push(fn),
    onUpdated: fn => listeners.updated.push(fn),
    setFresh: v => { fresh = !!v; },
    /** Read-only offline mode: use cached data under the last user who logged in on this device. */
    enterOfflineMode() {
      const u = lastUser();
      if (!u) return null;
      sessionStorage.setItem(USER_KEY, JSON.stringify(u));
      setOffline(true);
      return u;
    }
  };
})();

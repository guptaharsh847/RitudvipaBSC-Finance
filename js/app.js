// Core: utilities (UI), editable table component, router, login, settings.

/* ───────────────────────────── Utilities ───────────────────────────── */
const UI = (() => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  const esc = s => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = v => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[₹,\s]/g, '')); return isFinite(n) ? n : 0; };
  const round2 = n => Math.round(n * 100) / 100;
  /** ₹1,23,456 (en-IN grouping). Negative → −₹1,234. */
  const inr = (v, opts = {}) => {
    const n = round2(num(v));
    const s = '₹' + inrFmt.format(Math.abs(n));
    if (n < 0) return '−' + s;
    return opts.sign && n > 0 ? '+' + s : s;
  };
  const fmtDate = ymd => {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd || '—';
    const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  };
  const monthLabel = ym => {
    if (!ym) return '';
    const [y, m] = ym.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  };
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDate(new Date());
  const relTime = iso => {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' d ago';
    return fmtDate(isoDate(new Date(iso)));
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const spinner = (text = 'Loading…') => `<div class="loading"><span class="spinner"></span><span>${esc(text)}</span></div>`;

  function toast(msg, type = 'info', ms = 3200) {
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
  }

  /** Error toast for API failures (auth errors redirect to login elsewhere). */
  function fail(e) {
    if (e && e.code === 'AUTH') return;
    toast((e && e.message) || 'Something went wrong', 'error', 4500);
  }

  /**
   * Modal form. body = HTML containing named inputs. onSubmit(values, form) may return a Promise;
   * throwing keeps the modal open. Resolves to onSubmit's result, or null if cancelled.
   */
  function modal({ title, body, submitLabel = 'Save', danger = false, onSubmit, wide = false }) {
    return new Promise(resolve => {
      const root = document.getElementById('modal-root');
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `
        <form class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate>
          <header class="modal-head"><h2>${esc(title)}</h2>
            <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
          <div class="modal-body">${body}</div>
          <footer class="modal-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            ${onSubmit ? `<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitLabel)}</button>` : ''}
          </footer>
        </form>`;
      root.appendChild(wrap);
      const form = wrap.querySelector('form');
      const prevFocus = document.activeElement;
      const close = result => {
        wrap.classList.remove('show');
        document.removeEventListener('keydown', onKey);
        setTimeout(() => wrap.remove(), 200);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(result);
      };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
      wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => close(null)));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!onSubmit) return close(true);
        const btn = form.querySelector('[type=submit]');
        const values = {};
        new FormData(form).forEach((v, k) => { values[k] = typeof v === 'string' ? v.trim() : v; });
        form.querySelectorAll('input[type=checkbox][name]').forEach(cb => { values[cb.name] = cb.checked; });
        try {
          setBusy(btn, true);
          const r = await onSubmit(values, form);
          close(r === undefined ? true : r);
        } catch (err) {
          setBusy(btn, false);
          const msg = form.querySelector('.form-error');
          if (msg) { msg.textContent = err.message; msg.hidden = false; } else fail(err);
        }
      });
      requestAnimationFrame(() => {
        wrap.classList.add('show');
        const first = form.querySelector('.modal-body input:not([type=hidden]):not([type=radio]):not([type=checkbox]), .modal-body select, .modal-body textarea');
        if (first) first.focus();
      });
    });
  }

  function confirm(message, { okLabel = 'Delete', title = 'Are you sure?', danger = true } = {}) {
    return modal({ title, body: `<p class="confirm-msg">${esc(message)}</p>`, submitLabel: okLabel, danger, onSubmit: () => true })
      .then(r => r === true);
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner spinner-sm"></span>';
    } else if (btn.dataset.label !== undefined) {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.label;
      delete btn.dataset.label;
    }
  }

  /** Run an async action with the button showing a spinner. */
  async function busy(btn, fn) {
    setBusy(btn, true);
    try { return await fn(); } finally { setBusy(btn, false); }
  }

  const auditTitle = r => {
    if (!r || !r.CreatedBy) return '';
    let t = `Added by ${r.CreatedBy}${r.CreatedAt ? ' · ' + relTime(r.CreatedAt) : ''}`;
    if (r.UpdatedBy && r.UpdatedAt && r.UpdatedAt !== r.CreatedAt) t += `\nEdited by ${r.UpdatedBy} · ${relTime(r.UpdatedAt)}`;
    return t;
  };

  const options = (list, selected, { blank = true } = {}) => {
    const items = list.slice();
    if (selected && !items.includes(selected)) items.push(selected);
    return (blank ? '<option value="">—</option>' : '') +
      items.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
  };

  return { MONTHS, esc, num, round2, inr, fmtDate, monthLabel, isoDate, today, relTime, debounce, spinner, toast, fail, modal, confirm, setBusy, busy, auditTitle, options };
})();

/* ───────────────────────────── Editable table ───────────────────────────── */
/**
 * Inline add/edit/delete table. On phones rows render as cards (see .et in CSS).
 * opts: columns [{key,label,type:'text'|'money'|'number'|'date'|'select'|'list'|'textarea',options:()=>[],required,format}],
 *       rows, idKey, addLabel, emptyText, newDefaults(lastSaved), onSave(values, original) → saved row,
 *       onDelete(row), onChange(rows), totalKey, readOnly
 */
class EditableTable {
  constructor(el, opts) {
    this.el = el;
    this.o = opts;
    this.rows = (opts.rows || []).slice();
    this.editing = null;
    this.lastSaved = null;
    this.uid = 'et' + Math.random().toString(36).slice(2, 8);
    el.classList.add('et-host');
    el.addEventListener('click', e => this.onClick(e));
    el.addEventListener('keydown', e => this.onKey(e));
    this.render();
  }

  id(r) { return r[this.o.idKey]; }

  setRows(rows) { this.rows = rows.slice(); this.editing = null; this.render(); }

  display(c, r) {
    const v = r[c.key];
    if (c.format) return c.format(v, r);
    if (c.type === 'money') return UI.inr(v);
    if (c.type === 'date') return v ? UI.fmtDate(v) : '—';
    return UI.esc(v === '' || v === undefined || v === null ? '—' : v);
  }

  input(c, r) {
    const v = r[c.key] ?? '';
    const common = `data-k="${c.key}" aria-label="${UI.esc(c.label)}"${c.required ? ' required' : ''}`;
    switch (c.type) {
      case 'money':
      case 'number':
        return `<input type="number" inputmode="decimal" step="any" ${common} value="${UI.esc(v)}" placeholder="${c.type === 'money' ? '₹' : ''}">`;
      case 'date':
        return `<input type="date" ${common} value="${UI.esc(v)}">`;
      case 'select':
        return `<select ${common}>${UI.options(c.options(), v, { blank: !c.noBlank })}</select>`;
      case 'list':
        return `<input type="text" list="${this.uid}-${c.key}" ${common} value="${UI.esc(v)}" autocomplete="off" placeholder="${UI.esc(c.placeholder || '')}">`;
      case 'textarea':
        return `<textarea rows="1" ${common}>${UI.esc(v)}</textarea>`;
      default:
        return `<input type="text" ${common} value="${UI.esc(v)}" placeholder="${UI.esc(c.placeholder || '')}">`;
    }
  }

  viewRow(r) {
    const cols = this.o.columns;
    return `<tr data-id="${UI.esc(this.id(r))}" title="${UI.esc(UI.auditTitle(r))}">
      ${cols.map(c => `<td data-label="${UI.esc(c.label)}" class="${c.type === 'money' || c.type === 'number' ? 'num' : ''} ${c.cls || ''}">${this.display(c, r)}</td>`).join('')}
      <td class="et-act">${this.o.readOnly ? '' : `
        <button type="button" class="icon-btn" data-et="edit" aria-label="Edit">✎</button>
        <button type="button" class="icon-btn icon-danger" data-et="del" aria-label="Delete">🗑</button>`}
        ${r.CreatedBy ? `<span class="et-who">${UI.esc(r.UpdatedBy || r.CreatedBy)}</span>` : ''}</td>
    </tr>`;
  }

  editRow(r, isNew) {
    const cols = this.o.columns;
    return `<tr class="et-editing" data-id="${isNew ? '__new' : UI.esc(this.id(r))}">
      ${cols.map(c => `<td data-label="${UI.esc(c.label)}" class="${c.type === 'money' || c.type === 'number' ? 'num' : ''}">${this.input(c, r)}</td>`).join('')}
      <td class="et-act">
        <button type="button" class="btn btn-primary btn-sm" data-et="save">Save</button>
        <button type="button" class="btn btn-ghost btn-sm" data-et="cancel">Cancel</button>
      </td></tr>`;
  }

  render() {
    const o = this.o, cols = o.columns;
    const lists = cols.filter(c => c.type === 'list').map(c =>
      `<datalist id="${this.uid}-${c.key}">${(c.options ? c.options() : []).map(v => `<option value="${UI.esc(v)}">`).join('')}</datalist>`).join('');
    let body = '';
    if (!this.rows.length && this.editing !== '__new') {
      body = `<tr class="et-empty"><td colspan="${cols.length + 1}">${UI.esc(o.emptyText || 'No entries yet')}</td></tr>`;
    }
    this.rows.forEach(r => { body += this.id(r) === this.editing ? this.editRow(r) : this.viewRow(r); });
    if (this.editing === '__new') body += this.editRow(o.newDefaults ? o.newDefaults(this.lastSaved) : {}, true);
    let foot = '';
    if (o.totalKey && this.rows.length) {
      const total = this.rows.reduce((s, r) => s + UI.num(r[o.totalKey]), 0);
      foot = `<tfoot><tr>${cols.map((c, i) => {
        if (c.key === o.totalKey) return `<td class="num" data-label="Total">${UI.inr(total)}</td>`;
        return i === 0 ? `<td class="et-total-label">Total (${this.rows.length})</td>` : '<td class="et-pad"></td>';
      }).join('')}<td class="et-pad"></td></tr></tfoot>`;
    }
    this.el.innerHTML = `${lists}<div class="et-wrap"><table class="et">
      <thead><tr>${cols.map(c => `<th class="${c.type === 'money' || c.type === 'number' ? 'num' : ''}">${UI.esc(c.label)}</th>`).join('')}<th class="et-act"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${body}</tbody>${foot}</table></div>
      ${o.readOnly || this.editing === '__new' ? '' : `<button type="button" class="btn btn-add" data-et="add">＋ ${UI.esc(o.addLabel || 'Add row')}</button>`}`;
    const editRow = this.el.querySelector('.et-editing');
    if (editRow) {
      const first = editRow.querySelector('input, select');
      if (first) first.focus({ preventScroll: true });
      // Bring the whole row (including Save/Cancel) into view, clear of the fixed nav.
      editRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  collect(tr) {
    const vals = {};
    let firstBad = null;
    tr.querySelectorAll('[data-k]').forEach(inp => {
      const c = this.o.columns.find(x => x.key === inp.dataset.k);
      let v = inp.value.trim();
      inp.classList.remove('invalid');
      if (c.required && v === '') { inp.classList.add('invalid'); firstBad = firstBad || inp; }
      if ((c.type === 'money' || c.type === 'number') && v !== '' && !isFinite(Number(v))) { inp.classList.add('invalid'); firstBad = firstBad || inp; }
      vals[c.key] = v;
    });
    if (firstBad) { firstBad.focus(); UI.toast('Please fill the highlighted field', 'error'); return null; }
    return vals;
  }

  async save(tr, btn) {
    const vals = this.collect(tr);
    if (!vals) return;
    const isNew = tr.dataset.id === '__new';
    const original = isNew ? null : this.rows.find(r => String(this.id(r)) === tr.dataset.id);
    try {
      const saved = await UI.busy(btn, () => this.o.onSave(vals, original));
      if (isNew) {
        this.rows.push(saved);
        this.lastSaved = saved;
        this.editing = '__new'; // keep the add row open for quick entry
      } else {
        this.rows = this.rows.map(r => (r === original ? saved : r));
        this.editing = null;
      }
      this.render();
      UI.toast(isNew ? 'Added' : 'Saved', 'success', 1500);
      this.o.onChange && this.o.onChange(this.rows);
    } catch (e) { UI.fail(e); }
  }

  async onClick(e) {
    const btn = e.target.closest('[data-et]');
    if (!btn) return;
    const act = btn.dataset.et;
    const tr = btn.closest('tr');
    if (act === 'add') { this.editing = '__new'; this.render(); }
    else if (act === 'cancel') { this.editing = null; this.render(); }
    else if (act === 'edit') { this.editing = this.rows.find(r => String(this.id(r)) === tr.dataset.id) ? tr.dataset.id : null; this.render(); }
    else if (act === 'save') { this.save(tr, btn); }
    else if (act === 'del') {
      const row = this.rows.find(r => String(this.id(r)) === tr.dataset.id);
      if (!row) return;
      const label = this.o.describe ? this.o.describe(row) : 'this entry';
      if (!(await UI.confirm(`Delete ${label}?`))) return;
      try {
        await UI.busy(btn, () => this.o.onDelete(row));
        this.rows = this.rows.filter(r => r !== row);
        this.render();
        UI.toast('Deleted', 'success', 1500);
        this.o.onChange && this.o.onChange(this.rows);
      } catch (err) { UI.fail(err); }
    }
  }

  onKey(e) {
    const tr = e.target.closest('tr.et-editing');
    if (!tr) return;
    if (e.key === 'Escape') { e.preventDefault(); this.editing = null; this.render(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      this.save(tr, tr.querySelector('[data-et=save]'));
    }
  }
}

/* ───────────────────────────── App shell & router ───────────────────────────── */
const App = (() => {
  const state = { user: null, categories: [], view: null };
  let installPrompt = null;   // Android "Add to home screen" prompt
  let lastShown = Date.now();
  // Re-render the current page; its reads return cache instantly and revalidate in the background.
  const onDataUpdatedCheck = () => route({ keepScroll: true, silent: true });
  const cfg = window.APP_CONFIG;
  const NAV = [
    { id: 'dashboard', label: 'Dashboard', icon: '◔' },
    { id: 'months', label: 'BSC Months', icon: '₹' },
    { id: 'preaching', label: 'Preaching', icon: '❀' },
    { id: 'export', label: 'Export', icon: '⇩' },
    { id: 'settings', label: 'Settings', icon: '⚙', admin: true }
  ];

  /* Theme */
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = dark ? '#1c1214' : '#8c1d40';
    document.dispatchEvent(new CustomEvent('themechange'));
  }
  function toggleTheme() {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('rbf_theme', next); } catch { /* ignore */ }
    applyTheme(next);
  }

  /* Categories */
  async function loadCategories() {
    try { state.categories = await Api.call('getCategories'); } catch (e) { if (e.code !== 'AUTH') state.categories = state.categories || []; }
  }
  const cats = (type, module) => state.categories
    .filter(c => c.Type === type && (!module || c.Module === module) && c.Active)
    .map(c => c.Name);

  /* Shell */
  function renderShell() {
    const u = state.user;
    document.getElementById('app').innerHTML = `
      <header class="topbar">
        <a class="brand" href="#/dashboard"><img class="brand-logo" src="assets/header-logo.png" alt="Ritudwip BSC" width="44" height="36"><span class="brand-name"><span class="name-full">${UI.esc(cfg.APP_NAME)}</span><span class="name-short">BSC Finance</span></span></a>
        <span id="offline-badge" class="badge badge-warn" hidden>Offline</span>
        <div class="topbar-actions">
          <button class="btn btn-ghost btn-sm" id="install-btn" hidden title="Install on this phone">Install</button>
          <button class="icon-btn" id="refresh-btn" aria-label="Refresh data" title="Refresh data from the sheet"><span class="refresh-icon">↻</span></button>
          <button class="icon-btn" id="theme-btn" aria-label="Toggle dark mode" title="Light / dark">◐</button>
          <div class="user-chip" title="${UI.esc(u.Name)} · ${UI.esc(u.Role)}"><span class="avatar">${UI.esc((u.Name || '?')[0].toUpperCase())}</span><span class="user-name">${UI.esc(u.Name)}</span></div>
          <button class="btn btn-ghost btn-sm" id="logout-btn" aria-label="Log out" title="Log out"><svg class="logout-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg><span class="logout-text">Log out</span></button>
        </div>
      </header>
      <nav class="nav" aria-label="Main">
        ${NAV.filter(n => !n.admin || u.Role === 'ADMIN').map(n => `
          <a href="#/${n.id}" data-nav="${n.id}"><span class="nav-icon" aria-hidden="true">${n.icon}</span><span>${n.label}</span></a>`).join('')}
      </nav>
      <main id="view" tabindex="-1"></main>`;
    document.getElementById('theme-btn').onclick = toggleTheme;
    document.getElementById('refresh-btn').onclick = () => refresh();
    const ib = document.getElementById('install-btn');
    ib.hidden = !installPrompt;
    ib.onclick = async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      ib.hidden = true;
    };
    document.getElementById('logout-btn').onclick = async () => {
      await Api.logout();
      state.user = null;
      location.hash = '';
      renderLogin();
    };
    setOfflineBadge(Api.isOffline());
  }

  function setOfflineBadge(off) {
    const b = document.getElementById('offline-badge');
    if (b) b.hidden = !off;
  }

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { name: parts[0] || 'dashboard', id: parts[1] ? decodeURIComponent(parts[1]) : '' };
  }

  /** Re-fetch everything for the current page straight from the sheet (bypasses all caches). */
  async function refresh() {
    const btn = document.getElementById('refresh-btn');
    if (btn) { btn.classList.add('spinning'); btn.classList.remove('has-update'); }
    Api.setFresh(true);
    try {
      await loadCategories();
      await route({ keepScroll: true });   // current page first, straight from the sheet
    } finally {
      Api.setFresh(false);
    }
    try {
      await preloadAll(true);               // then everything else, so all pages are up to date
      if (!Api.isOffline()) UI.toast('All data refreshed', 'success', 1800);
    } catch (e) { UI.fail(e); }
    finally { if (btn) btn.classList.remove('spinning'); }
  }

  // Background revalidation found newer data: re-render quietly unless the user is mid-edit.
  const onDataUpdated = UI.debounce(() => {
    if (!state.user) return;
    const busy = document.querySelector('.et-editing, .modal-backdrop, #details-form [type=submit]:not([disabled])') ||
      (document.activeElement && document.activeElement.closest && document.activeElement.closest('#view input, #view textarea, #view select'));
    if (busy) {
      const btn = document.getElementById('refresh-btn');
      if (btn) btn.classList.add('has-update'); // the user can tap Refresh when ready
      return;
    }
    route({ keepScroll: true, silent: true });
  }, 400);

  /**
   * Download everything (lists, dashboard, every month and event) and save it on the device,
   * so every page opens instantly and works offline. fresh=true skips all caches (login / Refresh).
   */
  let preloading = null;
  function preloadAll(fresh) {
    if (preloading) return preloading;
    const opts = { fresh };
    const now = new Date();
    const from = UI.isoDate(new Date(now.getFullYear(), now.getMonth() - 2, 1));
    const run = async () => {
      const [months, events] = await Promise.all([
        Api.call('listMonths', {}, opts), Api.call('listEvents', {}, opts),
        Api.call('getCategories', {}, opts), Api.call('getDashboard', { from, to: UI.today() }, opts)
      ]);
      const jobs = months.map(m => () => Api.call('getMonth', { MonthID: m.MonthID }, opts))
        .concat(events.map(e => () => Api.call('getEvent', { EventID: e.EventID }, opts)));
      // A few at a time so Apps Script isn't flooded.
      const workers = Array.from({ length: 4 }, async () => { while (jobs.length) await jobs.shift()().catch(() => {}); });
      await Promise.all(workers);
      return months.length + events.length;
    };
    preloading = run().finally(() => { preloading = null; });
    return preloading;
  }

  async function route(opts = {}) {
    if (!state.user) return;
    const { name, id } = parseHash();
    const view = document.getElementById('view');
    if (!view) return;
    document.querySelectorAll('[data-nav]').forEach(a => {
      const active = a.dataset.nav === name || (name === 'month' && a.dataset.nav === 'months') || (name === 'event' && a.dataset.nav === 'preaching');
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    // Each route renders into a fresh container so late responses from a previous page are harmless.
    const el = document.createElement('div');
    el.className = 'page';
    const scrollY = window.scrollY;
    if (opts.silent) {
      // Render off-screen, then swap in, so a background update doesn't flash a spinner.
      el.hidden = true;
      view.appendChild(el);
    } else {
      view.replaceChildren(el);
      if (!opts.keepScroll) window.scrollTo(0, 0);
    }
    try {
      switch (name) {
        case 'dashboard': await Dashboard.render(el); break;
        case 'months': await BscMonths.renderList(el); break;
        case 'month': await BscMonths.renderDetail(el, id); break;
        case 'preaching': await Preaching.renderList(el); break;
        case 'event': await Preaching.renderDetail(el, id); break;
        case 'export': await Exporter.render(el); break;
        case 'settings':
          if (state.user.Role !== 'ADMIN') { location.hash = '#/dashboard'; return; }
          await Settings.render(el); break;
        default: location.hash = '#/dashboard';
      }
      if (opts.silent && el.isConnected) {
        // Silent render finished: swap in place, keeping the scroll position.
        [...view.children].forEach(c => { if (c !== el) c.remove(); });
        el.hidden = false;
        window.scrollTo(0, scrollY);
      } else if (opts.keepScroll) window.scrollTo(0, scrollY);
    } catch (e) {
      if (opts.silent) { el.remove(); return; }
      el.innerHTML = `<div class="empty-state"><p>${UI.esc(e.message || 'Could not load this page')}</p>
        <button class="btn btn-primary" onclick="App.route()">Try again</button></div>`;
      UI.fail(e);
    }
  }

  /* Login */
  function renderLogin(message) {
    const canOffline = Api.hasCache() && Api.lastUser();
    document.getElementById('app').innerHTML = `
      <div class="login-wrap">
        <form class="login-card" id="login-form" autocomplete="on">
          <div class="login-brand"><img class="login-logo" src="assets/main-logo.png" alt="BSC Ritudvipa — A home away from home" width="420" height="385">
            <h1>${UI.esc(cfg.APP_NAME)}</h1><p class="muted">Hare Krishna! Please sign in.</p></div>
          <label class="field"><span>Name</span><input name="name" autocomplete="username" required autocapitalize="words"></label>
          <label class="field"><span>PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" required minlength="4" maxlength="8"></label>
          <p class="form-error" ${message ? '' : 'hidden'}>${UI.esc(message || '')}</p>
          <button class="btn btn-primary btn-block" type="submit">Sign in</button>
          ${canOffline ? `<button class="btn btn-ghost btn-block" type="button" id="offline-btn">View saved data offline (read-only)</button>` : ''}
        </form>
      </div>`;
    const form = document.getElementById('login-form');
    form.elements.namedItem("name").focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const err = form.querySelector('.form-error');
      err.hidden = true;
      const btn = form.querySelector('[type=submit]');
      try {
        const user = await UI.busy(btn, () => Api.login(form.elements.namedItem("name").value.trim(), form.elements.namedItem("pin").value.trim()));
        await start(user, true);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        form.elements.namedItem("pin").value = "";
        form.elements.namedItem("pin").focus();
      }
    });
    const ob = document.getElementById('offline-btn');
    if (ob) ob.onclick = () => { const u = Api.enterOfflineMode(); if (u) start(u); };
  }

  async function start(user, fromLogin) {
    state.user = user;
    renderShell();
    if (fromLogin) {
      // Fresh login: load the latest data from the sheet into the device cache.
      const btn = document.getElementById('refresh-btn');
      if (btn) btn.classList.add('spinning');
      Api.setFresh(true);
      try { await loadCategories(); } finally { Api.setFresh(false); }
      preloadAll(true)
        .then(n => UI.toast(`All data loaded (${n} months & events) — pages now open instantly`, 'success', 2500))
        .catch(() => {})
        .finally(() => { if (btn) btn.classList.remove('spinning'); });
    }
    // Categories come from cache instantly if present; don't block the first page on the network.
    const cats = loadCategories();
    if (!state.categories.length) await cats;
    if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/dashboard';
    else route();
    if (!fromLogin) setTimeout(() => preloadAll(false).catch(() => {}), 800); // resume: top up the cache quietly
  }

  function init() {
    let t = '';
    try { t = localStorage.getItem('rbf_theme') || ''; } catch { /* ignore */ }
    applyTheme(t);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!document.documentElement.dataset.theme) applyTheme('');
    });
    window.addEventListener('hashchange', route);
    Api.onOffline(setOfflineBadge);
    Api.onUpdated(onDataUpdated);
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      installPrompt = e;
      const ib = document.getElementById('install-btn');
      if (ib) ib.hidden = false;
    });
    // Coming back to the app after a while: check for changes made by others.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.user && Date.now() - lastShown > 60000) onDataUpdatedCheck();
      if (document.visibilityState === 'hidden') lastShown = Date.now();
    });
    Api.onAuthLost(() => { state.user = null; renderLogin('Your session has expired. Please sign in again.'); });
    window.addEventListener('online', () => { setOfflineBadge(false); UI.toast('Back online', 'success'); });
    window.addEventListener('offline', () => setOfflineBadge(true));
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
    }
    const user = Api.getUser();
    if (user && (Api.getToken() || Api.isOffline())) start(user); else renderLogin();
  }

  return {
    state, init, route, refresh, cats, loadCategories,
    get user() { return state.user; },
    isAdmin: () => state.user && state.user.Role === 'ADMIN',
    go: hash => { location.hash = hash; }
  };
})();

/* ───────────────────────────── Settings (ADMIN) ───────────────────────────── */
const Settings = (() => {
  const TYPES = [
    { module: 'BSC', type: 'INCOME_PURPOSE', label: 'BSC income purposes' },
    { module: 'BSC', type: 'EXPENSE_PURPOSE', label: 'BSC expense purposes' },
    { module: 'PREACHING', type: 'ITEM', label: 'Preaching items' }
  ];

  async function render(el) {
    el.innerHTML = UI.spinner();
    const [users] = await Promise.all([Api.call('listUsers'), App.loadCategories()]);
    el.innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>
      <section class="card">
        <div class="card-head"><h2>Users</h2><button class="btn btn-primary btn-sm" id="add-user">＋ Add user</button></div>
        <ul class="list" id="user-list"></ul>
      </section>
      <section class="card">
        <div class="card-head"><h2>Categories</h2></div>
        <p class="muted small">These lists feed the Purpose / Item dropdowns. Disabled entries stay on old rows but are hidden from new entries.</p>
        <div class="cat-grid" id="cat-grid"></div>
      </section>`;
    renderUsers(el, users);
    renderCats(el);
    el.querySelector('#add-user').onclick = () => editUser(el, null);
  }

  function renderUsers(el, users) {
    el._users = users;
    el.querySelector('#user-list').innerHTML = users.map(u => `
      <li class="list-row">
        <span class="avatar">${UI.esc(u.Name[0].toUpperCase())}</span>
        <div class="grow"><strong>${UI.esc(u.Name)}</strong>
          <div class="muted small">${u.Role}${u.Active ? '' : ' · disabled'}</div></div>
        <span class="badge ${u.Active ? 'badge-ok' : 'badge-muted'}">${u.Active ? 'Active' : 'Disabled'}</span>
        <button class="btn btn-ghost btn-sm" data-user="${UI.esc(u.UserID)}">Edit</button>
      </li>`).join('');
    el.querySelectorAll('[data-user]').forEach(b => {
      b.onclick = () => editUser(el, users.find(u => u.UserID === b.dataset.user));
    });
  }

  async function editUser(el, u) {
    const res = await UI.modal({
      title: u ? 'Edit user' : 'Add user',
      body: `
        <label class="field"><span>Name</span><input name="Name" required value="${UI.esc(u ? u.Name : '')}"></label>
        <label class="field"><span>Role</span><select name="Role">
          <option value="EDITOR"${u && u.Role === 'EDITOR' ? ' selected' : ''}>EDITOR — can add and edit entries</option>
          <option value="ADMIN"${u && u.Role === 'ADMIN' ? ' selected' : ''}>ADMIN — also manages users and categories</option></select></label>
        <label class="field"><span>${u ? 'New PIN (leave blank to keep)' : 'PIN (4–8 digits)'}</span>
          <input name="Pin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" autocomplete="new-password"></label>
        <label class="check"><input type="checkbox" name="Active" ${!u || u.Active ? 'checked' : ''}> Active (can log in)</label>
        <p class="form-error" hidden></p>`,
      onSubmit: v => {
        if (!v.Name) throw new Error('Name is required');
        if (v.Pin && !/^\d{4,8}$/.test(v.Pin)) throw new Error('PIN must be 4–8 digits');
        if (!u && !v.Pin) throw new Error('A PIN is required for a new user');
        return Api.call('saveUser', { UserID: u ? u.UserID : '', Name: v.Name, Role: v.Role, Pin: v.Pin, Active: v.Active });
      }
    });
    if (res) {
      UI.toast('User saved', 'success');
      renderUsers(el, await Api.call('listUsers'));
    }
  }

  function renderCats(el) {
    const all = App.state.categories;
    el.querySelector('#cat-grid').innerHTML = TYPES.map(t => {
      const rows = all.filter(c => c.Module === t.module && c.Type === t.type);
      return `<div class="cat-col">
        <h3>${t.label}</h3>
        <ul class="chip-list">${rows.map(c => `
          <li class="chip ${c.Active ? '' : 'chip-off'}">
            <span>${UI.esc(c.Name)}</span>
            <button class="icon-btn icon-xs" data-cat-edit="${UI.esc(c.CategoryID)}" aria-label="Rename ${UI.esc(c.Name)}">✎</button>
            <button class="icon-btn icon-xs" data-cat-toggle="${UI.esc(c.CategoryID)}" aria-label="${c.Active ? 'Disable' : 'Enable'} ${UI.esc(c.Name)}" title="${c.Active ? 'Disable' : 'Enable'}">${c.Active ? '⦸' : '↺'}</button>
          </li>`).join('')}</ul>
        <form class="inline-add" data-module="${t.module}" data-type="${t.type}">
          <input name="Name" placeholder="Add new…" aria-label="New ${t.label}" required>
          <button class="btn btn-primary btn-sm">Add</button>
        </form></div>`;
    }).join('');
    const save = async (payload, btn) => {
      try {
        await UI.busy(btn, () => Api.call('saveCategory', payload));
        await App.loadCategories();
        renderCats(el);
      } catch (e) { UI.fail(e); }
    };
    el.querySelectorAll('.inline-add').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      const name = f.Name.value.trim();
      if (name) save({ Module: f.dataset.module, Type: f.dataset.type, Name: name, Active: true }, f.querySelector('button'));
    }));
    el.querySelectorAll('[data-cat-toggle]').forEach(b => b.addEventListener('click', () => {
      const c = all.find(x => x.CategoryID === b.dataset.catToggle);
      save({ CategoryID: c.CategoryID, Module: c.Module, Type: c.Type, Name: c.Name, Active: !c.Active }, b);
    }));
    el.querySelectorAll('[data-cat-edit]').forEach(b => b.addEventListener('click', async () => {
      const c = all.find(x => x.CategoryID === b.dataset.catEdit);
      const ok = await UI.modal({
        title: 'Rename category',
        body: `<label class="field"><span>Name</span><input name="Name" required value="${UI.esc(c.Name)}"></label>
          <p class="muted small">Existing entries keep the old text; only new entries use the new name.</p><p class="form-error" hidden></p>`,
        onSubmit: v => Api.call('saveCategory', { CategoryID: c.CategoryID, Module: c.Module, Type: c.Type, Name: v.Name, Active: c.Active })
      });
      if (ok) { await App.loadCategories(); renderCats(el); }
    }));
  }

  return { render };
})();

document.addEventListener('DOMContentLoaded', () => App.init());

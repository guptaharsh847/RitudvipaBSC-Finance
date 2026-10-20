/**
 * Ritudvipa BSC Finance — Google Apps Script backend.
 *
 * Bind this script to the Google Sheet "Ritudvipa BSC Finance DB".
 * 1. Set SETUP_ADMIN_NAME / SETUP_ADMIN_PIN below, run setup() once from the editor.
 * 2. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * 3. Paste the /exec URL into js/config.js.
 * 4. (Optional, once) run importLegacy() from the editor to pull Aug–Oct 2026 data.
 *
 * Request:  POST (Content-Type text/plain) body = {action, token, payload}
 * Response: {ok: true, data} | {ok: false, error: "message", code: "CODE"}
 */

// ───────────────────────────── Configuration ─────────────────────────────
const SETUP_ADMIN_NAME = 'Admin';
const SETUP_ADMIN_PIN = '1234';           // change before running setup()
const DB_NAME = 'Ritudvipa BSC Finance DB';
const APP_NAME = 'Ritudvipa BSC Finance';
const SESSION_SECONDS = 6 * 60 * 60;      // 6 hours (CacheService maximum)
const PIN_PEPPER = 'ritudvipa-bsc-v1';
const MAX_LOGIN_FAILS = 5;

const BSC_ACCOUNT_NAME = 'Ritudwip BSC';
const PURPOSE_CARRY = 'Last Month Remaining';
const PURPOSE_COVERAGE = 'HELP (BSC Loss Coverage)';

const LEGACY_BSC_ID = '1kxcjxhhH7He4FBNAIQeZ_rdEmU4-3DVKP_fCl888OW4';
const LEGACY_PREACHING_ID = '1Xr11D7nIKYb8CTsCcOOKna5GnGSGOJxB0WNuRG81VpY';
const LEGACY_MONTHS = ['2026-08', '2026-09', '2026-10'];
const LEGACY_YEAR = 2026;
const LEGACY_PREACHING_FIRST_TAB = '23 aug slf';
const LEGACY_PREACHING_LAST_TAB = '11 oct slf';
const LEGACY_PREACHING_FROM = '2026-08-01';
const LEGACY_PREACHING_TO = '2026-10-31';

// ───────────────────────────── Schema ─────────────────────────────
const AUDIT = ['Source', 'Deleted', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'];
const SCHEMA = {
  Users: { id: 'UserID', cols: ['UserID', 'Name', 'PinHash', 'Salt', 'Role', 'Active', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'] },
  BscMonths: { id: 'MonthID', cols: ['MonthID', 'Month', 'Title', 'OpeningBalance', 'Notes'].concat(AUDIT) },
  BscIncome: { id: 'IncomeID', cols: ['IncomeID', 'MonthID', 'Date', 'Person', 'Purpose', 'Amount', 'Remarks'].concat(AUDIT) },
  BscExpenses: { id: 'ExpenseID', cols: ['ExpenseID', 'MonthID', 'Date', 'Mediator', 'ExpenseBearedBy', 'Purpose', 'Amount', 'Remarks'].concat(AUDIT) },
  PreachingEvents: { id: 'EventID', cols: ['EventID', 'SubType', 'Name', 'Date', 'Title', 'Menu', 'StudentPlates', 'InmatePlates', 'OtherPlates', 'Notes'].concat(AUDIT) },
  PreachingDonations: { id: 'DonationID', cols: ['DonationID', 'EventID', 'Date', 'DonorName', 'Amount', 'Mode', 'Remarks'].concat(AUDIT) },
  PreachingExpenses: { id: 'ExpenseID', cols: ['ExpenseID', 'EventID', 'Section', 'Item', 'Quantity', 'Unit', 'Amount', 'PaidBy', 'Remarks'].concat(AUDIT) },
  Categories: { id: 'CategoryID', cols: ['CategoryID', 'Module', 'Type', 'Name', 'SortOrder', 'Active'].concat(AUDIT) },
  ImportLog: { id: null, cols: ['Timestamp', 'SourceFile', 'Tab', 'Row', 'Status', 'Target', 'Detail'] }
};
const NUMERIC = { OpeningBalance: 1, Amount: 1, StudentPlates: 1, InmatePlates: 1, OtherPlates: 1, SortOrder: 1 };
const BOOL = { Active: 1, Deleted: 1 };
const TIMESTAMP = { CreatedAt: 1, UpdatedAt: 1, Timestamp: 1 };

const SEED_CATEGORIES = {
  'BSC|INCOME_PURPOSE': ['Rent Collection', 'Donation', 'Savings', 'Camp/Trip/Yatra', 'Book Distribution Donation',
    'Last Month Remaining', 'HELP (Preaching Donation)', 'HELP (BSC Loss Coverage)', 'Others (Refer remarks)'],
  'BSC|EXPENSE_PURPOSE': ['Building Rent', 'Cook', 'Vegetables', 'Flowers', 'Grocery', 'Electricity', 'Maintainance',
    'Petrol', 'Wi-Fi', 'Gas', 'Preachers', 'Reimbursement', 'Preaching Program', 'Others (Refer remarks)'],
  'PREACHING|ITEM': ['Aata', 'Vegetables', 'Ghee', 'Dal', 'Rice', 'Oil', 'Milk', 'Fruits', 'Sweets', 'Books', 'Beads',
    'Gifts', 'Decoration', 'Flowers', 'Petrol', 'Others']
};

// Child tables: generic add/update/delete handlers.
const CHILD = {
  Income: { table: 'BscIncome', parent: 'BscMonths', key: 'MonthID', fields: ['Date', 'Person', 'Purpose', 'Amount', 'Remarks'] },
  BscExpense: { table: 'BscExpenses', parent: 'BscMonths', key: 'MonthID', fields: ['Date', 'Mediator', 'ExpenseBearedBy', 'Purpose', 'Amount', 'Remarks'] },
  Donation: { table: 'PreachingDonations', parent: 'PreachingEvents', key: 'EventID', fields: ['Date', 'DonorName', 'Amount', 'Mode', 'Remarks'] },
  PreachingExpense: { table: 'PreachingExpenses', parent: 'PreachingEvents', key: 'EventID', fields: ['Section', 'Item', 'Quantity', 'Unit', 'Amount', 'PaidBy', 'Remarks'] }
};

// ───────────────────────────── HTTP entry points ─────────────────────────────
function doGet() {
  return json_({ ok: true, data: { app: APP_NAME, status: 'healthy', time: new Date().toISOString() } });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Invalid JSON body', code: 'BAD_REQUEST' });
  }
  return json_(handle_(req));
}

function handle_(req) {
  const action = String(req.action || '');
  const payload = req.payload || {};
  const route = ROUTES[action];
  if (!route) return { ok: false, error: 'Unknown action: ' + action, code: 'BAD_REQUEST' };

  let lock = null;
  try {
    resetTables_();
    let user = null;
    if (action === 'logout') {
      if (req.token) CacheService.getScriptCache().remove('s_' + req.token);
      return { ok: true, data: null };
    }
    if (route.auth !== 'none') {
      user = auth_(req.token);
      if (route.auth === 'admin' && user.Role !== 'ADMIN') throw err_('FORBIDDEN', 'Only an ADMIN can do this.');
    }
    if (route.write) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) throw err_('BUSY', 'Server is busy, please try again.');
    }
    // Read cache: results are keyed by a data version that every write bumps, so they are never stale
    // after an app edit. Manual edits in the sheet show up after READ_CACHE_SECONDS or via Refresh.
    let ckey = null;
    if (READ_CACHEABLE[action]) {
      const p = Object.assign({}, payload); delete p.fresh;
      ckey = 'r_' + dataVersion_() + '_' + action + '_' + md5_(JSON.stringify(p));
      if (!payload.fresh) {
        const hit = CacheService.getScriptCache().get(ckey);
        if (hit) return { ok: true, data: JSON.parse(hit), cached: true };
      }
    }
    const data = route.fn(payload, user);
    if (route.write) bumpDataVersion_();
    if (ckey) {
      try { CacheService.getScriptCache().put(ckey, JSON.stringify(data), READ_CACHE_SECONDS); }
      catch (e) { /* value over 100 KB — just don't cache */ }
    }
    return { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    if (e && e.appCode) return { ok: false, error: e.message, code: e.appCode };
    console.error(e && e.stack || e);
    return { ok: false, error: String(e && e.message || e), code: 'SERVER' };
  } finally {
    if (lock) lock.releaseLock();
  }
}

const READ_CACHEABLE = { listMonths: 1, getMonth: 1, listEvents: 1, getEvent: 1, getCategories: 1, getDashboard: 1 };
const READ_CACHE_SECONDS = 300;

function dataVersion_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_VER') || '0';
}
function bumpDataVersion_() {
  PropertiesService.getScriptProperties().setProperty('DATA_VER', String(Date.now()));
}
function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function err_(code, message) {
  const e = new Error(message);
  e.appCode = code;
  return e;
}

const R = (fn, opts) => Object.assign({ fn: fn, auth: 'user', write: false }, opts || {});
const ROUTES = {
  setup: R(setupAction_, { auth: 'none', write: true }),
  login: R(login_, { auth: 'none' }),
  logout: R(logout_, { auth: 'none' }),
  listUsers: R(listUsers_, { auth: 'admin' }),
  saveUser: R(saveUser_, { auth: 'admin', write: true }),

  listMonths: R(listMonths_),
  getMonth: R(getMonth_),
  createMonth: R(createMonth_, { write: true }),
  updateMonth: R(updateMonth_, { write: true }),
  deleteMonth: R(deleteMonth_, { write: true }),
  addIncome: R((p, u) => childAdd_('Income', p, u), { write: true }),
  updateIncome: R((p, u) => childUpdate_('Income', p, u), { write: true }),
  deleteIncome: R((p, u) => childDelete_('Income', p, u), { write: true }),
  addBscExpense: R((p, u) => childAdd_('BscExpense', p, u), { write: true }),
  updateBscExpense: R((p, u) => childUpdate_('BscExpense', p, u), { write: true }),
  deleteBscExpense: R((p, u) => childDelete_('BscExpense', p, u), { write: true }),

  listEvents: R(listEvents_),
  getEvent: R(getEvent_),
  createEvent: R(createEvent_, { write: true }),
  updateEvent: R(updateEvent_, { write: true }),
  deleteEvent: R(deleteEvent_, { write: true }),
  addDonation: R((p, u) => childAdd_('Donation', p, u), { write: true }),
  updateDonation: R((p, u) => childUpdate_('Donation', p, u), { write: true }),
  deleteDonation: R((p, u) => childDelete_('Donation', p, u), { write: true }),
  addPreachingExpense: R((p, u) => childAdd_('PreachingExpense', p, u), { write: true }),
  updatePreachingExpense: R((p, u) => childUpdate_('PreachingExpense', p, u), { write: true }),
  deletePreachingExpense: R((p, u) => childDelete_('PreachingExpense', p, u), { write: true }),

  getCategories: R(getCategories_),
  saveCategory: R(saveCategory_, { auth: 'admin', write: true }),
  getDashboard: R(getDashboard_),
  getExportData: R(getExportData_),
  importLegacy: R((p, u) => importLegacy_(u), { auth: 'admin', write: true })
};

// ───────────────────────────── Generic table helper ─────────────────────────────
let TABLES_ = {};
let DB_ = null;
function resetTables_() { TABLES_ = {}; }

function db_() {
  if (DB_) return DB_;
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  DB_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!DB_) throw err_('SERVER', 'Database sheet not found. Run setup() from the script editor.');
  return DB_;
}

function T_(name) {
  if (!TABLES_[name]) TABLES_[name] = new Table_(name);
  return TABLES_[name];
}

function ensureSheet_(name) {
  const ss = db_();
  const cols = SCHEMA[name].cols;
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(String);
  const missing = cols.filter(c => hdr.indexOf(c) < 0);
  if (missing.length) sh.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  return sh;
}

function Table_(name) {
  this.name = name;
  this.idCol = SCHEMA[name].id;
  this.sheet = ensureSheet_(name);
  const values = this.sheet.getDataRange().getValues();
  this.headers = values[0].map(String);
  this.raw = values.slice(1);
  this.tz = Session.getScriptTimeZone();
}

Table_.prototype.toObj_ = function (row, idx) {
  const o = {};
  this.headers.forEach((h, i) => { if (h) o[h] = fromCell_(h, row[i], this.tz); });
  Object.defineProperty(o, '_row', { value: idx + 2, enumerable: false });
  return o;
};

/** All rows as objects; soft-deleted rows excluded unless includeDeleted. */
Table_.prototype.all = function (includeDeleted) {
  const out = [];
  this.raw.forEach((r, i) => {
    if (r.every(v => v === '' || v === null)) return;
    const o = this.toObj_(r, i);
    if (!includeDeleted && o.Deleted === true) return;
    out.push(o);
  });
  return out;
};

Table_.prototype.find = function (id) {
  if (!id) return null;
  const c = this.headers.indexOf(this.idCol);
  for (let i = 0; i < this.raw.length; i++) {
    if (String(this.raw[i][c]) === String(id)) {
      const o = this.toObj_(this.raw[i], i);
      return o.Deleted === true ? null : o;
    }
  }
  return null;
};

Table_.prototype.cells_ = function (obj) {
  const vals = [], fmts = [];
  this.headers.forEach(h => {
    let v = obj[h];
    if (v === undefined || v === null) v = '';
    if (NUMERIC[h] && v !== '') v = num_(v);
    else if (BOOL[h]) v = v === true || String(v).toUpperCase() === 'TRUE';
    else if (h === 'Quantity' && v !== '' && isFinite(Number(v))) v = Number(v);
    else if (typeof v !== 'number' && typeof v !== 'boolean') v = String(v);
    vals.push(v);
    fmts.push(typeof v === 'number' || typeof v === 'boolean' ? 'General' : '@');
  });
  return { vals: vals, fmts: fmts };
};

Table_.prototype.stamp_ = function (obj, user, isNew) {
  const now = new Date().toISOString();
  const who = user ? user.Name : 'system';
  if (isNew) {
    if (this.idCol && !obj[this.idCol]) obj[this.idCol] = Utilities.getUuid();
    obj.CreatedBy = who; obj.CreatedAt = now;
    if (this.headers.indexOf('Deleted') >= 0 && obj.Deleted === undefined) obj.Deleted = false;
    if (this.headers.indexOf('Source') >= 0 && !obj.Source) obj.Source = 'APP';
  }
  obj.UpdatedBy = who; obj.UpdatedAt = now;
  return obj;
};

Table_.prototype.insert = function (obj, user) {
  return this.insertMany([obj], user)[0];
};

Table_.prototype.insertMany = function (objs, user) {
  if (!objs.length) return [];
  objs.forEach(o => this.stamp_(o, user, true));
  const cells = objs.map(o => this.cells_(o));
  const start = this.sheet.getLastRow() + 1;
  const range = this.sheet.getRange(start, 1, cells.length, this.headers.length);
  range.setNumberFormats(cells.map(c => c.fmts));
  range.setValues(cells.map(c => c.vals));
  cells.forEach(c => this.raw.push(c.vals));
  return objs.map((o, i) => this.toObj_(cells[i].vals, start - 2 + i));
};

Table_.prototype.update = function (id, patch, user) {
  const cur = this.find(id);
  if (!cur) throw err_('NOT_FOUND', this.name + ' record not found (it may have been deleted).');
  const next = Object.assign({}, cur, patch);
  next[this.idCol] = cur[this.idCol];
  next.CreatedBy = cur.CreatedBy; next.CreatedAt = cur.CreatedAt;
  this.stamp_(next, user, false);
  const c = this.cells_(next);
  const range = this.sheet.getRange(cur._row, 1, 1, this.headers.length);
  range.setNumberFormats([c.fmts]);
  range.setValues([c.vals]);
  this.raw[cur._row - 2] = c.vals;
  return this.toObj_(c.vals, cur._row - 2);
};

Table_.prototype.softDelete = function (id, user) {
  return this.update(id, { Deleted: true }, user);
};

/** Hard-delete rows matching predicate (used only for re-runnable legacy import). Returns count removed. */
Table_.prototype.deleteWhere = function (pred) {
  const keep = [], all = this.all(true);
  let removed = 0;
  all.forEach(o => { if (pred(o)) removed++; else keep.push(o); });
  if (!removed) return 0;
  const last = this.sheet.getLastRow();
  if (last > 1) this.sheet.getRange(2, 1, last - 1, this.sheet.getLastColumn()).clearContent();
  this.raw = [];
  if (keep.length) {
    const cells = keep.map(o => this.cells_(o));
    const range = this.sheet.getRange(2, 1, cells.length, this.headers.length);
    range.setNumberFormats(cells.map(c => c.fmts));
    range.setValues(cells.map(c => c.vals));
    this.raw = cells.map(c => c.vals);
  }
  return removed;
};

function fromCell_(h, v, tz) {
  if (v instanceof Date) {
    if (h === 'Month') return Utilities.formatDate(v, tz, 'yyyy-MM');
    if (TIMESTAMP[h]) return v.toISOString();
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  if (NUMERIC[h]) return v === '' || v === null ? 0 : num_(v);
  if (BOOL[h]) return v === true || String(v).toUpperCase() === 'TRUE';
  if (h === 'Quantity') return v;
  return v === null || v === undefined ? '' : String(v);
}

function num_(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[₹,\s]/g, ''));
  return isFinite(n) ? n : 0;
}

function round2_(n) { return Math.round(n * 100) / 100; }

function clean_(o) {
  // Strip internal / sensitive fields before sending.
  const c = Object.assign({}, o);
  delete c.PinHash; delete c.Salt;
  return c;
}

// ───────────────────────────── Setup & auth ─────────────────────────────
/** Run once from the Apps Script editor. Creates sheets, categories and the first ADMIN. */
function setup() {
  resetTables_();
  const res = setupAction_({}, null, true);
  bumpDataVersion_();
  Logger.log(JSON.stringify(res));
  return res;
}

function setupAction_(p, user, fromEditor) {
  const ss = db_();
  PropertiesService.getScriptProperties().setProperty('DB_ID', ss.getId());
  if (ss.getName() !== DB_NAME) ss.rename(DB_NAME);
  Object.keys(SCHEMA).forEach(ensureSheet_);
  const users = T_('Users').all();
  if (users.length && !fromEditor) {
    // Via web, setup is only allowed to bootstrap an empty database.
    throw err_('FORBIDDEN', 'Setup has already been completed.');
  }
  const out = { sheets: Object.keys(SCHEMA), adminCreated: false, categoriesSeeded: 0 };
  if (!users.length) {
    if (!/^\d{4,8}$/.test(SETUP_ADMIN_PIN)) throw err_('BAD_REQUEST', 'SETUP_ADMIN_PIN must be 4–8 digits.');
    const salt = Utilities.getUuid();
    T_('Users').insert({ Name: SETUP_ADMIN_NAME, PinHash: hash_(SETUP_ADMIN_PIN, salt), Salt: salt, Role: 'ADMIN', Active: true }, { Name: 'setup' });
    out.adminCreated = true;
  }
  out.categoriesSeeded = seedCategories_();
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  return out;
}

function seedCategories_() {
  const t = T_('Categories');
  const existing = {};
  t.all(true).forEach(c => { existing[c.Module + '|' + c.Type + '|' + c.Name.toLowerCase()] = 1; });
  const add = [];
  Object.keys(SEED_CATEGORIES).forEach(k => {
    const parts = k.split('|');
    SEED_CATEGORIES[k].forEach((name, i) => {
      if (!existing[k + '|' + name.toLowerCase()]) add.push({ Module: parts[0], Type: parts[1], Name: name, SortOrder: (i + 1) * 10, Active: true });
    });
  });
  t.insertMany(add, { Name: 'setup' });
  return add.length;
}

function hash_(pin, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin + ':' + PIN_PEPPER, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function auth_(token) {
  if (!token) throw err_('AUTH', 'Please log in.');
  const s = CacheService.getScriptCache().get('s_' + token);
  if (!s) throw err_('AUTH', 'Your session has expired. Please log in again.');
  const sess = JSON.parse(s);
  // The user's active/role check is cached briefly (saveUser clears it) to avoid reading Users every request.
  const cache = CacheService.getScriptCache();
  const uc = cache.get('u_' + sess.UserID);
  if (uc) return JSON.parse(uc);
  const u = T_('Users').find(sess.UserID);
  if (!u || u.Active !== true) {
    cache.remove('s_' + token);
    throw err_('AUTH', 'This user is disabled.');
  }
  const out = { UserID: u.UserID, Name: u.Name, Role: u.Role };
  cache.put('u_' + u.UserID, JSON.stringify(out), 300);
  return out;
}

function login_(p) {
  const name = String(p.name || '').trim();
  const pin = String(p.pin || '').trim();
  if (!name || !pin) throw err_('LOGIN', 'Enter your name and PIN.');
  const cache = CacheService.getScriptCache();
  const fk = 'f_' + name.toLowerCase();
  const fails = Number(cache.get(fk) || 0);
  if (fails >= MAX_LOGIN_FAILS) throw err_('LOCKED', 'Too many wrong attempts. Try again in 15 minutes.');
  const u = T_('Users').all().find(x => x.Name.trim().toLowerCase() === name.toLowerCase() && x.Active === true);
  if (!u || hash_(pin, u.Salt) !== u.PinHash) {
    cache.put(fk, String(fails + 1), 900);
    throw err_('LOGIN', 'Wrong name or PIN.');
  }
  cache.remove(fk);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const user = { UserID: u.UserID, Name: u.Name, Role: u.Role };
  cache.put('s_' + token, JSON.stringify(user), SESSION_SECONDS);
  return { token: token, user: user, expiresAt: Date.now() + SESSION_SECONDS * 1000 };
}

function logout_() {
  return null; // handled in handle_() because it needs the raw token
}

function listUsers_() {
  return T_('Users').all().map(clean_).sort((a, b) => a.Name.localeCompare(b.Name));
}

function saveUser_(p, user) {
  const t = T_('Users');
  const name = String(p.Name || '').trim();
  const role = p.Role === 'ADMIN' ? 'ADMIN' : 'EDITOR';
  const active = p.Active !== false;
  const pin = p.Pin ? String(p.Pin).trim() : '';
  if (!name) throw err_('BAD_REQUEST', 'Name is required.');
  if (pin && !/^\d{4,8}$/.test(pin)) throw err_('BAD_REQUEST', 'PIN must be 4–8 digits.');
  const all = t.all();
  const dup = all.find(u => u.Name.trim().toLowerCase() === name.toLowerCase() && u.UserID !== p.UserID);
  if (dup) throw err_('BAD_REQUEST', 'A user with this name already exists.');

  if (p.UserID) {
    const cur = t.find(p.UserID);
    if (!cur) throw err_('NOT_FOUND', 'User not found.');
    const activeAdmins = all.filter(u => u.Role === 'ADMIN' && u.Active === true && u.UserID !== cur.UserID);
    if ((role !== 'ADMIN' || !active) && cur.Role === 'ADMIN' && !activeAdmins.length) {
      throw err_('BAD_REQUEST', 'At least one active ADMIN is required.');
    }
    const patch = { Name: name, Role: role, Active: active };
    if (pin) { patch.Salt = Utilities.getUuid(); patch.PinHash = hash_(pin, patch.Salt); }
    CacheService.getScriptCache().remove('u_' + cur.UserID);
    return clean_(t.update(cur.UserID, patch, user));
  }
  if (!pin) throw err_('BAD_REQUEST', 'A PIN is required for a new user.');
  const salt = Utilities.getUuid();
  return clean_(t.insert({ Name: name, Role: role, Active: active, Salt: salt, PinHash: hash_(pin, salt) }, user));
}

// ───────────────────────────── Validation helpers ─────────────────────────────
function str_(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 500);
}
function date_(v, required) {
  const s = str_(v, 10);
  if (!s) { if (required) throw err_('BAD_REQUEST', 'Date is required.'); return ''; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw err_('BAD_REQUEST', 'Date must be YYYY-MM-DD.');
  return s;
}
function amount_(v) {
  const n = typeof v === 'number' ? v : Number(String(v === undefined ? '' : v).replace(/[₹,\s]/g, ''));
  if (String(v).trim() === '' || !isFinite(n)) throw err_('BAD_REQUEST', 'Amount must be a number.');
  return round2_(n);
}
function intOrZero_(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function sanitizeChild_(kind, p) {
  const out = {};
  CHILD[kind].fields.forEach(f => {
    if (!(f in p)) return;
    if (f === 'Amount') out.Amount = amount_(p.Amount);
    else if (f === 'Date') out.Date = date_(p.Date);
    else if (f === 'Section') {
      out.Section = p.Section === 'Other' ? 'Other' : 'Prasadam';
    } else if (f === 'Mode') {
      out.Mode = ['Cash', 'UPI', 'Bank'].indexOf(p.Mode) >= 0 ? p.Mode : '';
    } else if (f === 'Unit') {
      out.Unit = ['Kg', 'Ltr', 'Pcs'].indexOf(p.Unit) >= 0 ? p.Unit : '';
    } else if (f === 'Quantity') {
      const q = str_(p.Quantity, 30);
      out.Quantity = q !== '' && isFinite(Number(q)) ? Number(q) : q;
    } else out[f] = str_(p[f]);
  });
  return out;
}

// ───────────────────────────── Generic child CRUD ─────────────────────────────
function childAdd_(kind, p, user) {
  const def = CHILD[kind];
  const parentId = p[def.key];
  if (!T_(def.parent).find(parentId)) throw err_('NOT_FOUND', 'Parent record not found.');
  const row = sanitizeChild_(kind, p);
  if (!('Amount' in row)) row.Amount = amount_(p.Amount);
  row[def.key] = parentId;
  return T_(def.table).insert(row, user);
}

function childUpdate_(kind, p, user) {
  const def = CHILD[kind];
  const t = T_(def.table);
  const id = p[t.idCol];
  return t.update(id, sanitizeChild_(kind, p), user);
}

function childDelete_(kind, p, user) {
  const def = CHILD[kind];
  const t = T_(def.table);
  t.softDelete(p[t.idCol], user);
  return { deleted: p[t.idCol] };
}

function childrenOf_(table, key, id) {
  return T_(table).all().filter(r => r[key] === id);
}

function groupBy_(rows, key) {
  const m = {};
  rows.forEach(r => { m[r[key]] = m[r[key]] || []; m[r[key]].push(r); });
  return m;
}

function sortByDate_(rows) {
  return rows.sort((a, b) => (a.Date || '9999').localeCompare(b.Date || '9999') || (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));
}

// ───────────────────────────── BSC months ─────────────────────────────
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel_(ym) {
  const p = String(ym).split('-');
  return MONTH_NAMES[Number(p[1]) - 1] + ' ' + p[0];
}

function isBscBearer_(b) {
  const s = String(b || '').trim().toLowerCase();
  return !s || /\bbsc\b/.test(s) || s.indexOf('ritudwip') >= 0 || s.indexOf('ritudvipa') >= 0;
}

/** Same rules as js/bscMonths.js → summarizeMonth(). Keep them in sync. */
function summarizeMonth_(m, income, expenses) {
  const sum = rows => round2_(rows.reduce((s, r) => s + num_(r.Amount), 0));
  const byPurpose = rows => {
    const o = {};
    rows.forEach(r => { const k = r.Purpose || '(none)'; o[k] = round2_((o[k] || 0) + num_(r.Amount)); });
    return o;
  };
  const totalIncome = sum(income);
  const totalExpense = sum(expenses);
  const carry = sum(income.filter(r => r.Purpose === PURPOSE_CARRY));
  const coverage = sum(income.filter(r => r.Purpose === PURPOSE_COVERAGE));
  const operatingIncome = round2_(totalIncome - carry - coverage);
  const operatingResult = round2_(operatingIncome - totalExpense);
  const loss = Math.max(0, -operatingResult);
  const personal = {};
  expenses.filter(r => !isBscBearer_(r.ExpenseBearedBy)).forEach(r => {
    const k = String(r.ExpenseBearedBy).trim();
    personal[k] = personal[k] || { bearer: k, total: 0, count: 0 };
    personal[k].total = round2_(personal[k].total + num_(r.Amount));
    personal[k].count++;
  });
  const profitLoss = round2_(totalIncome - totalExpense);
  return {
    opening: num_(m.OpeningBalance),
    totalIncome: totalIncome,
    totalExpense: totalExpense,
    profitLoss: profitLoss,
    closing: round2_(num_(m.OpeningBalance) + profitLoss),
    carryForward: carry,
    coverage: coverage,
    operatingIncome: operatingIncome,
    loss: round2_(loss),
    gap: round2_(Math.max(0, loss - coverage)),
    isLoss: loss > 0,
    incomeByPurpose: byPurpose(income),
    expenseByPurpose: byPurpose(expenses),
    personal: Object.keys(personal).map(k => personal[k]),
    incomeCount: income.length,
    expenseCount: expenses.length
  };
}

function monthsWithSummary_() {
  const inc = groupBy_(T_('BscIncome').all(), 'MonthID');
  const exp = groupBy_(T_('BscExpenses').all(), 'MonthID');
  return T_('BscMonths').all()
    .map(m => Object.assign({}, m, { summary: summarizeMonth_(m, inc[m.MonthID] || [], exp[m.MonthID] || []) }))
    .sort((a, b) => a.Month.localeCompare(b.Month));
}

function listMonths_() {
  return monthsWithSummary_().reverse();
}

function getMonth_(p) {
  const m = T_('BscMonths').find(p.MonthID);
  if (!m) throw err_('NOT_FOUND', 'Month not found.');
  const income = sortByDate_(childrenOf_('BscIncome', 'MonthID', m.MonthID));
  const expenses = sortByDate_(childrenOf_('BscExpenses', 'MonthID', m.MonthID));
  return { month: m, income: income, expenses: expenses, summary: summarizeMonth_(m, income, expenses), prevClosing: previousClosing_(m.Month) };
}

function previousClosing_(ym) {
  const prev = monthsWithSummary_().filter(m => m.Month < ym);
  return prev.length ? prev[prev.length - 1].summary.closing : 0;
}

function createMonth_(p, user) {
  const ym = str_(p.Month, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw err_('BAD_REQUEST', 'Month must be YYYY-MM.');
  if (T_('BscMonths').all().some(m => m.Month === ym)) throw err_('BAD_REQUEST', monthLabel_(ym) + ' already exists.');
  const opening = p.OpeningBalance === '' || p.OpeningBalance === undefined || p.OpeningBalance === null
    ? previousClosing_(ym) : amount_(p.OpeningBalance);
  return T_('BscMonths').insert({ Month: ym, Title: 'BSC Accounts – ' + monthLabel_(ym), OpeningBalance: opening, Notes: str_(p.Notes, 2000) }, user);
}

function updateMonth_(p, user) {
  const patch = {};
  if ('OpeningBalance' in p) patch.OpeningBalance = amount_(p.OpeningBalance);
  if ('Notes' in p) patch.Notes = str_(p.Notes, 2000);
  return T_('BscMonths').update(p.MonthID, patch, user);
}

function deleteMonth_(p, user) {
  const t = T_('BscMonths');
  const m = t.find(p.MonthID);
  if (!m) throw err_('NOT_FOUND', 'Month not found.');
  ['BscIncome', 'BscExpenses'].forEach(n => childrenOf_(n, 'MonthID', m.MonthID).forEach(r => T_(n).softDelete(r[T_(n).idCol], user)));
  t.softDelete(m.MonthID, user);
  return { deleted: m.MonthID };
}

// ───────────────────────────── Preaching ─────────────────────────────
function eventTitle_(subType, name, date) {
  const kind = subType === 'SUNDAY_LOVE_FEAST' ? 'Sunday Love Feast' : 'One Time';
  let d = '';
  if (date) {
    const p = date.split('-');
    d = Number(p[2]) + ' ' + MONTH_NAMES[Number(p[1]) - 1] + ' ' + p[0];
  }
  return 'Preaching – ' + kind + (name ? ' (' + name + ')' : '') + (d ? ' – ' + d : '');
}

/** Same rules as js/preaching.js → summarizeEvent(). Keep them in sync. */
function summarizeEvent_(ev, donations, expenses) {
  const sum = rows => round2_(rows.reduce((s, r) => s + num_(r.Amount), 0));
  const prasadam = sum(expenses.filter(r => r.Section !== 'Other'));
  const other = sum(expenses.filter(r => r.Section === 'Other'));
  const totalExpense = round2_(prasadam + other);
  const totalDonations = sum(donations);
  const plates = intOrZero_(ev.StudentPlates) + intOrZero_(ev.InmatePlates) + intOrZero_(ev.OtherPlates);
  return {
    prasadamTotal: prasadam,
    otherTotal: other,
    totalExpense: totalExpense,
    totalDonations: totalDonations,
    net: round2_(totalDonations - totalExpense),
    totalPlates: plates,
    perPlate: plates ? round2_(totalExpense / plates) : 0,
    perPlatePrasadam: plates ? round2_(prasadam / plates) : 0
  };
}

function eventsWithSummary_() {
  const don = groupBy_(T_('PreachingDonations').all(), 'EventID');
  const exp = groupBy_(T_('PreachingExpenses').all(), 'EventID');
  return T_('PreachingEvents').all()
    .map(e => Object.assign({}, e, { summary: summarizeEvent_(e, don[e.EventID] || [], exp[e.EventID] || []) }))
    .sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));
}

function listEvents_() {
  return eventsWithSummary_();
}

function getEvent_(p) {
  const ev = T_('PreachingEvents').find(p.EventID);
  if (!ev) throw err_('NOT_FOUND', 'Event not found.');
  const donations = sortByDate_(childrenOf_('PreachingDonations', 'EventID', ev.EventID));
  const expenses = childrenOf_('PreachingExpenses', 'EventID', ev.EventID)
    .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));
  return { event: ev, donations: donations, expenses: expenses, summary: summarizeEvent_(ev, donations, expenses) };
}

function eventFields_(p, cur) {
  const o = {};
  const merged = Object.assign({}, cur || {}, p);
  o.SubType = merged.SubType === 'SUNDAY_LOVE_FEAST' ? 'SUNDAY_LOVE_FEAST' : 'ONE_TIME';
  o.Name = str_(merged.Name, 120);
  o.Date = date_(merged.Date, true);
  ['Menu', 'Notes'].forEach(f => { if (f in p) o[f] = str_(p[f], 3000); });
  ['StudentPlates', 'InmatePlates', 'OtherPlates'].forEach(f => { if (f in p) o[f] = intOrZero_(p[f]); });
  o.Title = eventTitle_(o.SubType, o.Name, o.Date);
  return o;
}

function createEvent_(p, user) {
  return T_('PreachingEvents').insert(eventFields_(p, null), user);
}

function updateEvent_(p, user) {
  const t = T_('PreachingEvents');
  const cur = t.find(p.EventID);
  if (!cur) throw err_('NOT_FOUND', 'Event not found.');
  return t.update(cur.EventID, eventFields_(p, cur), user);
}

function deleteEvent_(p, user) {
  const t = T_('PreachingEvents');
  const ev = t.find(p.EventID);
  if (!ev) throw err_('NOT_FOUND', 'Event not found.');
  ['PreachingDonations', 'PreachingExpenses'].forEach(n => childrenOf_(n, 'EventID', ev.EventID).forEach(r => T_(n).softDelete(r[T_(n).idCol], user)));
  t.softDelete(ev.EventID, user);
  return { deleted: ev.EventID };
}

// ───────────────────────────── Categories ─────────────────────────────
function getCategories_() {
  let rows = T_('Categories').all();
  if (!rows.length) { seedCategories_(); rows = T_('Categories').all(); }
  return rows.sort((a, b) => (a.Module + a.Type).localeCompare(b.Module + b.Type) || num_(a.SortOrder) - num_(b.SortOrder));
}

function saveCategory_(p, user) {
  const t = T_('Categories');
  const name = str_(p.Name, 80);
  if (!name) throw err_('BAD_REQUEST', 'Name is required.');
  const module = p.Module === 'PREACHING' ? 'PREACHING' : 'BSC';
  const type = ['INCOME_PURPOSE', 'EXPENSE_PURPOSE', 'ITEM'].indexOf(p.Type) >= 0 ? p.Type : '';
  if (!type) throw err_('BAD_REQUEST', 'Unknown category type.');
  const dup = t.all().find(c => c.Module === module && c.Type === type && c.Name.toLowerCase() === name.toLowerCase() && c.CategoryID !== p.CategoryID);
  if (dup) throw err_('BAD_REQUEST', 'This category already exists.');
  const row = { Module: module, Type: type, Name: name, Active: p.Active !== false };
  if (p.CategoryID) {
    if ('SortOrder' in p) row.SortOrder = num_(p.SortOrder);
    return t.update(p.CategoryID, row, user);
  }
  const same = t.all().filter(c => c.Module === module && c.Type === type);
  row.SortOrder = same.reduce((m, c) => Math.max(m, num_(c.SortOrder)), 0) + 10;
  return t.insert(row, user);
}

// ───────────────────────────── Dashboard ─────────────────────────────
function getDashboard_(p) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(p.from || '') ? p.from : '0000-01-01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(p.to || '') ? p.to : '9999-12-31';
  const fromM = from.slice(0, 7), toM = to.slice(0, 7);

  const allMonths = monthsWithSummary_();
  const months = allMonths.filter(m => m.Month >= fromM && m.Month <= toM);
  const events = eventsWithSummary_().filter(e => e.Date >= from && e.Date <= to)
    .sort((a, b) => a.Date.localeCompare(b.Date));

  const bsc = { income: 0, expense: 0, loss: 0, coverage: 0, gap: 0 };
  const expenseByPurpose = {};
  months.forEach(m => {
    const s = m.summary;
    bsc.income += s.totalIncome - s.carryForward;
    bsc.expense += s.totalExpense;
    bsc.loss += s.loss;
    bsc.coverage += s.coverage;
    bsc.gap += s.gap;
    Object.keys(s.expenseByPurpose).forEach(k => { expenseByPurpose[k] = (expenseByPurpose[k] || 0) + s.expenseByPurpose[k]; });
  });
  Object.keys(bsc).forEach(k => { bsc[k] = round2_(bsc[k]); });

  const preaching = { spent: 0, donations: 0, plates: 0, count: events.length };
  events.forEach(e => {
    preaching.spent += e.summary.totalExpense;
    preaching.donations += e.summary.totalDonations;
    preaching.plates += e.summary.totalPlates;
  });
  Object.keys(preaching).forEach(k => { preaching[k] = round2_(preaching[k]); });

  const upToTo = allMonths.filter(m => m.Month <= toM);
  const latest = upToTo.length ? upToTo[upToTo.length - 1] : null;

  return {
    from: from, to: to,
    bsc: bsc,
    preaching: preaching,
    currentBalance: latest ? latest.summary.closing : 0,
    currentBalanceMonth: latest ? latest.Month : '',
    monthly: months.map(m => ({
      MonthID: m.MonthID, Month: m.Month,
      income: round2_(m.summary.totalIncome - m.summary.carryForward),
      expense: m.summary.totalExpense,
      loss: m.summary.loss, closing: m.summary.closing
    })),
    expenseByPurpose: Object.keys(expenseByPurpose).map(k => ({ purpose: k, amount: round2_(expenseByPurpose[k]) }))
      .sort((a, b) => b.amount - a.amount),
    events: events.map(e => ({
      EventID: e.EventID, Title: e.Title, Name: e.Name, SubType: e.SubType, Date: e.Date,
      totalExpense: e.summary.totalExpense, totalDonations: e.summary.totalDonations,
      perPlate: e.summary.perPlate, plates: e.summary.totalPlates
    })),
    recent: recentEntries_(15)
  };
}

function recentEntries_(limit) {
  const months = {}; T_('BscMonths').all().forEach(m => { months[m.MonthID] = m; });
  const events = {}; T_('PreachingEvents').all().forEach(e => { events[e.EventID] = e; });
  const out = [];
  const push = (r, kind, label, parentLabel, link) => out.push({
    kind: kind, label: label, parent: parentLabel, amount: r.Amount === undefined ? null : num_(r.Amount),
    by: r.UpdatedBy || r.CreatedBy, createdBy: r.CreatedBy, at: r.UpdatedAt || r.CreatedAt,
    edited: r.UpdatedAt && r.UpdatedAt !== r.CreatedAt, link: link
  });
  T_('BscIncome').all().forEach(r => { const m = months[r.MonthID]; if (m) push(r, 'Income', r.Purpose + (r.Person ? ' · ' + r.Person : ''), monthLabel_(m.Month), 'month/' + m.MonthID); });
  T_('BscExpenses').all().forEach(r => { const m = months[r.MonthID]; if (m) push(r, 'Expense', r.Purpose + (r.Mediator ? ' · ' + r.Mediator : ''), monthLabel_(m.Month), 'month/' + m.MonthID); });
  T_('PreachingDonations').all().forEach(r => { const e = events[r.EventID]; if (e) push(r, 'Donation', r.DonorName || 'Donation', e.Title, 'event/' + e.EventID); });
  T_('PreachingExpenses').all().forEach(r => { const e = events[r.EventID]; if (e) push(r, r.Section === 'Other' ? 'Other expense' : 'Prasadam', r.Item, e.Title, 'event/' + e.EventID); });
  Object.keys(months).forEach(k => { const m = months[k]; push(Object.assign({}, m, { Amount: undefined }), 'Month', m.Title, '', 'month/' + m.MonthID); });
  Object.keys(events).forEach(k => { const e = events[k]; push(Object.assign({}, e, { Amount: undefined }), 'Event', e.Title, '', 'event/' + e.EventID); });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}

// ───────────────────────────── Export ─────────────────────────────
function getExportData_(p) {
  let monthIds = Array.isArray(p.monthIds) ? p.monthIds : [];
  let eventIds = Array.isArray(p.eventIds) ? p.eventIds : [];
  if (p.from || p.to) {
    const from = p.from || '0000-01-01', to = p.to || '9999-12-31';
    monthIds = T_('BscMonths').all().filter(m => m.Month >= from.slice(0, 7) && m.Month <= to.slice(0, 7)).map(m => m.MonthID);
    eventIds = T_('PreachingEvents').all().filter(e => e.Date >= from && e.Date <= to).map(e => e.EventID);
  }
  const months = monthIds.map(id => { try { return getMonth_({ MonthID: id }); } catch (e) { return null; } })
    .filter(Boolean).sort((a, b) => a.month.Month.localeCompare(b.month.Month));
  const events = eventIds.map(id => { try { return getEvent_({ EventID: id }); } catch (e) { return null; } })
    .filter(Boolean).sort((a, b) => a.event.Date.localeCompare(b.event.Date));
  return { months: months, events: events, generatedAt: new Date().toISOString() };
}

// ───────────────────────────── Legacy import ─────────────────────────────
/** Run once from the Apps Script editor. Safe to re-run: removes previous Source=LEGACY rows first. */
function importLegacy() {
  resetTables_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const res = importLegacy_({ UserID: 'legacy', Name: 'Legacy Import' });
    bumpDataVersion_();
    Logger.log(JSON.stringify(res, null, 2));
    return res;
  } finally {
    lock.releaseLock();
  }
}

function importLegacy_(user) {
  const log = [];
  const L = (src, tab, row, status, target, detail) =>
    log.push([new Date().toISOString(), src, tab, row === '' ? '' : String(row), status, target, detail]);
  const res = { months: 0, income: 0, bscExpenses: 0, events: 0, preachingExpenses: 0, skipped: 0, warnings: 0 };
  const importUser = { Name: (user && user.Name) || 'Legacy Import' };

  ['BscIncome', 'BscExpenses', 'BscMonths', 'PreachingDonations', 'PreachingExpenses', 'PreachingEvents'].forEach(n => {
    const c = T_(n).deleteWhere(r => r.Source === 'LEGACY');
    if (c) L('-', n, '', 'INFO', n, 'Removed ' + c + ' rows from a previous legacy import');
  });

  const cats = {};
  Object.keys(SEED_CATEGORIES).forEach(k => { cats[k] = SEED_CATEGORIES[k].slice(); });
  T_('Categories').all().forEach(c => {
    const k = c.Module + '|' + c.Type;
    cats[k] = cats[k] || [];
    if (cats[k].indexOf(c.Name) < 0) cats[k].push(c.Name);
  });

  try { importLegacyBsc_(L, res, importUser, cats); }
  catch (e) { L('BSC', '', '', 'ERROR', '', String(e && e.message || e)); }
  try { importLegacyPreaching_(L, res, importUser, cats); }
  catch (e) { L('Preaching', '', '', 'ERROR', '', String(e && e.message || e)); }

  log.forEach(r => { if (r[4] === 'SKIPPED') res.skipped++; if (r[4] === 'WARN') res.warnings++; });
  const sh = ensureSheet_('ImportLog');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  if (log.length) {
    const range = sh.getRange(2, 1, log.length, 7);
    range.setNumberFormat('@');
    range.setValues(log);
  }
  return res;
}

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function monIdx_(word) {
  const w = String(word || '').toLowerCase();
  if (w.length < 3) return 0;
  const i = MONTH_KEYS.indexOf(w.slice(0, 3));
  if (i < 0) return 0;
  // Reject words that merely start like a month ("marks", "mayapur"): allow full / abbreviated names only.
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i];
  return full.indexOf(w) === 0 || w === 'sept' ? i + 1 : 0;
}

function ymd_(y, m, d) {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return '';
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function yearFor_(y, tabM, m) {
  if (tabM === 1 && m === 12) return y - 1;
  if (tabM === 12 && m === 1) return y + 1;
  return y;
}

/** Parse messy dates like "5 October", "19Oct", "28October", "1-Oct", "05/10", 5, Date objects. */
function parseLooseDate_(v, y, m, tz) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'number') {
    if (v >= 1 && v <= 31 && y && m) return ymd_(y, m, Math.round(v));
    if (v > 20000 && v < 80000) return Utilities.formatDate(new Date(Math.round((v - 25569) * 864e5)), 'UTC', 'yyyy-MM-dd');
    return '';
  }
  const s = String(v).toLowerCase().replace(/(\d)\s*(st|nd|rd|th)\b/g, '$1').replace(/\s+/g, ' ').trim();
  let mt;
  if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return ymd_(+mt[1], +mt[2], +mt[3]);
  if ((mt = s.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?$/))) {
    let yy = mt[3] ? +mt[3] : yearFor_(y, m, +mt[2]);
    if (yy < 100) yy += 2000;
    return ymd_(yy, +mt[2], +mt[1]);
  }
  if ((mt = s.match(/(\d{1,2})\s*[-\/.,]?\s*([a-z]{3,})\.?(?:\s*[-\/.,']?\s*(\d{2,4}))?/))) {
    const mi = monIdx_(mt[2]);
    if (mi) {
      let yy = mt[3] ? +mt[3] : yearFor_(y, m, mi);
      if (yy < 100) yy += 2000;
      return ymd_(yy, mi, +mt[1]);
    }
  }
  if ((mt = s.match(/([a-z]{3,})\.?\s*[-\/.,]?\s*(\d{1,2})(?!\d)(?:\D+(\d{4}))?/))) {
    const mi = monIdx_(mt[1]);
    if (mi) return ymd_(mt[3] ? +mt[3] : yearFor_(y, m, mi), mi, +mt[2]);
  }
  if ((mt = s.match(/^(\d{1,2})$/)) && y && m) return ymd_(y, m, +mt[1]);
  return '';
}

function parseAmount_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  const s = String(v === null || v === undefined ? '' : v).replace(/₹|rs\.?|inr|,|\/-|\s/gi, '');
  if (!s) return NaN;
  const n = Number(s);
  if (isFinite(n)) return n;
  const mt = s.match(/^-?\d+(\.\d+)?/);
  return mt ? parseFloat(mt[0]) : NaN;
}

function parseQty_(q) {
  if (q === '' || q === null || q === undefined) return { qty: '', unit: '', raw: '' };
  if (typeof q === 'number') return { qty: q, unit: '', raw: '' };
  const raw = String(q).trim();
  const s = raw.toLowerCase();
  const mt = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)/);
  if (!mt) return { qty: raw, unit: '', raw: raw };
  const n = Number(mt[1]), u = mt[2];
  if (!u) return { qty: n, unit: '', raw: '' };
  if (/^(kg|kgs|kilo)/.test(u)) return { qty: n, unit: 'Kg', raw: '' };
  if (/^(g|gm|gms|gram|grams)$/.test(u)) return { qty: round2_(n / 1000), unit: 'Kg', raw: raw };
  if (/^ml/.test(u)) return { qty: round2_(n / 1000), unit: 'Ltr', raw: raw };
  if (/^(l|lt|ltr|ltrs|litre|litres|liter|liters)$/.test(u)) return { qty: n, unit: 'Ltr', raw: '' };
  if (/^(pc|pcs|piece|pieces|nos|no|pkt|pkts|packet|packets|box|boxes|bottle|bottles)$/.test(u)) return { qty: n, unit: 'Pcs', raw: u === 'pc' || u === 'pcs' || u === 'piece' || u === 'pieces' ? '' : raw };
  if (/^dozen/.test(u)) return { qty: n * 12, unit: 'Pcs', raw: raw };
  return { qty: raw, unit: '', raw: raw };
}

/** Map a free-text purpose/item onto the category list when it clearly matches; else keep it. */
function matchCategory_(raw, list) {
  const r = String(raw || '').trim();
  if (!r) return '';
  const key = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const rk = key(r);
  for (let i = 0; i < list.length; i++) if (key(list[i]) === rk) return list[i];
  if (rk.length >= 4) {
    for (let i = 0; i < list.length; i++) {
      const lk = key(list[i]);
      if (lk.indexOf(rk) === 0 || rk.indexOf(lk) === 0) return list[i];
    }
  }
  if (/^maint/.test(rk)) return list.find(x => /^maint/i.test(x)) || r;
  if (/^(wifi|internet|broadband)/.test(rk)) return list.find(x => /wi-?fi/i.test(x)) || r;
  if (/^(rent)$/.test(rk)) return list.find(x => /rent/i.test(x)) || r;
  return r;
}

function rowText_(row) {
  return row.map(v => (v instanceof Date ? '' : String(v === null ? '' : v))).join(' ').toLowerCase();
}

function isBlank_(cells) {
  return cells.every(v => v === '' || v === null || (typeof v === 'string' && !v.trim()));
}

function findLabelValue_(values, regex) {
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const v = values[r][c];
      if (typeof v !== 'string' || !regex.test(v)) continue;
      for (let k = 1; k <= 4 && c + k < values[r].length; k++) {
        const n = parseAmount_(values[r][c + k]);
        if (values[r][c + k] !== '' && isFinite(n)) return { value: n, row: r + 1, col: c + k + 1 };
      }
      if (r + 1 < values.length) {
        const n = parseAmount_(values[r + 1][c]);
        if (values[r + 1][c] !== '' && isFinite(n)) return { value: n, row: r + 2, col: c + 1 };
      }
    }
  }
  return null;
}

/** Detect "YYYY-MM" from a tab name like "aug 26", "Sept 2026", "October-26". */
function tabYearMonth_(name) {
  const t = String(name).toLowerCase();
  const re = /([a-z]{3,})/g;
  let mt;
  while ((mt = re.exec(t))) {
    const mi = monIdx_(mt[1]);
    if (!mi) continue;
    const after = t.slice(mt.index + mt[1].length);
    const ya = after.match(/^\D{0,3}(20\d{2}|\d{2})(?!\d)/);
    let y = ya ? Number(ya[1]) : 0;
    if (!y) { const yb = t.match(/(20\d{2})/); y = yb ? Number(yb[1]) : LEGACY_YEAR; }
    if (y < 100) y += 2000;
    return y + '-' + ('0' + mi).slice(-2);
  }
  return '';
}

function importLegacyBsc_(L, res, user, cats) {
  const SRC = 'Ritudwip BSC Accounts';
  const ss = SpreadsheetApp.openById(LEGACY_BSC_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const sheets = ss.getSheets();
  L(SRC, '', '', 'INFO', '', 'Tabs found (' + sheets.length + '): ' + sheets.map(s => s.getName()).join(' | '));

  // Detect each tab's month: name first, then row-1 title, then "current" → latest wanted month.
  const cands = sheets.map(s => {
    let ym = tabYearMonth_(s.getName()), how = 'tab name';
    if (!ym) {
      const title = s.getRange(1, 1, 1, Math.min(14, Math.max(1, s.getLastColumn()))).getDisplayValues()[0].join(' ');
      ym = tabYearMonth_(title); how = 'row-1 title';
    }
    if (!ym && /current|latest/i.test(s.getName())) { ym = LEGACY_MONTHS[LEGACY_MONTHS.length - 1]; how = '"current" tab'; }
    return { sheet: s, ym: ym, how: how };
  });
  const existing = {};
  T_('BscMonths').all().forEach(m => { existing[m.Month] = m; });

  const used = {};
  cands.forEach(c => {
    const name = c.sheet.getName();
    if (!c.ym) { L(SRC, name, '', 'SKIPPED', '', 'Could not detect a month for this tab'); return; }
    if (LEGACY_MONTHS.indexOf(c.ym) < 0) { L(SRC, name, '', 'SKIPPED', '', 'Month ' + c.ym + ' is outside the import range'); return; }
    if (used[c.ym]) {
      // Prefer a tab detected by explicit name over one guessed from "current".
      if (used[c.ym].how === '"current" tab' && c.how !== '"current" tab') {
        L(SRC, used[c.ym].sheet.getName(), '', 'SKIPPED', '', c.ym + ' also found in tab "' + name + '" (preferred)');
        used[c.ym] = c;
      } else {
        L(SRC, name, '', 'SKIPPED', '', c.ym + ' already taken by tab "' + used[c.ym].sheet.getName() + '"');
      }
      return;
    }
    used[c.ym] = c;
  });

  let prevClosing = null;
  LEGACY_MONTHS.forEach(ym => {
    const c = used[ym];
    if (!c) { L(SRC, '', '', 'WARN', ym, 'No tab found for ' + monthLabel_(ym)); return; }
    const tab = c.sheet.getName();
    if (existing[ym]) {
      L(SRC, tab, '', 'SKIPPED', ym, monthLabel_(ym) + ' already exists in the app (created manually) — not overwritten');
      prevClosing = null;
      return;
    }
    L(SRC, tab, '', 'INFO', ym, 'Using tab for ' + monthLabel_(ym) + ' (detected by ' + c.how + ')');
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    const values = c.sheet.getDataRange().getValues();
    const income = [], expenses = [];
    let incomeDone = false, expenseDone = false;

    for (let r = 2; r < values.length; r++) {
      const row = values[r];
      const rowNo = r + 1;
      // Income A–E
      const ic = row.slice(0, 5);
      while (ic.length < 5) ic.push('');
      if (!incomeDone && !isBlank_(ic)) {
        const txt = rowText_(ic);
        if (/total income|do not delete/.test(txt) || /(^|\s)total\b/.test(rowText_(ic.slice(0, 4)))) {
          L(SRC, tab, rowNo, 'SKIPPED', 'Income', 'Total row'); incomeDone = true;
        } else {
          const amt = parseAmount_(ic[3]);
          if (!isFinite(amt)) L(SRC, tab, rowNo, 'SKIPPED', 'Income', 'No valid amount: ' + txt.slice(0, 80));
          else if (amt === 0) L(SRC, tab, rowNo, 'SKIPPED', 'Income', 'Zero amount: ' + txt.slice(0, 80));
          else {
            const date = parseLooseDate_(ic[0], y, m, tz);
            const purpose = matchCategory_(ic[2], cats['BSC|INCOME_PURPOSE']);
            income.push({ Date: date, Person: str_(ic[1]), Purpose: purpose, Amount: round2_(amt), Remarks: str_(ic[4]), Source: 'LEGACY', _row: rowNo });
            if (ic[0] !== '' && !date) L(SRC, tab, rowNo, 'WARN', 'Income', 'Could not parse date "' + ic[0] + '" — left blank');
          }
        }
      }
      // Expenses F–K
      const ec = row.slice(5, 11);
      while (ec.length < 6) ec.push('');
      if (!expenseDone && !isBlank_(ec)) {
        const txt = rowText_(ec);
        if (/do not delete/.test(txt) || /(^|\s)total\b/.test(rowText_(ec.slice(0, 5)))) {
          L(SRC, tab, rowNo, 'SKIPPED', 'Expense', 'Total row'); expenseDone = true;
        } else {
          const amt = parseAmount_(ec[4]);
          if (!isFinite(amt)) L(SRC, tab, rowNo, 'SKIPPED', 'Expense', 'No valid amount: ' + txt.slice(0, 80));
          else if (amt === 0) L(SRC, tab, rowNo, 'SKIPPED', 'Expense', 'Zero amount: ' + txt.slice(0, 80));
          else {
            const date = parseLooseDate_(ec[0], y, m, tz);
            const purpose = matchCategory_(ec[3], cats['BSC|EXPENSE_PURPOSE']);
            expenses.push({ Date: date, Mediator: str_(ec[1]), ExpenseBearedBy: str_(ec[2]), Purpose: purpose, Amount: round2_(amt), Remarks: str_(ec[5]), Source: 'LEGACY', _row: rowNo });
            if (ec[0] !== '' && !date) L(SRC, tab, rowNo, 'WARN', 'Expense', 'Could not parse date "' + ec[0] + '" — left blank');
          }
        }
      }
    }

    // Opening balance.
    let opening = 0, openingHow = 'default 0';
    const hasCarry = income.some(r => r.Purpose === PURPOSE_CARRY);
    const lmb = findLabelValue_(values, /last\s*month('?s)?\s*bal/i);
    if (hasCarry) {
      openingHow = 'set to 0 because "' + PURPOSE_CARRY + '" is already recorded as income' + (lmb ? ' (Last Month Balance cell = ' + lmb.value + ')' : '');
    } else if (lmb) {
      opening = round2_(lmb.value); openingHow = '"Last Month Balance" cell at R' + lmb.row + 'C' + lmb.col;
    } else if (prevClosing !== null) {
      opening = prevClosing; openingHow = 'previous imported month closing';
    }

    const month = T_('BscMonths').insert({ Month: ym, Title: 'BSC Accounts – ' + monthLabel_(ym), OpeningBalance: opening, Notes: 'Imported from "' + tab + '"', Source: 'LEGACY' }, user);
    res.months++;
    L(SRC, tab, '', 'IMPORTED', 'BscMonths', monthLabel_(ym) + ' — opening balance ' + opening + ' (' + openingHow + ')');

    const strip = rows => rows.map(r => { const o = Object.assign({}, r, { MonthID: month.MonthID }); delete o._row; return o; });
    T_('BscIncome').insertMany(strip(income), user);
    T_('BscExpenses').insertMany(strip(expenses), user);
    income.forEach(r => L(SRC, tab, r._row, 'IMPORTED', 'BscIncome', [r.Date, r.Person, r.Purpose, r.Amount].join(' | ')));
    expenses.forEach(r => L(SRC, tab, r._row, 'IMPORTED', 'BscExpenses', [r.Date, r.Mediator, r.ExpenseBearedBy, r.Purpose, r.Amount].join(' | ')));
    res.income += income.length;
    res.bscExpenses += expenses.length;
    prevClosing = summarizeMonth_(month, income, expenses).closing;
  });
}

function legacyEventName_(tabName) {
  let s = String(tabName).toLowerCase()
    .replace(/\bslf\b/g, ' ')
    .replace(/\d+\s*(st|nd|rd|th)?/g, ' ')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/g, ' ')
    .replace(/\bbday\b|\bb'day\b/g, 'birthday')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return s.replace(/\b[a-z]/g, ch => ch.toUpperCase());
}

function dateFromTabName_(name) {
  const mt = String(name).toLowerCase().match(/(\d{1,2})\s*(st|nd|rd|th)?\s*([a-z]{3,})/);
  if (!mt) return '';
  const mi = monIdx_(mt[3]);
  return mi ? ymd_(LEGACY_YEAR, mi, +mt[1]) : '';
}

function importLegacyPreaching_(L, res, user, cats) {
  const SRC = 'preaching program sheet';
  const ss = SpreadsheetApp.openById(LEGACY_PREACHING_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const sheets = ss.getSheets();
  L(SRC, '', '', 'INFO', '', 'Tabs found (' + sheets.length + '): ' + sheets.map(s => s.getName()).join(' | '));

  const norm = n => String(n).toLowerCase().replace(/\s+/g, ' ').trim();
  const i0 = sheets.findIndex(s => norm(s.getName()) === LEGACY_PREACHING_FIRST_TAB);
  const i1 = sheets.findIndex(s => norm(s.getName()) === LEGACY_PREACHING_LAST_TAB);
  let selected;
  if (i0 >= 0 && i1 >= 0) {
    const a = Math.min(i0, i1), b = Math.max(i0, i1);
    selected = sheets.slice(a, b + 1);
    sheets.forEach((s, i) => { if (i < a || i > b) L(SRC, s.getName(), '', 'SKIPPED', '', 'Outside "' + LEGACY_PREACHING_FIRST_TAB + '" … "' + LEGACY_PREACHING_LAST_TAB + '" range'); });
  } else {
    L(SRC, '', '', 'WARN', '', 'Boundary tabs not found by name — selecting tabs by date between ' + LEGACY_PREACHING_FROM + ' and ' + LEGACY_PREACHING_TO);
    selected = sheets.filter(s => {
      const h2 = s.getRange('H2').getValue();
      const d = parseLooseDate_(h2, LEGACY_YEAR, 0, tz) || dateFromTabName_(s.getName());
      const ok = d && d >= LEGACY_PREACHING_FROM && d <= LEGACY_PREACHING_TO;
      if (!ok) L(SRC, s.getName(), '', 'SKIPPED', '', 'Date ' + (d || 'unknown') + ' outside import range');
      return ok;
    });
  }

  selected.forEach(s => {
    const tab = s.getName();
    const values = s.getDataRange().getValues();
    const get = (r, c) => (values[r] && values[r][c] !== undefined ? values[r][c] : '');
    const subType = /slf/i.test(tab) ? 'SUNDAY_LOVE_FEAST' : 'ONE_TIME';
    const nameDate = dateFromTabName_(tab);
    const nm = nameDate ? Number(nameDate.slice(5, 7)) : 0;
    let date = parseLooseDate_(get(1, 7), LEGACY_YEAR, nm, tz);
    if (!date) {
      date = nameDate;
      L(SRC, tab, 2, 'WARN', 'PreachingEvents', 'H2 date "' + get(1, 7) + '" not readable — ' + (date ? 'using date from tab name ' + date : 'no date found'));
    }
    if (!date) { L(SRC, tab, '', 'SKIPPED', 'PreachingEvents', 'No program date — tab skipped'); return; }

    // Menu (column A).
    const menu = [];
    for (let r = 0; r < values.length; r++) {
      const v = get(r, 0);
      if (v === '' || v === null) continue;
      const t = v instanceof Date ? Utilities.formatDate(v, tz, 'd MMM') : String(v).trim();
      if (!t || /^menu\b/i.test(t) && t.length < 12) continue;
      menu.push(t);
    }

    // Plate counts (labels in G/I, value to the right or below).
    const plateVal = re => {
      for (let r = 0; r < values.length; r++) {
        for (let c = 5; c <= 9; c++) {
          const v = get(r, c);
          if (typeof v !== 'string' || !re.test(v)) continue;
          for (let k = 1; k <= 3; k++) { const n = parseAmount_(get(r, c + k)); if (get(r, c + k) !== '' && isFinite(n)) return Math.round(n); }
          const n = parseAmount_(get(r + 1, c)); if (get(r + 1, c) !== '' && isFinite(n)) return Math.round(n);
        }
      }
      return null;
    };
    const students = plateVal(/student/i);
    const inmates = plateVal(/inmate/i);
    const others = plateVal(/(other|guest).*plate/i);
    if (students === null) L(SRC, tab, '', 'WARN', 'PreachingEvents', '"Student Plates Count" not found — set to 0');
    if (inmates === null) L(SRC, tab, '', 'WARN', 'PreachingEvents', '"Inmates Plates" not found — set to 0');

    const name = subType === 'ONE_TIME' ? legacyEventName_(tab) : '';
    const ev = T_('PreachingEvents').insert({
      SubType: subType, Name: name, Date: date, Title: eventTitle_(subType, name, date),
      Menu: menu.join('\n'), StudentPlates: students || 0, InmatePlates: inmates || 0, OtherPlates: others || 0,
      Notes: 'Imported from "' + tab + '"', Source: 'LEGACY'
    }, user);
    res.events++;
    L(SRC, tab, '', 'IMPORTED', 'PreachingEvents', ev.Title + ' — plates S:' + (students || 0) + ' I:' + (inmates || 0) + ' O:' + (others || 0));

    const rows = [];
    const scan = (section, cItem, cQty, cAmt, cRem) => {
      for (let r = 0; r < values.length; r++) {
        const cells = [get(r, cItem), get(r, cQty), get(r, cAmt)].concat(cRem !== null ? [get(r, cRem)] : []);
        if (isBlank_(cells)) continue;
        const rowNo = r + 1;
        const item = String(cells[0] instanceof Date ? '' : cells[0]).trim();
        const amt = parseAmount_(cells[2]);
        const txt = rowText_(cells);
        if (/total/.test(txt)) { L(SRC, tab, rowNo, 'SKIPPED', section, 'Total row'); continue; }
        if (!isFinite(amt)) {
          if (r === 0 || /^(item|items|grocery|particular|name|s\.?\s*no|qty|quantity|amount)/i.test(item)) continue; // header row
          L(SRC, tab, rowNo, 'SKIPPED', section, 'No valid amount: ' + txt.slice(0, 80));
          continue;
        }
        if (amt === 0) { L(SRC, tab, rowNo, 'SKIPPED', section, 'Zero amount: ' + txt.slice(0, 80)); continue; }
        if (!item) L(SRC, tab, rowNo, 'WARN', section, 'Amount without item name — imported as "Others"');
        const q = parseQty_(cells[1]);
        const remarks = [cRem !== null ? str_(cells[3]) : '', q.raw ? 'Qty: ' + q.raw : ''].filter(String).join(' · ');
        rows.push({
          EventID: ev.EventID, Section: section, Item: item ? matchCategory_(item, cats['PREACHING|ITEM']) : 'Others',
          Quantity: q.qty, Unit: q.unit, Amount: round2_(amt), PaidBy: '', Remarks: remarks, Source: 'LEGACY', _row: rowNo
        });
      }
    };
    scan('Prasadam', 2, 3, 4, null);   // C–E
    scan('Other', 9, 10, 11, 12);      // J–L + M remarks
    const clean = rows.map(r => { const o = Object.assign({}, r); delete o._row; return o; });
    T_('PreachingExpenses').insertMany(clean, user);
    rows.forEach(r => L(SRC, tab, r._row, 'IMPORTED', 'PreachingExpenses', [r.Section, r.Item, r.Quantity + (r.Unit ? ' ' + r.Unit : ''), r.Amount].join(' | ')));
    res.preachingExpenses += rows.length;
  });
}

/* HomeCoin - web interface (vanilla JS, no external dependencies other than a local Chart.js) */
'use strict';

// ================================================================ utilities
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const EUR0 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
const money = (c) => EUR.format((c || 0) / 100);
const money0 = (c) => EUR0.format((c || 0) / 100);
// unit price (not in cents) with its currency symbol: 6,1973 € · 6,91 $ (up to 4 decimals)
const _unitFmt = {};
const unitPrice = (v, cur = 'EUR') => {
  if (v == null) return '—';
  const c = /^[A-Z]{3}$/.test(cur || '') ? cur : 'EUR';
  _unitFmt[c] ||= new Intl.NumberFormat('it-IT', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return _unitFmt[c].format(v);
};
const moneyInput = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
const pct = (x) => `${Math.round(x * 100)}%`;
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// hand-typed numbers, a single rule for the whole app (like util.parse_number on the server):
// "1.234,56" · "1234,56" · "1234.56" · "1,234.56" · and for amounts "1.500" = 1500 (thousands dot)
function normNum(s, { thousandsDot = true } = {}) {
  s = String(s ?? '').trim().replace(/[€$£\s ']/g, '').replace(/^−/, '-');
  if (!s) return '';
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');  // the last separator is the decimal one
  else if (c >= 0) s = (s.match(/,/g).length > 1 || (thousandsDot && /^[-+]?\d{1,3},\d{3}$/.test(s)) ? s.replace(/,/g, '') : s.replace(',', '.'));
  else if (d >= 0 && (s.match(/\./g).length > 1 || (thousandsDot && /^[-+]?\d{1,3}\.\d{3}$/.test(s)))) s = s.replace(/\./g, '');
  return s;
}
function parseMoney(s) {  // amount in cents, always positive (the sign comes from the transaction type)
  const v = normNum(s);
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : NaN;
}
function parseSignedMoney(s) {  // signed amount in cents (e.g. opening balance of a credit card)
  const v = normNum(s);
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
const parseQty = (s) => normNum(s, { thousandsDot: false });  // quantities and unit prices: "9.014" stays 9,014
function isoLocal(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
const todayIso = () => isoLocal(new Date());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "29 Oct 2026": built from MONTHS so every browser gives the same three-letter month (en-GB alone may print "Sept")
const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '');
const fmtMonth = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y.slice(2)}`; };
const daysFrom = (iso) => Math.round((new Date(iso + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 86400000);

const KIND_LABEL = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };
const FREQ = { weekly: 'Weekly', monthly: 'Monthly', bimonthly: 'Every 2 months', quarterly: 'Quarterly', semiannual: 'Every 6 months', yearly: 'Yearly' };
const ACC_TYPES = { corrente: 'Current account', risparmio: 'Savings account', credito: 'Credit card', prepagata: 'Prepaid card', contanti: 'Cash', investimenti: 'Investment account', altro: 'Other' };
const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#64748b', '#78716c'];
// suggested icons for categories, accounts, spaces and goals, grouped by theme (the picker appends the ones
// already in use that are not here; you can always type an emoji by hand)
const EMOJIS = [
  '🏠', '🏡', '🔑', '🛋️', '🔧', '🧹', '🌱', '💡', '🔥', '💧', '📶',                   // home and utilities
  '🛒', '🥦', '🍞', '🍕', '🍔', '☕', '🍷', '🍺',                                       // groceries and eating out
  '🚗', '⛽', '🅿️', '🚆', '🚌', '🚲', '🛵', '✈️', '🧳', '🏖️', '🏨',                   // transport and travel
  '💊', '🩺', '🦷', '💇', '🧴', '🏋️', '⚽', '🎾', '🧘',                               // health, care, sport
  '👶', '🧸', '🐾', '🎓', '📚', '👪',                                                   // family and learning
  '🎮', '🎬', '🎵', '📺', '🎟️', '🎨', '📷',                                            // leisure and subscriptions
  '🛍️', '👕', '👟', '💍', '🎁', '📱', '💻',                                            // shopping
  '🧾', '🏛️', '⚖️', '🛡️', '📮', '☎️', '🏢',                                           // taxes, services, work
  '💰', '💶', '💵', '💳', '🏦', '🐷', '🪙', '📈', '📊', '💹', '💼', '👤', '↩️', '🔄', '🎯', '🏆', '⭐', '❤️', '📦', // money and misc
];
// periods per page: each has the ones that make sense for its analysis, and always "All"
const PERIOD_LABELS = { '7d': 'Last 7 days', '30d': 'Last 30 days', month: 'This month', prev: 'Last month', '3m': 'Last 3 months',
  '6m': 'Last 6 months', year: 'This year', lastyear: 'Last year', '12m': 'Last 12 months', all: 'All' };
const periodsOf = (...keys) => keys.map((k) => [k, PERIOD_LABELS[k]]);
const PERIODS = periodsOf('month', 'prev', '3m', '6m', 'year', 'lastyear', '12m', 'all');           // dashboard
const TX_PERIODS = periodsOf('7d', '30d', 'month', 'prev', '3m', '12m', 'year', 'lastyear', 'all'); // transactions
const REPORT_PERIODS = periodsOf('year', '12m', '6m', '3m', 'prev', 'month');                      // reports (+ years and All)

function periodRange(key) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const first = (yy, mm) => isoLocal(new Date(yy, mm, 1));
  const last = (yy, mm) => isoLocal(new Date(yy, mm + 1, 0));
  const daysAgo = (n) => isoLocal(new Date(y, m, now.getDate() - n + 1));
  switch (key) {
    case '7d': return [daysAgo(7), todayIso()];
    case '30d': return [daysAgo(30), todayIso()];
    case 'lastyear': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case 'prev': return [first(y, m - 1), last(y, m - 1)];
    case '3m': return [first(y, m - 2), last(y, m)];
    case '6m': return [first(y, m - 5), last(y, m)];
    case 'year': return [`${y}-01-01`, `${y}-12-31`];
    case '12m': return [first(y, m - 11), last(y, m)];
    case 'all': return ['', ''];
    default: return [first(y, m), last(y, m)];
  }
}

// ================================================================ drill-down to Transactions
// Every element with data-tx (filters as JSON) leads to Transactions already filtered; charts use goTx().
const goTx = (f) => { location.hash = '#/movimenti?' + qs(f); };
const txLink = (f, title = 'View transactions') => `data-tx="${esc(JSON.stringify(f))}" title="${esc(title)}"`;
const monthBounds = (ym) => { const [y, m] = ym.split('-').map(Number); return { from: `${ym}-01`, to: isoLocal(new Date(y, m, 0)) }; };
const searchKey = (desc) => (desc || '').replace(/\s*-\s*\d+\/\d+$/, '').trim();  // "Mortgage installment - 9/24" -> "Mortgage installment"
const pointerOnHover = (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; };
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tx]');
  if (!el || e.target.closest('button, a, input, select, label') && !e.target.closest('button[data-tx]')) return;
  goTx(JSON.parse(el.dataset.tx));
});

// CSV/Excel exports: they leave the encrypted database, so we say so first (the .hcbackup backup is encrypted instead)
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a[href^="/api/export/"]');
  if (!a) return;
  e.preventDefault();
  if (await confirmDialog('The file you are about to download (CSV or Excel) will be UNENCRYPTED: anyone who opens it can see the data. Keep it safe and delete it when you no longer need it. For a protected copy, use the encrypted backup in Settings.',
    { ok: 'Download anyway', danger: false, title: '⚠️ Unencrypted export' })) location.href = a.href;
});

// ================================================================ API
// double click on "Save", "Import", "Delete"…: the same write already in progress does not start a second time
const _inFlight = new Map();
function api(path, opts = {}) {
  const method = opts.method || 'GET';
  if (method === 'GET') return _api(path, opts);
  const key = `${method} ${S.pid} ${path} ${opts.body instanceof FormData ? `form:${[...opts.body.keys()].join()}` : JSON.stringify(opts.body ?? null)}`;
  if (_inFlight.has(key)) return _inFlight.get(key);
  const p = _api(path, opts).finally(() => _inFlight.delete(key));
  _inFlight.set(key, p);
  return p;
}
async function _api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: { 'X-HomeCoin': '1' } };
  if (S.pid) o.headers['X-Portfolio'] = String(S.pid);  // active space: the server filters everything on it
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch('/api' + path, o);
  const isJson = (r.headers.get('content-type') || '').includes('json');
  const data = isJson ? await r.json() : await r.text();
  if (r.status === 401 && isJson && data.locked) { showLock(); }  // session expired or locked elsewhere
  if (!r.ok) { const e = new Error((isJson && data.error) || `Error ${r.status}`); e.status = r.status; e.data = data; throw e; }
  return data;
}

// ================================================================ password sign-in
// The server starts locked: encrypted database, key in memory only after the password.
const AUTH = { status: null, lastPing: 0, lastInput: Date.now(), timer: null };
const pwScore = (p) => [p.length >= 8, p.length >= 12, /[a-z]/.test(p) && /[A-Z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p), p.length >= 16]
  .filter(Boolean).length;
function pwMeter(input, meter) {
  const upd = () => {
    const s = pwScore(input.value), w = [0, 20, 40, 60, 75, 90, 100][s];
    meter.style.width = w + '%';
    meter.style.background = s <= 2 ? 'var(--red)' : s <= 3 ? 'var(--amber)' : 'var(--green)';
  };
  input.addEventListener('input', upd); upd();
}
function wipeView() {  // clear the data off the screen
  destroyCharts(); closeModal();
  $('#view').innerHTML = ''; $('#pf-switch').innerHTML = '';
}
async function showLock(mode) {
  const st = AUTH.status = await fetch('/api/auth/status', { headers: { 'X-HomeCoin': '1' } }).then((r) => r.json()).catch(() => null);
  if (!st) { $('#lock-body').innerHTML = '<p class="lock-err">Server not reachable: restart HomeCoin.</p>'; return; }
  // HomeCoin was updated while the page was open: reload to use the new interface
  if (AUTH.loadedVersion && AUTH.loadedVersion !== st.version) { location.reload(); return; }
  AUTH.loadedVersion = st.version;
  $('#lock-version').textContent = 'v' + st.version;
  document.body.classList.toggle('demo', !!st.demo);  // "DEMO · sample data" banner always visible
  if (st.unlocked && !mode) { return unlocked(); }
  document.body.classList.add('locked');
  wipeView();
  if (st.db_encrypted_without_keystore) mode = 'missing';
  else if (!st.configured) mode = 'setup';
  else mode = mode && mode !== 'setup' ? mode : 'login';
  LOCK_VIEWS[mode](st);
}
const lockErr = (msg) => { $('#lock-err').textContent = msg || ''; };
function lockSubmit(btn, fn) {
  btn.closest('form').onsubmit = async (e) => {
    e.preventDefault(); lockErr('');
    btn.disabled = true;
    try { await fn(); } catch (err) {
      lockErr(err.message);
      const wait = err.data?.retry_after;
      if (wait) { setTimeout(() => (btn.disabled = false), wait * 1000); return; }
    }
    btn.disabled = false;
  };
}
function checkNew(pw, pw2) {
  if (pw.length < (AUTH.status?.min_password || 8)) throw new Error(`The password must be at least ${AUTH.status?.min_password || 8} characters long`);
  if (pw !== pw2) throw new Error('The two passwords do not match');
}
const newPwFields = (label = 'New password') => `
  <label class="field">${label}<input type="password" id="l-pw" autocomplete="new-password" autofocus></label>
  <div class="pw-meter"><span id="l-meter"></span></div>
  <label class="field">Confirm password<input type="password" id="l-pw2" autocomplete="new-password"></label>`;
const LOCK_VIEWS = {
  login(st) {
    if (st?.demo) {  // demo version: sample data, you get in with one click
      $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
        <h2>Demo version 🎬</h2>
        <p class="muted small">All data is <b>made up</b> and recreated at every start of the demo: feel free to experiment,
          nothing you do is kept. Your real data cannot be reached from here.</p>
        <div class="lock-err" id="lock-err"></div>
        <button class="btn btn-primary" id="l-go">▶ Enter the demo</button></form>`;
      lockSubmit($('#l-go'), async () => { await api('/auth/login', { method: 'POST', body: { password: st.demo_password } }); unlocked(); });
      return;
    }
    $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
      <h2>Welcome back 👋</h2>
      <label class="field">Password<input type="password" id="l-pw" autocomplete="current-password" autofocus></label>
      <div class="lock-err" id="lock-err"></div>
      <button class="btn btn-primary" id="l-go">🔓 Unlock</button>
      <button type="button" class="link" id="l-forgot">Forgot your password? Use the recovery key</button></form>`;
    setTimeout(() => $('#l-pw').focus(), 30);
    $('#l-forgot').onclick = () => LOCK_VIEWS.recover();
    lockSubmit($('#l-go'), async () => {
      await api('/auth/login', { method: 'POST', body: { password: $('#l-pw').value } });
      unlocked();
    });
  },
  setup(st) {
    $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
      <h2>Protect HomeCoin 🛡️</h2>
      <p class="muted small">Choose the password you will be asked for every time you open it. ${st.legacy_data ? 'Your existing data (and the automatic backups) will be <b>encrypted</b> with AES-256.' : 'All data will be stored encrypted with AES-256.'}
        The password is not saved anywhere: keep it safe.</p>
      ${newPwFields('Password')}
      <div class="lock-err" id="lock-err"></div>
      <button class="btn btn-primary" id="l-go">🔐 Create password and encrypt the data</button></form>`;
    pwMeter($('#l-pw'), $('#l-meter'));
    setTimeout(() => $('#l-pw').focus(), 30);
    lockSubmit($('#l-go'), async () => {
      checkNew($('#l-pw').value, $('#l-pw2').value);
      const btn = $('#l-go');
      btn.textContent = 'Encrypting…';
      try {
        const r = await api('/auth/setup', { method: 'POST', body: { password: $('#l-pw').value } });
        LOCK_VIEWS.recovery(r.recovery_key);
      } finally { btn.textContent = '🔐 Create password and encrypt the data'; }
    });
  },
  recover() {
    $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
      <h2>Recover access 🗝️</h2>
      <p class="muted small">Enter the recovery key you saved when you created the password, then choose a new password.</p>
      <label class="field">Recovery key<input id="l-rk" autocomplete="off" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" autofocus></label>
      ${newPwFields()}
      <div class="lock-err" id="lock-err"></div>
      <button class="btn btn-primary" id="l-go">Set the new password</button>
      <button type="button" class="link" id="l-back">← Back to sign-in</button></form>`;
    pwMeter($('#l-pw'), $('#l-meter'));
    $('#l-back').onclick = () => LOCK_VIEWS.login();
    lockSubmit($('#l-go'), async () => {
      checkNew($('#l-pw').value, $('#l-pw2').value);
      const r = await api('/auth/recover', { method: 'POST', body: { recovery_key: $('#l-rk').value, password: $('#l-pw').value } });
      LOCK_VIEWS.recovery(r.recovery_key);
    });
  },
  recovery(key) {  // key shown only once
    $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
      <h2>Your recovery key 🗝️</h2>
      <p class="muted small">If you forget the password, this is <b>the only way</b> to reopen your data: nobody (not even the author of HomeCoin) can recover it without this key.
        Write it on paper or save it in a password manager. It will not be shown again.</p>
      <div class="recovery-code" id="l-key">${esc(key)}</div>
      <button type="button" class="btn" id="l-copy">📋 Copy</button>
      <label class="check-row"><input type="checkbox" id="l-ok"> I saved the recovery key in a safe place</label>
      <button class="btn btn-primary" id="l-go" disabled>Enter HomeCoin →</button></form>`;
    $('#l-copy').onclick = async () => { try { await navigator.clipboard.writeText(key); toast('Key copied'); } catch { toast('Copy failed: select it by hand', 'err'); } };
    $('#l-ok').onchange = (e) => ($('#l-go').disabled = !e.target.checked);
    $('#l-go').closest('form').onsubmit = (e) => { e.preventDefault(); unlocked(); };
  },
  missing() {
    $('#lock-body').innerHTML = `<h2>Key file missing ⚠️</h2>
      <p class="muted small">The database is encrypted but <code>keystore.json</code> is missing from the data folder. Restore that file (for example from a copy of the <code>data</code> folder) and reload the page.</p>`;
  },
};
async function unlocked() {
  document.body.classList.remove('locked');
  AUTH.lastInput = AUTH.lastPing = Date.now();
  resetPeriods();  // new sign-in: every tab goes back to "Last 12 months"
  if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');  // always start again from the Dashboard
  try { await loadMeta(); } catch (e) { fail(e); }
  route();
  setTimeout(offerFolderProtection, 1200);  // after the dashboard has appeared
}
async function lockNow() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* already locked */ }
  showLock('login');
}
// auto-lock: same timeout as the server; using the page postpones the lock even without requests
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => {
  AUTH.lastInput = Date.now();
  if (!document.body.classList.contains('locked') && Date.now() - AUTH.lastPing > 60000) {
    AUTH.lastPing = Date.now();
    api('/auth/ping', { method: 'POST' }).catch(() => {});
  }
}, { passive: true, capture: true }));
setInterval(() => {
  const min = AUTH.status?.auto_lock || 15;
  if (!document.body.classList.contains('locked') && Date.now() - AUTH.lastInput > min * 60000) lockNow();
}, 15000);
const qs = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)).toString();

// ================================================================ state
const storedPid = () => { try { return +localStorage.getItem('homecoin-portfolio') || null; } catch { return null; } };
// analysis period: "Last 12 months" on every tab; each tab remembers its own while you work,
// and every new sign-in (unlock) starts again from the default
const DEFAULT_PERIOD = '12m';
const emptyTxFilters = () => {
  const [from, to] = periodRange(DEFAULT_PERIOD);
  return { q: '', from, to, account_id: '', category_id: '', kind: '', excluded: '' };
};
const S = {
  pid: storedPid(), portfolio: null, portfolios: [], allAccounts: [],
  accounts: [], categories: [], rules: [], tx_count: 0, charts: [],
  tx: { f: null, offset: 0, items: [], sel: new Set() },
  imp: { step: 1 },
};
function resetPeriods() {
  Object.assign(S, { dash: { period: DEFAULT_PERIOD, account_id: '' }, rep: { period: DEFAULT_PERIOD },
    invMonths: '12', savMonths: '12', budgetAvg: '12', budgetMonth: null });
  S.tx.f = emptyTxFilters();
}
resetPeriods();
// optional tabs: each space picks its own (the others are the common set, always present).
// Must mirror db.OPTIONAL_FEATURES / DEFAULT_FEATURES. Hiding a tab neither deletes nor excludes any data.
const FEATURES = {
  budget: ['🎯', 'Budgets', 'Monthly spending limits per category, this month\'s spending against the average, and overspending alerts'],
  obiettivi: ['🏁', 'Goals', 'Savings targets (trip, car, home…) with how much to set aside each month'],
  emergenza: ['🛟', 'Emergency fund', 'How many months of expenses your available cash covers and how far you are from the recommended reserve'],
  calendario: ['📅', 'Calendar', 'Due dates for the coming months (installments, bills, subscriptions, incoming payments) and projected balance'],
  mutuo: ['🔑', 'Mortgage', 'Amortization schedule, fixed/variable/mixed rate, interest and early repayment simulation'],
  ripartizione: ['⚖️', 'Fair split', 'How much each person should pay into the joint account to save the same % of their income'],
  investimenti: ['📈', 'Investments', 'Securities and trades, investment plans, average cost, gains, return, XIRR and updated prices'],
  risparmio: ['🐷', 'Savings', 'Savings and investment rate month by month, and net worth over time'],
};
const DEFAULT_FEATURES = {
  family: ['budget', 'obiettivi', 'emergenza', 'calendario', 'mutuo', 'ripartizione'],
  personal: ['budget', 'obiettivi', 'emergenza', 'calendario', 'investimenti', 'risparmio'],
};
const CORE_TABS = [['📊', 'Dashboard'], ['💸', 'Transactions'], ['🏦', 'Accounts'], ['🔁', 'Recurring'], ['📥', 'Import'], ['🏷️', 'Categories'],
  ['📑', 'Reports'], ['📜', 'Activity log'], ['⚙️', 'Settings']];
const featureOn = (k, p = S.portfolio) => !FEATURES[k] || (p?.features || DEFAULT_FEATURES[p?.type] || []).includes(k);
const PF_TYPES = { family: ['Household', 'Family', '🏠'], personal: ['Personal', 'Personal', '👤'] };  // label, default name, icon
// guide to choosing the space type: the type decides the initial categories, the suggested tabs and some calculations
const PF_GUIDE = {
  family: {
    for: 'The shared household account: several people pay in and share the mortgage, bills and common expenses.',
    diff: ['Goals with each person\'s monthly share, in proportion to income', 'People\'s contributions counted as shared income', 'Emergency fund based on household expenses'],
    cats: '🔑 Mortgage & loans, 🛋️ Home & furniture, 💡 Utilities, 🥦 Groceries, 💶 Contributions to household…',
  },
  personal: {
    for: 'Your personal finances: salary, your own expenses, savings, investments and pension fund.',
    diff: ['Investment accounts valued at market price (cash + securities)', 'Contributions to the household account as expenses or transfers to the household space', 'Personal goals and emergency fund'],
    cats: '💼 Salary, 📺 Subscriptions, 🎾 Sport & leisure, 📚 Books & learning, 🥦 Groceries…',
  },
};
async function loadMeta() {
  const m = await api('/meta');
  Object.assign(S, { accounts: m.accounts, categories: m.categories, rules: m.rules, tx_count: m.tx_count, version: m.version,
    data_dir: m.data_dir, portfolio: m.portfolio, portfolios: m.portfolios, allAccounts: m.all_accounts });
  if (S.pid !== m.portfolio.id) setPid(m.portfolio.id);  // saved space no longer valid
  $('#app-version').textContent = 'v' + m.version;
  drawPortfolioSwitcher();
}
function setPid(id) {
  S.pid = id;
  try { localStorage.setItem('homecoin-portfolio', String(id)); } catch { /* ignore */ }
}
async function switchPortfolio(id) {
  setPid(id);
  // when switching space the chosen periods stay, the filters tied to accounts and categories do not
  Object.assign(S, { dash: { period: S.dash.period, account_id: '' }, imp: { step: 1 } });
  S.tx.f = { ...emptyTxFilters(), from: S.tx.f.from, to: S.tx.f.to };
  await loadMeta();
  const k = currentRoute().key;
  if (!featureOn(k)) location.hash = '#/dashboard';
  else route();
  toast(`Space: ${S.portfolio.name}`, 'info');
}
function drawPortfolioSwitcher() {
  const p = S.portfolio;
  $('#pf-switch').innerHTML = `<button class="pf-current" id="pf-btn" style="--pc:${esc(p.color)}">
      <span class="pf-ico">${esc(p.icon)}</span><span class="pf-txt"><b>${esc(p.name)}</b><small>${PF_TYPES[p.type][0]}</small></span><span class="pf-caret">▾</span></button>
    <div class="pf-menu hidden" id="pf-menu">
      ${S.portfolios.filter((x) => !x.archived).map((x) => `<button data-pf="${x.id}" class="${x.id === p.id ? 'on' : ''}" style="--pc:${esc(x.color)}">
        <span class="pf-ico">${esc(x.icon)}</span><span class="pf-txt"><b>${esc(x.name)}</b><small>${PF_TYPES[x.type][0]} · ${x.accounts} ${x.accounts === 1 ? 'account' : 'accounts'}</small></span></button>`).join('')}
      <hr><button data-pf-new>＋ New space</button><button data-pf-manage>⚙️ Manage spaces</button></div>`;
  $$('#nav a').forEach((a) => a.classList.toggle('hidden', !featureOn(a.dataset.route, p)));
  $('#pf-btn').onclick = (e) => { e.stopPropagation(); $('#pf-menu').classList.toggle('hidden'); };
  $$('#pf-menu [data-pf]').forEach((b) => (b.onclick = () => { $('#pf-menu').classList.add('hidden'); if (+b.dataset.pf !== S.pid) switchPortfolio(+b.dataset.pf); }));
  $('#pf-menu [data-pf-new]').onclick = () => { $('#pf-menu').classList.add('hidden'); portfolioModal(); };
  $('#pf-menu [data-pf-manage]').onclick = () => { $('#pf-menu').classList.add('hidden'); location.hash = '#/impostazioni'; };
}
document.addEventListener('click', (e) => { if (!e.target.closest('#pf-switch')) $('#pf-menu')?.classList.add('hidden'); });
const otherPf = (pid) => pid != null && pid !== S.pid;
const catById = (id) => S.categories.find((c) => c.id === id);
const activeAccounts = () => S.accounts.filter((a) => !a.archived);
const catsOf = (kind) => S.categories.filter((c) => c.kind === kind);

const accountOptions = (sel, { all = false, includeArchived = false } = {}) =>
  (all ? `<option value="">All accounts</option>` : '') +
  S.accounts.filter((a) => includeArchived || !a.archived || a.id === +sel)
    .map((a) => `<option value="${a.id}" ${+sel === a.id ? 'selected' : ''}>${esc(a.icon)} ${esc(a.name)}</option>`).join('');
// destination of a transfer: accounts of every space, grouped (the active one first)
const transferOptions = (sel) => [S.portfolio, ...S.portfolios.filter((p) => p.id !== S.pid && !p.archived)].map((p) => {
  const accs = S.allAccounts.filter((a) => a.portfolio_id === p.id && (!a.archived || a.id === +sel));
  return accs.length ? `<optgroup label="${esc(p.id === S.pid ? `${p.name} (this space)` : p.name)}">${accs.map((a) =>
    `<option value="${a.id}" ${+sel === a.id ? 'selected' : ''}>${esc(a.icon)} ${esc(a.name)}</option>`).join('')}</optgroup>` : '';
}).join('');
const categoryOptions = (kind, sel, empty = 'Uncategorized') =>
  `<option value="">${esc(empty)}</option>` +
  catsOf(kind).map((c) => `<option value="${c.id}" ${+sel === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('');

// ================================================================ UI helpers
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3000);
  setTimeout(() => el.remove(), 3400);
}
const fail = (e) => toast(e.message || String(e), 'err');

function openModal(title, html, { wide = false } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn sm" data-close title="Close">✕</button></div>
    <div class="modal-body">${html}</div></div></div>`;
  const m = $('.modal', root);
  $('[data-close]', m).addEventListener('click', closeModal);
  $('.modal-backdrop', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
  setTimeout(() => { const f = $('[autofocus]', m) || $('input, select', m); f && f.focus(); }, 30);
  return m;
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function confirmDialog(message, { ok = 'Confirm', danger = true, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    const m = openModal(title, `<p>${esc(message)}</p><div class="modal-foot">
      <button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(ok)}</button></div>`);
    $('[data-no]', m).onclick = () => { closeModal(); resolve(false); };
    $('[data-yes]', m).onclick = () => { closeModal(); resolve(true); };
  });
}

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function chartTheme() {
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--grid');
  Chart.defaults.font.family = css('--font');
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.callbacks.label = masked((ctx) => ` ${ctx.dataset.label || ctx.label}: ${money(ctx.raw)}`);
}
// ================================================================ privacy: hidden amounts (eye icon)
// Every euro amount on the page is wrapped in <span class="m"> (including ones added later, via MutationObserver);
// with body.privacy the CSS blurs them. In charts (canvas) axes and tooltips show "•••".
const AMOUNT_RE = /[−+-]?\d{1,3}(?:\.\d{3})*(?:,\d+)?\s?K?\s?(?:€|\$|£|¥|CHF)/g;  // also prices in other currencies
const maskAmounts = (v) => (Array.isArray(v) ? v.map(maskAmounts) : typeof v === 'string' ? v.replace(AMOUNT_RE, '•••') : v);
const privacyOn = () => document.body.classList.contains('privacy');
function wrapAmounts(root) {
  if (!root || root.nodeType !== 1 && root.nodeType !== 3) return;
  const base = root.nodeType === 3 ? root.parentNode : root;
  if (!base || !base.isConnected) return;  // node already removed from the page
  const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentNode;
      if (!p || /^(SCRIPT|STYLE|OPTION|TEXTAREA|TITLE)$/.test(p.nodeName) || p.closest('.m, .lock-screen')) return NodeFilter.FILTER_REJECT;
      AMOUNT_RE.lastIndex = 0;
      return AMOUNT_RE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const frag = document.createDocumentFragment(), s = n.nodeValue;
    let last = 0;
    s.replace(AMOUNT_RE, (m, i) => {
      if (i > last) frag.append(s.slice(last, i));
      const span = document.createElement('span'); span.className = 'm'; span.textContent = m; frag.append(span);
      last = i + m.length; return m;
    });
    if (last < s.length) frag.append(s.slice(last));
    n.parentNode.replaceChild(frag, n);
  }
}
new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(wrapAmounts)))
  .observe(document.body, { childList: true, subtree: true });
function setPrivacy(on) {
  document.body.classList.toggle('privacy', on);
  try { localStorage.setItem('homecoin-privacy', on ? '1' : '0'); } catch { /* ignore */ }
  const b = $('#privacy-toggle');
  if (b) {
    b.innerHTML = on ? EYE_OFF : EYE_ON;
    b.title = on ? 'Show amounts' : 'Hide amounts';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  S.charts.forEach((c) => c.update('none'));
}
const EYE_ON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
// in charts, the functions that produce text (axes, tooltips) mask the amounts when privacy is on
const masked = (fn) => (typeof fn !== 'function' || fn.__masked ? fn : Object.assign(function (...a) { const r = fn.apply(this, a); return privacyOn() ? maskAmounts(r) : r; }, { __masked: true }));
function maskChartConfig(cfg) {
  const o = cfg.options || (cfg.options = {});
  Object.values(o.scales || {}).forEach((s) => { if (s.ticks?.callback) s.ticks.callback = masked(s.ticks.callback); });
  const cb = o.plugins?.tooltip?.callbacks;
  if (cb) Object.keys(cb).forEach((k) => { cb[k] = masked(cb[k]); });
  return cfg;
}
// stacked bars: a thin line in the background color between segments, so the parts stay distinct
function separateStacks(cfg) {
  const stacked = cfg.type === 'bar' && Object.values(cfg.options?.scales || {}).some((s) => s.stacked);
  if (stacked) (cfg.data?.datasets || []).forEach((ds) => {
    if (ds.borderWidth == null) Object.assign(ds, { borderColor: css('--surface'), borderWidth: { top: 2 }, borderSkipped: 'start' });
  });
  return cfg;
}
function chart(canvas, cfg) { const c = new Chart(canvas, maskChartConfig(separateStacks(cfg))); S.charts.push(c); return c; }
function destroyCharts() { S.charts.forEach((c) => c.destroy()); S.charts = []; }
const moneyAxis = { ticks: { callback: (v) => money0(v) } };
function vGradient(ctx, color) {
  const { chart: c } = ctx;
  if (!c.chartArea) return color + '33';
  const g = c.ctx.createLinearGradient(0, c.chartArea.top, 0, c.chartArea.bottom);
  g.addColorStop(0, color + '66'); g.addColorStop(1, color + '05');
  return g;
}

const catPill = (t) => {
  if (t.kind === 'transfer') return `<span class="pill" style="--c:#0ea5e9">🔄 Transfer</span>`;
  if (!t.category_id) return `<span class="pill" style="--c:#94a3b8">❔ To categorize</span>`;
  return `<span class="pill" style="--c:${esc(t.category_color)}">${esc(t.category_icon)} ${esc(t.category_name)}</span>`;
};
// sign: internal transfers have no sign, those from/to other spaces do
const signedAmount = (t) => (t.estimated ? '≈ ' : '') + (t.kind === 'expense' ? '−' : t.kind === 'income' ? '+'
  : otherPf(t.portfolio_id) ? '+' : otherPf(t.to_portfolio_id) ? '−' : '') + money(t.amount);
const transferLabel = (t) => `${esc(t.account_name)}${otherPf(t.portfolio_id) ? ` <span class="tag">${esc(t.portfolio_name)}</span>` : ''} → ${esc(t.to_account_name)}${otherPf(t.to_portfolio_id) ? ` <span class="tag">${esc(t.to_portfolio_name)}</span>` : ''}`;
function dateChip(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `<div class="date-chip"><b>${d.getDate()}</b><span>${MONTHS[d.getMonth()]}</span></div>`;
}

// ================================================================ router
const ROUTES = {
  dashboard: ['Dashboard', 'Your finances at a glance', renderDashboard],
  movimenti: ['Transactions', 'All income, expenses and transfers', renderMovimenti],
  conti: ['Accounts', 'Current accounts, cards and cash', renderConti],
  ricorrenti: ['Recurring', 'Mortgages, loans, subscriptions and fixed expenses', renderRicorrenti],
  import: ['Import', 'Upload a CSV or Excel bank statement', renderImport],
  report: ['Reports', 'Breakdown by category and period', renderReport],
  ripartizione: ['Fair split', 'How much each person should pay in to save the same percentage', renderRipartizione],
  budget: ['Budgets', 'Monthly spending limits per category', renderBudget],
  mutuo: ['Mortgage & loans', 'Amortization schedule, interest and early repayment simulation', renderMutuo],
  investimenti: ['Investments', 'Value, contributions and return of the investment accounts', renderInvestimenti],
  risparmio: ['Savings', 'Savings rate and net worth', renderRisparmio],
  obiettivi: ['Goals', 'Savings targets and how much to set aside each month', renderObiettivi],
  emergenza: ['Emergency fund', 'How many months of expenses the available reserve covers (accounts + broker cash and money market funds)', renderEmergenza],
  calendario: ['Calendar', 'Due dates for the coming months and projected balance', renderCalendario],
  categorie: ['Categories', 'Categories, budgets and automatic rules', renderCategorie],
  registro: ['Activity log', 'Sign-ins, changes and important deletions over the last 12 months', renderRegistro],
  impostazioni: ['Settings', 'Backups, exports and preferences', renderImpostazioni],
};
function currentRoute() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  return { key: ROUTES[path] ? path : 'dashboard', params: new URLSearchParams(query || '') };
}
async function route() {
  const { key, params } = currentRoute();
  if (S.portfolio && !featureOn(key)) { location.hash = '#/dashboard'; return; }  // tab hidden in this space
  const [title, sub, render] = ROUTES[key];
  destroyCharts();
  chartTheme();
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  $('#page-title').textContent = title;
  $('#page-sub').textContent = S.portfolio ? `${S.portfolio.name} · ${sub}` : sub;
  const v = $('#view');
  v.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await render(v, params);
  } catch (e) {
    v.innerHTML = `<div class="card empty"><div class="big">😕</div><h3>Something went wrong</h3><p>${esc(e.message)}</p></div>`;
  }
}
const refresh = async () => { await loadMeta(); await route(); };

// ================================================================ dashboard
async function renderDashboard(v) {
  const d = S.dash;
  const [from, to] = periodRange(d.period);
  const [st, up] = await Promise.all([api('/stats?' + qs({ from, to, account_id: d.account_id })), api('/upcoming?days=45')]);
  // savings = the month's surplus: income (and transfers from other spaces) − expenses − contributions to other spaces
  const exp = st.by_category.expense, saved = st.saved ?? st.income - st.expense, inflow = st.income + (st.transfers_in || 0);
  // money out = everything that leaves: expenses + contributions/transfers to other spaces (shown separately in the box)
  const toOthers = st.transfers_out || 0, outTot = st.expense + toOthers;
  // money in = everything that arrives: income + transfers received from other spaces (separate in the box, like money out)
  const fromOthers = st.transfers_in || 0, inTot = st.income + fromOthers;
  const hero = S.tx_count === 0 ? `
    <div class="hero">
      <h2>Welcome to HomeCoin 👋</h2>
      <p>Start by recording an expense, importing your bank statement or setting up your mortgage and recurring expenses: HomeCoin will do the rest.</p>
      <div class="actions" style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-go="add">＋ First transaction</button>
        <a class="btn" href="#/import">📥 Import bank statement</a>
        <a class="btn" href="#/ricorrenti">🔁 Set up recurring items</a>
        <a class="btn" href="#/conti">🏦 Add accounts</a>
      </div>
    </div>` : '';

  v.innerHTML = `${hero}
    <div class="toolbar">
      <select id="d-period">${PERIODS.map(([k, l]) => `<option value="${k}" ${k === d.period ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="d-account">${accountOptions(d.account_id, { all: true, includeArchived: true })}</select>
      <span class="muted small">${st.from_ ? `${fmtDate(st.from_)} → ${fmtDate(st.to)}` : ''}</span>
      ${st.excluded ? `<a class="chip small" href="#/movimenti?${qs({ excluded: 1, from, to })}" title="Not counted in totals and charts (they stay in the balance)">🙈 ${st.excluded} excluded</a>` : ''}
    </div>
    <div class="kpis">
      <div class="kpi g-indigo"><div class="k-label">🏦 ${d.account_id ? 'Account balance' : 'Total net worth'}</div>
        <div class="k-value">${money(st.balance_now)}</div><div class="k-sub">${activeAccounts().length} active accounts</div></div>
      <div class="kpi g-emerald"><div class="k-label">📥 Income</div><div class="k-value">${money(inTot)}</div>
        ${fromOthers ? `<div class="k-split">
          <a href="#/movimenti?${qs({ kind: 'income', from, to, ...(d.account_id ? { account_id: d.account_id } : {}) })}" title="Actual income: salaries, contributions, interest…"><span>💼 Income</span><b>${money(st.income)}</b></a>
          <a href="#/movimenti?${qs({ kind: 'transfer', from, to })}" title="Transfers received from accounts in other spaces: they come in here and count toward savings"><span>↙ From other spaces</span><b>${money(fromOthers)}</b></a></div>`
          : `<div class="k-sub">${st.by_category.income.length} sources</div>`}</div>
      <div class="kpi g-rose"><div class="k-label">📤 Money out</div><div class="k-value">${money(outTot)}</div>
        ${toOthers ? `<div class="k-split">
          <a href="#/movimenti?${qs({ kind: 'expense', from, to, ...(d.account_id ? { account_id: d.account_id } : {}) })}" title="Actual expenses: spending categories, budgets and chart by category"><span>🛒 Expenses</span><b>${money(st.expense)}</b></a>
          <a ${st.other_categories ? 'href="#/report" data-reptab="other"' : `href="#/movimenti?${qs({ kind: 'transfer', from, to })}"`} title="Contributions and transfers to other spaces (e.g. the household account): they leave from here but are not expenses"><span>↗ Other spaces</span><b>${money(toOthers)}</b></a></div>`
          : `<div class="k-sub">avg ${money0(outTot / st.months)} / month</div>`}</div>
      <div class="kpi g-amber"><div class="k-label">🐷 Savings</div><div class="k-value">${money(saved)}</div>
        <div class="k-sub">${inflow ? `savings rate ${pct(saved / inflow)}` : 'no income in the period'}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>Expenses by category</h3><span class="muted">click for details</span></div>
        ${exp.length ? `<div class="donut-wrap"><div class="chart-box"><canvas id="c-donut"></canvas></div>
          <div class="legend">${exp.map((c, i) => `<div class="legend-item" data-cat="${c.id ?? 'none'}">
            <span class="dot" style="background:${esc(c.color)}"></span><span>${esc(c.icon)} ${esc(c.name)}<span class="pct">${pct(c.total / st.expense)}</span></span>
            <b class="num">${money(c.total)}</b></div>`).join('')}</div></div>`
          : `<div class="empty"><div class="big">🍩</div>No expenses in the period</div>`}
      </div>
      <div class="card"><div class="card-head"><h3>Income, money out and savings by month</h3></div>
        <div class="chart-box"><canvas id="c-month"></canvas></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>Balance over time</h3><span class="muted">at month end</span></div>
        <div class="chart-box"><canvas id="c-balance"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>Budgets</h3><span class="muted">${st.months > 1 ? `over ${st.months} months` : 'month'}</span></div>
        <div id="budgets"></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>Upcoming payments</h3><a href="#/ricorrenti" class="small">Manage →</a></div>
        <div class="list">${up.length ? up.slice(0, 7).map(upcomingItem).join('') : `<div class="empty"><div class="big">📅</div>Nothing due in the next 45 days</div>`}</div></div>
      <div class="card"><div class="card-head"><h3>Largest expenses</h3><span class="muted">in the period</span></div>
        <div class="list">${st.top_expenses.length ? st.top_expenses.map((t) => `<div class="list-item clickable" ${txLink({ q: searchKey(t.description) }, 'View all similar transactions')}>
          <div class="cat-ico" style="--c:${esc(t.category_color || '#94a3b8')}">${esc(t.category_icon || '❔')}</div>
          <div class="grow"><div class="title">${esc(t.description || t.category_name || 'Expense')}</div><div class="muted small">${fmtDate(t.date)} · ${esc(t.account_name)}</div></div>
          <b class="amount expense">−${money(t.amount)}</b></div>`).join('') : `<div class="empty"><div class="big">🧾</div>No expenses</div>`}</div></div>
    </div>`;

  $('#d-period').onchange = (e) => { d.period = e.target.value; route(); };
  $('#d-account').onchange = (e) => { d.account_id = e.target.value; route(); };
  $$('[data-go="add"]', v).forEach((b) => (b.onclick = () => txModal()));
  const goCat = (id) => { location.hash = '#/movimenti?' + qs({ category_id: id, from, to, kind: 'expense', account_id: d.account_id }); };
  $$('.legend-item', v).forEach((el) => (el.onclick = () => goCat(el.dataset.cat)));

  // budgets
  const budgeted = catsOf('expense').filter((c) => c.budget > 0);
  $('#budgets').innerHTML = budgeted.length ? budgeted.map((c) => {
    const spent = exp.find((x) => x.id === c.id)?.total || 0, limit = c.budget * st.months, r = spent / limit;
    return `<div class="budget-row clickable" ${txLink({ category_id: c.id, from, to, kind: 'expense', account_id: d.account_id })}><div class="top"><span>${esc(c.icon)} ${esc(c.name)}</span>
      <span class="num ${r > 1 ? 'neg' : 'muted'}"><b>${money0(spent)}</b> / ${money0(limit)}</span></div>
      <div class="bar ${r > 1 ? 'over' : ''}"><i style="width:${Math.min(100, r * 100).toFixed(1)}%"></i></div></div>`;
  }).join('') : `<div class="empty"><div class="big">🎯</div><p>Set a monthly budget on your categories to keep your spending under control.</p>
    <div class="actions"><a class="btn btn-sm" href="#/categorie">Set budgets</a></div></div>`;

  $$('[data-reptab]', v).forEach((a) => a.addEventListener('click', () => { S.reportTab = a.dataset.reptab; }));
  // charts
  if (exp.length) {
    chart($('#c-donut'), {
      type: 'doughnut',
      data: { labels: exp.map((c) => c.name), datasets: [{ data: exp.map((c) => c.total), backgroundColor: exp.map((c) => c.color), borderWidth: 3, borderColor: css('--surface'), hoverOffset: 10, spacing: 1 }] },
      options: { cutout: '68%', maintainAspectRatio: false, plugins: { legend: { display: false } }, onHover: pointerOnHover, onClick: (_, el) => el.length && goCat(exp[el[0].index].id ?? 'none') },
    });
  }
  const months = st.balance_series.map((b) => b.month);
  const bm = Object.fromEntries(st.by_month.map((m) => [m.month, m]));
  chart($('#c-month'), {
    type: 'bar',
    data: {
      labels: months.map(fmtMonth),
      datasets: [
        // income: two greens like the box (income darker, transfers received from other spaces lighter)
        { label: 'Income', stack: 'in', data: months.map((m) => bm[m]?.income || 0), backgroundColor: '#059669', borderRadius: 8, maxBarThickness: 34 },
        ...(fromOthers ? [{ label: 'From other spaces', stack: 'in', data: months.map((m) => bm[m]?.from_others || 0), backgroundColor: '#6ee7b7', borderRadius: 8, maxBarThickness: 34 }] : []),
        // money out: two reds like the box (expenses darker, other spaces lighter); savings orange like its box
        { label: 'Expenses', stack: 'out', data: months.map((m) => bm[m]?.expense || 0), backgroundColor: '#e11d48', borderRadius: 8, maxBarThickness: 34 },
        ...(toOthers ? [{ label: 'Other spaces', stack: 'out', data: months.map((m) => bm[m]?.to_others || 0), backgroundColor: '#fb7185', borderRadius: 8, maxBarThickness: 34 }] : []),
        { label: 'Savings', stack: 'sav', data: months.map((m) => { const x = bm[m]; return x ? x.income + (x.from_others || 0) - x.expense - (x.to_others || 0) : 0; }),
          backgroundColor: '#f59e0b', borderRadius: 8, maxBarThickness: 34 },
      ],
    },
    options: {
      maintainAspectRatio: false, scales: { y: { ...moneyAxis, stacked: true }, x: { stacked: true, grid: { display: false } } }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } },
      onHover: pointerOnHover,
      onClick: (_, el, ch) => {
        if (!el.length) return;
        const lbl = ch.data.datasets[el[0].datasetIndex].label;  // income / expenses → that type; other spaces and savings → the whole month
        goTx({ ...monthBounds(months[el[0].index]), ...({ Income: { kind: 'income' }, 'From other spaces': { kind: 'transfer' }, Expenses: { kind: 'expense' } }[lbl] || {}), account_id: d.account_id });
      },
    },
  });
  chart($('#c-balance'), {
    type: 'line',
    data: { labels: months.map(fmtMonth), datasets: [{ label: 'Balance', data: st.balance_series.map((b) => b.balance), borderColor: '#8b5cf6', borderWidth: 3, tension: .35, fill: true, backgroundColor: (ctx) => vGradient(ctx, '#8b5cf6'), pointRadius: 3, pointBackgroundColor: '#8b5cf6', pointHitRadius: 14 }] },
    options: {
      maintainAspectRatio: false, scales: { y: moneyAxis, x: { grid: { display: false } } }, plugins: { legend: { display: false } },
      onHover: pointerOnHover,
      onClick: (_, el) => el.length && goTx({ ...monthBounds(months[el[0].index]), account_id: d.account_id }),
    },
  });
}

function upcomingItem(u) {
  const dd = daysFrom(u.date);
  const when = dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : `in ${dd} days`;
  return `<div class="list-item clickable" ${txLink({ recurring_id: u.recurring_id }, 'View the transactions of this recurring item')}>${dateChip(u.date)}
    <div class="grow"><div class="title">${esc(u.name)} ${u.installment ? `<span class="tag">installment ${esc(u.installment)}</span>` : ''}</div>
    <div class="muted small">${when} · ${esc(u.account_name)}</div></div>
    <b class="amount ${u.kind}">${signedAmount(u)}</b></div>`;
}

// ================================================================ transactions
async function renderMovimenti(v, params) {
  const t = S.tx;
  if ([...params.keys()].length) {
    t.f = { q: '', from: '', to: '', account_id: '', category_id: '', kind: '', excluded: '', ...Object.fromEntries(params) };
    history.replaceState(null, '', '#/movimenti');
  }
  const f = t.f;
  v.innerHTML = `
    <div class="card" style="margin-bottom:16px;padding:16px">
      <div class="toolbar" style="margin:0">
        <input id="f-q" type="search" placeholder="🔍 Search description or notes…" value="${esc(f.q)}" style="flex:2;min-width:200px">
        <select id="f-period"><option value="">Period…</option>${TX_PERIODS.map(([k, l]) => `<option value="${k}" ${periodRange(k).join() === `${f.from},${f.to}` ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input id="f-from" type="date" value="${esc(f.from)}" title="From">
        <input id="f-to" type="date" value="${esc(f.to)}" title="To">
        <select id="f-account">${accountOptions(f.account_id, { all: true, includeArchived: true })}</select>
        <select id="f-kind"><option value="">All types</option>${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="f-cat"><option value="">All categories</option><option value="none" ${f.category_id === 'none' ? 'selected' : ''}>❔ To categorize</option>
          <optgroup label="Expenses">${catsOf('expense').map((c) => `<option value="${c.id}" ${+f.category_id === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup>
          <optgroup label="Income">${catsOf('income').map((c) => `<option value="${c.id}" ${+f.category_id === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup></select>
        <select id="f-excl"><option value="">👁 Included and excluded</option><option value="0" ${f.excluded === '0' ? 'selected' : ''}>👁 Only included in reports</option><option value="1" ${f.excluded === '1' ? 'selected' : ''}>🙈 Only excluded from reports</option></select>
        <button class="btn btn-ghost" id="f-reset" title="Reset filters">↺ Reset</button>
      </div>
    </div>
    <div class="toolbar" style="margin-bottom:12px">
      <div class="summary-chips" id="tx-summary" style="margin:0"></div><span class="spacer"></span>
      <a class="btn btn-sm" id="exp-csv">⬇ CSV</a><a class="btn btn-sm" id="exp-xlsx">⬇ Excel</a>
    </div>
    <div id="bulk"></div>
    <div class="card" style="padding:6px 8px">
      <div class="table-wrap"><table>
        <thead><tr><th style="width:30px"><input type="checkbox" id="sel-all"></th><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th class="right">Amount</th><th></th></tr></thead>
        <tbody id="tx-body"></tbody></table></div>
      <div id="tx-more" style="text-align:center;padding:12px"></div>
    </div>`;

  const set = (k, val) => { f[k] = val; load(true); };
  $('#f-q').oninput = debounce((e) => set('q', e.target.value.trim()));
  $('#f-from').onchange = (e) => set('from', e.target.value);
  $('#f-to').onchange = (e) => set('to', e.target.value);
  $('#f-account').onchange = (e) => set('account_id', e.target.value);
  $('#f-kind').onchange = (e) => set('kind', e.target.value);
  $('#f-cat').onchange = (e) => set('category_id', e.target.value);
  $('#f-excl').onchange = (e) => set('excluded', e.target.value);
  $('#f-period').onchange = (e) => {
    const [a, b] = periodRange(e.target.value);
    f.from = a; f.to = b; $('#f-from').value = a; $('#f-to').value = b; load(true);
  };
  $('#f-reset').onclick = () => { t.f = emptyTxFilters(); route(); };  // reset: back to "Last 12 months"
  $('#sel-all').onchange = (e) => { t.items.forEach((x) => (e.target.checked ? t.sel.add(x.id) : t.sel.delete(x.id))); drawRows(); };

  $('#tx-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr || e.target.closest('[data-tx]')) return;  // the quick filters (category, account) are handled by the global click
    const id = +tr.dataset.id, item = t.items.find((x) => x.id === id);
    if (e.target.matches('input[type=checkbox]')) { e.target.checked ? t.sel.add(id) : t.sel.delete(id); drawBulk(); tr.classList.toggle('sel', e.target.checked); return; }
    if (e.target.closest('[data-del]')) { deleteTx(item); return; }
    if (e.target.closest('[data-eye]')) { setExcluded([id], !item.excluded); return; }
    if (e.target.closest('[data-dup]')) { txModal({ ...item, id: undefined, date: todayIso() }); return; }
    txModal(item);
  });

  function drawRows() {
    $('#tx-body').innerHTML = t.items.length ? t.items.map((x) => `<tr data-id="${x.id}" class="${t.sel.has(x.id) ? 'sel' : ''} ${x.excluded ? 'is-excluded' : ''}" style="cursor:pointer">
      <td><input type="checkbox" ${t.sel.has(x.id) ? 'checked' : ''}></td>
      <td class="num">${fmtDate(x.date)}</td>
      <td><div class="desc">${x.recurring_id ? '<span title="Generated by a recurring item">🔁</span> ' : ''}${esc(x.description || '—')}${x.excluded ? ' <span class="tag">🙈 excluded from reports</span>' : ''}</div>${x.notes ? `<div class="notes">${esc(x.notes)}</div>` : ''}</td>
      <td><span class="quick-filter" ${txLink({ ...filters(), kind: x.kind, category_id: x.kind === 'transfer' ? '' : (x.category_id ?? 'none') }, 'Filter by this category')}>${catPill(x)}</span></td>
      <td class="small">${x.kind === 'transfer' ? transferLabel(x) : `<span class="quick-filter" ${txLink({ ...filters(), account_id: x.account_id }, 'Filter by this account')}>${esc(x.account_name)}</span>`}</td>
      <td class="amount ${x.kind}">${signedAmount(x)}</td>
      <td><div class="row-actions"><button class="icon-btn sm ${x.excluded ? 'eye-off' : ''}" data-eye title="${x.excluded ? 'Include again in reports and totals' : 'Exclude from reports and totals'}">${x.excluded ? '🙈' : '👁'}</button><button class="icon-btn sm" data-dup title="Duplicate">⧉</button><button class="icon-btn sm" data-del title="Delete">🗑</button></div></td></tr>`).join('')
      : `<tr><td colspan="7"><div class="empty"><div class="big">🔎</div><h3>No transactions</h3><p>Try changing the filters or add a new transaction.</p></div></td></tr>`;
    drawBulk();
  }
  function drawBulk() {
    const n = t.sel.size;
    $('#bulk').innerHTML = n ? `<div class="bulkbar"><b>${n} selected</b><span class="spacer" style="flex:1"></span>
      <select id="bulk-cat"><option value="">🏷️ Assign category…</option>
        <optgroup label="Expenses">${catsOf('expense').map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup>
        <optgroup label="Income">${catsOf('income').map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup></select>
      <button class="btn btn-sm" id="bulk-excl">🙈 Exclude from reports</button><button class="btn btn-sm" id="bulk-incl">👁 Include</button>
      <button class="btn btn-sm btn-danger" id="bulk-del">🗑 Delete</button><button class="btn btn-sm" id="bulk-clear">Cancel</button></div>` : '';
    if (!n) return;
    $('#bulk-clear').onclick = () => { t.sel.clear(); drawRows(); };
    $('#bulk-excl').onclick = () => setExcluded([...t.sel], true).then(() => { t.sel.clear(); drawRows(); });
    $('#bulk-incl').onclick = () => setExcluded([...t.sel], false).then(() => { t.sel.clear(); drawRows(); });
    $('#bulk-cat').onchange = async (e) => {
      if (!e.target.value) return;
      try { await api('/transactions/bulk', { method: 'POST', body: { action: 'category', ids: [...t.sel], category_id: +e.target.value } }); toast('Category assigned (only to transactions of the matching type)'); t.sel.clear(); load(true); } catch (err) { fail(err); }
    };
    $('#bulk-del').onclick = async () => {
      if (!(await confirmDialog(`Permanently delete ${n} transactions?`, { ok: 'Delete' }))) return;
      try {
        const r = await api('/transactions/bulk', { method: 'POST', body: { action: 'delete', ids: [...t.sel] } });
        toast(`${n} transactions deleted${r.pac_deleted ? ` (and ${r.pac_deleted} linked automatic investment plan purchases)` : ''}`); t.sel.clear(); await loadMeta(); load(true);
      } catch (err) { fail(err); }
    };
  }

  const filters = () => ({ q: f.q, from: f.from, to: f.to, account_id: f.account_id, category_id: f.category_id, kind: f.kind, excluded: f.excluded, recurring_id: f.recurring_id });
  function drawSummary(res) {
    $('#tx-summary').innerHTML = `<span class="chip">📄 <b>${res.total}</b> transactions</span>
      <span class="chip">📥 <b class="pos">${money(res.income)}</b></span><span class="chip">📤 <b class="neg">${money(res.expense)}</b></span>
      <span class="chip">= <b class="${res.income - res.expense >= 0 ? 'pos' : 'neg'}">${money(res.income - res.expense)}</b></span>
      ${res.excluded ? `<span class="chip" title="Not counted in totals and reports">🙈 <b>${res.excluded}</b> excluded from totals</span>` : ''}
      ${f.recurring_id ? `<button class="chip" ${txLink({ ...filters(), recurring_id: '' }, 'Remove the recurring item filter')}>🔁 One recurring item only <b>✕</b></button>` : ''}`;
  }
  // shows/hides transactions in reports and totals, updating rows and summary without reloading the list
  async function setExcluded(ids, excluded) {
    try {
      const r = await api('/transactions/bulk', { method: 'POST', body: { action: excluded ? 'exclude' : 'include', ids } });
      if (r.skipped) toast(`${r.skipped} transfers coming from another space were not changed: change them from there`, 'info');
      t.items.forEach((x) => { if (ids.includes(x.id) && !otherPf(x.portfolio_id)) x.excluded = excluded ? 1 : 0; });
      drawRows();
      drawSummary(await api('/transactions?' + qs({ ...filters(), limit: 1 })));
      toast(excluded ? `🙈 ${ids.length} excluded from reports and totals` : `👁 ${ids.length} included again`, 'info');
    } catch (e) { fail(e); }
  }

  async function load(reset) {
    if (reset) { t.offset = 0; t.items = []; }
    const filt = filters();
    $('#exp-csv').href = '/api/export/transactions?' + qs({ ...filt, format: 'csv', pf: S.pid });
    $('#exp-xlsx').href = '/api/export/transactions?' + qs({ ...filt, format: 'xlsx', pf: S.pid });
    const res = await api('/transactions?' + qs({ ...filt, limit: 100, offset: t.offset }));
    t.items = t.items.concat(res.items);
    t.offset += res.items.length;
    drawSummary(res);
    drawRows();
    $('#tx-more').innerHTML = t.offset < res.total ? `<button class="btn btn-sm" id="more">Load more (${res.total - t.offset})</button>` : '';
    if ($('#more')) $('#more').onclick = () => load(false).catch(fail);
  }
  t.sel.clear();
  await load(true);
}

async function deleteTx(item) {
  if (!(await confirmDialog(`Delete the transaction "${item.description || KIND_LABEL[item.kind]}" of ${money(item.amount)}?`, { ok: 'Delete' }))) return;
  try {
    const r = await api(`/transactions/${item.id}`, { method: 'DELETE' });
    toast(r.pac_deleted ? 'Transaction deleted, together with its automatic investment plan purchase' : 'Transaction deleted'); closeModal(); refresh();
  } catch (e) { fail(e); }
}

// ------------------------------------------------- suggestions under a field
// custom dropdown (instead of the browser's <datalist>): aligned with the field, matches the theme, keyboard-navigable.
// load(q) → [{ value, label, meta }], onPick(item) when an entry is chosen
function autocomplete(input, { load, onPick, min = 2 }) {
  const wrap = document.createElement('div');
  wrap.className = 'ac-wrap';
  input.replaceWith(wrap); wrap.append(input);
  input.setAttribute('autocomplete', 'off');
  const box = document.createElement('div');
  box.className = 'ac-box hidden'; box.setAttribute('role', 'listbox');
  wrap.append(box);
  let items = [], cur = -1, seq = 0;
  const close = () => { box.classList.add('hidden'); cur = -1; };
  const mark = () => $$('.ac-item', box).forEach((el, i) => el.classList.toggle('on', i === cur));
  const pick = (i) => { const it = items[i]; if (!it) return; input.value = it.value; close(); onPick?.(it); };
  const draw = () => {
    if (!items.length) { close(); return; }
    box.innerHTML = `<div class="ac-head">✨ Used before</div>` + items.map((it, i) => `<div class="ac-item" role="option" data-i="${i}">
      <span class="ac-label">${esc(it.label ?? it.value)}</span>${it.meta ? `<span class="ac-meta">${it.meta}</span>` : ''}</div>`).join('');
    $$('.ac-item', box).forEach((el) => {
      el.onmousedown = (e) => { e.preventDefault(); pick(+el.dataset.i); };  // before the field's blur
    });
    cur = -1; box.classList.remove('hidden');
  };
  const refresh = debounce(async () => {
    const q = input.value.trim(), my = ++seq;
    if (q.length < min) { items = []; close(); return; }
    try { const res = await load(q); if (my !== seq || document.activeElement !== input) return; items = res.filter((it) => it.value !== input.value); draw(); }
    catch { close(); }  // suggestions are not essential
  }, 200);
  input.addEventListener('input', refresh);
  input.addEventListener('focus', () => { if (input.value.trim().length >= min) refresh(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; mark();
      $$('.ac-item', box)[cur]?.scrollIntoView({ block: 'nearest' });
    } else if ((e.key === 'Enter' || e.key === 'Tab') && cur >= 0) {
      e.preventDefault(); e.stopPropagation(); pick(cur);  // Enter picks the entry, it does not save the dialog
    } else if (e.key === 'Escape') { e.stopPropagation(); close(); }  // closes the dropdown, not the dialog
  });
  return { close };
}
const acMeta = (d) => [d.count > 1 ? `×${d.count}` : '', d.amount ? money(d.amount) : '', d.date ? fmtDate(d.date) : ''].filter(Boolean).join(' · ');

// fields filled in by a suggestion: highlighted until you change them
function markSuggested(el, on = true) {
  const box = el.closest('label') || el;
  box.classList.toggle('sugg-filled', on);
  if (on) el.addEventListener('input', () => box.classList.remove('sugg-filled'), { once: true });
  if (on) el.addEventListener('change', () => box.classList.remove('sugg-filled'), { once: true });
}

// ------------------------------------------------- transaction dialog
function txModal(tx = null, defaults = {}) {
  const editing = !!(tx && tx.id);
  const t = { kind: 'expense', date: todayIso(), account_id: activeAccounts()[0]?.id, ...defaults, ...(tx || {}) };
  if (!S.accounts.length) { toast('Create an account first', 'err'); return; }
  const m = openModal(editing ? 'Edit transaction' : 'New transaction', `
    <div class="seg" id="tx-kind" style="margin-bottom:16px">
      ${Object.entries(KIND_LABEL).map(([k, l]) => `<button type="button" data-kind="${k}" class="${t.kind === k ? 'on' : ''}">${{ expense: '📤', income: '📥', transfer: '🔄' }[k]} ${l}</button>`).join('')}
    </div>
    <input id="tx-amount" class="amount-input" inputmode="decimal" placeholder="0,00 €" value="${moneyInput(t.amount)}" autofocus>
    <div class="form-grid" style="margin-top:16px">
      <label class="field full">Description <input id="tx-desc" maxlength="200" value="${esc(t.description || '')}" placeholder="E.g. Supermarket shopping, electricity bill…">
        <span id="tx-sugg-note" class="sugg-note hidden"></span></label>
      <label class="field">Date <input id="tx-date" type="date" value="${esc(t.date)}"></label>
      <label class="field"><span id="acc-label">Account</span> <select id="tx-account">${accountOptions(t.account_id)}</select></label>
      <label class="field" id="to-wrap">To account <select id="tx-to">${transferOptions(t.to_account_id || activeAccounts().find((a) => a.id !== t.account_id)?.id)}</select></label>
      <label class="field" id="cat-wrap"><span class="field-head">Category <span id="sugg"></span></span><select id="tx-cat"></select></label>
      <label class="field full">Notes <textarea id="tx-notes" maxlength="1000" placeholder="Optional">${esc(t.notes || '')}</textarea></label>
      <label class="check full"><input type="checkbox" id="tx-excl" ${t.excluded ? 'checked' : ''}> 🙈 Exclude from reports and totals
        <span class="muted small">(it still counts in the account balance)</span></label>
    </div>
    <div class="modal-foot">
      ${editing ? '<button class="btn btn-ghost left neg" id="tx-del">🗑 Delete</button>' : '<span class="left muted small">Tip: press <span class="kbd">N</span> for a new transaction</span>'}
      ${editing ? '' : '<button class="btn" id="tx-save-new">Save & new</button>'}
      <button class="btn btn-primary" id="tx-save">Save</button>
    </div>`);

  let kind = t.kind, catTouched = editing && !!t.category_id;
  const drawKind = () => {
    $$('#tx-kind button', m).forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
    $('#to-wrap', m).classList.toggle('hidden', kind !== 'transfer');
    $('#cat-wrap', m).classList.toggle('hidden', kind === 'transfer');
    $('#acc-label', m).textContent = kind === 'transfer' ? 'From account' : 'Account';
    const cur = $('#tx-cat', m).value || t.category_id;
    $('#tx-cat', m).innerHTML = kind === 'transfer' ? '' : categoryOptions(kind, cur);
  };
  $$('#tx-kind button', m).forEach((b) => (b.onclick = () => { kind = b.dataset.kind; drawKind(); suggest(); }));
  drawKind();

  $('#tx-cat', m).onchange = () => { catTouched = true; $('#sugg', m).innerHTML = ''; };
  // accounts picked by hand (or already set when opening) are no longer changed by suggestions
  let accTouched = editing || !!defaults.account_id, toTouched = editing || !!defaults.to_account_id;
  $('#tx-account', m).addEventListener('change', () => { accTouched = true; });
  $('#tx-to', m).addEventListener('change', () => { toTouched = true; });
  const desc = $('#tx-desc', m);
  autocomplete(desc, {
    load: async (q) => (await api('/descriptions?' + qs({ q, kind, full: 1 }))).map((d) => ({ value: d.description, meta: acMeta(d) })),
    onPick: () => suggest(true),
  });
  desc.addEventListener('input', debounce(() => suggest(false), 350));  // description typed by hand: category only
  const pick = (sel, id) => {  // true only if the suggestion really changes the choice
    if (!id || +$(sel, m).value === id || !$(`${sel} option[value="${id}"]`, m)) return false;
    $(sel, m).value = id; markSuggested($(sel, m)); return true;
  };
  const note = (txt) => { const n = $('#tx-sugg-note', m); n.textContent = txt; n.classList.toggle('hidden', !txt); };
  async function suggest(full) {
    if (editing || desc.value.trim().length < 3) return;  // when editing, the data is already the real one
    try {
      const s = await api('/suggest?' + qs({ description: desc.value, kind }));
      const done = [];
      if (kind !== 'transfer' && s.category_id && !catTouched && +$('#tx-cat', m).value !== s.category_id) {
        $('#tx-cat', m).value = s.category_id;
        markSuggested($('#tx-cat', m));
        $('#sugg', m).innerHTML = `<span class="suggest-badge" title="${s.source === 'regola' ? `Rule «${esc(s.pattern || '')}»` : 'Like similar transactions already categorized'}">✨ ${s.source === 'regola' ? 'by rule' : 'from history'}</span>`;
      }
      if (!full) return;  // accounts and amount only when picking a description used before
      if (!accTouched && pick('#tx-account', s.account_id)) done.push(kind === 'transfer' ? 'source account' : 'account');
      if (kind === 'transfer' && !toTouched && s.to_account_id !== +$('#tx-account', m).value && pick('#tx-to', s.to_account_id)) done.push('destination');
      if (s.amount && !$('#tx-amount', m).value) { $('#tx-amount', m).value = moneyInput(s.amount); markSuggested($('#tx-amount', m)); done.push('amount'); }
      note(done.length ? `✨ ${done.join(', ').replace(/^./, (c) => c.toUpperCase())} as last time: check and edit if needed` : '');
    } catch { /* ignore */ }
  }

  async function save(again) {
    const amount = parseMoney($('#tx-amount', m).value);
    if (!amount || Number.isNaN(amount)) { toast('Enter a valid amount', 'err'); $('#tx-amount', m).focus(); return; }
    const body = {
      kind, amount, date: $('#tx-date', m).value, account_id: +$('#tx-account', m).value,
      to_account_id: kind === 'transfer' ? +$('#tx-to', m).value : null,
      category_id: kind === 'transfer' ? null : ($('#tx-cat', m).value ? +$('#tx-cat', m).value : null),
      description: desc.value.trim(), notes: $('#tx-notes', m).value.trim(), excluded: $('#tx-excl', m).checked,
    };
    try {
      let res;
      try { res = await api(editing ? `/transactions/${t.id}` : '/transactions', { method: editing ? 'PUT' : 'POST', body }); } catch (e) {
        if (e.status !== 409 || !e.data?.duplicate) throw e;  // same account, type and amount a few days apart: maybe already entered or imported
        const dd = e.data.duplicate;
        if (!(await confirmDialog(`This account already has a transaction of ${money(body.amount)} on ${fmtDate(dd.date)}${dd.description ? ` («${dd.description}»)` : ''}. Record it anyway?`,
          { ok: 'Record anyway', danger: false, title: 'Possible duplicate transaction' }))) { txModal({ ...body, id: undefined }); return; }  // reopens the dialog with the data
        res = await api('/transactions', { method: 'POST', body: { ...body, force: true } });
      }
      if (res.warning) toast(res.warning, 'info');
      else toast(editing ? 'Transaction updated' : 'Transaction recorded ✓');
      await loadMeta();
      if (again) { txModal(null, { kind, date: body.date, account_id: body.account_id }); } else closeModal();
      route();
    } catch (e) { fail(e); }
  }
  $('#tx-save', m).onclick = () => save(false);
  if (!editing) $('#tx-save-new', m).onclick = () => save(true);
  if (editing) $('#tx-del', m).onclick = () => deleteTx(t);
  m.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(false); } });
}

// ================================================================ accounts
async function renderConti(v) {
  const worth = (a) => a.market_value ?? a.balance;  // investment accounts: market value
  const total = activeAccounts().reduce((s, a) => s + worth(a), 0);
  const card = (a) => `<div class="acc-card clickable-card ${a.archived ? 'archived' : ''}" style="--acc:${esc(a.color)}" ${txLink({ account_id: a.id }, `Transactions ${a.name}`)}>
      <div class="acc-top"><span class="acc-icon">${esc(a.icon)}</span><span class="acc-type" title="${esc(ACC_BEHAVIOR[accGroup(a.type)].title)}">${ACC_BEHAVIOR[accGroup(a.type)].icon} ${esc(ACC_TYPES[a.type] || a.type)}</span></div>
      <div class="acc-name">${esc(a.name)}</div>
      <div class="acc-bal">${money(worth(a))}</div>
      <div class="small" style="opacity:.8">${a.market_value != null ? `market value · cash ${money(a.balance)}` : `${a.tx_count} transactions · opening balance ${money(a.initial_balance)}`}</div>
      <div class="acc-actions">
        <button data-acc-tx="${a.id}">📄 Transactions</button>
        ${a.archived ? '' : `<button data-acc-transfer="${a.id}">🔄 Transfer</button>`}
        <button data-acc-edit="${a.id}">✏️ Edit</button>
      </div></div>`;
  const archived = S.accounts.filter((a) => a.archived);
  v.innerHTML = `
    <div class="toolbar">
      <span class="chip">💎 Total net worth <b>${money(total)}</b></span>
      <span class="spacer"></span>
      <button class="btn" id="acc-transfer">🔄 Transfer</button>
      <button class="btn btn-primary" id="acc-new">＋ New account</button>
    </div>
    <div class="acc-grid">${activeAccounts().map(card).join('')}<button class="acc-add" id="acc-add">＋ Add an account</button></div>
    ${archived.length ? `<div class="section-title">Archived</div><div class="acc-grid">${archived.map(card).join('')}</div>` : ''}
    <div class="grid-2" style="margin-top:22px">
      <div class="card"><div class="card-head"><h3>Net worth breakdown</h3></div><div class="chart-box"><canvas id="c-acc"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>How it works</h3></div>
        <div class="list">
          <div class="list-item"><div class="cat-ico" style="--c:#6366f1">🏦</div><div class="grow">Every transaction belongs to an account: the balance is the opening balance plus income minus expenses.</div></div>
          <div class="list-item"><div class="cat-ico" style="--c:#0ea5e9">🔄</div><div class="grow"><b>Transfers</b> move money between accounts (e.g. current → savings, card top-up) without counting as spending.</div></div>
          <div class="list-item"><div class="cat-ico" style="--c:#f59e0b">🗄️</div><div class="grow">A closed account can be <b>archived</b>: it stays in the history but no longer appears in the choices.</div></div>
        </div></div>
    </div>`;
  $('#acc-new').onclick = $('#acc-add').onclick = () => accountModal();
  $('#acc-transfer').onclick = () => txModal(null, { kind: 'transfer' });
  $$('[data-acc-edit]').forEach((b) => (b.onclick = () => accountModal(S.accounts.find((a) => a.id === +b.dataset.accEdit))));
  $$('[data-acc-transfer]').forEach((b) => (b.onclick = () => txModal(null, { kind: 'transfer', account_id: +b.dataset.accTransfer })));
  $$('[data-acc-tx]').forEach((b) => (b.onclick = () => { location.hash = '#/movimenti?account_id=' + b.dataset.accTx; }));
  const accs = activeAccounts().filter((a) => worth(a) > 0);
  chart($('#c-acc'), {
    type: 'bar',
    data: { labels: accs.map((a) => a.name), datasets: [{ label: 'Balance', data: accs.map(worth), backgroundColor: accs.map((a) => a.color), borderRadius: 10, maxBarThickness: 46 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: moneyAxis, y: { grid: { display: false } } } },
  });
}

function swatchPicker(id, value) {
  return `<div class="swatches" id="${id}">${PALETTE.map((c) => `<span class="swatch ${c === value ? 'on' : ''}" data-c="${c}" style="--c:${c}"></span>`).join('')}
    <input type="color" value="${esc(value)}" style="width:44px;height:30px;padding:0;border-radius:8px"></div>`;
}
function bindSwatches(root, onPick) {
  let val;
  $$('.swatch', root).forEach((s) => (s.onclick = () => { $$('.swatch', root).forEach((x) => x.classList.remove('on')); s.classList.add('on'); val = s.dataset.c; $('input', root).value = val; onPick && onPick(val); }));
  $('input', root).oninput = (e) => { $$('.swatch', root).forEach((x) => x.classList.remove('on')); val = e.target.value; onPick && onPick(val); };
  return () => val || $('input', root).value;
}
// picker list: the suggestions + the icons currently in use (categories, accounts, spaces) and the current one; an icon
// no longer used by anyone and not among the suggestions disappears on its own
function emojiChoices(value) {
  const used = [...S.categories, ...(S.allAccounts.length ? S.allAccounts : S.accounts), ...S.portfolios].map((x) => x.icon);
  return [...new Set([...EMOJIS, ...used, value].filter((e) => e && e.trim()))];
}
function emojiPicker(id, value) {
  return `<div class="emoji-pick" id="${id}">${emojiChoices(value).map((e) => `<button type="button" class="${e === value ? 'on' : ''}">${e}</button>`).join('')}
    <input maxlength="8" value="${esc(value)}" style="width:70px;text-align:center" title="Or type an emoji"></div>`;
}
function bindEmoji(root) {
  const on = $('button.on', root);  // current icon visible even if it is at the end of the list
  if (on) requestAnimationFrame(() => { root.scrollTop = on.getBoundingClientRect().top - root.getBoundingClientRect().top - 50; });
  $$('button', root).forEach((b) => (b.onclick = () => { $$('button', root).forEach((x) => x.classList.remove('on')); b.classList.add('on'); $('input', root).value = b.textContent; }));
  return () => $('input', root).value.trim();
}

// account behavior by type (must mirror the server: tools.INVEST, savings, emergency, market_values)
const accGroup = (t) => (t === 'investimenti' ? 'invest' : t === 'credito' ? 'credit' : 'cash');
const ACC_BEHAVIOR = {
  cash: { icon: '💧', title: 'cash account', points: [
    'The <b>balance</b> is available cash and counts toward net worth and the <b>emergency fund</b>',
    '<b>Income</b> and <b>expenses</b> count in reports, budgets and the month\'s savings',
    'Transfers to your other accounts move money without being expenses'] },
  credit: { icon: '💳', title: 'credit card', points: [
    'Expenses count as <b>spending</b> at the time of purchase',
    'The balance (usually negative) is the card debt; the statement charged to your account is paid with a transfer to the card',
    'It counts toward net worth as cash (even when negative)'] },
  invest: { icon: '📈', title: 'investment account', points: [
    'The <b>value</b> is the market value: cash + securities (from trades and updated prices) or values entered by hand',
    'Incoming transfers are <b>contributions</b> (capital put in), not expenses; the gain is value − invested',
    'Buying and selling securities counts as <b>invested</b>; <b>money market</b> ETFs are cash',
    'Money market securities and broker cash count toward the <b>emergency fund</b>; the rest does not'] },
};
// type suggested from the account name (the choice can still be changed)
const ACC_GUESS = [
  ['investimenti', /degiro|directa|fineco ?trading|scalable|trade ?republic|interactive|ibkr|etoro|moneyfarm|satispay ?invest|broker|pac\b|etf|fondo|pension|allianz|azimut|bit ?panda|coinbase|binance|crypto|azioni|dossier|titoli|invest|stocks|shares|brokerage/i],
  ['credito', /carta di credito|credit|amex|american express|visa|mastercard|nexi/i],
  ['prepagata', /prepagat|prepaid|satispay|paypal|edenred|ticket|buoni|voucher|hype|postepay|revolut card|pluxee/i],
  ['contanti', /contant|cash|portafoglio|wallet|materasso/i],
  ['risparmio', /risparmi|saving|deposito|deposit|conto arancio|salvadanaio|piggy|vincolat|revolut|sogni/i],
];
const guessAccountType = (name) => ACC_GUESS.find(([, re]) => re.test(name || ''))?.[0] || null;
// type change that moves the account between cash and investments: the only one that changes the calculations (the other types are all cash)
const ACC_SHIFT = {
  toInvest: ['The balance stops being cash: it leaves the <b>emergency fund</b> and net worth uses the <b>market value</b>',
    'Incoming transfers become <b>contributions</b> (invested capital) and the gain is calculated on them',
    'Transactions already recorded stay the same, but the <b>savings</b> and <b>invested</b> amounts of past months are recalculated'],
  toCash: ['The account goes back to <b>cash</b>: it joins the emergency fund and counts with its book balance, no longer its market value',
    'The <b>valuations</b> you entered are no longer used and the account disappears from Investments (return, XIRR, allocation)',
    'Incoming transfers are no longer contributions: the <b>savings</b> and <b>invested</b> amounts of past months may change'],
};
const accShift = (from, to) => ((from === 'investimenti') === (to === 'investimenti') ? null : to === 'investimenti' ? 'toInvest' : 'toCash');

function accountModal(a = null, preset = {}) {
  const x = a || { name: '', type: 'corrente', color: PALETTE[Math.floor(Math.random() * PALETTE.length)], icon: '🏦', initial_balance: 0, ...preset };
  const m = openModal(a ? 'Edit account' : 'New account', `
    <div class="form-grid">
      <label class="field full">Name <input id="a-name" maxlength="60" value="${esc(x.name)}" placeholder="E.g. Main bank account, Prepaid card, Cash" autofocus></label>
      <label class="field">Type <select id="a-type">${Object.entries(ACC_TYPES).map(([k, l]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Opening balance <input id="a-init" inputmode="decimal" value="${x.initial_balance ? (x.initial_balance / 100).toFixed(2).replace('.', ',') : ''}" placeholder="0,00"></label>
      <div class="full acc-type-help" id="a-help"></div>
      <div class="field full">Color ${swatchPicker('a-color', x.color)}</div>
      <div class="field full">Icon ${emojiPicker('a-icon', x.icon)}</div>
      ${a ? `<label class="check full"><input type="checkbox" id="a-arch" ${x.archived ? 'checked' : ''}> Archived account (closed)</label>` : ''}
    </div>
    <div class="modal-foot">${a ? '<button class="btn btn-ghost left neg" id="a-del">🗑 Delete</button>' : ''}
      <button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="a-save">Save</button></div>`);
  const getColor = bindSwatches($('#a-color', m)), getIcon = bindEmoji($('#a-icon', m));
  // the type decides how the account behaves: explanation always visible and automatic suggestion from the name (editable)
  let typeTouched = !!a || !!preset.type;
  const help = (auto) => {
    const t = $('#a-type', m).value, g = ACC_BEHAVIOR[accGroup(t)];
    const shift = a && accShift(a.type, t);
    $('#a-help', m).innerHTML = `<div class="acc-help-head">${g.icon} <b>${esc(ACC_TYPES[t])}</b> · ${g.title}${auto ? ' <span class="tag ai">suggested from the name</span>' : ''}</div>
      <ul>${g.points.map((p) => `<li>${p}</li>`).join('')}</ul>
      ${shift ? `<div class="acc-shift-warn"><b>⚠️ Change of account group</b> (${shift === 'toInvest' ? 'cash → investments' : 'investments → cash'}): changes how the account counts in your data
        <ul>${ACC_SHIFT[shift].map((p) => `<li>${p}</li>`).join('')}</ul></div>` : ''}`;
  };
  $('#a-type', m).onchange = () => { typeTouched = true; help(); };
  $('#a-name', m).addEventListener('input', () => {
    if (typeTouched) return;
    const t = guessAccountType($('#a-name', m).value);
    if (t && t !== $('#a-type', m).value) { $('#a-type', m).value = t; help(true); }
  });
  help();
  $('[data-cancel]', m).onclick = closeModal;
  $('#a-save', m).onclick = async () => {
    // only changes between cash and investments change the calculations (e.g. prepaid → savings does not)
    const shift = a && accShift(a.type, $('#a-type', m).value);
    if (shift && !(await confirmDialog(
      `You are moving "${a.name}" from ${shift === 'toInvest' ? 'cash to investments' : 'investments to cash'} (${ACC_TYPES[a.type]} → ${ACC_TYPES[$('#a-type', m).value]}).
      Net worth, emergency fund, savings and invested amounts will be recalculated for past months too. Transactions are not changed and you can switch back at any time. Continue?`,
      { ok: 'Change account group', title: '⚠️ Change of account group' }))) return;
    const raw = $('#a-init', m).value.trim();
    let init = raw ? parseSignedMoney(raw) : 0;
    if (!Number.isFinite(init)) { toast('Invalid opening balance', 'err'); return; }
    const body = { name: $('#a-name', m).value, type: $('#a-type', m).value, color: getColor(), icon: getIcon(), initial_balance: init, archived: a ? $('#a-arch', m).checked : false };
    try { await api(a ? `/accounts/${a.id}` : '/accounts', { method: a ? 'PUT' : 'POST', body }); toast('Account saved'); closeModal(); refresh(); } catch (e) { fail(e); }
  };
  if (a) $('#a-del', m).onclick = async () => {
    if (!(await confirmDialog(`Delete the account "${a.name}"?`, { ok: 'Delete' }))) return;
    try { await api(`/accounts/${a.id}`, { method: 'DELETE' }); toast('Account deleted'); refresh(); } catch (e) { fail(e); }
  };
}

// ================================================================ recurring
async function renderRicorrenti(v) {
  const [list, up] = await Promise.all([api('/recurring'), api('/upcoming?days=60')]);
  const act = list.filter((r) => r.active);
  const fixedOut = act.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.monthly_equivalent, 0);
  const fixedIn = act.filter((r) => r.kind === 'income').reduce((s, r) => s + r.monthly_equivalent, 0);
  const debt = act.reduce((s, r) => s + (r.remaining_amount || 0), 0);
  const isPac = (r) => r.kind === 'transfer' && r.holding_id;
  const groups = [
    ['📈 Investment plans', list.filter(isPac), 'Each contribution automatically buys units of the chosen security at the day\'s estimated price: then verify the actual price in Investments.'],
    ['🏠 Mortgages & loans', list.filter((r) => r.installments)],
    ['📤 Recurring expenses', list.filter((r) => !r.installments && r.kind === 'expense')],
    ['📥 Recurring income', list.filter((r) => !r.installments && r.kind === 'income')],
    ['🔄 Scheduled transfers', list.filter((r) => !r.installments && r.kind === 'transfer' && !isPac(r))],
  ].filter(([, l]) => l.length);

  v.innerHTML = `
    <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="kpi g-rose"><div class="k-label">📤 Fixed monthly expenses</div><div class="k-value">${money(fixedOut)}</div><div class="k-sub">monthly equivalent</div></div>
      <div class="kpi g-emerald"><div class="k-label">📥 Fixed monthly income</div><div class="k-value">${money(fixedIn)}</div><div class="k-sub">margin ${money(fixedIn - fixedOut)}</div></div>
      <div class="kpi g-sky"><div class="k-label">🏦 Remaining debt</div><div class="k-value">${money(debt)}</div><div class="k-sub">installments still to pay</div></div>
    </div>
    <div class="toolbar"><span class="muted small">Payments that fall due are recorded automatically as transactions.</span><span class="spacer"></span>
      <button class="btn" id="r-run">⚡ Process due payments</button><button class="btn btn-primary" id="r-new">＋ New recurring item</button></div>
    <div class="grid-3-2">
      <div>${groups.length ? groups.map(([title, l, help]) => `<div class="section-title" style="margin-top:4px">${title}</div>${help ? `<p class="muted small" style="margin:-4px 0 10px">${help}</p>` : ''}<div class="rec-grid">${l.map(recCard).join('')}</div>`).join('')
        : `<div class="card empty"><div class="big">🔁</div><h3>No recurring items</h3><p>Set up your mortgage, loans, rent, subscriptions and salary: they will be recorded automatically every time they fall due.</p>
          <div class="actions"><button class="btn btn-primary" data-new>＋ Create the first one</button></div></div>`}</div>
      <div class="card" style="align-self:start"><div class="card-head"><h3>Next 60 days</h3><span class="muted">${up.length} due</span></div>
        <div class="list">${up.length ? up.slice(0, 20).map(upcomingItem).join('') : '<div class="empty">Nothing due</div>'}</div></div>
    </div>`;
  $('#r-new').onclick = () => recurringModal();
  $$('[data-new]', v).forEach((b) => (b.onclick = () => recurringModal()));
  $('#r-run').onclick = async () => { try { const r = await api('/recurring/run', { method: 'POST' }); toast(r.created ? `${r.created} transactions recorded` : 'No due payments to record', 'info'); refresh(); } catch (e) { fail(e); } };
  v.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    const r = list.find((x) => x.id === +b.dataset.id);
    if (b.dataset.r === 'edit') recurringModal(r);
    if (b.dataset.r === 'tx') location.hash = '#/movimenti?recurring_id=' + r.id;
    if (b.dataset.r === 'toggle') {
      try { await api(`/recurring/${r.id}`, { method: 'PUT', body: { ...r, active: !r.active } }); toast(r.active ? 'Recurring item paused' : 'Recurring item resumed', 'info'); refresh(); } catch (err) { fail(err); }
    }
  });
}

// ================================================================ due-date calendar
async function renderCalendario(v) {
  S.calMonths ||= '3';
  const d = await api('/calendar?months=' + S.calMonths);
  // two projections: with estimates (realistic, shown large) and with confirmed due dates only (cautious)
  let bal = d.start_liquidity, sure = d.start_liquidity;
  const items = d.items.map((x) => {
    bal += x.effect; if (!x.estimated) sure += x.effect;
    return { ...x, after: bal };
  });
  const sum = (f) => items.filter(f).reduce((s, x) => s + x.effect, 0);
  const plusSure = sum((x) => x.effect > 0 && !x.estimated), plusEst = sum((x) => x.effect > 0 && x.estimated);
  const minusSure = -sum((x) => x.effect < 0 && !x.estimated), minusEst = -sum((x) => x.effect < 0 && x.estimated);
  const plus = plusSure + plusEst, minus = -(minusSure + minusEst);
  const tagOf = (x) => !x.estimated ? '' : x.late ? `<span class="tag warn">expected since ${esc(fmtDate(x.nominal))}</span>`
    : x.source === 'expected' ? '<span class="tag">≈ variable amount</span>' : `<span class="tag">≈ estimated · ${x.months_seen} months out of ${d.history_months}</span>`;
  const byDay = {};
  items.forEach((x) => (byDay[x.date] ||= []).push(x));
  const [ty, tm] = d.today.split('-').map(Number);
  const months = Array.from({ length: +S.calMonths }, (_, i) => new Date(ty, tm - 1 + i, 1));
  const grid = (m) => {
    const y = m.getFullYear(), mo = m.getMonth(), days = new Date(y, mo + 1, 0).getDate(), off = (m.getDay() + 6) % 7;
    const cells = Array.from({ length: off }, () => '<div class="cal-cell empty"></div>');
    for (let dd = 1; dd <= days; dd++) {
      const iso = isoLocal(new Date(y, mo, dd)), its = byDay[iso] || [], net = its.reduce((s, x) => s + x.effect, 0);
      const est = its.some((x) => x.estimated);
      cells.push(`<div class="cal-cell ${iso === d.today ? 'today' : ''} ${iso < d.today ? 'past' : ''} ${its.length ? 'has' : ''} ${est && its.every((x) => x.estimated) ? 'est' : ''}" title="${esc(its.map((x) => `${x.estimated ? '≈ ' : ''}${x.name} ${money(x.amount)}`).join('\n'))}">
        <span class="cal-d">${dd}</span>${its.length ? `<span class="cal-ico ${its.length > 6 ? 'many' : ''}">${its.map((x) => `<span class="${x.estimated ? 'est' : ''}" title="${x.estimated ? '≈ estimated · ' : ''}${esc(x.name)} ${esc(money(x.amount))}">${esc(x.kind === 'transfer' ? '🔄' : x.category_icon || '🔁')}</span>`).join('')}</span>
        <span class="cal-net ${net > 0 ? 'pos' : net < 0 ? 'neg' : 'muted'}">${net ? (est ? '≈' : '') + (net > 0 ? '+' : '−') + money0(Math.abs(net)) : '↔'}</span>` : ''}</div>`);
    }
    return `<div class="cal-grid">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => `<div class="cal-w">${w}</div>`).join('')}${cells.join('')}</div>`;
  };
  const line = (x) => `<div class="list-item ${x.estimated ? 'cal-est' : ''}">${dateChip(x.date)}
    <div class="grow"><div class="title">${esc(x.name)} ${x.installment ? `<span class="tag">installment ${esc(x.installment)}</span>` : ''} ${tagOf(x)}</div>
      <div class="muted small">${esc(x.account_name || '')}${x.kind === 'transfer' ? ' → ' + esc(x.to_account_name || '') : ''}${x.incoming ? ' · from another space' : ''}</div></div>
    <div class="right"><b class="${x.effect > 0 ? 'pos' : x.effect < 0 ? 'neg' : 'muted'}">${x.estimated ? '≈ ' : ''}${x.effect ? (x.effect > 0 ? '+' : '−') + money(Math.abs(x.effect)) : '↔ ' + money(x.amount)}</b>
      <div class="muted small">balance ${money0(x.after)}</div></div></div>`;
  const split = (a, b, la, lb) => (b ? `<div class="k-split"><span class="k-li"><span>✔ ${la}</span><b>${money0(a)}</b></span><span class="k-li"><span>≈ ${lb}</span><b>${money0(b)}</b></span></div>` : '');
  v.innerHTML = `
    <div class="toolbar"><select id="cal-months">${[['1', 'This month'], ['3', 'Next 3 months'], ['6', 'Next 6 months'], ['12', 'Next 12 months']].map(([k, l]) => `<option value="${k}" ${k === S.calMonths ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted small">Due dates of active recurring items (including transfers coming in from other spaces). Cash = only the day-to-day accounts (current, savings, cards, cash), where the payments go through; the Emergency fund also counts broker cash and money market ETFs.</span></div>
    <div class="kpis">
      <div class="kpi g-indigo"><div class="k-label">💧 Cash in accounts today</div><div class="k-value">${money0(d.start_liquidity)}</div>
        <div class="k-sub" title="The emergency fund adds the uninvested broker cash and money market ETFs">day-to-day accounts, no broker · ${items.length} due</div></div>
      <div class="kpi g-emerald"><div class="k-label">📥 Coming in</div><div class="k-value">+${money0(plus)}</div>
        ${split(plusSure, plusEst, 'Confirmed (recurring items)', 'Estimated (variable and regular)') || '<div class="k-sub">incoming payments and contributions</div>'}</div>
      <div class="kpi g-rose"><div class="k-label">📤 Going out</div><div class="k-value">−${money0(-minus)}</div>
        ${split(minusSure, minusEst, 'Confirmed (recurring items)', 'Estimated (variable and regular)') || '<div class="k-sub">installments, bills, subscriptions, transfers</div>'}</div>
      <div class="kpi ${bal < 0 ? 'g-rose' : 'g-amber'}"><div class="k-label">🔮 Projected cash on ${esc(fmtDate(d.end))}</div><div class="k-value">${plusEst || minusEst ? '≈ ' : ''}${money0(bal)}</div>
        ${plusEst || minusEst ? `<div class="k-split"><span class="k-li"><span>✔ Confirmed only</span><b>${money0(sure)}</b></span><span class="k-li"><span>≈ Total with estimates</span><b>${money0(bal)}</b></span></div>`
          : '<div class="k-sub">confirmed due dates only</div>'}</div>
    </div>
    ${plusEst || minusEst ? `<p class="muted small" style="margin:-6px 0 14px">≈ <b>Estimated</b>, with the same method for income and expenses: variable recurring items (median of recent payments) and regular transactions without a recurring item, recognized from history (same payer or payee in at least ${d.regular_min} of the last ${d.history_months} months, ignoring month and year in the description; median monthly amount and day). Occasional expenses are not forecast; among estimated income only significant amounts are included (at least 50 € and 5% of the largest, so no account interest of a few euros). To track an item better, create a "variable amount" recurring item in Recurring.</p>` : ''}
    ${months.map((m) => {
      const key = isoLocal(m).slice(0, 7), its = items.filter((x) => x.date.startsWith(key));
      return `<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>${esc(fmtMonth(key))}</h3><span class="muted">${its.length} due</span></div>
        <div class="cal-wrap">${grid(m)}<div class="list">${its.length ? its.map(line).join('') : '<div class="empty">Nothing due</div>'}</div></div></div>`;
    }).join('')}`;
  $('#cal-months').onchange = (e) => { S.calMonths = e.target.value; route(); };
}

function recCard(r) {
  const pac = r.kind === 'transfer' && r.holding_id;
  const ico = pac ? '📈' : r.kind === 'transfer' ? '🔄' : r.category_icon || '🔁';
  const color = pac ? '#10b981' : r.kind === 'transfer' ? '#0ea5e9' : r.category_color || '#94a3b8';
  const status = !r.active ? '⏸ Paused' : r.late_since ? `⚠️ expected since ${fmtDate(r.late_since)}` : r.next_date ? `📅 ${r.expected ? '≈ ' : ''}${fmtDate(r.next_date)}` : '✅ Completed';
  const stat = (label, value) => `<div class="rec-stat"><span>${label}</span><b>${value}</b></div>`;
  const progress = r.installments
    ? `<div class="top small"><span>Installment <b>${r.paid}</b> of ${r.installments}</span><span class="muted">${pct(r.progress)}</span></div>
       <div class="bar"><i style="width:${(r.progress * 100).toFixed(1)}%"></i></div>`
    : r.expected ? `<div class="top small"><span>≈ Variable amount and date${r.match_text ? ` · «${esc(r.match_text)}»` : ''}</span><span class="muted">${r.generated} linked</span></div>
       <div class="bar bar-flat"></div>`
    : `<div class="top small"><span>Ongoing recurring item</span><span class="muted">${r.generated} recorded</span></div>
       <div class="bar bar-flat"></div>`;
  const stats = r.expected
    ? stat(r.expected_source === 'fixed' ? 'Expected (set)' : r.expected_source === 'set' ? 'Expected (typical)' : `Expected (median of ${r.expected_count})`, money(r.expected_amount))
      + stat('Range', r.expected_count > 1 ? `${money0(r.expected_min)}–${money0(r.expected_max)}` : '—') + stat('Last', r.last_date ? fmtDate(r.last_date) : '—')
    : r.installments
    ? stat('Remaining', money(r.remaining_amount)) + stat('Last installment', fmtDate(r.last_date)) + stat('Interest', r.principal ? (r.interest > 0 ? money(r.interest) : '0% rate') : '—')
    : stat('Per month', money(r.monthly_equivalent)) + stat('From', fmtDate(r.start_date)) + stat('Until', r.end_date ? fmtDate(r.end_date) : '—');
  return `<div class="card rec-card ${r.active ? '' : 'paused'}">
    <div class="rec-head"><div class="cat-ico" style="--c:${esc(color)}">${esc(ico)}</div>
      <div class="grow" style="min-width:0"><div class="title ellipsis" title="${esc(r.name)}">${esc(r.name)}</div>
      <div class="muted small ellipsis">${FREQ[r.frequency]} · ${esc(r.account_name)}${r.kind === 'transfer' ? ' → ' + esc(r.to_account_name) : ''}</div></div></div>
    ${pac ? `<div class="small" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="tag ai" title="Each contribution automatically buys units of the linked security">📈 Plan</span>
      <span>buys <b>${esc(r.holding_ticker || '')}</b> <span class="muted">${esc(r.holding_name || '')}</span></span>
      ${r.pac_unverified ? `<a class="tag warn" href="#/investimenti" title="Purchases with an estimated price for more than 30 days">⚠️ ${r.pac_unverified} price${r.pac_unverified === 1 ? '' : 's'} to verify</a>` : ''}</div>` : ''}
    <div class="rec-line"><span class="rec-amount amount ${r.kind}">${r.expected ? '≈ ' + money(r.expected_amount) : money(r.amount)}</span><span class="rec-next">${status}</span></div>
    <div class="rec-progress">${progress}</div>
    <div class="rec-stats">${stats}</div>
    <div class="rec-actions"><button class="btn btn-sm btn-ghost" data-r="tx" data-id="${r.id}">📄 Transactions</button>
      <button class="btn btn-sm btn-ghost" data-r="toggle" data-id="${r.id}">${r.active ? '⏸ Pause' : '▶ Resume'}</button>
      <button class="btn btn-sm" data-r="edit" data-id="${r.id}">✏️ Edit</button></div></div>`;
}

// cat: candidate category names, first match wins (English defaults, then the legacy Italian names of existing databases)
const PRESETS = [
  { label: '🏠 Mortgage', name: 'Home mortgage', kind: 'expense', cat: ['Mortgage & loans', 'Mutuo e finanziamenti', 'Mutuo / Affitto'], frequency: 'monthly', installments: 240 },
  { label: '🔑 Rent', name: 'Rent', kind: 'expense', cat: ['Home & furniture', 'Casa e arredo', 'Mutuo / Affitto'], frequency: 'monthly' },
  { label: '🛋️ Furniture loan', name: 'Furniture loan', kind: 'expense', cat: ['Home & furniture', 'Casa e arredo', 'Arredamento'], frequency: 'monthly', installments: 24 },
  { label: '🚗 Car loan', name: 'Car loan', kind: 'expense', cat: ['Transport', 'Trasporti', 'Auto & Carburante'], frequency: 'monthly', installments: 48 },
  { label: '💡 Bill', name: 'Electricity/gas bill', kind: 'expense', cat: ['Utilities', 'Utenze', 'Bollette'], frequency: 'bimonthly' },
  { label: '📺 Subscription', name: 'Subscription', kind: 'expense', cat: ['Subscriptions', 'Abbonamenti'], frequency: 'monthly' },
  { label: '🛡️ Insurance', name: 'Insurance', kind: 'expense', cat: ['Bank & insurance', 'Banca e assicurazioni', 'Assicurazioni'], frequency: 'yearly' },
  { label: '💼 Salary', name: 'Salary', kind: 'income', cat: ['Salary', 'Stipendio'], frequency: 'monthly' },
  { label: '🐷 Automatic savings', name: 'Savings deposit', kind: 'transfer', frequency: 'monthly' },
];

function recurringModal(r = null) {
  const x = r || { kind: 'expense', frequency: 'monthly', start_date: todayIso(), account_id: activeAccounts()[0]?.id };
  const m = openModal(r ? 'Edit recurring item' : 'New recurring item', `
    ${r ? '' : `<div class="presets">${PRESETS.map((p, i) => `<button type="button" data-p="${i}">${p.label}</button>`).join('')}</div>`}
    <div class="seg" id="r-kind" style="margin-bottom:16px">${Object.entries(KIND_LABEL).map(([k, l]) => `<button type="button" data-kind="${k}">${l}</button>`).join('')}</div>
    <div class="form-grid">
      <label class="field">Name <input id="r-name" maxlength="80" value="${esc(x.name || '')}" placeholder="E.g. Home mortgage" autofocus>${r ? '' : '<span id="r-sugg-note" class="sugg-note hidden"></span>'}</label>
      <label class="field">Amount per payment <input id="r-amount" inputmode="decimal" value="${moneyInput(x.amount)}" placeholder="0,00"></label>
      <label class="field">Frequency <select id="r-freq">${Object.entries(FREQ).map(([k, l]) => `<option value="${k}" ${x.frequency === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">First due date <input id="r-start" type="date" value="${esc(x.start_date)}"></label>
      <label class="field"><span id="r-acc-label">Account</span><select id="r-account">${accountOptions(x.account_id)}</select></label>
      <label class="field" id="r-to-wrap">To account <select id="r-to">${transferOptions(x.to_account_id || activeAccounts()[1]?.id)}</select></label>
      <label class="field" id="r-cat-wrap">Category <select id="r-cat"></select></label>
      <div class="field full var-box" id="r-var-wrap">
        <label class="check"><input type="checkbox" id="r-var" ${x.expected ? 'checked' : ''}> <b>Variable amount and date</b>
          <span class="muted small">(e.g. salary, commissions, usage-based bills)</span></label>
        <div id="r-var-help" class="muted small">HomeCoin <b>does not record</b> transactions on its own: when the real one arrives (entered or imported) it links it
          to this recurring item if the description contains the keyword and the amount is plausible. The amount and day expected in the Calendar
          are the median of recent payments; the typical amount applies only until there are any, or always if you tick the option below. If it is more than a week late, you get a warning.
          <label class="field" style="margin-top:8px">Keyword in the description <input id="r-match" maxlength="60" value="${esc(x.match_text || '')}" placeholder="E.g. the employer's name (empty = the recurring item's name)"></label>
          <label class="check" style="margin-top:4px"><input type="checkbox" id="r-fixed" ${x.amount_fixed ? 'checked' : ''}> <b>Always expect the typical amount</b>
            <span class="muted small">instead of the median of recent payments${x.expected_median ? ` (currently ${money(x.expected_median)})` : ''}: useful after an increase or a change, until the median catches up</span></label>
          <span>To also link past transactions, set the first due date a few months back.</span></div></div>
      <label class="field full hidden" id="r-pac-wrap">Investment plan: each contribution automatically buys units of
        <select id="r-pac"><option value="">— no automatic purchase (transfer only)</option></select>
        <span class="muted small">Units are calculated from the amount and the last known price; the trade can still be edited in Investments. Without a known price the purchase goes among those "to complete".</span></label>
      <label class="field">Number of installments <input id="r-inst" type="number" min="1" value="${x.installments || ''}" placeholder="Empty = no end"></label>
      <label class="field">Amount financed <input id="r-principal" inputmode="decimal" value="${moneyInput(x.principal)}" placeholder="Optional (for the interest calculation)"></label>
      <div class="field full rate-box"><span>Loan interest rate <span class="muted small">(for the amortization schedule; excluding APR and additional costs)</span></span>
        <div class="rate-grid">
          <label class="field">Type <select id="r-rtype">${[['', '— not specified'], ['fixed', 'Fixed'], ['variable', 'Variable'], ['mixed', 'Mixed']].map(([k, l]) =>
            `<option value="${k}" ${(x.rate_type || (x.rate != null ? 'fixed' : '')) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field" data-rt="fixed mixed">Fixed rate (%) <input id="r-rate" inputmode="decimal" value="${x.rate != null ? String(x.rate).replace('.', ',') : ''}" placeholder="3"></label>
          <label class="field" data-rt="mixed">Fixed for (years) <input id="r-fyears" type="number" min="1" max="40" value="${x.fixed_years ?? ''}" placeholder="5"></label>
          <label class="field" data-rt="variable mixed">Index <select id="r-index">${['Euribor 1M', 'Euribor 3M', 'Euribor 6M', 'Euribor 12M'].map((i) => `<option ${(x.rate_index || 'Euribor 3M') === i ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
          <label class="field" data-rt="variable mixed">Spread (%) <input id="r-spread" inputmode="decimal" value="${x.spread != null ? String(x.spread).replace('.', ',') : ''}" placeholder="1,6"></label>
          <label class="field" data-rt="variable mixed">Current index value (%) <input id="r-ivalue" inputmode="decimal" value="${x.index_value != null ? String(x.index_value).replace('.', ',') : ''}" placeholder="optional"></label>
        </div></div>
      <label class="field">Ends on <input id="r-end" type="date" value="${esc(x.end_date || '')}"></label>
      <label class="field full">Notes <textarea id="r-notes" maxlength="1000">${esc(x.notes || '')}</textarea></label>
      ${r ? '' : `<label class="check full"><input type="checkbox" id="r-past"> Also record past due dates as transactions
        <span class="muted small">(otherwise they are only counted as paid)</span></label>`}
    </div>
    <div class="modal-foot">${r ? '<button class="btn btn-ghost left neg" id="r-del">🗑 Delete</button>' : ''}
      <button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="r-save">Save</button></div>`, { wide: true });

  let kind = x.kind, pacHoldings = null;
  // investment plan: available when the transfer goes to an investment account that holds securities
  const drawPac = async () => {
    const to = S.accounts.find((a) => a.id === +$('#r-to', m).value);
    const on = kind === 'transfer' && to && to.type === 'investimenti' && featureOn('investimenti');
    $('#r-pac-wrap', m).classList.toggle('hidden', !on);
    if (!on) return;
    if (!pacHoldings) {
      try { pacHoldings = Object.fromEntries((await api('/investments?months=1')).accounts.map((a) => [a.id, a.holdings])); } catch { pacHoldings = {}; }
    }
    const hs = (pacHoldings[to.id] || []).filter((h) => h.quantity > 0 || h.trades);
    $('#r-pac', m).innerHTML = `<option value="">— no automatic purchase (transfer only)</option>` +
      hs.map((h) => `<option value="${h.id}" ${h.id === x.holding_id ? 'selected' : ''}>${esc(h.ticker)} · ${esc(h.name)}${h.asset_class === 'monetario' ? ' (money market)' : ''}</option>`).join('');
  };
  $('#r-to', m).addEventListener('change', drawPac);
  const draw = (cat) => {
    $$('#r-kind button', m).forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
    drawPac();
    $('#r-to-wrap', m).classList.toggle('hidden', kind !== 'transfer');
    $('#r-cat-wrap', m).classList.toggle('hidden', kind === 'transfer');
    $('#r-acc-label', m).textContent = kind === 'transfer' ? 'From account' : 'Account';
    $('#r-cat', m).innerHTML = kind === 'transfer' ? '' : categoryOptions(kind, cat ?? $('#r-cat', m).value ?? x.category_id);
    syncVar();
  };
  // variable amount: only income and expenses without installments; hides what is not needed (installments, rate, record past)
  const syncVar = () => {
    const can = kind !== 'transfer' && !$('#r-inst', m).value;
    $('#r-var-wrap', m).classList.toggle('hidden', !can);
    const on = can && $('#r-var', m).checked;
    $('#r-var-help', m).classList.toggle('hidden', !on);
    $('#r-amount', m).closest('label').firstChild.textContent = on ? 'Typical amount ' : 'Amount per payment ';
    ['#r-inst', '#r-principal'].forEach((s) => $(s, m).closest('label').classList.toggle('hidden', on));
    $('.rate-box', m).classList.toggle('hidden', on);
    $('#r-past', m)?.closest('label').classList.toggle('hidden', on);
  };
  $('#r-var', m).onchange = syncVar;
  $('#r-inst', m).addEventListener('input', syncVar);
  $$('#r-kind button', m).forEach((b) => (b.onclick = () => { kind = b.dataset.kind; draw(); }));
  draw(x.category_id);
  $$('[data-p]', m).forEach((b) => (b.onclick = () => {
    const p = PRESETS[+b.dataset.p];
    kind = p.kind;
    $('#r-name', m).value = p.name;
    $('#r-freq', m).value = p.frequency;
    $('#r-inst', m).value = p.installments || '';
    draw([].concat(p.cat || []).map((n) => S.categories.find((c) => c.name === n && c.kind === p.kind)).find(Boolean)?.id || '');
    $('#r-amount', m).focus();
  }));
  if (!r) {  // new recurring item: suggests transactions already seen and, once one is picked, takes its type, category, accounts and amount
    const KIND_ICO = { expense: '📤', income: '📥', transfer: '🔄' };
    autocomplete($('#r-name', m), {
      load: async (q) => {
        const seen = new Set();
        return (await api('/descriptions?' + qs({ q, full: 1 }))).filter((d) => !seen.has(d.name) && seen.add(d.name))
          .map((d) => ({ value: d.name, label: `${KIND_ICO[d.kind]} ${d.name}`, meta: acMeta(d), d }));
      },
      onPick: async ({ d }) => {
        try {
          const s = await api('/suggest?' + qs({ description: d.description, kind: d.kind }));
          kind = d.kind;
          draw(s.category_id || '');
          if (s.category_id) markSuggested($('#r-cat', m));
          if (s.account_id && $(`#r-account option[value="${s.account_id}"]`, m)) { $('#r-account', m).value = s.account_id; markSuggested($('#r-account', m)); }
          if (s.to_account_id && $(`#r-to option[value="${s.to_account_id}"]`, m)) { $('#r-to', m).value = s.to_account_id; markSuggested($('#r-to', m)); drawPac(); }
          if (s.amount && !$('#r-amount', m).value) { $('#r-amount', m).value = moneyInput(s.amount); markSuggested($('#r-amount', m)); }
          const n = $('#r-sugg-note', m);
          n.textContent = '✨ Filled in like the last transaction: check the first due date and the frequency';
          n.classList.remove('hidden');
        } catch { /* suggestions are not essential */ }
      },
    });
  }
  const syncRate = () => {  // show only the fields of the chosen rate type
    const t = $('#r-rtype', m).value;
    $$('[data-rt]', m).forEach((el) => el.classList.toggle('hidden', !t || !el.dataset.rt.split(' ').includes(t)));
  };
  $('#r-rtype', m).onchange = syncRate; syncRate();
  $('[data-cancel]', m).onclick = closeModal;
  $('#r-save', m).onclick = async () => {
    const amount = parseMoney($('#r-amount', m).value);
    if (!amount || Number.isNaN(amount)) { toast('Enter the amount', 'err'); return; }
    const body = {
      name: $('#r-name', m).value, kind, amount, frequency: $('#r-freq', m).value, start_date: $('#r-start', m).value,
      account_id: +$('#r-account', m).value, to_account_id: kind === 'transfer' ? +$('#r-to', m).value : null,
      category_id: kind !== 'transfer' && $('#r-cat', m).value ? +$('#r-cat', m).value : null,
      installments: $('#r-inst', m).value || null, principal: parseMoney($('#r-principal', m).value) || null,
      rate_type: $('#r-rtype', m).value || null, rate: $('#r-rate', m).value.trim() || null,
      fixed_years: $('#r-fyears', m).value || null, rate_index: $('#r-index', m).value,
      spread: $('#r-spread', m).value.trim() || null, index_value: $('#r-ivalue', m).value.trim() || null,
      end_date: $('#r-end', m).value || null, notes: $('#r-notes', m).value, active: r ? !!r.active : true,
      post_past: !r && $('#r-past', m).checked,
      holding_id: kind === 'transfer' && !$('#r-pac-wrap', m).classList.contains('hidden') && $('#r-pac', m).value ? +$('#r-pac', m).value : null,
      expected: !$('#r-var-wrap', m).classList.contains('hidden') && $('#r-var', m).checked, match_text: $('#r-match', m).value.trim(),
      amount_fixed: $('#r-fixed', m).checked,
    };
    if (body.expected) Object.assign(body, { installments: null, principal: null, rate_type: null, rate: null, post_past: false });
    try {
      const res = await api(r ? `/recurring/${r.id}` : '/recurring', { method: r ? 'PUT' : 'POST', body });
      toast(res.created ? `Recurring item saved · ${res.created} transactions recorded` : 'Recurring item saved');
      closeModal(); refresh();
    } catch (e) { fail(e); }
  };
  if (r) $('#r-del', m).onclick = async () => {
    // variable amount: the linked transactions are the real ones (imported or entered), so they always stay
    const mm = openModal('Delete the recurring item?', r.expected
      ? `<p>You are about to delete <b>${esc(r.name)}</b>. The ${r.generated} linked transactions are the real ones and <b>are kept</b>: they are only unlinked.</p>
        <div class="modal-foot"><button class="btn" data-no>Cancel</button><button class="btn btn-danger" data-keep>Delete the recurring item</button></div>`
      : `<p>You are about to delete <b>${esc(r.name)}</b>. What should happen to the transactions already recorded?</p>
      <div class="modal-foot"><button class="btn" data-no>Cancel</button><button class="btn" data-keep>Keep the transactions</button>
      <button class="btn btn-danger" data-all>Delete the transactions too</button></div>`);
    const go = async (all) => { try { await api(`/recurring/${r.id}${all ? '?with_transactions=1' : ''}`, { method: 'DELETE' }); toast('Recurring item deleted'); closeModal(); refresh(); } catch (e) { fail(e); } };
    $('[data-no]', mm).onclick = closeModal;
    $('[data-keep]', mm).onclick = () => go(false);
    $('[data-all]', mm)?.addEventListener('click', () => go(true));
  };
}

// ================================================================ import
async function renderImport(v) {
  const I = S.imp;
  const steps = ['Upload file', 'Columns', 'Review', 'Done'];
  const stepper = `<div class="steps">${steps.map((s, i) => `<div class="step ${I.step === i + 1 ? 'on' : I.step > i + 1 ? 'done' : ''}"><i>${I.step > i + 1 ? '✓' : i + 1}</i>${s}</div>`).join('')}</div>`;

  if (I.step === 1) {
    v.innerHTML = `${stepper}
      <div class="grid-3-2"><div class="card">
        <label class="dropzone" id="drop"><input type="file" id="file" accept=".csv,.txt,.tsv,.xlsx,.xlsm" hidden>
          <div class="big">📥</div><h3>Drag your bank statement here</h3><p class="muted">or click to choose a file · CSV, TXT, XLSX</p></label>
      </div>
      <div class="card"><div class="card-head"><h3>How it works</h3></div><div class="list">
        <div class="list-item"><div class="cat-ico" style="--c:#6366f1">1️⃣</div><div class="grow">Export your transactions from online banking as <b>CSV or Excel</b>.</div></div>
        <div class="list-item"><div class="cat-ico" style="--c:#8b5cf6">2️⃣</div><div class="grow">HomeCoin <b>recognizes the columns</b> (date, description, amount or money in/out).</div></div>
        <div class="list-item"><div class="cat-ico" style="--c:#ec4899">3️⃣</div><div class="grow">Categories are <b>filled in automatically</b> from rules and history, and <b>duplicates</b> are flagged.</div></div>
        <div class="list-item"><div class="cat-ico" style="--c:#10b981">🔒</div><div class="grow">The file is processed only on your PC.</div></div>
      </div></div></div>`;
    const drop = $('#drop'), input = $('#file');
    const upload = async (file) => {
      if (!file) return;
      const fd = new FormData(); fd.append('file', file);
      drop.innerHTML = '<div class="loading">Reading the file…</div>';
      try {
        I.upload = await api('/import/upload', { method: 'POST', body: fd });
        I.mapping = { ...I.upload.mapping };
        I.account_id = I.account_id || activeAccounts()[0]?.id;
        I.invert = false; I.step = 2; route();
      } catch (e) { fail(e); route(); }
    };
    input.onchange = () => upload(input.files[0]);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => upload(e.dataTransfer.files[0]));
    return;
  }

  if (I.step === 2) {
    const u = I.upload;
    const fields = [['date', '📅 Date *'], ['description', '📝 Description'], ['amount', '💶 Amount (signed)'], ['debit', '📤 Money out / Debits'], ['credit', '📥 Money in / Credits'], ['category', '🏷️ Category']];
    const opt = (sel) => `<option value="">— none —</option>` + u.headers.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h)}</option>`).join('');
    const mapped = new Set(Object.values(I.mapping).filter((x) => x != null));
    v.innerHTML = `${stepper}
      <div class="card" style="margin-bottom:18px"><div class="card-head"><h3>📄 ${esc(u.filename)}</h3><span class="muted">${u.total} rows found</span></div>
        <div class="map-grid">${fields.map(([k, l]) => `<label class="field">${l}<select data-map="${k}">${opt(I.mapping[k])}</select></label>`).join('')}</div>
        <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
          <label class="field">Import into account <select id="i-acc">${accountOptions(I.account_id)}</select></label>
          <label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="i-inv" ${I.invert ? 'checked' : ''}> Invert the sign (e.g. credit card statements)</label>
        </div>
        <p class="muted small">Use <b>Amount</b> if the file has a single column with positive/negative values, or <b>Money out</b> + <b>Money in</b> if they are separate.</p>
      </div>
      <div class="card" style="padding:8px"><div class="table-wrap"><table class="preview-table"><thead><tr>${u.headers.map((h, i) => `<th class="${mapped.has(i) ? 'mapped' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${u.preview.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="modal-foot"><button class="btn" id="i-back">← Another file</button><button class="btn btn-primary" id="i-next">Analyze transactions →</button></div>`;
    $$('[data-map]').forEach((s) => (s.onchange = () => { I.mapping[s.dataset.map] = s.value === '' ? null : +s.value; }));
    $('#i-acc').onchange = (e) => (I.account_id = +e.target.value);
    $('#i-inv').onchange = (e) => (I.invert = e.target.checked);
    $('#i-back').onclick = () => { I.step = 1; route(); };
    $('#i-next').onclick = async () => {
      try {
        const res = await api('/import/analyze', { method: 'POST', body: { token: u.token, mapping: I.mapping, account_id: I.account_id, invert: I.invert } });
        I.rows = res.rows.map((r) => ({ ...r, include: !r.error && !r.duplicate }));
        I.step = 3; route();
      } catch (e) { fail(e); }
    };
    return;
  }

  if (I.step === 3) {
    const rows = I.rows;
    const draw = () => {
      const inc = rows.filter((r) => r.include);
      $('#i-sum').innerHTML = `<span class="chip">✅ <b>${inc.length}</b> to import</span>
        <span class="chip">♻️ <b>${rows.filter((r) => r.duplicate).length}</b> duplicates</span>
        <span class="chip">⚠️ <b>${rows.filter((r) => r.error).length}</b> invalid</span>
        <span class="chip">❔ <b>${inc.filter((r) => !r.category_id).length}</b> uncategorized</span>
        <span class="chip">📥 <b class="pos">${money(inc.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0))}</b></span>
        <span class="chip">📤 <b class="neg">${money(inc.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amount, 0))}</b></span>`;
      $('#i-go').textContent = `Import ${inc.length} transactions`;
      $('#i-go').disabled = !inc.length;
    };
    v.innerHTML = `${stepper}
      <div class="toolbar"><div class="summary-chips" id="i-sum" style="margin:0"></div></div>
      <div class="card" style="padding:6px 8px"><div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="review-table">
        <thead><tr><th><input type="checkbox" id="i-all" checked></th><th>Date</th><th>Description</th><th class="right">Amount</th><th>Category</th><th></th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr data-i="${i}" class="${r.duplicate ? 'dup' : ''} ${r.include ? '' : 'excluded'}">
          <td><input type="checkbox" ${r.include ? 'checked' : ''} ${r.error ? 'disabled' : ''}></td>
          <td class="num small">${r.date ? fmtDate(r.date) : '—'}</td>
          <td><div class="desc" title="${esc(r.description)}">${esc(r.description || '—')}</div></td>
          <td class="amount ${r.kind}">${r.amount ? signedAmount(r) : '—'}</td>
          <td>${r.error ? '' : `<select data-cat>${categoryOptions(r.kind, r.category_id, '❔ Uncategorized')}</select>`}</td>
          <td>${r.error ? `<span class="tag err">${esc(r.error)}</span>` : ''}${r.duplicate ? '<span class="tag warn">already present</span>' : ''}
            ${r.category_source && r.category_source !== 'file' ? `<span class="tag ai" title="Category suggested automatically">✨ ${esc({ regola: 'rule', storico: 'history' }[r.category_source] || r.category_source)}</span>` : ''}</td></tr>`).join('')}</tbody>
      </table></div></div>
      <div class="modal-foot"><button class="btn" id="i-back">← Columns</button><button class="btn btn-primary" id="i-go"></button></div>`;
    draw();
    $('#i-all').onchange = (e) => {
      rows.forEach((r, i) => { if (!r.error) { r.include = e.target.checked; const tr = $(`tr[data-i="${i}"]`); tr.classList.toggle('excluded', !r.include); $('input', tr).checked = r.include; } });
      draw();
    };
    $('tbody', v).addEventListener('change', (e) => {
      const tr = e.target.closest('tr'), r = rows[+tr.dataset.i];
      if (e.target.matches('input[type=checkbox]')) { r.include = e.target.checked; tr.classList.toggle('excluded', !r.include); }
      if (e.target.matches('[data-cat]')) {
        r.category_id = e.target.value ? +e.target.value : null;
        // apply the same choice to rows with an identical description that are still uncategorized
        let n = 0;
        rows.forEach((o, i) => {
          if (o !== r && !o.category_id && !o.error && o.kind === r.kind && o.description.toLowerCase() === r.description.toLowerCase()) {
            o.category_id = r.category_id; const sel = $(`tr[data-i="${i}"] [data-cat]`); if (sel) sel.value = r.category_id; n++;
          }
        });
        if (n) toast(`Category also applied to ${n} other identical transactions`, 'info');
      }
      draw();
    });
    $('#i-back').onclick = () => { I.step = 2; route(); };
    $('#i-go').onclick = async () => {
      try {
        const res = await api('/import/commit', { method: 'POST', body: { token: I.upload.token, account_id: I.account_id, rows: rows.filter((r) => r.include) } });
        I.result = res.imported; I.step = 4; await loadMeta(); route();
      } catch (e) { fail(e); }
    };
    return;
  }

  v.innerHTML = `${stepper}<div class="card empty"><div class="big">🎉</div><h3>${I.result} transactions imported</h3>
    <p>You can assign the missing categories from the Transactions page by filtering for “To categorize”.</p>
    <div class="actions"><a class="btn btn-primary" href="#/movimenti?category_id=none">View uncategorized</a><a class="btn" href="#/dashboard">Dashboard</a><button class="btn" id="i-again">Import another file</button></div></div>`;
  $('#i-again').onclick = () => { S.imp = { step: 1 }; route(); };
  S.imp = { step: 1, account_id: I.account_id };
}

// ================================================================ reports
async function renderReport(v) {
  // same periods as the dashboard; plus the previous years ("y:2025")
  const R = (S.rep ||= { period: DEFAULT_PERIOD });
  let query, label;
  if (R.period === 'all') {
    query = { all: 1 }; label = 'all';
  } else if (R.period.startsWith('y:')) {
    query = { year: R.period.slice(2) }; label = R.period.slice(2);
  } else {
    const [from, to] = periodRange(R.period);
    query = { from, to }; label = (PERIOD_LABELS[R.period] || '').toLowerCase();
  }
  const data = await api('/report?' + qs(query));
  const pastYears = data.years.filter((y) => y < String(new Date().getFullYear()));
  const hasOther = data.other && data.other.total > 0;  // contributions (dedicated categories) and transfers to other spaces
  const tab = S.reportTab === 'other' && !hasOther ? 'expense' : S.reportTab || 'expense';
  const d = data[tab];
  const other = hasOther ? data.other.total : 0;
  const single = data.months.length === 1;
  const max = Math.max(1, ...d.rows.flatMap((r) => r.months));
  const inc = data.income.total, exp = data.expense.total;
  // savings = surplus, as in the dashboard: income + transfers received − expenses − money out to other spaces
  const tin = data.transfers_in || 0, inflow = inc + tin, saved = inflow - exp - other;
  const monthsWithData = data.expense.months.filter((x) => x > 0).length || 1;
  const range = qs({ from: data.from, to: data.to });
  // heatmap background: square root so small values are not flattened, with a minimum that is always visible
  const heat = (x, color) => `background:color-mix(in srgb, ${esc(color)} ${Math.round(16 + 50 * Math.sqrt(x / max))}%, transparent)`;

  v.innerHTML = `
    <div class="toolbar">
      <select id="r-period">${REPORT_PERIODS.map(([k, l]) => `<option value="${k}" ${k === R.period ? 'selected' : ''}>${l}</option>`).join('')}
        ${pastYears.slice().reverse().map((y) => `<option value="y:${y}" ${R.period === `y:${y}` ? 'selected' : ''}>Year ${y}</option>`).join('')}
        <option value="all" ${R.period === 'all' ? 'selected' : ''}>All</option></select>
      <span class="muted small">${esc(fmtDate(data.from))} → ${esc(fmtDate(data.to))}</span>
      <div class="seg" id="r-tab"><button data-t="expense" class="${tab === 'expense' ? 'on' : ''}">📤 Expenses</button><button data-t="income" class="${tab === 'income' ? 'on' : ''}">📥 Income</button>${hasOther ? `<button data-t="other" class="${tab === 'other' ? 'on' : ''}">↗ Other spaces</button>` : ''}</div>
      ${data.excluded ? `<a class="chip small" href="#/movimenti?excluded=1&${range}" title="Not counted in the report">🙈 ${data.excluded} excluded</a>` : ''}
      <span class="spacer"></span>
      <a class="btn btn-sm" href="/api/export/report?${range}&pf=${S.pid}">⬇ Excel report</a>
      <a class="btn btn-sm" href="/api/export/transactions?format=xlsx&${range}&pf=${S.pid}">⬇ Transactions</a>
    </div>
    <div class="kpis">
      <div class="kpi g-emerald"><div class="k-label">📥 Income · ${esc(label)}</div><div class="k-value">${money(inflow)}</div>
        ${tin ? `<div class="k-split"><a href="#/report" data-t="income"><span>💼 Income</span><b>${money(inc)}</b></a><a href="#/movimenti?${qs({ kind: 'transfer', from: data.from, to: data.to })}"><span>↙ From other spaces</span><b>${money(tin)}</b></a></div>` : ''}</div>
      <div class="kpi g-rose"><div class="k-label">📤 Money out · ${esc(label)}</div><div class="k-value">${money(exp + other)}</div>
        ${other ? `<div class="k-split"><a href="#/report" data-t="expense"><span>🛒 Expenses</span><b>${money(exp)}</b></a><a href="#/report" data-t="other"><span>↗ Other spaces</span><b>${money(other)}</b></a></div>` : ''}</div>
      <div class="kpi g-amber"><div class="k-label">🐷 Savings</div><div class="k-value">${money(saved)}</div><div class="k-sub">${inflow ? pct(saved / inflow) + ' of income' : ''}</div></div>
      <div class="kpi g-indigo"><div class="k-label">📊 Average monthly spending</div><div class="k-value">${money(exp / monthsWithData)}</div><div class="k-sub">over ${monthsWithData} ${monthsWithData === 1 ? 'month' : 'months'} with expenses</div></div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <div class="card-head"><div><h3>${{ expense: 'Expenses', income: 'Income', other: 'Contributions to other spaces' }[tab]} ${single ? 'by category' : 'by month and category'}</h3>
        <p class="muted small" style="margin:3px 0 0">${single ? 'Amount per category in the month' : `Total above each bar · dashed line = monthly average (${money0(d.total / (d.months.filter((x) => x > 0).length || 1))}) · hover over a bar for details`}</p></div></div>
      <div class="chart-legend-wrap ${single ? 'single' : ''}">
        <div class="chart-box tall"><canvas id="c-stack"></canvas></div>
        ${single ? '' : '<div class="chart-legend" id="r-legend"></div>'}
      </div></div>
    <div class="card" style="padding:8px"><div class="table-wrap"><table class="heat">
      <thead><tr><th>Category</th>${single ? '' : data.months.map((mm) => `<th class="right">${fmtMonth(mm)}</th>`).join('')}<th class="right">Total</th><th class="right">%</th></tr></thead>
      <tbody>${d.rows.map((r) => {
        const cat = r.transfer ? { kind: 'transfer', excluded: 0 } : { category_id: r.id ?? 'none', kind: tab === 'income' ? 'income' : 'expense', excluded: 0 };
        const whole = txLink({ ...cat, from: data.from, to: data.to }, `Transactions ${r.name} in the period`);
        return `<tr><td><span class="pill quick-filter" style="--c:${esc(r.color)}" ${whole}>${esc(r.icon)} ${esc(r.name)}</span></td>
        ${single ? '' : r.months.map((x, i) => x ? `<td style="${heat(x, r.color)}" ${txLink({ ...cat, ...monthBounds(data.months[i]) }, `Transactions ${r.name} · ${fmtMonth(data.months[i])}`)}>${money0(x)}</td>` : '<td><span class="muted">·</span></td>').join('')}
        <td class="tot" ${single ? `style="${heat(r.total, r.color)}"` : ''} ${whole}>${money(r.total)}</td><td class="muted">${d.total ? pct(r.total / d.total) : ''}</td></tr>`;
      }).join('') || `<tr><td colspan="${data.months.length + 3}"><div class="empty">No data in the period</div></td></tr>`}</tbody>
      <tfoot><tr><td>Total</td>${single ? '' : d.months.map((x, i) => x ? `<td ${txLink({ kind: tab === 'income' ? 'income' : 'expense',excluded: 0, ...monthBounds(data.months[i]) }, `All transactions · ${fmtMonth(data.months[i])}`)}>${money0(x)}</td>` : '<td>·</td>').join('')}<td ${txLink({ kind: tab === 'income' ? 'income' : 'expense',excluded: 0, from: data.from, to: data.to })}>${money(d.total)}</td><td></td></tr></tfoot>
    </table></div></div>`;

  $('#r-period').onchange = (e) => { R.period = e.target.value; route(); };
  $$('#r-tab button, .k-split [data-t]', v).forEach((b) => (b.onclick = (e) => { e.preventDefault(); S.reportTab = b.dataset.t; route(); }));

  if (d.rows.length) drawReportChart(data, d, single, tab);
}

// compact amounts for axes and labels: 950 €, 1,2K €, 12K €
const moneyK = (c) => (Math.abs(c) >= 100000 ? `${(c / 100000).toLocaleString('it-IT', { maximumFractionDigits: c >= 1000000 ? 0 : 1 })}K €` : money0(c));

function drawReportChart(data, d, single, tab) {
  const surface = css('--surface'), ink = css('--text'), muted = css('--muted');
  const font = { family: css('--font'), size: 12, weight: '600' };
  const base = { kind: tab === 'income' ? 'income' : 'expense',excluded: 0 };

  if (single) {  // a single month: horizontal bars per category, value at the tip
    chart($('#c-stack'), {
      type: 'bar',
      data: { labels: d.rows.map((r) => `${r.icon}  ${r.name}`), datasets: [{ label: 'Total', data: d.rows.map((r) => r.total), backgroundColor: d.rows.map((r) => r.color), borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'start', maxBarThickness: 22 }] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 70 } },
        scales: { x: { ...moneyAxis, ticks: { callback: (v) => moneyK(v) }, border: { display: false } }, y: { grid: { display: false }, border: { display: false }, ticks: { color: ink, font } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${money(c.raw)} · ${pct(c.raw / d.total)}` } } },
        onHover: pointerOnHover,
        onClick: (_, el) => el.length && goTx(d.rows[el[0].index].transfer ? { kind: 'transfer', excluded: 0, from: data.from, to: data.to }
          : { ...base, category_id: d.rows[el[0].index].id ?? 'none', from: data.from, to: data.to }),
      },
      plugins: [{
        id: 'tipLabels',
        afterDatasetsDraw(c) {
          const { ctx } = c; ctx.save(); ctx.font = `600 12px ${font.family}`; ctx.fillStyle = ink; ctx.textBaseline = 'middle';
          c.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(money0(d.rows[i].total), bar.x + 8, bar.y));
          ctx.restore();
        },
      }],
    });
    return;
  }

  // month by month: up to 12 stacked categories (the largest at the bottom) + "Other" only for the marginal items
  const MAX = d.rows.length <= 13 ? 13 : 12, top = d.rows.slice(0, MAX), rest = d.rows.slice(MAX);
  const series = top.map((r) => ({ id: r.id ?? 'none', transfer: r.transfer, name: `${r.icon} ${r.name}`, color: r.color, months: r.months, total: r.total }));
  if (rest.length) series.push({ name: `${rest.length} other categories`, color: '#a8adc2', months: data.months.map((_, i) => rest.reduce((s, r) => s + r.months[i], 0)), total: rest.reduce((s, r) => s + r.total, 0), others: rest });
  const active = d.months.filter((x) => x > 0).length || 1, avg = d.total / active;
  const hidden = new Set();

  // rounded corners only at the top of the highest visible segment of each bar
  const isTop = (ctx) => {
    for (let j = series.length - 1; j >= 0; j--) if (!hidden.has(j) && series[j].months[ctx.dataIndex] > 0) return j === ctx.datasetIndex;
    return false;
  };
  const datasets = series.map((s) => ({
    label: s.name, data: s.months, backgroundColor: s.color, maxBarThickness: 44, categoryPercentage: .78, barPercentage: .92,
    borderColor: surface, borderWidth: { top: 3 }, borderSkipped: 'start',
    borderRadius: (ctx) => (isTop(ctx) ? { topLeft: 4, topRight: 4 } : 0),
  }));
  const visibleTotal = (i) => series.reduce((s, x, j) => s + (hidden.has(j) ? 0 : x.months[i]), 0);

  const c = chart($('#c-stack'), {
    type: 'bar',
    data: { labels: data.months.map(fmtMonth), datasets },
    options: {
      maintainAspectRatio: false, layout: { padding: { top: 22 } },
      interaction: { mode: 'index', intersect: false },
      onHover: pointerOnHover,
      // click on a segment = that category in that month; click on the column outside the segments = the whole month
      onClick: (evt, el, ch) => {
        if (!el.length) return;
        const month = monthBounds(data.months[el[0].index]);
        const hit = ch.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true)[0];
        const s = hit && series[hit.datasetIndex];
        goTx(s?.transfer ? { kind: 'transfer', excluded: 0, ...month } : s && !s.others ? { ...base, ...month, category_id: s.id } : { ...base, ...month });
      },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: muted, font: { ...font, weight: '500' } } },
        y: { stacked: true, beginAtZero: true, border: { display: false }, grid: { color: css('--grid') }, ticks: { color: muted, maxTicksLimit: 6, callback: (v) => moneyK(v) } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          itemSort: (a, b) => b.raw - a.raw, filter: (i) => i.raw > 0, boxPadding: 4, usePointStyle: true,
          callbacks: {
            title: (items) => `${data.months[items[0].dataIndex] ? fmtMonth(data.months[items[0].dataIndex]) : ''}`,
            label: (i) => ` ${i.dataset.label}  ${money(i.raw)}`,
            footer: (items) => `Total  ${money(visibleTotal(items[0].dataIndex))}`,
          },
        },
      },
    },
    plugins: [{
      id: 'totalsAndAverage',
      afterDatasetsDraw(ch) {
        const { ctx, chartArea: area, scales: { y } } = ch;
        ctx.save();
        // monthly average line (a reference, not a grid line)
        const ay = y.getPixelForValue(avg);
        if (ay >= area.top && ay <= area.bottom && hidden.size === 0) {
          ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(area.left, ay); ctx.lineTo(area.right, ay); ctx.stroke(); ctx.setLineDash([]);
          ctx.font = `600 11px ${font.family}`; ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          ctx.fillText(`avg ${moneyK(avg)}`, area.right, ay - 3);
        }
        // total above each bar, on a surface-colored background so the average line passes behind it
        ctx.font = `600 11.5px ${font.family}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        data.months.forEach((_, i) => {
          const tot = visibleTotal(i);
          if (!tot) return;
          const x = ch.getDatasetMeta(0).data[i].x, ty = y.getPixelForValue(tot) - 11, txt = moneyK(tot);
          const w = ctx.measureText(txt).width + 8;
          ctx.fillStyle = surface; ctx.fillRect(x - w / 2, ty - 8, w, 16);
          ctx.fillStyle = ink; ctx.fillText(txt, x, ty);
        });
        ctx.restore();
      },
    }],
  });

  // legend: color dot + name + total + share; click = show/hide, hover = highlight
  const lg = $('#r-legend');
  lg.innerHTML = series.map((s, j) => `<button type="button" class="lg-item" data-j="${j}" title="${s.others ? esc(s.others.map((o) => o.name).join(', ')) : 'Click to show/hide'}">
      <span class="lg-sw" style="background:${esc(s.color)}"></span>
      <span class="lg-name">${esc(s.name)}</span>
      <span class="lg-val">${money0(s.total)}</span><span class="lg-pct">${pct(s.total / d.total)}</span></button>`).join('')
    + `<div class="lg-total"><span>Period total</span><b>${money0(d.total)}</b></div>`;
  const restyle = (focus) => {
    datasets.forEach((ds, j) => { ds.backgroundColor = focus == null || focus === j ? series[j].color : series[j].color + '33'; });
    c.update('none');
  };
  $$('.lg-item', lg).forEach((b) => {
    const j = +b.dataset.j;
    b.onclick = () => { hidden.has(j) ? hidden.delete(j) : hidden.add(j); c.setDatasetVisibility(j, !hidden.has(j)); b.classList.toggle('off', hidden.has(j)); c.update(); };
    b.onmouseenter = () => !hidden.has(j) && restyle(j);
    b.onmouseleave = () => restyle(null);
  });
}

// ================================================================ fair split of expenses
const SPLIT_RULES = [['prop', '⚖️ Proportional', 'Based on income'], ['equal', '½ Split equally', 'Same amount for everyone'], ['none', '🚫 Excluded', 'Not a shared expense']];

async function renderRipartizione(v) {
  let state = await api('/split');
  const cfg = () => ({
    people: $$('.sp-person', v).map((row) => ({
      id: row.dataset.id ? +row.dataset.id : null, name: $('[data-f=name]', row).value.trim(),
      income: parseMoney($('[data-f=income]', row).value) || 0, keyword: $('[data-f=keyword]', row).value.trim(),
    })).filter((p) => p.name),
    settings: {
      split_base: $('#sp-base').value, split_months: $('#sp-months').value, split_margin: $('#sp-margin').value || 0,
      split_round: $('#sp-round').value, split_minimum: $('#sp-min').value || 0,
      ...($('#sp-base').value === 'manual' ? { split_manual: manualItems() } : {}),
    },
  });
  // manual items ("Manual amounts" basis): name, account, monthly amount, rule
  const manualItems = () => $$('.sp-mrow', v).map((row) => ({
    name: $('[data-m=name]', row).value.trim(), account_id: +$('[data-m=account]', row).value,
    amount: parseMoney($('[data-m=amount]', row).value) || 0, rule: $('[data-m=rule]', row).value,
  })).filter((x) => x.name && x.amount > 0);
  const save = async (extra = {}) => {
    try { state = await api('/split', { method: 'PUT', body: { ...cfg(), ...extra } }); syncIds(); drawResult(); }
    catch (e) { fail(e); }
  };
  const saveSoon = debounce(() => save(), 600);
  const s = state.settings;

  const personRow = (p = {}) => `<div class="sp-person" data-id="${p.id ?? ''}">
      <input data-f="name" maxlength="40" placeholder="Name" value="${esc(p.name ?? '')}">
      <input data-f="income" inputmode="decimal" placeholder="Net monthly income" value="${p.income ? moneyInput(p.income) : ''}">
      <input data-f="keyword" maxlength="40" placeholder="Word in contributions" value="${esc(p.keyword ?? '')}" title="Word used to recognize this person's contributions (e.g. the name as it appears on bank transfers)">
      <button class="icon-btn sm" data-del-person title="Remove">✕</button></div>`;

  const manualRow = (it = {}) => `<div class="sp-mrow">
      <input data-m="name" maxlength="60" placeholder="Item (e.g. Mortgage, Groceries, Unexpected)" value="${esc(it.name ?? '')}">
      <select data-m="account">${state.accounts.map((a) => `<option value="${a.id}" ${+it.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <input data-m="amount" inputmode="decimal" placeholder="€ / month" value="${it.amount ? moneyInput(it.amount) : ''}">
      <select data-m="rule">${SPLIT_RULES.map(([k, l]) => `<option value="${k}" ${(it.rule || 'prop') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="icon-btn sm" data-m-del title="Remove">✕</button></div>`;
  const parseManual = () => { try { return JSON.parse(state.settings.split_manual || '[]'); } catch { return []; } };
  const BASE_LABEL = { expenses: 'Actual expenses (average)', deposits: 'Actual contributions (average)', manual: 'Amounts entered by hand' };

  v.innerHTML = `
    <div class="sp-intro card">
      <div class="sp-intro-ico">⚖️</div>
      <div><b>How it works</b><p class="muted small" style="margin:4px 0 0">HomeCoin calculates how much each person should pay into each account so that everyone
        <b>saves the same percentage of their income</b>. You can start from <b>actual expenses</b>, from the <b>contributions made so far</b>
        (total ÷ months) or from <b>amounts entered by hand</b>. Items <i>split equally</i> (e.g. a joint mortgage) are divided in half,
        <i>proportional</i> ones make up the difference; <i>excluded</i> ones are left out of the calculation.</p></div>
    </div>
    <div class="grid-3-2">
      <div class="card"><div class="card-head"><h3>👥 People and income</h3><button class="btn btn-sm" id="sp-add">＋ Person</button></div>
        <div class="sp-head muted small"><span>Name</span><span>Net income / month</span><span>Recognize contributions from</span><span></span></div>
        <div id="sp-people">${(state.people.length ? state.people : [{}, {}]).map(personRow).join('')}</div></div>
      <div class="card"><div class="card-head"><h3>⚙️ Settings</h3></div>
        <div class="form-grid">
          <label class="field full">Calculation basis <select id="sp-base">${Object.entries(BASE_LABEL).map(([k, l]) => `<option value="${k}" ${s.split_base === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Averaging period <select id="sp-months">${[3, 6, 12, 24].map((m) => `<option value="${m}" ${+s.split_months === m ? 'selected' : ''}>Last ${m} full months</option>`).join('')}<option value="all" ${s.split_months === 'all' ? 'selected' : ''}>Entire history</option></select></label>
          <label class="field">Margin for unexpected costs (%) <input id="sp-margin" type="number" min="0" max="50" step="1" value="${esc(s.split_margin)}"></label>
          <label class="field">Round contributions to <select id="sp-round">${[1, 5, 10, 50].map((r) => `<option value="${r}" ${+s.split_round === r ? 'selected' : ''}>${r} €</option>`).join('')}</select></label>
          <label class="field">Minimum contribution (€) <input id="sp-min" type="number" min="0" step="5" value="${esc(s.split_minimum)}"></label>
        </div></div>
    </div>
    <div class="card" id="sp-manual" style="margin-bottom:18px"><div class="card-head"><div><h3>✏️ Amounts entered by hand</h3>
        <p class="muted small" style="margin:3px 0 0">Monthly items to split, as in a spreadsheet: for each one, the account to pay into and the rule.</p></div>
        <div style="display:flex;gap:8px"><button class="btn btn-sm" id="sp-m-fill" title="Replaces the items with the actual averages per category">⤵ Prefill from actual expenses</button><button class="btn btn-sm" id="sp-m-add">＋ Item</button></div></div>
      <div class="sp-mhead muted small"><span>Item</span><span>Account</span><span>Amount / month</span><span>Rule</span><span></span></div>
      <div id="sp-mrows">${parseManual().map(manualRow).join('')}</div>
      <p class="muted small" id="sp-m-total" style="margin:8px 0 0"></p></div>
    <div id="sp-result"></div>`;
  const syncBase = () => {
    const manual = $('#sp-base').value === 'manual';
    $('#sp-manual').classList.toggle('hidden', !manual);
    $('#sp-months').disabled = manual; $('#sp-margin').disabled = manual;
    if (manual && !$$('.sp-mrow', v).length) $('#sp-mrows').insertAdjacentHTML('beforeend', manualRow());
    $('#sp-m-total').textContent = `Items total: ${money(manualItems().reduce((t, x) => t + x.amount, 0))} per month`;
  };
  syncBase();
  $('#sp-base').onchange = () => { syncBase(); save(); };
  $('#sp-m-add').onclick = () => { $('#sp-mrows').insertAdjacentHTML('beforeend', manualRow()); $('#sp-mrows .sp-mrow:last-child input').focus(); };
  $('#sp-mrows').addEventListener('input', () => { syncBase(); saveSoon(); });
  $('#sp-mrows').addEventListener('change', () => { syncBase(); saveSoon(); });
  $('#sp-mrows').addEventListener('click', (e) => { if (e.target.closest('[data-m-del]')) { e.target.closest('.sp-mrow').remove(); syncBase(); save(); } });
  $('#sp-m-fill').onclick = async () => {
    if (manualItems().length && !(await confirmDialog('Replace the current items with the actual average expenses per category?', { ok: 'Replace', danger: false, title: 'Prefill the items?' }))) return;
    try {
      const exp = await api('/split', { method: 'PUT', body: { settings: { split_base: 'expenses' } } });
      const items = exp.result.rows.filter((x) => x.rule !== 'none' && x.monthly > 0)
        .map((x) => ({ name: x.category, account_id: x.account_id, amount: Math.round(x.monthly / 100) * 100, rule: x.rule }));
      $('#sp-mrows').innerHTML = items.map(manualRow).join('');
      $('#sp-base').value = 'manual'; syncBase(); await save();
      toast(`${items.length} items prefilled from actual expenses`, 'info');
    } catch (e) { fail(e); }
  };

  function syncIds() {  // after saving, new people receive an id
    $$('.sp-person', v).filter((r) => $('[data-f=name]', r).value.trim()).forEach((row, i) => { if (state.people[i]) row.dataset.id = state.people[i].id; });
  }
  $('#sp-add').onclick = () => { $('#sp-people').insertAdjacentHTML('beforeend', personRow()); $('#sp-people .sp-person:last-child input').focus(); };
  $('#sp-people').addEventListener('input', saveSoon);
  $('#sp-people').addEventListener('click', (e) => { if (e.target.closest('[data-del-person]')) { e.target.closest('.sp-person').remove(); save(); } });
  ['#sp-months', '#sp-round'].forEach((id) => ($(id).onchange = () => save()));
  ['#sp-margin', '#sp-min'].forEach((id) => ($(id).oninput = saveSoon));

  function drawResult() {
    const r = state.result, people = r.people.filter((p) => p.income > 0);
    const box = $('#sp-result');
    if (!people.length) {
      box.innerHTML = `<div class="card empty"><div class="big">👥</div><h3>Enter who contributes</h3><p>Add at least one person with their net monthly income to calculate the split.</p></div>`;
      return;
    }
    const range = { from: r.from, to: r.to, excluded: 0 };
    const rate = people[0].rate_exact;
    // rows per category (sum over accounts)
    const byCat = {};
    r.rows.forEach((x) => {
      const k = r.base === 'expenses' ? x.key : `${x.key}`;  // categories: summed across accounts; other bases: one row per item
      const c = (byCat[k] ||= { ...x, monthly: 0, quotas: r.people.map(() => 0), accounts: [] });
      c.monthly += x.monthly; c.quotas = c.quotas.map((q, i) => q + x.quotas[i]); c.accounts.push(x.account);
    });
    const cats = Object.values(byCat).sort((a, b) => b.monthly - a.monthly);
    const ruleOf = (id) => state.rules.find((x) => x.id === id)?.split ?? 'prop';
    const accs = [...new Set(r.deposits.map((d) => d.account))];

    box.innerHTML = `
      ${r.fair ? '' : `<div class="card sp-warn">⚠️ The <b>split equally</b> part exceeds someone's fair share: savings cannot be identical. Consider making some categories proportional.</div>`}
      <div class="kpis">
        <div class="kpi g-indigo"><div class="k-label">🧾 ${{ expenses: 'Shared expenses per month', deposits: 'Average contributions per month', manual: 'Manual amounts per month' }[r.base]}</div><div class="k-value">${money(r.total)}</div>
          <div class="k-sub">${r.base === 'manual' ? 'items entered by hand' : `${r.months}-month average${r.margin ? ` + ${r.margin}% unexpected` : ''} · ${esc(fmtDate(r.from))} → ${esc(fmtDate(r.to))}`}</div></div>
        <div class="kpi g-emerald"><div class="k-label">🐷 Each person's savings rate</div><div class="k-value">${rate == null ? '—' : pct(rate)}</div>
          <div class="k-sub">${r.fair ? 'the same for everyone' : 'not exactly the same'}</div></div>
        <div class="kpi g-amber"><div class="k-label">½ Split equally</div><div class="k-value">${money(r.equal_total)}</div><div class="k-sub">${money(r.equal_total / (r.people.length || 1))} each</div></div>
        <div class="kpi g-rose"><div class="k-label">⚖️ Proportional</div><div class="k-value">${money(r.prop_total)}</div><div class="k-sub">${r.excluded_total ? `excluded ${money(r.excluded_total)}` : 'no excluded categories'}</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h3>💸 Proposed monthly contributions</h3><button class="btn btn-sm btn-primary" id="sp-apply">Update recurring contributions</button></div>
          <div class="table-wrap"><table class="sp-table">
            <thead><tr><th>Account</th><th>Person</th><th class="right">Proposed / month</th><th class="right">Paid in the period</th><th class="right">÷ ${r.months} months</th><th class="right">Difference</th></tr></thead>
            <tbody>${accs.map((a) => r.deposits.filter((d) => d.account === a).map((d, i) => {
              const diff = d.rounded - d.actual;
              return `<tr><td>${i ? '' : `<span class="dot" style="background:${esc(d.color)}"></span> <b>${esc(a)}</b>`}</td><td>${esc(d.person)}</td>
                <td class="right"><b>${money0(d.rounded)}</b>${d.below_min ? ' <span class="tag warn">below the minimum</span>' : ''}<div class="muted small">exact ${money(d.exact)}</div></td>
                <td class="right">${d.actual_total ? `<span class="quick-filter" ${txLink({ account_id: d.account_id, from: r.from, to: r.to }, 'View the account transactions in the period')}>${money0(d.actual_total)}</span><div class="muted small">${d.actual_count} contributions${d.actual_transfers ? ` · of which ${money0(d.actual_transfers)} by transfer` : ''}</div>` : '<span class="muted">—</span>'}</td>
                <td class="right muted">${d.actual_total ? money0(d.actual) : '—'}</td>
                <td class="right ${Math.abs(diff) < 1000 ? 'muted' : diff > 0 ? 'neg' : 'pos'}" title="${diff > 0 ? 'To increase' : 'To reduce'}">${d.actual_total ? (diff > 0 ? '+' : '') + money0(diff) : '—'}</td></tr>`;
            }).join('')).join('')}</tbody>
            <tfoot><tr><td colspan="2">Total</td><td class="right">${money0(r.deposits.reduce((s, d) => s + d.rounded, 0))}</td><td class="right">${money0(r.paid_total)}</td><td class="right">${money0(r.paid_month)}</td><td></td></tr></tfoot>
          </table></div>
          <p class="muted small" style="margin:10px 0 0">The actual amount paid is the period <b>total</b> (${esc(fmtDate(r.from))} → ${esc(fmtDate(r.to))}) divided by ${r.months} months: it includes «Contributions…» income and <b>transfers received from other spaces</b> (e.g. from the contributor's personal space). Each contribution counts for one person only: the one whose keyword is in the description, otherwise the one matching the source space or account. Transactions excluded from reports do not count.</p>
          ${r.unassigned_total ? `<p class="small" style="margin:8px 0 0"><span class="tag warn">⚠ ${money0(r.unassigned_total)} of unassigned contributions</span> no keyword matches: add it to the right person above (e.g. the name of their space or of the account they pay from).</p>` : ''}</div>
        <div class="card"><div class="card-head"><h3>🤝 Share and savings</h3><span class="muted">fair vs actual</span></div>
          <div class="sp-people-res">${r.people.map((p) => `<div class="sp-pres">
            <div class="top"><b>${esc(p.name)}</b><span class="muted small">income ${money0(p.income)} / month</span></div>
            <table class="sp-cmp"><thead><tr><th></th><th>Pays / month</th><th>Share</th><th>Saves</th><th>Rate</th></tr></thead><tbody>
              <tr><td><span class="tag ai">Fair</span></td><td>${money0(p.share_rounded)}</td><td>${pct(p.weight)}</td>
                <td class="${p.savings >= 0 ? 'pos' : 'neg'}">${money0(p.savings)}</td><td><b>${p.rate == null ? '—' : pct(p.rate)}</b></td></tr>
              <tr><td><span class="tag">Actual</span></td><td>${p.paid_total ? money0(p.paid_month) : '—'}</td><td>${p.paid_weight == null ? '—' : pct(p.paid_weight)}</td>
                <td>${p.paid_total ? money0(p.income - p.paid_month) : '—'}</td><td><b>${p.paid_total && p.rate_actual != null ? pct(p.rate_actual) : '—'}</b></td></tr>
            </tbody></table>
            <div class="sp-share" title="Fair share vs actual share of the total paid">
              <div><span>Fair</span><div class="bar"><i style="width:${(p.weight * 100).toFixed(1)}%"></i></div></div>
              <div><span>Actual</span><div class="bar real"><i style="width:${((p.paid_weight || 0) * 100).toFixed(1)}%"></i></div></div>
            </div>
            <div class="muted small">Paid in the period: <b>${money0(p.paid_total)}</b> in ${p.paid_count} bank transfers (÷ ${r.months} months)</div></div>`).join('')}</div></div>
      </div>
      <div class="card"><div class="card-head"><div><h3>${{ expenses: '🏷️ Rules per category', deposits: '🤝 Breakdown of contributions', manual: '✏️ Manual items' }[r.base]}</h3>
        <p class="muted small" style="margin:3px 0 0">${{ expenses: 'Actual average monthly spending and each person\'s share. Click the name to see the transactions.',
          deposits: 'Monthly average of contributions per account: the part covering expenses split equally is divided in half, the rest in proportion to income.',
          manual: 'Amounts entered by hand and each person\'s share (rules are changed in the items table).' }[r.base]}</p></div></div>
        <div class="table-wrap"><table class="sp-table">
          <thead><tr><th>${r.base === 'expenses' ? 'Category' : 'Item'}</th><th>Rule</th><th class="right">${r.base === 'manual' ? 'Amount' : 'Average'} / month</th>${r.people.map((p) => `<th class="right">${esc(p.name)}</th>`).join('')}</tr></thead>
          <tbody>${cats.map((c) => `<tr class="${c.rule === 'none' ? 'is-off' : ''}">
            <td><span class="pill ${r.base === 'expenses' ? 'quick-filter' : ''}" style="--c:${esc(c.color)}" ${r.base === 'expenses' ? txLink({ ...range, category_id: c.category_id ?? 'none', kind: 'expense' }) : ''}>${esc(c.icon)} ${esc(c.category)}</span>
              <div class="muted small">${esc([...new Set(c.accounts)].join(' · '))}</div></td>
            <td>${r.base === 'expenses' && c.category_id ? `<div class="seg sp-rule" data-cat="${c.category_id}">${SPLIT_RULES.map(([k, l, t]) => `<button data-r="${k}" class="${ruleOf(c.category_id) === k ? 'on' : ''}" title="${t}">${l}</button>`).join('')}</div>`
              : `<span class="muted small">${SPLIT_RULES.find(([k]) => k === c.rule)?.[1] ?? 'Proportional'}</span>`}</td>
            <td class="right"><b>${money0(c.monthly)}</b></td>${c.quotas.map((q) => `<td class="right">${c.rule === 'none' ? '<span class="muted">—</span>' : money0(q)}</td>`).join('')}</tr>`).join('')
            || `<tr><td colspan="${3 + r.people.length}"><div class="empty">${r.base === 'manual' ? 'Add at least one item with an amount' : 'No data in the period'}</div></td></tr>`}</tbody>
        </table></div>
        ${r.base === 'expenses' && state.rules.filter((x) => !byCat[`c${x.id}`]).length ? `<p class="muted small" style="margin:10px 0 0">Categories with no expenses in the period: ${state.rules.filter((x) => !byCat[`c${x.id}`]).map((x) => `${esc(x.icon)} ${esc(x.name)}`).join(' · ')}</p>` : ''}
      </div>`;

    $$('.sp-rule', box).forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (b) save({ rules: { [seg.dataset.cat]: b.dataset.r } });
    }));
    $('#sp-apply').onclick = async () => {
      const list = r.deposits.filter((d) => d.rounded > 0 && d.person_id);
      if (!(await confirmDialog(`Set the recurring monthly contributions to the proposed amounts? (${list.map((d) => `${d.person} into ${d.account}: ${money0(d.rounded)}`).join(', ')}). Anyone who pays with a recurring transfer from their own space will have that transfer updated, without a new one being created here.`, { ok: 'Update', danger: false, title: 'Update the contributions?' }))) return;
      try {
        const res = await api('/split/apply', { method: 'POST', body: { deposits: list.map((d) => ({ account_id: d.account_id, person_id: d.person_id, amount: d.rounded })) } });
        toast(`Recurring items updated: ${res.updated}${res.created ? ` · created ${res.created}` : ''}${res.transfers?.length ? ` · transfers updated in the contributor's space: ${res.transfers.join(', ')}` : ''}`);
      } catch (e) { fail(e); }
    };
  }
  drawResult();
}

// ================================================================ categories
async function renderCategorie(v) {
  const col = (kind, title) => `<div class="card"><div class="card-head"><h3>${title}</h3><button class="btn btn-sm" data-newcat="${kind}">＋ New</button></div>
    <div class="list">${catsOf(kind).map((c) => `<div class="list-item clickable" ${txLink({ category_id: c.id, kind }, `Transactions ${c.name}`)}><div class="cat-ico" style="--c:${esc(c.color)}">${esc(c.icon)}</div>
      <div class="grow"><div class="title">${esc(c.name)}</div>${kind === 'expense' ? `<div class="muted small">${c.budget ? `Budget ${money0(c.budget)} / month` : 'No budget'}</div>` : ''}</div>
      <button class="icon-btn sm" data-editcat="${c.id}" title="Edit">✏️</button></div>`).join('')}</div></div>`;
  v.innerHTML = `<div class="grid-2">${col('expense', '📤 Expense categories')}${col('income', '📥 Income categories')}</div>
    <div class="card"><div class="card-head"><div><h3>✨ Automatic categorization rules</h3>
      <p class="muted small" style="margin:4px 0 0">If the description contains the keyword, the transaction gets the category. Besides the rules, HomeCoin learns from the transactions you have already categorized.</p></div>
      <button class="btn btn-sm" id="rules-apply">⚡ Apply to uncategorized transactions</button></div>
      <div class="inline-form" style="margin-bottom:16px"><input id="rule-p" placeholder="Keyword (e.g. tesco)" maxlength="80">
        <select id="rule-c"><optgroup label="Expenses">${catsOf('expense').map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup>
        <optgroup label="Income">${catsOf('income').map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup></select>
        <button class="btn btn-primary" id="rule-add">＋ Add rule</button></div>
      <div id="rule-sugg" class="sugg-row"></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${S.rules.map((r) => { const c = catById(r.category_id) || {}; return `<span class="pill" style="--c:${esc(c.color)}">“${esc(r.pattern)}” → ${esc(c.icon)} ${esc(r.category_name)}
        <button class="btn-ghost" data-delrule="${r.id}" style="border:0;background:none;cursor:pointer;color:inherit;padding:0 0 0 4px" title="Remove">✕</button></span>`; }).join('')}</div>
    </div>`;
  $$('[data-newcat]').forEach((b) => (b.onclick = () => categoryModal(null, b.dataset.newcat)));
  $$('[data-editcat]').forEach((b) => (b.onclick = () => categoryModal(catById(+b.dataset.editcat))));
  $$('[data-delrule]').forEach((b) => (b.onclick = async () => { try { await api(`/rules/${b.dataset.delrule}`, { method: 'DELETE' }); refresh(); } catch (e) { fail(e); } }));
  $('#rule-add').onclick = async () => {
    try { await api('/rules', { method: 'POST', body: { pattern: $('#rule-p').value, category_id: +$('#rule-c').value } }); toast('Rule added'); refresh(); } catch (e) { fail(e); }
  };
  $('#rules-apply').onclick = async () => {
    try { const r = await api('/rules/apply', { method: 'POST' }); toast(`${r.updated} transactions categorized`, 'info'); } catch (e) { fail(e); }
  };
  try {  // suggested keywords: payees that come up often among the transactions still uncategorized
    const sug = await api('/rules/suggestions');
    if (sug.length) {
      $('#rule-sugg').innerHTML = `<span class="sugg-title">✨ Often uncategorized</span>${sug.map((s, i) =>
        `<button type="button" class="sugg-chip" data-rsug="${i}" title="Use as keyword · ${s.count} uncategorized transactions">${s.kind === 'income' ? '📥' : '📤'} ${esc(s.pattern)} <span class="ac-meta">×${s.count}</span></button>`).join('')}`;
      $$('[data-rsug]').forEach((b) => (b.onclick = () => {
        const s = sug[+b.dataset.rsug];
        $$('[data-rsug]').forEach((x) => x.classList.toggle('on', x === b));
        $('#rule-p').value = s.pattern;
        markSuggested($('#rule-p'));
        const sel = $('#rule-c');
        if (catById(+sel.value)?.kind !== s.kind) sel.value = catsOf(s.kind)[0]?.id ?? sel.value;  // category of the right type
        sel.focus();
      }));
    }
  } catch { /* suggestions are not essential */ }
}

function categoryModal(c = null, kind = 'expense') {
  const x = c || { name: '', kind, color: PALETTE[Math.floor(Math.random() * PALETTE.length)], icon: '📦', budget: 0 };
  const m = openModal(c ? 'Edit category' : `New ${x.kind === 'expense' ? 'expense' : 'income'} category`, `
    <div class="form-grid">
      <label class="field ${x.kind === 'expense' ? '' : 'full'}">Name <input id="c-name" maxlength="60" value="${esc(x.name)}" autofocus></label>
      ${x.kind === 'expense' ? `<label class="field">Monthly budget <input id="c-budget" inputmode="decimal" value="${moneyInput(x.budget)}" placeholder="None"></label>` : ''}
      <div class="field full">Color ${swatchPicker('c-color', x.color)}</div>
      <div class="field full">Icon ${emojiPicker('c-icon', x.icon)}</div>
      ${x.kind === 'expense' ? `<label class="check full"><input type="checkbox" id="c-flow" ${x.flow === 'other' ? 'checked' : ''}>
        Contribution to other spaces (e.g. the household account): not an expense, in reports it counts under "Other spaces"</label>` : ''}
    </div>
    <div class="modal-foot">${c ? '<button class="btn btn-ghost left neg" id="c-del">🗑 Delete</button>' : ''}
      <button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="c-save">Save</button></div>`);
  const getColor = bindSwatches($('#c-color', m)), getIcon = bindEmoji($('#c-icon', m));
  $('[data-cancel]', m).onclick = closeModal;
  $('#c-save', m).onclick = async () => {
    const budget = $('#c-budget', m) ? parseMoney($('#c-budget', m).value) : 0;
    const body = { name: $('#c-name', m).value, kind: x.kind, color: getColor(), icon: getIcon(), budget: budget || 0,
      flow: $('#c-flow', m)?.checked ? 'other' : '' };
    try { await api(c ? `/categories/${c.id}` : '/categories', { method: c ? 'PUT' : 'POST', body }); toast('Category saved'); closeModal(); refresh(); } catch (e) { fail(e); }
  };
  if (c) $('#c-del', m).onclick = async () => {
    if (!(await confirmDialog(`Delete "${c.name}"? Its automatic rules will be deleted too.`, { ok: 'Delete' }))) return;
    const del = (force) => api(`/categories/${c.id}${force ? '?force=1' : ''}`, { method: 'DELETE' });
    try {
      try { await del(false); } catch (e) {
        if (e.status !== 409 || e.data?.transactions == null) throw e;  // in use: say what would be left without a category
        const parts = [e.data.transactions && `${e.data.transactions} transactions`, e.data.recurring && `${e.data.recurring} recurring items`].filter(Boolean).join(' and ');
        if (!(await confirmDialog(`"${c.name}" is used by ${parts}: they will be left uncategorized and drop out of budgets and category reports. `
          + 'To keep the classification, first move them to another category (Transactions → multiple selection → Category). Delete anyway?', { ok: 'Delete anyway' }))) return;
        await del(true);
      }
      toast('Category deleted'); refresh();
    } catch (e) { fail(e); }
  };
}

// ================================================================ budgets
async function renderBudget(v) {
  S.budgetMonth ||= todayIso().slice(0, 7);
  S.budgetAvg ||= '3';
  const d = await api('/budget?' + qs({ month: S.budgetMonth, avg: S.budgetAvg }));
  const avgLabel = S.budgetAvg === 'all' ? `Average of all (${d.avg_months} months)` : `${S.budgetAvg}-month average`;
  const withB = d.categories.filter((c) => c.budget > 0), noB = d.categories.filter((c) => !c.budget);
  const totB = withB.reduce((s, c) => s + c.budget, 0), totS = withB.reduce((s, c) => s + c.spent, 0);
  const over = withB.filter((c) => c.spent > c.budget);
  const [y, m] = S.budgetMonth.split('-').map(Number);
  const isCurrent = S.budgetMonth === todayIso().slice(0, 7);
  const elapsed = isCurrent ? new Date().getDate() / new Date(y, m, 0).getDate() : 1;  // share of the month elapsed
  const row = (c) => {
    const r = c.budget ? c.spent / c.budget : 0;
    const state = !c.budget ? '' : r > 1 ? '<span class="tag err">over</span>' : r > elapsed + 0.1 ? '<span class="tag warn">ahead</span>' : '<span class="tag">ok</span>';
    return `<tr><td><span class="pill quick-filter" style="--c:${esc(c.color)}" ${txLink({ category_id: c.id, kind: 'expense', ...monthBounds(S.budgetMonth), excluded: 0 })}>${esc(c.icon)} ${esc(c.name)}</span></td>
      <td><input class="bd-input" data-cat="${c.id}" inputmode="decimal" value="${c.budget ? moneyInput(c.budget) : ''}" placeholder="—"></td>
      <td class="right"><b>${money0(c.spent)}</b></td><td class="right muted">${money0(c.avg)}</td>
      <td style="min-width:160px">${c.budget ? `<div class="bar ${r > 1 ? 'over' : ''}"><i style="width:${Math.min(100, r * 100).toFixed(1)}%"></i></div><div class="muted small">${pct(r)} of budget</div>` : `<button class="btn btn-sm btn-ghost" data-suggest="${c.id}" data-v="${Math.ceil(c.avg / 1000) * 1000}" ${c.avg ? '' : 'disabled'}>Use the average (${money0(Math.ceil(c.avg / 1000) * 1000)})</button>`}</td>
      <td>${state}</td></tr>`;
  };
  v.innerHTML = `
    <div class="toolbar"><input type="month" id="bd-month" value="${esc(S.budgetMonth)}" max="${todayIso().slice(0, 7)}">
      <select id="bd-avg" title="Average to compare against (full months)">${[['3', '3-month average'], ['6', '6-month average'], ['12', '12-month average'], ['all', 'Average of all']].map(([k, l]) => `<option value="${k}" ${k === S.budgetAvg ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted small">${isCurrent ? `current month: ${pct(elapsed)} elapsed` : 'month closed'} · average calculated over ${esc(fmtDate(d.avg_from))} → ${esc(fmtDate(d.avg_to))}</span></div>
    <div class="kpis">
      <div class="kpi g-indigo"><div class="k-label">🎯 Budget for the month</div><div class="k-value">${money0(totB)}</div><div class="k-sub">${withB.length} categories with a budget</div></div>
      <div class="kpi g-rose"><div class="k-label">📤 Spent (budgeted categories)</div><div class="k-value">${money0(totS)}</div><div class="k-sub">${totB ? pct(totS / totB) + ' of budget' : 'no budget set'}</div></div>
      <div class="kpi g-emerald"><div class="k-label">🟢 Still available</div><div class="k-value">${money0(Math.max(0, totB - totS))}</div><div class="k-sub">${isCurrent ? `${new Date(y, m, 0).getDate() - new Date().getDate()} days to the end of the month` : ''}</div></div>
      <div class="kpi g-amber"><div class="k-label">⚠️ Categories over budget</div><div class="k-value">${over.length}</div><div class="k-sub">${over.map((c) => esc(c.name)).join(', ') || 'none'}</div></div>
    </div>
    <div class="card"><div class="card-head"><div><h3>Budget per category</h3><p class="muted small" style="margin:3px 0 0">Type the monthly limit next to the category: it saves by itself. "Ahead" = spending faster than the share of the month that has passed.</p></div></div>
      <div class="table-wrap"><table class="sp-table"><thead><tr><th>Category</th><th>Budget / month</th><th class="right">Spent this month</th><th class="right">${esc(avgLabel)}</th><th>Progress</th><th></th></tr></thead>
      <tbody>${withB.map(row).join('')}${noB.length ? `<tr><td colspan="6" class="muted small" style="padding-top:18px">No budget</td></tr>${noB.map(row).join('')}` : ''}</tbody></table></div></div>`;
  $('#bd-month').onchange = (e) => { if (e.target.value) { S.budgetMonth = e.target.value; route(); } };
  $('#bd-avg').onchange = (e) => { S.budgetAvg = e.target.value; route(); };
  const saveBudget = async (cid, cents) => {
    try { await api(`/categories/${cid}/budget`, { method: 'PUT', body: { budget: cents } }); await loadMeta(); route(); } catch (e) { fail(e); }
  };
  $$('.bd-input', v).forEach((inp) => inp.addEventListener('change', () => saveBudget(inp.dataset.cat, parseMoney(inp.value) || 0)));
  $$('[data-suggest]', v).forEach((b) => (b.onclick = () => saveBudget(b.dataset.suggest, +b.dataset.v)));
}

// ================================================================ mortgage
async function renderMutuo(v) {
  const plans = await api('/tools/mortgage');
  if (!plans.length) {
    v.innerHTML = `<div class="card empty"><div class="big">🏦</div><h3>No installment loans</h3><p>In Recurring, create an expense with the number of installments, amount financed and rate (fixed, variable or mixed): you will see the amortization schedule here.</p>
      <div class="actions"><a class="btn btn-primary" href="#/ricorrenti">Go to Recurring</a></div></div>`;
    return;
  }
  const tot = (k) => plans.reduce((s, p) => s + p[k], 0);
  v.innerHTML = `
    <div class="kpis">
      <div class="kpi g-indigo"><div class="k-label">🏦 Total remaining debt</div><div class="k-value">${money0(tot('residual'))}</div><div class="k-sub">principal still to repay</div></div>
      <div class="kpi g-emerald"><div class="k-label">✅ Principal already repaid</div><div class="k-value">${money0(tot('capital_paid'))}</div><div class="k-sub">${plans.length} loans</div></div>
      <div class="kpi g-rose"><div class="k-label">💸 Interest paid</div><div class="k-value">${money0(tot('interest_paid'))}</div><div class="k-sub">so far</div></div>
      <div class="kpi g-amber"><div class="k-label">⏳ Interest remaining</div><div class="k-value">${money0(tot('interest_left'))}</div><div class="k-sub">until the end of the schedules</div></div>
    </div>
    ${plans.map((p, i) => `<div class="card mt-plan" style="margin-bottom:18px">
      <div class="card-head"><div><h3>${esc(p.name)}</h3><p class="muted small" style="margin:3px 0 0">${esc(p.account)} · ${money0(p.principal)} in ${p.installments} installments · rate ${p.rate_known ? esc(p.rate_label) : '<span class="tag warn">not specified: calculated at 0%</span>'} · ends ${esc(fmtDate(p.end_date))}</p></div>
        <a class="btn btn-sm" href="#/movimenti?${qs({ recurring_id: p.id })}">📄 Installments paid</a></div>
      ${p.index_missing ? `<div class="sp-warn card" style="margin-bottom:12px">⚠️ The current value of the ${esc(p.rate_index)} is missing: the variable part of the schedule is indicative (calculated with a 0% index, i.e. spread only, ${String(p.spread).replace('.', ',')}%). Enter it in the mortgage's recurring item (Recurring → Edit → Rate).</div>` : ''}
      ${p.rate_change ? `<div class="mt-change">🔁 From installment ${p.rate_change.n} (${esc(fmtDate(p.rate_change.date))}) the rate becomes <b>${String(+p.rate_change.rate.toFixed(3)).replace('.', ',')}%</b>${p.index_missing ? ' (estimated)' : ''} and the installment becomes about <b>${money(p.rate_change.installment)}</b>.</div>` : ''}
      <div class="mt-grid">
        <div class="rec-stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <div class="rec-stat"><span>Current installment</span><b>${money(p.installment)}</b></div>
          <div class="rec-stat"><span>Current rate</span><b>${String(+p.current_rate.toFixed(3)).replace('.', ',')}%</b></div>
          <div class="rec-stat"><span>Paid</span><b>${p.paid} / ${p.installments}</b></div>
          <div class="rec-stat"><span>Remaining</span><b>${money0(p.residual)}</b></div>
          <div class="rec-stat"><span>Interest paid</span><b>${money0(p.interest_paid)}</b></div>
          <div class="rec-stat"><span>Future interest</span><b>${money0(p.interest_left)}</b></div>
        </div>
        <div class="chart-box" style="height:200px"><canvas id="mt-c${i}"></canvas></div>
      </div>
      <details class="mt-sched"><summary>Full amortization schedule (${p.schedule.length} installments)</summary>
        <div class="table-wrap" style="max-height:340px;overflow:auto"><table class="sp-table"><thead><tr><th>No.</th><th>Date</th><th class="right">Rate</th><th class="right">Installment</th><th class="right">Principal</th><th class="right">Interest</th><th class="right">Remaining</th></tr></thead>
        <tbody>${p.schedule.map((r) => `<tr class="${r.n <= p.paid ? 'is-paid' : ''}"><td>${r.n}</td><td>${esc(fmtDate(r.date))}</td><td class="right muted">${String(+r.rate.toFixed(3)).replace('.', ',')}%</td><td class="right">${money(r.installment)}</td><td class="right">${money(r.capital)}</td><td class="right">${money(r.interest)}</td><td class="right">${money0(r.residual)}</td></tr>`).join('')}</tbody></table></div></details>
    </div>`).join('')}
    <div class="card"><div class="card-head"><div><h3>🧮 Simulate an early repayment</h3><p class="muted small" style="margin:3px 0 0">You pay an extra amount: you can reduce the term (same installment) or the installment (same term).</p></div></div>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
        <label class="field">Loan <select id="sim-p">${plans.filter((p) => p.paid < p.installments).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field">Extra amount (€) <input id="sim-x" inputmode="decimal" value="10000"></label>
        <label class="field">After installment no. <input id="sim-n" type="number" min="0"></label>
        <label class="field">Goal <select id="sim-m"><option value="duration">Reduce the term</option><option value="installment">Reduce the installment</option></select></label>
      </div>
      <div id="sim-out" style="margin-top:14px"></div></div>`;
  plans.forEach((p, i) => {
    const yearly = {};  // principal and interest per year
    p.schedule.forEach((r) => { const yy = r.date.slice(0, 4); (yearly[yy] ||= { c: 0, i: 0 }); yearly[yy].c += r.capital; yearly[yy].i += r.interest; });
    const years = Object.keys(yearly);
    chart($(`#mt-c${i}`), {
      type: 'bar',
      data: { labels: years, datasets: [
        { label: 'Principal', data: years.map((yy) => yearly[yy].c), backgroundColor: '#7b52ab', borderRadius: 3, maxBarThickness: 18 },
        { label: 'Interest', data: years.map((yy) => yearly[yy].i), backgroundColor: '#f59f45', borderRadius: 3, maxBarThickness: 18 }] },
      options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (x) => moneyK(x) } } },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } },
    });
  });
  const sim = debounce(async () => {
    const p = plans.find((x) => x.id === +$('#sim-p').value);
    if (!p) return;
    if ($('#sim-n').value === '') $('#sim-n').value = p.paid;
    try {
      const r = await api('/tools/mortgage/simulate', { method: 'POST', body: { recurring_id: p.id, extra: parseMoney($('#sim-x').value), after_payment: +$('#sim-n').value, mode: $('#sim-m').value } });
      $('#sim-out').innerHTML = r.closed ? `<div class="sp-warn card">🎉 With this amount the loan is paid off: you save ${money0(r.interest_saved)} in interest.</div>`
        : `<div class="rec-stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
            <div class="rec-stat"><span>Interest saved</span><b class="pos">${money0(r.interest_saved)}</b></div>
            <div class="rec-stat"><span>New installment</span><b>${money(r.new_installment)}</b></div>
            <div class="rec-stat"><span>Installments left</span><b>${r.new_remaining}${r.months_saved ? ` (−${r.months_saved})` : ''}</b></div>
            <div class="rec-stat"><span>New end date</span><b>${esc(fmtDate(r.new_end))}</b></div></div>`;
    } catch (e) { $('#sim-out').innerHTML = `<p class="neg small">${esc(e.message)}</p>`; }
  }, 300);
  ['#sim-p', '#sim-x', '#sim-n', '#sim-m'].forEach((id) => $(id).addEventListener('input', sim));
  $('#sim-p').addEventListener('change', () => { $('#sim-n').value = ''; sim(); });
  sim();
}

// ================================================================ emergency fund
async function renderEmergenza(v) {
  const em = await api('/tools/emergency');
  const months = em.months_total, ratio = months == null ? 0 : months / em.target_months;
  const family = S.portfolio.type === 'family';
  v.innerHTML = `
    <div class="card" style="margin-bottom:18px"><div class="card-head"><div><h3>🛟 ${family ? 'Household emergency fund' : 'Emergency fund'}</h3>
      <p class="muted small" style="margin:3px 0 0">How many months of expenses the <b>available reserve</b> would cover: the accounts plus uninvested broker cash and money market ETFs (available within a few days), using the average spending of the last ${em.months_basis} months. Stocks, bonds and funds do not count.</p></div>
      <label class="field" style="flex-direction:row;align-items:center;gap:8px">Target <input id="em-target" type="number" min="1" max="36" step="1" value="${em.target_months}" style="width:70px"> months</label></div>
      <div class="em-grid">
        <div class="em-big"><div class="em-months ${ratio >= 1 ? 'pos' : ratio >= 0.5 ? '' : 'neg'}">${months == null ? '—' : months.toLocaleString('it-IT', { maximumFractionDigits: 1 })}</div><div class="muted">months covered</div></div>
        <div style="flex:1;min-width:0">
          <div class="budget-row" style="padding-top:0"><div class="top"><span>Available reserve <b>${money0(em.liquidity)}</b></span><span class="muted">target ${money0(em.target_amount)}</span></div>
            <div class="bar ${ratio < 0.5 ? 'over' : ''}"><i style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></i></div></div>
          <div class="rec-stats" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:8px">
            <div class="rec-stat"><span>Average spending / month</span><b>${money0(em.avg_expenses)}</b></div>
            <div class="rec-stat"><span>Fixed expenses only</span><b>${money0(em.fixed_monthly)} → ${em.months_fixed == null ? '—' : em.months_fixed.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' months'}</b></div>
            <div class="rec-stat"><span>Missing</span><b>${money0(Math.max(0, em.target_amount - em.liquidity))}</b></div></div>
          <div class="em-parts">
            <div class="em-part"><span>💧 Cash in accounts <span class="muted small">(the same as in the Calendar)</span></span><b>${money0(em.operational)}</b>
              <div class="muted small">${em.accounts.filter((a) => a.group === 'conti').map((a) => `${esc(a.name)} ${money0(a.balance)}`).join(' · ') || '—'}</div></div>
            <div class="em-part"><span>📈 Broker: cash and money market</span><b>${em.broker_cash ? '+' + money0(em.broker_cash) : '—'}</b>
              <div class="muted small">${em.accounts.filter((a) => a.group === 'broker').map((a) => `${esc(a.name)} ${money0(a.balance)}`).join(' · ') || 'none'}</div></div>
            <div class="em-part total"><span>🛟 Available reserve</span><b>${money0(em.liquidity)}</b></div>
          </div>
        </div></div></div>`;
  $('#em-target').addEventListener('change', async (e) => {
    try { await api('/tools/emergency', { method: 'PUT', body: { target_months: e.target.value } }); route(); } catch (err) { fail(err); }
  });
}

// ================================================================ goals
async function renderObiettivi(v) {
  const goals = await api('/goals');
  const family = S.portfolio.type === 'family';
  v.innerHTML = `
    <div class="toolbar"><h3 style="margin:0">🏁 ${family ? 'Shared goals' : 'Savings goals'}</h3><span class="spacer"></span><button class="btn btn-primary" id="gl-new">＋ New goal</button></div>
    <div class="rec-grid">${goals.map((gl) => `<div class="card rec-card">
      <div class="rec-head"><div class="cat-ico" style="--c:${esc(gl.color)}">${esc(gl.icon)}</div>
        <div class="grow" style="min-width:0"><div class="title ellipsis">${esc(gl.name)}</div><div class="muted small ellipsis">${gl.account_id ? `balance of ${esc(gl.account_name)}` : 'amount set aside by hand'}${gl.target_date ? ` · by ${esc(fmtDate(gl.target_date))}` : ''}</div></div></div>
      <div class="rec-line"><span class="rec-amount">${money0(gl.current)}</span><span class="rec-next">of ${money0(gl.target)}</span></div>
      <div class="rec-progress"><div class="top small"><span>${pct(gl.progress)} reached</span><span class="muted">${money0(gl.missing)} to go</span></div>
        <div class="bar"><i style="width:${(gl.progress * 100).toFixed(1)}%"></i></div></div>
      <div class="rec-stats">${gl.target_date ? `<div class="rec-stat"><span>Per month</span><b>${money0(gl.monthly_needed)}</b></div><div class="rec-stat"><span>Months</span><b>${gl.months_left}</b></div>` : '<div class="rec-stat"><span>Deadline</span><b>none</b></div><div class="rec-stat"><span></span><b></b></div>'}
        <div class="rec-stat"><span>${gl.per_person ? 'Each' : ''}</span><b>${gl.per_person ? gl.per_person.map((p) => `${esc(p.name.slice(0, 4))} ${money0(p.monthly)}`).join(' · ') : ''}</b></div></div>
      <div class="rec-actions"><button class="btn btn-sm" data-gl="${gl.id}">✏️ Edit</button></div></div>`).join('')
      || `<div class="card empty"><div class="big">🏁</div><h3>No goals</h3><p>${family ? 'Holiday, new car, home improvements…' : 'Trip, car, course, home down payment…'} Set the amount and the date: HomeCoin calculates how much to set aside each month${family ? ' and each person\'s share based on income' : ''}.</p></div>`}</div>`;
  $('#gl-new').onclick = () => goalModal();
  $$('[data-gl]', v).forEach((b) => (b.onclick = () => goalModal(goals.find((x) => x.id === +b.dataset.gl))));
}

function goalModal(gl = null) {
  const x = gl || { name: '', icon: '🎯', color: PALETTE[Math.floor(Math.random() * PALETTE.length)], target: 0, saved: 0 };
  const accs = S.accounts.filter((a) => !a.archived || a.id === x.account_id);
  const m = openModal(gl ? 'Edit goal' : 'New goal', `
    <div class="form-grid">
      <label class="field full">Name <input id="gl-name" maxlength="60" value="${esc(x.name)}" placeholder="E.g. Summer holiday, New car" autofocus></label>
      <label class="field">Target amount (€) <input id="gl-target" inputmode="decimal" value="${moneyInput(x.target)}"></label>
      <label class="field">By (optional) <input id="gl-date" type="date" value="${esc(x.target_date || '')}"></label>
      <label class="field full">How progress is measured <select id="gl-acc"><option value="">Amount set aside, entered by hand</option>
        ${accs.map((a) => `<option value="${a.id}" ${a.id === x.account_id ? 'selected' : ''}>Balance of the account ${esc(a.name)}</option>`).join('')}</select></label>
      <label class="field" id="gl-saved-wrap">Set aside so far (€) <input id="gl-saved" inputmode="decimal" value="${moneyInput(x.saved)}"></label>
      <div class="field full">Color ${swatchPicker('gl-color', x.color)}</div>
      <div class="field full">Icon ${emojiPicker('gl-icon', x.icon)}</div>
    </div>
    <div class="modal-foot">${gl ? '<button class="btn btn-ghost left neg" id="gl-del">🗑 Delete</button>' : ''}
      <button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="gl-save">Save</button></div>`);
  const getColor = bindSwatches($('#gl-color', m)), getIcon = bindEmoji($('#gl-icon', m));
  const sync = () => $('#gl-saved-wrap', m).classList.toggle('hidden', !!$('#gl-acc', m).value);
  $('#gl-acc', m).onchange = sync; sync();
  $('[data-cancel]', m).onclick = closeModal;
  $('#gl-save', m).onclick = async () => {
    const body = { name: $('#gl-name', m).value, target: parseMoney($('#gl-target', m).value), target_date: $('#gl-date', m).value || null,
      account_id: $('#gl-acc', m).value || null, saved: parseMoney($('#gl-saved', m).value) || 0, color: getColor(), icon: getIcon() };
    try { await api(gl ? `/goals/${gl.id}` : '/goals', { method: gl ? 'PUT' : 'POST', body }); toast('Goal saved'); closeModal(); route(); } catch (e) { fail(e); }
  };
  if (gl) $('#gl-del', m).onclick = async () => {
    if (!(await confirmDialog(`Delete the goal "${gl.name}"?`, { ok: 'Delete' }))) return;
    try { await api(`/goals/${gl.id}`, { method: 'DELETE' }); toast('Goal deleted'); route(); } catch (e) { fail(e); }
  };
}

// ================================================================ investments
// asset class codes (stored and sent by the server in Italian); ASSET_LABEL gives the text shown to the user
const ASSET_CLASSES = ['azioni', 'obbligazioni', 'monetario', 'materie prime', 'immobiliare', 'crypto', 'altro'];
const ASSET_LABEL = { azioni: 'Stocks', obbligazioni: 'Bonds', monetario: 'Money market', 'materie prime': 'Commodities', immobiliare: 'Real estate',
  crypto: 'Crypto', altro: 'Other', 'non specificato': 'Unspecified', 'liquidità': 'Cash' };
const assetLabel = (c) => ASSET_LABEL[c] || c;
// the class changes the behavior: money market funds are cash (they do not count as invested and count toward the emergency fund)
const CLASS_HELP = {
  monetario: '💧 <b>Money market</b>: it is parked cash. Buying or selling it does <b>not</b> count as invested, and it counts toward the emergency fund.',
  azioni: '📈 Investment: purchases and sales count as <b>invested</b>.', obbligazioni: '📈 Investment: purchases and sales count as <b>invested</b>.',
  'materie prime': '📈 Investment: purchases and sales count as <b>invested</b>.', immobiliare: '📈 Investment: purchases and sales count as <b>invested</b>.',
  crypto: '📈 Investment: purchases and sales count as <b>invested</b>.', altro: '📈 Investment: purchases and sales count as <b>invested</b>.',
};
const ASSET_COLORS = { azioni: '#7b52ab', obbligazioni: '#3f86dc', monetario: '#2fbf71', 'materie prime': '#fcc419', immobiliare: '#f59f45', crypto: '#e45bc4', altro: '#8b8fa8', 'non specificato': '#c9976a' };
const pctSigned = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`);

async function renderInvestimenti(v) {
  S.invMonths ||= '24';
  const d = await api('/investments?months=' + S.invMonths);
  if (!d.accounts.length) {
    v.innerHTML = `<div class="card empty"><div class="big">📊</div><h3>No investment accounts</h3>
      <p>Create an account of type <b>Investment account</b> (broker, pension fund, investment plan…). Record contributions as transfers from your current account and update the value: HomeCoin calculates gain and return.</p>
      <div class="actions"><button class="btn btn-primary" id="iv-new">＋ New investment account</button></div></div>`;
    $('#iv-new').onclick = () => accountModal(null, { type: 'investimenti', icon: '📈', name: '' });
    return;
  }
  const hasHoldings = d.accounts.some((a) => a.holdings.length);
  S.invAccounts = d.accounts;
  const pending = d.pac_pending || [];
  const unverified = d.pac_unverified || [];
  v.innerHTML = `
    ${pending.length ? `<div class="card" style="margin-bottom:18px;border-color:var(--amber)"><div class="card-head"><h3>⏳ Investment plan purchases to complete</h3>
      <span class="muted small">contribution made, but no known price to calculate the units</span></div>
      <div class="list">${pending.map((p, i) => `<div class="list-item"><div class="grow"><b>${esc(p.name)}</b><div class="muted small">${esc(fmtDate(p.date))} · ${esc(p.ticker)}</div></div>
        <b>${money(p.amount)}</b><button class="btn btn-sm btn-primary" data-pac="${i}">Record purchase</button></div>`).join('')}</div></div>` : ''}
    ${unverified.length ? `<div class="card" style="margin-bottom:18px;border-color:var(--amber)"><div class="card-head"><h3>⚠️ Investment plan prices to verify</h3>
      <span class="muted small">automatic purchases with an estimated price for more than 30 days: enter the actual price and units from the broker statement</span></div>
      <div class="list">${unverified.map((o, i) => `<div class="list-item"><div class="grow"><b>${esc(o.ticker || '')}</b> <span class="muted small">${esc(o.account_name)}</span><div class="muted small">${esc(fmtDate(o.date))} · estimated ${esc(unitPrice(o.price))} · ${qtyFmt(o.quantity)} units</div></div>
        <b>${money(Math.abs(o.amount))}</b><button class="btn btn-sm btn-primary" data-pacv="${i}">✏️ Verify</button></div>`).join('')}</div></div>` : ''}`
    + `
    <div class="toolbar"><span class="muted small">Value = latest valuation (automatic from securities or entered by hand). Invested = net transfers/income into the account.</span><span class="spacer"></span>
      ${hasHoldings ? '<button class="btn" id="iv-refresh" title="The only feature that uses the internet: it sends only the tickers to Yahoo Finance">🌐 Update prices</button>' : ''}
      <button class="btn btn-primary" id="iv-new">＋ Investment account</button></div>
    <div class="kpis">
      <div class="kpi g-indigo"><div class="k-label">📊 Current value</div><div class="k-value">${money0(d.total_value)}</div><div class="k-sub">${d.accounts.length} accounts</div></div>
      <div class="kpi g-sky"><div class="k-label">💶 Net invested</div><div class="k-value">${money0(d.total_invested)}</div><div class="k-sub">capital put in</div></div>
      <div class="kpi ${d.total_gain >= 0 ? 'g-emerald' : 'g-rose'}"><div class="k-label">${d.total_gain >= 0 ? '📈' : '📉'} Gain</div><div class="k-value">${d.total_gain >= 0 ? '+' : ''}${money0(d.total_gain)}</div><div class="k-sub">${pctSigned(d.total_return)} on invested</div></div>
      <div class="kpi g-amber"><div class="k-label">⏱️ Annual return</div><div class="k-value">${pctSigned(d.total_xirr)}</div><div class="k-sub">XIRR, accounts for when you invested</div></div>
    </div>
    <div class="grid-3-2">
      <div class="card"><div class="card-head"><h3>Value and invested over time</h3>
        <select id="iv-months" style="width:auto">${[['12', 'Last 12 months'], ['24', 'Last 24 months'], ['36', 'Last 36 months'], ['all', 'All']].map(([k, l]) => `<option value="${k}" ${k === S.invMonths ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="chart-box"><canvas id="iv-line"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>Allocation</h3></div>${d.allocation.length ? `<div class="chart-box" style="height:220px"><canvas id="iv-alloc"></canvas></div>
        <div class="legend" style="margin-top:10px">${d.allocation.map((x) => `<div class="legend-item"><span class="dot" style="background:${ASSET_COLORS[x.name] || '#8b8fa8'}"></span><span>${esc(assetLabel(x.name))}<span class="pct">${pct(x.value / d.allocation.reduce((s, y) => s + y.value, 0))}</span></span><b class="num">${money0(x.value)}</b></div>`).join('')}</div>`
        : '<div class="empty">Add securities to see the allocation</div>'}</div>
    </div>
    ${d.accounts.map((a) => `<div class="card" style="margin-bottom:18px">
      <div class="card-head"><div><h3>${esc(a.icon)} ${esc(a.name)}</h3><p class="muted small" style="margin:3px 0 0">${a.has_trades ? 'value = cash + securities (from trades)' : a.value_date ? `value as of ${esc(fmtDate(a.value_date))}` : '<span class="tag warn">no valuation: showing the book balance</span>'}</p>
        ${a.idle ? `<p class="small" style="margin:6px 0 0"><span class="tag warn">💤 ${money(a.idle.cash)} of cash idle for ${a.idle.days} days</span> <span class="muted">if you have already invested it, record the purchase with "＋ Trade"</span></p>` : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${a.has_trades ? '' : `<button class="btn btn-sm" data-val="${a.id}">＋ Manual value</button>`}<button class="btn btn-sm" data-hold="${a.id}">＋ Security</button><button class="btn btn-sm btn-primary" data-trade="${a.id}">＋ Trade</button></div></div>
      <div class="rec-stats" style="grid-template-columns:repeat(${a.has_trades ? 7 : 5},minmax(0,1fr))">
        <div class="rec-stat"><span>Value</span><b>${money0(a.value)}</b></div><div class="rec-stat"><span>Invested</span><b>${money0(a.invested)}</b></div>
        <div class="rec-stat"><span>Gain</span><b class="${a.gain >= 0 ? 'pos' : 'neg'}">${a.gain >= 0 ? '+' : ''}${money0(a.gain)}</b></div>
        <div class="rec-stat"><span>Return</span><b>${pctSigned(a.return)}</b></div><div class="rec-stat"><span>Annual (XIRR)</span><b>${pctSigned(a.xirr)}</b></div>
        ${a.has_trades ? `<div class="rec-stat"><span>Cash</span><b>${money(a.cash)}</b></div><div class="rec-stat"><span>Realized gains</span><b class="${a.realized >= 0 ? 'pos' : 'neg'}">${a.realized >= 0 ? '+' : ''}${money0(a.realized)}</b></div>` : ''}</div>
      ${holdingsTable(a)}
      ${a.has_trades ? `<details class="mt-sched" data-trades="${a.id}"><summary>Trades</summary><div class="trades-box"><div class="loading">Loading…</div></div></details>` : ''}
      ${a.valuations.length && !a.has_trades ? `<details class="mt-sched"><summary>Valuation history (${a.valuations.length})</summary><div class="list">${a.valuations.slice().reverse().map((x) => `<div class="list-item">
        <span class="grow">${esc(fmtDate(x.date))} <span class="tag">${x.source === 'auto' ? 'automatic' : 'by hand'}</span></span><b>${money0(x.value)}</b><button class="icon-btn sm" data-vdel="${x.id}" title="Delete">✕</button></div>`).join('')}</div></details>` : ''}
    </div>`).join('')}`;

  $('#iv-new').onclick = () => accountModal(null, { type: 'investimenti', icon: '📈', name: '' });
  $('#iv-months').onchange = (e) => { S.invMonths = e.target.value; route(); };
  if ($('#iv-refresh')) $('#iv-refresh').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = '⏳ Updating…';
    try {
      const r = await api('/investments/refresh', { method: 'POST' });
      toast(r.errors.length ? `${r.updated} securities updated · ${r.errors.length} errors` : `Prices updated (${r.updated} securities)`, r.errors.length ? 'err' : 'ok');
      if (r.errors.length) console.warn(r.errors);
      route();
    } catch (err) { fail(err); e.target.disabled = false; }
  };
  $$('[data-val]', v).forEach((b) => (b.onclick = () => valuationModal(+b.dataset.val)));
  $$('[data-hold]', v).forEach((b) => (b.onclick = () => holdingModal(+b.dataset.hold)));
  $$('[data-trade]', v).forEach((b) => (b.onclick = () => tradeModal(d.accounts.find((a) => a.id === +b.dataset.trade))));
  $$('[data-pac]', v).forEach((b) => (b.onclick = () => {
    const p = pending[+b.dataset.pac], acc = d.accounts.find((a) => a.id === p.account_id);
    if (acc) tradeModal(acc, null, { kind: 'buy', date: p.date, holding_id: p.holding_id, amount: -p.amount, notes: `Investment plan «${p.name}»`,
      external_id: `pac:${p.recurring_id}:${p.date}` });
  }));
  $$('[data-pacv]', v).forEach((b) => (b.onclick = () => {
    const o = unverified[+b.dataset.pacv], acc = d.accounts.find((a) => a.id === o.account_id);
    if (acc) tradeModal(acc, o);
  }));
  $$('[data-trades]', v).forEach((det) => det.addEventListener('toggle', () => det.open && loadTrades(det, +det.dataset.trades), { once: true }));
  $$('[data-hedit]', v).forEach((b) => (b.onclick = () => holdingModal(+b.dataset.acc, d.accounts.flatMap((a) => a.holdings).find((h) => h.id === +b.dataset.hedit))));
  $$('[data-vdel]', v).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('Delete this valuation?', { ok: 'Delete' }))) return;
    try { await api(`/valuations/${b.dataset.vdel}`, { method: 'DELETE' }); route(); } catch (e) { fail(e); }
  }));
  const s = d.series.filter((x) => x.invested || x.value);
  chart($('#iv-line'), {
    type: 'line',
    data: { labels: s.map((x) => fmtMonth(x.month)), datasets: [
      { label: 'Value', data: s.map((x) => x.value), borderColor: '#7b52ab', backgroundColor: (ctx) => vGradient(ctx, '#7b52ab'), fill: true, tension: .3, borderWidth: 2, pointRadius: 3 },
      { label: 'Invested', data: s.map((x) => x.invested), borderColor: '#8b8fa8', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .3 }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: (x) => moneyK(x) } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } },
  });
  if (d.allocation.length) chart($('#iv-alloc'), {
    type: 'doughnut', data: { labels: d.allocation.map((x) => assetLabel(x.name)), datasets: [{ data: d.allocation.map((x) => x.value), backgroundColor: d.allocation.map((x) => ASSET_COLORS[x.name] || '#8b8fa8'), borderColor: css('--surface'), borderWidth: 2 }] },
    options: { cutout: '65%', maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

const qtyFmt = (q) => (q ?? 0).toLocaleString('it-IT', { maximumFractionDigits: 6 });
const signedMoney0 = (c) => (c >= 0 ? '+' : '') + money0(c);
function holdingsTable(a) {
  const open = a.holdings.filter((h) => !h.trades || h.quantity > 1e-9);  // securities sold entirely stay in the trades
  if (!open.length) return '';
  const t = a.has_trades;
  // order: security → quantity → purchase (average cost, cost) → today (price, value) → result; numbers aligned in columns
  const priceCell = (h) => (h.price != null
    // everything in euros like average cost, cost and value; the original quote (e.g. in dollars) stays below, in small print
    ? `${esc(unitPrice(h.price_eur ?? h.price, h.price_eur != null ? 'EUR' : h.currency))}<div class="muted small">${h.currency && h.currency !== 'EUR' ? `${esc(unitPrice(h.price, h.currency))} · ` : ''}${esc(fmtDate(h.price_date))}</div>`
    : h.estimated_price ? '<span class="muted small">last trade<br>price</span>' : '<span class="muted">needs updating</span>');
  return `<div class="table-wrap" style="margin-top:12px"><table class="sp-table inv-table"><thead>
      ${t ? '<tr class="inv-groups"><th colspan="3"></th><th colspan="2" class="center">Purchase</th><th colspan="2" class="center">Today</th><th colspan="2"></th></tr>' : ''}
      <tr><th>Security</th><th>Class</th><th class="right">Quantity</th>
      ${t ? '<th class="right">Avg cost</th><th class="right">Cost</th>' : ''}<th class="right">Price</th><th class="right">Value</th>${t ? '<th class="right">Gain</th>' : ''}<th></th></tr></thead>
    <tbody>${open.map((h) => `<tr><td><b>${esc(h.ticker)}</b><div class="muted small">${esc(h.name)}${h.isin ? ` · ${esc(h.isin)}` : ''}</div></td><td class="nowrap"><span class="dot" style="background:${ASSET_COLORS[h.asset_class] || '#8b8fa8'}"></span> ${esc(assetLabel(h.asset_class))}</td>
      <td class="right num">${qtyFmt(h.quantity)}</td>
      ${t ? `<td class="right num">${h.avg_price != null ? esc(unitPrice(h.avg_price)) : '—'}</td><td class="right num">${h.cost != null ? money0(h.cost) : '—'}</td>` : ''}
      <td class="right num">${priceCell(h)}</td>
      <td class="right num"><b>${h.value != null ? money0(h.value) : '—'}</b></td>
      ${t ? `<td class="right num">${h.unrealized != null ? `<b class="${h.unrealized >= 0 ? 'pos' : 'neg'}">${signedMoney0(h.unrealized)}</b>${h.cost > 0 ? `<div class="muted small">${pctSigned(h.unrealized / h.cost)}</div>` : ''}` : '—'}</td>` : ''}
      <td><div class="row-actions" style="opacity:1"><button class="icon-btn sm" data-hedit="${h.id}" data-acc="${a.id}">✏️</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
const TRADE_KINDS = { buy: 'Buy', sell: 'Sell', split: 'Split / reverse split', capital: 'Capital return', interest: 'Interest', dividend: 'Dividend', fee: 'Fee' };
async function loadTrades(det, aid) {
  const box = $('.trades-box', det);
  try {
    const rows = await api(`/investments/${aid}/trades`);
    box.innerHTML = rows.length ? `<div class="table-wrap"><table class="sp-table inv-table"><thead><tr><th>Date</th><th>Security</th><th>Trade</th><th class="right">Quantity</th><th class="right">Price</th><th class="right">Cash</th><th></th></tr></thead>
      <tbody>${rows.map((o) => `<tr><td class="nowrap">${esc(fmtDate(o.date))}</td>
        <td>${o.ticker ? `<b>${esc(o.ticker)}</b>` : '<span class="muted">—</span>'}</td><td>${esc(TRADE_KINDS[o.kind])}${o.notes ? `<div class="muted small">${esc(o.notes)}</div>` : ''}</td>
        <td class="right num">${o.quantity ? qtyFmt(o.quantity) : ''}</td>
        <td class="right num">${o.price != null ? esc(unitPrice(o.price)) : ''}</td>
        <td class="right num"><b class="${o.amount >= 0 ? 'pos' : 'neg'}">${o.amount ? (o.amount > 0 ? '+' : '−') + money(Math.abs(o.amount)) : ''}</b>${o.fees ? `<div class="muted small">fees ${money(o.fees)}</div>` : ''}</td>
        <td><div class="row-actions" style="opacity:1"><button class="icon-btn sm" data-tedit="${o.id}" title="Edit">✏️</button><button class="icon-btn sm" data-tdel="${o.id}" title="Delete">✕</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No trades</div>';
    $$('[data-tedit]', box).forEach((b) => (b.onclick = () => {
      const acc = (S.invAccounts || []).find((x) => x.id === aid);
      if (acc) tradeModal(acc, rows.find((x) => x.id === +b.dataset.tedit));
    }));
    $$('[data-tdel]', box).forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog('Delete this trade? Quantities and cash will be recalculated.', { ok: 'Delete' }))) return;
      try { await api(`/trades/${b.dataset.tdel}`, { method: 'DELETE' }); route(); } catch (e) { fail(e); }
    }));
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
// o = existing trade (edit); preset = initial values (e.g. investment plan purchase to complete)
function tradeModal(a, o = null, preset = {}) {
  const hs = a.holdings;
  const x = { kind: 'buy', date: todayIso(), holding_id: '', quantity: '', price: '', fees: 0, amount: 0, notes: '', ...preset, ...(o || {}) };
  const dec = (v, d = 6) => (v === '' || v == null ? '' : (+v).toLocaleString('it-IT', { maximumFractionDigits: d, useGrouping: false }));
  const tradeTotal = ['buy', 'sell'].includes(x.kind) && x.amount ? Math.abs(x.amount) : '';
  const m = openModal(`${o ? 'Edit trade' : 'New trade'} · ${a.name}`, `
    <div class="form-grid">
      <label class="field">Type <select id="tr-kind">${Object.entries(TRADE_KINDS).map(([k, l]) => `<option value="${k}" ${k === x.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Date <input id="tr-date" type="date" value="${esc(x.date)}"></label>
      <label class="field full" data-f="hold">Security <select id="tr-hold"><option value="">—</option>${hs.map((h) => `<option value="${h.id}" ${h.id === +x.holding_id ? 'selected' : ''}>${esc(h.ticker)} · ${esc(h.name)}</option>`).join('')}</select></label>
      <label class="field" data-f="qty"><span id="tr-qty-l">Quantity</span> <input id="tr-qty" inputmode="decimal" value="${dec(x.kind === 'sell' ? Math.abs(x.quantity) : x.quantity)}"></label>
      <label class="field" data-f="price">Unit price (€) <input id="tr-price" inputmode="decimal" value="${dec(x.price, 4)}"></label>
      <label class="field" data-f="total">Total amount (€) <input id="tr-total" inputmode="decimal" value="${tradeTotal ? moneyInput(tradeTotal) : ''}" placeholder="optional"></label>
      <label class="field" data-f="fees">Fees (€) <input id="tr-fees" inputmode="decimal" value="${x.fees ? moneyInput(x.fees) : ''}"></label>
      <label class="field" data-f="amount">Amount (€) <input id="tr-amount" inputmode="decimal" value="${!['buy', 'sell', 'split'].includes(x.kind) && x.amount ? moneyInput(Math.abs(x.amount)) : ''}"></label>
      <label class="field full">Notes <input id="tr-notes" maxlength="200" value="${esc(x.notes || '')}"></label>
    </div>
    <p class="muted small" id="tr-hint"></p>
    <div class="modal-foot"><button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="tr-save">Save</button></div>`, { wide: true });
  const show = () => {
    const k = $('#tr-kind', m).value, trade = k === 'buy' || k === 'sell';
    const vis = { hold: trade || k === 'split' || k === 'capital' || k === 'dividend', qty: trade || k === 'split', price: trade, total: trade, fees: trade, amount: !trade && k !== 'split' };
    Object.entries(vis).forEach(([f, on]) => $(`[data-f="${f}"]`, m).classList.toggle('hidden', !on));
    $('#tr-qty-l', m).textContent = k === 'split' ? 'Quantity change (+/−)' : 'Quantity';
    $('#tr-hint', m).textContent = { buy: 'The account cash decreases by the total (quantity × price + fees, or the total amount from the statement if you enter it). With amount and price the quantity is calculated automatically.',
      sell: 'Cash increases by the total; the gain or loss is calculated on the average cost.',
      split: 'Only the quantity changes (e.g. reverse split 50 → 1,66: −48,34).', capital: 'Return of capital: it reduces the cost of the security and increases cash.' }[k] || '';
  };
  const num = (id) => parseQty($(id, m).value);
  // fixed-amount purchases (investment plan): total amount + price → quantity
  const autoQty = () => {
    const total = parseMoney($('#tr-total', m).value), price = +num('#tr-price'), fees = parseMoney($('#tr-fees', m).value) || 0;
    if (total > 0 && price > 0 && !$('#tr-qty', m).dataset.manual) $('#tr-qty', m).value = dec(((total - fees) / 100) / price);
  };
  $('#tr-qty', m).oninput = () => { $('#tr-qty', m).dataset.manual = $('#tr-qty', m).value ? '1' : ''; };
  // when editing, the quantity stays the recorded one, except for investment plan purchases (fixed amount: the price changes → the units change)
  if (o && !String(o.external_id || '').startsWith('pac:')) $('#tr-qty', m).dataset.manual = '1';
  ['#tr-total', '#tr-price', '#tr-fees'].forEach((id) => ($(id, m).oninput = autoQty));
  $('#tr-kind', m).onchange = show; show();
  if (!hs.length) $('#tr-hint', m).textContent = 'First add a security with "＋ Security".';
  $('[data-cancel]', m).onclick = closeModal;
  $('#tr-save', m).onclick = async () => {
    const total = parseMoney($('#tr-total', m).value);
    const body = { kind: $('#tr-kind', m).value, date: $('#tr-date', m).value, holding_id: $('#tr-hold', m).value || null,
      quantity: num('#tr-qty'), price: num('#tr-price'), fees: parseMoney($('#tr-fees', m).value) || 0, total: total || null,
      amount: parseMoney($('#tr-amount', m).value), notes: $('#tr-notes', m).value, external_id: x.external_id || '' };
    try {
      await api(o ? `/trades/${o.id}` : `/investments/${a.id}/trades`, { method: o ? 'PUT' : 'POST', body });
      toast(o ? 'Trade updated' : 'Trade recorded'); closeModal(); route();
    } catch (e) { fail(e); }
  };
}

function valuationModal(accountId) {
  const m = openModal('Account value', `
    <p class="muted small" style="margin:0 0 14px">The market value of the account on a date (e.g. from the broker's website). If you enter it for a date that already exists, it is replaced.</p>
    <div class="form-grid"><label class="field">Date <input id="vl-date" type="date" value="${todayIso()}"></label>
      <label class="field">Value (€) <input id="vl-value" inputmode="decimal" autofocus></label></div>
    <div class="modal-foot"><button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="vl-save">Save</button></div>`);
  $('[data-cancel]', m).onclick = closeModal;
  $('#vl-save', m).onclick = async () => {
    try { await api(`/investments/${accountId}/valuations`, { method: 'POST', body: { date: $('#vl-date', m).value, value: parseMoney($('#vl-value', m).value) } }); toast('Value saved'); closeModal(); route(); } catch (e) { fail(e); }
  };
}

function holdingModal(accountId, h = null) {
  const x = h || { ticker: '', name: '', quantity: '', asset_class: 'azioni' };
  const m = openModal(h ? 'Edit security' : 'Add security', `
    <p class="muted small" style="margin:0 0 14px">Use the Yahoo Finance ticker with the exchange suffix: <b>.MI</b> Milan, <b>.DE</b> Xetra, <b>.AS</b> Amsterdam, <b>.PA</b> Paris (e.g. VWCE.DE, SWDA.MI). With "Update prices" the account value is calculated automatically.</p>
    <div class="form-grid">
      <label class="field">Ticker <input id="hd-ticker" maxlength="30" value="${esc(x.ticker)}" placeholder="VWCE.DE" autofocus></label>
      <label class="field">Quantity <input id="hd-qty" inputmode="decimal" value="${x.quantity === '' ? '' : String(x.quantity).replace('.', ',')}" ${x.trades ? 'disabled title="Calculated from the trades"' : ''}></label>
      <label class="field full">Description <input id="hd-name" maxlength="80" value="${esc(x.name)}" placeholder="E.g. Vanguard FTSE All-World"></label>
      <label class="field">Class <select id="hd-class">${ASSET_CLASSES.map((c) => `<option value="${esc(c)}" ${c === x.asset_class ? 'selected' : ''}>${esc(assetLabel(c))}</option>`).join('')}</select></label>
      <p class="muted small full" id="hd-hint" style="margin:0">${CLASS_HELP[x.asset_class] || ''}</p>
    </div>
    <div class="modal-foot">${h ? '<button class="btn btn-ghost left neg" id="hd-del">🗑 Delete</button>' : ''}
      <button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="hd-save">Save</button></div>`);
  $('[data-cancel]', m).onclick = closeModal;
  const hint = (extra = '') => { $('#hd-hint', m).innerHTML = (extra ? extra + '<br>' : '') + (CLASS_HELP[$('#hd-class', m).value] || ''); };
  $('#hd-class', m).onchange = () => hint();
  // automatic fill-in from the ticker (Yahoo Finance, sends only the ticker): name and suggested class, always editable
  let pending = null;  // saving waits for the lookup in progress, so the suggested class is not lost
  $('#hd-ticker', m).onchange = () => (pending = lookup());
  const lookup = async () => {
    const t = $('#hd-ticker', m).value.trim();
    if (!t) return;
    hint('⏳ Looking up the security…');
    try {
      const r = await api('/investments/lookup?' + qs({ ticker: t }));
      const fixed = r.ticker && r.ticker !== t.toUpperCase();  // e.g. a Morningstar code without exchange: Yahoo wants the suffix
      if (fixed) $('#hd-ticker', m).value = r.ticker;
      if (!$('#hd-name', m).value.trim() || !h) $('#hd-name', m).value = r.name || $('#hd-name', m).value;
      $('#hd-class', m).value = r.asset_class;
      hint(`✨ Found: <b>${esc(r.name || r.ticker)}</b> (${esc(r.type || 'security')}${r.price != null ? ' · ' + esc(unitPrice(r.price, r.currency)) : r.currency ? ', ' + esc(r.currency) : ''}) · suggested class <b>${esc(assetLabel(r.asset_class))}</b>, editable`
        + (fixed ? `<br>🔎 Code completed to <b>${esc(r.ticker)}</b>: it is the symbol Yahoo Finance quotes it under` : ''));
    } catch (e) { hint(`⚠️ ${esc(e.message)}: fill in name and class by hand`); }
  };
  $('#hd-save', m).onclick = async () => {
    if (pending) await pending;
    const body = { ticker: $('#hd-ticker', m).value, quantity: parseQty($('#hd-qty', m).value), name: $('#hd-name', m).value, asset_class: $('#hd-class', m).value };
    if (h && body.ticker.trim().toUpperCase() !== h.ticker && !(await confirmDialog(
      `Change the ticker from ${h.ticker} to ${body.ticker.trim().toUpperCase()}? The trades stay, but the current and historical prices of ${h.ticker} are deleted: then use "Update prices". Do this only if it is the same instrument (e.g. another exchange) or to fix a mistake.`,
      { ok: 'Change ticker', title: '⚠️ Ticker change' }))) return;
    try { await api(h ? `/holdings/${h.id}` : `/investments/${accountId}/holdings`, { method: h ? 'PUT' : 'POST', body }); toast('Security saved: use "Update prices" for the value'); closeModal(); route(); } catch (e) { fail(e); }
  };
  if (h) $('#hd-del', m).onclick = async () => {
    if (!(await confirmDialog(`Delete ${h.ticker}?`, { ok: 'Delete' }))) return;
    try { await api(`/holdings/${h.id}`, { method: 'DELETE' }); closeModal(); route(); } catch (e) { fail(e); }
  };
}

// ================================================================ savings and net worth
async function renderRisparmio(v) {
  S.savMonths ||= '12';
  const d = await api('/tools/savings?months=' + S.savMonths);
  const t = d.savings.total, rows = d.savings.months, nw = d.net_worth;
  const n = rows.filter((r) => r.income || r.expense || r.from_others).length || 1;
  const signed = (c) => (c ? (c > 0 ? '' : '−') + money0(Math.abs(c)) : '—');
  v.innerHTML = `
    <div class="toolbar"><select id="sv-months">${[['6', 'Last 6 months'], ['12', 'Last 12 months'], ['24', 'Last 24 months'], ['36', 'Last 36 months'], ['all', 'All']].map(([k, l]) => `<option value="${k}" ${k === String(S.savMonths) ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted small">Every month: income = spent + other spaces + saved (the month's surplus). Next to it, invested: purchases − sales of securities
        in investment accounts (money market ETFs are cash and do not count), even if paid with earlier savings · other spaces = transfers and contributions to other spaces.</span></div>
    <div class="kpis">
      <div class="kpi g-emerald"><div class="k-label">🐷 Savings rate</div><div class="k-value">${t.rate == null ? '—' : pct(t.rate)}</div><div class="k-sub">${money0(t.saved / n)} saved per month</div></div>
      <div class="kpi g-indigo"><div class="k-label">📈 Invested</div><div class="k-value">${money0(t.invested / n)}</div><div class="k-sub">per month in securities (${t.invest_rate == null ? '—' : pct(t.invest_rate)} of income)</div></div>
      <div class="kpi g-rose"><div class="k-label">📤 Spent</div><div class="k-value">${money0(t.expense / n)}</div><div class="k-sub">per month · other spaces ${money0(t.to_others / n)} per month</div></div>
      <div class="kpi g-amber"><div class="k-label">💎 Net worth</div><div class="k-value">${money0(nw.now ? nw.now.net : 0)}</div><div class="k-sub">cash + investments − debts</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>Where income goes</h3><span class="muted small">line = income for the month</span></div><div class="chart-box"><canvas id="sv-bar"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>Net worth</h3></div><div class="chart-box"><canvas id="sv-nw"></canvas></div></div>
    </div>
    <div class="card"><div class="table-wrap"><table class="sp-table"><thead><tr><th>Month</th><th class="right">Income</th><th class="right">Spent</th><th class="right">Other spaces</th><th class="right">Saved</th><th class="right">Rate</th><th class="right">Invested in securities</th></tr></thead>
      <tbody>${rows.slice().reverse().map((r) => `<tr><td>${fmtMonth(r.month)}</td><td class="right"><b>${money0(r.income + r.from_others)}</b></td><td class="right">${money0(r.expense)}</td>
        <td class="right">${signed(r.to_others)}</td><td class="right ${r.saved >= 0 ? 'pos' : 'neg'}"><b>${signed(r.saved)}</b></td>
        <td class="right">${r.rate == null ? '—' : pct(r.rate)}</td><td class="right ${r.invested < 0 ? 'neg' : ''}">${signed(r.invested)}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#sv-months').onchange = (e) => { S.savMonths = e.target.value; route(); };
  const labels = rows.map((r) => fmtMonth(r.month));
  const bar = (label, key, color) => ({ type: 'bar', label, data: rows.map((r) => r[key]), backgroundColor: color, stack: 's', maxBarThickness: 34 });
  chart($('#sv-bar'), {
    type: 'bar',
    data: { labels, datasets: [
      { type: 'line', label: 'Income', data: rows.map((r) => r.income + r.from_others), borderColor: css('--text'), backgroundColor: css('--text'),
        borderWidth: 2, borderDash: [5, 4], pointRadius: 3, tension: 0, order: -1 },
      // same colors as the dashboard: two reds for money out, orange for savings
      bar('Spent', 'expense', '#e11d48'), bar('Other spaces', 'to_others', '#fb7185'), bar('Saved', 'saved', '#f59e0b'),
      { ...bar('Invested in securities', 'invested', '#7c3aed'), stack: 'inv' }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (x) => moneyK(x) } } },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { filter: (i) => i.raw !== 0, callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.raw)}` } } } },
  });
  chart($('#sv-nw'), {
    type: 'line',
    data: { labels: nw.series.map((x) => fmtMonth(x.month)), datasets: [
      { label: 'Net worth', data: nw.series.map((x) => x.net), borderColor: '#f59e0b', backgroundColor: (ctx) => vGradient(ctx, '#f59e0b'), fill: true, borderWidth: 3, tension: .3, pointRadius: 3 },
      { label: 'Cash', data: nw.series.map((x) => x.liquidity), borderColor: '#2fbf71', borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: 'Investments', data: nw.series.map((x) => x.investments), borderColor: '#7b52ab', borderWidth: 2, pointRadius: 0, tension: .3 },
      ...(nw.series.some((x) => x.debts) ? [{ label: 'Debts', data: nw.series.map((x) => -x.debts), borderColor: '#e8364f', borderDash: [5, 4], borderWidth: 2, pointRadius: 0 }] : [])] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: (x) => moneyK(x) } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } },
  });
}

// ================================================================ settings
function getTheme() { try { return localStorage.getItem('homecoin-theme') || 'system'; } catch { return 'system'; } }
function setTheme(t) {
  try { t === 'system' ? localStorage.removeItem('homecoin-theme') : localStorage.setItem('homecoin-theme', t); } catch { /* ignore */ }
  t === 'system' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
  route();
}

function portfolioModal(p = null) {
  const x = p || { name: '', type: 'family', color: PALETTE[2], icon: PF_TYPES.family[2] };
  const m = openModal(p ? 'Edit space' : 'New space', `
    <p class="muted small" style="margin:0 0 12px">Each space has its own accounts, categories, rules and reports; transfers can also go to accounts in other spaces. Choose the type based on what you want to analyze:</p>
    <div class="pf-choice" id="g-type">${Object.entries(PF_GUIDE).map(([k, gd]) => `
      <button type="button" class="pf-opt ${x.type === k ? 'on' : ''}" data-k="${k}">
        <span class="pf-opt-head"><span class="pf-opt-ico">${PF_TYPES[k][2]}</span><b>${PF_TYPES[k][0]}</b><span class="pf-opt-check">✓</span></span>
        <span class="pf-opt-for">${gd.for}</span>
        <span class="pf-opt-label">Suggested tabs</span>
        <span class="pf-opt-cats">${DEFAULT_FEATURES[k].map((f) => `${FEATURES[f][0]} ${FEATURES[f][1]}`).join(' · ')}</span>
        <span class="pf-opt-label">Features that change</span>
        ${gd.diff.map((t) => `<span class="pf-opt-li">${t}</span>`).join('')}
        <span class="pf-opt-label">Initial categories</span>
        <span class="pf-opt-cats">${gd.cats}</span>
      </button>`).join('')}</div>
    <div class="feat-box">
      <div class="feat-core"><span class="muted small"><b>Always present:</b></span> ${CORE_TABS.map(([i, n]) => `<span class="tag">${i} ${n}</span>`).join(' ')}</div>
      <div class="muted small" style="margin:10px 0 6px"><b>Optional tabs</b> · ${p ? 'hiding a tab does not delete its data, which keeps counting in the dashboard and reports: turn it back on and everything is still there' : 'suggested based on the type, can be changed now and later'}</div>
      <div class="feat-grid" id="g-feat">${Object.entries(FEATURES).map(([k, [ico, name, what]]) => `
        <label class="feat-opt"><input type="checkbox" value="${k}" ${(p ? p.features : DEFAULT_FEATURES[x.type]).includes(k) ? 'checked' : ''}>
          <span class="feat-ico">${ico}</span><span><b>${name}</b><span class="muted small">${what}</span></span></label>`).join('')}</div>
    </div>
    <div class="form-grid">
      <label class="field full">Name <input id="g-name" maxlength="40" value="${esc(x.name)}" placeholder="${esc(PF_TYPES[x.type][1])}" autofocus></label>
      <div class="field full">Color ${swatchPicker('g-color', x.color)}</div>
      <div class="field full">Icon ${emojiPicker('g-icon', x.icon)}</div>
      ${p ? `<label class="check full"><input type="checkbox" id="g-arch" ${x.archived ? 'checked' : ''}> Archived space (hidden from the switcher)</label>` : ''}
    </div>
    <div class="modal-foot">${p ? '<button class="btn btn-ghost left neg" id="g-del">🗑 Delete</button>' : ''}
      <button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="g-save">${p ? 'Save' : 'Create space'}</button></div>`, { wide: true });
  let type = x.type, featTouched = !!p;  // new space: the tabs follow the type until they are changed by hand
  const feats = () => $$('#g-feat input', m).filter((i) => i.checked).map((i) => i.value);
  $$('#g-feat input', m).forEach((i) => (i.onchange = () => { featTouched = true; }));
  $$('#g-type .pf-opt', m).forEach((b) => (b.onclick = () => {
    type = b.dataset.k;
    $$('#g-type .pf-opt', m).forEach((y) => y.classList.toggle('on', y === b));
    $('#g-name', m).placeholder = PF_TYPES[type][1];
    if (!featTouched) $$('#g-feat input', m).forEach((i) => { i.checked = DEFAULT_FEATURES[type].includes(i.value); });
  }));
  const getColor = bindSwatches($('#g-color', m)), getIcon = bindEmoji($('#g-icon', m));
  $('[data-cancel]', m).onclick = closeModal;
  $('#g-save', m).onclick = async () => {
    const body = { name: $('#g-name', m).value.trim() || PF_TYPES[type][1], type, color: getColor(), icon: getIcon() || PF_TYPES[type][2],
      archived: p ? $('#g-arch', m).checked : false, features: feats() };
    const hidden = p ? p.features.filter((k) => !body.features.includes(k)) : [];
    if (hidden.length && !(await confirmDialog(`Hide ${hidden.map((k) => FEATURES[k][1]).join(', ')} in "${p.name}"? The data stays and keeps counting in the dashboard, reports and net worth: turn the tab back on and everything is still there.`,
      { ok: 'Hide', danger: false, title: 'Hidden tabs' }))) return;
    if (p && p.type !== type && !(await confirmDialog(`Change "${p.name}" to a ${PF_TYPES[type][0].toLowerCase()} space? The tabs stay the ones chosen below; some calculations change (shares per person, contributions as shared income).`,
      { ok: 'Change type', danger: false, title: 'Change of space type' }))) return;
    try {
      if (p) { await api(`/portfolios/${p.id}`, { method: 'PUT', body }); toast('Space saved'); closeModal(); refresh(); }
      else { const r = await api('/portfolios', { method: 'POST', body }); closeModal(); await switchPortfolio(r.id); location.hash = '#/conti'; }
    } catch (e) { fail(e); }
  };
  if (p) $('#g-del', m).onclick = async () => {
    if (!(await confirmDialog(`Delete the space "${p.name}"? It can be deleted only if it contains no accounts.`, { ok: 'Delete' }))) return;
    try { await api(`/portfolios/${p.id}`, { method: 'DELETE' }); toast('Space deleted'); if (p.id === S.pid) setPid(null); refresh(); } catch (e) { fail(e); }
  };
}

// ================================================================ activity log
const AUDIT_KINDS = { access: ['🔓', 'Sign-ins'], security: ['🛡️', 'Security'], change: ['✏️', 'Changes'], delete: ['🗑', 'Deletions'], data: ['💾', 'Import and export'] };
async function renderRegistro(v) {
  S.auditKind ??= '';
  const page = 100;
  let items = [], total = 0;
  const d0 = await api('/audit?' + qs({ kind: S.auditKind, limit: page }));
  items = d0.items; total = d0.total;
  const all = Object.values(d0.counts).reduce((s, n) => s + n, 0);
  v.innerHTML = `
    <div class="toolbar"><div class="seg" id="au-kind"><button data-k="" class="${S.auditKind === '' ? 'on' : ''}">All <span class="muted">${all}</span></button>
      ${Object.entries(AUDIT_KINDS).map(([k, [ic, l]]) => `<button data-k="${k}" class="${S.auditKind === k ? 'on' : ''}">${ic} ${l} <span class="muted">${d0.counts[k] || 0}</span></button>`).join('')}</div>
      <span class="spacer"></span><span class="muted small">🔒 In the encrypted database · entries older than ${d0.keep_months} months are deleted automatically</span></div>
    <div class="card" style="padding:6px 8px"><div class="table-wrap"><table class="audit-table">
      <thead><tr><th>When</th><th>Action</th><th>Details</th><th>Space</th></tr></thead><tbody id="au-body"></tbody></table></div>
      <div id="au-more" style="text-align:center;padding:10px"></div></div>`;
  const row = (x) => {
    const [ic] = AUDIT_KINDS[x.kind] || ['•'];
    const when = new Date(x.ts.replace(' ', 'T'));
    return `<tr class="au-${esc(x.kind)}"><td class="num nowrap">${esc(`${String(when.getDate()).padStart(2, '0')} ${MONTHS[when.getMonth()]} ${String(when.getFullYear()).slice(2)}`)} <span class="muted">${esc(x.ts.slice(11, 16))}</span></td>
      <td class="nowrap">${ic} ${esc(x.action)}</td><td class="muted small">${esc(x.detail)}</td><td class="muted small nowrap">${esc(x.portfolio)}</td></tr>`;
  };
  const draw = () => {
    $('#au-body').innerHTML = items.length ? items.map(row).join('') : '<tr><td colspan="4"><div class="empty">No actions recorded</div></td></tr>';
    $('#au-more').innerHTML = items.length < total ? `<button class="btn btn-sm" id="au-load">Show more (${total - items.length})</button>` : '';
    $('#au-load')?.addEventListener('click', async () => {
      try { const d = await api('/audit?' + qs({ kind: S.auditKind, limit: page, offset: items.length })); items = items.concat(d.items); draw(); } catch (e) { fail(e); }
    });
  };
  draw();
  $$('#au-kind button').forEach((b) => (b.onclick = () => { S.auditKind = b.dataset.k; route(); }));
}

async function renderImpostazioni(v) {
  const th = getTheme();
  v.innerHTML = `<div class="card" style="margin-bottom:18px"><div class="card-head"><div><h3>🗂️ Spaces</h3>
      <p class="muted small" style="margin:3px 0 0">Separate portfolios in the same HomeCoin (e.g. family, personal, business). Switch between them from the switcher at the top left.</p></div>
      <button class="btn btn-sm btn-primary" id="s-pf-new">＋ New space</button></div>
    <div class="pf-list">${S.portfolios.map((p) => `<div class="pf-row ${p.archived ? 'is-off' : ''}">
      <span class="pf-ico" style="--pc:${esc(p.color)}">${esc(p.icon)}</span>
      <div class="grow"><b>${esc(p.name)}</b> ${p.id === S.pid ? '<span class="tag ai">active</span>' : ''} ${p.archived ? '<span class="tag">archived</span>' : ''}
        <div class="muted small">${PF_TYPES[p.type][0]} · ${p.accounts} ${p.accounts === 1 ? 'account' : 'accounts'} · tabs: ${p.features.map((k) => `${FEATURES[k][0]} ${FEATURES[k][1]}`).join(', ') || 'only the common ones'}</div></div>
      ${p.id !== S.pid && !p.archived ? `<button class="btn btn-sm" data-pf-go="${p.id}">Open</button>` : ''}
      <button class="icon-btn sm" data-pf-edit="${p.id}" title="Edit">✏️</button></div>`).join('')}</div></div>
  <div class="card" style="margin-bottom:18px" id="sec-card"><div class="card-head"><div><h3>🩺 Security check</h3>
      <p class="muted small" style="margin:3px 0 0" id="sec-sum">Checking…</p></div>
      <button class="btn btn-sm" id="sec-go">🩺 Check now</button></div>
    <div class="sec-list" id="sec-list"><div class="loading">Checking the database, data folder and keys…</div></div></div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>🎨 Appearance</h3></div>
      <div class="settings-row"><div><b>Theme</b><p class="muted small">Light, dark or same as the system</p></div>
        <div class="seg" id="s-theme">${[['system', '💻 System'], ['light', '☀️ Light'], ['dark', '🌙 Dark']].map(([k, l]) => `<button data-t="${k}" class="${th === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="settings-row"><div><b>Shortcuts</b><p class="muted small"><span class="kbd">N</span> new transaction · <span class="kbd">Esc</span> closes dialogs</p></div></div>
    </div>
    <div class="card"><div class="card-head"><h3>💾 Backup and restore</h3></div>
      <div class="settings-row"><div><b>Download full backup</b><p class="muted small">Encrypted <code>.hcbackup</code> file: it opens only with the current password (or recovery key)</p></div><a class="btn btn-sm" href="/api/backup">⬇ Backup</a></div>
      <div class="settings-row"><div><b>Restore from backup</b><p class="muted small">Replaces all current data (a copy is saved first). Old .json backups are accepted too</p></div>
        <label class="btn btn-sm">⬆ Restore<input type="file" id="s-restore" accept=".hcbackup,.json" hidden></label></div>
      <div class="settings-row"><div><b>Automatic backups</b><p class="muted small">At every start an encrypted copy of the database is saved (last 15 kept)</p></div></div>
    </div>
    <div class="card"><div class="card-head"><h3>📤 Export</h3></div>
      <div class="settings-row"><div><p class="muted small" style="margin:0">⚠️ Exported files (CSV, Excel, reports) are <b>not encrypted</b>: keep them in a safe place and delete them when you no longer need them.</p></div></div>
      <div class="settings-row"><div><b>All transactions</b><p class="muted small">For Excel or other programs</p></div>
        <div style="display:flex;gap:8px"><a class="btn btn-sm" href="/api/export/transactions?format=csv&pf=${S.pid}">CSV</a><a class="btn btn-sm" href="/api/export/transactions?format=xlsx&pf=${S.pid}">Excel</a></div></div>
      <div class="settings-row"><div><b>Annual report</b><p class="muted small">From the Reports page</p></div><a class="btn btn-sm" href="#/report">Go →</a></div>
    </div>
    <div class="card"><div class="card-head"><h3>🔐 Security</h3></div>
      <div class="settings-row"><div><b>Password</b><p class="muted small">Asked every time you open HomeCoin; it is not saved anywhere</p></div><button class="btn btn-sm" id="s-pw">Change password</button></div>
      <div class="settings-row"><div><b>Recovery key</b><p class="muted small">Needed if you forget the password; generating a new one invalidates the previous one</p></div><button class="btn btn-sm" id="s-rk">New key</button></div>
      <div class="settings-row"><div><b>Auto-lock</b><p class="muted small">After this much time without activity the password is needed again</p></div>
        <select id="s-autolock" style="width:auto">${[5, 15, 30, 60, 120].map((m) => `<option value="${m}" ${(AUTH.status?.auto_lock || 15) === m ? 'selected' : ''}>${m < 60 ? m + ' minutes' : m / 60 + (m === 60 ? ' hour' : ' hours')}</option>`).join('')}</select></div>
      <div class="settings-row"><div><b>Lock now</b><p class="muted small">Removes the key from memory and hides the data</p></div><button class="btn btn-sm" id="s-lock">🔒 Lock</button></div>
      <div class="settings-row"><div><b>Import code</b><p class="muted small" id="s-itoken-state">Temporary code for an import script on this PC. It expires on its own and is revoked when HomeCoin locks. Generate it only if you asked for it yourself.</p></div>
        <div style="display:flex;gap:8px"><button class="btn btn-sm hidden" id="s-itoken-off">Revoke code</button><button class="btn btn-sm" id="s-itoken">🔑 Generate</button></div></div>
    </div>
    <div class="card"><div class="card-head"><h3>🛡️ Privacy</h3></div>
      <div class="settings-row"><div><b>Data encrypted on your PC</b><p class="muted small"><code class="path">${esc(S.data_dir)}</code></p></div></div>
      <div class="settings-row"><div><p class="muted small" style="margin:0">The database and automatic backups are encrypted with AES-256 (SQLCipher); the key is protected by your password (scrypt) and stays in memory only while HomeCoin is unlocked.
        HomeCoin accepts connections only from this PC (127.0.0.1), uses no external services or CDNs and blocks requests coming from other sites; the only online feature is "Update prices" in Investments, which sends only the tickers to Yahoo Finance. HomeCoin ${esc(S.version)} · by Starkark98.</p></div></div>
    </div></div>`;
  $('#s-pw').onclick = () => passwordModal();
  $('#s-rk').onclick = () => recoveryModal();
  $('#s-lock').onclick = () => lockNow();
  const runCheck = () => securityCheck(v);
  $('#sec-go').onclick = runCheck;
  runCheck();
  const tokenState = async () => {
    try {
      const st = AUTH.status = await fetch('/api/auth/status', { headers: { 'X-HomeCoin': '1' } }).then((x) => x.json());
      const until = st.import_token_until;
      if (!$('#s-itoken-state')) return;
      $('#s-itoken-off').classList.toggle('hidden', !until);
      if (until) $('#s-itoken-state').innerHTML = `<span class="tag warn">active</span> valid until <b>${new Date(until * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</b> (or until HomeCoin locks). Revoke it when you no longer need it.`;
    } catch { /* ignore */ }
  };
  tokenState();
  $('#s-itoken-off').onclick = async () => {
    try { await api('/auth/import-token', { method: 'DELETE' }); toast('Code revoked'); route(); } catch (e) { fail(e); }
  };
  $('#s-itoken').onclick = async () => {
    const minutes = await new Promise((resolve) => {
      const m = openModal('Import code', `<p class="muted small">How long should it be valid? It is revoked anyway when you lock HomeCoin (including auto-lock) and you can revoke it earlier from here. Generating a new one revokes the previous one.</p>
        <label class="field">Duration <select id="it-min"><option value="15">15 minutes</option><option value="60">1 hour</option><option value="240" selected>4 hours</option><option value="480">8 hours</option></select></label>
        <div class="modal-foot"><button class="btn" data-no>Cancel</button><button class="btn btn-primary" id="it-go">Generate</button></div>`);
      $('[data-no]', m).onclick = () => { closeModal(); resolve(null); };
      $('#it-go', m).onclick = () => { const v = +$('#it-min', m).value; closeModal(); resolve(v); };
    });
    if (!minutes) return;
    try {
      const r = await api('/auth/import-token', { method: 'POST', body: { minutes } });
      tokenState();
      const m = openModal('Import code', `<p class="muted small">Valid for ${r.minutes < 60 ? r.minutes + ' minutes' : r.minutes / 60 + (r.minutes === 60 ? ' hour' : ' hours')}, as long as HomeCoin stays unlocked. It lets a script on this PC read and write the data: do not share it with anyone else.</p>
        <div class="recovery-code" style="font-size:14px">${esc(r.token)}</div>
        <div class="modal-foot"><button class="btn btn-ghost left neg" id="it-revoke">Revoke code</button><button class="btn" id="it-copy">📋 Copy</button><button class="btn btn-primary" data-no>Close</button></div>`);
      $('#it-copy', m).onclick = async () => { try { await navigator.clipboard.writeText(r.token); toast('Code copied'); } catch { toast('Copy failed', 'err'); } };
      $('#it-revoke', m).onclick = async () => { try { await api('/auth/import-token', { method: 'DELETE' }); toast('Code revoked'); closeModal(); tokenState(); } catch (e) { fail(e); } };
      $('[data-no]', m).onclick = closeModal;
    } catch (err) { fail(err); }
  };
  $('#s-autolock').onchange = async (e) => {
    try { const r = await api('/auth/settings', { method: 'PUT', body: { auto_lock: +e.target.value } }); AUTH.status.auto_lock = r.auto_lock; toast('Auto-lock updated'); } catch (err) { fail(err); }
  };
  $$('#s-theme button').forEach((b) => (b.onclick = () => setTheme(b.dataset.t)));
  $('#s-pf-new').onclick = () => portfolioModal();
  $$('[data-pf-go]', v).forEach((b) => (b.onclick = () => switchPortfolio(+b.dataset.pfGo)));
  $$('[data-pf-edit]', v).forEach((b) => (b.onclick = () => portfolioModal(S.portfolios.find((p) => p.id === +b.dataset.pfEdit))));
  $('#s-restore').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await confirmDialog(`Restore the backup "${f.name}"? All current data will be replaced.`, { ok: 'Restore' }))) return;
    const send = async (password) => {
      const fd = new FormData(); fd.append('file', f);
      if (password) fd.append('password', password);
      await api('/restore', { method: 'POST', body: fd });
      closeModal(); toast('Backup restored'); refresh();
    };
    try { await send(); } catch (err) {
      if (err.status !== 422) return fail(err);
      // backup from another installation or from before a key change: the password of that time is needed
      const m = openModal('Backup password', `<p class="muted small">${esc(err.message)}</p>
        <label class="field">Password or recovery key<input type="password" id="rb-pw" autocomplete="off" autofocus></label>
        <div class="modal-foot"><button class="btn" data-close2>Cancel</button><button class="btn btn-primary" id="rb-go">Restore</button></div>`);
      $('[data-close2]', m).onclick = closeModal;
      $('#rb-go').onclick = async () => { try { await send($('#rb-pw').value); } catch (e2) { fail(e2); } };
    } finally { e.target.value = ''; }
  };
}

// ================================================================ security check
// One entry per protection: status (✔ fine · ⚠ needs fixing · ✖ problem) and, only when needed, the button to fix it.
async function securityCheck(v) {
  const btn = $('#sec-go', v), list = $('#sec-list', v);
  if (!btn) return;
  btn.disabled = true; btn.textContent = '⏳ Checking…';
  try {
    const [r, st] = await Promise.all([api('/auth/integrity'), fetch('/api/auth/status', { headers: { 'X-HomeCoin': '1' } }).then((x) => x.json())]);
    AUTH.status = st;
    const n = r.counts, others = r.folder_others;
    const dbOk = !r.pages_tampered && r.structure.join() === 'ok' && !r.foreign_key_errors && !r.plaintext_files.length;
    const lock = st.auto_lock, until = st.import_token_until;
    const items = [
      [dbOk ? 'ok' : 'bad', 'Database encrypted and intact', dbOk
        ? `${esc(r.cipher)} · ${n.transactions} transactions, ${n.accounts} accounts · ${r.backups} automatic backups, no unencrypted files`
        : `tampered pages ${r.pages_tampered} · structure ${esc(r.structure.join(', '))} · unencrypted files: ${esc(r.plaintext_files.join(', ') || 'none')} — restore the last intact backup`, ''],
      others == null ? ['na', 'Data folder restricted to your user', 'cannot be checked on this system', '']
        : others.length ? ['warn', 'Data folder restricted to your user', `also accessible to other accounts on this PC (${esc(others.join(', '))}): they could copy or delete it`, '<button class="btn btn-sm btn-primary" data-fix="folder">🔒 Protect</button>']
          : ['ok', 'Data folder restricted to your user', 'only you, the system and administrators can open it', ''],
      [r.kdf.password_n >= r.kdf.target_n ? 'ok' : 'warn', 'Password: strengthened key', r.kdf.password_n >= r.kdf.target_n ? 'scrypt N=2^17' : 'it is strengthened at the next sign-in', ''],
      r.kdf.recovery_n && r.kdf.recovery_n < r.kdf.target_n
        ? ['warn', 'Strengthened recovery key', 'created with the protection of the previous version: generate a new one (the old one stops working)', '<button class="btn btn-sm btn-primary" data-fix="recovery">🔑 Generate new</button>']
        : ['ok', 'Strengthened recovery key', 'scrypt N=2^17', ''],
      [lock && lock <= 30 ? 'ok' : 'warn', 'Auto-lock', lock ? `after ${lock < 60 ? lock + ' minutes' : lock / 60 + (lock === 60 ? ' hour' : ' hours')} without activity${lock > 30 ? ' — 30 minutes or less is better' : ''}` : 'off', ''],
      until ? ['warn', 'Import code', `active until ${new Date(until * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}: revoke it if you do not need it`, '<button class="btn btn-sm" data-fix="token">Revoke code</button>']
        : ['ok', 'Import code', 'no active code', ''],
    ];
    const ICON = { ok: '✔', warn: '⚠', bad: '✖', na: '–' };
    list.innerHTML = items.map(([s, title, what, act]) => `<div class="sec-row ${s}"><span class="sec-ico">${ICON[s]}</span>
      <div class="grow"><b>${title}</b><div class="muted small">${what}</div></div>${act}</div>`).join('');
    const todo = items.filter(([s]) => s === 'warn' || s === 'bad').length;
    $('#sec-sum', v).innerHTML = todo ? `<span class="tag warn">${todo} ${todo === 1 ? 'thing to fix' : 'things to fix'}</span> · checked at ${esc(r.checked_at.slice(11, 16))}`
      : `<span class="tag ai">✔ all protected</span> · checked at ${esc(r.checked_at.slice(11, 16))}`;
    $$('[data-fix]', list).forEach((b) => (b.onclick = async () => {
      if (b.dataset.fix === 'folder') { if (await protectFolder()) securityCheck(v); }
      if (b.dataset.fix === 'recovery') recoveryModal(() => securityCheck(v));
      if (b.dataset.fix === 'token') { try { await api('/auth/import-token', { method: 'DELETE' }); toast('Code revoked'); securityCheck(v); } catch (e) { fail(e); } }
    }));
  } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  btn.disabled = false; btn.textContent = '🩺 Check now';
}
async function protectFolder() {
  if (!(await confirmDialog('Make the HomeCoin data folder accessible only to your Windows user (plus the system and administrators)? Other accounts on this PC will no longer be able to read or change it. If something goes wrong, the permissions go back to how they were.',
    { ok: '🔒 Protect', danger: false, title: 'Protect the data folder' }))) return false;
  try {
    const x = await api('/auth/protect-folder', { method: 'POST' });
    toast(x.folder_others?.length ? 'Permissions only partly updated' : 'Data folder restricted to your user');
    return true;
  } catch (err) { fail(err); return false; }
}
// after sign-in: if the data folder is open to other accounts, offer to fix it once per session
async function offerFolderProtection() {
  if (AUTH.folderAsked || AUTH.status?.demo) return;
  AUTH.folderAsked = true;
  try {
    const { folder_others: others } = await api('/auth/folder');
    if (!others?.length) return;
    if (!(await confirmDialog(`Your data folder is also accessible to other accounts on this PC (${others.join(', ')}). The data is encrypted, but they could copy it to try to guess the password, or delete it. Restrict it to your Windows user?`,
      { ok: '🔒 Protect now', danger: false, title: '🛡️ Data folder protection' }))) {
      toast('You can do it any time from Settings → Security check', 'info');
      return;
    }
    const x = await api('/auth/protect-folder', { method: 'POST' });
    toast(x.folder_others?.length ? 'Permissions only partly updated' : 'Data folder restricted to your user');
  } catch (err) { fail(err); }
}

function passwordModal() {
  const m = openModal('Change password', `<div class="form-grid">
      <label class="field full">Current password<input type="password" id="p-cur" autocomplete="current-password" autofocus></label>
      <label class="field full">New password<input type="password" id="l-pw" autocomplete="new-password"></label>
      <div class="full pw-meter"><span id="l-meter"></span></div>
      <label class="field full">Confirm new password<input type="password" id="l-pw2" autocomplete="new-password"></label></div>
    <p class="muted small">The data is not re-encrypted: only the protection of the key changes. The recovery key stays valid.</p>
    <div class="modal-foot"><button class="btn" data-no>Cancel</button><button class="btn btn-primary" id="p-go">Change password</button></div>`);
  pwMeter($('#l-pw', m), $('#l-meter', m));
  $('[data-no]', m).onclick = closeModal;
  $('#p-go').onclick = async () => {
    try {
      checkNew($('#l-pw').value, $('#l-pw2').value);
      await api('/auth/password', { method: 'POST', body: { current: $('#p-cur').value, password: $('#l-pw').value } });
      closeModal(); toast('Password changed');
    } catch (err) { fail(err); }
  };
}
function recoveryModal(onDone) {
  const m = openModal('New recovery key', `<p class="muted small">The current key will stop working. Confirm with your password.</p>
    <label class="field">Current password<input type="password" id="p-cur" autocomplete="current-password" autofocus></label>
    <div class="modal-foot"><button class="btn" data-no>Cancel</button><button class="btn btn-primary" id="p-go">Generate</button></div>`);
  $('[data-no]', m).onclick = closeModal;
  $('#p-go').onclick = async () => {
    try {
      const r = await api('/auth/recovery-key', { method: 'POST', body: { current: $('#p-cur').value } });
      const m2 = openModal('Your new recovery key', `<p class="muted small">Save it in a safe place: it will not be shown again.</p>
        <div class="recovery-code">${esc(r.recovery_key)}</div>
        <div class="modal-foot"><button class="btn" id="k-copy">📋 Copy</button><button class="btn btn-primary" data-no>Done</button></div>`);
      $('#k-copy', m2).onclick = async () => { try { await navigator.clipboard.writeText(r.recovery_key); toast('Key copied'); } catch { toast('Copy failed', 'err'); } };
      $('[data-no]', m2).onclick = () => { closeModal(); onDone?.(); };
    } catch (err) { fail(err); }
  };
}

// ================================================================ startup
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal();
  if (document.body.classList.contains('locked')) return;
  if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !$('#modal-root').innerHTML) {
    e.preventDefault(); txModal();
  }
});
$('#quick-add').onclick = () => txModal();
$('#theme-toggle').onclick = () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  setTheme(dark ? 'light' : 'dark');
};
$('#lock-now').onclick = () => lockNow();
$('#privacy-toggle').onclick = () => setPrivacy(!privacyOn());
setPrivacy((() => { try { return localStorage.getItem('homecoin-privacy') === '1'; } catch { return false; } })());
window.addEventListener('hashchange', () => { if (!document.body.classList.contains('locked')) route(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => getTheme() === 'system' && !document.body.classList.contains('locked') && route());
showLock();  // on open: sign-in (or password creation); then load the data

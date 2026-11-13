/* HomeCoin - web interface (vanilla JS, no external dependencies other than a local Chart.js) */
'use strict';

// ================================================================ utilities
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// interface language: /i18n.js (loaded before this file) gives the language chosen in Settings and its translations.
// Texts are written in English and looked up by their English text; a text without a translation stays in English.
// {name} placeholders are filled in from `vars`. Translations may contain the same HTML tags as the English text.
// The language file also gives its plural rule and month names, and the server's table of currencies (util.CURRENCIES)
const I18N = window.HC_I18N || { lang: 'en', languages: { en: 'English' }, t: {}, plural: 'one', currencies: {} };  // i18n-skip
const LANG = I18N.lang;
document.documentElement.lang = LANG;
const fill = (out, vars) => (vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : out);
function T(s, vars) {
  let out = I18N.t[s] ?? s;
  if (typeof out === 'object') out = out.other || s;  // a plural text used on its own: its general form
  return fill(out, vars);
}
// plural category of n (same rules as i18n.plural_category): "one", "few", "many" or "other"
function pluralCategory(n) {
  switch (I18N.plural) {
    case 'none': return 'other';
    case 'zero_one': return n >= 0 && n < 2 ? 'one' : 'other';
    case 'pl': {
      if (!Number.isInteger(n)) return 'other';
      const a = Math.abs(n);
      if (a === 1) return 'one';
      return [2, 3, 4].includes(a % 10) && ![12, 13, 14].includes(a % 100) ? 'few' : 'many';
    }
    default: return n === 1 ? 'one' : 'other';
  }
}
// singular or plural by n, in the language's rule; languages with more forms give {few, many, other} for the plural
// (also "one" in that object when the English singular and plural are the same text, e.g. "{n} selected")
function tn(one, other, n, vars = {}) {
  const cat = pluralCategory(n);
  const key = cat === 'one' ? one : other;
  let out = I18N.t[key] ?? key;
  if (typeof out === 'object') out = out[cat] || out.other || key;
  return fill(out, { n, ...vars });
}
// the fixed texts of index.html (menu, top bar, sign-in frame): translated once, here. Parts filled in by the code and
// the brand name are skipped
(function translatePage() {
  const skip = (el) => ['view', 'modal-root', 'toasts', 'pf-switch', 'page-sub', 'app-version', 'lock-version', 'lock-body'].includes(el.id)
    || el.classList.contains('brand-name');
  const walk = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        const s = n.nodeValue.trim();
        if (s && /[A-Za-z]/.test(s)) n.nodeValue = n.nodeValue.replace(s, T(s));
      } else if (n.nodeType === 1 && !skip(n)) {
        for (const a of ['title', 'aria-label']) if (n.hasAttribute(a)) n.setAttribute(a, T(n.getAttribute(a)));
        walk(n);
      }
    }
  };
  walk(document.body);
}());
// reference currency of the installation (Settings): a label only, amounts are never converted. Each currency uses the
// number format of its main country: 1.234,56 € · $1,234.56 · CHF 1'234.56 · R$ 1.234,56 · 1 234,56 zł · ¥1,235.
// The table is util.CURRENCIES (through /i18n.js): `short` tells apart the dollars and the peso in the currency picker,
// `steps` are the rounding choices of the fair split (whole units), `regions` the countries it is suggested in,
// `indexes` the reference indexes of variable-rate loans (the first is the default)
const CURRENCIES = Object.fromEntries(Object.entries(I18N.currencies).map(([k, c]) => [k, { ...c, name: T(c.name) }]));
// names of the currencies, for the translation files: T('Euro') T('US dollar') T('British pound') T('Swiss franc')
// T('Canadian dollar') T('Australian dollar') T('Mexican peso') T('Brazilian real') T('Polish złoty') T('Japanese yen')
// T('Colombian peso') T('Chilean peso') T('South African rand') T('New Zealand dollar') T('Singapore dollar')
// T('Hong Kong dollar') T('Philippine peso') T('Indian rupee') T('UAE dirham') T('Malaysian ringgit') T('Swedish krona')
// T('Norwegian krone') T('Danish krone') T('Israeli new shekel') T('Czech koruna') T('New Taiwan dollar') T('South Korean won')
// DEC: decimal separator of the currency ('.' or ','), DIGITS: decimals of an amount (from Intl),
// SYM_FIRST: symbol before the number. All the number rules of the UI follow these, never a currency code
let CUR = 'EUR', CUR_SYM = '€', LOCALE = 'it-IT', DEC = ',', DIGITS = 2, SYM_FIRST = false, MONEY, MONEY0, _unitFmt = {};
function setCurrency(code) {
  CUR = CURRENCIES[code] ? code : 'EUR';
  ({ symbol: CUR_SYM, locale: LOCALE } = CURRENCIES[CUR]);
  MONEY = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CUR, useGrouping: 'always' });
  MONEY0 = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CUR, maximumFractionDigits: 0, useGrouping: 'always' });
  DEC = new Intl.NumberFormat(LOCALE).formatToParts(1.5).find((p) => p.type === 'decimal').value;
  DIGITS = MONEY.resolvedOptions().maximumFractionDigits;
  const parts = MONEY.formatToParts(1).map((p) => p.type);
  SYM_FIRST = parts.indexOf('currency') < parts.indexOf('integer');
  _unitFmt = {};
}
const currencySelect = (id, sel) => `<select id="${id}">${Object.entries(CURRENCIES).map(([k, c]) =>
  `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(c.short)} ${esc(c.name)} (${k})</option>`).join('')}</select>`;
// interface languages, each in its own language
const languageSelect = (id) => `<select id="${id}">${Object.entries(I18N.languages).map(([k, l]) =>
  `<option value="${k}" ${k === LANG ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
// currency suggested at the first start: the browser's country if it has one of HomeCoin's currencies, else the
// main currency of the interface language
function suggestedCurrency() {
  const region = ((navigator.languages || [])[0] || navigator.language || '').split('-')[1]?.toUpperCase() || '';
  const cur = Object.keys(CURRENCIES).find((k) => (CURRENCIES[k].regions || []).includes(region)) || I18N.currency;
  return CURRENCIES[cur] ? cur : 'EUR';
}
const currencyExample = (code) => new Intl.NumberFormat(CURRENCIES[code].locale, { style: 'currency', currency: code, useGrouping: 'always' }).format(1234.56);
setCurrency('EUR');
const money = (c) => MONEY.format((c || 0) / 100);
const money0 = (c) => MONEY0.format((c || 0) / 100);
const num = (x, d = 1) => (x ?? 0).toLocaleString(LOCALE, { maximumFractionDigits: d });
// unit price (not in cents) with its currency symbol: 6,1973 € · 6,91 $ (up to 4 decimals)
const unitPrice = (v, cur = CUR) => {
  if (v == null) return '—';
  const c = /^[A-Z]{3}$/.test(cur || '') ? cur : CUR;
  _unitFmt[c] ||= new Intl.NumberFormat(LOCALE, { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return _unitFmt[c].format(v);
};
const moneyInput = (c) => (c ? (c / 100).toFixed(DIGITS).replace('.', DEC) : '');
const moneyPlaceholder = () => (0).toFixed(DIGITS).replace('.', DEC);  // 0,00 · 0.00 · 0
const pct = (x) => `${Math.round(x * 100)}%`;
const decInput = (v) => (v == null ? '' : String(v).replace('.', DEC));  // plain decimal (rate %, quantity) for inputs
// reference indexes of variable and mixed-rate loans, per currency (util.CURRENCIES). Only those of the installation's
// currency are offered (the first is the default); an index saved under another currency stays shown
const RATE_INDEXES = Object.fromEntries(Object.entries(CURRENCIES).map(([k, c]) => [k, c.indexes || []]));
const defaultRateIndex = () => RATE_INDEXES[CUR][0];
const rateIndexOptions = (current) => [...RATE_INDEXES[CUR], ...(current && !RATE_INDEXES[CUR].includes(current) ? [current] : [])];
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// currency symbols and labels typed with an amount (longest first: "US$" before "$")
const MONEY_MARKS = new RegExp([...new Set(Object.values(CURRENCIES).flatMap((c) => [c.symbol, c.short]).concat(['Fr.', '円', '￥']))]
  .sort((a, b) => b.length - a.length).map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
// hand-typed numbers, a single rule for the whole app (like util.parse_number on the server):
// "1.234,56" · "1234,56" · "1234.56" · "1,234.56" · "1’234.56" · "1,23,456.78" · and for amounts "1.500" = 1500 when the
// currency writes decimals with a comma (euro); where the dot is the decimal separator, "1.500" = 1.5
function normNum(s, { thousandsDot = true } = {}) {
  s = String(s ?? '').trim().replace(MONEY_MARKS, '').replace(/[\s '’]/g, '').replace(/^−/, '-');
  if (!s) return '';
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');  // the last separator is the decimal one
  else if (c >= 0) s = (s.match(/,/g).length > 1 || (thousandsDot && /^[-+]?\d{1,3},\d{3}$/.test(s)) ? s.replace(/,/g, '') : s.replace(',', '.'));
  else if (d >= 0 && (s.match(/\./g).length > 1 || (thousandsDot && DEC === ',' && /^[-+]?\d{1,3}\.\d{3}$/.test(s)))) s = s.replace(/\./g, '');
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
// short month names of the language file: fixed there so every browser shows the same ones (Intl may add dots or print "Sept")
const MONTHS = I18N.months || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];  // i18n-skip
// "29 Oct 2026" / "2026年10月29日": the order of the language file (date_pattern, month_pattern), built from MONTHS
// {d} day with two digits, {j} without the leading zero, {mon} month name, {m} month number, {y} year, {yy} 2-digit year
const datePart = (pattern, y, m, d = '') => pattern.replace(/\{(d|j|mon|m|yy|y)\}/g, (_, k) => ({ d, j: String(+d), mon: MONTHS[m - 1], m, y, yy: y.slice(2) }[k]));
const fmtDate = (iso) => (iso ? datePart(I18N.date_pattern || '{d} {mon} {y}', iso.slice(0, 4), +iso.slice(5, 7), iso.slice(8, 10)) : '');  // i18n-skip
const fmtMonth = (ym) => { const [y, m] = ym.split('-'); return datePart(I18N.month_pattern || '{mon} {yy}', y, +m); };  // i18n-skip
// ---------------------------------------------------------------- date fields
// A native <input type="date"> is drawn in the browser's language, not in HomeCoin's (Edge and Chrome ignore the page
// language): every one is turned into a text field in the interface's numeric format (13/11/2026, 13.11.2026,
// 2026/11/13, 11/13/2026 with the dollar) and a small calendar with the interface's month and day names. The original
// input stays, hidden, with its id and its ISO value: the code that reads or sets .value and its change listeners work
// as before (setting .value updates the text too).
function dateLocale() {
  const lang = I18N.lang || 'en';
  if (lang !== 'en') return lang;
  const loc = (I18N.currencies?.[CUR]?.locale || 'en-GB');
  return loc.startsWith('en') ? loc : 'en-GB';  // English: the order of the currency's country (US: month first)
}
function dateShape() {
  let parts;
  try { parts = new Intl.DateTimeFormat(dateLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(2026, 10, 13)); }
  catch { parts = [{ type: 'day' }, { type: 'literal', value: '/' }, { type: 'month' }, { type: 'literal', value: '/' }, { type: 'year' }]; }
  const order = parts.filter((p) => ['day', 'month', 'year'].includes(p.type)).map((p) => p.type[0]).join('');  // "dmy", "ymd"…
  const sep = (parts.find((p) => p.type === 'literal')?.value || '/').trim() || '/';
  return { order, sep };
}
function fmtDateInput(iso) {
  if (!iso) return '';
  const { order, sep } = dateShape();
  const v = { y: iso.slice(0, 4), m: iso.slice(5, 7), d: iso.slice(8, 10) };
  return [...order].map((k) => v[k]).join(sep);
}
// what the user typed → ISO date ('' = empty, null = not a date); ISO itself is always accepted
function parseDateInput(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const nums = s.match(/\d+/g);
  if (!nums || nums.length !== 3) return null;
  const { order } = dateShape();
  const v = {};
  (nums[0].length === 4 ? 'ymd' : order).split('').forEach((k, i) => { v[k] = +nums[i]; });
  if (v.y < 100) v.y += 2000;
  const d = new Date(v.y, v.m - 1, v.d);
  return d.getFullYear() === v.y && d.getMonth() === v.m - 1 && d.getDate() === v.d ? isoLocal(d) : null;
}
const NATIVE_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
function enhanceDate(inp) {
  if (inp.dataset.df) return;
  inp.dataset.df = '1';
  const wrap = document.createElement('span');
  wrap.className = 'date-field';
  const text = document.createElement('input');
  text.className = 'date-text';
  text.inputMode = 'numeric';
  text.autocomplete = 'off';
  text.placeholder = fmtDateInput('2026-12-31').replace(/\d/g, '·');  // the shape of a date, e.g. ··/··/····
  text.title = inp.title || '';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'date-pick';
  pick.textContent = '📅';
  pick.title = T('Choose from the calendar');
  inp.replaceWith(wrap);
  wrap.append(text, pick, inp);
  inp.hidden = true;
  inp.tabIndex = -1;
  const show = () => { text.value = fmtDateInput(NATIVE_VALUE.get.call(inp)); text.classList.remove('bad'); };
  Object.defineProperty(inp, 'value', { configurable: true, get() { return NATIVE_VALUE.get.call(inp); }, set(x) { NATIVE_VALUE.set.call(inp, x); show(); } });
  const commit = (iso) => {
    if (iso === NATIVE_VALUE.get.call(inp)) return;
    NATIVE_VALUE.set.call(inp, iso);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  };
  text.addEventListener('input', () => {
    const iso = parseDateInput(text.value);
    const ok = iso !== null && (!inp.min || !iso || iso >= inp.min);
    text.classList.toggle('bad', !ok);
    if (ok) commit(iso);
  });
  text.addEventListener('blur', () => { if (!text.classList.contains('bad')) show(); });
  pick.addEventListener('click', (e) => { e.preventDefault(); datePopup(inp, wrap, commit); });
  show();
}
// small calendar under the field: month and weekday names of the interface language, Monday first
function datePopup(inp, anchor, commit) {
  document.querySelector('.date-pop')?.remove();
  const loc = dateLocale();
  const cur = NATIVE_VALUE.get.call(inp) || todayIso();
  let y = +cur.slice(0, 4), m = +cur.slice(5, 7) - 1;
  const pop = document.createElement('div');
  pop.className = 'date-pop';
  const wd = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(loc, { weekday: 'narrow' }).format(new Date(2026, 10, 9 + i)));  // a Monday
  const draw = () => {
    const first = new Date(y, m, 1), off = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    const title = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(first);
    const cells = [...Array(off)].map(() => '<span></span>').concat([...Array(days)].map((_, i) => {
      const iso = isoLocal(new Date(y, m, i + 1));
      const off2 = inp.min && iso < inp.min;
      return `<button type="button" data-iso="${iso}" class="${iso === NATIVE_VALUE.get.call(inp) ? 'on' : ''} ${iso === todayIso() ? 'today' : ''}" ${off2 ? 'disabled' : ''}>${i + 1}</button>`;
    }));
    pop.innerHTML = `<div class="dp-head"><button type="button" data-step="-1" title="${esc(T('Previous month'))}">‹</button><b>${esc(title)}</b><button type="button" data-step="1" title="${esc(T('Next month'))}">›</button></div>
      <div class="dp-grid">${wd.map((w) => `<i>${esc(w)}</i>`).join('')}${cells.join('')}</div>
      <div class="dp-foot"><button type="button" data-iso="${todayIso()}" ${inp.min && todayIso() < inp.min ? 'disabled' : ''}>${T('Today')}</button>${inp.required ? '' : `<button type="button" data-iso="">${T('Clear')}</button>`}</div>`;
  };
  draw();
  pop.addEventListener('mousedown', (e) => e.preventDefault());  // keep the focus where it is
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.step) { m += +b.dataset.step; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } draw(); return; }
    if (b.dataset.iso != null) { commit(b.dataset.iso); inp.value = b.dataset.iso; close(); }
  });
  const r = anchor.getBoundingClientRect();
  document.body.append(pop);
  const top = r.bottom + pop.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - pop.offsetHeight - 6) : r.bottom + 6;
  Object.assign(pop.style, { top: `${top}px`, left: `${Math.min(r.left, innerWidth - pop.offsetWidth - 8)}px` });
  const close = () => { pop.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc_, true); };
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc_ = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', esc_, true);
}
// every date input that appears (pages, windows) becomes a date field in the interface language
new MutationObserver(() => document.querySelectorAll('input[type="date"]:not([data-df])').forEach(enhanceDate))
  .observe(document.documentElement, { childList: true, subtree: true });

// "15 minutes", "1 hour", "2 hours" in the interface language
const durationLabel =(m) => (m < 60 ? tn('{n} minute', '{n} minutes', m) : tn('{n} hour', '{n} hours', m / 60));
const daysFrom = (iso) => Math.round((new Date(iso + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 86400000);

const KIND_LABEL = { expense: T('Expense'), income: T('Income'), transfer: T('Transfer') };
const FREQ = { weekly: T('Weekly'), monthly: T('Monthly'), bimonthly: T('Every 2 months'), quarterly: T('Quarterly'), semiannual: T('Every 6 months'), yearly: T('Yearly') };
const ACC_TYPES = { corrente: T('Current account'), risparmio: T('Savings account'), credito: T('Credit card'), prepagata: T('Prepaid card'), contanti: T('Cash'), investimenti: T('Investment account'), altro: T('Other') };
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
const PERIOD_LABELS = { '7d': T('Last 7 days'), '30d': T('Last 30 days'), month: T('This month'), prev: T('Last month'), '3m': T('Last 3 months'),
  '6m': T('Last 6 months'), year: T('This year'), lastyear: T('Last year'), '12m': T('Last 12 months'), all: T('All') };
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
// detail rows of a summary box, all in the same style: [label, value, link attributes?, tooltip?]. Labels are program
// texts (callers escape anything typed by the user); empty rows are left out, and no rows = no detail at all
const kRows = (...rows) => {
  const r = rows.filter(Boolean);
  return r.length ? `<div class="k-split">${r.map(([l, val, attrs, tip]) => {
    const t = tip ? ` title="${esc(tip)}"` : '';
    return attrs ? `<a ${attrs}${t}><span>${l}</span><b>${val}</b></a>` : `<span class="k-li"${t}><span>${l}</span><b>${val}</b></span>`;
  }).join('')}</div>` : '';
};
const txLink = (f, title = T('View transactions')) => `data-tx="${esc(JSON.stringify(f))}" title="${esc(title)}"`;
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
  if (await confirmDialog(T('The file you are about to download (CSV or Excel) will be UNENCRYPTED: anyone who opens it can see the data. Keep it safe and delete it when you no longer need it. For a protected copy, use the encrypted backup in Settings.'),
    { ok: T('Download anyway'), danger: false, title: T('⚠️ Unencrypted export') })) location.href = a.href;
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
  if (!r.ok) { const e = new Error((isJson && data.error) || `${T('Error')} ${r.status}`); e.status = r.status; e.data = data; throw e; }
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
  if (!st) { $('#lock-body').innerHTML = `<p class="lock-err">${T('Server not reachable: restart HomeCoin.')}</p>`; return; }
  // HomeCoin was updated while the page was open: reload to use the new interface
  if (AUTH.loadedVersion && AUTH.loadedVersion !== st.version) { location.reload(); return; }
  AUTH.loadedVersion = st.version;
  $('#lock-version').textContent = 'v' + st.version;
  document.body.classList.toggle('demo', !!st.demo);  // "DEMO · sample data" banner always visible
  if (st.demo) document.body.dataset.demo = T('DEMO VERSION · sample data, recreated at every start');
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
  if (pw.length < (AUTH.status?.min_password || 8)) throw new Error(tn('The password must be at least {n} character long', 'The password must be at least {n} characters long', AUTH.status?.min_password || 8));
  if (pw !== pw2) throw new Error(T('The two passwords do not match'));
}
const newPwFields = (label = T('New password')) => `
  <label class="field">${label}<input type="password" id="l-pw" autocomplete="new-password" autofocus></label>
  <div class="pw-meter"><span id="l-meter"></span></div>
  <label class="field">${T('Confirm password')}<input type="password" id="l-pw2" autocomplete="new-password"></label>`;
const LOCK_VIEWS = {
  login(st) {
    if (st?.demo) {  // demo version: sample data, you get in with one click
      $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
        <h2>${T('Demo version 🎬')}</h2>
        <p class="muted small">${T('All data is <b>made up</b> and recreated at every start of the demo: feel free to experiment, nothing you do is kept. Your real data cannot be reached from here.')}</p>
        <div class="lock-err" id="lock-err"></div>
        <button class="btn btn-primary" id="l-go">▶ ${T('Enter the demo')}</button></form>`;
      lockSubmit($('#l-go'), async () => { await api('/auth/login', { method: 'POST', body: { password: st.demo_password } }); unlocked(); });
      return;
    }
    $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
      <h2>${T('Welcome back 👋')}</h2>
      <label class="field">${T('Password')}<input type="password" id="l-pw" autocomplete="current-password" autofocus></label>
      <div class="lock-err" id="lock-err"></div>
      <button class="btn btn-primary" id="l-go">🔓 ${T('Unlock')}</button>
      <button type="button" class="link" id="l-forgot">${T('Forgot your password? Use the recovery key')}</button></form>`;
    setTimeout(() => $('#l-pw').focus(), 30);
    $('#l-forgot').onclick = () => LOCK_VIEWS.recover();
    lockSubmit($('#l-go'), async () => {
      await api('/auth/login', { method: 'POST', body: { password: $('#l-pw').value } });
      unlocked();
    });
  },
  setup(st) {
    $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
      <div class="wiz-steps"><span class="on">1 ${T('Password')}</span><span>2 ${T('Recovery key')}</span><span>3 ${T('Your setup')}</span></div>
      <h2>${T('Welcome to HomeCoin 🛡️')}</h2>
      <label class="field">🌐 ${T('Language')}${languageSelect('l-lang')}</label>
      <p class="muted small">${T('Choose the password you will be asked for every time you open it.')} ${st.legacy_data ? T('Your existing data (and the automatic backups) will be <b>encrypted</b> with AES-256.') : T('All data will be stored encrypted with AES-256.')}
        ${T('The password is not saved anywhere: keep it safe.')}</p>
      ${newPwFields(T('Password'))}
      <div class="lock-err" id="lock-err"></div>
      <button class="btn btn-primary" id="l-go">🔐 ${T('Create password and encrypt the data')}</button></form>`;
    pwMeter($('#l-pw'), $('#l-meter'));
    setTimeout(() => $('#l-pw').focus(), 30);
    $('#l-lang').onchange = (e) => {  // the page reloads in the chosen language (nothing typed is kept)
      document.cookie = `hc_lang=${encodeURIComponent(e.target.value)}; path=/; SameSite=Strict`;
      location.reload();
    };
    lockSubmit($('#l-go'), async () => {
      checkNew($('#l-pw').value, $('#l-pw2').value);
      const btn = $('#l-go');
      btn.textContent = T('Encrypting…');
      try {
        const r = await api('/auth/setup', { method: 'POST', body: { password: $('#l-pw').value, language: LANG } });
        LOCK_VIEWS.recovery(r.recovery_key, true);
      } finally { btn.textContent = T('🔐 Create password and encrypt the data'); }
    });
  },
  recover() {
    $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
      <h2>${T('Recover access 🗝️')}</h2>
      <p class="muted small">${T('Enter the recovery key you saved when you created the password, then choose a new password.')}</p>
      <label class="field">${T('Recovery key')}<input id="l-rk" autocomplete="off" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" autofocus></label>
      ${newPwFields()}
      <div class="lock-err" id="lock-err"></div>
      <button class="btn btn-primary" id="l-go">${T('Set the new password')}</button>
      <button type="button" class="link" id="l-back">← ${T('Back to sign-in')}</button></form>`;
    pwMeter($('#l-pw'), $('#l-meter'));
    $('#l-back').onclick = () => LOCK_VIEWS.login();
    lockSubmit($('#l-go'), async () => {
      checkNew($('#l-pw').value, $('#l-pw2').value);
      const r = await api('/auth/recover', { method: 'POST', body: { recovery_key: $('#l-rk').value, password: $('#l-pw').value } });
      LOCK_VIEWS.recovery(r.recovery_key);
    });
  },
  recovery(key, first = false) {  // key shown only once; on the first setup, then the welcome steps
    $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
      ${first ? `<div class="wiz-steps"><span class="done">1 ${T('Password')}</span><span class="on">2 ${T('Recovery key')}</span><span>3 ${T('Your setup')}</span></div>` : ''}
      <h2>${T('Your recovery key 🗝️')}</h2>
      <p class="muted small">${T('If you forget the password, this is <b>the only way</b> to reopen your data: nobody (not even the author of HomeCoin) can recover it without this key. Write it on paper or save it in a password manager. It will not be shown again.')}</p>
      <div class="recovery-code" id="l-key">${esc(key)}</div>
      <button type="button" class="btn" id="l-copy">📋 ${T('Copy')}</button>
      <label class="check-row"><input type="checkbox" id="l-ok"> ${T('I saved the recovery key in a safe place')}</label>
      <button class="btn btn-primary" id="l-go" disabled>${first ? T('Next →') : T('Enter HomeCoin →')}</button></form>`;
    $('#l-copy').onclick = async () => { try { await navigator.clipboard.writeText(key); toast(T('Key copied')); } catch { toast(T('Copy failed: select it by hand'), 'err'); } };
    $('#l-ok').onchange = (e) => ($('#l-go').disabled = !e.target.checked);
    $('#l-go').closest('form').onsubmit = (e) => { e.preventDefault(); if (first) LOCK_VIEWS.welcome(); else unlocked(); };
  },
  // first start, after password and recovery key: currency, first space and main account (all can be changed later)
  welcome() {
    const st = { cur: suggestedCurrency(), type: 'family' };
    setCurrency(st.cur);
    const draw = () => {
      $('#lock-body').innerHTML = `<form class="lock-body" style="margin:0">
        <div class="wiz-steps"><span class="done">1 ${T('Password')}</span><span class="done">2 ${T('Recovery key')}</span><span class="on">3 ${T('Your setup')}</span></div>
        <h2>${T('Set up HomeCoin ✨')}</h2>
        <p class="muted small">${T('A few choices to start; you can change everything later in Settings and Accounts.')}</p>
        <label class="field">${T('Currency of your accounts')}${currencySelect('w-cur', st.cur)}
          <span class="muted small">${T('Amounts are shown as {example}.', { example: esc(currencyExample(st.cur)) })} ${T('A label only: nothing is ever converted.')}</span></label>
        <div class="field"><span>${T('First space')}</span><div class="seg" id="w-type">${Object.entries(PF_TYPES).map(([k, t]) =>
          `<button type="button" data-t="${k}" class="${st.type === k ? 'on' : ''}">${t[2]} ${esc(t[0])}</button>`).join('')}</div>
          <span class="muted small">${st.type === 'family' ? T('Shared household finances: joint account, mortgage, fair split between people.') : T('Your own finances: salary, savings, investments.')} ${T('You can add more spaces later.')}</span></div>
        <label class="field">${T('Name of the space')}<input id="w-name" maxlength="40" value="${esc(st.name ?? PF_TYPES[st.type][1])}"></label>
        <label class="field">${T('Main account')}<input id="w-acc" maxlength="60" value="${esc(st.acc ?? (st.type === 'family' ? T('Joint account') : T('Current account')))}"></label>
        <label class="field">${T('Its balance today')} <span class="muted small">${T('(optional)')}</span><input id="w-bal" inputmode="decimal" placeholder="${moneyPlaceholder()}" value="${esc(st.bal ?? '')}"></label>
        <div class="lock-err" id="lock-err"></div>
        <button class="btn btn-primary" id="l-go">${T('Start using HomeCoin →')}</button></form>`;
      const keep = () => Object.assign(st, { name: $('#w-name').value, acc: $('#w-acc').value, bal: $('#w-bal').value });
      $('#w-cur').onchange = (e) => { keep(); st.cur = e.target.value; setCurrency(st.cur); draw(); };
      $$('#w-type button').forEach((b) => (b.onclick = () => { keep(); if (st.name === PF_TYPES[st.type][1]) st.name = null; if ([T('Joint account'), T('Current account')].includes(st.acc)) st.acc = null; st.type = b.dataset.t; draw(); }));
      lockSubmit($('#l-go'), async () => {
        keep();
        const bal = parseSignedMoney(st.bal);
        if (Number.isNaN(bal)) throw new Error(T('Invalid balance'));
        if (!st.acc.trim()) throw new Error(T('Enter a name for the main account'));
        if (st.cur !== 'EUR') await api('/settings/currency', { method: 'PUT', body: { currency: st.cur, confirm: true } });
        const m = await api('/meta');  // new installation: one household space with one empty account
        const first = m.portfolio, acc = m.accounts[0];
        const name = st.name.trim() || PF_TYPES[st.type][1];
        if (st.type === first.type) {
          await api(`/portfolios/${first.id}`, { method: 'PUT', body: { name, type: first.type, color: first.color, icon: PF_TYPES[st.type][2] } });
          await api(`/accounts/${acc.id}`, { method: 'PUT', body: { name: st.acc, type: 'corrente', color: acc.color, icon: acc.icon, initial_balance: bal } });
        } else {  // another type: a new space with its own default categories and tabs, the empty one removed
          const { id } = await api('/portfolios', { method: 'POST', body: { name, type: st.type, icon: PF_TYPES[st.type][2], color: '#6366f1' } });
          setPid(id);
          await api('/accounts', { method: 'POST', body: { name: st.acc, type: 'corrente', initial_balance: bal } });
          setPid(first.id);
          await api(`/accounts/${acc.id}`, { method: 'DELETE' });
          await api(`/portfolios/${first.id}`, { method: 'DELETE' });
          setPid(id);
        }
        unlocked();
      });
    };
    draw();
  },
  missing() {
    $('#lock-body').innerHTML = `<h2>${T('Key file missing ⚠️')}</h2>
      <p class="muted small">${T('The database is encrypted but')} <code>keystore.json</code> ${T('is missing from the data folder. Restore that file (for example from a copy of the')} <code>data</code> ${T('folder) and reload the page.')}</p>`;
  },
};
async function unlocked() {
  document.body.classList.remove('locked');
  $('#lock-body').innerHTML = '';  // the sign-in form (with the password typed) must not stay in the page once unlocked
  AUTH.lastInput = AUTH.lastPing = Date.now();
  resetPeriods();  // new sign-in: every tab goes back to "Last 12 months"
  if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');  // always start again from the Dashboard
  try { await loadMeta(); } catch (e) { fail(e); }
  route();
  if (sessionStorage.getItem('hc-demo-lang')) {
    sessionStorage.removeItem('hc-demo-lang');
    toast(T('Language changed. The sample data of the demo will be in the new language the next time you start the demo.'));
  }
  setTimeout(offerFolderProtection, 1200);  // after the dashboard has appeared
  setTimeout(() => loadUpdate('auto'), 2500);  // at most once a day, only if automatic checks are on
}
async function lockNow() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* already locked */ }
  showLock('login');
}
// started without a window (installer shortcut): this is how the server is stopped. The shortcut starts it again
async function quitApp() {
  if (!(await confirmDialog(T('HomeCoin will lock and stop. To open it again, use the HomeCoin shortcut (Start menu or desktop).'),
    { ok: T('⏻ Close HomeCoin'), danger: false, title: T('Close HomeCoin') }))) return;
  try { await api('/auth/quit', { method: 'POST' }); } catch { /* the server may already be gone */ }
  document.body.classList.add('locked');
  wipeView();
  $('#lock-body').innerHTML = `<div class="lock-body"><h2>${T('HomeCoin is closed 👋')}</h2>
    <p class="muted small">${T('Your data is locked and encrypted. You can close this tab. To open HomeCoin again, use its shortcut in the Start menu or on the desktop.')}</p></div>`;
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
  budget: ['🎯', T('Budgets'), T('Monthly spending limits per category, this month\'s spending against the average, and overspending alerts')],
  obiettivi: ['🏁', T('Goals'), T('Savings targets (trip, car, home…) with how much to set aside each month')],
  emergenza: ['🛟', T('Emergency fund'), T('How many months of expenses your available cash covers and how far you are from the recommended reserve')],
  calendario: ['📅', T('Calendar'), T('Due dates for the coming months (installments, bills, subscriptions, incoming payments) and projected balance')],
  mutuo: ['🔑', T('Mortgage'), T('Amortization schedule, fixed/variable/mixed rate, interest and early repayment simulation')],
  ripartizione: ['⚖️', T('Fair split'), T('How much each person should pay into the joint account to save the same % of their income')],
  investimenti: ['📈', T('Investments'), T('Securities and trades, investment plans, average cost, gains, return, XIRR and updated prices')],
  risparmio: ['🐷', T('Savings'), T('Savings and investment rate month by month, and net worth over time')],
};
const DEFAULT_FEATURES = {
  family: ['budget', 'obiettivi', 'emergenza', 'calendario', 'mutuo', 'ripartizione'],
  personal: ['budget', 'obiettivi', 'emergenza', 'calendario', 'investimenti', 'risparmio'],
};
const CORE_TABS = [['📊', T('Dashboard')], ['💸', T('Transactions')], ['🏦', T('Accounts')], ['🔁', T('Recurring')], ['📥', T('Import')], ['🏷️', T('Categories')],
  ['📑', T('Reports')], ['📜', T('Activity log')], ['⚙️', T('Settings')]];
const featureOn = (k, p = S.portfolio) => !FEATURES[k] || (p?.features || DEFAULT_FEATURES[p?.type] || []).includes(k);
const PF_TYPES = { family: [T('Household'), T('Family'), '🏠'], personal: [T('Personal'), T('Personal'), '👤'] };  // label, default name, icon
// guide to choosing the space type: the type decides the initial categories, the suggested tabs and some calculations
const PF_GUIDE = {
  family: {
    for: T('The shared household account: several people pay in and share the mortgage, bills and common expenses.'),
    diff: [T('Goals with each person\'s monthly share, in proportion to income'), T('People\'s contributions counted as shared income'), T('Emergency fund based on household expenses')],
    cats: T('🔑 Mortgage & loans, 🛋️ Home & furniture, 💡 Utilities, 🥦 Groceries, 💶 Contributions to household…'),
  },
  personal: {
    for: T('Your personal finances: salary, your own expenses, savings, investments and pension fund.'),
    diff: [T('Investment accounts valued at market price (cash + securities)'), T('Contributions to the household account as expenses or transfers to the household space'), T('Personal goals and emergency fund')],
    cats: T('💼 Salary, 📺 Subscriptions, 🎾 Sport & leisure, 📚 Books & learning, 🥦 Groceries…'),
  },
};
async function loadMeta() {
  const m = await api('/meta');
  Object.assign(S, { accounts: m.accounts, categories: m.categories, rules: m.rules, tx_count: m.tx_count, version: m.version,
    data_dir: m.data_dir, portfolio: m.portfolio, portfolios: m.portfolios, allAccounts: m.all_accounts,
    legacyCopies: m.legacy_copies || [], lastBackup: m.last_backup, currencyUnavailable: m.currency_unavailable });
  if (m.currency !== CUR) setCurrency(m.currency);
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
  toast(`${S.portfolio.icon} ${T('Space:')} ${S.portfolio.name}`, 'space');
}
// the color of the active space tints a few small accents (menu highlight, New transaction, the selected tab, the
// space-switch message); warnings, amounts, charts and confirmations keep the same colors in every space.
// Very light colors get dark text, so it stays readable
function applySpaceColor(hex) {
  const c = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#6366f1';
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(c.slice(i, i + 2), 16) / 255));
  const st = document.documentElement.style;
  st.setProperty('--space', c);
  st.setProperty('--space-ink', 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#1c1917' : '#ffffff');
}
function drawPortfolioSwitcher() {
  const p = S.portfolio;
  applySpaceColor(p.color);
  $('#pf-switch').innerHTML = `<button class="pf-current" id="pf-btn" style="--pc:${esc(p.color)}">
      <span class="pf-ico">${esc(p.icon)}</span><span class="pf-txt"><b>${esc(p.name)}</b><small>${PF_TYPES[p.type][0]}</small></span><span class="pf-caret">▾</span></button>
    <div class="pf-menu hidden" id="pf-menu">
      ${S.portfolios.filter((x) => !x.archived).map((x) => `<button data-pf="${x.id}" class="${x.id === p.id ? 'on' : ''}" style="--pc:${esc(x.color)}">
        <span class="pf-ico">${esc(x.icon)}</span><span class="pf-txt"><b>${esc(x.name)}</b><small>${PF_TYPES[x.type][0]} · ${tn('{n} account', '{n} accounts', x.accounts)}</small></span></button>`).join('')}
      <hr><button data-pf-new>＋ ${T('New space')}</button><button data-pf-manage>⚙️ ${T('Manage spaces')}</button></div>`;
  $$('#nav a').forEach((a) => a.classList.toggle('hidden', !featureOn(a.dataset.route, p)));
  $$('#nav .nav-group').forEach((g) => {  // a group title only when one of its tabs is shown in this space
    let n = g.nextElementSibling, any = false;
    for (; n && !n.classList.contains('nav-group'); n = n.nextElementSibling) any ||= !n.classList.contains('hidden');
    g.classList.toggle('hidden', !any);
  });
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
  (all ? `<option value="">${T('All accounts')}</option>` : '') +
  S.accounts.filter((a) => includeArchived || !a.archived || a.id === +sel)
    .map((a) => `<option value="${a.id}" ${+sel === a.id ? 'selected' : ''}>${esc(a.icon)} ${esc(a.name)}</option>`).join('');
// destination of a transfer: accounts of every space, grouped (the active one first)
const transferOptions = (sel) => [S.portfolio, ...S.portfolios.filter((p) => p.id !== S.pid && !p.archived)].map((p) => {
  const accs = S.allAccounts.filter((a) => a.portfolio_id === p.id && (!a.archived || a.id === +sel));
  return accs.length ? `<optgroup data-space="${p.id}" label="${esc(p.id === S.pid ? T('{name} (this space)', { name: p.name }) : p.name)}">${accs.map((a) =>
    `<option value="${a.id}" ${+sel === a.id ? 'selected' : ''}>${esc(a.icon)} ${esc(a.name)}</option>`).join('')}</optgroup>` : '';
}).join('');
const categoryOptions = (kind, sel, empty = T('Uncategorized')) =>
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
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn sm" data-close title="${esc(T('Close'))}">✕</button></div>
    <div class="modal-body">${html}</div></div></div>`;
  const m = $('.modal', root);
  $('[data-close]', m).addEventListener('click', closeModal);
  $('.modal-backdrop', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
  setTimeout(() => { const f = $('[autofocus]', m) || $('input, select', m); f && f.focus(); }, 30);
  return m;
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function confirmDialog(message, { ok = T('Confirm'), danger = true, title = T('Are you sure?') } = {}) {
  return new Promise((resolve) => {
    const m = openModal(title, `<p>${esc(message)}</p><div class="modal-foot">
      <button class="btn" data-no>${T('Cancel')}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(ok)}</button></div>`);
    $('[data-no]', m).onclick = () => { closeModal(); resolve(false); };
    $('[data-yes]', m).onclick = () => { closeModal(); resolve(true); };
  });
}

// a filter that takes several values: a button with the summary ("All accounts", the name, "3 selected") and a panel
// of ticks (grouped). value and onChange use a comma-separated string ('' = no filter).
function multiPick(el, { all, items, value = '', onChange }) {
  let sel = new Set(String(value || '').split(',').filter(Boolean));
  const label = () => {
    if (!sel.size) return all;
    if (sel.size === 1) return items.find((i) => String(i.value) === [...sel][0])?.label || all;
    return tn('{n} selected', '{n} selected', sel.size);
  };
  let group = null;
  el.innerHTML = `<button type="button" class="mp-btn ${sel.size ? 'on' : ''}"><span class="mp-label"></span><span class="mp-caret">▾</span></button>
    <div class="mp-panel hidden"><div class="mp-list">${items.map((i) => {
      const head = i.group && i.group !== group ? `<div class="mp-head">${esc(i.group)}</div>` : '';
      group = i.group || group;
      return `${head}<label class="mp-item"><input type="checkbox" value="${esc(i.value)}" ${sel.has(String(i.value)) ? 'checked' : ''}> <span>${esc(i.label)}</span></label>`;
    }).join('')}</div>
    <div class="mp-foot"><button type="button" class="btn btn-sm btn-ghost" data-clear>${esc(all)}</button></div></div>`;
  const btn = $('.mp-btn', el), panel = $('.mp-panel', el);
  const draw = () => { $('.mp-label', el).textContent = label(); btn.classList.toggle('on', sel.size > 0); btn.title = sel.size ? items.filter((i) => sel.has(String(i.value))).map((i) => i.label).join(', ') : all; };
  const emit = debounce(() => onChange([...sel].join(',')), 350);  // several ticks in a row: one search
  btn.onclick = (e) => { e.stopPropagation(); $$('.mp-panel').forEach((p) => p !== panel && p.classList.add('hidden')); panel.classList.toggle('hidden'); };
  panel.onclick = (e) => e.stopPropagation();
  $$('input', panel).forEach((c) => (c.onchange = () => { c.checked ? sel.add(c.value) : sel.delete(c.value); draw(); emit(); }));
  $('[data-clear]', panel).onclick = () => { sel = new Set(); $$('input', panel).forEach((c) => (c.checked = false)); draw(); panel.classList.add('hidden'); onChange(''); };
  draw();
}
document.addEventListener('click', () => $$('.mp-panel').forEach((p) => p.classList.add('hidden')));

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
// Symbol after the number (1.234,56 € · 6,91 $) or before it ($1,234.56 · -$1.2K · CHF 1’234.56 · R$ 1.234,56)
const AMOUNT_NUM = String.raw`\d{1,3}(?:[.,’'  ]\d{2,3})*(?:[.,]\d+)?`;
const AMOUNT_RE = new RegExp(String.raw`[−+-]?${AMOUNT_NUM}\s?K?\s?(?:€|CHF|\$|£)|[−+-]?(?:€|CHF|US\$|CA\$|A\$|MX\$|R\$|\$|£)\s?[−-]?${AMOUNT_NUM}K?`, 'g');
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
    b.title = on ? T('Show amounts') : T('Hide amounts');
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
// keep the cursor where it was when a page or a calculator redraws itself (e.g. after a recalculation): the field
// with the same id (or the same data-k and class), its selection and what was being typed in it
function snapFocus(root) {
  const a = document.activeElement;
  if (!a || a === document.body || !root.contains(a)) return null;
  const sel = a.id ? `#${CSS.escape(a.id)}` : a.dataset.k != null ? `${a.classList[0] ? '.' + CSS.escape(a.classList[0]) : ''}[data-k="${CSS.escape(a.dataset.k)}"]` : null;
  if (!sel) return null;
  let start = null, end = null;
  try { start = a.selectionStart; end = a.selectionEnd; } catch { /* not a text field */ }
  return { sel, start, end, value: a.value, typing: a.tagName === 'INPUT' && !/checkbox|radio/.test(a.type) };
}
function restoreFocus(root, s) {
  const el = s && root.querySelector(s.sel);
  if (!el) return;
  if (s.typing && el.value !== s.value) el.value = s.value;  // text typed while the calculation was running
  el.focus({ preventScroll: true });
  try { if (s.start != null) el.setSelectionRange(s.start, s.end); } catch { /* not a text field */ }
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
  if (t.kind === 'transfer') return `<span class="pill" style="--c:#0ea5e9">🔄 ${T('Transfer')}</span>`;
  if (!t.category_id) return `<span class="pill" style="--c:#94a3b8">❔ ${T('To categorize')}</span>`;
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
  dashboard: [T('Dashboard'), T('Your finances at a glance'), renderDashboard],
  movimenti: [T('Transactions'), T('All income, expenses and transfers'), renderMovimenti],
  conti: [T('Accounts'), T('Current accounts, cards and cash'), renderConti],
  ricorrenti: [T('Recurring'), T('Mortgages, loans, subscriptions and fixed expenses'), renderRicorrenti],
  import: [T('Import'), T('Upload a CSV or Excel bank statement'), renderImport],
  report: [T('Reports'), T('Breakdown by category and period'), renderReport],
  ripartizione: [T('Fair split'), T('How much each person should pay in to save the same percentage'), renderRipartizione],
  budget: [T('Budgets'), T('Monthly spending limits per category'), renderBudget],
  mutuo: [T('Mortgage & loans'), T('Amortization schedule, interest and early repayment simulation'), renderMutuo],
  investimenti: [T('Investments'), T('Value, contributions and return of the investment accounts'), renderInvestimenti],
  risparmio: [T('Savings'), T('Savings rate and net worth'), renderRisparmio],
  obiettivi: [T('Goals'), T('Savings targets and how much to set aside each month'), renderObiettivi],
  emergenza: [T('Emergency fund'), T('How many months of expenses your reserve covers'), renderEmergenza],
  calendario: [T('Calendar'), T('Due dates for the coming months and projected balance'), renderCalendario],
  categorie: [T('Categories'), T('Categories, budgets and automatic rules'), renderCategorie],
  registro: [T('Activity log'), T('Sign-ins, changes and important deletions over the last 12 months'), renderRegistro],
  impostazioni: [T('Settings'), T('Preferences, spaces, security, backups and updates'), renderImpostazioni],
};
function currentRoute() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  return { key: ROUTES[path] ? path : 'dashboard', params: new URLSearchParams(query || '') };
}
let routeSeq = 0;  // the page being shown: a slower page opened before it must not overwrite it
async function route() {
  const { key, params } = currentRoute();
  if (S.portfolio && !featureOn(key)) { location.hash = '#/dashboard'; return; }  // tab hidden in this space
  const [title, sub, render] = ROUTES[key];
  destroyCharts();
  chartTheme();
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  $('#page-title').textContent = title;
  $('#page-sub').textContent = S.portfolio ? `${S.portfolio.name} · ${sub}` : sub;
  const view = $('#view');
  const focus = snapFocus(view);
  // each page renders into its own box: if another page is opened before this one has finished loading, this box is
  // already detached, so the slower page can no longer overwrite the newer one (or show its error on it)
  const seq = ++routeSeq;
  const v = document.createElement('div');
  v.style.display = 'contents';
  v.innerHTML = `<div class="loading">${T('Loading…')}</div>`;
  view.replaceChildren(v);
  try {
    await render(v, params);
    if (seq === routeSeq) restoreFocus(v, focus);
  } catch (e) {
    if (seq === routeSeq) v.innerHTML = `<div class="card empty"><div class="big">😕</div><h3>${T('Something went wrong')}</h3><p>${esc(e.message)}</p></div>`;
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
      <h2>${T('Welcome to HomeCoin 👋')}</h2>
      <p>${T('Start by recording an expense, importing your bank statement or setting up your mortgage and recurring expenses: HomeCoin will do the rest.')}</p>
      <div class="actions" style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-go="add">＋ ${T('First transaction')}</button>
        <a class="btn" href="#/import">📥 ${T('Import bank statement')}</a>
        <a class="btn" href="#/ricorrenti">🔁 ${T('Set up recurring items')}</a>
        <a class="btn" href="#/conti">🏦 ${T('Add accounts')}</a>
      </div>
    </div>` : '';

  v.innerHTML = `${hero}
    <div class="toolbar">
      <select id="d-period">${PERIODS.map(([k, l]) => `<option value="${k}" ${k === d.period ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="d-account">${accountOptions(d.account_id, { all: true, includeArchived: true })}</select>
      <span class="muted small">${st.from_ ? `${fmtDate(st.from_)} → ${fmtDate(st.to)}` : ''}</span>
      ${st.excluded ? `<a class="chip small" href="#/movimenti?${qs({ excluded: 1, from, to })}" title="${esc(T('Not counted in totals and charts (they stay in the balance)'))}">🙈 ${tn('{n} excluded', '{n} excluded', st.excluded)}</a>` : ''}
    </div>
    <div class="kpis">
      <div class="kpi g-indigo"><div class="k-label">🏦 ${d.account_id ? T('Account balance') : T('Total net worth')}</div>
        <div class="k-value">${money(st.balance_now)}</div>${kRows([`🏦 ${T('Active accounts')}`, activeAccounts().length, 'href="#/conti"'])}</div>
      <div class="kpi g-emerald"><div class="k-label">📥 ${T('Income')}</div><div class="k-value">${money(inTot)}</div>
        ${fromOthers ? kRows([`💼 ${T('Income')}`, money(st.income), `href="#/movimenti?${qs({ kind: 'income', from, to, ...(d.account_id ? { account_id: d.account_id } : {}) })}"`, T('Actual income: salaries, contributions, interest…')],
          [`↙ ${T('From other spaces')}`, money(fromOthers), `href="#/movimenti?${qs({ kind: 'transfer', from, to })}"`, T('Transfers received from accounts in other spaces: they come in here and count toward savings')])
          : kRows([`📅 ${T('Per month')}`, money0(inTot / st.months)])}</div>
      <div class="kpi g-rose"><div class="k-label">📤 ${T('Money out')}</div><div class="k-value">${money(outTot)}</div>
        ${toOthers ? kRows([`🛒 ${T('Spending')}`, money(st.expense), `href="#/movimenti?${qs({ kind: 'expense', from, to, ...(d.account_id ? { account_id: d.account_id } : {}) })}"`, T('Actual expenses: spending categories, budgets and chart by category')],
          [`↗ ${T('To other spaces')}`, money(toOthers), st.other_categories ? 'href="#/report" data-reptab="other"' : `href="#/movimenti?${qs({ kind: 'transfer', from, to })}"`, T('Contributions and transfers to other spaces (e.g. the household account): they leave from here but are not expenses')])
          : kRows([`📅 ${T('Per month')}`, money0(outTot / st.months)])}</div>
      <div class="kpi g-amber"><div class="k-label">🐷 ${T('Savings')}</div><div class="k-value">${money(saved)}</div>
        ${kRows(inflow && [`📊 ${T('Savings rate')}`, pct(saved / inflow)])}</div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${T('Expenses by category')}</h3><span class="muted">${T('click for details')}</span></div>
        ${exp.length ? `<div class="donut-wrap"><div class="chart-box"><canvas id="c-donut"></canvas></div>
          <div class="legend">${exp.map((c, i) => `<div class="legend-item" data-cat="${c.id ?? 'none'}">
            <span class="dot" style="background:${esc(c.color)}"></span><span>${esc(c.icon)} ${esc(c.name)}<span class="pct">${pct(c.total / st.expense)}</span></span>
            <b class="num">${money(c.total)}</b></div>`).join('')}</div></div>`
          : `<div class="empty"><div class="big">🍩</div>${T('No expenses in the period')}</div>`}
      </div>
      <div class="card"><div class="card-head"><h3>${T('Income, money out and savings by month')}</h3></div>
        <div class="chart-box"><canvas id="c-month"></canvas></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${T('Balance over time')}</h3><span class="muted">${T('at month end')}</span></div>
        <div class="chart-box"><canvas id="c-balance"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>${T('Budgets')}</h3><span class="muted">${st.months > 1 ? tn('over {n} month', 'over {n} months', st.months) : T('month')}</span></div>
        <div id="budgets"></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${T('Upcoming payments')}</h3><a href="#/ricorrenti" class="small">${T('Manage →')}</a></div>
        <div class="list">${up.length ? up.slice(0, 7).map(upcomingItem).join('') : `<div class="empty"><div class="big">📅</div>${T('Nothing due in the next 45 days')}</div>`}</div></div>
      <div class="card"><div class="card-head"><h3>${T('Largest expenses')}</h3><span class="muted">${T('in the period')}</span></div>
        <div class="list">${st.top_expenses.length ? st.top_expenses.map((t) => `<div class="list-item clickable" ${txLink({ q: searchKey(t.description) }, T('View all similar transactions'))}>
          <div class="cat-ico" style="--c:${esc(t.category_color || '#94a3b8')}">${esc(t.category_icon || '❔')}</div>
          <div class="grow"><div class="title">${esc(t.description || t.category_name || T('Expense'))}</div><div class="muted small">${fmtDate(t.date)} · ${esc(t.account_name)}</div></div>
          <b class="amount expense">−${money(t.amount)}</b></div>`).join('') : `<div class="empty"><div class="big">🧾</div>${T('No expenses')}</div>`}</div></div>
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
  }).join('') : `<div class="empty"><div class="big">🎯</div><p>${T('Set a monthly budget on your categories to keep your spending under control.')}</p>
    <div class="actions"><a class="btn btn-sm" href="#/categorie">${T('Set budgets')}</a></div></div>`;

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
        // same colors everywhere: income green, expenses red, transfers between spaces blue (received light, sent
        // dark, each on its side), savings yellow
        { label: T('Income'), stack: 'in', data: months.map((m) => bm[m]?.income || 0), backgroundColor: '#059669', borderRadius: 8, maxBarThickness: 34 },
        ...(fromOthers ? [{ label: T('From other spaces'), stack: 'in', data: months.map((m) => bm[m]?.from_others || 0), backgroundColor: '#7dd3fc', borderRadius: 8, maxBarThickness: 34 }] : []),
        { label: T('Expenses'), stack: 'out', data: months.map((m) => bm[m]?.expense || 0), backgroundColor: '#e11d48', borderRadius: 8, maxBarThickness: 34 },
        ...(toOthers ? [{ label: T('Other spaces'), stack: 'out', data: months.map((m) => bm[m]?.to_others || 0), backgroundColor: '#0ea5e9', borderRadius: 8, maxBarThickness: 34 }] : []),
        { label: T('Savings'), stack: 'sav', data: months.map((m) => { const x = bm[m]; return x ? x.income + (x.from_others || 0) - x.expense - (x.to_others || 0) : 0; }),
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
    data: { labels: months.map(fmtMonth), datasets: [{ label: T('Balance'), data: st.balance_series.map((b) => b.balance), borderColor: '#8b5cf6', borderWidth: 3, tension: .35, fill: true, backgroundColor: (ctx) => vGradient(ctx, '#8b5cf6'), pointRadius: 3, pointBackgroundColor: '#8b5cf6', pointHitRadius: 14 }] },
    options: {
      maintainAspectRatio: false, scales: { y: moneyAxis, x: { grid: { display: false } } }, plugins: { legend: { display: false } },
      onHover: pointerOnHover,
      onClick: (_, el) => el.length && goTx({ ...monthBounds(months[el[0].index]), account_id: d.account_id }),
    },
  });
}

function upcomingItem(u) {
  const dd = daysFrom(u.date);
  const when = dd === 0 ? T('today') : dd === 1 ? T('tomorrow') : tn('in {n} day', 'in {n} days', dd);
  // transfers: where the money goes, and a sign when it crosses spaces (coming in from another space = +)
  const pidOf = (id) => S.allAccounts.find((a) => a.id === id)?.portfolio_id;
  const s = { ...u, portfolio_id: pidOf(u.account_id), to_portfolio_id: pidOf(u.to_account_id) };
  return `<div class="list-item clickable" ${txLink({ recurring_id: u.recurring_id }, T('View the transactions of this recurring item'))}>${dateChip(u.date)}
    <div class="grow"><div class="title">${u.kind === 'transfer' ? '🔄 ' : ''}${esc(u.name)} ${u.installment ? `<span class="tag">${T('installment {number}', { number: esc(u.installment) })}</span>` : ''}</div>
    <div class="muted small">${when} · ${esc(u.account_name)}${u.kind === 'transfer' && u.to_account_name ? ' → ' + esc(u.to_account_name) : ''}${u.incoming ? T(' · from another space') : ''}</div></div>
    <b class="amount ${u.kind}">${signedAmount(s)}</b></div>`;
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
      <div class="tx-filters">
        <input id="f-q" class="f-wide" type="search" placeholder="${esc(T('🔍 Search description or notes…'))}" value="${esc(f.q)}">
        <select id="f-period"><option value="">${T('Period…')}</option>${TX_PERIODS.map(([k, l]) => `<option value="${k}" ${periodRange(k).join() === `${f.from},${f.to}` ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input id="f-from" type="date" value="${esc(f.from)}" title="${esc(T('From'))}">
        <input id="f-to" type="date" value="${esc(f.to)}" title="${esc(T('To'))}">
        <div class="mp" id="f-account"></div>
        <div class="mp" id="f-kind"></div>
        <div class="mp" id="f-cat"></div>
        <select id="f-excl"><option value="">👁 ${T('Included and excluded')}</option><option value="0" ${f.excluded === '0' ? 'selected' : ''}>👁 ${T('Only included in reports')}</option><option value="1" ${f.excluded === '1' ? 'selected' : ''}>🙈 ${T('Only excluded from reports')}</option></select>
      </div>
    </div>
    <div class="toolbar" style="margin-bottom:12px">
      <div class="summary-chips" id="tx-summary" style="margin:0"></div><span class="spacer"></span>
      <button class="btn btn-sm btn-ghost" id="f-reset" title="${esc(T('Reset filters'))}">↺ ${T('Reset')}</button>
      <a class="btn btn-sm" id="exp-csv">⬇ CSV</a><a class="btn btn-sm" id="exp-xlsx">⬇ ${T('Excel')}</a>
    </div>
    <div id="bulk"></div>
    <div class="card" style="padding:6px 8px">
      <div class="table-wrap"><table class="tx-table">
        <thead><tr><th style="width:30px"><input type="checkbox" id="sel-all"></th><th>${T('Date')}</th><th>${T('Description')}</th><th>${T('Category')}</th><th>${T('Account')}</th><th class="right">${T('Amount')}</th><th></th></tr></thead>
        <tbody id="tx-body"></tbody></table></div>
      <div id="tx-more" style="text-align:center;padding:12px"></div>
    </div>`;

  const set = (k, val) => { f[k] = val; load(true); };
  $('#f-q').oninput = debounce((e) => set('q', e.target.value.trim()));
  $('#f-from').onchange = (e) => set('from', e.target.value);
  $('#f-to').onchange = (e) => set('to', e.target.value);
  // account, type and category: several values each (any of them), combined with the other filters
  multiPick($('#f-account'), { all: T('All accounts'), value: f.account_id, onChange: (v) => set('account_id', v),
    items: S.accounts.filter((a) => !a.archived || String(f.account_id).split(',').includes(String(a.id)))
      .map((a) => ({ value: a.id, label: `${a.icon} ${a.name}` })) });
  multiPick($('#f-kind'), { all: T('All types'), value: f.kind, onChange: (v) => set('kind', v),
    items: Object.entries(KIND_LABEL).map(([k, l]) => ({ value: k, label: l })) });
  multiPick($('#f-cat'), { all: T('All categories'), value: f.category_id, onChange: (v) => set('category_id', v),
    items: [{ value: 'none', label: `❔ ${T('To categorize')}` },
      ...catsOf('expense').map((c) => ({ value: c.id, label: `${c.icon} ${c.name}`, group: T('Expenses') })),
      ...catsOf('income').map((c) => ({ value: c.id, label: `${c.icon} ${c.name}`, group: T('Income') }))] });
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
      <td><div class="desc">${x.recurring_id ? `<span title="${esc(T('Generated by a recurring item'))}">🔁</span> ` : ''}${esc(x.description || '—')}${x.excluded ? ` <span class="tag">🙈 ${T('excluded from reports')}</span>` : ''}</div>${x.notes ? `<div class="notes">${esc(x.notes)}</div>` : ''}</td>
      <td><span class="quick-filter" ${txLink({ ...filters(), kind: x.kind, category_id: x.kind === 'transfer' ? '' : (x.category_id ?? 'none') }, T('Filter by this category'))}>${catPill(x)}</span></td>
      <td class="small">${x.kind === 'transfer' ? transferLabel(x) : `<span class="quick-filter" ${txLink({ ...filters(), account_id: x.account_id }, T('Filter by this account'))}>${esc(x.account_name)}</span>`}</td>
      <td class="amount ${x.kind}">${signedAmount(x)}</td>
      <td><div class="row-actions"><button class="icon-btn sm ${x.excluded ? 'eye-off' : ''}" data-eye title="${x.excluded ? T('Include again in reports and totals') : T('Exclude from reports and totals')}">${x.excluded ? '🙈' : '👁'}</button><button class="icon-btn sm" data-dup title="${esc(T('Duplicate'))}">⧉</button><button class="icon-btn sm" data-del title="${esc(T('Delete'))}">🗑</button></div></td></tr>`).join('')
      : `<tr><td colspan="7"><div class="empty"><div class="big">🔎</div><h3>${T('No transactions')}</h3><p>${T('Try changing the filters or add a new transaction.')}</p></div></td></tr>`;
    drawBulk();
  }
  function drawBulk() {
    const n = t.sel.size;
    $('#bulk').innerHTML = n ? `<div class="bulkbar"><b>${tn('{n} selected', '{n} selected', n)}</b><span class="spacer" style="flex:1"></span>
      <select id="bulk-cat"><option value="">🏷️ ${T('Assign category…')}</option>
        <optgroup label="${esc(T('Expenses'))}">${catsOf('expense').map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup>
        <optgroup label="${esc(T('Income'))}">${catsOf('income').map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup></select>
      <button class="btn btn-sm" id="bulk-excl">🙈 ${T('Exclude from reports')}</button><button class="btn btn-sm" id="bulk-incl">👁 ${T('Include')}</button>
      <button class="btn btn-sm btn-danger" id="bulk-del">🗑 ${T('Delete')}</button><button class="btn btn-sm" id="bulk-clear">${T('Cancel')}</button></div>` : '';
    if (!n) return;
    $('#bulk-clear').onclick = () => { t.sel.clear(); drawRows(); };
    $('#bulk-excl').onclick = () => setExcluded([...t.sel], true).then(() => { t.sel.clear(); drawRows(); });
    $('#bulk-incl').onclick = () => setExcluded([...t.sel], false).then(() => { t.sel.clear(); drawRows(); });
    $('#bulk-cat').onchange = async (e) => {
      if (!e.target.value) return;
      try { await api('/transactions/bulk', { method: 'POST', body: { action: 'category', ids: [...t.sel], category_id: +e.target.value } }); toast(T('Category assigned (only to transactions of the matching type)')); t.sel.clear(); load(true); } catch (err) { fail(err); }
    };
    $('#bulk-del').onclick = async () => {
      if (!(await confirmDialog(tn('Permanently delete {n} transaction?', 'Permanently delete {n} transactions?', n), { ok: T('Delete') }))) return;
      try {
        const r = await api('/transactions/bulk', { method: 'POST', body: { action: 'delete', ids: [...t.sel] } });
        toast(tn('{n} transaction deleted', '{n} transactions deleted', n) + (r.pac_deleted
          ? ' ' + tn('(and {n} linked automatic investment plan purchase)', '(and {n} linked automatic investment plan purchases)', r.pac_deleted) : '')); t.sel.clear(); await loadMeta(); load(true);
      } catch (err) { fail(err); }
    };
  }

  const filters = () => ({ q: f.q, from: f.from, to: f.to, account_id: f.account_id, category_id: f.category_id, kind: f.kind, excluded: f.excluded, recurring_id: f.recurring_id });
  function drawSummary(res) {
    $('#tx-summary').innerHTML = `<span class="chip">📄 ${tn('<b>{n}</b> transaction', '<b>{n}</b> transactions', res.total)}</span>
      <span class="chip">📥 <b class="pos">${money(res.income)}</b></span><span class="chip">📤 <b class="neg">${money(res.expense)}</b></span>
      <span class="chip">= <b class="${res.income - res.expense >= 0 ? 'pos' : 'neg'}">${money(res.income - res.expense)}</b></span>
      ${res.excluded ? `<span class="chip" title="${esc(T('Not counted in totals and reports'))}">🙈 ${tn('<b>{n}</b> excluded from totals', '<b>{n}</b> excluded from totals', res.excluded)}</span>` : ''}
      ${f.recurring_id ? `<button class="chip" ${txLink({ ...filters(), recurring_id: '' }, T('Remove the recurring item filter'))}>🔁 ${T('One recurring item only')} <b>✕</b></button>` : ''}`;
  }
  // shows/hides transactions in reports and totals, updating rows and summary without reloading the list
  async function setExcluded(ids, excluded) {
    try {
      const r = await api('/transactions/bulk', { method: 'POST', body: { action: excluded ? 'exclude' : 'include', ids } });
      if (r.skipped) toast(tn('{n} transfer coming from another space was not changed: change it from there',
        '{n} transfers coming from another space were not changed: change them from there', r.skipped), 'info');
      t.items.forEach((x) => { if (ids.includes(x.id) && !otherPf(x.portfolio_id)) x.excluded = excluded ? 1 : 0; });
      drawRows();
      drawSummary(await api('/transactions?' + qs({ ...filters(), limit: 1 })));
      toast(excluded ? `🙈 ${tn('{n} excluded from reports and totals', '{n} excluded from reports and totals', ids.length)}`
        : `👁 ${tn('{n} included again', '{n} included again', ids.length)}`, 'info');
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
    $('#tx-more').innerHTML = t.offset < res.total ? `<button class="btn btn-sm" id="more">${T('Load more (')}${res.total - t.offset})</button>` : '';
    if ($('#more')) $('#more').onclick = () => load(false).catch(fail);
  }
  t.sel.clear();
  await load(true);
}

async function deleteTx(item) {
  if (!(await confirmDialog(T('Delete the transaction "{name}" of {amount}?', { name: item.description || KIND_LABEL[item.kind], amount: money(item.amount) }), { ok: T('Delete') }))) return;
  try {
    const r = await api(`/transactions/${item.id}`, { method: 'DELETE' });
    toast(r.pac_deleted ? T('Transaction deleted, together with its automatic investment plan purchase') : T('Transaction deleted')); closeModal(); refresh();
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
    box.innerHTML = `<div class="ac-head">✨ ${T('Used before')}</div>` + items.map((it, i) => `<div class="ac-item" role="option" data-i="${i}">
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
  if (!S.accounts.length) { toast(T('Create an account first'), 'err'); return; }
  const m = openModal(editing ? T('Edit transaction') : T('New transaction'), `
    <div class="seg" id="tx-kind" style="margin-bottom:16px">
      ${Object.entries(KIND_LABEL).map(([k, l]) => `<button type="button" data-kind="${k}" class="${t.kind === k ? 'on' : ''}">${{ expense: '📤', income: '📥', transfer: '🔄' }[k]} ${l}</button>`).join('')}
    </div>
    <input id="tx-amount" class="amount-input" inputmode="decimal" placeholder="${esc(money(0))}" value="${moneyInput(t.amount)}" autofocus>
    <div class="form-grid" style="margin-top:16px">
      <label class="field full">${T('Description')} <input id="tx-desc" maxlength="200" value="${esc(t.description || '')}" placeholder="${esc(T('E.g. Supermarket shopping, electricity bill…'))}">
        <span id="tx-sugg-note" class="sugg-note hidden"></span></label>
      <label class="field">${T('Date')} <input id="tx-date" type="date" value="${esc(t.date)}"></label>
      <label class="field"><span id="acc-label">${T('Account')}</span> <select id="tx-account">${accountOptions(t.account_id)}</select></label>
      <label class="field" id="to-wrap">${T('To account')} <select id="tx-to">${transferOptions(t.to_account_id || activeAccounts().find((a) => a.id !== t.account_id)?.id)}</select></label>
      <label class="field" id="cat-wrap"><span class="field-head">${T('Category')} <span id="sugg"></span></span><select id="tx-cat"></select></label>
      <label class="field full">${T('Notes')} <textarea id="tx-notes" maxlength="1000" placeholder="${esc(T('Optional'))}">${esc(t.notes || '')}</textarea></label>
      <label class="check full"><input type="checkbox" id="tx-excl" ${t.excluded ? 'checked' : ''}> 🙈 ${T('Exclude from reports and totals')}
        <span class="muted small">${T('(it still counts in the account balance)')}</span></label>
    </div>
    <div class="modal-foot">
      ${editing ? `<button class="btn btn-ghost left neg" id="tx-del">🗑 ${T('Delete')}</button>` : `<span class="left muted small">${T('Tip: press')} <span class="kbd">N</span> ${T('for a new transaction')}</span>`}
      ${editing ? '' : `<button class="btn" id="tx-save-new">${T('Save & new')}</button>`}
      <button class="btn btn-primary" id="tx-save">${T('Save')}</button>
    </div>`);

  let kind = t.kind, catTouched = editing && !!t.category_id;
  const drawKind = () => {
    $$('#tx-kind button', m).forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
    $('#to-wrap', m).classList.toggle('hidden', kind !== 'transfer');
    $('#cat-wrap', m).classList.toggle('hidden', kind === 'transfer');
    $('#acc-label', m).textContent = kind === 'transfer' ? T('From account') : T('Account');
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
  // notes: the ones used recently with the same or a similar description, shown when the field gets focus (min 0)
  autocomplete($('#tx-notes', m), {
    min: 0,
    load: async (q) => (desc.value.trim().length < 3 ? []
      : (await api('/notes?' + qs({ description: desc.value, kind, q }))).map((d) => ({ value: d.notes, meta: acMeta(d) }))),
  });
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
        $('#sugg', m).innerHTML = `<span class="suggest-badge" title="${s.source === 'regola' ? `${T('Rule «')}${esc(s.pattern || '')}»` : T('Like similar transactions already categorized')}">✨ ${s.source === 'regola' ? T('by rule') : T('from history')}</span>`;
      }
      if (!full) return;  // accounts and amount only when picking a description used before
      if (!accTouched && pick('#tx-account', s.account_id)) done.push(kind === 'transfer' ? T('source account') : T('account'));
      if (kind === 'transfer' && !toTouched && s.to_account_id !== +$('#tx-account', m).value && pick('#tx-to', s.to_account_id)) done.push(T('destination account'));
      if (s.amount && !$('#tx-amount', m).value) { $('#tx-amount', m).value = moneyInput(s.amount); markSuggested($('#tx-amount', m)); done.push(T('amount')); }
      note(done.length ? `✨ ${T('{fields} as last time: check and edit if needed', { fields: done.join(', ').replace(/^./, (c) => c.toUpperCase()) })}` : '');
    } catch { /* ignore */ }
  }

  async function save(again) {
    const amount = parseMoney($('#tx-amount', m).value);
    if (!amount || Number.isNaN(amount)) { toast(T('Enter a valid amount'), 'err'); $('#tx-amount', m).focus(); return; }
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
        if (!(await confirmDialog(`${T('This account already has a transaction of {amount} on {date}', { amount: money(body.amount), date: fmtDate(dd.date) })}${dd.description ? ` («${dd.description}»)` : ''}. ${T('Record it anyway?')}`,
          { ok: T('Record anyway'), danger: false, title: T('Possible duplicate transaction') }))) { txModal({ ...body, id: undefined }); return; }  // reopens the dialog with the data
        res = await api('/transactions', { method: 'POST', body: { ...body, force: true } });
      }
      if (res.warning) toast(res.warning, 'info');
      else toast(editing ? T('Transaction updated') : T('Transaction recorded ✓'));
      if (defaults.afterSave) await defaults.afterSave(res);
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
  const card = (a) => `<div class="acc-card clickable-card ${a.archived ? 'archived' : ''}" style="--acc:${esc(a.color)}" ${txLink({ account_id: a.id }, `${T('Transactions')} ${a.name}`)}>
      <div class="acc-top"><span class="acc-icon">${esc(a.icon)}</span><span class="acc-type" title="${esc(ACC_BEHAVIOR[accGroup(a.type)].title)}">${ACC_BEHAVIOR[accGroup(a.type)].icon} ${esc(ACC_TYPES[a.type] || a.type)}</span></div>
      <div class="acc-name">${esc(a.name)}</div>
      <div class="acc-bal">${money(worth(a))}</div>
      <div class="acc-sub">${a.market_value != null ? T('market value · cash {amount}', { amount: money(a.balance) }) : tn('{n} transaction · opening balance {amount}', '{n} transactions · opening balance {amount}', a.tx_count, { amount: money(a.initial_balance) })}</div>
      <div class="acc-actions">
        ${a.archived ? '' : `<button data-acc-transfer="${a.id}">🔄 ${T('Transfer')}</button>`}
        <button data-acc-edit="${a.id}">✏️ ${T('Edit')}</button>
        <span class="acc-menu"><button class="acc-more" data-acc-menu title="${esc(T('More'))}">⋯</button>
          <span class="acc-pop hidden"><button data-acc-tx="${a.id}">📄 ${T('Transactions')}</button><button data-acc-doubles="${a.id}">🔍 ${T('Check for money recorded twice')}</button>
            <button data-acc-history="${a.id}">🕘 ${T('Compare with an automatic backup')}</button></span></span>
      </div></div>`;
  const archived = S.accounts.filter((a) => a.archived);
  // summary: cash for everyday use, investments, card debts, net worth
  const by = (g) => activeAccounts().filter((a) => accGroup(a.type) === g).reduce((s, a) => s + worth(a), 0);
  const cash = by('cash'), invest = by('invest'), credit = by('credit');
  const count = (g) => activeAccounts().filter((a) => accGroup(a.type) === g).length;
  v.innerHTML = `
    <div class="kpis">
      <div class="kpi g-indigo" title="${esc(T('current and savings accounts, cash, prepaid cards'))}"><div class="k-label">💧 ${T('Available money')}</div><div class="k-value">${money(cash)}</div>${kRows([`🏦 ${T('Accounts')}`, count('cash')])}</div>
      <div class="kpi g-indigo" title="${esc(T('market value'))}"><div class="k-label">📈 ${T('Investments')}</div><div class="k-value">${money(invest)}</div>${kRows([`🏦 ${T('Accounts')}`, count('invest')])}</div>
      ${count('credit') ? `<div class="kpi g-rose" title="${esc(T('balance of the cards (negative = to pay)'))}"><div class="k-label">💳 ${T('Credit cards')}</div><div class="k-value">${money(credit)}</div>${kRows([`💳 ${T('Cards')}`, count('credit')])}</div>` : ''}
      <div class="kpi g-indigo"><div class="k-label">💎 ${T('Total net worth')}</div><div class="k-value">${money(total)}</div>${kRows([`🏦 ${T('Active accounts')}`, activeAccounts().length])}</div>
    </div>
    <div class="toolbar">
      <span class="spacer"></span>
      <button class="btn" id="acc-transfer">🔄 ${T('Transfer')}</button>
      <button class="btn btn-primary" id="acc-new">＋ ${T('New account')}</button>
    </div>
    <div class="acc-grid">${activeAccounts().map(card).join('')}<button class="acc-add" id="acc-add">＋ ${T('Add an account')}</button></div>
    ${archived.length ? `<div class="section-title">${T('Archived')}</div><div class="acc-grid">${archived.map(card).join('')}</div>` : ''}
    <div class="grid-2" style="margin-top:22px">
      <div class="card"><div class="card-head"><h3>${T('Net worth breakdown')}</h3></div><div class="chart-box"><canvas id="c-acc"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>${T('How it works')}</h3></div>
        <div class="list">
          <div class="list-item"><div class="cat-ico" style="--c:#6366f1">🏦</div><div class="grow">${T('Every transaction belongs to an account: the balance is the opening balance plus income minus expenses.')}</div></div>
          <div class="list-item"><div class="cat-ico" style="--c:#0ea5e9">🔄</div><div class="grow">${T('<b>Transfers</b> move money between accounts (e.g. current → savings, card top-up) without counting as spending.')}</div></div>
          <div class="list-item"><div class="cat-ico" style="--c:#f59e0b">🗄️</div><div class="grow">${T('A closed account can be <b>archived</b>: it stays in the history but no longer appears in the choices.')}</div></div>
        </div></div>
    </div>`;
  $('#acc-new').onclick = $('#acc-add').onclick = () => accountModal();
  $('#acc-transfer').onclick = () => txModal(null, { kind: 'transfer' });
  $$('[data-acc-edit]').forEach((b) => (b.onclick = () => accountModal(S.accounts.find((a) => a.id === +b.dataset.accEdit))));
  $$('[data-acc-transfer]').forEach((b) => (b.onclick = () => txModal(null, { kind: 'transfer', account_id: +b.dataset.accTransfer })));
  $$('[data-acc-tx]').forEach((b) => (b.onclick = () => { location.hash = '#/movimenti?account_id=' + b.dataset.accTx; }));
  $$('[data-acc-menu]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const pop = b.nextElementSibling, open = pop.classList.contains('hidden');
    $$('.acc-pop').forEach((p) => p.classList.add('hidden'));
    pop.classList.toggle('hidden', !open);
  }));
  document.addEventListener('click', () => $$('.acc-pop').forEach((p) => p.classList.add('hidden')), { once: true });
  $$('[data-acc-doubles]').forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); await doublesModal(+b.dataset.accDoubles); refresh(); }));
  $$('[data-acc-history]').forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); await compareBackupModal(+b.dataset.accHistory); refresh(); }));
  const accs = activeAccounts().filter((a) => worth(a) > 0);
  chart($('#c-acc'), {
    type: 'bar',
    data: { labels: accs.map((a) => a.name), datasets: [{ label: T('Balance'), data: accs.map(worth), backgroundColor: accs.map((a) => a.color), borderRadius: 10, maxBarThickness: 46 }] },
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
    <input maxlength="8" value="${esc(value)}" style="width:70px;text-align:center" title="${esc(T('Or type an emoji'))}"></div>`;
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
  cash: { icon: '💧', title: T('cash account'), points: [
    T('The <b>balance</b> is available cash and counts toward net worth and the <b>emergency fund</b>'),
    T('<b>Income</b> and <b>expenses</b> count in reports, budgets and the month\'s savings'),
    T('Transfers to your other accounts move money without being expenses')] },
  credit: { icon: '💳', title: T('credit card'), points: [
    T('Expenses count as <b>spending</b> at the time of purchase'),
    T('The balance (usually negative) is the card debt; the statement charged to your account is paid with a transfer to the card'),
    T('It counts toward net worth as cash (even when negative)')] },
  invest: { icon: '📈', title: T('investment account'), points: [
    T('The <b>value</b> is the market value: cash + securities (from trades and updated prices) or values entered by hand'),
    T('Incoming transfers are <b>contributions</b> (capital put in), not expenses; the gain is value − invested'),
    T('Buying and selling securities counts as <b>invested</b>; <b>money market</b> ETFs are cash'),
    T('Money market securities and broker cash count toward the <b>emergency fund</b>; the rest does not')] },
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
  toInvest: [T('The balance stops being cash: it leaves the <b>emergency fund</b> and net worth uses the <b>market value</b>'),
    T('Incoming transfers become <b>contributions</b> (invested capital) and the gain is calculated on them'),
    T('Transactions already recorded stay the same, but the <b>savings</b> and <b>invested</b> amounts of past months are recalculated')],
  toCash: [T('The account goes back to <b>cash</b>: it joins the emergency fund and counts with its book balance, no longer its market value'),
    T('The <b>valuations</b> you entered are no longer used and the account disappears from Investments (return, XIRR, allocation)'),
    T('Incoming transfers are no longer contributions: the <b>savings</b> and <b>invested</b> amounts of past months may change')],
};
const accShift = (from, to) => ((from === 'investimenti') === (to === 'investimenti') ? null : to === 'investimenti' ? 'toInvest' : 'toCash');

function accountModal(a = null, preset = {}) {
  const x = a || { name: '', type: 'corrente', color: PALETTE[Math.floor(Math.random() * PALETTE.length)], icon: '🏦', initial_balance: 0, ...preset };
  const m = openModal(a ? T('Edit account') : T('New account'), `
    <div class="form-grid">
      <label class="field full">${T('Name')} <input id="a-name" maxlength="60" value="${esc(x.name)}" placeholder="${esc(T('E.g. Main bank account, Prepaid card, Cash'))}" autofocus></label>
      <label class="field">${T('Type')} <select id="a-type">${Object.entries(ACC_TYPES).map(([k, l]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">${T('Opening balance')} <input id="a-init" inputmode="decimal" value="${moneyInput(x.initial_balance)}" placeholder="${moneyPlaceholder()}"></label>
      <div class="full acc-type-help" id="a-help"></div>
      <div class="field full">${T('Color')} ${swatchPicker('a-color', x.color)}</div>
      <div class="field full">${T('Icon')} ${emojiPicker('a-icon', x.icon)}</div>
      ${a ? `<label class="check full"><input type="checkbox" id="a-arch" ${x.archived ? 'checked' : ''}> ${T('Archived account (closed)')}</label>` : ''}
    </div>
    <div class="modal-foot">${a ? `<button class="btn btn-ghost left neg" id="a-del">🗑 ${T('Delete')}</button>` : ''}
      <button class="btn" data-cancel>${T('Cancel')}</button><button class="btn btn-primary" id="a-save">${T('Save')}</button></div>`);
  const getColor = bindSwatches($('#a-color', m)), getIcon = bindEmoji($('#a-icon', m));
  // the type decides how the account behaves: explanation always visible and automatic suggestion from the name (editable)
  let typeTouched = !!a || !!preset.type;
  const help = (auto) => {
    const t = $('#a-type', m).value, g = ACC_BEHAVIOR[accGroup(t)];
    const shift = a && accShift(a.type, t);
    $('#a-help', m).innerHTML = `<div class="acc-help-head">${g.icon} <b>${esc(ACC_TYPES[t])}</b> · ${g.title}${auto ? ` <span class="tag ai">${T('suggested from the name')}</span>` : ''}</div>
      <ul>${g.points.map((p) => `<li>${p}</li>`).join('')}</ul>
      ${shift ? `<div class="acc-shift-warn"><b>⚠️ ${T('Change of account group')}</b> (${shift === 'toInvest' ? T('cash → investments') : T('investments → cash')}): ${T('changes how the account counts in your data')}<!-- i18n-ok -->
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
      `${T('You are moving "{name}" from {change}', { name: a.name, change: shift === 'toInvest' ? T('cash to investments') : T('investments to cash') })} (${ACC_TYPES[a.type]} → ${ACC_TYPES[$('#a-type', m).value]}).
      ${T('Net worth, emergency fund, savings and invested amounts will be recalculated for past months too. Transactions are not changed and you can switch back at any time. Continue?')}`,
      { ok: T('Change account group'), title: T('⚠️ Change of account group') }))) return;
    const raw = $('#a-init', m).value.trim();
    let init = raw ? parseSignedMoney(raw) : 0;
    if (!Number.isFinite(init)) { toast(T('Invalid opening balance'), 'err'); return; }
    const body = { name: $('#a-name', m).value, type: $('#a-type', m).value, color: getColor(), icon: getIcon(), initial_balance: init, archived: a ? $('#a-arch', m).checked : false };
    try { await api(a ? `/accounts/${a.id}` : '/accounts', { method: a ? 'PUT' : 'POST', body }); toast(T('Account saved')); closeModal(); refresh(); } catch (e) { fail(e); }
  };
  if (a) $('#a-del', m).onclick = async () => {
    if (!(await confirmDialog(T('Delete the account "{name}"?', { name: a.name }), { ok: T('Delete') }))) return;
    try { await api(`/accounts/${a.id}`, { method: 'DELETE' }); toast(T('Account deleted')); refresh(); } catch (e) { fail(e); }
  };
}

// ================================================================ recurring
async function renderRicorrenti(v) {
  const [list, up] = await Promise.all([api('/recurring'), api('/upcoming?days=60')]);
  // the three kinds of recurring items, as a monthly equivalent: expenses, income, transfers (out of this space's
  // accounts; those coming in from other spaces shown apart). Margin = what is left each month after all of them.
  const act = list.filter((r) => r.active);
  const sum = (f) => act.filter(f).reduce((s, r) => s + r.monthly_equivalent, 0);
  const isPac = (r) => r.kind === 'transfer' && r.holding_id;
  const fixedOut = sum((r) => r.kind === 'expense'), nOut = act.filter((r) => r.kind === 'expense').length;
  const fixedIn = sum((r) => r.kind === 'income'), nIn = act.filter((r) => r.kind === 'income').length;
  const trIn = sum((r) => r.kind === 'transfer' && r.incoming);
  // a transfer to an account of this same space moves money inside it (card top-up, investment plan): it does not
  // change the margin, so it is shown apart from the transfers that leave the space
  const toOther = (r) => r.kind === 'transfer' && !r.incoming && S.allAccounts.find((a) => a.id === r.to_account_id)?.portfolio_id !== S.pid;
  const trOutOther = sum(toOther), nOther = act.filter(toOther).length;
  const trInside = sum((r) => r.kind === 'transfer' && !r.incoming && !toOther(r));
  const pac = sum((r) => isPac(r) && !toOther(r));
  // margin: what is left each month after every fixed item (income and transfers received − expenses − transfers out)
  const margin = fixedIn + trIn - fixedOut - trOutOther;
  const groups = [
    [T('📈 Investment plans'), list.filter(isPac), T('Each contribution automatically buys units of the chosen security at the day\'s estimated price: then verify the actual price in Investments.')],
    [T('🏠 Mortgages & loans'), list.filter((r) => r.installments)],
    [T('📤 Recurring expenses'), list.filter((r) => !r.installments && r.kind === 'expense')],
    [T('📥 Recurring income'), list.filter((r) => !r.installments && r.kind === 'income')],
    [T('🔄 Scheduled transfers'), list.filter((r) => !r.installments && r.kind === 'transfer' && !isPac(r))],
  ].filter(([, l]) => l.length);

  v.innerHTML = `
    <div class="kpis">
      <div class="kpi g-rose" title="${esc(T('monthly equivalent'))}"><div class="k-label">📤 ${T('Fixed monthly expenses')}</div><div class="k-value">${money(fixedOut)}</div>
        ${kRows([`🔁 ${T('Items')}`, nOut])}</div>
      <div class="kpi g-emerald" title="${esc(T('monthly equivalent'))}"><div class="k-label">📥 ${T('Fixed monthly income')}</div><div class="k-value">${money(fixedIn + trIn)}</div>
        ${trIn ? kRows([`💼 ${T('Income')}`, money(fixedIn)], [`↙ ${T('From other spaces')}`, money(trIn)]) : kRows([`🔁 ${T('Items')}`, nIn])}</div>
      <div class="kpi g-sky" title="${esc(T('monthly equivalent'))}"><div class="k-label">🔄 ${T('Transfers to other spaces')}</div><div class="k-value">${money(trOutOther)}</div>
        ${kRows([`🔁 ${T('Items')}`, nOther], trInside && [`↔ ${T('Inside this space')}`, money(trInside), '', T('Card top-ups, investment plans and other transfers between accounts of this space: the money stays in the space, so they do not reduce the margin')])}</div>
      <div class="kpi g-amber" title="${esc(T('Fixed income and transfers received − fixed expenses − transfers to other spaces'))}"><div class="k-label">${margin < 0 ? '⚠️' : '✅'} ${T('Monthly margin')}</div><div class="k-value">${money(margin)}</div>
        ${kRows(fixedIn + trIn > 0 && [`📊 ${T('Of income')}`, pct(margin / (fixedIn + trIn))], pac && [`📈 ${T('Into investment plans')}`, money(pac)])}</div>
    </div>
    <div class="toolbar"><span class="muted small" style="flex:1 1 260px">${T('Payments that fall due are recorded automatically as transactions.')}</span>
      <span class="btn-row"><button class="btn" id="r-run">⚡ ${T('Process due payments')}</button><button class="btn btn-primary" id="r-new">＋ ${T('New recurring item')}</button></span></div>
    <div class="grid-3-2">
      <div>${groups.length ? groups.map(([title, l, help]) => `<div class="section-title" style="margin-top:4px">${title}</div>${help ? `<p class="muted small" style="margin:-4px 0 10px">${help}</p>` : ''}<div class="rec-grid">${l.map(recCard).join('')}</div>`).join('')
        : `<div class="card empty"><div class="big">🔁</div><h3>${T('No recurring items')}</h3><p>${T('Set up your mortgage, loans, rent, subscriptions and salary: they will be recorded automatically every time they fall due.')}</p>
          <div class="actions"><button class="btn btn-primary" data-new>＋ ${T('Create the first one')}</button></div></div>`}</div>
      <div class="card" style="align-self:start"><div class="card-head"><h3>${T('Next 60 days')}</h3><span class="muted">${tn('{n} due', '{n} due', up.length)}</span></div>
        <div class="list">${up.length ? up.slice(0, 20).map(upcomingItem).join('') : `<div class="empty">${T('Nothing due')}</div>`}</div></div>
    </div>`;
  $('#r-new').onclick = () => recurringModal();
  $$('[data-new]', v).forEach((b) => (b.onclick = () => recurringModal()));
  $('#r-run').onclick = async () => { try { const r = await api('/recurring/run', { method: 'POST' }); toast(r.created ? tn('{n} transaction recorded', '{n} transactions recorded', r.created) : T('No due payments to record'), 'info'); refresh(); } catch (e) { fail(e); } };
  v.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    const r = list.find((x) => x.id === +b.dataset.id);
    if (b.dataset.r === 'tx') location.hash = '#/movimenti?recurring_id=' + r.id;
    if (r.incoming) return;  // changed only in the space that created it
    // a variable item that arrived: a new transaction filled in like it (the keyword in the description links it);
    // the real date and amount are the user's, the item's next expected date follows from it
    if (b.dataset.r === 'arrived') txModal(null, {
      kind: r.kind, account_id: r.account_id, category_id: r.category_id, description: r.match_text || r.name,
      amount: r.expected_amount, date: todayIso(), afterSave: () => api('/recurring/run', { method: 'POST' }),
    });
    if (b.dataset.r === 'edit') recurringModal(r);
    if (b.dataset.r === 'reconcile') { await reconcileModal(r.id); refresh(); }
    if (b.dataset.r === 'link') { await linkModal(r); refresh(); }
    if (b.dataset.r === 'toggle') {
      try { await api(`/recurring/${r.id}`, { method: 'PUT', body: { ...r, active: !r.active } }); toast(r.active ? T('Recurring item paused') : T('Recurring item resumed'), 'info'); refresh(); } catch (err) { fail(err); }
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
  const tagOf = (x) => !x.estimated ? '' : x.late ? `<span class="tag warn">${T('expected since {date}', { date: esc(fmtDate(x.nominal)) })}</span>`
    : x.source === 'expected' ? `<span class="tag">≈ ${T('variable amount')}</span>`
    : `<span class="tag">≈ ${tn('estimated · {n} month out of {total}', 'estimated · {n} months out of {total}', x.months_seen, { total: d.history_months })}</span>`;
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
        <span class="cal-d">${dd}</span>${its.length ? `<span class="cal-ico ${its.length > 6 ? 'many' : ''}">${its.map((x) => `<span class="${x.estimated ? 'est' : ''}" title="${x.estimated ? T('≈ estimated · ') : ''}${esc(x.name)} ${esc(money(x.amount))}">${esc(x.kind === 'transfer' ? '🔄' : x.category_icon || '🔁')}</span>`).join('')}</span>
        <span class="cal-net ${net > 0 ? 'pos' : net < 0 ? 'neg' : 'muted'}">${net ? (est ? '≈' : '') + (net > 0 ? '+' : '−') + money0(Math.abs(net)) : '↔'}</span>` : ''}</div>`);
    }
    return `<div class="cal-grid">${[T('Mo'), T('Tu'), T('We'), T('Th'), T('Fr'), T('Sa'), T('Su')].map((w) => `<div class="cal-w">${w}</div>`).join('')}${cells.join('')}</div>`;
  };
  const line = (x) => `<div class="list-item ${x.estimated ? 'cal-est' : ''}">${dateChip(x.date)}
    <div class="grow"><div class="title">${esc(x.name)} ${x.installment ? `<span class="tag">${T('installment {number}', { number: esc(x.installment) })}</span>` : ''} ${tagOf(x)}</div>
      <div class="muted small">${esc(x.account_name || '')}${x.kind === 'transfer' ? ' → ' + esc(x.to_account_name || '') : ''}${x.incoming ? T(' · from another space') : ''}</div></div>
    <div class="right"><b class="${x.effect > 0 ? 'pos' : x.effect < 0 ? 'neg' : 'muted'}">${x.estimated ? '≈ ' : ''}${x.effect ? (x.effect > 0 ? '+' : '−') + money(Math.abs(x.effect)) : '↔ ' + money(x.amount)}</b>
      <div class="muted small">${T('balance {amount}', { amount: money0(x.after) })}</div></div></div>`;
  v.innerHTML = `
    <div class="toolbar"><select id="cal-months">${[['1', T('This month')], ['3', T('Next 3 months')], ['6', T('Next 6 months')], ['12', T('Next 12 months')]].map(([k, l]) => `<option value="${k}" ${k === S.calMonths ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <details class="help" style="flex:1 1 300px"><summary>ℹ️ ${T('How it works')}</summary>
        <p>${T('Due dates of active recurring items (including transfers coming in from other spaces). Cash = only the day-to-day accounts (current, savings, cards, cash), where the payments go through; the Emergency fund also counts broker cash and money market ETFs.')}</p>
        ${plusEst || minusEst ? `<p>≈ ${T('<b>Estimated</b>, with the same method for income and expenses: variable recurring items (median of recent payments) and regular transactions without a recurring item, recognized from history (same payer or payee in at least {min} of the last {months} months, ignoring month and year in the description; median monthly amount and day). Occasional expenses are not forecast; among estimated income only significant amounts are included (at least {amount} and 5% of the largest, so small account interest is left out). To track an item better, create a "variable amount" recurring item in Recurring.', { min: d.regular_min, months: d.history_months, amount: money0(5000) })}</p>` : ''}</details></div>
    <div class="kpis">
      <div class="kpi g-indigo" title="${esc(T('day-to-day accounts, no broker') + ' · ' + T('The emergency fund adds the uninvested broker cash and money market ETFs'))}"><div class="k-label">💧 ${T('Cash in accounts today')}</div><div class="k-value">${money0(d.start_liquidity)}</div>
        ${kRows([`📅 ${T('Due dates')}`, items.length])}</div>
      <div class="kpi g-emerald"><div class="k-label">📥 ${T('Coming in')}</div><div class="k-value">+${money0(plus)}</div>
        ${plusEst ? kRows([`✔ ${T('Confirmed')}`, money0(plusSure), '', T('Confirmed (recurring items)')], [`≈ ${T('Estimated')}`, money0(plusEst), '', T('Estimated (variable and regular)')])
          : kRows([`📅 ${T('Due dates')}`, items.filter((x) => x.effect > 0).length])}</div>
      <div class="kpi g-rose"><div class="k-label">📤 ${T('Going out')}</div><div class="k-value">−${money0(-minus)}</div>
        ${minusEst ? kRows([`✔ ${T('Confirmed')}`, money0(minusSure), '', T('Confirmed (recurring items)')], [`≈ ${T('Estimated')}`, money0(minusEst), '', T('Estimated (variable and regular)')])
          : kRows([`📅 ${T('Due dates')}`, items.filter((x) => x.effect < 0).length])}</div>
      <div class="kpi g-amber"><div class="k-label">${bal < 0 ? '⚠️' : '🔮'} ${T('Projected cash on {date}', { date: esc(fmtDate(d.end)) })}</div><div class="k-value">${plusEst || minusEst ? '≈ ' : ''}${money0(bal)}</div>
        ${kRows(plusEst || minusEst ? [`✔ ${T('Confirmed only')}`, money0(sure)] : null, [`Δ ${T('Difference')}`, (bal >= d.start_liquidity ? '+' : '−') + money0(Math.abs(bal - d.start_liquidity))])}</div>
    </div>
    ${months.map((m) => {
      const key = isoLocal(m).slice(0, 7), its = items.filter((x) => x.date.startsWith(key));
      return `<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>${esc(fmtMonth(key))}</h3><span class="muted">${tn('{n} due', '{n} due', its.length)}</span></div>
        <div class="cal-wrap">${grid(m)}<div class="list">${its.length ? its.map(line).join('') : `<div class="empty">${T('Nothing due')}</div>`}</div></div></div>`;
    }).join('')}`;
  $('#cal-months').onchange = (e) => { S.calMonths = e.target.value; route(); };
}

function recCard(r) {
  const pac = r.kind === 'transfer' && r.holding_id;
  const ico = pac ? '📈' : r.kind === 'transfer' ? '🔄' : r.category_icon || '🔁';
  const color = pac ? '#10b981' : r.kind === 'transfer' ? '#0ea5e9' : r.category_color || '#94a3b8';
  const status = !r.active ? T('⏸ Paused') : r.late_since ? `⚠️ ${T('expected since {date}', { date: fmtDate(r.late_since) })}` : r.next_date ? `📅 ${r.expected ? '≈ ' : ''}${fmtDate(r.next_date)}` : T('✅ Completed');
  const stat = (label, value) => `<div class="rec-stat"><span>${label}</span><b>${value}</b></div>`;
  const progress = r.installments
    ? `<div class="top small"><span>${T('Installment <b>{paid}</b> of {total}', { paid: r.paid, total: r.installments })}</span><span class="muted">${pct(r.progress)}</span></div>
       <div class="bar"><i style="width:${(r.progress * 100).toFixed(1)}%"></i></div>`
    : r.expected ? `<div class="small muted">≈ ${T('Variable amount and date')}${r.match_text ? ` · «${esc(r.match_text)}»` : ''} · ${tn('{n} linked', '{n} linked', r.recorded)}</div>`
    : '';  // ongoing item: how many were recorded is in the stats line
  const stats = r.expected
    ? stat(r.expected_source === 'fixed' ? T('Expected (set)') : r.expected_source === 'set' ? T('Expected (typical)') : tn('Expected (median of {n})', 'Expected (median of {n})', r.expected_count), money(r.expected_amount))
      + stat(T('Range'), r.expected_count > 1 ? `${money0(r.expected_min)}–${money0(r.expected_max)}` : '—') + stat(T('Last'), r.last_date ? fmtDate(r.last_date) : '—')
    : r.installments
    ? stat(T('Remaining'), money(r.remaining_amount)) + stat(T('Last installment'), fmtDate(r.last_date)) + stat(T('Interest'), r.principal ? (r.interest > 0 ? money(r.interest) : T('0% rate')) : '—')
    : stat(T('Per month'), money(r.monthly_equivalent)) + stat(T('From'), fmtDate(r.start_date)) + stat(T('Until'), r.end_date ? fmtDate(r.end_date) : '—')
      + stat(T('Recorded'), r.recorded);
  return `<div class="card rec-card ${r.active ? '' : 'paused'}">
    <div class="rec-head"><div class="cat-ico" style="--c:${esc(color)}">${esc(ico)}</div>
      <div class="grow" style="min-width:0"><div class="title ellipsis" title="${esc(r.name)}">${esc(r.name)}</div>
      <div class="muted small">${FREQ[r.frequency]} · ${esc(r.account_name)}${r.kind === 'transfer' ? ' → ' + esc(r.to_account_name) : ''}</div></div></div>
    ${pac ? `<div class="small" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="tag ai" title="${esc(T('Each contribution automatically buys units of the linked security'))}">📈 ${T('Plan')}</span>
      <span>${T('buys')} <b>${esc(r.holding_ticker || '')}</b> <span class="muted">${esc(r.holding_name || '')}</span></span>
      ${r.pac_unverified ? `<a class="tag warn" href="#/investimenti" title="${esc(T('Purchases with an estimated price for more than 30 days'))}">⚠️ ${tn('{n} price to verify', '{n} prices to verify', r.pac_unverified)}</a>` : ''}</div>` : ''}
    <div class="rec-line"><span class="rec-amount amount ${r.kind}">${r.expected ? '≈ ' + money(r.expected_amount) : money(r.amount)}</span><span class="rec-next">${status}</span></div>
    ${progress ? `<div class="rec-progress">${progress}</div>` : ''}
    <div class="rec-stats">${stats}</div>
    ${r.incoming
    ? `<div class="rec-actions"><span class="tag" title="${esc(T('It can be changed only in the space that created it'))}">↘ ${T('From {space} · read only', { space: esc(r.from_space) })}</span>
        <span class="spacer"></span><button class="icon-btn sm" data-r="tx" data-id="${r.id}" title="${esc(T('Transactions'))}">📄</button></div></div>`
    // one line in every language: the frequent tools as icons (name on hover), Edit with its label on the right;
    // "Record the one that arrived" of a variable item gets its own line above
    : `${r.expected && r.active ? `<button class="btn btn-sm btn-primary rec-arrived" data-r="arrived" data-id="${r.id}" title="${esc(T('A new transaction already filled in: correct the real amount and date, it is linked to this recurring item'))}">＋ ${T('Record the one that arrived')}</button>` : ''}
      <div class="rec-actions">
      <button class="icon-btn sm" data-r="tx" data-id="${r.id}" title="${esc(T('Transactions'))}">📄</button>
      ${toOtherSpace(r) ? `<button class="icon-btn sm" data-r="reconcile" data-id="${r.id}" title="${esc(`${T('Reconcile')}: ${T('Find the same money recorded in other ways in both spaces')}`)}">🔗</button>`
        : `<button class="icon-btn sm" data-r="link" data-id="${r.id}" title="${esc(`${T('Link')}: ${T('Link payments already recorded (before this item existed, by hand or imported)')}`)}">📎</button>`}
      <button class="icon-btn sm" data-r="toggle" data-id="${r.id}" title="${esc(r.active ? T('⏸ Pause') : T('▶ Resume'))}">${r.active ? '⏸' : '▶'}</button>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-r="edit" data-id="${r.id}">✏️ ${T('Edit')}</button></div></div>`}`;
}

// a plain recurring transfer of this space to an account of another space (one flow of money seen in both)
function toOtherSpace(r) {
  const to = S.allAccounts.find((a) => a.id === r.to_account_id);
  return r.kind === 'transfer' && !r.incoming && !r.holding_id && !r.installments && to && to.portfolio_id !== S.pid;
}

// cat: candidate category names, first match wins (English defaults, then the legacy Italian names of existing databases)
const PRESETS = [
  { label: T('🏠 Mortgage'), name: T('Home mortgage'), kind: 'expense', cat: ['mortgage'], frequency: 'monthly', installments: 240 },
  { label: T('🔑 Rent'), name: T('Rent'), kind: 'expense', cat: ['home'], frequency: 'monthly' },
  { label: T('🛋️ Furniture loan'), name: T('Furniture loan'), kind: 'expense', cat: ['home'], frequency: 'monthly', installments: 24 },
  { label: T('🚗 Car loan'), name: T('Car loan'), kind: 'expense', cat: ['transport'], frequency: 'monthly', installments: 48 },
  { label: T('💡 Bill'), name: T('Electricity/gas bill'), kind: 'expense', cat: ['utilities'], frequency: 'bimonthly' },
  { label: T('📺 Subscription'), name: T('Subscription'), kind: 'expense', cat: ['subscriptions'], frequency: 'monthly' },
  { label: T('🛡️ Insurance'), name: T('Insurance'), kind: 'expense', cat: ['bank'], frequency: 'yearly' },
  { label: T('💼 Salary'), name: T('Salary'), kind: 'income', cat: ['salary'], frequency: 'monthly' },
  { label: T('🐷 Automatic savings'), name: T('Savings deposit'), kind: 'transfer', frequency: 'monthly' },
];

function recurringModal(r = null) {
  const x = r || { kind: 'expense', frequency: 'monthly', start_date: todayIso(), account_id: activeAccounts()[0]?.id };
  const m = openModal(r ? T('Edit recurring item') : T('New recurring item'), `
    ${r ? '' : `<div class="presets">${PRESETS.map((p, i) => `<button type="button" data-p="${i}">${p.label}</button>`).join('')}</div>`}
    <div class="seg" id="r-kind" style="margin-bottom:16px">${Object.entries(KIND_LABEL).map(([k, l]) => `<button type="button" data-kind="${k}">${l}</button>`).join('')}</div>
    <div class="form-grid">
      <label class="field">${T('Name')} <input id="r-name" maxlength="80" value="${esc(x.name || '')}" placeholder="${esc(T('E.g. Home mortgage'))}" autofocus>${r ? '' : '<span id="r-sugg-note" class="sugg-note hidden"></span>'}</label>
      <label class="field">${T('Amount per payment')} <input id="r-amount" inputmode="decimal" value="${moneyInput(x.amount)}" placeholder="0,00"></label>
      <label class="field">${T('Frequency')} <select id="r-freq">${Object.entries(FREQ).map(([k, l]) => `<option value="${k}" ${x.frequency === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">${T('First due date')} <input id="r-start" type="date" value="${esc(x.start_date)}"></label>
      ${r && !r.expected && r.next_date ? `<label class="field">${T('Next due date')} <input id="r-next" type="date" value="${esc(r.next_date)}" min="${todayIso()}">
        <span class="muted small">${T('Change it to move this due date and all the following ones (e.g. from the 15th to the 18th); the payments already recorded stay as they are.')}</span></label>` : ''}
      <label class="field"><span id="r-acc-label">${T('Account')}</span><select id="r-account">${accountOptions(x.account_id)}</select></label>
      <div class="field full" id="r-where-wrap">${T('Where does the money go?')}
        <div class="seg" id="r-where"><button type="button" data-where="here">${T('To an account of this space')}</button><button type="button" data-where="other">${T('To another space')}</button></div>
        <span class="muted small hidden" id="r-where-help">${T('It is one recurring item, shown in that space too (read-only there). When you save, HomeCoin looks for the same money already recorded in both spaces and proposes what to merge.')}</span></div>
      <label class="field" id="r-to-wrap">${T('To account')} <select id="r-to">${transferOptions(x.to_account_id || activeAccounts()[1]?.id)}</select></label>
      <label class="field" id="r-cat-wrap">${T('Category')} <select id="r-cat"></select></label>
      <div class="field full var-box" id="r-var-wrap">
        <label class="check"><input type="checkbox" id="r-var" ${x.expected ? 'checked' : ''}> <b>${T('Variable amount and date')}</b>
          <span class="muted small">${T('(e.g. salary, commissions, usage-based bills)')}</span></label>
        <div id="r-var-help" class="muted small">${T('HomeCoin <b>does not record</b> transactions on its own: when the real one arrives (entered or imported) it links it to this recurring item if the description contains the keyword and the amount is plausible. The amount and day expected in the Calendar are the median of recent payments; the typical amount applies only until there are any, or always if you tick the option below. If it is more than a week late, you get a warning.')}
          <label class="field" style="margin-top:8px">${T('Keyword in the description')} <input id="r-match" maxlength="60" value="${esc(x.match_text || '')}" placeholder="${esc(T('E.g. the employer\'s name (empty = the recurring item\'s name)'))}"></label>
          <label class="check" style="margin-top:4px"><input type="checkbox" id="r-fixed" ${x.amount_fixed ? 'checked' : ''}> <b>${T('Always expect the typical amount')}</b>
            <span class="muted small">${T('instead of the median of recent payments')}${x.expected_median ? ` (${T('currently {amount}', { amount: money(x.expected_median) })})` : ''}: ${T('useful after an increase or a change, until the median catches up')}</span></label>
          <span>${T('To also link past transactions, set the first due date a few months back.')}</span></div></div>
      <label class="field full hidden" id="r-pac-wrap">${T('Investment plan: each contribution automatically buys units of')}
        <select id="r-pac"><option value="">— ${T('no automatic purchase (transfer only)')}</option></select>
        <span class="muted small">${T('Units are calculated from the amount and the last known price; the trade can still be edited in Investments. Without a known price the purchase goes among those "to complete".')}</span></label>
      <label class="field">${T('Number of installments')} <input id="r-inst" type="number" min="1" value="${x.installments || ''}" placeholder="${esc(T('Empty = no end'))}"></label>
      <label class="field">${T('Amount financed')} <input id="r-principal" inputmode="decimal" value="${moneyInput(x.principal)}" placeholder="${esc(T('Optional (for the interest calculation)'))}"></label>
      <div class="field full rate-box"><span>${T('Loan interest rate')} <span class="muted small">${T('(for the amortization schedule; excluding APR and additional costs)')}</span></span>
        <div class="rate-grid">
          <label class="field">${T('Repayment')} <select id="r-amort" title="${esc(T('How each installment is made up'))}">${[['french', T('Constant installment (French)')], ['constant', T('Constant principal (Italian, SAC)')]].map(([k, l]) =>
            `<option value="${k}" ${(x.amortization || 'french') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">${T('Type')} <select id="r-rtype">${[['', T('— not specified')], ['fixed', T('Fixed')], ['variable', T('Variable')], ['mixed', T('Mixed')]].map(([k, l]) =>
            `<option value="${k}" ${(x.rate_type || (x.rate != null ? 'fixed' : '')) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field" data-rt="fixed mixed">${T('Fixed rate (%)')} <input id="r-rate" inputmode="decimal" value="${decInput(x.rate)}" placeholder="3"></label>
          <label class="field" data-rt="mixed">${T('Fixed for (years)')} <input id="r-fyears" type="number" min="1" max="40" value="${x.fixed_years ?? ''}" placeholder="5" title="${esc(T('e.g. 5 for a 5/1 ARM'))}"></label>
          <label class="field" data-rt="variable mixed">${T('Index')} <select id="r-index">${rateIndexOptions(x.rate_index).map((i) =>
            `<option ${(x.rate_index || defaultRateIndex()) === i ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select></label>
          <label class="field" data-rt="variable mixed">${T('Spread / margin (%)')} <input id="r-spread" inputmode="decimal" value="${decInput(x.spread)}" placeholder="${decInput(1.6)}"></label>
          <label class="field" data-rt="variable mixed">${T('Current index value (%)')} <input id="r-ivalue" inputmode="decimal" value="${decInput(x.index_value)}" placeholder="${esc(T('optional'))}"></label>
        </div></div>
      <label class="field">${T('Ends on')} <input id="r-end" type="date" value="${esc(x.end_date || '')}"></label>
      <label class="field full">${T('Notes')} <textarea id="r-notes" maxlength="1000">${esc(x.notes || '')}</textarea></label>
      ${r ? '' : `<label class="check full"><input type="checkbox" id="r-past"> ${T('Also record past due dates as transactions')}
        <span class="muted small">${T('(otherwise they are only counted as paid)')}</span></label>`}
    </div>
    <div class="modal-foot">${r ? `<button class="btn btn-ghost left neg" id="r-del">🗑 ${T('Delete')}</button>` : ''}
      <button class="btn" data-cancel>${T('Cancel')}</button><button class="btn btn-primary" id="r-save">${T('Save')}</button></div>`, { wide: true });

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
    $('#r-pac', m).innerHTML = `<option value="">— ${T('no automatic purchase (transfer only)')}</option>` +
      hs.map((h) => `<option value="${h.id}" ${h.id === x.holding_id ? 'selected' : ''}>${esc(h.ticker)} · ${esc(h.name)}${h.asset_class === 'monetario' ? ' (money market)' : ''}</option>`).join('');
  };
  $('#r-to', m).addEventListener('change', drawPac);
  // a transfer: within this space, or to another space (one recurring item seen in both, reconciled when saved)
  const otherSpace = (id) => { const a = S.allAccounts.find((y) => y.id === +id); return !!a && a.portfolio_id !== S.pid; };
  let where = otherSpace(x.to_account_id) ? 'other' : 'here';
  const drawWhere = () => {
    $$('#r-where button', m).forEach((b) => b.classList.toggle('on', b.dataset.where === where));
    $('#r-where-help', m).classList.toggle('hidden', where !== 'other');
    const keep = $('#r-to', m).value;
    $('#r-to', m).innerHTML = transferOptions(keep);
    $$('#r-to optgroup', m).forEach((g) => { if ((+g.dataset.space === S.pid) === (where === 'other')) g.remove(); });
    if (!$('#r-to', m).value || otherSpace($('#r-to', m).value) !== (where === 'other')) $('#r-to', m).selectedIndex = 0;
    drawPac();
  };
  $$('#r-where button', m).forEach((b) => (b.onclick = () => { where = b.dataset.where; drawWhere(); }));
  const draw = (cat) => {
    $$('#r-kind button', m).forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
    drawPac();
    $('#r-where-wrap', m).classList.toggle('hidden', kind !== 'transfer' || S.portfolios.filter((p) => !p.archived).length < 2);
    $('#r-to-wrap', m).classList.toggle('hidden', kind !== 'transfer');
    $('#r-cat-wrap', m).classList.toggle('hidden', kind === 'transfer');
    $('#r-acc-label', m).textContent = kind === 'transfer' ? T('From account') : T('Account');
    $('#r-cat', m).innerHTML = kind === 'transfer' ? '' : categoryOptions(kind, cat ?? $('#r-cat', m).value ?? x.category_id);
    syncVar();
  };
  // variable amount: only income and expenses without installments; hides what is not needed (installments, rate, record past)
  const syncVar = () => {
    const can = kind !== 'transfer' && !$('#r-inst', m).value;
    $('#r-var-wrap', m).classList.toggle('hidden', !can);
    const on = can && $('#r-var', m).checked;
    $('#r-var-help', m).classList.toggle('hidden', !on);
    $('#r-amount', m).closest('label').firstChild.textContent = on ? T('Typical amount ') : T('Amount per payment ');
    ['#r-inst', '#r-principal'].forEach((s) => $(s, m).closest('label').classList.toggle('hidden', on));
    $('.rate-box', m).classList.toggle('hidden', on);
    $('#r-past', m)?.closest('label').classList.toggle('hidden', on);
    if ($('#r-amort', m)) syncAmortSoon();
  };
  const syncAmortSoon = () => setTimeout(() => $('#r-amort', m)?.dispatchEvent(new Event('change')), 0);
  $('#r-var', m).onchange = syncVar;
  $('#r-inst', m).addEventListener('input', syncVar);
  $$('#r-kind button', m).forEach((b) => (b.onclick = () => { kind = b.dataset.kind; draw(); }));
  draw(x.category_id);
  drawWhere();
  $$('[data-p]', m).forEach((b) => (b.onclick = () => {
    const p = PRESETS[+b.dataset.p];
    kind = p.kind;
    $('#r-name', m).value = p.name;
    $('#r-freq', m).value = p.frequency;
    $('#r-inst', m).value = p.installments || '';
    draw([].concat(p.cat || []).map((n) => S.categories.find((c) => c.code === n && c.kind === p.kind)).find(Boolean)?.id || '');
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
          if (s.to_account_id && otherSpace(s.to_account_id) !== (where === 'other')) { where = otherSpace(s.to_account_id) ? 'other' : 'here'; drawWhere(); }
          if (s.to_account_id && $(`#r-to option[value="${s.to_account_id}"]`, m)) { $('#r-to', m).value = s.to_account_id; markSuggested($('#r-to', m)); drawPac(); }
          if (s.amount && !$('#r-amount', m).value) { $('#r-amount', m).value = moneyInput(s.amount); markSuggested($('#r-amount', m)); }
          const n = $('#r-sugg-note', m);
          n.textContent = T('✨ Filled in like the last transaction: check the first due date and the frequency');
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
  // constant principal: every installment is different, so the amount comes from the schedule
  const constantOn = () => $('#r-amort', m).value === 'constant' && !$('.rate-box', m).classList.contains('hidden');
  const syncAmort = () => {
    const on = constantOn(), a = $('#r-amount', m);
    a.disabled = on;
    if (on) a.value = '';
    a.placeholder = on ? T('Calculated from the schedule') : '0,00';
    $('#r-principal', m).placeholder = on ? T('Required for constant principal') : T('Optional (for the interest calculation)');
  };
  $('#r-amort', m).onchange = syncAmort; syncAmort();
  $('[data-cancel]', m).onclick = closeModal;
  $('#r-save', m).onclick = async () => {
    const constant = constantOn();
    const amount = constant ? null : parseMoney($('#r-amount', m).value);
    if (constant && (kind !== 'expense' || !$('#r-inst', m).value || !parseMoney($('#r-principal', m).value))) {
      toast(T('Constant principal needs an expense with the number of installments and the amount financed'), 'err'); return;
    }
    if (!constant && (!amount || Number.isNaN(amount))) { toast(T('Enter the amount'), 'err'); return; }
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
      next_date: r && $('#r-next', m)?.value && $('#r-next', m).value !== r.next_date ? $('#r-next', m).value : null,
      holding_id: kind === 'transfer' && !$('#r-pac-wrap', m).classList.contains('hidden') && $('#r-pac', m).value ? +$('#r-pac', m).value : null,
      expected: !$('#r-var-wrap', m).classList.contains('hidden') && $('#r-var', m).checked, match_text: $('#r-match', m).value.trim(),
      amount_fixed: $('#r-fixed', m).checked, amortization: constant ? 'constant' : 'french',
    };
    if (body.expected) Object.assign(body, { installments: null, principal: null, rate_type: null, rate: null, post_past: false, amortization: 'french' });
    try {
      const res = await api(r ? `/recurring/${r.id}` : '/recurring', { method: r ? 'PUT' : 'POST', body });
      toast(res.created ? `${T('Recurring item saved')} · ${tn('{n} transaction recorded', '{n} transactions recorded', res.created)}` : T('Recurring item saved'));
      closeModal();
      // a recurring transfer to another space: propose the same money already recorded in other ways (if any)
      const saved = { ...body, id: r ? r.id : res.id };
      if (toOtherSpace(saved)) await reconcileModal(saved.id, { quiet: true });
      // a new item whose first due dates have already passed: propose the payments already recorded for them
      else if (!r && !body.post_past && body.start_date <= todayIso()) await linkModal(saved, { quiet: true });
      refresh();
    } catch (e) { fail(e); }
  };
  if (r) $('#r-del', m).onclick = async () => {
    // variable amount: the linked transactions are the real ones (imported or entered), so they always stay
    const mm = openModal(T('Delete the recurring item?'), r.expected
      ? `<p>${T('You are about to delete <b>{name}</b>.', { name: esc(r.name) })} ${tn('The {n} linked transaction is a real one and <b>is kept</b>: it is only unlinked.',
        'The {n} linked transactions are the real ones and <b>are kept</b>: they are only unlinked.', r.recorded)}</p>
        <div class="modal-foot"><button class="btn" data-no>${T('Cancel')}</button><button class="btn btn-danger" data-keep>${T('Delete the recurring item')}</button></div>`
      : `<p>${T('You are about to delete <b>{name}</b>.', { name: esc(r.name) })} ${T('What should happen to the transactions already recorded?')}</p>
      <div class="modal-foot"><button class="btn" data-no>${T('Cancel')}</button><button class="btn" data-keep>${T('Keep the transactions')}</button>
      <button class="btn btn-danger" data-all>${T('Delete the transactions too')}</button></div>`);
    const go = async (all) => { try { await api(`/recurring/${r.id}${all ? '?with_transactions=1' : ''}`, { method: 'DELETE' }); toast(T('Recurring item deleted')); closeModal(); refresh(); } catch (e) { fail(e); } };
    $('[data-no]', mm).onclick = closeModal;
    $('[data-keep]', mm).onclick = () => go(false);
    $('[data-all]', mm)?.addEventListener('click', () => go(true));
  };
}

// ================================================================ import
async function renderImport(v) {
  const I = S.imp;
  const steps = [T('Upload file'), T('Columns'), T('Review'), T('Done')];
  const stepper = `<div class="steps">${steps.map((s, i) => `<div class="step ${I.step === i + 1 ? 'on' : I.step > i + 1 ? 'done' : ''}"><i>${I.step > i + 1 ? '✓' : i + 1}</i>${s}</div>`).join('')}</div>`;

  if (I.step === 1) {
    v.innerHTML = `${stepper}
      <div class="grid-3-2"><div class="card">
        <label class="dropzone" id="drop"><input type="file" id="file" accept=".csv,.txt,.tsv,.xlsx,.xlsm" hidden>
          <div class="big">📥</div><h3>${T('Drag your bank statement here')}</h3><p class="muted">${T('or click to choose a file · CSV, TXT, XLSX')}</p></label>
        ${AUTH.status?.demo ? `<div style="text-align:center;margin-top:12px"><button class="btn btn-sm" id="imp-sample">🧪 ${T('Try it with a sample bank statement')}</button></div>` : ''}
      </div>
      <div class="card"><div class="card-head"><h3>${T('How it works')}</h3></div><div class="list">
        <div class="list-item"><div class="cat-ico" style="--c:#6366f1">1️⃣</div><div class="grow">${T('Export your transactions from online banking as <b>CSV or Excel</b>.')}</div></div>
        <div class="list-item"><div class="cat-ico" style="--c:#8b5cf6">2️⃣</div><div class="grow">HomeCoin <b>${T('recognizes the columns')}</b> ${T('(date, description, amount or money in/out).')}</div></div>
        <div class="list-item"><div class="cat-ico" style="--c:#ec4899">3️⃣</div><div class="grow">${T('Categories are <b>filled in automatically</b> from rules and history, and <b>duplicates</b> are flagged.')}</div></div>
        <div class="list-item"><div class="cat-ico" style="--c:#10b981">🔒</div><div class="grow">${T('The file is processed only on your PC.')}</div></div>
      </div></div></div>`;
    const drop = $('#drop'), input = $('#file');
    const upload = async (file) => {
      if (!file) return;
      const fd = new FormData(); fd.append('file', file);
      drop.innerHTML = `<div class="loading">${T('Reading the file…')}</div>`;
      try {
        I.upload = await api('/import/upload', { method: 'POST', body: fd });
        I.mapping = { ...I.upload.mapping };
        I.dateOrder = I.upload.date_order; I.dateOrderSource = I.upload.date_order_source;
        I.account_id = I.account_id || activeAccounts()[0]?.id;
        I.invert = false; I.step = 2; route();
      } catch (e) { fail(e); route(); }
    };
    input.onchange = () => upload(input.files[0]);
    $('#imp-sample')?.addEventListener('click', async () => {  // demo: a made-up statement of the joint account
      try {
        const blob = await fetch('/api/demo/statement.csv', { headers: { 'X-HomeCoin': '1' } }).then((r) => { if (!r.ok) throw new Error(T('Sample not available')); return r.blob(); });
        upload(new File([blob], 'sample-bank-statement.csv', { type: 'text/csv' }));
      } catch (e) { fail(e); }
    });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => upload(e.dataTransfer.files[0]));
    return;
  }

  if (I.step === 2) {
    const u = I.upload;
    const fields = [['date', T('📅 Date *')], ['description', T('📝 Description')], ['amount', T('💶 Amount (signed)')], ['debit', T('📤 Money out / Debits')], ['credit', T('📥 Money in / Credits')], ['sign', T('↕ Money in/out indicator (e.g. Af/Bij, S/H)')], ['category', T('🏷️ Category')]];
    const opt = (sel) => `<option value="">— ${T('none')} —</option>` + u.headers.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h)}</option>`).join('');
    const mapped = new Set(Object.values(I.mapping).filter((x) => x != null));
    v.innerHTML = `${stepper}
      <div class="card" style="margin-bottom:18px"><div class="card-head"><h3>📄 ${esc(u.filename)}</h3><span class="muted">${tn('{n} row found', '{n} rows found', u.total)}</span></div>
        <div class="map-grid">${fields.map(([k, l]) => `<label class="field">${l}<select data-map="${k}">${opt(I.mapping[k])}</select></label>`).join('')}</div>
        <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
          <label class="field">${T('Import into account')} <select id="i-acc">${accountOptions(I.account_id)}</select></label>
          <label class="field">${T('Date format')} <select id="i-dord">${[['dmy', T('Day / month / year (31/12/2026)')], ['mdy', T('Month / day / year (12/31/2026)')]].map(([k, l]) => `<option value="${k}" ${I.dateOrder === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <span class="muted small" id="i-dord-note">${I.dateOrderSource === 'file' ? T('Recognized from the dates in the file') : T('The dates in the file fit both: check that this is right')}</span></label>
          <label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="i-inv" ${I.invert ? 'checked' : ''}> ${T('Invert the sign (e.g. credit card statements)')}</label>
        </div>
        <p class="muted small">${T('Use <b>Amount</b> if the file has a single column with positive/negative values, or <b>Money out</b> + <b>Money in</b> if they are separate.')}</p>
      </div>
      <div class="card" style="padding:8px"><div class="table-wrap"><table class="preview-table"><thead><tr>${u.headers.map((h, i) => `<th class="${mapped.has(i) ? 'mapped' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${u.preview.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="modal-foot"><button class="btn" id="i-back">← ${T('Another file')}</button><button class="btn btn-primary" id="i-next">${T('Analyze transactions →')}</button></div>`;
    $$('[data-map]').forEach((s) => (s.onchange = async () => {
      I.mapping[s.dataset.map] = s.value === '' ? null : +s.value;
      if (s.dataset.map !== 'date') return;
      try {  // another date column: recognize its day/month order again
        const r = await api('/import/date-order', { method: 'POST', body: { token: u.token, column: I.mapping.date } });
        I.dateOrder = r.date_order; I.dateOrderSource = r.date_order_source;
        $('#i-dord').value = I.dateOrder;
        $('#i-dord-note').textContent = I.dateOrderSource === 'file' ? T('Recognized from the dates in the file') : T('The dates in the file fit both: check that this is right');
      } catch (e) { fail(e); }
    }));
    $('#i-dord').onchange = (e) => { I.dateOrder = e.target.value; I.dateOrderSource = 'user'; $('#i-dord-note').textContent = ''; };
    $('#i-acc').onchange = (e) => (I.account_id = +e.target.value);
    $('#i-inv').onchange = (e) => (I.invert = e.target.checked);
    $('#i-back').onclick = () => { I.step = 1; route(); };
    $('#i-next').onclick = async () => {
      try {
        const res = await api('/import/analyze', { method: 'POST', body: { token: u.token, mapping: I.mapping, account_id: I.account_id, invert: I.invert, date_order: I.dateOrder || 'dmy' } });
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
      $('#i-sum').innerHTML = `<span class="chip">✅ ${tn('<b>{n}</b> to import', '<b>{n}</b> to import', inc.length)}</span>
        <span class="chip">♻️ ${tn('<b>{n}</b> duplicate', '<b>{n}</b> duplicates', rows.filter((r) => r.duplicate).length)}</span>
        <span class="chip">⚠️ ${tn('<b>{n}</b> invalid', '<b>{n}</b> invalid', rows.filter((r) => r.error).length)}</span>
        <span class="chip">❔ ${tn('<b>{n}</b> uncategorized', '<b>{n}</b> uncategorized', inc.filter((r) => !r.category_id).length)}</span>
        <span class="chip">📥 <b class="pos">${money(inc.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0))}</b></span>
        <span class="chip">📤 <b class="neg">${money(inc.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amount, 0))}</b></span>`;
      $('#i-go').textContent = `${T('Import')} ${inc.length} transactions`;
      $('#i-go').disabled = !inc.length;
    };
    v.innerHTML = `${stepper}
      <div class="toolbar"><div class="summary-chips" id="i-sum" style="margin:0"></div></div>
      <div class="card" style="padding:6px 8px"><div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="review-table">
        <thead><tr><th><input type="checkbox" id="i-all" checked></th><th>${T('Date')}</th><th>${T('Description')}</th><th class="right">${T('Amount')}</th><th>${T('Category')}</th><th></th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr data-i="${i}" class="${r.duplicate ? 'dup' : ''} ${r.include ? '' : 'excluded'}">
          <td><input type="checkbox" ${r.include ? 'checked' : ''} ${r.error ? 'disabled' : ''}></td>
          <td class="num small">${r.date ? fmtDate(r.date) : '—'}</td>
          <td><div class="desc" title="${esc(r.description)}">${esc(r.description || '—')}</div></td>
          <td class="amount ${r.kind}">${r.amount ? signedAmount(r) : '—'}</td>
          <td>${r.error ? '' : `<select data-cat>${categoryOptions(r.kind, r.category_id, T('❔ Uncategorized'))}</select>`}</td>
          <td>${r.error ? `<span class="tag err">${esc(r.error)}</span>` : ''}${r.duplicate ? `<span class="tag warn">${T('already present')}</span>` : ''}
            ${r.category_source && r.category_source !== 'file' ? `<span class="tag ai" title="${esc(T('Category suggested automatically'))}">✨ ${esc({ regola: 'rule', storico: 'history' }[r.category_source] || r.category_source)}</span>` : ''}</td></tr>`).join('')}</tbody>
      </table></div></div>
      <div class="modal-foot"><button class="btn" id="i-back">← ${T('Columns')}</button><button class="btn btn-primary" id="i-go"></button></div>`;
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
        if (n) toast(tn('Category also applied to {n} other identical transaction', 'Category also applied to {n} other identical transactions', n), 'info');
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

  v.innerHTML = `${stepper}<div class="card empty"><div class="big">🎉</div><h3>${tn('{n} transaction imported', '{n} transactions imported', I.result)}</h3>
    <p>${T('You can assign the missing categories from the Transactions page by filtering for “To categorize”.')}</p>
    <div class="actions"><a class="btn btn-primary" href="#/movimenti?category_id=none">${T('View uncategorized')}</a><a class="btn" href="#/dashboard">${T('Dashboard')}</a><button class="btn" id="i-again">${T('Import another file')}</button></div></div>`;
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
        ${pastYears.slice().reverse().map((y) => `<option value="y:${y}" ${R.period === `y:${y}` ? 'selected' : ''}>${T('Year')} ${y}</option>`).join('')}
        <option value="all" ${R.period === 'all' ? 'selected' : ''}>${T('All')}</option></select>
      <span class="muted small">${esc(fmtDate(data.from))} → ${esc(fmtDate(data.to))}</span>
      <div class="seg" id="r-tab"><button data-t="expense" class="${tab === 'expense' ? 'on' : ''}">📤 ${T('Expenses')}</button><button data-t="income" class="${tab === 'income' ? 'on' : ''}">📥 ${T('Income')}</button>${hasOther ? `<button data-t="other" class="${tab === 'other' ? 'on' : ''}">↗ ${T('Other spaces')}</button>` : ''}</div>
      ${data.excluded ? `<a class="chip small" href="#/movimenti?excluded=1&${range}" title="${esc(T('Not counted in the report'))}">🙈 ${tn('{n} excluded', '{n} excluded', data.excluded)}</a>` : ''}
      <span class="spacer"></span>
      <a class="btn btn-sm" href="/api/export/report?${range}&pf=${S.pid}">⬇ ${T('Excel report')}</a>
      <a class="btn btn-sm" href="/api/export/transactions?format=xlsx&${range}&pf=${S.pid}">⬇ ${T('Transactions')}</a>
    </div>
    <div class="kpis">
      <div class="kpi g-emerald"><div class="k-label">📥 ${T('Income ·')} ${esc(label)}</div><div class="k-value">${money(inflow)}</div>
        ${tin ? kRows([`💼 ${T('Income')}`, money(inc), 'href="#/report" data-t="income"'], [`↙ ${T('From other spaces')}`, money(tin), `href="#/movimenti?${qs({ kind: 'transfer', from: data.from, to: data.to })}"`])
          : kRows([`📅 ${T('Per month')}`, money0(inflow / (data.months.length || 1))])}</div>
      <div class="kpi g-rose"><div class="k-label">📤 ${T('Money out ·')} ${esc(label)}</div><div class="k-value">${money(exp + other)}</div>
        ${other ? kRows([`🛒 ${T('Spending')}`, money(exp), 'href="#/report" data-t="expense"'], [`↗ ${T('To other spaces')}`, money(other), 'href="#/report" data-t="other"'])
          : kRows([`📅 ${T('Per month')}`, money0((exp + other) / (data.months.length || 1))])}</div>
      <div class="kpi g-amber"><div class="k-label">🐷 ${T('Savings')}</div><div class="k-value">${money(saved)}</div>${kRows(inflow && [`📊 ${T('Savings rate')}`, pct(saved / inflow)])}</div>
      <div class="kpi g-rose"><div class="k-label">📊 ${T('Average monthly spending')}</div><div class="k-value">${money(exp / monthsWithData)}</div>${kRows([`📅 ${T('Months with expenses')}`, monthsWithData])}</div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <div class="card-head"><div><h3>${{ expense: T('Expenses'), income: T('Income'), other: T('Contributions to other spaces') }[tab]} ${single ? T('by category') : T('by month and category')}</h3>
        <p class="muted small" style="margin:3px 0 0">${single ? T('Amount per category in the month') : `${T('Total above each bar · dashed line = monthly average ({amount})', { amount: money0(d.total / (d.months.filter((x) => x > 0).length || 1)) })} · ${T('hover over a bar for details')}`}</p></div></div>
      <div class="chart-legend-wrap ${single ? 'single' : ''}">
        <div class="chart-box tall"><canvas id="c-stack"></canvas></div>
        ${single ? '' : '<div class="chart-legend" id="r-legend"></div>'}
      </div></div>
    <div class="card" style="padding:8px"><div class="table-wrap"><table class="heat">
      <thead><tr><th>${T('Category')}</th>${single ? '' : data.months.map((mm) => `<th class="right">${fmtMonth(mm)}</th>`).join('')}<th class="right">${T('Total')}</th><th class="right">%</th></tr></thead>
      <tbody>${d.rows.map((r) => {
        const cat = r.transfer ? { kind: 'transfer', excluded: 0 } : { category_id: r.id ?? 'none', kind: tab === 'income' ? 'income' : 'expense', excluded: 0 };
        const whole = txLink({ ...cat, from: data.from, to: data.to }, T('{name} transactions in the period', { name: r.name }));
        return `<tr><td><span class="pill quick-filter" style="--c:${esc(r.color)}" ${whole}>${esc(r.icon)} ${esc(r.name)}</span></td>
        ${single ? '' : r.months.map((x, i) => x ? `<td style="${heat(x, r.color)}" ${txLink({ ...cat, ...monthBounds(data.months[i]) }, `${T('Transactions')} ${r.name} · ${fmtMonth(data.months[i])}`)}>${money0(x)}</td>` : '<td><span class="muted">·</span></td>').join('')}
        <td class="tot" ${single ? `style="${heat(r.total, r.color)}"` : ''} ${whole}>${money(r.total)}</td><td class="muted">${d.total ? pct(r.total / d.total) : ''}</td></tr>`;
      }).join('') || `<tr><td colspan="${data.months.length + 3}"><div class="empty">${T('No data in the period')}</div></td></tr>`}</tbody>
      <tfoot><tr><td>${T('Total')}</td>${single ? '' : d.months.map((x, i) => x ? `<td ${txLink({ kind: tab === 'income' ? 'income' : 'expense',excluded: 0, ...monthBounds(data.months[i]) }, `${T('All transactions ·')} ${fmtMonth(data.months[i])}`)}>${money0(x)}</td>` : '<td>·</td>').join('')}<td ${txLink({ kind: tab === 'income' ? 'income' : 'expense',excluded: 0, from: data.from, to: data.to })}>${money(d.total)}</td><td></td></tr></tfoot>
    </table></div></div>`;

  $('#r-period').onchange = (e) => { R.period = e.target.value; route(); };
  $$('#r-tab button, .k-split [data-t]', v).forEach((b) => (b.onclick = (e) => { e.preventDefault(); S.reportTab = b.dataset.t; route(); }));

  if (d.rows.length) drawReportChart(data, d, single, tab);
}

// compact amounts for axes and labels: 950 €, 1,2K €, 12K € · $950, $1.2K, $12K · CHF 1.2K · R$ 1,2K (symbol where the currency puts it)
const moneyK = (c) => {
  if (Math.abs(c) < 100000) return money0(c);
  const k = `${(Math.abs(c) / 100000).toLocaleString(LOCALE, { maximumFractionDigits: Math.abs(c) >= 1000000 ? 0 : 1 })}K`;
  const sym = MONEY.formatToParts(1).find((p) => p.type === 'currency').value;
  const gap = /\s/.test(MONEY.formatToParts(1).find((p) => p.type === 'literal')?.value || '') ? ' ' : '';
  return (c < 0 ? '-' : '') + (SYM_FIRST ? `${sym}${gap}${k}` : `${k}${gap || ' '}${sym}`);
};

function drawReportChart(data, d, single, tab) {
  const surface = css('--surface'), ink = css('--text'), muted = css('--muted');
  const font = { family: css('--font'), size: 12, weight: '600' };
  const base = { kind: tab === 'income' ? 'income' : 'expense',excluded: 0 };

  if (single) {  // a single month: horizontal bars per category, value at the tip
    chart($('#c-stack'), {
      type: 'bar',
      data: { labels: d.rows.map((r) => `${r.icon}  ${r.name}`), datasets: [{ label: T('Total'), data: d.rows.map((r) => r.total), backgroundColor: d.rows.map((r) => r.color), borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'start', maxBarThickness: 22 }] },
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
  if (rest.length) series.push({ name: tn('{n} other category', '{n} other categories', rest.length), color: '#a8adc2', months: data.months.map((_, i) => rest.reduce((s, r) => s + r.months[i], 0)), total: rest.reduce((s, r) => s + r.total, 0), others: rest });
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
            footer: (items) => `${T('Total')}  ${money(visibleTotal(items[0].dataIndex))}`,
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
  lg.innerHTML = series.map((s, j) => `<button type="button" class="lg-item" data-j="${j}" title="${s.others ? esc(s.others.map((o) => o.name).join(', ')) : T('Click to show/hide')}">
      <span class="lg-sw" style="background:${esc(s.color)}"></span>
      <span class="lg-name">${esc(s.name)}</span>
      <span class="lg-val">${money0(s.total)}</span><span class="lg-pct">${pct(s.total / d.total)}</span></button>`).join('')
    + `<div class="lg-total"><span>${T('Period total')}</span><b>${money0(d.total)}</b></div>`;
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
const SPLIT_RULES = [['prop', T('⚖️ Proportional'), T('Based on income')], ['equal', T('½ Split equally'), T('Same amount for everyone')], ['none', T('🚫 Excluded'), T('Not a shared expense')]];

async function renderRipartizione(v) {
  let state = await api('/split');
  const cfg = () => ({
    people: $$('.sp-person', v).map((row) => ({
      id: row.dataset.id ? +row.dataset.id : null, name: $('[data-f=name]', row).value.trim(),
      income: parseMoney($('[data-f=income]', row).value) || 0, keyword: $('[data-f=keyword]', row).value.trim(),
      space_id: $('[data-f=space]', row).value ? +$('[data-f=space]', row).value : null,
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
  // snapshot: the values are read when they change, so a save that runs after the page was left still has them
  const save = async (extra = {}, snapshot = null) => {
    try {
      state = await api('/split', { method: 'PUT', body: { ...(snapshot || cfg()), ...extra } });
      if (!$('#sp-months')) return;  // page left meanwhile: saved, nothing to redraw
      syncIds(); drawResult();
    } catch (e) { fail(e); }
  };
  const saveLater = debounce((snapshot) => save({}, snapshot), 600);
  const saveSoon = () => saveLater(cfg());
  const s = state.settings;

  // the space whose name contains the person's name (or the other way round): proposed as theirs
  const guessSpace = (name) => {
    const n = (name || '').trim().toLowerCase();
    if (n.length < 2) return null;
    return state.spaces.find((sp) => { const s = sp.name.toLowerCase(); return s.includes(n) || n.includes(s); })?.id ?? null;
  };
  const spaceSelect = (p) => {
    const taken = new Set(state.people.filter((x) => x.id !== p.id && x.space_id).map((x) => x.space_id));
    const guess = p.space_id ? null : guessSpace(p.name);
    const sel = p.space_id || guess;
    return `<select data-f="space" class="${guess && !taken.has(guess) ? 'suggested' : ''}" title="${esc(T('Their own space in HomeCoin: every transfer from it counts as theirs'))}">
      <option value="">${T('— none')}</option>
      ${state.spaces.map((sp) => `<option value="${sp.id}" ${sel === sp.id && !(guess && taken.has(guess)) ? 'selected' : ''} ${taken.has(sp.id) ? 'disabled' : ''}>${esc(sp.icon)} ${esc(sp.name)}${guess === sp.id ? ` (${T('suggested from the name')})` : ''}</option>`).join('')}</select>`;
  };
  const personRow = (p = {}) => `<div class="sp-person" data-id="${p.id ?? ''}">
      <input data-f="name" maxlength="40" placeholder="${esc(T('Name'))}" value="${esc(p.name ?? '')}">
      <input data-f="income" inputmode="decimal" placeholder="${esc(T('Net monthly income'))}" value="${p.income ? moneyInput(p.income) : ''}">
      ${spaceSelect(p)}
      <input data-f="keyword" maxlength="40" placeholder="${esc(p.name || T('Word in contributions'))}" value="${esc(p.keyword ?? '')}" title="${esc(T('Word that recognizes this person\'s contributions in the description of the incomes (e.g. the name as it appears on bank transfers). Empty = their name.'))}">
      <button class="icon-btn sm" data-del-person title="${esc(T('Remove'))}">✕</button></div>`;

  const manualRow = (it = {}) => `<div class="sp-mrow">
      <input data-m="name" maxlength="60" placeholder="${esc(T('Item (e.g. Mortgage, Groceries, Unexpected)'))}" value="${esc(it.name ?? '')}">
      <select data-m="account">${state.accounts.map((a) => `<option value="${a.id}" ${+it.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <input data-m="amount" inputmode="decimal" placeholder="${esc(T('{symbol} / month', { symbol: CUR_SYM }))}" value="${it.amount ? moneyInput(it.amount) : ''}">
      <select data-m="rule">${SPLIT_RULES.map(([k, l]) => `<option value="${k}" ${(it.rule || 'prop') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="icon-btn sm" data-m-del title="${esc(T('Remove'))}">✕</button></div>`;
  const parseManual = () => { try { return JSON.parse(state.settings.split_manual || '[]'); } catch { return []; } };
  const BASE_LABEL = { expenses: T('Actual expenses (average)'), deposits: T('Actual contributions (average)'), manual: T('Amounts entered by hand') };

  v.innerHTML = `
    <div class="sp-intro card">
      <div class="sp-intro-ico">⚖️</div>
      <div><b>${T('How it works')}</b><p class="muted small" style="margin:4px 0 0">${T('HomeCoin calculates how much each person should pay into each account so that everyone <b>saves the same percentage of their income</b>.')}
        ${T('You can start from <b>actual expenses</b>, from the <b>contributions made so far</b> (total ÷ months) or from <b>amounts entered by hand</b>.')}
        ${T('Items <i>split equally</i> (e.g. a joint mortgage) are divided in half, <i>proportional</i> ones make up the difference; <i>excluded</i> ones are left out of the calculation.')}</p></div>
    </div>
    <div class="grid-3-2">
      <div class="card"><div class="card-head"><h3>👥 ${T('People and income')}</h3><button class="btn btn-sm" id="sp-add">＋ ${T('Person')}</button></div>
        <div class="sp-head muted small"><span>${T('Name')}</span><span>${T('Net income / month')}</span><span>${T('Their space')}</span><span>${T('Keyword')}</span><span></span></div>
        <div id="sp-people">${(state.people.length ? state.people : [{}, {}]).map(personRow).join('')}</div>
        <p class="muted small sp-help">${T('<b>With their own space</b> in HomeCoin, every transfer from that space counts as theirs: nothing else to set. <b>Without a space</b> (they pay from a bank that is not in HomeCoin), their incomes are recognized by the keyword in the description: their name if you leave it empty, so write it the way it appears on the bank transfers (e.g. "Anna" in "Transfer from ANNA ROSSI"). Check the result in <i>Contributions in the period</i> below, and correct any row by hand.')}</p></div>
      <div class="card"><div class="card-head"><h3>⚙️ ${T('Settings')}</h3></div>
        <div class="form-grid">
          <label class="field full">${T('Calculation basis')} <select id="sp-base">${Object.entries(BASE_LABEL).map(([k, l]) => `<option value="${k}" ${s.split_base === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">${T('Averaging period')} <select id="sp-months">${[3, 6, 12, 24].map((m) => `<option value="${m}" ${+s.split_months === m ? 'selected' : ''}>${tn('Last {n} full month', 'Last {n} full months', m)}</option>`).join('')}<option value="all" ${s.split_months === 'all' ? 'selected' : ''}>${T('Entire history')}</option></select></label>
          <label class="field">${T('Margin for unexpected costs (%)')} <input id="sp-margin" type="number" min="0" max="50" step="1" value="${esc(s.split_margin)}"></label>
          <label class="field">${T('Round contributions to')} <select id="sp-round">${[...new Set([...(CURRENCIES[CUR].steps || [1, 5, 10, 50]), +s.split_round])].sort((a, b) => a - b)
            .map((r) => `<option value="${r}" ${+s.split_round === r ? 'selected' : ''}>${esc(money0(r * 100))}</option>`).join('')}</select></label>
          <label class="field">${T('Minimum contribution (')}${CUR_SYM}) <input id="sp-min" type="number" min="0" step="${(CURRENCIES[CUR].steps || [1, 5])[1]}" value="${esc(s.split_minimum)}"></label>
        </div></div>
    </div>
    <div class="card" id="sp-manual" style="margin-bottom:18px"><div class="card-head"><div><h3>✏️ ${T('Amounts entered by hand')}</h3>
        <p class="muted small" style="margin:3px 0 0">${T('Monthly items to split, as in a spreadsheet: for each one, the account to pay into and the rule.')}</p></div>
        <div style="display:flex;gap:8px"><button class="btn btn-sm" id="sp-m-fill" title="${esc(T('Replaces the items with the actual averages per category'))}">⤵ ${T('Prefill from actual expenses')}</button><button class="btn btn-sm" id="sp-m-add">＋ ${T('Item')}</button></div></div>
      <div class="sp-mhead muted small"><span>${T('Item')}</span><span>${T('Account')}</span><span>${T('Amount / month')}</span><span>${T('Rule')}</span><span></span></div>
      <div id="sp-mrows">${parseManual().map(manualRow).join('')}</div>
      <p class="muted small" id="sp-m-total" style="margin:8px 0 0"></p></div>
    <div id="sp-result"></div>`;
  const syncBase = () => {
    const manual = $('#sp-base').value === 'manual';
    $('#sp-manual').classList.toggle('hidden', !manual);
    $('#sp-months').disabled = manual; $('#sp-margin').disabled = manual;
    if (manual && !$$('.sp-mrow', v).length) $('#sp-mrows').insertAdjacentHTML('beforeend', manualRow());
    $('#sp-m-total').textContent = T('Items total: {amount} per month', { amount: money(manualItems().reduce((t, x) => t + x.amount, 0)) });
  };
  syncBase();
  $('#sp-base').onchange = () => { syncBase(); save(); };
  $('#sp-m-add').onclick = () => { $('#sp-mrows').insertAdjacentHTML('beforeend', manualRow()); $('#sp-mrows .sp-mrow:last-child input').focus(); };
  $('#sp-mrows').addEventListener('input', () => { syncBase(); saveSoon(); });
  $('#sp-mrows').addEventListener('change', () => { syncBase(); saveSoon(); });
  $('#sp-mrows').addEventListener('click', (e) => { if (e.target.closest('[data-m-del]')) { e.target.closest('.sp-mrow').remove(); syncBase(); save(); } });
  $('#sp-m-fill').onclick = async () => {
    if (manualItems().length && !(await confirmDialog(T('Replace the current items with the actual average expenses per category?'), { ok: T('Replace'), danger: false, title: T('Prefill the items?') }))) return;
    try {
      const exp = await api('/split', { method: 'PUT', body: { settings: { split_base: 'expenses' } } });
      const items = exp.result.rows.filter((x) => x.rule !== 'none' && x.monthly > 0)
        .map((x) => ({ name: x.category, account_id: x.account_id, amount: Math.round(x.monthly / 100) * 100, rule: x.rule }));
      $('#sp-mrows').innerHTML = items.map(manualRow).join('');
      $('#sp-base').value = 'manual'; syncBase(); await save();
      toast(tn('{n} item prefilled from actual expenses', '{n} items prefilled from actual expenses', items.length), 'info');
    } catch (e) { fail(e); }
  };

  function syncIds() {  // after saving, new people receive an id
    $$('.sp-person', v).filter((r) => $('[data-f=name]', r).value.trim()).forEach((row, i) => { if (state.people[i]) row.dataset.id = state.people[i].id; });
  }
  $('#sp-add').onclick = () => { $('#sp-people').insertAdjacentHTML('beforeend', personRow()); $('#sp-people .sp-person:last-child input').focus(); };
  $('#sp-people').addEventListener('input', saveSoon);
  // a name typed with no space chosen: the space with that name is proposed (and can be changed)
  $('#sp-people').addEventListener('focusout', (e) => {
    const row = e.target.closest('.sp-person');
    if (!row || e.target.dataset.f !== 'name' || $('[data-f=space]', row).value) return;
    const g = guessSpace(e.target.value), sel = $('[data-f=space]', row);
    if (g && !sel.querySelector(`option[value="${g}"]`)?.disabled) { sel.value = String(g); sel.classList.add('suggested'); saveSoon(); }
  });
  // spaces proposed from the names when the page opens are saved right away (the select shows them as suggested)
  if ($$('#sp-people [data-f=space].suggested', v).some((s) => s.value)) saveSoon();
  $('#sp-people').addEventListener('click', (e) => { if (e.target.closest('[data-del-person]')) { e.target.closest('.sp-person').remove(); save(); } });
  ['#sp-months', '#sp-round'].forEach((id) => ($(id).onchange = () => save()));
  ['#sp-margin', '#sp-min'].forEach((id) => ($(id).oninput = saveSoon));

  // the attribution check: every transfer from other spaces and every income of the space in the period, who it
  // counts for and why; the user's choice is saved on the transaction and always wins
  function contribCard(r) {
    const rows = r.contributions || [];
    if (!rows.length) return '';
    const REASON = { manual: T('your choice'), off: T('your choice'), space: T('from their space'), keyword: T('keyword in the description'),
      source: T('name of the source account'), none: '' };
    const name = (id) => r.people.find((p) => p.id === id)?.name || '';
    const order = (x) => (x.counted && !x.person_id ? 0 : x.counted ? 1 : 2);
    const sorted = rows.slice().sort((a, b) => order(a) - order(b) || b.date.localeCompare(a.date));
    const unassigned = rows.filter((x) => x.counted && !x.person_id).length, notCounted = rows.filter((x) => !x.counted).length;
    const status = (x) => (x.counted ? (x.person_id ? `<b>${esc(name(x.person_id))}</b>` : `<span class="tag warn">${T('unassigned')}</span>`) : `<span class="muted">${T('not counted')}</span>`);
    const choice = (x) => (!x.manual ? 'auto' : x.counted ? `p:${x.person_id}` : 'off');
    return `<div class="card" style="margin-bottom:18px"><div class="card-head"><div><h3>🔎 ${T('Contributions in the period')}</h3>
        <p class="muted small" style="margin:3px 0 0">${T('Every transfer from other spaces and every income of this space in the period, who it counts for and why. If a row is wrong, choose the right person: your choice is kept.')}</p></div>
        <span class="muted small">${unassigned ? `<span class="tag warn">${tn('{n} unassigned', '{n} unassigned', unassigned)}</span> ` : ''}${notCounted ? tn('{n} income not counted', '{n} incomes not counted', notCounted) : ''}</span></div>
      <div class="table-wrap sp-contrib"><table class="sp-table"><thead><tr><th>${T('Date')}</th><th>${T('Description')}</th><th>${T('Account')}</th><th class="right">${T('Amount')}</th><th>${T('Counts for')}</th><th>${T('Why')}</th></tr></thead>
        <tbody>${sorted.map((x) => `<tr class="${x.counted && !x.person_id ? 'unassigned' : x.counted ? '' : 'not-counted'}">
          <td class="small">${fmtDate(x.date)}</td>
          <td>${x.kind === 'transfer' ? '🔄 ' : ''}${esc(x.description)}${x.from_space ? `<div class="muted small">${T('from {space}', { space: esc(x.from_space) })}</div>` : ''}</td>
          <td class="small">${esc(x.account)}</td><td class="right">${money(x.amount)}</td>
          <td><select data-contrib="${x.id}">
            <option value="auto" ${choice(x) === 'auto' ? 'selected' : ''}>${T('Automatic')}</option>
            ${r.people.map((p) => `<option value="p:${p.id}" ${choice(x) === `p:${p.id}` ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            <option value="off" ${choice(x) === 'off' ? 'selected' : ''}>${T('Not a contribution')}</option></select>
            <div class="small" style="margin-top:3px">${status(x)}</div></td>
          <td class="small muted">${REASON[x.reason] || ''}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  $('#sp-result').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-contrib]');
    if (!sel) return;
    const v2 = sel.value;
    try {
      state = await api('/split/attribution', { method: 'PUT', body: { transaction_id: +sel.dataset.contrib,
        person_id: v2.startsWith('p:') ? +v2.slice(2) : null, off: v2 === 'off' } });
      drawResult();
    } catch (err) { fail(err); }
  });

  function drawResult() {
    const r = state.result, people = r.people.filter((p) => p.income > 0);
    const box = $('#sp-result');
    if (!people.length) {
      box.innerHTML = `<div class="card empty"><div class="big">👥</div><h3>${T('Enter who contributes')}</h3><p>${T('Add at least one person with their net monthly income to calculate the split.')}</p></div>`;
      return;
    }
    const range = { from: r.from, to: r.to, excluded: 0 };
    const rate = people[0].rate_exact;
    // rows per category (sum over accounts)
    const byCat = {};
    r.rows.forEach((x) => {
      const k = r.base === 'expenses' ? x.key : `${x.key}`;  // categories: summed across accounts; other bases: one row per item
      const c = (byCat[k] ||= { ...x, monthly: 0, quotas: r.people.map(() => 0), accounts: [] });
      c.monthly += x.monthly; c.quotas = c.quotas.map((q, i) => q + x.quotas[i]);
      c.accounts.push(x.via ? T('{account} (spent with {via})', { account: x.account, via: x.via }) : x.account);
    });
    const cats = Object.values(byCat).sort((a, b) => b.monthly - a.monthly);
    const ruleOf = (id) => state.rules.find((x) => x.id === id)?.split ?? 'prop';
    const accs = [...new Set(r.deposits.map((d) => d.account))];

    box.innerHTML = `
      ${r.fair ? '' : `<div class="card sp-warn">⚠️ ${T('The <b>split equally</b> part exceeds someone\'s fair share: savings cannot be identical. Consider making some categories proportional.')}</div>`}
      <div class="kpis">
        <div class="kpi ${r.base === 'deposits' ? 'g-sky' : 'g-rose'}"><div class="k-label">🧾 ${{ expenses: T('Shared expenses per month'), deposits: T('Average contributions per month'), manual: T('Manual amounts per month') }[r.base]}</div><div class="k-value">${money(r.total)}</div>
          ${r.base === 'manual' ? kRows([`✏️ ${T('Items')}`, r.rows.length])
            : kRows([`📅 ${T('Average of')}`, tn('{n} month', '{n} months', r.months), '', `${fmtDate(r.from)} → ${fmtDate(r.to)}`], r.margin && [`➕ ${T('Unexpected')}`, `${num(r.margin)}%`])}</div>
        <div class="kpi g-amber" title="${esc(r.fair ? T('the same for everyone') : T('not exactly the same'))}"><div class="k-label">🐷 ${T('Each person\'s savings rate')}</div><div class="k-value">${rate == null ? '—' : pct(rate)}</div>
          ${kRows([`👥 ${T('People')}`, r.people.length])}</div>
        <div class="kpi g-indigo"><div class="k-label">½ ${T('Split equally')}</div><div class="k-value">${money(r.equal_total)}</div>${kRows([`👤 ${T('Each')}`, money(r.equal_total / (r.people.length || 1))])}</div>
        <div class="kpi g-indigo"><div class="k-label">⚖️ ${T('Proportional')}</div><div class="k-value">${money(r.prop_total)}</div>${kRows([`🚫 ${T('Excluded')}`, money(r.excluded_total)])}</div>
      </div>
      <div class="sp-stack">
        <div class="card"><div class="card-head"><h3>💸 ${T('Proposed monthly contributions')}</h3><button class="btn btn-sm btn-primary" id="sp-apply">${T('Update recurring contributions')}</button></div>
          <div class="table-wrap"><table class="sp-table">
            <thead><tr><th>${T('Account')}</th><th>${T('Person')}</th><th class="right">${T('Proposed / month')}</th><th class="right">${T('Paid in the period')}</th><th class="right">÷ ${tn('{n} month', '{n} months', r.months)}</th><th class="right">${T('Difference')}</th></tr></thead>
            <tbody>${accs.map((a) => r.deposits.filter((d) => d.account === a).map((d, i) => {
              const diff = d.rounded - d.actual;
              return `<tr><td>${i ? '' : `<span class="dot" style="background:${esc(d.color)}"></span> <b>${esc(a)}</b>`}</td><td>${esc(d.person)}</td>
                <td class="right"><b>${money0(d.rounded)}</b>${d.below_min ? ` <span class="tag warn">${T('below the minimum')}</span>` : ''}<div class="muted small">${T('exact')} ${money(d.exact)}</div></td>
                <td class="right">${d.actual_total ? `<span class="quick-filter" ${txLink({ account_id: d.account_id, from: r.from, to: r.to }, T('View the account transactions in the period'))}>${money0(d.actual_total)}</span><div class="muted small">${tn('{n} contribution', '{n} contributions', d.actual_count)}${d.actual_transfers ? ` · ${T('of which {amount} by transfer', { amount: money0(d.actual_transfers) })}` : ''}</div>` : '<span class="muted">—</span>'}</td>
                <td class="right muted">${d.actual_total ? money0(d.actual) : '—'}</td>
                <td class="right ${Math.abs(diff) < 1000 ? 'muted' : diff > 0 ? 'neg' : 'pos'}" title="${diff > 0 ? T('To increase') : T('To reduce')}">${d.actual_total ? (diff > 0 ? '+' : '') + money0(diff) : '—'}</td></tr>`;
            }).join('')).join('')}</tbody>
            <tfoot><tr><td colspan="2">${T('Total')}</td><td class="right">${money0(r.deposits.reduce((s, d) => s + d.rounded, 0))}</td><td class="right">${money0(r.paid_total)}</td><td class="right">${money0(r.paid_month)}</td><td></td></tr></tfoot>
          </table></div>
          <p class="muted small" style="margin:10px 0 0">${tn('The actual amount paid is the period <b>total</b> ({from} → {to}) divided by {n} month: it includes «Contributions…» income and <b>transfers received from other spaces</b> (e.g. from the contributor\'s personal space).',
            'The actual amount paid is the period <b>total</b> ({from} → {to}) divided by {n} months: it includes «Contributions…» income and <b>transfers received from other spaces</b> (e.g. from the contributor\'s personal space).',
            r.months, { from: esc(fmtDate(r.from)), to: esc(fmtDate(r.to)) })} ${T('Each contribution counts for one person only: your choice in the list below, else the person whose space it comes from, else the one whose keyword is in the description. Transactions excluded from reports do not count.')}</p>
          ${r.unassigned_total ? `<p class="small" style="margin:8px 0 0"><span class="tag warn">⚠ ${T('{amount} of unassigned contributions', { amount: money0(r.unassigned_total) })}</span> ${T('choose who made them in the list below, or link the person to their space.')}</p>` : ''}</div>
        <div class="card"><div class="card-head"><h3>🤝 ${T('Share and savings')}</h3><span class="muted">${T('fair vs actual')}</span></div>
          <div class="sp-people-res">${r.people.map((p) => `<div class="sp-pres">
            <div class="top"><b>${esc(p.name)}</b><span class="muted small">${T('income {amount} / month', { amount: money0(p.income) })}</span></div>
            <table class="sp-cmp"><thead><tr><th></th><th>${T('Pays / month')}</th><th>${T('Share')}</th><th>${T('Saves')}</th><th>${T('Savings rate')}</th></tr></thead><tbody>
              <tr><td><span class="tag ai">${T('Fair')}</span></td><td>${money0(p.share_rounded)}</td><td>${pct(p.weight)}</td>
                <td class="${p.savings >= 0 ? 'pos' : 'neg'}">${money0(p.savings)}</td><td><b>${p.rate == null ? '—' : pct(p.rate)}</b></td></tr>
              <tr><td><span class="tag">${T('Actual')}</span></td><td>${p.paid_total ? money0(p.paid_month) : '—'}</td><td>${p.paid_weight == null ? '—' : pct(p.paid_weight)}</td>
                <td>${p.paid_total ? money0(p.income - p.paid_month) : '—'}</td><td><b>${p.paid_total && p.rate_actual != null ? pct(p.rate_actual) : '—'}</b></td></tr>
            </tbody></table>
            <div class="sp-share" title="${esc(T('Fair share vs actual share of the total paid'))}">
              <div><span>${T('Fair')}</span><div class="bar"><i style="width:${(p.weight * 100).toFixed(1)}%"></i></div></div>
              <div><span>${T('Actual')}</span><div class="bar real"><i style="width:${((p.paid_weight || 0) * 100).toFixed(1)}%"></i></div></div>
            </div>
            <div class="muted small">${tn('Paid in the period: <b>{amount}</b> in {n} bank transfer', 'Paid in the period: <b>{amount}</b> in {n} bank transfers', p.paid_count, { amount: money0(p.paid_total) })} (÷ ${tn('{n} month', '{n} months', r.months)})</div></div>`).join('')}</div></div>
      </div>
      ${contribCard(r)}
      <div class="card"><div class="card-head"><div><h3>${{ expenses: T('🏷️ Rules per category'), deposits: T('🤝 Breakdown of contributions'), manual: T('✏️ Manual items') }[r.base]}</h3>
        <p class="muted small" style="margin:3px 0 0">${{ expenses: T('Actual average monthly spending and each person\'s share. Click the name to see the transactions.'),
          deposits: T('Monthly average of contributions per account: the part covering expenses split equally is divided in half, the rest in proportion to income.'),
          manual: T('Amounts entered by hand and each person\'s share (rules are changed in the items table).') }[r.base]}</p></div></div>
        <div class="table-wrap"><table class="sp-table">
          <thead><tr><th>${r.base === 'expenses' ? T('Category') : T('Item')}</th><th>${T('Rule')}</th><th class="right">${r.base === 'manual' ? T('Amount') : T('Average')} / ${T('month')}</th>${r.people.map((p) => `<th class="right">${esc(p.name)}</th>`).join('')}</tr></thead>
          <tbody>${cats.map((c) => `<tr class="${c.rule === 'none' ? 'is-off' : ''}">
            <td><span class="pill ${r.base === 'expenses' ? 'quick-filter' : ''}" style="--c:${esc(c.color)}" ${r.base === 'expenses' ? txLink({ ...range, category_id: c.category_id ?? 'none', kind: 'expense' }) : ''}>${esc(c.icon)} ${esc(c.category)}</span>
              <div class="muted small">${esc([...new Set(c.accounts)].join(' · '))}</div></td>
            <td>${r.base === 'expenses' && c.category_id ? `<div class="seg sp-rule" data-cat="${c.category_id}">${SPLIT_RULES.map(([k, l, t]) => `<button data-r="${k}" class="${ruleOf(c.category_id) === k ? 'on' : ''}" title="${t}">${l}</button>`).join('')}</div>`
              : `<span class="muted small">${SPLIT_RULES.find(([k]) => k === c.rule)?.[1] ?? T('Proportional')}</span>`}</td>
            <td class="right"><b>${money0(c.monthly)}</b></td>${c.quotas.map((q) => `<td class="right">${c.rule === 'none' ? '<span class="muted">—</span>' : money0(q)}</td>`).join('')}</tr>`).join('')
            || `<tr><td colspan="${3 + r.people.length}"><div class="empty">${r.base === 'manual' ? T('Add at least one item with an amount') : T('No data in the period')}</div></td></tr>`}</tbody>
        </table></div>
        ${r.base === 'expenses' && state.rules.filter((x) => !byCat[`c${x.id}`]).length ? `<p class="muted small" style="margin:10px 0 0">${T('Categories with no expenses in the period:')} ${state.rules.filter((x) => !byCat[`c${x.id}`]).map((x) => `${esc(x.icon)} ${esc(x.name)}`).join(' · ')}</p>` : ''}
      </div>`;

    $$('.sp-rule', box).forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (b) save({ rules: { [seg.dataset.cat]: b.dataset.r } });
    }));
    $('#sp-apply').onclick = async () => {
      const list = r.deposits.filter((d) => d.rounded > 0 && d.person_id);
      if (!(await confirmDialog(`${T('Set the recurring monthly contributions to the proposed amounts? ({list})', { list: list.map((d) => T('{person} into {account}: {amount}', { person: d.person, account: d.account, amount: money0(d.rounded) })).join(', ') })} ${T('Whoever has their own space pays with a recurring transfer from it: it is updated, or created from the account they usually pay from. Whoever has no space gets a recurring contribution income here.')}`, { ok: T('Update'), danger: false, title: T('Update the contributions?') }))) return;
      try {
        const res = await api('/split/apply', { method: 'POST', body: { deposits: list.map((d) => ({ account_id: d.account_id, person_id: d.person_id, amount: d.rounded })) } });
        toast(`${T('Recurring items updated:')} ${res.updated}${res.created ? ` · ${T('created')} ${res.created}` : ''}${res.transfers?.length ? ` · ${T('transfers updated in the contributor\'s space:')} ${res.transfers.join(', ')}` : ''}`);
        (res.warnings || []).forEach((w) => toast(w, 'err'));
      } catch (e) { fail(e); }
    };
  }
  drawResult();
}

// ================================================================ categories
async function renderCategorie(v) {
  const col = (kind, title) => `<div class="card"><div class="card-head"><h3>${title}</h3><button class="btn btn-sm" data-newcat="${kind}">＋ ${T('New')}</button></div>
    <div class="list">${catsOf(kind).map((c) => `<div class="list-item clickable" ${txLink({ category_id: c.id, kind }, `${T('Transactions')} ${c.name}`)}><div class="cat-ico" style="--c:${esc(c.color)}">${esc(c.icon)}</div>
      <div class="grow"><div class="title">${esc(c.name)}</div>${kind === 'expense' ? `<div class="muted small">${c.budget ? `${T('Budget {amount} / month', { amount: money0(c.budget) })}` : T('No budget')}</div>` : ''}</div>
      <button class="icon-btn sm" data-editcat="${c.id}" title="${esc(T('Edit'))}">✏️</button></div>`).join('')}</div></div>`;
  v.innerHTML = `<div class="grid-2">${col('expense', T('📤 Expense categories'))}${col('income', T('📥 Income categories'))}</div>
    <div class="card"><div class="card-head"><div><h3>✨ ${T('Automatic categorization rules')}</h3>
      <p class="muted small" style="margin:4px 0 0">${T('If the description contains the keyword, the transaction gets the category. Besides the rules, HomeCoin learns from the transactions you have already categorized.')}</p></div>
      <button class="btn btn-sm" id="rules-apply">⚡ ${T('Apply to uncategorized transactions')}</button></div>
      <div class="inline-form" style="margin-bottom:16px"><input id="rule-p" placeholder="${esc(T('Keyword (e.g. tesco)'))}" maxlength="80">
        <select id="rule-c"><optgroup label="${esc(T('Expenses'))}">${catsOf('expense').map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup>
        <optgroup label="${esc(T('Income'))}">${catsOf('income').map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup></select>
        <button class="btn btn-primary" id="rule-add">＋ ${T('Add rule')}</button></div>
      <div id="rule-sugg" class="sugg-row"></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${S.rules.map((r) => { const c = catById(r.category_id) || {}; return `<span class="pill" style="--c:${esc(c.color)}">“${esc(r.pattern)}” → ${esc(c.icon)} ${esc(r.category_name)}
        <button class="btn-ghost" data-delrule="${r.id}" style="border:0;background:none;cursor:pointer;color:inherit;padding:0 0 0 4px" title="${esc(T('Remove'))}">✕</button></span>`; }).join('')}</div>
    </div>`;
  $$('[data-newcat]').forEach((b) => (b.onclick = () => categoryModal(null, b.dataset.newcat)));
  $$('[data-editcat]').forEach((b) => (b.onclick = () => categoryModal(catById(+b.dataset.editcat))));
  $$('[data-delrule]').forEach((b) => (b.onclick = async () => { try { await api(`/rules/${b.dataset.delrule}`, { method: 'DELETE' }); refresh(); } catch (e) { fail(e); } }));
  $('#rule-add').onclick = async () => {
    try { await api('/rules', { method: 'POST', body: { pattern: $('#rule-p').value, category_id: +$('#rule-c').value } }); toast(T('Rule added')); refresh(); } catch (e) { fail(e); }
  };
  $('#rules-apply').onclick = async () => {
    try { const r = await api('/rules/apply', { method: 'POST' }); toast(tn('{n} transaction categorized', '{n} transactions categorized', r.updated), 'info'); } catch (e) { fail(e); }
  };
  try {  // suggested keywords: payees that come up often among the transactions still uncategorized
    const sug = await api('/rules/suggestions');
    if (sug.length) {
      $('#rule-sugg').innerHTML = `<span class="sugg-title">✨ ${T('Often uncategorized')}</span>${sug.map((s, i) =>
        `<button type="button" class="sugg-chip" data-rsug="${i}" title="${esc(tn('Use as keyword · {n} uncategorized transaction', 'Use as keyword · {n} uncategorized transactions', s.count))}">${s.kind === 'income' ? '📥' : '📤'} ${esc(s.pattern)} <span class="ac-meta">×${s.count}</span></button>`).join('')}`;
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
  const m = openModal(c ? T('Edit category') : x.kind === 'expense' ? T('New expense category') : T('New income category'), `
    <div class="form-grid">
      <label class="field ${x.kind === 'expense' ? '' : 'full'}">${T('Name')} <input id="c-name" maxlength="60" value="${esc(x.name)}" autofocus></label>
      ${x.kind === 'expense' ? `<label class="field">${T('Monthly budget')} <input id="c-budget" inputmode="decimal" value="${moneyInput(x.budget)}" placeholder="${esc(T('None'))}"></label>` : ''}
      <div class="field full">${T('Color')} ${swatchPicker('c-color', x.color)}</div>
      <div class="field full">${T('Icon')} ${emojiPicker('c-icon', x.icon)}</div>
      ${x.kind === 'expense' ? `<label class="check full"><input type="checkbox" id="c-flow" ${x.flow === 'other' ? 'checked' : ''}>
        ${T('Contribution to other spaces (e.g. the household account): not an expense, in reports it counts under "Other spaces"')}</label>` : ''}
    </div>
    ${c && x.kind === 'expense' && !['balance_adjustment', 'other_investments'].includes(c.code) ? `<p class="muted small" style="margin:12px 0 0">🔄 ${T('Money you move to another space recorded here as expenses? Turn them into transfers, so they appear in both spaces.')}
      <button type="button" class="btn btn-sm" id="c-convert">${T('Turn into transfers…')}</button></p>` : ''}
    <div class="modal-foot">${c ? `<button class="btn btn-ghost left neg" id="c-del">🗑 ${T('Delete')}</button>` : ''}
      <button class="btn" data-cancel>${T('Cancel')}</button><button class="btn btn-primary" id="c-save">${T('Save')}</button></div>`);
  const getColor = bindSwatches($('#c-color', m)), getIcon = bindEmoji($('#c-icon', m));
  $('[data-cancel]', m).onclick = closeModal;
  if ($('#c-convert', m)) $('#c-convert', m).onclick = () => { closeModal(); convertToTransfersModal(c); };
  $('#c-save', m).onclick = async () => {
    const budget = $('#c-budget', m) ? parseMoney($('#c-budget', m).value) : 0;
    const body = { name: $('#c-name', m).value, kind: x.kind, color: getColor(), icon: getIcon(), budget: budget || 0,
      flow: $('#c-flow', m)?.checked ? 'other' : '' };
    try { await api(c ? `/categories/${c.id}` : '/categories', { method: c ? 'PUT' : 'POST', body }); toast(T('Category saved')); closeModal(); refresh(); } catch (e) { fail(e); }
  };
  if (c) $('#c-del', m).onclick = async () => {
    if (!(await confirmDialog(`${T('Delete "{name}"?', { name: c.name })} ${T('Its automatic rules will be deleted too.')}`, { ok: T('Delete') }))) return;
    const del = (force) => api(`/categories/${c.id}${force ? '?force=1' : ''}`, { method: 'DELETE' });
    try {
      try { await del(false); } catch (e) {
        if (e.status !== 409 || e.data?.transactions == null) throw e;  // in use: say what would be left without a category
        const tx = e.data.transactions ? tn('{n} transaction', '{n} transactions', e.data.transactions) : '';
        const rec = e.data.recurring ? tn('{n} recurring item', '{n} recurring items', e.data.recurring) : '';
        const parts = tx && rec ? T('{first} and {second}', { first: tx, second: rec }) : tx || rec;
        if (!(await confirmDialog(`${T('"{name}" is used by {items}: they will be left uncategorized and drop out of budgets and category reports.', { name: c.name, items: parts })} `
          + T('To keep the classification, first move them to another category (Transactions → multiple selection → Category). Delete anyway?'), { ok: T('Delete anyway') }))) return;
        await del(true);
      }
      toast(T('Category deleted')); refresh();
    } catch (e) { fail(e); }
  };
}

// expenses of a category that are really money moved to another space → transfers to an account of that space:
// preview first (each expense and what it becomes, the pairings the user can undo, the effect on both spaces),
// then the conversion
function convertToTransfersModal(c) {
  // the money reaches one other space, possibly several of its accounts: the space first, then its accounts
  const spaces = S.portfolios.filter((p) => p.id !== S.pid && !p.archived)
    .map((p) => ({ ...p, accs: S.allAccounts.filter((a) => a.portfolio_id === p.id && !a.archived) })).filter((p) => p.accs.length);
  if (!spaces.length) { toast(T('There is no active account in another space'), 'err'); return; }
  const m = openModal(T('Turn "{name}" into transfers', { name: c.name }), `
    <p class="muted small" style="margin-top:0">${T('Each expense of this category becomes a transfer to the account where its money arrived, found among the accounts you tick: it stays out of your spending and appears in that space as money received. Amounts, dates and descriptions do not change.')}</p>
    <div class="form-grid">
      <label class="field">${T('Destination space')} <select id="cv-space">${spaces.map((p) => `<option value="${p.id}">${esc(p.icon || '')} ${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">${T('Expenses with no matching record go to')} <select id="cv-def"></select></label>
      <div class="field full">${T('Accounts the money reaches')} <div id="cv-accs" style="display:flex;flex-wrap:wrap;gap:4px 14px"></div></div>
      <label class="check full"><input type="checkbox" id="cv-merge" checked> ${T('Recognize the money already recorded: similar amount and close date, each record paired once with the best overall pairing. An income in the destination account is replaced by the transfer; an expense already recorded as a transfer to that account is a duplicate and is deleted. Nothing is counted twice.')}</label>
      <label class="check full"><input type="checkbox" id="cv-split" checked> ${T('Split an expense into two transfers when two incomes in two different accounts together make its amount')}</label>
      <label class="field">${T('Date difference allowed (days)')} <input id="cv-days" type="number" min="0" max="31" step="1" value="5"></label>
      <label class="field">${T('Amount difference allowed (%)')} <input id="cv-tol" type="number" min="0" max="100" step="1" value="2"></label>
      <p class="muted small full" style="margin:0">${T('When the amounts differ, the transfer keeps the amount of the expense, the money that left your account.')}</p>
    </div>
    <div id="cv-out" class="card" style="margin-top:12px"></div>
    <div class="modal-foot"><button class="btn" data-cancel>${T('Cancel')}</button>
      <button class="btn btn-primary" id="cv-go" disabled>${T('Convert')}</button></div>`, { wide: true });
  $('[data-cancel]', m).onclick = closeModal;
  let unmatch, chosen, assign, recAcc, confirm;  // the user's choices, reset when the space changes
  const reset = () => { unmatch = new Set(); chosen = new Set(); assign = {}; recAcc = {}; confirm = new Set(); };
  const space = () => spaces.find((p) => p.id === +$('#cv-space', m).value);
  const ticked = () => $$('[data-acc]:checked', m).map((el) => +el.dataset.acc);
  const accName = (id) => S.allAccounts.find((a) => a.id === id)?.name || '';
  const drawAccounts = () => {  // all the accounts of the space ticked: the records say where the money arrived
    $('#cv-accs', m).innerHTML = space().accs.map((a) => `<label class="check"><input type="checkbox" data-acc="${a.id}" checked> ${esc(a.icon)} ${esc(a.name)}</label>`).join('');
    $$('[data-acc]', m).forEach((el) => (el.onchange = () => { drawDefault(); preview(); }));
    drawDefault();
  };
  let defVal = null;  // the user's choice for unmatched expenses (null = not chosen yet: the first ticked account)
  const drawDefault = () => {
    $('#cv-def', m).innerHTML = ticked().map((id) => `<option value="${id}">${esc(accName(id))}</option>`).join('')
      + `<option value="">${T('Leave them as expenses')}</option>`;
    if (defVal !== null && [...$('#cv-def', m).options].some((o) => o.value === defVal)) $('#cv-def', m).value = defVal;
    else $('#cv-def', m).selectedIndex = 0;
  };
  const num = (sel, max) => Math.min(max, Math.max(0, Number($(sel, m).value) || 0));
  const opts = () => ({ to_account_ids: ticked(), default_account_id: $('#cv-def', m).value ? +$('#cv-def', m).value : null,
    merge: $('#cv-merge', m).checked, split: $('#cv-split', m).checked, days: Math.round(num('#cv-days', 31)), tolerance: num('#cv-tol', 100),
    unmatch: [...unmatch], confirm: [...confirm], assign, recurring_ids: [...chosen], recurring_accounts: recAcc });
  const range = (r) => (r.first ? ` · ${fmtDate(r.first)} → ${fmtDate(r.last)}` : '');
  async function preview() {
    $('#cv-go', m).disabled = true;
    if (!ticked().length) { $('#cv-out', m).innerHTML = `<div class="small neg">${T('Tick at least one account')}</div>`; return; }
    try {
      const r = await api(`/categories/${c.id}/to-transfers`, { method: 'POST', body: { ...opts(), dry_run: true } });
      const names = (list) => list.map(esc).join(', ');
      const lines = [
        `<b>${tn('{n} expense', '{n} expenses', r.transactions)}</b> · ${money(r.total)}${range(r)}`,
        r.merged ? `🔗 ${tn('{n} matching income in the destination account will be replaced', '{n} matching incomes in the destination account will be replaced', r.merged)}` : '',
        r.split ? `✂️ ${tn('{n} expense matches two incomes in two accounts: it is split into two transfers', '{n} expenses match two incomes in two accounts: each is split into two transfers', r.split)}` : '',
        r.duplicates ? `♊ ${tn('{n} expense is already recorded as a transfer to that account: it is a duplicate and will be deleted', '{n} expenses are already recorded as transfers to that account: they are duplicates and will be deleted', r.duplicates)}` : '',
        r.kept ? `⏸ ${tn('{n} expense stays an expense', '{n} expenses stay expenses', r.kept)}` : '',
        r.elsewhere ? `<span class="neg">⚠ ${tn('{n} expense has a similar income (amount and date) in another account of {space}: check that the destination account is the right one', '{n} expenses have a similar income (amount and date) in another account of {space}: check that the destination account is the right one', r.elsewhere, { space: esc(r.to_space) })}</span>` : '',
      ].filter(Boolean);
      // each expense: what it becomes and its account (the account of the record found, or the default); the account
      // can be changed per row (this undoes the pairing), a pairing can be unticked ("not the same money")
      const diff = (i) => (i.match_amount && i.match_amount !== i.amount ? ` · ${T('different amount: {amount}', { amount: money(i.match_amount) })}` : '');
      const parts = (i) => i.parts.map((x) => `${money(x.amount)} → ${esc(accName(x.account_id))}`).join(', ');
      const what = (i) => ({
        merge: `🔗 ${T('Replaces the income of {date}', { date: fmtDate(i.match_date) })}${diff(i)}`,
        duplicate: `♊ ${T('Already a transfer on {date}: deleted', { date: fmtDate(i.match_date) })}${diff(i)}`,
        split: `✂️ ${T('Split into two transfers, replacing the two incomes: {parts}', { parts: parts(i) })}`,
        keep: `⏸ ${T('Stays an expense')}`,
      }[i.action] || `🔄 ${T('Becomes a transfer')}`);
      // a pairing with a different amount (beyond 2%) is only a suggestion: applied when the user ticks it
      const sug = (i) => {
        const s = i.suggestion, v = { date: fmtDate(s.date), amount: money(s.amount) };
        return `<div class="small neg"><input type="checkbox" data-confirm="${i.id}"> ${s.action === 'duplicate'
          ? T('Possible duplicate with a different amount: the transfer of {date} ({amount}). Tick it if it is the same money.', v)
          : s.action === 'split' ? T('Possible split with a different total ({amount}). Tick it if it is the same money.', v)
            : T('Possible match with a different amount: the income of {date} ({amount}). Tick it if it is the same money.', v)}</div>`;
      };
      const tick = (i) => (i.confirmed ? `<input type="checkbox" data-confirm="${i.id}" checked title="${esc(T('Untick if they are not the same money'))}"> `
        : ['merge', 'duplicate', 'split'].includes(i.action) || i.unmatched
          ? `<input type="checkbox" data-pair="${i.id}" ${i.unmatched ? '' : 'checked'} title="${esc(T('Untick if they are not the same money'))}"> ` : '');
      const accSel = (i) => `<label title="${esc(T('To account'))}">→ <select data-assign="${i.id}">${i.action === 'split' ? `<option value="split" selected>✂️ ${T('Split')}</option>` : ''}
        ${r.accounts.map((a) => `<option value="${a.id}" ${i.action !== 'split' && i.to_account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        <option value="0" ${i.action === 'keep' ? 'selected' : ''}>${T('Stays an expense')}</option></select></label>`;
      // one card per expense: date, description, amount; then its account, what happens and the pairing tick
      const rows = r.items.map((i) => `<div class="ri ${i.action === 'keep' ? 'off' : ''}"><span class="ri-date">${fmtDate(i.date)}</span>
        <span class="ri-desc">${esc(i.description)}</span><span class="ri-amt">${money(i.amount)}</span>
        <div class="ri-act">${accSel(i)}<span>${tick(i)}${what(i)}</span></div>${i.suggestion ? `<div class="ri-note">${sug(i)}</div>` : ''}</div>`).join('');
      // the category's recurring items: none converted unless ticked, each with its account (suggested by the recurring
      // income that looks like the same money, or a split); what looks like the same money is only reported
      const recs = r.recurring_items.map((x) => {
        const warn = [
          x.planned.length ? `<div class="small neg">⚠ ${T('A recurring transfer to that account already looks like the same money ({names}): converting this one too would record it twice.', { names: names(x.planned) })}</div>` : '',
          x.dest_income.length ? `<div class="small">ℹ️ ${T('Recurring income in {space} that looks like the same money ({names}): after the change you can merge it, it is proposed right after.', { space: esc(r.to_space), names: names(x.dest_income) })}</div>` : '',
          x.parts.length ? `<div class="small">✂️ ${T('Two recurring incomes in two accounts together make it ({names}): it can become two recurring transfers, {parts}.', { names: names(x.parts.map((p) => p.income)), parts: parts(x) })}</div>` : '',
          !x.chosen && !r.flow_other ? `<div class="muted small">${T('Not converted: its future payments stay expenses and do not reach {space}. To count them under "Other spaces" meanwhile, mark the category as a contribution to other spaces.', { space: esc(r.to_space) })}</div>` : '',
        ].join('');
        const sel = `<label title="${esc(T('To account'))}">→ <select data-racc="${x.id}">${x.parts.length ? `<option value="split" ${x.to_account_id === 'split' ? 'selected' : ''}>✂️ ${T('Split')}</option>` : ''}
          ${r.accounts.map((a) => `<option value="${a.id}" ${x.to_account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`;
        return `<div class="ri ${x.chosen ? '' : 'off'}"><span class="ri-date">🔁 ${FREQ[x.frequency] || ''}</span><span class="ri-desc">${esc(x.name)}${x.active ? '' : ` · ${T('⏸ Paused')}`}</span>
          <span class="ri-amt">${money(x.amount)}</span>
          <div class="ri-act"><label><input type="checkbox" data-rec="${x.id}" ${x.chosen ? 'checked' : ''}> ${T('Turn into a recurring transfer')}</label>${sel}</div>
          ${warn ? `<div class="ri-note">${warn}</div>` : ''}</div>`;
      }).join('');
      $('#cv-out', m).innerHTML = r.transactions || r.recurring_items.length ? lines.map((l) => `<div class="small">${l}</div>`).join('')
        + (rows ? `<div class="ri-list">${rows}</div>` : '')
        + (recs ? `<div class="small" style="margin-top:12px"><b>${T('Recurring items of this category: tick the ones to turn into recurring transfers. Nothing else is changed.')}</b></div><div class="ri-list">${recs}</div>` : '')
        + effectTable(r)
        : `<div class="muted small">${T('Nothing to convert: this category has no expenses or recurring items.')}</div>`;
      $$('[data-pair]', m).forEach((el) => (el.onchange = () => { (el.checked ? unmatch.delete(+el.dataset.pair) : unmatch.add(+el.dataset.pair)); preview(); }));
      $$('[data-confirm]', m).forEach((el) => (el.onchange = () => { (el.checked ? confirm.add(+el.dataset.confirm) : confirm.delete(+el.dataset.confirm)); preview(); }));
      $$('[data-assign]', m).forEach((el) => (el.onchange = () => { if (el.value === 'split') delete assign[el.dataset.assign]; else assign[el.dataset.assign] = +el.value; preview(); }));
      $$('[data-rec]', m).forEach((el) => (el.onchange = () => { (el.checked ? chosen.add(+el.dataset.rec) : chosen.delete(+el.dataset.rec)); preview(); }));
      $$('[data-racc]', m).forEach((el) => (el.onchange = () => { recAcc[el.dataset.racc] = el.value === 'split' ? 'split' : +el.value; preview(); }));
      $('#cv-go', m).disabled = !(r.items.some((i) => i.action !== 'keep') || r.recurring);
    } catch (e) { $('#cv-out', m).innerHTML = `<div class="small neg">${esc(e.message)}</div>`; }
  }
  $('#cv-space', m).onchange = () => { reset(); defVal = null; drawAccounts(); preview(); };
  $('#cv-def', m).onchange = () => { defVal = $('#cv-def', m).value; preview(); };
  $$('#cv-merge, #cv-split, #cv-days, #cv-tol', m).forEach((el) => (el.onchange = preview));
  $('#cv-go', m).onclick = async () => {
    if (!(await confirmDialog(T('Convert now? A backup of the database is saved first.'), { ok: T('Convert'), danger: false }))) return;
    try {
      const r = await api(`/categories/${c.id}/to-transfers`, { method: 'POST', body: opts() });
      toast(tn('{n} expense turned into a transfer', '{n} expenses turned into transfers', r.converted + r.merged + r.split)
        + (r.duplicates ? ` · ${tn('{n} duplicate removed', '{n} duplicates removed', r.duplicates)}` : ''));
      closeModal();
      for (const id of r.converted_recurring) await reconcileModal(id, { quiet: true });  // proposes what to merge, if anything
      await loadMeta(); route();
    } catch (e) { fail(e); }
  };
  reset(); drawAccounts(); preview();
}

// effect of a change between two spaces on the reports of both (saved = income − spending), per account when the
// money reaches several, and on net worth
function effectTable(r) {
  const e = r.effect, sign = (v) => (v > 0 ? '+' : '') + money(v);
  const here = S.portfolios.find((p) => p.id === S.pid)?.name || '';
  const balances = r.dest_balances ? r.dest_balances.map((x) => [r.to_space, T('Balance of {account}', { account: x.name }), x.delta])
    : [[r.to_space, T('Balance of {account}', { account: r.to_account }), e.dest_balance]];
  const fx = [
    [here, T('Spending'), e.spending], [here, T('To other spaces'), e.to_others],
    [here, T('Account balances'), e.source_balance], [here, T('Money saved'), e.source_balance],
    [r.to_space, T('Income'), e.dest_income], [r.to_space, T('From other spaces'), e.dest_from_others],
    ...balances, [r.to_space, T('Money saved'), e.dest_balance],
    ['', T('Net worth'), e.source_balance + e.dest_balance],
  ].filter((x) => x[2]).map(([s, k, v]) => `<tr><td>${esc(s)}</td><td>${esc(k)}</td><td class="num">${sign(v)}</td></tr>`).join('');
  const changed = r.dest_balances ? r.dest_balances.map((x) => x.name) : (e.dest_balance ? [r.to_account] : []);
  return (fx ? `<div class="small" style="margin-top:12px"><b>${T('Effect on the reports')}</b></div><table class="table small fx-table"><tbody>${fx}</tbody></table>` : '')
    + (changed.length ? `<div class="muted small">${T('After the change, check that the balance of {account} matches your bank: if it does not, the same money was recorded there in another way (for example a balance adjustment).', { account: changed.map(esc).join(', ') })}</div>` : '');
}

// what changed in one account since an automatic backup: deleted transactions (they can be put back one by one),
// changed and added ones, and the difference in the balance. Resolves when the window is closed.
async function compareBackupModal(aid) {
  let list;
  try { list = await api('/backups/auto'); } catch (e) { fail(e); return; }
  if (!list.length) { toast(T('There are no automatic backups yet'), 'err'); return; }
  const acc = S.allAccounts.find((a) => a.id === aid);
  const restore = new Set();
  const reason = (x) => ({ startup: T('at start'), 'pre-convert': T('before turning expenses into transfers'), 'pre-reconcile': T('before a reconciliation'),
    'pre-doubles': T('before removing doubles'), 'pre-import': T('before an import'), 'pre-restore': T('before a restore'),
    'pre-restore-tx': T('before putting transactions back'), update: T('before an update') }[x.reason] || x.reason);
  return new Promise((resolve) => {
    const m = openModal(T('{account}: compare with an automatic backup', { account: acc?.name || '' }), `
      <p class="muted small" style="margin-top:0">${T('HomeCoin saves an encrypted copy at every start and before every bulk change. Choose one: you see the transactions of this account deleted, changed or added since then, and you can put back the deleted ones you need. Nothing else changes.')}</p>
      <label class="field">${T('Automatic backup')} <select id="cb-name">${list.map((x) => `<option value="${esc(x.name)}">${esc(fmtDate(x.at.slice(0, 10)))} ${esc(x.at.slice(11))} · ${esc(reason(x))}</option>`).join('')}</select></label>
      <div id="cb-out" style="margin-top:12px"></div>
      <div class="modal-foot"><button class="btn" data-cancel>${T('Close')}</button>
        <button class="btn btn-primary" id="cb-go" disabled>${T('Put back the ticked ones')}</button></div>`, { wide: true });
    const done = () => { closeModal(); resolve(); };
    $('[data-cancel]', m).onclick = done;
    const line = (t) => `${KIND_LABEL[t.kind] || t.kind}${t.kind === 'transfer' ? ` · ${esc(t.account_name || '')} → ${esc(t.to_account_name || '')}` : ''}`;
    const card = (t, tick) => `<div class="ri"><span class="ri-date">${fmtDate(t.date)}</span><span class="ri-desc">${esc(t.description)}</span>
      <span class="ri-amt ${t.effect > 0 ? 'pos' : 'neg'}">${t.effect > 0 ? '+' : ''}${money(t.effect)}</span>
      <div class="ri-act">${tick ? `<label><input type="checkbox" data-restore="${t.id}" ${restore.has(t.id) ? 'checked' : ''}> ${T('Put back')}</label>` : ''}<span class="muted">${line(t)}</span></div></div>`;
    const load = async () => {
      $('#cb-go', m).disabled = true;
      try {
        const r = await api(`/accounts/${aid}/compare-backup`, { method: 'POST', body: { backup: $('#cb-name', m).value, dry_run: true } });
        const sec = (title, html) => (html ? `<div class="small" style="margin-top:12px"><b>${title}</b></div><div class="ri-list">${html}</div>` : '');
        $('#cb-out', m).innerHTML = `<div class="small">${T('Difference in the balance of {account} since then: {amount}', { account: esc(acc?.name || ''), amount: `<b>${r.difference > 0 ? '+' : ''}${money(r.difference)}</b>` })}</div>`
          + sec(`🗑 ${T('Deleted since then')}`, r.deleted.map((t) => card(t, true)).join(''))
          + sec(`✏️ ${T('Changed since then')}`, r.changed.map((x) => `<div class="ri"><span class="ri-date">${fmtDate(x.after.date)}</span><span class="ri-desc">${esc(x.after.description)}</span>
              <span class="ri-amt">${money(x.after.effect)}</span><div class="ri-note muted">${T('before')}: ${fmtDate(x.before.date)} · ${esc(x.before.description)} · ${money(x.before.effect)} · ${line(x.before)}</div></div>`).join(''))
          + sec(`＋ ${T('Added since then')}`, r.added.map((t) => card(t, false)).join(''))
          + (r.deleted.length || r.changed.length || r.added.length ? '' : `<div class="muted small" style="margin-top:8px">${T('Nothing changed in this account since then.')}</div>`);
        $$('[data-restore]', m).forEach((el) => (el.onchange = () => { el.checked ? restore.add(+el.dataset.restore) : restore.delete(+el.dataset.restore); $('#cb-go', m).disabled = !restore.size; }));
        $('#cb-go', m).disabled = !restore.size;
      } catch (e) { $('#cb-out', m).innerHTML = `<div class="small neg">${esc(e.message)}</div>`; }
    };
    $('#cb-name', m).onchange = () => { restore.clear(); load(); };
    $('#cb-go', m).onclick = async () => {
      if (!(await confirmDialog(T('Put back the ticked transactions? A backup of the database is saved first.'), { ok: T('Put back'), danger: false }))) { resolve(); return; }
      try {
        const res = await api(`/accounts/${aid}/compare-backup`, { method: 'POST', body: { backup: $('#cb-name', m)?.value || list[0].name, restore_ids: [...restore] } });
        toast(tn('{n} transaction restored', '{n} transactions restored', res.restored)); done();
      } catch (e) { fail(e); }
    };
    load();
  });
}

// money recorded twice in one account (an income and a transfer for the same money, a generated transfer and the same
// one entered by hand, an import done twice): pairs to tick, the most coherent record of each pair is kept.
// Resolves when the window is closed.
async function doublesModal(aid) {
  const choices = {};
  let days = 3, tol = 0, r;
  const load = () => api(`/accounts/${aid}/doubles`, { method: 'POST', body: { dry_run: true, days, tolerance: tol, choices } });
  try { r = await load(); } catch (e) { fail(e); return; }
  const num = (m, sel, max) => Math.min(max, Math.max(0, Number($(sel, m).value) || 0));
  return new Promise((resolve) => {
    const m = openModal(T('Money recorded twice in {account}', { account: r.account }), `
      <p class="muted small" style="margin-top:0">${T('Two records in the same direction with a similar amount and a close date are probably the same money recorded twice. For each pair HomeCoin keeps the most coherent record (a transfer, seen in both spaces) and deletes the other. Nothing changes until you confirm.')}</p>
      <div class="form-grid">
        <label class="field">${T('Date difference allowed (days)')} <input id="db-days" type="number" min="0" max="31" step="1" value="${days}"></label>
        <label class="field">${T('Amount difference allowed (%)')} <input id="db-tol" type="number" min="0" max="100" step="1" value="${tol}"></label>
      </div>
      <div id="db-out" style="margin-top:12px"></div>
      <div class="modal-foot"><button class="btn" data-cancel>${T('Cancel')}</button>
        <button class="btn btn-primary" id="db-go">${T('Apply')}</button></div>`, { wide: true });
    const done = () => { closeModal(); resolve(); };
    $('[data-cancel]', m).onclick = done;
    const what = (t) => {
      const flow = t.kind === 'transfer'
        ? (t.to_account_id === aid ? T('from {account} ({space})', { account: t.account_name, space: t.space }) : T('to {account} ({space})', { account: t.to_account_name, space: t.to_space }))
        : '';
      return `${KIND_LABEL[t.kind] || t.kind}${flow ? ' · ' + esc(flow) : ''}${t.recurring_id ? ' · 🔁' : ''} · ${fmtDate(t.date)} · <b>${money(t.amount)}</b> — ${esc(t.description)}`;
    };
    const draw = () => {
      const cards = r.pairs.map((p) => `<div class="ri ${p.on ? '' : 'off'}"><span class="ri-date">${fmtDate(p.drop.date)}</span>
        <span class="ri-desc">${p.direction === 'in' ? '📥' : '📤'} ${esc(p.drop.description || p.keep.description)}</span><span class="ri-amt ${p.different ? 'neg' : ''}">${money(p.drop.amount)}</span>
        <div class="ri-act"><label><input type="checkbox" data-key="${esc(p.key)}" ${p.on ? 'checked' : ''}> ${T('Delete the double')}</label></div>
        <div class="ri-note">✅ ${T('Kept')}: ${what(p.keep)}<br>🗑 ${T('Deleted')}: ${what(p.drop)}</div></div>`).join('');
      const fx = r.effect.map((x) => `<tr><td>${esc(x.space)}</td><td>${T('Balance of {account}', { account: esc(x.name) })}</td><td class="num">${x.delta > 0 ? '+' : ''}${money(x.delta)}</td></tr>`).join('');
      $('#db-out', m).innerHTML = cards
        ? `<div class="ri-list">${cards}</div>` + (fx ? `<div class="small" style="margin-top:12px"><b>${T('Effect on the balances')}</b></div><table class="table small fx-table"><tbody>${fx}</tbody></table>` : '')
        : `<div class="muted small">${T('No money recorded twice found in this account.')}</div>`;
      $$('[data-key]', m).forEach((el) => (el.onchange = async () => { choices[el.dataset.key] = el.checked; await refresh(); }));
      $('#db-go', m).disabled = !r.pairs.some((p) => p.on);
    };
    const refresh = async () => { try { r = await load(); draw(); } catch (e) { $('#db-out', m).innerHTML = `<div class="small neg">${esc(e.message)}</div>`; } };
    $$('#db-days, #db-tol', m).forEach((el) => (el.onchange = () => { days = Math.round(num(m, '#db-days', 31)); tol = num(m, '#db-tol', 100); refresh(); }));
    $('#db-go', m).onclick = async () => {
      if (!(await confirmDialog(T('Apply the changes? A backup of the database is saved first.'), { ok: T('Apply'), danger: false }))) { resolve(); return; }
      try {
        const res = await api(`/accounts/${aid}/doubles`, { method: 'POST', body: { days, tolerance: tol, choices } });
        toast(tn('{n} duplicate removed', '{n} duplicates removed', res.removed)); done();
      } catch (e) { fail(e); }
    };
    draw();
  });
}

// one flow of money between two spaces = one recurring transfer: proposes the records that look like the same money
// (to link, convert or delete) and the recurring items to merge; changes only what the user ticks.
// quiet: open only if there is something to propose. Resolves when the window is closed.
async function reconcileModal(rid, { quiet = false } = {}) {
  const choices = {};
  const num = (m, sel, max) => Math.min(max, Math.max(0, Number($(sel, m).value) || 0));
  let days = 5, tol = 2;
  const load = () => api(`/recurring/${rid}/reconcile`, { method: 'POST', body: { dry_run: true, days, tolerance: tol, choices } });
  let r;
  try { r = await load(); } catch (e) { if (!quiet) fail(e); return; }
  if (quiet && !r.rows.length && !r.recurring.length) return;
  return new Promise((resolve) => {
    const m = openModal(T('Make "{name}" coherent in both spaces', { name: r.name }), `
      <p class="muted small" style="margin-top:0">${T('One flow of money between two spaces is one recurring transfer. Here are the records that look like the same money (similar amount, close date): tick what to fix. Nothing changes until you confirm.')}</p>
      <div class="form-grid">
        <label class="field">${T('Date difference allowed (days)')} <input id="rc-days" type="number" min="0" max="31" step="1" value="${days}"></label>
        <label class="field">${T('Amount difference allowed (%)')} <input id="rc-tol" type="number" min="0" max="100" step="1" value="${tol}"></label>
        <p class="muted small full" style="margin:0">${T('Records whose amount differs from the recurring item by more than 2% are shown in red and are not ticked: tick them only if they are the same money.')}</p>
      </div>
      <div id="rc-out" class="card" style="margin-top:12px"></div>
      <div class="modal-foot"><button class="btn" data-cancel>${T('Not now')}</button>
        <button class="btn btn-primary" id="rc-go">${T('Apply')}</button></div>`, { wide: true });
    const done = () => { closeModal(); resolve(); };
    $('[data-cancel]', m).onclick = done;
    const what = (x) => ({
      lnk: `🔗 ${T('Transfer already recorded: linked to this recurring item')}`,
      cnv: `🔄 ${x.own ? T('Past payment of this recurring item, still an expense: becomes this transfer') : T('Expense: becomes this transfer')}`,
      del: `♊ ${T('Income in {account}: the same money again, deleted', { account: esc(r.to_account) })}`,
      inc: `❔ ${T('Income in {account} with no transfer: tick it only if this money left your account, then it becomes the transfer', { account: esc(r.to_account) })}`,
    }[x.type]);
    const draw = () => {
      const differs = (x) => (x.different ? `<div class="small neg">≠ ${T('Different amount from the recurring item ({amount}): tick it only if it is the same money', { amount: money(r.amount) })}</div>` : '');
      // one card per record: date, description, amount; then the tick and what happens (due date it belongs to)
      const rows = r.rows.map((x) => `<div class="ri ${x.on ? '' : 'off'}"><span class="ri-date">${fmtDate(x.date)}</span><span class="ri-desc">${esc(x.description)}</span>
        <span class="ri-amt ${x.different ? 'neg' : ''}">${money(x.amount)}</span>
        <div class="ri-act"><label><input type="checkbox" data-key="${esc(x.key)}" ${x.on ? 'checked' : ''}> ${what(x)}</label>
          <span class="muted">${T('Due date')}: ${fmtDate(x.due)}</span></div>${x.different ? `<div class="ri-note">${differs(x)}</div>` : ''}</div>`).join('');
      const recs = r.recurring.map((x) => `<div class="ri ${x.on ? '' : 'off'}"><span class="ri-date">${x.kind === 'income' ? '📥' : x.kind === 'expense' ? '📤' : '🔄'} ${FREQ[x.frequency] || ''}</span>
        <span class="ri-desc">${esc(x.name)}</span><span class="ri-amt ${x.different ? 'neg' : ''}">${money(x.amount)}</span>
        <div class="ri-act"><label><input type="checkbox" data-key="${esc(x.key)}" ${x.on ? 'checked' : ''}> ${T('Remove (its past transactions stay)')}</label>
          <span class="muted">📅 ${fmtDate(x.next_date)}</span></div>${x.different ? `<div class="ri-note">${differs(x)}</div>` : ''}</div>`).join('');
      $('#rc-out', m).innerHTML = (r.linked ? `<div class="small">✅ ${tn('{n} due date already linked', '{n} due dates already linked', r.linked)}</div>` : '')
        + (rows ? `<div class="ri-list">${rows}</div>` : '')
        + (recs ? `<div class="small" style="margin-top:12px"><b>${T('Recurring items for the same money: removed if ticked (their past transactions stay). The amount of this recurring transfer is the one that counts.')}</b></div><div class="ri-list">${recs}</div>` : '')
        + (rows || recs ? effectTable(r) : `<div class="muted small">${T('Nothing to fix: this recurring transfer is already coherent in both spaces.')}</div>`);
      $$('[data-key]', m).forEach((el) => (el.onchange = async () => { choices[el.dataset.key] = el.checked; await refresh(); }));
      $('#rc-go', m).disabled = ![...r.rows, ...r.recurring].some((x) => x.on);
    };
    const refresh = async () => { try { r = await load(); draw(); } catch (e) { $('#rc-out', m).innerHTML = `<div class="small neg">${esc(e.message)}</div>`; } };
    $$('#rc-days, #rc-tol', m).forEach((el) => (el.onchange = () => { days = Math.round(num(m, '#rc-days', 31)); tol = num(m, '#rc-tol', 100); refresh(); }));
    $('#rc-go', m).onclick = async () => {
      // the confirmation replaces this window: cancelling ends it (nothing changed), the caller goes on
      if (!(await confirmDialog(T('Apply the changes? A backup of the database is saved first.'), { ok: T('Apply'), danger: false }))) { resolve(); return; }
      try {
        await api(`/recurring/${rid}/reconcile`, { method: 'POST', body: { days, tolerance: tol, choices } });
        toast(T('Recurring transfer made coherent in both spaces')); done();
      } catch (e) { fail(e); }
    };
    draw();
  });
}

// Link transactions already recorded (before the item existed, by hand, imported) to a recurring item. Every row starts
// unticked: the user decides; a real transaction replaces the automatic one of the same due date. quiet = opened right
// after saving a new item: nothing is shown when there is nothing to link.
async function linkModal(rec, { quiet = false } = {}) {
  const on = new Set();
  let days = 5, tol = 2, first = rec.start_date;
  const num = (m, sel, max) => Math.min(max, Math.max(0, Number($(sel, m).value) || 0));
  const load = () => api(`/recurring/${rec.id}/link`, { method: 'POST', body: { dry_run: true, days, tolerance: tol, start_date: first } });
  let r;
  try { r = await load(); } catch (e) { if (!quiet) fail(e); return; }
  if (quiet && !r.rows.length) return;
  return new Promise((resolve) => {
    const m = openModal(T('Link transactions to "{name}"', { name: rec.name }), `
      <p class="muted small" style="margin-top:0">${T('Transactions already recorded that look like the payments of this recurring item (similar amount, close date). Tick the ones that are: they are linked to it. Nothing changes until you confirm.')}</p>
      <div class="form-grid">
        <label class="field">${T('First due date')} <input id="lk-first" type="date" value="${esc(first)}"></label>
        <label class="field">${T('Date difference allowed (days)')} <input id="lk-days" type="number" min="0" max="31" step="1" value="${days}"></label>
        <label class="field">${T('Amount difference allowed (%)')} <input id="lk-tol" type="number" min="0" max="100" step="1" value="${tol}"></label>
        <p class="muted small full" style="margin:0">${T('Moving the first due date earlier lets you link older payments: the due dates before today then count as paid.')}</p>
      </div>
      <div id="lk-out" class="card" style="margin-top:12px"></div>
      <div class="modal-foot"><button class="btn" data-cancel>${T('Not now')}</button>
        <button class="btn" id="lk-same">${T('Tick the ones with the same amount')}</button>
        <button class="btn btn-primary" id="lk-go">${T('Link the ticked ones')}</button></div>`, { wide: true });
    const done = () => { closeModal(); resolve(); };
    $('[data-cancel]', m).onclick = done;
    const draw = () => {
      const rows = r.rows.map((x) => `<div class="ri ${on.has(x.id) ? '' : 'off'}"><span class="ri-date">${fmtDate(x.date)}</span><span class="ri-desc">${esc(x.description)}</span>
        <span class="ri-amt ${x.different ? 'neg' : ''}">${money(x.amount)}</span>
        <div class="ri-act"><label><input type="checkbox" data-id="${x.id}" ${on.has(x.id) ? 'checked' : ''}> ${T('Linked to this recurring item')}</label>
          <span class="muted">${T('Due date')}: ${fmtDate(x.due)}${x.installment ? ` · ${T('installment {n}', { n: x.installment })}` : ''}</span></div>
        ${x.replaces || x.different ? `<div class="ri-note">${x.replaces ? `<div class="small">♊ ${T('It replaces the automatic transaction of that due date ({amount})', { amount: money(x.replaces.amount) })}</div>` : ''}${x.different ? `<div class="small neg">≠ ${T('Different amount from the due date ({amount}): tick it only if it is the same payment', { amount: money(x.due_amount) })}</div>` : ''}</div>` : ''}</div>`).join('');
      $('#lk-out', m).innerHTML = `<div class="small">${tn('{n} due date up to today', '{n} due dates up to today', r.dues)}${r.covered ? ` · ✅ ${tn('{n} already covered by a linked transaction', '{n} already covered by a linked transaction', r.covered)}` : ''}</div>`
        + (rows ? `<div class="ri-list">${rows}</div>` : `<div class="muted small" style="margin-top:8px">${T('No transaction to link: nothing already recorded looks like these payments.')}</div>`);
      $$('[data-id]', m).forEach((el) => (el.onchange = () => { el.checked ? on.add(+el.dataset.id) : on.delete(+el.dataset.id); draw(); }));
      $('#lk-go', m).disabled = !on.size;
      $('#lk-same', m).disabled = !r.rows.some((x) => !x.different && !on.has(x.id));
    };
    const refresh = async () => {
      try { r = await load(); const ids = new Set(r.rows.map((x) => x.id)); [...on].forEach((id) => ids.has(id) || on.delete(id)); draw(); }
      catch (e) { $('#lk-out', m).innerHTML = `<div class="small neg">${esc(e.message)}</div>`; }
    };
    $$('#lk-days, #lk-tol', m).forEach((el) => (el.onchange = () => { days = Math.round(num(m, '#lk-days', 31)); tol = num(m, '#lk-tol', 100); refresh(); }));
    $('#lk-first', m).onchange = (e) => { if (e.target.value) { first = e.target.value; refresh(); } };
    $('#lk-same', m).onclick = () => { r.rows.forEach((x) => x.different || on.add(x.id)); draw(); };
    $('#lk-go', m).onclick = async () => {
      if (!(await confirmDialog(T('Apply the changes? A backup of the database is saved first.'), { ok: T('Apply'), danger: false }))) { resolve(); return; }
      try {
        const pairs = r.rows.filter((x) => on.has(x.id)).map((x) => ({ transaction_id: x.id, due: x.due }));
        const res = await api(`/recurring/${rec.id}/link`, { method: 'POST', body: { pairs, start_date: first !== rec.start_date ? first : null } });
        toast(tn('{n} transaction linked', '{n} transactions linked', pairs.length) + (res.replaced ? ` · ${tn('{n} automatic one replaced', '{n} automatic ones replaced', res.replaced)}` : ''));
        done();
      } catch (e) { fail(e); }
    };
    draw();
  });
}

// ================================================================ budgets
async function renderBudget(v) {
  S.budgetMonth ||= todayIso().slice(0, 7);
  S.budgetAvg ||= '3';
  const d = await api('/budget?' + qs({ month: S.budgetMonth, avg: S.budgetAvg }));
  const avgLabel = S.budgetAvg === 'all' ? tn('Average of all ({n} month)', 'Average of all ({n} months)', d.avg_months) : tn('{n}-month average', '{n}-month average', +S.budgetAvg);
  const withB = d.categories.filter((c) => c.budget > 0), noB = d.categories.filter((c) => !c.budget);
  const totB = withB.reduce((s, c) => s + c.budget, 0), totS = withB.reduce((s, c) => s + c.spent, 0);
  const over = withB.filter((c) => c.spent > c.budget);
  const [y, m] = S.budgetMonth.split('-').map(Number);
  const isCurrent = S.budgetMonth === todayIso().slice(0, 7);
  const elapsed = isCurrent ? new Date().getDate() / new Date(y, m, 0).getDate() : 1;  // share of the month elapsed
  const row = (c) => {
    const r = c.budget ? c.spent / c.budget : 0;
    const state = !c.budget ? '' : r > 1 ? `<span class="tag err">${T('over')}</span>` : r > elapsed + 0.1 ? `<span class="tag warn">${T('ahead')}</span>` : `<span class="tag">${T('ok')}</span>`;
    return `<tr><td><span class="pill quick-filter" style="--c:${esc(c.color)}" ${txLink({ category_id: c.id, kind: 'expense', ...monthBounds(S.budgetMonth), excluded: 0 })}>${esc(c.icon)} ${esc(c.name)}</span></td>
      <td><input class="bd-input" data-cat="${c.id}" inputmode="decimal" value="${c.budget ? moneyInput(c.budget) : ''}" placeholder="—"></td>
      <td class="right"><b>${money0(c.spent)}</b></td><td class="right muted">${money0(c.avg)}</td>
      <td style="min-width:160px">${c.budget ? `<div class="bar ${r > 1 ? 'over' : ''}"><i style="width:${Math.min(100, r * 100).toFixed(1)}%"></i></div><div class="muted small">${T('{percent} of budget', { percent: pct(r) })}</div>` : c.avg ? `<button class="btn btn-sm btn-ghost" data-suggest="${c.id}" data-v="${Math.ceil(c.avg / 1000) * 1000}">${T('Use the average ({amount})', { amount: money0(Math.ceil(c.avg / 1000) * 1000) })}</button>` : ''}</td>
      <td>${state}</td></tr>`;
  };
  v.innerHTML = `
    <div class="toolbar"><input type="month" id="bd-month" value="${esc(S.budgetMonth)}" max="${todayIso().slice(0, 7)}">
      <select id="bd-avg" title="${esc(T('Average to compare against (full months)'))}">${[['3', tn('{n}-month average', '{n}-month average', 3)], ['6', tn('{n}-month average', '{n}-month average', 6)], ['12', tn('{n}-month average', '{n}-month average', 12)], ['all', T('Average of all')]].map(([k, l]) => `<option value="${k}" ${k === S.budgetAvg ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted small">${isCurrent ? T('current month: {percent} elapsed', { percent: pct(elapsed) }) : T('month closed')} · ${T('average calculated over {from} → {to}', { from: esc(fmtDate(d.avg_from)), to: esc(fmtDate(d.avg_to)) })}</span></div>
    <div class="kpis">
      <div class="kpi g-indigo"><div class="k-label">🎯 ${T('Budget for the month')}</div><div class="k-value">${money0(totB)}</div>${kRows([`🏷️ ${T('Categories')}`, withB.length])}</div>
      <div class="kpi g-rose"><div class="k-label">📤 ${T('Spent (budgeted categories)')}</div><div class="k-value">${money0(totS)}</div>${kRows(totB && [`📊 ${T('Of budget')}`, pct(totS / totB)])}</div>
      <div class="kpi g-amber"><div class="k-label">🟢 ${T('Still available')}</div><div class="k-value">${money0(Math.max(0, totB - totS))}</div>
        ${kRows(isCurrent && [`📅 ${T('Days left')}`, new Date(y, m, 0).getDate() - new Date().getDate()], isCurrent && totB > totS && [`👛 ${T('Per day')}`, money0((totB - totS) / Math.max(1, new Date(y, m, 0).getDate() - new Date().getDate() + 1))])}</div>
      <div class="kpi ${over.length ? 'g-rose' : 'g-indigo'}" title="${esc(over.map((c) => c.name).join(', '))}"><div class="k-label">⚠️ ${T('Categories over budget')}</div><div class="k-value">${over.length}</div>
        ${kRows([`🔺 ${T('Over by')}`, money0(over.reduce((s, c) => s + c.spent - c.budget, 0))])}</div>
    </div>
    <div class="card"><div class="card-head"><div><h3>${T('Budget per category')}</h3><p class="muted small" style="margin:3px 0 0">${T('Type the monthly limit next to the category: it saves by itself. "Ahead" = spending faster than the share of the month that has passed.')}</p></div></div>
      <div class="table-wrap"><table class="sp-table"><thead><tr><th>${T('Category')}</th><th>${T('Budget / month')}</th><th class="right">${T('Spent this month')}</th><th class="right">${esc(avgLabel)}</th><th>${T('Progress')}</th><th></th></tr></thead>
      <tbody>${withB.map(row).join('')}${noB.length ? `<tr><td colspan="6" class="muted small" style="padding-top:18px">${T('No budget')}</td></tr>${noB.map(row).join('')}` : ''}</tbody></table></div></div>`;
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
    v.innerHTML = `<div class="card empty"><div class="big">🏦</div><h3>${T('No installment loans')}</h3><p>${T('In Recurring, create an expense with the number of installments, amount financed and rate (fixed, variable or mixed): you will see the amortization schedule here.')}</p>
      <div class="actions"><a class="btn btn-primary" href="#/ricorrenti">${T('Go to Recurring')}</a></div></div>`;
    return;
  }
  const tot = (k) => plans.reduce((s, p) => s + p[k], 0);
  const principal = tot('residual') + tot('capital_paid'), interest = tot('interest_paid') + tot('interest_left');
  v.innerHTML = `
    <div class="kpis">
      <div class="kpi g-indigo" title="${esc(T('principal still to repay'))}"><div class="k-label">🏦 ${T('Total remaining debt')}</div><div class="k-value">${money0(tot('residual'))}</div>${kRows([`🏠 ${T('Loans')}`, plans.length])}</div>
      <div class="kpi g-amber"><div class="k-label">✅ ${T('Principal already repaid')}</div><div class="k-value">${money0(tot('capital_paid'))}</div>${kRows(principal && [`📊 ${T('Of the principal')}`, pct(tot('capital_paid') / principal)])}</div>
      <div class="kpi g-rose"><div class="k-label">💸 ${T('Interest paid')}</div><div class="k-value">${money0(tot('interest_paid'))}</div>${kRows(interest && [`📊 ${T('Of the total interest')}`, pct(tot('interest_paid') / interest)])}</div>
      <div class="kpi g-rose" title="${esc(T('until the end of the schedules'))}"><div class="k-label">⏳ ${T('Interest remaining')}</div><div class="k-value">${money0(tot('interest_left'))}</div>${kRows([`Σ ${T('Total interest')}`, money0(interest)])}</div>
    </div>
    ${plans.map((p, i) => `<div class="card mt-plan" style="margin-bottom:18px">
      <div class="card-head"><div><h3>${esc(p.name)}</h3><p class="muted small" style="margin:3px 0 0">${esc(p.account)} · ${tn('{amount} in {n} installment', '{amount} in {n} installments', p.installments, { amount: money0(p.principal) })} · ${T('rate {rate}', { rate: p.rate_known ? esc(p.rate_label) : `<span class="tag warn">${T('not specified: calculated at 0%')}</span>` })} · ${T('ends {date}', { date: esc(fmtDate(p.end_date)) })}${p.amortization === 'constant' ? `<br>${T('Constant principal: installments go down from {first} to {last}', { first: money0(p.first_installment), last: money0(p.last_installment) })}` : ''}</p></div>
        <a class="btn btn-sm" href="#/movimenti?${qs({ recurring_id: p.id })}">📄 ${T('Installments paid')}</a></div>
      ${p.index_missing ? `<div class="sp-warn card" style="margin-bottom:12px">⚠️ ${T('The current value of the {index} is missing: the variable part of the schedule is indicative (calculated with a 0% index, i.e. spread only, {spread}%).', { index: esc(p.rate_index), spread: decInput(p.spread) })} ${T('Enter it in the mortgage\'s recurring item (Recurring → Edit → Rate).')}</div>` : ''}
      ${p.rate_change ? `<div class="mt-change">🔁 ${((v) => (p.index_missing ? T('From installment {n} ({date}) the rate becomes <b>{rate}%</b> (estimated) and the installment becomes about <b>{amount}</b>.', v)
        : T('From installment {n} ({date}) the rate becomes <b>{rate}%</b> and the installment becomes about <b>{amount}</b>.', v)))(
        { n: p.rate_change.n, date: esc(fmtDate(p.rate_change.date)), rate: num(p.rate_change.rate, 3), amount: money(p.rate_change.installment) })}</div>` : ''}
      <div class="mt-grid">
        <div class="rec-stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <div class="rec-stat"><span>${T('Current installment')}</span><b>${money(p.installment)}</b></div>
          <div class="rec-stat"><span>${T('Current rate')}</span><b>${num(p.current_rate, 3)}%</b></div>
          <div class="rec-stat"><span>${T('Paid')}</span><b>${p.paid} / ${p.installments}</b></div>
          <div class="rec-stat"><span>${T('Remaining')}</span><b>${money0(p.residual)}</b></div>
          <div class="rec-stat"><span>${T('Interest paid')}</span><b>${money0(p.interest_paid)}</b></div>
          <div class="rec-stat"><span>${T('Future interest')}</span><b>${money0(p.interest_left)}</b></div>
        </div>
        <div class="chart-box" style="height:200px"><canvas id="mt-c${i}"></canvas></div>
      </div>
      <details class="mt-sched"><summary>${tn('Full amortization schedule ({n} installment)', 'Full amortization schedule ({n} installments)', p.schedule.length)}</summary>
        <div class="table-wrap" style="max-height:340px;overflow:auto"><table class="sp-table"><thead><tr><th>${T('No.')}</th><th>${T('Date')}</th><th class="right">${T('Interest rate')}</th><th class="right">${T('Installment')}</th><th class="right">${T('Principal')}</th><th class="right">${T('Interest')}</th><th class="right">${T('Remaining')}</th></tr></thead>
        <tbody>${p.schedule.map((r) => `<tr class="${r.n <= p.paid ? 'is-paid' : ''}"><td>${r.n}</td><td>${esc(fmtDate(r.date))}</td><td class="right muted">${num(r.rate, 3)}%</td><td class="right">${money(r.installment)}</td><td class="right">${money(r.capital)}</td><td class="right">${money(r.interest)}</td><td class="right">${money0(r.residual)}</td></tr>`).join('')}</tbody></table></div></details>
    </div>`).join('')}
    <div class="card"><div class="card-head"><div><h3>🧮 ${T('Simulate an early repayment')}</h3><p class="muted small" style="margin:3px 0 0">${T('You pay an extra amount: you can reduce the term (same installment, or the same principal share with constant principal) or the installment (same term).')}</p></div></div>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
        <label class="field">${T('Loan')} <select id="sim-p">${plans.filter((p) => p.paid < p.installments).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field">${T('Extra amount (')}${CUR_SYM}) <input id="sim-x" inputmode="decimal" value="10000"></label>
        <label class="field">${T('After installment no.')} <input id="sim-n" type="number" min="0"></label>
        <label class="field">${T('Goal')} <select id="sim-m"><option value="duration">${T('Reduce the term')}</option><option value="installment">${T('Reduce the installment')}</option></select></label>
      </div>
      <div id="sim-out" style="margin-top:14px"></div></div>`;
  plans.forEach((p, i) => {
    const yearly = {};  // principal and interest per year
    p.schedule.forEach((r) => { const yy = r.date.slice(0, 4); (yearly[yy] ||= { c: 0, i: 0 }); yearly[yy].c += r.capital; yearly[yy].i += r.interest; });
    const years = Object.keys(yearly);
    chart($(`#mt-c${i}`), {
      type: 'bar',
      data: { labels: years, datasets: [
        { label: T('Principal'), data: years.map((yy) => yearly[yy].c), backgroundColor: '#7b52ab', borderRadius: 3, maxBarThickness: 18 },
        { label: T('Interest'), data: years.map((yy) => yearly[yy].i), backgroundColor: '#f59f45', borderRadius: 3, maxBarThickness: 18 }] },
      options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (x) => moneyK(x) } } },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } },
    });
  });
  const sim = debounce(async () => {
    if (!$('#sim-p')) return;  // the page was left before the delayed calculation started
    const p = plans.find((x) => x.id === +$('#sim-p').value);
    if (!p) return;
    if ($('#sim-n').value === '') $('#sim-n').value = p.paid;
    try {
      const r = await api('/tools/mortgage/simulate', { method: 'POST', body: { recurring_id: p.id, extra: parseMoney($('#sim-x').value), after_payment: +$('#sim-n').value, mode: $('#sim-m').value } });
      if (!$('#sim-out')) return;  // left while waiting for the answer
      $('#sim-out').innerHTML = calcNotes(r.notes) + (r.closed ? `<div class="sp-warn card">🎉 ${T('With this amount the loan is paid off: you save {amount} in interest.', { amount: money0(r.interest_saved) })}</div>`
        : `<div class="rec-stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
            <div class="rec-stat"><span>${T('Interest saved')}</span><b class="pos">${money0(r.interest_saved)}</b></div>
            <div class="rec-stat"><span>${T('New installment')}</span><b>${money(r.new_installment)}</b></div>
            <div class="rec-stat"><span>${T('Installments left')}</span><b>${r.new_remaining}${r.months_saved ? ` (−${r.months_saved})` : ''}</b></div>
            <div class="rec-stat"><span>${T('New end date')}</span><b>${esc(fmtDate(r.new_end))}</b></div></div>`);
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
    <div class="card" style="margin-bottom:18px"><div class="card-head"><div><h3>🛟 ${family ? T('Household emergency fund') : T('Emergency fund')}</h3>
      <p class="muted small" style="margin:3px 0 0">${tn('How many months of expenses the <b>available reserve</b> would cover: the accounts plus uninvested broker cash and money market ETFs (available within a few days), using the average spending of the last {n} month. Stocks, bonds and funds do not count.',
        'How many months of expenses the <b>available reserve</b> would cover: the accounts plus uninvested broker cash and money market ETFs (available within a few days), using the average spending of the last {n} months. Stocks, bonds and funds do not count.', em.months_basis)}</p></div>
      <label class="field" style="flex-direction:row;align-items:center;gap:8px">${T('Target')} <input id="em-target" type="number" min="1" max="36" step="1" value="${em.target_months}" style="width:70px"> ${T('months')}</label></div>
      ${calcNotes(em.notes)}
      <div class="em-grid">
        <div class="em-big"><div class="em-months ${ratio >= 1 ? 'pos' : ratio >= 0.5 ? '' : 'neg'}">${months == null ? '—' : num(months)}</div><div class="muted">${T('months covered')}</div></div>
        <div style="flex:1;min-width:0">
          <div class="budget-row" style="padding-top:0"><div class="top"><span>${T('Available reserve')} <b>${money0(em.liquidity)}</b></span><span class="muted">${T('target')} ${money0(em.target_amount)}</span></div>
            <div class="bar ${ratio < 0.5 ? 'over' : ''}"><i style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></i></div></div>
          <div class="rec-stats" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:8px">
            <div class="rec-stat"><span>${T('Average spending / month')}</span><b>${money0(em.avg_expenses)}</b></div>
            <div class="rec-stat"><span>${T('Fixed expenses only')}</span><b>${money0(em.fixed_monthly)} → ${em.months_fixed == null ? '—' : tn('{n} month', '{n} months', em.months_fixed, { n: num(em.months_fixed) })}</b></div>
            <div class="rec-stat"><span>${T('Missing')}</span><b>${money0(Math.max(0, em.target_amount - em.liquidity))}</b></div></div>
          <div class="em-parts">
            <div class="em-part"><span>💧 ${T('Cash in accounts')} <span class="muted small">${T('(the same as in the Calendar)')}</span></span><b>${money0(em.operational)}</b>
              <div class="muted small">${em.accounts.filter((a) => a.group === 'conti').map((a) => `${esc(a.name)} ${money0(a.balance)}`).join(' · ') || '—'}</div></div>
            <div class="em-part"><span>📈 ${T('Broker: cash and money market')}</span><b>${em.broker_cash ? '+' + money0(em.broker_cash) : '—'}</b>
              <div class="muted small">${em.accounts.filter((a) => a.group === 'broker').map((a) => `${esc(a.name)} ${money0(a.balance)}`).join(' · ') || T('none')}</div></div>
            <div class="em-part total"><span>🛟 ${T('Available reserve')}</span><b>${money0(em.liquidity)}</b></div>
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
  // summary of all the goals: how much in total, how much already there, how far, how many reached
  const target = goals.reduce((s, gl) => s + gl.target, 0), current = goals.reduce((s, gl) => s + Math.min(gl.current, gl.target), 0);
  const reached = goals.filter((gl) => gl.progress >= 1).length;
  const monthly = goals.reduce((s, gl) => s + (gl.progress < 1 && gl.monthly_needed ? gl.monthly_needed : 0), 0);
  v.innerHTML = `
    ${goals.length ? `<div class="kpis">
      <div class="kpi g-indigo"><div class="k-label">🏁 ${T('All goals')}</div><div class="k-value">${money0(target)}</div>${kRows([`⏳ ${T('Still to go')}`, money0(Math.max(0, target - current))])}</div>
      <div class="kpi g-amber"><div class="k-label">🐷 ${T('Already set aside')}</div><div class="k-value">${money0(current)}</div>${kRows([`📊 ${T('Of the total')}`, pct(target ? current / target : 0)])}</div>
      <div class="kpi g-amber" title="${esc(T('for the goals with a date'))}"><div class="k-label">📅 ${T('To set aside each month')}</div><div class="k-value">${money0(monthly)}</div>${kRows([`🎯 ${T('Goals with a date')}`, goals.filter((gl) => gl.progress < 1 && gl.monthly_needed).length])}</div>
      <div class="kpi g-indigo"><div class="k-label">✅ ${T('Goals reached')}</div><div class="k-value">${reached}</div>${kRows([`🏁 ${T('Goals')}`, goals.length])}</div>
    </div>` : ''}
    <div class="toolbar"><h3 style="margin:0">🏁 ${family ? T('Shared goals') : T('Savings goals')}</h3><span class="spacer"></span><button class="btn btn-primary" id="gl-new">＋ ${T('New goal')}</button></div>
    <div class="rec-grid">${goals.map((gl) => `<div class="card rec-card">
      <div class="rec-head"><div class="cat-ico" style="--c:${esc(gl.color)}">${esc(gl.icon)}</div>
        <div class="grow" style="min-width:0"><div class="title ellipsis">${esc(gl.name)}</div><div class="muted small">${gl.account_id ? T('balance of {account}', { account: esc(gl.account_name) }) : T('amount set aside by hand')}${gl.target_date ? ` · ${T('by {date}', { date: esc(fmtDate(gl.target_date)) })}` : ''}</div></div></div>
      <div class="rec-line"><span class="rec-amount">${money0(gl.current)}</span><span class="rec-next">${T('of {amount}', { amount: money0(gl.target) })}</span></div>
      <div class="rec-progress"><div class="top small"><span>${T('{percent} reached', { percent: pct(gl.progress) })}</span><span class="muted">${T('{amount} to go', { amount: money0(gl.missing) })}</span></div>
        <div class="bar"><i style="width:${(gl.progress * 100).toFixed(1)}%"></i></div></div>
      <div class="rec-stats">${gl.target_date ? `<div class="rec-stat"><span>${T('Per month')}</span><b>${money0(gl.monthly_needed)}</b></div><div class="rec-stat"><span>${T('Months')}</span><b>${gl.months_left}</b></div>` : `<div class="rec-stat"><span>${T('Deadline')}</span><b>${T('none')}</b></div><div class="rec-stat"><span></span><b></b></div>`}
        <div class="rec-stat"><span>${gl.per_person ? T('Each') : ''}</span><b>${gl.per_person ? gl.per_person.map((p) => `${esc(p.name)} ${money0(p.monthly)}`).join(' · ') : ''}</b></div></div>
      ${calcNotes(gl.notes)}
      <div class="rec-actions"><button class="btn btn-sm" data-gl="${gl.id}">✏️ ${T('Edit')}</button></div></div>`).join('')
      || `<div class="card empty"><div class="big">🏁</div><h3>${T('No goals')}</h3><p>${family ? T('Holiday, new car, home improvements…') : T('Trip, car, course, home down payment…')} ${T('Set the amount and the date: HomeCoin calculates how much to set aside each month')}${family ? T(' and each person\'s share based on income') : ''}.</p></div>`}</div>`;
  $('#gl-new').onclick = () => goalModal();
  $$('[data-gl]', v).forEach((b) => (b.onclick = () => goalModal(goals.find((x) => x.id === +b.dataset.gl))));
}

function goalModal(gl = null) {
  const x = gl || { name: '', icon: '🎯', color: PALETTE[Math.floor(Math.random() * PALETTE.length)], target: 0, saved: 0 };
  const accs = S.accounts.filter((a) => !a.archived || a.id === x.account_id);
  const m = openModal(gl ? T('Edit goal') : T('New goal'), `
    <div class="form-grid">
      <label class="field full">${T('Name')} <input id="gl-name" maxlength="60" value="${esc(x.name)}" placeholder="${esc(T('E.g. Summer holiday, New car'))}" autofocus></label>
      <label class="field">${T('Target amount (')}${CUR_SYM}) <input id="gl-target" inputmode="decimal" value="${moneyInput(x.target)}"></label>
      <label class="field">${T('By (optional)')} <input id="gl-date" type="date" value="${esc(x.target_date || '')}"></label>
      <label class="field full">${T('How progress is measured')} <select id="gl-acc"><option value="">${T('Amount set aside, entered by hand')}</option>
        ${accs.map((a) => `<option value="${a.id}" ${a.id === x.account_id ? 'selected' : ''}>${T('Balance of the account')} ${esc(a.name)}</option>`).join('')}</select></label>
      <label class="field" id="gl-saved-wrap">${T('Set aside so far (')}${CUR_SYM}) <input id="gl-saved" inputmode="decimal" value="${moneyInput(x.saved)}"></label>
      <div class="field full">${T('Color')} ${swatchPicker('gl-color', x.color)}</div>
      <div class="field full">${T('Icon')} ${emojiPicker('gl-icon', x.icon)}</div>
    </div>
    <div class="modal-foot">${gl ? `<button class="btn btn-ghost left neg" id="gl-del">🗑 ${T('Delete')}</button>` : ''}
      <button class="btn" data-cancel>${T('Cancel')}</button><button class="btn btn-primary" id="gl-save">${T('Save')}</button></div>`);
  const getColor = bindSwatches($('#gl-color', m)), getIcon = bindEmoji($('#gl-icon', m));
  const sync = () => $('#gl-saved-wrap', m).classList.toggle('hidden', !!$('#gl-acc', m).value);
  $('#gl-acc', m).onchange = sync; sync();
  $('[data-cancel]', m).onclick = closeModal;
  $('#gl-save', m).onclick = async () => {
    const body = { name: $('#gl-name', m).value, target: parseMoney($('#gl-target', m).value), target_date: $('#gl-date', m).value || null,
      account_id: $('#gl-acc', m).value || null, saved: parseMoney($('#gl-saved', m).value) || 0, color: getColor(), icon: getIcon() };
    try { await api(gl ? `/goals/${gl.id}` : '/goals', { method: gl ? 'PUT' : 'POST', body }); toast(T('Goal saved')); closeModal(); route(); } catch (e) { fail(e); }
  };
  if (gl) $('#gl-del', m).onclick = async () => {
    if (!(await confirmDialog(T('Delete the goal "{name}"?', { name: gl.name }), { ok: T('Delete') }))) return;
    try { await api(`/goals/${gl.id}`, { method: 'DELETE' }); toast(T('Goal deleted')); route(); } catch (e) { fail(e); }
  };
}

// ================================================================ investments
// asset class codes (stored and sent by the server in Italian); ASSET_LABEL gives the text shown to the user
const ASSET_CLASSES = ['azioni', 'obbligazioni', 'monetario', 'materie prime', 'immobiliare', 'crypto', 'altro'];  // i18n-skip (stored codes)
const ASSET_LABEL = { azioni: T('Stocks'), obbligazioni: T('Bonds'), monetario: T('Money market'), 'materie prime': T('Commodities'), immobiliare: T('Real estate'),
  crypto: T('Crypto'), altro: T('Other'), 'non specificato': T('Unspecified'), 'liquidità': T('Cash') };
const assetLabel = (c) => ASSET_LABEL[c] || c;
// the class changes the behavior: money market funds are cash (they do not count as invested and count toward the emergency fund)
const CLASS_HELP = {
  monetario: `💧 ${T('<b>Money market</b>: it is parked cash. Buying or selling it does <b>not</b> count as invested, and it counts toward the emergency fund.')}`,
  azioni: `📈 ${T('Investment: purchases and sales count as <b>invested</b>.')}`, obbligazioni: `📈 ${T('Investment: purchases and sales count as <b>invested</b>.')}`,
  'materie prime': `📈 ${T('Investment: purchases and sales count as <b>invested</b>.')}`, immobiliare: `📈 ${T('Investment: purchases and sales count as <b>invested</b>.')}`,
  crypto: `📈 ${T('Investment: purchases and sales count as <b>invested</b>.')}`, altro: `📈 ${T('Investment: purchases and sales count as <b>invested</b>.')}`,
};
const ASSET_COLORS = { azioni: '#7b52ab', obbligazioni: '#3f86dc', monetario: '#2fbf71', 'materie prime': '#fcc419', immobiliare: '#f59f45', crypto: '#e45bc4', altro: '#8b8fa8', 'non specificato': '#c9976a', 'liquidità': '#94a3b8' };
const pctSigned = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${num(x * 100, 2)}%`);

async function renderInvestimenti(v) {
  S.invMonths ||= '24';
  const d = await api('/investments?months=' + S.invMonths);
  if (!d.accounts.length) {
    v.innerHTML = `<div class="card empty"><div class="big">📊</div><h3>${T('No investment accounts')}</h3>
      <p>${T('Create an account of type <b>Investment account</b> (broker, pension fund, investment plan…). Record contributions as transfers from your current account and update the value: HomeCoin calculates gain and return.')}</p>
      <div class="actions"><button class="btn btn-primary" id="iv-new">＋ ${T('New investment account')}</button></div></div>`;
    $('#iv-new').onclick = () => accountModal(null, { type: 'investimenti', icon: '📈', name: '' });
    return;
  }
  const hasHoldings = d.accounts.some((a) => a.holdings.length);
  S.invAccounts = d.accounts;
  const pending = d.pac_pending || [];
  const unverified = d.pac_unverified || [];
  v.innerHTML = `
    <div class="kpis">
      <div class="kpi g-indigo"><div class="k-label">📊 ${T('Current value')}</div><div class="k-value">${money0(d.total_value)}</div>${kRows([`🏦 ${T('Accounts')}`, d.accounts.length])}</div>
      <div class="kpi g-indigo" title="${esc(T('capital put in'))}"><div class="k-label">💶 ${T('Net invested')}</div><div class="k-value">${money0(d.total_invested)}</div>${kRows([`📄 ${T('Securities')}`, d.accounts.reduce((s, a) => s + a.holdings.length, 0)])}</div>
      <div class="kpi ${d.total_gain >= 0 ? 'g-emerald' : 'g-rose'}"><div class="k-label">${d.total_gain >= 0 ? '📈' : '📉'} ${T('Gain')}</div><div class="k-value">${d.total_gain >= 0 ? '+' : ''}${money0(d.total_gain)}</div>${kRows(d.total_return != null && [`📊 ${T('On invested')}`, pctSigned(d.total_return)])}</div>
      <div class="kpi ${d.total_xirr == null ? 'g-indigo' : d.total_xirr >= 0 ? 'g-emerald' : 'g-rose'}" title="${esc(T('XIRR, accounts for when you invested'))}"><div class="k-label">⏱️ ${T('Annual return')}</div><div class="k-value">${pctSigned(d.total_xirr)}</div>${kRows([`🧮 ${T('Method')}`, 'XIRR'])}</div>
    </div>
    ${pending.length ? `<div class="card" style="margin-bottom:18px;border-color:var(--amber)"><div class="card-head"><h3>⏳ ${T('Investment plan purchases to complete')}</h3>
      <span class="muted small">${T('contribution made, but no known price to calculate the units')}</span></div>
      <div class="list">${pending.map((p, i) => `<div class="list-item"><div class="grow"><b>${esc(p.name)}</b><div class="muted small">${esc(fmtDate(p.date))} · ${esc(p.ticker)}</div></div>
        <b>${money(p.amount)}</b><button class="btn btn-sm btn-primary" data-pac="${i}">${T('Record purchase')}</button></div>`).join('')}</div></div>` : ''}
    ${unverified.length ? `<div class="card" style="margin-bottom:18px;border-color:var(--amber)"><div class="card-head"><h3>⚠️ ${T('Investment plan prices to verify')}</h3>
      <span class="muted small">${T('automatic purchases with an estimated price for more than 30 days: enter the actual price and units from the broker statement')}</span></div>
      <div class="list">${unverified.map((o, i) => `<div class="list-item"><div class="grow"><b>${esc(o.ticker || '')}</b> <span class="muted small">${esc(o.account_name)}</span><div class="muted small">${esc(fmtDate(o.date))} · ${T('estimated {price}', { price: esc(unitPrice(o.price)) })} · ${tn('{n} unit', '{n} units', o.quantity, { n: qtyFmt(o.quantity) })}</div></div>
        <b>${money(Math.abs(o.amount))}</b><button class="btn btn-sm btn-primary" data-pacv="${i}">✏️ ${T('Verify')}</button></div>`).join('')}</div></div>` : ''}`
    + `
    <div class="toolbar"><details class="help" style="flex:1 1 260px"><summary>ℹ️ ${T('How it works')}</summary><p>${T('Value = latest valuation (automatic from securities or entered by hand). Invested = net transfers/income into the account.')}</p></details>
      <span class="btn-row">${hasHoldings ? `<button class="btn" id="iv-refresh" title="${esc(T('Uses the internet: it sends only the tickers to Yahoo Finance'))}">🌐 ${T('Update prices')}</button>` : ''}
      <button class="btn btn-primary" id="iv-new">＋ ${T('Investment account')}</button></span></div>
    <div class="grid-3-2">
      <div class="card"><div class="card-head"><h3>${T('Value and invested over time')}</h3>
        <select id="iv-months" style="width:auto">${[['12', T('Last 12 months')], ['24', T('Last 24 months')], ['36', T('Last 36 months')], ['all', T('All')]].map(([k, l]) => `<option value="${k}" ${k === S.invMonths ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="chart-box"><canvas id="iv-line"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>${T('Allocation')}</h3></div>${d.allocation.length ? `<div class="chart-box" style="height:220px"><canvas id="iv-alloc"></canvas></div>
        <div class="legend" style="margin-top:10px">${d.allocation.map((x) => `<div class="legend-item"><span class="dot" style="background:${ASSET_COLORS[x.name] || '#8b8fa8'}"></span><span>${esc(assetLabel(x.name))}<span class="pct">${pct(x.value / d.allocation.reduce((s, y) => s + y.value, 0))}</span></span><b class="num">${money0(x.value)}</b></div>`).join('')}</div>`
        : `<div class="empty">${T('Add securities to see the allocation')}</div>`}</div>
    </div>
    <details class="card rb-card" id="rb" ${S.rbOpen ? 'open' : ''}><summary class="card-head"><div><h3>🧭 ${T('Rebalancing')}</h3>
      <p class="muted small" style="margin:3px 0 0">${T('Target allocation, drift and what to buy or sell to get back to it. A calculator: it records nothing.')}</p></div>
      <span class="rb-status muted small"></span></summary><div class="rb-body"><div class="loading">${T('Loading…')}</div></div></details>
    ${d.accounts.map((a) => `<div class="card" style="margin-bottom:18px">
      <div class="card-head"><div><h3>${esc(a.icon)} ${esc(a.name)}</h3><p class="muted small" style="margin:3px 0 0">${a.has_trades ? T('value = cash + securities (from trades)') : a.value_date ? T('value as of {date}', { date: esc(fmtDate(a.value_date)) }) : `<span class="tag warn">${T('no valuation: showing the book balance')}</span>`}</p>
        ${a.idle ? `<p class="small" style="margin:6px 0 0"><span class="tag warn">💤 ${tn('{amount} of cash idle for {n} day', '{amount} of cash idle for {n} days', a.idle.days, { amount: money(a.idle.cash) })}</span> <span class="muted">${T('if you have already invested it, record the purchase with "＋ Trade"')}</span></p>` : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${a.has_trades ? '' : `<button class="btn btn-sm" data-val="${a.id}">＋ ${T('Manual value')}</button>`}<button class="btn btn-sm" data-hold="${a.id}">＋ ${T('Security')}</button><button class="btn btn-sm btn-primary" data-trade="${a.id}">＋ ${T('Trade')}</button></div></div>
      <div class="rec-stats" style="grid-template-columns:repeat(${a.has_trades ? 7 : 5},minmax(0,1fr))">
        <div class="rec-stat"><span>${T('Value')}</span><b>${money0(a.value)}</b></div><div class="rec-stat"><span>${T('Invested')}</span><b>${money0(a.invested)}</b></div>
        <div class="rec-stat"><span>${T('Gain')}</span><b class="${a.gain >= 0 ? 'pos' : 'neg'}">${a.gain >= 0 ? '+' : ''}${money0(a.gain)}</b></div>
        <div class="rec-stat"><span>${T('Return')}</span><b>${pctSigned(a.return)}</b></div><div class="rec-stat"><span>${T('Annual (XIRR)')}</span><b>${pctSigned(a.xirr)}</b></div>
        ${a.has_trades ? `<div class="rec-stat"><span>${T('Cash')}</span><b>${money(a.cash)}</b></div><div class="rec-stat"><span>${T('Realized gains')}</span><b class="${a.realized >= 0 ? 'pos' : 'neg'}">${a.realized >= 0 ? '+' : ''}${money0(a.realized)}</b></div>` : ''}</div>
      ${holdingsTable(a)}
      ${a.has_trades ? `<details class="mt-sched" data-trades="${a.id}"><summary>${T('Trades')}</summary><div class="trades-box"><div class="loading">${T('Loading…')}</div></div></details>` : ''}
      ${a.valuations.length && !a.has_trades ? `<details class="mt-sched"><summary>${T('Valuation history (')}${a.valuations.length})</summary><div class="list">${a.valuations.slice().reverse().map((x) => `<div class="list-item">
        <span class="grow">${esc(fmtDate(x.date))} <span class="tag">${x.source === 'auto' ? T('automatic') : T('by hand')}</span></span><b>${money0(x.value)}</b><button class="icon-btn sm" data-vdel="${x.id}" title="${esc(T('Delete'))}">✕</button></div>`).join('')}</div></details>` : ''}
    </div>`).join('')}`;

  $('#iv-new').onclick = () => accountModal(null, { type: 'investimenti', icon: '📈', name: '' });
  const rb = $('#rb');
  rb.addEventListener('toggle', () => { S.rbOpen = rb.open; if (rb.open && !rb.dataset.ready) { rb.dataset.ready = '1'; rebalanceCard(rb); } });
  if (rb.open) { rb.dataset.ready = '1'; rebalanceCard(rb); }
  $('#iv-months').onchange = (e) => { S.invMonths = e.target.value; route(); };
  if ($('#iv-refresh')) $('#iv-refresh').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = T('⏳ Updating…');
    try {
      const r = await api('/investments/refresh', { method: 'POST' });
      toast(r.errors.length ? `${tn('{n} security updated', '{n} securities updated', r.updated)} · ${tn('{n} error', '{n} errors', r.errors.length)}`
        : tn('Prices updated ({n} security)', 'Prices updated ({n} securities)', r.updated), r.errors.length ? 'err' : 'ok');
      if (r.errors.length) console.warn(r.errors);
      route();
    } catch (err) { fail(err); e.target.disabled = false; }
  };
  $$('[data-val]', v).forEach((b) => (b.onclick = () => valuationModal(+b.dataset.val)));
  $$('[data-hold]', v).forEach((b) => (b.onclick = () => holdingModal(+b.dataset.hold)));
  $$('[data-trade]', v).forEach((b) => (b.onclick = () => tradeModal(d.accounts.find((a) => a.id === +b.dataset.trade))));
  $$('[data-pac]', v).forEach((b) => (b.onclick = () => {
    const p = pending[+b.dataset.pac], acc = d.accounts.find((a) => a.id === p.account_id);
    if (acc) tradeModal(acc, null, { kind: 'buy', date: p.date, holding_id: p.holding_id, amount: -p.amount, notes: `${T('Investment plan «')}${p.name}»`,
      external_id: `pac:${p.recurring_id}:${p.date}` });
  }));
  $$('[data-pacv]', v).forEach((b) => (b.onclick = () => {
    const o = unverified[+b.dataset.pacv], acc = d.accounts.find((a) => a.id === o.account_id);
    if (acc) tradeModal(acc, o);
  }));
  $$('[data-trades]', v).forEach((det) => det.addEventListener('toggle', () => det.open && loadTrades(det, +det.dataset.trades), { once: true }));
  $$('[data-hedit]', v).forEach((b) => (b.onclick = () => holdingModal(+b.dataset.acc, d.accounts.flatMap((a) => a.holdings).find((h) => h.id === +b.dataset.hedit))));
  $$('[data-vdel]', v).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(T('Delete this valuation?'), { ok: T('Delete') }))) return;
    try { await api(`/valuations/${b.dataset.vdel}`, { method: 'DELETE' }); route(); } catch (e) { fail(e); }
  }));
  const s = d.series.filter((x) => x.invested || x.value);
  chart($('#iv-line'), {
    type: 'line',
    data: { labels: s.map((x) => fmtMonth(x.month)), datasets: [
      { label: T('Value'), data: s.map((x) => x.value), borderColor: '#7b52ab', backgroundColor: (ctx) => vGradient(ctx, '#7b52ab'), fill: true, tension: .3, borderWidth: 2, pointRadius: 3 },
      { label: T('Invested'), data: s.map((x) => x.invested), borderColor: '#8b8fa8', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .3 }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: (x) => moneyK(x) } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } },
  });
  if (d.allocation.length) chart($('#iv-alloc'), {
    type: 'doughnut', data: { labels: d.allocation.map((x) => assetLabel(x.name)), datasets: [{ data: d.allocation.map((x) => x.value), backgroundColor: d.allocation.map((x) => ASSET_COLORS[x.name] || '#8b8fa8'), borderColor: css('--surface'), borderWidth: 2 }] },
    options: { cutout: '65%', maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

const qtyFmt = (q) => num(q, 6);

// rebalancing calculator: targets per asset class or per security, drift thresholds, buys only (new money) or buys and sells
// warnings and notes of a calculator, from the server: [{level: 'warn' | 'info', text}]
function calcNotes(notes) {
  return notes?.length ? `<ul class="calc-notes">${notes.map((w) => `<li class="${w.level === 'warn' ? 'warn' : 'info'}">${w.level === 'warn' ? '⚠️' : 'ℹ️'} ${esc(w.text)}</li>`).join('')}</ul>` : '';
}
async function rebalanceCard(det) {
  const box = $('.rb-body', det);
  let cfg, res;
  const pct1 = (x) => `${num(x, 1)}%`;
  const calc = async (save = false) => {
    try {
      const r = await api('/investments/rebalance', { method: 'POST', body: { ...cfg, save } });
      ({ config: cfg, result: res } = r);
      draw();
      if (save) toast(T('Rebalancing settings saved'));
    } catch (e) { fail(e); }
  };
  const label = (r) => {
    if (r.kind === 'security') return `<b>${esc(r.label)}</b><div class="muted small">${esc(r.name || '')}${r.name ? ' · ' : ''}${esc(r.account)} · ${esc(assetLabel(r.asset_class))}</div>`;
    if (r.kind === 'account') return `<b>${esc(r.label)}</b><div class="muted small">${T('account valued as a whole')}</div>`;
    return `<span class="dot" style="background:${ASSET_COLORS[r.key] || '#8b8fa8'}"></span> <b>${esc(assetLabel(r.key === 'cash' ? 'liquidità' : r.key))}</b>${r.kind === 'cash' ? `<div class="muted small">${T('uninvested cash on the broker')}</div>` : ''}`;
  };
  const trade = (r) => {
    if (!r.trade) return '<span class="muted">—</span>';
    const verb = r.kind === 'cash' ? (r.trade > 0 ? T('Keep') : T('Use')) : r.trade > 0 ? T('Buy') : T('Sell');
    const parts = (r.holdings || []).filter((x) => x.trade).map((x) => `${esc(x.ticker)} ${x.trade > 0 ? '+' : '−'}${esc(money0(Math.abs(x.trade)))}${x.units ? ` (≈ ${qtyFmt(Math.abs(x.units))})` : ''}`);
    const hint = r.units ? `≈ ${tn('{n} unit', '{n} units', Math.abs(r.units), { n: qtyFmt(Math.abs(r.units)) })}` : parts.length ? parts.join(' · ')
      : r.kind === 'class' && r.trade > 0 ? T('no security of this class yet: choose one') : '';
    return `<b class="${r.trade > 0 ? 'pos' : 'neg'}">${verb} ${esc(money0(Math.abs(r.trade)))}</b>${hint ? `<div class="muted small">${hint}</div>` : ''}`;
  };
  const draw = () => {
    const tg = cfg.targets[cfg.mode] || {};
    const chosen = cfg.accounts == null ? null : new Set(cfg.accounts);
    const status = !res.total ? T('No investments to rebalance in the accounts chosen')
      : !res.has_targets ? T('Targets: {percent} of 100%', { percent: pct1(res.sum_targets) })
        : res.needs_rebalance ? `⚠️ ${tn('Rebalancing needed · largest drift {n} point', 'Rebalancing needed · largest drift {n} points', Math.round(res.max_drift * 10) / 10, { n: num(res.max_drift, 1) })}`
          : `✅ ${tn('Within the thresholds · largest drift {n} point', 'Within the thresholds · largest drift {n} points', Math.round(res.max_drift * 10) / 10, { n: num(res.max_drift, 1) })}`;
    $('.rb-status', det).innerHTML = `<span class="tag ${res.has_targets ? (res.needs_rebalance ? 'warn' : 'ai') : ''}">${esc(status)}</span>`;
    const noTrades = res.has_targets && res.needs_rebalance && !cfg.sells && !res.contribution;
    const focus = snapFocus(box);
    box.innerHTML = `<div class="rb-controls">
        <div class="seg" id="rb-mode">${[['class', T('By asset class')], ['security', T('By security')]].map(([k, l]) => `<button data-m="${k}" class="${cfg.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="rb-accs">${res.accounts.map((a) => `<label class="check"><input type="checkbox" data-acc="${a.id}" ${!chosen || chosen.has(a.id) ? 'checked' : ''}> ${esc(a.icon)} ${esc(a.name)} <span class="muted small">${esc(money0(a.value))}</span></label>`).join('')}</div>
      </div>
      <div class="rb-controls">
        <label class="field">${T('Drift threshold (points)')} <input id="rb-abs" inputmode="decimal" value="${cfg.drift_abs ?? ''}" placeholder="off" title="${esc(T('Rebalance when a weight is this many percentage points away from its target'))}"></label>
        <label class="field">${T('or relative (% of the target)')} <input id="rb-rel" inputmode="decimal" value="${cfg.drift_rel ?? ''}" placeholder="off" title="${esc(T('e.g. 25: a 20% target is off below 15% or above 25%'))}"></label>
        <label class="field">${T('New money to invest (')}${CUR_SYM}) <input id="rb-new" inputmode="decimal" value="${moneyInput(cfg.contribution)}" placeholder="${moneyPlaceholder()}"></label>
        <label class="check" title="${esc(T('Without sells, only the new money is used, on the items below target'))}"><input type="checkbox" id="rb-sells" ${cfg.sells ? 'checked' : ''}> ${T('Allow sells (exactly back to the targets)')}</label>
      </div>
      ${calcNotes(res.warnings)}
      <div class="table-wrap"><table class="sp-table inv-table rb-table"><thead><tr><th title="${esc(T('Count it in the calculation'))}">${T('Count')}</th><th>${cfg.mode === 'class' ? T('Asset class') : T('Security')}</th><th class="right">${T('Value')}</th><th class="right">${T('Now')}</th>
        <th class="right">${T('Target %')}</th><th class="right">${T('Drift')}</th><th>${T('To do')}</th><th class="right">${T('After')}</th></tr></thead><tbody>
        ${res.rows.map((r) => `<tr class="${r.off ? 'rb-off' : ''}"><td><input type="checkbox" class="rb-in" data-k="${esc(r.key)}" data-via="${cfg.mode}" checked title="${esc(T('Count it in the calculation'))}"></td>
          <td>${label(r)}</td><td class="num right">${esc(money0(r.value))}</td><td class="num right">${pct1(r.pct)}</td>
          <td class="right"><input class="rb-t" data-k="${esc(r.key)}" inputmode="decimal" value="${tg[r.key] != null ? num(tg[r.key], 2) : ''}" placeholder="0"></td>
          <td class="num right ${r.off ? 'neg' : 'muted'}">${r.target || r.value ? `${r.drift > 0 ? '+' : ''}${num(r.drift, 1)}` : ''}${r.off ? ' ⚠️' : ''}</td>
          <td>${trade(r)}</td><td class="num right">${r.trade ? pct1(r.after_pct) : ''}</td></tr>`).join('')}
        ${res.excluded.map((r) => `<tr class="rb-out"><td><input type="checkbox" class="rb-in" data-k="${esc(r.key)}" data-via="${r.via}" title="${esc(T('Count it again'))}"></td>
          <td>${label(r)}<div class="muted small">${T('not counted')}${r.via === 'security' && cfg.mode === 'class' ? ' (excluded in "By security")' : ''}</div></td>
          <td class="num right">${esc(money0(r.value))}</td><td colspan="5"></td></tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td>${T('Total')}${res.excluded_total ? `<div class="muted small">${T('not counted:')} ${esc(money0(res.excluded_total))}</div>` : ''}</td><td class="num right">${esc(money0(res.total))}</td><td></td><td class="num right ${res.has_targets ? '' : 'neg'}">${pct1(res.sum_targets)}</td><td></td>
          <td>${res.contribution ? `+ ${T('{amount} new money', { amount: esc(money0(res.contribution)) })}` : ''}</td><td class="num right">${res.contribution ? esc(money0(res.total_after)) : ''}</td></tr></tfoot></table></div>
      ${res.missing.length ? `<p class="small"><span class="tag warn">${T('Targets not used')}</span> ${res.missing.map((m) => `${esc(m.label)} ${pct1(m.target)}`).join(' · ')} <span class="muted">${T('(security no longer owned or account not counted)')}</span> <button class="btn btn-sm" id="rb-drop">${T('Remove them')}</button></p>` : ''}
      ${noTrades ? `<p class="muted small">${T('To see the trades, enter the new money to invest or allow sells.')}</p>` : ''}
      <div class="rb-foot"><span class="muted small">${T('Values as in the Allocation chart (latest prices). Drift = current weight − target, in percentage points. Taxes and fees of the trades are not included.')}</span><span class="spacer"></span>
        <button class="btn btn-sm" id="rb-now" title="${esc(T('Targets = today\'s weights'))}">${T('Use current weights')}</button><button class="btn btn-sm" id="rb-clear">${T('Clear targets')}</button>
        <button class="btn btn-sm btn-primary" id="rb-save">${T('Save settings')}</button></div>`;
    $$('#rb-mode button', box).forEach((b) => (b.onclick = () => { cfg.mode = b.dataset.m; calc(); }));
    $$('[data-acc]', box).forEach((c) => (c.onchange = () => {
      const ids = $$('[data-acc]', box).filter((x) => x.checked).map((x) => +x.dataset.acc);
      cfg.accounts = ids.length === res.accounts.length ? null : ids;
      calc();
    }));
    const numOrNull = (s) => { const v = parseQty(s); return v === '' ? null : v; };
    $('#rb-abs', box).onchange = (e) => { cfg.drift_abs = numOrNull(e.target.value); calc(); };
    $('#rb-rel', box).onchange = (e) => { cfg.drift_rel = numOrNull(e.target.value); calc(); };
    $('#rb-new', box).onchange = (e) => { const c = parseMoney(e.target.value); if (Number.isNaN(c)) return fail(new Error(T('Invalid amount'))); cfg.contribution = c; calc(); };
    $('#rb-sells', box).onchange = (e) => { cfg.sells = e.target.checked; calc(); };
    $$('.rb-in', box).forEach((c) => (c.onchange = () => {
      const ex = new Set(cfg.excluded[c.dataset.via] || []);
      if (c.checked) ex.delete(c.dataset.k); else ex.add(c.dataset.k);
      cfg.excluded[c.dataset.via] = [...ex];
      calc();
    }));
    $$('.rb-t', box).forEach((inp) => (inp.onchange = () => {
      const t = cfg.targets[cfg.mode] ||= {}, v = parseQty(inp.value);
      if (v === '' || +v === 0) delete t[inp.dataset.k]; else t[inp.dataset.k] = v;
      calc();
    }));
    $('#rb-now', box).onclick = () => {
      const t = {};
      res.rows.filter((r) => r.value > 0).forEach((r) => { t[r.key] = Math.round(r.pct * 10) / 10; });
      const keys = Object.keys(t), diff = Math.round((100 - keys.reduce((s, k) => s + t[k], 0)) * 10) / 10;
      if (keys.length && diff) t[keys[0]] = Math.round((t[keys[0]] + diff) * 10) / 10;  // rounding: still 100% in total
      cfg.targets[cfg.mode] = t;
      calc();
    };
    $('#rb-clear', box).onclick = () => { cfg.targets[cfg.mode] = {}; calc(); };
    $('#rb-save', box).onclick = () => calc(true);
    if ($('#rb-drop', box)) $('#rb-drop', box).onclick = () => { res.missing.forEach((m) => delete cfg.targets[cfg.mode][m.key]); calc(); };
    restoreFocus(box, focus);
  };
  try {
    ({ config: cfg, result: res } = await api('/investments/rebalance'));
    draw();
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; }
}
const signedMoney0 = (c) => (c >= 0 ? '+' : '') + money0(c);
function holdingsTable(a) {
  const open = a.holdings.filter((h) => !h.trades || h.quantity > 1e-9);  // securities sold entirely stay in the trades
  if (!open.length) return '';
  const t = a.has_trades;
  // order: security → quantity → purchase (average cost, cost) → today (price, value) → result; numbers aligned in columns
  const priceCell = (h) => (h.price != null
    // everything in euros like average cost, cost and value; the original quote (e.g. in dollars) stays below, in small print
    ? `${esc(unitPrice(h.price_eur ?? h.price, h.price_eur != null ? CUR : h.currency))}<div class="muted small">${h.currency && h.currency !== CUR ? `${esc(unitPrice(h.price, h.currency))} · ` : ''}${esc(fmtDate(h.price_date))}</div>`
    : h.estimated_price ? `<span class="muted small">${T('last trade')}<br>${T('price')}</span>` : `<span class="muted">${T('needs updating')}</span>`);
  return `<div class="table-wrap" style="margin-top:12px"><table class="sp-table inv-table"><thead>
      ${t ? `<tr class="inv-groups"><th colspan="3"></th><th colspan="2" class="center">${T('Purchase')}</th><th colspan="2" class="center">${T('Today')}</th><th colspan="2"></th></tr>` : ''}
      <tr><th>${T('Security')}</th><th>${T('Class')}</th><th class="right">${T('Quantity')}</th>
      ${t ? `<th class="right">${T('Avg cost')}</th><th class="right">${T('Cost')}</th>` : ''}<th class="right">${T('Price')}</th><th class="right">${T('Value')}</th>${t ? `<th class="right">${T('Gain')}</th>` : ''}<th></th></tr></thead>
    <tbody>${open.map((h) => `<tr><td><b>${esc(h.ticker)}</b><div class="muted small">${esc(h.name)}${h.isin ? ` · ${esc(h.isin)}` : ''}</div></td><td class="nowrap"><span class="dot" style="background:${ASSET_COLORS[h.asset_class] || '#8b8fa8'}"></span> ${esc(assetLabel(h.asset_class))}</td>
      <td class="right num">${qtyFmt(h.quantity)}</td>
      ${t ? `<td class="right num">${h.avg_price != null ? esc(unitPrice(h.avg_price)) : '—'}</td><td class="right num">${h.cost != null ? money0(h.cost) : '—'}</td>` : ''}
      <td class="right num">${priceCell(h)}</td>
      <td class="right num"><b>${h.value != null ? money0(h.value) : '—'}</b></td>
      ${t ? `<td class="right num">${h.unrealized != null ? `<b class="${h.unrealized >= 0 ? 'pos' : 'neg'}">${signedMoney0(h.unrealized)}</b>${h.cost > 0 ? `<div class="muted small">${pctSigned(h.unrealized / h.cost)}</div>` : ''}` : '—'}</td>` : ''}
      <td><div class="row-actions" style="opacity:1"><button class="icon-btn sm" data-hedit="${h.id}" data-acc="${a.id}">✏️</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
const TRADE_KINDS = { buy: T('Buy'), sell: T('Sell'), split: T('Split / reverse split'), capital: T('Capital return'), interest: T('Interest'), dividend: T('Dividend'), fee: T('Fee') };
async function loadTrades(det, aid) {
  const box = $('.trades-box', det);
  try {
    const rows = await api(`/investments/${aid}/trades`);
    box.innerHTML = rows.length ? `<div class="table-wrap"><table class="sp-table inv-table"><thead><tr><th>${T('Date')}</th><th>${T('Security')}</th><th>${T('Trade')}</th><th class="right">${T('Quantity')}</th><th class="right">${T('Price')}</th><th class="right">${T('Cash')}</th><th></th></tr></thead>
      <tbody>${rows.map((o) => `<tr><td class="nowrap">${esc(fmtDate(o.date))}</td>
        <td>${o.ticker ? `<b>${esc(o.ticker)}</b>` : '<span class="muted">—</span>'}</td><td>${esc(TRADE_KINDS[o.kind])}${o.notes ? `<div class="muted small">${esc(o.notes)}</div>` : ''}</td>
        <td class="right num">${o.quantity ? qtyFmt(o.quantity) : ''}</td>
        <td class="right num">${o.price != null ? esc(unitPrice(o.price)) : ''}</td>
        <td class="right num"><b class="${o.amount >= 0 ? 'pos' : 'neg'}">${o.amount ? (o.amount > 0 ? '+' : '−') + money(Math.abs(o.amount)) : ''}</b>${o.fees ? `<div class="muted small">${T('fees')} ${money(o.fees)}</div>` : ''}</td>
        <td><div class="row-actions" style="opacity:1"><button class="icon-btn sm" data-tedit="${o.id}" title="${esc(T('Edit'))}">✏️</button><button class="icon-btn sm" data-tdel="${o.id}" title="${esc(T('Delete'))}">✕</button></div></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${T('No trades')}</div>`;
    $$('[data-tedit]', box).forEach((b) => (b.onclick = () => {
      const acc = (S.invAccounts || []).find((x) => x.id === aid);
      if (acc) tradeModal(acc, rows.find((x) => x.id === +b.dataset.tedit));
    }));
    $$('[data-tdel]', box).forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog(T('Delete this trade? Quantities and cash will be recalculated.'), { ok: T('Delete') }))) return;
      try { await api(`/trades/${b.dataset.tdel}`, { method: 'DELETE' }); route(); } catch (e) { fail(e); }
    }));
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
// o = existing trade (edit); preset = initial values (e.g. investment plan purchase to complete)
function tradeModal(a, o = null, preset = {}) {
  const hs = a.holdings;
  const x = { kind: 'buy', date: todayIso(), holding_id: '', quantity: '', price: '', fees: 0, amount: 0, notes: '', ...preset, ...(o || {}) };
  const dec = (v, d = 6) => (v === '' || v == null ? '' : (+v).toLocaleString(LOCALE, { maximumFractionDigits: d, useGrouping: false }));
  const tradeTotal = ['buy', 'sell'].includes(x.kind) && x.amount ? Math.abs(x.amount) : '';
  const m = openModal(`${o ? T('Edit trade') : T('New trade')} · ${a.name}`, `
    <div class="form-grid">
      <label class="field">${T('Type')} <select id="tr-kind">${Object.entries(TRADE_KINDS).map(([k, l]) => `<option value="${k}" ${k === x.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">${T('Date')} <input id="tr-date" type="date" value="${esc(x.date)}"></label>
      <label class="field full" data-f="hold">${T('Security')} <select id="tr-hold"><option value="">—</option>${hs.map((h) => `<option value="${h.id}" ${h.id === +x.holding_id ? 'selected' : ''}>${esc(h.ticker)} · ${esc(h.name)}</option>`).join('')}</select></label>
      <label class="field" data-f="qty"><span id="tr-qty-l">${T('Quantity')}</span> <input id="tr-qty" inputmode="decimal" value="${dec(x.kind === 'sell' ? Math.abs(x.quantity) : x.quantity)}"></label>
      <label class="field" data-f="price">${T('Unit price (')}${CUR_SYM}) <input id="tr-price" inputmode="decimal" value="${dec(x.price, 4)}"></label>
      <label class="field" data-f="total">${T('Total amount (')}${CUR_SYM}) <input id="tr-total" inputmode="decimal" value="${tradeTotal ? moneyInput(tradeTotal) : ''}" placeholder="${esc(T('optional'))}"></label>
      <label class="field" data-f="fees">${T('Fees (')}${CUR_SYM}) <input id="tr-fees" inputmode="decimal" value="${x.fees ? moneyInput(x.fees) : ''}"></label>
      <label class="field" data-f="amount">${T('Amount (')}${CUR_SYM}) <input id="tr-amount" inputmode="decimal" value="${!['buy', 'sell', 'split'].includes(x.kind) && x.amount ? moneyInput(Math.abs(x.amount)) : ''}"></label>
      <label class="field full">${T('Notes')} <input id="tr-notes" maxlength="200" value="${esc(x.notes || '')}"></label>
    </div>
    <p class="muted small" id="tr-hint"></p>
    <div class="modal-foot"><button class="btn" data-cancel>${T('Cancel')}</button><button class="btn btn-primary" id="tr-save">${T('Save')}</button></div>`, { wide: true });
  const show = () => {
    const k = $('#tr-kind', m).value, trade = k === 'buy' || k === 'sell';
    const vis = { hold: trade || k === 'split' || k === 'capital' || k === 'dividend', qty: trade || k === 'split', price: trade, total: trade, fees: trade, amount: !trade && k !== 'split' };
    Object.entries(vis).forEach(([f, on]) => $(`[data-f="${f}"]`, m).classList.toggle('hidden', !on));
    $('#tr-qty-l', m).textContent = k === 'split' ? T('Quantity change (+/−)') : T('Quantity');
    $('#tr-hint', m).textContent = { buy: T('The account cash decreases by the total (quantity × price + fees, or the total amount from the statement if you enter it). With amount and price the quantity is calculated automatically.'),
      sell: T('Cash increases by the total; the gain or loss is calculated on the average cost.'),
      split: T('Only the quantity changes (e.g. reverse split {from} → {to}: {change}).', { from: num(50), to: num(1.66, 2), change: num(-48.34, 2) }), capital: T('Return of capital: it reduces the cost of the security and increases cash.') }[k] || '';
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
  if (!hs.length) $('#tr-hint', m).textContent = T('First add a security with "＋ Security".');
  $('[data-cancel]', m).onclick = closeModal;
  $('#tr-save', m).onclick = async () => {
    const total = parseMoney($('#tr-total', m).value);
    const body = { kind: $('#tr-kind', m).value, date: $('#tr-date', m).value, holding_id: $('#tr-hold', m).value || null,
      quantity: num('#tr-qty'), price: num('#tr-price'), fees: parseMoney($('#tr-fees', m).value) || 0, total: total || null,
      amount: parseMoney($('#tr-amount', m).value), notes: $('#tr-notes', m).value, external_id: x.external_id || '' };
    try {
      await api(o ? `/trades/${o.id}` : `/investments/${a.id}/trades`, { method: o ? 'PUT' : 'POST', body });
      toast(o ? T('Trade updated') : T('Trade recorded')); closeModal(); route();
    } catch (e) { fail(e); }
  };
}

function valuationModal(accountId) {
  const m = openModal(T('Account value'), `
    <p class="muted small" style="margin:0 0 14px">${T('The market value of the account on a date (e.g. from the broker\'s website). If you enter it for a date that already exists, it is replaced.')}</p>
    <div class="form-grid"><label class="field">${T('Date')} <input id="vl-date" type="date" value="${todayIso()}"></label>
      <label class="field">${T('Value (')}${CUR_SYM}) <input id="vl-value" inputmode="decimal" autofocus></label></div>
    <div class="modal-foot"><button class="btn" data-cancel>${T('Cancel')}</button><button class="btn btn-primary" id="vl-save">${T('Save')}</button></div>`);
  $('[data-cancel]', m).onclick = closeModal;
  $('#vl-save', m).onclick = async () => {
    try { await api(`/investments/${accountId}/valuations`, { method: 'POST', body: { date: $('#vl-date', m).value, value: parseMoney($('#vl-value', m).value) } }); toast(T('Value saved')); closeModal(); route(); } catch (e) { fail(e); }
  };
}

function holdingModal(accountId, h = null) {
  const x = h || { ticker: '', name: '', quantity: '', asset_class: 'azioni' };
  const m = openModal(h ? T('Edit security') : T('Add security'), `
    <p class="muted small" style="margin:0 0 14px">${T('Use the Yahoo Finance ticker with the exchange suffix: <b>.MI</b> Milan, <b>.DE</b> Xetra, <b>.AS</b> Amsterdam, <b>.PA</b> Paris (e.g. VWCE.DE, SWDA.MI). With "Update prices" the account value is calculated automatically.')}</p>
    <div class="form-grid">
      <label class="field">${T('Ticker')} <input id="hd-ticker" maxlength="30" value="${esc(x.ticker)}" placeholder="VWCE.DE" autofocus></label>
      <label class="field">${T('Quantity')} <input id="hd-qty" inputmode="decimal" value="${x.quantity === '' ? '' : decInput(x.quantity)}" ${x.trades ? 'disabled title="Calculated from the trades"' : ''}></label>
      <label class="field full">${T('Description')} <input id="hd-name" maxlength="80" value="${esc(x.name)}" placeholder="${esc(T('E.g. Vanguard FTSE All-World'))}"></label>
      <label class="field">${T('Class')} <select id="hd-class">${ASSET_CLASSES.map((c) => `<option value="${esc(c)}" ${c === x.asset_class ? 'selected' : ''}>${esc(assetLabel(c))}</option>`).join('')}</select></label>
      <p class="muted small full" id="hd-hint" style="margin:0">${CLASS_HELP[x.asset_class] || ''}</p>
    </div>
    <div class="modal-foot">${h ? `<button class="btn btn-ghost left neg" id="hd-del">🗑 ${T('Delete')}</button>` : ''}
      <button class="btn" data-cancel>${T('Cancel')}</button><button class="btn btn-primary" id="hd-save">${T('Save')}</button></div>`);
  $('[data-cancel]', m).onclick = closeModal;
  const hint = (extra = '') => { $('#hd-hint', m).innerHTML = (extra ? extra + '<br>' : '') + (CLASS_HELP[$('#hd-class', m).value] || ''); };
  $('#hd-class', m).onchange = () => hint();
  // automatic fill-in from the ticker (Yahoo Finance, sends only the ticker): name and suggested class, always editable
  let pending = null;  // saving waits for the lookup in progress, so the suggested class is not lost
  $('#hd-ticker', m).onchange = () => (pending = lookup());
  const lookup = async () => {
    const t = $('#hd-ticker', m).value.trim();
    if (!t) return;
    hint(T('⏳ Looking up the security…'));
    try {
      const r = await api('/investments/lookup?' + qs({ ticker: t }));
      const fixed = r.ticker && r.ticker !== t.toUpperCase();  // e.g. a Morningstar code without exchange: Yahoo wants the suffix
      if (fixed) $('#hd-ticker', m).value = r.ticker;
      if (!$('#hd-name', m).value.trim() || !h) $('#hd-name', m).value = r.name || $('#hd-name', m).value;
      $('#hd-class', m).value = r.asset_class;
      hint(`✨ ${T('Found:')} <b>${esc(r.name || r.ticker)}</b> (${esc(r.type || 'security')}${r.price != null ? ' · ' + esc(unitPrice(r.price, r.currency)) : r.currency ? ', ' + esc(r.currency) : ''}) · ${T('suggested class <b>{class}</b>, editable', { class: esc(assetLabel(r.asset_class)) })}`
        + (fixed ? `<br>🔎 ${T('Code completed to <b>{ticker}</b>: it is the symbol Yahoo Finance quotes it under', { ticker: esc(r.ticker) })}` : ''));
    } catch (e) { hint(`⚠️ ${esc(e.message)}: ${T('fill in name and class by hand')}`); }
  };
  $('#hd-save', m).onclick = async () => {
    if (pending) await pending;
    const body = { ticker: $('#hd-ticker', m).value, quantity: parseQty($('#hd-qty', m).value), name: $('#hd-name', m).value, asset_class: $('#hd-class', m).value };
    if (h && body.ticker.trim().toUpperCase() !== h.ticker && !(await confirmDialog(
      `${T('Change the ticker from {old} to {new}?', { old: h.ticker, new: body.ticker.trim().toUpperCase() })} ${T('The trades stay, but the current and historical prices of {ticker} are deleted: then use "Update prices". Do this only if it is the same instrument (e.g. another exchange) or to fix a mistake.', { ticker: h.ticker })}`,
      { ok: T('Change ticker'), title: T('⚠️ Ticker change') }))) return;
    try { await api(h ? `/holdings/${h.id}` : `/investments/${accountId}/holdings`, { method: h ? 'PUT' : 'POST', body }); toast(T('Security saved: use "Update prices" for the value')); closeModal(); route(); } catch (e) { fail(e); }
  };
  if (h) $('#hd-del', m).onclick = async () => {
    if (!(await confirmDialog(T('Delete {name}?', { name: h.ticker }), { ok: T('Delete') }))) return;
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
    <div class="toolbar"><select id="sv-months">${[['6', T('Last 6 months')], ['12', T('Last 12 months')], ['24', T('Last 24 months')], ['36', T('Last 36 months')], ['all', T('All')]].map(([k, l]) => `<option value="${k}" ${k === String(S.savMonths) ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <details class="help" style="flex:1 1 260px"><summary>ℹ️ ${T('How it works')}</summary><p>${T('Every month: income = spent + other spaces + saved (the month\'s surplus). Next to it, invested: purchases − sales of securities in investment accounts (money market ETFs are cash and do not count), even if paid with earlier savings · other spaces = transfers and contributions to other spaces.')}</p></details></div>
    <div class="kpis">
      <div class="kpi g-amber"><div class="k-label">🐷 ${T('Savings rate')}</div><div class="k-value">${t.rate == null ? '—' : pct(t.rate)}</div>${kRows([`📅 ${T('Saved per month')}`, money0(t.saved / n)])}</div>
      <div class="kpi g-indigo" title="${esc(T('purchases − sales of securities'))}"><div class="k-label">📈 ${T('Invested per month')}</div><div class="k-value">${money0(t.invested / n)}</div>${kRows(t.invest_rate != null && [`📊 ${T('Of income')}`, pct(t.invest_rate)])}</div>
      <div class="kpi g-rose"><div class="k-label">📤 ${T('Spent per month')}</div><div class="k-value">${money0(t.expense / n)}</div>${kRows(t.to_others && [`↗ ${T('To other spaces')}`, money0(t.to_others / n)])}</div>
      <div class="kpi g-indigo" title="${esc(T('cash + investments − debts'))}"><div class="k-label">💎 ${T('Net worth')}</div><div class="k-value">${money0(nw.now ? nw.now.net : 0)}</div>
        ${nw.now ? kRows([`💧 ${T('Cash')}`, money0(nw.now.liquidity)], [`📈 ${T('Investments')}`, money0(nw.now.investments)], nw.now.debts && [`💳 ${T('Debts')}`, '−' + money0(nw.now.debts)]) : ''}</div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${T('Where income goes')}</h3><span class="muted small">${T('line = income for the month')}</span></div><div class="chart-box"><canvas id="sv-bar"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>${T('Net worth')}</h3></div><div class="chart-box"><canvas id="sv-nw"></canvas></div></div>
    </div>
    <div class="card"><div class="table-wrap"><table class="sp-table"><thead><tr><th>${T('Month')}</th><th class="right">${T('Income')}</th><th class="right">${T('Spent')}</th><th class="right">${T('Other spaces')}</th><th class="right">${T('Saved')}</th><th class="right">${T('Savings rate')}</th><th class="right">${T('Invested in securities')}</th></tr></thead>
      <tbody>${rows.slice().reverse().map((r) => {
        // the current month is not over: income may still arrive, so its saved amount is not a result (no red)
        const now = r.month === todayIso().slice(0, 7);
        return `<tr class="${now ? 'muted' : ''}"><td>${fmtMonth(r.month)}${now ? ` <span class="tag" title="${esc(T('The month is not over: income and expenses may still arrive'))}">${T('in progress')}</span>` : ''}</td><td class="right"><b>${money0(r.income + r.from_others)}</b></td><td class="right">${money0(r.expense)}</td>
        <td class="right">${signed(r.to_others)}</td><td class="right ${now ? '' : r.saved >= 0 ? 'pos' : 'neg'}"><b>${signed(r.saved)}</b></td>
        <td class="right">${r.rate == null || now ? '—' : pct(r.rate)}</td><td class="right ${r.invested < 0 ? 'neg' : ''}">${signed(r.invested)}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
  $('#sv-months').onchange = (e) => { S.savMonths = e.target.value; route(); };
  const labels = rows.map((r) => fmtMonth(r.month));
  const bar = (label, key, color) => ({ type: 'bar', label, data: rows.map((r) => r[key]), backgroundColor: color, stack: 's', maxBarThickness: 34 });
  chart($('#sv-bar'), {
    type: 'bar',
    data: { labels, datasets: [
      { type: 'line', label: T('Income'), data: rows.map((r) => r.income + r.from_others), borderColor: css('--text'), backgroundColor: css('--text'),
        borderWidth: 2, borderDash: [5, 4], pointRadius: 3, tension: 0, order: -1 },
      // same colors as everywhere: red for spending, blue for transfers to other spaces, yellow for savings
      bar(T('Spent'), 'expense', '#e11d48'), bar(T('Other spaces'), 'to_others', '#0ea5e9'), bar(T('Saved'), 'saved', '#f59e0b'),
      { ...bar(T('Invested in securities'), 'invested', '#7c3aed'), stack: 'inv' }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (x) => moneyK(x) } } },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { filter: (i) => i.raw !== 0, callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.raw)}` } } } },
  });
  chart($('#sv-nw'), {
    type: 'line',
    data: { labels: nw.series.map((x) => fmtMonth(x.month)), datasets: [
      { label: T('Net worth'), data: nw.series.map((x) => x.net), borderColor: '#6366f1', backgroundColor: (ctx) => vGradient(ctx, '#6366f1'), fill: true, borderWidth: 3, tension: .3, pointRadius: 3 },
      { label: T('Cash'), data: nw.series.map((x) => x.liquidity), borderColor: '#2fbf71', borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: T('Investments'), data: nw.series.map((x) => x.investments), borderColor: '#7b52ab', borderWidth: 2, pointRadius: 0, tension: .3 },
      ...(nw.series.some((x) => x.debts) ? [{ label: T('Debts'), data: nw.series.map((x) => -x.debts), borderColor: '#e8364f', borderDash: [5, 4], borderWidth: 2, pointRadius: 0 }] : [])] },
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
  const m = openModal(p ? T('Edit space') : T('New space'), `
    <p class="muted small" style="margin:0 0 12px">${T('Each space has its own accounts, categories, rules and reports; transfers can also go to accounts in other spaces. Choose the type based on what you want to analyze:')}</p>
    <div class="pf-choice" id="g-type">${Object.entries(PF_GUIDE).map(([k, gd]) => `
      <button type="button" class="pf-opt ${x.type === k ? 'on' : ''}" data-k="${k}">
        <span class="pf-opt-head"><span class="pf-opt-ico">${PF_TYPES[k][2]}</span><b>${PF_TYPES[k][0]}</b><span class="pf-opt-check">✓</span></span>
        <span class="pf-opt-for">${gd.for}</span>
        <span class="pf-opt-label">${T('Suggested tabs')}</span>
        <span class="pf-opt-cats">${DEFAULT_FEATURES[k].map((f) => `${FEATURES[f][0]} ${FEATURES[f][1]}`).join(' · ')}</span>
        <span class="pf-opt-label">${T('Features that change')}</span>
        ${gd.diff.map((t) => `<span class="pf-opt-li">${t}</span>`).join('')}
        <span class="pf-opt-label">${T('Initial categories')}</span>
        <span class="pf-opt-cats">${gd.cats}</span>
      </button>`).join('')}</div>
    <div class="feat-box">
      <div class="feat-core"><span class="muted small"><b>${T('Always present:')}</b></span> ${CORE_TABS.map(([i, n]) => `<span class="tag">${i} ${n}</span>`).join(' ')}</div>
      <div class="muted small" style="margin:10px 0 6px"><b>${T('Optional tabs')}</b> · ${p ? T('hiding a tab does not delete its data, which keeps counting in the dashboard and reports: turn it back on and everything is still there') : T('suggested based on the type, can be changed now and later')}</div>
      <div class="feat-grid" id="g-feat">${Object.entries(FEATURES).map(([k, [ico, name, what]]) => `
        <label class="feat-opt"><input type="checkbox" value="${k}" ${(p ? p.features : DEFAULT_FEATURES[x.type]).includes(k) ? 'checked' : ''}>
          <span class="feat-ico">${ico}</span><span><b>${name}</b><span class="muted small">${what}</span></span></label>`).join('')}</div>
    </div>
    <div class="form-grid">
      <label class="field full">${T('Name')} <input id="g-name" maxlength="40" value="${esc(x.name)}" placeholder="${esc(PF_TYPES[x.type][1])}" autofocus></label>
      <div class="field full">${T('Color')} ${swatchPicker('g-color', x.color)}</div>
      <div class="field full">${T('Icon')} ${emojiPicker('g-icon', x.icon)}</div>
      ${p ? `<label class="check full"><input type="checkbox" id="g-arch" ${x.archived ? 'checked' : ''}> ${T('Archived space (hidden from the switcher)')}</label>` : ''}
    </div>
    <div class="modal-foot">${p ? `<button class="btn btn-ghost left neg" id="g-del">🗑 ${T('Delete')}</button>` : ''}
      <button class="btn" data-cancel>${T('Cancel')}</button><button class="btn btn-primary" id="g-save">${p ? T('Save') : T('Create space')}</button></div>`, { wide: true });
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
    if (hidden.length && !(await confirmDialog(`${T('Hide {tabs} in "{space}"?', { tabs: hidden.map((k) => FEATURES[k][1]).join(', '), space: p.name })} ${T('The data stays and keeps counting in the dashboard, reports and net worth: turn the tab back on and everything is still there.')}`,
      { ok: T('Hide'), danger: false, title: T('Hidden tabs') }))) return;
    if (p && p.type !== type && !(await confirmDialog(`${T('Change "{space}" to the type {type}?', { space: p.name, type: PF_TYPES[type][0] })} ${T('The tabs stay the ones chosen below; some calculations change (shares per person, contributions as shared income).')}`,
      { ok: T('Change type'), danger: false, title: T('Change of space type') }))) return;
    try {
      if (p) { await api(`/portfolios/${p.id}`, { method: 'PUT', body }); toast(T('Space saved')); closeModal(); refresh(); }
      else { const r = await api('/portfolios', { method: 'POST', body }); closeModal(); await switchPortfolio(r.id); location.hash = '#/conti'; }
    } catch (e) { fail(e); }
  };
  if (p) $('#g-del', m).onclick = async () => {
    if (!(await confirmDialog(`${T('Delete the space "{name}"?', { name: p.name })} ${T('It can be deleted only if it contains no accounts.')}`, { ok: T('Delete') }))) return;
    try { await api(`/portfolios/${p.id}`, { method: 'DELETE' }); toast(T('Space deleted')); if (p.id === S.pid) setPid(null); refresh(); } catch (e) { fail(e); }
  };
}

// ================================================================ activity log
const AUDIT_KINDS = { access: ['🔓', T('Sign-ins')], security: ['🛡️', T('Security')], change: ['✏️', T('Changes')], delete: ['🗑', T('Deletions')], data: ['💾', T('Import and export')] };
async function renderRegistro(v) {
  S.auditKind ??= '';
  const page = 100;
  let items = [], total = 0;
  const d0 = await api('/audit?' + qs({ kind: S.auditKind, limit: page }));
  items = d0.items; total = d0.total;
  const all = Object.values(d0.counts).reduce((s, n) => s + n, 0);
  v.innerHTML = `
    <div class="toolbar"><div class="seg" id="au-kind"><button data-k="" class="${S.auditKind === '' ? 'on' : ''}">${T('All')} <span class="muted">${all}</span></button>
      ${Object.entries(AUDIT_KINDS).map(([k, [ic, l]]) => `<button data-k="${k}" class="${S.auditKind === k ? 'on' : ''}">${ic} ${l} <span class="muted">${d0.counts[k] || 0}</span></button>`).join('')}</div>
      <span class="spacer"></span><span class="muted small">🔒 ${T('In the encrypted database')} · ${tn('entries older than {n} month are deleted automatically', 'entries older than {n} months are deleted automatically', d0.keep_months)}</span></div>
    <div class="card" style="padding:6px 8px"><div class="table-wrap"><table class="audit-table">
      <thead><tr><th>${T('When')}</th><th>${T('Action')}</th><th>${T('Details')}</th><th>${T('Space')}</th></tr></thead><tbody id="au-body"></tbody></table></div>
      <div id="au-more" style="text-align:center;padding:10px"></div></div>`;
  const row = (x) => {
    const [ic] = AUDIT_KINDS[x.kind] || ['•'];
    const when = new Date(x.ts.replace(' ', 'T'));
    return `<tr class="au-${esc(x.kind)}"><td class="num nowrap">${esc(fmtDate(isoLocal(when)))} <span class="muted">${esc(x.ts.slice(11, 16))}</span></td>
      <td class="nowrap">${ic} ${esc(T(x.action))}</td><td class="muted small">${esc(x.detail)}</td><td class="muted small nowrap">${esc(x.portfolio)}</td></tr>`;
  };
  const draw = () => {
    $('#au-body').innerHTML = items.length ? items.map(row).join('') : `<tr><td colspan="4"><div class="empty">${T('No actions recorded')}</div></td></tr>`;
    $('#au-more').innerHTML = items.length < total ? `<button class="btn btn-sm" id="au-load">${T('Show more (')}${total - items.length})</button>` : '';
    $('#au-load')?.addEventListener('click', async () => {
      try { const d = await api('/audit?' + qs({ kind: S.auditKind, limit: page, offset: items.length })); items = items.concat(d.items); draw(); } catch (e) { fail(e); }
    });
  };
  draw();
  $$('#au-kind button').forEach((b) => (b.onclick = () => { S.auditKind = b.dataset.k; route(); }));
}

// last encrypted backup downloaded: a reminder after 30 days (or never), only when there is something to protect
function backupAge() {
  const d = S.lastBackup, days = d ? -daysFrom(d) : null;
  if (!d) return S.tx_count ? `<span class="tag warn">${T('never downloaded')}</span>` : T('Never downloaded');
  return `${T('Last downloaded: <b>{date}</b>', { date: esc(fmtDate(d)) })}${days > 30 ? ` <span class="tag warn">${tn('{n} day ago', '{n} days ago', days)}</span>` : ''}`;
}
// Settings in five tabs, from the everyday to the rare: what you change often first, safety and data after
const SETTINGS_TABS = [['general', T('🎨 General')], ['spaces', T('🗂️ Spaces')], ['security', T('🔐 Security')], ['data', T('💾 Backup & data')], ['updates', T('🔄 Updates')]];
async function renderImpostazioni(v, params) {
  const th = getTheme();
  const tab = SETTINGS_TABS.some(([k]) => k === params?.get('tab')) ? params.get('tab') : S.settingsTab || 'general';
  S.settingsTab = tab;
  if (tab === 'updates' && !S.update) await loadUpdate();
  const tabs = `<div class="seg settings-tabs" id="s-tabs" role="tablist">${SETTINGS_TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${l}${k === 'updates' && S.update?.available ? '<span class="nav-dot"></span>' : ''}</button>`).join('')}</div>`;
  const lockLabel = (m) => durationLabel(m);
  const panes = {
    general: `<div class="grid-2">
    <div class="card"><div class="card-head"><h3>🎨 ${T('Appearance')}</h3></div>
      <div class="settings-row"><div><b>${T('Theme')}</b><p class="muted small">${T('Light, dark or same as the system')}</p></div>
        <div class="seg" id="s-theme">${[['system', T('💻 System')], ['light', T('☀️ Light')], ['dark', T('🌙 Dark')]].map(([k, l]) => `<button data-t="${k}" class="${th === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="settings-row"><div><b>🌐 ${T('Language')}</b><p class="muted small">${T('Menus, messages and the names of new categories. The categories you already have keep their names')}</p></div>
        <div style="width:220px;flex:none">${languageSelect('s-lang')}</div></div>
      <div class="settings-row"><div><b>${T('Reference currency')}</b><p class="muted small">${T('Symbol and number format of every space: {example}.', { example: esc(money(123456)) })} ${T('A label only: amounts are not converted')}</p></div>
        <div style="width:220px;flex:none">${currencySelect('s-cur', CUR)}</div></div>
      ${S.currencyUnavailable ? `<div class="settings-row"><p class="small" style="margin:0"><span class="tag warn">⚠️</span> ${esc(T('The currency {code} saved in your data is no longer available: amounts are shown in euro. Choose the currency of your accounts above.', { code: S.currencyUnavailable }))}</p></div>` : ''}
      <div class="settings-row"><div><b>${T('Hide amounts')}</b><p class="muted small">${T('The eye at the top blurs every amount, for when someone is looking at the screen')}</p></div></div>
      <div class="settings-row"><div><b>${T('Shortcuts')}</b><p class="muted small">${T('{key_n} new transaction · {key_esc} closes dialogs', { key_n: '<span class="kbd">N</span>', key_esc: '<span class="kbd">Esc</span>' })}</p></div></div>
    </div>
    <div class="card"><div class="card-head"><h3>🪙 ${T('About HomeCoin')}</h3></div>
      <div class="settings-row"><div><b>HomeCoin ${esc(S.version)}</b><p class="muted small">${S.update?.available ? `<span class="tag ai">${T('version {version} available', { version: esc(S.update.latest) })}</span>` : T('Household finances on your own PC, by Starkark98')}</p></div><a class="btn btn-sm" href="#/impostazioni?tab=updates">🔄 ${T('Updates')}</a></div>
      <div class="settings-row"><div><b>${T('Help')}</b><p class="muted small">${T('Guide and questions on GitHub (opens a new tab)')}</p></div><a class="btn btn-sm" href="https://github.com/Starkark98/HomeCoin#readme" target="_blank" rel="noopener noreferrer">❔ ${T('Help')}</a></div>
      <div class="settings-row"><div><b>${T('Support HomeCoin')}</b><p class="muted small">${T('HomeCoin is free. If it helps you, a coffee on Ko-fi keeps it growing')}</p></div><a class="btn btn-sm" href="https://ko-fi.com/starkark98" target="_blank" rel="noopener noreferrer">☕ Ko-fi</a></div>
      <div class="settings-row"><div><b>${T('Close HomeCoin')}</b><p class="muted small">${T('Locks and stops HomeCoin; open it again from its shortcut')}</p></div><button class="btn btn-sm" id="s-quit">⏻ ${T('Close')}</button></div>
    </div></div>`,
    spaces: `<div class="card"><div class="card-head"><div><h3>🗂️ ${T('Spaces')}</h3>
      <p class="muted small" style="margin:3px 0 0">${T('Separate portfolios in the same HomeCoin (e.g. family, personal, business). Switch between them from the switcher at the top left.')}</p></div>
      <button class="btn btn-sm btn-primary" id="s-pf-new">＋ ${T('New space')}</button></div>
    <div class="pf-list">${S.portfolios.map((p) => `<div class="pf-row ${p.archived ? 'is-off' : ''}">
      <span class="pf-ico" style="--pc:${esc(p.color)}">${esc(p.icon)}</span>
      <div class="grow"><b>${esc(p.name)}</b> ${p.id === S.pid ? `<span class="tag ai">${T('active')}</span>` : ''} ${p.archived ? `<span class="tag">${T('archived')}</span>` : ''}
        <div class="muted small">${PF_TYPES[p.type][0]} · ${tn('{n} account', '{n} accounts', p.accounts)} · ${T('tabs:')} ${p.features.map((k) => `${FEATURES[k][0]} ${FEATURES[k][1]}`).join(', ') || T('only the common ones')}</div></div>
      ${p.id !== S.pid && !p.archived ? `<button class="btn btn-sm" data-pf-go="${p.id}">${T('Open')}</button>` : ''}
      <button class="icon-btn sm" data-pf-edit="${p.id}" title="${esc(T('Edit'))}">✏️</button></div>`).join('')}</div></div>`,
    security: `<div class="card" style="margin-bottom:18px" id="sec-card"><div class="card-head"><div><h3>🩺 ${T('Security check')}</h3>
      <p class="muted small" style="margin:3px 0 0" id="sec-sum">${T('Checking…')}</p></div>
      <button class="btn btn-sm" id="sec-go">🩺 ${T('Check now')}</button></div>
    <div class="sec-list" id="sec-list"><div class="loading">${T('Checking the database, data folder and keys…')}</div></div></div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>🔐 ${T('Password and lock')}</h3></div>
      <div class="settings-row"><div><b>${T('Password')}</b><p class="muted small">${T('Asked every time you open HomeCoin; it is not saved anywhere')}</p></div><button class="btn btn-sm" id="s-pw">${T('Change password')}</button></div>
      <div class="settings-row"><div><b>${T('Recovery key')}</b><p class="muted small">${T('Needed if you forget the password; generating a new one invalidates the previous one')}</p></div><button class="btn btn-sm" id="s-rk">${T('New key')}</button></div>
      <div class="settings-row"><div><b>${T('Auto-lock')}</b><p class="muted small">${T('After this much time without activity the password is needed again')}</p></div>
        <select id="s-autolock" style="width:auto">${[5, 15, 30, 60, 120].map((m) => `<option value="${m}" ${(AUTH.status?.auto_lock || 15) === m ? 'selected' : ''}>${lockLabel(m)}</option>`).join('')}</select></div>
      <div class="settings-row"><div><b>${T('Lock now')}</b><p class="muted small">${T('Removes the key from memory and hides the data')}</p></div><button class="btn btn-sm" id="s-lock">🔒 ${T('Lock')}</button></div>
    </div>
    <div class="card"><div class="card-head"><div><h3>🧰 ${T('Advanced')}</h3><p class="muted small" style="margin:3px 0 0">${T('Only if you asked for it yourself')}</p></div></div>
      <div class="settings-row"><div><b>${T('Import code')}</b><p class="muted small" id="s-itoken-state">${T('Temporary code for an import script on this PC. It expires on its own and is revoked when HomeCoin locks. Generate it only if you asked for it yourself.')}</p></div>
        <div style="display:flex;gap:8px"><button class="btn btn-sm hidden" id="s-itoken-off">${T('Revoke code')}</button><button class="btn btn-sm" id="s-itoken">🔑 ${T('Generate')}</button></div></div>
      <div class="settings-row"><div><p class="muted small" style="margin:0">${T('The database and the automatic backups are encrypted with AES-256 (SQLCipher); the key is protected by your password (scrypt) and stays in memory only while HomeCoin is unlocked. Downloaded backups are encrypted too and open only in HomeCoin with the password or recovery key.')}</p></div></div>
    </div></div>`,
    data: `<div class="grid-2">
    <div class="card"><div class="card-head"><h3>💾 ${T('Backup and restore')}</h3></div>
      <div class="settings-row"><div><b>${T('Download full backup')}</b><p class="muted small">${T('Encrypted {file} file: it opens only with the current password (or recovery key). Keep a copy outside this PC (USB drive, cloud): the automatic backups below stay in the same folder as the data.', { file: '<code>.hcbackup</code>' })}
        <br>${backupAge()}</p></div><a class="btn btn-sm" href="/api/backup" id="s-backup">⬇ ${T('Backup')}</a></div>
      <div class="settings-row"><div><b>${T('Restore from backup')}</b><p class="muted small">${T('Replaces all current data (a copy is saved first). Old .json backups are accepted too')}</p></div>
        <label class="btn btn-sm">⬆ ${T('Restore')}<input type="file" id="s-restore" accept=".hcbackup,.json" hidden></label></div>
    </div>
    <div class="card"><div class="card-head"><h3>📤 ${T('Export')}</h3></div>
      <div class="settings-row"><div><p class="muted small" style="margin:0">⚠️ ${T('Exported files (CSV, Excel, reports) are <b>not encrypted</b>: keep them in a safe place and delete them when you no longer need them.')}</p></div></div>
      <div class="settings-row"><div><b>${T('All transactions')}</b><p class="muted small">${T('For Excel or other programs')}</p></div>
        <div style="display:flex;gap:8px"><a class="btn btn-sm" href="/api/export/transactions?format=csv&pf=${S.pid}">CSV</a><a class="btn btn-sm" href="/api/export/transactions?format=xlsx&pf=${S.pid}">${T('Excel')}</a></div></div>
      <div class="settings-row"><div><b>${T('Annual report')}</b><p class="muted small">${T('From the Reports page')}</p></div><a class="btn btn-sm" href="#/report">${T('Go →')}</a></div>
    </div></div>
    <div class="card" style="margin-top:18px" id="bk-card"><div class="loading">${T('Loading…')}</div></div>
    <div class="card" style="margin-top:18px"><div class="card-head"><h3>🛡️ ${T('Where your data lives')}</h3></div>
      <div class="settings-row"><div><b>${T('Data encrypted on your PC')}</b><p class="muted small"><code class="path">${esc(S.data_dir)}</code></p>
        ${S.legacyCopies.length ? `<p class="small"><span class="tag warn">${T('old copy')}</span> ${T('Since version 1.2 the data lives in the folder above. The previous folder was kept, unused:')} ${S.legacyCopies.map((p) => `<code class="path">${esc(p)}</code>`).join(' ')} — ${T('delete it once you have checked that everything is here (it is encrypted, like the data).')}</p>` : ''}</div></div>
      <div class="settings-row"><div><p class="muted small" style="margin:0">${T('HomeCoin accepts connections only from this PC (127.0.0.1), uses no external services or CDNs and blocks requests coming from other sites. It goes online only for two optional things: "Update prices" in Investments (sends only the tickers to Yahoo Finance) and the update check (asks GitHub for the latest version; nothing about you or your data is sent). Help and Support open GitHub and Ko-fi in a new browser tab, only when you click them.')}</p></div></div>
    </div>`,
    updates: updatePane(),
  };
  v.innerHTML = tabs + panes[tab];
  $$('#s-tabs button', v).forEach((b) => (b.onclick = () => {
    S.settingsTab = b.dataset.tab;
    history.replaceState(null, '', `#/impostazioni?tab=${b.dataset.tab}`);
    route();
  }));
  if (tab === 'updates') bindUpdatePane(v);
  if (tab === 'data') drawBackups();
  $('#s-pw')?.addEventListener('click', () => passwordModal());
  $('#s-rk')?.addEventListener('click', () => recoveryModal());
  $('#s-lock')?.addEventListener('click', () => lockNow());
  $('#s-quit')?.addEventListener('click', () => quitApp());
  if (tab !== 'security') return bindSettingsCommon(v);
  const runCheck = () => securityCheck(v);
  $('#sec-go').onclick = runCheck;
  runCheck();
  const tokenState = async () => {
    try {
      const st = AUTH.status = await fetch('/api/auth/status', { headers: { 'X-HomeCoin': '1' } }).then((x) => x.json());
      const until = st.import_token_until;
      if (!$('#s-itoken-state')) return;
      $('#s-itoken-off').classList.toggle('hidden', !until);
      if (until) $('#s-itoken-state').innerHTML = `<span class="tag warn">${T('active')}</span> ${T('valid until <b>{time}</b> (or until HomeCoin locks). Revoke it when you no longer need it.', { time: new Date(until * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) })}`;
    } catch { /* ignore */ }
  };
  tokenState();
  $('#s-itoken-off').onclick = async () => {
    try { await api('/auth/import-token', { method: 'DELETE' }); toast(T('Code revoked')); route(); } catch (e) { fail(e); }
  };
  $('#s-itoken').onclick = async () => {
    const minutes = await new Promise((resolve) => {
      const m = openModal(T('Import code'), `<p class="muted small">${T('How long should it be valid? It is revoked anyway when you lock HomeCoin (including auto-lock) and you can revoke it earlier from here. Generating a new one revokes the previous one.')}</p>
        <label class="field">${T('Duration')} <select id="it-min"><option value="15">15 ${T('minutes')}</option><option value="60">1 ${T('hour')}</option><option value="240" selected>4 ${T('hours')}</option><option value="480">8 ${T('hours')}</option></select></label>
        <div class="modal-foot"><button class="btn" data-no>${T('Cancel')}</button><button class="btn btn-primary" id="it-go">${T('Generate')}</button></div>`);
      $('[data-no]', m).onclick = () => { closeModal(); resolve(null); };
      $('#it-go', m).onclick = () => { const v = +$('#it-min', m).value; closeModal(); resolve(v); };
    });
    if (!minutes) return;
    try {
      const r = await api('/auth/import-token', { method: 'POST', body: { minutes } });
      tokenState();
      const m = openModal(T('Import code'), `<p class="muted small">${T('Valid for {duration}', { duration: durationLabel(r.minutes) })}, ${T('as long as HomeCoin stays unlocked. It lets a script on this PC read and write the data: do not share it with anyone else.')}</p>
        <div class="recovery-code" style="font-size:14px">${esc(r.token)}</div>
        <div class="modal-foot"><button class="btn btn-ghost left neg" id="it-revoke">${T('Revoke code')}</button><button class="btn" id="it-copy">📋 ${T('Copy')}</button><button class="btn btn-primary" data-no>${T('Close')}</button></div>`);
      $('#it-copy', m).onclick = async () => { try { await navigator.clipboard.writeText(r.token); toast(T('Code copied')); } catch { toast(T('Copy failed'), 'err'); } };
      $('#it-revoke', m).onclick = async () => { try { await api('/auth/import-token', { method: 'DELETE' }); toast(T('Code revoked')); closeModal(); tokenState(); } catch (e) { fail(e); } };
      $('[data-no]', m).onclick = closeModal;
    } catch (err) { fail(err); }
  };
  $('#s-autolock').onchange = async (e) => {
    try { const r = await api('/auth/settings', { method: 'PUT', body: { auto_lock: +e.target.value } }); AUTH.status.auto_lock = r.auto_lock; toast(T('Auto-lock updated')); } catch (err) { fail(err); }
  };
}
// controls of the General, Spaces and Backup tabs (each binds only what its tab shows)
function bindSettingsCommon(v) {
  $$('#s-theme button').forEach((b) => (b.onclick = () => setTheme(b.dataset.t)));
  $('#s-backup')?.addEventListener('click', () => { S.lastBackup = todayIso(); });
  $('#s-lang')?.addEventListener('change', async (e) => {  // saved in the keystore; the page reloads in the new language
    try {
      await api('/auth/language', { method: 'PUT', body: { language: e.target.value } });
      if (AUTH.status?.demo) sessionStorage.setItem('hc-demo-lang', '1');  // the sample data changes at the next start
      location.reload();
    }
    catch (err) { e.target.value = LANG; fail(err); }
  });
  $('#s-cur')?.addEventListener('change', async (e) => {
    const code = e.target.value;
    if (code === CUR) return;
    const c = CURRENCIES[code];
    if (!(await confirmDialog(`${T('HomeCoin will show every amount in {currency} ({code}), written as {example}.', { currency: c.name, code, example: currencyExample(code) })} `
      + T('Amounts are NOT converted: the numbers stay the same, only the symbol and the format change. Use it only if your accounts are kept in that currency. ')
      + `${DIGITS && !new Intl.NumberFormat(c.locale, { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ? `${T('{currency} has no decimals: amounts are shown rounded.', { currency: c.name })} ` : ''}`
      + T('Security prices downloaded so far are cleared: use "Update prices" in Investments to get them again in the new currency. ')
      + T('Variable-rate loans keep the index they have.'),
    { ok: T('Switch to {code}', { code }), danger: false, title: T('⚠️ Change the reference currency') }))) { e.target.value = CUR; return; }
    try {
      await api('/settings/currency', { method: 'PUT', body: { currency: code, confirm: true } });
      await loadMeta();
      toast(T('Reference currency: {currency}', { currency: c.name }));
      route();
    } catch (err) { e.target.value = CUR; fail(err); }
  });
  $('#s-pf-new')?.addEventListener('click', () => portfolioModal());
  $$('[data-pf-go]', v).forEach((b) => (b.onclick = () => switchPortfolio(+b.dataset.pfGo)));
  $$('[data-pf-edit]', v).forEach((b) => (b.onclick = () => portfolioModal(S.portfolios.find((p) => p.id === +b.dataset.pfEdit))));
  if (!$('#s-restore')) return;
  $('#s-restore').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await confirmDialog(`${T('Restore the backup "{name}"?', { name: f.name })} ${T('All current data will be replaced.')}`, { ok: T('Restore') }))) return;
    const send = async (password) => {
      const fd = new FormData(); fd.append('file', f);
      if (password) fd.append('password', password);
      await api('/restore', { method: 'POST', body: fd });
      closeModal(); toast(T('Backup restored')); refresh();
    };
    try { await send(); } catch (err) {
      if (err.status !== 422) return fail(err);
      // backup from another installation or from before a key change: the password of that time is needed
      const m = openModal(T('Backup password'), `<p class="muted small">${esc(err.message)}</p>
        <label class="field">${T('Password or recovery key')}<input type="password" id="rb-pw" autocomplete="off" autofocus></label>
        <div class="modal-foot"><button class="btn" data-close2>${T('Cancel')}</button><button class="btn btn-primary" id="rb-go">${T('Restore')}</button></div>`);
      $('[data-close2]', m).onclick = closeModal;
      $('#rb-go').onclick = async () => { try { await send($('#rb-pw').value); } catch (e2) { fail(e2); } };
    } finally { e.target.value = ''; }
  };
}

// ================================================================ updates
// Signed GitHub releases (see homecoin/updater.py). mode: 'auto' = at most once a day if enabled, 'check' = ask now,
// nothing = only the last known state (no network). A new version shows a small chip at the top and a dot on Settings.
async function loadUpdate(mode) {
  try {
    S.update = await api('/update' + (mode === 'check' ? '?check=1' : mode === 'auto' ? '?auto=1' : ''));
  } catch { return null; }
  const on = !!S.update.available && !S.update.demo;
  $('#update-chip').classList.toggle('hidden', !on);
  $('#update-chip').textContent = on ? `⬆ ${T('HomeCoin {version} is available', { version: S.update.latest })}` : '';
  $('#nav-update-dot').classList.toggle('hidden', !on);
  return S.update;
}
// automatic backups, all in the user's hands: where they are saved (and another folder), when (at start, every day
// or week), how many are kept, before which operations; one by hand; and for each backup the comparison with the
// current data, to put back rows one by one or everything
const BACKUP_REASONS = () => ({
  startup: T('at start'), scheduled: T('periodic'), manual: T('by hand'), 'pre-convert': T('before turning expenses into transfers'),
  'pre-reconcile': T('before a reconciliation'), 'pre-doubles': T('before removing doubles'), 'pre-import': T('before an import'),
  'pre-restore': T('before a restore'), 'pre-restore-tx': T('before putting rows back'), update: T('before an update'),
});
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function drawBackups() {
  const card = $('#bk-card');
  if (!card) return;
  let d;
  try { d = await api('/backup-settings'); } catch (e) { card.innerHTML = `<div class="small neg">${esc(e.message)}</div>`; return; }
  const s = d.settings, why = BACKUP_REASONS();
  card.innerHTML = `<div class="card-head"><div><h3>🕘 ${T('Automatic backups')}</h3>
      <p class="muted small" style="margin:3px 0 0">${T('Encrypted copies of all the data, saved by HomeCoin by itself. From any of them you can see what changed and put back only what you need.')}</p></div>
      <button class="btn btn-sm btn-primary" id="bk-now">💾 ${T('Save a backup now')}</button></div>
    <div class="bk-grid">
      <div class="bk-box"><h4>📁 ${T('Folder')}</h4>
        <code class="path">${esc(d.folder)}</code>
        ${d.fallback ? `<p class="small neg">⚠️ ${T('The folder you chose cannot be reached (a drive removed?): backups go to the default folder until it is back.')}</p>` : ''}
        <div class="bk-row"><button class="btn btn-sm" id="bk-open">📂 ${T('Open folder')}</button>
          ${s.dir ? `<button class="btn btn-sm btn-ghost" id="bk-default">${T('Use the default folder')}</button>` : ''}</div>
        <label class="field">${T('Another folder (full path)')}<span class="bk-row"><input id="bk-dir" placeholder="${esc(d.default_folder)}" value="${esc(s.dir)}"><button class="btn btn-sm" id="bk-dir-save">${T('Use')}</button></span></label>
        <p class="muted small">${T('For example a USB drive or a synced folder: the copies are encrypted and open only in HomeCoin with your password.')}</p></div>
      <div class="bk-box"><h4>⏱️ ${T('When')}</h4>
        <label class="check"><input type="checkbox" id="bk-start" ${s.on_start ? 'checked' : ''}> ${T('At every start')}</label>
        <label class="field">${T('Also periodically, while HomeCoin is open')}
          <select id="bk-every">${[['none', T('Never')], ['daily', T('Every day')], ['weekly', T('Every week')]].map(([k, l]) => `<option value="${k}" ${s.every === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">${T('How many to keep (the oldest are deleted)')}<input id="bk-keep" type="number" min="3" max="200" value="${s.keep}"></label></div>
      <div class="bk-box"><h4>🛟 ${T('Before these operations')}</h4>
        ${d.triggers.map((t) => `<label class="check"><input type="checkbox" data-trigger="${t}" ${s.triggers[t] ? 'checked' : ''}> ${esc(why[t] || t)}</label>`).join('')}
        <p class="muted small">${T('Each one is the way back if the operation goes wrong: switch them off only if you have another backup. Before a full restore a copy is always saved.')}</p></div>
    </div>
    <div class="section-title" style="margin:18px 0 8px">${tn('{n} backup', '{n} backups', d.backups.length)}</div>
    <div class="bk-list">${d.backups.length ? d.backups.map((b) => `<div class="bk-item">
        <span class="bk-when">${esc(fmtDate(b.at.slice(0, 10)))} <b>${esc(b.at.slice(11))}</b></span>
        <span class="tag">${esc(why[b.reason] || b.reason)}</span>${b.default_folder && s.dir && !d.fallback ? `<span class="tag">${T('default folder')}</span>` : ''}
        <span class="muted small">${fmtSize(b.size)}</span><span class="spacer"></span>
        <button class="btn btn-sm" data-bk="${esc(b.name)}">🔍 ${T('Compare and restore')}</button></div>`).join('')
      : `<div class="muted small">${T('There are no automatic backups yet')}</div>`}</div>`;
  const save = async (body) => { try { await api('/backup-settings', { method: 'PUT', body }); toast(T('Backup settings saved')); drawBackups(); } catch (e) { fail(e); } };
  $('#bk-now').onclick = async () => { try { await api('/backup-now', { method: 'POST' }); toast(T('Backup saved')); S.lastBackupAuto = todayIso(); drawBackups(); } catch (e) { fail(e); } };
  $('#bk-open').onclick = async () => { try { await api('/backup-folder/open', { method: 'POST' }); } catch (e) { fail(e); } };
  $('#bk-default')?.addEventListener('click', () => save({ dir: '' }));
  $('#bk-dir-save').onclick = () => save({ dir: $('#bk-dir').value.trim() });
  $('#bk-start').onchange = (e) => save({ on_start: e.target.checked });
  $('#bk-every').onchange = (e) => save({ every: e.target.value });
  $('#bk-keep').onchange = (e) => { const n = Math.round(Number(e.target.value)); if (n >= 3 && n <= 200) save({ keep: n }); else { toast(T('Keep between 3 and 200 backups'), 'err'); e.target.value = s.keep; } };
  $$('[data-trigger]', card).forEach((el) => (el.onchange = async () => {
    if (!el.checked && !(await confirmDialog(T('Without this backup a wrong operation cannot be undone from here. Switch it off?'), { ok: T('Switch off') }))) { route(); return; }
    save({ triggers: { [el.dataset.trigger]: el.checked } });
  }));
  $$('[data-bk]', card).forEach((b) => (b.onclick = async () => { await backupCompareModal(b.dataset.bk); drawBackups(); }));
}

// one backup against the current data, for each kind of row: deleted since then (put back), changed (take back to how
// it was), added (only shown). Then put back the ticked rows, or restore everything to that backup.
async function backupCompareModal(name) {
  let r;
  try { r = await api('/backups/compare', { method: 'POST', body: { backup: name } }); } catch (e) { fail(e); return; }
  const TAB = { transactions: `💸 ${T('Transactions')}`, recurring: `🔁 ${T('Recurring')}`, accounts: `🏦 ${T('Accounts')}`, categories: `🏷️ ${T('Categories')}`, rules: `⚙️ ${T('Rules')}` };
  const put = {}, rev = {};
  Object.keys(TAB).forEach((t) => { put[t] = new Set(); rev[t] = new Set(); });
  let tab = Object.keys(TAB).find((t) => r.tables[t].deleted.length || r.tables[t].changed.length) || 'transactions';
  return new Promise((resolve) => {
    const m = openModal(T('Compare with the backup of {date}', { date: `${fmtDate(name.slice(9, 13) + '-' + name.slice(13, 15) + '-' + name.slice(15, 17))} ${name.slice(18, 20)}:${name.slice(20, 22)}` }), `
      <p class="muted small" style="margin-top:0">${T('What changed in all the spaces since this backup. Tick what to put back: only those rows change, everything else stays as it is now.')}</p>
      <div class="seg" id="bc-tabs">${Object.entries(TAB).map(([t, l]) => {
        const n = r.tables[t].deleted.length + r.tables[t].changed.length + r.tables[t].added.length;
        return `<button type="button" data-t="${t}">${l}${n ? ` <span class="tag">${n}</span>` : ''}</button>`;
      }).join('')}</div>
      <div id="bc-out" style="margin-top:12px"></div>
      <div class="modal-foot"><button class="btn btn-ghost left neg" id="bc-all">⚠️ ${T('Restore everything to this backup')}</button>
        <button class="btn" data-cancel>${T('Close')}</button><button class="btn btn-primary" id="bc-go" disabled>${T('Put back the ticked ones')}</button></div>`, { wide: true });
    const done = () => { closeModal(); resolve(); };
    $('[data-cancel]', m).onclick = done;
    const desc = (x) => `${x.kind ? `${KIND_LABEL[x.kind] || x.kind} · ` : ''}${x.account ? esc(x.account) : ''}${x.to_account ? ` → ${esc(x.to_account)}` : ''}`;
    const amount = (x) => (x.amount != null ? money(x.amount) : '');
    const count = () => Object.values(put).reduce((s, x) => s + x.size, 0) + Object.values(rev).reduce((s, x) => s + x.size, 0);
    const draw = () => {
      $$('#bc-tabs button', m).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
      const d = r.tables[tab];
      const card = (x, box, set) => `<div class="ri"><span class="ri-date">${x.date ? fmtDate(String(x.date).slice(0, 10)) : ''}</span><span class="ri-desc">${esc(x.label)}</span>
        <span class="ri-amt">${amount(x)}</span><div class="ri-act">${box ? `<label><input type="checkbox" data-${box}="${x.id}" ${set.has(x.id) ? 'checked' : ''}> ${box === 'put' ? T('Put back') : T('Take back to how it was')}</label>` : ''}<span class="muted">${desc(x)}</span></div></div>`;
      const sec = (title, html) => (html ? `<div class="small" style="margin-top:12px"><b>${title}</b></div><div class="ri-list">${html}</div>` : '');
      $('#bc-out', m).innerHTML = sec(`🗑 ${T('Deleted since then')}`, d.deleted.map((x) => card(x, 'put', put[tab])).join(''))
        + sec(`✏️ ${T('Changed since then')}`, d.changed.map((c) => card({ ...c.before }, 'rev', rev[tab])
          .replace('</div></div>', `</div><div class="ri-note muted">${T('now')}: ${esc(c.after.label)} · ${amount(c.after)} · ${desc(c.after)}</div></div>`)).join(''))
        + sec(`＋ ${T('Added since then')}`, d.added.map((x) => card(x)).join(''))
        + (d.deleted.length || d.changed.length || d.added.length ? '' : `<div class="muted small">${T('Nothing changed here since then.')}</div>`);
      $$('[data-put]', m).forEach((el) => (el.onchange = () => { el.checked ? put[tab].add(+el.dataset.put) : put[tab].delete(+el.dataset.put); $('#bc-go', m).disabled = !count(); }));
      $$('[data-rev]', m).forEach((el) => (el.onchange = () => { el.checked ? rev[tab].add(+el.dataset.rev) : rev[tab].delete(+el.dataset.rev); $('#bc-go', m).disabled = !count(); }));
      $('#bc-go', m).disabled = !count();
    };
    $$('#bc-tabs button', m).forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    $('#bc-go', m).onclick = async () => {
      if (!(await confirmDialog(T('Put back the ticked rows? A backup of the current data is saved first.'), { ok: T('Put back'), danger: false }))) { resolve(); return; }
      try {
        const res = await api('/backups/put-back', { method: 'POST', body: { backup: name,
          put_back: Object.fromEntries(Object.entries(put).map(([t, x]) => [t, [...x]])), revert: Object.fromEntries(Object.entries(rev).map(([t, x]) => [t, [...x]])) } });
        toast(tn('{n} row put back', '{n} rows put back', res.done) + (res.skipped ? ` · ${tn('{n} skipped: its account no longer exists', '{n} skipped: their account no longer exists', res.skipped)}` : ''));
        await loadMeta(); done();
      } catch (e) { fail(e); }
    };
    $('#bc-all', m).onclick = async () => {
      if (!(await confirmDialog(T('All the current data will be replaced by this backup (a copy of the current data is saved first). Continue?'), { ok: T('Restore everything') }))) { resolve(); return; }
      try { await api('/backups/restore-all', { method: 'POST', body: { backup: name } }); toast(T('Data restored')); await loadMeta(); done(); route(); } catch (e) { fail(e); }
    };
    draw();
  });
}

function updatePane() {
  const u = S.update;
  if (!u) return `<div class="card"><div class="empty">${T('The update status could not be read')}</div></div>`;
  if (u.demo) return `<div class="card empty"><div class="big">🔄</div><h3>${T('Updates are off in the demo')}</h3>
    <p>${T('The demo works offline with made-up data. In your own HomeCoin this tab checks GitHub for new versions and installs them after verifying their signature.')}</p></div>`;
  const when = u.checked ? T('last checked {date} at {time}', { date: esc(fmtDate(u.checked.slice(0, 10))), time: esc(u.checked.slice(11, 16)) }) : T('not checked yet');
  const status = u.error ? `<span class="tag warn">${T('could not check')}</span> ${esc(u.error)}`
    : u.available ? `<span class="tag ai">${T('version {version} is available', { version: esc(u.latest) })}</span>` : u.checked ? `<span class="tag ok">✔ ${T('up to date')}</span>` : '';
  const how = { installer: T('The new installer runs by itself in the background and HomeCoin reopens.'),
    zip: T('The program files in this folder are replaced (a copy of the old ones is kept) and HomeCoin restarts.'),
    dev: T('This is a development copy (a git working tree): update it with git. Nothing is installed from here.'),
    unknown: T('This copy cannot update itself: download the new version from GitHub.') }[u.kind];
  const action = !u.available ? ''
    : u.can_apply ? `<button class="btn btn-primary" id="s-upd-go">⬆ ${T('Update to {version}', { version: esc(u.latest) })}</button>`
      : `<a class="btn" href="${esc(u.url)}" target="_blank" rel="noopener noreferrer">${T('Open on GitHub ↗')}</a>`;
  return `<div class="grid-2">
    <div class="card"><div class="card-head"><h3>🔄 ${T('Updates')}</h3><button class="btn btn-sm" id="s-upd-check">${T('Check now')}</button></div>
      <div class="settings-row"><div><b>HomeCoin ${esc(u.current)}</b><p class="muted small">${status}${status ? ' · ' : ''}${when}</p></div></div>
      ${u.available ? `<div class="settings-row"><div><b>${T('Version')} ${esc(u.latest)}</b><p class="muted small">${how}</p></div>${action}</div>
        ${u.notes ? `<details class="upd-notes"><summary>${T('What\'s new in {version}', { version: esc(u.latest) })}</summary><div class="upd-notes-text">${esc(u.notes)}</div></details>` : ''}` : ''}
      <div class="settings-row"><div><b>${T('Check automatically')}</b><p class="muted small">${T('Once a day, after you sign in, HomeCoin asks GitHub whether there is a new version. Nothing about you or your data is sent.')}</p></div>
        <label class="switch"><input type="checkbox" id="s-upd-auto" ${u.auto ? 'checked' : ''}><span></span></label></div>
    </div>
    <div class="card"><div class="card-head"><h3>🛡️ ${T('How updates stay safe')}</h3></div><div class="list small">
      <div>✍️ ${T('Every release is <b>signed</b> by the maintainer: HomeCoin checks the signature (Ed25519) with a key built into the program and refuses anything else, even if it came from GitHub.')}</div>
      <div>🔢 ${T('Every downloaded byte is checked against the signed <b>SHA-256</b> before anything is installed.')}</div>
      <div>⏫ ${T('Only <b>newer</b> published versions are offered: never test builds, never an older version.')}</div>
      <div>💾 ${T('An encrypted <b>backup</b> of the database is saved first; the data folder is never part of an update.')}</div>
      <div>🖐️ ${T('Nothing is installed until you click <b>Update</b>.')}</div>
    </div></div></div>`;
}
function bindUpdatePane(v) {
  $('#s-upd-check', v)?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = T('⏳ Checking…');
    await loadUpdate('check');
    route();
  });
  $('#s-upd-auto', v)?.addEventListener('change', async (e) => {
    try { S.update = await api('/update/settings', { method: 'PUT', body: { auto: e.target.checked } }); toast(e.target.checked ? T('Automatic checks on') : T('Automatic checks off')); } catch (err) { fail(err); }
  });
  $('#s-upd-go', v)?.addEventListener('click', applyUpdate);
}
async function applyUpdate() {
  const u = S.update, btn = $('#s-upd-go');
  if (!(await confirmDialog(T('HomeCoin will download version {version} from GitHub, verify its signature and SHA-256, save an encrypted backup of the database and install it. Then it restarts by itself (about a minute). Your data is not touched.', { version: u.latest }),
    { ok: `⬆ ${T('Update to {version}', { version: esc(u.latest) })}`, danger: false, title: T('🔄 Update HomeCoin') }))) return;
  if (btn) { btn.disabled = true; btn.textContent = T('⏳ Downloading and verifying…'); }
  let r;
  try { r = await api('/update/apply', { method: 'POST' }); } catch (e) {
    fail(e);
    if (btn) { btn.disabled = false; btn.textContent = `⬆ ${T('Update to {version}', { version: u.latest })}`; }
    return;
  }
  document.body.classList.add('locked');
  wipeView();
  $('#lock-body').innerHTML = `<h2>${T('Updating to {version}', { version: esc(r.version) })} ⏳</h2>
    <p class="muted small" id="upd-msg">${T('The new version was verified and is being installed. This page reloads by itself when HomeCoin is back.')}</p>`;
  const started = Date.now();
  const poll = async () => {
    try {
      const st = await fetch('/api/auth/status', { headers: { 'X-HomeCoin': '1' } }).then((x) => x.json());
      if (st.version === r.version) { location.replace('/'); return; }
    } catch { /* restarting */ }
    if (Date.now() - started > 180000 && $('#upd-msg')) {
      $('#upd-msg').textContent = T('This is taking longer than expected. If HomeCoin does not come back, open it again from its shortcut (or with HomeCoin.cmd in the ZIP version).');
    }
    setTimeout(poll, 2000);
  };
  setTimeout(poll, 3000);
}

// ================================================================ security check
// One entry per protection: status (✔ fine · ⚠ needs fixing · ✖ problem) and, only when needed, the button to fix it.
async function securityCheck(v) {
  const btn = $('#sec-go', v), list = $('#sec-list', v);
  if (!btn) return;
  btn.disabled = true; btn.textContent = T('⏳ Checking…');
  try {
    const [r, st] = await Promise.all([api('/auth/integrity'), fetch('/api/auth/status', { headers: { 'X-HomeCoin': '1' } }).then((x) => x.json())]);
    AUTH.status = st;
    const n = r.counts, others = r.folder_others;
    const dbOk = !r.pages_tampered && r.structure.join() === 'ok' && !r.foreign_key_errors && !r.plaintext_files.length;
    const lock = st.auto_lock, until = st.import_token_until;
    const items = [
      [dbOk ? 'ok' : 'bad', T('Database encrypted and intact'), dbOk
        ? `${esc(r.cipher)} · ${tn('{n} transaction', '{n} transactions', n.transactions)}, ${tn('{n} account', '{n} accounts', n.accounts)} · ${tn('{n} automatic backup, no unencrypted files', '{n} automatic backups, no unencrypted files', r.backups)}`
        : `${T('tampered pages: {n}', { n: r.pages_tampered })} · ${T('structure: {result}', { result: esc(r.structure.join(', ')) })} · ${T('unencrypted files:')} ${esc(r.plaintext_files.join(', ') || T('none'))} — ${T('restore the last intact backup')}`, ''],
      others == null ? ['na', T('Data folder restricted to your user'), T('cannot be checked on this system'), '']
        : others.length ? ['warn', T('Data folder restricted to your user'), T('also accessible to other accounts on this PC ({accounts}): they could copy or delete it', { accounts: esc(others.join(', ')) }), `<button class="btn btn-sm btn-primary" data-fix="folder">🔒 ${T('Protect')}</button>`]
          : ['ok', T('Data folder restricted to your user'), T('only you, the system and administrators can open it'), ''],
      [r.kdf.password_n >= r.kdf.target_n ? 'ok' : 'warn', T('Password: strengthened key'), r.kdf.password_n >= r.kdf.target_n ? 'scrypt N=2^17' : T('it is strengthened at the next sign-in'), ''],
      r.kdf.recovery_n && r.kdf.recovery_n < r.kdf.target_n
        ? ['warn', T('Strengthened recovery key'), T('created with the protection of the previous version: generate a new one (the old one stops working)'), `<button class="btn btn-sm btn-primary" data-fix="recovery">🔑 ${T('Generate new')}</button>`]
        : ['ok', T('Strengthened recovery key'), 'scrypt N=2^17', ''],
      [lock && lock <= 30 ? 'ok' : 'warn', T('Auto-lock'), lock ? `${T('after {duration} without activity', { duration: durationLabel(lock) })}${lock > 30 ? T(' — 30 minutes or less is better') : ''}` : T('off'), ''],
      until ? ['warn', T('Import code'), T('active until {time}: revoke it if you do not need it', { time: new Date(until * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }), `<button class="btn btn-sm" data-fix="token">${T('Revoke code')}</button>`]
        : ['ok', T('Import code'), T('no active code'), ''],
    ];
    const ICON = { ok: '✔', warn: '⚠', bad: '✖', na: '–' };
    list.innerHTML = items.map(([s, title, what, act]) => `<div class="sec-row ${s}"><span class="sec-ico">${ICON[s]}</span>
      <div class="grow"><b>${title}</b><div class="muted small">${what}</div></div>${act}</div>`).join('');
    const todo = items.filter(([s]) => s === 'warn' || s === 'bad').length;
    $('#sec-sum', v).innerHTML = todo ? `<span class="tag warn">${tn('{n} thing to fix', '{n} things to fix', todo)}</span> · ${T('checked at {time}', { time: esc(r.checked_at.slice(11, 16)) })}`
      : `<span class="tag ai">✔ ${T('all protected')}</span> · ${T('checked at {time}', { time: esc(r.checked_at.slice(11, 16)) })}`;
    $$('[data-fix]', list).forEach((b) => (b.onclick = async () => {
      if (b.dataset.fix === 'folder') { if (await protectFolder()) securityCheck(v); }
      if (b.dataset.fix === 'recovery') recoveryModal(() => securityCheck(v));
      if (b.dataset.fix === 'token') { try { await api('/auth/import-token', { method: 'DELETE' }); toast(T('Code revoked')); securityCheck(v); } catch (e) { fail(e); } }
    }));
  } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  btn.disabled = false; btn.textContent = T('🩺 Check now');
}
async function protectFolder() {
  if (!(await confirmDialog(T('Make the HomeCoin data folder accessible only to your Windows user (plus the system and administrators)? Other accounts on this PC will no longer be able to read or change it. If something goes wrong, the permissions go back to how they were.'),
    { ok: T('🔒 Protect'), danger: false, title: T('Protect the data folder') }))) return false;
  try {
    const x = await api('/auth/protect-folder', { method: 'POST' });
    toast(x.folder_others?.length ? T('Permissions only partly updated') : T('Data folder restricted to your user'));
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
    if (!(await confirmDialog(`${T('Your data folder is also accessible to other accounts on this PC ({accounts}).', { accounts: others.join(', ') })} ${T('The data is encrypted, but they could copy it to try to guess the password, or delete it. Restrict it to your Windows user?')}`,
      { ok: T('🔒 Protect now'), danger: false, title: T('🛡️ Data folder protection') }))) {
      toast(T('You can do it any time from Settings → Security check'), 'info');
      return;
    }
    const x = await api('/auth/protect-folder', { method: 'POST' });
    toast(x.folder_others?.length ? T('Permissions only partly updated') : T('Data folder restricted to your user'));
  } catch (err) { fail(err); }
}

function passwordModal() {
  const m = openModal(T('Change password'), `<div class="form-grid">
      <label class="field full">${T('Current password')}<input type="password" id="p-cur" autocomplete="current-password" autofocus></label>
      <label class="field full">${T('New password')}<input type="password" id="p-new" autocomplete="new-password"></label>
      <div class="full pw-meter"><span id="p-meter"></span></div>
      <label class="field full">${T('Confirm new password')}<input type="password" id="p-new2" autocomplete="new-password"></label></div>
    <p class="muted small">${T('The data is not re-encrypted: only the protection of the key changes. The recovery key stays valid.')}</p>
    <div class="modal-foot"><button class="btn" data-no>${T('Cancel')}</button><button class="btn btn-primary" id="p-go">${T('Change password')}</button></div>`);
  // fields of this dialog only (ids of their own): the sign-in screen has fields with other ids in the same page
  pwMeter($('#p-new', m), $('#p-meter', m));
  $('[data-no]', m).onclick = closeModal;
  $('#p-go', m).onclick = async () => {
    try {
      checkNew($('#p-new', m).value, $('#p-new2', m).value);
      await api('/auth/password', { method: 'POST', body: { current: $('#p-cur', m).value, password: $('#p-new', m).value } });
      closeModal(); toast(T('Password changed'));
    } catch (err) { fail(err); }
  };
}
function recoveryModal(onDone) {
  const m = openModal(T('New recovery key'), `<p class="muted small">${T('The current key will stop working. Confirm with your password.')}</p>
    <label class="field">${T('Current password')}<input type="password" id="p-cur" autocomplete="current-password" autofocus></label>
    <div class="modal-foot"><button class="btn" data-no>${T('Cancel')}</button><button class="btn btn-primary" id="p-go">${T('Generate')}</button></div>`);
  $('[data-no]', m).onclick = closeModal;
  $('#p-go', m).onclick = async () => {
    try {
      const r = await api('/auth/recovery-key', { method: 'POST', body: { current: $('#p-cur', m).value } });
      const m2 = openModal(T('Your new recovery key'), `<p class="muted small">${T('Save it in a safe place: it will not be shown again.')}</p>
        <div class="recovery-code">${esc(r.recovery_key)}</div>
        <div class="modal-foot"><button class="btn" id="k-copy">📋 ${T('Copy')}</button><button class="btn btn-primary" data-no>${T('Done')}</button></div>`);
      $('#k-copy', m2).onclick = async () => { try { await navigator.clipboard.writeText(r.recovery_key); toast(T('Key copied')); } catch { toast(T('Copy failed'), 'err'); } };
      $('[data-no]', m2).onclick = () => { closeModal(); onDone?.(); };
    } catch (err) { fail(err); }
  };
}

// ================================================================ startup
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal();
  if (e.key === 'Escape') moreMenu(false);
  if (document.body.classList.contains('locked')) return;
  if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !$('#modal-root').innerHTML) {
    e.preventDefault(); txModal();
  }
});
$('#quick-add').onclick = () => txModal();
$('#theme-toggle').onclick = () => setTheme(isDark() ? 'light' : 'dark');
$('#lock-now').onclick = () => lockNow();
$('#quit-app').onclick = () => quitApp();
// "⋯" menu: the actions used less often (theme, help, donate, close), out of the way of the everyday ones
const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark' ||
  (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
const moreMenu = (open) => {
  if (open) $('#theme-toggle').innerHTML = isDark() ? `<span class="mi">☀️</span><span>${T('Light theme')}</span>` : `<span class="mi">🌙</span><span>${T('Dark theme')}</span>`;
  $('#more-menu').classList.toggle('hidden', !open);
  $('#more-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
};
$('#more-btn').onclick = (e) => { e.stopPropagation(); moreMenu($('#more-menu').classList.contains('hidden')); };
$('#more-menu').addEventListener('click', () => moreMenu(false));
document.addEventListener('click', (e) => { if (!e.target.closest('.more')) moreMenu(false); });
$('#privacy-toggle').onclick = () => setPrivacy(!privacyOn());
setPrivacy((() => { try { return localStorage.getItem('homecoin-privacy') === '1'; } catch { return false; } })());
window.addEventListener('hashchange', () => { if (!document.body.classList.contains('locked')) route(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => getTheme() === 'system' && !document.body.classList.contains('locked') && route());
showLock();  // on open: sign-in (or password creation); then load the data

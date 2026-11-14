/* Paycheck Budget — offline-first budget planner (no account, data stays on device) */
(() => {
"use strict";

const MODE = window.APP_MODE === "demo" ? "demo" : "full";
const VERSION = window.APP_VERSION && !/^__/.test(window.APP_VERSION) ? window.APP_VERSION : "dev";
const SHOP = window.SHOP_URL && !/^__/.test(window.SHOP_URL) ? window.SHOP_URL : "https://www.etsy.com/shop/WolyonStudio";
const KEY = MODE === "demo" ? "paycheckbudget.demo.v1" : "paycheckbudget.v1";

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const sum = (a, f = x => x) => a.reduce((t, x) => t + (+f(x) || 0), 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round2 = n => Math.round((+n || 0) * 100) / 100;
const pad = n => String(n).padStart(2, "0");
const LOC = /^en\b/i.test(navigator.language || "") ? navigator.language : "en-US";

/* ---------- dates (ISO yyyy-mm-dd, local) ---------- */
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const addMonths = (s, n, day) => {
  const d = parse(s); const want = day || d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  t.setDate(Math.min(want, daysIn(t.getFullYear(), t.getMonth())));
  return iso(t);
};
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const monthKey = s => String(s).slice(0, 7);
const monthStart = mk => mk + "-01";
const monthEnd = mk => { const [y, m] = mk.split("-").map(Number); return `${mk}-${pad(daysIn(y, m - 1))}`; };
const shiftMonth = (mk, n) => addMonths(monthStart(mk), n, 1).slice(0, 7);
const fmtDate = (s, o = { month: "short", day: "numeric" }) => parse(s).toLocaleDateString(LOC, o);
const fmtMonth = mk => parse(monthStart(mk)).toLocaleDateString(LOC, { month: "long", year: "numeric" });
const weekday = s => parse(s).toLocaleDateString(LOC, { weekday: "short" });
const relDay = s => { const d = diffDays(today(), s); if (d === 0) return "Today"; if (d === 1) return "Tomorrow"; if (d === -1) return "Yesterday"; if (d > 1 && d < 7) return weekday(s); if (d < 0) return `${-d} days ago`; return fmtDate(s); };

/* ---------- recurrence ---------- */
const FREQS = [["once", "One time"], ["weekly", "Every week"], ["biweekly", "Every 2 weeks"], ["semimonthly", "Twice a month"], ["monthly", "Every month"], ["quarterly", "Every 3 months"], ["yearly", "Every year"]];
const freqLabel = f => (FREQS.find(x => x[0] === f) || [, f])[1];
const perMonth = (amt, f) => ({ once: 0, weekly: amt * 52 / 12, biweekly: amt * 26 / 12, semimonthly: amt * 2, monthly: amt, quarterly: amt / 3, yearly: amt / 12 }[f] || 0);
function occurrences(item, from, to) {
  const out = []; const a = item.date; if (!a) return out;
  const f = item.freq || "monthly";
  if (f === "once") { if (a >= from && a <= to) out.push(a); return out; }
  if (f === "weekly" || f === "biweekly") {
    const step = f === "weekly" ? 7 : 14; let d = a;
    if (d < from) { const k = Math.floor(diffDays(a, from) / step); d = addDays(a, k * step); if (d < from) d = addDays(d, step); }
    for (let i = 0; d <= to && i < 600; i++, d = addDays(d, step)) out.push(d);
    return out;
  }
  const anchorDay = parse(a).getDate();
  if (f === "semimonthly") {
    const d1 = anchorDay, d2 = d1 <= 15 ? d1 + 15 : d1 - 15;
    let mk = monthKey(a < from ? from : a);
    for (let i = 0; i < 400; i++) {
      const [y, m] = mk.split("-").map(Number);
      for (const dd of [d1, d2].sort((x, y) => x - y)) {
        const s = `${mk}-${pad(Math.min(dd, daysIn(y, m - 1)))}`;
        if (s >= a && s >= from && s <= to) out.push(s);
      }
      if (monthStart(mk) > to) break; mk = shiftMonth(mk, 1);
    }
    return [...new Set(out)];
  }
  const step = f === "quarterly" ? 3 : f === "yearly" ? 12 : 1;
  let n = 0;
  if (a < from) { const md = (parse(from).getFullYear() - parse(a).getFullYear()) * 12 + parse(from).getMonth() - parse(a).getMonth(); n = Math.max(0, Math.floor(md / step) - 1); }
  for (let i = 0; i < 600; i++, n++) {
    const d = addMonths(a, n * step, anchorDay);
    if (d > to) break; if (d >= from) out.push(d);
  }
  return out;
}

/* ---------- state ---------- */
const DEFAULT_CATS = [
  ["Housing", "🏠", "needs"], ["Utilities", "💡", "needs"], ["Groceries", "🛒", "needs"], ["Transport", "🚗", "needs"],
  ["Phone & internet", "📱", "needs"], ["Insurance", "🛡️", "needs"], ["Health", "💊", "needs"], ["Kids & pets", "🧸", "needs"],
  ["Eating out", "🍔", "wants"], ["Coffee & snacks", "☕", "wants"], ["Shopping", "🛍️", "wants"], ["Fun", "🎬", "wants"],
  ["Subscriptions", "📺", "wants"], ["Personal care", "💅", "wants"], ["Gifts", "🎁", "wants"], ["Other", "✨", "wants"],
  ["Savings", "🌱", "future"], ["Debt payments", "💳", "future"]
];
const GROUPS = { needs: "Needs", wants: "Wants", future: "Savings & debt" };
function blankState() {
  return {
    v: 1, created: today(), onboarded: false,
    settings: { name: "", currency: "USD", theme: "sage", buffer: 0, weekStart: 0, lastBackup: null, help: true, quick: [5, 10, 20, 50] },
    start: { date: today(), amount: 0 },
    cats: DEFAULT_CATS.map(([name, icon, group]) => ({ id: uid(), name, icon, group, budget: 0, sys: name === "Savings" ? "savings" : name === "Debt payments" ? "debt" : undefined })),
    tx: [], bills: [], incomes: [], goals: [], debts: [], debtPlan: { strategy: "snowball", extra: 0 }
  };
}
let S = load();
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { console.warn(e); }
  return null;
}
function migrate(s) {
  const b = blankState();
  s.settings = Object.assign({}, b.settings, s.settings || {});
  for (const k of ["tx", "bills", "incomes", "goals", "debts", "cats"]) if (!Array.isArray(s[k])) s[k] = b[k];
  s.debtPlan = Object.assign({}, b.debtPlan, s.debtPlan || {});
  s.start = s.start || b.start;
  return s;
}
let saveErr = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); saveErr = false; }
  catch (e) { if (!saveErr) toast("Couldn't save on this device. Export a backup from Settings."); saveErr = true; }
}
const cat = id => S.cats.find(c => c.id === id);
const sysCat = k => S.cats.find(c => c.sys === k) || S.cats[S.cats.length - 1];

/* ---------- money ---------- */
const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "ZAR", "INR", "SGD", "AED", "MXN", "BRL", "JPY", "TRY"];
let NF = null, NF0 = null;
function setFormatters() {
  const c = S ? S.settings.currency : "USD";
  try { NF = new Intl.NumberFormat(LOC, { style: "currency", currency: c }); NF0 = new Intl.NumberFormat(LOC, { style: "currency", currency: c, maximumFractionDigits: 0 }); }
  catch (e) { NF = new Intl.NumberFormat(LOC, { style: "currency", currency: "USD" }); NF0 = NF; }
}
const money = (n, whole) => (whole ? NF0 : NF).format(Math.abs(n) < 0.005 ? 0 : n);
const moneyParts = n => { const p = NF.formatToParts(n); let main = "", cents = ""; let after = false; for (const x of p) { if (x.type === "decimal") { after = true; cents += x.value; continue; } if (after && x.type === "fraction") cents += x.value; else main += x.value; } return [main, cents]; };
const num = v => { if (typeof v === "number") return v; const s = String(v || "").replace(/[^\d.,-]/g, ""); if (!s) return 0; const lc = Math.max(s.lastIndexOf(","), s.lastIndexOf(".")); if (lc > -1 && s.length - lc - 1 <= 2) { return parseFloat(s.slice(0, lc).replace(/[.,]/g, "") + "." + s.slice(lc + 1)) || 0; } return parseFloat(s.replace(/[.,]/g, "")) || 0; };

/* ---------- calculations ---------- */
const sign = t => t.dir === "in" ? 1 : -1;
function balance(at = "9999-12-31") { return round2(S.start.amount + sum(S.tx.filter(t => t.date >= S.start.date && t.date <= at), t => sign(t) * t.amount)); }
function paydays(from, to) {
  const out = [];
  for (const inc of S.incomes) for (const d of occurrences(inc, from, to)) out.push({ date: d, inc, got: !!(inc.got && inc.got[d]) });
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}
function nextPayday(t = today()) {
  const p = paydays(addDays(t, 1), addDays(t, 120))[0];
  return p ? p.date : null;
}
function billDue(from, to) {
  const out = [];
  for (const b of S.bills) for (const d of occurrences(b, from, to)) out.push({ date: d, bill: b, paid: !!(b.paid && b.paid[d]) });
  return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : b.bill.amount - a.bill.amount);
}
function overdueBills(t = today()) { return billDue(addDays(t, -45), addDays(t, -1)).filter(x => !x.paid && x.date > S.start.date); }
function safeToSpend() {
  const t = today(); const np = nextPayday(t);
  const end = np || addDays(monthEnd(monthKey(t)), 1);
  const days = Math.max(1, diffDays(t, end));
  const upcoming = billDue(t, addDays(end, -1)).filter(x => !x.paid);
  const overdue = overdueBills(t);
  const bills = round2(sum(upcoming, x => x.bill.amount) + sum(overdue, x => x.bill.amount));
  const bal = balance();
  const spentToday = round2(sum(S.tx.filter(x => x.date === t && x.dir === "out" && !x.billId && x.kind !== "adjust"), x => x.amount));
  const pool = round2(bal - bills - (+S.settings.buffer || 0));
  const startOfDay = pool + spentToday;
  const daily = startOfDay / days;
  const left = round2(daily - spentToday);
  return { t, np, end, days, bills, upcoming, overdue, bal, pool, daily: round2(daily), left, spentToday, buffer: +S.settings.buffer || 0 };
}
function monthTx(mk) { return S.tx.filter(t => monthKey(t.date) === mk); }
function spendTx(list) { return list.filter(t => t.dir === "out" && t.kind !== "adjust"); }
function monthSummary(mk) {
  const list = monthTx(mk);
  const income = round2(sum(list.filter(t => t.dir === "in" && t.kind !== "adjust"), t => t.amount));
  const out = spendTx(list);
  const spent = round2(sum(out, t => t.amount));
  const byCat = {};
  for (const t of out) byCat[t.cat || "_"] = round2((byCat[t.cat || "_"] || 0) + t.amount);
  const planned = round2(sum(paydays(monthStart(mk), monthEnd(mk)), p => p.inc.amount));
  const budgeted = round2(sum(S.cats, c => +c.budget || 0));
  return { income, spent, byCat, planned, budgeted, list };
}
function debtSim(extra, strategy) {
  let ds = S.debts.filter(d => d.balance > 0).map(d => ({ id: d.id, name: d.name, bal: +d.balance, apr: +d.apr || 0, min: +d.min || 0 }));
  if (!ds.length) return null;
  const start = today(); let month = 0, interest = 0; const order = []; const series = [round2(sum(ds, d => d.bal))];
  const minTotal = sum(ds, d => d.min);
  while (ds.some(d => d.bal > 0.005) && month < 600) {
    month++;
    for (const d of ds) if (d.bal > 0) { const i = d.bal * d.apr / 1200; d.bal += i; interest += i; }
    let pool = minTotal + (+extra || 0);
    for (const d of ds) if (d.bal > 0) { const p = Math.min(d.bal, d.min, pool); d.bal -= p; pool -= p; }
    const live = () => ds.filter(d => d.bal > 0.005).sort(strategy === "avalanche" ? (a, b) => b.apr - a.apr || a.bal - b.bal : (a, b) => a.bal - b.bal || b.apr - a.apr);
    let L = live();
    while (pool > 0.005 && L.length) { const d = L[0]; const p = Math.min(d.bal, pool); d.bal -= p; pool -= p; L = live(); }
    for (const d of ds) if (d.bal <= 0.005 && !order.find(o => o.id === d.id)) { d.bal = 0; order.push({ id: d.id, name: d.name, month, date: addMonths(start, month, 1).slice(0, 7) }); }
    series.push(round2(sum(ds, d => d.bal)));
    if (month > 2 && series[month] >= series[month - 1] + 0.01) return { stuck: true, minTotal };
  }
  return { months: month, interest: round2(interest), order, series, done: month < 600, date: addMonths(start, month, 1).slice(0, 7), minTotal };
}

/* ---------- icons ---------- */
const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const IC = {
  today: I('<path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/><circle cx="12" cy="12" r="4"/>'),
  log: I('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  budget: I('<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 15h2"/>'),
  bills: I('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  goals: I('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>'),
  debt: I('<path d="M4 19 20 5"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>'),
  reports: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  more: I('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  left: I('<path d="m15 18-6-6 6-6"/>'), right: I('<path d="m9 18 6-6-6-6"/>'), x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: I('<path d="m5 12 5 5L20 7"/>'), download: I('<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/>'), upload: I('<path d="M12 21V9m0 0 4 4m-4-4-4 4M4 3h16"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'), cal: I('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  money: I('<rect x="2" y="6" width="20" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>')
};
const ROUTES = [
  ["today", "Today", IC.today], ["log", "Spending log", IC.log], ["budget", "Monthly budget", IC.budget], ["bills", "Bills & paydays", IC.bills],
  ["goals", "Savings goals", IC.goals], ["debt", "Debt payoff", IC.debt], ["reports", "Reports", IC.reports], ["settings", "Settings", IC.settings]
];

/* ---------- ui state ---------- */
const U = { route: "today", month: monthKey(today()), q: "", billView: "list", why: false, reportMonth: monthKey(today()) };
function routeFromHash() { const h = location.hash.replace("#", ""); U.route = ROUTES.some(r => r[0] === h) ? h : "today"; }
window.addEventListener("hashchange", () => { routeFromHash(); render(); window.scrollTo(0, 0); });

/* ---------- rendering ---------- */
function render() {
  const app = $("#app");
  document.documentElement.dataset.theme = S ? S.settings.theme : "sage";
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#F4F1EA";
  if (!S || !S.onboarded) { app.innerHTML = viewOnboard(); return; }
  setFormatters();
  const views0 = { today: viewToday, log: viewLog, budget: viewBudget, bills: viewBills, goals: viewGoals, debt: viewDebt, reports: viewReports, settings: viewSettings };
  const views = {}; for (const k in views0) views[k] = () => { try { return views0[k](); } catch (e) { console.error(e); return `<div class="card"><div class="empty"><b>Something went wrong on this screen.</b>Your data is safe. Try another tab, or save a backup from Settings and message us on Etsy.<br><small class="faint">${esc(e && e.message)}</small></div></div>`; } };
  const nav = ROUTES.map(([k, l, ic]) => `<button class="nav-item" data-go="${k}" ${U.route === k ? 'aria-current="page"' : ""}>${ic}<span>${l}</span></button>`).join("");
  const tabs = [["today", "Today", IC.today], ["log", "Log", IC.log], ["add", "", IC.plus], ["budget", "Budget", IC.budget], ["more", "More", IC.more]];
  const moreActive = ["bills", "goals", "debt", "reports", "settings"].includes(U.route);
  app.innerHTML = `
  <div class="shell">
    <nav class="side" aria-label="Main">
      <div class="brand"><div class="brand-mark">${IC.money}</div><div>Paycheck Budget<small>${S.settings.name ? esc(S.settings.name) + "’s planner" : "your money, one calm number"}</small></div></div>
      ${nav}
      <div class="spacer"></div>
      <button class="btn primary" data-act="add-tx">${IC.plus} Log a spend</button>
      <div class="side-foot">${MODE === "demo" ? "Demo version" : "Lifetime licence · no account"} · v${esc(VERSION)}</div>
    </nav>
    <main id="main">${MODE === "demo" ? demoBanner() : ""}${views[U.route]()}</main>
    <nav class="tabbar" aria-label="Main">${tabs.map(([k, l, ic]) => k === "add" ? `<button class="tab-add" data-act="add-tx" aria-label="Log a spend">${ic}</button>` : `<button data-go="${k}" ${(U.route === k || (k === "more" && moreActive)) ? 'aria-current="page"' : ""}>${ic}<span>${l}</span></button>`).join("")}</nav>
  </div>`;
  afterRender();
}
function afterRender() {
  const s = $("#search"); if (s) { s.addEventListener("input", e => { U.q = e.target.value; const pos = e.target.selectionStart; render(); const n = $("#search"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); }
}
function demoBanner() { return `<div class="banner demo"><span>👋 <b>You’re trying the demo.</b> Everything works — play with the example numbers. Your full planner starts empty and is yours to keep.</span><a class="btn sm primary" href="${esc(SHOP)}" target="_blank" rel="noopener">Get the full app</a></div>`; }
function top(eyebrow, title, sub, right = "") { return `<div class="topbar"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div><div class="row wrap">${right}</div></div>`; }
const greet = () => { const h = new Date().getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
function bar(frac, cls = "", tick) { return `<div class="bar ${cls}"><i style="width:${clamp(frac * 100, 0, 100).toFixed(1)}%"></i>${tick != null ? `<span class="tick" style="left:${clamp(tick * 100, 0, 100)}%"></span>` : ""}</div>`; }
const catIcon = id => { const c = cat(id); return c ? c.icon : "•"; };
const catName = id => { const c = cat(id); return c ? c.name : "Uncategorised"; };

/* Today */
function oneThing(st) {
  const t = today();
  if (st.overdue.length) { const o = st.overdue[0]; return { t: `Pay ${esc(o.bill.name)} (${money(o.bill.amount)}) — it was due ${relDay(o.date).toLowerCase()}`, b: `<button class="btn primary sm" data-act="pay-bill" data-id="${o.bill.id}" data-d="${o.date}">Mark paid</button>`, time: "1 min" }; }
  const payToday = paydays(addDays(t, -3), t).find(p => !p.got && p.date > S.start.date);
  if (payToday) return { t: `Did your ${esc(payToday.inc.name)} (${money(payToday.inc.amount)}) arrive?`, b: `<button class="btn primary sm" data-act="got-pay" data-id="${payToday.inc.id}" data-d="${payToday.date}">Yes, add it</button>`, time: "10 sec" };
  const dueToday = st.upcoming.find(x => x.date === t);
  if (dueToday) return { t: `${esc(dueToday.bill.name)} is due today (${money(dueToday.bill.amount)})`, b: `<button class="btn primary sm" data-act="pay-bill" data-id="${dueToday.bill.id}" data-d="${dueToday.date}">Mark paid</button>`, time: "1 min" };
  if (!S.tx.some(x => x.date === t)) return { t: "Log anything you spent today", b: `<button class="btn primary sm" data-act="add-tx">Log it</button>`, time: "30 sec" };
  const lb = S.settings.lastBackup; if (MODE === "full" && S.tx.length > 20 && (!lb || diffDays(lb.slice(0, 10), t) > 14)) return { t: "Save a backup of your planner", b: `<button class="btn primary sm" data-act="backup">Save backup</button>`, time: "20 sec" };
  return { t: "You’re all caught up for today. Nice work. 🌿", b: "", time: "" };
}
function viewToday() {
  const st = safeToSpend(); const t = today();
  const [main, cents] = moneyParts(st.left);
  const one = oneThing(st);
  const todays = S.tx.filter(x => x.date === t).slice().reverse();
  const next7 = billDue(t, addDays(t, 13)).filter(x => !x.paid);
  const npText = st.np ? `${relDay(st.np) === "Tomorrow" ? "tomorrow" : fmtDate(st.np, { weekday: "short", month: "short", day: "numeric" })}` : "the end of the month";
  const mk = monthKey(t); const ms = monthSummary(mk);
  const overCats = S.cats.filter(c => c.budget > 0 && (ms.byCat[c.id] || 0) > c.budget);
  const goals = S.goals.slice(0, 3);
  const hasPay = S.incomes.length > 0;
  return `
  ${top(fmtDate(t, { weekday: "long", month: "long", day: "numeric" }), `${greet()}${S.settings.name ? ", " + esc(S.settings.name) : ""}`, "", `<button class="btn hide-m" data-act="update-balance">Update balance</button><button class="btn primary hide-m" data-act="add-tx">${IC.plus} Log a spend</button>`)}
  ${iosBrowser() ? `<div class="banner demo"><span>📱 You’re in Safari. <b>Add this planner to your Home Screen</b> so it keeps your data safely and opens like an app.</span><button class="btn sm" data-act="help-install">How</button></div>` : ""}${backupNudge()}
  <div class="grid g-main">
    <div class="stack">
      <section class="hero ${st.left < 0 ? "neg" : ""}" aria-label="Safe to spend today">
        <div class="eyebrow">Safe to spend today</div>
        <div class="hero-num num">${esc(main)}<span class="cents">${esc(cents)}</span></div>
        <div class="hero-sub">${st.pool >= 0 ? `<b>${money(st.pool)}</b> has to last until ${hasPay ? "payday, " : ""}<b>${npText}</b> · ${st.days} day${st.days === 1 ? "" : "s"}` : `You’re short <b>${money(-st.pool)}</b> before ${npText}${st.bills ? ` once your ${money(st.bills, true)} of bills come out` : ""}. Spend only what you must.`}</div>
        <div class="hero-stats">
          <div class="hero-stat"><span>Balance</span><b class="num">${money(st.bal, true)}</b></div>
          <div class="hero-stat"><span>Bills before payday</span><b class="num">${money(st.bills, true)}</b></div>
          <div class="hero-stat"><span>${hasPay ? "Days to payday" : "Days left"}</span><b class="num">${st.days}</b></div>
        </div>
        <button class="why" data-act="why">${U.why ? "Hide the math" : "How is this worked out?"}</button>
        ${U.why ? `<div class="why-box">
          <span>Money you have now</span><b class="num">${money(st.bal)}</b>
          <span>− Bills due before ${hasPay ? "payday" : "month end"}${st.overdue.length ? " (incl. overdue)" : ""}</span><b class="num">${money(st.bills)}</b>
          ${st.buffer ? `<span>− Safety cushion</span><b class="num">${money(st.buffer)}</b>` : ""}
          <span>= Free to spend</span><b class="num">${money(st.pool)}</b>
          <span>÷ ${st.days} day${st.days === 1 ? "" : "s"} (incl. today)</span><b class="num">${money(st.daily)}/day</b>
          <span>− Spent today</span><b class="num">${money(st.spentToday)}</b>
        </div>` : ""}
      </section>
      <div class="one" role="region" aria-label="One thing now">
        <div class="one-n">1</div>
        <div><div class="eyebrow">Right now · one thing only${one.time ? " · " + one.time : ""}</div><div class="one-t">${one.t}</div></div>
        ${one.b}
      </div>
      ${!hasPay ? `<div class="banner info"><span>Add your paycheck so the planner knows how long your money has to last.</span><button class="btn sm primary" data-act="edit-income">Add paycheck</button></div>` : ""}
      <section class="card">
        <div class="card-h"><h2>Today</h2><span class="sub">${todays.length ? `${money(st.spentToday)} spent` : ""}</span></div>
        ${todays.length ? `<div class="list">${todays.map(txRow).join("")}</div>` : `<div class="empty"><b>Nothing logged yet today</b>Quick to do: tap <b>+</b> and choose an amount.</div>`}
        ${quickRow()}
      </section>
    </div>
    <div class="stack">
      <section class="card">
        <div class="card-h"><h2>Coming up</h2><button class="btn ghost sm" data-go="bills">All bills</button></div>
        ${next7.length || st.overdue.length ? `<div class="list">${[...st.overdue, ...next7].slice(0, 6).map(billRow).join("")}</div>` : `<div class="empty"><b>No bills in the next 2 weeks</b>${S.bills.length ? "Enjoy the quiet." : `<button class="btn sm" data-act="edit-bill" style="margin-top:8px">Add a bill</button>`}</div>`}
        ${st.np ? `<div class="li"><div class="li-ic">💸</div><div class="li-main"><div class="li-t">Next payday</div><div class="li-s">${relDay(st.np)}</div></div><div class="li-v in num">+${money(sum(paydays(st.np, st.np), p => p.inc.amount))}</div></div>` : ""}
      </section>
      <section class="card">
        <div class="card-h"><h2>${fmtMonth(mk).split(" ")[0]} so far</h2><button class="btn ghost sm" data-go="budget">Budget</button></div>
        <div class="row between small"><span class="muted">Spent</span><b class="num">${money(ms.spent)}</b></div>
        <div class="row between small" style="margin:4px 0 10px"><span class="muted">Money in</span><b class="num">${money(ms.income)}</b></div>
        ${overCats.length ? `<div class="small" style="color:var(--bad)">Over budget: ${overCats.map(c => esc(c.icon + " " + c.name)).join(", ")}</div>` : `<span class="chip good">${IC.check.replace("<svg", '<svg style="width:14px;height:14px"')} Every category is on track</span>`}
      </section>
      ${goals.length ? `<section class="card"><div class="card-h"><h2>Saving up for</h2><button class="btn ghost sm" data-go="goals">Goals</button></div>${goals.map(g => `<div style="margin-bottom:12px"><div class="row between small"><b>${esc(g.icon || "🌱")} ${esc(g.name)}</b><span class="num muted">${money(g.saved, true)} / ${money(g.target, true)}</span></div>${bar(g.target ? g.saved / g.target : 0, "good")}</div>`).join("")}</section>` : ""}
    </div>
  </div>`;
}
function quickRow() {
  const favs = topCats(5);
  return `<div class="row wrap" style="margin-top:12px;gap:8px">${favs.map(c => `<button class="chip" style="min-height:36px;padding:6px 12px;border:0" data-act="add-tx" data-cat="${c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join("")}</div>`;
}
function topCats(n) {
  const cnt = {}; for (const t of S.tx.slice(-120)) if (t.dir === "out" && !t.billId && t.cat) cnt[t.cat] = (cnt[t.cat] || 0) + 1;
  const ranked = S.cats.filter(c => !c.sys).sort((a, b) => (cnt[b.id] || 0) - (cnt[a.id] || 0));
  return ranked.slice(0, n);
}
function backupNudge() {
  if (MODE !== "full" || S.tx.length < 15) return "";
  const lb = S.settings.lastBackup; if (lb && diffDays(lb.slice(0, 10), today()) <= 30) return "";
  return `<div class="banner info"><span>💾 Your planner lives only on this device. Save a backup file now and then — it takes 20 seconds.</span><button class="btn sm primary" data-act="backup">Save backup</button></div>`;
}
function txRow(t) {
  const c = cat(t.cat);
  const label = t.note || (t.kind === "income" ? "Money in" : t.kind === "adjust" ? "Balance correction" : c ? c.name : "Spend");
  const sub = [t.kind === "adjust" ? "" : c ? c.name : "", t.billId ? "Bill" : "", t.goalId ? "Goal" : "", t.debtId ? "Debt" : ""].filter(Boolean).join(" · ");
  return `<div class="li"><button class="li-hit" data-act="edit-tx" data-id="${t.id}"><div class="li-ic">${esc(t.kind === "income" ? "💸" : t.kind === "adjust" ? "⚖️" : c ? c.icon : "•")}</div><div class="li-main"><div class="li-t">${esc(label)}</div><div class="li-s">${esc(sub || relDay(t.date))}</div></div><div class="li-v num ${t.dir === "in" ? "in" : ""}">${t.dir === "in" ? "+" : "−"}${money(t.amount)}</div></button></div>`;
}
function billRow(x) {
  const d = diffDays(today(), x.date);
  const chip = x.paid ? `<span class="chip good">Paid</span>` : d < 0 ? `<span class="chip bad">Overdue</span>` : d <= 3 ? `<span class="chip warn">${relDay(x.date)}</span>` : `<span class="chip">${relDay(x.date)}</span>`;
  return `<div class="li"><button class="li-hit" data-act="edit-bill" data-id="${x.bill.id}"><div class="li-ic">${esc(catIcon(x.bill.cat))}</div><div class="li-main"><div class="li-t">${esc(x.bill.name)}</div><div class="li-s">${fmtDate(x.date, { weekday: "short", month: "short", day: "numeric" })}${x.bill.auto ? " · autopay" : ""}</div></div><div class="li-v num">${money(x.bill.amount)}</div></button>${x.paid ? chip : x.bill.auto && d >= 0 ? `<span class="chip accent">Autopay</span>` : `<button class="btn sm" data-act="pay-bill" data-id="${x.bill.id}" data-d="${x.date}" aria-label="Mark ${esc(x.bill.name)} paid">${d < 0 ? "Pay" : "Paid?"}</button>`}</div>`;
}

/* Log */
function viewLog() {
  const mk = U.month; const q = U.q.trim().toLowerCase();
  let list = monthTx(mk);
  if (q) list = list.filter(t => (t.note || "").toLowerCase().includes(q) || catName(t.cat).toLowerCase().includes(q) || String(t.amount).includes(q));
  list = list.slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const days = {}; for (const t of list) (days[t.date] = days[t.date] || []).push(t);
  const ms = monthSummary(mk);
  return `
  ${top("Spending log", fmtMonth(mk), `${money(ms.spent)} out · ${money(ms.income)} in`, monthNav() + `<button class="btn primary hide-m" data-act="add-tx">${IC.plus} Add</button>`)}
  <section class="card">
    <div class="row" style="margin-bottom:6px"><div style="position:relative;flex:1"><input id="search" class="input" type="search" placeholder="Search notes, categories or amounts" value="${esc(U.q)}" aria-label="Search"></div><button class="btn hide-m" data-act="csv">${IC.download} CSV</button></div>
    ${list.length ? Object.keys(days).map(d => `<div class="day-h"><span>${relDay(d)} · ${fmtDate(d)}</span><span class="num">${money(sum(days[d].filter(t => t.dir === "out" && t.kind !== "adjust"), t => t.amount))}</span></div><div class="list">${days[d].map(txRow).join("")}</div>`).join("") : `<div class="empty"><b>${q ? "No matches" : "Nothing here yet"}</b>${q ? "Try a different word." : "Everything you log for this month shows up here."}</div>`}
  </section>`;
}
function monthNav() { return `<div class="row" style="gap:6px"><button class="icon-btn" data-act="month" data-n="-1" aria-label="Previous month">${IC.left}</button><button class="btn sm" data-act="month" data-n="0">This month</button><button class="icon-btn" data-act="month" data-n="1" aria-label="Next month">${IC.right}</button></div>`; }

/* Budget */
function viewBudget() {
  const mk = U.month; const ms = monthSummary(mk); const t = today();
  const isNow = mk === monthKey(t);
  const pace = isNow ? parse(t).getDate() / daysIn(parse(t).getFullYear(), parse(t).getMonth()) : mk < monthKey(t) ? 1 : 0;
  const left = round2(ms.planned - ms.budgeted);
  const groups = Object.keys(GROUPS).map(g => {
    const cs = S.cats.filter(c => c.group === g);
    if (!cs.length) return "";
    return `<div class="group-h"><h3>${GROUPS[g]}</h3><span class="small muted num">${money(sum(cs, c => ms.byCat[c.id] || 0), true)} of ${money(sum(cs, c => +c.budget || 0), true)}</span></div>
    ${cs.map(c => {
      const sp = ms.byCat[c.id] || 0; const b = +c.budget || 0; const rem = round2(b - sp);
      const hasBill = S.bills.some(x => x.cat === c.id);
      const cls = !b ? "" : sp > b ? "bad" : !hasBill && isNow && sp > b * pace + b * 0.1 ? "warn" : "";
      return `<div class="cat"><div class="li-ic">${esc(c.icon)}</div><button class="li-hit" style="all:unset;cursor:pointer;min-width:0" data-act="edit-cat" data-id="${c.id}"><div class="li-t">${esc(c.name)}</div><div class="li-s num">${money(sp)} spent${b ? ` of ${money(b, true)}` : " · no budget set"}</div></button>
      <div class="cat-left num" style="color:${rem < 0 ? "var(--bad)" : "inherit"}">${b ? (rem < 0 ? "−" + money(-rem) : money(rem)) : "—"}<small>${b ? (rem < 0 ? "over" : "left") : ""}</small></div>
      ${b ? bar(sp / b, cls, isNow ? pace : null) : ""}</div>`;
    }).join("")}`;
  }).join("");
  const unc = ms.byCat["_"] || 0;
  return `
  ${top("Monthly budget", fmtMonth(mk), isNow ? "The thin line on each bar shows where you’d be if you spent evenly through the month." : "", monthNav())}
  <div class="grid g3" style="margin-bottom:16px">
    <div class="tile"><span>Expected money in</span><b class="num">${money(ms.planned, true)}</b><div class="small muted">${money(ms.income, true)} received so far</div></div>
    <div class="tile"><span>Budgeted</span><b class="num">${money(ms.budgeted, true)}</b><div class="small ${left < 0 ? "" : "muted"}" style="${left < 0 ? "color:var(--bad)" : ""}">${left >= 0 ? `${money(left, true)} not given a job yet` : `${money(-left, true)} more than you expect to earn`}</div></div>
    <div class="tile"><span>Spent</span><b class="num">${money(ms.spent, true)}</b><div class="small muted">${ms.budgeted ? Math.round(ms.spent / ms.budgeted * 100) + "% of budget" : "set budgets below"}</div></div>
  </div>
  <section class="card">
    <div class="card-h"><h2>Categories</h2><div class="row"><button class="btn sm" data-act="suggest-budget">Suggest amounts</button><button class="btn sm" data-act="edit-cat">${IC.plus} Category</button></div></div>
    ${groups}
    ${unc ? `<div class="cat"><div class="li-ic">•</div><div><div class="li-t">Uncategorised</div></div><div class="cat-left num">${money(unc)}</div></div>` : ""}
  </section>`;
}

/* Bills */
function viewBills() {
  const t = today();
  const monthly = round2(sum(S.bills, b => perMonth(+b.amount, b.freq)));
  const up = [...overdueBills(t), ...billDue(t, addDays(t, 44))];
  const right = `<div class="seg" role="group" aria-label="View"><button data-act="billview" data-v="list" aria-pressed="${U.billView === "list"}">List</button><button data-act="billview" data-v="cal" aria-pressed="${U.billView === "cal"}">Calendar</button></div><button class="btn primary" data-act="edit-bill">${IC.plus} Bill</button>`;
  return `
  ${top("Bills & paydays", "What’s coming", `Bills cost about <b>${money(monthly, true)}</b> a month · income about <b>${money(sum(S.incomes, i => perMonth(+i.amount, i.freq)), true)}</b>`, right)}
  ${U.billView === "cal" ? calendar() : `
  <div class="grid g-main">
    <section class="card"><div class="card-h"><h2>Next 45 days</h2></div>
      ${up.length ? `<div class="list">${up.map(billRow).join("")}</div>` : `<div class="empty"><b>No bills yet</b>Add rent, phone, subscriptions — anything that comes round again.</div>`}
    </section>
    <div class="stack">
      <section class="card"><div class="card-h"><h2>Paydays</h2><button class="btn sm" data-act="edit-income">${IC.plus} Income</button></div>
        ${S.incomes.length ? `<div class="list">${S.incomes.map(i => { const n = paydays(t, addDays(t, 120)).find(p => p.inc.id === i.id); return `<div class="li"><button class="li-hit" data-act="edit-income" data-id="${i.id}"><div class="li-ic">💸</div><div class="li-main"><div class="li-t">${esc(i.name)}</div><div class="li-s">${freqLabel(i.freq)}${n ? " · next " + relDay(n.date) : ""}</div></div><div class="li-v in num">+${money(i.amount)}</div></button></div>`; }).join("")}</div>` : `<div class="empty">Add how and when you get paid.</div>`}
      </section>
      <section class="card"><div class="card-h"><h2>All bills</h2></div>
        ${S.bills.length ? `<div class="list">${S.bills.slice().sort((a, b) => b.amount - a.amount).map(b => `<div class="li"><button class="li-hit" data-act="edit-bill" data-id="${b.id}"><div class="li-ic">${esc(catIcon(b.cat))}</div><div class="li-main"><div class="li-t">${esc(b.name)}</div><div class="li-s">${freqLabel(b.freq)}${b.auto ? " · autopay" : ""}</div></div><div class="li-v num">${money(b.amount)}</div></button></div>`).join("")}</div>` : `<div class="empty">Nothing yet.</div>`}
      </section>
    </div>
  </div>`}`;
}
function calendar() {
  const mk = U.month; const [y, m] = mk.split("-").map(Number);
  const first = new Date(y, m - 1, 1); const ws = +S.settings.weekStart || 0;
  const lead = (first.getDay() - ws + 7) % 7; const start = addDays(monthStart(mk), -lead);
  const cells = Math.ceil((lead + daysIn(y, m - 1)) / 7) * 7; const end = addDays(start, cells - 1);
  const bills = billDue(start, end); const pays = paydays(start, end); const t = today();
  const names = []; for (let i = 0; i < 7; i++) names.push(new Date(2024, 0, 7 + ws + i).toLocaleDateString(LOC, { weekday: "short" }));
  let html = names.map(n => `<div class="cal-h">${n}</div>`).join("");
  for (let i = 0; i < cells; i++) {
    const d = addDays(start, i);
    const ev = pays.filter(p => p.date === d).map(p => `<div class="ev pay" title="${esc(p.inc.name)}">+${money(p.inc.amount, true)} ${esc(p.inc.name)}</div>`).join("") +
      bills.filter(b => b.date === d).map(b => `<div class="ev bill ${b.paid ? "paid" : ""}" title="${esc(b.bill.name)} ${money(b.bill.amount)}">${money(b.bill.amount, true)} ${esc(b.bill.name)}</div>`).join("");
    html += `<div class="cal-d ${monthKey(d) !== mk ? "out" : ""} ${d === t ? "today" : ""}"><span class="dn">${parse(d).getDate()}</span>${ev}</div>`;
  }
  const mb = bills.filter(b => monthKey(b.date) === mk);
  return `<section class="card"><div class="card-h"><h2>${fmtMonth(mk)}</h2>${monthNav()}</div><div class="cal">${html}</div>
  <div class="row wrap small" style="margin-top:12px;gap:14px"><span><span class="chip good">Payday</span></span><span><span class="chip warn">Bill</span></span><span class="muted">${mb.length} bills · ${money(sum(mb, b => b.bill.amount))} this month</span></div></section>
  <section class="card show-m" style="margin-top:16px"><div class="card-h"><h2>This month</h2></div><div class="list">${mb.map(billRow).join("") || `<div class="empty">No bills this month.</div>`}</div></section>`;
}

/* Goals */
function viewGoals() {
  const total = sum(S.goals, g => g.saved); const target = sum(S.goals, g => g.target);
  return `
  ${top("Savings goals", "Saving up for", S.goals.length ? `${money(total, true)} saved of ${money(target, true)}` : "", `<button class="btn primary" data-act="edit-goal">${IC.plus} Goal</button>`)}
  ${S.goals.length ? `<div class="grid g2">${S.goals.map(goalCard).join("")}</div>` : `<section class="card"><div class="empty"><b>What are you saving for?</b>An emergency fund, a trip, Christmas, a new car… Add a goal and drop money in whenever you can.<div style="margin-top:12px"><button class="btn primary" data-act="edit-goal">Add your first goal</button></div></div></section>`}`;
}
function goalCard(g) {
  const frac = g.target ? g.saved / g.target : 0; const rem = Math.max(0, g.target - g.saved);
  let eta = "";
  if (rem <= 0) eta = `<span class="chip good">Done! 🎉</span>`;
  else if (+g.monthly > 0) { const mo = Math.ceil(rem / g.monthly); const d = addMonths(today(), mo, 1).slice(0, 7); eta = `<span class="chip ${g.by && monthKey(g.by) < d ? "warn" : "accent"}">On track for ${fmtMonth(d)}</span>`; }
  let need = "";
  if (g.by && rem > 0) { const mo = Math.max(1, (parse(g.by).getFullYear() - new Date().getFullYear()) * 12 + parse(g.by).getMonth() - new Date().getMonth()); need = `<div class="small muted" style="margin-top:6px">To reach it by ${fmtDate(g.by, { month: "short", year: "numeric" })}: <b>${money(rem / mo, true)}/month</b></div>`; }
  return `<section class="card"><div class="card-h"><div class="row"><div class="li-ic">${esc(g.icon || "🌱")}</div><div><h2>${esc(g.name)}</h2><div class="sub">${money(rem, true)} to go${+g.monthly ? ` · ${money(g.monthly, true)}/month` : ""}</div></div></div><button class="icon-btn" data-act="edit-goal" data-id="${g.id}" aria-label="Edit goal">${IC.more}</button></div>
  <div class="row between" style="margin-bottom:6px"><b class="num" style="font-size:22px">${money(g.saved, true)}</b><span class="muted num">of ${money(g.target, true)} · ${Math.round(frac * 100)}%</span></div>
  ${bar(frac, "good")}
  <div class="row between wrap" style="margin-top:12px;gap:8px">${eta}<div class="row"><button class="btn sm" data-act="goal-move" data-id="${g.id}" data-dir="out">Take out</button><button class="btn sm primary" data-act="goal-move" data-id="${g.id}" data-dir="in">${IC.plus} Add money</button></div></div>${need}</section>`;
}

/* Debt */
function viewDebt() {
  const p = S.debtPlan; const sim = debtSim(p.extra, p.strategy); const base = debtSim(0, p.strategy);
  const total = sum(S.debts, d => +d.balance);
  const right = `<button class="btn primary" data-act="edit-debt">${IC.plus} Debt</button>`;
  if (!S.debts.length) return `${top("Debt payoff", "Your debt-free plan", "", right)}<section class="card"><div class="empty"><b>Add your credit cards and loans</b>See your debt-free date, and how much sooner you’d get there with a little extra each month.<div style="margin-top:12px"><button class="btn primary" data-act="edit-debt">Add a debt</button></div></div></section>`;
  const saved = sim && base && sim.done && base.done ? { mo: base.months - sim.months, int: round2(base.interest - sim.interest) } : null;
  return `
  ${top("Debt payoff", "Your debt-free plan", `${money(total, true)} across ${S.debts.length} debt${S.debts.length > 1 ? "s" : ""}`, right)}
  <div class="grid g-main">
    <div class="stack">
      <section class="hero"><div class="eyebrow">Debt-free date</div>
        ${!sim ? `<div class="hero-num" style="font-size:44px">Debt-free! 🎉</div><div class="hero-sub">Every balance here is paid off. Add a new debt if one comes up.</div>` : sim.stuck ? `<div class="hero-num" style="font-size:34px">Not yet reachable</div><div class="hero-sub">Minimum payments don’t cover the interest. Add an extra amount per month below.</div>` :
      `<div class="hero-num" style="font-size:44px">${sim.done ? fmtMonth(sim.date) : "50+ years"}</div><div class="hero-sub"><b>${Math.floor(sim.months / 12)} yr ${sim.months % 12} mo</b> from now · <b>${money(sim.interest, true)}</b> total interest</div>`}
        ${saved && p.extra > 0 && saved.mo > 0 ? `<div class="hero-stats"><div class="hero-stat"><span>Sooner by</span><b>${saved.mo} months</b></div><div class="hero-stat"><span>Interest saved</span><b class="num">${money(saved.int, true)}</b></div><div class="hero-stat"><span>Paying / month</span><b class="num">${money(sim.minTotal + +p.extra, true)}</b></div></div>` : ""}
      </section>
      <section class="card"><div class="card-h"><h2>Your plan</h2></div>
        <div class="field"><span class="lbl">Method</span><div class="seg" role="group"><button data-act="strategy" data-v="snowball" aria-pressed="${p.strategy === "snowball"}">Snowball · smallest first</button><button data-act="strategy" data-v="avalanche" aria-pressed="${p.strategy === "avalanche"}">Avalanche · highest rate first</button></div>
        <span class="hint">${p.strategy === "snowball" ? "Quick wins keep you going: clear the smallest balance first, then roll its payment into the next." : "Saves the most interest: attack the highest interest rate first."}</span></div>
        <div class="field"><label for="extra">Extra on top of minimums, per month</label><input id="extra" class="input" inputmode="decimal" value="${p.extra || ""}" placeholder="0" data-change="extra"></div>
        ${sim && sim.series ? lineChart(sim.series) : ""}
      </section>
    </div>
    <section class="card"><div class="card-h"><h2>Payoff order</h2></div>
      <div class="list">${(sim && sim.order ? sim.order : []).map((o, i) => { const d = S.debts.find(x => x.id === o.id); return `<div class="li"><div class="one-n" style="width:30px;height:30px;flex-basis:30px;font-size:14px">${i + 1}</div><button class="li-hit" data-act="edit-debt" data-id="${d.id}"><div class="li-main"><div class="li-t">${esc(d.name)}</div><div class="li-s">${money(d.balance, true)} · ${+d.apr}% · min ${money(d.min, true)}</div></div><div class="li-v small">Gone ${fmtMonth(o.date)}</div></button><button class="btn sm" data-act="debt-pay" data-id="${d.id}">Pay</button></div>`; }).join("")}
      ${S.debts.filter(d => !(sim && sim.order || []).some(o => o.id === d.id)).map(d => `<div class="li"><div class="li-ic">${+d.balance <= 0 ? "🎉" : "💳"}</div><button class="li-hit" data-act="edit-debt" data-id="${d.id}"><div class="li-main"><div class="li-t">${esc(d.name)}</div><div class="li-s">${+d.balance <= 0 ? "Paid off!" : `${money(d.balance, true)} · ${+d.apr}%`}</div></div></button>${+d.balance > 0 ? `<button class="btn sm" data-act="debt-pay" data-id="${d.id}">Pay</button>` : ""}</div>`).join("")}</div>
      <p class="small muted" style="margin-top:10px">Estimates assume the same payment every month and no new charges.</p>
    </section>
  </div>`;
}
function lineChart(series) {
  const W = 600, H = 160, P = 4; const max = Math.max(...series) || 1; const n = series.length - 1 || 1;
  const pts = series.map((v, i) => `${(P + i / n * (W - 2 * P)).toFixed(1)},${(H - P - v / max * (H - 2 * P)).toFixed(1)}`).join(" ");
  const yrs = Math.floor(n / 12);
  return `<svg viewBox="0 0 ${W} ${H + 20}" width="100%" role="img" aria-label="Total debt falling over ${n} months" style="margin-top:6px">
    <polygon points="${P},${H - P} ${pts} ${W - P},${H - P}" fill="var(--accent-soft)"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/>
    <text x="${P}" y="${H + 16}" font-size="12" fill="var(--muted)">Now · ${money(max, true)}</text><text x="${W - P}" y="${H + 16}" font-size="12" fill="var(--muted)" text-anchor="end">${yrs ? yrs + " yr " : ""}${n % 12} mo</text></svg>`;
}

/* Reports */
function viewReports() {
  const mk = U.reportMonth; const ms = monthSummary(mk); const prev = monthSummary(shiftMonth(mk, -1));
  const cats = Object.entries(ms.byCat).sort((a, b) => b[1] - a[1]);
  const colors = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)", "var(--c8)"];
  const topN = cats.slice(0, 7); const rest = sum(cats.slice(7), x => x[1]);
  const slices = topN.map(([id, v], i) => ({ label: id === "_" ? "Uncategorised" : catName(id), icon: id === "_" ? "•" : catIcon(id), v, c: colors[i] }));
  if (rest > 0) slices.push({ label: "Everything else", icon: "…", v: rest, c: colors[7] });
  const months = []; for (let i = 5; i >= 0; i--) { const k = shiftMonth(mk, -i); const s = monthSummary(k); months.push({ k, i: s.income, o: s.spent }); }
  const mx = Math.max(1, ...months.map(m => Math.max(m.i, m.o)));
  const isNow = mk === monthKey(today());
  const dayN = isNow ? parse(today()).getDate() : daysIn(...mk.split("-").map((x, i) => i ? +x - 1 : +x));
  const net = round2(ms.income - ms.spent);
  const right = `<div class="row" style="gap:6px"><button class="icon-btn" data-act="rmonth" data-n="-1" aria-label="Previous month">${IC.left}</button><button class="icon-btn" data-act="rmonth" data-n="1" aria-label="Next month">${IC.right}</button></div>`;
  return `
  ${top("Reports", fmtMonth(mk), "", right)}
  <div class="grid g3" style="margin-bottom:16px">
    <div class="tile"><span>Money in</span><b class="num">${money(ms.income, true)}</b></div>
    <div class="tile"><span>Money out</span><b class="num">${money(ms.spent, true)}</b><div class="small muted">${prev.spent ? `${ms.spent > prev.spent ? "▲" : "▼"} ${money(Math.abs(ms.spent - prev.spent), true)} vs last month` : ""}</div></div>
    <div class="tile"><span>${net >= 0 ? "Kept" : "Overspent"}</span><b class="num" style="color:${net >= 0 ? "var(--good)" : "var(--bad)"}">${money(Math.abs(net), true)}</b><div class="small muted">${money(ms.spent / Math.max(1, dayN), true)} a day on average</div></div>
  </div>
  <div class="grid g2">
    <section class="card"><div class="card-h"><h2>Where it went</h2></div>
      ${slices.length ? `<div class="donut-wrap">${donut(slices)}<div class="legend">${slices.map(s => `<div><i style="background:${s.c}"></i><span>${esc(s.icon)} ${esc(s.label)}</span><b class="num">${money(s.v, true)}</b></div>`).join("")}</div></div>` : `<div class="empty">No spending logged this month.</div>`}
    </section>
    <section class="card"><div class="card-h"><h2>Last 6 months</h2><div class="row small"><span class="chip good">In</span><span class="chip" style="background:var(--c2);color:#fff">Out</span></div></div>
      <div class="bars" role="img" aria-label="Money in and out over six months">${months.map(m => `<div class="col"><div class="pair"><i style="height:${m.i / mx * 100}%" title="In ${money(m.i)}"></i><i class="o" style="height:${m.o / mx * 100}%" title="Out ${money(m.o)}"></i></div><span>${parse(monthStart(m.k)).toLocaleDateString(LOC, { month: "short" })}</span></div>`).join("")}</div>
    </section>
  </div>
  <section class="card" style="margin-top:16px"><div class="card-h"><h2>Category by category</h2><span class="sub">vs ${fmtMonth(shiftMonth(mk, -1))}</span></div>
    <div class="list">${cats.map(([id, v]) => { const pv = prev.byCat[id] || 0; const d = v - pv; return `<div class="li"><div class="li-ic">${esc(id === "_" ? "•" : catIcon(id))}</div><div class="li-main"><div class="li-t">${esc(id === "_" ? "Uncategorised" : catName(id))}</div><div class="li-s">${pv ? `${d >= 0 ? "▲" : "▼"} ${money(Math.abs(d), true)}` : "new this month"}</div></div><div class="li-v num">${money(v)}</div></div>`; }).join("") || `<div class="empty">Nothing to compare yet.</div>`}</div>
  </section>`;
}
function donut(sl) {
  const tot = sum(sl, s => s.v) || 1; let a = -Math.PI / 2; const R = 70, r = 46, C = 80;
  const paths = sl.map(s => { const f = s.v / tot; const a2 = a + f * Math.PI * 2 - (sl.length > 1 ? 0.012 : 0); const large = f > .5 ? 1 : 0;
    const p = (rad, ang) => `${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`;
    const d = f >= 0.999 ? `M${C - R},${C}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0M${C - r},${C}a${r},${r} 0 1,1 ${2 * r},0a${r},${r} 0 1,1 ${-2 * r},0` : `M${p(R, a)}A${R},${R} 0 ${large} 1 ${p(R, a2)}L${p(r, a2)}A${r},${r} 0 ${large} 0 ${p(r, a)}Z`;
    a += f * Math.PI * 2; return `<path d="${d}" fill="${s.c}" fill-rule="evenodd"><title>${esc(s.label)}</title></path>`; }).join("");
  return `<svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Spending by category">${paths}<text x="80" y="76" text-anchor="middle" font-size="11" fill="var(--muted)">Total</text><text x="80" y="94" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">${esc(money(tot, true))}</text></svg>`;
}

/* Settings */
function viewSettings() {
  const st = S.settings;
  const themes = [["sage", "Sage", "#3F7A63"], ["blush", "Blush", "#B4566A"], ["ocean", "Ocean", "#2F6690"], ["night", "Night", "#1D2421"]];
  return `
  ${top("Settings", "Make it yours", "")}
  <div class="grid g2">
    <section class="card"><div class="card-h"><h2>Basics</h2></div>
      <div class="field"><label for="s-name">Your name</label><input id="s-name" class="input" value="${esc(st.name)}" data-change="name" placeholder="Optional"></div>
      <div class="f2"><div class="field"><label for="s-cur">Currency</label><select id="s-cur" class="input" data-change="currency">${CURRENCIES.map(c => `<option ${c === st.currency ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="s-ws">Week starts on</label><select id="s-ws" class="input" data-change="weekStart"><option value="0" ${+st.weekStart === 0 ? "selected" : ""}>Sunday</option><option value="1" ${+st.weekStart === 1 ? "selected" : ""}>Monday</option></select></div></div>
      <div class="field"><span class="lbl">Colour</span><div class="row wrap">${themes.map(([k, l, c]) => `<button class="btn sm" data-act="theme" data-v="${k}" aria-pressed="${st.theme === k}" style="${st.theme === k ? "border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)" : ""}"><span style="width:14px;height:14px;border-radius:50%;background:${c};display:inline-block"></span>${l}</button>`).join("")}</div></div>
      <div class="field"><label for="s-buf">Safety cushion</label><input id="s-buf" class="input" inputmode="decimal" value="${st.buffer || ""}" placeholder="0" data-change="buffer"><span class="hint">Money you never want “Safe to spend” to touch. Leave at 0 if unsure.</span></div>
      <div class="field"><span class="lbl">Balance</span><div class="row wrap"><span class="num">${money(balance())}</span><button class="btn sm" data-act="update-balance">Update balance</button></div><span class="hint">Check your bank app now and then and type what it says — the planner adds a correction for the difference.</span></div>
    </section>
    <div class="stack">
      <section class="card"><div class="card-h"><h2>Income</h2><button class="btn sm" data-act="edit-income">${IC.plus} Add</button></div>
        ${S.incomes.length ? `<div class="list">${S.incomes.map(i => `<div class="li"><button class="li-hit" data-act="edit-income" data-id="${i.id}"><div class="li-ic">💸</div><div class="li-main"><div class="li-t">${esc(i.name)}</div><div class="li-s">${freqLabel(i.freq)}</div></div><div class="li-v num in">+${money(i.amount)}</div></button></div>`).join("")}</div>` : `<div class="empty">No income added.</div>`}
      </section>
      <section class="card"><div class="card-h"><h2>Your data</h2></div>
        <p class="small muted" style="margin-top:0">Everything is saved privately in this browser on this device — no account, nothing sent anywhere. To move to a new phone or computer, save a backup and open it there.</p>
        <div class="row wrap"><button class="btn primary" data-act="backup">${IC.download} Save backup</button><button class="btn" data-act="restore">${IC.upload} Open backup</button><button class="btn" data-act="csv">${IC.download} Export CSV</button></div>
        <p class="small muted">${st.lastBackup ? "Last backup: " + fmtDate(st.lastBackup.slice(0, 10), { month: "short", day: "numeric", year: "numeric" }) : "No backup saved yet."}</p>
        <div class="row wrap" style="margin-top:6px"><button class="btn sm" data-act="help-install">Add to Home Screen</button><button class="btn sm danger" data-act="erase">Erase everything</button></div>
      </section>
      <section class="card"><h2>About</h2><p class="small muted">Paycheck Budget v${esc(VERSION)} · ${MODE === "demo" ? "demo" : "lifetime licence"} · made by WolyonStudio. Not financial advice — just a calm place to see your numbers.</p><p class="small"><a href="${esc(SHOP)}" target="_blank" rel="noopener">Questions? Message us on Etsy</a></p></section>
    </div>
  </div>`;
}

/* Onboarding */
let OB = { step: 0, d: {} };
function viewOnboard() {
  document.documentElement.dataset.theme = "sage";
  const steps = `<div class="steps">${[0, 1, 2, 3].map(i => `<i class="${i <= OB.step ? "on" : ""}"></i>`).join("")}</div>`;
  const d = OB.d;
  if (OB.step === 0) return `<div class="ob"><div class="card">
    <div class="brand" style="padding:0 0 16px"><div class="brand-mark">${IC.money}</div><div>Paycheck Budget<small>your money, one calm number</small></div></div>
    <h1>Hi! Let’s make money feel lighter.</h1>
    <p class="muted">This planner tells you one thing first: <b>how much is safe to spend today</b> — after the bills that come before your next paycheck. Setup takes about 2 minutes.</p>
    <div class="choice">
      <button class="btn primary" data-act="ob-next">Set up my planner<small>4 quick questions. You can change everything later.</small></button>
      <button class="btn" data-act="ob-sample">Look around with example numbers first<small>Made-up data. Clear it with one tap when you’re ready.</small></button>
      <button class="btn" data-act="restore">I have a backup file<small>Moving from another device</small></button>
    </div>
    ${iosBrowser() ? `<div class="banner demo" style="margin:16px 0 0"><span>📱 <b>On iPhone/iPad: add this to your Home Screen first</b> (Share → Add to Home Screen) and set up from that icon. Safari and the Home Screen app keep separate data.</span></div>` : ""}
    <p class="small faint" style="margin-top:16px">🔒 No account, no bank login. Everything stays on this device.</p></div></div>`;
  if (OB.step === 1) return `<div class="ob"><div class="card">${steps}<h1>What should we call you?</h1>
    <div class="field" style="margin-top:16px"><label for="ob-name">First name (optional)</label><input id="ob-name" class="input" value="${esc(d.name || "")}" autocomplete="given-name"></div>
    <div class="field"><label for="ob-cur">Currency</label><select id="ob-cur" class="input">${CURRENCIES.map(c => `<option ${c === (d.currency || guessCurrency()) ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <div class="modal-f" style="padding:10px 0 0"><button class="btn" data-act="ob-back">Back</button><button class="btn primary" data-act="ob-next">Next</button></div></div></div>`;
  if (OB.step === 2) return `<div class="ob"><div class="card">${steps}<h1>How much is in your account right now?</h1>
    <p class="muted">Open your bank app and type what it says for your everyday account(s). A rough number is fine.</p>
    <div class="field money-in"><label for="ob-bal" class="sr">Current balance</label><input id="ob-bal" class="input num" inputmode="decimal" placeholder="0.00" value="${d.bal != null ? d.bal : ""}"></div>
    <div class="modal-f" style="padding:10px 0 0"><button class="btn" data-act="ob-back">Back</button><button class="btn primary" data-act="ob-next">Next</button></div></div></div>`;
  if (OB.step === 3) return `<div class="ob"><div class="card">${steps}<h1>When do you get paid next?</h1>
    <p class="muted">If you have more than one paycheck, add the main one now and the rest later.</p>
    <div class="field"><label for="ob-pay">Usual amount (after tax)</label><input id="ob-pay" class="input num" inputmode="decimal" placeholder="0.00" value="${d.pay != null ? d.pay : ""}"></div>
    <div class="f2"><div class="field"><label for="ob-freq">How often</label><select id="ob-freq" class="input">${FREQS.filter(f => f[0] !== "once").map(([k, l]) => `<option value="${k}" ${k === (d.freq || "biweekly") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="field"><label for="ob-next">Next payday</label><input id="ob-next" class="input" type="date" value="${d.next || addDays(today(), 7)}"></div></div>
    <p class="small muted">Irregular income? Pick “Every month”, use a low estimate, and log what really comes in.</p>
    <div class="modal-f" style="padding:10px 0 0"><button class="btn ghost" data-act="ob-skip-pay">Skip for now</button><button class="btn" data-act="ob-back">Back</button><button class="btn primary" data-act="ob-finish">Start my planner</button></div></div></div>`;
  return "";
}
function iosBrowser() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone && MODE === "full";
}
function guessCurrency() {
  const l = (navigator.language || "en-US").toUpperCase();
  if (/-GB/.test(l)) return "GBP"; if (/-CA/.test(l)) return "CAD"; if (/-AU/.test(l)) return "AUD"; if (/-NZ/.test(l)) return "NZD"; if (/-IN/.test(l)) return "INR"; if (/-TR|^TR/.test(l)) return "TRY";
  if (/^(DE|FR|ES|IT|NL|PT|FI|IE|AT|BE|GR|SK|SI|LT|LV|EE)|-(DE|FR|ES|IT|NL|PT|FI|IE|AT|BE|GR)/.test(l)) return "EUR";
  return "USD";
}
function obCollect() {
  const v = id => { const e = $("#" + id); return e ? e.value : undefined; };
  if (OB.step === 1) { OB.d.name = v("ob-name").trim(); OB.d.currency = v("ob-cur"); }
  if (OB.step === 2) OB.d.bal = num(v("ob-bal"));
  if (OB.step === 3) { OB.d.pay = num(v("ob-pay")); OB.d.freq = v("ob-freq"); OB.d.next = v("ob-next"); }
}
function obFinish(withPay) {
  obCollect();
  const s = blankState(); const d = OB.d;
  s.settings.name = d.name || ""; s.settings.currency = d.currency || guessCurrency();
  s.start = { date: today(), amount: +d.bal || 0 };
  if (withPay && d.pay > 0 && d.next) s.incomes.push({ id: uid(), name: "Paycheck", amount: d.pay, freq: d.freq || "biweekly", date: d.next < today() ? today() : d.next, got: {} });
  s.onboarded = true; S = s; save(); requestPersist(); location.hash = "today"; render();
  setTimeout(() => toast("You’re set! Next: add your bills so ‘Safe to spend’ is accurate."), 300);
}

/* ---------- sample data ---------- */
function sampleState() {
  const s = blankState(); const t = today(); let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  s.settings.name = "Alex"; s.onboarded = true; s.settings.lastBackup = new Date().toISOString();
  const C = n => s.cats.find(c => c.name === n).id;
  const budgets = { Housing: 1200, Utilities: 160, Groceries: 480, Transport: 220, "Phone & internet": 110, Insurance: 120, Health: 60, "Kids & pets": 80, "Eating out": 180, "Coffee & snacks": 60, Shopping: 120, Fun: 100, Subscriptions: 45, "Personal care": 50, Gifts: 60, Other: 25, Savings: 150, "Debt payments": 450 };
  for (const c of s.cats) c.budget = budgets[c.name] || 0;
  const startD = addDays(t, -182); s.start = { date: startD, amount: 1420 };
  s.incomes.push({ id: uid(), name: "Paycheck", amount: 1850, freq: "biweekly", date: addDays(t, 4 - 14 * 14), got: {} });
  const inc = s.incomes[0];
  const bill = (name, amount, freq, date, cat, auto) => s.bills.push({ id: uid(), name, amount, freq, date, cat: C(cat), auto: !!auto, paid: {} });
  const dayOf = (n) => { const mk = monthKey(addDays(t, -190)); return `${mk}-${pad(n)}`; };
  bill("Rent", 1200, "monthly", dayOf(1), "Housing"); bill("Electric", 86, "monthly", dayOf(18), "Utilities");
  bill("Phone", 45, "monthly", dayOf(12), "Phone & internet", true); bill("Internet", 60, "monthly", dayOf(22), "Phone & internet", true);
  bill("Car insurance", 118, "monthly", dayOf(9), "Insurance", true); bill("Netflix", 15.49, "monthly", dayOf(15), "Subscriptions", true);
  bill("Spotify", 11.99, "monthly", dayOf(27), "Subscriptions", true); bill("Gym", 29, "monthly", dayOf(5), "Health", true);
  bill("Amazon Prime", 139, "yearly", addDays(t, 40), "Subscriptions", true);
  s.debts.push({ id: uid(), name: "Credit card", balance: 2340, apr: 22.9, min: 65 }, { id: uid(), name: "Car loan", balance: 8900, apr: 6.4, min: 285 }, { id: uid(), name: "Student loan", balance: 14200, apr: 5.1, min: 160 });
  s.debtPlan = { strategy: "snowball", extra: 100 };
  s.goals.push({ id: uid(), name: "Emergency fund", icon: "🛟", target: 3000, saved: 1240, monthly: 150, by: "" }, { id: uid(), name: "Summer trip", icon: "✈️", target: 1500, saved: 420, monthly: 100, by: addMonths(t, 7, 1) }, { id: uid(), name: "Christmas gifts", icon: "🎁", target: 600, saved: 455, monthly: 75, by: `${t.slice(0, 4)}-12-15` });
  const add = (date, amount, dir, cat, note, extra) => s.tx.push(Object.assign({ id: uid(), date, amount: round2(amount), dir, cat, note: note || "", kind: dir === "in" ? "income" : "spend" }, extra || {}));
  for (const p of occurrences(inc, startD, t)) { add(p, 1850, "in", null, "Paycheck", { kind: "income", incId: inc.id }); inc.got[p] = 1; }
  for (const b of s.bills) for (const d of occurrences(b, startD, t)) {
    if (d === t && !b.auto) continue;
    const id = uid(); s.tx.push({ id, date: d, amount: b.amount, dir: "out", cat: b.cat, note: b.name, kind: "bill", billId: b.id, occ: d }); b.paid[d] = id;
  }
  const spends = [["Groceries", "Trader Joe’s", 45, 95, 0.32], ["Coffee & snacks", "Coffee", 4, 7, 0.45], ["Eating out", "Takeout", 14, 38, 0.18], ["Transport", "Gas", 32, 55, 0.14], ["Shopping", "Target", 12, 60, 0.1], ["Fun", "Movies", 12, 30, 0.05], ["Personal care", "Haircut", 25, 40, 0.02], ["Kids & pets", "Dog food", 20, 40, 0.04], ["Health", "Pharmacy", 8, 25, 0.04], ["Gifts", "Birthday gift", 20, 45, 0.03], ["Other", "Post office", 5, 15, 0.02]];
  for (let d = startD; d < t; d = addDays(d, 1)) for (const [c, n, lo, hi, p] of spends) if (rnd() < p) add(d, lo + rnd() * (hi - lo), "out", C(c), n);
  add(t, 5.75, "out", C("Coffee & snacks"), "Latte");
  for (const [i, d] of [[0, -40], [1, -25], [0, -10], [2, -12]]) add(addDays(t, d), [150, 100, 75][i], "out", C("Savings"), s.goals[i].name, { kind: "goal", goalId: s.goals[i].id });
  for (const [i, d] of [[0, -50], [1, -48], [2, -46], [0, -20], [1, -18], [2, -16]]) add(addDays(t, d), [s.debts[0].min + 100, s.debts[1].min, s.debts[2].min][i], "out", C("Debt payments"), s.debts[i].name, { kind: "debt", debtId: s.debts[i].id });
  s.tx.sort((a, b) => a.date < b.date ? -1 : 1);
  const target = 1640; const cur = s.start.amount + sum(s.tx, x => sign(x) * x.amount); s.start.amount = round2(s.start.amount + (target - cur));
  return s;
}

/* ---------- modals ---------- */
let modalClose = null;
function modal(title, body, foot, onMount) {
  const root = $("#modal-root"); const prev = document.activeElement;
  root.innerHTML = `<div class="modal-bg" data-act="close-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h2>${title}</h2><button class="icon-btn" data-act="close" aria-label="Close">${IC.x}</button></div><div class="modal-b">${body}</div><div class="modal-f">${foot}</div></div></div>`;
  modalClose = () => { root.innerHTML = ""; modalClose = null; if (prev && prev.focus) prev.focus(); };
  const first = root.querySelector("[autofocus]") || root.querySelector("input,select,button.btn");
  if (first && !matchMedia("(max-width:900px)").matches) first.focus(); else if (first && first.hasAttribute("autofocus")) first.focus();
  if (onMount) onMount(root.firstElementChild);
}
const val = id => { const e = $("#" + id); return e ? e.value : ""; };
const catOptions = (sel, filter = () => true) => S.cats.filter(filter).map(c => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.icon + " " + c.name)}</option>`).join("");

function txModal(id, preset = {}) {
  const t = id ? S.tx.find(x => x.id === id) : null; if (id && !t) return;
  const d = t || Object.assign({ dir: "out", date: today(), amount: "", cat: preset.cat || (topCats(1)[0] || {}).id, note: "" }, preset);
  let dir = d.dir, selCat = d.cat;
  const linked = t && (t.billId || t.goalId || t.debtId || t.kind === "adjust");
  const picks = S.cats.filter(c => !c.sys);
  const body = () => `
    ${linked ? "" : `<div class="seg" role="group" style="margin-bottom:14px"><button data-x="dir" data-v="out" aria-pressed="${dir === "out"}">Money out</button><button data-x="dir" data-v="in" aria-pressed="${dir === "in"}">Money in</button></div>`}
    <div class="field money-in"><label for="m-amt" class="sr">Amount</label><input id="m-amt" class="input num" inputmode="decimal" placeholder="0.00" value="${d.amount !== "" ? d.amount : ""}" autofocus></div>
    <div class="quick">${(S.settings.quick || [5, 10, 20, 50]).map(q => `<button data-x="add" data-v="${q}">+${money(q, true)}</button>`).join("")}</div>
    ${dir === "out" && !linked ? `<span class="lbl">Category</span><div class="cats-pick" style="margin-top:6px">${picks.map(c => `<button data-x="cat" data-v="${c.id}" aria-pressed="${c.id === selCat}"><span>${esc(c.icon)}</span>${esc(c.name)}</button>`).join("")}</div>` : ""}
    <div class="f2"><div class="field"><label for="m-date">Day</label><input id="m-date" class="input" type="date" value="${d.date}"></div>
    <div class="field"><label for="m-note">Note <span class="faint">(optional)</span></label><input id="m-note" class="input" value="${esc(d.note)}" placeholder="${dir === "in" ? "Paycheck, refund…" : "Where / what"}"></div></div>
    ${linked ? `<p class="small muted">This entry is linked to a ${t.billId ? "bill" : t.goalId ? "goal" : t.debtId ? "debt" : "balance correction"}. Deleting it will undo that too.</p>` : ""}`;
  const foot = `${t ? `<button class="btn danger" data-x="del">Delete</button>` : ""}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="save">${t ? "Save" : "Add"}</button>`;
  modal(t ? "Edit entry" : "Log money", body(), foot, el => {
    const rerender = () => { const a = val("m-amt"), dd = val("m-date"), n = val("m-note"); d.amount = a; d.date = dd; d.note = n; el.querySelector(".modal-b").innerHTML = body(); };
    el.addEventListener("click", e => {
      const b = e.target.closest("[data-x]"); if (!b) return; const x = b.dataset.x;
      if (x === "dir") { dir = b.dataset.v; rerender(); }
      if (x === "cat") { selCat = b.dataset.v; el.querySelectorAll('[data-x="cat"]').forEach(k => k.setAttribute("aria-pressed", k.dataset.v === selCat)); }
      if (x === "add") { const inp = $("#m-amt"); inp.value = round2(num(inp.value) + +b.dataset.v); }
      if (x === "del") { removeTx(t.id, true); modalClose(); }
      if (x === "save") {
        const amount = round2(num(val("m-amt"))); if (!(amount > 0)) { $("#m-amt").focus(); toast("Type an amount first"); return; }
        const rec = { amount, dir, date: val("m-date") || today(), note: val("m-note").trim() };
        if (t) { const old = Object.assign({}, t); Object.assign(t, rec); if (!linked) { t.cat = dir === "out" ? selCat : null; t.kind = dir === "in" ? "income" : "spend"; } syncLinked(old, t); }
        else S.tx.push(Object.assign({ id: uid(), cat: dir === "out" ? selCat : null, kind: dir === "in" ? "income" : "spend" }, rec));
        save(); modalClose(); render(); toast(t ? "Saved" : `${dir === "in" ? "Added" : "Logged"} ${money(amount)}`);
      }
    });
    el.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); el.querySelector('[data-x="save"]').click(); } });
  });
}
function syncLinked(old, t) {
  if (t.goalId) { const g = S.goals.find(x => x.id === t.goalId); if (g) g.saved = round2(g.saved - (old.dir === "out" ? old.amount : -old.amount) + (t.dir === "out" ? t.amount : -t.amount)); }
  if (t.debtId) { const dd = S.debts.find(x => x.id === t.debtId); if (dd) dd.balance = round2(dd.balance + old.amount - t.amount); }
}
function removeTx(id, undoable) {
  const i = S.tx.findIndex(x => x.id === id); if (i < 0) return;
  const snap = JSON.stringify(S); const t = S.tx[i]; S.tx.splice(i, 1);
  if (t.billId) { const b = S.bills.find(x => x.id === t.billId); if (b && b.paid) delete b.paid[t.occ]; }
  if (t.incId) { const inc = S.incomes.find(x => x.id === t.incId); if (inc && inc.got) delete inc.got[t.occ]; }
  if (t.goalId) { const g = S.goals.find(x => x.id === t.goalId); if (g) g.saved = round2(g.saved - (t.dir === "out" ? t.amount : -t.amount)); }
  if (t.debtId) { const d = S.debts.find(x => x.id === t.debtId); if (d) d.balance = round2(d.balance + t.amount); }
  save(); render(); if (undoable) toast("Deleted", () => { S = JSON.parse(snap); save(); render(); });
}

function billModal(id) {
  const b = id ? S.bills.find(x => x.id === id) : null;
  const d = b || { name: "", amount: "", freq: "monthly", date: addDays(today(), 7), cat: (S.cats.find(c => c.name === "Housing") || S.cats[0]).id, auto: false };
  const body = `
    <div class="field"><label for="b-name">Name</label><input id="b-name" class="input" value="${esc(d.name)}" placeholder="Rent, phone, Netflix…" autofocus></div>
    <div class="f2"><div class="field"><label for="b-amt">Amount</label><input id="b-amt" class="input num" inputmode="decimal" value="${d.amount}" placeholder="0.00"></div>
    <div class="field"><label for="b-freq">Repeats</label><select id="b-freq" class="input">${FREQS.map(([k, l]) => `<option value="${k}" ${k === d.freq ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
    <div class="f2"><div class="field"><label for="b-date">${b ? "First due date" : "Next due date"}</label><input id="b-date" class="input" type="date" value="${d.date}"></div>
    <div class="field"><label for="b-cat">Category</label><select id="b-cat" class="input">${catOptions(d.cat)}</select></div></div>
    <label class="row small" style="gap:10px;margin-bottom:10px"><input id="b-auto" type="checkbox" ${d.auto ? "checked" : ""} style="width:20px;height:20px"> Autopay — mark it paid automatically on the due date</label>`;
  const foot = `${b ? `<button class="btn danger" data-x="del">Delete</button>` : ""}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="save">Save</button>`;
  modal(b ? "Edit bill" : "Add a bill", body, foot, el => el.addEventListener("click", e => {
    const x = (e.target.closest("[data-x]") || {}).dataset; if (!x || !x.x) return;
    if (x.x === "del") { confirmBox(`Delete “${esc(b.name)}”?`, "Payments you already logged stay in your history.", "Delete", () => { const snap = JSON.stringify(S); S.bills = S.bills.filter(y => y !== b); S.tx.forEach(t => { if (t.billId === b.id) delete t.billId; }); save(); render(); toast("Bill deleted", () => { S = JSON.parse(snap); save(); render(); }); }); }
    if (x.x === "save") {
      const name = val("b-name").trim(); const amount = round2(num(val("b-amt")));
      if (!name) { $("#b-name").focus(); toast("Give the bill a name"); return; } if (!(amount > 0)) { $("#b-amt").focus(); toast("Type the amount"); return; }
      const rec = { name, amount, freq: val("b-freq"), date: val("b-date") || today(), cat: val("b-cat"), auto: $("#b-auto").checked };
      if (b) Object.assign(b, rec); else S.bills.push(Object.assign({ id: uid(), paid: {} }, rec));
      autopay(); save(); modalClose(); render(); toast("Bill saved");
    }
  }));
}
function payBill(id, occ) {
  const b = S.bills.find(x => x.id === id); if (!b) return; b.paid = b.paid || {}; if (b.paid[occ]) return;
  const t = { id: uid(), date: occ > today() ? today() : occ, amount: b.amount, dir: "out", cat: b.cat, note: b.name, kind: "bill", billId: b.id, occ };
  S.tx.push(t); b.paid[occ] = t.id; save(); render(); toast(`${b.name} marked paid`, () => removeTx(t.id));
}
function autopay() {
  const t = today(); let n = 0;
  for (const b of S.bills) if (b.auto) for (const d of occurrences(b, addDays(S.start.date, 1), t)) { b.paid = b.paid || {}; if (!b.paid[d]) { const id = uid(); S.tx.push({ id, date: d, amount: b.amount, dir: "out", cat: b.cat, note: b.name, kind: "bill", billId: b.id, occ: d }); b.paid[d] = id; n++; } }
  if (n) save(); return n;
}
function incomeModal(id) {
  const i = id ? S.incomes.find(x => x.id === id) : null;
  const d = i || { name: S.incomes.length ? "Side income" : "Paycheck", amount: "", freq: "biweekly", date: addDays(today(), 7) };
  const body = `
    <div class="field"><label for="i-name">Name</label><input id="i-name" class="input" value="${esc(d.name)}" autofocus></div>
    <div class="f2"><div class="field"><label for="i-amt">Usual amount (after tax)</label><input id="i-amt" class="input num" inputmode="decimal" value="${d.amount}" placeholder="0.00"></div>
    <div class="field"><label for="i-freq">How often</label><select id="i-freq" class="input">${FREQS.map(([k, l]) => `<option value="${k}" ${k === d.freq ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
    <div class="field"><label for="i-date">${i ? "A payday (any past or next one)" : "Next payday"}</label><input id="i-date" class="input" type="date" value="${d.date}"></div>
    <p class="small muted">On payday the planner asks if the money arrived, so your balance stays right.</p>`;
  const foot = `${i ? `<button class="btn danger" data-x="del">Delete</button>` : ""}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="save">Save</button>`;
  modal(i ? "Edit income" : "Add income", body, foot, el => el.addEventListener("click", e => {
    const x = (e.target.closest("[data-x]") || {}).dataset; if (!x || !x.x) return;
    if (x.x === "del") { const snap = JSON.stringify(S); S.incomes = S.incomes.filter(y => y !== i); save(); modalClose(); render(); toast("Income deleted", () => { S = JSON.parse(snap); save(); render(); }); }
    if (x.x === "save") {
      const amount = round2(num(val("i-amt"))); if (!(amount > 0)) { $("#i-amt").focus(); toast("Type the amount"); return; }
      const rec = { name: val("i-name").trim() || "Paycheck", amount, freq: val("i-freq"), date: val("i-date") || today() };
      if (i) Object.assign(i, rec); else S.incomes.push(Object.assign({ id: uid(), got: {} }, rec));
      save(); modalClose(); render(); toast("Income saved");
    }
  }));
}
function gotPay(id, occ) {
  const inc = S.incomes.find(x => x.id === id); if (!inc) return;
  amountBox(`${inc.name} arrived`, "How much landed in your account?", inc.amount, amt => {
    inc.got = inc.got || {}; const t = { id: uid(), date: occ > today() ? today() : occ, amount: amt, dir: "in", cat: null, note: inc.name, kind: "income", incId: inc.id, occ };
    S.tx.push(t); inc.got[occ] = t.id; save(); render(); toast(`+${money(amt)} added. Payday! 🎉`);
  }, "Add it", `<button class="btn ghost" data-x="skip">It didn’t come</button>`, () => { inc.got = inc.got || {}; inc.got[occ] = "skipped"; save(); render(); });
}
function goalModal(id) {
  const g = id ? S.goals.find(x => x.id === id) : null;
  const d = g || { name: "", icon: "🌱", target: "", saved: 0, monthly: "", by: "" };
  const icons = ["🌱", "🛟", "✈️", "🏠", "🚗", "🎁", "🎓", "💍", "👶", "🐾", "💻", "🏖️"];
  const body = `
    <div class="field"><span class="lbl">Icon</span><div class="row wrap" style="gap:6px">${icons.map(i => `<button class="icon-btn" data-x="icon" data-v="${i}" aria-pressed="${i === d.icon}" style="font-size:18px;${i === d.icon ? "border-color:var(--accent);background:var(--accent-soft)" : ""}">${i}</button>`).join("")}</div></div>
    <div class="field"><label for="g-name">What for?</label><input id="g-name" class="input" value="${esc(d.name)}" placeholder="Emergency fund, trip, new laptop…" autofocus></div>
    <div class="f2"><div class="field"><label for="g-target">Goal amount</label><input id="g-target" class="input num" inputmode="decimal" value="${d.target}" placeholder="0"></div>
    <div class="field"><label for="g-saved">Already saved</label><input id="g-saved" class="input num" inputmode="decimal" value="${d.saved || ""}" placeholder="0"></div></div>
    <div class="f2"><div class="field"><label for="g-month">Plan to add each month</label><input id="g-month" class="input num" inputmode="decimal" value="${d.monthly || ""}" placeholder="optional"></div>
    <div class="field"><label for="g-by">Target date</label><input id="g-by" class="input" type="date" value="${d.by || ""}"></div></div>`;
  const foot = `${g ? `<button class="btn danger" data-x="del">Delete</button>` : ""}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="save">Save</button>`;
  let icon = d.icon;
  modal(g ? "Edit goal" : "New savings goal", body, foot, el => el.addEventListener("click", e => {
    const b = e.target.closest("[data-x]"); if (!b) return; const x = b.dataset.x;
    if (x === "icon") { icon = b.dataset.v; el.querySelectorAll('[data-x="icon"]').forEach(k => { const on = k.dataset.v === icon; k.setAttribute("aria-pressed", on); k.style.borderColor = on ? "var(--accent)" : ""; k.style.background = on ? "var(--accent-soft)" : ""; }); }
    if (x === "del") confirmBox(`Delete “${esc(g.name)}”?`, "Money you moved into it stays in your history.", "Delete", () => { const snap = JSON.stringify(S); S.goals = S.goals.filter(y => y !== g); save(); render(); toast("Goal deleted", () => { S = JSON.parse(snap); save(); render(); }); });
    if (x === "save") {
      const name = val("g-name").trim(); const target = round2(num(val("g-target")));
      if (!name) { $("#g-name").focus(); toast("Name your goal"); return; } if (!(target > 0)) { $("#g-target").focus(); toast("How much do you need?"); return; }
      const rec = { name, icon, target, saved: round2(num(val("g-saved"))), monthly: round2(num(val("g-month"))), by: val("g-by") };
      if (g) Object.assign(g, rec); else S.goals.push(Object.assign({ id: uid() }, rec));
      save(); modalClose(); render(); toast("Goal saved");
    }
  }));
}
function goalMove(id, dirn) {
  const g = S.goals.find(x => x.id === id); if (!g) return;
  amountBox(dirn === "in" ? `Add to ${g.name}` : `Take from ${g.name}`, dirn === "in" ? "This comes out of your spending money." : "This goes back into your spending money.", g.monthly || "", amt => {
    if (dirn === "out") amt = Math.min(amt, g.saved);
    S.tx.push({ id: uid(), date: today(), amount: amt, dir: dirn === "in" ? "out" : "in", cat: sysCat("savings").id, note: g.name, kind: "goal", goalId: g.id });
    g.saved = round2(g.saved + (dirn === "in" ? amt : -amt)); save(); render();
    toast(dirn === "in" ? (g.saved >= g.target ? `Goal reached! 🎉` : `+${money(amt)} to ${g.name}`) : `${money(amt)} moved back`);
  }, dirn === "in" ? "Add" : "Take out");
}
function debtModal(id) {
  const g = id ? S.debts.find(x => x.id === id) : null;
  const d = g || { name: "", balance: "", apr: "", min: "" };
  const body = `
    <div class="field"><label for="d-name">Name</label><input id="d-name" class="input" value="${esc(d.name)}" placeholder="Visa, car loan…" autofocus></div>
    <div class="field"><label for="d-bal">What you owe now</label><input id="d-bal" class="input num" inputmode="decimal" value="${d.balance}" placeholder="0.00"></div>
    <div class="f2"><div class="field"><label for="d-apr">Interest rate (APR %)</label><input id="d-apr" class="input num" inputmode="decimal" value="${d.apr}" placeholder="e.g. 24.9"></div>
    <div class="field"><label for="d-min">Minimum payment / month</label><input id="d-min" class="input num" inputmode="decimal" value="${d.min}" placeholder="0.00"></div></div>`;
  const foot = `${g ? `<button class="btn danger" data-x="del">Delete</button>` : ""}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="save">Save</button>`;
  modal(g ? "Edit debt" : "Add a debt", body, foot, el => el.addEventListener("click", e => {
    const x = (e.target.closest("[data-x]") || {}).dataset; if (!x || !x.x) return;
    if (x.x === "del") confirmBox(`Delete “${esc(g.name)}”?`, "Payments you logged stay in your history.", "Delete", () => { const snap = JSON.stringify(S); S.debts = S.debts.filter(y => y !== g); save(); render(); toast("Debt deleted", () => { S = JSON.parse(snap); save(); render(); }); });
    if (x.x === "save") {
      const name = val("d-name").trim(); if (!name) { $("#d-name").focus(); toast("Name the debt"); return; }
      const rec = { name, balance: round2(num(val("d-bal"))), apr: round2(num(val("d-apr"))), min: round2(num(val("d-min"))) };
      if (!(rec.min > 0) && rec.balance > 0) { $("#d-min").focus(); toast("Add the minimum payment"); return; }
      if (g) Object.assign(g, rec); else S.debts.push(Object.assign({ id: uid() }, rec));
      save(); modalClose(); render(); toast("Debt saved");
    }
  }));
}
function debtPay(id) {
  const d = S.debts.find(x => x.id === id); if (!d) return;
  amountBox(`Pay ${d.name}`, `You owe ${money(d.balance)}. This is logged as money out.`, d.min, amt => {
    amt = Math.min(amt, d.balance);
    S.tx.push({ id: uid(), date: today(), amount: amt, dir: "out", cat: sysCat("debt").id, note: d.name, kind: "debt", debtId: d.id });
    d.balance = round2(d.balance - amt); save(); render(); toast(d.balance <= 0 ? `${d.name} is PAID OFF! 🎉` : `${money(amt)} paid · ${money(d.balance, true)} to go`);
  }, "Log payment");
}
function catModal(id) {
  const c = id ? cat(id) : null;
  const d = c || { name: "", icon: "✨", group: "wants", budget: "" };
  const body = `
    <div class="f2"><div class="field"><label for="c-icon">Emoji</label><input id="c-icon" class="input" value="${esc(d.icon)}" maxlength="4" style="font-size:22px;text-align:center"></div>
    <div class="field"><label for="c-name">Name</label><input id="c-name" class="input" value="${esc(d.name)}" ${c && c.sys ? "disabled" : ""} autofocus></div></div>
    <div class="f2"><div class="field"><label for="c-group">Group</label><select id="c-group" class="input">${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}" ${k === d.group ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="field"><label for="c-budget">Monthly budget</label><input id="c-budget" class="input num" inputmode="decimal" value="${d.budget || ""}" placeholder="0"></div></div>`;
  const foot = `${c && !c.sys ? `<button class="btn danger" data-x="del">Delete</button>` : ""}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="save">Save</button>`;
  modal(c ? "Edit category" : "New category", body, foot, el => el.addEventListener("click", e => {
    const x = (e.target.closest("[data-x]") || {}).dataset; if (!x || !x.x) return;
    if (x.x === "del") confirmBox(`Delete “${esc(c.name)}”?`, "Entries in it will move to “Other”.", "Delete", () => { const other = S.cats.find(k => k.name === "Other" && k !== c) || S.cats.find(k => k !== c); S.tx.forEach(t => { if (t.cat === c.id) t.cat = other.id; }); S.bills.forEach(b => { if (b.cat === c.id) b.cat = other.id; }); S.cats = S.cats.filter(k => k !== c); save(); render(); toast("Category deleted"); });
    if (x.x === "save") {
      const name = c && c.sys ? c.name : val("c-name").trim(); if (!name) { $("#c-name").focus(); return; }
      const rec = { name, icon: val("c-icon").trim() || "✨", group: val("c-group"), budget: round2(num(val("c-budget"))) };
      if (c) Object.assign(c, rec); else S.cats.push(Object.assign({ id: uid() }, rec));
      save(); modalClose(); render();
    }
  }));
}
function suggestBudget() {
  const months = [1, 2, 3].map(n => monthSummary(shiftMonth(monthKey(today()), -n))).filter(m => m.spent > 0);
  const billMonthly = {}; for (const b of S.bills) billMonthly[b.cat] = (billMonthly[b.cat] || 0) + perMonth(+b.amount, b.freq);
  const sugg = S.cats.map(c => { const avg = months.length ? sum(months, m => m.byCat[c.id] || 0) / months.length : 0; const v = Math.max(avg, billMonthly[c.id] || 0); return { c, v: v ? Math.ceil(v / 5) * 5 : 0 }; }).filter(x => x.v > 0);
  if (!sugg.length) { toast("Log a few weeks of spending or add bills first — then I can suggest amounts."); return; }
  confirmBox("Use suggested budgets?", `Based on ${months.length ? `your last ${months.length} month${months.length > 1 ? "s" : ""} of spending` : "your bills"}${months.length ? " and your bills" : ""}, rounded up to the nearest 5:<br><br>${sugg.map(x => `${esc(x.c.icon)} ${esc(x.c.name)}: <b>${money(x.v, true)}</b>`).join("<br>")}`, "Use these", () => { const snap = JSON.stringify(S); for (const x of sugg) x.c.budget = x.v; save(); render(); toast("Budgets updated", () => { S = JSON.parse(snap); save(); render(); }); });
}
function updateBalance() {
  amountBox("Update your balance", "Type what your bank app shows right now. We’ll add a correction for the difference.", balance(), amt => {
    const diff = round2(amt - balance()); if (!diff) { toast("Already matches 👍"); return; }
    S.tx.push({ id: uid(), date: today(), amount: Math.abs(diff), dir: diff > 0 ? "in" : "out", cat: null, note: "Balance correction", kind: "adjust" });
    save(); render(); toast(`Balance set to ${money(amt)}`);
  }, "Update", "", null, true);
}
function amountBox(title, text, def, cb, okLabel = "Save", extraFoot = "", onExtra, allowZero) {
  modal(title, `<p class="muted" style="margin-top:0">${text}</p><div class="field money-in"><input id="ab-amt" class="input num" inputmode="decimal" value="${def !== "" && def != null ? round2(def) : ""}" placeholder="0.00" autofocus aria-label="Amount"></div>`,
    `${extraFoot}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="ok">${okLabel}</button>`, el => {
      const go = () => { const a = round2(num(val("ab-amt"))); if (!(a > 0) && !(allowZero && val("ab-amt").trim() !== "")) { $("#ab-amt").focus(); return; } modalClose(); cb(a); };
      el.addEventListener("click", e => { const x = e.target.closest("[data-x]"); if (!x) return; if (x.dataset.x === "ok") go(); if (x.dataset.x === "skip" && onExtra) { modalClose(); onExtra(); } });
      el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      const i = $("#ab-amt"); if (i) { i.focus(); i.select(); }
    });
}
function confirmBox(title, text, ok, cb) {
  modal(title, `<p class="muted" style="margin-top:0">${text}</p>`, `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="ok">${ok}</button>`, el => el.addEventListener("click", e => { if (e.target.closest('[data-x="ok"]')) { modalClose(); cb(); } }));
}
function installHelp() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  modal("Open it like an app", `
    ${ios ? `<p><b>iPhone / iPad (Safari):</b></p><ol><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Open the planner from that icon from now on.</li></ol><p class="small muted">Use Safari for this — not the Etsy app or Instagram’s browser.</p>` :
    `<p><b>Android (Chrome):</b> tap <b>⋮</b> → <b>Add to Home screen</b> (or <b>Install app</b>).</p><p><b>Computer (Chrome / Edge):</b> click the install icon at the right end of the address bar, or bookmark this page.</p>`}
    <p class="small muted">Once added it opens full-screen and works with no internet. Your data stays on that device — save a backup to move it.</p>`,
    `<button class="btn primary" data-act="close">Got it</button>`);
}

/* ---------- backup / csv ---------- */
function download(name, text, type) {
  const blob = new Blob([text], { type }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function backup() {
  S.settings.lastBackup = new Date().toISOString(); save();
  download(`paycheck-budget-backup-${today()}.json`, JSON.stringify({ app: "paycheck-budget", exported: S.settings.lastBackup, data: S }, null, 1), "application/json");
  render(); toast("Backup saved to your downloads 💾");
}
function restore() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return; const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result); const data = j && j.data ? j.data : j;
        if (!data || !Array.isArray(data.tx) || !data.settings) throw new Error("bad");
        const go = () => { S = migrate(data); S.onboarded = true; save(); OB = { step: 0, d: {} }; location.hash = "today"; render(); toast("Backup opened ✔"); };
        if (S && S.onboarded && S.tx.length) confirmBox("Replace what’s here?", `This device’s planner will be replaced by the backup from ${esc((j.exported || "").slice(0, 10) || "the file")} (${data.tx.length} entries).`, "Replace", go); else go();
      } catch (e) { toast("That file isn’t a Paycheck Budget backup."); }
    };
    r.readAsText(f);
  };
  inp.click();
}
function csv() {
  const rows = [["Date", "Type", "Category", "Note", "Amount"]];
  for (const t of S.tx.slice().sort((a, b) => a.date < b.date ? -1 : 1)) rows.push([t.date, t.dir === "in" ? "In" : "Out", t.kind === "adjust" ? "Balance correction" : t.cat ? catName(t.cat) : "", t.note || "", (t.dir === "in" ? 1 : -1) * t.amount]);
  download(`paycheck-budget-${today()}.csv`, rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\n"), "text/csv");
}
function requestPersist() { try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {} }

/* ---------- toast ---------- */
let toastT;
function toast(msg, undo) {
  const el = $("#toast"); el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button">Undo</button>` : ""}`; el.classList.add("on");
  if (undo) el.querySelector("button").onclick = () => { el.classList.remove("on"); undo(); };
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), undo ? 6000 : 3200);
}

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const go = e.target.closest("[data-go]");
  if (go) { const r = go.dataset.go; if (r === "more") { moreSheet(); return; } if (modalClose) modalClose(); location.hash = r; return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act, id = a.dataset.id;
  if (act === "close-bg" && e.target !== a) return;
  switch (act) {
    case "close": case "close-bg": modalClose && modalClose(); break;
    case "add-tx": txModal(null, a.dataset.cat ? { cat: a.dataset.cat } : {}); break;
    case "edit-tx": txModal(id); break;
    case "edit-bill": billModal(id); break;
    case "pay-bill": payBill(id, a.dataset.d); break;
    case "edit-income": incomeModal(id); break;
    case "got-pay": gotPay(id, a.dataset.d); break;
    case "edit-goal": goalModal(id); break;
    case "goal-move": goalMove(id, a.dataset.dir); break;
    case "edit-debt": debtModal(id); break;
    case "debt-pay": debtPay(id); break;
    case "edit-cat": catModal(id); break;
    case "suggest-budget": suggestBudget(); break;
    case "update-balance": updateBalance(); break;
    case "why": U.why = !U.why; render(); break;
    case "month": U.month = +a.dataset.n === 0 ? monthKey(today()) : shiftMonth(U.month, +a.dataset.n); render(); break;
    case "rmonth": U.reportMonth = shiftMonth(U.reportMonth, +a.dataset.n); render(); break;
    case "billview": U.billView = a.dataset.v; render(); break;
    case "strategy": S.debtPlan.strategy = a.dataset.v; save(); render(); break;
    case "theme": S.settings.theme = a.dataset.v; save(); render(); break;
    case "backup": backup(); break;
    case "restore": restore(); break;
    case "csv": csv(); break;
    case "help-install": installHelp(); break;
    case "erase": confirmBox("Erase everything?", "This deletes all your entries, bills, goals and settings on this device. Save a backup first if you might want them back.", "Erase", () => { localStorage.removeItem(KEY); S = MODE === "demo" ? sampleState() : null; OB = { step: 0, d: {} }; if (S) save(); location.hash = "today"; render(); }); break;
    case "ob-next": obCollect(); OB.step++; render(); setTimeout(() => { const f = $(".ob input"); if (f) f.focus(); }, 30); break;
    case "ob-back": obCollect(); OB.step = Math.max(0, OB.step - 1); render(); break;
    case "ob-finish": obFinish(true); break;
    case "ob-skip-pay": obFinish(false); break;
    case "ob-sample": S = sampleState(); S.sample = true; save(); location.hash = "today"; render(); setTimeout(() => toast("These are made-up numbers. Settings → Erase everything to start fresh."), 300); break;
  }
});
document.addEventListener("change", e => {
  const k = e.target.dataset && e.target.dataset.change; if (!k) return;
  const v = e.target.value;
  if (k === "extra") S.debtPlan.extra = round2(num(v));
  else if (k === "buffer") S.settings.buffer = round2(num(v));
  else if (k === "weekStart") S.settings.weekStart = +v;
  else if (k === "name") S.settings.name = v.trim();
  else if (k === "currency") S.settings.currency = v;
  save(); render();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && modalClose) modalClose();
  if (!modalClose && S && S.onboarded && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !e.metaKey && !e.ctrlKey) {
    if (e.key === "n" || e.key === "+") { e.preventDefault(); txModal(null); }
  }
});
function moreSheet() {
  const items = ROUTES.filter(r => ["bills", "goals", "debt", "reports", "settings"].includes(r[0]));
  modal("More", `<div class="list">${items.map(([k, l, ic]) => `<button class="nav-item" data-go="${k}" style="min-height:52px">${ic}<span>${l}</span></button>`).join("")}</div>`, `<button class="btn" data-act="close">Close</button>`);
}

/* ---------- boot ---------- */
if (MODE === "demo" && !S) { S = sampleState(); save(); }
if (S && S.onboarded) autopay();
routeFromHash();
render();
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
// refresh "today" when the app is reopened on a new day
let lastDay = today();
document.addEventListener("visibilitychange", () => { if (!document.hidden && today() !== lastDay) { lastDay = today(); U.month = monthKey(lastDay); if (S && S.onboarded) autopay(); render(); } });
window.__pb = { get S() { return S; }, set(st) { S = st ? migrate(st) : null; if (S) save(); else localStorage.removeItem(KEY); OB = { step: 0, d: {} }; render(); }, U, safeToSpend, occurrences, debtSim, monthSummary, balance };
})();

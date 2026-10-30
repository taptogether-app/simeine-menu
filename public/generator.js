// Генератор тижневого меню за сімейними правилами. Використовується і сервером, і браузером.
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const DAYS_FULL = ['понеділка', 'вівторка', 'середи', 'четверга', "п'ятниці", 'суботи', 'неділі'];
const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const PORTIONS = 2.5; // ~2,5 дорослих порції на прийом їжі

const iso = d => d.toISOString().slice(0, 10);
const parse = s => new Date(s + 'T12:00:00Z');
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

// Понеділок тижня, для якого варто складати меню: з п'ятниці наступний, інакше поточний.
export function targetMonday(now = new Date()) {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
  const wd = (d.getUTCDay() + 6) % 7; // 0 = Пн
  return iso(addDays(d, wd >= 4 ? 7 - wd : -wd));
}

export function weekInfo(start, updated) {
  const s = parse(start), e = addDays(s, 6);
  const label = s.getUTCMonth() === e.getUTCMonth()
    ? `${s.getUTCDate()} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`
    : `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  return { start, end: iso(e), label, updated: updated || iso(new Date()) };
}

const xFor = (r, portions) => Math.max(0.25, Math.ceil((portions / (r.yield || r.servings || 1)) * 4 - 0.05) / 4);

function picker(rng, usage) {
  // Випадковий вибір з перевагою для страв, яких давно не було.
  return (list, avoid = []) => {
    let c = list.filter(r => !avoid.includes(r.id));
    if (!c.length) c = list;
    const w = c.map(r => 1 / (1 + (usage[r.id] || 0) * 3));
    let t = rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < c.length; i++) { t -= w[i]; if (t <= 0) return c[i]; }
    return c[c.length - 1];
  };
}

function pools(recipes) {
  const by = k => recipes.filter(r => r.kind === k);
  return { egg: by('egg'), other: by('other'), soup: by('soup'), main: [...by('main'), ...by('complex')], side: by('side'), dinner: by('dinner') };
}

function countUsage(days) {
  const u = {};
  (days || []).forEach(d => d.meals.forEach(m => m.items.forEach(it => {
    [it, ...(it.alt || [])].forEach(p => { u[p.r] = (u[p.r] || 0) + 1; });
  })));
  return u;
}

function lunchMain(r, P, pick, prevSide) {
  const items = [{ r: r.id, x: xFor(r, PORTIONS) }];
  if (r.kind === 'main' && P.side.length) {
    const s = pick(P.side, prevSide ? [prevSide] : []);
    items.push({ r: s.id, x: xFor(s, PORTIONS) });
  }
  return items;
}

const SOUP_PLAN = [[0, 1], [2, 3], [4, 5], [6]];

export function generateWeek(lib, start, prevDays = [], rng = Math.random) {
  const P = pools(lib.recipes);
  const usage = countUsage(prevDays);
  const pick = picker(rng, usage);
  const wk = {};
  const use = r => { usage[r.id] = (usage[r.id] || 0) + 1; wk[r.id] = (wk[r.id] || 0) + 1; return r; };
  const maxed = (n = 2) => Object.keys(wk).filter(id => wk[id] >= n);
  const s = parse(start);
  const days = DAYS.map((d, i) => {
    const dt = addDays(s, i);
    return { d, date: `${String(dt.getUTCDate()).padStart(2, '0')}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}`, meals: [] };
  });

  // Сніданки: з яєць, максимум один інший (напр. сирники).
  const otherDay = P.other.length && rng() < 0.6 ? Math.floor(rng() * 7) : -1;
  let prevB = null;
  const breakfasts = days.map((_, i) => {
    const r = use(i === otherDay ? pick(P.other) : pick(P.egg.length ? P.egg : P.other, [...(prevB ? [prevB] : []), ...maxed()]));
    prevB = r.id;
    return r;
  });

  // Супи: варимо на 2 дні.
  const soupFor = [];
  const usedSoups = [];
  SOUP_PLAN.forEach(group => {
    const r = use(pick(P.soup, usedSoups));
    usedSoups.push(r.id);
    group.forEach((di, j) => { soupFor[di] = { r, cook: j === 0, from: group[0], portions: group.length * PORTIONS }; });
  });

  let prevMain = null, prevSide = null, prevDinner = null;
  days.forEach((day, i) => {
    const b = breakfasts[i];
    day.meals.push({ slot: 'Сніданок', items: [{ r: b.id, x: xFor(b, PORTIONS) }] });

    const sp = soupFor[i];
    const soupItem = sp.cook
      ? { r: sp.r.id, x: xFor(sp.r, sp.portions), ...(sp.portions > PORTIONS ? { note: 'варимо на 2 дні' } : {}) }
      : { r: sp.r.id, x: 0, note: 'з ' + DAYS_FULL[sp.from] };
    const m = use(pick(P.main, [...(prevMain ? [prevMain] : []), ...maxed()]));
    prevMain = m.id;
    const mainItems = lunchMain(m, P, pick, prevSide);
    prevSide = mainItems[1] ? mainItems[1].r : null;
    day.meals.push({ slot: 'Обід', items: [soupItem, ...mainItems] });

    const dn = use(pick(P.dinner, [...(prevDinner ? [prevDinner] : []), ...maxed()]));
    prevDinner = dn.id;
    const alt = pick(P.dinner, [dn.id]);
    const it = { r: dn.id, x: xFor(dn, PORTIONS) };
    if (alt.id !== dn.id) it.alt = [{ r: alt.id, x: xFor(alt, PORTIONS) }];
    day.meals.push({ slot: 'Вечеря', items: [it] });
  });
  return days;
}

// Замінити одну страву. Повертає нові days (копію).
export function replaceItem(lib, days, di, mi, ii, rng = Math.random) {
  const D = JSON.parse(JSON.stringify(days));
  const R = Object.fromEntries(lib.recipes.map(r => [r.id, r]));
  const P = pools(lib.recipes);
  const pick = picker(rng, countUsage(D));
  const meal = D[di].meals[mi];
  const it = meal.items[ii];
  const cur = R[it.r];
  if (!cur) return D;
  const kind = cur.kind;

  if (kind === 'soup') {
    const used = D.map(d => d.meals.find(m => m.slot === 'Обід')).filter(Boolean).map(m => m.items[0].r);
    const nr = pick(P.soup, used);
    D.forEach(d => d.meals.forEach(m => m.items.forEach(x => {
      if (x.r === cur.id && m.slot === 'Обід' && sameSoupGroup(D, di, d)) {
        x.r = nr.id;
        if (x.x > 0) x.x = xFor(nr, (x.note ? 2 : 1) * PORTIONS);
      }
    })));
    return D;
  }
  if (kind === 'side') {
    const ns = pick(P.side, [cur.id]);
    meal.items[ii] = { r: ns.id, x: xFor(ns, PORTIONS) };
    return D;
  }
  if (kind === 'main' || kind === 'complex') {
    const nr = pick(P.main, [cur.id]);
    const hasSide = meal.items[ii + 1] && R[meal.items[ii + 1].r] && R[meal.items[ii + 1].r].kind === 'side';
    const prevSide = hasSide ? meal.items[ii + 1].r : null;
    meal.items.splice(ii, hasSide ? 2 : 1, ...lunchMain(nr, P, pick, prevSide));
    return D;
  }
  if (kind === 'dinner') {
    const opts = [it.r, ...(it.alt || []).map(a => a.r)];
    const n1 = pick(P.dinner, opts);
    const n2 = pick(P.dinner, [...opts, n1.id]);
    const ni = { r: n1.id, x: xFor(n1, PORTIONS) };
    if (n2.id !== n1.id) ni.alt = [{ r: n2.id, x: xFor(n2, PORTIONS) }];
    meal.items[ii] = ni;
    return D;
  }
  // сніданок
  const nr = pick(P.egg, [cur.id]);
  meal.items[ii] = { r: nr.id, x: xFor(nr, PORTIONS) };
  return D;
}

function sameSoupGroup(D, di, d) {
  const j = D.indexOf(d);
  const g = SOUP_PLAN.find(g => g.includes(di));
  return g ? g.includes(j) : j === di;
}

export function validate(lib, days) {
  const ids = new Set(lib.recipes.map(r => r.id));
  const bad = [];
  days.forEach(d => d.meals.forEach(m => m.items.forEach(it => {
    [it, ...(it.alt || [])].forEach(p => { if (!ids.has(p.r)) bad.push(p.r); });
  })));
  return bad;
}

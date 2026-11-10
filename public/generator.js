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

function pools(recipes) {
  const minutes = r => { const t = r.time || ''; const h = t.match(/(\d+)\s*год/); const m = t.match(/(\d+)\s*хв/); return (h ? +h[1]*60 : 0) + (m ? +m[1] : 0); };
  const by = k => recipes.filter(r => r.kind === k && minutes(r) <= 60 && (k === 'side' || /^https:\/\/klopotenko\.com\//.test(r.url || '')));
  return { egg: by('egg'), soup: by('soup'), main: [...by('main'), ...by('complex')], side: by('side'), dinner: [...by('dinner'), ...by('main').filter(r => r.id !== 'garbuz-kotlety'), ...by('complex')] };
}
function historyIds(history) {
  const ids = new Set();
  for (const week of history || []) for (const day of week.days || []) for (const meal of day.meals || []) for (const item of meal.items || []) ids.add(item.r);
  return ids;
}
function pickOne(pool, used, history, rng, exclusions = []) {
  if (!pool.length) throw new Error('Недостатньо рецептів для генерації меню');
  const forbidden = new Set(exclusions);
  const eligible = pool.filter(r => !used.has(r.id) && !history.has(r.id) && !forbidden.has(r.id));
  const fresh = pool.filter(r => !used.has(r.id) && !forbidden.has(r.id));
  const unique = pool.filter(r => !used.has(r.id));
  const candidates = eligible.length ? eligible : fresh.length ? fresh : unique.length ? unique : pool;
  const r = candidates[Math.floor(rng() * candidates.length)];
  used.add(r.id);
  return r;
}
const SOUP_PLAN = [[0,1],[2,3],[4,5],[6]];
export function generateWeek(lib, start, history = [], rng = Math.random) {
  const P = pools(lib.recipes);
  const previous = historyIds(history);
  const used = new Set();
  const days = DAYS.map((d,i) => { const dt=addDays(parse(start),i); return {d,date:`${String(dt.getUTCDate()).padStart(2,'0')}.${String(dt.getUTCMonth()+1).padStart(2,'0')}`,meals:[]}; });
  const soups = [];
  for (const group of SOUP_PLAN) {
    const r = pickOne(P.soup,used,previous,rng);
    group.forEach((i,j)=>soups[i]={r, first:j===0, firstDay:group[0], portions:PORTIONS*group.length});
  }
  for (let i=0;i<7;i++) {
    const breakfast=pickOne(P.egg,used,previous,rng);
    days[i].meals.push({slot:'Сніданок',items:[{r:breakfast.id,x:xFor(breakfast,PORTIONS)}]});
    const sp=soups[i];
    const soupItem={r:sp.r.id,x:sp.first?xFor(sp.r,sp.portions):0,...(sp.first && sp.portions>PORTIONS?{note:'варимо на 2 дні'}:{}),...(!sp.first?{note:'з '+DAYS_FULL[sp.firstDay]}:{})};
    const main=pickOne(P.main,used,previous,rng);
    const lunch=[soupItem,{r:main.id,x:xFor(main,PORTIONS)}];
    if(main.kind==='main') {const side=pickOne(P.side,used,previous,rng);lunch.push({r:side.id,x:xFor(side,PORTIONS)});}
    days[i].meals.push({slot:'Обід',items:lunch});
    const dinner=pickOne(P.dinner,used,previous,rng,[main.id]);
    const dinnerItems=[{r:dinner.id,x:xFor(dinner,PORTIONS)}];
    if(dinner.kind!=='complex') {const side=pickOne(P.side,used,previous,rng);dinnerItems.push({r:side.id,x:xFor(side,PORTIONS)});}
    days[i].meals.push({slot:'Вечеря',items:dinnerItems});
  }
  return days;
}
export function replaceItem(lib, days, di, mi, ii, rng=Math.random, history=[]) {
  const D=JSON.parse(JSON.stringify(days));
  const P=pools(lib.recipes), R=Object.fromEntries(lib.recipes.map(r=>[r.id,r]));
  const meal=D[di]?.meals[mi], it=meal?.items[ii]; if(!it||!R[it.r])return D;
  const old=R[it.r], prior=historyIds(history), used=new Set(D.flatMap(d=>d.meals.flatMap(m=>m.items.map(x=>x.r))));
  const pool=old.kind==='soup'?P.soup:old.kind==='egg'?P.egg:old.kind==='side'?P.side:mi===2?P.dinner:P.main;
  const nr=pickOne(pool,used,prior,rng,[old.id]);
  if(old.kind==='soup') { const group=SOUP_PLAN.find(g=>g.includes(di))||[di];for(const i of group){const x=D[i].meals[1].items[0];x.r=nr.id;if(x.x>0)x.x=xFor(nr,group.length*PORTIONS);} }
  else if(old.kind==='side') meal.items[ii]={r:nr.id,x:xFor(nr,PORTIONS)};
  else {const rest=meal.items.slice(ii+1);const hasSide=rest.length && R[rest[0].r]?.kind==='side';const repl=[{r:nr.id,x:xFor(nr,PORTIONS)}];if(nr.kind==='main'||(mi===2&&nr.kind==='dinner')){const side=pickOne(P.side,used,prior,rng);repl.push({r:side.id,x:xFor(side,PORTIONS)});}meal.items.splice(ii,hasSide?2:1,...repl);}
  return D;
}

export function validate(lib, days) {
  const ids = new Set(lib.recipes.map(r => r.id));
  const bad = [];
  days.forEach(d => d.meals.forEach(m => m.items.forEach(it => {
    [it, ...(it.alt || [])].forEach(p => { if (!ids.has(p.r)) bad.push(p.r); });
  })));
  return bad;
}

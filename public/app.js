const $ = s => document.querySelector(s);
const API = '/api/state';
const fmtNum = n => { const r = Math.round(n * 100) / 100; return String(r).replace('.', ','); };
const FRAC = { 0.25: '¼', 0.33: '⅓', 0.5: '½', 0.75: '¾' };
function fmtQ(q, u, shop) {
  if (q == null) return u;
  if (u === 'г' && q >= 1000) return fmtNum(Math.round(q / 10) / 100) + ' кг';
  if (u === 'мл' && q >= 1000) return fmtNum(Math.round(q / 10) / 100) + ' л';
  if (shop && (u === 'шт' || u === 'зуб.' || u === 'пучок' || u === 'скибки' || u === 'гілочки')) q = Math.ceil(q - 0.01);
  if (u === 'г' || u === 'мл') q = Math.round(q / 5) * 5 || Math.round(q);
  const whole = Math.floor(q), frac = Math.round((q - whole) * 100) / 100;
  const s = FRAC[frac] !== undefined ? (whole ? whole + ' ' : '') + FRAC[frac] : fmtNum(q);
  return s + ' ' + u;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const key = s => s.toLowerCase();

let LIB = null, S = null, R = {}, busy = false;

const opts = it => [{ r: it.r, x: it.x }, ...(it.alt || [])];
const pick = (k, it) => { const o = opts(it); const c = S.choices[k] || 0; return o[c] || o[0]; };

function chosen() {
  const out = [];
  S.days.forEach((day, di) => day.meals.forEach((m, mi) => m.items.forEach((it, ii) => {
    const p = pick(`${di}-${mi}-${ii}`, it);
    out.push({ day: day.d, slot: m.slot, r: p.r, x: it.x === 0 ? 0 : p.x });
  })));
  return out;
}

function status(msg, err) {
  const el = $('#sync');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('bad', !!err);
}

async function api(body) {
  const res = await fetch(API, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

let queue = Promise.resolve(), pending = 0;
function act(body, label) {
  pending++; busy = true; status(label || 'Зберігаю…');
  queue = queue.then(async () => {
    try { const s = await api(body); if (pending === 1) { S = s; render(); } status('Збережено'); }
    catch (e) { status('Не вдалося зберегти. Перевірте інтернет.', true); }
    finally { if (--pending === 0) busy = false; }
  });
  return queue;
}

function nextMondayLabel() {
  const now = new Date();
  const wd = (now.getDay() + 6) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (wd >= 4 ? 7 - wd : -wd));
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

const btnRe = (k, label) => `<button class="re" type="button" data-re="${k}" title="Замінити: ${esc(label)}" aria-label="Замінити: ${esc(label)}">↻</button>`;

function renderMenu() {
  let h = '<h2>Меню на тиждень</h2><div class="rules">' + (LIB.rules || []).map(r => `<span>${esc(r)}</span>`).join('') + '</div>' +
    `<div class="toolbar"><button class="btn primary" id="gen" type="button">Скласти нове меню (тиждень з ${nextMondayLabel()})</button><span class="sync" id="sync" role="status"></span></div>` +
    '<p class="note">Супи варимо одразу на 2 дні. Де є «або», оберіть варіант: список покупок перерахується автоматично. ↻ замінює одну страву. Усі зміни бачать обоє.</p><div class="week">';
  S.days.forEach((day, di) => {
    h += `<article class="day"><h3>${day.d}<span>${day.date}</span></h3>`;
    day.meals.forEach((m, mi) => {
      h += `<div class="slot"><span class="lab">${m.slot}</span>`;
      m.items.forEach((it, ii) => {
        const k = `${di}-${mi}-${ii}`, o = opts(it);
        const r0 = R[it.r];
        if (!r0) return;
        if (o.length > 1) {
          const c = S.choices[k] || 0;
          h += `<div class="row"><fieldset class="choice"><legend class="vh">Варіант: ${m.slot}, ${day.d}</legend>` + o.map((p, oi) => {
            const r = R[p.r]; if (!r) return ''; const id = `c-${k}-${oi}`;
            return `${oi ? '<span class="or">або</span>' : ''}<div class="opt${oi === c ? ' on' : ''}"><input type="radio" name="c-${k}" id="${id}" value="${oi}" data-k="${k}"${oi === c ? ' checked' : ''}><label for="${id}" class="vh">Обрати ${esc(r.name)}</label><a class="dish" href="#r-${r.id}">${esc(r.name)}</a></div>`;
          }).join('') + `</fieldset>${btnRe(k, r0.name)}</div>`;
        } else {
          const side = r0.type === 'Гарнір';
          h += `<div class="row"><a class="dish${side ? ' side' : ''}" href="#r-${r0.id}">${side ? '+ ' : ''}${esc(r0.name.replace('Гарнір: ', ''))}</a>${it.x === 0 ? '' : btnRe(k, r0.name)}</div>`;
        }
        if (it.note) h += `<span class="tag ${it.x === 0 ? 'left' : ''}">${it.x === 0 ? '↺ ' : ''}${esc(it.note)}</span>`;
      });
      h += '</div>';
    });
    h += '</article>';
  });
  $('#v-menu').innerHTML = h + '</div>';
}

function renderRecipes() {
  const ch = chosen();
  const used = {}, alt = {};
  ch.forEach(e => (used[e.r] = used[e.r] || []).push(e));
  S.days.forEach((day, di) => day.meals.forEach((m, mi) => m.items.forEach((it, ii) => {
    const sel = pick(`${di}-${mi}-${ii}`, it).r;
    opts(it).forEach(p => { if (p.r !== sel) (alt[p.r] = alt[p.r] || []).push({ day: day.d, x: p.x }); });
  })));
  const order = ['Сніданок', 'Обід', 'Гарнір', 'Вечеря'];
  let h = '<h2>Рецепти тижня</h2><p class="note">Кількості вже перераховані на нашу родину для одного приготування. Повний спосіб приготування за посиланням на klopotenko.com.</p>';
  order.forEach(t => {
    const list = LIB.recipes.filter(r => r.type === t && (used[r.id] || alt[r.id]));
    if (!list.length) return;
    h += `<h3 class="group">${t === 'Гарнір' ? 'Гарніри до обіду' : t}</h3><div class="recipes">`;
    list.forEach(r => {
      const ev = (used[r.id] || []).filter(e => e.x > 0), av = alt[r.id] || [];
      const x = Math.max(...ev.map(e => e.x), ...av.map(e => e.x));
      const inMenu = (used[r.id] || []).map(e => e.day + (e.x === 0 ? ' (залишки)' : '')).join(', ');
      const asAlt = [...new Set(av.map(e => e.day))].join(', ');
      h += `<article class="rcp${ev.length ? '' : ' alt'}" id="r-${r.id}"><div class="type">${r.type}${ev.length ? '' : ' · варіант на вибір'}</div><h3>${esc(r.name)}</h3>
        <div class="facts">${esc(r.time)} · у рецепті ${r.servings} порц. · у нас ×${fmtNum(x)}${ev.length > 1 ? ' · готуємо ' + ev.length + ' рази' : ''}</div>
        <div class="days-used">${inMenu ? 'У меню: ' + inMenu : ''}${inMenu && asAlt ? '<br>' : ''}${asAlt ? 'Можна замінити: ' + asAlt : ''}</div><ul>`;
      r.ingredients.forEach(i => { h += `<li><span>${esc(i.n)}${i.note ? ` <small>(${esc(i.note)})</small>` : ''}</span><span class="q">${fmtQ(i.q == null ? null : i.q * x, i.u)}</span></li>`; });
      h += `</ul><div class="kid"><b>Для дитини:</b> ${esc(r.kid)}</div>`;
      h += r.url ? `<a class="src" href="${esc(r.url)}" target="_blank" rel="noopener">Спосіб приготування на klopotenko.com ↗</a>` : `<span class="tag">Власна порада, не з klopotenko.com</span>`;
      h += '</article>';
    });
    h += '</div>';
  });
  $('#v-recipes').innerHTML = h;
}

function renderShop() {
  const agg = {};
  chosen().forEach(e => {
    if (!e.x) return; const r = R[e.r]; if (!r) return;
    r.ingredients.forEach(i => {
      const k = i.q == null ? 'salt-pepper' : key(i.n) + '|' + i.u;
      const a = agg[k] = agg[k] || (i.q == null ? { n: 'Сіль і чорний перець', u: 'до смаку', q: null, c: i.c, uses: {} } : { n: i.n, u: i.u, q: 0, c: i.c, uses: {} });
      if (i.q != null) a.q += i.q * e.x; a.uses[r.id] = r.name;
    });
  });
  const done = S.done || {};
  const list = Object.entries(agg);
  let h = `<h2>Список покупок</h2><p class="note">Список рахується за обраними варіантами в меню. Позначки спільні для всієї родини.</p><div class="shopbar"><span class="progress" id="prog"></span><button class="btn" id="reset" type="button">Зняти всі позначки</button></div><div class="cats">`;
  LIB.categories.forEach(c => {
    const items = list.filter(([k, a]) => a.c === c).sort((a, b) => a[1].n.localeCompare(b[1].n, 'uk'));
    if (!items.length) return;
    h += `<div class="cat"><h3>${c}</h3>`;
    items.forEach(([k, a]) => {
      const id = 'i-' + btoa(unescape(encodeURIComponent(k))).replace(/[^a-z0-9]/gi, '');
      h += `<label class="item${done[k] ? ' done' : ''}" for="${id}"><input type="checkbox" id="${id}" data-k="${esc(k)}"${done[k] ? ' checked' : ''}>
      <span class="nm">${esc(a.n)}<span class="uses">${Object.entries(a.uses).map(([rid, nm]) => `<a href="#r-${rid}">${esc(nm)}</a>`).join(' · ')}</span></span>
      <span class="q">${a.q == null ? a.u : fmtQ(a.q, a.u, true)}</span></label>`;
    });
    h += '</div>';
  });
  $('#v-shop').innerHTML = h + '</div>';
  const all = document.querySelectorAll('.item input'), c = [...all].filter(x => x.checked).length;
  $('#prog').textContent = `Куплено ${c} з ${all.length}`;
}

function render() {
  const y = window.scrollY;
  $('#meta').innerHTML = 'Тиждень ' + esc(S.week.label) + '<br>Оновлено ' + S.week.updated.split('-').reverse().join('.');
  renderMenu(); renderRecipes(); renderShop();
  window.scrollTo(0, y);
}

// Події (делегування, один раз)
$('#v-menu').addEventListener('change', e => {
  const t = e.target; if (t.type !== 'radio') return;
  S.choices[t.dataset.k] = +t.value;
  t.closest('.choice').querySelectorAll('.opt').forEach(o => o.classList.toggle('on', o.querySelector('input').checked));
  renderRecipes(); renderShop();
  act({ action: 'choose', k: t.dataset.k, v: +t.value });
});
$('#v-menu').addEventListener('click', e => {
  const g = e.target.closest('#gen');
  if (g) {
    if (confirm('Скласти нове меню на тиждень з ' + nextMondayLabel() + '? Поточне меню і позначки в списку покупок буде замінено.')) act({ action: 'generate' }, 'Складаю меню…');
    return;
  }
  const b = e.target.closest('[data-re]');
  if (b) { const [di, mi, ii] = b.dataset.re.split('-').map(Number); act({ action: 'replace', di, mi, ii }, 'Замінюю страву…'); }
});
$('#v-shop').addEventListener('change', e => {
  const t = e.target; if (!t.dataset.k) return;
  if (t.checked) S.done[t.dataset.k] = true; else delete S.done[t.dataset.k];
  t.closest('.item').classList.toggle('done', t.checked);
  const all = document.querySelectorAll('.item input'), c = [...all].filter(x => x.checked).length;
  $('#prog').textContent = `Куплено ${c} з ${all.length}`;
  act({ action: 'check', key: t.dataset.k, v: t.checked });
});
$('#v-shop').addEventListener('click', e => {
  if (e.target.id === 'reset' && confirm('Зняти всі позначки?')) act({ action: 'reset-shop' });
});

function route() {
  const h = (location.hash || '#menu').slice(1);
  const tab = h.startsWith('r-') ? 'recipes' : (['menu', 'recipes', 'shop'].includes(h) ? h : 'menu');
  ['menu', 'recipes', 'shop'].forEach(t => { $('#v-' + t).hidden = t !== tab; const a = document.querySelector(`[data-tab="${t}"]`); if (t === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (h.startsWith('r-')) { const el = document.getElementById(h); if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' })); }
  else window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// Підтягувати зміни іншого члена родини
async function refresh() {
  if (busy || document.hidden) return;
  try { const s = await api(); if (s.rev !== S.rev) { S = s; render(); } } catch (e) { /* тихо */ }
}
setInterval(refresh, 15000);
document.addEventListener('visibilitychange', refresh);

(async () => {
  try {
    const [lib, s] = await Promise.all([fetch('/recipes.json', { cache: 'no-store' }).then(r => r.json()), api()]);
    LIB = lib; S = s; S.choices = S.choices || {}; S.done = S.done || {};
    LIB.recipes.forEach(r => R[r.id] = r);
    render(); route();
  } catch (e) {
    $('#v-menu').innerHTML = '<p class="err">Не вдалося завантажити меню. Перевірте інтернет і оновіть сторінку.</p>';
  }
})();

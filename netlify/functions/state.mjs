import { getStore } from '@netlify/blobs';
import { generateWeek, replaceItem, targetMonday, weekInfo, validate } from '../../public/generator.js';
import lib from '../../public/recipes.json' with { type: 'json' };
import seed from './seed.json' with { type: 'json' };

const KEY = 'state';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function load(store) {
  const s = await store.get(KEY, { type: 'json' });
  return s || { week: seed.week, days: seed.days, choices: {}, done: {}, rev: 0 };
}

export default async (req) => {
  const store = getStore({ name: 'family-menu', consistency: 'strong' });
  if (req.method === 'GET') return json(await load(store));
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let b;
  try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const s = await load(store);
  const today = new Date().toISOString().slice(0, 10);

  switch (b.action) {
    case 'choose':
      if (typeof b.k !== 'string') return json({ error: 'k' }, 400);
      s.choices[b.k] = Number(b.v) || 0;
      break;
    case 'check':
      if (typeof b.key !== 'string') return json({ error: 'key' }, 400);
      if (b.v) s.done[b.key] = true; else delete s.done[b.key];
      break;
    case 'reset-shop':
      s.done = {};
      break;
    case 'generate': {
      const start = /^\d{4}-\d{2}-\d{2}$/.test(b.start || '') ? b.start : targetMonday();
      s.prevDays = s.days;
      s.days = generateWeek(lib, start, s.days);
      s.week = weekInfo(start, today);
      s.choices = {};
      s.done = {};
      break;
    }
    case 'replace': {
      const { di, mi, ii } = b;
      if (![di, mi, ii].every(Number.isInteger) || !s.days[di] || !s.days[di].meals[mi] || !s.days[di].meals[mi].items[ii]) return json({ error: 'index' }, 400);
      s.days = replaceItem(lib, s.days, di, mi, ii);
      Object.keys(s.choices).forEach(k => { if (k.startsWith(`${di}-${mi}-`)) delete s.choices[k]; });
      s.week.updated = today;
      break;
    }
    default:
      return json({ error: 'action' }, 400);
  }
  if (validate(lib, s.days).length) return json({ error: 'invalid menu' }, 500);
  s.rev = (s.rev || 0) + 1;
  delete s.prevDays;
  await store.setJSON(KEY, s);
  return json(s);
};

export const config = { path: '/api/state' };

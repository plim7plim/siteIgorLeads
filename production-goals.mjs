import { getGoal, listSellerGoals, updateGoal } from './goals-db.mjs';

const localDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const respond = (res, status, data) => res.writeHead(status, headers).end(JSON.stringify(data));
const publicOrigin = process.env.PANEL_ORIGIN ? new URL(process.env.PANEL_ORIGIN).origin : '';

export async function saveProductionGoals(request, response, snapshot) {
  const origin = `http://${request.headers.host}`;
  const local = request.headers.origin === origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!local && (!publicOrigin || request.headers.origin !== publicOrigin)) {
    return respond(response, 403, { error: 'Origem não autorizada para editar metas.' });
  }
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    return respond(response, 415, { error: 'Envie os valores em JSON.' });
  }
  let change;
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 1024) {
        respond(response, 413, { error: 'Requisição muito grande.' });
        return;
      }
    }
    const { weekly, monthly, seller = '', remove } = JSON.parse(body);
    if (typeof seller !== 'string' || (seller && !listSellerGoals().has(seller) &&
        !snapshot?.proposals.some(row => row.seller === seller))) {
      return respond(response, 400, { error: 'Selecione um vendedor válido.' });
    }
    if (remove !== undefined && !['weekly', 'monthly'].includes(remove)) throw new Error();
    if (remove === undefined && ![weekly, monthly].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error();
    change = { seller, weekly, monthly, remove };
  } catch {
    return respond(response, 400, { error: 'Informe metas válidas e não negativas.' });
  }

  try {
    const targets = updateGoal(change);
    respond(response, 200, { targets });
  } catch {
    respond(response, 500, { error: 'Não foi possível salvar as metas.' });
  }
}

export function productionGoals(snapshot, stale, seller = '') {
  const today = localDay.format(new Date());
  const monday = new Date(today + 'T00:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const weekStart = monday.toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  const period = from => ({ from, to: today, production: snapshot ? 0 : null, count: 0, paidCount: 0, paidValue: 0 });
  const weekly = period(weekStart);
  const monthly = period(monthStart);
  const sellerGoals = listSellerGoals();
  const sellers = new Map([...sellerGoals.keys()].map(key => [key, key]));
  const dailyProduction = new Map();
  const monthlyBySeller = new Map();
  for (const row of snapshot?.proposals ?? []) {
    if (row.seller && row.name) sellers.set(row.seller, row.name);
    const inMonth = row.created >= monthStart && row.created <= today;
    if (inMonth) monthlyBySeller.set(row.seller, (monthlyBySeller.get(row.seller) ?? 0) + row.cents);
    if (seller && row.seller !== seller) continue;
    if (inMonth) dailyProduction.set(row.created, (dailyProduction.get(row.created) ?? 0) + row.cents);
    for (const summary of [weekly, monthly]) {
      if (row.created < summary.from || row.created > today) continue;
      summary.production += row.cents;
      summary.count++;
      if (row.paid) {
        summary.paidCount++;
        summary.paidValue += row.cents;
      }
    }
  }
  const targets = getGoal(seller);
  const month = monthStart.slice(0, 7);
  const calendar = [];
  for (const date = new Date(monthStart + 'T00:00:00Z'); date.toISOString().startsWith(month); date.setUTCDate(date.getUTCDate() + 1)) {
    calendar.push({ day: date.toISOString().slice(0, 10), weekday: date.getUTCDay() >= 1 && date.getUTCDay() <= 5 });
  }
  const weekdays = calendar.filter(date => date.weekday).length;
  const remainingDays = calendar.filter(date => date.weekday && date.day > today).length;
  let elapsed = 0;
  let accumulated = 0;
  const trend = calendar.map(({ day, weekday }) => {
    if (weekday) elapsed++;
    accumulated += dailyProduction.get(day) ?? 0;
    return { day, actual: snapshot && day <= today ? accumulated : null,
      planned: targets.monthly ? Math.round(targets.monthly * elapsed / weekdays) : null };
  });
  const ranking = snapshot ? [...sellerGoals]
    .filter(([key, target]) => target.monthly > 0 && sellers.has(key))
    .map(([key, target]) => {
      const production = monthlyBySeller.get(key) ?? 0;
      return { key, name: sellers.get(key), production, target: target.monthly, percent: production / target.monthly * 100 };
    })
    .sort((a, b) => b.percent - a.percent || b.production - a.production || a.name.localeCompare(b.name, 'pt-BR')) : [];
  return {
    targets,
    sellers: [...sellers].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')),
    weekly, monthly,
    remainingDays, trend, ranking,
    updatedAt: snapshot?.updatedAt,
    stale
  };
}

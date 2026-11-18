import { readFileSync } from 'node:fs';

const geo = JSON.parse(readFileSync(new URL('./brasil-ufs.geojson', import.meta.url), 'utf8'));
const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/[^a-z0-9]+/gi, ' ').trim().toUpperCase();
const states = geo.features.map(({ properties: { uf, name } }) => ({ uf, name, normalized: normalize(name) }))
  .sort((a, b) => b.normalized.length - a.normalized.length);
const codes = new Set(states.map(state => state.uf));
const cities = new Map([
  ['CAMPO GRANDE', 'MS'], ['CURITIBA', 'PR'], ['BELO HORIZONTE', 'MG'], ['BH', 'MG'],
  ['SAO LUIS', 'MA'], ['SAO GONCALO', 'RJ'], ['FORTALEZA', 'CE'], ['RECIFE', 'PE'],
  ['MANAUS', 'AM'], ['SALVADOR', 'BA'], ['GOIANIA', 'GO'], ['BRASILIA', 'DF'],
  ['PORTO ALEGRE', 'RS'], ['FLORIANOPOLIS', 'SC']
]);

function stateOf(value) {
  const text = String(value ?? '').trim().toUpperCase();
  const code = text.match(/(?:^|\s[-–]\s)([A-Z]{2})$/)?.[1] ??
    text.match(/^(?:GOV(?:ERNO)?|PREF(?:EITURA)?)(?:\s+D[EOA])?\s+([A-Z]{2})$/)?.[1];
  if (codes.has(code)) return code;
  const name = normalize(text);
  const state = states.find(item => ` ${name} `.includes(` ${item.normalized} `));
  if (state) return state.uf;
  const city = name.match(/^PREF(?:EITURA)?\s+(?:D[EOA]\s+)?(.+)$/)?.[1];
  return cities.get(city) ?? null;
}

export function proposalsByState(proposals) {
  const counts = new Map();
  let unknown = 0;
  for (const row of proposals) {
    const uf = stateOf(row.agency) ?? stateOf(row.agreement);
    if (uf) counts.set(uf, (counts.get(uf) ?? 0) + 1);
    else unknown++;
  }
  return {
    states: states.map(({ uf, name }) => ({ uf, name, count: counts.get(uf) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR')),
    unknown, total: proposals.length
  };
}

const endpoint = 'https://www.soumaisblu.com.br/api/rest/v1/proposals';
const columns = [
  'id', 'vendorId', 'vendor_id', 'vendorName', 'vendor_name', 'employee_id',
  'product', 'entidade', 'obs', 'valor', 'valorFinal', 'valor_final', 'status', 'statusOp', 'status_op',
  'convenio', 'bancoDigitado', 'banco_digitado', 'bancoComprado', 'banco_comprado',
  'created_at', 'updated_at', 'history', 'clientName', 'client_name', 'numero', 'protocolo'
];
const extraColumns = ['credito_esteira', 'digitacao_at', 'paid_at', 'meta'];
const pageSize = 800;
const photoBase = 'https://www.soumaisblu.com.br';

function resolveProfilePhoto(value) {
  const raw = String(value ?? '').trim();
  const inline = /^data:(image\/(?:jpeg|png|gif|webp|avif));base64,([a-z0-9+/]+={0,2})$/i.exec(raw);
  if (inline) return { type: inline[1], bytes: Buffer.from(inline[2], 'base64') };
  if (!raw) return null;

  try {
    const url = new URL(raw, photoBase);
    if (url.protocol !== 'https:' || !['www.soumaisblu.com.br', 'soumaisblu.com.br'].includes(url.hostname)) return null;
    const path = ['/api/file.php', '/api/attachment-proxy.php'].includes(url.pathname)
      ? url.searchParams.get('path') || ''
      : decodeURIComponent(url.pathname);
    const file = path.replace(/^\/+/, '').replace(/^uploads\//i, '');
    if (!/^profile-photos\//i.test(file) || file.split('/').some(part => part === '..')) return null;
    const target = new URL('/api/file.php', photoBase);
    target.searchParams.set('path', file);
    return { url: target.href };
  } catch {
    return null;
  }
}

export async function loadSellerPhotos(apiKey, sellerIds) {
  const photos = new Map();
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL('/api/rest/v1/users', photoBase);
    url.search = new URLSearchParams({ select: 'id,photo_url', order: 'id.asc', limit: pageSize, offset });
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-API-Key': apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Fotos do Sou+BLU retornaram HTTP ${response.status}`);
    const users = await response.json();
    if (!Array.isArray(users)) throw new Error('Resposta de fotos inválida.');
    for (const user of users) {
      const id = String(user.id);
      if (!sellerIds.has(id)) continue;
      const photo = resolveProfilePhoto(user.photo_url);
      if (photo) photos.set(id, photo);
    }
    if (users.length < pageSize) return photos;
  }
}

function isCreditManagement(row) {
  const workflow = parseJson(row.credito_esteira ?? row.creditoEsteira);
  const entity = String(row.entidade ?? '').toUpperCase().trim();
  const notes = String(row.obs ?? '');
  return workflow?.tipo === 'compra_divida' ||
    ['COMPRA_DIVIDA', 'COMPRA DE DIVIDA'].includes(entity) ||
    notes.includes('[COMPRA_DIVIDA]') || notes.includes('tipo_esteira=compra_divida');
}

function loadPage(apiKey, offset, includeWorkflow) {
  const url = new URL(endpoint);
  const select = includeWorkflow ? [...columns, ...extraColumns] : columns;
  url.search = new URLSearchParams({
    select: select.join(','), order: 'id.asc', limit: pageSize, offset
  });
  return fetch(url, {
    headers: { Accept: 'application/json', 'X-API-Key': apiKey },
    redirect: 'error',
    signal: AbortSignal.timeout(15000)
  });
}

const label = value => String(value ?? '').trim();
const normalizeName = value => label(value).normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
const saoPauloDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
function dateOnly(value) {
  const text = label(value);
  const day = text.match(/^(?!0000)\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
  if (!day || !/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) return day;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? saoPauloDay.format(ms) : '';
}

function parseJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function proposalDates(row, paid) {
  const history = parseJson(row.history);
  const meta = parseJson(row.meta);
  let firstEntry = '';
  let paymentStamp = '';
  let paymentTransition = '';
  for (const event of Array.isArray(history) ? history : []) {
    const kind = label(event?.kind || event?.billing).toLowerCase();
    const action = label(event?.action);
    const day = dateOnly(event?.date);
    if (!day) continue;
    if (['digitacao', 'digitacao_at'].includes(kind) || /(→|->|⇒)\s*\[?\s*Digita|Status:.*Digita/i.test(action)) {
      if (!firstEntry || day < firstEntry) firstEntry = day;
    }
    if (['paid', 'paid_at'].includes(kind)) paymentStamp = day;
    else if (/(→|->|⇒)\s*\[?\s*PAGO\b/i.test(action)) paymentTransition = day;
  }
  return {
    created: dateOnly(row.created_at),
    entered: dateOnly(row.digitacao_at) || dateOnly(meta?.digitacaoAt || meta?.digitacao_at) || firstEntry,
    paidDate: dateOnly(row.paid_at) || paymentStamp || paymentTransition || (paid ? dateOnly(row.updated_at) : '')
  };
}
const dimensions = ['seller', 'status', 'operationStatus', 'agreement', 'agency', 'entryBank', 'purchaseBank'];

export async function loadSouMaisBluProposals(apiKey) {
  const proposals = [];
  const credit = [];
  const seen = new Set();
  let includeWorkflow = true;
  for (let offset = 0; ; offset += pageSize) {
    if (offset > 80000) throw new Error('Limite de paginação da esteira excedido.');
    let response = await loadPage(apiKey, offset, includeWorkflow);
    if (offset === 0 && [400, 500].includes(response.status)) {
      await response.body?.cancel();
      includeWorkflow = false;
      response = await loadPage(apiKey, offset, includeWorkflow);
    }
    if (!response.ok) throw new Error(`Sou+BLU retornou HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Resposta da esteira inválida.');

    for (const row of rows) {
      if (!row?.id) continue;
      const inCredit = isCreditManagement(row);
      const inDebt = inCredit || ['compra de divida', 'compra de div'].includes(normalizeName(row.product));
      if (!inDebt) continue;
      const id = String(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const name = label(row.vendorName || row.vendor_name);
      const seller = String(row.vendorId || row.vendor_id || row.employee_id || name.toUpperCase());
      const cents = Math.round(Number(row.valorFinal ?? row.valor_final ?? row.valor ?? 0) * 100);
      if (!Number.isSafeInteger(cents)) throw new Error('Valor da proposta inválido.');
      const status = label(row.status);
      const operationStatus = label(row.statusOp || row.status_op);
      const paid = !/CANCEL/i.test(status + ' ' + operationStatus) &&
        /\bPAG[OA]\b/i.test(status + ' ' + operationStatus);
      const proposal = {
        seller, name, cents, paid, status, operationStatus,
        number: label(row.numero || row.protocolo) || id,
        originalValue: row.valor != null && label(row.valor) && Number.isFinite(Number(row.valor)) ? Number(row.valor) : null,
        sellerSearch: normalizeName(name), clientSearch: normalizeName(row.clientName || row.client_name),
        agreement: label(row.convenio), agency: label(row.entidade),
        entryBank: label(row.bancoDigitado || row.banco_digitado),
        purchaseBank: label(row.bancoComprado || row.banco_comprado),
        ...proposalDates(row, paid)
      };
      proposals.push(proposal);
      if (inCredit) credit.push(proposal);
    }
    if (rows.length < pageSize) break;
  }
  return { proposals, credit };
}

export function purchaseDebtReport(proposals, filters) {
  const sellers = new Map();
  const choices = Object.fromEntries(dimensions.map(key => [key, new Map()]));
  const selected = dimensions.map(key => [key, filters.get(key)]).filter(([, value]) => value !== null);
  const start = filters.get('start');
  const end = filters.get('end');
  const dateField = ['created', 'entered', 'paidDate'].includes(filters.get('date'))
    ? filters.get('date') : 'created';
  const minimum = filters.get('min');
  const maximum = filters.get('max');
  const payment = filters.get('payment');
  const person = normalizeName(filters.get('person'));
  const detail = filters.get('detail');
  const matches = [];
  for (const row of proposals) {
    for (const key of dimensions) {
      const value = row[key];
      const name = key === 'seller' ? row.name : value;
      if (!choices[key].has(value) || name) choices[key].set(value, name || (key === 'seller' ? 'Sem vendedor identificado' : 'Não informado'));
    }
    const day = row[dateField];
    if ((detail !== null && row.seller !== detail) ||
        selected.some(([key, value]) => row[key] !== value) ||
        (person && !row.sellerSearch.includes(person) && !row.clientSearch.includes(person)) ||
        ((start || end) && (!day || (start && day < start) || (end && day > end))) ||
        (minimum && row.cents < Math.round(Number(minimum) * 100)) ||
        (maximum && row.cents > Math.round(Number(maximum) * 100)) ||
        (payment && row.paid !== (payment === 'paid'))) continue;
    matches.push(row);
  }
  if (detail !== null || filters.get('view') === 'proposals') {
    const items = matches.sort((a, b) => b.created.localeCompare(a.created))
      .map(({ number, seller, originalValue, cents, status, operationStatus, paid, created, entered, paidDate }) => ({
        number, seller: choices.seller.get(seller), originalValue, value: cents / 100,
        status: status || operationStatus, paid, created, entered, paidDate
      }));
    return { name: choices.seller.get(detail), items };
  }
  const statusGroups = new Map();
  const agreementGroups = new Map();
  const timelineGroups = new Map();
  const daily = start && end && Date.parse(end) - Date.parse(start) <= 31 * 86400000;
  let missingDate = 0;
  for (const row of matches) {
    addChartPoint(statusGroups, row.status || row.operationStatus || 'Não informado', row);
    addChartPoint(agreementGroups, row.agreement || 'Não informado', row);
    if (row[dateField]) {
      addChartPoint(timelineGroups, daily ? row[dateField] : row[dateField].slice(0, 7), row);
    } else {
      missingDate++;
    }
    const seller = sellers.get(row.seller) ?? { name: choices.seller.get(row.seller), count: 0, cents: 0, paidCount: 0, paidCents: 0 };
    seller.count++;
    seller.cents += row.cents;
    if (row.paid) {
      seller.paidCount++;
      seller.paidCents += row.cents;
    }
    sellers.set(row.seller, seller);
  }
  const metrics = [...sellers].sort(([, a], [, b]) => b.cents - a.cents || b.count - a.count)
    .map(([key, { name, count, cents, paidCount, paidCents }]) => ({
      key, name: name || 'Sem vendedor identificado', count, value: cents / 100,
      paidCount, paidValue: paidCents / 100
    }));
  const options = Object.fromEntries(dimensions.map(key => [key, [...choices[key]]
    .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))]));
  return {
    sellers: metrics,
    options,
    charts: {
      statuses: chartPoints(statusGroups),
      agreements: chartPoints(agreementGroups),
      timeline: chartPoints(timelineGroups).sort((a, b) => a.label.localeCompare(b.label)),
      dateField, missingDate
    }
  };
}

function addChartPoint(groups, label, row) {
  const point = groups.get(label) ?? { label, count: 0, cents: 0 };
  point.count++;
  point.cents += row.cents;
  groups.set(label, point);
}

function chartPoints(groups) {
  return [...groups.values()].map(({ label, count, cents }) => ({ label, count, value: cents / 100 }));
}

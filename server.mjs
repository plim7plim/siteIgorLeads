import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { loadSouMaisBluProposals, loadSellerPhotos, purchaseDebtReport } from './soumaisblu.mjs';
import { productionGoals, saveProductionGoals } from './production-goals.mjs';
import { purchaseDebtCsv } from './reports.mjs';
import { geographyByStatus } from './brazil-regions.mjs';

const { KONSIG_API_URL, KONSIG_API_TOKEN, PORT = '3000', PANEL_HOST = '127.0.0.1' } = process.env;
const souMaisBluKey = process.env.SOUMAISBLU_API_KEY;
const interval = Number(process.env.SYNC_INTERVAL_MS ?? 300000);
const assets = new Map(await Promise.all([
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['brazil-map.js', 'text/javascript; charset=utf-8'],
  ['brasil-ufs.geojson', 'application/geo+json; charset=utf-8'],
  ['favicon.png', 'image/png']
].map(async ([name, type]) => {
  const content = await readFile(new URL(`./${name}`, import.meta.url));
  return [`/${name}`, { content, type }];
})));
const source = KONSIG_API_URL && new URL(KONSIG_API_URL);

if (Boolean(source) !== Boolean(KONSIG_API_TOKEN)) {
  throw new Error('Configure KONSIG_API_URL e KONSIG_API_TOKEN juntos.');
}
if (source && (source.protocol !== 'https:' || source.username || source.password)) {
  throw new Error('Configure um endereço HTTPS sem credenciais embutidas.');
}
if (!Number.isInteger(interval) || interval < 1000 || interval > 2147483647) {
  throw new Error('SYNC_INTERVAL_MS deve ser um inteiro entre 1000 e 2147483647.');
}

const stageNames = new Map([
  ['AGUARD BOLETO', 'Aguardando boleto'],
  ['AGUARD LIQUIDACAO', 'Aguardando liquidação'],
  ['AGUARD QUITACAO', 'Aguardando quitação'],
  ['ANALISE BANCO', 'Análise banco'],
  ['ANALISE CREDITO', 'Análise crédito'],
  ['ANALISE DOCUMENTAL', 'Análise documental'],
  ['PAGO', 'Pagos'],
  ['PAGA', 'Pagos'],
  ['PAGOS', 'Pagos'],
  ['PAGAS', 'Pagos'],
  ['CANCELADO', 'Cancelados'],
  ['CANCELADA', 'Cancelados']
]);

function aggregate(proposals) {
  if (!Array.isArray(proposals)) throw new Error('Resposta fora do formato esperado.');

  const unique = new Map();
  for (const proposal of proposals) {
    const id = String(proposal?.proposta_id ?? '').trim();
    const value = String(proposal?.valorbruto ?? '').trim();
    const status = typeof proposal?.status === 'string' ? proposal.status.trim() : '';
    const cents = Math.round(Number(value) * 100);
    if (!/^\d+$/.test(id) || !/^\d+(\.\d{1,2})?$/.test(value) ||
        !Number.isSafeInteger(cents) || !status) {
      throw new Error('A resposta contém uma proposta inválida.');
    }
    const key = status.normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toUpperCase().replace(/\s+/g, ' ');
    unique.set(id, { stage: stageNames.get(key) ?? key, cents });
  }

  const groups = new Map();
  for (const { stage, cents } of unique.values()) {
    const group = groups.get(stage) ?? { stage, count: 0, cents: 0 };
    group.count++;
    group.cents += cents;
    groups.set(stage, group);
  }
  return [...groups.values()].sort((a, b) => b.cents - a.cents)
    .map(({ stage, count, cents }) => ({ stage, count, value: cents / 100 }));
}

let snapshot;
let syncFailed = false;
let sellerSnapshot;
let sellerSyncFailed = false;
let sellerPhotos = new Map();

async function syncSellers() {
  try {
    const { proposals, credit } = await loadSouMaisBluProposals(souMaisBluKey);
    try {
      sellerPhotos = await loadSellerPhotos(souMaisBluKey, new Set(proposals.map(row => row.seller)));
    } catch {
      console.error('Falha ao atualizar as fotos de perfil do Sou+BLU.');
    }
    sellerSnapshot = { proposals, credit, geography: geographyByStatus(proposals), updatedAt: new Date().toISOString() };
    sellerSyncFailed = false;
  } catch {
    sellerSyncFailed = true;
    console.error('Falha ao atualizar os indicadores de Compra de Dívida do Sou+BLU.');
  } finally {
    setTimeout(syncSellers, interval);
  }
}

async function sync() {
  try {
    const response = await fetch(source, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${KONSIG_API_TOKEN}` },
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    });
    if (!response.ok) {
      console.error(`Konsig retornou HTTP ${response.status}.`);
      syncFailed = true;
      return;
    }
    const stages = aggregate(await response.json());
    snapshot = { stages, updatedAt: new Date().toISOString() };
    syncFailed = false;
  } catch {
    syncFailed = true;
    console.error('Falha ao consultar a Konsig ou processar os dados da carteira.');
  } finally {
    setTimeout(sync, interval);
  }
}

createServer((request, response) => {
  const path = request.url?.split('?')[0];
  const asset = assets.get(path === '/' ? '/index.html' : path);
  if (path === '/api/soumaisblu/metas' && request.method === 'POST') {
    void saveProductionGoals(request, response, sellerSnapshot);
  } else if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end();
  } else if (asset) {
    response.writeHead(200, { 'Content-Type': asset.type }).end(asset.content);
  } else if (path === '/api/soumaisblu/mapa') {
    const state = !souMaisBluKey ? 'unconfigured' : sellerSyncFailed ? 'error' : sellerSnapshot ? 'ready' : 'pending';
    const query = new URLSearchParams(request.url.split('?')[1]);
    const status = query.get('status') ?? 'todas';
    if (!['todas', 'digitadas', 'pagas', 'canceladas'].includes(status)) {
      response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        .end(JSON.stringify({ error: 'Status de proposta inválido.' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ state, updatedAt: sellerSnapshot?.updatedAt, ...sellerSnapshot?.geography[status] }));
  } else if (path === '/api/soumaisblu/metas') {
    const seller = new URLSearchParams(request.url.split('?')[1]).get('seller') ?? '';
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(productionGoals(sellerSnapshot, sellerSyncFailed, seller)));
  } else if (path === '/api/soumaisblu/relatorios') {
    if (!sellerSnapshot) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('Relatório indisponível até a primeira sincronização do Sou+BLU.');
      return;
    }
    const query = new URLSearchParams(request.url.split('?')[1]);
    const proposals = query.get('area') === 'cp-mercantil' ? sellerSnapshot.credit : sellerSnapshot.proposals;
    const report = purchaseDebtCsv({ ...sellerSnapshot, proposals }, query);
    if (!report) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Tipo de relatório inválido.');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }).end(report.content);
  } else if (path === '/api/soumaisblu/foto-vendedor') {
    const photo = sellerPhotos.get(new URLSearchParams(request.url.split('?')[1]).get('id'));
    const cache = { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' };
    if (photo?.url) {
      response.writeHead(302, { ...cache, Location: photo.url }).end();
    } else if (photo?.bytes) {
      response.writeHead(200, { ...cache, 'Content-Type': photo.type }).end(photo.bytes);
    } else {
      response.writeHead(404).end();
    }
  } else if (path === '/api/soumaisblu/compra-divida' || path === '/api/soumaisblu/cp-mercantil') {
    const state = !souMaisBluKey ? 'unconfigured' : sellerSyncFailed ? 'error' : sellerSnapshot ? 'ready' : 'pending';
    const query = new URLSearchParams(request.url.split('?')[1]);
    const proposals = path.endsWith('/cp-mercantil') ? sellerSnapshot?.credit : sellerSnapshot?.proposals;
    const report = proposals && purchaseDebtReport(proposals, query);
    for (const seller of report?.sellers ?? []) seller.hasPhoto = sellerPhotos.has(seller.key);
    response.writeHead(sellerSyncFailed && !sellerSnapshot ? 503 : 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }).end(JSON.stringify({ state, updatedAt: sellerSnapshot?.updatedAt, ...report }));
  } else if (path === '/api/konsig/carteira') {
    const state = !source ? 'demo' : syncFailed ? 'error' : snapshot ? 'ready' : 'pending';
    response.writeHead(syncFailed && !snapshot ? 503 : 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }).end(JSON.stringify({ state, ...snapshot }));
  } else {
    response.writeHead(404).end();
  }
}).listen(Number(PORT), PANEL_HOST, function () {
  console.log(`Painel BLU em http://${PANEL_HOST}:${this.address().port}`);
  if (source) void sync();
  if (souMaisBluKey) void syncSellers();
});

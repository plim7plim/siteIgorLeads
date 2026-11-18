import { purchaseDebtReport } from './soumaisblu.mjs';

const decimal = new Intl.NumberFormat('pt-BR', {
  useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2
});
const day = value => value ? value.split('-').reverse().join('/') : '';

function cell(value) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '');
  const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/u.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

function amount(value) {
  if (value == null) return '';
  // Retorna um número localizado sem passar pelo tratamento de fórmulas de texto.
  return { numeric: decimal.format(value) };
}

export function purchaseDebtCsv(snapshot, query) {
  const kind = query.get('report');
  if (!['propostas', 'vendedores'].includes(kind)) return null;
  const filters = new URLSearchParams(query);
  filters.delete('detail');
  filters.delete('view');
  let columns;
  let rows;
  if (kind === 'propostas') {
    filters.set('view', 'proposals');
    const { items } = purchaseDebtReport(snapshot.proposals, filters);
    columns = ['Nº da proposta', 'Vendedor', 'Status', 'Cadastro', 'Digitação', 'Pagamento',
      'Paga', 'Valor original (R$)', 'Valor na produção (R$)'];
    rows = items.map(item => [
      item.number, item.seller, item.status, day(item.created), day(item.entered), day(item.paidDate),
      item.paid ? 'Sim' : 'Não', amount(item.originalValue), amount(item.value)
    ]);
  } else {
    const { sellers } = purchaseDebtReport(snapshot.proposals, filters);
    columns = ['Posição', 'Vendedor', 'Propostas', 'Produção (R$)', 'Ticket médio (R$)',
      'Participação na produção (%)', 'Propostas pagas', 'Valor pago (R$)'];
    const total = sellers.reduce((sum, seller) => sum + Math.round(seller.value * 100), 0) / 100;
    rows = sellers.map((seller, index) => [
      index + 1, seller.name, seller.count, amount(seller.value), amount(seller.value / seller.count),
      amount(total ? seller.value / total * 100 : 0), seller.paidCount, amount(seller.paidValue)
    ]);
  }
  const body = [columns, ...rows].map(row => row.map(value => value?.numeric ?? cell(value)).join(';'));
  return {
    filename: `${query.get('area') === 'cp-mercantil' ? 'cp-mercantil' : 'compra-de-divida'}-${kind}-${snapshot.updatedAt.slice(0, 10)}.csv`,
    content: '\uFEFF' + body.join('\r\n') + '\r\n'
  };
}

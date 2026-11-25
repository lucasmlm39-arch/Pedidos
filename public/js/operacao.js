// Telas de expedição, faturamento e listas de pedidos por status.
import { api, tentar, sessao, toast } from './util.js';
import { abrirPedido } from './detalhe.js';
import { listaPedidos } from './vendedor.js';

// Monta uma tela com várias seções, cada uma listando pedidos de um conjunto de status.
function telaSecoes(secoes, { topo = '', aoClicar = null } = {}) {
  return async (alvo) => {
    const carregar = async () => {
      const listas = await Promise.all(secoes.map((s) => api('GET', `/api/pedidos?status=${s.status}`)));
      alvo.innerHTML = topo + secoes.map((s, i) => `
        <section class="cartao ${s.destaque && listas[i].length ? 'destaque-' + s.destaque : ''}">
          <h3>${s.titulo} <span class="contador">${listas[i].length}</span></h3>
          ${s.dica ? `<p class="dica">${s.dica}</p>` : ''}
          ${listaPedidos(s.limite ? listas[i].slice(0, s.limite) : listas[i], { mostrarVendedor: true })}
        </section>`).join('');
    };
    alvo.onclick = (e) => {
      const b = e.target.closest('[data-pedido]');
      if (b) return abrirPedido(Number(b.dataset.pedido), carregar);
      aoClicar?.(e, carregar);
    };
    alvo.recarregar = carregar;
    await tentar(carregar);
  };
}

// Baixa o arquivo gerado pelo servidor (exportação para o Visual Software).
async function baixarExportacao(corpo) {
  const r = await fetch('/api/exportacao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.token}` },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) {
    const erro = await r.json().catch(() => ({}));
    throw new Error(erro.erro || `Erro ${r.status}`);
  }
  const nome = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'pedidos.csv';
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { nome, quantidade: Number(r.headers.get('x-quantidade-pedidos')) || 0 };
}

const TOPO_FATURAMENTO = `
  <section class="cartao destaque-info">
    <div class="cabecalho-secao"><h3>Exportar para o Visual Software</h3>
      <div class="grupo-botoes">
        <select class="input input-auto" data-formato aria-label="Formato do arquivo">
          <option value="csv">CSV (Excel / importação)</option>
          <option value="json">JSON (integração)</option>
        </select>
        <button class="btn btn-primario" data-exportar>Exportar pedidos pendentes</button>
      </div></div>
    <p class="dica">Gera um arquivo com todos os pedidos aguardando faturamento que ainda não foram exportados, para importar no Visual Software.
      Cada pedido sai uma única vez (fica marcado como "Exportado"). Itens em falta não entram no arquivo.</p>
  </section>`;

export const telaFaturamento = telaSecoes([
  { titulo: 'Aguardando faturamento', status: 'AGUARDANDO_FATURAMENTO', destaque: 'roxo' },
  { titulo: 'Faturados recentemente', status: 'FATURADO', limite: 30 },
], {
  topo: TOPO_FATURAMENTO,
  aoClicar: async (e, carregar) => {
    const b = e.target.closest('[data-exportar]');
    if (!b) return;
    b.disabled = true;
    try {
      const formato = e.currentTarget.querySelector('[data-formato]').value;
      const r = await baixarExportacao({ formato });
      toast(`${r.quantidade} pedido(s) exportado(s) em ${r.nome}`);
      carregar();
    } catch (err) {
      toast(err.message, 'erro');
    } finally {
      b.disabled = false;
    }
  },
});

export const telaAprovacoes = telaSecoes([
  { titulo: 'Preços aguardando sua aprovação', status: 'AGUARDANDO_APROVACAO', destaque: 'alerta',
    dica: 'Pedidos com itens vendidos abaixo da tabela. Abra o pedido para aprovar ou reprovar cada preço.' },
]);

export async function telaTodosPedidos(alvo) {
  let filtro = '';
  const carregar = async () => {
    const pedidos = await api('GET', `/api/pedidos${filtro ? `?status=${filtro}` : ''}`);
    const { rotulos } = await api('GET', '/api/status');
    alvo.innerHTML = `<section class="cartao">
      <div class="cabecalho-secao"><h3>Todos os pedidos</h3>
        <select class="input input-auto" data-filtro aria-label="Filtrar por status">
          <option value="">Todos os status</option>
          ${Object.entries(rotulos).map(([k, v]) => `<option value="${k}" ${k === filtro ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
      ${listaPedidos(pedidos, { mostrarVendedor: true })}</section>`;
  };
  alvo.onchange = (e) => {
    if (e.target.matches('[data-filtro]')) { filtro = e.target.value; tentar(carregar); }
  };
  alvo.onclick = (e) => {
    const b = e.target.closest('[data-pedido]');
    if (b) abrirPedido(Number(b.dataset.pedido), carregar);
  };
  alvo.recarregar = carregar;
  await tentar(carregar);
}

// Telas de expedição, faturamento e listas de pedidos por status.
import { api, tentar } from './util.js';
import { abrirPedido } from './detalhe.js';
import { listaPedidos } from './vendedor.js';

// Monta uma tela com várias seções, cada uma listando pedidos de um conjunto de status.
function telaSecoes(secoes) {
  return async (alvo) => {
    const carregar = async () => {
      const listas = await Promise.all(secoes.map((s) => api('GET', `/api/pedidos?status=${s.status}`)));
      alvo.innerHTML = secoes.map((s, i) => `
        <section class="cartao ${s.destaque && listas[i].length ? 'destaque-' + s.destaque : ''}">
          <h3>${s.titulo} <span class="contador">${listas[i].length}</span></h3>
          ${s.dica ? `<p class="dica">${s.dica}</p>` : ''}
          ${listaPedidos(s.limite ? listas[i].slice(0, s.limite) : listas[i], { mostrarVendedor: true })}
        </section>`).join('');
    };
    alvo.onclick = (e) => {
      const b = e.target.closest('[data-pedido]');
      if (b) abrirPedido(Number(b.dataset.pedido), carregar);
    };
    alvo.recarregar = carregar;
    await tentar(carregar);
  };
}

export const telaExpedicao = telaSecoes([
  { titulo: 'Novos pedidos para aceitar', status: 'AGUARDANDO_EXPEDICAO', destaque: 'info' },
  { titulo: 'Em separação / pesagem', status: 'EM_SEPARACAO', dica: 'Abra o pedido, informe o peso real dos itens pesáveis e conclua para imprimir.' },
  { titulo: 'Concluídos (aguardando faturamento)', status: 'AGUARDANDO_FATURAMENTO', limite: 30 },
]);

export const telaFaturamento = telaSecoes([
  { titulo: 'Aguardando faturamento', status: 'AGUARDANDO_FATURAMENTO', destaque: 'roxo' },
  { titulo: 'Faturados recentemente', status: 'FATURADO', limite: 30 },
]);

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

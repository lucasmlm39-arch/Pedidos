// Expedição em tablet: lista de pedidos à esquerda, pedido aberto à direita (sem janela modal).
// Em telas pequenas (celular) o pedido abre por cima da lista.
import { api, esc, moeda, dataHora, tentar, vazio } from './util.js';
import { montarDetalhe } from './detalhe.js';

const GRUPOS = [
  { status: 'AGUARDANDO_EXPEDICAO', titulo: 'Novos', classe: 'info' },
  { status: 'EM_SEPARACAO', titulo: 'Separando', classe: 'alerta' },
  { status: 'AGUARDANDO_FATURAMENTO', titulo: 'Concluídos', classe: 'roxo' },
];

export async function telaExpedicao(alvo) {
  let selecionado = null;
  let aba = 'AGUARDANDO_EXPEDICAO';
  let listas = {};

  alvo.classList.add('expedicao-tablet');
  alvo.innerHTML = `
    <aside class="exp-lista">
      <div class="exp-abas" role="tablist">${GRUPOS.map((g) => `
        <button class="exp-aba" role="tab" data-aba="${g.status}">${g.titulo} <span class="contador-aba" data-cont="${g.status}">0</span></button>`).join('')}
      </div>
      <ul class="exp-pedidos" data-lista></ul>
    </aside>
    <section class="exp-painel" data-painel>
      <div class="exp-vazio">Toque num pedido para separar e pesar.</div>
    </section>`;

  const painel = alvo.querySelector('[data-painel]');

  function renderLista() {
    alvo.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('ativo', b.dataset.aba === aba));
    for (const g of GRUPOS) alvo.querySelector(`[data-cont="${g.status}"]`).textContent = (listas[g.status] || []).length;
    const pedidos = listas[aba] || [];
    alvo.querySelector('[data-lista]').innerHTML = pedidos.length ? pedidos.map((p) => `
      <li><button class="exp-pedido ${p.id === selecionado ? 'ativo' : ''}" data-pedido="${p.id}">
        <div class="lp-topo"><strong>#${p.id}</strong><span>${dataHora(p.lancado_em || p.criado_em)}</span></div>
        <div class="exp-cliente">${esc(p.cliente_fantasia || p.cliente_nome)}</div>
        <small>${p.qtd_itens} ${p.qtd_itens === 1 ? 'item' : 'itens'} · ${esc(p.vendedor_nome)} · ${moeda(p.total_centavos)}</small>
        ${p.status === 'AGUARDANDO_FATURAMENTO' && !p.impresso_em ? '<small class="txt-alerta">Não impresso</small>' : ''}
      </button></li>`).join('') : `<li>${vazio(aba === 'AGUARDANDO_EXPEDICAO' ? 'Nenhum pedido novo' : 'Nada aqui')}</li>`;
  }

  async function carregar() {
    const r = await Promise.all(GRUPOS.map((g) => api('GET', `/api/pedidos?status=${g.status}`)));
    GRUPOS.forEach((g, i) => { listas[g.status] = g.status === 'AGUARDANDO_FATURAMENTO' ? r[i].slice(0, 40) : r[i]; });
    renderLista();
  }

  async function abrir(id) {
    selecionado = id;
    renderLista();
    alvo.classList.add('com-pedido');
    painel.innerHTML = `<button class="btn exp-voltar" data-voltar>← Voltar à lista</button><div data-detalhe class="detalhe-painel"><div class="carregando">Carregando…</div></div>`;
    await montarDetalhe(painel.querySelector('[data-detalhe]'), id, {
      aoMudar: (p) => {
        // Segue o pedido para a aba do novo status.
        if (p && GRUPOS.some((g) => g.status === p.status)) aba = p.status;
        carregar();
      },
      fechar: fecharPainel,
    });
  }

  function fecharPainel() {
    selecionado = null;
    alvo.classList.remove('com-pedido');
    painel.innerHTML = '<div class="exp-vazio">Toque num pedido para separar e pesar.</div>';
    renderLista();
  }

  alvo.onclick = (e) => {
    const a = e.target.closest('[data-aba]');
    if (a) { aba = a.dataset.aba; return renderLista(); }
    const p = e.target.closest('[data-pedido]');
    if (p) return abrir(Number(p.dataset.pedido));
    if (e.target.closest('[data-voltar]')) fecharPainel();
  };

  // Atualiza a lista quando chega notificação, sem atrapalhar quem está pesando.
  alvo.recarregar = carregar;
  await tentar(carregar);
}

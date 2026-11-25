// Detalhe do pedido (modal) com as ações permitidas para o papel do usuário.
import { api, esc, moeda, qtd, dataHora, selo, modal, tentar, sessao, numero, toast } from './util.js';

export function imprimirPedido(id) {
  const janela = window.open(`/impressao.html?id=${id}`, `impressao-${id}`, 'width=420,height=700');
  if (!janela) toast('Libere os pop-ups deste site para imprimir automaticamente', 'erro');
}

const pode = (...papeis) => sessao.usuario.papel === 'gestor' || papeis.includes(sessao.usuario.papel);

function linhaItem(p, i) {
  const pesando = p.status === 'EM_SEPARACAO' && i.pesavel && pode('expedicao');
  const abaixo = i.preco_tabela_centavos != null && i.preco_centavos < i.preco_tabela_centavos;
  const aprov = {
    pendente: '<span class="selo selo-alerta">Aguardando gestor</span>',
    aprovado: '<span class="selo selo-ok">Preço aprovado</span>',
    reprovado: `<span class="selo selo-perigo">Reprovado</span>${i.motivo_reprovacao ? ` <small>${esc(i.motivo_reprovacao)}</small>` : ''}`,
    nao_necessaria: '',
  }[i.aprovacao];
  const decidir = p.status === 'AGUARDANDO_APROVACAO' && pode() && i.aprovacao !== 'nao_necessaria'
    ? `<div class="acoes-item">
         <button class="btn btn-ok btn-peq" data-acao="aprovar-item" data-item="${i.id}">Aprovar</button>
         <button class="btn btn-perigo btn-peq" data-acao="reprovar-item" data-item="${i.id}">Reprovar</button>
       </div>` : '';
  return `<tr class="${abaixo ? 'linha-alerta' : ''}">
    <td><strong>${esc(i.descricao)}</strong><br><small>${esc(i.codigo)}${i.pesavel ? ' · pesável' : ''}</small> ${aprov}${decidir}</td>
    <td class="num">${qtd(i.quantidade, i.unidade)}${i.pesavel ? '<br><small>(estimado)</small>' : ''}</td>
    <td class="num">${pesando
      ? `<input class="input-peso" type="text" inputmode="decimal" data-peso="${i.id}" value="${i.peso_real ?? ''}" placeholder="kg" aria-label="Peso de ${esc(i.descricao)}">`
      : (i.peso_real != null ? qtd(i.peso_real, 'kg') : (i.pesavel ? '<small>a pesar</small>' : '—'))}</td>
    <td class="num">${moeda(i.preco_centavos)}${i.preco_tabela_centavos != null
      ? `<br><small class="${abaixo ? 'txt-alerta' : ''}">tabela ${moeda(i.preco_tabela_centavos)}</small>`
      : '<br><small class="txt-alerta">sem tabela</small>'}</td>
    <td class="num">${moeda(i.total_centavos)}</td>
  </tr>`;
}

function acoes(p) {
  const b = [];
  const s = p.status;
  const dono = sessao.usuario.id === p.vendedor_id;
  if (s === 'AGUARDANDO_APROVACAO' && pode()) b.push('<button class="btn btn-ok" data-acao="aprovar-todos">Aprovar todos os preços</button>');
  if (s === 'AGUARDANDO_EXPEDICAO' && pode('expedicao')) b.push('<button class="btn btn-primario" data-acao="aceitar">Aceitar pedido</button>');
  if (s === 'EM_SEPARACAO' && pode('expedicao')) b.push('<button class="btn btn-primario" data-acao="concluir">Concluir pesagem e imprimir</button>');
  if (['AGUARDANDO_EXPEDICAO', 'EM_SEPARACAO'].includes(s) && pode('expedicao')) b.push('<button class="btn" data-acao="recusar">Devolver ao vendedor</button>');
  if (['AGUARDANDO_FATURAMENTO', 'FATURADO'].includes(s) && pode('expedicao', 'faturamento')) b.push('<button class="btn" data-acao="imprimir">Imprimir</button>');
  if (s === 'AGUARDANDO_FATURAMENTO' && pode('faturamento')) b.push('<button class="btn btn-primario" data-acao="faturar">Marcar como faturado</button>');
  if (dono && ['REVISAO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_EXPEDICAO'].includes(s)) b.push('<button class="btn" data-acao="editar">Editar pedido</button>');
  const cancelavel = sessao.usuario.papel === 'gestor'
    ? !['FATURADO', 'CANCELADO'].includes(s)
    : dono && ['REVISAO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_EXPEDICAO'].includes(s);
  if (cancelavel) b.push('<button class="btn btn-perigo-txt" data-acao="cancelar">Cancelar pedido</button>');
  return b.join('');
}

function render(p) {
  return `
    <div class="detalhe-topo">
      <div><h2>Pedido #${p.id}</h2>${selo(p)}</div>
      <div class="total-grande">${moeda(p.total_centavos)}</div>
    </div>
    ${p.motivo_status && ['REVISAO', 'CANCELADO'].includes(p.status) ? `<div class="aviso aviso-perigo">${esc(p.motivo_status)}</div>` : ''}
    <dl class="dados">
      <div><dt>Cliente</dt><dd>${esc(p.cliente_fantasia || p.cliente_nome)}<br><small>${esc(p.cliente_nome)} · ${esc(p.cliente_documento || '')}</small></dd></div>
      <div><dt>Vendedor</dt><dd>${esc(p.vendedor_nome)}</dd></div>
      <div><dt>Lançado</dt><dd>${dataHora(p.criado_em)}</dd></div>
      ${p.nota_fiscal ? `<div><dt>Nota fiscal</dt><dd>${esc(p.nota_fiscal)}</dd></div>` : ''}
      ${p.impresso_em ? `<div><dt>Impresso</dt><dd>${dataHora(p.impresso_em)}</dd></div>` : ''}
    </dl>
    ${p.observacao ? `<div class="aviso"><strong>Obs.:</strong> ${esc(p.observacao)}</div>` : ''}
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Produto</th><th class="num">Qtd.</th><th class="num">Peso real</th><th class="num">Preço</th><th class="num">Total</th></tr></thead>
      <tbody>${p.itens.map((i) => linhaItem(p, i)).join('')}</tbody>
    </table></div>
    <div class="barra-acoes">${acoes(p)}</div>
    <details class="historico"><summary>Histórico (${p.historico.length})</summary>
      <ol>${p.historico.map((h) => `<li><time>${dataHora(h.criado_em)}</time> ${esc(h.descricao || h.status_novo)} <small>— ${esc(h.usuario_nome || '')}</small></li>`).join('')}</ol>
    </details>`;
}

export async function abrirPedido(id, aoMudar = () => {}) {
  const { el, fechar } = modal('<div class="carregando">Carregando…</div>', { largo: true });
  let pedido;
  const atualizar = async () => {
    pedido = await api('GET', `/api/pedidos/${id}`);
    el.innerHTML = render(pedido);
  };
  const feito = async (novo) => {
    pedido = novo;
    el.innerHTML = render(pedido);
    aoMudar();
  };
  await tentar(atualizar).catch(fechar);

  el.addEventListener('change', async (e) => {
    const campo = e.target.closest('[data-peso]');
    if (!campo || !campo.value.trim()) return;
    const peso = numero(campo.value);
    await tentar(async () => feito(await api('PUT', `/api/pedidos/${id}/itens/${campo.dataset.peso}/peso`, { peso })), 'Peso registrado')
      .catch(() => campo.focus());
  });

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-acao]');
    if (!btn) return;
    const acao = btn.dataset.acao;
    const post = (rota, corpo, msg) => tentar(async () => feito(await api('POST', `/api/pedidos/${id}/${rota}`, corpo)), msg);
    const pendentes = pedido.itens.filter((i) => i.aprovacao !== 'nao_necessaria');
    btn.disabled = true;
    try {
      if (acao === 'aprovar-item') await post('aprovacao', { decisoes: [{ item_id: Number(btn.dataset.item), aprovado: true }] }, 'Preço aprovado');
      if (acao === 'reprovar-item') {
        const motivo = prompt('Motivo da reprovação (o vendedor verá esta mensagem):');
        if (motivo !== null) await post('aprovacao', { decisoes: [{ item_id: Number(btn.dataset.item), aprovado: false, motivo }] }, 'Preço reprovado');
      }
      if (acao === 'aprovar-todos') await post('aprovacao', { decisoes: pendentes.map((i) => ({ item_id: i.id, aprovado: true })) }, 'Preços aprovados');
      if (acao === 'aceitar') await post('aceitar', undefined, 'Pedido aceito');
      if (acao === 'recusar') {
        const motivo = prompt('Motivo para devolver ao vendedor (ex.: falta de estoque):');
        if (motivo) await post('recusar', { motivo }, 'Pedido devolvido ao vendedor');
      }
      if (acao === 'concluir') {
        await post('concluir', undefined, 'Pesagem concluída. Enviado ao faturamento');
        imprimirPedido(id);
      }
      if (acao === 'imprimir') imprimirPedido(id);
      if (acao === 'faturar') {
        const nf = prompt('Número da nota fiscal (opcional):', '');
        if (nf !== null) await post('faturar', { nota_fiscal: nf.trim() || undefined }, 'Pedido faturado');
      }
      if (acao === 'cancelar') {
        const motivo = prompt('Motivo do cancelamento:');
        if (motivo !== null) await post('cancelar', { motivo }, 'Pedido cancelado');
      }
      if (acao === 'editar') {
        fechar();
        const { editarPedido } = await import('./vendedor.js');
        editarPedido(pedido, aoMudar);
      }
    } catch { /* erro já exibido */ } finally {
      btn.disabled = false;
    }
  });
}

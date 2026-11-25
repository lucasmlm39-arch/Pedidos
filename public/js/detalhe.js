// Detalhe do pedido com as ações permitidas para o papel do usuário (em janela modal ou painel da expedição).
import { api, esc, moeda, qtd, dataHora, selo, modal, tentar, sessao, numero, toast } from './util.js';

export function imprimirPedido(id) {
  const janela = window.open(`/impressao.html?id=${id}`, `impressao-${id}`, 'width=420,height=700');
  if (!janela) toast('Libere os pop-ups deste site para imprimir automaticamente', 'erro');
}

const pode = (...papeis) => sessao.usuario.papel === 'gestor' || papeis.includes(sessao.usuario.papel);

const fracionado = (i) => Boolean(i.pesavel) || String(i.unidade).toUpperCase() === 'KG';
const num = (v) => String(v).replace('.', ',');
const kg = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

// Aceita soma de pesagens: "12,5 + 10,9" (várias pesadas do mesmo item).
export function somarPesagens(texto) {
  const partes = String(texto || '').split('+').map((t) => t.trim()).filter(Boolean);
  if (!partes.length) return null;
  // "1.234,5" ou "23,4" (vírgula decimal) e também "23.4" (teclado com ponto).
  const valor = (t) => Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  const total = partes.reduce((s, t) => s + valor(t), 0);
  return Number.isFinite(total) ? Math.round(total * 1000) / 1000 : NaN;
}

const taraDo = (i) => i.tara_kg ?? i.tara_produto_kg ?? 0;
const caixasPadrao = (i) => i.caixas ?? (i.unidade_pedido === 'CX' ? i.quantidade : '');

// Pesáveis: peso bruto da balança - caixas x tara = líquido cobrado.
function campoPesagem(i) {
  const falta = i.peso_real === 0;
  const bruto = i.peso_bruto ?? (i.peso_real > 0 ? i.peso_real : null);
  return `<div class="pesagem" data-pesagem="${i.id}" data-tara="${taraDo(i)}">
    <label class="pesagem-campo">Caixas
      <span><input class="input-peso input-caixas" type="text" inputmode="numeric" data-caixas value="${esc(caixasPadrao(i))}" placeholder="0"
        aria-label="Caixas de ${esc(i.descricao)}"> × ${kg(taraDo(i))} kg</span></label>
    <label class="pesagem-campo">Peso bruto
      <span><input class="input-peso ${i.peso_real != null ? 'preenchido' : 'obrigatorio'}" type="text" inputmode="decimal"
        data-bruto value="${bruto != null ? num(bruto) : ''}" placeholder="balança" aria-label="Peso bruto de ${esc(i.descricao)}"> kg</span></label>
    <div class="pesagem-liquido">Líquido <strong data-liquido>${i.peso_real != null ? `${kg(i.peso_real)} kg` : '—'}</strong></div>
    <button class="btn btn-peq ${falta ? 'btn-perigo' : ''}" data-falta="${i.id}" title="Item em falta">Falta</button>
  </div>`;
}

function campoSeparacao(i) {
  if (i.pesavel) return campoPesagem(i);
  const falta = i.peso_real === 0;
  return `<div class="campo-separacao">
    <input class="input-peso ${i.peso_real != null ? 'preenchido' : ''}"
      type="text" inputmode="${fracionado(i) ? 'decimal' : 'numeric'}" data-peso="${i.id}"
      value="${i.peso_real != null ? num(i.peso_real) : ''}"
      placeholder="${num(i.quantidade)}"
      aria-label="Quantidade atendida de ${esc(i.descricao)}">
    <span class="un-peso">${esc(i.unidade)}</span>
    <button class="btn btn-peq ${falta ? 'btn-perigo' : ''}" data-falta="${i.id}" title="Item em falta">Falta</button>
  </div>`;
}

function valorSeparado(i) {
  if (i.peso_real === 0) return '<span class="selo selo-perigo">Em falta</span>';
  if (i.peso_real != null) {
    const detalhe = i.peso_bruto != null && i.caixas
      ? `<br><small>bruto ${kg(i.peso_bruto)} − ${i.caixas} cx × ${kg(i.tara_kg)} kg</small>` : '';
    return qtd(i.peso_real, i.pesavel ? 'kg' : i.unidade) + detalhe;
  }
  return i.pesavel ? '<small>a pesar</small>' : '—';
}

function colunaQtd(i) {
  if (i.unidade_pedido) {
    return `${qtd(i.quantidade, i.unidade_pedido)}<br><small>${i.peso_estimado_kg ? `≈ ${kg(i.peso_estimado_kg)} kg` : 'cobrado por kg'}</small>`;
  }
  return `${qtd(i.quantidade, i.unidade)}${i.pesavel ? '<br><small>(estimado)</small>' : ''}`;
}

// Item já conferido (OK): mostra o resultado travado e o botão para desfazer.
function itemConferido(i) {
  const falta = i.peso_real === 0;
  return `<div class="conferido">
    <div class="conferido-valor">${i.peso_real == null ? qtd(i.quantidade, i.unidade) : valorSeparado(i)}</div>
    <span class="selo ${falta ? 'selo-perigo' : 'selo-ok'} selo-ok-grande">${falta ? 'Falta' : '✓ OK'}</span>
    <button class="btn btn-peq" ${falta ? `data-falta="${i.id}"` : `data-desfazer="${i.id}"`}>Desfazer</button>
  </div>`;
}

const botaoOk = (i) => `<button class="btn btn-ok btn-ok-item" data-ok="${i.id}" aria-label="OK: ${esc(i.descricao)} separado">OK</button>`;

function linhaItem(p, i) {
  const separando = p.status === 'EM_SEPARACAO' && pode('expedicao');
  const conferido = Boolean(i.separado_em);
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
  const classe = separando && conferido ? 'item-ok' : (abaixo ? 'linha-alerta' : '');
  const separacao = !separando ? valorSeparado(i)
    : conferido ? itemConferido(i)
      : `<div class="separar">${campoSeparacao(i)}${botaoOk(i)}</div>`;
  return `<tr class="${classe}" data-linha-item="${i.id}">
    <td><strong>${esc(i.descricao)}</strong><br><small>${esc(i.codigo)}${i.pesavel ? ' · pesável' : ''}</small> ${aprov}${decidir}</td>
    <td class="num">${colunaQtd(i)}</td>
    <td class="num">${separacao}</td>
    <td class="num">${moeda(i.preco_centavos)}${i.pesavel ? '<small>/kg</small>' : ''}${i.preco_tabela_centavos != null
      ? `<br><small class="${abaixo ? 'txt-alerta' : ''}">tabela ${moeda(i.preco_tabela_centavos)}</small>`
      : '<br><small class="txt-alerta">sem tabela</small>'}</td>
    <td class="num">${moeda(i.total_centavos)}</td>
  </tr>`;
}

function progresso(p) {
  if (p.status !== 'EM_SEPARACAO') return '';
  const total = p.itens.length;
  const ok = p.itens.filter((i) => i.separado_em).length;
  return `<div class="progresso-separacao" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${ok}" aria-label="Itens separados">
    <div class="ps-texto"><strong>${ok} de ${total}</strong> itens separados</div>
    <div class="ps-barra"><span style="width:${total ? Math.round((ok / total) * 100) : 0}%"></span></div>
  </div>`;
}

function acoes(p) {
  const b = [];
  const s = p.status;
  const dono = sessao.usuario.id === p.vendedor_id;
  if (s === 'AGUARDANDO_APROVACAO' && pode()) b.push('<button class="btn btn-ok" data-acao="aprovar-todos">Aprovar todos os preços</button>');
  if (s === 'AGUARDANDO_EXPEDICAO' && pode('expedicao')) b.push('<button class="btn btn-primario" data-acao="aceitar">Aceitar pedido</button>');
  if (s === 'EM_SEPARACAO' && pode('expedicao')) {
    const faltam = p.itens.filter((i) => !i.separado_em).length;
    b.push(`<button class="btn btn-primario" data-acao="concluir" ${faltam ? 'aria-disabled="true"' : ''}>${faltam ? `Concluir (faltam ${faltam})` : 'Concluir e imprimir'}</button>`);
  }
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
    ${progresso(p)}
    <dl class="dados">
      <div><dt>Cliente</dt><dd>${esc(p.cliente_fantasia || p.cliente_nome)}<br><small>${esc(p.cliente_nome)} · ${esc(p.cliente_documento || '')}</small></dd></div>
      <div><dt>Vendedor</dt><dd>${esc(p.vendedor_nome)}</dd></div>
      <div><dt>Lançado</dt><dd>${dataHora(p.criado_em)}</dd></div>
      ${p.nota_fiscal ? `<div><dt>Nota fiscal</dt><dd>${esc(p.nota_fiscal)}</dd></div>` : ''}
      ${p.impresso_em ? `<div><dt>Impresso</dt><dd>${dataHora(p.impresso_em)}</dd></div>` : ''}
    </dl>
    ${p.observacao ? `<div class="aviso"><strong>Obs.:</strong> ${esc(p.observacao)}</div>` : ''}
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Produto</th><th class="num">Qtd.</th><th class="num">${p.status === 'EM_SEPARACAO' ? 'Peso / qtd. atendida' : 'Peso / atendido'}</th><th class="num">Preço</th><th class="num">Total</th></tr></thead>
      <tbody>${p.itens.map((i) => linhaItem(p, i)).join('')}</tbody>
    </table></div>
    ${p.status === 'EM_SEPARACAO' && pode('expedicao') ? '<p class="dica">Separou um produto? Toque em <strong>OK</strong> na linha dele. Pode sair e voltar ao pedido: os itens com OK ficam marcados. Pesáveis: informe <strong>caixas</strong> e <strong>peso bruto</strong> (várias pesadas: 12,5+10,9) antes do OK. Demais itens: OK direto se saiu tudo, ou digite a quantidade se foi parcial. <strong>Falta</strong> já conta como resolvido.</p>' : ''}
    <div class="barra-acoes">${acoes(p)}</div>
    <details class="historico"><summary>Histórico (${p.historico.length})</summary>
      <ol>${p.historico.map((h) => `<li><time>${dataHora(h.criado_em)}</time> ${esc(h.descricao || h.status_novo)} <small>— ${esc(h.usuario_nome || '')}</small></li>`).join('')}</ol>
    </details>`;
}

export async function abrirPedido(id, aoMudar = () => {}) {
  const { el, fechar } = modal('<div class="carregando">Carregando…</div>', { largo: true });
  await montarDetalhe(el, id, { aoMudar, fechar });
}

// Renderiza o pedido dentro de "el" e liga as ações. Retorna função para recarregar.
export async function montarDetalhe(el, id, { aoMudar = () => {}, fechar = () => {} } = {}) {
  let pedido;
  const atualizar = async () => {
    pedido = await api('GET', `/api/pedidos/${id}`);
    el.innerHTML = render(pedido);
  };
  const feito = async (novo) => {
    pedido = novo;
    el.innerHTML = render(pedido);
    aoMudar(pedido);
  };
  await tentar(atualizar).catch(fechar);

  // Prévia do líquido enquanto digita.
  el.addEventListener('input', (e) => {
    const bloco = e.target.closest('[data-pesagem]');
    if (!bloco) return;
    const bruto = somarPesagens(bloco.querySelector('[data-bruto]').value);
    const caixas = Number(bloco.querySelector('[data-caixas]').value || 0);
    const liquido = bruto == null || Number.isNaN(bruto) ? null : Math.round((bruto - caixas * Number(bloco.dataset.tara)) * 1000) / 1000;
    const alvo = bloco.querySelector('[data-liquido]');
    alvo.textContent = liquido == null ? '—' : `${kg(liquido)} kg`;
    alvo.classList.toggle('txt-perigo', liquido != null && !(liquido > 0));
  });

  let salvando = Promise.resolve();
  const salvarItem = (itemId, corpo, campo) => (salvando = salvarItemAgora(itemId, corpo, campo));
  const salvarItemAgora = async (itemId, corpo, campo) => {
    const ordem = [...el.querySelectorAll('[data-bruto], [data-peso]')];
    const pos = ordem.indexOf(campo);
    try {
      await tentar(async () => feito(await api('PUT', `/api/pedidos/${id}/itens/${itemId}/peso`, corpo)));
      // Vai direto para o próximo item pesável ainda sem peso (agiliza no tablet).
      const novos = [...el.querySelectorAll('[data-bruto], [data-peso]')];
      novos.slice(pos + 1).find((c) => c.classList.contains('obrigatorio'))?.focus();
    } catch { /* erro já exibido */ }
  };

  el.addEventListener('change', async (e) => {
    const bloco = e.target.closest('[data-pesagem]');
    if (bloco) {
      const textoBruto = bloco.querySelector('[data-bruto]').value.trim();
      const caixasTxt = bloco.querySelector('[data-caixas]').value.trim();
      if (!textoBruto) {
        if (e.target.matches('[data-bruto]')) await salvarItem(bloco.dataset.pesagem, { peso: null }, e.target);
        return;
      }
      const bruto = somarPesagens(textoBruto);
      if (Number.isNaN(bruto)) return toast('Peso bruto inválido', 'erro');
      await salvarItem(bloco.dataset.pesagem, { peso_bruto: bruto, caixas: caixasTxt === '' ? 0 : Number(caixasTxt) }, bloco.querySelector('[data-bruto]'));
      return;
    }
    const campo = e.target.closest('[data-peso]');
    if (!campo) return;
    const peso = campo.value.trim() === '' ? null : numero(campo.value);
    await salvarItem(campo.dataset.peso, { peso }, campo);
  });

  el.addEventListener('click', async (e) => {
    const okBtn = e.target.closest('[data-ok], [data-desfazer]');
    if (okBtn) {
      await salvando; // espera o peso/quantidade digitados serem gravados antes do OK
      const separado = 'ok' in okBtn.dataset;
      const itemId = okBtn.dataset.ok || okBtn.dataset.desfazer;
      okBtn.disabled = true;
      try {
        await tentar(async () => feito(await api('PUT', `/api/pedidos/${id}/itens/${itemId}/separado`, { separado })));
        if (separado) {
          // Leva ao próximo item ainda sem OK.
          const proxima = el.querySelector('tr[data-linha-item]:not(.item-ok)');
          proxima?.querySelector('[data-bruto], [data-peso], [data-ok]')?.focus();
          proxima?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      } catch { okBtn.disabled = false; }
      return;
    }
    const falta = e.target.closest('[data-falta]');
    if (falta) {
      const item = pedido.itens.find((i) => i.id === Number(falta.dataset.falta));
      const valor = item.peso_real === 0 ? null : 0; // toque de novo desfaz
      await tentar(async () => feito(await api('PUT', `/api/pedidos/${id}/itens/${item.id}/peso`, { peso: valor }))).catch(() => {});
      return;
    }
    const btn = e.target.closest('[data-acao]');
    if (!btn) return;
    const acao = btn.dataset.acao;
    if (!acao) return;
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
  return atualizar;
}

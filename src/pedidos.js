// Regras de negócio do pedido e seu fluxo de status.
const { transacao } = require('./db');
const { precosDoCliente } = require('./precos');

const STATUS = {
  AGUARDANDO_APROVACAO: 'AGUARDANDO_APROVACAO',     // tem item abaixo da tabela: gestor precisa aprovar
  REVISAO: 'REVISAO',                               // preço reprovado ou recusado pela expedição: vendedor ajusta
  AGUARDANDO_EXPEDICAO: 'AGUARDANDO_EXPEDICAO',     // liberado, esperando a expedição aceitar
  EM_SEPARACAO: 'EM_SEPARACAO',                     // expedição aceitou, separando e pesando
  AGUARDANDO_FATURAMENTO: 'AGUARDANDO_FATURAMENTO', // pesado/separado, impresso e enviado ao faturamento
  FATURADO: 'FATURADO',
  CANCELADO: 'CANCELADO',
};

const ROTULOS = {
  AGUARDANDO_APROVACAO: 'Aguardando aprovação de preço',
  REVISAO: 'Em revisão (vendedor)',
  AGUARDANDO_EXPEDICAO: 'Aguardando expedição',
  EM_SEPARACAO: 'Em separação / pesagem',
  AGUARDANDO_FATURAMENTO: 'Aguardando faturamento',
  FATURADO: 'Faturado',
  CANCELADO: 'Cancelado',
};

class ErroNegocio extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

const agora = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Produtos pesáveis ou vendidos em KG aceitam quantidade fracionada (ex.: 2,5 kg).
const aceitaFracao = (p) => Boolean(p.pesavel) || String(p.unidade).toUpperCase() === 'KG';
// Produto pesável pedido em outra unidade (UN, CX…) e cobrado por kg.
const pedidoEmUnidade = (p) => Boolean(p.pesavel && p.unidade_pedido && p.unidade_pedido.toUpperCase() !== 'KG');

// Quantidade que é cobrada: peso/qtd. registrada pela expedição; antes disso, a estimativa.
function quantidadeFinal(item) {
  if (item.peso_real != null) return item.peso_real;
  if (item.unidade_pedido) return item.peso_estimado_kg ?? 0;
  return item.quantidade;
}

const arred3 = (n) => Math.round(n * 1000) / 1000;

function calcularTotal(itens) {
  return itens.reduce((s, i) => s + Math.round(quantidadeFinal(i) * i.preco_centavos), 0);
}

function registrarHistorico(db, pedidoId, usuarioId, anterior, novo, descricao) {
  db.prepare(`INSERT INTO pedido_historico (pedido_id, usuario_id, status_anterior, status_novo, descricao)
              VALUES (?, ?, ?, ?, ?)`).run(pedidoId, usuarioId, anterior, novo, descricao || null);
}

function mudarStatus(db, pedido, usuario, novo, descricao, extras = {}) {
  const campos = { status: novo, atualizado_em: agora(), ...extras };
  const sets = Object.keys(campos).map((k) => `${k} = :${k}`).join(', ');
  db.prepare(`UPDATE pedidos SET ${sets} WHERE id = :id`).run({ ...campos, id: pedido.id });
  registrarHistorico(db, pedido.id, usuario.id, pedido.status, novo, descricao);
}

function buscarPedidoBruto(db, id) {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!p) throw new ErroNegocio('Pedido não encontrado', 404);
  return p;
}

function exigirStatus(pedido, ...permitidos) {
  if (!permitidos.includes(pedido.status)) {
    throw new ErroNegocio(`Ação não permitida: pedido está "${ROTULOS[pedido.status]}"`, 409);
  }
}

// Valida os itens enviados pelo vendedor e compara com a tabela de preço do cliente.
function montarItens(db, clienteId, itens) {
  if (!Array.isArray(itens) || itens.length === 0) throw new ErroNegocio('Informe ao menos um item');
  const precos = precosDoCliente(db, clienteId);
  const vistos = new Set();
  return itens.map((i, idx) => {
    const produtoId = Number(i.produto_id);
    const produto = precos.get(produtoId);
    if (!produto) throw new ErroNegocio(`Item ${idx + 1}: produto inválido ou inativo`);
    if (vistos.has(produtoId)) throw new ErroNegocio(`Produto "${produto.descricao}" repetido no pedido`);
    vistos.add(produtoId);
    const quantidade = Number(i.quantidade);
    if (!(quantidade > 0)) throw new ErroNegocio(`Quantidade inválida para "${produto.descricao}"`);
    const emUnidade = pedidoEmUnidade(produto);
    if ((emUnidade || !aceitaFracao(produto)) && !Number.isInteger(quantidade)) {
      throw new ErroNegocio(`"${produto.descricao}" é pedido em ${emUnidade ? produto.unidade_pedido : produto.unidade}: use quantidade inteira`);
    }
    const tabela = produto.preco_centavos ?? null;
    const preco = i.preco_centavos == null ? tabela : Math.round(Number(i.preco_centavos));
    if (!(preco > 0)) throw new ErroNegocio(`Informe o preço de "${produto.descricao}" (sem preço de tabela)`);
    const precisaAprovar = tabela == null || preco < tabela;
    return {
      produto_id: produtoId,
      quantidade,
      preco_centavos: preco,
      preco_tabela_centavos: tabela,
      tabela_id: produto.tabela_id ?? null,
      aprovacao: precisaAprovar ? 'pendente' : 'nao_necessaria',
      peso_real: null,
      unidade_pedido: emUnidade ? produto.unidade_pedido.toUpperCase() : null,
      peso_estimado_kg: emUnidade && produto.peso_medio_kg ? arred3(quantidade * produto.peso_medio_kg) : null,
    };
  });
}

function gravarItens(db, pedidoId, itens) {
  db.prepare('DELETE FROM pedido_itens WHERE pedido_id = ?').run(pedidoId);
  const ins = db.prepare(`INSERT INTO pedido_itens
    (pedido_id, produto_id, quantidade, preco_centavos, preco_tabela_centavos, tabela_id, aprovacao, unidade_pedido, peso_estimado_kg)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const i of itens) {
    ins.run(pedidoId, i.produto_id, i.quantidade, i.preco_centavos, i.preco_tabela_centavos, i.tabela_id, i.aprovacao,
      i.unidade_pedido, i.peso_estimado_kg);
  }
}

function validarCliente(db, clienteId) {
  const c = db.prepare('SELECT id, ativo FROM clientes WHERE id = ?').get(Number(clienteId));
  if (!c || !c.ativo) throw new ErroNegocio('Cliente inválido ou inativo');
  return c.id;
}

function avisarPorStatus(ev, pedido) {
  const resumo = { id: pedido.id, status: pedido.status, rotulo: ROTULOS[pedido.status] };
  const destinos = {
    AGUARDANDO_APROVACAO: { papeis: ['gestor'] },
    REVISAO: { usuarioIds: [pedido.vendedor_id] },
    AGUARDANDO_EXPEDICAO: { papeis: ['expedicao'], usuarioIds: [pedido.vendedor_id] },
    EM_SEPARACAO: { papeis: ['expedicao'], usuarioIds: [pedido.vendedor_id] },
    AGUARDANDO_FATURAMENTO: { papeis: ['faturamento', 'expedicao'], usuarioIds: [pedido.vendedor_id] },
    FATURADO: { papeis: ['faturamento'], usuarioIds: [pedido.vendedor_id] },
    CANCELADO: { papeis: ['expedicao'], usuarioIds: [pedido.vendedor_id] },
  };
  ev?.emitir('pedido', resumo, destinos[pedido.status] || {});
}

// ---------- Ações ----------

const UUID_OK = /^[0-9a-zA-Z-]{8,64}$/;

function dataLancamento(v) {
  if (!v) return agora();
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 5 * 60000) return agora();
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function criarPedido(db, ev, usuario, dados) {
  // Pedido vindo do modo offline pode ser reenviado: o uuid garante que não duplica.
  if (dados.uuid != null && !UUID_OK.test(String(dados.uuid))) throw new ErroNegocio('Identificador do pedido inválido');
  if (dados.uuid) {
    const existente = db.prepare('SELECT id, vendedor_id FROM pedidos WHERE uuid = ?').get(String(dados.uuid));
    if (existente) {
      if (existente.vendedor_id !== usuario.id) throw new ErroNegocio('Identificador do pedido já utilizado', 409);
      return { ...obterPedido(db, existente.id), ja_existia: true };
    }
  }
  const id = transacao(db, () => {
    const clienteId = validarCliente(db, dados.cliente_id);
    const itens = montarItens(db, clienteId, dados.itens);
    const status = itens.some((i) => i.aprovacao === 'pendente')
      ? STATUS.AGUARDANDO_APROVACAO
      : STATUS.AGUARDANDO_EXPEDICAO;
    const r = db.prepare(`INSERT INTO pedidos (cliente_id, vendedor_id, status, observacao, total_centavos, uuid, lancado_em)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(clienteId, usuario.id, status, dados.observacao || null, calcularTotal(itens),
        dados.uuid ? String(dados.uuid) : null, dataLancamento(dados.lancado_em));
    const pid = Number(r.lastInsertRowid);
    gravarItens(db, pid, itens);
    registrarHistorico(db, pid, usuario.id, null, status,
      dados.uuid && dados.lancado_em ? `Pedido lançado (feito no aparelho em ${dataLancamento(dados.lancado_em)} UTC)` : 'Pedido lançado');
    return pid;
  });
  const pedido = obterPedido(db, id);
  avisarPorStatus(ev, pedido);
  return pedido;
}

function revisarPedido(db, ev, usuario, id, dados) {
  transacao(db, () => {
    const p = buscarPedidoBruto(db, id);
    if (usuario.papel === 'vendedor' && p.vendedor_id !== usuario.id) throw new ErroNegocio('Pedido de outro vendedor', 403);
    exigirStatus(p, STATUS.REVISAO, STATUS.AGUARDANDO_APROVACAO, STATUS.AGUARDANDO_EXPEDICAO);
    const clienteId = validarCliente(db, dados.cliente_id ?? p.cliente_id);
    const itens = montarItens(db, clienteId, dados.itens);
    const novo = itens.some((i) => i.aprovacao === 'pendente') ? STATUS.AGUARDANDO_APROVACAO : STATUS.AGUARDANDO_EXPEDICAO;
    db.prepare('UPDATE pedidos SET cliente_id = ?, observacao = ?, total_centavos = ? WHERE id = ?')
      .run(clienteId, dados.observacao ?? p.observacao, calcularTotal(itens), p.id);
    gravarItens(db, p.id, itens);
    mudarStatus(db, p, usuario, novo, 'Pedido alterado pelo vendedor', { motivo_status: null });
  });
  const pedido = obterPedido(db, id);
  avisarPorStatus(ev, pedido);
  return pedido;
}

// decisoes: [{ item_id, aprovado: boolean, motivo? }]
function decidirPrecos(db, ev, usuario, id, decisoes) {
  transacao(db, () => {
    const p = buscarPedidoBruto(db, id);
    exigirStatus(p, STATUS.AGUARDANDO_APROVACAO);
    if (!Array.isArray(decisoes) || decisoes.length === 0) throw new ErroNegocio('Nenhuma decisão informada');
    const upd = db.prepare(`UPDATE pedido_itens SET aprovacao = ?, aprovado_por = ?, aprovado_em = ?, motivo_reprovacao = ?
                            WHERE id = ? AND pedido_id = ? AND aprovacao IN ('pendente','aprovado','reprovado')`);
    for (const d of decisoes) {
      const r = upd.run(d.aprovado ? 'aprovado' : 'reprovado', usuario.id, agora(), d.aprovado ? null : (d.motivo || null), Number(d.item_id), p.id);
      if (r.changes === 0) throw new ErroNegocio(`Item ${d.item_id} não precisa de aprovação neste pedido`);
    }
    const itens = db.prepare('SELECT aprovacao, motivo_reprovacao FROM pedido_itens WHERE pedido_id = ?').all(p.id);
    if (itens.some((i) => i.aprovacao === 'pendente')) return; // ainda faltam itens
    const reprovados = itens.filter((i) => i.aprovacao === 'reprovado');
    if (reprovados.length) {
      const motivo = reprovados.map((i) => i.motivo_reprovacao).filter(Boolean).join('; ') || 'Preço reprovado pelo gestor';
      mudarStatus(db, p, usuario, STATUS.REVISAO, `Preço reprovado: ${motivo}`, { motivo_status: motivo });
    } else {
      mudarStatus(db, p, usuario, STATUS.AGUARDANDO_EXPEDICAO, 'Preços aprovados pelo gestor');
    }
  });
  const pedido = obterPedido(db, id);
  avisarPorStatus(ev, pedido);
  return pedido;
}

function aceitarExpedicao(db, ev, usuario, id) {
  transacao(db, () => {
    const p = buscarPedidoBruto(db, id);
    exigirStatus(p, STATUS.AGUARDANDO_EXPEDICAO);
    mudarStatus(db, p, usuario, STATUS.EM_SEPARACAO, 'Pedido aceito pela expedição');
  });
  const pedido = obterPedido(db, id);
  avisarPorStatus(ev, pedido);
  return pedido;
}

function recusarExpedicao(db, ev, usuario, id, motivo) {
  if (!motivo || !String(motivo).trim()) throw new ErroNegocio('Informe o motivo da recusa');
  transacao(db, () => {
    const p = buscarPedidoBruto(db, id);
    exigirStatus(p, STATUS.AGUARDANDO_EXPEDICAO, STATUS.EM_SEPARACAO);
    db.prepare(`UPDATE pedido_itens SET peso_real = NULL, peso_bruto = NULL, caixas = NULL, tara_kg = NULL,
                separado_em = NULL, separado_por = NULL WHERE pedido_id = ?`).run(p.id);
    mudarStatus(db, p, usuario, STATUS.REVISAO, `Recusado pela expedição: ${motivo}`, { motivo_status: String(motivo) });
  });
  const pedido = obterPedido(db, id);
  avisarPorStatus(ev, pedido);
  return pedido;
}

// Expedição registra o item:
//  - pesáveis: { peso_bruto, caixas } -> líquido = bruto - caixas x tara do produto (ou { peso } já líquido)
//  - demais:   { peso } = quantidade atendida
//  0 = item em falta; null/'' limpa o registro.
function registrarPeso(db, ev, usuario, id, itemId, dados) {
  const d = typeof dados === 'object' && dados !== null ? dados : { peso: dados };
  const temBruto = d.peso_bruto != null && d.peso_bruto !== '';
  const limpar = !temBruto && (d.peso === null || d.peso === '' || d.peso === undefined);
  transacao(db, () => {
    const p = buscarPedidoBruto(db, id);
    exigirStatus(p, STATUS.EM_SEPARACAO);
    const item = db.prepare(`SELECT i.id, i.separado_em, i.peso_real, pr.pesavel, pr.unidade, pr.tara_kg
                             FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id
                             WHERE i.id = ? AND i.pedido_id = ?`).get(Number(itemId), p.id);
    if (!item) throw new ErroNegocio('Item não encontrado', 404);
    if (item.separado_em && item.peso_real !== 0) throw new ErroNegocio('Item já conferido (OK). Toque em "Desfazer" para alterar.', 409);
    let liquido = null;
    let bruto = null;
    let caixas = null;
    let tara = null;
    if (temBruto) {
      if (!item.pesavel) throw new ErroNegocio('Peso bruto só se aplica a produtos pesáveis');
      bruto = Number(d.peso_bruto);
      caixas = d.caixas == null || d.caixas === '' ? 0 : Number(d.caixas);
      tara = Number(d.tara_kg ?? item.tara_kg ?? 0);
      if (!(bruto > 0)) throw new ErroNegocio('Peso bruto inválido');
      if (!(caixas >= 0) || !Number.isInteger(caixas)) throw new ErroNegocio('Número de caixas inválido');
      if (!(tara >= 0)) throw new ErroNegocio('Tara inválida');
      liquido = arred3(bruto - caixas * tara);
      if (!(liquido > 0)) throw new ErroNegocio(`Peso líquido ficou ${liquido} kg: confira o peso bruto e o número de caixas`);
      bruto = arred3(bruto);
    } else if (!limpar) {
      liquido = Number(d.peso);
      if (!(liquido >= 0)) throw new ErroNegocio('Valor inválido');
      if (!aceitaFracao(item) && !Number.isInteger(liquido)) throw new ErroNegocio(`Quantidade em ${item.unidade} deve ser inteira`);
      liquido = arred3(liquido);
    }
    // "Falta" (0) já conta como item resolvido; tirar a falta volta a ficar pendente.
    const separado = liquido === 0 ? agora() : null;
    db.prepare('UPDATE pedido_itens SET peso_real = ?, peso_bruto = ?, caixas = ?, tara_kg = ?, separado_em = ?, separado_por = ? WHERE id = ?')
      .run(liquido, bruto, caixas, tara, separado, separado ? usuario.id : null, item.id);
    const itens = db.prepare('SELECT quantidade, peso_real, preco_centavos, unidade_pedido, peso_estimado_kg FROM pedido_itens WHERE pedido_id = ?').all(p.id);
    db.prepare('UPDATE pedidos SET total_centavos = ?, atualizado_em = ? WHERE id = ?').run(calcularTotal(itens), agora(), p.id);
  });
  const pedido = obterPedido(db, id);
  ev?.emitir('pedido', { id: pedido.id, status: pedido.status, rotulo: ROTULOS[pedido.status] }, { papeis: ['expedicao'] });
  return pedido;
}

// Expedição dá OK (ou desfaz) num item: permite separar um produto por vez, sair e voltar ao pedido.
function marcarSeparado(db, ev, usuario, id, itemId, separado) {
  transacao(db, () => {
    const p = buscarPedidoBruto(db, id);
    exigirStatus(p, STATUS.EM_SEPARACAO);
    const item = db.prepare(`SELECT i.id, i.peso_real, pr.pesavel, pr.descricao FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id
                             WHERE i.id = ? AND i.pedido_id = ?`).get(Number(itemId), p.id);
    if (!item) throw new ErroNegocio('Item não encontrado', 404);
    if (separado && item.pesavel && item.peso_real == null) throw new ErroNegocio(`Pese "${item.descricao}" antes de dar OK`);
    db.prepare('UPDATE pedido_itens SET separado_em = ?, separado_por = ? WHERE id = ?')
      .run(separado ? agora() : null, separado ? usuario.id : null, item.id);
    db.prepare('UPDATE pedidos SET atualizado_em = ? WHERE id = ?').run(agora(), p.id);
  });
  const pedido = obterPedido(db, id);
  ev?.emitir('pedido', { id: pedido.id, status: pedido.status, rotulo: ROTULOS[pedido.status] }, { papeis: ['expedicao'] });
  return pedido;
}

function concluirSeparacao(db, ev, usuario, id) {
  transacao(db, () => {
    const p = buscarPedidoBruto(db, id);
    exigirStatus(p, STATUS.EM_SEPARACAO);
    const faltando = db.prepare(`SELECT pr.descricao FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id
                                 WHERE i.pedido_id = ? AND pr.pesavel = 1 AND i.peso_real IS NULL`).all(p.id);
    if (faltando.length) throw new ErroNegocio(`Falta pesar: ${faltando.map((f) => f.descricao).join(', ')}`);
    const semOk = db.prepare(`SELECT pr.descricao FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id
                              WHERE i.pedido_id = ? AND i.separado_em IS NULL`).all(p.id);
    if (semOk.length) throw new ErroNegocio(`Falta dar OK em: ${semOk.map((f) => f.descricao).join(', ')}`);
    mudarStatus(db, p, usuario, STATUS.AGUARDANDO_FATURAMENTO, 'Separação/pesagem concluída. Enviado ao faturamento');
  });
  const pedido = obterPedido(db, id);
  avisarPorStatus(ev, pedido);
  ev?.emitir('impressao', { id: pedido.id }, { papeis: ['expedicao'] });
  return pedido;
}

function marcarImpresso(db, usuario, id) {
  const p = buscarPedidoBruto(db, id);
  db.prepare('UPDATE pedidos SET impresso_em = ? WHERE id = ?').run(agora(), p.id);
  registrarHistorico(db, p.id, usuario.id, p.status, p.status, 'Pedido impresso');
  return obterPedido(db, id);
}

function faturar(db, ev, usuario, id, notaFiscal) {
  transacao(db, () => {
    const p = buscarPedidoBruto(db, id);
    exigirStatus(p, STATUS.AGUARDANDO_FATURAMENTO);
    mudarStatus(db, p, usuario, STATUS.FATURADO, notaFiscal ? `Faturado - NF ${notaFiscal}` : 'Faturado',
      { nota_fiscal: notaFiscal || null });
  });
  const pedido = obterPedido(db, id);
  avisarPorStatus(ev, pedido);
  return pedido;
}

function cancelar(db, ev, usuario, id, motivo) {
  transacao(db, () => {
    const p = buscarPedidoBruto(db, id);
    if (usuario.papel === 'vendedor') {
      if (p.vendedor_id !== usuario.id) throw new ErroNegocio('Pedido de outro vendedor', 403);
      exigirStatus(p, STATUS.AGUARDANDO_APROVACAO, STATUS.REVISAO, STATUS.AGUARDANDO_EXPEDICAO);
    } else {
      exigirStatus(p, STATUS.AGUARDANDO_APROVACAO, STATUS.REVISAO, STATUS.AGUARDANDO_EXPEDICAO,
        STATUS.EM_SEPARACAO, STATUS.AGUARDANDO_FATURAMENTO);
    }
    mudarStatus(db, p, usuario, STATUS.CANCELADO, motivo ? `Cancelado: ${motivo}` : 'Cancelado',
      { motivo_status: motivo || null });
  });
  const pedido = obterPedido(db, id);
  avisarPorStatus(ev, pedido);
  return pedido;
}

// ---------- Consultas ----------

function obterPedido(db, id) {
  const p = db.prepare(`
    SELECT p.*, c.razao_social AS cliente_nome, c.nome_fantasia AS cliente_fantasia, c.codigo AS cliente_codigo,
           c.documento AS cliente_documento, c.cidade AS cliente_cidade, c.uf AS cliente_uf,
           u.nome AS vendedor_nome
    FROM pedidos p JOIN clientes c ON c.id = p.cliente_id JOIN usuarios u ON u.id = p.vendedor_id
    WHERE p.id = ?`).get(Number(id));
  if (!p) throw new ErroNegocio('Pedido não encontrado', 404);
  p.rotulo_status = ROTULOS[p.status];
  p.itens = db.prepare(`
    SELECT i.*, pr.codigo, pr.descricao, pr.unidade, pr.pesavel, pr.tara_kg AS tara_produto_kg, t.nome AS tabela_nome
    FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id
    LEFT JOIN tabelas_preco t ON t.id = i.tabela_id
    WHERE i.pedido_id = ? ORDER BY i.id`).all(p.id)
    .map((i) => ({ ...i, total_centavos: Math.round(quantidadeFinal(i) * i.preco_centavos) }));
  p.historico = db.prepare(`
    SELECT h.*, u.nome AS usuario_nome FROM pedido_historico h LEFT JOIN usuarios u ON u.id = h.usuario_id
    WHERE h.pedido_id = ? ORDER BY h.id`).all(p.id);
  return p;
}

function listarPedidos(db, usuario, filtros = {}) {
  const cond = [];
  const params = {};
  if (usuario.papel === 'vendedor') {
    cond.push('p.vendedor_id = :vendedor');
    params.vendedor = usuario.id;
  }
  if (filtros.status) {
    const lista = String(filtros.status).split(',').filter((s) => STATUS[s]);
    if (lista.length) cond.push(`p.status IN (${lista.map((s) => `'${s}'`).join(',')})`);
  }
  if (filtros.nao_impressos) cond.push('p.impresso_em IS NULL');
  if (filtros.nao_exportados) cond.push('p.exportado_em IS NULL');
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return db.prepare(`
    SELECT p.id, p.uuid, p.status, p.total_centavos, p.criado_em, p.lancado_em, p.atualizado_em, p.impresso_em, p.exportado_em, p.motivo_status,
           c.razao_social AS cliente_nome, c.nome_fantasia AS cliente_fantasia, u.nome AS vendedor_nome,
           (SELECT COUNT(*) FROM pedido_itens i WHERE i.pedido_id = p.id) AS qtd_itens,
           (SELECT COUNT(*) FROM pedido_itens i WHERE i.pedido_id = p.id AND i.aprovacao = 'pendente') AS itens_pendentes,
           (SELECT COUNT(*) FROM pedido_itens i WHERE i.pedido_id = p.id AND i.separado_em IS NOT NULL) AS itens_separados
    FROM pedidos p JOIN clientes c ON c.id = p.cliente_id JOIN usuarios u ON u.id = p.vendedor_id
    ${where} ORDER BY p.id DESC LIMIT 200`).all(params)
    .map((p) => ({ ...p, rotulo_status: ROTULOS[p.status] }));
}

module.exports = {
  STATUS, ROTULOS, ErroNegocio, aceitaFracao, quantidadeFinal,
  criarPedido, revisarPedido, decidirPrecos, aceitarExpedicao, recusarExpedicao,
  registrarPeso, marcarSeparado, concluirSeparacao, marcarImpresso, faturar, cancelar,
  obterPedido, listarPedidos,
};

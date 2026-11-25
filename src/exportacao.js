// Integração com o Visual Software (ERP): exportação de pedidos e importação de cadastros.
//
// O layout exato de importação do Visual Software ainda precisa ser confirmado.
// Por isso a exportação gera um arquivo CSV "plano" (uma linha por item, com os dados do pedido repetidos),
// que é o formato mais comum aceito por rotinas de importação de ERPs, e também JSON.
// Quando tivermos o layout oficial, basta ajustar COLUNAS_CSV (ou criar um novo formato aqui).
const { transacao } = require('./db');
const { obterPedido, quantidadeFinal, ErroNegocio, STATUS } = require('./pedidos');

const decimal = (n, casas) => Number(n).toFixed(casas).replace('.', ',');
const dataBr = (s) => {
  if (!s) return '';
  const [d, h] = s.split(' ');
  const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a} ${h || ''}`.trim();
};

const COLUNAS_CSV = [
  ['NUMERO_PEDIDO', (p) => p.id],
  ['DATA_PEDIDO', (p) => dataBr(p.lancado_em || p.criado_em)],
  ['CLIENTE_CODIGO', (p) => p.cliente_codigo || ''],
  ['CLIENTE_CNPJ_CPF', (p) => (p.cliente_documento || '').replace(/\D/g, '')],
  ['CLIENTE_RAZAO_SOCIAL', (p) => p.cliente_nome],
  ['VENDEDOR', (p) => p.vendedor_nome],
  ['ITEM', (p, i, n) => n + 1],
  ['PRODUTO_CODIGO', (p, i) => i.codigo],
  ['PRODUTO_DESCRICAO', (p, i) => i.descricao],
  ['UNIDADE', (p, i) => i.unidade],
  ['QUANTIDADE_PEDIDA', (p, i) => decimal(i.quantidade, 3)],
  ['UNIDADE_PEDIDA', (p, i) => i.unidade_pedido || i.unidade],
  ['PESO_BRUTO', (p, i) => (i.peso_bruto != null ? decimal(i.peso_bruto, 3) : '')],
  ['CAIXAS', (p, i) => i.caixas ?? ''],
  ['TARA_TOTAL', (p, i) => (i.peso_bruto != null ? decimal((i.caixas || 0) * (i.tara_kg || 0), 3) : '')],
  ['QUANTIDADE_FINAL', (p, i) => decimal(quantidadeFinal(i), 3)],
  ['PRECO_UNITARIO', (p, i) => decimal(i.preco_centavos / 100, 2)],
  ['TOTAL_ITEM', (p, i) => decimal(i.total_centavos / 100, 2)],
  ['TOTAL_PEDIDO', (p) => decimal(p.total_centavos / 100, 2)],
  ['OBSERVACAO', (p) => p.observacao || ''],
];

function celula(v) {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ');
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function gerarCsv(pedidos) {
  const linhas = [COLUNAS_CSV.map(([nome]) => nome).join(';')];
  for (const p of pedidos) {
    p.itens.forEach((i, n) => {
      if (quantidadeFinal(i) === 0) return; // item em falta não vai para o faturamento
      linhas.push(COLUNAS_CSV.map(([, fn]) => celula(fn(p, i, n))).join(';'));
    });
  }
  return linhas.join('\r\n') + '\r\n';
}

function gerarJson(pedidos) {
  return JSON.stringify(pedidos.map((p) => ({
    numero: p.id,
    data: p.lancado_em || p.criado_em,
    cliente: { codigo: p.cliente_codigo, documento: p.cliente_documento, razao_social: p.cliente_nome },
    vendedor: p.vendedor_nome,
    observacao: p.observacao,
    total: p.total_centavos / 100,
    itens: p.itens.filter((i) => quantidadeFinal(i) !== 0).map((i) => ({
      produto_codigo: i.codigo,
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade_pedida: i.quantidade,
      unidade_pedida: i.unidade_pedido || i.unidade,
      peso_bruto: i.peso_bruto,
      caixas: i.caixas,
      tara_kg_por_caixa: i.tara_kg,
      quantidade: quantidadeFinal(i),
      preco_unitario: i.preco_centavos / 100,
      total: i.total_centavos / 100,
    })),
  })), null, 2);
}

// Exporta pedidos prontos para faturar. Sem ids: todos os "aguardando faturamento" ainda não exportados.
function exportarPedidos(db, usuario, { ids, formato = 'csv', codificacao = 'latin1', incluirExportados = false } = {}) {
  let lista;
  if (Array.isArray(ids) && ids.length) {
    lista = ids.map(Number);
  } else {
    lista = db.prepare(`SELECT id FROM pedidos WHERE status = ? ${incluirExportados ? '' : 'AND exportado_em IS NULL'} ORDER BY id`)
      .all(STATUS.AGUARDANDO_FATURAMENTO).map((r) => r.id);
  }
  const pedidos = lista.map((id) => obterPedido(db, id));
  const invalidos = pedidos.filter((p) => ![STATUS.AGUARDANDO_FATURAMENTO, STATUS.FATURADO].includes(p.status));
  if (invalidos.length) throw new ErroNegocio(`Pedido(s) ainda não liberados para faturar: ${invalidos.map((p) => '#' + p.id).join(', ')}`);
  if (!pedidos.length) throw new ErroNegocio('Nenhum pedido pendente de exportação', 404);

  transacao(db, () => {
    const marcar = db.prepare("UPDATE pedidos SET exportado_em = datetime('now') WHERE id = ?");
    const hist = db.prepare(`INSERT INTO pedido_historico (pedido_id, usuario_id, status_anterior, status_novo, descricao)
                             VALUES (?, ?, ?, ?, 'Exportado para o Visual Software')`);
    for (const p of pedidos) {
      marcar.run(p.id);
      hist.run(p.id, usuario.id, p.status, p.status);
    }
  });

  const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  if (formato === 'json') {
    return { nome: `pedidos_${carimbo}.json`, tipo: 'application/json; charset=utf-8', conteudo: Buffer.from(gerarJson(pedidos), 'utf8'), quantidade: pedidos.length };
  }
  const csv = gerarCsv(pedidos);
  const conteudo = codificacao === 'utf8' ? Buffer.from('﻿' + csv, 'utf8') : Buffer.from(csv, 'latin1');
  return {
    nome: `pedidos_${carimbo}.csv`,
    tipo: `text/csv; charset=${codificacao === 'utf8' ? 'utf-8' : 'iso-8859-1'}`,
    conteudo,
    quantidade: pedidos.length,
  };
}

// ---------- Importação de cadastros (vindos do Visual Software) ----------

function lerLinhas(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (linhas.length && /^c[oó]d/i.test(linhas[0])) linhas.shift(); // ignora cabeçalho
  return linhas.map((l) => l.split(/\t|;/).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
}

const simOuNao = (v) => /^(s|sim|1|true|x)$/i.test(String(v || '').trim()) ? 1 : 0;

// Colunas: CODIGO;RAZAO_SOCIAL;NOME_FANTASIA;CNPJ_CPF;CIDADE;UF;TELEFONE;GRUPO
function importarClientes(db, texto) {
  const erros = [];
  let criados = 0;
  let atualizados = 0;
  transacao(db, () => {
    const grupo = (nome) => {
      if (!nome) return null;
      db.prepare('INSERT OR IGNORE INTO grupos_clientes (nome) VALUES (?)').run(nome);
      return db.prepare('SELECT id FROM grupos_clientes WHERE nome = ?').get(nome).id;
    };
    lerLinhas(texto).forEach((c, n) => {
      const [codigo, razao, fantasia, doc, cidade, uf, tel, grp] = c;
      if (!codigo || !razao) return erros.push(`Linha ${n + 1}: código e razão social são obrigatórios`);
      const dados = {
        codigo, razao_social: razao, nome_fantasia: fantasia || null, documento: doc || null,
        cidade: cidade || null, uf: uf ? uf.toUpperCase() : null, telefone: tel || null, grupo_id: grupo(grp),
      };
      const existe = db.prepare('SELECT id FROM clientes WHERE codigo = ?').get(codigo);
      if (existe) {
        db.prepare(`UPDATE clientes SET razao_social = :razao_social, nome_fantasia = :nome_fantasia, documento = :documento,
          cidade = :cidade, uf = :uf, telefone = :telefone, grupo_id = COALESCE(:grupo_id, grupo_id) WHERE codigo = :codigo`).run(dados);
        atualizados++;
      } else {
        db.prepare(`INSERT INTO clientes (codigo, razao_social, nome_fantasia, documento, cidade, uf, telefone, grupo_id)
          VALUES (:codigo, :razao_social, :nome_fantasia, :documento, :cidade, :uf, :telefone, :grupo_id)`).run(dados);
        criados++;
      }
    });
  });
  return { criados, atualizados, erros };
}

// Colunas: CODIGO;DESCRICAO;UNIDADE;PESAVEL(S/N);UNIDADE_PEDIDO;PESO_MEDIO_KG;TARA_KG (as 3 últimas opcionais)
function importarProdutos(db, texto) {
  const erros = [];
  let criados = 0;
  let atualizados = 0;
  transacao(db, () => {
    lerLinhas(texto).forEach((c, n) => {
      const [codigo, descricao, unidade, pesavel, unPedido, pesoMedio, tara] = c;
      if (!codigo || !descricao) return erros.push(`Linha ${n + 1}: código e descrição são obrigatórios`);
      const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(',', '.')));
      const dados = {
        codigo, descricao, unidade: (unidade || 'UN').toUpperCase(), pesavel: simOuNao(pesavel),
        unidade_pedido: unPedido ? unPedido.toUpperCase() : null, peso_medio_kg: num(pesoMedio), tara_kg: num(tara),
      };
      if ([dados.peso_medio_kg, dados.tara_kg].some((v) => v != null && !(v >= 0))) return erros.push(`Linha ${n + 1}: peso médio/tara inválido`);
      const existe = db.prepare('SELECT id FROM produtos WHERE codigo = ?').get(codigo);
      if (existe) {
        db.prepare(`UPDATE produtos SET descricao = :descricao, unidade = :unidade, pesavel = :pesavel,
          unidade_pedido = COALESCE(:unidade_pedido, unidade_pedido), peso_medio_kg = COALESCE(:peso_medio_kg, peso_medio_kg),
          tara_kg = COALESCE(:tara_kg, tara_kg) WHERE codigo = :codigo`).run(dados);
        atualizados++;
      } else {
        db.prepare(`INSERT INTO produtos (codigo, descricao, unidade, pesavel, unidade_pedido, peso_medio_kg, tara_kg)
          VALUES (:codigo, :descricao, :unidade, :pesavel, :unidade_pedido, :peso_medio_kg, :tara_kg)`).run(dados);
        criados++;
      }
    });
  });
  return { criados, atualizados, erros };
}

module.exports = { exportarPedidos, importarClientes, importarProdutos, gerarCsv };

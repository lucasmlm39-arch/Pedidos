// Testes do modo offline (sincronização) e da integração com o Visual Software.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirBanco } = require('../src/db');
const { criarApp } = require('../src/app');
const { popularDemonstracao } = require('../src/seed');

let servidor, base, db;
const tokens = {};

async function api(quem, metodo, rota, corpo, cru = false) {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(tokens[quem] ? { Authorization: `Bearer ${tokens[quem]}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (cru) return r;
  return { status: r.status, dados: await r.json() };
}
const idCliente = (c) => db.prepare('SELECT id FROM clientes WHERE codigo = ?').get(c).id;
const idProduto = (c) => db.prepare('SELECT id FROM produtos WHERE codigo = ?').get(c).id;

before(async () => {
  db = abrirBanco(':memory:');
  popularDemonstracao(db);
  const app = criarApp(db);
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
  for (const [quem, login, senha] of [['gestor', 'gestor', 'admin123'], ['carlos', 'carlos', '123456'], ['ana', 'ana', '123456'], ['exp', 'expedicao', '123456'], ['fat', 'faturamento', '123456']]) {
    tokens[quem] = (await api(null, 'POST', '/api/login', { login, senha })).dados.token;
  }
});
after(() => { servidor.closeAllConnections(); servidor.close(); });

test('pacote offline traz clientes, produtos e tabelas', async () => {
  const { status, dados } = await api('carlos', 'GET', '/api/vendedor/pacote');
  assert.equal(status, 200);
  assert.ok(dados.clientes.length >= 5);
  assert.ok(dados.produtos.length >= 10);
  const padrao = dados.tabelas.find((t) => t.padrao);
  assert.ok(padrao.precos.length >= 10);
  const especial = dados.tabelas.find((t) => t.nome === 'Especial Sacolão Alfa');
  assert.deepEqual(especial.clientes, [idCliente('C005')]);
});

test('pedido offline reenviado com o mesmo uuid não duplica', async () => {
  const corpo = {
    uuid: 'a1b2c3d4-0000-4000-8000-000000000001',
    lancado_em: new Date(Date.now() - 3600e3).toISOString(),
    cliente_id: idCliente('C003'),
    itens: [{ produto_id: idProduto('P002'), quantidade: 30 }],
  };
  const r1 = await api('carlos', 'POST', '/api/pedidos', corpo);
  const r2 = await api('carlos', 'POST', '/api/pedidos', corpo);
  assert.equal(r1.status, 201);
  assert.equal(r2.dados.id, r1.dados.id);
  assert.equal(r2.dados.ja_existia, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pedidos WHERE uuid = ?').get(corpo.uuid).n, 1);
  // Outro vendedor não pode reaproveitar o uuid.
  assert.equal((await api('ana', 'POST', '/api/pedidos', corpo)).status, 409);
});

test('quantidade fracionada só para KG/pesável', async () => {
  const c = idCliente('C003');
  assert.equal((await api('carlos', 'POST', '/api/pedidos', { cliente_id: c, itens: [{ produto_id: idProduto('P005'), quantidade: 12.5 }] })).status, 201);
  assert.equal((await api('carlos', 'POST', '/api/pedidos', { cliente_id: c, itens: [{ produto_id: idProduto('P007'), quantidade: 2.5 }] })).status, 400);
});

test('item em falta, exportação CSV para o Visual Software e marcação de exportado', async () => {
  const p = (await api('carlos', 'POST', '/api/pedidos', {
    cliente_id: idCliente('C001'),
    observacao: 'Entregar; cedo',
    itens: [
      { produto_id: idProduto('P001'), quantidade: 3 },
      { produto_id: idProduto('P006'), quantidade: 20 },
      { produto_id: idProduto('P008'), quantidade: 5 },
    ],
  })).dados;
  await api('exp', 'POST', `/api/pedidos/${p.id}/aceitar`);
  const [tomate, laranja, ovos] = p.itens;
  await api('exp', 'PUT', `/api/pedidos/${p.id}/itens/${laranja.id}/peso`, { peso: 21.4 });
  await api('exp', 'PUT', `/api/pedidos/${p.id}/itens/${ovos.id}/peso`, { peso: 0 }); // em falta
  const fim = (await api('exp', 'POST', `/api/pedidos/${p.id}/concluir`)).dados;
  assert.equal(fim.total_centavos, 3 * tomate.preco_centavos + Math.round(21.4 * laranja.preco_centavos));

  assert.equal((await api('carlos', 'POST', '/api/exportacao', {}, true)).status, 403);
  const r = await api('fat', 'POST', '/api/exportacao', { formato: 'csv', codificacao: 'utf8' }, true);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /pedidos_\d+\.csv/);
  const csv = (await r.text()).replace(/^﻿/, '');
  const linhas = csv.trim().split('\r\n');
  assert.match(linhas[0], /^NUMERO_PEDIDO;DATA_PEDIDO;CLIENTE_CODIGO/);
  const doPedido = linhas.filter((l) => l.startsWith(`${p.id};`));
  assert.equal(doPedido.length, 2); // ovos em falta não vão
  assert.ok(doPedido.some((l) => l.includes(';P006;') && l.includes(';21,400;')));
  assert.ok(doPedido[0].includes('"Entregar; cedo"'));

  // Já exportado: não sai de novo.
  assert.equal((await api('fat', 'POST', '/api/exportacao', {}, true)).status, 404);
  const lista = (await api('fat', 'GET', '/api/pedidos?status=AGUARDANDO_FATURAMENTO&nao_exportados=1')).dados;
  assert.ok(!lista.some((x) => x.id === p.id));
  // Reexportação explícita em JSON.
  const j = await api('fat', 'POST', '/api/exportacao', { ids: [p.id], formato: 'json' }, true);
  const json = JSON.parse(await j.text());
  assert.equal(json[0].numero, p.id);
  assert.equal(json[0].itens.length, 2);
});

test('importação de clientes e produtos do Visual Software', async () => {
  const cli = await api('gestor', 'POST', '/api/clientes/lote', {
    texto: 'CODIGO;RAZAO;FANTASIA;CNPJ;CIDADE;UF;TEL;GRUPO\nC900;Hortifruti Novo Ltda;Horti Novo;11.111.111/0001-11;Campinas;sp;;Atacarejos\nC001;Supermercado Bom Preço Ltda;Bom Preço Matriz;;;;;\n;sem codigo',
  });
  assert.equal(cli.dados.criados, 1);
  assert.equal(cli.dados.atualizados, 1);
  assert.equal(cli.dados.erros.length, 1);
  assert.equal(db.prepare("SELECT nome_fantasia FROM clientes WHERE codigo = 'C001'").get().nome_fantasia, 'Bom Preço Matriz');
  assert.ok(db.prepare("SELECT id FROM grupos_clientes WHERE nome = 'Atacarejos'").get());

  const prod = await api('gestor', 'POST', '/api/produtos/lote', { texto: 'P100\tAbacaxi Pérola\tUN\tN\nP101;Melancia;KG;S' });
  assert.equal(prod.dados.criados, 2);
  assert.equal(db.prepare("SELECT pesavel FROM produtos WHERE codigo = 'P101'").get().pesavel, 1);
  assert.equal((await api('carlos', 'POST', '/api/produtos/lote', { texto: 'x;y' })).status, 403);
});

test('abacaxi pedido em unidades, cobrado por kg, com desconto da caixa (tara)', async () => {
  const abacaxi = idProduto('P011'); // UN, R$ 4,50/kg, peso médio 1,8 kg, tara 2 kg
  // Unidade não pode ser fracionada.
  assert.equal((await api('carlos', 'POST', '/api/pedidos', { cliente_id: idCliente('C003'), itens: [{ produto_id: abacaxi, quantidade: 2.5 }] })).status, 400);
  const p = (await api('carlos', 'POST', '/api/pedidos', {
    cliente_id: idCliente('C003'),
    itens: [{ produto_id: abacaxi, quantidade: 10 }],
  })).dados;
  const item = p.itens[0];
  assert.equal(item.unidade_pedido, 'UN');
  assert.equal(item.peso_estimado_kg, 18);
  assert.equal(p.total_centavos, 18 * 450); // estimativa: 10 x 1,8 kg x 4,50
  await api('exp', 'POST', `/api/pedidos/${p.id}/aceitar`);
  // Sem peso não conclui.
  assert.equal((await api('exp', 'POST', `/api/pedidos/${p.id}/concluir`)).status, 400);
  // Bruto 23,4 kg em 2 caixas de 2 kg -> líquido 19,4 kg.
  const r = await api('exp', 'PUT', `/api/pedidos/${p.id}/itens/${item.id}/peso`, { peso_bruto: 23.4, caixas: 2 });
  assert.equal(r.status, 200);
  const it = r.dados.itens[0];
  assert.equal(it.peso_bruto, 23.4);
  assert.equal(it.caixas, 2);
  assert.equal(it.tara_kg, 2);
  assert.equal(it.peso_real, 19.4);
  assert.equal(r.dados.total_centavos, Math.round(19.4 * 450));
  // Tara maior que o peso é recusada.
  assert.equal((await api('exp', 'PUT', `/api/pedidos/${p.id}/itens/${item.id}/peso`, { peso_bruto: 3, caixas: 2 })).status, 400);
  // Peso líquido direto continua valendo (limpa bruto/caixas).
  const direto = (await api('exp', 'PUT', `/api/pedidos/${p.id}/itens/${item.id}/peso`, { peso: 19 })).dados.itens[0];
  assert.equal(direto.peso_real, 19);
  assert.equal(direto.peso_bruto, null);
  await api('exp', 'PUT', `/api/pedidos/${p.id}/itens/${item.id}/peso`, { peso_bruto: 23.4, caixas: 2 });
  await api('exp', 'POST', `/api/pedidos/${p.id}/concluir`);
  const csv = await (await api('fat', 'POST', '/api/exportacao', { ids: [p.id], codificacao: 'utf8' }, true)).text();
  const linha = csv.split('\r\n').find((l) => l.startsWith(`${p.id};`));
  assert.ok(linha.includes(';10,000;UN;23,400;2;4,000;19,400;4,50;87,30;'), linha);
});

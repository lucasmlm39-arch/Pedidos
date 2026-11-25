// Testes de ponta a ponta do fluxo: vendedor -> gestor -> expedição -> faturamento.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirBanco } = require('../src/db');
const { criarApp } = require('../src/app');
const { popularDemonstracao } = require('../src/seed');
const { reaisParaCentavos } = require('../src/rotas/cadastros');

let servidor, base, db;
const tokens = {};

async function api(quem, metodo, rota, corpo) {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(tokens[quem] ? { Authorization: `Bearer ${tokens[quem]}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json();
  return { status: r.status, dados };
}

const idCliente = (codigo) => db.prepare('SELECT id FROM clientes WHERE codigo = ?').get(codigo).id;
const idProduto = (codigo) => db.prepare('SELECT id FROM produtos WHERE codigo = ?').get(codigo).id;

before(async () => {
  db = abrirBanco(':memory:');
  popularDemonstracao(db);
  const app = criarApp(db);
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
  for (const [quem, login, senha] of [
    ['gestor', 'gestor', 'admin123'], ['carlos', 'carlos', '123456'], ['ana', 'ana', '123456'],
    ['exp', 'expedicao', '123456'], ['fat', 'faturamento', '123456'],
  ]) {
    const r = await api(null, 'POST', '/api/login', { login, senha });
    assert.equal(r.status, 200);
    tokens[quem] = r.dados.token;
  }
});

after(() => {
  servidor.app?.locals?.eventos?.fecharTodas();
  servidor.closeAllConnections();
  servidor.close();
});

test('login inválido é recusado', async () => {
  const r = await api(null, 'POST', '/api/login', { login: 'gestor', senha: 'errada' });
  assert.equal(r.status, 401);
});

test('conversão de reais para centavos', () => {
  assert.equal(reaisParaCentavos('12,50'), 1250);
  assert.equal(reaisParaCentavos('1.234,56'), 123456);
  assert.equal(reaisParaCentavos('R$ 7.89'), 789);
  assert.equal(reaisParaCentavos(3.5), 350);
});

test('preço respeita prioridade: cliente > grupo > padrão', async () => {
  const padrao = (await api('carlos', 'GET', `/api/clientes/${idCliente('C003')}/catalogo`)).dados;
  const grupo = (await api('carlos', 'GET', `/api/clientes/${idCliente('C001')}/catalogo`)).dados;
  const especial = (await api('carlos', 'GET', `/api/clientes/${idCliente('C005')}/catalogo`)).dados;
  const preco = (lista, codigo) => lista.find((p) => p.codigo === codigo);
  assert.equal(preco(padrao, 'P001').preco_centavos, 9890);
  assert.equal(preco(padrao, 'P001').tabela_nome, 'Tabela Padrão');
  assert.equal(preco(grupo, 'P001').preco_centavos, Math.round(9890 * 0.95));
  assert.equal(preco(especial, 'P001').preco_centavos, 8990);              // tabela do cliente
  assert.equal(preco(especial, 'P002').preco_centavos, 250);               // não está na especial -> padrão
});

test('pedido com preço de tabela vai direto para a expedição', async () => {
  const r = await api('carlos', 'POST', '/api/pedidos', {
    cliente_id: idCliente('C003'),
    itens: [{ produto_id: idProduto('P002'), quantidade: 10 }],
  });
  assert.equal(r.status, 201);
  assert.equal(r.dados.status, 'AGUARDANDO_EXPEDICAO');
  assert.equal(r.dados.total_centavos, 2500);
});

test('fluxo completo com preço abaixo da tabela, aprovação, pesagem e faturamento', async () => {
  // Vendedor lança: um item abaixo da tabela e um item pesável.
  const novo = await api('carlos', 'POST', '/api/pedidos', {
    cliente_id: idCliente('C003'),
    observacao: 'Entregar pela manhã',
    itens: [
      { produto_id: idProduto('P001'), quantidade: 5, preco_centavos: 9000 }, // tabela 98,90
      { produto_id: idProduto('P004'), quantidade: 30 },                      // batata, kg, preço tabela
    ],
  });
  assert.equal(novo.status, 201);
  const pedido = novo.dados;
  assert.equal(pedido.status, 'AGUARDANDO_APROVACAO');
  const itemBaixo = pedido.itens.find((i) => i.codigo === 'P001');
  const itemBatata = pedido.itens.find((i) => i.codigo === 'P004');
  assert.equal(itemBaixo.aprovacao, 'pendente');
  assert.equal(itemBatata.aprovacao, 'nao_necessaria');

  // Expedição ainda não pode aceitar.
  assert.equal((await api('exp', 'POST', `/api/pedidos/${pedido.id}/aceitar`)).status, 409);
  // Vendedor não pode aprovar o próprio preço.
  assert.equal((await api('carlos', 'POST', `/api/pedidos/${pedido.id}/aprovacao`, { decisoes: [] })).status, 403);

  // Gestor aprova.
  const apr = await api('gestor', 'POST', `/api/pedidos/${pedido.id}/aprovacao`, {
    decisoes: [{ item_id: itemBaixo.id, aprovado: true }],
  });
  assert.equal(apr.status, 200);
  assert.equal(apr.dados.status, 'AGUARDANDO_EXPEDICAO');

  // Expedição aceita, tenta concluir sem pesar, pesa e conclui.
  assert.equal((await api('exp', 'POST', `/api/pedidos/${pedido.id}/aceitar`)).dados.status, 'EM_SEPARACAO');
  const semPeso = await api('exp', 'POST', `/api/pedidos/${pedido.id}/concluir`);
  assert.equal(semPeso.status, 400);
  assert.match(semPeso.dados.erro, /Falta pesar/);
  assert.equal((await api('exp', 'PUT', `/api/pedidos/${pedido.id}/itens/${itemBaixo.id}/peso`, { peso: 4.5 })).status, 400); // caixa: inteiro
  // Expedição atende só 4 das 5 caixas.
  assert.equal((await api('exp', 'PUT', `/api/pedidos/${pedido.id}/itens/${itemBaixo.id}/peso`, { peso: 4 })).status, 200);
  const pesado = await api('exp', 'PUT', `/api/pedidos/${pedido.id}/itens/${itemBatata.id}/peso`, { peso: 31.25 });
  assert.equal(pesado.status, 200);
  assert.equal(pesado.dados.total_centavos, 4 * 9000 + Math.round(31.25 * 390));
  const concl = await api('exp', 'POST', `/api/pedidos/${pedido.id}/concluir`);
  assert.equal(concl.dados.status, 'AGUARDANDO_FATURAMENTO');

  // Fila de impressão.
  const fila = (await api('exp', 'GET', '/api/pedidos?status=AGUARDANDO_FATURAMENTO&nao_impressos=1')).dados;
  assert.ok(fila.some((p) => p.id === pedido.id));
  await api('exp', 'POST', `/api/pedidos/${pedido.id}/impresso`);
  const fila2 = (await api('exp', 'GET', '/api/pedidos?status=AGUARDANDO_FATURAMENTO&nao_impressos=1')).dados;
  assert.ok(!fila2.some((p) => p.id === pedido.id));

  // Faturamento.
  const fat = await api('fat', 'POST', `/api/pedidos/${pedido.id}/faturar`, { nota_fiscal: '12345' });
  assert.equal(fat.dados.status, 'FATURADO');
  assert.equal(fat.dados.nota_fiscal, '12345');
  assert.ok(fat.dados.historico.length >= 5);
});

test('preço reprovado volta para o vendedor revisar', async () => {
  const novo = (await api('carlos', 'POST', '/api/pedidos', {
    cliente_id: idCliente('C004'),
    itens: [{ produto_id: idProduto('P008'), quantidade: 2, preco_centavos: 900 }],
  })).dados;
  const rep = await api('gestor', 'POST', `/api/pedidos/${novo.id}/aprovacao`, {
    decisoes: [{ item_id: novo.itens[0].id, aprovado: false, motivo: 'Margem muito baixa' }],
  });
  assert.equal(rep.dados.status, 'REVISAO');
  assert.equal(rep.dados.motivo_status, 'Margem muito baixa');

  // Outro vendedor não vê nem altera.
  assert.equal((await api('ana', 'GET', `/api/pedidos/${novo.id}`)).status, 403);
  assert.equal((await api('ana', 'PUT', `/api/pedidos/${novo.id}`, { itens: [] })).status, 403);

  // Vendedor corrige para o preço de tabela.
  const rev = await api('carlos', 'PUT', `/api/pedidos/${novo.id}`, {
    itens: [{ produto_id: idProduto('P008'), quantidade: 2 }],
  });
  assert.equal(rev.dados.status, 'AGUARDANDO_EXPEDICAO');
});

test('validações do pedido', async () => {
  const c = idCliente('C001');
  assert.equal((await api('carlos', 'POST', '/api/pedidos', { cliente_id: c, itens: [] })).status, 400);
  assert.equal((await api('carlos', 'POST', '/api/pedidos', { cliente_id: c, itens: [{ produto_id: idProduto('P001'), quantidade: 1.5 }] })).status, 400);
  assert.equal((await api('carlos', 'POST', '/api/pedidos', { cliente_id: 9999, itens: [{ produto_id: idProduto('P001'), quantidade: 1 }] })).status, 400);
  assert.equal((await api('exp', 'POST', '/api/pedidos', { cliente_id: c, itens: [{ produto_id: idProduto('P001'), quantidade: 1 }] })).status, 403);
});

test('gestor cadastra tabela por grupo e importa preços em lote', async () => {
  const t = await api('gestor', 'POST', '/api/tabelas', { nome: 'Restaurantes Promo' });
  assert.equal(t.status, 201);
  const lote = await api('gestor', 'POST', `/api/tabelas/${t.dados.id}/itens/lote`, { texto: 'P002;2,10\nP999;1,00\nP008\t10,00' });
  assert.equal(lote.dados.importados, 2);
  assert.equal(lote.dados.erros.length, 1);
  const grupoRest = db.prepare("SELECT id FROM grupos_clientes WHERE nome = 'Restaurantes'").get().id;
  await api('gestor', 'PUT', `/api/tabelas/${t.dados.id}/vinculos`, { grupos: [grupoRest] });
  const cat = (await api('carlos', 'GET', `/api/clientes/${idCliente('C003')}/catalogo`)).dados;
  assert.equal(cat.find((p) => p.codigo === 'P002').preco_centavos, 210);
  assert.equal(cat.find((p) => p.codigo === 'P001').preco_centavos, 9890); // não está na promo -> padrão
  // Vendedor não acessa cadastros de preço.
  assert.equal((await api('carlos', 'GET', '/api/tabelas')).status, 403);
});

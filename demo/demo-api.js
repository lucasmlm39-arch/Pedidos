// PRÉVIA: simula o servidor dentro do navegador, só para mostrar o layout do vendedor.
// Intercepta as chamadas /api/* e responde com dados fictícios em memória.
// Nada é gravado de verdade; recarregar a página recomeça a demonstração.
import { catalogoLocal } from './offline.js';

// Qual tela a prévia mostra: <meta name="demo-papel" content="vendedor|expedicao">
const PAPEL = document.querySelector('meta[name="demo-papel"]')?.content || 'vendedor';
const VENDEDOR = { id: 2, nome: 'Carlos Vendedor', login: 'carlos', papel: 'vendedor' };
const OUTROS_VENDEDORES = [{ id: 3, nome: 'Ana Vendedora' }, VENDEDOR];
const EXPEDICAO = { id: 4, nome: 'João Expedição', login: 'expedicao', papel: 'expedicao' };
const USUARIO = PAPEL === 'expedicao' ? EXPEDICAO : VENDEDOR;
const ROTULOS = {
  AGUARDANDO_APROVACAO: 'Aguardando aprovação de preço',
  REVISAO: 'Em revisão (vendedor)',
  AGUARDANDO_EXPEDICAO: 'Aguardando expedição',
  EM_SEPARACAO: 'Em separação / pesagem',
  AGUARDANDO_FATURAMENTO: 'Aguardando faturamento',
  FATURADO: 'Faturado',
  CANCELADO: 'Cancelado',
};

const grupos = { 1: 'Supermercados', 2: 'Restaurantes', 3: 'Quitandas' };
const clientes = [
  [1, 'C001', 'Supermercado Bom Preço Ltda', 'Bom Preço', '12.345.678/0001-90', 'Quedas do Iguaçu', 'PR', 1],
  [2, 'C002', 'Mercado Central Eireli', 'Mercado Central', '23.456.789/0001-01', 'Laranjeiras do Sul', 'PR', 1],
  [3, 'C003', 'Restaurante Sabor Caseiro ME', 'Sabor Caseiro', '34.567.890/0001-12', 'Quedas do Iguaçu', 'PR', 2],
  [4, 'C004', 'Quitanda do Zé', 'Quitanda do Zé', '456.789.012-34', 'Espigão Alto do Iguaçu', 'PR', 3],
  [5, 'C005', 'Sacolão Alfa S/A', 'Sacolão Alfa', '45.678.901/0001-23', 'Cascavel', 'PR', null],
  [6, 'C006', 'Hotel Cataratas Ltda', 'Hotel Cataratas', '56.789.012/0001-34', 'Rio Bonito do Iguaçu', 'PR', 2],
  [7, 'C007', 'Mercearia Três Barras', 'Merc. Três Barras', '67.890.123/0001-45', 'Três Barras do Paraná', 'PR', 3],
].map(([id, codigo, razao_social, nome_fantasia, documento, cidade, uf, grupo_id]) =>
  ({ id, codigo, razao_social, nome_fantasia, documento, cidade, uf, grupo_id, grupo_nome: grupos[grupo_id] || null }));

// id, código, descrição, unidade de cobrança, pesável, preço padrão (centavos), pede em, peso médio, tara
const produtos = [
  [1, 'P001', 'Tomate Italiano (caixa 18 kg)', 'CX', 0, 9890],
  [2, 'P002', 'Alface Crespa', 'UN', 0, 250],
  [3, 'P003', 'Banana Prata (caixa 20 kg)', 'CX', 0, 7990],
  [4, 'P004', 'Batata Lavada', 'KG', 1, 390, null, null, 2],
  [5, 'P005', 'Cebola Nacional', 'KG', 1, 450, null, null, 2],
  [6, 'P006', 'Laranja Pera', 'KG', 1, 320, null, null, 2],
  [7, 'P007', 'Cheiro-Verde (maço)', 'MÇ', 0, 180],
  [8, 'P008', 'Ovos Brancos (dúzia)', 'DZ', 0, 1090],
  [9, 'P009', 'Mamão Formosa', 'KG', 1, 590, null, null, 2],
  [10, 'P010', 'Couve Manteiga (maço)', 'MÇ', 0, 220],
  [11, 'P011', 'Abacaxi Pérola', 'KG', 1, 450, 'UN', 1.8, 2],
  [12, 'P012', 'Tomate Salada (caixa, por kg)', 'KG', 1, 560, 'CX', 20, 2],
  [13, 'P013', 'Melancia', 'KG', 1, 240, 'UN', 9, 0],
  [14, 'P014', 'Morango (bandeja)', 'BDJ', 0, 690],
].map(([id, codigo, descricao, unidade, pesavel, , unidade_pedido = null, peso_medio_kg = null, tara_kg = null]) =>
  ({ id, codigo, descricao, unidade, pesavel, unidade_pedido, peso_medio_kg, tara_kg }));
const precoPadrao = new Map([
  [1, 9890], [2, 250], [3, 7990], [4, 390], [5, 450], [6, 320], [7, 180], [8, 1090], [9, 590], [10, 220],
  [11, 450], [12, 560], [13, 240], [14, 690],
]);

const tabelas = [
  { id: 1, nome: 'Tabela Padrão', padrao: 1, clientes: [], grupos: [], precos: [...precoPadrao] },
  { id: 2, nome: 'Supermercados (-5%)', padrao: 0, clientes: [], grupos: [1], precos: [...precoPadrao].map(([p, v]) => [p, Math.round(v * 0.95)]) },
  { id: 3, nome: 'Especial Sacolão Alfa', padrao: 0, clientes: [5], grupos: [], precos: [[1, 8990], [3, 6990]] },
];
const pacote = () => ({ gerado_em: new Date().toISOString(), usuario: VENDEDOR, clientes, produtos, tabelas });

// ---------- Pedidos em memória ----------
const pedidos = new Map();
let proximoId = 1041;
let proximoItem = 1;
const agoraSql = (d = new Date()) => d.toISOString().replace('T', ' ').slice(0, 19);
const qFinal = (i) => (i.peso_real != null ? i.peso_real : i.unidade_pedido ? (i.peso_estimado_kg ?? 0) : i.quantidade);
const totalItem = (i) => Math.round(qFinal(i) * i.preco_centavos);

function montarItens(clienteId, itens) {
  const cat = new Map(catalogoLocal(pacote(), clienteId).map((p) => [p.id, p]));
  return itens.map((i) => {
    const p = cat.get(Number(i.produto_id));
    const emUnidade = Boolean(p.pesavel && p.unidade_pedido);
    const tabela = p.preco_centavos ?? null;
    const preco = i.preco_centavos ?? tabela;
    return {
      id: proximoItem++, produto_id: p.id, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade,
      pesavel: p.pesavel, unidade_pedido: emUnidade ? p.unidade_pedido : null,
      peso_estimado_kg: emUnidade && p.peso_medio_kg ? Math.round(i.quantidade * p.peso_medio_kg * 1000) / 1000 : null,
      quantidade: Number(i.quantidade), peso_real: null, peso_bruto: null, caixas: null, tara_kg: null, tara_produto_kg: p.tara_kg,
      preco_centavos: preco, preco_tabela_centavos: tabela, tabela_nome: p.tabela_nome,
      aprovacao: tabela == null || preco < tabela ? 'pendente' : 'nao_necessaria', motivo_reprovacao: null,
    };
  });
}

function completar(p) {
  p.itens.forEach((i) => { i.total_centavos = totalItem(i); });
  p.total_centavos = p.itens.reduce((s, i) => s + i.total_centavos, 0);
  p.rotulo_status = ROTULOS[p.status];
  return p;
}

function criar({ cliente_id, itens, observacao, uuid, lancado_em }, quando = new Date(), vendedor = VENDEDOR) {
  if (uuid) {
    const existente = [...pedidos.values()].find((p) => p.uuid === uuid);
    if (existente) return { ...existente, ja_existia: true };
  }
  const c = clientes.find((x) => x.id === Number(cliente_id));
  const its = montarItens(c.id, itens);
  const status = its.some((i) => i.aprovacao === 'pendente') ? 'AGUARDANDO_APROVACAO' : 'AGUARDANDO_EXPEDICAO';
  const p = {
    id: proximoId++, uuid, status, cliente_id: c.id, cliente_nome: c.razao_social, cliente_fantasia: c.nome_fantasia,
    cliente_codigo: c.codigo, cliente_documento: c.documento, cliente_cidade: c.cidade, cliente_uf: c.uf,
    vendedor_id: vendedor.id, vendedor_nome: vendedor.nome, observacao: observacao || null, motivo_status: null,
    criado_em: agoraSql(quando), lancado_em: lancado_em ? agoraSql(new Date(lancado_em)) : agoraSql(quando),
    impresso_em: null, nota_fiscal: null, exportado_em: null, itens: its,
    historico: [{ criado_em: agoraSql(quando), descricao: 'Pedido lançado', usuario_nome: vendedor.nome }],
  };
  pedidos.set(p.id, completar(p));
  return p;
}

function mudar(p, status, descricao, quem, extras = {}) {
  Object.assign(p, { status }, extras);
  p.historico.push({ criado_em: agoraSql(), descricao, usuario_nome: quem });
  completar(p);
  eventos.emitir({ id: p.id, status, rotulo: ROTULOS[status] });
}

// Pedidos de exemplo, para "Meus pedidos" já mostrar cada situação.
function exemplosVendedor() {
  const h = (horas) => new Date(Date.now() - horas * 3600e3);
  const a = criar({ cliente_id: 1, itens: [{ produto_id: 4, quantidade: 50 }, { produto_id: 2, quantidade: 120 }, { produto_id: 8, quantidade: 30 }] }, h(30));
  a.itens[0].peso_real = 52.4; a.itens[0].peso_bruto = 58.4; a.itens[0].caixas = 3; a.itens[0].tara_kg = 2;
  Object.assign(a, { status: 'FATURADO', nota_fiscal: '18452', impresso_em: agoraSql(h(27)) });
  a.historico.push({ criado_em: agoraSql(h(26)), descricao: 'Faturado - NF 18452', usuario_nome: 'Marta Faturamento' });
  completar(a);
  const b = criar({ cliente_id: 6, itens: [{ produto_id: 11, quantidade: 12 }, { produto_id: 9, quantidade: 15 }, { produto_id: 7, quantidade: 20 }] }, h(3));
  Object.assign(b, { status: 'EM_SEPARACAO' });
  b.historico.push({ criado_em: agoraSql(h(2)), descricao: 'Pedido aceito pela expedição', usuario_nome: 'João Expedição' });
  completar(b);
  const c = criar({ cliente_id: 4, itens: [{ produto_id: 1, quantidade: 4, preco_centavos: 8500 }, { produto_id: 10, quantidade: 25 }] }, h(1));
  c.itens[0].aprovacao = 'reprovado';
  c.itens[0].motivo_reprovacao = 'Mínimo para esse cliente é R$ 94,00';
  Object.assign(c, { status: 'REVISAO', motivo_status: 'Mínimo para esse cliente é R$ 94,00' });
  c.historico.push({ criado_em: agoraSql(h(0.5)), descricao: 'Preço reprovado: Mínimo para esse cliente é R$ 94,00', usuario_nome: 'Gestor' });
  completar(c);
}

// Pedidos de exemplo para a expedição: novos, um em separação e alguns concluídos.
function exemplosExpedicao() {
  const h = (horas) => new Date(Date.now() - horas * 3600e3);
  const liberar = (p, horas) => {
    p.historico.push({ criado_em: agoraSql(h(horas)), descricao: 'Preços aprovados pelo gestor', usuario_nome: 'Gestor' });
    p.status = 'AGUARDANDO_EXPEDICAO';
    p.itens.forEach((i) => { if (i.aprovacao === 'pendente') i.aprovacao = 'aprovado'; });
    completar(p);
  };
  const [ana, carlos] = OUTROS_VENDEDORES;
  // Já concluídos (aguardando faturamento)
  const f1 = criar({ cliente_id: 2, itens: [{ produto_id: 3, quantidade: 6 }, { produto_id: 5, quantidade: 40 }] }, h(6), ana);
  f1.itens[1].peso_real = 41.2; f1.itens[1].peso_bruto = 45.2; f1.itens[1].caixas = 2; f1.itens[1].tara_kg = 2;
  Object.assign(f1, { status: 'AGUARDANDO_FATURAMENTO', impresso_em: agoraSql(h(5)) });
  f1.historico.push({ criado_em: agoraSql(h(5)), descricao: 'Separação/pesagem concluída. Enviado ao faturamento', usuario_nome: EXPEDICAO.nome });
  completar(f1);
  // Em separação, já com um item pesado
  const s1 = criar({ cliente_id: 6, observacao: 'Entregar até 10h na cozinha', itens: [
    { produto_id: 11, quantidade: 12 }, { produto_id: 9, quantidade: 15 }, { produto_id: 7, quantidade: 20 }, { produto_id: 8, quantidade: 10 },
  ] }, h(2.5), carlos);
  s1.itens[1].peso_real = 15.8; s1.itens[1].peso_bruto = 17.8; s1.itens[1].caixas = 1; s1.itens[1].tara_kg = 2;
  s1.status = 'EM_SEPARACAO';
  s1.historico.push({ criado_em: agoraSql(h(1)), descricao: 'Pedido aceito pela expedição', usuario_nome: EXPEDICAO.nome });
  completar(s1);
  // Novos, aguardando a expedição aceitar
  const n1 = criar({ cliente_id: 3, itens: [
    { produto_id: 11, quantidade: 10 }, { produto_id: 12, quantidade: 3 }, { produto_id: 2, quantidade: 40 }, { produto_id: 10, quantidade: 15 },
  ] }, h(0.8), carlos);
  completar(n1);
  const n2 = criar({ cliente_id: 1, observacao: 'Cliente pediu bananas mais verdes', itens: [
    { produto_id: 4, quantidade: 60 }, { produto_id: 6, quantidade: 45 }, { produto_id: 3, quantidade: 8 }, { produto_id: 13, quantidade: 4 },
  ] }, h(0.5), ana);
  liberar(n2, 0.4);
  const n3 = criar({ cliente_id: 7, itens: [{ produto_id: 14, quantidade: 24 }, { produto_id: 1, quantidade: 2 }, { produto_id: 8, quantidade: 6 }] }, h(0.2), carlos);
  completar(n3);
  // Daqui a pouco chega mais um, para ver o aviso em tempo real.
  setTimeout(() => {
    const novo = criar({ cliente_id: 4, itens: [{ produto_id: 12, quantidade: 2 }, { produto_id: 5, quantidade: 15 }, { produto_id: 7, quantidade: 30 }] }, new Date(), ana);
    eventos.emitir({ id: novo.id, status: novo.status, rotulo: ROTULOS[novo.status] });
  }, 25000);
}

if (PAPEL === 'expedicao') exemplosExpedicao(); else exemplosVendedor();

// Simula o gestor aprovando e a expedição recebendo, para o vendedor ver os avisos chegarem.
function simularAndamento(p) {
  if (p.status === 'AGUARDANDO_APROVACAO') {
    setTimeout(() => {
      if (p.status !== 'AGUARDANDO_APROVACAO') return;
      p.itens.forEach((i) => { if (i.aprovacao === 'pendente') i.aprovacao = 'aprovado'; });
      mudar(p, 'AGUARDANDO_EXPEDICAO', 'Preços aprovados pelo gestor', 'Gestor');
    }, 8000);
  }
}

// ---------- Eventos em tempo real (simulados) ----------
const eventos = {
  ouvintes: new Set(),
  emitir(dados) {
    for (const fn of this.ouvintes) fn({ data: JSON.stringify(dados) });
  },
};
window.EventSource = class {
  constructor() { this.fns = []; }
  addEventListener(tipo, fn) { if (tipo === 'pedido') eventos.ouvintes.add(fn); }
  close() {}
};

// ---------- "Sem internet" simulado ----------
let semInternet = false;
try {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !semInternet });
} catch { /* navegador não deixou: o indicador segue o estado real */ }
export function alternarInternet() {
  semInternet = !semInternet;
  window.dispatchEvent(new Event(semInternet ? 'offline' : 'online'));
  return semInternet;
}

// ---------- Rotas falsas ----------
const resposta = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
const resumo = (p) => ({
  id: p.id, status: p.status, rotulo_status: p.rotulo_status, total_centavos: p.total_centavos, criado_em: p.criado_em,
  lancado_em: p.lancado_em, cliente_nome: p.cliente_nome, cliente_fantasia: p.cliente_fantasia, vendedor_nome: p.vendedor_nome,
  qtd_itens: p.itens.length, itens_pendentes: p.itens.filter((i) => i.aprovacao === 'pendente').length,
  motivo_status: p.motivo_status, exportado_em: null, impresso_em: p.impresso_em,
});

const fetchOriginal = window.fetch.bind(window);
window.fetch = async (entrada, opcoes = {}) => {
  const url = new URL(typeof entrada === 'string' ? entrada : entrada.url, location.href);
  if (!url.pathname.startsWith('/api/')) return fetchOriginal(entrada, opcoes);
  await new Promise((r) => setTimeout(r, 150)); // parece uma chamada de rede
  if (semInternet) throw new TypeError('Failed to fetch');
  const metodo = (opcoes.method || 'GET').toUpperCase();
  const corpo = opcoes.body ? JSON.parse(opcoes.body) : {};
  const rota = url.pathname;
  let m;

  if (rota === '/api/login' && metodo === 'POST') {
    if (corpo.login?.toLowerCase() !== USUARIO.login) return resposta({ erro: `Na prévia, entre como ${USUARIO.login} / 123456` }, 401);
    return resposta({ token: 'demo', usuario: USUARIO });
  }
  if (rota === '/api/me') return resposta(USUARIO);
  if (rota === '/api/logout') return resposta({ ok: true });
  if (rota === '/api/status') return resposta({ rotulos: ROTULOS });
  if (rota === '/api/vendedor/pacote') return resposta(pacote());
  if (rota === '/api/pedidos' && metodo === 'GET') {
    const filtro = url.searchParams.get('status')?.split(',');
    return resposta([...pedidos.values()].filter((p) => !filtro || filtro.includes(p.status)).sort((a, b) => b.id - a.id).map(resumo));
  }
  if (rota === '/api/pedidos' && metodo === 'POST') {
    const p = criar(corpo);
    simularAndamento(p);
    return resposta(p, p.ja_existia ? 200 : 201);
  }
  if ((m = rota.match(/^\/api\/pedidos\/(\d+)$/))) {
    const p = pedidos.get(Number(m[1]));
    if (!p) return resposta({ erro: 'Pedido não encontrado' }, 404);
    if (metodo === 'GET') return resposta(p);
    if (metodo === 'PUT') {
      p.itens = montarItens(p.cliente_id, corpo.itens);
      p.observacao = corpo.observacao ?? p.observacao;
      const novo = p.itens.some((i) => i.aprovacao === 'pendente') ? 'AGUARDANDO_APROVACAO' : 'AGUARDANDO_EXPEDICAO';
      mudar(p, novo, 'Pedido alterado pelo vendedor', VENDEDOR.nome, { motivo_status: null });
      simularAndamento(p);
      return resposta(p);
    }
  }
  if ((m = rota.match(/^\/api\/pedidos\/(\d+)\/cancelar$/))) {
    const p = pedidos.get(Number(m[1]));
    mudar(p, 'CANCELADO', corpo.motivo ? `Cancelado: ${corpo.motivo}` : 'Cancelado', VENDEDOR.nome, { motivo_status: corpo.motivo || null });
    return resposta(p);
  }
  // ---- Expedição ----
  if ((m = rota.match(/^\/api\/pedidos\/(\d+)\/(aceitar|recusar|concluir|impresso)$/))) {
    const p = pedidos.get(Number(m[1]));
    const acao = m[2];
    if (acao === 'aceitar') {
      if (p.status !== 'AGUARDANDO_EXPEDICAO') return resposta({ erro: 'Pedido não está aguardando a expedição' }, 409);
      mudar(p, 'EM_SEPARACAO', 'Pedido aceito pela expedição', EXPEDICAO.nome);
    }
    if (acao === 'recusar') {
      p.itens.forEach((i) => Object.assign(i, { peso_real: null, peso_bruto: null, caixas: null, tara_kg: null }));
      mudar(p, 'REVISAO', `Recusado pela expedição: ${corpo.motivo}`, EXPEDICAO.nome, { motivo_status: corpo.motivo });
    }
    if (acao === 'concluir') {
      const faltam = p.itens.filter((i) => i.pesavel && i.peso_real == null).map((i) => i.descricao);
      if (faltam.length) return resposta({ erro: `Falta pesar: ${faltam.join(', ')}` }, 400);
      mudar(p, 'AGUARDANDO_FATURAMENTO', 'Separação/pesagem concluída. Enviado ao faturamento', EXPEDICAO.nome);
    }
    if (acao === 'impresso') {
      p.impresso_em = agoraSql();
      p.historico.push({ criado_em: agoraSql(), descricao: 'Pedido impresso', usuario_nome: EXPEDICAO.nome });
    }
    return resposta(p);
  }
  if ((m = rota.match(/^\/api\/pedidos\/(\d+)\/itens\/(\d+)\/peso$/))) {
    const p = pedidos.get(Number(m[1]));
    const i = p.itens.find((x) => x.id === Number(m[2]));
    if (p.status !== 'EM_SEPARACAO') return resposta({ erro: 'Aceite o pedido antes de pesar' }, 409);
    const arred = (n) => Math.round(n * 1000) / 1000;
    if (corpo.peso_bruto != null && corpo.peso_bruto !== '') {
      const bruto = Number(corpo.peso_bruto);
      const caixas = Number(corpo.caixas || 0);
      const tara = Number(i.tara_produto_kg || 0);
      if (!Number.isInteger(caixas) || caixas < 0) return resposta({ erro: 'Número de caixas inválido' }, 400);
      const liquido = arred(bruto - caixas * tara);
      if (!(liquido > 0)) return resposta({ erro: `Peso líquido ficou ${liquido} kg: confira o peso bruto e o número de caixas` }, 400);
      Object.assign(i, { peso_real: liquido, peso_bruto: arred(bruto), caixas, tara_kg: tara });
    } else if (corpo.peso === null || corpo.peso === '' || corpo.peso === undefined) {
      Object.assign(i, { peso_real: null, peso_bruto: null, caixas: null, tara_kg: null });
    } else {
      const v = Number(corpo.peso);
      const fracao = i.pesavel || i.unidade === 'KG';
      if (!(v >= 0)) return resposta({ erro: 'Valor inválido' }, 400);
      if (!fracao && !Number.isInteger(v)) return resposta({ erro: `Quantidade em ${i.unidade} deve ser inteira` }, 400);
      Object.assign(i, { peso_real: arred(v), peso_bruto: null, caixas: null, tara_kg: null });
    }
    completar(p);
    return resposta(p);
  }
  return resposta({ erro: 'Não disponível na prévia' }, 404);
};

// ---------- Comprovante de impressão (na prévia aparece na própria tela) ----------
function comprovante(p) {
  const q = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const m = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const e = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const linhas = p.itens.map((i) => `
    <div class="cp-desc">${e(i.codigo)} ${e(i.descricao)}</div>
    ${i.unidade_pedido ? `<div>Pedido: ${q(i.quantidade)} ${e(i.unidade_pedido)}</div>` : ''}
    ${i.peso_bruto != null && i.caixas ? `<div>Bruto ${q(i.peso_bruto)} kg - ${i.caixas} cx x ${q(i.tara_kg)} kg</div>` : ''}
    <div class="cp-linha"><span>${i.peso_real === 0 ? 'EM FALTA' : i.peso_real != null ? `${q(i.peso_real)} ${i.pesavel ? 'kg líq.' : e(i.unidade)}` : `${q(i.quantidade)} ${e(i.unidade)}`} x ${m(i.preco_centavos)}</span><span>${m(i.total_centavos)}</span></div>`).join('');
  return `<div class="cupom-previa" role="document" aria-label="Comprovante do pedido ${p.id}">
    <div class="cp-titulo">PEDIDO #${p.id}</div>
    <div class="cp-centro">${e(p.lancado_em.slice(8, 10))}/${e(p.lancado_em.slice(5, 7))} ${e(p.lancado_em.slice(11, 16))} · Vend.: ${e(p.vendedor_nome)}</div>
    <hr><div><strong>${e(p.cliente_fantasia)}</strong></div><div>${e(p.cliente_nome)}</div><div>${e(p.cliente_documento)} · ${e(p.cliente_cidade)}/${e(p.cliente_uf)}</div>
    <hr>${linhas}<hr>
    <div class="cp-linha cp-total"><span>TOTAL</span><span>${m(p.total_centavos)}</span></div>
    ${p.observacao ? `<hr><div><strong>OBS:</strong> ${e(p.observacao)}</div>` : ''}
    <hr><div>Conferido: ____________________</div></div>`;
}

window.open = (url) => {
  const id = Number(new URL(url, location.href).searchParams.get('id'));
  const p = pedidos.get(id);
  if (!p) return null;
  p.impresso_em = agoraSql();
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `<div class="modal"><button class="modal-fechar" aria-label="Fechar">×</button>
    <h2>Comprovante que sai na impressora</h2>
    <p class="dica">Na prévia o comprovante aparece aqui. No sistema, ele vai direto para a impressora térmica de 80 mm.</p>
    ${comprovante(p)}</div>`;
  fundo.addEventListener('click', (ev) => { if (ev.target === fundo || ev.target.closest('.modal-fechar')) fundo.remove(); });
  document.body.append(fundo);
  return { close() { fundo.remove(); } };
};

// Na prévia, as caixas de confirmação do navegador não aparecem: confirma direto.
window.confirm = () => true;
window.prompt = (_msg, padrao = '') => padrao || 'Motivo de teste (prévia)';

// Entra direto como vendedor.
try { localStorage.setItem('token', 'demo'); } catch { /* sem armazenamento: usa a tela de login */ }

// PRÉVIA: simula o servidor dentro do navegador, só para mostrar o layout do vendedor.
// Intercepta as chamadas /api/* e responde com dados fictícios em memória.
// Nada é gravado de verdade; recarregar a página recomeça a demonstração.
import { catalogoLocal } from './offline.js';

const VENDEDOR = { id: 2, nome: 'Carlos Vendedor', login: 'carlos', papel: 'vendedor' };
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

function criar({ cliente_id, itens, observacao, uuid, lancado_em }, quando = new Date()) {
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
    vendedor_id: VENDEDOR.id, vendedor_nome: VENDEDOR.nome, observacao: observacao || null, motivo_status: null,
    criado_em: agoraSql(quando), lancado_em: lancado_em ? agoraSql(new Date(lancado_em)) : agoraSql(quando),
    impresso_em: null, nota_fiscal: null, exportado_em: null, itens: its,
    historico: [{ criado_em: agoraSql(quando), descricao: 'Pedido lançado', usuario_nome: VENDEDOR.nome }],
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
(function exemplos() {
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
}());

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
    if (corpo.login?.toLowerCase() !== 'carlos') return resposta({ erro: 'Na prévia, entre como carlos / 123456' }, 401);
    return resposta({ token: 'demo', usuario: VENDEDOR });
  }
  if (rota === '/api/me') return resposta(VENDEDOR);
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
  return resposta({ erro: 'Não disponível na prévia' }, 404);
};

// Na prévia, as caixas de confirmação do navegador não aparecem: confirma direto.
window.confirm = () => true;
window.prompt = (_msg, padrao = '') => padrao || 'Cancelado na prévia';

// Entra direto como vendedor.
try { localStorage.setItem('token', 'demo'); } catch { /* sem armazenamento: usa a tela de login */ }

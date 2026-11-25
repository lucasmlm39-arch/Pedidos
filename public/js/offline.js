// Modo offline do vendedor.
// - Guarda no aparelho (IndexedDB) clientes, produtos e tabelas de preço ("pacote").
// - Pedidos são salvos primeiro numa fila local e enviados quando houver conexão.
// - Cada pedido tem um identificador único (uuid): reenviar não duplica no servidor.
import { api, ErroApi, sessao } from './util.js';

const BANCO = 'pedidos-offline';
let conexaoDb = null;

function abrir() {
  if (conexaoDb) return conexaoDb;
  conexaoDb = new Promise((ok, falha) => {
    const req = indexedDB.open(BANCO, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('kv');
      db.createObjectStore('fila', { keyPath: 'uuid' });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
  return conexaoDb;
}

// Se o navegador bloquear o IndexedDB (janela anônima, prévia), guarda só na memória desta aba.
const memoria = { kv: new Map(), fila: new Map() };
function lojaMemoria(nome) {
  const m = memoria[nome];
  return {
    get: (k) => ({ result: m.get(k) }),
    getAll: () => ({ result: [...m.values()] }),
    put: (v, k) => { m.set(nome === 'fila' ? v.uuid : k, structuredClone(v)); return { result: undefined }; },
    delete: (k) => { m.delete(k); return { result: undefined }; },
  };
}

async function operar(loja, modo, fn) {
  let db;
  try {
    db = await abrir();
  } catch {
    conexaoDb = Promise.reject(new Error('IndexedDB indisponível'));
    conexaoDb.catch(() => {});
    return fn(lojaMemoria(loja))?.result;
  }
  return new Promise((ok, falha) => {
    const tx = db.transaction(loja, modo);
    const r = fn(tx.objectStore(loja));
    tx.oncomplete = () => ok(r?.result);
    tx.onerror = () => falha(tx.error);
  });
}

export const kvLer = (chave) => operar('kv', 'readonly', (s) => s.get(chave)).catch(() => undefined);
export const kvGravar = (chave, valor) => operar('kv', 'readwrite', (s) => s.put(valor, chave));
// Só os pedidos do usuário logado (o aparelho pode ser compartilhado).
export const filaListar = async () => ((await operar('fila', 'readonly', (s) => s.getAll()).catch(() => [])) || [])
  .filter((p) => p.usuario_id === sessao.usuario?.id)
  .sort((a, b) => a.lancado_em.localeCompare(b.lancado_em));
const filaGravar = (p) => operar('fila', 'readwrite', (s) => s.put(p));
export const filaRemover = (uuid) => operar('fila', 'readwrite', (s) => s.delete(uuid));

export function novoUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); // funciona também fora de HTTPS
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Erro de rede (sem conexão) x erro de regra de negócio vindo do servidor.
export const semConexao = (e) => !(e instanceof ErroApi);

// ---------- Pacote de dados ----------
let pacoteMemoria = null;

export async function baixarPacote() {
  const p = await api('GET', '/api/vendedor/pacote');
  pacoteMemoria = p;
  await kvGravar('pacote', p);
  avisar();
  return p;
}

export async function pacoteLocal() {
  if (!pacoteMemoria) pacoteMemoria = (await kvLer('pacote')) || null;
  if (pacoteMemoria && pacoteMemoria.usuario?.id !== sessao.usuario?.id) pacoteMemoria = null; // pacote de outro usuário
  return pacoteMemoria;
}

// Mesma regra do servidor: tabela do cliente > tabela do grupo > padrão; empate = menor preço.
export function catalogoLocal(pacote, clienteId) {
  const cliente = pacote.clientes.find((c) => c.id === clienteId);
  const melhor = new Map();
  for (const t of pacote.tabelas) {
    let prioridade = null;
    if (t.clientes.includes(clienteId)) prioridade = 1;
    else if (cliente?.grupo_id != null && t.grupos.includes(cliente.grupo_id)) prioridade = 2;
    else if (t.padrao) prioridade = 3;
    if (prioridade == null) continue;
    for (const [produtoId, preco] of t.precos) {
      const atual = melhor.get(produtoId);
      if (!atual || prioridade < atual.prioridade || (prioridade === atual.prioridade && preco < atual.preco_centavos)) {
        melhor.set(produtoId, { prioridade, preco_centavos: preco, tabela_id: t.id, tabela_nome: t.nome });
      }
    }
  }
  return pacote.produtos.map((p) => {
    const m = melhor.get(p.id);
    return { ...p, preco_centavos: m?.preco_centavos ?? null, tabela_id: m?.tabela_id ?? null, tabela_nome: m?.tabela_nome ?? null };
  });
}

export function buscarClientesLocal(pacote, termo) {
  const t = termo.trim().toLowerCase();
  const so = (s) => String(s || '').toLowerCase();
  return pacote.clientes.filter((c) => !t || [c.razao_social, c.nome_fantasia, c.codigo, c.documento, c.cidade].some((x) => so(x).includes(t)));
}

// ---------- Fila de pedidos ----------
export async function salvarNaFila(pedido) {
  const registro = { uuid: novoUuid(), lancado_em: new Date().toISOString(), erro: null, usuario_id: sessao.usuario.id, ...pedido };
  await filaGravar(registro);
  avisar();
  return registro;
}

export async function atualizarNaFila(registro) {
  await filaGravar({ ...registro, erro: null });
  avisar();
}

let sincronizando = null;

// Envia os pedidos da fila. Retorna { enviados: [pedidoServidor], erros, semConexao }.
export function sincronizar() {
  if (sincronizando) return sincronizando;
  sincronizando = (async () => {
    const resultado = { enviados: [], erros: 0, semConexao: false };
    for (const item of await filaListar()) {
      try {
        const salvo = await api('POST', '/api/pedidos', {
          uuid: item.uuid,
          lancado_em: item.lancado_em,
          cliente_id: item.cliente.id,
          observacao: item.observacao,
          itens: item.itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_centavos: i.preco_centavos })),
        });
        await filaRemover(item.uuid);
        resultado.enviados.push({ ...salvo, uuid_local: item.uuid });
      } catch (e) {
        if (semConexao(e)) { resultado.semConexao = true; break; }
        item.erro = e.message; // recusado pelo servidor: fica na fila para o vendedor corrigir
        await filaGravar(item);
        resultado.erros++;
      }
    }
    if (!resultado.semConexao) await kvGravar('ultima_sincronizacao', new Date().toISOString());
    avisar();
    return resultado;
  })().finally(() => { sincronizando = null; });
  return sincronizando;
}

// ---------- Estado (para o indicador no topo) ----------
const ouvintes = new Set();
export const aoMudarEstado = (fn) => ouvintes.add(fn);
async function avisar() {
  const estado = await estadoOffline();
  ouvintes.forEach((fn) => fn(estado));
}
export async function estadoOffline() {
  const pacote = await pacoteLocal();
  return {
    online: navigator.onLine,
    pendentes: (await filaListar()).length,
    dadosDe: pacote?.gerado_em || null,
    ultimaSync: (await kvLer('ultima_sincronizacao')) || null,
  };
}
window.addEventListener('online', avisar);
window.addEventListener('offline', avisar);

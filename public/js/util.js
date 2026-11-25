// Utilitários compartilhados pelas telas.
export const sessao = {
  get token() { try { return localStorage.getItem('token'); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem('token', v) : localStorage.removeItem('token'); } catch {} },
  usuario: null,
};

export class ErroApi extends Error {}

export async function api(metodo, rota, corpo) {
  const r = await fetch(rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(sessao.token ? { Authorization: `Bearer ${sessao.token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados = null;
  try { dados = await r.json(); } catch {}
  if (r.status === 401 && rota !== '/api/login') {
    sessao.token = null;
    location.reload();
  }
  if (!r.ok) throw new ErroApi(dados?.erro || `Erro ${r.status}`);
  return dados;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (centavos) => (centavos == null ? '—' : fmtMoeda.format(centavos / 100));
export const centavosParaTexto = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
export function textoParaCentavos(t) {
  let s = String(t ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export const numero = (t) => Number(String(t ?? '').replace(',', '.'));
export const qtd = (q, un) => `${Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${esc(un || '')}`;
export function dataHora(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export const CORES_STATUS = {
  AGUARDANDO_APROVACAO: 'alerta', REVISAO: 'perigo', AGUARDANDO_EXPEDICAO: 'info',
  EM_SEPARACAO: 'info', AGUARDANDO_FATURAMENTO: 'roxo', FATURADO: 'ok', CANCELADO: 'neutro',
};
export const selo = (p) => `<span class="selo selo-${CORES_STATUS[p.status] || 'neutro'}">${esc(p.rotulo_status)}</span>`;

export function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = msg;
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}

// Executa uma ação mostrando erro amigável.
export async function tentar(fn, sucesso) {
  try {
    const r = await fn();
    if (sucesso) toast(sucesso);
    return r;
  } catch (e) {
    toast(e.message, 'erro');
    throw e;
  }
}

export function modal(html, { largo = false } = {}) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `<div class="modal ${largo ? 'modal-largo' : ''}" role="dialog" aria-modal="true">
    <button class="modal-fechar" aria-label="Fechar">×</button><div class="modal-corpo">${html}</div></div>`;
  const fechar = () => fundo.remove();
  fundo.addEventListener('click', (e) => { if (e.target === fundo || e.target.closest('.modal-fechar')) fechar(); });
  document.body.append(fundo);
  return { el: fundo.querySelector('.modal-corpo'), fechar };
}

export function formDados(form) {
  const d = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    d[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return d;
}

export const vazio = (msg) => `<div class="vazio">${esc(msg)}</div>`;

// Inicialização: login, menu por perfil e notificações em tempo real.
import { api, sessao, esc, toast, tentar } from './util.js';
import { telaNovoPedido, telaMeusPedidos } from './vendedor.js';
import { telaFaturamento, telaAprovacoes, telaTodosPedidos } from './operacao.js';
import { telaExpedicao } from './expedicao.js';
import { sincronizar, baixarPacote, aoMudarEstado, estadoOffline, filaListar, semConexao } from './offline.js';
import { telaClientes, telaGrupos, telaProdutos, telaTabelas, telaUsuarios } from './gestor.js';

const TELAS = {
  'novo-pedido': { titulo: 'Novo pedido', fn: telaNovoPedido },
  'meus-pedidos': { titulo: 'Meus pedidos', fn: telaMeusPedidos },
  aprovacoes: { titulo: 'Aprovações', fn: telaAprovacoes },
  pedidos: { titulo: 'Pedidos', fn: telaTodosPedidos },
  expedicao: { titulo: 'Expedição', fn: telaExpedicao },
  faturamento: { titulo: 'Faturamento', fn: telaFaturamento },
  tabelas: { titulo: 'Tabelas de preço', fn: telaTabelas },
  clientes: { titulo: 'Clientes', fn: telaClientes },
  grupos: { titulo: 'Grupos', fn: telaGrupos },
  produtos: { titulo: 'Produtos', fn: telaProdutos },
  usuarios: { titulo: 'Usuários', fn: telaUsuarios },
};

const MENU = {
  vendedor: ['novo-pedido', 'meus-pedidos'],
  expedicao: ['expedicao'],
  faturamento: ['faturamento'],
  gestor: ['aprovacoes', 'pedidos', 'expedicao', 'faturamento', 'tabelas', 'clientes', 'grupos', 'produtos', 'usuarios'],
};
const NOME_PAPEL = { vendedor: 'Vendedor', expedicao: 'Expedição', faturamento: 'Faturamento', gestor: 'Gestor' };


function irPara(chave) {
  try { history.replaceState(null, '', `#${chave}`); } catch { /* ambiente restrito */ }
  document.querySelectorAll('[data-tela]').forEach((b) => b.classList.toggle('ativo', b.dataset.tela === chave));
  // Troca o contêiner para descartar listeners da tela anterior.
  const novo = document.createElement('main');
  novo.id = 'conteudo';
  conteudoAtual().replaceWith(novo);
  TELAS[chave].fn(novo, irPara);
}

function conteudoAtual() { return document.getElementById('conteudo'); }

function montarMenu() {
  const itens = MENU[sessao.usuario.papel];
  document.getElementById('menu').innerHTML = itens
    .map((k) => `<button class="aba" data-tela="${k}">${esc(TELAS[k].titulo)}<span class="badge" data-badge="${k}" hidden></span></button>`).join('');
  document.getElementById('menu').onclick = (e) => {
    const b = e.target.closest('[data-tela]');
    if (b) irPara(b.dataset.tela);
  };
  document.getElementById('usuario').innerHTML = `${esc(sessao.usuario.nome)} <small>${NOME_PAPEL[sessao.usuario.papel]}</small>`;
  const inicial = location.hash.slice(1);
  irPara(itens.includes(inicial) ? inicial : itens[0]);
}

// Contadores no menu (pendências).
async function atualizarBadges() {
  const papel = sessao.usuario.papel;
  const contar = async (status) => (await api('GET', `/api/pedidos?status=${status}`)).length;
  const marcar = (k, n) => {
    const b = document.querySelector(`[data-badge="${k}"]`);
    if (b) { b.hidden = !n; b.textContent = n; }
  };
  try {
    if (papel === 'gestor') marcar('aprovacoes', await contar('AGUARDANDO_APROVACAO'));
    if (papel === 'gestor' || papel === 'expedicao') marcar('expedicao', await contar('AGUARDANDO_EXPEDICAO,EM_SEPARACAO'));
    if (papel === 'gestor' || papel === 'faturamento') marcar('faturamento', await contar('AGUARDANDO_FATURAMENTO'));
    if (papel === 'vendedor') marcar('meus-pedidos', await contar('REVISAO'));
  } catch { /* ignora */ }
}

function notificarNavegador(titulo, corpo) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  try { new Notification(titulo, { body: corpo, tag: titulo + corpo }); } catch { /* ignora */ }
}

function mensagemEvento(ev) {
  const papel = sessao.usuario.papel;
  const m = {
    AGUARDANDO_APROVACAO: papel === 'gestor' && `Pedido #${ev.id} tem preço abaixo da tabela para aprovar`,
    REVISAO: papel === 'vendedor' && `Pedido #${ev.id} voltou para ajuste`,
    AGUARDANDO_EXPEDICAO: papel === 'expedicao' ? `Novo pedido #${ev.id} para a expedição` : papel === 'vendedor' && `Pedido #${ev.id} liberado para a expedição`,
    AGUARDANDO_FATURAMENTO: papel === 'faturamento' ? `Pedido #${ev.id} pronto para faturar` : papel === 'vendedor' && `Pedido #${ev.id} pesado e enviado ao faturamento`,
    FATURADO: papel === 'vendedor' && `Pedido #${ev.id} faturado`,
    CANCELADO: papel !== 'gestor' && `Pedido #${ev.id} cancelado`,
  };
  return m[ev.status] || null;
}

function conectarEventos() {
  const fonte = new EventSource(`/api/eventos?token=${encodeURIComponent(sessao.token)}`);
  fonte.addEventListener('pedido', (e) => {
    const ev = JSON.parse(e.data);
    const msg = mensagemEvento(ev);
    if (msg) {
      toast(msg, 'info');
      notificarNavegador('Pedidos', msg);
    }
    atualizarBadges();
    const alvo = conteudoAtual();
    if (alvo.recarregar && !document.querySelector('.modal-fundo')) alvo.recarregar().catch(() => {});
  });
}

// ---------- Modo offline (vendedor) ----------
function renderEstadoConexao(e) {
  const el = document.getElementById('conexao');
  const quando = e.dadosDe ? new Date(e.dadosDe).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca';
  el.hidden = false;
  el.className = `conexao ${e.online ? 'conexao-on' : 'conexao-off'}`;
  el.innerHTML = `<span class="ponto"></span>${e.online ? 'Online' : 'Offline'}${e.pendentes ? ` · <strong>${e.pendentes} a enviar</strong>` : ''}`;
  el.title = `Dados de clientes e preços atualizados em ${quando}. Toque para sincronizar.`;
}

async function sincronizarTudo({ silencioso = false } = {}) {
  try {
    const r = await sincronizar();
    if (r.enviados.length) toast(`${r.enviados.length} pedido(s) do aparelho enviado(s) ao servidor`);
    if (r.erros) toast(`${r.erros} pedido(s) recusado(s): veja em "Meus pedidos"`, 'erro');
    if (!r.semConexao) await baixarPacote();
    else if (!silencioso) toast('Sem conexão com o servidor', 'erro');
    if (r.enviados.length || r.erros) conteudoAtual().recarregar?.().catch(() => {});
  } catch (e) {
    if (!silencioso) toast(semConexao(e) ? 'Sem conexão com o servidor' : e.message, 'erro');
  }
}

function iniciarOffline() {
  aoMudarEstado(renderEstadoConexao);
  estadoOffline().then(renderEstadoConexao);
  document.getElementById('conexao').onclick = () => sincronizarTudo();
  window.addEventListener('online', () => sincronizarTudo({ silencioso: true }));
  setInterval(async () => {
    if (navigator.onLine && (await filaListar()).length) sincronizarTudo({ silencioso: true });
  }, 60000);
  setInterval(() => navigator.onLine && baixarPacote().catch(() => {}), 30 * 60000); // preços atualizados
  sincronizarTudo({ silencioso: true });
}

async function entrar({ offline = false } = {}) {
  document.getElementById('tela-login').hidden = true;
  document.getElementById('app').hidden = false;
  try { localStorage.setItem('usuario', JSON.stringify(sessao.usuario)); } catch {}
  montarMenu();
  if (sessao.usuario.papel === 'vendedor') iniciarOffline();
  if (offline) return;
  atualizarBadges();
  conectarEventos();
  if ('Notification' in window && Notification.permission === 'default') {
    const b = document.getElementById('ativar-notificacoes');
    b.hidden = false;
    b.onclick = async () => { await Notification.requestPermission(); b.hidden = true; };
  }
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await tentar(() => api('POST', '/api/login', { login: f.login.value, senha: f.senha.value }));
    sessao.token = r.token;
    sessao.usuario = r.usuario;
    entrar();
  } catch { f.senha.select(); }
});

document.getElementById('sair').onclick = async () => {
  if (sessao.usuario?.papel === 'vendedor') {
    const pendentes = (await filaListar()).length;
    if (pendentes && !confirm(`Há ${pendentes} pedido(s) no aparelho ainda não enviados. Eles só serão enviados quando você entrar de novo. Sair mesmo assim?`)) return;
  }
  await api('POST', '/api/logout').catch(() => {});
  sessao.token = null;
  try { localStorage.removeItem('usuario'); } catch {}
  location.hash = '';
  location.reload();
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* exige HTTPS (ou localhost) */ });
}

(async () => {
  if (sessao.token) {
    try {
      sessao.usuario = await api('GET', '/api/me');
      return entrar();
    } catch (e) {
      // Sem conexão: entra com o usuário guardado no aparelho (modo offline).
      let guardado = null;
      try { guardado = JSON.parse(localStorage.getItem('usuario')); } catch {}
      if (semConexao(e) && guardado) {
        sessao.usuario = guardado;
        return entrar({ offline: true });
      }
      sessao.token = null;
    }
  }
  document.getElementById('tela-login').hidden = false;
})();

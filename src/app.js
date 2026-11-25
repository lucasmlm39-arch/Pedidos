// Monta a aplicação Express (separado do server.js para facilitar os testes).
const path = require('node:path');
const express = require('express');
const { conferirSenha, criarSessao, exigirLogin, exigirPapel } = require('./auth');
const { Eventos } = require('./eventos');
const { rotasCadastros } = require('./rotas/cadastros');
const { rotasPedidos } = require('./rotas/pedidos');
const { STATUS, ROTULOS } = require('./pedidos');
const { exportarPedidos } = require('./exportacao');

function criarApp(db) {
  const app = express();
  const ev = new Eventos();
  app.locals.eventos = ev;

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    // Sem cache HTTP para HTML/JS/CSS: o service worker cuida do offline e as atualizações chegam na hora.
    setHeaders: (res, arquivo) => {
      if (/\.(html|js|css|webmanifest)$/.test(arquivo)) res.set('Cache-Control', 'no-cache');
    },
  }));

  app.post('/api/login', (req, res) => {
    const login = String(req.body.login || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM usuarios WHERE login = ? AND ativo = 1').get(login);
    if (!u || !conferirSenha(String(req.body.senha || ''), u.senha_hash)) {
      return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
    }
    const token = criarSessao(db, u.id);
    res.json({ token, usuario: { id: u.id, nome: u.nome, login: u.login, papel: u.papel } });
  });

  const auth = exigirLogin(db);
  app.post('/api/logout', auth, (req, res) => {
    db.prepare('DELETE FROM sessoes WHERE token = ?').run(req.token);
    res.json({ ok: true });
  });
  app.get('/api/me', auth, (req, res) => res.json(req.usuario));
  app.get('/api/status', auth, (req, res) => res.json({ status: STATUS, rotulos: ROTULOS }));
  app.get('/api/eventos', auth, (req, res) => ev.conectar(req, res));
  app.use('/api/pedidos', auth, rotasPedidos(db, ev));
  // Exportação para o Visual Software: gera o arquivo e marca os pedidos como exportados.
  app.post('/api/exportacao', auth, exigirPapel('faturamento'), (req, res) => {
    const arq = exportarPedidos(db, req.usuario, {
      ids: req.body.ids,
      formato: req.body.formato,
      codificacao: req.body.codificacao,
      incluirExportados: Boolean(req.body.incluir_exportados),
    });
    res.set({
      'Content-Type': arq.tipo,
      'Content-Disposition': `attachment; filename="${arq.nome}"`,
      'X-Quantidade-Pedidos': String(arq.quantidade),
    });
    res.send(arq.conteudo);
  });
  app.use('/api', auth, rotasCadastros(db));

  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

  // Tratamento de erros: regras de negócio, restrições do banco e erros inesperados.
  app.use((err, req, res, _next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ erro: err.message });
    const msg = String(err.message || '');
    if (msg.includes('UNIQUE constraint failed')) return res.status(409).json({ erro: 'Registro duplicado (código/nome/login já existe)' });
    if (msg.includes('FOREIGN KEY constraint failed')) return res.status(400).json({ erro: 'Referência inválida (cliente, grupo, produto ou usuário inexistente)' });
    if (msg.includes('CHECK constraint failed')) return res.status(400).json({ erro: 'Dados inválidos' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno' });
  });

  return app;
}

module.exports = { criarApp };

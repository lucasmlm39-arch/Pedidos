// Autenticação simples: senha com scrypt + token de sessão (Bearer).
const crypto = require('node:crypto');

function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

function conferirSenha(senha, armazenado) {
  const [sal, hash] = String(armazenado).split(':');
  if (!sal || !hash) return false;
  const calc = crypto.scryptSync(senha, sal, 64);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

function criarSessao(db, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes (token, usuario_id) VALUES (?, ?)').run(token, usuarioId);
  return token;
}

function usuarioDoToken(db, token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.nome, u.login, u.papel FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND u.ativo = 1`).get(token) || null;
}

// Middleware: exige login. Aceita "Authorization: Bearer <token>" ou ?token= (usado pelo EventSource).
function exigirLogin(db) {
  return (req, res, next) => {
    const cab = req.get('authorization') || '';
    const token = cab.startsWith('Bearer ') ? cab.slice(7) : req.query.token;
    const usuario = usuarioDoToken(db, token);
    if (!usuario) return res.status(401).json({ erro: 'Não autenticado' });
    req.usuario = usuario;
    req.token = token;
    next();
  };
}

// Middleware: exige um dos papéis informados. O gestor sempre tem acesso.
function exigirPapel(...papeis) {
  return (req, res, next) => {
    const p = req.usuario?.papel;
    if (p === 'gestor' || papeis.includes(p)) return next();
    res.status(403).json({ erro: 'Sem permissão para esta ação' });
  };
}

module.exports = { hashSenha, conferirSenha, criarSessao, usuarioDoToken, exigirLogin, exigirPapel };

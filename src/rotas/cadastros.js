// Cadastros mantidos pelo gestor: clientes, grupos, produtos, tabelas de preço e usuários.
const express = require('express');
const { exigirPapel, hashSenha } = require('../auth');
const { transacao } = require('../db');
const { catalogoDoCliente } = require('../precos');
const { ErroNegocio } = require('../pedidos');
const { importarClientes, importarProdutos } = require('../exportacao');

const PAPEIS = ['vendedor', 'expedicao', 'gestor', 'faturamento'];

const texto = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const idOuNull = (v) => (v == null || v === '' ? null : Number(v));

// Aceita "12,50", "12.50", "1.234,56" ou número; retorna centavos.
function reaisParaCentavos(v) {
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function exigir(valor, nome) {
  if (valor == null) throw new ErroNegocio(`Campo obrigatório: ${nome}`);
  return valor;
}

function rotasCadastros(db) {
  const r = express.Router();
  const gestor = exigirPapel(); // apenas gestor

  // ----- Grupos de clientes -----
  r.get('/grupos', (req, res) => {
    res.json(db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM clientes c WHERE c.grupo_id = g.id) AS qtd_clientes
                         FROM grupos_clientes g ORDER BY g.nome`).all());
  });
  r.post('/grupos', gestor, (req, res) => {
    const rr = db.prepare('INSERT INTO grupos_clientes (nome) VALUES (?)').run(exigir(texto(req.body.nome), 'nome'));
    res.status(201).json({ id: Number(rr.lastInsertRowid) });
  });
  r.put('/grupos/:id', gestor, (req, res) => {
    db.prepare('UPDATE grupos_clientes SET nome = ? WHERE id = ?').run(exigir(texto(req.body.nome), 'nome'), Number(req.params.id));
    res.json({ ok: true });
  });

  // ----- Clientes -----
  r.get('/clientes', (req, res) => {
    const cond = [];
    const p = {};
    if (req.usuario.papel === 'vendedor') {
      cond.push('c.ativo = 1 AND (c.vendedor_id IS NULL OR c.vendedor_id = :vend)');
      p.vend = req.usuario.id;
    }
    if (req.query.busca) {
      cond.push('(c.razao_social LIKE :b OR c.nome_fantasia LIKE :b OR c.codigo LIKE :b OR c.documento LIKE :b OR c.cidade LIKE :b)');
      p.b = `%${req.query.busca}%`;
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    res.json(db.prepare(`
      SELECT c.*, g.nome AS grupo_nome, u.nome AS vendedor_nome FROM clientes c
      LEFT JOIN grupos_clientes g ON g.id = c.grupo_id LEFT JOIN usuarios u ON u.id = c.vendedor_id
      ${where} ORDER BY c.razao_social LIMIT 500`).all(p));
  });
  const camposCliente = (b) => ({
    codigo: texto(b.codigo),
    razao_social: exigir(texto(b.razao_social), 'razão social'),
    nome_fantasia: texto(b.nome_fantasia),
    documento: texto(b.documento),
    cidade: texto(b.cidade),
    uf: texto(b.uf)?.toUpperCase() ?? null,
    telefone: texto(b.telefone),
    grupo_id: idOuNull(b.grupo_id),
    vendedor_id: idOuNull(b.vendedor_id),
    ativo: b.ativo === undefined ? 1 : bool(b.ativo),
  });
  r.post('/clientes', gestor, (req, res) => {
    const c = camposCliente(req.body);
    const rr = db.prepare(`INSERT INTO clientes (codigo, razao_social, nome_fantasia, documento, cidade, uf, telefone, grupo_id, vendedor_id, ativo)
      VALUES (:codigo, :razao_social, :nome_fantasia, :documento, :cidade, :uf, :telefone, :grupo_id, :vendedor_id, :ativo)`).run(c);
    res.status(201).json({ id: Number(rr.lastInsertRowid) });
  });
  r.put('/clientes/:id', gestor, (req, res) => {
    const c = camposCliente(req.body);
    db.prepare(`UPDATE clientes SET codigo = :codigo, razao_social = :razao_social, nome_fantasia = :nome_fantasia,
      documento = :documento, cidade = :cidade, uf = :uf, telefone = :telefone, grupo_id = :grupo_id,
      vendedor_id = :vendedor_id, ativo = :ativo WHERE id = :id`).run({ ...c, id: Number(req.params.id) });
    res.json({ ok: true });
  });
  // Importação em lote (texto colado/arquivo exportado do Visual Software).
  r.post('/clientes/lote', gestor, (req, res) => res.json(importarClientes(db, req.body.texto)));
  r.post('/produtos/lote', gestor, (req, res) => res.json(importarProdutos(db, req.body.texto)));

  // Pacote para o modo offline do vendedor: clientes, produtos e tabelas de preço.
  // O aparelho calcula o preço de cada cliente com a mesma regra do servidor (cliente > grupo > padrão).
  r.get('/vendedor/pacote', (req, res) => {
    const vendedor = req.usuario.papel === 'vendedor';
    const clientes = db.prepare(`
      SELECT c.id, c.codigo, c.razao_social, c.nome_fantasia, c.documento, c.cidade, c.uf, c.grupo_id, g.nome AS grupo_nome
      FROM clientes c LEFT JOIN grupos_clientes g ON g.id = c.grupo_id
      WHERE c.ativo = 1 ${vendedor ? 'AND (c.vendedor_id IS NULL OR c.vendedor_id = ?)' : ''}
      ORDER BY c.razao_social`).all(...(vendedor ? [req.usuario.id] : []));
    const produtos = db.prepare(`SELECT id, codigo, descricao, unidade, pesavel, unidade_pedido, peso_medio_kg, tara_kg
      FROM produtos WHERE ativo = 1 ORDER BY descricao`).all();
    const tabelas = db.prepare('SELECT id, nome, padrao FROM tabelas_preco WHERE ativo = 1').all().map((t) => ({
      ...t,
      precos: db.prepare('SELECT produto_id, preco_centavos FROM tabela_preco_itens WHERE tabela_id = ?').all(t.id)
        .map((i) => [i.produto_id, i.preco_centavos]),
      clientes: db.prepare('SELECT cliente_id FROM tabela_preco_vinculos WHERE tabela_id = ? AND cliente_id IS NOT NULL').all(t.id).map((v) => v.cliente_id),
      grupos: db.prepare('SELECT grupo_id FROM tabela_preco_vinculos WHERE tabela_id = ? AND grupo_id IS NOT NULL').all(t.id).map((v) => v.grupo_id),
    }));
    res.json({ gerado_em: new Date().toISOString(), usuario: req.usuario, clientes, produtos, tabelas });
  });

  // Produtos com o preço de tabela que vale para este cliente.
  r.get('/clientes/:id/catalogo', (req, res) => {
    res.json(catalogoDoCliente(db, Number(req.params.id)));
  });

  // ----- Produtos -----
  r.get('/produtos', (req, res) => {
    const where = req.usuario.papel === 'gestor' ? '' : 'WHERE ativo = 1';
    res.json(db.prepare(`SELECT * FROM produtos ${where} ORDER BY descricao`).all());
  });
  const numOuNull = (v, nome) => {
    if (v == null || String(v).trim() === '') return null;
    const n = Number(String(v).replace(',', '.'));
    if (!(n >= 0)) throw new ErroNegocio(`${nome} inválido`);
    return n;
  };
  const camposProduto = (b) => ({
    codigo: exigir(texto(b.codigo), 'código'),
    descricao: exigir(texto(b.descricao), 'descrição'),
    unidade: (texto(b.unidade) || 'UN').toUpperCase(),
    pesavel: bool(b.pesavel),
    unidade_pedido: texto(b.unidade_pedido)?.toUpperCase() ?? null,
    peso_medio_kg: numOuNull(b.peso_medio_kg, 'Peso médio'),
    tara_kg: numOuNull(b.tara_kg, 'Tara'),
    ativo: b.ativo === undefined ? 1 : bool(b.ativo),
  });
  r.post('/produtos', gestor, (req, res) => {
    const rr = db.prepare(`INSERT INTO produtos (codigo, descricao, unidade, pesavel, unidade_pedido, peso_medio_kg, tara_kg, ativo)
      VALUES (:codigo, :descricao, :unidade, :pesavel, :unidade_pedido, :peso_medio_kg, :tara_kg, :ativo)`).run(camposProduto(req.body));
    res.status(201).json({ id: Number(rr.lastInsertRowid) });
  });
  r.put('/produtos/:id', gestor, (req, res) => {
    db.prepare(`UPDATE produtos SET codigo = :codigo, descricao = :descricao, unidade = :unidade,
      pesavel = :pesavel, unidade_pedido = :unidade_pedido, peso_medio_kg = :peso_medio_kg, tara_kg = :tara_kg,
      ativo = :ativo WHERE id = :id`).run({ ...camposProduto(req.body), id: Number(req.params.id) });
    res.json({ ok: true });
  });

  // ----- Tabelas de preço -----
  r.get('/tabelas', gestor, (req, res) => {
    res.json(db.prepare(`
      SELECT t.*,
        (SELECT COUNT(*) FROM tabela_preco_itens i WHERE i.tabela_id = t.id) AS qtd_itens,
        (SELECT COUNT(*) FROM tabela_preco_vinculos v WHERE v.tabela_id = t.id AND v.cliente_id IS NOT NULL) AS qtd_clientes,
        (SELECT COUNT(*) FROM tabela_preco_vinculos v WHERE v.tabela_id = t.id AND v.grupo_id IS NOT NULL) AS qtd_grupos
      FROM tabelas_preco t ORDER BY t.padrao DESC, t.nome`).all());
  });
  r.get('/tabelas/:id', gestor, (req, res) => {
    const id = Number(req.params.id);
    const t = db.prepare('SELECT * FROM tabelas_preco WHERE id = ?').get(id);
    if (!t) throw new ErroNegocio('Tabela não encontrada', 404);
    t.itens = db.prepare(`SELECT i.produto_id, i.preco_centavos, p.codigo, p.descricao, p.unidade
      FROM tabela_preco_itens i JOIN produtos p ON p.id = i.produto_id WHERE i.tabela_id = ? ORDER BY p.descricao`).all(id);
    t.clientes = db.prepare('SELECT cliente_id FROM tabela_preco_vinculos WHERE tabela_id = ? AND cliente_id IS NOT NULL').all(id).map((v) => v.cliente_id);
    t.grupos = db.prepare('SELECT grupo_id FROM tabela_preco_vinculos WHERE tabela_id = ? AND grupo_id IS NOT NULL').all(id).map((v) => v.grupo_id);
    res.json(t);
  });
  r.post('/tabelas', gestor, (req, res) => {
    const rr = db.prepare('INSERT INTO tabelas_preco (nome, padrao, ativo) VALUES (?, ?, ?)')
      .run(exigir(texto(req.body.nome), 'nome'), bool(req.body.padrao), req.body.ativo === undefined ? 1 : bool(req.body.ativo));
    res.status(201).json({ id: Number(rr.lastInsertRowid) });
  });
  r.put('/tabelas/:id', gestor, (req, res) => {
    db.prepare('UPDATE tabelas_preco SET nome = ?, padrao = ?, ativo = ? WHERE id = ?')
      .run(exigir(texto(req.body.nome), 'nome'), bool(req.body.padrao), bool(req.body.ativo ?? 1), Number(req.params.id));
    res.json({ ok: true });
  });
  // Define/atualiza o preço de um produto na tabela. preco em reais (ex.: "12,50").
  r.put('/tabelas/:id/itens/:produtoId', gestor, (req, res) => {
    const centavos = reaisParaCentavos(req.body.preco);
    if (!(centavos > 0)) throw new ErroNegocio('Preço inválido');
    db.prepare(`INSERT INTO tabela_preco_itens (tabela_id, produto_id, preco_centavos) VALUES (?, ?, ?)
      ON CONFLICT (tabela_id, produto_id) DO UPDATE SET preco_centavos = excluded.preco_centavos`)
      .run(Number(req.params.id), Number(req.params.produtoId), centavos);
    res.json({ ok: true, preco_centavos: centavos });
  });
  r.delete('/tabelas/:id/itens/:produtoId', gestor, (req, res) => {
    db.prepare('DELETE FROM tabela_preco_itens WHERE tabela_id = ? AND produto_id = ?').run(Number(req.params.id), Number(req.params.produtoId));
    res.json({ ok: true });
  });
  // Importação em lote: texto colado da planilha, uma linha por produto: "CODIGO;PRECO" (ou separado por TAB).
  r.post('/tabelas/:id/itens/lote', gestor, (req, res) => {
    const tabelaId = Number(req.params.id);
    const linhas = String(req.body.texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const porCodigo = db.prepare('SELECT id FROM produtos WHERE codigo = ?');
    const ups = db.prepare(`INSERT INTO tabela_preco_itens (tabela_id, produto_id, preco_centavos) VALUES (?, ?, ?)
      ON CONFLICT (tabela_id, produto_id) DO UPDATE SET preco_centavos = excluded.preco_centavos`);
    const erros = [];
    let importados = 0;
    transacao(db, () => {
      linhas.forEach((linha, n) => {
        const [codigo, preco] = linha.split(/\t|;/).map((s) => s.trim());
        const prod = porCodigo.get(codigo || '');
        const centavos = reaisParaCentavos(preco);
        if (!prod) return erros.push(`Linha ${n + 1}: produto "${codigo}" não encontrado`);
        if (!(centavos > 0)) return erros.push(`Linha ${n + 1}: preço inválido "${preco}"`);
        ups.run(tabelaId, prod.id, centavos);
        importados++;
      });
    });
    res.json({ importados, erros });
  });
  // Substitui os vínculos da tabela: { clientes: [ids], grupos: [ids] }
  r.put('/tabelas/:id/vinculos', gestor, (req, res) => {
    const id = Number(req.params.id);
    transacao(db, () => {
      db.prepare('DELETE FROM tabela_preco_vinculos WHERE tabela_id = ?').run(id);
      const ins = db.prepare('INSERT INTO tabela_preco_vinculos (tabela_id, cliente_id, grupo_id) VALUES (?, ?, ?)');
      for (const c of new Set((req.body.clientes || []).map(Number))) ins.run(id, c, null);
      for (const g of new Set((req.body.grupos || []).map(Number))) ins.run(id, null, g);
    });
    res.json({ ok: true });
  });

  // ----- Usuários -----
  r.get('/usuarios', gestor, (req, res) => {
    res.json(db.prepare('SELECT id, nome, login, papel, ativo FROM usuarios ORDER BY nome').all());
  });
  r.get('/vendedores', gestor, (req, res) => {
    res.json(db.prepare("SELECT id, nome FROM usuarios WHERE papel = 'vendedor' AND ativo = 1 ORDER BY nome").all());
  });
  r.post('/usuarios', gestor, (req, res) => {
    const papel = req.body.papel;
    if (!PAPEIS.includes(papel)) throw new ErroNegocio('Papel inválido');
    const senha = exigir(texto(req.body.senha), 'senha');
    if (senha.length < 6) throw new ErroNegocio('A senha precisa ter ao menos 6 caracteres');
    const rr = db.prepare('INSERT INTO usuarios (nome, login, senha_hash, papel) VALUES (?, ?, ?, ?)')
      .run(exigir(texto(req.body.nome), 'nome'), exigir(texto(req.body.login), 'login').toLowerCase(), hashSenha(senha), papel);
    res.status(201).json({ id: Number(rr.lastInsertRowid) });
  });
  r.put('/usuarios/:id', gestor, (req, res) => {
    const id = Number(req.params.id);
    const papel = req.body.papel;
    if (!PAPEIS.includes(papel)) throw new ErroNegocio('Papel inválido');
    if (id === req.usuario.id && (papel !== 'gestor' || !bool(req.body.ativo ?? 1))) {
      throw new ErroNegocio('Você não pode remover seu próprio acesso de gestor');
    }
    transacao(db, () => {
      db.prepare('UPDATE usuarios SET nome = ?, login = ?, papel = ?, ativo = ? WHERE id = ?')
        .run(exigir(texto(req.body.nome), 'nome'), exigir(texto(req.body.login), 'login').toLowerCase(), papel, bool(req.body.ativo ?? 1), id);
      const senha = texto(req.body.senha);
      if (senha) {
        if (senha.length < 6) throw new ErroNegocio('A senha precisa ter ao menos 6 caracteres');
        db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(senha), id);
        db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
      }
      if (!bool(req.body.ativo ?? 1)) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    });
    res.json({ ok: true });
  });

  return r;
}

module.exports = { rotasCadastros, reaisParaCentavos };

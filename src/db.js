// Banco de dados SQLite (módulo nativo do Node.js, sem dependências externas).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY,
  nome        TEXT NOT NULL,
  login       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT NOT NULL,
  papel       TEXT NOT NULL CHECK (papel IN ('vendedor','expedicao','gestor','faturamento')),
  ativo       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessoes (
  token       TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grupos_clientes (
  id    INTEGER PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS clientes (
  id             INTEGER PRIMARY KEY,
  codigo         TEXT UNIQUE,
  razao_social   TEXT NOT NULL,
  nome_fantasia  TEXT,
  documento      TEXT,
  cidade         TEXT,
  uf             TEXT,
  telefone       TEXT,
  grupo_id       INTEGER REFERENCES grupos_clientes(id),
  vendedor_id    INTEGER REFERENCES usuarios(id),
  ativo          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS produtos (
  id         INTEGER PRIMARY KEY,
  codigo     TEXT NOT NULL UNIQUE,
  descricao  TEXT NOT NULL,
  unidade    TEXT NOT NULL DEFAULT 'UN',
  pesavel    INTEGER NOT NULL DEFAULT 0,   -- 1 = precisa ser pesado na expedição (preço por kg)
  ativo      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tabelas_preco (
  id      INTEGER PRIMARY KEY,
  nome    TEXT NOT NULL UNIQUE,
  padrao  INTEGER NOT NULL DEFAULT 0,      -- 1 = vale para todos os clientes sem tabela específica
  ativo   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tabela_preco_itens (
  tabela_id       INTEGER NOT NULL REFERENCES tabelas_preco(id) ON DELETE CASCADE,
  produto_id      INTEGER NOT NULL REFERENCES produtos(id),
  preco_centavos  INTEGER NOT NULL CHECK (preco_centavos > 0),
  PRIMARY KEY (tabela_id, produto_id)
);

-- Uma tabela pode ser vinculada a clientes específicos e/ou a grupos de clientes.
CREATE TABLE IF NOT EXISTS tabela_preco_vinculos (
  id          INTEGER PRIMARY KEY,
  tabela_id   INTEGER NOT NULL REFERENCES tabelas_preco(id) ON DELETE CASCADE,
  cliente_id  INTEGER REFERENCES clientes(id),
  grupo_id    INTEGER REFERENCES grupos_clientes(id),
  CHECK ((cliente_id IS NULL) <> (grupo_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_vinculo_cliente ON tabela_preco_vinculos(tabela_id, cliente_id) WHERE cliente_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_vinculo_grupo   ON tabela_preco_vinculos(tabela_id, grupo_id)   WHERE grupo_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pedidos (
  id               INTEGER PRIMARY KEY,
  cliente_id       INTEGER NOT NULL REFERENCES clientes(id),
  vendedor_id      INTEGER NOT NULL REFERENCES usuarios(id),
  status           TEXT NOT NULL,
  observacao       TEXT,
  motivo_status    TEXT,
  total_centavos   INTEGER NOT NULL DEFAULT 0,
  nota_fiscal      TEXT,
  impresso_em      TEXT,
  criado_em        TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_pedidos_status ON pedidos(status);

CREATE TABLE IF NOT EXISTS pedido_itens (
  id                      INTEGER PRIMARY KEY,
  pedido_id               INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id              INTEGER NOT NULL REFERENCES produtos(id),
  quantidade              REAL NOT NULL CHECK (quantidade > 0),
  peso_real               REAL,
  preco_centavos          INTEGER NOT NULL CHECK (preco_centavos > 0),
  preco_tabela_centavos   INTEGER,
  tabela_id               INTEGER REFERENCES tabelas_preco(id),
  aprovacao               TEXT NOT NULL DEFAULT 'nao_necessaria'
                          CHECK (aprovacao IN ('nao_necessaria','pendente','aprovado','reprovado')),
  aprovado_por            INTEGER REFERENCES usuarios(id),
  aprovado_em             TEXT,
  motivo_reprovacao       TEXT
);

CREATE TABLE IF NOT EXISTS pedido_historico (
  id               INTEGER PRIMARY KEY,
  pedido_id        INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  usuario_id       INTEGER REFERENCES usuarios(id),
  status_anterior  TEXT,
  status_novo      TEXT NOT NULL,
  descricao        TEXT,
  criado_em        TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function abrirBanco(arquivo) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA foreign_keys = ON;');
  if (arquivo !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Executa fn dentro de uma transação.
function transacao(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { abrirBanco, transacao };

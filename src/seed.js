// Dados iniciais. "npm run seed" cria dados de demonstração para testar o fluxo completo.
const path = require('node:path');
const { abrirBanco, transacao } = require('./db');
const { hashSenha } = require('./auth');

function garantirGestorInicial(db) {
  const existe = db.prepare("SELECT 1 FROM usuarios WHERE papel = 'gestor' LIMIT 1").get();
  if (existe) return;
  const senha = process.env.SENHA_GESTOR || 'admin123';
  db.prepare("INSERT INTO usuarios (nome, login, senha_hash, papel) VALUES ('Gestor', 'gestor', ?, 'gestor')").run(hashSenha(senha));
  console.log(`Usuário inicial criado -> login: gestor  senha: ${senha}  (troque a senha no primeiro acesso)`);
}

function popularDemonstracao(db) {
  transacao(db, () => {
    const usu = db.prepare('INSERT OR IGNORE INTO usuarios (nome, login, senha_hash, papel) VALUES (?, ?, ?, ?)');
    usu.run('Gestor', 'gestor', hashSenha('admin123'), 'gestor');
    usu.run('Carlos Vendedor', 'carlos', hashSenha('123456'), 'vendedor');
    usu.run('Ana Vendedora', 'ana', hashSenha('123456'), 'vendedor');
    usu.run('João Expedição', 'expedicao', hashSenha('123456'), 'expedicao');
    usu.run('Marta Faturamento', 'faturamento', hashSenha('123456'), 'faturamento');

    const grp = db.prepare('INSERT OR IGNORE INTO grupos_clientes (nome) VALUES (?)');
    ['Supermercados', 'Restaurantes', 'Quitandas'].forEach((g) => grp.run(g));
    const g = (nome) => db.prepare('SELECT id FROM grupos_clientes WHERE nome = ?').get(nome).id;

    const cli = db.prepare(`INSERT OR IGNORE INTO clientes (codigo, razao_social, nome_fantasia, documento, cidade, uf, grupo_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?)`);
    cli.run('C001', 'Supermercado Bom Preço Ltda', 'Bom Preço', '12.345.678/0001-90', 'Campinas', 'SP', g('Supermercados'));
    cli.run('C002', 'Mercado Central Eireli', 'Mercado Central', '23.456.789/0001-01', 'Jundiaí', 'SP', g('Supermercados'));
    cli.run('C003', 'Restaurante Sabor Caseiro ME', 'Sabor Caseiro', '34.567.890/0001-12', 'Campinas', 'SP', g('Restaurantes'));
    cli.run('C004', 'Quitanda do Zé', 'Quitanda do Zé', '456.789.012-34', 'Valinhos', 'SP', g('Quitandas'));
    cli.run('C005', 'Sacolão Alfa S/A', 'Sacolão Alfa', '45.678.901/0001-23', 'Sumaré', 'SP', null);

    const prod = db.prepare('INSERT OR IGNORE INTO produtos (codigo, descricao, unidade, pesavel) VALUES (?, ?, ?, ?)');
    const produtos = [
      // código, descrição, unidade, pesável, preço tabela padrão (centavos)
      ['P001', 'Tomate Italiano (caixa 18 kg)', 'CX', 0, 9890],
      ['P002', 'Alface Crespa', 'UN', 0, 250],
      ['P003', 'Banana Prata (caixa 20 kg)', 'CX', 0, 7990],
      ['P004', 'Batata Lavada', 'KG', 1, 390],
      ['P005', 'Cebola Nacional', 'KG', 1, 450],
      ['P006', 'Laranja Pera', 'KG', 1, 320],
      ['P007', 'Cheiro-Verde (maço)', 'MÇ', 0, 180],
      ['P008', 'Ovos Brancos (dúzia)', 'DZ', 0, 1090],
      ['P009', 'Mamão Formosa', 'KG', 1, 590],
      ['P010', 'Couve Manteiga (maço)', 'MÇ', 0, 220],
    ];
    produtos.forEach(([c, d, u, p]) => prod.run(c, d, u, p));
    const pid = (codigo) => db.prepare('SELECT id FROM produtos WHERE codigo = ?').get(codigo).id;

    const tab = db.prepare('INSERT OR IGNORE INTO tabelas_preco (nome, padrao) VALUES (?, ?)');
    tab.run('Tabela Padrão', 1);
    tab.run('Supermercados (-5%)', 0);
    tab.run('Especial Sacolão Alfa', 0);
    const tid = (nome) => db.prepare('SELECT id FROM tabelas_preco WHERE nome = ?').get(nome).id;
    const item = db.prepare('INSERT OR REPLACE INTO tabela_preco_itens (tabela_id, produto_id, preco_centavos) VALUES (?, ?, ?)');
    for (const [c, , , , preco] of produtos) {
      item.run(tid('Tabela Padrão'), pid(c), preco);
      item.run(tid('Supermercados (-5%)'), pid(c), Math.round(preco * 0.95));
    }
    item.run(tid('Especial Sacolão Alfa'), pid('P001'), 8990);
    item.run(tid('Especial Sacolão Alfa'), pid('P003'), 6990);

    const vinc = db.prepare('INSERT OR IGNORE INTO tabela_preco_vinculos (tabela_id, cliente_id, grupo_id) VALUES (?, ?, ?)');
    vinc.run(tid('Supermercados (-5%)'), null, g('Supermercados'));
    const alfa = db.prepare("SELECT id FROM clientes WHERE codigo = 'C005'").get().id;
    vinc.run(tid('Especial Sacolão Alfa'), alfa, null);
  });
}

if (require.main === module) {
  const arquivo = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pedidos.db');
  const db = abrirBanco(arquivo);
  popularDemonstracao(db);
  console.log('Dados de demonstração criados em', arquivo);
  console.log('Logins: gestor/admin123 | carlos/123456 | ana/123456 | expedicao/123456 | faturamento/123456');
}

module.exports = { garantirGestorInicial, popularDemonstracao };

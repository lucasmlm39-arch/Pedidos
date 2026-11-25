const path = require('node:path');
const { abrirBanco } = require('./db');
const { criarApp } = require('./app');
const { garantirGestorInicial } = require('./seed');

const PORTA = Number(process.env.PORT) || 3000;
const ARQUIVO = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pedidos.db');

const db = abrirBanco(ARQUIVO);
garantirGestorInicial(db);
const app = criarApp(db);

app.listen(PORTA, () => {
  console.log(`Sistema de pedidos rodando em http://localhost:${PORTA}`);
  console.log(`Banco de dados: ${ARQUIVO}`);
});

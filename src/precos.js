// Resolução de preço de tabela para um cliente.
// Prioridade: 1) tabela vinculada ao cliente, 2) tabela do grupo do cliente, 3) tabela padrão.
// Se houver mais de uma tabela na mesma prioridade, vale o menor preço.
const SQL_CATALOGO = `
WITH candidatos AS (
  SELECT ti.produto_id, ti.preco_centavos, t.id AS tabela_id, t.nome AS tabela_nome,
    MIN(CASE
          WHEN v.cliente_id = c.id THEN 1
          WHEN v.grupo_id IS NOT NULL AND v.grupo_id = c.grupo_id THEN 2
          WHEN t.padrao = 1 THEN 3
        END) AS prioridade
  FROM clientes c
  JOIN tabelas_preco t ON t.ativo = 1
  JOIN tabela_preco_itens ti ON ti.tabela_id = t.id
  LEFT JOIN tabela_preco_vinculos v ON v.tabela_id = t.id
  WHERE c.id = :cliente
  GROUP BY ti.produto_id, t.id
  HAVING prioridade IS NOT NULL
), ranqueados AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY produto_id ORDER BY prioridade, preco_centavos) AS rn
  FROM candidatos
)
SELECT p.id, p.codigo, p.descricao, p.unidade, p.pesavel, p.unidade_pedido, p.peso_medio_kg, p.tara_kg,
       r.preco_centavos, r.tabela_id, r.tabela_nome
FROM produtos p
LEFT JOIN ranqueados r ON r.produto_id = p.id AND r.rn = 1
WHERE p.ativo = 1
ORDER BY p.descricao`;

function catalogoDoCliente(db, clienteId) {
  return db.prepare(SQL_CATALOGO).all({ cliente: clienteId });
}

function precosDoCliente(db, clienteId) {
  const mapa = new Map();
  for (const p of catalogoDoCliente(db, clienteId)) mapa.set(p.id, p);
  return mapa;
}

module.exports = { catalogoDoCliente, precosDoCliente };

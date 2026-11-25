// Rotas do fluxo de pedidos.
const express = require('express');
const { exigirPapel } = require('../auth');
const P = require('../pedidos');

function rotasPedidos(db, ev) {
  const r = express.Router();
  const id = (req) => Number(req.params.id);

  r.get('/', (req, res) => {
    res.json(P.listarPedidos(db, req.usuario, req.query));
  });

  r.get('/:id', (req, res) => {
    const pedido = P.obterPedido(db, id(req));
    if (req.usuario.papel === 'vendedor' && pedido.vendedor_id !== req.usuario.id) {
      throw new P.ErroNegocio('Pedido de outro vendedor', 403);
    }
    res.json(pedido);
  });

  r.post('/', exigirPapel('vendedor'), (req, res) => {
    res.status(201).json(P.criarPedido(db, ev, req.usuario, req.body));
  });

  r.put('/:id', exigirPapel('vendedor'), (req, res) => {
    res.json(P.revisarPedido(db, ev, req.usuario, id(req), req.body));
  });

  r.post('/:id/aprovacao', exigirPapel(), (req, res) => {
    res.json(P.decidirPrecos(db, ev, req.usuario, id(req), req.body.decisoes));
  });

  r.post('/:id/aceitar', exigirPapel('expedicao'), (req, res) => {
    res.json(P.aceitarExpedicao(db, ev, req.usuario, id(req)));
  });

  r.post('/:id/recusar', exigirPapel('expedicao'), (req, res) => {
    res.json(P.recusarExpedicao(db, ev, req.usuario, id(req), req.body.motivo));
  });

  r.put('/:id/itens/:itemId/peso', exigirPapel('expedicao'), (req, res) => {
    res.json(P.registrarPeso(db, ev, req.usuario, id(req), Number(req.params.itemId), req.body));
  });

  r.put('/:id/itens/:itemId/separado', exigirPapel('expedicao'), (req, res) => {
    res.json(P.marcarSeparado(db, ev, req.usuario, id(req), Number(req.params.itemId), req.body.separado !== false));
  });

  r.post('/:id/concluir', exigirPapel('expedicao'), (req, res) => {
    res.json(P.concluirSeparacao(db, ev, req.usuario, id(req)));
  });

  r.post('/:id/impresso', exigirPapel('expedicao', 'faturamento'), (req, res) => {
    res.json(P.marcarImpresso(db, req.usuario, id(req)));
  });

  r.post('/:id/faturar', exigirPapel('faturamento'), (req, res) => {
    res.json(P.faturar(db, ev, req.usuario, id(req), req.body.nota_fiscal));
  });

  r.post('/:id/cancelar', exigirPapel('vendedor'), (req, res) => {
    res.json(P.cancelar(db, ev, req.usuario, id(req), req.body.motivo));
  });

  return r;
}

module.exports = { rotasPedidos };

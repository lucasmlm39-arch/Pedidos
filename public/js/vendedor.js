// Telas do vendedor: lançar pedido e acompanhar seus pedidos.
import { api, esc, moeda, qtd, dataHora, selo, tentar, modal, centavosParaTexto, textoParaCentavos, numero, vazio } from './util.js';
import { abrirPedido } from './detalhe.js';

// Formulário de pedido (novo ou edição). Renderiza dentro de "alvo".
function formPedido(alvo, { pedido = null, aoSalvar }) {
  const estado = {
    cliente: pedido ? { id: pedido.cliente_id, razao_social: pedido.cliente_nome, nome_fantasia: pedido.cliente_fantasia } : null,
    catalogo: [],
    itens: [], // { produto, quantidade, precoTexto }
    observacao: pedido?.observacao || '',
  };

  alvo.innerHTML = `
    <section class="cartao">
      <h3>1. Cliente</h3>
      <div data-area="cliente"></div>
    </section>
    <section class="cartao" data-area="produtos-sec" hidden>
      <h3>2. Produtos</h3>
      <input type="search" class="input" data-campo="busca-produto" placeholder="Buscar produto por nome ou código" aria-label="Buscar produto">
      <ul class="lista-produtos" data-area="catalogo"></ul>
    </section>
    <section class="cartao" data-area="itens-sec" hidden>
      <h3>3. Itens do pedido</h3>
      <div data-area="itens"></div>
      <label class="rotulo">Observação
        <textarea class="input" data-campo="obs" rows="2" placeholder="Ex.: entregar pela manhã">${esc(estado.observacao)}</textarea>
      </label>
      <div class="rodape-pedido">
        <div>Total estimado <strong data-area="total">R$ 0,00</strong></div>
        <button class="btn btn-primario btn-grande" data-acao="enviar">${pedido ? 'Salvar alterações' : 'Enviar pedido'}</button>
      </div>
      <p class="dica" data-area="dica-aprovacao" hidden>Itens abaixo do preço de tabela serão enviados ao gestor para aprovação.</p>
    </section>`;

  const $ = (sel) => alvo.querySelector(sel);

  function renderCliente(lista = null) {
    const area = $('[data-area="cliente"]');
    if (estado.cliente && !lista) {
      area.innerHTML = `<div class="cliente-escolhido">
        <div><strong>${esc(estado.cliente.nome_fantasia || estado.cliente.razao_social)}</strong><br>
        <small>${esc(estado.cliente.razao_social)}${estado.cliente.cidade ? ` · ${esc(estado.cliente.cidade)}/${esc(estado.cliente.uf || '')}` : ''}</small></div>
        <button class="btn btn-peq" data-acao="trocar-cliente">Trocar</button></div>`;
      return;
    }
    area.innerHTML = `<input type="search" class="input" data-campo="busca-cliente" placeholder="Buscar cliente (nome, código, CNPJ, cidade)" aria-label="Buscar cliente">
      <ul class="lista-clientes" data-area="clientes"></ul>`;
    buscarClientes('');
    $('[data-campo="busca-cliente"]').focus();
  }

  let ultimoBusca = 0;
  async function buscarClientes(termo) {
    const n = ++ultimoBusca;
    const lista = await api('GET', `/api/clientes?busca=${encodeURIComponent(termo)}`);
    if (n !== ultimoBusca) return;
    const ul = $('[data-area="clientes"]');
    if (!ul) return;
    ul.innerHTML = lista.filter((c) => c.ativo).slice(0, 30).map((c) => `
      <li><button class="item-lista" data-cliente="${c.id}">
        <strong>${esc(c.nome_fantasia || c.razao_social)}</strong>
        <small>${esc(c.codigo || '')} · ${esc(c.razao_social)} · ${esc(c.cidade || '')}${c.grupo_nome ? ` · ${esc(c.grupo_nome)}` : ''}</small>
      </button></li>`).join('') || '<li>' + vazio('Nenhum cliente encontrado') + '</li>';
    ul._clientes = lista;
  }

  async function escolherCliente(cliente) {
    estado.cliente = cliente;
    renderCliente();
    estado.catalogo = await api('GET', `/api/clientes/${cliente.id}/catalogo`);
    // Ao trocar de cliente, reaplica os preços de tabela do novo cliente.
    estado.itens = estado.itens
      .map((it) => {
        const produto = estado.catalogo.find((p) => p.id === it.produto.id);
        return produto ? { ...it, produto, precoTexto: centavosParaTexto(produto.preco_centavos) } : null;
      })
      .filter(Boolean);
    $('[data-area="produtos-sec"]').hidden = false;
    renderCatalogo();
    renderItens();
  }

  function renderCatalogo() {
    const termo = ($('[data-campo="busca-produto"]').value || '').toLowerCase();
    const noPedido = new Set(estado.itens.map((i) => i.produto.id));
    const lista = estado.catalogo.filter((p) => !termo || p.descricao.toLowerCase().includes(termo) || p.codigo.toLowerCase().includes(termo));
    $('[data-area="catalogo"]').innerHTML = lista.slice(0, 50).map((p) => `
      <li class="${noPedido.has(p.id) ? 'no-pedido' : ''}">
        <div><strong>${esc(p.descricao)}</strong><br>
          <small>${esc(p.codigo)} · ${esc(p.unidade)}${p.pesavel ? ' · pesável' : ''}</small></div>
        <div class="preco-cat">${p.preco_centavos != null ? moeda(p.preco_centavos) : '<small class="txt-alerta">sem preço</small>'}
          ${p.preco_centavos != null ? `<small>${esc(p.tabela_nome)}</small>` : ''}</div>
        <button class="btn btn-peq ${noPedido.has(p.id) ? '' : 'btn-primario'}" data-adicionar="${p.id}" ${noPedido.has(p.id) ? 'disabled' : ''}>
          ${noPedido.has(p.id) ? 'Adicionado' : 'Adicionar'}</button>
      </li>`).join('') || `<li>${vazio('Nenhum produto encontrado')}</li>`;
  }

  function precoItem(it) { return textoParaCentavos(it.precoTexto); }
  function abaixo(it) {
    const preco = precoItem(it);
    return it.produto.preco_centavos == null || (preco != null && preco < it.produto.preco_centavos);
  }

  function renderItens() {
    $('[data-area="itens-sec"]').hidden = estado.itens.length === 0;
    $('[data-area="itens"]').innerHTML = estado.itens.map((it, idx) => `
      <div class="item-pedido ${abaixo(it) ? 'linha-alerta' : ''}" data-idx="${idx}">
        <div class="item-desc"><strong>${esc(it.produto.descricao)}</strong>
          <small>${esc(it.produto.codigo)} · tabela ${it.produto.preco_centavos != null ? moeda(it.produto.preco_centavos) : '—'}</small>
          ${abaixo(it) ? '<span class="selo selo-alerta">Precisa de aprovação</span>' : ''}</div>
        <label class="rotulo-peq">Qtd. (${esc(it.produto.unidade)})${it.produto.pesavel ? ' estimada' : ''}
          <input class="input" type="text" inputmode="decimal" data-qtd value="${esc(it.quantidade)}"></label>
        <label class="rotulo-peq">Preço (R$/${esc(it.produto.unidade)})
          <input class="input" type="text" inputmode="decimal" data-preco value="${esc(it.precoTexto)}"></label>
        <div class="item-total">${moeda(Math.round(numero(it.quantidade || 0) * (precoItem(it) || 0)))}</div>
        <button class="btn-icone" data-remover="${idx}" aria-label="Remover ${esc(it.produto.descricao)}">×</button>
      </div>`).join('');
    atualizarTotal();
  }

  function atualizarTotal() {
    const total = estado.itens.reduce((s, it) => s + Math.round(numero(it.quantidade || 0) * (precoItem(it) || 0)), 0);
    $('[data-area="total"]').textContent = moeda(total);
    $('[data-area="dica-aprovacao"]').hidden = !estado.itens.some(abaixo);
  }

  alvo.addEventListener('input', (e) => {
    if (e.target.matches('[data-campo="busca-cliente"]')) buscarClientes(e.target.value);
    if (e.target.matches('[data-campo="busca-produto"]')) renderCatalogo();
    if (e.target.matches('[data-campo="obs"]')) estado.observacao = e.target.value;
    const linha = e.target.closest('[data-idx]');
    if (linha) {
      const it = estado.itens[Number(linha.dataset.idx)];
      if (e.target.matches('[data-qtd]')) it.quantidade = e.target.value;
      if (e.target.matches('[data-preco]')) it.precoTexto = e.target.value;
      linha.querySelector('.item-total').textContent = moeda(Math.round(numero(it.quantidade || 0) * (precoItem(it) || 0)));
      linha.classList.toggle('linha-alerta', abaixo(it));
      atualizarTotal();
    }
  });
  alvo.addEventListener('change', (e) => {
    if (e.target.matches('[data-preco]')) renderItens(); // atualiza o selo de aprovação
  });

  alvo.addEventListener('click', async (e) => {
    const cli = e.target.closest('[data-cliente]');
    if (cli) {
      const c = $('[data-area="clientes"]')._clientes.find((x) => x.id === Number(cli.dataset.cliente));
      return tentar(() => escolherCliente(c));
    }
    if (e.target.closest('[data-acao="trocar-cliente"]')) return renderCliente([]);
    const add = e.target.closest('[data-adicionar]');
    if (add) {
      const produto = estado.catalogo.find((p) => p.id === Number(add.dataset.adicionar));
      estado.itens.push({ produto, quantidade: '1', precoTexto: centavosParaTexto(produto.preco_centavos) });
      renderCatalogo();
      renderItens();
      const inputs = alvo.querySelectorAll('[data-qtd]');
      inputs[inputs.length - 1]?.select();
      return;
    }
    const rem = e.target.closest('[data-remover]');
    if (rem) {
      estado.itens.splice(Number(rem.dataset.remover), 1);
      renderCatalogo();
      return renderItens();
    }
    const enviar = e.target.closest('[data-acao="enviar"]');
    if (enviar) {
      const corpo = {
        cliente_id: estado.cliente.id,
        observacao: estado.observacao.trim() || null,
        itens: estado.itens.map((it) => ({
          produto_id: it.produto.id,
          quantidade: numero(it.quantidade),
          preco_centavos: precoItem(it),
        })),
      };
      enviar.disabled = true;
      try {
        const salvo = await tentar(
          () => (pedido ? api('PUT', `/api/pedidos/${pedido.id}`, corpo) : api('POST', '/api/pedidos', corpo)),
          pedido ? 'Pedido atualizado' : 'Pedido enviado!',
        );
        aoSalvar(salvo);
      } catch { /* exibido */ } finally {
        enviar.disabled = false;
      }
    }
  });

  if (pedido) {
    tentar(async () => {
      await escolherCliente(estado.cliente);
      estado.itens = pedido.itens.map((i) => ({
        produto: estado.catalogo.find((p) => p.id === i.produto_id) || { id: i.produto_id, descricao: i.descricao, codigo: i.codigo, unidade: i.unidade, pesavel: i.pesavel, preco_centavos: i.preco_tabela_centavos },
        quantidade: String(i.quantidade).replace('.', ','),
        precoTexto: centavosParaTexto(i.preco_centavos),
      }));
      renderCatalogo();
      renderItens();
    });
  } else {
    renderCliente();
  }
}

export function telaNovoPedido(alvo, irPara) {
  formPedido(alvo, {
    aoSalvar: (p) => {
      irPara('meus-pedidos');
      abrirPedido(p.id);
    },
  });
}

export function editarPedido(pedido, aoMudar) {
  const { el, fechar } = modal(`<h2>Editar pedido #${pedido.id}</h2><div data-form></div>`, { largo: true });
  formPedido(el.querySelector('[data-form]'), {
    pedido,
    aoSalvar: (p) => { fechar(); aoMudar(); abrirPedido(p.id, aoMudar); },
  });
}

export function listaPedidos(pedidos, { mostrarVendedor = false } = {}) {
  if (!pedidos.length) return vazio('Nenhum pedido aqui');
  return `<ul class="lista-pedidos">${pedidos.map((p) => `
    <li><button class="item-lista item-pedido-lista" data-pedido="${p.id}">
      <div class="lp-topo"><strong>#${p.id} · ${esc(p.cliente_fantasia || p.cliente_nome)}</strong><span class="lp-total">${moeda(p.total_centavos)}</span></div>
      <div class="lp-baixo">${selo(p)}
        <small>${p.qtd_itens} ${p.qtd_itens === 1 ? 'item' : 'itens'}${mostrarVendedor ? ` · ${esc(p.vendedor_nome)}` : ''} · ${dataHora(p.criado_em)}</small>
        ${p.itens_pendentes ? `<small class="txt-alerta">${p.itens_pendentes} preço(s) para aprovar</small>` : ''}
        ${p.motivo_status && p.status === 'REVISAO' ? `<small class="txt-perigo">${esc(p.motivo_status)}</small>` : ''}
      </div>
    </button></li>`).join('')}</ul>`;
}

export async function telaMeusPedidos(alvo) {
  const carregar = async () => {
    const pedidos = await api('GET', '/api/pedidos');
    const revisao = pedidos.filter((p) => p.status === 'REVISAO');
    alvo.innerHTML = `
      ${revisao.length ? `<section class="cartao destaque-perigo"><h3>Precisam de ajuste (${revisao.length})</h3>${listaPedidos(revisao)}</section>` : ''}
      <section class="cartao"><h3>Meus pedidos</h3>${listaPedidos(pedidos.filter((p) => p.status !== 'REVISAO'))}</section>`;
  };
  alvo.onclick = (e) => {
    const b = e.target.closest('[data-pedido]');
    if (b) abrirPedido(Number(b.dataset.pedido), carregar);
  };
  alvo.recarregar = carregar;
  await tentar(carregar);
}

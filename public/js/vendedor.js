// Telas do vendedor: lançar pedido (funciona offline) e acompanhar seus pedidos.
import { api, esc, moeda, dataHora, selo, tentar, modal, centavosParaTexto, textoParaCentavos, numero, vazio, toast } from './util.js';
import { abrirPedido } from './detalhe.js';
import {
  pacoteLocal, baixarPacote, catalogoLocal, buscarClientesLocal, salvarNaFila, atualizarNaFila,
  sincronizar, filaListar, filaRemover, kvLer, kvGravar, semConexao,
} from './offline.js';

const aceitaFracao = (p) => Boolean(p.pesavel) || String(p.unidade).toUpperCase() === 'KG';
// Pesável pedido em unidade/caixa e cobrado por kg (ex.: 10 abacaxis).
const emUnidade = (p) => Boolean(p.pesavel && p.unidade_pedido && p.unidade_pedido.toUpperCase() !== 'KG');
const unidadeQtd = (p) => (emUnidade(p) ? p.unidade_pedido : p.unidade);
const fmtKg = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

async function obterPacote() {
  const local = await pacoteLocal();
  if (local) return local;
  try {
    return await baixarPacote();
  } catch {
    return null;
  }
}

// Formulário de pedido. modos: novo | servidor (editar pedido já enviado, precisa de conexão) | local (editar pedido na fila)
async function formPedido(alvo, { pedido = null, local = null, aoSalvar }) {
  const pacote = await obterPacote();
  if (!pacote) {
    alvo.innerHTML = `<section class="cartao">${vazio('Sem dados no aparelho. Conecte-se à internet uma vez para baixar clientes, produtos e preços.')}</section>`;
    return;
  }
  const base = pedido || local;
  const estado = {
    cliente: base ? (pacote.clientes.find((c) => c.id === (pedido?.cliente_id ?? local.cliente.id))
      || { id: pedido?.cliente_id ?? local.cliente.id, razao_social: pedido?.cliente_nome ?? local.cliente.razao_social, nome_fantasia: pedido?.cliente_fantasia ?? local.cliente.nome_fantasia }) : null,
    catalogo: [],
    itens: [],
    observacao: base?.observacao || '',
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
        <button class="btn btn-primario btn-grande" data-acao="enviar">${base ? 'Salvar alterações' : 'Enviar pedido'}</button>
      </div>
      <p class="dica" data-area="dica-aprovacao" hidden>Itens abaixo do preço de tabela serão enviados ao gestor para aprovação.</p>
    </section>`;

  const $ = (sel) => alvo.querySelector(sel);
  let clientesListados = [];

  function renderCliente(buscando = false) {
    const area = $('[data-area="cliente"]');
    if (estado.cliente && !buscando) {
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

  function buscarClientes(termo) {
    clientesListados = buscarClientesLocal(pacote, termo).slice(0, 40);
    $('[data-area="clientes"]').innerHTML = clientesListados.map((c) => `
      <li><button class="item-lista" data-cliente="${c.id}">
        <strong>${esc(c.nome_fantasia || c.razao_social)}</strong>
        <small>${esc(c.codigo || '')} · ${esc(c.razao_social)} · ${esc(c.cidade || '')}${c.grupo_nome ? ` · ${esc(c.grupo_nome)}` : ''}</small>
      </button></li>`).join('') || `<li>${vazio('Nenhum cliente encontrado')}</li>`;
  }

  function escolherCliente(cliente) {
    estado.cliente = cliente;
    renderCliente();
    estado.catalogo = catalogoLocal(pacote, cliente.id);
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
    $('[data-area="catalogo"]').innerHTML = lista.slice(0, 60).map((p) => `
      <li class="${noPedido.has(p.id) ? 'no-pedido' : ''}">
        <div><strong>${esc(p.descricao)}</strong><br>
          <small>${esc(p.codigo)} · ${emUnidade(p) ? `pede em ${esc(p.unidade_pedido)}, cobra por kg` : `${esc(p.unidade)}${p.pesavel ? ' · pesável' : ''}`}</small></div>
        <div class="preco-cat">${p.preco_centavos != null ? `${moeda(p.preco_centavos)}<small>/${esc(p.unidade)} · ${esc(p.tabela_nome)}</small>` : '<small class="txt-alerta">sem preço</small>'}</div>
        <button class="btn btn-peq ${noPedido.has(p.id) ? '' : 'btn-primario'}" data-adicionar="${p.id}" ${noPedido.has(p.id) ? 'disabled' : ''}>
          ${noPedido.has(p.id) ? 'Adicionado' : 'Adicionar'}</button>
      </li>`).join('') || `<li>${vazio('Nenhum produto encontrado')}</li>`;
  }

  const precoItem = (it) => textoParaCentavos(it.precoTexto);
  function abaixo(it) {
    const preco = precoItem(it);
    return it.produto.preco_centavos == null || (preco != null && preco < it.produto.preco_centavos);
  }
  // Para itens pedidos em unidade e cobrados por kg, o total é estimado pelo peso médio.
  const pesoEstimado = (it) => (emUnidade(it.produto) ? numero(it.quantidade || 0) * (it.produto.peso_medio_kg || 0) : null);
  const totalItem = (it) => Math.round((emUnidade(it.produto) ? pesoEstimado(it) : numero(it.quantidade || 0)) * (precoItem(it) || 0));

  function renderItens() {
    $('[data-area="itens-sec"]').hidden = estado.itens.length === 0;
    $('[data-area="itens"]').innerHTML = estado.itens.map((it, idx) => `
      <div class="item-pedido ${abaixo(it) ? 'linha-alerta' : ''}" data-idx="${idx}">
        <div class="item-desc"><strong>${esc(it.produto.descricao)}</strong>
          <small>${esc(it.produto.codigo)} · tabela ${it.produto.preco_centavos != null ? moeda(it.produto.preco_centavos) : '—'}</small>
          ${emUnidade(it.produto) ? `<small class="txt-info" data-estimado>${it.produto.peso_medio_kg ? `≈ ${fmtKg(pesoEstimado(it))} kg · ` : ''}cobrado pelo peso real</small>` : ''}
          ${abaixo(it) ? '<span class="selo selo-alerta">Precisa de aprovação</span>' : ''}</div>
        <label class="rotulo-peq">Qtd. (${esc(unidadeQtd(it.produto))})${it.produto.pesavel && !emUnidade(it.produto) ? ' estimada' : ''}
          <input class="input" type="text" inputmode="${aceitaFracao(it.produto) && !emUnidade(it.produto) ? 'decimal' : 'numeric'}" data-qtd value="${esc(it.quantidade)}"></label>
        <label class="rotulo-peq">Preço (R$/${esc(it.produto.unidade)})
          <input class="input" type="text" inputmode="decimal" data-preco value="${esc(it.precoTexto)}"></label>
        <div class="item-total">${moeda(totalItem(it))}</div>
        <button class="btn-icone" data-remover="${idx}" aria-label="Remover ${esc(it.produto.descricao)}">×</button>
      </div>`).join('');
    atualizarTotal();
  }

  function atualizarTotal() {
    $('[data-area="total"]').textContent = moeda(estado.itens.reduce((s, it) => s + totalItem(it), 0));
    $('[data-area="dica-aprovacao"]').hidden = !estado.itens.some(abaixo);
  }

  // Validação local (o servidor valida de novo ao receber).
  function validar() {
    if (!estado.cliente) return 'Escolha o cliente';
    if (!estado.itens.length) return 'Adicione ao menos um produto';
    for (const it of estado.itens) {
      const q = numero(it.quantidade);
      if (!(q > 0)) return `Quantidade inválida em "${it.produto.descricao}"`;
      if ((emUnidade(it.produto) || !aceitaFracao(it.produto)) && !Number.isInteger(q)) return `"${it.produto.descricao}" é pedido em ${unidadeQtd(it.produto)}: use quantidade inteira`;
      if (!(precoItem(it) > 0)) return `Informe o preço de "${it.produto.descricao}"`;
    }
    return null;
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
      linha.querySelector('.item-total').textContent = moeda(totalItem(it));
      const est = linha.querySelector('[data-estimado]');
      if (est && it.produto.peso_medio_kg) est.textContent = `≈ ${fmtKg(pesoEstimado(it))} kg · cobrado pelo peso real`;
      linha.classList.toggle('linha-alerta', abaixo(it));
      atualizarTotal();
    }
  });
  alvo.addEventListener('change', (e) => {
    if (e.target.matches('[data-preco]')) renderItens(); // atualiza o selo de aprovação
  });

  alvo.addEventListener('click', async (e) => {
    const cli = e.target.closest('[data-cliente]');
    if (cli) return escolherCliente(clientesListados.find((x) => x.id === Number(cli.dataset.cliente)));
    if (e.target.closest('[data-acao="trocar-cliente"]')) return renderCliente(true);
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
    if (!enviar) return;
    const problema = validar();
    if (problema) return toast(problema, 'erro');
    const itens = estado.itens.map((it) => ({
      produto_id: it.produto.id,
      quantidade: numero(it.quantidade),
      preco_centavos: precoItem(it),
      // dados para exibir o pedido enquanto estiver só no aparelho
      descricao: it.produto.descricao, codigo: it.produto.codigo, unidade: it.produto.unidade, unidade_pedido: it.produto.unidade_pedido,
      pesavel: it.produto.pesavel, preco_tabela_centavos: it.produto.preco_centavos,
    }));
    const c = estado.cliente;
    const registro = {
      cliente: { id: c.id, razao_social: c.razao_social, nome_fantasia: c.nome_fantasia, codigo: c.codigo },
      observacao: estado.observacao.trim() || null,
      itens,
      total_centavos: estado.itens.reduce((s, it) => s + totalItem(it), 0),
    };
    enviar.disabled = true;
    try {
      if (pedido) {
        // Pedido já no servidor (ex.: voltou para ajuste): precisa de conexão.
        const salvo = await api('PUT', `/api/pedidos/${pedido.id}`, { cliente_id: c.id, observacao: registro.observacao, itens });
        toast('Pedido atualizado');
        return aoSalvar(salvo);
      }
      const naFila = local ? { ...local, ...registro } : await salvarNaFila(registro);
      if (local) await atualizarNaFila(naFila);
      const r = await sincronizar();
      const enviado = r.enviados.find((p) => p.uuid_local === naFila.uuid);
      if (enviado) {
        toast('Pedido enviado!');
        aoSalvar(enviado);
      } else if (r.semConexao) {
        toast('Sem conexão: pedido salvo no aparelho. Será enviado automaticamente.', 'info');
        aoSalvar(null);
      } else {
        toast('O servidor recusou o pedido. Veja em "Meus pedidos".', 'erro');
        aoSalvar(null);
      }
    } catch (err) {
      toast(semConexao(err) ? 'Sem conexão. Para alterar um pedido já enviado é preciso estar online.' : err.message, 'erro');
    } finally {
      enviar.disabled = false;
    }
  });

  if (base) {
    escolherCliente(estado.cliente);
    estado.itens = base.itens.map((i) => ({
      produto: estado.catalogo.find((p) => p.id === i.produto_id)
        || { id: i.produto_id, descricao: i.descricao, codigo: i.codigo, unidade: i.unidade, pesavel: i.pesavel, unidade_pedido: i.unidade_pedido, preco_centavos: i.preco_tabela_centavos },
      quantidade: String(i.quantidade).replace('.', ','),
      precoTexto: centavosParaTexto(i.preco_centavos),
    }));
    renderCatalogo();
    renderItens();
  } else {
    renderCliente();
  }
}

export function telaNovoPedido(alvo, irPara) {
  formPedido(alvo, {
    aoSalvar: (p) => {
      irPara('meus-pedidos');
      if (p) abrirPedido(p.id);
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

function editarLocal(registro, aoMudar) {
  const { el, fechar } = modal('<h2>Editar pedido (não enviado)</h2><div data-form></div>', { largo: true });
  formPedido(el.querySelector('[data-form]'), {
    local: registro,
    aoSalvar: () => { fechar(); aoMudar(); },
  });
}

export function listaPedidos(pedidos, { mostrarVendedor = false } = {}) {
  if (!pedidos.length) return vazio('Nenhum pedido aqui');
  return `<ul class="lista-pedidos">${pedidos.map((p) => `
    <li><button class="item-lista item-pedido-lista" data-pedido="${p.id}">
      <div class="lp-topo"><strong>#${p.id} · ${esc(p.cliente_fantasia || p.cliente_nome)}</strong><span class="lp-total">${moeda(p.total_centavos)}</span></div>
      <div class="lp-baixo">${selo(p)}
        <small>${p.qtd_itens} ${p.qtd_itens === 1 ? 'item' : 'itens'}${mostrarVendedor ? ` · ${esc(p.vendedor_nome)}` : ''} · ${dataHora(p.lancado_em || p.criado_em)}</small>
        ${p.itens_pendentes ? `<small class="txt-alerta">${p.itens_pendentes} preço(s) para aprovar</small>` : ''}
        ${p.exportado_em ? '<small>Exportado</small>' : ''}
        ${p.motivo_status && p.status === 'REVISAO' ? `<small class="txt-perigo">${esc(p.motivo_status)}</small>` : ''}
      </div>
    </button></li>`).join('')}</ul>`;
}

function listaFila(fila) {
  return `<ul class="lista-pedidos">${fila.map((f) => `
    <li class="item-fila ${f.erro ? 'com-erro' : ''}">
      <div class="lp-topo"><strong>${esc(f.cliente.nome_fantasia || f.cliente.razao_social)}</strong><span class="lp-total">${moeda(f.total_centavos)}</span></div>
      <div class="lp-baixo">
        <span class="selo ${f.erro ? 'selo-perigo' : 'selo-neutro'}">${f.erro ? 'Recusado pelo servidor' : 'Aguardando envio'}</span>
        <small>${f.itens.length} ${f.itens.length === 1 ? 'item' : 'itens'} · feito em ${new Date(f.lancado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
        ${f.erro ? `<small class="txt-perigo">${esc(f.erro)}</small>` : ''}
      </div>
      <div class="acoes-item">
        <button class="btn btn-peq" data-editar-local="${f.uuid}">Editar</button>
        <button class="btn btn-peq btn-perigo-txt" data-excluir-local="${f.uuid}">Excluir</button>
      </div>
    </li>`).join('')}</ul>`;
}

export async function telaMeusPedidos(alvo) {
  let fila = [];
  const carregar = async () => {
    fila = await filaListar();
    let pedidos = (await kvLer('meus_pedidos')) || [];
    let offline = false;
    try {
      pedidos = await api('GET', '/api/pedidos');
      kvGravar('meus_pedidos', pedidos).catch(() => {});
    } catch (e) {
      if (!semConexao(e)) throw e;
      offline = true;
    }
    const revisao = pedidos.filter((p) => p.status === 'REVISAO');
    alvo.innerHTML = `
      ${fila.length ? `<section class="cartao destaque-alerta">
        <div class="cabecalho-secao"><h3>No aparelho, ainda não enviados <span class="contador">${fila.length}</span></h3>
          <button class="btn btn-primario btn-peq" data-enviar-fila>Enviar agora</button></div>
        ${listaFila(fila)}</section>` : ''}
      ${revisao.length ? `<section class="cartao destaque-perigo"><h3>Precisam de ajuste (${revisao.length})</h3>${listaPedidos(revisao)}</section>` : ''}
      <section class="cartao"><h3>Meus pedidos</h3>
        ${offline ? '<p class="dica">Sem conexão: mostrando a última lista baixada.</p>' : ''}
        ${listaPedidos(pedidos.filter((p) => p.status !== 'REVISAO'))}</section>`;
  };
  alvo.onclick = async (e) => {
    const b = e.target.closest('[data-pedido]');
    if (b) return abrirPedido(Number(b.dataset.pedido), carregar);
    if (e.target.closest('[data-enviar-fila]')) {
      const r = await sincronizar();
      if (r.enviados.length) toast(`${r.enviados.length} pedido(s) enviado(s)`);
      if (r.semConexao) toast('Ainda sem conexão com o servidor', 'erro');
      return carregar();
    }
    const ed = e.target.closest('[data-editar-local]');
    if (ed) return editarLocal(fila.find((f) => f.uuid === ed.dataset.editarLocal), carregar);
    const ex = e.target.closest('[data-excluir-local]');
    if (ex && confirm('Excluir este pedido do aparelho? Ele ainda não foi enviado.')) {
      await filaRemover(ex.dataset.excluirLocal);
      carregar();
    }
  };
  alvo.recarregar = carregar;
  await tentar(carregar);
}

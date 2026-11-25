// Cadastros do gestor: clientes, grupos, produtos, tabelas de preço e usuários.
import { api, esc, tentar, modal, formDados, centavosParaTexto, vazio, toast } from './util.js';

// ---------- CRUD genérico ----------
function campoHtml(c, valor, opcoes) {
  const v = valor ?? c.padrao ?? '';
  if (c.tipo === 'checkbox') {
    return `<label class="rotulo-check"><input type="checkbox" name="${c.nome}" ${valor ?? c.padrao ? 'checked' : ''}> ${esc(c.rotulo)}</label>`;
  }
  if (c.tipo === 'select') {
    return `<label class="rotulo">${esc(c.rotulo)}<select class="input" name="${c.nome}">
      ${c.opcional ? '<option value="">— nenhum —</option>' : ''}
      ${opcoes[c.nome].map((o) => `<option value="${esc(o.valor)}" ${String(o.valor) === String(v) ? 'selected' : ''}>${esc(o.texto)}</option>`).join('')}
    </select></label>`;
  }
  return `<label class="rotulo">${esc(c.rotulo)}${c.obrigatorio ? ' *' : ''}
    <input class="input" name="${c.nome}" type="${c.tipo || 'text'}" value="${esc(c.tipo === 'password' ? '' : v)}"
      ${c.obrigatorio ? 'required' : ''} ${c.dica ? `placeholder="${esc(c.dica)}"` : ''}></label>`;
}

function telaCrud(cfg) {
  return async (alvo) => {
    let registros = [];
    let busca = '';
    const opcoes = {};
    const carregarOpcoes = async () => {
      for (const c of cfg.campos.filter((x) => x.tipo === 'select')) {
        opcoes[c.nome] = typeof c.opcoes === 'function' ? await c.opcoes() : c.opcoes;
      }
    };
    const render = () => {
      const filtrados = registros.filter((r) => !busca || cfg.colunas.some((col) => String(col.valor(r) ?? '').toLowerCase().includes(busca)));
      alvo.querySelector('[data-lista]').innerHTML = filtrados.length ? `<div class="tabela-rolagem"><table class="tabela tabela-clicavel">
        <thead><tr>${cfg.colunas.map((c) => `<th>${esc(c.titulo)}</th>`).join('')}</tr></thead>
        <tbody>${filtrados.map((r) => `<tr data-id="${r.id}" class="${r.ativo === 0 ? 'inativo' : ''}">${cfg.colunas.map((c) => `<td>${c.html ? c.html(r) : esc(c.valor(r) ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>` : vazio('Nenhum registro');
    };
    const carregar = async () => {
      registros = await api('GET', cfg.rota);
      render();
    };
    const abrirForm = async (reg) => {
      await carregarOpcoes();
      const { el, fechar } = modal(`<h2>${reg ? 'Editar' : 'Novo'} ${esc(cfg.nome)}</h2>
        <form class="form-grade">${cfg.campos.map((c) => campoHtml(c, reg?.[c.nome], opcoes)).join('')}
          <div class="barra-acoes"><button class="btn btn-primario" type="submit">Salvar</button></div></form>`);
      el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const dados = formDados(e.target);
        try {
          await tentar(() => (reg ? api('PUT', `${cfg.rota}/${reg.id}`, dados) : api('POST', cfg.rota, dados)), 'Salvo');
          fechar();
          carregar();
        } catch { /* exibido */ }
      });
    };
    alvo.innerHTML = `<section class="cartao">
      <div class="cabecalho-secao"><h3>${esc(cfg.titulo)}</h3>
        <div class="grupo-botoes"><input type="search" class="input input-auto" data-busca placeholder="Filtrar…" aria-label="Filtrar">
        <button class="btn btn-primario" data-novo>+ Novo</button></div></div>
      ${cfg.dica ? `<p class="dica">${cfg.dica}</p>` : ''}
      <div data-lista></div></section>`;
    alvo.querySelector('[data-busca]').oninput = (e) => { busca = e.target.value.toLowerCase(); render(); };
    alvo.querySelector('[data-novo]').onclick = () => abrirForm(null);
    alvo.querySelector('[data-lista]').onclick = (e) => {
      const tr = e.target.closest('[data-id]');
      if (tr) abrirForm(registros.find((r) => r.id === Number(tr.dataset.id)));
    };
    alvo.recarregar = carregar;
    await tentar(carregar);
  };
}

const simNao = (v) => (v ? 'Sim' : 'Não');
const opcoesGrupos = async () => (await api('GET', '/api/grupos')).map((g) => ({ valor: g.id, texto: g.nome }));
const opcoesVendedores = async () => (await api('GET', '/api/vendedores')).map((v) => ({ valor: v.id, texto: v.nome }));

export const telaClientes = telaCrud({
  titulo: 'Clientes', nome: 'cliente', rota: '/api/clientes',
  dica: 'Se um vendedor for definido, só ele vê o cliente. Sem vendedor, todos os vendedores veem.',
  colunas: [
    { titulo: 'Código', valor: (r) => r.codigo },
    { titulo: 'Cliente', valor: (r) => r.nome_fantasia || r.razao_social, html: (r) => `<strong>${esc(r.nome_fantasia || r.razao_social)}</strong><br><small>${esc(r.razao_social)}</small>` },
    { titulo: 'CNPJ/CPF', valor: (r) => r.documento },
    { titulo: 'Cidade', valor: (r) => (r.cidade ? `${r.cidade}/${r.uf || ''}` : '') },
    { titulo: 'Grupo', valor: (r) => r.grupo_nome },
    { titulo: 'Vendedor', valor: (r) => r.vendedor_nome || 'Todos' },
  ],
  campos: [
    { nome: 'codigo', rotulo: 'Código' },
    { nome: 'razao_social', rotulo: 'Razão social', obrigatorio: true },
    { nome: 'nome_fantasia', rotulo: 'Nome fantasia' },
    { nome: 'documento', rotulo: 'CNPJ/CPF' },
    { nome: 'telefone', rotulo: 'Telefone' },
    { nome: 'cidade', rotulo: 'Cidade' },
    { nome: 'uf', rotulo: 'UF' },
    { nome: 'grupo_id', rotulo: 'Grupo de clientes', tipo: 'select', opcional: true, opcoes: opcoesGrupos },
    { nome: 'vendedor_id', rotulo: 'Vendedor responsável', tipo: 'select', opcional: true, opcoes: opcoesVendedores },
    { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', padrao: 1 },
  ],
});

export const telaGrupos = telaCrud({
  titulo: 'Grupos de clientes', nome: 'grupo', rota: '/api/grupos',
  dica: 'Agrupe clientes (ex.: Supermercados, Restaurantes) para aplicar uma tabela de preço a todos de uma vez.',
  colunas: [{ titulo: 'Grupo', valor: (r) => r.nome }, { titulo: 'Clientes', valor: (r) => r.qtd_clientes }],
  campos: [{ nome: 'nome', rotulo: 'Nome do grupo', obrigatorio: true }],
});

export const telaProdutos = telaCrud({
  titulo: 'Produtos', nome: 'produto', rota: '/api/produtos',
  dica: 'Marque "pesável" para produtos vendidos por peso: a expedição informa o peso real e o valor é recalculado.',
  colunas: [
    { titulo: 'Código', valor: (r) => r.codigo },
    { titulo: 'Descrição', valor: (r) => r.descricao },
    { titulo: 'Unidade', valor: (r) => r.unidade },
    { titulo: 'Pesável', valor: (r) => simNao(r.pesavel) },
    { titulo: 'Ativo', valor: (r) => simNao(r.ativo) },
  ],
  campos: [
    { nome: 'codigo', rotulo: 'Código', obrigatorio: true },
    { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true },
    { nome: 'unidade', rotulo: 'Unidade', dica: 'UN, CX, FD, KG…', padrao: 'UN' },
    { nome: 'pesavel', rotulo: 'Pesável (vendido por kg, pesado na expedição)', tipo: 'checkbox' },
    { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', padrao: 1 },
  ],
});

const PAPEIS = [
  { valor: 'vendedor', texto: 'Vendedor' }, { valor: 'expedicao', texto: 'Expedição' },
  { valor: 'faturamento', texto: 'Faturamento' }, { valor: 'gestor', texto: 'Gestor' },
];
export const telaUsuarios = telaCrud({
  titulo: 'Usuários', nome: 'usuário', rota: '/api/usuarios',
  colunas: [
    { titulo: 'Nome', valor: (r) => r.nome },
    { titulo: 'Login', valor: (r) => r.login },
    { titulo: 'Perfil', valor: (r) => PAPEIS.find((p) => p.valor === r.papel)?.texto },
    { titulo: 'Ativo', valor: (r) => simNao(r.ativo) },
  ],
  campos: [
    { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
    { nome: 'login', rotulo: 'Login', obrigatorio: true },
    { nome: 'senha', rotulo: 'Senha (deixe em branco para manter)', tipo: 'password' },
    { nome: 'papel', rotulo: 'Perfil', tipo: 'select', opcoes: PAPEIS },
    { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', padrao: 1 },
  ],
});

// ---------- Tabelas de preço ----------
async function editarTabela(id, aoMudar) {
  const [t, produtos, clientes, grupos] = await Promise.all([
    api('GET', `/api/tabelas/${id}`), api('GET', '/api/produtos'), api('GET', '/api/clientes'), api('GET', '/api/grupos'),
  ]);
  const precos = new Map(t.itens.map((i) => [i.produto_id, i.preco_centavos]));
  const cliSel = new Set(t.clientes);
  const grpSel = new Set(t.grupos);
  const { el } = modal(`
    <h2>Tabela: ${esc(t.nome)}</h2>
    <form class="form-linha" data-form-tabela>
      <label class="rotulo">Nome<input class="input" name="nome" value="${esc(t.nome)}" required></label>
      <label class="rotulo-check"><input type="checkbox" name="padrao" ${t.padrao ? 'checked' : ''}> Tabela padrão (todos os clientes)</label>
      <label class="rotulo-check"><input type="checkbox" name="ativo" ${t.ativo ? 'checked' : ''}> Ativa</label>
      <button class="btn" type="submit">Salvar dados</button>
    </form>

    <h3>Aplicar a</h3>
    <p class="dica">Prioridade do preço: tabela do <strong>cliente</strong> &gt; tabela do <strong>grupo</strong> &gt; tabela <strong>padrão</strong>. Produtos que não estiverem nesta tabela usam a próxima da lista.</p>
    <div class="vinculos">
      <fieldset><legend>Grupos</legend>
        ${grupos.map((g) => `<label class="rotulo-check"><input type="checkbox" data-grupo="${g.id}" ${grpSel.has(g.id) ? 'checked' : ''}> ${esc(g.nome)}</label>`).join('') || '<small>Nenhum grupo cadastrado</small>'}
      </fieldset>
      <fieldset><legend>Clientes específicos</legend>
        <input type="search" class="input" data-busca-cli placeholder="Filtrar clientes…" aria-label="Filtrar clientes">
        <div class="lista-check">${clientes.map((c) => `<label class="rotulo-check" data-nome="${esc((c.razao_social + ' ' + (c.nome_fantasia || '') + ' ' + (c.codigo || '')).toLowerCase())}">
          <input type="checkbox" data-cli="${c.id}" ${cliSel.has(c.id) ? 'checked' : ''}> ${esc(c.nome_fantasia || c.razao_social)} <small>${esc(c.codigo || '')}</small></label>`).join('')}</div>
      </fieldset>
    </div>
    <div class="barra-acoes"><button class="btn btn-primario" data-salvar-vinculos>Salvar vínculos</button></div>

    <h3>Preços</h3>
    <p class="dica">Digite o preço e saia do campo para salvar. Deixe vazio para tirar o produto desta tabela.</p>
    <details class="lote"><summary>Colar preços de uma planilha</summary>
      <p class="dica">Uma linha por produto: <code>CÓDIGO;PREÇO</code> (ou copie as duas colunas direto do Excel).</p>
      <textarea class="input" rows="5" data-lote placeholder="P001;28,90&#10;P002;7,89"></textarea>
      <button class="btn" data-importar>Importar</button>
    </details>
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Código</th><th>Produto</th><th>Un.</th><th class="num">Preço (R$)</th></tr></thead>
      <tbody>${produtos.map((p) => `<tr class="${p.ativo ? '' : 'inativo'}"><td>${esc(p.codigo)}</td><td>${esc(p.descricao)}</td><td>${esc(p.unidade)}</td>
        <td class="num"><input class="input input-preco" inputmode="decimal" data-produto="${p.id}" value="${centavosParaTexto(precos.get(p.id))}" aria-label="Preço de ${esc(p.descricao)}"></td></tr>`).join('')}</tbody>
    </table></div>`, { largo: true });

  el.querySelector('[data-form-tabela]').addEventListener('submit', async (e) => {
    e.preventDefault();
    await tentar(() => api('PUT', `/api/tabelas/${id}`, formDados(e.target)), 'Tabela salva').catch(() => {});
    aoMudar();
  });
  el.querySelector('[data-busca-cli]').oninput = (e) => {
    const termo = e.target.value.toLowerCase();
    el.querySelectorAll('[data-nome]').forEach((l) => { l.hidden = termo && !l.dataset.nome.includes(termo); });
  };
  el.querySelector('[data-salvar-vinculos]').onclick = async () => {
    const clientesIds = [...el.querySelectorAll('[data-cli]:checked')].map((c) => Number(c.dataset.cli));
    const gruposIds = [...el.querySelectorAll('[data-grupo]:checked')].map((c) => Number(c.dataset.grupo));
    await tentar(() => api('PUT', `/api/tabelas/${id}/vinculos`, { clientes: clientesIds, grupos: gruposIds }), 'Vínculos salvos').catch(() => {});
    aoMudar();
  };
  el.querySelector('[data-importar]').onclick = async () => {
    try {
      const r = await tentar(() => api('POST', `/api/tabelas/${id}/itens/lote`, { texto: el.querySelector('[data-lote]').value }));
      toast(`${r.importados} preço(s) importado(s)`);
      if (r.erros.length) toast(r.erros.slice(0, 5).join(' | '), 'erro');
      aoMudar();
      editarTabela(id, aoMudar);
      el.closest('.modal-fundo').remove();
    } catch { /* exibido */ }
  };
  el.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-produto]');
    if (!inp) return;
    const pid = inp.dataset.produto;
    try {
      if (inp.value.trim() === '') {
        await api('DELETE', `/api/tabelas/${id}/itens/${pid}`);
        toast('Produto removido da tabela');
      } else {
        const r = await api('PUT', `/api/tabelas/${id}/itens/${pid}`, { preco: inp.value });
        inp.value = centavosParaTexto(r.preco_centavos);
        toast('Preço salvo');
      }
      inp.classList.remove('input-erro');
      aoMudar();
    } catch (err) {
      inp.classList.add('input-erro');
      toast(err.message, 'erro');
    }
  });
}

export async function telaTabelas(alvo) {
  const carregar = async () => {
    const tabelas = await api('GET', '/api/tabelas');
    alvo.querySelector('[data-lista]').innerHTML = tabelas.length ? `<div class="tabela-rolagem"><table class="tabela tabela-clicavel">
      <thead><tr><th>Tabela</th><th>Aplica-se a</th><th class="num">Produtos</th><th>Situação</th></tr></thead>
      <tbody>${tabelas.map((t) => `<tr data-id="${t.id}" class="${t.ativo ? '' : 'inativo'}">
        <td><strong>${esc(t.nome)}</strong></td>
        <td>${t.padrao ? '<span class="selo selo-info">Padrão: todos os clientes</span> ' : ''}
          ${t.qtd_grupos ? `${t.qtd_grupos} grupo(s) ` : ''}${t.qtd_clientes ? `${t.qtd_clientes} cliente(s)` : ''}
          ${!t.padrao && !t.qtd_grupos && !t.qtd_clientes ? '<small class="txt-alerta">sem vínculo</small>' : ''}</td>
        <td class="num">${t.qtd_itens}</td><td>${t.ativo ? 'Ativa' : 'Inativa'}</td></tr>`).join('')}</tbody></table></div>`
      : vazio('Nenhuma tabela. Crie a tabela padrão primeiro.');
  };
  alvo.innerHTML = `<section class="cartao">
    <div class="cabecalho-secao"><h3>Tabelas de preço</h3><button class="btn btn-primario" data-nova>+ Nova tabela</button></div>
    <p class="dica">Itens vendidos abaixo do preço da tabela do cliente precisam da sua aprovação.</p>
    <div data-lista></div></section>`;
  alvo.querySelector('[data-nova]').onclick = async () => {
    const nome = prompt('Nome da nova tabela de preço:');
    if (!nome) return;
    try {
      const r = await tentar(() => api('POST', '/api/tabelas', { nome }), 'Tabela criada');
      await carregar();
      editarTabela(r.id, carregar);
    } catch { /* exibido */ }
  };
  alvo.querySelector('[data-lista]').onclick = (e) => {
    const tr = e.target.closest('[data-id]');
    if (tr) tentar(() => editarTabela(Number(tr.dataset.id), carregar));
  };
  alvo.recarregar = carregar;
  await tentar(carregar);
}


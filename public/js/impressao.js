import { api, esc, moeda, dataHora } from './util.js';

const id = Number(new URLSearchParams(location.search).get('id'));
const alvo = document.getElementById('cupom');
const q = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function render(p) {
  return `
    <h1>PEDIDO #${p.id}</h1>
    <div class="centro">${dataHora(p.criado_em)} · Vend.: ${esc(p.vendedor_nome)}</div>
    <hr>
    <div><strong>${esc(p.cliente_fantasia || p.cliente_nome)}</strong></div>
    <div>${esc(p.cliente_nome)}</div>
    <div>${esc(p.cliente_documento || '')} ${p.cliente_cidade ? `· ${esc(p.cliente_cidade)}/${esc(p.cliente_uf || '')}` : ''}</div>
    <hr>
    <table>${p.itens.map((i) => `
      <tr><td colspan="2" class="desc">${esc(i.codigo)} ${esc(i.descricao)}</td></tr>
      <tr><td>${i.peso_real != null ? `${q(i.peso_real)} kg (pesado)` : `${q(i.quantidade)} ${esc(i.unidade)}`} x ${moeda(i.preco_centavos)}</td>
          <td class="num">${moeda(i.total_centavos)}</td></tr>`).join('')}
    </table>
    <hr>
    <table><tr><td class="total">TOTAL</td><td class="num total">${moeda(p.total_centavos)}</td></tr></table>
    <div>${p.itens.length} item(ns)</div>
    ${p.observacao ? `<hr><div><strong>OBS:</strong> ${esc(p.observacao)}</div>` : ''}
    <hr>
    <div>Status: ${esc(p.rotulo_status)}</div>
    <div>Impresso em ${new Date().toLocaleString('pt-BR')}</div>
    <br><div>Conferido: ____________________</div>`;
}

async function marcarImpresso() {
  try { await api('POST', `/api/pedidos/${id}/impresso`); } catch { /* sem permissão: só visualização */ }
}

document.getElementById('imprimir').onclick = () => window.print();
window.addEventListener('afterprint', marcarImpresso);

try {
  const p = await api('GET', `/api/pedidos/${id}`);
  alvo.innerHTML = render(p);
  document.title = `Pedido ${p.id}`;
  setTimeout(() => window.print(), 300);
} catch (e) {
  alvo.innerHTML = `<div class="aviso">${esc(e.message)}</div>`;
}

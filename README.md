# Pedidos: sistema de pedidos para atacado de hortifruti

Sistema web, complementar ao **Visual Software**, para o fluxo de pedidos de um atacadista de frutas e verduras. Funciona no celular (vendedores, inclusive **sem internet**), no **tablet** (expedição) e no computador (gestor e faturamento):

```
Vendedor lança o pedido
   │  (algum item abaixo do preço da tabela?)
   ├── sim ──► Gestor aprova/reprova o preço ──► reprovado: volta ao vendedor para ajuste
   ▼
Expedição aceita ──► separa e pesa os itens pesáveis ──► conclui
   ▼
Pedido impresso ──► Faturamento: exporta arquivo ──► importa no Visual Software ──► Faturado
```

## Perfis de usuário

| Perfil | O que faz |
|---|---|
| **Vendedor** | Escolhe o cliente na lista, adiciona produtos (o preço da tabela do cliente vem preenchido), ajusta quantidade/preço e envia. Funciona **offline**. Acompanha seus pedidos e corrige os que voltarem. |
| **Gestor** | Aprova ou reprova preços abaixo da tabela (recebe notificação na hora), cadastra clientes, grupos, produtos, usuários e **tabelas de preço**. Vê e pode agir em todas as etapas. |
| **Expedição** | Tela feita para **tablet**: lista de pedidos de um lado e o pedido aberto do outro. Aceita, informa o **peso real** dos pesáveis, a **quantidade atendida** (parcial) ou marca **Falta**, e conclui. O valor é recalculado e o pedido é impresso. Pode devolver ao vendedor. |
| **Faturamento** | Exporta os pedidos pesados para o **Visual Software** (arquivo CSV) e marca como faturados (com número da NF). |

## Tabelas de preço

- Pode haver **várias tabelas**. Cada uma pode ser vinculada a **clientes específicos**, a **grupos de clientes** ou ser a **tabela padrão**.
- Prioridade do preço para um cliente: **tabela do cliente > tabela do grupo > tabela padrão**. Se o produto não estiver numa tabela, vale a próxima.
- Item vendido **abaixo** do preço da tabela (ou produto sem preço) fica pendente de aprovação do gestor.
- Os preços podem ser digitados um a um ou **colados de uma planilha** (`CÓDIGO;PREÇO`).

## Hortifruti: venda por unidade/caixa cobrada por kg e desconto da caixa (tara)

- **Produto pesável** = cobrado pelo peso real (preço por kg).
- Se o cliente pede em **unidades ou caixas** (ex.: 10 abacaxis), o produto tem "vendedor pede em" = `UN`/`CX` e um **peso médio** (ex.: 1,8 kg). O vendedor digita 10 UN; o sistema mostra a estimativa (≈ 18 kg) e o valor estimado.
- Na expedição, para cada pesável: **Caixas** (já vem preenchido quando o pedido é em caixas) e **Peso bruto** da balança. Dá para somar várias pesadas: `12,1+11,3`.
- O sistema desconta **caixas × tara** (padrão 2 kg por caixa, ajustável por produto) e cobra o **peso líquido**. Ex.: bruto 23,4 kg − 2 cx × 2 kg = 19,4 kg × R$ 4,50.
- O comprovante impresso e o arquivo do Visual Software trazem pedido, bruto, caixas, tara e líquido.

### Separação item por item (OK)

- Cada item do pedido tem um botão **OK**. A expedição pode separar um produto, dar OK, sair do pedido e voltar depois: os itens com OK ficam marcados (verde) e travados, com **Desfazer** para corrigir.
- Pesável só aceita OK depois de pesado. Item comum: OK direto = atendido inteiro; ou digite a quantidade parcial antes. **Falta** já conta como resolvido.
- A lista mostra o progresso ("3 de 4 itens com OK") e **Concluir** só passa quando todos os itens têm OK.

## Vendedor sem internet (offline)

- Ao entrar com internet, o aparelho baixa **clientes, produtos e tabelas de preço** (e atualiza a cada 30 min).
- Sem internet o app **abre normalmente** e o vendedor faz pedidos; eles ficam guardados no aparelho ("No aparelho, ainda não enviados").
- Quando a conexão volta, os pedidos são **enviados sozinhos** (ou pelo botão "Enviar agora"). Cada pedido tem um identificador único, então reenviar nunca duplica.
- O indicador no topo mostra **Online/Offline** e quantos pedidos faltam enviar. Tocar nele força a sincronização.
- O preço exibido offline é o da última atualização; o servidor confere de novo ao receber (e manda para aprovação se estiver abaixo da tabela).
- Ao sair com pedidos não enviados, o app avisa. Cada vendedor só vê/envia os próprios pedidos do aparelho.
- **Importante:** o modo offline exige que o sistema esteja publicado com **HTTPS** (regra dos navegadores). Em `localhost` funciona para testes.
- Dica: no celular/tablet, use "Adicionar à tela inicial" para abrir como aplicativo.

## Integração com o Visual Software

**Pedidos → Visual Software:** na tela do Faturamento, "Exportar pedidos pendentes" gera um arquivo com todos os pedidos aguardando faturamento ainda não exportados (cada pedido sai uma vez; itens em falta não entram). Formato CSV separado por `;`, decimais com vírgula, codificação Windows (ISO-8859-1), uma linha por item:

```
NUMERO_PEDIDO;DATA_PEDIDO;CLIENTE_CODIGO;CLIENTE_CNPJ_CPF;CLIENTE_RAZAO_SOCIAL;VENDEDOR;ITEM;PRODUTO_CODIGO;PRODUTO_DESCRICAO;UNIDADE;QUANTIDADE_PEDIDA;QUANTIDADE_FINAL;PRECO_UNITARIO;TOTAL_ITEM;TOTAL_PEDIDO;OBSERVACAO
```

> Este é um layout provisório. Assim que tivermos o **layout de importação do Visual Software**, ajustamos o arquivo (em `src/exportacao.js`) para ficar exatamente no formato dele. Também há saída em JSON, para uma futura integração automática.

**Visual Software → Pedidos:** em Clientes e Produtos, "Importar do Visual Software" aceita o arquivo exportado de lá (ou texto colado), para que os **códigos sejam os mesmos** nos dois sistemas:

- Clientes: `CODIGO;RAZAO_SOCIAL;NOME_FANTASIA;CNPJ_CPF;CIDADE;UF;TELEFONE;GRUPO`
- Produtos: `CODIGO;DESCRICAO;UNIDADE;PESAVEL (S/N)`

Registros com código existente são atualizados; os novos são criados.

## Como rodar

Requer **Node.js 22.13 ou mais novo** (o banco SQLite já vem embutido no Node).

```bash
npm install
npm run seed     # opcional: cria dados de demonstração
npm start        # abre em http://localhost:3000
```

Logins da demonstração: `gestor/admin123`, `carlos/123456` e `ana/123456` (vendedores), `expedicao/123456`, `faturamento/123456`.

Sem a demonstração, o sistema cria apenas o usuário `gestor` com a senha `admin123` (ou a definida em `SENHA_GESTOR`). **Troque a senha no primeiro acesso.**

Variáveis de ambiente: `PORT` (padrão 3000), `DB_FILE` (padrão `data/pedidos.db`), `SENHA_GESTOR`.

Testes: `npm test`

## Notificações

O sistema avisa em tempo real (sem recarregar a página): o gestor quando chega preço para aprovar, a expedição quando chega pedido novo, o faturamento quando um pedido é pesado e o vendedor quando o pedido volta, é liberado ou faturado. Clicando em **"Ativar notificações"** o aviso aparece também como notificação do sistema, enquanto o navegador estiver aberto.

## Impressão

Ao concluir a pesagem abre-se o comprovante do pedido no formato de **impressora térmica de 80 mm** (também imprime em A4). A impressão é marcada no histórico do pedido.

## Estrutura

```
src/
  server.js          inicia o servidor
  app.js             rotas HTTP e tratamento de erros
  db.js              esquema do banco (SQLite)
  pedidos.js         regras de negócio e fluxo de status
  precos.js          resolução do preço por cliente/grupo/padrão
  auth.js            login e permissões por perfil
  eventos.js         notificações em tempo real (SSE)
  exportacao.js      exportação para o Visual Software e importação de cadastros
  rotas/             rotas de pedidos e cadastros
  seed.js            dados iniciais/demonstração
public/              telas (HTML/CSS/JS sem framework), sw.js (offline) e manifest (instalar como app)
test/                testes automatizados
```

## Próximos passos

- [ ] Definir a impressora e imprimir direto, sem a janela de impressão (agente de impressão ESC/POS)
- [ ] Ajustar a exportação ao layout oficial de importação do **Visual Software**
- [ ] Leitura automática do peso pela balança da expedição
- [ ] Notificação push no celular do gestor, mesmo com o app fechado (PWA + Web Push)
- [ ] Instalação num servidor da empresa ou na nuvem, com HTTPS e backup do banco

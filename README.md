# Pedidos: sistema de pedidos para atacado

Sistema web (funciona no celular e no computador) para o fluxo de pedidos de uma distribuidora atacadista:

```
Vendedor lança o pedido
   │  (algum item abaixo do preço da tabela?)
   ├── sim ──► Gestor aprova/reprova o preço ──► reprovado: volta ao vendedor para ajuste
   ▼
Expedição aceita ──► separa e pesa os itens pesáveis ──► conclui
   ▼
Pedido impresso automaticamente ──► Faturamento ──► Faturado
```

## Perfis de usuário

| Perfil | O que faz |
|---|---|
| **Vendedor** | Escolhe o cliente na lista, adiciona produtos (o preço da tabela do cliente vem preenchido), ajusta quantidade/preço e envia. Acompanha seus pedidos e corrige os que voltarem. |
| **Gestor** | Aprova ou reprova preços abaixo da tabela (recebe notificação na hora), cadastra clientes, grupos, produtos, usuários e **tabelas de preço**. Vê e pode agir em todas as etapas. |
| **Expedição** | Recebe os pedidos liberados, aceita, informa o **peso real** dos itens pesáveis e conclui. O valor é recalculado pelo peso e o pedido é impresso. Pode devolver ao vendedor (ex.: falta de estoque). |
| **Faturamento** | Recebe os pedidos pesados e marca como faturados (com número da NF). |

## Tabelas de preço

- Pode haver **várias tabelas**. Cada uma pode ser vinculada a **clientes específicos**, a **grupos de clientes** ou ser a **tabela padrão**.
- Prioridade do preço para um cliente: **tabela do cliente > tabela do grupo > tabela padrão**. Se o produto não estiver numa tabela, vale a próxima.
- Item vendido **abaixo** do preço da tabela (ou produto sem preço) fica pendente de aprovação do gestor.
- Os preços podem ser digitados um a um ou **colados de uma planilha** (`CÓDIGO;PREÇO`).

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
  rotas/             rotas de pedidos e cadastros
  seed.js            dados iniciais/demonstração
public/              telas (HTML/CSS/JS sem framework)
test/                testes automatizados
```

## Próximos passos

- [ ] Definir a impressora e imprimir direto, sem a janela de impressão (agente de impressão ESC/POS)
- [ ] Integração com o **Visual Software** (clientes, produtos e envio dos pedidos para faturar)
- [ ] Leitura automática do peso pela balança da expedição
- [ ] Notificação push no celular do gestor, mesmo com o app fechado (PWA + Web Push)
- [ ] Instalação num servidor da empresa ou na nuvem, com HTTPS e backup do banco

# Sistema de Reservas de Salas — SENAI José Oscar Salazar

Projeto Integrador II. Sistema web para professores reservarem salas por data e turno, sem conflitos, com troca de sala entre professores e uma área de coordenação que gera a grade de salas automaticamente com o algoritmo clássico de backtracking.

## Tecnologias

- Backend: Node.js, Express, SQLite (better-sqlite3)
- Segurança: bcrypt (senhas), JWT (sessão), helmet (cabeçalhos), express-rate-limit (limite de tentativas de login)
- Frontend: HTML, CSS e JavaScript puros (sem framework)

## Como rodar

Dentro da pasta `backend`(pra entrar nela é só abrir o terminal e dar cd backend):

(se for windows, antes dos passos a seguir de npm.cmd Install better-sqlite3@ˆ12)

1. Instale as dependências: `npm install`
2. Crie um arquivo `.env` com uma chave secreta qualquer: `JWT_SECRET=troque-por-uma-frase-longa`
3. Crie as contas de teste: `node CriarCredenciaisDeTeste.js` no terminal
4. Inicie o servidor: `node server.js` no terminal
5. Abra `http://localhost:6767` no navegador

O banco (`reservas.db`) e o `.env` ficam sempre na pasta `backend`, não importa de onde o comando seja executado.

## Contas de teste

A senha de todas é `Senha@123`. Os CPFs são fictícios.

- Professores: `90000000001` (Sami Berti), `90000000002` (Aletodescatt), e assim por diante até `90000000013`
- Coordenadoras: `90000000101`, `90000000102` e `90000000103`

## Geração automática de grade (backtracking)

A coordenadora escolhe a data, o turno, o motivo e os professores. Nenhuma sala é digitada: o algoritmo decide.

- Cada professor tem, no banco (tabela `professor_salas`), uma lista de salas em ordem de preferência: primeiro as salas do curso dele (por exemplo, Solda 1 e Solda 2 para o professor de Solda) e depois as salas comuns. Em aula teórica, as salas comuns vêm primeiro.
- O backtracking percorre os professores um a um, escolhe a primeira sala livre da lista, avança para o próximo e, se um professor ficar sem sala, desfaz a escolha anterior (`pop`) e tenta a próxima sala.
- Antes da busca há uma poda inicial: professor que já tem reserva no período, ou professor sem nenhuma sala livre, é avisado na hora.
- Como o backtracking pode crescer muito, a busca tem um limite de segurança de verificações.
- A tela mostra quantas escolhas o algoritmo testou e quantas vezes voltou atrás.
- Existe uma opção, desligada por padrão, de priorizar quem tem menos opções de sala (atendê-los primeiro). Ela pode reduzir ou aumentar o número de retrocessos, dependendo do caso.
- A grade gerada é só uma sugestão até a coordenadora clicar em "Confirmar grade", que cria todas as reservas de uma vez.

## Estrutura

- `backend/server.js`: rotas da API e regras do sistema
- `backend/database.js`: criação do banco, tabelas e dados iniciais
- `frontend/`: telas do sistema (`index.html`, `style.css`, `app.js`)

## Regras principais

- Uma sala não pode ter duas reservas confirmadas no mesmo dia e turno, e um professor também não.
- Não é possível reservar datas que já passaram.
- O motivo de reservas e trocas tem no máximo 300 caracteres.
- Trocas de sala só acontecem entre reservas do mesmo dia e turno e precisam ser aceitas pelo outro professor ou pela coordenação. Se uma das reservas for cancelada ou alterada, os pedidos pendentes são encerrados.
- Toda ação importante fica registrada no histórico.
- A coordenação pode alterar e cancelar qualquer reserva e gerar grades com backtracking.

## Segurança

- Senhas guardadas apenas como hash (bcrypt) e login com mensagem igual para CPF ou senha errados.
- Sessão por token JWT com validade de 2 horas; rotas protegidas por token e por papel.
- Consultas SQL sempre com parâmetros (protege contra SQL injection) e textos escapados na tela (protege contra XSS).
- Login limitado a 10 tentativas erradas a cada 15 minutos por CPF (e um limite geral maior por endereço), para um professor não bloquear os outros que usam a mesma rede.
- Cabeçalhos de segurança com helmet.
- Erros inesperados respondem uma mensagem simples; os detalhes ficam só no terminal.

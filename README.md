# Sistema de Reserva de Salas

Sistema desenvolvido para facilitar o gerenciamento e a organização de reservas de salas, permitindo que professores consultem a disponibilidade dos ambientes e realizem solicitações de reserva.

## Como executar o projeto

Para utilizar o sistema, é necessário baixar o projeto e executá-lo localmente no computador.

### 1. Baixar o projeto

1. Acesse este repositório no GitHub.
2. Clique no botão **Code**.
3. Selecione **Download ZIP**.
4. Extraia o arquivo ZIP em uma pasta do computador.

### 2. Instalar o Node.js

O projeto utiliza Node.js para executar o servidor.

Caso ainda não tenha instalado, acesse o site oficial e faça o download:

https://nodejs.org/

Recomenda-se instalar a versão LTS.

### 3. Instalar as dependências

1. Abra a pasta do projeto extraída.
2. Entre na pasta `backend`.
3. Abra um terminal nessa pasta.
4. Execute o seguinte comando:

```bash
npm install
```

Esse comando instalará as dependências necessárias para executar o sistema.

### 4. Iniciar o sistema

Após a instalação das dependências, execute:

```bash
npm start
```

O servidor será iniciado localmente na porta `6767`.

### 5. Acessar o sistema

Com o servidor em execução, abra seu navegador e acesse:

**http://localhost:6767**

Pronto! O sistema estará disponível para utilização.

---

## Banco de dados

O projeto utiliza SQLite para armazenar as informações das reservas.

O banco de dados é armazenado localmente no computador onde o sistema está sendo executado.

Isso significa que:

- Não é necessária uma hospedagem externa.
- As reservas ficam salvas no próprio computador.
- Cada instalação possui seu próprio banco de dados.
- Os dados permanecem disponíveis mesmo após fechar o sistema, desde que o arquivo do banco seja preservado.

**Importante:** como o sistema funciona localmente, diferentes computadores não compartilham automaticamente as mesmas reservas. Para que vários usuários utilizem o mesmo banco de dados, seria necessário hospedar o backend em um servidor acessível por todos.

---

## Tecnologias utilizadas

- **HTML5** – Estrutura das páginas.
- **CSS3** – Estilização e organização visual.
- **JavaScript** – Funcionalidades e interatividade.
- **Node.js** – Execução do servidor.
- **Express** – Gerenciamento das rotas e requisições.
- **SQLite** – Armazenamento dos dados.

---

## Observações

- O terminal precisa permanecer aberto enquanto o sistema estiver sendo utilizado.
- Para encerrar o servidor, pressione `Ctrl + C` no terminal.
- Para iniciar novamente, basta acessar a pasta `backend` e executar `npm start`.
- Não compartilhe arquivos contendo senhas, tokens ou chaves secretas.

**Desenvolvido como projeto acadêmico.**

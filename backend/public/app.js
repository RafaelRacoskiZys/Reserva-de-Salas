const telaLogin = document.querySelector("#tela-login");
const telaSistema = document.querySelector("#tela-sistema");
const formLogin = document.querySelector("#form-login");
const mensagemLogin = document.querySelector("#mensagem-login");
const mensagemSistema = document.querySelector("#mensagem-sistema");
const nomeUsuario = document.querySelector("#nome-usuario");
const dataReserva = document.querySelector("#data-reserva");
const turnoReserva = document.querySelector("#turno-reserva");
const motivoReserva = document.querySelector("#motivo-reserva");
const salasDisponiveis = document.querySelector("#salas-disponiveis");
const botaoReservar = document.querySelector("#botao-reservar");
const minhasReservas = document.querySelector("#minhas-reservas");

let usuarioLogado = JSON.parse(localStorage.getItem("usuario"));
let salaSelecionadaId = null;

function mostrarMensagem(elemento, texto, tipo = "") {
  elemento.textContent = texto;
  elemento.className = `mensagem ${tipo}`;
}

function token() {
  return localStorage.getItem("token");
}

async function requisicao(url, opcoes = {}) {
  const resposta = await fetch(url, {
    ...opcoes,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
      ...opcoes.headers
    }
  });

  const dados = await resposta.json();

  if (!resposta.ok) {
    if (resposta.status === 401) {
      sair();
    }

    throw new Error(dados.erro || "Não foi possível concluir a operação.");
  }

  return dados;
}

function formatarData(data) {
  return new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR");
}

function mostrarSistema() {
  telaLogin.hidden = true;
  telaSistema.hidden = false;
  nomeUsuario.textContent = `${usuarioLogado.nome} (${usuarioLogado.papel})`;
  carregarMinhasReservas();
}

function sair() {
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
  usuarioLogado = null;
  salaSelecionadaId = null;
  telaSistema.hidden = true;
  telaLogin.hidden = false;
  formLogin.reset();
  salasDisponiveis.innerHTML = "";
  botaoReservar.disabled = true;
  mostrarMensagem(mensagemSistema, "");
}

async function carregarSalasDisponiveis() {
  const data = dataReserva.value;
  const turno = turnoReserva.value;

  if (!data) {
    mostrarMensagem(mensagemSistema, "Selecione uma data antes de buscar as salas.", "erro");
    return;
  }

  try {
    mostrarMensagem(mensagemSistema, "Buscando salas disponíveis...");
    const resposta = await requisicao(
      `/salas-disponiveis?data=${data}&turno=${turno}`
    );

    salaSelecionadaId = null;
    botaoReservar.disabled = true;
    salasDisponiveis.innerHTML = "";

    if (resposta.salas.length === 0) {
      salasDisponiveis.textContent = "Não há salas disponíveis nesse período.";
      return;
    }

    for (const sala of resposta.salas) {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "sala";
      botao.innerHTML = `${sala.nome}<span>${sala.tipo}</span>`;

      botao.addEventListener("click", () => {
        document.querySelectorAll(".sala").forEach((item) => {
          item.classList.remove("selecionada");
        });

        botao.classList.add("selecionada");
        salaSelecionadaId = sala.id;
        botaoReservar.disabled = false;
        mostrarMensagem(mensagemSistema, `Sala selecionada: ${sala.nome}.`, "sucesso");
      });

      salasDisponiveis.appendChild(botao);
    }

    mostrarMensagem(mensagemSistema, "Escolha uma das salas disponíveis.");
  } catch (erro) {
    mostrarMensagem(mensagemSistema, erro.message, "erro");
  }
}

async function carregarMinhasReservas() {
  try {
    const reservas = await requisicao("/minhas-reservas");
    minhasReservas.innerHTML = "";

    if (reservas.length === 0) {
      minhasReservas.textContent = "Você ainda não possui reservas.";
      return;
    }

    const salas = await requisicao("/salas");

    for (const reserva of reservas) {
      const sala = salas.find((item) => item.id === reserva.salaId);
      const item = document.createElement("article");
      item.className = "reserva";
      const statusClasse = reserva.status === "cancelada" ? "cancelada" : "";

      item.innerHTML = `
        <div>
          <strong>${sala ? sala.nome : "Sala não encontrada"}</strong>
          <p>${formatarData(reserva.data)} - ${reserva.turno} - ${reserva.motivo}</p>
          <span class="status ${statusClasse}">${reserva.status}</span>
        </div>
      `;

      if (reserva.status === "confirmada") {
        const botaoCancelar = document.createElement("button");
        botaoCancelar.type = "button";
        botaoCancelar.className = "botao-secundario";
        botaoCancelar.textContent = "Cancelar";

        botaoCancelar.addEventListener("click", async () => {
          if (!confirm("Deseja cancelar esta reserva?")) return;

          try {
            await requisicao(`/reservas/${reserva.id}/cancelar`, {
              method: "PATCH"
            });
            mostrarMensagem(mensagemSistema, "Reserva cancelada com sucesso.", "sucesso");
            carregarMinhasReservas();
          } catch (erro) {
            mostrarMensagem(mensagemSistema, erro.message, "erro");
          }
        });

        item.appendChild(botaoCancelar);
      }

      minhasReservas.appendChild(item);
    }
  } catch (erro) {
    mostrarMensagem(mensagemSistema, erro.message, "erro");
  }
}

formLogin.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  try {
    mostrarMensagem(mensagemLogin, "Entrando...");
    const resposta = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cpf: document.querySelector("#cpf").value,
        senha: document.querySelector("#senha").value
      })
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.erro || "Não foi possível fazer login.");
    }

    localStorage.setItem("token", dados.token);
    localStorage.setItem("usuario", JSON.stringify(dados.usuario));
    usuarioLogado = dados.usuario;
    mostrarMensagem(mensagemLogin, "");
    mostrarSistema();
  } catch (erro) {
    mostrarMensagem(mensagemLogin, erro.message, "erro");
  }
});

document.querySelector("#botao-buscar-salas").addEventListener("click", carregarSalasDisponiveis);

botaoReservar.addEventListener("click", async () => {
  if (!salaSelecionadaId) return;

  try {
    const reserva = await requisicao("/reservas", {
      method: "POST",
      body: JSON.stringify({
        salaId: salaSelecionadaId,
        data: dataReserva.value,
        turno: turnoReserva.value,
        motivo: motivoReserva.value
      })
    });

    mostrarMensagem(
      mensagemSistema,
      `Reserva criada com sucesso. Número da reserva: ${reserva.id}.`,
      "sucesso"
    );
    salasDisponiveis.innerHTML = "";
    salaSelecionadaId = null;
    botaoReservar.disabled = true;
    carregarMinhasReservas();
  } catch (erro) {
    mostrarMensagem(mensagemSistema, erro.message, "erro");
  }
});

document.querySelector("#botao-atualizar-reservas").addEventListener("click", carregarMinhasReservas);
document.querySelector("#botao-sair").addEventListener("click", sair);

dataReserva.value = new Date().toISOString().slice(0, 10);

if (token() && usuarioLogado) {
  mostrarSistema();
}

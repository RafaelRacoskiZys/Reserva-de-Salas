"use strict";

/* =========================================================
   Utilidades
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtData = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const fmtDataHora = (s) => {
  const d = new Date(String(s).replace(" ", "T") + "Z"); // SQLite grava em UTC
  return isNaN(d) ? s : `${fmtData(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dataLocalDe = (s) => {
  const d = new Date(String(s).replace(" ", "T") + "Z");
  return isNaN(d) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const TURNOS = {
  manha: { nome: "Manhã", horas: "07h00 – 12h00" },
  tarde: { nome: "Tarde", horas: "13h00 – 17h00" },
  noite: { nome: "Noite", horas: "18h00 – 22h00" },
};
const ORDEM_TURNO = { manha: 0, tarde: 1, noite: 2 };
const porPeriodo = (a, b) => a.data.localeCompare(b.data) || ORDEM_TURNO[a.turno] - ORDEM_TURNO[b.turno];

const MOTIVOS = ["Aula teórica", "Aula prática", "Reposição de aula", "Avaliação", "Reunião", "Palestra ou evento"];

const STATUS = {
  confirmada: ["Confirmada", "ok"],
  cancelada: ["Cancelada", "bad"],
  pendente_troca: ["Troca pendente", "warn"],
};
const STATUS_TROCA = { pendente: ["Pendente", "warn"], aceita: ["Aceita", "ok"], recusada: ["Recusada", "bad"] };
const ACOES = {
  reserva_criada: "Criou reserva",
  reserva_alterada: "Alterou reserva",
  reserva_cancelada: "Cancelou reserva",
  troca_solicitada: "Solicitou troca",
  troca_aceita: "Aceitou troca",
  troca_recusada: "Recusou troca",
};
const PAPEIS = { professor: "Professor(a)", coordenadora: "Coordenador(a)" };

const pill = ([texto, tipo]) => `<span class="pill ${tipo}">${esc(texto)}</span>`;
const nomeTurno = (t) => `${TURNOS[t]?.nome ?? t} (${TURNOS[t]?.horas ?? ""})`;

/* =========================================================
   Sessão e API
   ========================================================= */
const sessao = {
  get token() { return localStorage.getItem("token"); },
  get usuario() {
    try { return JSON.parse(localStorage.getItem("usuario")); } catch { return null; }
  },
  salvar(token, usuario) {
    localStorage.setItem("token", token);
    localStorage.setItem("usuario", JSON.stringify(usuario));
  },
  limpar() {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    cacheSalas = null;
  },
};

async function api(caminho, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (sessao.token) headers.Authorization = `Bearer ${sessao.token}`;

  const resp = await fetch(caminho, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let dados = null;
  try { dados = await resp.json(); } catch { /* resposta sem JSON */ }

  if (resp.status === 401 && caminho !== "/login") {
    sessao.limpar();
    location.hash = "#/login";
    throw new Error("Sessão expirada. Entre novamente.");
  }
  if (!resp.ok) throw new Error(dados?.erro || `Erro inesperado (${resp.status}).`);
  return dados;
}

let cacheSalas = null;
async function salas() {
  if (!cacheSalas) cacheSalas = await api("/salas");
  return cacheSalas;
}
const nomeSala = (lista, id) => lista.find((s) => s.id === id)?.nome ?? `Sala ${id}`;

// Lista resumida de reservas com nome da sala e do professor.
async function resumo() {
  try { return await api("/reservas-resumo"); } catch { return null; }
}

async function buscarReserva(id) {
  const u = sessao.usuario;
  const lista = await api(u.papel === "professor" ? "/minhas-reservas" : "/reservas");
  const r = lista.find((x) => x.id === Number(id));
  if (!r) throw new Error("Reserva não encontrada.");
  return r;
}

/* =========================================================
   Layout
   ========================================================= */
let aviso = null;
const flash = (msg, tipo = "") => { aviso = { msg, tipo }; };

function montar(ativo, conteudo) {
  const u = sessao.usuario;
  const prof = u.papel === "professor";
  const itens = [
    ["inicio", "Início"],
    ["salas", "Salas"],
    ...(prof ? [["nova", "Nova reserva"]] : []),
    ["reservas", prof ? "Minhas reservas" : "Todas as reservas"],
    ["trocas", "Trocas de sala"],
    ...(!prof ? [["grade", "Gerar grade"]] : []),
    ["historico", "Histórico"],
  ];
  const iniciais = u.nome.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  const banner = aviso ? `<div class="aviso ${aviso.tipo}" role="status">${esc(aviso.msg)}</div>` : "";
  aviso = null;

  $("#app").innerHTML = `
    <div class="layout">
      <aside class="menu">
        <div class="logo">SENAI</div>
        <div class="logo-sub">Reserva de Salas</div>
        <nav>
          ${itens.map(([id, nome]) => `<a href="#/${id}" class="${id === ativo ? "ativo" : ""}">${nome}</a>`).join("")}
          <button class="sair" id="sair">Sair</button>
        </nav>
        <a class="usuario" href="#/perfil" title="Meu perfil">
          <span class="avatar">${esc(iniciais)}</span>
          <span><strong>${esc(u.nome)}</strong><small>${PAPEIS[u.papel] ?? u.papel}</small></span>
        </a>
      </aside>
      <main id="conteudo">${banner}${conteudo}</main>
    </div>`;
  $("#sair").onclick = () => { sessao.limpar(); location.hash = "#/login"; };
}

const carregando = () => {
  const c = $("#conteudo");
  if (c) c.innerHTML = `<p class="muted">Carregando…</p>`;
};

const cartaoReserva = (r, listaSalas, extra = "") => `
  <div class="card item">
    <div class="info">
      <div>${pill(STATUS[r.status] ?? [r.status, ""])}</div>
      <strong>${esc(nomeSala(listaSalas, r.salaId))}</strong>
      <span>${fmtData(r.data)} · ${nomeTurno(r.turno)}</span>
      <span class="muted">${esc(r.motivo)}</span>
    </div>
    ${extra}
  </div>`;

/* =========================================================
   Login
   ========================================================= */
function telaLogin() {
  $("#app").innerHTML = `
    <div class="login">
      <section class="marca">
        <div class="logo">SENAI</div>
        <div class="logo-sub">Reserva de Salas</div>
        <p>Mais organização para o seu dia a dia.</p>
      </section>
      <section class="caixa">
        <h1>Bem-vindo!</h1>
        <p class="muted">Faça login com seu CPF e senha para acessar o sistema.</p>
        <form id="login" class="form">
          <label>CPF
            <input type="text" id="cpf" inputmode="numeric" autocomplete="username" placeholder="Digite seu CPF" required>
          </label>
          <label>Senha
            <input type="password" id="senha" autocomplete="current-password" placeholder="Digite sua senha" required>
          </label>
          <p class="erro" id="erro" hidden></p>
          <button class="btn bloco">Entrar</button>
        </form>
      </section>
    </div>`;

  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    const erro = $("#erro");
    erro.hidden = true;
    try {
      const r = await api("/login", { method: "POST", body: { cpf: $("#cpf").value, senha: $("#senha").value } });
      sessao.salvar(r.token, r.usuario);
      location.hash = "#/inicio";
    } catch (err) {
      erro.textContent = err.message;
      erro.hidden = false;
    }
  };
}

/* =========================================================
   Início
   ========================================================= */
async function telaInicio() {
  const u = sessao.usuario;
  const prof = u.papel === "professor";
  const [reservas, trocas, lista, professores] = await Promise.all([
    api(prof ? "/minhas-reservas" : "/reservas"),
    api("/trocas"),
    salas(),
    prof ? null : api("/professores"),
  ]);

  const proximas = reservas.filter((r) => r.status === "confirmada" && r.data >= hoje()).sort(porPeriodo);
  const meus = new Set(reservas.map((r) => r.id));
  const trocasPendentes = trocas.filter((t) => t.status === "pendente" && (!prof || meus.has(t.reservaDestinoId)));
  const nomeProf = (id) => professores?.find((p) => p.id === id)?.nome ?? "";

  montar("inicio", `
    <h1>Olá, ${esc(u.nome.split(" ")[0])}!</h1>
    <p class="muted">Aqui está um resumo ${prof ? "das suas reservas" : "das reservas do SENAI"}.</p>
    <div class="cards">
      <div class="card stat"><div class="num">${proximas.length}</div><div class="rot">Próximas reservas</div></div>
      <div class="card stat"><div class="num">${trocasPendentes.length}</div><div class="rot">${prof ? "Trocas aguardando você" : "Trocas pendentes"}</div></div>
      <div class="card stat"><div class="num">${reservas.length}</div><div class="rot">Total de reservas</div></div>
    </div>

    <h2>${prof ? "Suas próximas reservas" : "Próximas reservas"}</h2>
    <div class="lista">
      ${proximas.length
        ? proximas.slice(0, 3).map((r) => cartaoReserva(r, lista, prof ? "" : `<div class="info"><span>${esc(nomeProf(r.professorId))}</span></div>`)).join("")
        : `<p class="muted">Nenhuma reserva futura.</p>`}
    </div>

    <h2>Acesso rápido</h2>
    <div class="botoes">
      ${prof ? `<a class="btn" href="#/nova">Nova reserva</a>` : `<a class="btn" href="#/grade">Gerar grade</a>`}
      <a class="btn claro" href="#/reservas">Ver reservas</a>
      <a class="btn claro" href="#/salas">Ver salas</a>
    </div>`);
}

/* =========================================================
   Salas (disponibilidade por turno)
   ========================================================= */
const params = () => Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || ""));

async function telaSalas() {
  const prof = sessao.usuario.papel === "professor";
  const todas = await salas();
  const tipos = [...new Set(todas.map((s) => s.tipo))];
  const st = { data: hoje(), tipo: "" };

  montar("salas", `
    <h1>Disponibilidade das salas</h1>
    <div class="filtros">
      <label>Data<input type="date" id="data" value="${st.data}"></label>
      <label>Tipo de sala
        <select id="tipo"><option value="">Todos</option>${tipos.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
      </label>
    </div>
    <div class="card tabela-wrap" id="quadro"></div>`);

  const desenhar = async () => {
    const quadro = $("#quadro");
    if (!st.data) { quadro.innerHTML = `<p class="muted">Selecione uma data.</p>`; return; }
    quadro.innerHTML = `<p class="muted">Carregando…</p>`;
    let livres;
    try {
      const respostas = await Promise.all(Object.keys(TURNOS).map((t) => api(`/salas-disponiveis?data=${st.data}&turno=${t}`)));
      livres = Object.fromEntries(Object.keys(TURNOS).map((t, i) => [t, new Set(respostas[i].salas.map((s) => s.id))]));
    } catch (e) { quadro.innerHTML = `<p class="erro">${esc(e.message)}</p>`; return; }

    const linhas = todas.filter((s) => !st.tipo || s.tipo === st.tipo);
    quadro.innerHTML = `
      <table>
        <thead><tr><th>Sala</th><th>Tipo</th>${Object.entries(TURNOS).map(([, t]) => `<th class="centro-cel">${t.nome}<br><small class="muted">${t.horas}</small></th>`).join("")}</tr></thead>
        <tbody>${linhas.map((s) => `
          <tr>
            <td>${esc(s.nome)}</td><td>${esc(s.tipo)}</td>
            ${Object.keys(TURNOS).map((t) => {
              const livre = livres[t].has(s.id);
              const alvo = livre && prof && st.data >= hoje()
                ? `<a href="#/nova?data=${st.data}&turno=${t}&sala=${s.id}" title="Reservar">${pill(["Livre", "ok"])}</a>`
                : pill(livre ? ["Livre", "ok"] : ["Ocupada", "bad"]);
              return `<td class="centro-cel">${alvo}</td>`;
            }).join("")}
          </tr>`).join("")}
        </tbody>
      </table>`;
  };

  $("#data").onchange = (e) => { st.data = e.target.value; desenhar(); };
  $("#tipo").onchange = (e) => { st.tipo = e.target.value; desenhar(); };
  desenhar();
}

/* =========================================================
   Campos compartilhados: nova reserva e alterar reserva
   (data, turno, tipo, sala e motivo — tudo por seleção)
   ========================================================= */
async function camposReserva(st) {
  const todas = await salas();
  const tipos = [...new Set(todas.map((s) => s.tipo))];
  const motivos = st.motivo && !MOTIVOS.includes(st.motivo) ? [st.motivo, ...MOTIVOS] : MOTIVOS;
  return `
    <div class="linha">
      <label>Data<input type="date" id="data" min="${hoje()}" value="${esc(st.data)}" required></label>
      <fieldset>
        <legend>Turno</legend>
        <div class="turnos">
          ${Object.entries(TURNOS).map(([id, t]) => `
            <label class="opcao"><input type="radio" name="turno" value="${id}" ${st.turno === id ? "checked" : ""}>
              <span>${t.nome}<small>${t.horas}</small></span></label>`).join("")}
        </div>
      </fieldset>
    </div>
    <label>Tipo de sala
      <select id="tipo"><option value="">Todos</option>${tipos.map((t) => `<option ${st.tipo === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
    </label>
    <fieldset><legend>Sala</legend><div class="grade-salas" id="salas"></div></fieldset>
    <label>Motivo
      <select id="motivo">
        <option value="">Selecione o motivo</option>
        ${motivos.map((m) => `<option ${st.motivo === m ? "selected" : ""}>${esc(m)}</option>`).join("")}
      </select>
    </label>`;
}

async function carregarSalas(alvo, st, opts) {
  const n = String(Number(alvo.dataset.n || 0) + 1);
  alvo.dataset.n = n;
  if (!st.data || !st.turno) {
    st.salaId = null;
    alvo.innerHTML = `<p class="muted">Escolha a data e o turno para ver as salas livres.</p>`;
    opts.onChange?.();
    return;
  }
  alvo.innerHTML = `<p class="muted">Carregando salas…</p>`;
  let livres;
  try {
    livres = (await api(`/salas-disponiveis?data=${st.data}&turno=${st.turno}`)).salas;
  } catch (e) {
    alvo.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    return;
  }
  if (alvo.dataset.n !== n) return; // resposta antiga

  const mesmoPeriodo = opts.atual && opts.atual.data === st.data && opts.atual.turno === st.turno;
  if (mesmoPeriodo) {
    const sala = (await salas()).find((s) => s.id === opts.atual.salaId);
    if (sala && !livres.some((s) => s.id === sala.id)) livres = [sala, ...livres];
  }
  if (st.tipo) livres = livres.filter((s) => s.tipo === st.tipo);
  if (!livres.some((s) => s.id === st.salaId)) st.salaId = null;

  alvo.innerHTML = livres.length
    ? livres.map((s) => `
        <label class="sala-card"><input type="radio" name="sala" value="${s.id}" ${s.id === st.salaId ? "checked" : ""}>
          <span><strong>${esc(s.nome)}</strong><small>${esc(s.tipo)}${mesmoPeriodo && s.id === opts.atual.salaId ? " · reserva atual" : ""}</small></span></label>`).join("")
    : `<p class="muted">Nenhuma sala livre nesse período.</p>`;
  $$("input", alvo).forEach((i) => (i.onchange = () => { st.salaId = Number(i.value); opts.onChange?.(); }));
  opts.onChange?.();
}

function ligarCampos(st, opts) {
  const alvo = $("#salas");
  const recarregar = () => carregarSalas(alvo, st, opts);
  $("#data").onchange = (e) => { st.data = e.target.value; recarregar(); };
  $$("input[name=turno]").forEach((i) => (i.onchange = () => { st.turno = i.value; recarregar(); }));
  $("#tipo").onchange = (e) => { st.tipo = e.target.value; recarregar(); };
  $("#motivo").onchange = (e) => { st.motivo = e.target.value; opts.onChange?.(); };
  recarregar();
}

/* =========================================================
   Nova reserva (professor)
   ========================================================= */
let rascunho = null;

async function telaNova() {
  const p = params();
  rascunho = { data: p.data || hoje(), turno: p.turno || "", tipo: "", salaId: Number(p.sala) || null, motivo: "" };
  await formNova();
}

async function formNova() {
  const st = rascunho;
  montar("nova", `
    <h1>Nova reserva</h1>
    <form class="form" id="form">
      ${await camposReserva(st)}
      <button class="btn" id="seguir" disabled>Revisar reserva</button>
    </form>`);

  ligarCampos(st, { onChange: () => { $("#seguir").disabled = !(st.data && st.turno && st.salaId && st.motivo); } });
  $("#form").onsubmit = (e) => { e.preventDefault(); revisarNova(); };
}

async function revisarNova(erro = "") {
  const st = rascunho;
  const lista = await salas();
  montar("nova", `
    <h1>Confirmar reserva</h1>
    <p class="muted">Verifique os dados da sua reserva antes de confirmar.</p>
    <div class="card" style="max-width:620px">
      <dl class="resumo">
        <dt>Sala</dt><dd>${esc(nomeSala(lista, st.salaId))}</dd>
        <dt>Data</dt><dd>${fmtData(st.data)}</dd>
        <dt>Turno</dt><dd>${nomeTurno(st.turno)}</dd>
        <dt>Motivo</dt><dd>${esc(st.motivo)}</dd>
      </dl>
    </div>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}
    <div class="botoes">
      <button class="btn sec" id="voltar">Voltar</button>
      <button class="btn" id="confirmar">Confirmar reserva</button>
    </div>`);

  $("#voltar").onclick = () => formNova();
  $("#confirmar").onclick = async () => {
    $("#confirmar").disabled = true;
    try {
      await api("/reservas", { method: "POST", body: { salaId: st.salaId, data: st.data, turno: st.turno, motivo: st.motivo } });
      montar("nova", `
        <div class="centro">
          <div class="check">✓</div>
          <h1>Reserva realizada com sucesso!</h1>
          <p class="muted">Sua reserva já foi registrada e já aparece na sua lista de reservas.</p>
          <a class="btn" href="#/reservas">Ver minhas reservas</a>
          <a class="btn sec" href="#/nova">Nova reserva</a>
        </div>`);
    } catch (e) {
      revisarNova(e.message);
    }
  };
}

/* =========================================================
   Reservas: lista (professor) e tabela geral (coordenação)
   ========================================================= */
let aba = "ativas";

async function telaReservas() {
  return sessao.usuario.papel === "professor" ? reservasProfessor() : reservasCoordenacao();
}

async function reservasProfessor() {
  const [reservas, lista] = await Promise.all([api("/minhas-reservas"), salas()]);
  const ativa = (r) => r.status === "confirmada" && r.data >= hoje();
  const grupos = {
    ativas: reservas.filter(ativa).sort(porPeriodo),
    passadas: reservas.filter((r) => !ativa(r)).sort((a, b) => porPeriodo(b, a)),
  };

  const desenhar = () => {
    $("#lista").innerHTML = grupos[aba].length
      ? grupos[aba].map((r) => cartaoReserva(r, lista, aba === "ativas" && r.status === "confirmada" ? `
          <div class="acoes">
            <a class="btn pequeno claro" href="#/reservas/${r.id}/alterar">Alterar</a>
            <a class="btn pequeno claro" href="#/reservas/${r.id}/troca">Trocar sala</a>
            <a class="btn pequeno perigo" href="#/reservas/${r.id}/cancelar">Cancelar</a>
          </div>` : "")).join("")
      : `<p class="muted">Nenhuma reserva ${aba === "ativas" ? "ativa" : "passada"}.</p>`;
    $$(".abas button").forEach((b) => b.classList.toggle("ativo", b.dataset.aba === aba));
  };

  montar("reservas", `
    <h1>Minhas reservas</h1>
    <div class="abas">
      <button data-aba="ativas">Ativas (${grupos.ativas.length})</button>
      <button data-aba="passadas">Passadas e canceladas (${grupos.passadas.length})</button>
    </div>
    <div class="lista" id="lista"></div>`);
  $$(".abas button").forEach((b) => (b.onclick = () => { aba = b.dataset.aba; desenhar(); }));
  desenhar();
}

async function reservasCoordenacao() {
  const [reservas, lista, professores] = await Promise.all([api("/reservas"), salas(), api("/professores")]);
  const f = { data: "", professor: "", sala: "", turno: "" };

  montar("reservas", `
    <h1>Todas as reservas</h1>
    <div class="filtros">
      <label>Data<input type="date" id="f-data"></label>
      <label>Professor<select id="f-professor"><option value="">Todos</option>${professores.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join("")}</select></label>
      <label>Sala<select id="f-sala"><option value="">Todas</option>${lista.map((s) => `<option value="${s.id}">${esc(s.nome)}</option>`).join("")}</select></label>
      <label>Turno<select id="f-turno"><option value="">Todos</option>${Object.entries(TURNOS).map(([id, t]) => `<option value="${id}">${t.nome}</option>`).join("")}</select></label>
    </div>
    <div class="card tabela-wrap" id="tabela"></div>`);

  const desenhar = () => {
    const filtradas = reservas
      .filter((r) => (!f.data || r.data === f.data) && (!f.professor || r.professorId === Number(f.professor)) &&
        (!f.sala || r.salaId === Number(f.sala)) && (!f.turno || r.turno === f.turno))
      .sort(porPeriodo);
    $("#tabela").innerHTML = filtradas.length ? `
      <table>
        <thead><tr><th>Professor</th><th>Sala</th><th>Data</th><th>Turno</th><th>Motivo</th><th>Situação</th><th></th></tr></thead>
        <tbody>${filtradas.map((r) => `
          <tr>
            <td>${esc(professores.find((p) => p.id === r.professorId)?.nome ?? r.professorId)}</td>
            <td>${esc(nomeSala(lista, r.salaId))}</td>
            <td>${fmtData(r.data)}</td>
            <td>${TURNOS[r.turno]?.nome}</td>
            <td>${esc(r.motivo)}</td>
            <td>${pill(STATUS[r.status] ?? [r.status, ""])}</td>
            <td>${r.status === "confirmada" && r.data >= hoje() ? `
              <a class="btn pequeno claro" href="#/reservas/${r.id}/alterar">Alterar</a>
              <a class="btn pequeno perigo" href="#/reservas/${r.id}/cancelar">Cancelar</a>` : ""}</td>
          </tr>`).join("")}</tbody>
      </table>` : `<p class="muted">Nenhuma reserva encontrada.</p>`;
  };

  for (const k of Object.keys(f)) $(`#f-${k}`).onchange = (e) => { f[k] = e.target.value; desenhar(); };
  desenhar();
}

/* =========================================================
   Alterar / cancelar reserva
   ========================================================= */
async function telaAlterar(id) {
  const r = await buscarReserva(id);
  if (r.status !== "confirmada") throw new Error("Apenas reservas confirmadas podem ser alteradas.");
  const st = { data: r.data, turno: r.turno, tipo: "", salaId: r.salaId, motivo: r.motivo };

  montar("reservas", `
    <h1>Alterar reserva</h1>
    <p class="muted">Selecione a nova data, turno, sala e motivo.</p>
    <form class="form" id="form">
      ${await camposReserva(st)}
      <p class="erro" id="erro" hidden></p>
      <div class="botoes" style="margin-top:0">
        <button class="btn" id="salvar" disabled>Salvar alterações</button>
        <a class="btn sec" href="#/reservas">Voltar</a>
      </div>
    </form>`);

  ligarCampos(st, {
    atual: r,
    onChange: () => { $("#salvar").disabled = !(st.data && st.turno && st.salaId && st.motivo); },
  });

  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    $("#salvar").disabled = true;
    try {
      await api(`/reservas/${r.id}`, { method: "PATCH", body: { salaId: st.salaId, data: st.data, turno: st.turno, motivo: st.motivo } });
      flash("Reserva alterada com sucesso.");
      location.hash = "#/reservas";
    } catch (err) {
      $("#erro").textContent = err.message;
      $("#erro").hidden = false;
      $("#salvar").disabled = false;
    }
  };
}

async function telaCancelar(id) {
  const [r, lista] = await Promise.all([buscarReserva(id), salas()]);
  if (r.status === "cancelada") throw new Error("Esta reserva já foi cancelada.");

  montar("reservas", `
    <h1>Cancelar reserva</h1>
    <p>Tem certeza que deseja cancelar essa reserva?</p>
    <div class="card" style="max-width:520px">
      <dl class="resumo">
        <dt>Sala</dt><dd>${esc(nomeSala(lista, r.salaId))}</dd>
        <dt>Data</dt><dd>${fmtData(r.data)}</dd>
        <dt>Turno</dt><dd>${nomeTurno(r.turno)}</dd>
        <dt>Motivo</dt><dd>${esc(r.motivo)}</dd>
      </dl>
    </div>
    <p class="erro" id="erro" hidden></p>
    <div class="botoes">
      <button class="btn perigo" id="cancelar">Cancelar reserva</button>
      <a class="btn sec" href="#/reservas">Voltar</a>
    </div>`);

  $("#cancelar").onclick = async () => {
    $("#cancelar").disabled = true;
    try {
      await api(`/reservas/${r.id}/cancelar`, { method: "PATCH" });
      flash("Reserva cancelada com sucesso.");
      location.hash = "#/reservas";
    } catch (err) {
      $("#erro").textContent = err.message;
      $("#erro").hidden = false;
      $("#cancelar").disabled = false;
    }
  };
}

/* =========================================================
   Troca de sala
   ========================================================= */
const SEM_RESUMO = `<p class="erro">Esta tela precisa da rota <code>/reservas-resumo</code> no server.js.</p>`;

async function telaTroca(id) {
  const [minha, lista, todas] = await Promise.all([buscarReserva(id), salas(), resumo()]);
  if (!todas) { montar("reservas", `<h1>Troca de sala</h1>${SEM_RESUMO}`); return; }
  if (minha.status !== "confirmada") throw new Error("Apenas reservas confirmadas podem trocar de sala.");

  const candidatas = todas.filter((r) => r.status === "confirmada" && r.data === minha.data && r.turno === minha.turno && r.id !== minha.id);
  let escolhida = null;

  montar("reservas", `
    <h1>Solicitação de troca de sala</h1>
    <p><strong>Sua reserva:</strong> ${esc(nomeSala(lista, minha.salaId))} · ${fmtData(minha.data)} · ${nomeTurno(minha.turno)}</p>
    <p class="muted">Só é possível trocar com reservas do mesmo dia e turno. Selecione a sala desejada:</p>
    ${candidatas.length ? `
      <div class="grade-salas">
        ${candidatas.map((r) => `
          <label class="sala-card"><input type="radio" name="destino" value="${r.id}">
            <span><strong>${esc(r.salaNome)}</strong><small>Reservada por ${esc(r.professorNome)}</small></span></label>`).join("")}
      </div>` : `<p class="muted">Nenhuma outra sala reservada neste período.</p>`}
    <div class="form" style="margin-top:1.1rem">
      <label>Motivo da troca
        <textarea id="motivo" rows="4" maxlength="300" placeholder="Explique por que você precisa trocar de sala"></textarea>
      </label>
    </div>
    <p class="erro" id="erro" hidden></p>
    <div class="botoes">
      <button class="btn" id="enviar" disabled>Enviar solicitação</button>
      <a class="btn sec" href="#/reservas">Voltar</a>
    </div>`);

  const validar = () => { $("#enviar").disabled = !(escolhida && $("#motivo").value.trim()); };
  $$("input[name=destino]").forEach((i) => (i.onchange = () => { escolhida = Number(i.value); validar(); }));
  $("#motivo").oninput = validar;

  $("#enviar").onclick = async () => {
    $("#enviar").disabled = true;
    try {
      await api("/trocas", {
        method: "POST",
        body: { reservaSolicitanteId: minha.id, reservaDestinoId: escolhida, motivo: $("#motivo").value.trim() },
      });
      flash("Solicitação de troca enviada.");
      location.hash = "#/trocas";
    } catch (err) {
      $("#erro").textContent = err.message;
      $("#erro").hidden = false;
      validar();
    }
  };
}

async function telaTrocas() {
  const u = sessao.usuario;
  const prof = u.papel === "professor";
  const [trocas, todas, , minhas] = await Promise.all([
    api("/trocas"), resumo(), salas(), prof ? api("/minhas-reservas") : null,
  ]);
  const mapa = new Map((todas || []).map((r) => [r.id, r]));
  const meus = new Set((minhas || []).map((r) => r.id));

  const linha = (t) => {
    const a = mapa.get(t.reservaSolicitanteId);
    const b = mapa.get(t.reservaDestinoId);
    const recebida = prof && meus.has(t.reservaDestinoId);
    const quando = a ? `${fmtData(a.data)} · ${TURNOS[a.turno]?.nome}` : "";
    let texto;
    if (!a || !b) {
      texto = `<strong>Troca #${t.id}</strong><span class="muted">Reservas ${t.reservaSolicitanteId} e ${t.reservaDestinoId}</span>`;
    } else if (t.status === "pendente") {
      texto = recebida
        ? `<strong>${esc(a.professorNome)}</strong><span>${esc(a.salaNome)} → ${esc(b.salaNome)}</span><span class="muted">${quando}</span>`
        : `<strong>${esc(a.professorNome)} → ${esc(b.professorNome)}</strong><span>${esc(a.salaNome)} ⇄ ${esc(b.salaNome)}</span><span class="muted">${quando}</span>`;
    } else {
      texto = `<strong>${esc(a.professorNome)} e ${esc(b.professorNome)}</strong><span class="muted">${quando}</span>`;
    }
    const acoes = (recebida || !prof) && t.status === "pendente"
      ? `<div class="acoes">
           <button class="btn pequeno verde" data-troca="${t.id}" data-aceitar="true">Aceitar</button>
           <button class="btn pequeno perigo" data-troca="${t.id}" data-aceitar="false">Recusar</button>
         </div>`
      : pill(STATUS_TROCA[t.status] ?? [t.status, ""]);
    const msg = t.motivo ? `<span>Motivo: ${esc(t.motivo)}</span>` : "";
    return `<div class="card item"><div class="info">${texto}${msg}</div>${acoes}</div>`;
  };

  montar("trocas", `
    <h1>Trocas de sala</h1>
    ${!todas ? SEM_RESUMO : ""}
    <div class="lista">${trocas.length ? trocas.map(linha).join("") : `<p class="muted">Nenhuma solicitação de troca.</p>`}</div>`);

  $$("[data-troca]").forEach((b) => (b.onclick = async () => {
    $$("[data-troca]").forEach((x) => (x.disabled = true));
    try {
      const r = await api(`/trocas/${b.dataset.troca}/responder`, { method: "PATCH", body: { aceitar: b.dataset.aceitar === "true" } });
      flash(r.mensagem);
    } catch (err) {
      flash(err.message, "bad");
    }
    telaTrocas();
  }));
}

/* =========================================================
   Gerar grade (coordenação) — o backtracking do servidor distribui as salas
   ========================================================= */
const grade = {
  data: "", turno: "manha", motivo: "", selecionados: [], priorizarMenosOpcoes: false,
  resultado: null, estatisticas: null, erro: "", dados: null,
};

const reservasDoPeriodo = () =>
  grade.dados.reservas.filter((r) => r.status === "confirmada" && r.data === grade.data && r.turno === grade.turno);

async function telaGrade() {
  const [lista, professores, reservas] = await Promise.all([salas(), api("/professores"), api("/reservas")]);
  Object.assign(grade, {
    data: hoje(), turno: "manha", motivo: "", selecionados: [], priorizarMenosOpcoes: false,
    resultado: null, estatisticas: null, erro: "", dados: { lista, professores, reservas },
  });
  const ocupados = new Set(reservasDoPeriodo().map((r) => r.professorId));
  grade.selecionados = professores.filter((p) => !ocupados.has(p.id)).map((p) => p.id);
  desenharGrade();
}

const corpoDaGrade = () => ({
  data: grade.data, turno: grade.turno, motivo: grade.motivo,
  professores: grade.selecionados, priorizarMenosOpcoes: grade.priorizarMenosOpcoes,
});

function desenharGrade() {
  const { lista, professores } = grade.dados;
  const doPeriodo = reservasDoPeriodo();
  const professoresOcupados = new Set(doPeriodo.map((r) => r.professorId));
  const salasLivres = lista.length - new Set(doPeriodo.map((r) => r.salaId)).size;
  const disponiveis = professores.filter((p) => !professoresOcupados.has(p.id));
  grade.selecionados = grade.selecionados.filter((id) => !professoresOcupados.has(id));
  const nomeProf = (id) => professores.find((p) => p.id === id)?.nome ?? "";
  const est = grade.estatisticas;

  montar("grade", `
    <h1>Gerar grade</h1>
    <p class="muted">Escolha o período e os professores. O algoritmo de backtracking distribui as salas livres automaticamente, sem conflitos, usando as salas de cada curso.</p>

    <div class="linha" style="max-width:720px">
      <label>Data<input type="date" id="g-data" min="${hoje()}" value="${esc(grade.data)}"></label>
      <fieldset><legend>Turno</legend><div class="turnos">
        ${Object.entries(TURNOS).map(([id, t]) => `
          <label class="opcao"><input type="radio" name="g-turno" value="${id}" ${grade.turno === id ? "checked" : ""}>
            <span>${t.nome}<small>${t.horas}</small></span></label>`).join("")}
      </div></fieldset>
    </div>

    <div class="form" style="margin-top:1.1rem">
      <label>Motivo
        <select id="g-motivo"><option value="">Selecione o motivo</option>${MOTIVOS.map((m) => `<option ${grade.motivo === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>
      </label>
    </div>

    <h2>Professores (<span id="g-contagem">${grade.selecionados.length}</span> de ${disponiveis.length} disponíveis · ${salasLivres} salas livres)</h2>
    <div class="botoes" style="margin:0 0 .75rem">
      <button class="btn pequeno claro" id="g-todos">Marcar todos</button>
      <button class="btn pequeno claro" id="g-nenhum">Limpar</button>
    </div>
    <div class="grade-salas" id="g-profs">
      ${professores.map((p) => {
        const ocupado = professoresOcupados.has(p.id);
        return `<label class="opcao"><input type="checkbox" value="${p.id}" ${grade.selecionados.includes(p.id) ? "checked" : ""} ${ocupado ? "disabled" : ""}>
          <span style="${ocupado ? "opacity:.5" : ""}"><strong>${esc(p.nome)}</strong><small>${ocupado ? "já tem reserva nesse período" : esc(p.curso)}</small></span></label>`;
      }).join("")}
    </div>

    <label style="display:flex;gap:.5rem;align-items:center;margin-top:1rem">
      <input type="checkbox" id="g-prioridade" ${grade.priorizarMenosOpcoes ? "checked" : ""}>
      Priorizar quem tem menos opções de sala (atendê-los primeiro)
    </label>

    <div class="botoes"><button class="btn" id="g-gerar" disabled>Gerar grade</button></div>
    ${grade.erro ? `<p class="erro" id="g-erro">${esc(grade.erro)}</p>` : ""}
    ${grade.resultado ? `
      <div id="g-resultado">
      <h2>Grade gerada</h2>
      <p class="muted">O algoritmo testou ${est.tentativas} escolhas de sala e voltou atrás ${est.retrocessos} ${est.retrocessos === 1 ? "vez" : "vezes"} (retrocesso).</p>
      <div class="card tabela-wrap"><table>
        <thead><tr><th>Professor</th><th>Sala</th><th>Data</th><th>Turno</th><th>Motivo</th></tr></thead>
        <tbody>${[...grade.resultado].sort((a, b) => nomeProf(a.professorId).localeCompare(nomeProf(b.professorId))).map((p) => `<tr>
          <td>${esc(nomeProf(p.professorId))}</td><td>${esc(nomeSala(lista, p.salaId))}</td>
          <td>${fmtData(p.data)}</td><td>${TURNOS[p.turno]?.nome}</td><td>${esc(p.motivo)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="muted">Esta é apenas uma sugestão: nenhuma reserva foi criada ainda.</p>
      <div class="botoes"><button class="btn verde" id="g-confirmar">Confirmar grade</button></div>
      </div>` : ""}`);

  const validar = () => { $("#g-gerar").disabled = !(grade.data && grade.motivo && grade.selecionados.length); };
  const limparResultado = () => {
    grade.resultado = null; grade.estatisticas = null; grade.erro = "";
    $("#g-resultado")?.remove(); $("#g-erro")?.remove();
  };

  $("#g-data").onchange = (e) => { grade.data = e.target.value; limparResultado(); desenharGrade(); };
  $$("input[name=g-turno]").forEach((i) => (i.onchange = () => { grade.turno = i.value; limparResultado(); desenharGrade(); }));
  $("#g-motivo").onchange = (e) => { grade.motivo = e.target.value; limparResultado(); validar(); };
  $("#g-prioridade").onchange = (e) => { grade.priorizarMenosOpcoes = e.target.checked; limparResultado(); };
  $("#g-todos").onclick = () => { grade.selecionados = disponiveis.map((p) => p.id); limparResultado(); desenharGrade(); };
  $("#g-nenhum").onclick = () => { grade.selecionados = []; limparResultado(); desenharGrade(); };
  $$("#g-profs input").forEach((i) => (i.onchange = () => {
    const id = Number(i.value);
    grade.selecionados = i.checked ? [...grade.selecionados, id] : grade.selecionados.filter((x) => x !== id);
    limparResultado();
    $("#g-contagem").textContent = grade.selecionados.length;
    validar();
  }));
  validar();

  $("#g-gerar").onclick = async () => {
    limparResultado();
    $("#g-gerar").disabled = true;
    $("#g-gerar").textContent = "Gerando…";
    try {
      const r = await api("/sugestoes-grade", { method: "POST", body: corpoDaGrade() });
      grade.resultado = r.plano;
      grade.estatisticas = r.estatisticas;
    } catch (e) { grade.erro = e.message; }
    desenharGrade();
  };

  const confirmar = $("#g-confirmar");
  if (confirmar) {
    confirmar.onclick = async () => {
      if (!window.confirm(`Criar ${grade.resultado.length} reservas com esta grade?`)) return;
      confirmar.disabled = true;
      try {
        const r = await api("/sugestoes-grade/confirmar", { method: "POST", body: corpoDaGrade() });
        flash(r.mensagem);
        location.hash = "#/reservas";
      } catch (e) {
        grade.resultado = null; grade.estatisticas = null;
        grade.erro = e.message;
        desenharGrade();
      }
    };
  }
}

/* =========================================================
   Histórico
   ========================================================= */
async function telaHistorico() {
  const [historico, lista, todas] = await Promise.all([api("/historico"), salas(), resumo()]);
  const mapa = new Map((todas || []).map((r) => [r.id, r]));
  const f = { de: "", ate: "" };

  const detalhes = (h) => {
    let d = null;
    try { d = h.detalhes ? JSON.parse(h.detalhes) : null; } catch { /* ignora */ }
    const desc = (x) => `${nomeSala(lista, x.salaId)} · ${fmtData(x.data)} · ${TURNOS[x.turno]?.nome ?? x.turno}`;
    if (h.acao === "reserva_alterada" && d?.antes && d?.depois) return `${esc(desc(d.antes))}<br>→ ${esc(desc(d.depois))}`;
    const r = mapa.get(h.reservaId);
    if (r) return esc(`${r.salaNome} · ${fmtData(r.data)} · ${TURNOS[r.turno]?.nome ?? r.turno}`);
    return `Reserva #${h.reservaId}`;
  };

  montar("historico", `
    <h1>Histórico de alocações</h1>
    <div class="filtros" style="max-width:520px">
      <label>De<input type="date" id="h-de"></label>
      <label>Até<input type="date" id="h-ate"></label>
    </div>
    <div class="card tabela-wrap" id="tabela"></div>`);

  const desenhar = () => {
    const itens = historico.filter((h) => {
      const dia = dataLocalDe(h.dataHora);
      return (!f.de || dia >= f.de) && (!f.ate || dia <= f.ate);
    });
    $("#tabela").innerHTML = itens.length ? `
      <table>
        <thead><tr><th>Data e hora</th><th>Usuário</th><th>Ação</th><th>Detalhes</th></tr></thead>
        <tbody>${itens.map((h) => `
          <tr><td>${fmtDataHora(h.dataHora)}</td><td>${esc(h.autorNome)}</td>
          <td>${ACOES[h.acao] ?? esc(h.acao)}</td><td>${detalhes(h)}</td></tr>`).join("")}</tbody>
      </table>` : `<p class="muted">Nenhum registro no período.</p>`;
  };
  $("#h-de").onchange = (e) => { f.de = e.target.value; desenhar(); };
  $("#h-ate").onchange = (e) => { f.ate = e.target.value; desenhar(); };
  desenhar();
}

/* =========================================================
   Perfil
   ========================================================= */
async function telaPerfil() {
  const u = sessao.usuario;
  const iniciais = u.nome.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();

  montar("", `
    <h1>Meu perfil</h1>
    <div class="card" style="max-width:620px">
      <div class="item" style="justify-content:flex-start">
        <span class="avatar grande">${esc(iniciais)}</span>
        <div class="info"><strong style="font-size:1.3rem">${esc(u.nome)}</strong>
          <span>${PAPEIS[u.papel] ?? esc(u.papel)}</span>
          ${u.curso ? `<span class="muted">${esc(u.curso)}</span>` : ""}</div>
      </div>
    </div>

    <h2>Alterar senha</h2>
    <form class="form estreito" id="senha-form">
      <label>Senha atual<input type="password" id="atual" autocomplete="current-password" required></label>
      <label>Nova senha (mínimo 8 caracteres)<input type="password" id="nova" autocomplete="new-password" minlength="8" required></label>
      <label>Repita a nova senha<input type="password" id="repete" autocomplete="new-password" required></label>
      <p class="erro" id="erro" hidden></p>
      <p id="ok" class="aviso" hidden></p>
      <button class="btn">Salvar nova senha</button>
    </form>`);

  $("#senha-form").onsubmit = async (e) => {
    e.preventDefault();
    const erro = $("#erro"), ok = $("#ok");
    erro.hidden = ok.hidden = true;
    if ($("#nova").value !== $("#repete").value) { erro.textContent = "As senhas novas não são iguais."; erro.hidden = false; return; }
    try {
      const r = await api("/minha-senha", { method: "PATCH", body: { senhaAtual: $("#atual").value, novaSenha: $("#nova").value } });
      ok.textContent = r.mensagem; ok.hidden = false;
      e.target.reset();
    } catch (err) { erro.textContent = err.message; erro.hidden = false; }
  };
}

/* =========================================================
   Roteador
   ========================================================= */
const ROTAS = [
  [/^#\/inicio$/, telaInicio],
  [/^#\/salas$/, telaSalas],
  [/^#\/nova$/, telaNova, "professor"],
  [/^#\/reservas$/, telaReservas],
  [/^#\/reservas\/(\d+)\/alterar$/, telaAlterar],
  [/^#\/reservas\/(\d+)\/cancelar$/, telaCancelar],
  [/^#\/reservas\/(\d+)\/troca$/, telaTroca, "professor"],
  [/^#\/trocas$/, telaTrocas],
  [/^#\/grade$/, telaGrade, "coordenadora"],
  [/^#\/historico$/, telaHistorico],
  [/^#\/perfil$/, telaPerfil],
];

async function rotear() {
  const hash = (location.hash || "#/inicio").split("?")[0];

  if (!sessao.token || !sessao.usuario) {
    if (hash !== "#/login") { location.hash = "#/login"; return; }
    telaLogin();
    return;
  }
  if (hash === "#/login") { location.hash = "#/inicio"; return; }

  for (const [regex, tela, papel] of ROTAS) {
    const m = hash.match(regex);
    if (!m) continue;
    if (papel && sessao.usuario.papel !== papel) { location.hash = "#/inicio"; return; }
    carregando();
    try {
      await tela(m[1]);
    } catch (e) {
      if (sessao.token) montar("", `<h1>Ops</h1><p class="erro">${esc(e.message)}</p><a class="btn" href="#/inicio">Voltar ao início</a>`);
    }
    return;
  }
  location.hash = "#/inicio";
}

window.addEventListener("hashchange", rotear);
rotear();
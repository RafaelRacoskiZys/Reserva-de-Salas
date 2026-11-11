require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./database");

const app = express();


app.use(
  helmet({
    hsts: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { "upgrade-insecure-requests": null }
    }
  })
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

const PORT = 6767;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não foi encontrada no arquivo .env");
}


const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_LIMITE) || 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    erro: "Muitas tentativas de login. Tente novamente em 15 minutos."
  }
});

const turnosValidos = ["manha", "tarde", "noite"];

function dataEhValida(data) {
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return false;
  }

  const [ano, mes, dia] = data.split("-").map(Number);
  const dataTeste = new Date(Date.UTC(ano, mes - 1, dia));

  return (
    dataTeste.getUTCFullYear() === ano &&
    dataTeste.getUTCMonth() === mes - 1 &&
    dataTeste.getUTCDate() === dia
  );
}

function dataDeHoje() {
  const agora = new Date();
  const dois = (n) => String(n).padStart(2, "0");

  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}


function dataEhPassada(data) {
  return data < dataDeHoje();
}

function buscarSala(salaId) {
  return db
    .prepare("SELECT id, nome, tipo FROM salas WHERE id = ?")
    .get(salaId);
}

function buscarProfessor(professorId) {
  return db
    .prepare(`
      SELECT id, nome, curso, papel
      FROM usuarios
      WHERE id = ? AND papel = 'professor'
    `)
    .get(professorId);
}

function buscarUsuario(usuarioId) {
  return db
    .prepare(`
      SELECT id, nome, papel
      FROM usuarios
      WHERE id = ?
    `)
    .get(usuarioId);
}

function normalizarCpf(cpf) {
  return String(cpf).replace(/\D/g, "");
}

function exigirCoordenadora(req, res, next) {
  if (req.usuario.papel !== "coordenadora") {
    return res.status(403).json({
      erro: "Apenas coordenadoras possuem esta permissão."
    });
  }

  next();
}

function autenticarToken(req, res, next) {
  const cabecalho = req.headers.authorization;

  if (!cabecalho || !cabecalho.startsWith("Bearer ")) {
    return res.status(401).json({
      erro: "Token de acesso não informado."
    });
  }

  const token = cabecalho.split(" ")[1];

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      erro: "Token inválido ou expirado."
    });
  }
}

function registrarHistorico(acao, reservaId, autorId, detalhes = null) {
  db.prepare(`
    INSERT INTO historico (acao, reserva_id, autor_id, detalhes)
    VALUES (?, ?, ?, ?)
  `).run(acao, reservaId, autorId, detalhes);
}

function buscarReserva(reservaId) {
  return db
    .prepare(`
      SELECT
        id,
        sala_id AS salaId,
        professor_id AS professorId,
        data,
        turno,
        motivo,
        status,
        criada_em AS criadaEm
      FROM reservas
      WHERE id = ?
    `)
    .get(reservaId);
}

function buscarTroca(trocaId) {
  return db.prepare(`
    SELECT
      id,
      reserva_solicitante_id AS reservaSolicitanteId,
      reserva_destino_id AS reservaDestinoId,
      solicitante_id AS solicitanteId,
      motivo,
      status,
      criada_em AS criadaEm,
      respondida_em AS respondidaEm
    FROM solicitacoes_troca
    WHERE id = ?
  `).get(trocaId);
}


function encerrarTrocasPendentes(reservaId) {
  db.prepare(`
    UPDATE solicitacoes_troca
    SET status = 'recusada',
        respondida_em = CURRENT_TIMESTAMP
    WHERE status = 'pendente'
      AND (reserva_solicitante_id = ? OR reserva_destino_id = ?)
  `).run(reservaId, reservaId);
}

function existeConflito(salaId, professorId, data, turno, plano) {
  const conflitoNoBanco = db.prepare(`
    SELECT id
    FROM reservas
    WHERE data = ?
      AND turno = ?
      AND status = 'confirmada'
      AND (sala_id = ? OR professor_id = ?)
    LIMIT 1
  `).get(data, turno, salaId, professorId);

  const conflitoNoPlano = plano.some((item) => {
    return (
      item.data === data &&
      item.turno === turno &&
      (item.salaId === salaId || item.professorId === professorId)
    );
  });

  return Boolean(conflitoNoBanco) || conflitoNoPlano;
}


const LIMITE_DE_VERIFICACOES = 20000;


function montarPlanoComBacktracking(
  pedidos,
  data,
  turno,
  indice,
  plano,
  estatisticas = { tentativas: 0, retrocessos: 0, verificacoes: 0 }
) {
  if (indice === pedidos.length) {
    return true;
  }

  const pedidoAtual = pedidos[indice];

  for (const salaId of pedidoAtual.salasPermitidas) {
    if (estatisticas.verificacoes >= LIMITE_DE_VERIFICACOES) {
      estatisticas.interrompida = true;
      return false;
    }

    estatisticas.verificacoes++;

    const salaExiste = buscarSala(salaId);

    if (!salaExiste) {
      continue;
    }

    if (
      existeConflito(
        salaId,
        pedidoAtual.professorId,
        data,
        turno,
        plano
      )
    ) {
      continue;
    }

    plano.push({
      professorId: pedidoAtual.professorId,
      salaId,
      data,
      turno,
      motivo: pedidoAtual.motivo,
      status: "sugestao"
    });

    estatisticas.tentativas++;

    const encontrouSolucao = montarPlanoComBacktracking(
      pedidos,
      data,
      turno,
      indice + 1,
      plano,
      estatisticas
    );

    if (encontrouSolucao) {
      return true;
    }

    plano.pop();
    estatisticas.retrocessos++;
  }

  return false;
}


function ordenarPedidos(pedidos, usarHeuristica) {
  if (!usarHeuristica) {
    return pedidos;
  }

  return [...pedidos].sort(
    (a, b) => a.salasPermitidas.length - b.salasPermitidas.length
  );
}

function gerarGrade({ data, turno, pedidos, usarHeuristica }) {
  const plano = [];
  const estatisticas = { tentativas: 0, retrocessos: 0, verificacoes: 0 };

  const encontrouSolucao = montarPlanoComBacktracking(
    ordenarPedidos(pedidos, usarHeuristica),
    data,
    turno,
    0,
    plano,
    estatisticas
  );

  if (estatisticas.interrompida) {
    return { interrompida: true, estatisticas };
  }

  return encontrouSolucao ? { plano, estatisticas } : null;
}


function salasDoProfessor(professorId, motivo) {
  const salas = db.prepare(`
    SELECT s.id, s.tipo
    FROM professor_salas ps
    JOIN salas s ON s.id = ps.sala_id
    WHERE ps.professor_id = ?
    ORDER BY ps.ordem
  `).all(professorId);

  if (motivo === "Aula teórica") {
    const comuns = salas.filter((sala) => sala.tipo === "sala comum");
    const outras = salas.filter((sala) => sala.tipo !== "sala comum");

    return [...comuns, ...outras].map((sala) => sala.id);
  }

  return salas.map((sala) => sala.id);
}

function lerPedidosDaGrade(corpo) {
  const { data, turno } = corpo;

  if (!dataEhValida(data) || !turnosValidos.includes(turno)) {
    return { erro: "Informe uma data válida e um turno." };
  }

  if (dataEhPassada(data)) {
    return { erro: "Não é possível montar uma grade para uma data que já passou." };
  }

  let pedidos;

  if (Array.isArray(corpo.pedidos) && corpo.pedidos.length > 0) {
    pedidos = corpo.pedidos.map((pedido) => ({
      professorId: Number(pedido.professorId),
      salasPermitidas: Array.isArray(pedido.salasPermitidas)
        ? [...new Set(pedido.salasPermitidas.map(Number))]
        : [],
      motivo: typeof pedido.motivo === "string" ? pedido.motivo.trim() : ""
    }));
  } else if (Array.isArray(corpo.professores) && corpo.professores.length > 0) {
    const motivo =
      typeof corpo.motivo === "string" ? corpo.motivo.trim() : "";

    pedidos = [...new Set(corpo.professores.map(Number))].map((professorId) => ({
      professorId,
      salasPermitidas: salasDoProfessor(professorId, motivo),
      motivo
    }));
  } else {
    return { erro: "Escolha pelo menos um professor." };
  }

  for (const pedido of pedidos) {
    if (!buscarProfessor(pedido.professorId)) {
      return { erro: "Há pedidos com professor inválido." };
    }

    if (!pedido.motivo) {
      return { erro: "Informe o motivo da grade." };
    }

    if (pedido.salasPermitidas.length === 0) {
      return { erro: "Há professores sem salas cadastradas." };
    }
  }

  const ids = pedidos.map((pedido) => pedido.professorId);

  if (new Set(ids).size !== ids.length) {
    return { erro: "Há mais de um pedido para o mesmo professor." };
  }

  return {
    data,
    turno,
    pedidos,
    usarHeuristica: corpo.heuristica === true
  };
}

function encontrarBloqueioDaGrade({ data, turno, pedidos }) {
  const nomeDoProfessor = (id) => buscarProfessor(id)?.nome ?? `Professor ${id}`;

  const professorTemReserva = db.prepare(`
    SELECT 1 FROM reservas
    WHERE professor_id = ? AND data = ? AND turno = ? AND status = 'confirmada'
  `);

  const salaTemReserva = db.prepare(`
    SELECT 1 FROM reservas
    WHERE sala_id = ? AND data = ? AND turno = ? AND status = 'confirmada'
  `);

  const comReserva = pedidos.filter((pedido) =>
    professorTemReserva.get(pedido.professorId, data, turno)
  );

  if (comReserva.length > 0) {
    return `Estes professores já têm reserva nesse período: ${comReserva
      .map((pedido) => nomeDoProfessor(pedido.professorId))
      .join(", ")}. Desmarque-os e tente de novo.`;
  }

  const semSala = pedidos.filter((pedido) =>
    pedido.salasPermitidas.every((salaId) => salaTemReserva.get(salaId, data, turno))
  );

  if (semSala.length > 0) {
    return `Não há sala livre para: ${semSala
      .map((pedido) => nomeDoProfessor(pedido.professorId))
      .join(", ")}.`;
  }

  return null;
}


function montarGradeCompleta(dados) {
  const bloqueio = encontrarBloqueioDaGrade(dados);

  if (bloqueio) {
    return { erro: bloqueio };
  }

  const resultado = gerarGrade(dados);

  if (resultado && resultado.interrompida) {
    return {
      erro: "A busca ficou grande demais e foi interrompida. Escolha menos professores de cada vez."
    };
  }

  if (!resultado) {
    return {
      erro: "Não há salas livres suficientes para atender todos os professores escolhidos ao mesmo tempo. Tente desmarcar alguns."
    };
  }

  return resultado;
}

app.post("/login", limitarLogin, async (req, res) => {
  const cpf = normalizarCpf(req.body.cpf);
  const senha = req.body.senha;

  if (!cpf || !senha) {
    return res.status(400).json({
      erro: "CPF e senha são obrigatórios."
    });
  }

  const usuario = db.prepare(`
    SELECT id, nome, cpf, senha_hash AS senhaHash, curso, papel
    FROM usuarios
    WHERE cpf = ?
  `).get(cpf);

  if (!usuario || !usuario.senhaHash) {
    return res.status(401).json({
      erro: "CPF ou senha inválidos."
    });
  }

  const senhaCorreta = await bcrypt.compare(String(senha), usuario.senhaHash);

  if (!senhaCorreta) {
    return res.status(401).json({
      erro: "CPF ou senha inválidos."
    });
  }

  const token = jwt.sign(
    {
      id: usuario.id,
      nome: usuario.nome,
      papel: usuario.papel
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  return res.json({
    mensagem: "Login realizado com sucesso.",
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      curso: usuario.curso,
      papel: usuario.papel
    }
  });
});

app.get("/me", autenticarToken, (req, res) => {
  const usuario = buscarUsuario(req.usuario.id);

  if (!usuario) {
    return res.status(404).json({
      erro: "Usuário não encontrado."
    });
  }

  res.json(usuario);
});

app.patch("/minha-senha", autenticarToken, async (req, res) => {
  const senhaAtual = req.body.senhaAtual;
  const novaSenha = req.body.novaSenha;

  if (typeof senhaAtual !== "string" || typeof novaSenha !== "string") {
    return res.status(400).json({
      erro: "Informe a senha atual e a nova senha."
    });
  }

  if (novaSenha.length < 8) {
    return res.status(400).json({
      erro: "A nova senha deve ter pelo menos 8 caracteres."
    });
  }

  const usuario = db.prepare(`
    SELECT id, senha_hash AS senhaHash
    FROM usuarios
    WHERE id = ?
  `).get(req.usuario.id);

  if (!usuario || !usuario.senhaHash) {
    return res.status(404).json({
      erro: "Usuário não encontrado."
    });
  }

  const senhaAtualCorreta = await bcrypt.compare(
    senhaAtual,
    usuario.senhaHash
  );

  if (!senhaAtualCorreta) {
    return res.status(401).json({
      erro: "Senha atual incorreta."
    });
  }

  const novoHash = await bcrypt.hash(novaSenha, 10);

  db.prepare(`
    UPDATE usuarios
    SET senha_hash = ?
    WHERE id = ?
  `).run(novoHash, req.usuario.id);

  return res.json({
    mensagem: "Senha alterada com sucesso."
  });
});

app.get("/salas", autenticarToken, (req, res) => {
  const salas = db
    .prepare("SELECT id, nome, tipo FROM salas ORDER BY id")
    .all();

  res.json(salas);
});

app.get("/professores", autenticarToken, exigirCoordenadora, (req, res) => {
  const professores = db
    .prepare(`
      SELECT id, nome, curso, papel
      FROM usuarios
      WHERE papel = 'professor'
      ORDER BY id
    `)
    .all();

  res.json(professores);
});

app.get("/reservas", autenticarToken, exigirCoordenadora, (req, res) => {
  const reservas = db
    .prepare(`
      SELECT
        id,
        sala_id AS salaId,
        professor_id AS professorId,
        data,
        turno,
        motivo,
        status,
        criada_em AS criadaEm
      FROM reservas
      ORDER BY data, turno, sala_id
    `)
    .all();

  res.json(reservas);
});

app.get("/minhas-reservas", autenticarToken, (req, res) => {
  const reservas = db.prepare(`
    SELECT
      id,
      sala_id AS salaId,
      professor_id AS professorId,
      data,
      turno,
      motivo,
      status,
      criada_em AS criadaEm
    FROM reservas
    WHERE professor_id = ?
    ORDER BY data, turno
  `).all(req.usuario.id);

  res.json(reservas);
});

app.post("/reservas", autenticarToken, (req, res) => {
  const salaId = Number(req.body.salaId);
  const professorId = req.usuario.id;

  if (req.usuario.papel !== "professor") {
    return res.status(403).json({
      erro: "Somente professores podem criar reservas."
    });
  }

  const { data, turno } = req.body;
  const motivo =
    typeof req.body.motivo === "string" ? req.body.motivo.trim() : "";

  if (!salaId || !professorId || !data || !turno || !motivo) {
    return res.status(400).json({
      erro: "Sala, professor, data, turno e motivo são obrigatórios."
    });
  }

  if (!dataEhValida(data)) {
    return res.status(400).json({
      erro: "A data deve estar no formato AAAA-MM-DD e ser válida."
    });
  }

  if (dataEhPassada(data)) {
    return res.status(400).json({
      erro: "Não é possível reservar uma data que já passou."
    });
  }

  if (!turnosValidos.includes(turno)) {
    return res.status(400).json({
      erro: "O turno deve ser manha, tarde ou noite."
    });
  }

  if (!buscarSala(salaId)) {
    return res.status(404).json({
      erro: "Sala não encontrada."
    });
  }

  if (!buscarProfessor(professorId)) {
    return res.status(404).json({
      erro: "Professor não encontrado."
    });
  }

  const salaOcupada = db.prepare(`
    SELECT id
    FROM reservas
    WHERE sala_id = ?
      AND data = ?
      AND turno = ?
      AND status = 'confirmada'
  `).get(salaId, data, turno);

  if (salaOcupada) {
    return res.status(409).json({
      erro: "Esta sala já está reservada nesta data e turno."
    });
  }

  const professorOcupado = db.prepare(`
    SELECT id
    FROM reservas
    WHERE professor_id = ?
      AND data = ?
      AND turno = ?
      AND status = 'confirmada'
  `).get(professorId, data, turno);

  if (professorOcupado) {
    return res.status(409).json({
      erro: "Este professor já possui uma reserva nesta data e turno."
    });
  }

  try {
    const resultado = db.prepare(`
      INSERT INTO reservas (
        sala_id,
        professor_id,
        data,
        turno,
        motivo,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'confirmada')
    `).run(salaId, professorId, data, turno, motivo);

    const reservaId = Number(resultado.lastInsertRowid);

    registrarHistorico("reserva_criada", reservaId, professorId);

    return res.status(201).json(buscarReserva(reservaId));
  } catch (erro) {
    console.error(erro);

    return res.status(500).json({
      erro: "Não foi possível criar a reserva."
    });
  }
});

app.get("/salas-disponiveis", autenticarToken, (req, res) => {
  const { data, turno } = req.query;

  if (!data || !turno || !dataEhValida(data)) {
    return res.status(400).json({
      erro: "Informe uma data válida e um turno."
    });
  }

  if (!turnosValidos.includes(turno)) {
    return res.status(400).json({
      erro: "O turno deve ser manha, tarde ou noite."
    });
  }

  const salas = db.prepare(`
    SELECT s.id, s.nome, s.tipo
    FROM salas s
    WHERE NOT EXISTS (
      SELECT 1
      FROM reservas r
      WHERE r.sala_id = s.id
        AND r.data = ?
        AND r.turno = ?
        AND r.status = 'confirmada'
    )
    ORDER BY s.id
  `).all(data, turno);

  return res.json({
    data,
    turno,
    total: salas.length,
    salas
  });
});

app.get("/professores/:professorId/reservas", autenticarToken, (req, res) => {
  const professorId = Number(req.params.professorId);

  if (!buscarProfessor(professorId)) {
    return res.status(404).json({
      erro: "Professor não encontrado."
    });
  }

  if (
    req.usuario.papel !== "coordenadora" &&
    req.usuario.id !== professorId
  ) {
    return res.status(403).json({
      erro: "Você só pode consultar as próprias reservas."
    });
  }

  const reservas = db.prepare(`
    SELECT
      id,
      sala_id AS salaId,
      professor_id AS professorId,
      data,
      turno,
      motivo,
      status,
      criada_em AS criadaEm
    FROM reservas
    WHERE professor_id = ?
    ORDER BY data, turno
  `).all(professorId);

  res.json(reservas);
});

app.patch("/reservas/:id", autenticarToken, (req, res) => {
  const reservaId = Number(req.params.id);
  const usuarioId = req.usuario.id;
  const salaId = Number(req.body.salaId);
  const { data, turno } = req.body;
  const motivo =
    typeof req.body.motivo === "string" ? req.body.motivo.trim() : "";

  const reservaAtual = buscarReserva(reservaId);
  const usuario = buscarUsuario(usuarioId);

  if (!reservaAtual) {
    return res.status(404).json({
      erro: "Reserva não encontrada."
    });
  }

  if (!usuario) {
    return res.status(404).json({
      erro: "Usuário não encontrado."
    });
  }

  if (reservaAtual.status !== "confirmada") {
    return res.status(409).json({
      erro: "Apenas reservas confirmadas podem ser alteradas."
    });
  }

  const ehDonoDaReserva = reservaAtual.professorId === usuarioId;
  const ehCoordenadora = usuario.papel === "coordenadora";

  if (!ehDonoDaReserva && !ehCoordenadora) {
    return res.status(403).json({
      erro: "Você não possui permissão para alterar esta reserva."
    });
  }

  if (!buscarSala(salaId) || !dataEhValida(data) || !turnosValidos.includes(turno) || !motivo) {
    return res.status(400).json({
      erro: "Sala, data, turno ou motivo inválido."
    });
  }

  if (dataEhPassada(data)) {
    return res.status(400).json({
      erro: "Não é possível usar uma data que já passou."
    });
  }

  const salaOcupada = db.prepare(`
    SELECT id
    FROM reservas
    WHERE sala_id = ?
      AND data = ?
      AND turno = ?
      AND status = 'confirmada'
      AND id != ?
  `).get(salaId, data, turno, reservaId);

  if (salaOcupada) {
    return res.status(409).json({
      erro: "A sala escolhida já está reservada nesse período."
    });
  }

  const professorOcupado = db.prepare(`
    SELECT id
    FROM reservas
    WHERE professor_id = ?
      AND data = ?
      AND turno = ?
      AND status = 'confirmada'
      AND id != ?
  `).get(reservaAtual.professorId, data, turno, reservaId);

  if (professorOcupado) {
    return res.status(409).json({
      erro: "O professor já possui outra reserva nesse período."
    });
  }

  const alterar = db.transaction(() => {
    db.prepare(`
      UPDATE reservas
      SET sala_id = ?, data = ?, turno = ?, motivo = ?
      WHERE id = ?
    `).run(salaId, data, turno, motivo, reservaId);

    const mudouLugarOuHorario =
      salaId !== reservaAtual.salaId ||
      data !== reservaAtual.data ||
      turno !== reservaAtual.turno;

    if (mudouLugarOuHorario) {
      encerrarTrocasPendentes(reservaId);
    }

    registrarHistorico(
      "reserva_alterada",
      reservaId,
      usuarioId,
      JSON.stringify({
        antes: reservaAtual,
        depois: {
          salaId,
          data,
          turno,
          motivo
        }
      })
    );
  });

  alterar();

  return res.json({
    mensagem: "Reserva alterada com sucesso.",
    reserva: buscarReserva(reservaId)
  });
});

app.patch("/reservas/:id/cancelar", autenticarToken, (req, res) => {
  const reservaId = Number(req.params.id);
  const usuarioId = req.usuario.id;

  const reserva = buscarReserva(reservaId);
  const usuario = buscarUsuario(usuarioId);

  if (!reserva) {
    return res.status(404).json({
      erro: "Reserva não encontrada."
    });
  }

  if (!usuario) {
    return res.status(404).json({
      erro: "Usuário não encontrado."
    });
  }

  const ehDonoDaReserva = reserva.professorId === usuarioId;
  const ehCoordenadora = usuario.papel === "coordenadora";

  if (!ehDonoDaReserva && !ehCoordenadora) {
    return res.status(403).json({
      erro: "Você não possui permissão para cancelar esta reserva."
    });
  }

  if (reserva.status === "cancelada") {
    return res.status(409).json({
      erro: "Esta reserva já foi cancelada."
    });
  }

  const cancelar = db.transaction(() => {
    db.prepare(`
      UPDATE reservas
      SET status = 'cancelada'
      WHERE id = ?
    `).run(reservaId);

    encerrarTrocasPendentes(reservaId);

    registrarHistorico("reserva_cancelada", reservaId, usuarioId);
  });

  cancelar();

  return res.json({
    mensagem: "Reserva cancelada com sucesso.",
    reserva: buscarReserva(reservaId)
  });
});

app.post(
  "/sugestoes-grade",
  autenticarToken,
  exigirCoordenadora,
  (req, res) => {
    const dados = lerPedidosDaGrade(req.body);

    if (dados.erro) {
      return res.status(400).json({ erro: dados.erro });
    }

    const resultado = montarGradeCompleta(dados);

    if (resultado.erro) {
      return res.status(409).json({ erro: resultado.erro });
    }

    return res.json({
      mensagem: "Grade gerada com backtracking.",
      plano: resultado.plano,
      estatisticas: resultado.estatisticas
    });
  }
);


app.post(
  "/sugestoes-grade/confirmar",
  autenticarToken,
  exigirCoordenadora,
  (req, res) => {
    const dados = lerPedidosDaGrade(req.body);

    if (dados.erro) {
      return res.status(400).json({ erro: dados.erro });
    }

    const resultado = montarGradeCompleta(dados);

    if (resultado.erro) {
      return res.status(409).json({ erro: resultado.erro });
    }

    const plano = resultado.plano;

    const criarReservas = db.transaction(() => {
      const inserir = db.prepare(`
        INSERT INTO reservas (
          sala_id,
          professor_id,
          data,
          turno,
          motivo,
          status
        )
        VALUES (?, ?, ?, ?, ?, 'confirmada')
      `);

      return plano.map((item) => {
        const resultadoInsercao = inserir.run(
          item.salaId,
          item.professorId,
          item.data,
          item.turno,
          item.motivo
        );

        const reservaId = Number(resultadoInsercao.lastInsertRowid);

        registrarHistorico(
          "reserva_criada",
          reservaId,
          req.usuario.id,
          JSON.stringify({ origem: "grade" })
        );

        return buscarReserva(reservaId);
      });
    });

    try {
      const reservas = criarReservas();

      return res.status(201).json({
        mensagem: `${reservas.length} reservas criadas a partir da grade.`,
        reservas
      });
    } catch (erro) {
      console.error(erro);

      return res.status(500).json({
        erro: "Não foi possível criar as reservas da grade."
      });
    }
  }
);

app.get("/historico", autenticarToken, (req, res) => {
  const consultaBase = `
    SELECT
      h.id,
      h.acao,
      h.detalhes,
      h.reserva_id AS reservaId,
      h.autor_id AS autorId,
      u.nome AS autorNome,
      h.data_hora AS dataHora
    FROM historico h
    JOIN usuarios u ON u.id = h.autor_id
  `;

  const historico = req.usuario.papel === "coordenadora"
    ? db.prepare(`${consultaBase} ORDER BY h.id DESC`).all()
    : db.prepare(`
        ${consultaBase}
        JOIN reservas r ON r.id = h.reserva_id
        WHERE r.professor_id = ?
        ORDER BY h.id DESC
      `).all(req.usuario.id);

  res.json(historico);
});

app.get("/coordenadoras", autenticarToken, exigirCoordenadora, (req, res) => {
  const coordenadoras = db
    .prepare(`
      SELECT id, nome, papel
      FROM usuarios
      WHERE papel = 'coordenadora'
      ORDER BY id
    `)
    .all();

  res.json(coordenadoras);
});

app.post("/trocas", autenticarToken, (req, res) => {
  const reservaSolicitanteId = Number(req.body.reservaSolicitanteId);
  const reservaDestinoId = Number(req.body.reservaDestinoId);
  const solicitanteId = req.usuario.id;

  const motivo =
    typeof req.body.motivo === "string" ? req.body.motivo.trim() : "";

  if (!motivo) {
    return res.status(400).json({
      erro: "Informe o motivo da troca."
    });
  }

  if (motivo.length > 300) {
    return res.status(400).json({
      erro: "O motivo deve ter no máximo 300 caracteres."
    });
  }

  const reservaSolicitante = buscarReserva(reservaSolicitanteId);
  const reservaDestino = buscarReserva(reservaDestinoId);
  const solicitante = buscarUsuario(solicitanteId);

  if (!reservaSolicitante || !reservaDestino || !solicitante) {
    return res.status(404).json({
      erro: "Reserva ou usuário não encontrado."
    });
  }

  if (reservaSolicitanteId === reservaDestinoId) {
    return res.status(400).json({
      erro: "Uma reserva não pode solicitar troca com ela mesma."
    });
  }

  if (solicitante.papel !== "professor") {
    return res.status(403).json({
      erro: "Somente professores podem solicitar trocas."
    });
  }

  if (reservaSolicitante.professorId !== solicitanteId) {
    return res.status(403).json({
      erro: "Você só pode solicitar troca da própria reserva."
    });
  }

  if (
    reservaSolicitante.status !== "confirmada" ||
    reservaDestino.status !== "confirmada"
  ) {
    return res.status(409).json({
      erro: "As duas reservas precisam estar confirmadas."
    });
  }

  if (
    reservaSolicitante.data !== reservaDestino.data ||
    reservaSolicitante.turno !== reservaDestino.turno
  ) {
    return res.status(409).json({
      erro: "As reservas precisam ser da mesma data e turno."
    });
  }

  if (dataEhPassada(reservaSolicitante.data)) {
    return res.status(409).json({
      erro: "Não é possível trocar reservas de uma data que já passou."
    });
  }

  const trocaRepetida = db.prepare(`
    SELECT id
    FROM solicitacoes_troca
    WHERE status = 'pendente'
      AND (
        (reserva_solicitante_id = ? AND reserva_destino_id = ?)
        OR (reserva_solicitante_id = ? AND reserva_destino_id = ?)
      )
  `).get(
    reservaSolicitanteId,
    reservaDestinoId,
    reservaDestinoId,
    reservaSolicitanteId
  );

  if (trocaRepetida) {
    return res.status(409).json({
      erro: "Já existe uma solicitação pendente de troca entre essas duas reservas."
    });
  }

  const resultado = db.prepare(`
    INSERT INTO solicitacoes_troca (
      reserva_solicitante_id,
      reserva_destino_id,
      solicitante_id,
      motivo
    )
    VALUES (?, ?, ?, ?)
  `).run(reservaSolicitanteId, reservaDestinoId, solicitanteId, motivo);

  const trocaId = Number(resultado.lastInsertRowid);

  registrarHistorico(
    "troca_solicitada",
    reservaSolicitanteId,
    solicitanteId,
    JSON.stringify({ reservaDestinoId })
  );

  return res.status(201).json({
    mensagem: "Solicitação de troca criada.",
    troca: buscarTroca(trocaId)
  });
});

app.get("/trocas", autenticarToken, (req, res) => {
  const consultaBase = `
    SELECT
      id,
      reserva_solicitante_id AS reservaSolicitanteId,
      reserva_destino_id AS reservaDestinoId,
      solicitante_id AS solicitanteId,
      motivo,
      status,
      criada_em AS criadaEm,
      respondida_em AS respondidaEm
    FROM solicitacoes_troca
  `;

  const trocas = req.usuario.papel === "coordenadora"
    ? db.prepare(`${consultaBase} ORDER BY id DESC`).all()
    : db.prepare(`
        ${consultaBase}
        WHERE reserva_solicitante_id IN (
          SELECT id FROM reservas WHERE professor_id = ?
        ) OR reserva_destino_id IN (
          SELECT id FROM reservas WHERE professor_id = ?
        )
        ORDER BY id DESC
      `).all(req.usuario.id, req.usuario.id);

  res.json(trocas);
});

app.patch("/trocas/:id/responder", autenticarToken, (req, res) => {
  const trocaId = Number(req.params.id);
  const usuarioId = req.usuario.id;
  const { aceitar } = req.body;

  const troca = buscarTroca(trocaId);
  const usuario = buscarUsuario(usuarioId);

  if (!troca || !usuario) {
    return res.status(404).json({
      erro: "Solicitação ou usuário não encontrado."
    });
  }

  if (troca.status !== "pendente") {
    return res.status(409).json({
      erro: "Esta solicitação já foi respondida."
    });
  }

  if (typeof aceitar !== "boolean") {
    return res.status(400).json({
      erro: "Informe aceitar como true ou false."
    });
  }

  const reservaSolicitante = buscarReserva(troca.reservaSolicitanteId);
  const reservaDestino = buscarReserva(troca.reservaDestinoId);

  if (
    reservaDestino.professorId !== usuarioId &&
    usuario.papel !== "coordenadora"
  ) {
    return res.status(403).json({
      erro: "Apenas o professor da outra reserva ou a coordenação pode responder."
    });
  }

  if (!aceitar) {
    db.prepare(`
      UPDATE solicitacoes_troca
      SET status = 'recusada',
          respondida_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(trocaId);

    registrarHistorico(
      "troca_recusada",
      troca.reservaDestinoId,
      usuarioId,
      JSON.stringify({ trocaId })
    );

    return res.json({
      mensagem: "Troca recusada.",
      troca: buscarTroca(trocaId)
    });
  }


  const aindaPossivel =
    reservaSolicitante.status === "confirmada" &&
    reservaDestino.status === "confirmada" &&
    reservaSolicitante.data === reservaDestino.data &&
    reservaSolicitante.turno === reservaDestino.turno &&
    !dataEhPassada(reservaSolicitante.data);

  if (!aindaPossivel) {
    db.prepare(`
      UPDATE solicitacoes_troca
      SET status = 'recusada',
          respondida_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(trocaId);

    return res.status(409).json({
      erro: "As reservas mudaram desde o pedido, então a solicitação foi encerrada."
    });
  }

  const concluirTroca = db.transaction(() => {
    db.prepare(`
      UPDATE reservas
      SET status = 'pendente_troca'
      WHERE id = ?
    `).run(reservaSolicitante.id);

    db.prepare(`
      UPDATE reservas
      SET sala_id = ?
      WHERE id = ?
    `).run(reservaSolicitante.salaId, reservaDestino.id);

    db.prepare(`
      UPDATE reservas
      SET sala_id = ?,
          status = 'confirmada'
      WHERE id = ?
    `).run(reservaDestino.salaId, reservaSolicitante.id);

    db.prepare(`
      UPDATE solicitacoes_troca
      SET status = 'aceita',
          respondida_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(trocaId);


    encerrarTrocasPendentes(reservaSolicitante.id);
    encerrarTrocasPendentes(reservaDestino.id);
  });

  concluirTroca();

  registrarHistorico(
    "troca_aceita",
    reservaSolicitante.id,
    usuarioId,
    JSON.stringify({ trocaId, novaSalaId: reservaDestino.salaId })
  );

  registrarHistorico(
    "troca_aceita",
    reservaDestino.id,
    usuarioId,
    JSON.stringify({ trocaId, novaSalaId: reservaSolicitante.salaId })
  );

  return res.json({
    mensagem: "Troca aceita e salas atualizadas.",
    troca: buscarTroca(trocaId),
    reservaSolicitante: buscarReserva(reservaSolicitante.id),
    reservaDestino: buscarReserva(reservaDestino.id)
  });
});

app.get("/reservas-resumo", autenticarToken, (req, res) => {
  const reservas = db.prepare(`
    SELECT
      r.id,
      r.sala_id AS salaId,
      s.nome AS salaNome,
      r.professor_id AS professorId,
      u.nome AS professorNome,
      r.data,
      r.turno,
      r.status
    FROM reservas r
    JOIN salas s ON s.id = r.sala_id
    JOIN usuarios u ON u.id = r.professor_id
    ORDER BY r.data, r.turno
  `).all();

  res.json(reservas);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor iniciado em http://localhost:${PORT}`);
  });
}

module.exports = { app, db };
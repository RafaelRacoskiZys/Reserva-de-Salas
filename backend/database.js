const Database = require("better-sqlite3");

const db = new Database(process.env.DB_FILE || "reservas.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS salas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cpf TEXT UNIQUE,
    senha_hash TEXT,
    curso TEXT,
    papel TEXT NOT NULL CHECK (papel IN ('professor', 'coordenadora'))
  );

  CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sala_id INTEGER NOT NULL,
    professor_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    turno TEXT NOT NULL CHECK (turno IN ('manha', 'tarde', 'noite')),
    motivo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmada'
      CHECK (status IN ('confirmada', 'cancelada', 'pendente_troca')),
    criada_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sala_id) REFERENCES salas(id),
    FOREIGN KEY (professor_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS historico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acao TEXT NOT NULL,
    reserva_id INTEGER NOT NULL,
    autor_id INTEGER NOT NULL,
    data_hora TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reserva_id) REFERENCES reservas(id),
    FOREIGN KEY (autor_id) REFERENCES usuarios(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS reserva_confirmada_por_sala
  ON reservas(sala_id, data, turno)
  WHERE status = 'confirmada';

  CREATE UNIQUE INDEX IF NOT EXISTS reserva_confirmada_por_professor
  ON reservas(professor_id, data, turno)
  WHERE status = 'confirmada';
`);

const colunasHistorico = db.prepare("PRAGMA table_info(historico)").all();

const historicoTemDetalhes = colunasHistorico.some(
  (coluna) => coluna.name === "detalhes"
);

if (!historicoTemDetalhes) {
  db.exec("ALTER TABLE historico ADD COLUMN detalhes TEXT");
}

const salasIniciais = [
  ["Automação", "laboratório"],
  ["Pneumática", "laboratório"],
  ["Elétrica Industrial", "laboratório"],
  ["Elétrica Predial", "laboratório"],
  ["Eletrônica", "laboratório"],
  ["Solda 1", "laboratório"],
  ["Solda 2", "laboratório"],
  ["Robótica", "laboratório"],
  ["Sala Normal 1", "sala comum"],
  ["Sala Normal 2", "sala comum"],
  ["Sala Normal 3", "sala comum"],
  ["Sala Normal 4", "sala comum"],
  ["Sala Normal 5", "sala comum"],
  ["Laboratório de Informática 1", "laboratório"],
  ["Laboratório de Informática 2", "laboratório"],
  ["Logística", "laboratório"],
  ["CAD", "laboratório"],
  ["Oficina — Parte 1", "oficina"],
  ["Oficina — Parte 2", "oficina"],
  ["Oficina — Parte 3", "oficina"]
];

const professoresIniciais = [
  ["Sami Berti", "Operador de Processos Logísticos"],
  ["Aletodescatt", "Técnico em Eletromecânica"],
  ["Josué Cauon", "Eletricista Industrial"],
  ["Odairon", "Desenho Mecânico"],
  ["Eduarda", "Desenho Mecânico"],
  ["Poliana", "Mecânico de Manutenção de Máquinas Industriais"],
  ["Jeanifer", "Mecânico de Manutenção de Máquinas Industriais"],
  ["Jhonas", "Manutenção / Torno CNC"],
  ["Wallsion", "Manutenção / Torno CNC"],
  ["Dionatan", "Eletrônica"],
  ["Henry", "Robótica"],
  ["Mateufields", "Solda"],
  ["Ferranti", "Técnico em Automação"]
];

const inserirSala = db.prepare(`
  INSERT OR IGNORE INTO salas (nome, tipo)
  VALUES (?, ?)
`);

const buscarProfessor = db.prepare(`
  SELECT id FROM usuarios
  WHERE nome = ? AND papel = 'professor'
`);

const inserirProfessor = db.prepare(`
  INSERT INTO usuarios (nome, curso, papel)
  VALUES (?, ?, 'professor')
`);

const cadastrarDadosIniciais = db.transaction(() => {
  for (const sala of salasIniciais) {
    inserirSala.run(sala[0], sala[1]);
  }

  for (const professor of professoresIniciais) {
    const professorExiste = buscarProfessor.get(professor[0]);

    if (!professorExiste) {
      inserirProfessor.run(professor[0], professor[1]);
    }
  }
});

cadastrarDadosIniciais();

// Salas em que cada professor pode dar aula, em ordem de preferência.
// O backtracking usa essa lista para montar a grade automaticamente.
db.exec(`
  CREATE TABLE IF NOT EXISTS professor_salas (
    professor_id INTEGER NOT NULL,
    sala_id INTEGER NOT NULL,
    ordem INTEGER NOT NULL,
    PRIMARY KEY (professor_id, sala_id),
    FOREIGN KEY (professor_id) REFERENCES usuarios(id),
    FOREIGN KEY (sala_id) REFERENCES salas(id)
  );
`);

const salasComuns = [
  "Sala Normal 1",
  "Sala Normal 2",
  "Sala Normal 3",
  "Sala Normal 4",
  "Sala Normal 5"
];

// Salas do curso de cada professor. Depois delas, todos podem usar as salas
// comuns (por exemplo, para aula teórica). Pode ser ajustado à vontade.
const salasPorProfessor = {
  "Sami Berti": ["Logística"],
  "Aletodescatt": ["Pneumática", "Elétrica Industrial", "Automação"],
  "Josué Cauon": ["Elétrica Industrial", "Elétrica Predial"],
  "Odairon": ["CAD", "Laboratório de Informática 1", "Laboratório de Informática 2"],
  "Eduarda": ["CAD", "Laboratório de Informática 1", "Laboratório de Informática 2"],
  "Poliana": ["Oficina — Parte 1", "Oficina — Parte 2", "Oficina — Parte 3"],
  "Jeanifer": ["Oficina — Parte 1", "Oficina — Parte 2", "Oficina — Parte 3"],
  "Jhonas": ["Oficina — Parte 1", "Oficina — Parte 2", "Oficina — Parte 3"],
  "Wallsion": ["Oficina — Parte 1", "Oficina — Parte 2", "Oficina — Parte 3"],
  "Dionatan": ["Eletrônica"],
  "Henry": ["Robótica"],
  "Mateufields": ["Solda 1", "Solda 2"],
  "Ferranti": ["Automação", "Pneumática", "Robótica"]
};

const cadastrarSalasDosProfessores = db.transaction(() => {
  const idDoProfessor = db.prepare(
    "SELECT id FROM usuarios WHERE nome = ? AND papel = 'professor'"
  );
  const idDaSala = db.prepare("SELECT id FROM salas WHERE nome = ?");
  const inserirVinculo = db.prepare(`
    INSERT OR IGNORE INTO professor_salas (professor_id, sala_id, ordem)
    VALUES (?, ?, ?)
  `);

  for (const [nomeProfessor, salasDoCurso] of Object.entries(salasPorProfessor)) {
    const professor = idDoProfessor.get(nomeProfessor);

    if (!professor) {
      continue;
    }

    [...salasDoCurso, ...salasComuns].forEach((nomeSala, posicao) => {
      const sala = idDaSala.get(nomeSala);

      if (sala) {
        inserirVinculo.run(professor.id, sala.id, posicao);
      }
    });
  }
});

cadastrarSalasDosProfessores();

const coordenadorasIniciais = [
  "Coordenadora 1",
  "Coordenadora 2",
  "Coordenadora 3"
];

const inserirCoordenadora = db.prepare(`
  INSERT INTO usuarios (nome, papel)
  SELECT ?, 'coordenadora'
  WHERE NOT EXISTS (
    SELECT 1
    FROM usuarios
    WHERE nome = ? AND papel = 'coordenadora'
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS solicitacoes_troca (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reserva_solicitante_id INTEGER NOT NULL,
    reserva_destino_id INTEGER NOT NULL,
    solicitante_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente'
      CHECK (status IN ('pendente', 'aceita', 'recusada')),
    criada_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    respondida_em TEXT,
    FOREIGN KEY (reserva_solicitante_id) REFERENCES reservas(id),
    FOREIGN KEY (reserva_destino_id) REFERENCES reservas(id),
    FOREIGN KEY (solicitante_id) REFERENCES usuarios(id)
  );
`);

const colunasTroca = db.prepare("PRAGMA table_info(solicitacoes_troca)").all();

if (!colunasTroca.some((coluna) => coluna.name === "motivo")) {
  db.exec("ALTER TABLE solicitacoes_troca ADD COLUMN motivo TEXT");
}

for (const nome of coordenadorasIniciais) {
  inserirCoordenadora.run(nome, nome);
}

console.log("Banco de dados preparado com sucesso.");

module.exports = db;
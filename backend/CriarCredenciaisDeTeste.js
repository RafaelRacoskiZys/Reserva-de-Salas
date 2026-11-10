const bcrypt = require("bcrypt");
const db = require("./database");

const senhaPadrao = "Senha@123";

const credenciais = [
  ["Sami Berti", "90000000001"],
  ["Aletodescatt", "90000000002"],
  ["Josué Cauon", "90000000003"],
  ["Odairon", "90000000004"],
  ["Eduarda", "90000000005"],
  ["Poliana", "90000000006"],
  ["Jeanifer", "90000000007"],
  ["Jhonas", "90000000008"],
  ["Wallsion", "90000000009"],
  ["Dionatan", "90000000010"],
  ["Henry", "90000000011"],
  ["Mateufields", "90000000012"],
  ["Ferranti", "90000000013"],
  ["Coordenadora 1", "90000000101"],
  ["Coordenadora 2", "90000000102"],
  ["Coordenadora 3", "90000000103"]
];

async function criarCredenciais() {
  const senhaHash = await bcrypt.hash(senhaPadrao, 10);

  const atualizarUsuario = db.prepare(`
    UPDATE usuarios
    SET cpf = ?, senha_hash = ?
    WHERE nome = ?
  `);

  for (const [nome, cpf] of credenciais) {
    atualizarUsuario.run(cpf, senhaHash, nome);
  }

  console.log("Credenciais de teste criadas com sucesso.");
  console.log("Senha de todos os usuários: Senha@123");
}

criarCredenciais();
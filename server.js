const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'ceeac-db.json');
const BOOTSTRAP_ADMIN_EMAIL = normalizeEmail(getRequiredEnv('BOOTSTRAP_ADMIN_EMAIL'));
const PASSWORD_PEPPER = getRequiredEnv('PASSWORD_PEPPER');
const SESSION_SECRET = getRequiredEnv('SESSION_SECRET');
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const DEFAULT_DB = {
  users: [],
  cards: [],
  accessLogs: [],
  systemLogs: [],
  legacyAssets: []
};

const PAGE_MAP = {
  login: 'login.html',
  portaria: 'portaria.html',
  admin: 'admin.html',
  scanner: 'scanner.html',
  index: 'scanner.html',
  cartaoui: 'card.html',
  portal: 'card.html'
};

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/assets', express.static(path.join(__dirname, 'public')));

ensureDataFile();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
  const page = String(req.query.page || 'login').toLowerCase();
  const fileName = PAGE_MAP[page] || PAGE_MAP.login;
  return res.sendFile(path.join(__dirname, 'public', fileName));
});

app.post('/api/legacy/save', requireAuth('ADMINISTRADOR'), (req, res) => {
  return res.json(executarGravacaoSegura(req.body || {}));
});

app.post('/api/auth/login', (req, res) => {
  const { email = '', senha = '' } = req.body || {};
  const emailNorm = normalizeEmail(email);
  const db = readDb();

  if (db.users.length === 0 && emailNorm === BOOTSTRAP_ADMIN_EMAIL) {
    const admin = {
      id: crypto.randomUUID(),
      nome: 'Administrador CEEAC',
      email: emailNorm,
      senhaHash: hashPassword(senha),
      perfil: 'ADMINISTRADOR',
      status: 'ATIVO',
      criadoEm: new Date().toISOString()
    };
    db.users.push(admin);
    appendSystemLog(db, 'INFO', 'BOOTSTRAP_ADMIN', emailNorm, 'Administrador mestre criado automaticamente.');
    writeDb(db);
    return res.json({ sucesso: true, redirecionarLogin: true, mensagem: 'Admin Mestre criado! Logue novamente.' });
  }

  const user = db.users.find((item) => normalizeEmail(item.email) === emailNorm);
  if (!user) {
    return res.status(404).json({ sucesso: false, erro: 'Este e-mail não possui cadastro.' });
  }

  if (!verifyPassword(senha, user.senhaHash)) {
    return res.status(401).json({ sucesso: false, erro: 'Senha incorreta.' });
  }

  if (user.status !== 'ATIVO') {
    return res.status(403).json({ sucesso: false, erro: 'Seu cadastro está pendente de aprovação.' });
  }

  appendSystemLog(db, 'INFO', 'LOGIN', user.email, `Acesso autorizado como ${user.perfil}`);
  writeDb(db);

  return res.json({
    sucesso: true,
    usuario: serializeUser(user),
    token: buildSessionToken(user)
  });
});

app.post('/api/auth/register', (req, res) => {
  const { nome = '', email = '', senha = '' } = req.body || {};
  const nomeTrim = String(nome).trim();
  const emailNorm = normalizeEmail(email);

  if (!nomeTrim || !emailNorm || String(senha).length < 6) {
    return res.status(400).json({ sucesso: false, erro: 'Preencha nome, e-mail e senha válida.' });
  }

  const db = readDb();
  const exists = db.users.some((item) => normalizeEmail(item.email) === emailNorm);
  if (exists) {
    return res.status(409).json({ sucesso: false, erro: 'E-mail corporativo já cadastrado.' });
  }

  db.users.push({
    id: crypto.randomUUID(),
    nome: nomeTrim,
    email: emailNorm,
    senhaHash: hashPassword(senha),
    perfil: 'OPERADOR_PORTARIA',
    status: 'PENDENTE',
    criadoEm: new Date().toISOString()
  });
  appendSystemLog(db, 'WARNING', 'AUTOCADASTRO', emailNorm, 'Solicitação de cadastro gerada.');
  writeDb(db);

  return res.json({ sucesso: true, mensagem: 'Cadastro efetuado! Aguarde liberação do administrador.' });
});

app.get('/api/vehicles/:placa', requireAuth(), (req, res) => {
  const result = verificarPlaca(req.params.placa);
  const statusCode = result.sucesso ? 200 : 400;
  return res.status(statusCode).json(result);
});

app.post('/api/access/register', requireAuth(), (req, res) => {
  const { placa = '', tipoMovimento = '', idCartaoFk = '' } = req.body || {};
  const user = req.user;

  if (!['OPERADOR_PORTARIA', 'ADMINISTRADOR'].includes(user.perfil)) {
    return res.status(403).json({ sucesso: false, erro: 'Nível de permissão insuficiente.' });
  }

  const movement = String(tipoMovimento).toUpperCase();
  if (!['ENTRADA', 'SAIDA'].includes(movement)) {
    return res.status(400).json({ sucesso: false, erro: 'Tipo de movimentação inválido.' });
  }

  const normalizedPlate = normalizePlate(placa);
  if (normalizedPlate.length < 7) {
    return res.status(400).json({ sucesso: false, erro: 'Placa inválida (mínimo 7 caracteres).' });
  }

  const db = readDb();
  const now = new Date().toISOString();
  db.accessLogs.push({
    id: crypto.randomUUID(),
    dataHora: now,
    placa: normalizedPlate,
    tipoMovimento: movement,
    idCartaoFk: idCartaoFk || 'N/A',
    operadorPortaria: user.email,
    observacao: 'Registrado via Web App containerizado.'
  });
  appendSystemLog(db, 'INFO', 'REGISTRO_PORTARIA', user.email, `${movement} registrada para ${normalizedPlate}.`);
  writeDb(db);

  return res.json({
    sucesso: true,
    mensagem: `Passagem de ${movement} registrada!`,
    dataHora: new Date(now).toLocaleString('pt-BR')
  });
});

app.get('/api/admin/dashboard', requireAuth('ADMINISTRADOR'), (req, res) => {
  const db = readDb();
  const usuariosPendentes = db.users
    .filter((item) => item.status === 'PENDENTE')
    .map((item) => ({ id: item.id, nome: item.nome, email: item.email, perfil: item.perfil }));

  const logs = db.systemLogs
    .slice(-15)
    .reverse()
    .map((item) => ({
      data: item.dataHora,
      severidade: item.severidade,
      acao: item.acao,
      usuario: item.usuario,
      detalhes: item.detalhes
    }));

  return res.json({
    sucesso: true,
    usuariosPendentes,
    totalCartoes: db.cards.length,
    logs
  });
});

app.post('/api/admin/moderate', requireAuth('ADMINISTRADOR'), (req, res) => {
  const { idUsuario = '', novoPerfil = '', acao = '' } = req.body || {};
  const db = readDb();
  const index = db.users.findIndex((item) => item.id === idUsuario);
  if (index === -1) {
    return res.status(404).json({ sucesso: false, erro: 'Usuário não localizado.' });
  }

  const action = String(acao).toUpperCase();
  const target = db.users[index];

  if (action === 'APROVAR') {
    target.perfil = String(novoPerfil || 'OPERADOR_PORTARIA').toUpperCase();
    target.status = 'ATIVO';
    appendSystemLog(db, 'INFO', 'MODERACAO', req.user.email, `Aprovado: ${target.email} como ${target.perfil}`);
  } else {
    db.users.splice(index, 1);
    appendSystemLog(db, 'WARNING', 'MODERACAO', req.user.email, `Recusado: ${target.email}`);
  }

  writeDb(db);
  return res.json({ sucesso: true, mensagem: 'Ação processada com sucesso!' });
});

app.post('/api/admin/cards', requireAuth('ADMINISTRADOR'), (req, res) => {
  const { nomeProprietario = '', placa01 = '', placa02 = '', secretaria = '', validade = '' } = req.body || {};
  const owner = String(nomeProprietario).trim().toUpperCase();
  const primaryPlate = normalizePlate(placa01);
  const secondaryPlate = normalizePlate(placa02);
  const department = String(secretaria).trim().toUpperCase();
  const expiration = String(validade).trim();

  if (!owner || primaryPlate.length < 7 || !department || !expiration) {
    return res.status(400).json({ sucesso: false, erro: 'Dados do cartão inválidos.' });
  }

  const db = readDb();
  const id = `CARD_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  db.cards.push({
    id,
    nomeProprietario: owner,
    placa01: primaryPlate,
    placa02: secondaryPlate || 'N/A',
    secretaria: department,
    validade: expiration,
    status: 'ATIVO',
    criadoEm: new Date().toISOString()
  });
  appendSystemLog(db, 'INFO', 'EMISSAO_CARD', req.user.email, `Emitido cartão ${id} para ${owner}`);
  writeDb(db);

  return res.json({ sucesso: true, mensagem: `Cartão de acesso emitido! ID: ${id}` });
});

app.post('/api/admin/temp-access', requireAuth('ADMINISTRADOR'), (req, res) => {
  const { nome = '', placa = '' } = req.body || {};
  const visitor = String(nome).trim().toUpperCase();
  const normalizedPlate = normalizePlate(placa);

  if (!visitor || normalizedPlate.length < 7) {
    return res.status(400).json({ sucesso: false, erro: 'Inputs inválidos.' });
  }

  const db = readDb();
  const id = `TEMP_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  db.cards.push({
    id,
    nomeProprietario: `${visitor} (TEMPORÁRIO)`,
    placa01: normalizedPlate,
    placa02: 'N/A',
    secretaria: 'VISITANTE',
    validade: tomorrow.toLocaleDateString('pt-BR'),
    status: 'ATIVO',
    criadoEm: new Date().toISOString()
  });
  appendSystemLog(db, 'INFO', 'ACESSO_TEMPORARIO', req.user.email, `Acesso temporário gerado para ${visitor}.`);
  writeDb(db);

  return res.json({ sucesso: true, mensagem: `Acesso gerado para ${visitor}. Validade: 24h.` });
});

app.post('/api/admin/revoke-temp', requireAuth('ADMINISTRADOR'), (req, res) => {
  const db = readDb();
  let revogados = 0;

  db.cards.forEach((card) => {
    if (card.id.startsWith('TEMP_') || String(card.nomeProprietario).includes('(TEMPORÁRIO)')) {
      if (card.status !== 'INATIVO') {
        card.status = 'INATIVO';
        revogados += 1;
      }
    }
  });

  appendSystemLog(db, 'WARNING', 'REVOGACAO_TEMPORARIA', req.user.email, `Revogados ${revogados} acessos temporários.`);
  writeDb(db);
  return res.json({ sucesso: true, mensagem: `Revogados ${revogados} acessos temporários.` });
});

app.post('/api/admin/colorize', requireAuth('ADMINISTRADOR'), (req, res) => {
  const db = readDb();
  appendSystemLog(db, 'INFO', 'PADRONIZACAO_VISUAL', req.user.email, 'Padronização visual solicitada no modo containerizado.');
  writeDb(db);
  return res.json({ sucesso: true, mensagem: 'Estrutura visual repadronizada!' });
});

app.get('/api/auth/permissions', requireAuth(), (req, res) => {
  const escopos = req.user.perfil === 'ADMINISTRADOR' ? ['ocr:scan', 'system:config'] : ['ocr:scan'];
  return res.json({ sucesso: true, perfil: req.user.perfil, escopos });
});

app.get('/api/me', requireAuth(), (req, res) => {
  return res.json({ sucesso: true, usuario: serializeUser(req.user) });
});

app.listen(PORT, () => {
  console.log(`CEEAC Control listening on port ${PORT}`);
});

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

function readDb() {
  ensureDataFile();
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    accessLogs: Array.isArray(parsed.accessLogs) ? parsed.accessLogs : [],
    systemLogs: Array.isArray(parsed.systemLogs) ? parsed.systemLogs : [],
    legacyAssets: Array.isArray(parsed.legacyAssets) ? parsed.legacyAssets : []
  };
}

function writeDb(db) {
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function executarGravacaoSegura(params) {
  const db = readDb();
  const payload = {
    id: crypto.randomUUID(),
    cod: sanitizeText(params.cod, 40),
    nomeFuncionario: sanitizeText(params.nome_funcionario, 120),
    modelo01: sanitizeText(params.modelo_01, 120),
    placa: normalizePlate(params.placa || '').slice(0, 10),
    modelo02: sanitizeText(params.modelo, 120),
    placa2: normalizePlate(params.placa2 || '').slice(0, 10),
    periodo: sanitizeText(params.periodo, 60),
    secretaria: sanitizeText(params.secretaria, 80),
    status: sanitizeText(params.status || 'ATIVO', 20).toUpperCase(),
    criadoEm: new Date().toISOString()
  };

  db.legacyAssets.push(payload);
  appendSystemLog(db, 'INFO', 'LEGACY_SAVE', payload.nomeFuncionario || 'integração', `Ativo legado gravado para placa ${payload.placa || 'N/A'}.`);
  writeDb(db);

  return {
    status: 'success',
    message: 'Ativo gravado com sucesso!',
    id_gerado: payload.id
  };
}

function verificarPlaca(placaInput) {
  const plate = normalizePlate(placaInput);
  if (plate.length < 7) {
    return { sucesso: false, status: 'DESCONHECIDO', mensagem: 'Placa inválida (mínimo 7 caracteres).' };
  }

  const db = readDb();
  const found = db.cards.find((card) => normalizePlate(card.placa01) === plate || normalizePlate(card.placa02) === plate);
  if (!found) {
    return { sucesso: true, status: 'DESCONHECIDO', mensagem: 'Veículo não localizado.' };
  }

  const isLiberado = ['ATIVO', 'LIBERADO', 'OK'].includes(String(found.status).toUpperCase());
  return {
    sucesso: true,
    status: isLiberado ? 'LIBERADO' : 'BLOQUEADO',
    mensagem: isLiberado ? 'Acesso Autorizado.' : `Bloqueio: Status ${found.status}`,
    dados: {
      id: found.id,
      proprietario: found.nomeProprietario,
      placa: normalizePlate(found.placa01) === plate ? found.placa01 : found.placa02,
      secretaria: found.secretaria,
      validade: found.validade
    }
  };
}

function appendSystemLog(db, severidade, acao, usuario, detalhes) {
  db.systemLogs.push({
    dataHora: new Date().toISOString(),
    severidade: String(severidade).toUpperCase(),
    acao,
    usuario,
    detalhes
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), `${salt}:${PASSWORD_PEPPER}`, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, derivedHash] = String(storedHash || '').split(':', 2);
  if (!salt || !derivedHash) {
    return false;
  }

  const candidateHash = crypto.scryptSync(String(password), `${salt}:${PASSWORD_PEPPER}`, 64).toString('hex');
  const derivedBuffer = Buffer.from(derivedHash, 'hex');
  const candidateBuffer = Buffer.from(candidateHash, 'hex');
  if (derivedBuffer.length !== candidateBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(derivedBuffer, candidateBuffer);
}

function serializeUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    perfil: user.perfil
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePlate(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sanitizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function buildSessionToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    perfil: user.perfil,
    exp: Date.now() + SESSION_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function requireAuth(requiredPerfil) {
  return (req, res, next) => {
    const auth = authenticateRequest(req, requiredPerfil);
    if (auth.error) {
      return res.status(auth.error.status).json({ sucesso: false, erro: auth.error.message });
    }
    req.user = auth.user;
    return next();
  };
}

function verifySessionToken(token) {
  if (!token) {
    return null;
  }

  const separatorIndex = token.indexOf('.');
  if (separatorIndex <= 0 || token.indexOf('.', separatorIndex + 1) !== -1) {
    return null;
  }

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(encodedPayload).digest('base64url');
  const signatureBuffer = Buffer.from(signature, 'base64url');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

function authenticateRequest(req, requiredPerfil) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = verifySessionToken(token);

  if (!payload) {
    return { error: { status: 401, message: 'Sessão inválida ou expirada.' } };
  }

  const db = readDb();
  const user = db.users.find((item) => item.id === payload.sub && normalizeEmail(item.email) === normalizeEmail(payload.email));
  if (!user || user.status !== 'ATIVO') {
    return { error: { status: 401, message: 'Usuário não autorizado.' } };
  }

  if (requiredPerfil && user.perfil !== requiredPerfil) {
    return { error: { status: 403, message: 'Nível de permissão insuficiente.' } };
  }

  return { user };
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

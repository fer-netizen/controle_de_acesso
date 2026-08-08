/**
 * ============================================================================
 * SISTEMA INTEGRADO CEEAC - PORTAL & PORTARIA V10.0 (MOBILE-FIRST)
 * Arquivo: Services.gs | Transações do Banco de Dados, Segurança e API
 * ============================================================================
 */

const PRIVATE_SECURITY_SALT = "CEEAC_SECEL_SECRET_SALT_2026";
const ID_PASTA_IMAGENS = "1l6a9njLB7g9t7IlpuM_uFk_-xPHO2SUR";

// ============================================================================
// UPLOAD DE IMAGENS PARA O GOOGLE DRIVE
// ============================================================================
function salvarImagemNoDrive(base64Data, nomeArquivo) {
  try {
    const pasta = DriveApp.getFolderById(ID_PASTA_IMAGENS);
    const base64Limpo = base64Data.split(',')[1];
    const tipoMime = base64Data.split(';')[0].split(':')[1];
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Limpo), tipoMime, nomeArquivo);
    const arquivo = pasta.createFile(blob);
    arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    registrarLogAuditoria("INFO", "UPLOAD_IMAGEM", "SYSTEM", `Imagem salva: ${nomeArquivo}`);
    return { sucesso: true, url: arquivo.getUrl(), id: arquivo.getId() };
  } catch (erro) {
    registrarLogAuditoria("ERROR", "UPLOAD_FALHA", "SYSTEM", erro.toString());
    return { sucesso: false, erro: erro.toString() };
  }
}

function obterConexaoPlanilha() {
  const SPREADSHEET_ID_LOCAL = "1ibZ43sYryxg7PqV2mCKsdE1e26aX4KLWXBh2QLTxe1o";
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID_LOCAL);
  } catch (error) {
    return SpreadsheetApp.getActiveSpreadsheet();
  }
}

function inicializarBancoDeDados() {
  const ss = obterConexaoPlanilha();
  const tabelas = {
    "Usuarios": ["ID_Usuario", "Nome", "Email", "Senha_Hash", "Perfil", "Status", "Criado_Em"],
    "Cartoes_Ativos": ["ID_Cartao", "Nome_Proprietario", "Placa_01", "Placa_02", "Secretaria", "Validade", "Status", "Criado_Em"],
    "Registro_Acessos": ["ID_Registro", "Data_Hora", "Placa", "Tipo_Movimento", "ID_Cartao_FK", "Operador_Portaria", "Observacao"],
    "Logs_Sistema": ["Data_Hora", "Severidade", "Ação", "Usuario", "Detalhes"],
    "Ativos Antigos": ["ID_ATIVO", "COD", "NOME FUNCIONARIO", "MODELO DO CARRO 01", "PLACA", "MODELO DO CARRO 02", "PLACA2", "PERIODO DE USO", "SECRETARIA", "STATUS"]
  };
  
  for (const [nomeAba, cabecalhos] of Object.entries(tabelas)) {
    let sheet = ss.getSheetByName(nomeAba);
    if (!sheet) {
      sheet = ss.insertSheet(nomeAba);
      sheet.appendRow(cabecalhos);
      sheet.getRange(1, 1, 1, cabecalhos.length)
        .setBackground("#1e293b")
        .setFontColor("#ffffff")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
      sheet.setFrozenRows(1);
    }
  }
}

function registrarLogAuditoria(severidade, acao, usuario, detalhes) {
  try {
    const ss = obterConexaoPlanilha();
    const sheet = ss.getSheetByName("Logs_Sistema");
    if (sheet) {
      sheet.appendRow([new Date(), severidade.toUpperCase(), acao, usuario, detalhes]);
    }
  } catch(e) {
    console.error("Falha de log: " + e.toString());
  }
}

function processarAutenticacao(email, senha) {
  try {
    const ss = obterConexaoPlanilha();
    const sheet = ss.getSheetByName("Usuarios");
    const dados = sheet.getDataRange().getValues();
    const emailNorm = email.trim().toLowerCase();
    const hashSenhaTentativa = calcularHashSHA256(senha);

    for (let r = 1; r < dados.length; r++) {
      const dbEmail = dados[r][2].toString().trim().toLowerCase();
      const dbHash = dados[r][3].toString();
      const dbPerfil = dados[r][4].toString();
      const dbStatus = dados[r][5].toString();

      if (dbEmail === emailNorm) {
        if (dbHash !== hashSenhaTentativa) {
          return { sucesso: false, erro: "Senha incorreta." };
        }
        if (dbStatus !== "ATIVO") {
          return { sucesso: false, erro: "Seu cadastro está pendente de aprovação." };
        }
        
        registrarLogAuditoria("INFO", "LOGIN", dbEmail, `Acesso autorizado como ${dbPerfil}`);
        return {
          sucesso: true,
          usuario: { id: dados[r][0].toString(), nome: dados[r][1].toString(), email: dbEmail, perfil: dbPerfil }
        };
      }
    }
    
    if (dados.length <= 1 && emailNorm === "admin@secel.online") {
      processarAutocadastro("Administrador CEEAC", "admin@secel.online", senha);
      sheet.getRange(2, 6).setValue("ATIVO");
      sheet.getRange(2, 5).setValue("ADMINISTRADOR");
      return { sucesso: true, redirecionarLogin: true, mensagem: "Admin Mestre criado! Logue novamente." };
    }

    return { sucesso: false, erro: "Este e-mail não possui cadastro." };
  } catch (error) {
    return { sucesso: false, erro: error.toString() };
  }
}

function processarAutocadastro(nome, email, senha) {
  try {
    const ss = obterConexaoPlanilha();
    const sheet = ss.getSheetByName("Usuarios");
    const dados = sheet.getDataRange().getValues();
    const emailNorm = email.trim().toLowerCase();

    for (let r = 1; r < dados.length; r++) {
      if (dados[r][2].toString().trim().toLowerCase() === emailNorm) {
        return { sucesso: false, erro: "E-mail corporativo já cadastrado." };
      }
    }

    const uuid = Utilities.getUuid();
    const hashSenha = calcularHashSHA256(senha);

    sheet.appendRow([uuid, nome.trim(), emailNorm, hashSenha, "OPERADOR_PORTARIA", "PENDENTE", new Date()]);
    registrarLogAuditoria("WARNING", "AUTOCADASTRO", emailNorm, `Solicitação de cadastro gerada.`);
    
    return { sucesso: true, mensagem: "Cadastro efetuado! Aguarde liberação do administrador." };
  } catch (error) {
    return { sucesso: false, erro: error.toString() };
  }
}

function calcularHashSHA256(senhaText) {
  const hashDigest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, 
    senhaText + PRIVATE_SECURITY_SALT, 
    Utilities.Charset.UTF_8
  );
  let hashOutput = "";
  for (let i = 0; i < hashDigest.length; i++) {
    let byteVal = hashDigest[i];
    if (byteVal < 0) byteVal += 256;
    let byteString = byteVal.toString(16);
    if (byteString.length === 1) byteString = "0" + byteString;
    hashOutput += byteString;
  }
  return hashOutput;
}

function validarNivelAcesso(email, perfilPermitido) {
  const ss = obterConexaoPlanilha();
  const sheet = ss.getSheetByName("Usuarios");
  const dados = sheet.getDataRange().getValues();
  const emailNorm = email.trim().toLowerCase();

  for (let r = 1; r < dados.length; r++) {
    const dbEmail = dados[r][2].toString().trim().toLowerCase();
    const dbPerfil = dados[r][4].toString();
    const dbStatus = dados[r][5].toString();

    if (dbEmail === emailNorm && dbStatus === "ATIVO") {
      if (dbPerfil === perfilPermitido || dbPerfil === "ADMINISTRADOR") {
        return true;
      }
    }
  }
  throw new Error("Nível de permissão insuficiente.");
}

function verificarPlaca(placaInput) {
  try {
    const ss = obterConexaoPlanilha();
    const sheet = ss.getSheetByName("Cartoes_Ativos");
    const dados = sheet.getDataRange().getValues();
    const placaBusca = placaInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (placaBusca.length < 7) {
      return { sucesso: false, status: "DESCONHECIDO", mensagem: "Placa inválida (mínimo 7 caracteres)." };
    }

    for (let r = 1; r < dados.length; r++) {
      const p1 = dados[r][2].toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const p2 = dados[r][3].toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const dbStatus = dados[r][6].toString().trim().toUpperCase();

      if (p1 === placaBusca || p2 === placaBusca) {
        const isLiberado = ["ATIVO", "LIBERADO", "OK"].includes(dbStatus);
        
        return {
          sucesso: true,
          status: isLiberado ? "LIBERADO" : "BLOQUEADO",
          mensagem: isLiberado ? "Acesso Autorizado." : `Bloqueio: Status ${dbStatus}`,
          dados: {
            id: dados[r][0].toString(),
            proprietario: dados[r][1].toString(),
            placa: p1 === placaBusca ? dados[r][2].toString() : dados[r][3].toString(),
            secretaria: dados[r][4].toString(),
            validade: dados[r][5].toString()
          }
        };
      }
    }

    return { sucesso: true, status: "DESCONHECIDO", mensagem: "Veículo não localizado." };
  } catch (error) {
    return { sucesso: false, erro: error.toString() };
  }
}

function registrarMovimentacaoPortaria(placa, tipoMovimento, idCartaoFk, emailOperador) {
  const lock = LockService.getScriptLock();
  try {
    validarNivelAcesso(emailOperador, "OPERADOR_PORTARIA");
    lock.waitLock(10000);
    
    const ss = obterConexaoPlanilha();
    const sheet = ss.getSheetByName("Registro_Acessos");
    const uuid = Utilities.getUuid();
    const dataHora = new Date();

    sheet.appendRow([
      uuid,
      dataHora,
      placa.trim().toUpperCase(),
      tipoMovimento.toUpperCase(), 
      idCartaoFk || "N/A",
      emailOperador.trim().toLowerCase(),
      `Registrado via Web App Móvel.`
    ]);

    return { sucesso: true, mensagem: `Passagem de ${tipoMovimento} registrada!`, dataHora: dataHora.toLocaleString('pt-BR') };
  } catch (error) {
    return { sucesso: false, erro: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

function obterDadosPainelAdmin(emailAdmin) {
  try {
    validarNivelAcesso(emailAdmin, "ADMINISTRADOR");
    
    const ss = obterConexaoPlanilha();
    const uSheet = ss.getSheetByName("Usuarios").getDataRange().getValues();
    const cSheet = ss.getSheetByName("Cartoes_Ativos").getDataRange().getValues();
    const lSheet = ss.getSheetByName("Logs_Sistema").getDataRange().getValues();

    const usuariosPendentes = [];
    for (let r = 1; r < uSheet.length; r++) {
      if (uSheet[r][5].toString() === "PENDENTE") {
        usuariosPendentes.push({ id: uSheet[r][0], nome: uSheet[r][1], email: uSheet[r][2], perfil: uSheet[r][4] });
      }
    }

    const logsRecentes = [];
    const maxLogs = Math.min(lSheet.length, 15);
    for (let r = lSheet.length - 1; r >= lSheet.length - maxLogs && r >= 1; r--) {
      logsRecentes.push({
        data: lSheet[r][0],
        severidade: lSheet[r][1],
        acao: lSheet[r][2],
        usuario: lSheet[r][3],
        detalhes: lSheet[r][4]
      });
    }

    return {
      sucesso: true,
      usuariosPendentes: usuariosPendentes,
      totalCartoes: cSheet.length - 1,
      logs: logsRecentes
    };
  } catch (error) {
    return { sucesso: false, erro: error.toString() };
  }
}

function processarModeracaoUsuario(idUsuario, novoPerfil, acao, emailAdmin) {
  try {
    validarNivelAcesso(emailAdmin, "ADMINISTRADOR");
    const ss = obterConexaoPlanilha();
    const sheet = ss.getSheetByName("Usuarios");
    const dados = sheet.getDataRange().getValues();

    for (let r = 1; r < dados.length; r++) {
      if (dados[r][0].toString() === idUsuario) {
        const linha = r + 1;
        if (acao === "APROVAR") {
          sheet.getRange(linha, 5).setValue(novoPerfil); 
          sheet.getRange(linha, 6).setValue("ATIVO");
          registrarLogAuditoria("INFO", "MODERACAO", emailAdmin, `Aprovado: ${dados[r][2]} como ${novoPerfil}`);
        } else {
          sheet.deleteRow(linha); 
          registrarLogAuditoria("WARNING", "MODERACAO", emailAdmin, `Recusado: ${dados[r][2]}`);
        }
        return { sucesso: true, mensagem: `Ação processada com sucesso!` };
      }
    }
    return { sucesso: false, erro: "Usuário não localizado." };
  } catch (error) {
    return { sucesso: false, erro: error.toString() };
  }
}

function processarEmissaoCartao(cartao, emailAdmin) {
  try {
    validarNivelAcesso(emailAdmin, "ADMINISTRADOR");
    const ss = obterConexaoPlanilha();
    const sheet = ss.getSheetByName("Cartoes_Ativos");
    const uuid = "CARD_" + Utilities.getUuid().substring(0, 8).toUpperCase();

    sheet.appendRow([
      uuid,
      cartao.nomeProprietario.trim().toUpperCase(),
      cartao.placa01.trim().toUpperCase(),
      cartao.placa02.trim().toUpperCase() || "N/A",
      cartao.secretaria.trim().toUpperCase(),
      cartao.validade, 
      "ATIVO",
      new Date()
    ]);

    registrarLogAuditoria("INFO", "EMISSAO_CARD", emailAdmin, `Emitido cartão ${uuid} para ${cartao.nomeProprietario}`);
    return { sucesso: true, mensagem: `Cartão de acesso emitido! ID: ${uuid}` };
  } catch (error) {
    return { sucesso: false, erro: error.toString() };
  }
}

function getActiveUserEmail() {
  return Session.getActiveUser().getEmail() || "operador@ceeac.com";
}

function obterPermissoesAtivas(email) {
  try {
    const ss = obterConexaoPlanilha();
    const sheet = ss.getSheetByName("Usuarios");
    if (!sheet) return { sucesso: false, erro: "Base inativa." };
    
    const dados = sheet.getDataRange().getValues();
    const emailNorm = email.trim().toLowerCase();

    for (let r = 1; r < dados.length; r++) {
      const dbEmail = dados[r][2].toString().trim().toLowerCase();
      const dbPerfil = dados[r][4].toString();
      const dbStatus = dados[r][5].toString();

      if (dbEmail === emailNorm && dbStatus === "ATIVO") {
        const escopos = [];
        if (dbPerfil === "ADMINISTRADOR") {
          escopos.push("ocr:scan", "system:config");
        } else {
          escopos.push("ocr:scan");
        }
        return { sucesso: true, perfil: dbPerfil, escopos: escopos };
      }
    }
    return { sucesso: false, erro: "Acesso pendente." };
  } catch (err) {
    return { sucesso: false, erro: err.toString() };
  }
}

function navegarParaAba(nomeAbaSimplificado) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mapeamento = { "Usuarios": "Usuarios", "Cartoes": "Cartoes_Ativos", "Logs": "Registro_Acessos" };
  const abaFisica = mapeamento[nomeAbaSimplificado] || nomeAbaSimplificado;
  const sheet = ss.getSheetByName(abaFisica);
  if (sheet) ss.setActiveSheet(sheet);
}

function abrirPromptAcessoTemporario() {
  const ui = SpreadsheetApp.getUi();
  const resNome = ui.prompt('🔑 Novo Passe Temporário', 'Nome do Visitante:', ui.ButtonSet.OK_CANCEL);
  if (resNome.getSelectedButton() !== ui.Button.OK) return;
  const nome = resNome.getResponseText().trim().toUpperCase();
  
  const resPlaca = ui.prompt('🔑 Novo Passe Temporário', 'Placa do Veículo:', ui.ButtonSet.OK_CANCEL);
  if (resPlaca.getSelectedButton() !== ui.Button.OK) return;
  const placa = resPlaca.getResponseText().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!nome || placa.length < 7) {
    ui.alert('❌ Erro', 'Inputs inválidos.', ui.ButtonSet.OK);
    return;
  }

  try {
    const ss = obterConexaoPlanilha();
    const sheet = ss.getSheetByName("Cartoes_Ativos");
    const uuid = "TEMP_" + Utilities.getUuid().substring(0, 8).toUpperCase();
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);

    sheet.appendRow([uuid, nome + " (TEMPORÁRIO)", placa, "N/A", "VISITANTE", amanha.toLocaleDateString('pt-BR'), "ATIVO", new Date()]);
    ui.alert('✅ Sucesso', `Acesso gerado: ${nome}.\nValidade: 24h.`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ Erro', e.toString(), ui.ButtonSet.OK);
  }
}

function revogarAcessoTemporarioExec() {
  const ss = obterConexaoPlanilha();
  const sheet = ss.getSheetByName("Cartoes_Ativos");
  const ui = SpreadsheetApp.getUi();
  if (!sheet) return;
  
  const dados = sheet.getDataRange().getValues();
  let revogados = 0;
  
  for (let r = dados.length - 1; r >= 1; r--) {
    const idCartao = dados[r][0].toString();
    const nomeProp = dados[r][1].toString();
    if (idCartao.startsWith("TEMP_") || nomeProp.includes("(TEMPORÁRIO)")) {
      sheet.getRange(r + 1, 7).setValue("INATIVO");
      revogados++;
    }
  }
  ui.alert('🚫 Concluído', `Revogados ${revogados} acessos temporários.`, ui.ButtonSet.OK);
}

function colorirSecretarias(emailOperador) {
  const ss = obterConexaoPlanilha();
  const sheet = ss.getSheetByName("Cartoes_Ativos");
  if (!sheet) return;
  
  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha <= 1) return;
  
  const range = sheet.getRange(2, 1, ultimaLinha - 1, 8);
  const dados = range.getValues();
  const paletaBackgrounds = [];
  
  const cores = {
    "SEINFRA": "#e0f2fe", "SAUDE": "#f0fdf4", "EDUCACAO": "#fef9c3",
    "ESPORTES": "#f3e8ff", "VISITANTE": "#f1f5f9", "TEMPORÁRIO": "#fee2e2"
  };
  
  for (let i = 0; i < dados.length; i++) {
    const proprietario = dados[i][1].toString().toUpperCase();
    const secretaria = dados[i][4].toString().toUpperCase();
    let cor = "#ffffff";
    
    for (const [key, hex] of Object.entries(cores)) {
      if (secretaria.includes(key) || proprietario.includes(key)) {
        cor = hex;
        break;
      }
    }
    paletaBackgrounds.push(Array(8).fill(cor));
  }
  range.setBackgrounds(paletaBackgrounds);
}

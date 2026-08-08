/**
 * ============================================================================
 * SISTEMA INTEGRADO CEEAC - PORTAL & PORTARIA V10.0 (MOBILE-FIRST)
 * Arquivo: Code.gs | Roteamento Avançado e Renderização de UI
 * ============================================================================
 */

const SPREADSHEET_ID_CEEAC = "1ibZ43sYryxg7PqV2mCKsdE1e26aX4KLWXBh2QLTxe1o";

/**
 * ROTEADOR CENTRAL (doGet)
 * Serve as páginas web formatadas para Mobile ou processa requisições HTTP/Webhooks
 */
function doGet(e) {
  inicializarBancoDeDados();
  
  var params = (e && e.parameter) ? e.parameter : {};
  
  // ROTA TRANSACIONAL API (Webhooks / AppSheet / Integrações)
  if (params.placa || params.nome_funcionario || params.action === 'salvar') {
    return executarGravacaoSegura(params);
  }
  
  // ROTA DE RENDERIZAÇÃO DE PÁGINAS (Web App)
  var page = params.page ? params.page.toLowerCase() : 'login';
  
  switch (page) {
    case 'portaria':
      return renderizarLayout('PortariaUI', 'Portaria SECEL');
      
    case 'admin':
      return renderizarLayout('AdminUI', 'Painel Admin CEEAC');
      
    case 'scanner':
    case 'index':
      return renderizarLayout('Index', 'Scanner de Placas');
      
    case 'cartaoui':
    case 'portal':
      return renderizarLayout('CartaoUI', 'Portal de Cartões');
      
    case 'login':
    default:
      return renderizarLayout('LoginUI', 'Acesso - CEEAC');
  }
}

/**
 * MOTOR DE PERSISTÊNCIA ISOLADO (Ativos Antigos)
 */
function executarGravacaoSegura(params) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 10 segundos contra Race Conditions
    
    var cod             = (params.cod || "").toString().trim();
    var nomeFuncionario = (params.nome_funcionario || "").toString().trim();
    var modelo01        = (params.modelo_01 || "").toString().trim();
    var placa           = (params.placa || "").toString().trim().toUpperCase();
    var modelo          = (params.modelo || "").toString().trim();
    var placa2          = (params.placa2 || "").toString().trim().toUpperCase();
    var periodo         = (params.periodo || "").toString().trim();
    var secretaria      = (params.secretaria || "").toString().trim();
    var status          = (params.status || "ATIVO").toString().trim().toUpperCase();

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID_CEEAC);
    var sheet = ss.getSheetByName("Ativos Antigos");
    
    if (!sheet) throw new Error("Aba 'Ativos Antigos' não localizada.");

    var uuid = Utilities.getUuid();
    var payload = [uuid, cod, nomeFuncionario, modelo01, placa, modelo, placa2, periodo, secretaria, status];

    sheet.appendRow(payload);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Ativo gravado com sucesso!",
      id_gerado: uuid
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function salvarViaWebHTML(dadosFormulario) {
  var responseJsonString = executarGravacaoSegura(dadosFormulario).getContent();
  return JSON.parse(responseJsonString);
}

/**
 * Força a injeção correta da tag Viewport Mobile-First
 */
function renderizarLayout(templateName, title) {
  const template = HtmlService.createTemplateFromFile(templateName);
  template.webAppUrl = ScriptApp.getService().getUrl();
  
  return template.evaluate()
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================================
// UPLOAD DE IMAGENS PARA O GOOGLE DRIVE
// ============================================================================
const ID_PASTA_IMAGENS = "1l6a9njLB7g9t7IlpuM_uFk_-xPHO2SUR";

function salvarImagemNoDrive(base64Data, nomeArquivo) {
  try {
    const pasta = DriveApp.getFolderById(ID_PASTA_IMAGENS);

    // Separa o cabeçalho do base64 (ex: "data:image/jpeg;base64,...")
    const base64Limpo = base64Data.split(',')[1];
    const tipoMime = base64Data.split(';')[0].split(':')[1];

    const blob = Utilities.newBlob(Utilities.base64Decode(base64Limpo), tipoMime, nomeArquivo);
    const arquivo = pasta.createFile(blob);

    registrarLogAuditoria("INFO", "UPLOAD_IMAGEM", "SYSTEM", `Imagem salva: ${nomeArquivo}`);

    return { sucesso: true, url: arquivo.getUrl(), id: arquivo.getId() };
  } catch (erro) {
    registrarLogAuditoria("ERROR", "UPLOAD_FALHA", "SYSTEM", erro.toString());
    return { sucesso: false, erro: erro.toString() };
  }
}

/**
 * Menus superiores para uso interno na planilha Desktop
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('🏟️ Sistema CEEAC')
      .addItem('📱 Abrir Painel Lateral (Sidebar)', 'abrirSidebar')
      .addItem('🚪 Abrir Portaria (Pop-up)', 'abrirPortariaPopUp')
      .addItem('⚙️ Abrir Painel Admin (Pop-up)', 'abrirMenuAdminPopUp')
      .addSeparator()
      .addItem('🎨 Padronizar Formatação das Abas', 'inicializarBancoDeDados')
      .addToUi();
  } catch (error) {
    console.error("Falha onOpen: " + error.toString());
  }
}

function abrirSidebar() {
  const html = renderizarLayout('SidebarUI', 'CEEAC CONTROL');
  SpreadsheetApp.getUi().showSidebar(html);
}

function abrirPortariaPopUp() {
  const html = renderizarLayout('PortariaUI', 'Portaria SECEL');
  html.setWidth(1000).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'Terminal de Portaria');
}

function abrirMenuAdminPopUp() {
  const html = renderizarLayout('AdminUI', 'Painel Administrativo');
  html.setWidth(1200).setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, 'Painel Administrativo CEEAC');
}

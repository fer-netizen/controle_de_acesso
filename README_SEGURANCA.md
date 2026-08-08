# Guia de Segurança — Sistema CEEAC

Este documento descreve as práticas de segurança obrigatórias para operar e manter o sistema CEEAC de forma segura.

---

## 1. Configuração de Propriedades de Script (Segredos)

**Nunca** insira credenciais, IDs de planilhas ou salts diretamente no código-fonte. Todo valor sensível deve ser armazenado como **Propriedade de Script** do Google Apps Script.

### Como configurar

1. No editor do Apps Script, acesse **Configurações do projeto** (ícone de engrenagem ⚙️).
2. Role até a seção **Propriedades de script**.
3. Adicione cada chave abaixo com o valor correspondente.

### Chaves obrigatórias

| Chave | Descrição |
|---|---|
| `SPREADSHEET_ID` | ID da planilha principal do CEEAC |
| `PASSWORD_SALT` | Salt usado no hash de senhas legadas (ver aviso abaixo) |
| `FOLDER_CRACHAS_ID` | ID da pasta no Drive para armazenamento de crachás |
| `TEMPLATE_CRACHA_ID` | ID do arquivo de template (Slides) para crachás |
| `SCRIPT_ID` | ID do script (quando necessário para integrações) |
| `OAUTH_CLIENT_ID` | Client ID OAuth (quando necessário para integrações externas) |

---

## 2. Por que SHA-256 com salt estático não é adequado para senhas

O sistema atual utiliza SHA-256 combinado a um salt estático para armazenar hashes de senhas. Este método apresenta vulnerabilidades sérias:

- **Velocidade**: SHA-256 é um algoritmo projetado para ser rápido. Isso permite que atacantes testem bilhões de combinações por segundo com hardware comum (GPUs).
- **Salt estático**: Um salt fixo (igual para todos os usuários) permite que um atacante que conheça o salt pré-compute uma tabela de hashes (*rainbow table*) para todas as senhas comuns de uma só vez, comprometendo todos os usuários simultaneamente.
- **Ausência de fator de custo**: Algoritmos modernos como **bcrypt**, **scrypt** e **Argon2** são propositalmente lentos e têm custo configurável, tornando ataques de força bruta inviáveis mesmo com hardware dedicado.

---

## 3. Recomendação: Autenticação Federada

Como o Google Apps Script **não oferece suporte nativo** a bcrypt/Argon2, a arquitetura recomendada é **delegar a autenticação a um serviço externo**:

### Opção A — Google OAuth (recomendada para usuários corporativos)

- Use `Session.getActiveUser().getEmail()` para identificar o usuário autenticado via conta Google.
- Consulte a aba `Usuarios` apenas para verificar o perfil/nível de acesso.
- **Nenhuma senha é armazenada ou comparada localmente.**

### Opção B — Firebase Authentication

- Integre o Firebase Authentication no frontend (HTML/JS das páginas do Web App).
- O backend (Apps Script) valida o token JWT emitido pelo Firebase antes de executar qualquer operação.
- Consulte: [Firebase Authentication Docs](https://firebase.google.com/docs/auth)

---

## 4. Plano de Migração de Senhas Existentes

As senhas armazenadas na aba `Usuarios` com o método SHA-256 + salt estático devem ser substituídas:

1. **Não processe nem exporte** as senhas existentes da planilha.
2. Force um **reset de senha** para todos os usuários na próxima sessão.
3. Migre a autenticação para uma das opções acima antes de criar novas contas.
4. Após a migração, remova a coluna `Senha_Hash` da aba `Usuarios` e apague a propriedade `PASSWORD_SALT`.

---

## 5. Credenciais Comprometidas

Se qualquer credencial (salt, ID de planilha, OAuth client ID) foi exposta em código-fonte público ou em qualquer repositório:

1. **Rotacione imediatamente**: revogue e recrie o OAuth client ID no [Google Cloud Console](https://console.cloud.google.com/).
2. Altere o salt via PropertiesService e force reset de senha de todos os usuários.
3. Revise os logs de acesso da planilha para detectar acessos não autorizados.

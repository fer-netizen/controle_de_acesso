# controle_de_acesso

Aplicação containerizável derivada do projeto original em Google Apps Script para controle de acesso CEEAC.

## Executar localmente

```bash
export BOOTSTRAP_ADMIN_EMAIL='admin@secel.online'
export BOOTSTRAP_ADMIN_PASSWORD='defina-uma-senha-inicial-segura'
export PASSWORD_PEPPER='gere-um-pepper-persistente'
export SESSION_SECRET='gere-um-segredo-de-sessao-persistente'
npm install
npm start
```

A aplicação sobe por padrão em `http://localhost:3000`.
Use valores distintos e persistentes para `PASSWORD_PEPPER` e `SESSION_SECRET`; se eles mudarem entre reinícios, logins e sessões anteriores deixam de funcionar.

## Fluxo inicial

1. Acesse `/?page=login`.
2. Faça o primeiro login com o e-mail definido em `BOOTSTRAP_ADMIN_EMAIL` e a senha definida em `BOOTSTRAP_ADMIN_PASSWORD` para bootstrap do administrador.
3. Faça login novamente com as mesmas credenciais.
4. Aprove usuários pendentes e emita cartões pelo painel admin.

## Build Docker

```bash
docker build -t fernandohonoratoo/gate_control:latest .
cat <<'EOF' > .env
BOOTSTRAP_ADMIN_EMAIL=admin@secel.online
BOOTSTRAP_ADMIN_PASSWORD=defina-uma-senha-inicial-segura
PASSWORD_PEPPER=gere-um-pepper-persistente
SESSION_SECRET=gere-um-segredo-de-sessao-persistente
EOF

docker run --rm -p 3000:3000 --env-file .env \
  fernandohonoratoo/gate_control:latest
```

## Push Docker Hub

```bash
docker login
docker push fernandohonoratoo/gate_control:latest
```

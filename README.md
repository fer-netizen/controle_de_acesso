# controle_de_acesso

Aplicação containerizável derivada do projeto original em Google Apps Script para controle de acesso CEEAC.

## Executar localmente

```bash
export PASSWORD_PEPPER='troque-por-um-segredo-forte'
export SESSION_SECRET='troque-por-um-segredo-forte'
npm install
npm start
```

A aplicação sobe por padrão em `http://localhost:3000`.

## Fluxo inicial

1. Acesse `/?page=login`.
2. Faça o primeiro login com `admin@secel.online` e a senha desejada para bootstrap do administrador.
3. Faça login novamente com as mesmas credenciais.
4. Aprove usuários pendentes e emita cartões pelo painel admin.

## Build Docker

```bash
docker build -t fernandohonoratoo/gate_control:latest .
docker run --rm -p 3000:3000 \
  -e PASSWORD_PEPPER='troque-por-um-segredo-forte' \
  -e SESSION_SECRET='troque-por-um-segredo-forte' \
  fernandohonoratoo/gate_control:latest
```

## Push Docker Hub

```bash
docker login
docker push fernandohonoratoo/gate_control:latest
```

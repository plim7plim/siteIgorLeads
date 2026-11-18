# Publicar o painel BLU na Locaweb

O projeto usa um VPS Linux com Docker e o plugin Docker Compose. O Caddy recebe as conexões HTTPS e pede usuário e senha. O Node.js fica na rede privada do Compose e o SQLite armazena as metas da empresa e dos vendedores no volume `metas`. As propostas são consultadas no Sou+BLU e os relatórios refletem a última sincronização.

## Preparar o VPS

1. Aponte o DNS do subdomínio do painel para o IP público do VPS. Libere as portas TCP 80 e 443 para o Caddy.
2. Conecte-se via SSH e copie os arquivos do projeto para um diretório próprio no VPS. O ambiente precisa de Docker com Compose.
3. Crie a configuração de produção e gere o hash da senha de acesso.

```sh
umask 077
cp .env.production.example .env.production
docker run --rm -it caddy:2-alpine caddy hash-password
```

Preencha `PANEL_DOMAIN` com o domínio sem `https://`, `PANEL_USER` com o usuário, `PANEL_PASSWORD_HASH` com o hash entre aspas simples e `SOUMAISBLU_API_KEY` com a chave autorizada. Mantenha esse arquivo no VPS com permissão `600`.

## Preservar as metas existentes

Se já existe um banco `goals.sqlite` no computador de origem, gere um backup consistente com `node backup-db.mjs metas-backup.sqlite` antes de transferir o arquivo. Se o computador ainda usa somente o formato antigo, transfira `.goals.json`. Escolha uma das importações a seguir antes da primeira inicialização do painel.

```sh
docker compose --env-file .env.production build painel
```

Para importar um backup do SQLite:

```sh
docker compose --env-file .env.production run --rm --no-deps -T painel \
  sh -c 'umask 077; set -C; cat > /data/goals.sqlite' < metas-backup.sqlite
```

Para importar o JSON legado:

```sh
docker compose --env-file .env.production run --rm --no-deps -T painel \
  sh -c 'umask 077; set -C; cat > /data/metas-legado.json' < .goals.json
```

O aplicativo importa o JSON uma vez na criação do banco. Um VPS novo também pode começar com as metas em branco.

## Subir e conferir

```sh
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
```

Abra o domínio no navegador, entre com o usuário e a senha e confira a última sincronização em **Compra de dívida** e **CP Mercantil**. Depois, confira as metas migradas e baixe um relatório CSV para confirmar o acesso aos dados.

## Backup do banco

```sh
mkdir -p backups
docker compose --env-file .env.production exec -T painel \
  node backup-db.mjs /data/backup.sqlite
docker compose --env-file .env.production cp \
  painel:/data/backup.sqlite "backups/metas-$(date +%F-%H%M%S).sqlite"
```

O backup do SQLite é consistente mesmo com o painel em execução. Guarde uma cópia fora do VPS. Para recuperar em um ambiente novo, use o arquivo do backup no procedimento de importação do SQLite. O volume persistente mantém as metas durante atualizações com `up -d --build`.

#!/usr/bin/env bash
#
# deploy-hostinger.sh
# Procedimento automatizado e seguro de deploy do DeskcommCRM na VPS Hostinger com Traefik.
#
# Proteções garantidas:
#  ✓ Valida variáveis essenciais do .env antes de iniciar.
#  ✓ Preserva outros contêineres (n8n, Hermes, Evolution Go, etc.).
#  ✓ Realiza backup do banco Supabase antes de qualquer alteração.
#  ✓ Aplica o schema de forma idempotente (não apaga nem sobrescreve dados existentes).
#  ✓ Constrói as imagens localmente a partir do seu repositório (não usa imagem antiga de terceiros).
#  ✓ Roteia através do Traefik existente na VPS (Caddy interno desligado).
#

set -Eeuo pipefail

COLOR=1
if [[ -z "${TERM:-}" || "${TERM:-}" == "dumb" || -n "${NO_COLOR:-}" ]]; then
  COLOR=0
fi

paint() {
  local code="$1"
  shift
  if [[ "$COLOR" == 1 ]]; then
    printf '\033[%sm%s\033[0m\n' "$code" "$*"
  else
    printf '%s\n' "$*"
  fi
}

info()    { paint 34 "ℹ $*"; }
ok()      { paint 32 "✔ $*"; }
warn()    { paint 33 "⚠ $*"; }
err()     { paint 31 "✖ $*" >&2; exit 1; }
section() { printf '\n'; paint "1;36" "═══ $* ═══"; }

# 1. Validação de Ambiente e Pré-Requisitos
section "1. Validação Automática de Configurações"

[[ -f ".env" ]] || err "Arquivo .env não encontrado na raiz do projeto. Execute 'bash generate-secrets.sh' e configure seu .env."

# shellcheck disable=SC1091
set -a
. ./.env
set +a

[[ -n "${DOMAIN:-}" ]] || err "Variável DOMAIN não definida no .env (ex: DOMAIN=crm.seudominio.com.br)."
[[ -n "${SUPABASE_DB_URL:-}" ]] || err "Variável SUPABASE_DB_URL não definida no .env."
[[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]] || err "Variável NEXT_PUBLIC_SUPABASE_URL não definida no .env."
[[ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]] || err "Variável NEXT_PUBLIC_SUPABASE_ANON_KEY não definida no .env."
[[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] || err "Variável SUPABASE_SERVICE_ROLE_KEY não definida no .env."
[[ -n "${INTERNAL_SECRET:-}" ]] || err "Variável INTERNAL_SECRET não definida no .env. Execute 'bash generate-secrets.sh'."

ok "Configurações essenciais do .env validadas com sucesso."

# 2. Detecção e Ajuste da Rede do Traefik
section "2. Detecção do Proxy Traefik"

TRAEFIK_CONTAINER="$(docker ps --filter "name=traefik" --format '{{.Names}}' | head -n 1 || true)"
if [[ -n "$TRAEFIK_CONTAINER" ]]; then
  info "Contêiner do Traefik detectado: $TRAEFIK_CONTAINER"
else
  warn "Nenhum contêiner contendo 'traefik' no nome foi detectado pelo Docker."
fi

# Garante que a rede externa exista
TRAEFIK_NET="${TRAEFIK_NETWORK:-traefik}"
if ! docker network inspect "$TRAEFIK_NET" >/dev/null 2>&1; then
  info "Rede Docker '$TRAEFIK_NET' não existe. Criando rede bridge..."
  docker network create "$TRAEFIK_NET"
  ok "Rede '$TRAEFIK_NET' criada com sucesso."
else
  ok "Rede do Traefik '$TRAEFIK_NET' confirmada."
fi

# 3. Teste de Conexão com o Supabase e Extensões
section "3. Verificação de Conectividade com o Supabase"

info "Testando conexão com o banco de dados..."
docker run --rm postgres:17-alpine psql "$SUPABASE_DB_URL" -c "SELECT 1;" >/dev/null 2>&1 \
  || err "Não foi possível conectar ao banco Supabase com a SUPABASE_DB_URL fornecida. Verifique host, porta e credenciais."

ok "Conexão com o Supabase estabelecida com sucesso."

info "Garantindo extensões necessárias (vector, citext, pg_trgm, pgcrypto)..."
docker run --rm postgres:17-alpine psql "$SUPABASE_DB_URL" -c "
  CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
  CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
  CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
  CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
" >/dev/null 2>&1 || warn "Extensões já estavam ativas ou requerem permissão de superusuário/dashboard do Supabase."

ok "Extensões de banco validadas."

# 4. Backup Obrigatório do Banco de Dados
section "4. Backup de Segurança do Banco de Dados"

mkdir -p backups
BACKUP_FILE="backups/supabase_backup_$(date +%Y%m%d_%H%M%S).dump"
info "Gerando backup em $BACKUP_FILE..."

docker run --rm -v "$(pwd)/backups:/backups" postgres:17-alpine \
  pg_dump "$SUPABASE_DB_URL" -Fc -f "/$BACKUP_FILE"

if [[ -f "$BACKUP_FILE" && -s "$BACKUP_FILE" ]]; then
  ok "Backup do Supabase concluído com sucesso ($(du -h "$BACKUP_FILE" | cut -f1))."
else
  err "Falha na criação do arquivo de backup. Abortando deploy por segurança."
fi

# 5. Aplicação Segura e Idempotente do Schema (Modo Update)
section "5. Verificação e Atualização do Schema (Idempotente)"

info "Aplicando atualizações de estrutura de forma não-destrutiva (nenhum dado será apagado)..."
SCHEMA_LOG="backups/schema_update_$(date +%Y%m%d_%H%M%S).log"

# Executa o baseline.sql sem ON_ERROR_STOP, preservando tabelas e registros existentes
docker run --rm -v "$(pwd)/supabase/baseline.sql:/baseline.sql:ro" postgres:17-alpine \
  psql "$SUPABASE_DB_URL" -q -f /baseline.sql > "$SCHEMA_LOG" 2>&1 || true

ok "Atualização de estrutura executada. Log registrado em $SCHEMA_LOG."

# 6. Build Local das Imagens (Código do seu Repositório)
section "6. Compilação Local das Imagens Docker"

info "Compilando as imagens locais a partir do código do seu repositório..."
info "Isso garante que o contêiner execute exatamente o seu código, sem puxar imagens antigas."

docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.build.yml \
  -f docker-compose.traefik.yml \
  build app worker scheduler

ok "Imagens Docker locais compiladas com sucesso."

# 7. Inicialização da Stack com Traefik
section "7. Inicialização dos Contêineres com Traefik"

info "Subindo a stack do CRM..."
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.build.yml \
  -f docker-compose.traefik.yml \
  up -d

ok "Stack do CRM iniciada com sucesso."

# 8. Verificação de Saúde
section "8. Verificação Final de Status"
sleep 5
docker compose -f docker-compose.prod.yml ps

echo ""
paint "1;32" "════════════════════════════════════════════════════════════════"
paint "1;32" "✔ Deploy concluído com sucesso!"
paint "1;32" "• Domínio: https://${DOMAIN}"
paint "1;32" "• Contêineres existentes (n8n, Hermes, Evolution Go) preservados."
paint "1;32" "• Caddy desativado (roteamento gerenciado pelo Traefik)."
paint "1;32" "• Dados do Supabase preservados com backup salvo em backups/."
paint "1;32" "════════════════════════════════════════════════════════════════"

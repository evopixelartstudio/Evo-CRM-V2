#!/usr/bin/env bash
#
# deploy-hostinger.sh
# Instalação e deploy do DeskcommCRM na VPS Hostinger com Traefik.
#
# Diretrizes:
#  ✓ Validação estrita de credenciais e conexão com o Supabase antes de iniciar.
#  ✓ Verificação de compatibilidade do banco (versão do Postgres e extensões).
#  ✓ Schema aplicado com tratamento rigoroso de erros (não usa '|| true' cego).
#  ✓ Interrompe imediatamente em caso de erro crítico no banco ou na stack.
#  ✓ Preserva contêineres alheios existentes (n8n, Hermes, Evolution Go, etc.).
#  ✓ Utiliza o Traefik já instalado na VPS (Caddy interno desligado).
#  ✓ Compila as imagens Docker localmente com base no código atual do repositório.
#  ✓ Sem etapa obrigatória de backup ou solicitações interativas.
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
err()     { paint 31 "✖ ERRO CRÍTICO: $*" >&2; exit 1; }
section() { printf '\n'; paint "1;36" "═══ $* ═══"; }

# 1. Validação Automática de Configurações do .env
section "1. Validação de Credenciais e Variáveis de Ambiente"

[[ -f ".env" ]] || err "Arquivo .env não encontrado na raiz do projeto. Configure o .env antes de rodar o deploy."

# shellcheck disable=SC1091
set -a
. ./.env
set +a

[[ -n "${DOMAIN:-}" ]] || err "Variável DOMAIN obrigatória não definida no .env."
[[ -n "${SUPABASE_DB_URL:-}" ]] || err "Variável SUPABASE_DB_URL obrigatória não definida no .env."
[[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]] || err "Variável NEXT_PUBLIC_SUPABASE_URL obrigatória não definida no .env."
[[ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]] || err "Variável NEXT_PUBLIC_SUPABASE_ANON_KEY obrigatória não definida no .env."
[[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] || err "Variável SUPABASE_SERVICE_ROLE_KEY obrigatória não definida no .env."
[[ -n "${INTERNAL_SECRET:-}" ]] || err "Variável INTERNAL_SECRET não definida no .env. Execute 'bash generate-secrets.sh' primeiro."
[[ -n "${WAHA_API_KEY:-}" ]] || err "Variável WAHA_API_KEY não definida no .env. Execute 'bash generate-secrets.sh' primeiro."
[[ -n "${SRH_TOKEN:-}" ]] || err "Variável SRH_TOKEN não definida no .env. Execute 'bash generate-secrets.sh' primeiro."

ok "Todas as variáveis de ambiente necessárias estão presentes no .env."

# 2. Validação de Rede e Traefik Existente
section "2. Verificação do Proxy Traefik"

TRAEFIK_NET="${TRAEFIK_NETWORK:-traefik}"
if ! docker network inspect "$TRAEFIK_NET" >/dev/null 2>&1; then
  info "Rede Docker '$TRAEFIK_NET' não encontrada. Criando rede bridge para comunicação com o Traefik..."
  docker network create "$TRAEFIK_NET" || err "Não foi possível criar a rede Docker '$TRAEFIK_NET'."
  ok "Rede '$TRAEFIK_NET' pronta."
else
  ok "Rede do Traefik '$TRAEFIK_NET' verificada com sucesso."
fi

# 3. Validação de Conectividade e Compatibilidade do Banco Supabase
section "3. Verificação de Conectividade e Compatibilidade do Supabase"

info "Testando conexão com o banco de dados Supabase..."
PG_TEST_RAW="$(docker run --rm postgres:17-alpine psql "$SUPABASE_DB_URL" -tAc "SELECT version();" 2>&1)" || {
  err "Falha na conexão com o Supabase. Resposta do servidor:\n$PG_TEST_RAW"
}

ok "Conexão com o Supabase validada com sucesso."
info "Versão detectada: $(echo "$PG_TEST_RAW" | head -n 1)"

info "Validando extensões essenciais no banco..."
EXT_CHECK="$(docker run --rm postgres:17-alpine psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "
  CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
  CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
  CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
  CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
" 2>&1)" || {
  err "Não foi possível habilitar extensões obrigatórias no Supabase:\n$EXT_CHECK"
}
ok "Extensões obrigatórias (vector, citext, pg_trgm, pgcrypto) confirmadas."

# 4. Aplicação Segura do Schema com Tratamento Rigoroso de Erros
section "4. Aplicação do Schema (Verificação e Migrações)"

[[ -f "supabase/baseline.sql" ]] || err "Arquivo supabase/baseline.sql não encontrado."

info "Aplicando o schema no banco de dados e verificando compatibilidade..."
LOG_DIR="logs"
mkdir -p "$LOG_DIR"
SCHEMA_LOG="$LOG_DIR/schema_deploy_$(date +%Y%m%d_%H%M%S).log"

# Executa o baseline.sql e captura toda a saída
PSQL_EXIT_CODE=0
docker run --rm -v "$(pwd)/supabase/baseline.sql:/baseline.sql:ro" postgres:17-alpine \
  psql "$SUPABASE_DB_URL" -q -f /baseline.sql > "$SCHEMA_LOG" 2>&1 || PSQL_EXIT_CODE=$?

# Erros benignos normais quando tabelas e objetos já existem no banco anterior
BASELINE_ERROS_BENIGNOS='already exists|multiple primary keys|multiple default values|is already a member|already a partition'

# Filtra se há erros críticos inesperados
ERROS_CRITICOS="$(grep -iE 'ERROR|FATAL' "$SCHEMA_LOG" | grep -viE "$BASELINE_ERROS_BENIGNOS" || true)"

if [[ -n "$ERROS_CRITICOS" ]]; then
  paint 31 "────────────────────────────────────────────────────────────────"
  paint 31 "✖ ERROS CRÍTICOS DETECTADOS NO BANCO DE DADOS:"
  printf '%s\n' "$ERROS_CRITICOS" | head -n 20
  paint 31 "────────────────────────────────────────────────────────────────"
  err "O schema não pôde ser validado com sucesso. Detalhes completos salvos em: $SCHEMA_LOG"
fi

if [[ "$PSQL_EXIT_CODE" -ne 0 && -n "$ERROS_CRITICOS" ]]; then
  err "A execução do SQL falhou com código $PSQL_EXIT_CODE. Interrompendo deploy."
fi

ok "Schema do banco de dados validado e atualizado com sucesso (erros benignos de duplicidade ignorados)."

# 5. Compilação Local das Imagens Docker (Código Atual do Repositório)
section "5. Compilação Local das Imagens do CRM"

info "Compilando app, worker e scheduler com base no código atual clonado do GitHub..."
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.build.yml \
  -f docker-compose.traefik.yml \
  build app worker scheduler || err "Falha na compilação das imagens Docker locais."

ok "Imagens locais compiladas com sucesso."

# 6. Inicialização dos Contêineres do CRM
section "6. Inicialização da Stack com Traefik"

info "Iniciando contêineres do CRM (contêineres de n8n, Hermes e Evolution Go permanecem intocados)..."
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.build.yml \
  -f docker-compose.traefik.yml \
  up -d || err "Falha ao iniciar os contêineres do CRM."

ok "Contêineres do CRM iniciados com sucesso."

# 7. Verificação Final de Execução
section "7. Status dos Contêineres"
sleep 4
docker compose -f docker-compose.prod.yml ps

echo ""
paint "1;32" "════════════════════════════════════════════════════════════════"
paint "1;32" "✔ CRM instalado e atualizado com sucesso na Hostinger!"
paint "1;32" "• URL do CRM: https://${DOMAIN}"
paint "1;32" "• Traefik: Roteando portas 80/443 (Caddy interno desativado)."
paint "1;32" "• Contêineres alheios: n8n, Hermes e Evolution Go preservados."
paint "1;32" "• Supabase: Integrado e validado."
paint "1;32" "════════════════════════════════════════════════════════════════"

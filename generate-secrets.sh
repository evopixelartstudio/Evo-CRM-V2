#!/usr/bin/env bash
#
# generate-secrets.sh
# Gera com segurança os segredos criptográficos internos necessários no arquivo .env
# do DeskcommCRM para VPS Hostinger (Ubuntu 24.04).
#
# Diretrizes:
#  ✓ Não substitui variáveis que já estejam preenchidas no .env
#  ✓ Não altera variáveis do Supabase (URL, anon key, service role, db url)
#  ✓ Não exibe nenhum segredo no terminal
#  ✓ Não executa deploy nem altera contêineres Docker
#  ✓ Define permissões restritas (chmod 600) no arquivo .env
#

set -Eeuo pipefail

ENV_FILE=".env"
TEMPLATE_FILE=".env.hostinger.example"

# Cores para saída amigável
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
err()     { paint 31 "✖ $*" >&2; }
section() { printf '\n'; paint "1;36" "═══ $* ═══"; }

# 1. Checagem de dependências
if ! command -v openssl >/dev/null 2>&1; then
  err "O utilitário 'openssl' é obrigatório para gerar números aleatórios criptograficamente seguros."
  exit 1
fi

section "Gerador Seguro de Segredos Internos — DeskcommCRM"

# 2. Verificação / Criação do arquivo .env
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$TEMPLATE_FILE" ]]; then
    info "Arquivo .env não encontrado. Criando cópia inicial a partir de $TEMPLATE_FILE..."
    cp "$TEMPLATE_FILE" "$ENV_FILE"
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    ok "Arquivo .env criado com sucesso."
  elif [[ -f ".env.example" ]]; then
    info "Criando cópia a partir de .env.example..."
    cp ".env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    ok "Arquivo .env criado com sucesso."
  else
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    warn "Arquivo .env em branco inicializado."
  fi
else
  info "Arquivo .env existente detectado. Nenhuma credencial já existente será sobrescrita."
fi

# Função auxiliar para ler o valor de uma chave sem exibir no terminal
get_env_val() {
  local key="$1"
  local raw_line
  raw_line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | command head -n 1 || true)"
  if [[ -z "$raw_line" ]]; then
    printf ''
    return 0
  fi
  local val="${raw_line#*=}"
  # Remove \r (CRLF), espaços e aspas externas simples ou duplas
  val="$(printf '%s' "$val" | tr -d '\r' | sed -e 's/^[[:space:]]*["'"'"']\{0,1\}//' -e 's/["'"'"']\{0,1\}[[:space:]]*$//')"
  printf '%s' "$val"
}

# Função auxiliar para gravar uma chave no .env sem vazar para terminal
set_env_val() {
  local key="$1"
  local val="$2"
  
  if grep -q -E "^#?[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null; then
    awk -v k="$key" -v v="$val" '
      BEGIN { replaced = 0 }
      $0 ~ "^#?[[:space:]]*" k "(=|[[:space:]]*$)" && !replaced {
        print k "=" v
        replaced = 1
        next
      }
      { sub(/\r$/, ""); print }
    ' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# Geradores criptográficos
gen_hex() { openssl rand -hex 32 | tr -d '\r\n'; }
gen_b64() { openssl rand -base64 32 | tr -d '\r\n'; }

# Lista de variáveis a verificar e gerar caso estejam vazias
declare -a SECRETS_TO_CHECK=(
  "INTERNAL_SECRET:hex"
  "INTERNAL_CRON_SECRET:hex"
  "CPF_ENCRYPTION_KEY:b64"
  "AI_CRED_AES_KEY:b64"
  "WAHA_BYO_ENCRYPTION_KEY:b64"
  "IMPERSONATE_COOKIE_SECRET:hex"
  "LGPD_SIGNING_KEY:hex"
  "WAHA_API_KEY:hex"
  "WAHA_HMAC_SECRET:hex"
  "SRH_TOKEN:hex"
  "TENANT_PROVISIONING_SECRET:hex"
  "WACALLS_ADMIN_USER:user"
  "WACALLS_ADMIN_PASSWORD:hex"
  "WACALLS_API_TOKEN:hex"
  "NUVEMSHOP_OAUTH_ENCRYPTION_KEY:hex"
)

GERADOS=0
PRESERVADOS=0

for item in "${SECRETS_TO_CHECK[@]}"; do
  key="${item%%:*}"
  type="${item##*:}"
  
  current_val="$(get_env_val "$key")"
  
  if [[ -n "$current_val" ]]; then
    ok "$key já configurado (preservado)."
    PRESERVADOS=$((PRESERVADOS + 1))
  else
    new_val=""
    if [[ "$type" == "hex" ]]; then
      new_val="$(gen_hex)"
    elif [[ "$type" == "b64" ]]; then
      new_val="$(gen_b64)"
    elif [[ "$type" == "user" ]]; then
      new_val="deskcomm"
    fi
    
    set_env_val "$key" "$new_val"
    ok "$key gerado com segurança."
    GERADOS=$((GERADOS + 1))
  fi
done

# Caso especial 1: UPSTASH_REDIS_REST_TOKEN deve ser idêntico a SRH_TOKEN
srh_val="$(get_env_val "SRH_TOKEN")"
upstash_val="$(get_env_val "UPSTASH_REDIS_REST_TOKEN")"

if [[ -z "$upstash_val" ]]; then
  if [[ -n "$srh_val" ]]; then
    set_env_val "UPSTASH_REDIS_REST_TOKEN" "$srh_val"
    ok "UPSTASH_REDIS_REST_TOKEN sincronizado com SRH_TOKEN."
    GERADOS=$((GERADOS + 1))
  fi
else
  ok "UPSTASH_REDIS_REST_TOKEN já configurado (preservado)."
  PRESERVADOS=$((PRESERVADOS + 1))
fi

# Caso especial 2: WAHA_API_KEY_SHA512 deve ser o hash SHA-512 da WAHA_API_KEY
waha_key="$(get_env_val "WAHA_API_KEY")"
waha_sha="$(get_env_val "WAHA_API_KEY_SHA512")"

if [[ -z "$waha_sha" ]]; then
  if [[ -n "$waha_key" ]]; then
    calc_sha="$(printf '%s' "$waha_key" | openssl dgst -sha512 -hex | awk '{print $NF}' | tr -d '\r\n')"
    set_env_val "WAHA_API_KEY_SHA512" "$calc_sha"
    ok "WAHA_API_KEY_SHA512 gerado a partir de WAHA_API_KEY."
    GERADOS=$((GERADOS + 1))
  fi
else
  ok "WAHA_API_KEY_SHA512 já configurado (preservado)."
  PRESERVADOS=$((PRESERVADOS + 1))
fi

# 3. Ajuste estrito de permissões no arquivo .env
chmod 600 "$ENV_FILE" 2>/dev/null || true

section "Resumo da Operação"
info "Segredos novos gerados : $GERADOS"
info "Credenciais preservadas: $PRESERVADOS"
ok "Permissão do arquivo $ENV_FILE configurada como 600 (somente leitura/escrita pelo proprietário)."
ok "Nenhum segredo foi exibido na tela ou gravado em logs."
ok "Nenhum contêiner ou serviço foi reiniciado."

echo ""
info "Lembre-se de preencher apenas as credenciais externas no seu .env:"
info "  - DOMAIN e ACME_EMAIL"
info "  - NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY"
info "  - SUPABASE_DB_URL (porta 5432 ou 6543 do Session Pooler)"
info "  - Chaves de IA (ANTHROPIC_API_KEY ou OPENROUTER_API_KEY)"


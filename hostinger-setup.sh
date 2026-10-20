#!/usr/bin/env bash
#
# hostinger-setup.sh
# Preparação e diagnóstico para implantação do DeskcommCRM na Hostinger VPS (Ubuntu 24.04).
#
# Diretrizes de segurança atendidas:
#  ✓ Não reinstala Docker se já estiver instalado e funcional.
#  ✓ Não altera o firewall (ufw) automaticamente.
#  ✓ Não remove contêineres, volumes ou redes existentes.
#  ✓ Verifica disponibilidade das portas 80 e 443 e identifica o proxy adequado.
#  ✓ Preserva integralmente o CRM e a integração com Supabase.
#  ✓ Não executa deploy sem autorização explícita do operador.
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

info() { paint 34 "ℹ $*"; }
ok()   { paint 32 "✔ $*"; }
warn() { paint 33 "⚠ $*"; }
err()  { paint 31 "✖ $*" >&2; }
head() { printf '\n'; paint "1;36" "═══ $* ═══"; }

echo ""
paint "1;35" "╔════════════════════════════════════════════════════════════════╗"
paint "1;35" "║       DeskcommCRM — Diagnóstico & Setup Hostinger VPS         ║"
paint "1;35" "║                 Ubuntu 24.04 LTS (Docker)                      ║"
paint "1;35" "╚════════════════════════════════════════════════════════════════╝"

# 1. Verificação do Sistema Operacional
head "1. Verificação do Sistema Operacional"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  info "Sistema detectado: ${PRETTY_NAME:-Linux}"
  if [[ "${ID:-}" == "ubuntu" || "${ID_LIKE:-}" == *ubuntu* || "${ID_LIKE:-}" == *debian* ]]; then
    ok "Distribuição compatível."
  else
    warn "Distribuição diferente de Ubuntu/Debian (${ID:-desconhecida}). O CRM pode rodar via Docker, mas recomenda-se Ubuntu 24.04."
  fi
else
  warn "Não foi possível ler /etc/os-release. Prosseguindo com verificações genéricas de Linux."
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)
    ok "Arquitetura x86_64 (amd64) detectada — 100% suportada pelas imagens de produção."
    ;;
  aarch64|arm64)
    ok "Arquitetura ARM64 detectada — suportada pelas imagens multi-arch de produção."
    ;;
  *)
    err "Arquitetura $ARCH não homologada para as imagens pré-compiladas."
    ;;
esac

# 2. Verificação de Memória RAM e Swap
head "2. Memória RAM e Recursos"
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_MB=$((TOTAL_RAM_KB / 1024))
info "RAM total disponível: ${TOTAL_RAM_MB} MB"

if [[ $TOTAL_RAM_MB -lt 3200 ]]; then
  warn "Menos de 4 GB de RAM detectados (${TOTAL_RAM_MB} MB)."
  warn "O CRM e o WhatsApp (WAHA) operam melhor com pelo menos 4 GB."
  warn "Recomenda-se criar um arquivo Swap de 2 GB a 4 GB para evitar paradas por falta de memória."
else
  ok "Quantidade de memória RAM adequada para produção."
fi

# 3. Verificação do Docker (Sem reinstalação se já estiver ativo)
head "3. Verificação do Docker Engine e Compose"
DOCKER_INSTALADO=0
DOCKER_COMPOSE_OK=0

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1 || (command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1); then
    DOCKER_INSTALADO=1
    ok "Docker já está instalado e o daemon está respondendo normalmente. Nenhuma reinstalação necessária."
    docker --version || true
  else
    warn "Docker está instalado, mas o daemon não respondeu ou requer permissões de sudo."
  fi
fi

if [[ $DOCKER_INSTALADO -eq 1 ]]; then
  if docker compose version >/dev/null 2>&1 || (command -v sudo >/dev/null 2>&1 && sudo docker compose version >/dev/null 2>&1); then
    DOCKER_COMPOSE_OK=1
    ok "Docker Compose v2 detectado e funcional."
  else
    warn "Docker Compose v2 não foi detectado no comando 'docker compose'."
  fi
else
  warn "Docker Engine não foi detectado em execução."
  info "Caso precise instalar o Docker manualmente, o comando oficial recomendado é:"
  info "  curl -fsSL https://get.docker.com | sh"
fi

# 4. Verificação de Conflitos nas Portas 80 e 443
head "4. Verificação de Ocupação das Portas 80 e 443"
PORTA_80_OCUPADA=""
PORTA_443_OCUPADA=""

if command -v ss >/dev/null 2>&1; then
  PORTA_80_OCUPADA=$(ss -tlnp 2>/dev/null | grep -E ':(80)\s' || true)
  PORTA_443_OCUPADA=$(ss -tlnp 2>/dev/null | grep -E ':(443)\s' || true)
elif command -v netstat >/dev/null 2>&1; then
  PORTA_80_OCUPADA=$(netstat -tlnp 2>/dev/null | grep -E ':(80)\s' || true)
  PORTA_443_OCUPADA=$(netstat -tlnp 2>/dev/null | grep -E ':(443)\s' || true)
fi

TRAEFIK_EM_EXECUCAO=0
if command -v docker >/dev/null 2>&1 && docker ps >/dev/null 2>&1; then
  if docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -qi "traefik"; then
    TRAEFIK_EM_EXECUCAO=1
  fi
fi

if [[ -n "$PORTA_80_OCUPADA" || -n "$PORTA_443_OCUPADA" ]]; then
  warn "As portas 80 ou 443 já estão em uso por outro processo:"
  [[ -n "$PORTA_80_OCUPADA" ]] && info "  Porta 80: $PORTA_80_OCUPADA"
  [[ -n "$PORTA_443_OCUPADA" ]] && info "  Porta 443: $PORTA_443_OCUPADA"

  if [[ $TRAEFIK_EM_EXECUCAO -eq 1 ]]; then
    ok "Detectado Traefik em execução (típico de imagens com templates da Hostinger)."
    info "Recomendação para deploy com Traefik:"
    info "  Utilize o override do Traefik sem conflito de portas:"
    info "  docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml up -d"
  else
    warn "Existe um servidor web (ex: Nginx, Apache ou Caddy) ocupando as portas 80/443."
    warn "Antes de subir o Caddy interno do CRM, verifique se deseja utilizar o proxy existente ou desativá-lo."
  fi
else
  ok "Portas 80 e 443 estão LIVRES. O Caddy interno do CRM poderá emitir os certificados SSL diretamente."
fi

# 5. Status do Firewall (Não altera nada automaticamente)
head "5. Diagnóstico de Firewall (Informativo)"
if command -v ufw >/dev/null 2>&1; then
  UFW_STATUS=$(ufw status 2>/dev/null || (command -v sudo >/dev/null 2>&1 && sudo ufw status 2>/dev/null) || echo "indisponível")
  info "Status do UFW:"
  printf '%s\n' "$UFW_STATUS"
  
  if echo "$UFW_STATUS" | grep -qi "active"; then
    info "O firewall está ATIVO. Certifique-se de que as portas necessárias estão liberadas:"
    info "  - Porta 22/tcp  (SSH padrão na Hostinger)"
    info "  - Porta 80/tcp  (HTTP - Let's Encrypt / Redirecionamento)"
    info "  - Porta 443/tcp (HTTPS - Acesso seguro ao CRM)"
    info "Comando manual sugerido (se ainda não liberadas):"
    info "  sudo ufw allow 22,80,443/tcp"
  else
    ok "UFW não está bloqueando conexões no momento. Se for ativá-lo, libere sempre a porta 22 (SSH) antes."
  fi
else
  info "UFW não instalado ou não detectado. Verifique as configurações de firewall no painel da Hostinger (hPanel)."
fi

# 6. Preservação de Dados e Contêineres
head "6. Segurança e Preservação de Dados"
ok "Nenhum contêiner, rede ou volume foi alterado ou excluído."
ok "Integração com Supabase preservada via variáveis de ambiente."

# 7. Próximos Passos (Sem executar deploy antecipado)
head "7. Próximos Passos para o Deploy na Hostinger"
cat << 'EOF'
Para concluir a implantação na VPS da Hostinger quando desejar:

1. Configure as variáveis de ambiente:
   cp .env.hostinger.example .env
   nano .env
   (Insira seu DOMAIN, dados do Supabase e credenciais)

2. Se as portas 80/443 estiverem livres (Caddy padrão):
   docker compose -f docker-compose.prod.yml --env-file .env up -d

3. Se a sua VPS Hostinger já tiver Traefik instalado pelo painel:
   docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d

4. Acompanhe a inicialização dos contêineres:
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml logs -f app
EOF

echo ""
ok "Diagnóstico concluído com sucesso. Nenhum deploy foi disparado."


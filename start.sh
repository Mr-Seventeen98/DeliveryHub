#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/deploy/docker-compose.yml"
ENV_FILE="$ROOT_DIR/.env"

log() {
  printf '\033[1;34m[Delivery Hub]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[Delivery Hub]\033[0m %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "未找到 $1，请先安装后重试。"
}

replace_env_value() {
  local key="$1"
  local value="$2"
  local temporary_file

  temporary_file="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v target_key="$key" -v replacement="$value" '
    BEGIN { FS = OFS = "=" }
    $1 == target_key { $0 = target_key OFS replacement }
    { print }
  ' "$ENV_FILE" > "$temporary_file"
  mv "$temporary_file" "$ENV_FILE"
}

find_free_port() {
  local port="$1"

  while lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
    ((port += 1))
    ((port <= 65535)) || fail "没有可用端口。"
  done

  printf '%s' "$port"
}

wait_for_service() {
  local service="$1"
  local container_id
  local status

  container_id="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$service")"
  [[ -n "$container_id" ]] || fail "$service 容器未成功创建，请查看 Docker 日志。"

  for _ in {1..60}; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    case "$status" in
      healthy | running)
        log "$service 已就绪。"
        return 0
        ;;
      unhealthy | exited | dead)
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=50 "$service"
        fail "$service 启动失败。"
        ;;
    esac
    sleep 1
  done

  fail "等待 $service 就绪超时，请运行 make logs 查看日志。"
}

wait_for_host_url() {
  local label="$1"
  local service_url="$2"

  for _ in {1..60}; do
    if DELIVERY_HUB_WAIT_URL="$service_url" node -e '
      const net = require("node:net");
      const target = new URL(process.env.DELIVERY_HUB_WAIT_URL);
      const defaultPorts = { "postgresql:": 5432, "postgres:": 5432, "redis:": 6379 };
      const port = Number(target.port || defaultPorts[target.protocol]);
      if (!target.hostname || !Number.isInteger(port)) process.exit(1);
      const socket = net.createConnection({ host: target.hostname, port });
      socket.setTimeout(1000);
      socket.once("connect", () => { socket.destroy(); process.exit(0); });
      socket.once("timeout", () => { socket.destroy(); process.exit(1); });
      socket.once("error", () => process.exit(1));
    '; then
      log "$label 已可从宿主机访问。"
      return 0
    fi
    sleep 1
  done

  fail "等待 $label 的宿主机端口就绪超时，请检查 Docker 端口映射。"
}

run_with_retries() {
  local attempts="$1"
  local delay_seconds="$2"
  shift 2

  local attempt
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if "$@"; then
      return 0
    fi
    if ((attempt == attempts)); then
      return 1
    fi
    log "命令执行失败，${delay_seconds} 秒后重试（${attempt}/${attempts}）..."
    sleep "$delay_seconds"
  done
}

cd "$ROOT_DIR"

require_command docker
require_command node
require_command pnpm
require_command lsof
require_command openssl

docker info >/dev/null 2>&1 || fail "Docker 未运行，请先启动 Docker Desktop。"

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
((node_major >= 22)) || fail "需要 Node.js 22 或更高版本，当前版本为 $(node --version)。"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  database_password="$(openssl rand -hex 24)"
  replace_env_value "APP_SECRET_KEY" "$(openssl rand -hex 32)"
  replace_env_value "CREDENTIAL_ENCRYPTION_KEY" "$(openssl rand -base64 32 | tr -d '\n')"
  replace_env_value "POSTGRES_PASSWORD" "$database_password"
  replace_env_value "DATABASE_URL" "postgresql://delivery:${database_password}@localhost:5432/delivery_hub?schema=public"
  replace_env_value "DATABASE_URL_DOCKER" "postgresql://delivery:${database_password}@postgres:5432/delivery_hub?schema=public"
  replace_env_value "INITIAL_ADMIN_PASSWORD" "$(openssl rand -base64 24 | tr -d '\n')"
  chmod 600 "$ENV_FILE"
  log "已根据 .env.example 创建 .env，并生成本地随机密钥和密码。"
fi

# Export the local environment for Prisma seed and all development processes.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

requested_api_port="${API_PORT:-3000}"
requested_web_port="${WEB_PORT:-5173}"
API_PORT="$(find_free_port "$requested_api_port")"
WEB_PORT="$(find_free_port "$requested_web_port")"
export API_PORT WEB_PORT
export API_BASE_URL="http://localhost:$API_PORT"
export VITE_API_BASE_URL="$API_BASE_URL"
export WORKER_API_BASE_URL="$API_BASE_URL"
export WEB_BASE_URL="http://localhost:$WEB_PORT"

if [[ "$API_PORT" != "$requested_api_port" ]]; then
  log "API 端口 ${requested_api_port} 已被占用，自动改用 ${API_PORT}。"
fi
if [[ "$WEB_PORT" != "$requested_web_port" ]]; then
  log "Web 端口 ${requested_web_port} 已被占用，自动改用 ${WEB_PORT}。"
fi

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  log "正在安装项目依赖..."
  pnpm install
fi

log "正在生成 Prisma Client..."
pnpm db:generate

log "正在启动 PostgreSQL 和 Redis..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis
wait_for_service postgres
wait_for_service redis
wait_for_host_url "PostgreSQL" "$DATABASE_URL"
wait_for_host_url "Redis" "$REDIS_URL"

log "正在执行数据库迁移..."
run_with_retries 3 2 pnpm db:deploy

log "正在初始化管理员账号..."
pnpm db:seed

log "启动完成：Web http://localhost:$WEB_PORT | API http://localhost:$API_PORT | Swagger http://localhost:$API_PORT/api/docs"
log "按 Ctrl+C 停止 Web、API 和 Worker；PostgreSQL、Redis 将继续运行。"
exec pnpm dev

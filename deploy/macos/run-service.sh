#!/bin/bash
# DeliveryHub 的 launchd 前台入口。API 根据数据库中显式启用的应用策略调度整套发布，不另开发布守护进程。
# 密钥从权限为 0600 的配置文件加载，避免写入可被系统枚举的 plist 或命令行。
set -euo pipefail
root="$1"
service="$2"
set -a
source "$root/config/runtime.env"
set +a
# macOS 的无登录启动环境可能没有有效 locale；显式使用 C，避免 PostgreSQL 初始化时触发多线程区域设置错误。
export LC_ALL=C LANG=C
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$root/current"

case "$service" in
  postgres)
    exec "$PG_BIN/postgres" -D "$root/data/postgres" -p 15432 \
      -h 127.0.0.1 -k "$root/run"
    ;;
  redis)
    exec /opt/homebrew/bin/redis-server "$root/config/redis.conf"
    ;;
  api|worker)
    # launchd 不保证服务启动顺序。等待持久化依赖就绪后再运行应用；依赖失败不删除数据。
    until "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p 15432 && \
      /opt/homebrew/bin/redis-cli -h 127.0.0.1 -p 16379 ping >/dev/null 2>&1; do
      sleep 2
    done
    if [[ "$service" == worker ]]; then
      until /usr/bin/curl -fsS --max-time 3 http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; do
        sleep 2
      done
    fi
    exec /usr/local/bin/node "apps/$service/dist/main.js"
    ;;
  web)
    exec /opt/homebrew/bin/nginx -p "$root/" -c "$root/config/nginx.conf" -g 'daemon off;'
    ;;
  callback)
    # TeamCity 只监听其宿主机回环端口；隧道断开后交给 launchd 重连，不开放公网回调端口。
    exec /usr/bin/ssh -NT -o BatchMode=yes -o StrictHostKeyChecking=yes \
      -o RemoteCommand=none -o ExitOnForwardFailure=yes -o ConnectTimeout=10 \
      -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -R "127.0.0.1:$CALLBACK_REMOTE_PORT:127.0.0.1:3000" "$CALLBACK_SSH_ALIAS"
    ;;
  *)
    echo "Unknown DeliveryHub service: $service" >&2
    exit 64
    ;;
esac

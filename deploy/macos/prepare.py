#!/usr/bin/env python3
"""生成独立的 macOS 服务配置；不导入数据、不切换源码、不注册或重启系统服务。

安装者先恢复检查点并准备 runtime.env，再把生成的 plist 交给 system launchd。
各进程使用指定普通账号运行，因此可在登录前启动，且不会以 root 处理业务请求。
"""
import argparse
from pathlib import Path
import plistlib
import re


def prepare(root: Path, user: str) -> None:
    """只生成目标目录下的配置，数据库与 Redis 的现有数据保持不变。"""
    if not root.is_absolute() or re.search(r"[\s;{}]", str(root)):
        raise ValueError("Service root must be absolute and contain no whitespace or nginx delimiters")
    if not re.fullmatch(r"[a-z_][a-z0-9_-]*", user):
        raise ValueError("Invalid service user")
    for name in ["config", "data/postgres", "data/redis", "run", "logs", "launchd", "backups"]:
        path = root / name
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(0o700)

    # 数据库与队列只绑定回环地址；外部用户统一通过 8080 的静态页面和 API 代理访问。
    (root / "config/redis.conf").write_text(
        f"bind 127.0.0.1\nport 16379\nprotected-mode yes\ndir {root}/data/redis\n"
        "appendonly yes\nappendfsync everysec\ndaemonize no\n"
        "save 900 1\nsave 300 10\n"
    )
    (root / "config/nginx.conf").write_text(f"""# 独立实例，不修改 Homebrew 或其他项目的 Nginx 配置。
worker_processes 1;
pid {root}/run/nginx.pid;
error_log {root}/logs/nginx-error.log warn;
events {{ worker_connections 512; }}
http {{
  include /opt/homebrew/etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log {root}/logs/nginx-access.log;
  client_body_temp_path {root}/run/client-body;
  proxy_temp_path {root}/run/proxy;
  server {{
    listen 8080;
    server_name _;
    root {root}/current/apps/web/dist;
    index index.html;
    location /api/ {{
      proxy_pass http://127.0.0.1:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Request-ID $request_id;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 120s;
    }}
    location / {{ try_files $uri $uri/ /index.html; }}
  }}
}}
""")
    for service in ["postgres", "redis", "api", "worker", "web", "callback"]:
        label = f"com.deliveryhub.{service}"
        config = {
            "Label": label,
            "ProgramArguments": ["/bin/bash", str(root / "current/deploy/macos/run-service.sh"), str(root), service],
            "UserName": user,
            "GroupName": "staff",
            "WorkingDirectory": str(root),
            "EnvironmentVariables": {"HOME": f"/Users/{user}", "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
            "RunAtLoad": True,
            "KeepAlive": True,
            "ThrottleInterval": 10,
            "ExitTimeOut": 30,
            "Umask": 0o077,
            "StandardOutPath": str(root / f"logs/{service}.log"),
            "StandardErrorPath": str(root / f"logs/{service}-error.log"),
        }
        # plist 只包含公开启动参数。凭据留在 runtime.env，由服务入口按普通账号权限读取。
        with (root / f"launchd/{label}.plist").open("wb") as output:
            plistlib.dump(config, output)
    print(f"Prepared 6 DeliveryHub launchd definitions under {root / 'launchd'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--user", required=True)
    arguments = parser.parse_args()
    prepare(arguments.root, arguments.user)

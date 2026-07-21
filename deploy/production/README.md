# DeliveryHub Docker 部署包

目录中需要有以下文件：

```text
docker-compose.yml
.env
delivery-hub-images.tar.gz
```

## 1. 导入镜像

```bash
gzip -dc delivery-hub-images.tar.gz | docker load
```

## 2. 配置环境变量

```bash
cp .env.production.example .env
```

生成随机密钥：

```bash
openssl rand -hex 32     # APP_SECRET_KEY
openssl rand -base64 32  # CREDENTIAL_ENCRYPTION_KEY
openssl rand -hex 24     # PostgreSQL password
openssl rand -base64 24  # INITIAL_ADMIN_PASSWORD
```

将结果分别写入 `.env` 的 `APP_SECRET_KEY` 和
`CREDENTIAL_ENCRYPTION_KEY`，同时修改数据库密码、管理员密码、
`WEB_BASE_URL` 和 `PUBLIC_CALLBACK_BASE_URL`。

`CREDENTIAL_ENCRYPTION_KEY` 一旦开始保存凭据后不能随意更换，必须备份。
应用会拒绝示例文件中的 `CHANGE_ME` 占位值，替换完成后才能启动。

## 3. 启动

```bash
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

访问：

```text
http://服务器IP:8080
```

该端口应只对反向代理或可信网络开放。公网访问必须由反向代理终止 HTTPS，不要直接暴露容器端口。

## 4. 查看日志

```bash
docker compose --env-file .env logs -f --tail=200 api worker web
```

## 5. 停止

```bash
docker compose --env-file .env down
```

不要使用 `down -v`，否则会删除 PostgreSQL 和 Redis 数据卷。

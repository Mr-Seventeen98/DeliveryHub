# Local deployment

1. 复制 `.env.example` 为 `.env`，替换所有密钥和初始管理员密码。
2. 生成 32 字节随机凭证加密密钥，并以 Base64 形式设置 `CREDENTIAL_ENCRYPTION_KEY`。
3. 运行 `make up`。
4. 首次启动后运行 `make db-seed` 创建初始管理员。
5. 访问 `http://localhost:8080`，OpenAPI 位于 `http://localhost:8080/api/docs`。

生产环境必须更换 PostgreSQL 密码、限制数据库和 Redis 网络访问，并通过反向代理启用 HTTPS。

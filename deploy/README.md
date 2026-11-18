# 阿里云部署

站点：`https://aidatamind.cn`，`www` 跳转到主域名。管理员入口为 `/admin`。

服务器 IP 为 `43.108.80.68`。主域名和 `www` 的 A 记录均指向该 IP。以下配置不包含 SSH 密码、OpenAI 密钥或实际管理员初始化令牌。

## 环境配置

模板见 [environment.example](environment.example)。服务器上的 `/etc/gongshi/environment` 使用同样的变量，填入真实密钥后设置权限为 `600`，由 systemd 读取；应用以 `gongshi` 用户运行。真实配置文件不要复制到仓库。

配置中的 `PUBLIC_ORIGIN=https://aidatamind.cn` 用于 Host 和同源校验，并启用 HTTPS Secure Cookie。保持应用监听回环地址，通过 Caddy 提供公网访问；不要将 4173 端口暴露到公网。

## 目录与服务

- `/opt/gongshi/releases/`：程序版本；`/opt/gongshi/current` 指向当前版本。
- `/opt/gongshi/runtime/`：Node.js 24.22.3 官方 musl 版本及 Alpine 3.24 的独立运行库。未替换系统 glibc。
- `/opt/gongshi/bin/node`：启动上述独立运行环境的包装脚本。
- `/etc/gongshi/environment`：后端密钥与环境配置，仅 root 可读。不要上传到 Git。
- `/var/lib/gongshi/reviews.sqlite`：正式 SQLite 数据库，与程序版本分开保存。
- `/var/backups/gongshi/`：每日 SQLite 在线备份，保留 14 天，仅 root 可访问。
- `/etc/caddy/Caddyfile`：域名、HTTPS 和反向代理；Caddy 自动维护证书。
- `/usr/local/bin/caddy`：Caddy 2.11.9，以 `caddy` 用户运行；通过文件能力绑定 80、443 端口。
- `gongshi.service`：普通用户运行的应用进程；`caddy.service`：HTTPS 入口，均配置开机启动。

CentOS 7 已较旧。本次用独立运行库兼容部署，后续维护建议安排迁移至受支持的新系统。不要直接替换系统 libc。运行包与代理更新需由运维定期执行。

## 首次设置

首次部署从空数据库开始，没有导入本地测试账号、评价或汇总。通过 SSH 执行以下命令生成一次性管理员设置链接：

```sh
cd /opt/gongshi/current
sudo -u gongshi env HUPING_DB=/var/lib/gongshi/reviews.sqlite PUBLIC_ORIGIN=https://aidatamind.cn /opt/gongshi/bin/node server.mjs --setup
```

链接有效期 24 小时，只能使用一次；重新生成会替换旧令牌。设置管理员后，通过 `/admin` 创建正式同事账号。

不要把生成的实际链接写入 README、日志示例或 Git 提交。

## 检查与重启

```sh
systemctl status gongshi caddy
journalctl -u gongshi -n 50 --no-pager
journalctl -u caddy -n 50 --no-pager
systemctl restart gongshi
systemctl reload caddy
```

仅公网开放网站的 80、443 和管理用 SSH。应用端口 4173 只监听本机，Caddy 管理接口仅本机可用。

## 更新与回滚

上传新程序到新的 `/opt/gongshi/releases/<version>` 目录，先进行语法检查，再切换 `current` 链接并重启 `gongshi`。只上传程序、网页与场景素材，不上传 `.env`、`.git` 或 `.huping-data`。密钥文件和正式数据库保持原路径。

回滚时将 `current` 指回上一个版本并重启服务。涉及数据库结构变更时，先备份并核对旧版兼容性。

本目录的 `gongshi.service`、`caddy.service` 和 `Caddyfile` 对应服务器使用的配置。修改服务文件后执行 `systemctl daemon-reload` 并重启对应服务；修改 Caddyfile 后先执行 `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`，再 reload。

CentOS 7 的本次部署使用文件能力让普通 `caddy` 用户绑定网站端口。替换 Caddy 二进制后，需要重新执行以下命令，再重启 Caddy：

```sh
setcap cap_net_bind_service=+ep /usr/local/bin/caddy
```

## 备份与恢复

`/etc/cron.daily/gongshi-backup` 使用 SQLite 在线备份，每日生成独立数据库快照。可手动执行该命令并将备份复制到服务器外保存。服务器本机备份不能覆盖整机丢失的情况。

恢复前停止应用，保存当前数据库及 WAL/SHM 文件，再用选定的备份替换正式数据库，设置文件所有者为 `gongshi:gongshi`、权限为 `600`，移走旧 WAL/SHM 后启动服务。

GPT 仅由后端通过 OpenAI 官方 API 调用。修改 `/etc/gongshi/environment` 后需重启应用；日志和 Git 中不要记录密钥。

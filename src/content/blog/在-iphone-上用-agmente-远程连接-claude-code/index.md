---
title: '在 iPhone 上用 Agmente 远程连接 Claude Code'
publishDate: 2026-03-05
description: 'Agmente 是一个 iOS 客户端，可以通过 ACP（Agent Client Protocol）连接到远程编码代理。本文记录如何在 Linux 服务器（WSL2）上配置 Claude Code，让 iPhone 上的 Agmente 随时随地与 Claude Code 对话。'
tags:
  - tech
language: '中文'
---

# 在 iPhone 上用 Agmente 远程连接 Claude Code

Agmente 是一个 iOS 客户端，可以通过 ACP（Agent Client Protocol）连接到远程编码代理。本文记录如何在 Linux 服务器（WSL2）上配置 Claude Code，让 iPhone 上的 Agmente 随时随地与 Claude Code 对话。

## 架构概览

```
iPhone (Agmente App)
    |
    | wss:// (加密 WebSocket)
    |
Cloudflare Tunnel (快速隧道或命名隧道)
    |
    | http://localhost:8765
    |
stdio-to-ws (WebSocket 桥接)
    |
    | stdin/stdout (ACP 协议)
    |
Claude Code ACP 适配器
```

Agmente 通过 WebSocket 与服务器通信。`stdio-to-ws` 负责将 Claude Code 的 ACP stdio 协议桥接为 WebSocket。Cloudflare Tunnel 提供免费的公网 HTTPS 入口，不需要你拥有公网 IP。本文提供两种隧道方案：

- **方案 A：快速隧道** — 零配置，无需域名，但每次启动 URL 会变
- **方案 B：命名隧道** — 需要一个域名，但 URL 固定，一次配置永久使用

## 前置条件

- 一台 Linux 机器（本文以 Arch Linux / WSL2 为例）
- Node.js 18+
- Claude Code CLI 已安装并登录（`claude` 命令可用）
- iPhone 上安装 [Agmente App](https://apps.apple.com/us/app/agmente/id6756249477)
- （方案 B 额外需要）一个域名（任意注册商均可，需将 DNS 托管到 Cloudflare）

## 第一步：安装 cloudflared

Cloudflare Tunnel 客户端，用于将本地端口暴露到公网。

```bash
# Arch Linux
paru -S cloudflared

# Debian/Ubuntu
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared

# macOS
brew install cloudflared
```

## 第二步：启动 Claude Code ACP 桥接

使用 `@rebornix/stdio-to-ws` 将 Claude Code ACP 适配器桥接到 WebSocket：

```bash
env -u CLAUDECODE npx -y @rebornix/stdio-to-ws \
  --persist \
  --grace-period 604800 \
  "npx @zed-industries/claude-code-acp" \
  --port 8765
```

参数说明：

| 参数                    | 作用                                         |
| ----------------------- | -------------------------------------------- |
| `env -u CLAUDECODE`     | 清除环境变量，避免嵌套会话检测冲突           |
| `--persist`             | 保持 Claude Code 进程在 WebSocket 断连后存活 |
| `--grace-period 604800` | 允许 7 天内重新连接而不丢失会话              |
| `--port 8765`           | WebSocket 监听端口                           |

> **踩坑提醒**：如果你在 Claude Code 终端内启动这个命令，子进程会继承 `CLAUDECODE` 环境变量，导致报错 "Claude Code cannot be launched inside another Claude Code session"。务必加上 `env -u CLAUDECODE`。

启动成功后会看到：

```
[stdio-to-ws] WebSocket server listening on port 8765 (persistence enabled, grace period: 604800s)
```

## 第三步：启动 Cloudflare 隧道

### 方案 A：快速隧道（无需域名，URL 每次变化）

最简单的方式，零配置，适合临时使用或试用：

```bash
cloudflared tunnel --url http://localhost:8765
```

输出中会包含一个临时公网 URL：

```
https://xxx-xxx-xxx-xxx.trycloudflare.com
```

记下这个 URL，后面要用。

> 快速隧道的 URL 每次启动都会变，需要重新在 Agmente 中添加 server。如果你希望 URL 固定，请使用方案 B。

### 方案 B：命名隧道（需要域名，URL 固定）

使用命名隧道可以获得固定域名，一次配置永久使用，无需每次重新添加 server。

#### 3B.1 将域名托管到 Cloudflare

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击 "Add a site"，输入你的域名
3. 选择 Free 计划
4. Cloudflare 会给你两个 NS 服务器地址
5. 去域名注册商（如阿里云）将 DNS 服务器改为 Cloudflare 提供的地址
6. 等待域名状态变为 Active

#### 3B.2 登录 cloudflared 并创建隧道

```bash
# 登录（浏览器中选择你的域名授权）
cloudflared tunnel login

# 创建命名隧道
cloudflared tunnel create agmente-claude

# 配置 DNS 路由（将子域名指向隧道）
cloudflared tunnel route dns agmente-claude claude.yourdomain.com
```

#### 3B.3 编写隧道配置文件

```yaml
# ~/.cloudflared/config.yml
tunnel: agmente-claude
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: claude.yourdomain.com
    service: http://localhost:8765
  - service: http_status:404
```

> `<TUNNEL_ID>` 替换为 `cloudflared tunnel create` 输出的隧道 ID。

#### 3B.4 启动隧道

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run
```

现在 `wss://claude.yourdomain.com` 就是你的固定地址，每次启动都不会变。

## 第四步：在 Agmente 中连接

1. 打开 iPhone 上的 Agmente App
2. 点击添加新 Agent
3. URL 填入：
   - 方案 A：`wss://xxx-xxx-xxx-xxx.trycloudflare.com`（替换为你的实际 URL）
   - 方案 B：`wss://claude.yourdomain.com`（替换为你的实际域名）
4. 协议默认为 ACP，无需修改
5. 点击连接

连接成功后，绿灯亮起，创建新 Session 即可开始对话。

## 一键启动脚本

### 方案 A 脚本（快速隧道）

```bash
#!/bin/bash
# ~/bin/agmente-start.sh

# 启动 ACP 桥接
env -u CLAUDECODE npx -y @rebornix/stdio-to-ws \
  --persist --grace-period 604800 \
  "npx @zed-industries/claude-code-acp" \
  --port 8765 &
WS_PID=$!

# 等待 WebSocket 就绪
sleep 3

# 启动 Cloudflare 隧道
cloudflared tunnel --url http://localhost:8765 &
CF_PID=$!

echo "服务已启动 (stdio-to-ws PID: $WS_PID, cloudflared PID: $CF_PID)"
echo "查看 cloudflared 输出获取公网 URL"
echo "按 Ctrl+C 停止所有服务"

trap "kill $WS_PID $CF_PID 2>/dev/null; exit" INT TERM
wait
```

### 方案 B 脚本（命名隧道，固定 URL）

使用命名隧道后，每次启动的 URL 都是固定的，还支持同时启动多个代理：

```bash
#!/bin/bash
# ~/bin/agmente-start.sh
# 用法: agmente-start.sh [claude|codex|both]

MODE=${1:-both}

cleanup() {
    echo ""
    echo "正在停止所有服务..."
    kill $WS_PID $CODEX_PID $CF1_PID $CF2_PID 2>/dev/null
    exit 0
}
trap cleanup INT TERM

if [[ "$MODE" == "claude" || "$MODE" == "both" ]]; then
    echo "启动 Claude Code ACP 桥接 (端口 8765)..."
    env -u CLAUDECODE npx -y @rebornix/stdio-to-ws \
        --persist --grace-period 604800 \
        "npx @zed-industries/claude-code-acp" --port 8765 &
    WS_PID=$!
    sleep 3

    echo "启动 Cloudflare 命名隧道 (Claude Code)..."
    cloudflared tunnel --config ~/.cloudflared/config.yml run &
    CF1_PID=$!
    sleep 3

    echo ""
    echo "=================================="
    echo " Claude Code URL:"
    echo " wss://claude.yourdomain.com"
    echo "=================================="
    echo ""
fi

if [[ "$MODE" == "codex" || "$MODE" == "both" ]]; then
    echo "启动 Codex app-server (端口 9000)..."
    env -u CLAUDECODE codex app-server --listen ws://0.0.0.0:9000 &
    CODEX_PID=$!
    sleep 2

    echo "启动 Cloudflare 命名隧道 (Codex)..."
    cloudflared tunnel --config ~/.cloudflared/config-codex.yml run &
    CF2_PID=$!
    sleep 3

    echo ""
    echo "=================================="
    echo " Codex URL:"
    echo " wss://codex.yourdomain.com"
    echo "=================================="
    echo ""
fi

echo "服务已全部启动，按 Ctrl+C 停止"
wait
```

如果同时运行 Codex，需要额外创建一个隧道和配置文件：

```bash
cloudflared tunnel create agmente-codex
cloudflared tunnel route dns agmente-codex codex.yourdomain.com
```

```yaml
# ~/.cloudflared/config-codex.yml
tunnel: agmente-codex
credentials-file: ~/.cloudflared/<CODEX_TUNNEL_ID>.json

ingress:
  - hostname: codex.yourdomain.com
    service: http://localhost:9000
  - service: http_status:404
```

```bash
chmod +x ~/bin/agmente-start.sh
```

## 停止服务

```bash
pkill -f "stdio-to-ws.*8765"
pkill -f "cloudflared"
```

## 其他代理

同样的方式也可以连接其他 ACP 代理：

```bash
# Gemini CLI
env -u CLAUDECODE npx -y @rebornix/stdio-to-ws --persist --grace-period 604800 \
  "npx @google/gemini-cli --experimental-acp" --port 8765

# Copilot CLI
env -u CLAUDECODE npx -y @rebornix/stdio-to-ws --persist --grace-period 604800 \
  "copilot --acp" --port 8765

# Qwen
env -u CLAUDECODE npx -y @rebornix/stdio-to-ws --persist --grace-period 604800 \
  "qwen --experimental-acp" --port 8765
```

## 原理解析：这和 SSH 有什么不同？

### SSH 的连接方式

```
客户端 ──TCP 连接──> 服务器 22 端口（需要公网 IP）
```

SSH 是客户端**主动连接**服务器。服务器必须有公网 IP（或做端口转发），客户端才能找到它。SSH 协议自带加密，用途包括远程终端、文件传输、端口转发等。

### 我们这个方案的连接方式

```
iPhone (Agmente)
    │
    │ wss:// (WebSocket over HTTPS)
    ▼
Cloudflare CDN 边缘节点
    │
    │ Cloudflare 内部网络 (QUIC)
    ▼
cloudflared (你的机器上，主动向外连接)
    │
    │ http://localhost:8765
    ▼
stdio-to-ws (WebSocket 桥接)
    │
    │ stdin/stdout (JSON-RPC)
    ▼
Claude Code ACP 适配器
```

关键区别在于**连接方向反了**：

- **SSH**：客户端 → 服务器（服务器被动等待连接，需要公网 IP）
- **Cloudflare Tunnel**：服务器 → Cloudflare（服务器主动向外建立隧道，外部请求通过 Cloudflare 转发进来）

这就是为什么它能在 WSL2、NAT 后面、甚至校园网里工作——出站连接几乎不受限制，不需要公网 IP，不需要开放端口。

### 各层协议的作用

| 层                        | 协议                             | 作用                                  |
| ------------------------- | -------------------------------- | ------------------------------------- |
| Agmente ↔ Cloudflare      | **wss://**（WebSocket over TLS） | 加密的双向实时通信                    |
| Cloudflare ↔ cloudflared  | **QUIC**                         | Cloudflare 内部隧道传输，高效穿透 NAT |
| cloudflared ↔ stdio-to-ws | **HTTP → WebSocket**             | 本地端口转发                          |
| stdio-to-ws ↔ Claude Code | **stdin/stdout**                 | ACP 协议，JSON-RPC 格式的消息交换     |

### 类比 SSH 反向隧道

如果用 SSH 术语来理解，Cloudflare Tunnel 最接近 **SSH 反向隧道**（`ssh -R`）：

```bash
# SSH 反向隧道：你的机器主动连到中转服务器，把本地端口暴露出去
ssh -R 8765:localhost:8765 中转服务器
```

Cloudflare Tunnel 本质上就是这个思路，只不过"中转服务器"换成了 Cloudflare 的全球 CDN 网络，自动处理了 TLS 加密、DNS 解析、负载均衡等问题，而且完全免费。

### wss:// vs ws://

类似 HTTPS 和 HTTP 的关系：

- `ws://` — 明文 WebSocket，数据不加密
- `wss://` — WebSocket over TLS，数据加密传输

Cloudflare Tunnel 自动提供 TLS，所以 Agmente 连接时使用的是 `wss://`，通信全程加密。

## 进阶：用自己的服务器替代 Cloudflare Tunnel

如果你有一台公网服务器，可以完全不依赖 Cloudflare，获得固定 URL 和更低延迟。

### 方式 A：直接部署在公网服务器上

把所有服务跑在公网服务器上，用 Caddy 自动签发 TLS 证书：

```
iPhone (Agmente)
    │
    │ wss://agent.yourdomain.com
    ▼
Caddy (自动 TLS)
    │
    │ http://localhost:8765
    ▼
stdio-to-ws → Claude Code ACP
```

**1. 在服务器上启动 ACP 桥接：**

```bash
env -u CLAUDECODE npx -y @rebornix/stdio-to-ws \
  --persist --grace-period 604800 \
  "npx @zed-industries/claude-code-acp" --port 8765
```

**2. 配置 Caddy 反向代理（自动 HTTPS）：**

```
# /etc/caddy/Caddyfile
agent.yourdomain.com {
    reverse_proxy localhost:8765
}
```

```bash
sudo systemctl restart caddy
```

Caddy 会自动申请和续期 Let's Encrypt 证书，Agmente 中填 `wss://agent.yourdomain.com` 即可。

### 方式 B：服务器做跳板，Claude Code 留在本地

如果你需要 Claude Code 访问本地文件和项目，可以用 SSH 反向隧道把本地端口映射到公网服务器：

```
iPhone (Agmente)
    │
    │ wss://agent.yourdomain.com
    ▼
公网服务器 Caddy/Nginx (TLS 终结)
    │
    │ localhost:8765
    ▼
SSH 反向隧道
    │
    ▼
本地机器 stdio-to-ws → Claude Code ACP (localhost:8765)
```

**1. 本地启动 ACP 桥接（同前）：**

```bash
env -u CLAUDECODE npx -y @rebornix/stdio-to-ws \
  --persist --grace-period 604800 \
  "npx @zed-industries/claude-code-acp" --port 8765
```

**2. 本地建立 SSH 反向隧道：**

```bash
ssh -R 8765:localhost:8765 your-server
```

这会把本地的 8765 端口映射到服务器的 8765。

**3. 服务器上配置 Caddy（同方式 A）。**

> 这其实就是 Cloudflare Tunnel 干的事——本质都是"本地机器主动向外建立连接，把本地端口暴露出去"。区别只是中转节点从 Cloudflare CDN 换成了你自己的服务器。

### 方案对比

|                      | Cloudflare 快速隧道 | Cloudflare 命名隧道       | 自有服务器直接部署 | 自有服务器 + SSH 隧道 |
| -------------------- | ------------------- | ------------------------- | ------------------ | --------------------- |
| 需要公网 IP          | 不需要              | 不需要                    | 需要               | 需要（服务器）        |
| 需要域名             | 不需要              | 需要（托管到 Cloudflare） | 需要               | 需要                  |
| URL 固定             | 否（每次变化）      | 是                        | 是                 | 是                    |
| 延迟                 | 较高（经 CDN 中转） | 较高（经 CDN 中转）       | 最低               | 中等                  |
| Claude Code 运行位置 | 本地                | 本地                      | 服务器             | 本地                  |
| 能访问本地文件       | 能                  | 能                        | 不能               | 能                    |
| 配置复杂度           | 最低（零配置）      | 低（一次配置）            | 中等               | 较高                  |

## 常见问题

**Q: 连接后显示 "Internal error"**
A: 检查服务端日志，最常见的原因是 `CLAUDECODE` 环境变量未清除，导致嵌套会话冲突。确保启动命令包含 `env -u CLAUDECODE`。

**Q: 连接后显示 "initialize needed"**
A: 尝试删除 Agmente 中的 Agent 连接，重新添加并创建新 Session。

**Q: 隧道 URL 每次都变怎么办？**
A: 快速隧道（方案 A）的 URL 每次启动都会变。使用命名隧道（方案 B）即可获得固定 URL，只需一个域名（将 DNS 托管到 Cloudflare 免费计划），配置一次后永久生效。

**Q: 想让服务开机自启？**
A: 可以用 systemd service 管理，或者用 tmux/screen 保持后台运行。

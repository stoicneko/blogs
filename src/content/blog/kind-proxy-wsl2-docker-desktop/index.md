---
title: '解决 Kind 在 WSL2 + Docker Desktop 下无法拉取镜像的代理问题'
publishDate: 2026-03-25
description: 'Kind 节点里 localhost 不是你的 localhost。记录在 WSL2 + Docker Desktop 环境中，Kind 容器无法通过代理拉取镜像的排查过程和最终解决方案。'
tags:
  - tech
language: '中文'
---

# 解决 Kind 在 WSL2 + Docker Desktop 下无法拉取镜像的代理问题

在 WSL2 里跑 Kind，结果 Pod 一直 `ImagePullBackOff`。代理明明在 Windows 上跑着，`docker pull` 也能用，Kind 就是拉不到镜像。折腾了好几个小时，记录一下完整的排查过程。

## 环境

- WSL2 (Arch Linux) on Windows
- Docker Desktop (WSL2 backend)
- Kind (Kubernetes in Docker)
- Sparkle（Clash 内核的代理客户端），监听 `7890` 端口

## 症状

创建 Kind 集群后，部署一个简单的 nginx Pod：

```bash
kubectl run nginx --image=nginx
```

Pod 一直卡在 `ImagePullBackOff`。`describe` 看到的错误：

```
Failed to pull image "nginx:latest": ... dial tcp [::1]:7890: connect: connection refused
```

关键信息：**`[::1]:7890`**——Kind 节点在尝试连接 IPv6 的 localhost，但没有任何东西在容器内监听这个地址。

## 排查过程

### 第一个坑：代理只监听 127.0.0.1

在 Windows 上检查代理端口：

```powershell
netstat -ano | findstr 7890
```

一开始看到的是：

```
TCP    127.0.0.1:7890    0.0.0.0:0    LISTENING    40024
```

只监听了 `127.0.0.1`，也就是说只有 Windows 本机能连，WSL2 和 Docker 容器都连不上。

**原因**：Sparkle 有两个"允许局域网"开关——一个在 Sub-Store 面板里（没用），一个在**内核设置**里。需要打开**内核级别**的"允许局域网"选项。

打开后确认：

```powershell
netstat -ano | findstr 7890
# TCP    0.0.0.0:7890    0.0.0.0:0    LISTENING
```

`0.0.0.0` 表示监听所有网络接口，这才对。

### 第二个坑：Kind 节点里的 localhost 不是宿主机

代理开放了局域网访问，但 Kind 节点内的 `HTTP_PROXY=http://localhost:7890` 仍然不工作。

这是因为 Kind 节点本质上是 **Docker 容器**。容器内的 `localhost` 指向的是容器自身的网络命名空间，不是 Windows 宿主机。

需要找到一个从容器内部能到达宿主机的地址。

### 尝试过的地址

| 地址 | 结果 | 原因 |
|------|------|------|
| `localhost:7890` | connection refused | 指向容器自身 |
| `172.22.0.1:7890` (网关 IP) | connection refused | 这是 Docker 虚拟网络的网关，不是 Windows 主机 |
| `host.docker.internal:7890` | 成功 | Docker Desktop 提供的特殊 DNS，解析到宿主机 |

在 Kind 节点里验证：

```bash
docker exec kind-control-plane getent hosts host.docker.internal
# 192.168.65.254  host.docker.internal
```

## 解决方案

两步：

### 1. Sparkle 内核开启"允许局域网"

打开 Sparkle → 内核设置（不是 Sub-Store）→ 允许局域网 → 开启。

确认代理监听在 `0.0.0.0:7890`。

### 2. 创建 Kind 集群时使用 host.docker.internal

Kind 会自动读取宿主机的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 环境变量，并注入到节点中。所以创建集群时，把代理地址指向 `host.docker.internal`：

```bash
HTTP_PROXY=http://host.docker.internal:7890 \
HTTPS_PROXY=http://host.docker.internal:7890 \
NO_PROXY=localhost,127.0.0.1,::1,10.96.0.0/16,10.244.0.0/16,kind-control-plane,.svc,.svc.cluster,.svc.cluster.local \
kind create cluster
```

创建完成后验证：

```bash
docker exec kind-control-plane crictl pull nginx:latest
# Image is up to date for sha256:...
```

### 已有集群怎么办？

如果不想重建集群，可以直接修改运行中的 Kind 节点：

```bash
docker exec kind-control-plane bash -c '
mkdir -p /etc/systemd/system/containerd.service.d
cat > /etc/systemd/system/containerd.service.d/http-proxy.conf <<EOF
[Service]
Environment="HTTP_PROXY=http://host.docker.internal:7890"
Environment="HTTPS_PROXY=http://host.docker.internal:7890"
Environment="NO_PROXY=localhost,127.0.0.1,::1,10.96.0.0/16,10.244.0.0/16,kind-control-plane,.svc,.svc.cluster,.svc.cluster.local"
EOF
systemctl daemon-reload
systemctl restart containerd
'
```

## 另一个坑：kind load docker-image 失败

在排查代理的过程中，我还尝试了先用 Docker 拉镜像再导入 Kind：

```bash
docker pull nginx:latest
kind load docker-image nginx:latest
```

结果报错：

```
ctr: content digest sha256:...: not found
```

这是 Docker Desktop 启用 **containerd image store** 后的已知兼容性问题，`kind load` 和 `docker save` 都会触发。修好代理让 Kind 直接拉镜像，反而是最干净的方案。

## 总结

| 问题 | 根因 | 解决 |
|------|------|------|
| 代理连不上 | Sparkle 只监听 127.0.0.1 | 内核设置开启"允许局域网" |
| Kind 节点连不上代理 | 容器内 localhost ≠ 宿主机 | 使用 `host.docker.internal` |
| kind load 失败 | containerd image store 兼容性 | 让 Kind 节点直接拉镜像 |

核心就一句话：**Kind 节点是 Docker 容器，容器里的 localhost 是它自己，要用 `host.docker.internal` 才能连到 Windows 宿主机上的代理。**

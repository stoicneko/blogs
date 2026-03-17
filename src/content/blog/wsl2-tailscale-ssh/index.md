---
title: '用 Tailscale 从其他设备 SSH 进 WSL2'
publishDate: 2026-03-17
description: '校园网/企业网 AP 隔离导致设备间无法直连，用 Tailscale 建立 P2P 隧道，五分钟解决跨设备 SSH 连接 WSL2 的问题。'
tags:
  - tech
language: '中文'
---

# 用 Tailscale 从其他设备 SSH 进 WSL2

想从手机或另一台电脑 SSH 进自己的 WSL2，折腾了一圈，最后发现根本不是 SSH 配置的问题。

## 问题排查

WSL2 用的是 Mirrored 网络模式，和 Windows 共享同一个 IP（比如 `10.66.180.15`）。SSH 已经跑在端口 3456，Windows 防火墙也开了，但另一台设备死活连不上。

加 `-v` 参数也没走到握手阶段，直接 timeout。于是在另一台设备上 ping：

```
ping 10.66.180.15
```

一直 timeout。再查 ARP 表：

```
arp -n
10.66.180.15    (incomplete)
```

**ARP incomplete**——说明网络层根本没有收到对方的响应，IP 在网络上"不存在"。

这不是 SSH 的锅，也不是 WSL 配置的锅。

## 真正的原因：AP 客户端隔离

学校和公司的 Wi-Fi 普遍开启 **Client Isolation**（客户端隔离），同一个无线网络下的设备之间无法直接通信。路由器可以 ping 通，但设备互相 ping 不通。

端口转发、防火墙规则、WSL 网络配置——全是白费力气。

## 解决方案：Tailscale

Tailscale 通过 DERP 中继或直接 P2P 打洞，绕过 AP 隔离，建立加密隧道。

### 1. WSL2 中安装

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

### 2. 启动并登录

```bash
sudo tailscaled &
sudo tailscale up
```

终端会输出一个授权链接，浏览器打开，用 GitHub/Google 账号登录即可。

### 3. 获取 Tailscale IP

```bash
tailscale ip
# 100.x.x.x
```

### 4. 另一台设备

去 [tailscale.com/download](https://tailscale.com/download) 下载对应平台的客户端，登录同一个账号。

然后就可以连了：

```bash
ssh -p 3456 zhaole_lv@100.x.x.x
```

## 总结

遇到连接问题先在网络层排查，`ping` + `arp` 两条命令就能判断是不是网络隔离。如果 ARP incomplete，再怎么配 SSH 都没用，Tailscale 是最省事的解法。

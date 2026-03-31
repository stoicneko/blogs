---
title: '解决 kind load docker-image 多平台镜像导入失败'
publishDate: 2026-03-31
description: 'kind load docker-image 报 content digest not found？根因是多平台 manifest，不是 containerd image store。用 crane 拉单平台镜像可以彻底解决。'
tags:
  - tech
language: '中文'
---

# 解决 kind load docker-image 多平台镜像导入失败

`kind load docker-image` 导入本地镜像到 Kind 集群时，报了一个莫名其妙的错误：

```
$ kind load docker-image prom/prometheus --name kind
ERROR: failed to load image: command "docker exec --privileged -i kind-control-plane ctr --namespace=k8s.io images import --all-platforms --digests --snapshotter=overlayfs -" failed with error: exit status 1
Command Output: ctr: content digest sha256:ce0e992cc801a3e5a8595e18e5a78748d69794933c529bf4a2dc14d67ac1d85c: not found
```

网上很多文章说这是 Docker Desktop 启用 containerd image store 导致的。**不完全对。** 真正的原因是多平台 manifest。

## 环境

- WSL2 (Arch Linux) + Docker Desktop 29.2.1
- Kind v0.31.0
- 平台：linux/amd64

## 根因分析

先看看 `prom/prometheus` 的 manifest：

```bash
$ docker manifest inspect prom/prometheus:latest
```

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.docker.distribution.manifest.list.v2+json",
  "manifests": [
    {
      "digest": "sha256:82bb24e3...",
      "platform": { "architecture": "amd64", "os": "linux" }
    },
    {
      "digest": "sha256:ce0e992cc801a3e5a8595e18e5a78748d69794933c529bf4a2dc14d67ac1d85c",
      "platform": { "architecture": "arm64", "os": "linux" }
    },
    {
      "digest": "sha256:b355043d...",
      "platform": { "architecture": "arm", "os": "linux", "variant": "v7" }
    },
    {
      "digest": "sha256:dad74217...",
      "platform": { "architecture": "ppc64le", "os": "linux" }
    },
    {
      "digest": "sha256:68b8d469...",
      "platform": { "architecture": "riscv64", "os": "linux" }
    }
  ]
}
```

注意报错里的 `sha256:ce0e992cc801...`——正好是 **arm64** 平台的 digest。

整个链条是这样的：

1. `docker pull prom/prometheus` 只下载当前平台（amd64）的 layers，但本地保留了完整的 manifest list（包含 arm64、armv7、ppc64le、riscv64 的引用）
2. `kind load docker-image` 内部执行 `docker save` 导出镜像，再通过 `docker exec` 管道给 Kind 节点里的 `ctr images import --all-platforms`
3. `ctr` 解析 manifest list，尝试导入所有平台，找 arm64 的 content layer 时发现不存在——报错

**关键**：`docker save` 导出的 tar 里确实只有 amd64 的 layers，但 manifest list 仍然引用了其他平台。`ctr --all-platforms` 不会跳过缺失的平台，而是直接报错。

### 为什么 docker save + kind load image-archive 也不行？

你可能想到了先 `docker save` 再 `kind load image-archive`：

```bash
docker save prom/prometheus -o /tmp/prometheus.tar
kind load image-archive /tmp/prometheus.tar --name kind
```

同样会失败，原因一样——`docker save` 生成的 tar 包含了多平台 manifest list，`kind load image-archive` 内部也是调用 `ctr images import --all-platforms`。

### 为什么 docker pull --platform 也不行？

```bash
docker pull --platform linux/amd64 prom/prometheus
kind load docker-image prom/prometheus --name kind
```

Docker 拉取时虽然只下载了 amd64 的 layers，但本地存储仍然保留了 manifest list 索引。`docker save` 导出时这个索引会被带上，`ctr` 照样尝试解析所有平台。

## 解决方案：crane 拉单平台镜像

[crane](https://github.com/google/go-containerregistry/tree/main/cmd/crane) 是 Google 开源的容器镜像工具，可以精确拉取单平台镜像，生成的 tar 不包含多平台 manifest list。

### 安装 crane

```bash
go install github.com/google/go-containerregistry/cmd/crane@latest
```

### 拉取并导入

```bash
crane pull --platform linux/amd64 prom/prometheus /tmp/prometheus-amd64.tar
kind load image-archive /tmp/prometheus-amd64.tar --name kind
rm /tmp/prometheus-amd64.tar
```

没有报错，导入成功。

### 验证

```bash
$ docker exec kind-control-plane crictl images | grep prometheus
docker.io/prom/prometheus    latest    4a61322ac110    143MB
```

## 对比

| 方法 | 结果 | 原因 |
|------|------|------|
| `kind load docker-image` | 失败 | `docker save` 带多平台 manifest |
| `docker save` + `kind load image-archive` | 失败 | 同上 |
| `docker pull --platform` + `kind load` | 失败 | 本地仍保留 manifest list |
| `crane pull --platform` + `kind load image-archive` | 成功 | 只包含单平台 manifest |

## 写个 helper 函数

如果经常需要导入镜像，可以加到 shell 配置里：

```bash
# ~/.config/fish/functions/kind-load.fish (Fish Shell)
function kind-load
    set -l image $argv[1]
    set -l cluster (test (count $argv) -ge 2; and echo $argv[2]; or echo "kind")
    set -l tmpfile (mktemp /tmp/kind-load-XXXXXX.tar)

    echo "Pulling $image (linux/amd64)..."
    crane pull --platform linux/amd64 $image $tmpfile
    and echo "Loading into kind cluster '$cluster'..."
    and kind load image-archive $tmpfile --name $cluster
    rm -f $tmpfile
end
```

```bash
# ~/.bashrc 或 ~/.zshrc (Bash/Zsh)
kind-load() {
    local image="$1"
    local cluster="${2:-kind}"
    local tmpfile
    tmpfile=$(mktemp /tmp/kind-load-XXXXXX.tar)

    echo "Pulling $image (linux/amd64)..."
    crane pull --platform linux/amd64 "$image" "$tmpfile" \
        && echo "Loading into kind cluster '$cluster'..." \
        && kind load image-archive "$tmpfile" --name "$cluster"
    rm -f "$tmpfile"
}
```

用法：

```bash
kind-load prom/prometheus        # 默认 kind 集群
kind-load nginx my-cluster       # 指定集群名
```

## 这个问题跟操作系统有关吗？

**无关。** macOS、Linux、WSL2 都会遇到。这是 Docker 存储多平台镜像的方式和 Kind 导入逻辑之间的不兼容。macOS 上的 Docker Desktop 行为完全一样。Apple Silicon 的 Mac 甚至更容易触发，因为默认拉 arm64 但 manifest 里还引用了 amd64。

这是 Kind 的已知问题：[kubernetes-sigs/kind#3053](https://github.com/kubernetes-sigs/kind/issues/3053)。

## 总结

`kind load docker-image` 失败的核心原因：**Docker 本地保留了多平台 manifest list，但只有当前平台的 layers。Kind 用 `ctr --all-platforms` 导入时找不到其他平台的 content digest。**

解决方案：用 `crane pull --platform` 拉纯粹的单平台镜像，绕过 Docker 的多平台 manifest。

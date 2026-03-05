---
title: 使用 Astro + Cloudflare Pages 搭建个人博客
publishDate: 2026-03-05 12:00:00
description: '记录从零开始使用 astro-theme-pure 模板搭建个人博客并部署到 Cloudflare Pages 的完整过程，包括踩过的坑和解决方案。'
tags:
  - technology
language: '中文'
---

## 为什么选择 Astro + Cloudflare Pages

选择 [Astro](https://astro.build/) 是因为它专注于内容驱动的网站，构建速度快，默认零 JS 加载。主题选用了 [astro-theme-pure](https://github.com/cworld1/astro-theme-pure)，简洁美观，功能齐全。

部署平台选了 Cloudflare Pages，免费额度够用，全球 CDN 速度快，和 GitHub 集成后 push 即部署，非常方便。

## 搭建过程

### 1. 克隆模板

```bash
git clone https://github.com/cworld1/astro-theme-pure.git blogs
cd blogs
```

模板本身是一个 monorepo 结构，主题核心在 `packages/pure/` 下，站点配置在 `src/site.config.ts`。

### 2. 切换适配器

模板默认使用 Vercel 适配器，需要改为 Cloudflare：

```bash
npm install @astrojs/cloudflare
```

修改 `astro.config.ts`：

```typescript
import cloudflare from '@astrojs/cloudflare'

export default defineConfig({
  adapter: cloudflare({ imageService: 'compile' }),
  output: 'server',
  // ...
})
```

这里有个注意点：Cloudflare 适配器使用 `compile` 模式处理图片，不需要 `sharp`。如果配置里还保留了 `image.service: sharp`，需要删掉，否则会冲突。

### 3. 添加 Wrangler 配置

创建 `wrangler.jsonc`：

```json
{
  "name": "blogs",
  "pages_build_output_dir": "dist",
  "compatibility_date": "2026-03-05",
  "compatibility_flags": ["nodejs_compat"]
}
```

关键字段是 `pages_build_output_dir`，告诉 Cloudflare 构建产物在 `dist` 目录。`nodejs_compat` 是必须的兼容性标志，否则一些 Node.js API 在 Cloudflare Workers 运行时中不可用。

### 4. 依赖问题

模板原本使用 bun 管理依赖，切换到 npm 后可能遇到依赖缺失的问题。我碰到了 `@unocss/astro` 找不到的情况，手动安装解决：

```bash
npm install @unocss/astro
```

### 5. 自定义站点信息

编辑 `src/site.config.ts`，修改标题、作者、描述、社交链接等。同时更新 `astro.config.ts` 中的 `site` 字段为实际域名。

## 踩坑记录

### Worker vs Pages：最大的坑

这是整个过程中最折腾的一个问题。在 Cloudflare Dashboard 创建项目时，我选成了 **Worker** 项目而不是 **Pages** 项目。

这两者的区别：

| | Workers | Pages |
|---|---|---|
| 用途 | API、边缘计算 | 静态站点 + SSR |
| 配置 | `main` + `assets` | `pages_build_output_dir` |
| 部署命令 | `wrangler deploy` | `wrangler pages deploy` |

因为选错了项目类型，构建成功后部署一直失败，报错 `Must specify a project name`。反复修改配置都没用，最后发现根本原因就是项目类型不对。

**解决方案**：删掉 Worker 项目，重新创建 Pages 项目，连接 GitHub 仓库，构建命令填 `npm run build`。

### Node 版本问题

Cloudflare 构建环境默认使用 Node 22，项目依赖也要求 Node >= 20。如果通过 `.node-version` 文件指定了 Node 18，会导致 `oxc-parser` 等包找不到原生绑定而构建失败。

**教训**：不要随意降低 Node 版本，先看看依赖的最低要求。

### image service 冲突

`astro.config.ts` 中同时配置了 `sharp` image service 和 Cloudflare 适配器的 `compile` 模式，需要去掉 `sharp` 的配置：

```typescript
// 删掉这部分
image: {
  service: {
    entrypoint: 'astro/assets/services/sharp'
  }
}

// 只保留
image: {
  responsiveStyles: true
}
```

## 最终项目结构

```
blogs/
├── astro.config.ts          # Astro 配置
├── wrangler.jsonc            # Cloudflare Pages 配置
├── src/
│   ├── site.config.ts        # 站点信息配置
│   ├── content/blog/         # 博客文章
│   └── assets/               # 静态资源
├── packages/pure/            # 主题核心包
└── public/                   # 公共静态文件
```

## 总结

整个搭建过程其实并不复杂，核心步骤就是：克隆模板 → 换适配器 → 加 wrangler 配置 → Cloudflare Pages 连接 GitHub。

最大的坑是在 Cloudflare 上创建了错误的项目类型（Worker 而非 Pages），导致走了很多弯路。记住：**部署静态站点或 SSR 网站用 Pages，部署 API 或边缘函数用 Workers**。

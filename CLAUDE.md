# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```shell
# Start dev server
bun dev

# Full build (runs astro-pure check + astro check + astro build)
bun run build

# Type-check only
bun check

# Format all files
bun format

# Lint + fix
bun lint

# Preview production build
bun preview

# Create a new blog post (interactive)
bun new
# or: bun pure new

# Run all checks + format in one shot
bun yijiansilian

# Cache friend-link avatars into public/avatars/
bun cache:avatars

# Clean build artifacts
bun clean
```

## Architecture Overview

This is a **monorepo** with two distinct parts:

### 1. `packages/pure/` — the reusable Astro theme package (`astro-pure`)
- Published to npm as `astro-pure@1.4.0`
- Provides the Astro integration (`AstroPureIntegration`), all shared components, plugins, schemas, types, and utilities
- Components are split into four categories: `basic/` (Header, Footer), `user/` (Aside, Tabs, Steps…), `pages/` (PostPreview, TOC, Hero…), `advanced/` (GithubCard, LinkPreview, QRCode…)
- Rehype/remark plugins live in `packages/pure/plugins/`
- Config is injected at build time via a virtual module (`virtual-user-config.ts`)

### 2. Root — the actual blog site
- **`src/site.config.ts`** — single source of truth for all site customization (title, author, nav menu, footer, integrations). Edit this file to change site identity and behavior.
- **`astro.config.ts`** — Astro config; uses `@astrojs/cloudflare` adapter (SSR, `output: 'server'`), KaTeX math, custom Shiki transformers, and Fontshare fonts.
- **`src/content.config.ts`** — defines two Astro content collections: `blog` and `docs`, with Zod schemas for frontmatter validation.
- **`src/content/blog/`** — blog posts as `.md`/`.mdx` files (each post typically in its own subdirectory with an `index.md`).
- **`src/content/docs/`** — documentation pages.
- **`src/pages/`** — file-based routing: `blog/`, `docs/`, `about/`, `projects/`, `links/`, `tags/`, `archives/`, `search/`, `terms/`.
- **`src/plugins/`** — site-specific Shiki transformers (copy button, collapse, diff notation) and rehype autolink headings.
- **`uno.config.ts`** — UnoCSS configuration (used for all styling; no Tailwind).
- **`public/links.json`** — friend links data.
- **`preset/`** — optional preset resources (extra icons, experimental signature component, avatar-caching script).

## Key Conventions

- **Styling**: UnoCSS only — no plain CSS or Tailwind classes. Typography uses the `prose` class via `@unocss/preset-typography`.
- **Deployment target**: Cloudflare Pages (SSR via `@astrojs/cloudflare`). The site URL is `https://blogs-6hn.pages.dev`.
- **Formatting**: Prettier with `prettier-plugin-astro`. No semicolons, single quotes, 100-char print width. Import order is enforced by `@ianvs/prettier-plugin-sort-imports`.
- **Blog post frontmatter** (required: `title`, `description`, `publishDate`; optional: `updatedDate`, `heroImage`, `tags`, `draft`, `comment`).
- **Docs frontmatter** (required: `title`, `description`; optional: `publishDate`, `updatedDate`, `tags`, `draft`, `order`).
- To add a new page to the nav, edit `header.menu` in `src/site.config.ts`.
- KaTeX math is supported in markdown via `remark-math` + `rehype-katex`.
- Comments are powered by Waline; configured under `integ.waline` in `src/site.config.ts`.
- Full-site search uses Pagefind (requires `prerender: true`).

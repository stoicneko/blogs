import { createInterface } from 'node:readline'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

const rl = createInterface({ input: process.stdin, output: process.stdout })

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve))
}

function toSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function main() {
  const title = await ask('标题 (max 60 chars): ')
  if (!title) {
    console.error('标题不能为空')
    process.exit(1)
  }
  if (title.length > 60) {
    console.error(`标题过长 (${title.length}/60)`)
    process.exit(1)
  }

  const description = await ask('描述 (max 160 chars): ')
  if (description.length > 160) {
    console.error(`描述过长 (${description.length}/160)`)
    process.exit(1)
  }

  const tagsInput = await ask('标签 (逗号分隔, 如: astro,blog): ')
  const tags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const language = (await ask('语言 (默认: 中文): ')) || '中文'

  let slug = await ask(`Slug (默认: ${toSlug(title)}): `)
  if (!slug) slug = toSlug(title)

  rl.close()

  const dir = join('src', 'content', 'blog', slug)

  try {
    await access(dir)
    console.error(`目录已存在: ${dir}`)
    process.exit(1)
  } catch {
    // directory doesn't exist, good
  }

  const today = new Date().toISOString().split('T')[0]
  const tagsYaml = tags.length
    ? '\ntags:\n' + tags.map((t) => `  - ${t}`).join('\n')
    : '\ntags: []'

  const content = `---
title: '${title}'
publishDate: ${today}
description: '${description}'${tagsYaml}
language: '${language}'
---
`

  await mkdir(dir, { recursive: true })
  const filePath = join(dir, 'index.md')
  await writeFile(filePath, content, 'utf-8')
  console.log(`\n✅ 文章已创建: ${filePath}`)
}

main()

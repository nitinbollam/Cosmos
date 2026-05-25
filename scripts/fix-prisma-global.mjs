#!/usr/bin/env node
/**
 * Ensures every DB-backed service has @Global() PrismaModule wired in app.module.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'services')

const prismaModuleSrc = `import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
`

for (const svc of fs.readdirSync(root)) {
  const dir = path.join(root, svc)
  const prismaService = path.join(dir, 'src', 'prisma', 'prisma.service.ts')
  const appModule = path.join(dir, 'src', 'app.module.ts')
  if (!fs.existsSync(prismaService) || !fs.existsSync(appModule)) continue

  const prismaModule = path.join(dir, 'src', 'prisma', 'prisma.module.ts')
  if (!fs.existsSync(prismaModule)) {
    fs.writeFileSync(prismaModule, prismaModuleSrc)
    console.log(`[prisma] created ${svc}/prisma.module.ts`)
  }

  let src = fs.readFileSync(appModule, 'utf8')

  if (src.includes("from './prisma/prisma.service'")) {
    src = src.replace(
      /import \{ PrismaService \} from '\.\/prisma\/prisma\.service'\n/,
      "import { PrismaModule } from './prisma/prisma.module'\n",
    )
    src = src.replace(/\n\s*PrismaService,\n/, '\n')
    src = src.replace(/\n\s*exports: \[PrismaService\],\n/, '\n')
  }

  if (!src.includes("from './prisma/prisma.module'")) {
    console.log(`[prisma] skip ${svc} (no PrismaModule import)`)
    continue
  }

  if (!/imports:\s*\[[\s\S]*?\bPrismaModule\b/.test(src)) {
    if (/imports:\s*\[\s*\n/.test(src)) {
      src = src.replace(/(imports:\s*\[\s*\n)(\s*)/, '$1$2PrismaModule,\n$2')
    } else {
      src = src.replace(/imports:\s*\[\s*/, 'imports: [PrismaModule, ')
    }
    console.log(`[prisma] added PrismaModule to imports in ${svc}`)
  } else {
    console.log(`[prisma] skip ${svc} (PrismaModule already in imports)`)
    continue
  }

  fs.writeFileSync(appModule, src)
}

console.log('PrismaModule global wiring complete.')

/** Feature modules need PrismaModule in imports even when AppModule uses @Global() PrismaModule (Nest dev/watch quirk). */
for (const svc of fs.readdirSync(root)) {
  const srcDir = path.join(root, svc, 'src')
  const prismaModule = path.join(srcDir, 'prisma', 'prisma.module.ts')
  if (!fs.existsSync(prismaModule)) continue

  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.name.endsWith('.module.ts') && ent.name !== 'prisma.module.ts' && ent.name !== 'app.module.ts') {
        wireFeatureModule(full, svc)
      }
    }
  }
  walk(srcDir)
}

function wireFeatureModule(file, svc) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes('@Module')) return
  const dir = path.dirname(file)
  const usesPrisma = fs.readdirSync(dir).some(
    (f) => f.endsWith('.ts') && fs.readFileSync(path.join(dir, f), 'utf8').includes('PrismaService'),
  )
  if (!usesPrisma) return
  if (/imports:\s*\[[\s\S]*?\bPrismaModule\b/.test(src)) return

  const prismaImport = "import { PrismaModule } from '../prisma/prisma.module'\n"
  const depth = path.relative(path.join(root, svc, 'src'), dir).split(path.sep).length
  const rel = `${'../'.repeat(depth)}prisma/prisma.module`
  const importLine = `import { PrismaModule } from '${rel}'\n`

  if (!src.includes("from '../prisma/prisma.module'") && !src.includes('prisma/prisma.module')) {
    src = src.replace(/(@Module\(\{)/, `${importLine}$1`)
  }

  if (/imports:\s*\[\s*\n/.test(src)) {
    src = src.replace(/(imports:\s*\[\s*\n)(\s*)/, '$1$2PrismaModule,\n$2')
  } else if (/imports:\s*\[/.test(src)) {
    src = src.replace(/imports:\s*\[\s*/, 'imports: [PrismaModule, ')
  } else if (/@Module\(\{\s*controllers:/.test(src)) {
    src = src.replace(/@Module\(\{\s*controllers:/, '@Module({ imports: [PrismaModule], controllers:')
  } else if (/@Module\(\{\s*providers:/.test(src)) {
    src = src.replace(/@Module\(\{\s*providers:/, '@Module({ imports: [PrismaModule], providers:')
  } else {
    src = src.replace(/@Module\(\{\s*\n/, '@Module({\n  imports: [PrismaModule],\n')
  }

  fs.writeFileSync(file, src)
  console.log(`[prisma] feature module wired: ${path.relative(root, file)}`)
}

console.log('Feature module Prisma wiring complete.')

#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'services')

for (const svc of fs.readdirSync(root)) {
  const dir = path.join(root, svc)
  const nestCli = path.join(dir, 'nest-cli.json')
  if (!fs.existsSync(nestCli)) continue

  const config = {
    $schema: 'https://json.schemastore.org/nest-cli',
    collection: '@nestjs/schematics',
    sourceRoot: 'src',
    compilerOptions: {
      deleteOutDir: true,
      tsConfigPath: 'tsconfig.build.json',
    },
  }

  const schema = path.join(dir, 'src', 'prisma', 'schema.prisma')
  if (fs.existsSync(schema)) {
    config.compilerOptions.assets = [{ include: 'generated/**/*', watchAssets: true }]
  }

  fs.writeFileSync(nestCli, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`fixed ${svc}`)
}

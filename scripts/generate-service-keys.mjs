import { generateKeyPairSync } from 'crypto'
import { writeFileSync, existsSync } from 'fs'

if (existsSync('.service-jwt-private.pem')) {
  console.log('Keys already exist. Delete .service-jwt-private.pem to regenerate.')
  process.exit(0)
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
})

writeFileSync('.service-jwt-private.pem', privateKey, { mode: 0o600 })
writeFileSync('.service-jwt-public.pem', publicKey)
console.log('Generated .service-jwt-private.pem and .service-jwt-public.pem')
console.log('Base64 private:', Buffer.from(privateKey).toString('base64').substring(0, 40) + '...')
console.log('Add both to .gitignore and load via env or AWS Secrets Manager.')

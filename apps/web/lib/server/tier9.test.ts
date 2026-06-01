import assert from 'node:assert/strict'
import test from 'node:test'
import { persistMsaFile, readMsaFile } from './msa-storage'

test('persistMsaFile writes and readMsaFile reads back', async () => {
  const rel = `test/${Date.now()}/sample.txt`
  const content = 'HDR|TEST|20260101|MULTICAT|1.0\n'
  await persistMsaFile(rel, content)
  assert.equal(readMsaFile(rel), content)
})

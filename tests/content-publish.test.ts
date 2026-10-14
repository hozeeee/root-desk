import { execFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanupFixture, fixture, project, setupFixture } from './service-test-fixture'
vi.mock('electron', async () => (await import('./service-test-fixture')).electronMock)
import { manifestSchema, verifyManifest } from '../src/main/security/content-validation'
const run = promisify(execFile)
beforeEach(setupFixture)
afterEach(cleanupFixture)
it('generates and signs a canonical Ed25519 manifest with exact bytes and no overwrites', async () => {
  const unsigned = join(fixture.root, 'unsigned.json')
  const signed = join(fixture.root, 'rootdesk-manifest.json')
  const keyFile = join(fixture.root, 'private.pem')
  const keys = generateKeyPairSync('ed25519')
  await writeFile(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  const generator = join(project, 'scripts/generate-content-manifest.mjs')
  const signer = join(project, 'scripts/sign-content-manifest.mjs')
  await run(process.execPath, ['--experimental-strip-types', generator, 'owner/repo', '1.0.0', join(fixture.root, 'resources/seed-content'), unsigned])
  await run(process.execPath, [signer, unsigned, keyFile, signed])
  const manifest = manifestSchema.parse(JSON.parse(await readFile(signed, 'utf8')))
  expect(() => verifyManifest(manifest, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString())).not.toThrow()
  expect(manifest.files.map((file) => file.name)).toEqual(['catalog.json', 'tools.json'])
  expect(manifest.files[0].bytes).toBe((await readFile(join(fixture.root, 'resources/seed-content/catalog.json'))).length)
  await expect(run(process.execPath, [signer, unsigned, keyFile, signed])).rejects.toThrow()
  expect(() => verifyManifest(manifest, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString())).not.toThrow()
})

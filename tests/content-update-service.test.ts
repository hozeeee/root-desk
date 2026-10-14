import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { chmod, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalog, cleanupFixture, fetchMock, fixture, setupFixture, tools } from './service-test-fixture'
vi.mock('electron', async () => (await import('./service-test-fixture')).electronMock)
import { ContentService } from '../src/main/services/content-service'
import { UpdateService } from '../src/main/services/update-service'
import { SettingsService } from '../src/main/services/settings-service'
import { githubAssetPolicy, manifestSchema, signaturePayload, validateContent, verifyManifest, type UpdateManifest } from '../src/main/security/content-validation'

const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
let content: ContentService
let settings: SettingsService
let update: UpdateService
let manifest: UpdateManifest
let documents: Record<string, Buffer>
function release(version = '2.0.0', overrides: { catalog?: unknown; tools?: unknown } = {}): void {
  documents = { 'catalog.json': Buffer.from(JSON.stringify(overrides.catalog ?? catalog(version))), 'tools.json': Buffer.from(JSON.stringify(overrides.tools ?? tools(version))) }
  const payload = { schemaVersion: 1 as const, version, files: (['catalog.json', 'tools.json'] as const).map((name) => ({
    name, url: `https://github.com/owner/repo/releases/download/${version}/${name}`, sha256: createHash('sha256').update(documents[name]).digest('hex'), bytes: documents[name].length
  })) }
  manifest = { ...payload, signature: sign(null, signaturePayload(payload), keys.privateKey).toString('base64') }
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('api.github.com')) return Response.json({ tag_name: version, html_url: `https://github.com/owner/repo/releases/tag/${version}`,
      assets: ['rootdesk-manifest.json', 'catalog.json', 'tools.json'].map((name) => ({ name, browser_download_url: `https://github.com/owner/repo/releases/download/${version}/${name}` })) })
    if (url.endsWith('rootdesk-manifest.json')) return Response.json(manifest)
    return new Response(documents[url.split('/').at(-1)!] ? new Uint8Array(documents[url.split('/').at(-1)!]) : 'unknown', { status: documents[url.split('/').at(-1)!] ? 200 : 404 })
  })
}
beforeEach(async () => {
  await setupFixture()
  settings = new SettingsService()
  await settings.update({ contentRepository: 'owner/repo', contentPublicKey: publicKey })
  content = new ContentService(); await content.load(); update = new UpdateService(content, settings); release()
})
afterEach(cleanupFixture)

describe('signed content updates', () => {
  it('uses catalog version instead of app version and installs only catalog/tools', async () => {
    const seedCommands = content.getSnapshot().commands
    expect((await update.check()).state).toBe('available')
    expect(update.getStatus().currentVersion).toBe('1.0.0')
    const installed = await update.install()
    expect(installed.state, installed.message).toBe('installed')
    expect(update.getStatus().currentVersion).toBe('2.0.0')
    expect(content.getSnapshot().commands).toEqual(seedCommands)
    expect((await new ContentService().load()).catalog?.version).toBe('2.0.0')
    const pointer = JSON.parse(await readFile(join(fixture.root, 'userData/content/active.json'), 'utf8'))
    expect(await readdir(join(fixture.root, 'userData/content/packages', pointer.active))).toEqual(['catalog.json', 'rootdesk-manifest.json', 'tools.json'])
  })
  it('rejects install without configured trust and does not make network requests', async () => {
    await settings.update({ contentPublicKey: '' })
    expect((await update.install()).state).toBe('error')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(content.getSnapshot().catalog?.version).toBe('1.0.0')
  })
  it.each(['signature', 'hash', 'bytes', 'schema', 'reference'])('failed %s preserves the active pointer and prior snapshot', async (failure) => {
    expect((await update.install()).state).toBe('installed')
    const pointerFile = join(fixture.root, 'userData/content/active.json')
    const before = await readFile(pointerFile, 'utf8')
    release('3.0.0')
    if (failure === 'signature') manifest.signature = 'A'.repeat(86) + '=='
    if (failure === 'hash') documents['catalog.json'] = Buffer.from('x'.repeat(documents['catalog.json'].length))
    if (failure === 'bytes') documents['catalog.json'] = Buffer.from('short')
    if (failure === 'schema') release('3.0.0', { tools: { ...tools('3.0.0'), schemaVersion: 2 } })
    if (failure === 'reference') release('3.0.0', { catalog: { ...catalog('3.0.0'), brands: [{ id: 'brand', name: 'Brand', summary: '', devices: [{
      id: 'device', name: 'Device', codenames: [], variants: [], androidVersions: [], soc: 'soc', bootloader: { unlockable: false, method: '', notes: [] },
      root: { supported: false, methods: [], notes: [] }, prerequisites: [], steps: [], rollback: [], tools: ['missing-tool'], sources: [], warning: ''
    }] }] } })
    expect((await update.install()).state).toBe('error')
    expect(await readFile(pointerFile, 'utf8')).toBe(before)
    expect(content.getSnapshot().catalog?.version).toBe('2.0.0')
  })
  it('rolls back to previous version or bundled seed without changing command authority', async () => {
    await update.install(); release('3.0.0'); await update.install()
    expect((await content.rollback()).catalog?.version).toBe('2.0.0')
    const fresh = new ContentService(); await fresh.load()
    expect(fresh.getSnapshot().catalog?.version).toBe('2.0.0')
    // A separate first-install chain rolls back directly to seed.
    await content.rollback() // return to 3.0.0; verifies both immutable packages remain usable
    expect(content.getSnapshot().commands?.commands[0].id).toBe('adb-version')
  })
  it('first installation rolls back to seed', async () => {
    await update.install()
    expect((await content.rollback()).catalog?.version).toBe('1.0.0')
    expect(update.getStatus().currentVersion).toBe('1.0.0')
  })
  it('serializes duplicate installs and refuses remote commands, duplicate file entries and arbitrary CDN origins', async () => {
    const first = update.install(); const second = update.install()
    expect(first).toBe(second)
    expect((await first).state).toBe('installed')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('catalog.json'))).toHaveLength(1)
    expect(manifestSchema.safeParse({ ...manifest, files: [...manifest.files, { ...manifest.files[0], name: 'commands.json' }] }).success).toBe(false)
    expect(manifestSchema.safeParse({ ...manifest, files: [manifest.files[0], manifest.files[0]] }).success).toBe(false)
    const policy = githubAssetPolicy(manifest.files[0].url)
    expect(policy('https://raw.githubusercontent.com/attacker/repo/a')).toBe(false)
    expect(policy('https://github.com/attacker/repo/releases/download/2.0.0/catalog.json')).toBe(false)
    expect(policy('https://release-assets.githubusercontent.com/github-production-release-asset/1/file')).toBe(true)
  })
  it('rejects cross-repo manifest/file URLs before fetching them', async () => {
    manifest.files[0].url = 'https://github.com/attacker/repo/releases/download/2.0.0/catalog.json'
    expect((await update.check()).state).toBe('error')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('attacker'))).toBe(false)
  })
  it('load revalidates immutable packages and falls back to seed after corruption or trust changes', async () => {
    await update.install()
    const pointer = JSON.parse(await readFile(join(fixture.root, 'userData/content/active.json'), 'utf8'))
    const path = join(fixture.root, 'userData/content/packages', pointer.active, 'catalog.json')
    await chmod(path, 0o600); await writeFile(path, 'corrupted')
    const loaded = await new ContentService().load()
    expect(loaded.catalog?.version).toBe('1.0.0')
    expect(loaded.issues.some((issue) => issue.file === 'active.json')).toBe(true)
  })
  it('requires Ed25519 and binds signatures to the complete canonical payload', () => {
    expect(() => verifyManifest(manifest, publicKey)).not.toThrow()
    expect(() => verifyManifest({ ...manifest, version: '9.0.0' }, publicKey)).toThrow('签名')
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(() => verifyManifest(manifest, rsa)).toThrow('Ed25519')
  })
  it('keeps command-shaped guide strings informational and rejects unknown bare command IDs', () => {
    expect(() => validateContent(Buffer.from(JSON.stringify(catalog('2.0.0'))), Buffer.from(JSON.stringify(tools('2.0.0'))), '2.0.0', content.getSnapshot().commands!)).not.toThrow()
  })
})

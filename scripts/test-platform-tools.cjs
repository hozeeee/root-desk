const { app, session } = require('electron')
const { mkdir } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')

// Runs version checks only: no devices, flashing, adb server startup or application settings changes.
const root = resolve(__dirname, '..')
const sandbox = join(root, 'tests', '.platform-tools-smoke')
async function run() {
  await mkdir(sandbox, { recursive: true })
  app.setPath('userData', sandbox)
  app.setPath('temp', sandbox)
  await app.whenReady()
  await session.defaultSession.setProxy({ mode: 'system' })
  const bundle = await build({
    stdin: { contents: "export { PlatformToolsService } from './src/main/services/platform-tools-service'; export { SettingsService } from './src/main/services/settings-service'", resolveDir: root, loader: 'ts' },
    absWorkingDir: root, tsconfig: join(root, 'tsconfig.json'), platform: 'node', format: 'cjs', bundle: true,
    external: ['electron'], write: false, logLevel: 'silent'
  })
  const compiled = new Module(join(root, 'scripts', '.platform-tools-bundle.cjs'), module)
  compiled.filename = compiled.id
  compiled.paths = Module._nodeModulePaths(join(root, 'scripts'))
  compiled._compile(bundle.outputFiles[0].text, compiled.filename)
  const { SettingsService, PlatformToolsService } = compiled.exports
  const settings = new SettingsService()
  await settings.load()
  const service = new PlatformToolsService(settings)
  const statuses = process.argv.includes('--install') ? await service.install() : await service.detect()
  console.log(JSON.stringify({ electron: process.versions.electron, installed: process.argv.includes('--install'), statuses }, null, 2))
  app.exit(statuses.every((status) => status.available) ? 0 : 1)
}
run().catch((error) => { console.error(error.message); app.exit(1) })

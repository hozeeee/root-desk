import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { settingsSchema } from '@shared/settings'
import type { AppSettings } from '@shared/contracts'

const defaults: AppSettings = {
  theme: 'dark',
  expertMode: false,
  proxy: { mode: 'system', protocol: 'http', host: '', port: 8080 }
}

export class SettingsService {
  private value: AppSettings = defaults
  private readonly file = join(app.getPath('userData'), 'settings.json')

  async load(): Promise<AppSettings> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      this.value = { ...settingsSchema.parse(parsed), expertMode: false }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('设置文件无效，已使用默认值：', error)
      this.value = structuredClone(defaults)
    }
    return this.get()
  }

  get(): AppSettings {
    return structuredClone(this.value)
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = settingsSchema.parse({
      ...this.value,
      ...patch,
      proxy: { ...this.value.proxy, ...(patch.proxy ?? {}) }
    })
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    const diskValue = { ...next, proxy: { ...next.proxy, hasCredential: undefined } }
    await writeFile(temporary, JSON.stringify(diskValue, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.file)
    this.value = next
    return this.get()
  }
}

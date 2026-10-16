const { app } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = resolve(__dirname, '..')
const data = join(root, '.smoke', 'user-data')
const screenshots = join(root, '.smoke', 'screenshots')
mkdirSync(data, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setAppPath(root)
app.setName('RootDesk')
app.setVersion(require(join(root, 'package.json')).version)
for (const name of ['userData', 'sessionData', 'crashDumps', 'logs']) app.setPath(name, data)
const timer = setTimeout(() => { console.error('Electron smoke test timed out'); app.exit(1) }, 30_000)
const expectedPages = ['总览', '设备指南', '工具目录', 'ADB 工具箱', '下载中心', '设置']

app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-fail-load', (_event, code, message) => { console.error(code, message); app.exit(1) })
  window.webContents.once('did-finish-load', async () => {
    try {
      const preferences = window.webContents.getLastWebPreferences()
      if (!preferences.sandbox || !preferences.contextIsolation || preferences.nodeIntegration) throw new Error('窗口安全配置不符合要求')
      const result = await window.webContents.executeJavaScript(`(async () => {
        const content = await window.rootDesk.getContent()
        const settings = await window.rootDesk.getSettings()
        const update = await window.rootDesk.getUpdateStatus()
        const preview = await window.rootDesk.previewCommand({ commandId: 'adb-reboot-bootloader' })
        const search = await window.rootDesk.searchContent('Pixel')
        await document.fonts.ready
        await new Promise(resolve => setTimeout(resolve, 250))
        return {
          bridge: typeof window.rootDesk === 'object', node: typeof window.require,
          generalInvoke: typeof window.rootDesk.invoke, issues: content.issues,
          brands: content.catalog?.brands.length,
          devices: content.catalog?.brands.reduce((sum, brand) => sum + brand.devices.length, 0),
          tools: content.tools?.tools.length, commands: content.commands?.commands.length,
          toolDetails: content.tools?.tools.every(tool => tool.install.length && tool.usage.length && tool.sources.length),
          theme: settings.theme, expertMode: settings.expertMode, update: update.state,
          rejectsUnboundCommand: !preview.allowed, searchResults: search.length
        }
      })()`)
      if (!result.bridge || result.node !== 'undefined' || result.generalInvoke !== 'undefined' || result.issues.length || result.brands !== 9 || result.devices !== 63 || !result.toolDetails || result.expertMode || !result.rejectsUnboundCommand || !result.searchResults) throw new Error(JSON.stringify(result))
      const pages = []
      for (let index = 0; index < expectedPages.length; index++) {
        const title = await window.webContents.executeJavaScript(`(async () => {
          document.querySelectorAll('.sidebar nav button')[${index}].click()
          await new Promise(resolve => setTimeout(resolve, 200))
          const active = document.querySelector('.sidebar nav button.active strong')?.textContent
          return document.querySelector('h1')?.textContent ? active : null
        })()`)
        if (title !== expectedPages[index]) throw new Error(`页面 ${index}: ${title}`)
        pages.push(title)
        if (index === 1) await window.webContents.executeJavaScript("document.querySelector('.main-content').scrollTop = 0")
        const image = await window.webContents.capturePage()
        writeFileSync(join(screenshots, `${index + 1}.png`), image.toPNG())
      }
      const lightTheme = await window.webContents.executeJavaScript(`(async () => {
        document.querySelector('.theme-options button:nth-child(2)').click()
        await new Promise(resolve => setTimeout(resolve, 50))
        document.querySelector('.page-actions button').click()
        await new Promise(resolve => setTimeout(resolve, 300))
        document.querySelectorAll('.sidebar nav button')[0].click()
        await new Promise(resolve => setTimeout(resolve, 200))
        return document.documentElement.dataset.theme
      })()`)
      if (lightTheme !== 'light') throw new Error('浅色主题未应用')
      writeFileSync(join(screenshots, 'light.png'), (await window.webContents.capturePage()).toPNG())
      await window.webContents.executeJavaScript("window.rootDesk.updateSettings({ theme: 'dark' })")
      console.log('Electron smoke passed:', JSON.stringify({ ...result, pages, screenshots: 7 }))
      clearTimeout(timer)
      app.quit()
    } catch (error) { console.error(error); clearTimeout(timer); app.exit(1) }
  })
})

import(pathToFileURL(join(root, 'out/main/index.js')).href).catch(error => { console.error(error); app.exit(1) })

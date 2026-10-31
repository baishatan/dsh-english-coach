// Throwaway prototype launcher. Opens a local file, not a replacement app server.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const file = new URL('./words-profile.prototype.html', import.meta.url)
const variant = process.argv.find(arg => /^--variant=[ABC]$/.test(arg))?.split('=')[1] ?? 'A'
const page = process.argv.includes('--page=profile') ? 'profile' : 'words'
file.searchParams.set('variant', variant)
file.searchParams.set('page', page)
console.log(`英语教练交互原型（仅示例数据）：\n${file.href}`)
if (!process.argv.includes('--print')) {
  if (process.env.NODE_ENV === 'production') {
    console.error('这是不随插件发布的开发原型，请在本地开发环境打开。')
    process.exitCode = 1
  } else {
    const [command, args] = process.platform === 'darwin'
      ? ['open', [file.href]]
      : process.platform === 'win32'
        ? ['rundll32.exe', ['url.dll,FileProtocolHandler', file.href]]
        : ['xdg-open', [file.href]]
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', error => {
      console.error(`浏览器未自动打开：${error.message}\n请手动打开 ${fileURLToPath(new URL('./words-profile.prototype.html', import.meta.url))}`)
      process.exitCode = 1
    })
    child.on('exit', code => { if (code) process.exitCode = code })
  }
}

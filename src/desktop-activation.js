import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

// Use the running Desktop executable, never a caller-supplied path or shell command.
// Its single-instance handler restores, shows and focuses the existing main window.
export function activateDesktopWindow({ env = process.env, platform = process.platform, launch = spawn, exists = existsSync, timeoutMs = 5000 } = {}) {
  if (env.DSH_PROFILE !== 'desktop' || platform !== 'win32') return Promise.resolve({ ok: true, supported: false })
  const executable = env.DSH_NODE_EXECUTABLE
  if (!executable || !exists(executable)) return Promise.resolve({ ok: false, supported: true, error: 'desktop-executable-unavailable' })
  return new Promise((resolve) => {
    let child
    let timeout
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ supported: true, ...result })
    }
    try {
      const launchEnv = { ...env }
      delete launchEnv.ELECTRON_RUN_AS_NODE
      child = launch(executable, ['dsh://open'], { env: launchEnv, stdio: 'ignore', windowsHide: true, shell: false })
      child.once('error', () => finish({ ok: false, error: 'desktop-launch-failed' }))
      child.once('exit', (code) => finish(code === 0 ? { ok: true } : { ok: false, error: 'desktop-launch-failed' }))
      timeout = setTimeout(() => {
        finish({ ok: false, error: 'desktop-activation-timeout' })
        // Only the short-lived second-instance request is terminated, never the owner.
        child.kill()
      }, timeoutMs)
    } catch {
      finish({ ok: false, error: 'desktop-launch-failed' })
    }
  })
}

// A custom header prevents form-based requests; reject cross-origin browser calls.
export function isDesktopActivationRequest(req) {
  return isNotificationActionRequest(req, 'activate')
}

export function isCardActionRequest(req) {
  return isNotificationActionRequest(req, 'card-action')
}

function isNotificationActionRequest(req, action) {
  const headers = req.headers || {}
  if (headers['x-dsh-task-toast'] !== action) return false
  if (!String(headers['content-type'] || '').toLowerCase().startsWith('application/json')) return false
  const origin = headers.origin
  if (origin === 'dsh-app://app') return true
  if (origin) {
    try {
      const url = new URL(origin)
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === headers.host
    } catch { return false }
  }
  // Desktop verifies dsh-app Origin, then strips Origin and Sec-Fetch-Site
  // before proxying to its loopback Host. Keep the custom action header and
  // require a loopback peer for this native/proxied request shape.
  const address = String(req.socket?.remoteAddress || '').toLowerCase()
  const loopback = address === '::1' || /^(?:::ffff:)?127\./.test(address)
  return headers['sec-fetch-site'] === 'same-origin' || (!headers['sec-fetch-site'] && loopback)
}

import { describe, expect, it } from 'vitest'
import { authGate, COOKIE, createSession, isPublicPath, LOGIN_PATH, readCookie, SESSION_DAYS, validSession } from './auth'
import worker from './index'

const ENV = { SITE_USER: 'freunde', SITE_PASSWORD: 'geheim-und-lang', SESSION_SECRET: 'x'.repeat(40) }
const NOW = Date.UTC(2026, 10, 5)
const req = (path: string, init: RequestInit = {}) => new Request(`https://meteojunkie.com${path}`, init)
const nav = { headers: { 'sec-fetch-mode': 'navigate' } }
const login = (user: string, password: string) =>
  req(LOGIN_PATH, { method: 'POST', body: new URLSearchParams({ user, password }), headers: { 'content-type': 'application/x-www-form-urlencoded' } })

describe('Worker', () => {
  // Die Prüfung muss in `fetch` vor allem anderen stehen. Geprüft wird der Worker selbst:
  // ein falsch eingefügter Aufruf ließ die Tests von authGate grün, und die Seite blieb offen.
  it('fragt bei jedem Pfad und jeder Methode zuerst die Anmeldung', async () => {
    const env = { ...ENV, ASSETS: { fetch: async () => new Response('app') }, DATA: { get: async () => null } }
    const ctx = { waitUntil() {} }
    for (const [p, method] of [['/', 'GET'], ['/nwp/varda/meta.json', 'GET'], ['/nwp/varda/meta.json', 'POST'], ['/sat/x.jpg', 'GET'], ['/foo', 'POST']]) {
      expect((await worker.fetch(req(p, { method }), env as never, ctx as never)).status, `${method} ${p}`).toBe(401)
    }
  })
})

describe('authGate', () => {
  it('sperrt Daten und App ohne Anmeldung', async () => {
    for (const p of ['/', '/nwp/varda/meta.json', '/topo/8/135/90.png', '/sat/geocolour/latest.json', '/sat-tiles/x', '/index.html']) {
      expect((await authGate(req(p), ENV, NOW))?.status, p).toBe(401)
    }
  })

  it('zeigt beim Seitenaufruf die Anmeldung, Datenabrufen aber kein HTML', async () => {
    const page = await authGate(req('/', nav), ENV, NOW)
    expect(page?.headers.get('content-type')).toContain('text/html')
    expect(await page?.text()).toContain('type="password"')
    const data = await authGate(req('/nwp/varda/meta.json'), ENV, NOW)
    expect(data?.headers.get('content-type')).not.toContain('text/html')
  })

  it('lässt Impressum und Programmdateien ohne Anmeldung durch', async () => {
    for (const p of ['/impressum', '/impressum.html', '/assets/index-abc.js']) {
      expect(await authGate(req(p), ENV, NOW), p).toBeNull()
    }
  })

  it('verrät die Daten nicht über einen ähnlichen Pfad', () => {
    for (const p of ['/assets', '/nwp/assets/x', '/impressum/../nwp', '/impressum2', '/topo/assets/x']) {
      expect(isPublicPath(new URL(p, 'https://x').pathname), p).toBe(false)
    }
  })

  it('bleibt zu, wenn ein Secret fehlt, das Impressum aber offen', async () => {
    for (const missing of ['SITE_USER', 'SITE_PASSWORD', 'SESSION_SECRET']) {
      const env = { ...ENV, [missing]: '' }
      expect((await authGate(req('/nwp/x'), env, NOW))?.status, missing).toBe(503)
      expect((await authGate(login('freunde', 'geheim-und-lang'), env, NOW))?.status, missing).toBe(503)
      expect(await authGate(req('/impressum'), env, NOW), missing).toBeNull()
    }
  })

  it('lehnt falsche Angaben ab und setzt dann keinen Cookie', async () => {
    for (const [u, p] of [['freunde', 'falsch'], ['falsch', 'geheim-und-lang'], ['', '']]) {
      const r = await authGate(login(u, p), ENV, NOW)
      expect(r?.status).toBe(401)
      expect(r?.headers.get('set-cookie')).toBeNull()
    }
  })

  it('meldet mit den richtigen Angaben an, und der Cookie öffnet danach die Seite', async () => {
    const r = await authGate(login('freunde', 'geheim-und-lang'), ENV, NOW)
    expect(r?.status).toBe(303)
    const set = r!.headers.get('set-cookie')!
    expect(set).toContain('HttpOnly')
    expect(set).toContain('Secure')
    expect(set).toContain('SameSite=Lax')
    const value = set.slice(set.indexOf('=') + 1, set.indexOf(';'))
    const cookie = { headers: { cookie: `andere=1; ${COOKIE}=${value}` } }
    expect(await authGate(req('/nwp/x', cookie), ENV, NOW)).toBeNull()
  })
})

describe('Sitzung', () => {
  it('läuft nach der Sitzungsdauer ab', async () => {
    const s = await createSession(ENV, NOW)
    expect(await validSession(ENV, s, NOW + (SESSION_DAYS - 1) * 86400e3)).toBe(true)
    expect(await validSession(ENV, s, NOW + (SESSION_DAYS + 1) * 86400e3)).toBe(false)
  })

  it('lässt sich nicht verlängern oder fälschen', async () => {
    const s = await createSession(ENV, NOW)
    const [exp, sig] = s.split('.')
    expect(await validSession(ENV, `${Number(exp) + 86400}.${sig}`, NOW)).toBe(false)
    expect(await validSession(ENV, `${exp}.${'0'.repeat(64)}`, NOW)).toBe(false)
    for (const bad of [undefined, '', 'abc', `${exp}.`, `${exp}.${sig}x`]) expect(await validSession(ENV, bad, NOW)).toBe(false)
  })

  it('wird durch ein neues Passwort ungültig', async () => {
    const s = await createSession(ENV, NOW)
    expect(await validSession({ ...ENV, SITE_PASSWORD: 'neu' }, s, NOW)).toBe(false)
  })
})

describe('readCookie', () => {
  it('findet den Wert zwischen anderen Cookies und nur bei vollem Namen', () => {
    expect(readCookie('a=1; b=2', 'b')).toBe('2')
    expect(readCookie('xb=2', 'b')).toBeUndefined()
    expect(readCookie(null, 'b')).toBeUndefined()
  })
})

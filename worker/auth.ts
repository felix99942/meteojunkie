// Gemeinsamer Login der Seite: ein Benutzername, ein Passwort, für den Freundeskreis.
//
// BEWUSST IM WORKER und nicht clientseitig: die Daten in R2 sollen ohne Anmeldung nicht
// abrufbar sein, und eine Sperre in der App ließe sich durch den direkten Abruf umgehen.
// Das gilt auch für die zweite Adresse unter workers.dev. `run_worker_first` in
// `wrangler.jsonc` ist deshalb Pflicht, sonst liefert Cloudflare die App-Dateien aus,
// ohne dieses Skript zu fragen.
//
// Benutzer, Passwort und der Schlüssel der Sitzung sind Worker-Secrets (`wrangler secret
// put`), sie stehen nicht im Repository. FEHLT EINES, BLEIBT DIE SEITE ZU: ein vergessenes
// Secret darf die Daten nicht öffentlich machen.
//
// Die Sitzung ist ein signierter Cookie ohne Serverzustand: Ablaufzeit + HMAC. In die
// Signatur geht auch die Anmeldung ein, ein neues Passwort meldet also alle ab.
//
// OHNE LOGIN bleiben das Impressum samt Datenschutz (§ 18 MStV: Freundeskreis ist nicht
// „ausschließlich persönlich oder familiär") und unter /assets/ die Programmdateien, die
// das Impressum zum Anzeigen braucht. Letztere enthalten keine Daten; der Quellcode ist
// ohnehin öffentlich.

export interface AuthEnv {
  SITE_USER?: string
  SITE_PASSWORD?: string
  SESSION_SECRET?: string
}

export const COOKIE = '__Host-mj_session'
export const SESSION_DAYS = 30
export const LOGIN_PATH = '/__login'
/** Bremst das Durchprobieren von Passwörtern, ohne dass es jemand beim Vertippen merkt. */
const FAIL_DELAY_MS = 500
const MAX_FIELD = 500

export function isPublicPath(path: string): boolean {
  return path === LOGIN_PATH || path === '/impressum' || path === '/impressum.html' || path.startsWith('/assets/')
}

const enc = new TextEncoder()

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** Ohne frühen Abbruch: die Antwortzeit verrät nicht, wie viele Zeichen stimmen. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

const signature = (env: Required<AuthEnv>, exp: number) =>
  hmac(env.SESSION_SECRET, `${exp}|${env.SITE_USER}|${env.SITE_PASSWORD}`)

function configured(env: AuthEnv): env is Required<AuthEnv> {
  return !!(env.SITE_USER && env.SITE_PASSWORD && env.SESSION_SECRET)
}

export async function checkLogin(env: Required<AuthEnv>, user: string, password: string): Promise<boolean> {
  // Über einen festen Schlüssel vergleichen, damit beide Seiten gleich lang sind
  const [a, b, c, d] = await Promise.all([
    hmac(env.SESSION_SECRET, `u|${user}`),
    hmac(env.SESSION_SECRET, `u|${env.SITE_USER}`),
    hmac(env.SESSION_SECRET, `p|${password}`),
    hmac(env.SESSION_SECRET, `p|${env.SITE_PASSWORD}`),
  ])
  return sameBytes(a, b) && sameBytes(c, d)
}

export async function createSession(env: Required<AuthEnv>, nowMs: number): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + SESSION_DAYS * 86400
  return `${exp}.${toHex(await signature(env, exp))}`
}

export async function validSession(env: Required<AuthEnv>, value: string | undefined, nowMs: number): Promise<boolean> {
  const m = value?.match(/^(\d{1,12})\.([0-9a-f]{64})$/)
  if (!m) return false
  const exp = Number(m[1])
  if (exp * 1000 <= nowMs) return false
  return sameBytes(enc.encode(m[2]), enc.encode(toHex(await signature(env, exp))))
}

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return undefined
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex',
  'x-frame-options': 'DENY',
}

function page(body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>meteojunkie – Anmeldung</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px;background:#111214;color:#e6e8ea;font:15px/1.4 system-ui,sans-serif}
main{width:100%;max-width:340px;background:#1a1c1f;border:1px solid #33363b;border-radius:8px;padding:24px}
h1{margin:0 0 4px;font-size:24px}h1 span{color:#3ecf9a}p{margin:0 0 16px;color:#a3a9b0;font-size:14px}
label{display:block;margin:0 0 12px;font-size:13px;color:#a3a9b0}
input{display:block;width:100%;margin-top:4px;padding:9px 10px;font:inherit;color:inherit;background:#111214;border:1px solid #454a50;border-radius:5px}
input:focus{outline:2px solid #3ecf9a;outline-offset:1px}
button{width:100%;margin-top:4px;padding:10px;font:inherit;font-weight:600;color:#08140f;background:#3ecf9a;border:0;border-radius:5px;cursor:pointer}
.err{color:#ff8a80}a{color:#a3a9b0;font-size:13px}
</style></head><body><main><h1><span>m</span>eteojunkie</h1>${body}</main><a href="/impressum">Impressum und Datenschutz</a></body></html>`,
    { status, headers: PAGE_HEADERS },
  )
}

function loginPage(status: number, failed = false): Response {
  return page(
    `<p${failed ? ' class="err"' : ''}>${failed ? 'Benutzername oder Passwort stimmt nicht.' : 'Zugang nur mit Anmeldung.'}</p>
<form method="post" action="${LOGIN_PATH}"><label>Benutzername<input name="user" autocomplete="username" required autofocus></label><label>Passwort<input name="password" type="password" autocomplete="current-password" required></label><button>Anmelden</button></form>`,
    status,
  )
}

/**
 * Entscheidet über eine Anfrage. `null` heißt: durchlassen, sonst ist es die Antwort.
 * Muss VOR jedem Cache-Zugriff laufen, sonst käme eine zwischengespeicherte Datei ohne
 * Anmeldung heraus.
 */
export async function authGate(req: Request, env: AuthEnv, nowMs = Date.now()): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== LOGIN_PATH && isPublicPath(url.pathname)) return null
  if (!configured(env)) return page('<p class="err">Die Anmeldung ist noch nicht eingerichtet.</p>', 503)

  if (url.pathname === LOGIN_PATH) {
    if (req.method !== 'POST') return loginPage(200)
    const form = await req.formData().catch(() => null)
    const user = String(form?.get('user') ?? '').slice(0, MAX_FIELD)
    const password = String(form?.get('password') ?? '').slice(0, MAX_FIELD)
    if (!(await checkLogin(env, user, password))) {
      await new Promise((r) => setTimeout(r, FAIL_DELAY_MS))
      return loginPage(401, true)
    }
    const session = await createSession(env, nowMs)
    return new Response(null, {
      status: 303,
      headers: {
        location: '/',
        'set-cookie': `${COOKIE}=${session}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
        'cache-control': 'no-store',
      },
    })
  }

  if (await validSession(env, readCookie(req.headers.get('cookie'), COOKIE), nowMs)) return null
  // Datenabrufe der App bekommen keine HTML-Seite, die sie als Bild oder JSON lesen müssten
  const wantsPage = (req.headers.get('sec-fetch-mode') ?? '') === 'navigate' || (req.headers.get('accept') ?? '').includes('text/html')
  return wantsPage ? loginPage(401) : new Response('Anmeldung erforderlich', { status: 401, headers: { 'cache-control': 'no-store' } })
}

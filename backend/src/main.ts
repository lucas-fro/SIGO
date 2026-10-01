import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { AppModule } from './app.module.js'
import { env } from './config/env.js'

// Mensagens padrão do zod em português, para o que o contrato não personalizou.
z.config(z.locales.ptBR())

// Só JSON (e o multipart dos comprovantes, lido pelo multer): o corpo de formulário
// (urlencoded) é o que um site de fora consegue mandar sem CORS.
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })
app.useBodyParser('json', { limit: '1mb' })

const origens = new Set(
  env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
)

app.disable('x-powered-by')
// Atrás do Caddy o IP de quem chama vem no X-Forwarded-For, e é por ele que o
// freio de login conta as tentativas. Só redes privadas são confiáveis aqui.
app.set('trust proxy', 'loopback, linklocal, uniquelocal')

/**
 * Contra requisição forjada (CSRF): o cookie é SameSite=Lax, o que barra outro
 * site, mas não um serviço irmão em *.smartinterno.com. Toda escrita vinda de
 * navegador precisa de uma origem conhecida: a do próprio endereço (front e API
 * no mesmo domínio) ou uma do CORS_ORIGIN. Sem Origin (curl, scripts), passa:
 * sem navegador não há cookie da vítima para aproveitar.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
  const origem = req.headers.origin
  if (origem) {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
      .split(',')[0]!
      .trim()
    let mesmoEndereco = false
    try {
      mesmoEndereco = new URL(origem).host === host
    } catch {
      // Origin malformado: trata como desconhecido.
    }
    if (origens.has(origem) || mesmoEndereco) return next()
  } else {
    const site = req.headers['sec-fetch-site']
    if (site !== 'cross-site' && site !== 'same-site') return next()
  }
  res.status(403).json({ message: 'Origem da requisição não permitida' })
})

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  // Só o próprio SIGO pode pôr a API num iframe (o visualizador de comprovantes).
  res.setHeader(
    'Content-Security-Policy',
    `frame-ancestors 'self' ${[...origens].join(' ')}`.trim(),
  )
  next()
})

app.setGlobalPrefix('api', { exclude: ['health'] })
app.enableCors({ origin: [...origens], credentials: true })
app.enableShutdownHooks()

await app.listen(env.PORT, env.HOST)
console.log(`SIGO API em http://${env.HOST}:${env.PORT}/api`)

import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { z } from 'zod'
import { AppModule } from './app.module.js'
import { env } from './config/env.js'

// Mensagens padrão do zod em português, para o que o contrato não personalizou.
z.config(z.locales.ptBR())

const app = await NestFactory.create<NestExpressApplication>(AppModule)

app.disable('x-powered-by')
// Atrás do Caddy o IP de quem chama vem no X-Forwarded-For, e é por ele que o
// freio de login conta as tentativas. Só redes privadas são confiáveis aqui.
app.set('trust proxy', 'loopback, linklocal, uniquelocal')
app.setGlobalPrefix('api', { exclude: ['health'] })
app.enableCors({
  origin: env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  credentials: true,
})
app.enableShutdownHooks()

await app.listen(env.PORT, env.HOST)
console.log(`SIGO API em http://${env.HOST}:${env.PORT}/api`)

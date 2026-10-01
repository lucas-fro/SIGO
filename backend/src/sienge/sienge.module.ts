import { Module } from '@nestjs/common'
import { env } from '../config/env.js'
import { ConferenciaService } from './conferencia.service.js'
import { SIENGE, SiengeCliente } from './sienge.cliente.js'
import { SiengeController } from './sienge.controller.js'
import { SiengeService } from './sienge.service.js'

/** O cliente com as credenciais do ambiente, ou `null` quando faltam (o quadro fica "não configurado"). */
function clienteDoAmbiente(): SiengeCliente | null {
  const { SIENGE_SUBDOMAIN, SIENGE_USER, SIENGE_PASSWORD, SIENGE_RATE_LIMIT_PER_MINUTE } = env
  if (!SIENGE_SUBDOMAIN || !SIENGE_USER || !SIENGE_PASSWORD) return null
  return new SiengeCliente({
    subdominio: SIENGE_SUBDOMAIN,
    usuario: SIENGE_USER,
    senha: SIENGE_PASSWORD,
    porMinuto: SIENGE_RATE_LIMIT_PER_MINUTE,
  })
}

@Module({
  controllers: [SiengeController],
  providers: [
    SiengeService,
    ConferenciaService,
    { provide: SIENGE, useFactory: clienteDoAmbiente },
  ],
})
export class SiengeModule {}

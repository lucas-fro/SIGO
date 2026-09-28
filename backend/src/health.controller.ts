import { Controller, Get, Inject } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Publico } from './auth/decorators.js'
import type { Database } from './db/client.js'
import { DB } from './db/database.module.js'

/**
 * Fora do prefixo /api e sem sessão: é o que o healthcheck do container
 * consulta. O `select 1` cobre API e banco de uma vez. O Caddy só encaminha
 * /api, então esta rota não fica exposta na internet.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Publico()
  @Get()
  async verificar(): Promise<{ status: 'ok' }> {
    await this.db.execute(sql`select 1`)
    return { status: 'ok' }
  }
}

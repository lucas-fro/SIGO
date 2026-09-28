import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common'
import { env } from '../config/env.js'
import { conectar, type Conexao } from './client.js'

/** Token de injeção do Drizzle: `@Inject(DB) private readonly db: Database`. */
export const DB = Symbol('DB')
const CONEXAO = Symbol('CONEXAO')

@Global()
@Module({
  providers: [
    { provide: CONEXAO, useFactory: () => conectar(env.DATABASE_URL) },
    { provide: DB, useFactory: (conexao: Conexao) => conexao.db, inject: [CONEXAO] },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(CONEXAO) private readonly conexao: Conexao) {}

  /* Fecha o pool no desligamento, para o `docker stop` não esperar conexões penduradas. */
  async onApplicationShutdown() {
    await this.conexao.pool.end()
  }
}

import { Module } from '@nestjs/common'
import { APP_PIPE } from '@nestjs/core'
import { AuthModule } from './auth/auth.module.js'
import { CadastrosModule } from './cadastros/cadastros.module.js'
import { ZodValidationPipe } from './common/validacao.js'
import { DatabaseModule } from './db/database.module.js'
import { HealthController } from './health.controller.js'
import { LancamentosModule } from './lancamentos/lancamentos.module.js'
import { PainelModule } from './painel/painel.module.js'
import { SiengeModule } from './sienge/sienge.module.js'

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CadastrosModule,
    LancamentosModule,
    PainelModule,
    SiengeModule,
  ],
  controllers: [HealthController],
  // Todo corpo, query e parâmetro com DTO de contrato passa pelo zod antes de chegar à rota.
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}

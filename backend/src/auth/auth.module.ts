import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthController } from './auth.controller.js'
import { SessaoGuard } from './sessao.guard.js'

@Module({
  controllers: [AuthController],
  // Guarda global: toda rota exige sessão, salvo as marcadas com @Publico().
  providers: [{ provide: APP_GUARD, useClass: SessaoGuard }],
})
export class AuthModule {}

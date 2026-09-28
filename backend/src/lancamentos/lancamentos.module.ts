import { Module } from '@nestjs/common'
import { LancamentosController } from './lancamentos.controller.js'
import { LancamentosService } from './lancamentos.service.js'

@Module({
  controllers: [LancamentosController],
  providers: [LancamentosService],
})
export class LancamentosModule {}

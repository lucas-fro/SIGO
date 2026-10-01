import { Module } from '@nestjs/common'
import { AnexosModule } from '../anexos/anexos.module.js'
import { LancamentosController } from './lancamentos.controller.js'
import { LancamentosService } from './lancamentos.service.js'

@Module({
  imports: [AnexosModule],
  controllers: [LancamentosController],
  providers: [LancamentosService],
  exports: [LancamentosService],
})
export class LancamentosModule {}

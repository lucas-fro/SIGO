import { Module } from '@nestjs/common'
import { ConfiguracoesController } from './configuracoes.controller.js'
import { LeituraIaService } from './leitura-ia.service.js'

@Module({
  controllers: [ConfiguracoesController],
  providers: [LeituraIaService],
  exports: [LeituraIaService],
})
export class ConfiguracoesModule {}

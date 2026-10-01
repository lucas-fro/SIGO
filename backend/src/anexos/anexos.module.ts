import { Module } from '@nestjs/common'
import { env } from '../config/env.js'
import { ConfiguracoesModule } from '../configuracoes/configuracoes.module.js'
import { AnexosController } from './anexos.controller.js'
import { ARMAZENAMENTO, AnexosService } from './anexos.service.js'
import { Armazenamento } from './armazenamento.js'

@Module({
  // O leitor por IA vem da configuração feita em Cadastros (LeituraIaService).
  imports: [ConfiguracoesModule],
  controllers: [AnexosController],
  providers: [
    AnexosService,
    { provide: ARMAZENAMENTO, useFactory: () => new Armazenamento(env.COMPROVANTES_DIR) },
  ],
  exports: [AnexosService],
})
export class AnexosModule {}

import { Body, Controller, Delete, Get, Put } from '@nestjs/common'
import { Papeis, UsuarioAtual } from '../auth/decorators.js'
import { zodDto } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import { salvarLeituraIaSchema } from '../contracts/configuracoes.js'
import { LeituraIaService } from './leitura-ia.service.js'

class SalvarLeituraIaDto extends zodDto(salvarLeituraIaSchema) {}

/** Configurações do sistema: só o administrador vê e altera. */
@Controller('configuracoes')
@Papeis('admin')
export class ConfiguracoesController {
  constructor(private readonly leituraIa: LeituraIaService) {}

  @Get('leitura-ia')
  obterLeituraIa() {
    return this.leituraIa.obter()
  }

  @Put('leitura-ia')
  salvarLeituraIa(@Body() dados: SalvarLeituraIaDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.leituraIa.salvar(usuario, dados)
  }

  @Delete('leitura-ia')
  removerLeituraIa(@UsuarioAtual() usuario: UsuarioSessao) {
    return this.leituraIa.remover(usuario)
  }
}

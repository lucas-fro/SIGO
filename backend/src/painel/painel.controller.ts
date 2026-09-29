import { Controller, Get, Query } from '@nestjs/common'
import { UsuarioAtual } from '../auth/decorators.js'
import { zodDto } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import { painelSchema } from '../contracts/painel.js'
import { PainelService } from './painel.service.js'

class PainelDto extends zodDto(painelSchema) {}

@Controller('painel')
export class PainelController {
  constructor(private readonly painel: PainelService) {}

  @Get()
  montar(@Query() { setorId, mes }: PainelDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.painel.montar(usuario, setorId, mes)
  }
}

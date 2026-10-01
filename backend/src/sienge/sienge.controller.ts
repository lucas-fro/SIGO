import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common'
import { Papeis, UsuarioAtual } from '../auth/decorators.js'
import { zodDto } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import { gastoSiengeSchema } from '../contracts/sienge.js'
import { ConferenciaService } from './conferencia.service.js'
import { SiengeService } from './sienge.service.js'

class GastoSiengeDto extends zodDto(gastoSiengeSchema) {}

@Controller('sienge')
export class SiengeController {
  constructor(
    private readonly sienge: SiengeService,
    private readonly conferencia: ConferenciaService,
  ) {}

  /** O gasto do setor no Sienge no mês; responde na hora e, se preciso, atualiza em segundo plano. */
  @Get('gasto')
  gasto(@Query() { setorId, mes }: GastoSiengeDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.sienge.gastoDoMes(usuario, setorId, mes)
  }

  /** Situação da conferência de pagamentos: a última rodada e a próxima. */
  @Get('conferencia')
  statusConferencia() {
    return this.conferencia.status()
  }

  /** Confere os pagamentos agora, sem esperar o horário. Responde na hora; a rodada segue em segundo plano. */
  @Post('conferencia')
  @Papeis('admin')
  @HttpCode(HttpStatus.ACCEPTED)
  async conferirAgora() {
    this.conferencia.iniciar('manual')
    return this.conferencia.status()
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { Papeis, UsuarioAtual } from '../auth/decorators.js'
import { zodDto } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import {
  cartaoSchema,
  editarCartaoSchema,
  editarGastoFixoSchema,
  gastoFixoSchema,
  recargaSchema,
} from '../contracts/cadastros.js'
import { situacaoCartoesSchema } from '../contracts/cartoes.js'
import { CartoesService } from './cartoes.service.js'

class NovoCartaoDto extends zodDto(cartaoSchema) {}
class EditarCartaoDto extends zodDto(editarCartaoSchema) {}
class NovoGastoFixoDto extends zodDto(gastoFixoSchema) {}
class EditarGastoFixoDto extends zodDto(editarGastoFixoSchema) {}
class NovaRecargaDto extends zodDto(recargaSchema) {}
class SituacaoCartoesDto extends zodDto(situacaoCartoesSchema) {}

/**
 * A listagem dos cartões vem junto das outras listas, em GET /cadastros; os
 * números da página Cartão (situação do mês e saldo), em GET /cartoes/situacao.
 */
@Controller()
export class CartoesController {
  constructor(private readonly cartoes: CartoesService) {}

  @Get('cartoes/situacao')
  situacao(@Query() { setorId, mes }: SituacaoCartoesDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.cartoes.situacao(usuario, setorId, mes)
  }

  @Post('cartoes')
  @Papeis('admin')
  criarCartao(@Body() dados: NovoCartaoDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.cartoes.criarCartao(usuario, dados)
  }

  @Patch('cartoes/:id')
  @Papeis('admin')
  editarCartao(
    @Param('id', ParseIntPipe) id: number,
    @Body() mudancas: EditarCartaoDto,
    @UsuarioAtual() usuario: UsuarioSessao,
  ) {
    return this.cartoes.editarCartao(usuario, id, mudancas)
  }

  @Post('gastos-fixos')
  @Papeis('admin', 'editor')
  criarGastoFixo(@Body() dados: NovoGastoFixoDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.cartoes.criarGastoFixo(usuario, dados)
  }

  @Patch('gastos-fixos/:id')
  @Papeis('admin', 'editor')
  editarGastoFixo(
    @Param('id', ParseIntPipe) id: number,
    @Body() mudancas: EditarGastoFixoDto,
    @UsuarioAtual() usuario: UsuarioSessao,
  ) {
    return this.cartoes.editarGastoFixo(usuario, id, mudancas)
  }

  @Post('recargas')
  @Papeis('admin', 'editor')
  criarRecarga(@Body() dados: NovaRecargaDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.cartoes.criarRecarga(usuario, dados)
  }

  @Post('recargas/:id/remover')
  @HttpCode(200)
  @Papeis('admin', 'editor')
  removerRecarga(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.cartoes.removerRecarga(usuario, id)
  }
}

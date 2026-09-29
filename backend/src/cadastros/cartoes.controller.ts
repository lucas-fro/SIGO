import { Body, Controller, Param, ParseIntPipe, Patch, Post } from '@nestjs/common'
import { Papeis, UsuarioAtual } from '../auth/decorators.js'
import { zodDto } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import {
  cartaoSchema,
  editarCartaoSchema,
  editarGastoFixoSchema,
  gastoFixoSchema,
} from '../contracts/cadastros.js'
import { CartoesService } from './cartoes.service.js'

class NovoCartaoDto extends zodDto(cartaoSchema) {}
class EditarCartaoDto extends zodDto(editarCartaoSchema) {}
class NovoGastoFixoDto extends zodDto(gastoFixoSchema) {}
class EditarGastoFixoDto extends zodDto(editarGastoFixoSchema) {}

/** A listagem vem junto das outras listas, em GET /cadastros. */
@Controller()
export class CartoesController {
  constructor(private readonly cartoes: CartoesService) {}

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
}

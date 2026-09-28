import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import { Papeis, UsuarioAtual } from '../auth/decorators.js'
import { zodDto } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import {
  cancelarLancamentoSchema,
  criarLancamentoSchema,
  indicadoresSchema,
  lancamentoSchema,
  listarLancamentosSchema,
  pagamentoParcelaSchema,
} from '../contracts/lancamentos.js'
import { LancamentosService } from './lancamentos.service.js'

class FiltrosDto extends zodDto(listarLancamentosSchema) {}
class IndicadoresDto extends zodDto(indicadoresSchema) {}
class CriarDto extends zodDto(criarLancamentoSchema) {}
class EditarDto extends zodDto(lancamentoSchema) {}
class CancelarDto extends zodDto(cancelarLancamentoSchema) {}
class PagamentoDto extends zodDto(pagamentoParcelaSchema) {}

@Controller('lancamentos')
export class LancamentosController {
  constructor(private readonly lancamentos: LancamentosService) {}

  @Get()
  listar(@Query() filtros: FiltrosDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.lancamentos.listar(usuario, filtros)
  }

  // Antes de ':id', senão "indicadores" seria lido como número de lançamento.
  @Get('indicadores')
  indicadores(@Query() { setorId }: IndicadoresDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.lancamentos.indicadores(usuario, setorId)
  }

  @Get(':id')
  detalhar(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.lancamentos.detalhar(usuario, id)
  }

  @Post()
  @Papeis('admin', 'editor')
  criar(@Body() entrada: CriarDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.lancamentos.criar(usuario, entrada)
  }

  @Put(':id')
  @Papeis('admin', 'editor')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() entrada: EditarDto,
    @UsuarioAtual() usuario: UsuarioSessao,
  ) {
    return this.lancamentos.atualizar(usuario, id, entrada)
  }

  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  @Papeis('admin', 'editor')
  cancelar(
    @Param('id', ParseIntPipe) id: number,
    @Body() { motivo }: CancelarDto,
    @UsuarioAtual() usuario: UsuarioSessao,
  ) {
    return this.lancamentos.cancelar(usuario, id, motivo)
  }

  @Patch(':id/parcelas/:parcelaId')
  @Papeis('admin', 'editor')
  pagamentoParcela(
    @Param('id', ParseIntPipe) id: number,
    @Param('parcelaId', ParseIntPipe) parcelaId: number,
    @Body() { pagoEm }: PagamentoDto,
    @UsuarioAtual() usuario: UsuarioSessao,
  ) {
    return this.lancamentos.pagamentoParcela(usuario, id, parcelaId, pagoEm)
  }
}

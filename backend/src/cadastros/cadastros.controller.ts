import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common'
import { Papeis, UsuarioAtual } from '../auth/decorators.js'
import { zodDto } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import {
  editarFornecedorSchema,
  editarItemSchema,
  fornecedorSchema,
  LISTAS,
  novoItemSchema,
  type Lista,
} from '../contracts/cadastros.js'
import { CadastrosService } from './cadastros.service.js'

class NovoItemDto extends zodDto(novoItemSchema) {}
class EditarItemDto extends zodDto(editarItemSchema) {}
class NovoFornecedorDto extends zodDto(fornecedorSchema) {}
class EditarFornecedorDto extends zodDto(editarFornecedorSchema) {}

function lista(valor: string): Lista {
  if (!(LISTAS as readonly string[]).includes(valor))
    throw new NotFoundException('Lista desconhecida')
  return valor as Lista
}

@Controller()
export class CadastrosController {
  constructor(private readonly cadastros: CadastrosService) {}

  @Get('cadastros')
  listar(@UsuarioAtual() usuario: UsuarioSessao) {
    return this.cadastros.listar(usuario)
  }

  @Post('cadastros/:lista')
  @Papeis('admin', 'editor')
  criarItem(
    @Param('lista') nome: string,
    @Body() item: NovoItemDto,
    @UsuarioAtual() usuario: UsuarioSessao,
  ) {
    return this.cadastros.criarItem(usuario, lista(nome), item)
  }

  @Patch('cadastros/:lista/:id')
  @Papeis('admin', 'editor')
  editarItem(
    @Param('lista') nome: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() mudancas: EditarItemDto,
    @UsuarioAtual() usuario: UsuarioSessao,
  ) {
    return this.cadastros.editarItem(usuario, lista(nome), id, mudancas)
  }

  @Get('fornecedores')
  listarFornecedores() {
    return this.cadastros.listarFornecedores()
  }

  @Post('fornecedores')
  @Papeis('admin', 'editor')
  criarFornecedor(@Body() dados: NovoFornecedorDto, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.cadastros.criarFornecedor(usuario, dados)
  }

  @Patch('fornecedores/:id')
  @Papeis('admin')
  editarFornecedor(@Param('id', ParseIntPipe) id: number, @Body() mudancas: EditarFornecedorDto) {
    return this.cadastros.editarFornecedor(id, mudancas)
  }
}

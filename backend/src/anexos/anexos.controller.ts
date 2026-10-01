import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js'
import type { Response } from 'express'
import { Papeis, UsuarioAtual } from '../auth/decorators.js'
import { zodDto } from '../common/validacao.js'
import {
  arquivoAnexoSchema,
  enviarAnexoSchema,
  lerAnexoSchema,
  TAMANHO_MAXIMO_ANEXO,
} from '../contracts/anexos.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import { AnexosService, type ArquivoRecebido } from './anexos.service.js'

class EnviarDto extends zodDto(enviarAnexoSchema) {}
class LerDto extends zodDto(lerAnexoSchema) {}
class ArquivoDto extends zodDto(arquivoAnexoSchema) {}

/** `filename*` em UTF-8 (acentos) e um `filename` só ASCII para navegador antigo. */
function disposicao(modo: 'inline' | 'attachment', nome: string): string {
  const ascii =
    nome
      .normalize('NFD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[\\"]/g, '') || 'comprovante'
  return `${modo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`
}

@Controller('anexos')
export class AnexosController {
  constructor(private readonly anexos: AnexosService) {}

  /**
   * Envio de um arquivo (multipart, campo `arquivo`). O limite do multer fica
   * um byte acima do máximo para o serviço responder com a mensagem certa.
   */
  @Post()
  @Papeis('admin', 'editor')
  @UseInterceptors(
    FileInterceptor('arquivo', {
      // Só o arquivo e o `lancamentoId`: campo a mais seria acumulado na memória da API.
      limits: { fileSize: TAMANHO_MAXIMO_ANEXO + 1, files: 1, fields: 2, fieldSize: 64, parts: 3 },
      // O navegador manda o nome em UTF-8; o padrão do multer (latin1) estraga os acentos.
      defParamCharset: 'utf8',
    } as MulterOptions),
  )
  enviar(
    @UploadedFile() arquivo: ArquivoRecebido | undefined,
    @Body() { lancamentoId }: EnviarDto,
    @UsuarioAtual() usuario: UsuarioSessao,
  ) {
    return this.anexos.enviar(usuario, arquivo, lancamentoId)
  }

  /** Lê o comprovante por IA para pré-preencher o formulário. */
  @Post(':id/ler')
  @Papeis('admin', 'editor')
  @HttpCode(HttpStatus.OK)
  ler(
    @Param('id', ParseIntPipe) id: number,
    @Body() { setorId }: LerDto,
    @UsuarioAtual() usuario: UsuarioSessao,
  ) {
    return this.anexos.ler(usuario, id, setorId)
  }

  /** O arquivo: abre no navegador, ou baixa com `?baixar=1`. */
  @Get(':id/arquivo')
  async arquivo(
    @Param('id', ParseIntPipe) id: number,
    @Query() { baixar }: ArquivoDto,
    @UsuarioAtual() usuario: UsuarioSessao,
    @Res({ passthrough: true }) res: Response,
  ) {
    const a = await this.anexos.arquivo(usuario, id)
    res.set({
      'Content-Type': a.tipo,
      'Content-Length': String(a.tamanho),
      'Content-Disposition': disposicao(baixar === '1' ? 'attachment' : 'inline', a.nome),
      // Comprovante é dado do setor: nada de cache compartilhado.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    return new StreamableFile(a.conteudo)
  }

  @Delete(':id')
  @Papeis('admin', 'editor')
  @HttpCode(HttpStatus.NO_CONTENT)
  remover(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() usuario: UsuarioSessao) {
    return this.anexos.remover(usuario, id)
  }
}

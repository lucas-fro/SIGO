import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'
import { zodDto } from '../common/validacao.js'
import { loginSchema, type UsuarioSessao } from '../contracts/auth.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import { Publico, UsuarioAtual } from './decorators.js'
import {
  atrasoDeFalha,
  chaveDoIp,
  iniciarTentativa,
  tempoBloqueado,
  tentativaEncerrada,
  tentativaFalhou,
  type Chave,
} from './freio-login.js'
import { hashPassword, verifyPassword } from './password.js'
import { clearedCookie, issueToken, lerToken, readSessionCookie, sessionCookie } from './session.js'
import {
  buscarAtivoPorEmail,
  carregarSessao,
  encerrarSessoes,
  normalizarEmail,
  registrarAcesso,
} from './usuarios.js'

class LoginDto extends zodDto(loginSchema) {}

/**
 * Hash de uma senha qualquer, para conferir quando o e-mail não existe: o
 * scrypt leva o mesmo tempo nos dois casos e a resposta não entrega quais
 * contas existem.
 */
const hashFicticio = hashPassword(randomBytes(18).toString('base64url')).catch(
  // Promessa criada na carga do módulo: sem catch, uma falha derrubaria a API.
  () => 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
)

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name)

  constructor(@Inject(DB) private readonly db: Database) {}

  @Publico()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ usuario: UsuarioSessao }> {
    const ip = chaveDoIp(req.ip ?? 'desconhecido')
    const chaves: Chave[] = [`ip:${ip}`, `conta:${normalizarEmail(body.email)}`]
    const bloqueio = tempoBloqueado(...chaves)
    if (bloqueio > 0) {
      throw new HttpException(
        {
          message: `Muitas tentativas. Tente novamente em ${Math.ceil(bloqueio / 60_000)} minuto(s).`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    // Ocupa lugar no limite antes de qualquer espera: pedidos em paralelo não passam
    // todos pela checagem acima.
    iniciarTentativa(...chaves)
    let usuario: Awaited<ReturnType<typeof buscarAtivoPorEmail>>
    let confere = false
    try {
      usuario = await buscarAtivoPorEmail(this.db, body.email)
      confere = await verifyPassword(body.senha, usuario?.senhaHash ?? (await hashFicticio))
    } catch (erro) {
      tentativaEncerrada(...chaves)
      throw erro
    }

    if (!usuario || !confere) {
      tentativaFalhou(...chaves)
      await atrasoDeFalha()
      // JSON.stringify: quebra de linha no e-mail não forja linha no log.
      this.logger.warn(`login recusado: ${JSON.stringify(body.email)} (ip ${ip})`)
      throw new UnauthorizedException('E-mail ou senha incorretos')
    }

    tentativaEncerrada(...chaves)
    await registrarAcesso(this.db, usuario.id)
    const sessao = await carregarSessao(this.db, usuario.id)
    if (!sessao) throw new UnauthorizedException('Acesso revogado')

    res.setHeader('Set-Cookie', sessionCookie(issueToken(usuario.id, usuario.sessaoVersao)))
    return { usuario: sessao }
  }

  /** Sair derruba as sessões da pessoa em todos os aparelhos (o cookie copiado também deixa de valer). */
  @Publico()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ usuario: null }> {
    const token = lerToken(readSessionCookie(req.headers.cookie))
    if (token && (await carregarSessao(this.db, token.uid, token.versao))) {
      await encerrarSessoes(this.db, token.uid)
    }
    res.setHeader('Set-Cookie', clearedCookie())
    return { usuario: null }
  }

  /** Chegou aqui, a guarda já validou a sessão e carregou o usuário. */
  @Get('me')
  me(@UsuarioAtual() usuario: UsuarioSessao): { usuario: UsuarioSessao } {
    return { usuario }
  }
}

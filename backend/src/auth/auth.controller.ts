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
import type { Request, Response } from 'express'
import { zodDto } from '../common/validacao.js'
import { loginSchema, type UsuarioSessao } from '../contracts/auth.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import { Publico, UsuarioAtual } from './decorators.js'
import { atrasoDeFalha, limparFalhas, registrarFalha, tempoBloqueado } from './freio-login.js'
import { verifyPassword } from './password.js'
import { clearedCookie, issueToken, sessionCookie } from './session.js'
import { buscarAtivoPorEmail, carregarSessao, registrarAcesso } from './usuarios.js'

class LoginDto extends zodDto(loginSchema) {}

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
    const ip = req.ip ?? 'desconhecido'
    const bloqueio = tempoBloqueado(ip)
    if (bloqueio > 0) {
      throw new HttpException(
        {
          message: `Muitas tentativas. Tente novamente em ${Math.ceil(bloqueio / 60_000)} minuto(s).`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const usuario = await buscarAtivoPorEmail(this.db, body.email)
    // Mesma resposta para e-mail inexistente e senha errada: distinguir os dois
    // diria a um estranho quais contas existem.
    const confere = usuario ? await verifyPassword(body.senha, usuario.senhaHash) : false

    if (!usuario || !confere) {
      registrarFalha(ip)
      await atrasoDeFalha()
      this.logger.warn(`login recusado: ${body.email} (ip ${ip})`)
      throw new UnauthorizedException('E-mail ou senha incorretos')
    }

    limparFalhas(ip)
    await registrarAcesso(this.db, usuario.id)
    const sessao = await carregarSessao(this.db, usuario.id)
    if (!sessao) throw new UnauthorizedException('Acesso revogado')

    res.setHeader('Set-Cookie', sessionCookie(issueToken(usuario.id)))
    return { usuario: sessao }
  }

  @Publico()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response): { usuario: null } {
    res.setHeader('Set-Cookie', clearedCookie())
    return { usuario: null }
  }

  /** Chegou aqui, a guarda já validou a sessão e carregou o usuário. */
  @Get('me')
  me(@UsuarioAtual() usuario: UsuarioSessao): { usuario: UsuarioSessao } {
    return { usuario }
  }
}

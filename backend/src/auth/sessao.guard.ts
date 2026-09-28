import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Papel } from '../contracts/auth.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import { CHAVE_PAPEIS, CHAVE_PUBLICO, type RequisicaoComUsuario } from './decorators.js'
import { readSessionCookie, userIdFromToken } from './session.js'
import { carregarSessao } from './usuarios.js'

/**
 * Guarda global: exige sessão válida e anexa o usuário à requisição.
 *
 * Papel, setores e situação vêm do banco, não do cookie: desativar alguém ou
 * mudar o acesso vale na requisição seguinte.
 *
 * Esconder botão no front é conveniência, não proteção — o front é build
 * estática e qualquer pessoa lê o JavaScript dele. Quem protege é esta guarda,
 * com 401 e 403, e as checagens de setor nos serviços.
 */
@Injectable()
export class SessaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const alvos = [ctx.getHandler(), ctx.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, alvos)) return true

    const req = ctx.switchToHttp().getRequest<RequisicaoComUsuario>()
    const id = userIdFromToken(readSessionCookie(req.headers.cookie))
    if (id === undefined) throw new UnauthorizedException('Sessão expirada ou ausente')

    const usuario = await carregarSessao(this.db, id)
    // Sessão assinada e no prazo, mas a conta foi desativada.
    if (!usuario) throw new UnauthorizedException('Acesso revogado')
    req.usuario = usuario

    const papeis = this.reflector.getAllAndOverride<Papel[] | undefined>(CHAVE_PAPEIS, alvos)
    if (papeis && !papeis.includes(usuario.papel)) {
      throw new ForbiddenException('Seu acesso não permite esta ação')
    }
    return true
  }
}

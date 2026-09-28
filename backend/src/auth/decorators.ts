import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { Papel, UsuarioSessao } from '../contracts/auth.js'

export type RequisicaoComUsuario = Request & { usuario?: UsuarioSessao }

export const CHAVE_PUBLICO = 'sigo:publico'
export const CHAVE_PAPEIS = 'sigo:papeis'

/** Rota aberta, sem sessão: login, logout e o healthcheck. Todo o resto exige sessão. */
export const Publico = () => SetMetadata(CHAVE_PUBLICO, true)

/** Restringe a rota a esses papéis. Sem este decorator, qualquer pessoa logada passa. */
export const Papeis = (...papeis: Papel[]) => SetMetadata(CHAVE_PAPEIS, papeis)

/** Quem fez a requisição, já validado e carregado pela guarda. */
export const UsuarioAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioSessao => {
    const usuario = ctx.switchToHttp().getRequest<RequisicaoComUsuario>().usuario
    // Só acontece se alguém marcar como pública uma rota que usa o usuário.
    if (!usuario) throw new Error('UsuarioAtual usado em rota sem sessão')
    return usuario
  },
)

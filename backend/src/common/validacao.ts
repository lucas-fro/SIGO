import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common'
import type { z } from 'zod'
import type { ErroValidacao } from '../contracts/comum.js'

/**
 * Classe-DTO que carrega o esquema zod do contrato.
 *
 * O Nest descobre o tipo de cada parâmetro pela classe declarada na assinatura
 * (`@Body() dto: CriarLancamentoDto`). A classe gerada aqui não tem nada além
 * do esquema, e o pipe global abaixo usa esse esquema para validar. Assim a
 * regra fica escrita uma vez só, no contrato, que o front também usa.
 */
export interface ZodDto<T extends z.ZodType> {
  new (): z.output<T>
  readonly schema: T
}

export function zodDto<T extends z.ZodType>(schema: T): ZodDto<T> {
  return class {
    static readonly schema = schema
  } as unknown as ZodDto<T>
}

export function erroDeValidacao(
  issues: ErroValidacao['issues'],
  message = 'Confira os campos destacados',
): BadRequestException {
  const corpo: ErroValidacao = { message, issues }
  return new BadRequestException(corpo)
}

/**
 * Pipe global: valida corpo, query e parâmetros que tenham DTO de contrato, e
 * entrega à rota o dado já convertido pelo zod (números da query, textos
 * aparados, vazios virando null).
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = (metadata.metatype as { schema?: z.ZodType } | undefined)?.schema
    if (!schema) return value

    const resultado = schema.safeParse(value ?? {})
    if (resultado.success) return resultado.data

    throw erroDeValidacao(
      resultado.error.issues.map((i) => ({
        path: i.path.map(String).join('.'),
        message: i.message,
      })),
    )
  }
}

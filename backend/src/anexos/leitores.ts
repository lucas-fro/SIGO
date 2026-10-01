import type { ProvedorIa } from '../contracts/configuracoes.js'
import type { Leitor } from './leitor.js'
import { LeitorClaude } from './leitor-claude.js'
import { LeitorOpenAI } from './leitor-openai.js'

/** O leitor da API escolhida na configuração. */
export function criarLeitor(provedor: ProvedorIa, chave: string, modelo: string): Leitor {
  switch (provedor) {
    case 'openai':
      return new LeitorOpenAI({ chave, modelo })
    case 'anthropic':
      return new LeitorClaude({ chave, modelo })
  }
}

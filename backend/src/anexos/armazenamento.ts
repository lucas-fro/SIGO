import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, type ReadStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { TipoAnexo } from '../contracts/anexos.js'

/*
  Onde os comprovantes ficam no disco. O caminho gravado no banco é relativo
  à pasta raiz ("2026/09/<uuid>.pdf"): trocar a pasta de lugar (outro volume,
  outro servidor) é só mudar COMPROVANTES_DIR e copiar os arquivos.

  O nome no disco é gerado aqui, nunca o que veio do navegador: o nome
  original fica só no banco, para mostrar e para o download.
*/

const EXTENSAO: Record<TipoAnexo, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/**
 * O tipo do arquivo pelo conteúdo (os primeiros bytes), não pelo que o
 * navegador disse: um .exe renomeado para .pdf não passa.
 */
export function tipoPeloConteudo(conteudo: Buffer): TipoAnexo | null {
  if (conteudo.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (conteudo[0] === 0xff && conteudo[1] === 0xd8 && conteudo[2] === 0xff) return 'image/jpeg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (png.every((byte, i) => conteudo[i] === byte)) return 'image/png'
  return null
}

export const sha256 = (conteudo: Buffer): string =>
  createHash('sha256').update(conteudo).digest('hex')

/**
 * Nome de arquivo seguro para guardar e para o cabeçalho do download: sem
 * pasta, sem caractere de controle, sem aspas, com tamanho limitado e com a
 * extensão do tipo conferido pelos bytes. Um "PDF" enviado como boleto.hta
 * baixa como boleto.pdf: quem abre não executa nada.
 */
export function nomeSeguro(nome: string, tipo: TipoAnexo): string {
  const limpo = nome
    .split(/[\\/]/)
    .pop()!
    // Tirar caractere de controle é o objetivo aqui: ele quebraria o cabeçalho do download.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim()
  const semExtensao = limpo
    .replace(/\.[^.]{1,10}$/, '')
    .trim()
    .slice(0, 140)
  return `${semExtensao || 'comprovante'}.${EXTENSAO[tipo]}`
}

export class Armazenamento {
  private readonly raiz: string

  constructor(pasta: string) {
    this.raiz = resolve(pasta)
  }

  /**
   * Confere que a pasta existe e aceita escrita. No servidor ela é montada
   * do disco da VPS e precisa ser do usuário do container (uid 1000): sem
   * isso, todo envio falharia só na hora do primeiro upload.
   */
  async conferirEscrita(): Promise<void> {
    await mkdir(this.raiz, { recursive: true })
    const teste = join(this.raiz, `.escrita-${randomUUID()}`)
    await writeFile(teste, '')
    await rm(teste, { force: true })
  }

  get pasta(): string {
    return this.raiz
  }

  /** Grava o conteúdo e devolve o caminho relativo para o banco. */
  async gravar(conteudo: Buffer, tipo: TipoAnexo, quando = new Date()): Promise<string> {
    const ano = String(quando.getFullYear())
    const mes = String(quando.getMonth() + 1).padStart(2, '0')
    const caminho = `${ano}/${mes}/${randomUUID()}.${EXTENSAO[tipo]}`
    const destino = this.absoluto(caminho)
    await mkdir(dirname(destino), { recursive: true })
    // `wx`: nunca sobrescreve (o uuid já torna isso impossível, mas o disco confirma).
    await writeFile(destino, conteudo, { flag: 'wx' })
    return caminho
  }

  ler(caminho: string): ReadStream {
    return createReadStream(this.absoluto(caminho))
  }

  /** O arquivo inteiro na memória (para mandar à leitura por IA). */
  lerConteudo(caminho: string): Promise<Buffer> {
    return readFile(this.absoluto(caminho))
  }

  /** Só para rascunho descartado: comprovante de lançamento nunca é apagado. */
  async apagar(caminho: string): Promise<void> {
    await rm(this.absoluto(caminho), { force: true })
  }

  /** Caminho absoluto, recusando qualquer coisa que saia da pasta raiz. */
  private absoluto(caminho: string): string {
    const alvo = resolve(this.raiz, caminho)
    const dentro = relative(this.raiz, alvo)
    if (
      !dentro ||
      dentro.startsWith('..') ||
      isAbsolute(dentro) ||
      dentro.split(sep).includes('..')
    ) {
      throw new Error('Caminho de comprovante fora da pasta')
    }
    return join(this.raiz, dentro)
  }
}

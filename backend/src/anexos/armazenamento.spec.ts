import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Armazenamento, nomeSeguro, sha256, tipoPeloConteudo } from './armazenamento.js'

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n', 'latin1')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

describe('tipoPeloConteudo', () => {
  it('reconhece PDF, JPG e PNG pelos primeiros bytes', () => {
    expect(tipoPeloConteudo(PDF)).toBe('application/pdf')
    expect(tipoPeloConteudo(JPG)).toBe('image/jpeg')
    expect(tipoPeloConteudo(PNG)).toBe('image/png')
  })

  it('recusa o que não é, mesmo com extensão certa', () => {
    expect(tipoPeloConteudo(Buffer.from('MZ\x90\x00executavel'))).toBeNull()
    expect(tipoPeloConteudo(Buffer.from('<html>'))).toBeNull()
    expect(tipoPeloConteudo(Buffer.alloc(0))).toBeNull()
  })
})

describe('nomeSeguro', () => {
  it('tira pasta, aspas e caracteres de controle', () => {
    expect(nomeSeguro('C:\\fakepath\\Boleto "Meta".pdf', 'application/pdf')).toBe('Boleto Meta.pdf')
    expect(nomeSeguro('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf')
    expect(nomeSeguro('nota\u0000\n.png', 'image/png')).toBe('nota.png')
  })

  it('a extensão é sempre a do tipo conferido pelos bytes', () => {
    expect(nomeSeguro('boleto.hta', 'application/pdf')).toBe('boleto.pdf')
    expect(nomeSeguro('foto.JPEG', 'image/jpeg')).toBe('foto.jpg')
    expect(nomeSeguro('NF 826 set.26.pdf', 'application/pdf')).toBe('NF 826 set.26.pdf')
  })

  it('sem nome aproveitável, usa um padrão com a extensão do tipo', () => {
    expect(nomeSeguro('   ', 'image/jpeg')).toBe('comprovante.jpg')
  })
})

describe('Armazenamento', () => {
  let pasta: string
  beforeEach(async () => {
    pasta = await mkdtemp(join(tmpdir(), 'sigo-comprovantes-'))
  })
  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true })
  })

  it('grava em ano/mês com nome gerado e lê de volta', async () => {
    const armazenamento = new Armazenamento(pasta)
    const caminho = await armazenamento.gravar(PDF, 'application/pdf', new Date(2026, 8, 29))
    expect(caminho).toMatch(/^2026\/09\/[0-9a-f-]{36}\.pdf$/)
    expect(await readFile(join(pasta, caminho))).toEqual(PDF)

    const partes: Buffer[] = []
    for await (const parte of armazenamento.ler(caminho)) partes.push(parte as Buffer)
    expect(Buffer.concat(partes)).toEqual(PDF)
  })

  it('recusa caminho que sai da pasta', () => {
    const armazenamento = new Armazenamento(pasta)
    expect(() => armazenamento.ler('../fora.pdf')).toThrow(/fora da pasta/)
    expect(() => armazenamento.ler('2026/../../fora.pdf')).toThrow(/fora da pasta/)
  })

  it('apagar some com o arquivo e não falha se ele já não existe', async () => {
    const armazenamento = new Armazenamento(pasta)
    const caminho = await armazenamento.gravar(PNG, 'image/png')
    await armazenamento.apagar(caminho)
    await armazenamento.apagar(caminho)
    await expect(readFile(join(pasta, caminho))).rejects.toThrow()
  })

  it('o hash identifica o mesmo conteúdo', () => {
    expect(sha256(PDF)).toBe(sha256(Buffer.from(PDF)))
    expect(sha256(PDF)).not.toBe(sha256(PNG))
  })
})

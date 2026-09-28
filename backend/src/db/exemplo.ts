import { and, count, eq, inArray } from 'drizzle-orm'
import { env } from '../config/env.js'
import { hoje, inicioDoMes, somarDias, somarMeses } from '../contracts/datas.js'
import { gerarParcelas } from '../contracts/parcelas.js'
import { conectar } from './client.js'
import {
  campanhas,
  categorias,
  empreendimentos,
  eventos,
  formasPagamento,
  fornecedores,
  lancamentos,
  parcelas,
  setores,
  usuarios,
} from './schema.js'

/*
  Dados de exemplo, só para desenvolvimento: um ano de gastos de marketing
  para ver as telas preenchidas (lista, indicadores, minigráfico, parcelas
  vencidas e a vencer).

  Recusa rodar em produção e em banco que já tenha lançamento. Todo
  fornecedor e empreendimento criado aqui leva "(exemplo)" no nome, para
  nunca se confundir com gasto real.
*/
if (process.env.NODE_ENV === 'production') {
  throw new Error('dados de exemplo não rodam em produção')
}

const { db, pool } = conectar(env.DATABASE_URL)

/** Variação determinística entre 0 e `faixa`: o exemplo sai igual a cada vez. */
const variacao = (i: number, faixa: number) =>
  Math.round(((((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1) * faixa)

interface Gasto {
  descricao: string
  data: string
  valor: number
  categoria: string
  forma: string
  fornecedor: string
  empreendimento: string
  campanha?: string
  codigo?: string
  parcelas?: number
  primeiroVencimento: string
  /** Paga as parcelas cujo vencimento já passou, exceto as listadas aqui (ficam vencidas). */
  naoPagar?: number[]
}

try {
  const [existentes] = await db.select({ total: count() }).from(lancamentos)
  if (existentes?.total) {
    console.log(`o banco já tem ${existentes.total} lançamento(s): exemplo não aplicado`)
  } else {
    const dia = hoje()

    const [marketing] = await db
      .select({ id: setores.id })
      .from(setores)
      .where(eq(setores.slug, 'marketing'))
    const [admin] = await db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, env.ADMIN_EMAIL.toLowerCase()))
    if (!marketing || !admin) throw new Error('rode antes db:seed e usuarios seed-admin')

    await db
      .insert(empreendimentos)
      .values([
        { nome: 'Residencial Jardim Aurora (exemplo)', ordem: 1 },
        { nome: 'Condomínio Vista Verde (exemplo)', ordem: 2 },
      ])
      .onConflictDoNothing()

    const nomesFornecedores = [
      'Meta Platforms (exemplo)',
      'Google Ads (exemplo)',
      'Gráfica Pontual (exemplo)',
      'Stand & Cia Montagens (exemplo)',
      'Brindes Nordeste (exemplo)',
      'Agência Criativa Norte (exemplo)',
      'Rádio Cidade FM (exemplo)',
      'Buffet Sabor & Arte (exemplo)',
      'Limpeza Total Serviços (exemplo)',
    ]
    await db
      .insert(fornecedores)
      .values(nomesFornecedores.map((nome) => ({ nome, criadoPor: admin.id })))

    await db
      .insert(campanhas)
      .values([
        { setorId: marketing.id, nome: 'Lançamento Jardim Aurora (exemplo)' },
        { setorId: marketing.id, nome: 'Feirão de Imóveis (exemplo)' },
      ])
      .onConflictDoNothing()

    const mapa = async <T extends { id: number; nome: string }>(linhas: Promise<T[]>) =>
      new Map((await linhas).map((l) => [l.nome, l.id]))
    const idCategoria = await mapa(
      db
        .select({ id: categorias.id, nome: categorias.nome })
        .from(categorias)
        .where(eq(categorias.setorId, marketing.id)),
    )
    const idForma = await mapa(
      db.select({ id: formasPagamento.id, nome: formasPagamento.nome }).from(formasPagamento),
    )
    const idEmp = await mapa(
      db.select({ id: empreendimentos.id, nome: empreendimentos.nome }).from(empreendimentos),
    )
    const idForn = await mapa(
      db
        .select({ id: fornecedores.id, nome: fornecedores.nome })
        .from(fornecedores)
        .where(inArray(fornecedores.nome, nomesFornecedores)),
    )
    const idCamp = await mapa(
      db
        .select({ id: campanhas.id, nome: campanhas.nome })
        .from(campanhas)
        .where(and(eq(campanhas.setorId, marketing.id))),
    )

    const aurora = 'Residencial Jardim Aurora (exemplo)'
    const vistaVerde = 'Condomínio Vista Verde (exemplo)'
    const diaDoMes = (mes: string, d: number) => `${mes.slice(0, 8)}${String(d).padStart(2, '0')}`

    const gastos: Gasto[] = []
    for (let m = -11; m <= 0; m++) {
      const mes = inicioDoMes(somarMeses(dia, m))
      const proximo = inicioDoMes(somarMeses(dia, m + 1))
      const i = m + 12

      // Mídia paga no cartão: a compra no mês, o pagamento na fatura do mês seguinte.
      gastos.push({
        descricao: `Impulsionamento Meta Ads — ${mes.slice(5, 7)}/${mes.slice(0, 4)}`,
        data: diaDoMes(mes, 5),
        valor: 850_000 + i * 42_000 + variacao(i, 180_000),
        categoria: 'Mídia digital',
        forma: 'Cartão de crédito',
        fornecedor: 'Meta Platforms (exemplo)',
        empreendimento: m >= -4 ? aurora : 'Institucional',
        campanha: m >= -4 ? 'Lançamento Jardim Aurora (exemplo)' : undefined,
        codigo: `FAT-${mes.slice(0, 7)}`,
        primeiroVencimento: diaDoMes(proximo, 10),
      })
      gastos.push({
        descricao: `Google Ads — rede de pesquisa ${mes.slice(5, 7)}/${mes.slice(0, 4)}`,
        data: diaDoMes(mes, 8),
        valor: 420_000 + variacao(i + 40, 190_000),
        categoria: 'Mídia digital',
        forma: 'Cartão de crédito',
        fornecedor: 'Google Ads (exemplo)',
        empreendimento: i % 2 ? vistaVerde : aurora,
        primeiroVencimento: diaDoMes(proximo, 10),
      })
      // Manutenção e limpeza do stand, todo mês por Pix.
      if (m >= -5) {
        gastos.push({
          descricao: 'Limpeza e manutenção do stand de vendas',
          data: diaDoMes(mes, 3),
          valor: 118_000 + variacao(i + 80, 12_000),
          categoria: 'Stand de vendas',
          forma: 'Pix',
          fornecedor: 'Limpeza Total Serviços (exemplo)',
          empreendimento: aurora,
          primeiroVencimento: diaDoMes(mes, 3),
        })
      }
      // Impressos a cada três meses, no boleto.
      if (i % 3 === 0) {
        gastos.push({
          descricao: 'Panfletos e folders para ação de rua',
          data: diaDoMes(mes, 14),
          valor: 280_000 + variacao(i + 120, 90_000),
          categoria: 'Gráfica e impressos',
          forma: 'Boleto',
          fornecedor: 'Gráfica Pontual (exemplo)',
          empreendimento: i % 2 ? vistaVerde : aurora,
          codigo: `NF ${4100 + i}`,
          primeiroVencimento: diaDoMes(mes, 28),
        })
      }
      // Agência a cada três meses.
      if (i % 3 === 2) {
        gastos.push({
          descricao: 'Criação de peças e vídeo para redes sociais',
          data: diaDoMes(mes, m === 0 ? 25 : 18),
          valor: 750_000,
          categoria: 'Criação e produção',
          forma: 'Boleto',
          fornecedor: 'Agência Criativa Norte (exemplo)',
          empreendimento: aurora,
          campanha: m >= -4 ? 'Lançamento Jardim Aurora (exemplo)' : undefined,
          codigo: `NFS-e ${880 + i}`,
          primeiroVencimento: somarDias(diaDoMes(mes, m === 0 ? 25 : 18), 10),
        })
      }
    }

    const mesAnterior = inicioDoMes(somarMeses(dia, -1))
    const doisAtras = inicioDoMes(somarMeses(dia, -2))
    gastos.push(
      {
        descricao: 'Montagem e decoração do stand — Jardim Aurora',
        data: diaDoMes(doisAtras, 18),
        valor: 2_400_000,
        categoria: 'Stand de vendas',
        forma: 'Boleto',
        fornecedor: 'Stand & Cia Montagens (exemplo)',
        empreendimento: aurora,
        campanha: 'Lançamento Jardim Aurora (exemplo)',
        codigo: 'NF 2231',
        parcelas: 3,
        primeiroVencimento: diaDoMes(doisAtras, 20),
        naoPagar: [3],
      },
      {
        descricao: 'Coquetel de lançamento para corretores',
        data: diaDoMes(inicioDoMes(somarMeses(dia, -4)), 22),
        valor: 1_280_000,
        categoria: 'Eventos e ações',
        forma: 'Pix',
        fornecedor: 'Buffet Sabor & Arte (exemplo)',
        empreendimento: aurora,
        campanha: 'Lançamento Jardim Aurora (exemplo)',
        primeiroVencimento: diaDoMes(inicioDoMes(somarMeses(dia, -4)), 22),
      },
      {
        descricao: 'Canecas e ecobags personalizadas para o feirão',
        data: diaDoMes(mesAnterior, 12),
        valor: 345_000,
        categoria: 'Brindes',
        forma: 'Pix',
        fornecedor: 'Brindes Nordeste (exemplo)',
        empreendimento: 'Institucional',
        campanha: 'Feirão de Imóveis (exemplo)',
        primeiroVencimento: diaDoMes(mesAnterior, 12),
      },
      {
        descricao: 'Spots de rádio — feirão de imóveis',
        data: somarDias(dia, -2),
        valor: 600_000,
        categoria: 'Mídia off-line',
        forma: 'Boleto',
        fornecedor: 'Rádio Cidade FM (exemplo)',
        empreendimento: 'Institucional',
        campanha: 'Feirão de Imóveis (exemplo)',
        codigo: 'PI 0917',
        parcelas: 2,
        primeiroVencimento: somarDias(dia, 3),
      },
    )

    gastos.sort((a, b) => a.data.localeCompare(b.data))

    await db.transaction(async (tx) => {
      for (const g of gastos) {
        const ref = (mapaIds: Map<string, number>, nome: string) => {
          const id = mapaIds.get(nome)
          if (!id) throw new Error(`cadastro não encontrado: ${nome}`)
          return id
        }
        const criadoEm = new Date(`${g.data}T13:00:00Z`)
        const [novo] = await tx
          .insert(lancamentos)
          .values({
            setorId: marketing.id,
            descricao: g.descricao,
            valorCentavos: g.valor,
            dataGasto: g.data,
            categoriaId: ref(idCategoria, g.categoria),
            formaPagamentoId: ref(idForma, g.forma),
            empreendimentoId: ref(idEmp, g.empreendimento),
            fornecedorId: ref(idForn, g.fornecedor),
            campanhaId: g.campanha ? ref(idCamp, g.campanha) : null,
            codigoIdentificacao: g.codigo ?? null,
            criadoPor: admin.id,
            criadoEm,
          })
          .returning({ id: lancamentos.id })

        const geradas = gerarParcelas(g.valor, g.parcelas ?? 1, g.primeiroVencimento)
        await tx.insert(parcelas).values(
          geradas.map((p, n) => ({
            lancamentoId: novo!.id,
            numero: n + 1,
            ...p,
            pagoEm: p.vencimento <= dia && !g.naoPagar?.includes(n + 1) ? p.vencimento : null,
          })),
        )
        await tx.insert(eventos).values({
          lancamentoId: novo!.id,
          tipo: 'criado',
          usuarioId: admin.id,
          em: criadoEm,
        })
      }
    })

    console.log(`${gastos.length} lançamentos de exemplo criados`)
  }
} finally {
  await pool.end()
}

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias, type PgTable } from 'drizzle-orm/pg-core'
import { enxergaSetor, exigirEdicaoNoSetor, setoresVisiveis } from '../common/acesso.js'
import { erroDeValidacao } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import type { ErroValidacao } from '../contracts/comum.js'
import { fimDoMes, hoje, inicioDoMes, somarDias, somarMeses } from '../contracts/datas.js'
import { normalizarDocumento } from '../contracts/documento.js'
import type {
  Alteracao,
  CriarLancamentoInput,
  FiltrosLancamentos,
  Indicadores,
  LancamentoDetalhe,
  LancamentoInput,
  LancamentoResumo,
  ListaLancamentos,
  ParcelaInput,
  PossivelDuplicado,
  RespostaDuplicidade,
  SituacaoLancamento,
} from '../contracts/lancamentos.js'
import { situacaoPagamento } from '../contracts/parcelas.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
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
} from '../db/schema.js'

/**
 * Totais das parcelas por lançamento, calculados no banco.
 *
 * "Vencida" depende do dia de hoje em São Paulo, que entra como parâmetro: o
 * servidor e o banco rodam em UTC, e às 21h de Brasília o `current_date` deles
 * já é amanhã.
 */
function resumoParcelas(db: Database, hojeIso: string) {
  return db
    .select({
      lancamentoId: parcelas.lancamentoId,
      quantidade: sql<number>`count(*)::int`.as('quantidade'),
      pagas: sql<number>`count(${parcelas.pagoEm})::int`.as('pagas'),
      vencidas:
        sql<number>`(count(*) filter (where ${parcelas.pagoEm} is null and ${parcelas.vencimento} < ${hojeIso}::date))::int`.as(
          'vencidas',
        ),
      proximoVencimento: sql<
        string | null
      >`min(${parcelas.vencimento}) filter (where ${parcelas.pagoEm} is null)`.as(
        'proximo_vencimento',
      ),
      emAbertoCentavos:
        sql<string>`coalesce(sum(${parcelas.valorCentavos}) filter (where ${parcelas.pagoEm} is null), 0)::bigint`.as(
          'em_aberto_centavos',
        ),
    })
    .from(parcelas)
    .groupBy(parcelas.lancamentoId)
    .as('resumo')
}
type Resumo = ReturnType<typeof resumoParcelas>

/** Colunas da lista, com os nomes dos cadastros já resolvidos. */
function camposResumo(resumo: Resumo) {
  return {
    id: lancamentos.id,
    setorId: setores.id,
    setorNome: setores.nome,
    descricao: lancamentos.descricao,
    valorCentavos: lancamentos.valorCentavos,
    dataGasto: lancamentos.dataGasto,
    categoriaId: categorias.id,
    categoriaNome: categorias.nome,
    formaPagamentoId: formasPagamento.id,
    formaPagamentoNome: formasPagamento.nome,
    empreendimentoId: empreendimentos.id,
    empreendimentoNome: empreendimentos.nome,
    fornecedorId: fornecedores.id,
    fornecedorNome: fornecedores.nome,
    fornecedorDocumento: fornecedores.documento,
    campanhaId: campanhas.id,
    campanhaNome: campanhas.nome,
    codigoIdentificacao: lancamentos.codigoIdentificacao,
    situacao: lancamentos.situacao,
    criadoEm: lancamentos.criadoEm,
    parcelasQtd: resumo.quantidade,
    parcelasPagas: resumo.pagas,
    parcelasVencidas: resumo.vencidas,
    proximoVencimento: resumo.proximoVencimento,
    emAbertoCentavos: resumo.emAbertoCentavos,
  }
}

interface LinhaResumo {
  id: number
  setorId: number
  setorNome: string
  descricao: string
  valorCentavos: number
  dataGasto: string
  categoriaId: number
  categoriaNome: string
  formaPagamentoId: number
  formaPagamentoNome: string
  empreendimentoId: number
  empreendimentoNome: string
  fornecedorId: number
  fornecedorNome: string
  fornecedorDocumento: string | null
  campanhaId: number | null
  campanhaNome: string | null
  codigoIdentificacao: string | null
  situacao: SituacaoLancamento
  criadoEm: Date
  parcelasQtd: number
  parcelasPagas: number
  parcelasVencidas: number
  proximoVencimento: string | null
  emAbertoCentavos: string | number
}

/** Data vinda de agregação em SQL: o driver pode entregar texto ou Date, a API sempre devolve "AAAA-MM-DD". */
function comoData(valor: string | Date | null): string | null {
  if (valor === null) return null
  if (valor instanceof Date) {
    const y = valor.getFullYear()
    const m = String(valor.getMonth() + 1).padStart(2, '0')
    const d = String(valor.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return valor.slice(0, 10)
}

function paraResumo(r: LinhaResumo): LancamentoResumo {
  const quantidade = Number(r.parcelasQtd)
  const pagas = Number(r.parcelasPagas)
  return {
    id: r.id,
    setor: { id: r.setorId, nome: r.setorNome },
    descricao: r.descricao,
    valorCentavos: r.valorCentavos,
    dataGasto: r.dataGasto,
    categoria: { id: r.categoriaId, nome: r.categoriaNome },
    formaPagamento: { id: r.formaPagamentoId, nome: r.formaPagamentoNome },
    empreendimento: { id: r.empreendimentoId, nome: r.empreendimentoNome },
    fornecedor: { id: r.fornecedorId, nome: r.fornecedorNome, documento: r.fornecedorDocumento },
    campanha: r.campanhaId === null ? null : { id: r.campanhaId, nome: r.campanhaNome ?? '' },
    codigoIdentificacao: r.codigoIdentificacao,
    situacao: r.situacao,
    pagamento: {
      situacao: situacaoPagamento({
        parcelas: quantidade,
        pagas,
        vencidas: Number(r.parcelasVencidas),
      }),
      parcelas: quantidade,
      pagas,
      proximoVencimento: comoData(r.proximoVencimento),
      emAbertoCentavos: Number(r.emAbertoCentavos),
    },
    criadoEm: r.criadoEm.toISOString(),
  }
}

/** Escapa curinga do ILIKE: quem busca "100%" quer o texto, não "100 seguido de qualquer coisa". */
const termoBusca = (texto: string): string => `%${texto.replace(/[\\%_]/g, '\\$&')}%`

/** Estado gravado de um lançamento, para comparar com a edição. */
interface Atual {
  id: number
  setorId: number
  descricao: string
  valorCentavos: number
  dataGasto: string
  categoriaId: number
  formaPagamentoId: number
  empreendimentoId: number
  fornecedorId: number
  campanhaId: number | null
  codigoIdentificacao: string | null
  observacao: string | null
  situacao: SituacaoLancamento
  parcelas: ParcelaInput[]
}

/** Campos de referência: o histórico guarda o nome de antes e de depois, não o id. */
const REFERENCIAS: Array<{
  campo: keyof Atual & keyof LancamentoInput
  rotulo: string
  tabela: PgTable
}> = [
  { campo: 'setorId', rotulo: 'Setor', tabela: setores },
  { campo: 'categoriaId', rotulo: 'Categoria', tabela: categorias },
  { campo: 'formaPagamentoId', rotulo: 'Forma de pagamento', tabela: formasPagamento },
  { campo: 'empreendimentoId', rotulo: 'Empreendimento', tabela: empreendimentos },
  { campo: 'fornecedorId', rotulo: 'Fornecedor', tabela: fornecedores },
  { campo: 'campanhaId', rotulo: 'Campanha', tabela: campanhas },
]

const SIMPLES: Array<{ campo: keyof Atual & keyof LancamentoInput; rotulo: string }> = [
  { campo: 'descricao', rotulo: 'Descrição' },
  { campo: 'valorCentavos', rotulo: 'Valor' },
  { campo: 'dataGasto', rotulo: 'Data do gasto' },
  { campo: 'codigoIdentificacao', rotulo: 'Código de identificação' },
  { campo: 'observacao', rotulo: 'Observação' },
]

const chaveParcelas = (lista: ParcelaInput[]): string =>
  JSON.stringify(lista.map((p) => [p.valorCentavos, p.vencimento, p.pagoEm]))

@Injectable()
export class LancamentosService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listar(usuario: UsuarioSessao, filtros: FiltrosLancamentos): Promise<ListaLancamentos> {
    const resumo = resumoParcelas(this.db, hoje())
    const where = this.condicoes(usuario, filtros, resumo)

    const [linhas, totais] = await Promise.all([
      this.db
        .select(camposResumo(resumo))
        .from(lancamentos)
        .innerJoin(setores, eq(setores.id, lancamentos.setorId))
        .innerJoin(categorias, eq(categorias.id, lancamentos.categoriaId))
        .innerJoin(formasPagamento, eq(formasPagamento.id, lancamentos.formaPagamentoId))
        .innerJoin(empreendimentos, eq(empreendimentos.id, lancamentos.empreendimentoId))
        .innerJoin(fornecedores, eq(fornecedores.id, lancamentos.fornecedorId))
        .leftJoin(campanhas, eq(campanhas.id, lancamentos.campanhaId))
        .innerJoin(resumo, eq(resumo.lancamentoId, lancamentos.id))
        .where(where)
        .orderBy(desc(lancamentos.dataGasto), desc(lancamentos.id))
        .limit(filtros.porPagina)
        .offset((filtros.pagina - 1) * filtros.porPagina),
      this.db
        .select({
          total: sql<number>`count(*)::int`,
          soma: sql<string>`coalesce(sum(${lancamentos.valorCentavos}), 0)::bigint`,
          emAberto: sql<string>`coalesce(sum(${resumo.emAbertoCentavos}), 0)::bigint`,
        })
        .from(lancamentos)
        .innerJoin(fornecedores, eq(fornecedores.id, lancamentos.fornecedorId))
        .innerJoin(resumo, eq(resumo.lancamentoId, lancamentos.id))
        .where(where),
    ])

    return {
      itens: linhas.map(paraResumo),
      total: Number(totais[0]?.total ?? 0),
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
      somaCentavos: Number(totais[0]?.soma ?? 0),
      emAbertoCentavos: Number(totais[0]?.emAberto ?? 0),
    }
  }

  async detalhar(usuario: UsuarioSessao, id: number): Promise<LancamentoDetalhe> {
    const resumo = resumoParcelas(this.db, hoje())
    const criador = alias(usuarios, 'criador')
    const cancelador = alias(usuarios, 'cancelador')

    const [linha] = await this.db
      .select({
        ...camposResumo(resumo),
        observacao: lancamentos.observacao,
        atualizadoEm: lancamentos.atualizadoEm,
        criadoPorId: criador.id,
        criadoPorNome: criador.nome,
        canceladoEm: lancamentos.canceladoEm,
        motivoCancelamento: lancamentos.motivoCancelamento,
        canceladoPorId: cancelador.id,
        canceladoPorNome: cancelador.nome,
      })
      .from(lancamentos)
      .innerJoin(setores, eq(setores.id, lancamentos.setorId))
      .innerJoin(categorias, eq(categorias.id, lancamentos.categoriaId))
      .innerJoin(formasPagamento, eq(formasPagamento.id, lancamentos.formaPagamentoId))
      .innerJoin(empreendimentos, eq(empreendimentos.id, lancamentos.empreendimentoId))
      .innerJoin(fornecedores, eq(fornecedores.id, lancamentos.fornecedorId))
      .leftJoin(campanhas, eq(campanhas.id, lancamentos.campanhaId))
      .innerJoin(resumo, eq(resumo.lancamentoId, lancamentos.id))
      .innerJoin(criador, eq(criador.id, lancamentos.criadoPor))
      .leftJoin(cancelador, eq(cancelador.id, lancamentos.canceladoPor))
      .where(eq(lancamentos.id, id))
      .limit(1)

    // Setor que a pessoa não enxerga responde como inexistente: não confirma que o número existe.
    if (!linha || !enxergaSetor(usuario, linha.setorId)) {
      throw new NotFoundException('Lançamento não encontrado')
    }

    const [listaParcelas, listaEventos] = await Promise.all([
      this.db
        .select({
          id: parcelas.id,
          numero: parcelas.numero,
          valorCentavos: parcelas.valorCentavos,
          vencimento: parcelas.vencimento,
          pagoEm: parcelas.pagoEm,
        })
        .from(parcelas)
        .where(eq(parcelas.lancamentoId, id))
        .orderBy(asc(parcelas.numero)),
      this.db
        .select({
          id: eventos.id,
          tipo: eventos.tipo,
          em: eventos.em,
          dados: eventos.dados,
          usuarioId: usuarios.id,
          usuarioNome: usuarios.nome,
        })
        .from(eventos)
        .innerJoin(usuarios, eq(usuarios.id, eventos.usuarioId))
        .where(eq(eventos.lancamentoId, id))
        .orderBy(desc(eventos.em), desc(eventos.id)),
    ])

    const cancelamento =
      linha.canceladoEm && linha.canceladoPorId !== null
        ? {
            em: linha.canceladoEm.toISOString(),
            por: { id: linha.canceladoPorId, nome: linha.canceladoPorNome ?? '' },
            motivo: linha.motivoCancelamento ?? '',
          }
        : null

    return {
      ...paraResumo(linha),
      observacao: linha.observacao,
      parcelas: listaParcelas,
      eventos: listaEventos.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        em: e.em.toISOString(),
        usuario: { id: e.usuarioId, nome: e.usuarioNome },
        dados: e.dados ?? null,
      })),
      criadoPor: { id: linha.criadoPorId, nome: linha.criadoPorNome },
      atualizadoEm: linha.atualizadoEm?.toISOString() ?? null,
      cancelamento,
    }
  }

  async criar(usuario: UsuarioSessao, entrada: CriarLancamentoInput): Promise<LancamentoDetalhe> {
    exigirEdicaoNoSetor(usuario, entrada.setorId)
    await this.validarEntrada(entrada)

    if (!entrada.confirmarDuplicidade) {
      const duplicados = await this.possiveisDuplicados(entrada)
      if (duplicados.length) {
        const corpo: RespostaDuplicidade = {
          message:
            'Há lançamentos parecidos com este. Confira se não é o mesmo gasto antes de salvar.',
          duplicados,
        }
        throw new ConflictException(corpo)
      }
    }

    const id = await this.db.transaction(async (tx) => {
      const [novo] = await tx
        .insert(lancamentos)
        .values({
          setorId: entrada.setorId,
          descricao: entrada.descricao,
          valorCentavos: entrada.valorCentavos,
          dataGasto: entrada.dataGasto,
          categoriaId: entrada.categoriaId,
          formaPagamentoId: entrada.formaPagamentoId,
          empreendimentoId: entrada.empreendimentoId,
          fornecedorId: entrada.fornecedorId,
          campanhaId: entrada.campanhaId,
          codigoIdentificacao: entrada.codigoIdentificacao,
          observacao: entrada.observacao,
          criadoPor: usuario.id,
        })
        .returning({ id: lancamentos.id })
      const lancamentoId = novo!.id

      await tx
        .insert(parcelas)
        .values(entrada.parcelas.map((p, i) => ({ lancamentoId, numero: i + 1, ...p })))
      await tx.insert(eventos).values({ lancamentoId, tipo: 'criado', usuarioId: usuario.id })
      return lancamentoId
    })

    return this.detalhar(usuario, id)
  }

  /** Substitui todos os campos e as parcelas. O que mudou vai para o histórico, com antes e depois. */
  async atualizar(
    usuario: UsuarioSessao,
    id: number,
    entrada: LancamentoInput,
  ): Promise<LancamentoDetalhe> {
    const atual = await this.carregarAtual(id)
    if (!atual || !enxergaSetor(usuario, atual.setorId)) {
      throw new NotFoundException('Lançamento não encontrado')
    }
    exigirEdicaoNoSetor(usuario, atual.setorId)
    if (entrada.setorId !== atual.setorId) exigirEdicaoNoSetor(usuario, entrada.setorId)
    if (atual.situacao === 'cancelado') {
      throw new ConflictException('Lançamento cancelado não pode ser editado')
    }

    await this.validarEntrada(entrada, atual)
    const alteracoes = await this.alteracoes(atual, entrada)
    if (!alteracoes.length) return this.detalhar(usuario, id)

    await this.db.transaction(async (tx) => {
      await tx
        .update(lancamentos)
        .set({
          setorId: entrada.setorId,
          descricao: entrada.descricao,
          valorCentavos: entrada.valorCentavos,
          dataGasto: entrada.dataGasto,
          categoriaId: entrada.categoriaId,
          formaPagamentoId: entrada.formaPagamentoId,
          empreendimentoId: entrada.empreendimentoId,
          fornecedorId: entrada.fornecedorId,
          campanhaId: entrada.campanhaId,
          codigoIdentificacao: entrada.codigoIdentificacao,
          observacao: entrada.observacao,
          atualizadoPor: usuario.id,
          atualizadoEm: new Date(),
        })
        .where(eq(lancamentos.id, id))

      if (alteracoes.some((a) => a.campo === 'parcelas')) {
        await tx.delete(parcelas).where(eq(parcelas.lancamentoId, id))
        await tx
          .insert(parcelas)
          .values(entrada.parcelas.map((p, i) => ({ lancamentoId: id, numero: i + 1, ...p })))
      }

      await tx
        .insert(eventos)
        .values({ lancamentoId: id, tipo: 'editado', usuarioId: usuario.id, dados: { alteracoes } })
    })

    return this.detalhar(usuario, id)
  }

  /** Cancelar é o "apagar" do sistema: o lançamento sai dos totais, mas continua consultável com o motivo. */
  async cancelar(usuario: UsuarioSessao, id: number, motivo: string): Promise<LancamentoDetalhe> {
    const [atual] = await this.db
      .select({ setorId: lancamentos.setorId, situacao: lancamentos.situacao })
      .from(lancamentos)
      .where(eq(lancamentos.id, id))
    if (!atual || !enxergaSetor(usuario, atual.setorId)) {
      throw new NotFoundException('Lançamento não encontrado')
    }
    exigirEdicaoNoSetor(usuario, atual.setorId)

    await this.db.transaction(async (tx) => {
      const agora = new Date()
      // A condição na própria atualização resolve dois cliques simultâneos: só um cancela.
      const alterados = await tx
        .update(lancamentos)
        .set({
          situacao: 'cancelado',
          canceladoEm: agora,
          canceladoPor: usuario.id,
          motivoCancelamento: motivo,
          atualizadoPor: usuario.id,
          atualizadoEm: agora,
        })
        .where(and(eq(lancamentos.id, id), eq(lancamentos.situacao, 'ativo')))
        .returning({ id: lancamentos.id })
      if (!alterados.length) throw new ConflictException('Este lançamento já está cancelado')

      await tx
        .insert(eventos)
        .values({ lancamentoId: id, tipo: 'cancelado', usuarioId: usuario.id, dados: { motivo } })
    })

    return this.detalhar(usuario, id)
  }

  /** Registra (data) ou desfaz (null) o pagamento de uma parcela. */
  async pagamentoParcela(
    usuario: UsuarioSessao,
    lancamentoId: number,
    parcelaId: number,
    pagoEm: string | null,
  ): Promise<LancamentoDetalhe> {
    const [linha] = await this.db
      .select({
        setorId: lancamentos.setorId,
        situacao: lancamentos.situacao,
        numero: parcelas.numero,
        pagoEm: parcelas.pagoEm,
      })
      .from(parcelas)
      .innerJoin(lancamentos, eq(lancamentos.id, parcelas.lancamentoId))
      .where(and(eq(parcelas.id, parcelaId), eq(parcelas.lancamentoId, lancamentoId)))
    if (!linha || !enxergaSetor(usuario, linha.setorId)) {
      throw new NotFoundException('Parcela não encontrada')
    }
    exigirEdicaoNoSetor(usuario, linha.setorId)
    if (linha.situacao === 'cancelado') {
      throw new ConflictException('Lançamento cancelado não pode ser alterado')
    }
    if (pagoEm && pagoEm > hoje()) {
      throw erroDeValidacao([{ path: 'pagoEm', message: 'O pagamento não pode estar no futuro' }])
    }
    if (linha.pagoEm === pagoEm) return this.detalhar(usuario, lancamentoId)

    await this.db.transaction(async (tx) => {
      await tx.update(parcelas).set({ pagoEm }).where(eq(parcelas.id, parcelaId))
      await tx
        .update(lancamentos)
        .set({ atualizadoPor: usuario.id, atualizadoEm: new Date() })
        .where(eq(lancamentos.id, lancamentoId))
      await tx.insert(eventos).values({
        lancamentoId,
        tipo: pagoEm ? 'pagamento_registrado' : 'pagamento_desfeito',
        usuarioId: usuario.id,
        dados: { parcela: linha.numero, pagoEm },
      })
    })

    return this.detalhar(usuario, lancamentoId)
  }

  /**
   * A faixa de indicadores do topo da lista. Tudo sobre lançamentos ativos: o
   * cancelado não é gasto.
   */
  async indicadores(usuario: UsuarioSessao, setorId?: number): Promise<Indicadores> {
    const dia = hoje()
    const inicioMes = inicioDoMes(dia)
    const mesmoDiaAnterior = somarMeses(dia, -1)
    const inicioAnterior = inicioDoMes(mesmoDiaAnterior)
    const inicioSerie = inicioDoMes(somarMeses(dia, -11))
    const daquiA7 = somarDias(dia, 7)
    const ativos = and(eq(lancamentos.situacao, 'ativo'), this.escopoSetor(usuario, setorId))
    const mes = sql<string>`to_char(${lancamentos.dataGasto}, 'YYYY-MM')`

    const [gasto, serie, abertas] = await Promise.all([
      this.db
        .select({
          atual: sql<string>`coalesce(sum(${lancamentos.valorCentavos}) filter (where ${lancamentos.dataGasto} between ${inicioMes}::date and ${dia}::date), 0)::bigint`,
          anterior: sql<string>`coalesce(sum(${lancamentos.valorCentavos}) filter (where ${lancamentos.dataGasto} between ${inicioAnterior}::date and ${mesmoDiaAnterior}::date), 0)::bigint`,
          lancamentos: sql<number>`(count(*) filter (where ${lancamentos.dataGasto} between ${inicioMes}::date and ${dia}::date))::int`,
        })
        .from(lancamentos)
        .where(ativos),
      this.db
        .select({ mes, centavos: sql<string>`sum(${lancamentos.valorCentavos})::bigint` })
        .from(lancamentos)
        .where(and(ativos, between(lancamentos.dataGasto, inicioSerie, fimDoMes(dia))))
        .groupBy(mes),
      this.db
        .select({
          emAberto: sql<string>`coalesce(sum(${parcelas.valorCentavos}), 0)::bigint`,
          parcelasEmAberto: sql<number>`count(*)::int`,
          vencido: sql<string>`coalesce(sum(${parcelas.valorCentavos}) filter (where ${parcelas.vencimento} < ${dia}::date), 0)::bigint`,
          parcelasVencidas: sql<number>`(count(*) filter (where ${parcelas.vencimento} < ${dia}::date))::int`,
          proximos: sql<string>`coalesce(sum(${parcelas.valorCentavos}) filter (where ${parcelas.vencimento} between ${dia}::date and ${daquiA7}::date), 0)::bigint`,
          parcelasProximas: sql<number>`(count(*) filter (where ${parcelas.vencimento} between ${dia}::date and ${daquiA7}::date))::int`,
        })
        .from(parcelas)
        .innerJoin(lancamentos, eq(lancamentos.id, parcelas.lancamentoId))
        .where(and(isNull(parcelas.pagoEm), ativos)),
    ])

    const porMes = new Map(serie.map((s) => [s.mes, Number(s.centavos)]))
    const g = gasto[0]
    const a = abertas[0]

    return {
      hoje: dia,
      gastoMes: {
        centavos: Number(g?.atual ?? 0),
        anteriorCentavos: Number(g?.anterior ?? 0),
        lancamentos: Number(g?.lancamentos ?? 0),
      },
      serieMensal: Array.from({ length: 12 }, (_, i) => {
        const chave = somarMeses(inicioSerie, i).slice(0, 7)
        return { mes: chave, centavos: porMes.get(chave) ?? 0 }
      }),
      emAberto: { centavos: Number(a?.emAberto ?? 0), parcelas: Number(a?.parcelasEmAberto ?? 0) },
      vencido: { centavos: Number(a?.vencido ?? 0), parcelas: Number(a?.parcelasVencidas ?? 0) },
      proximos7Dias: {
        centavos: Number(a?.proximos ?? 0),
        parcelas: Number(a?.parcelasProximas ?? 0),
      },
    }
  }

  /** Restringe aos setores que a pessoa enxerga; com setor escolhido, só a ele (se ela enxergar). */
  private escopoSetor(usuario: UsuarioSessao, setorId?: number): SQL | undefined {
    const visiveis = setoresVisiveis(usuario)
    if (setorId !== undefined) {
      if (visiveis !== null && !visiveis.includes(setorId)) return sql`false`
      return eq(lancamentos.setorId, setorId)
    }
    if (visiveis === null) return undefined
    return visiveis.length ? inArray(lancamentos.setorId, visiveis) : sql`false`
  }

  private condicoes(
    usuario: UsuarioSessao,
    f: FiltrosLancamentos,
    resumo: Resumo,
  ): SQL | undefined {
    const condicoes: Array<SQL | undefined> = [this.escopoSetor(usuario, f.setorId)]

    if (f.de) condicoes.push(gte(lancamentos.dataGasto, f.de))
    if (f.ate) condicoes.push(lte(lancamentos.dataGasto, f.ate))
    if (f.categoriaId) condicoes.push(eq(lancamentos.categoriaId, f.categoriaId))
    if (f.formaPagamentoId) condicoes.push(eq(lancamentos.formaPagamentoId, f.formaPagamentoId))
    if (f.empreendimentoId) condicoes.push(eq(lancamentos.empreendimentoId, f.empreendimentoId))
    if (f.fornecedorId) condicoes.push(eq(lancamentos.fornecedorId, f.fornecedorId))
    if (f.campanhaId) condicoes.push(eq(lancamentos.campanhaId, f.campanhaId))
    if (f.situacao !== 'todos') condicoes.push(eq(lancamentos.situacao, f.situacao))

    if (f.pagamento === 'pago') condicoes.push(sql`${resumo.pagas} = ${resumo.quantidade}`)
    if (f.pagamento === 'em_aberto') condicoes.push(sql`${resumo.pagas} < ${resumo.quantidade}`)
    if (f.pagamento === 'vencido') condicoes.push(sql`${resumo.vencidas} > 0`)

    if (f.busca) {
      const termo = termoBusca(f.busca)
      const documento = normalizarDocumento(f.busca)
      condicoes.push(
        or(
          ilike(lancamentos.descricao, termo),
          ilike(lancamentos.codigoIdentificacao, termo),
          ilike(fornecedores.nome, termo),
          documento.length >= 3 ? ilike(fornecedores.documento, termoBusca(documento)) : undefined,
        ),
      )
    }

    return and(...condicoes)
  }

  /**
   * Confere o que o esquema sozinho não sabe: se os cadastros existem, estão
   * ativos e pertencem ao setor. Item desativado só é recusado quando é uma
   * escolha nova — lançamento antigo que já apontava para ele continua editável.
   */
  private async validarEntrada(entrada: LancamentoInput, atual?: Atual): Promise<void> {
    const [setor, categoria, forma, empreendimento, fornecedor, campanha] = await Promise.all([
      this.db.select({ ativo: setores.ativo }).from(setores).where(eq(setores.id, entrada.setorId)),
      this.db
        .select({ ativo: categorias.ativo, setorId: categorias.setorId })
        .from(categorias)
        .where(eq(categorias.id, entrada.categoriaId)),
      this.db
        .select({ ativo: formasPagamento.ativo })
        .from(formasPagamento)
        .where(eq(formasPagamento.id, entrada.formaPagamentoId)),
      this.db
        .select({ ativo: empreendimentos.ativo })
        .from(empreendimentos)
        .where(eq(empreendimentos.id, entrada.empreendimentoId)),
      this.db
        .select({ ativo: fornecedores.ativo })
        .from(fornecedores)
        .where(eq(fornecedores.id, entrada.fornecedorId)),
      entrada.campanhaId === null
        ? Promise.resolve([])
        : this.db
            .select({ ativo: campanhas.ativo, setorId: campanhas.setorId })
            .from(campanhas)
            .where(eq(campanhas.id, entrada.campanhaId)),
    ])

    const problemas: ErroValidacao['issues'] = []
    const conferir = (
      path: keyof LancamentoInput,
      item: { ativo: boolean; setorId?: number } | undefined,
      nome: string,
    ) => {
      const novaEscolha = !atual || atual[path as keyof Atual] !== entrada[path]
      if (!item) problemas.push({ path, message: `${nome} não encontrado(a)` })
      else if (item.setorId !== undefined && item.setorId !== entrada.setorId) {
        problemas.push({ path, message: `${nome} de outro setor` })
      } else if (!item.ativo && novaEscolha) {
        problemas.push({ path, message: `${nome} desativado(a)` })
      }
    }

    conferir('setorId', setor[0], 'Setor')
    conferir('categoriaId', categoria[0], 'Categoria')
    conferir('formaPagamentoId', forma[0], 'Forma de pagamento')
    conferir('empreendimentoId', empreendimento[0], 'Empreendimento')
    conferir('fornecedorId', fornecedor[0], 'Fornecedor')
    if (entrada.campanhaId !== null) conferir('campanhaId', campanha[0], 'Campanha')

    const dia = hoje()
    entrada.parcelas.forEach((p, i) => {
      if (p.pagoEm && p.pagoEm > dia) {
        problemas.push({
          path: `parcelas.${i}.pagoEm`,
          message: 'O pagamento não pode estar no futuro',
        })
      }
    })

    if (problemas.length) throw erroDeValidacao(problemas)
  }

  /**
   * Mesmo fornecedor e mesmo código de identificação, ou mesmo fornecedor e
   * mesmo valor com até 7 dias de diferença. Recorrência mensal (a mesma
   * assinatura todo mês) fica de fora do aviso de propósito.
   */
  private possiveisDuplicados(entrada: LancamentoInput): Promise<PossivelDuplicado[]> {
    const mesmoCodigo = entrada.codigoIdentificacao
      ? sql`lower(${lancamentos.codigoIdentificacao}) = lower(${entrada.codigoIdentificacao})`
      : undefined
    const mesmoValorPerto = and(
      eq(lancamentos.valorCentavos, entrada.valorCentavos),
      between(
        lancamentos.dataGasto,
        somarDias(entrada.dataGasto, -7),
        somarDias(entrada.dataGasto, 7),
      ),
    )

    return this.db
      .select({
        id: lancamentos.id,
        descricao: lancamentos.descricao,
        valorCentavos: lancamentos.valorCentavos,
        dataGasto: lancamentos.dataGasto,
        codigoIdentificacao: lancamentos.codigoIdentificacao,
      })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.fornecedorId, entrada.fornecedorId),
          eq(lancamentos.situacao, 'ativo'),
          or(mesmoCodigo, mesmoValorPerto),
        ),
      )
      .orderBy(desc(lancamentos.dataGasto))
      .limit(5)
  }

  private async carregarAtual(id: number): Promise<Atual | undefined> {
    const [linha] = await this.db
      .select({
        id: lancamentos.id,
        setorId: lancamentos.setorId,
        descricao: lancamentos.descricao,
        valorCentavos: lancamentos.valorCentavos,
        dataGasto: lancamentos.dataGasto,
        categoriaId: lancamentos.categoriaId,
        formaPagamentoId: lancamentos.formaPagamentoId,
        empreendimentoId: lancamentos.empreendimentoId,
        fornecedorId: lancamentos.fornecedorId,
        campanhaId: lancamentos.campanhaId,
        codigoIdentificacao: lancamentos.codigoIdentificacao,
        observacao: lancamentos.observacao,
        situacao: lancamentos.situacao,
      })
      .from(lancamentos)
      .where(eq(lancamentos.id, id))
    if (!linha) return undefined

    const lista = await this.db
      .select({
        valorCentavos: parcelas.valorCentavos,
        vencimento: parcelas.vencimento,
        pagoEm: parcelas.pagoEm,
      })
      .from(parcelas)
      .where(eq(parcelas.lancamentoId, id))
      .orderBy(asc(parcelas.numero))

    return { ...linha, parcelas: lista }
  }

  private async alteracoes(atual: Atual, entrada: LancamentoInput): Promise<Alteracao[]> {
    const lista: Alteracao[] = []

    for (const { campo, rotulo } of SIMPLES) {
      if (atual[campo] !== entrada[campo]) {
        lista.push({ campo, rotulo, de: atual[campo], para: entrada[campo] })
      }
    }

    for (const { campo, rotulo, tabela } of REFERENCIAS) {
      const de = atual[campo] as number | null
      const para = entrada[campo] as number | null
      if (de !== para) {
        const [nomeDe, nomePara] = await Promise.all([
          this.nomeDe(tabela, de),
          this.nomeDe(tabela, para),
        ])
        lista.push({ campo, rotulo, de: nomeDe, para: nomePara })
      }
    }

    if (chaveParcelas(atual.parcelas) !== chaveParcelas(entrada.parcelas)) {
      lista.push({
        campo: 'parcelas',
        rotulo: 'Parcelas',
        de: atual.parcelas,
        para: entrada.parcelas,
      })
    }

    return lista
  }

  private async nomeDe(tabela: PgTable, id: number | null): Promise<string | null> {
    if (id === null) return null
    const { rows } = await this.db.execute<{ nome: string }>(
      sql`select nome from ${tabela} where id = ${id}`,
    )
    return rows[0]?.nome ?? null
  }
}

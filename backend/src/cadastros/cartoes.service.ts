import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { enxergaSetor, escopoDeSetor, exigirEdicaoNoSetor } from '../common/acesso.js'
import { ehViolacaoUnica } from '../common/erros-db.js'
import { erroDeValidacao } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import type {
  Cartao,
  EditarCartao,
  EditarGastoFixo,
  GastoFixo,
  NovaRecarga,
  NovoCartao,
  NovoGastoFixo,
} from '../contracts/cadastros.js'
import type { SituacaoCartoes } from '../contracts/cartoes.js'
import { FUSO, fimDoMes, hoje } from '../contracts/datas.js'
import type { ErroValidacao } from '../contracts/comum.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import {
  cartoes,
  categorias,
  empreendimentos,
  formasPagamento,
  fornecedores,
  gastosFixos,
  lancamentos,
  recargasCartao,
  setores,
} from '../db/schema.js'

const CARTAO_REPETIDO = 'Já existe um cartão com esse nome neste setor'

/** O dia (em São Paulo) em que o registro foi cadastrado. */
const diaDoCadastro = (coluna: PgColumn): SQL => sql`(${coluna} at time zone ${FUSO})::date`

/** Os cartões (com os gastos fixos de cada um) que passam no filtro de setor. */
export async function listarCartoes(db: Database, filtroSetor?: SQL): Promise<Cartao[]> {
  const lista = await db
    .select({
      id: cartoes.id,
      setorId: cartoes.setorId,
      nome: cartoes.nome,
      final: cartoes.final,
      formaPagamentoId: cartoes.formaPagamentoId,
      recarga: cartoes.recarga,
      orcamentoMensalCentavos: cartoes.orcamentoMensalCentavos,
      diaFechamento: cartoes.diaFechamento,
      diaVencimento: cartoes.diaVencimento,
      ativo: cartoes.ativo,
    })
    .from(cartoes)
    .where(filtroSetor)
    .orderBy(desc(cartoes.ativo), asc(cartoes.nome))
  if (!lista.length) return []

  const fixos = await db
    .select({
      id: gastosFixos.id,
      cartaoId: gastosFixos.cartaoId,
      descricao: gastosFixos.descricao,
      valorCentavos: gastosFixos.valorCentavos,
      diaCobranca: gastosFixos.diaCobranca,
      ativo: gastosFixos.ativo,
      fornecedorId: fornecedores.id,
      fornecedorNome: fornecedores.nome,
      categoriaId: categorias.id,
      categoriaNome: categorias.nome,
      empreendimentoId: empreendimentos.id,
      empreendimentoNome: empreendimentos.nome,
    })
    .from(gastosFixos)
    .innerJoin(fornecedores, eq(fornecedores.id, gastosFixos.fornecedorId))
    .innerJoin(categorias, eq(categorias.id, gastosFixos.categoriaId))
    .innerJoin(empreendimentos, eq(empreendimentos.id, gastosFixos.empreendimentoId))
    .where(
      inArray(
        gastosFixos.cartaoId,
        lista.map((c) => c.id),
      ),
    )
    .orderBy(desc(gastosFixos.ativo), asc(gastosFixos.diaCobranca), asc(gastosFixos.descricao))

  const paraGastoFixo = (f: (typeof fixos)[number]): GastoFixo => ({
    id: f.id,
    cartaoId: f.cartaoId,
    descricao: f.descricao,
    valorCentavos: f.valorCentavos,
    diaCobranca: f.diaCobranca,
    fornecedor: { id: f.fornecedorId, nome: f.fornecedorNome },
    categoria: { id: f.categoriaId, nome: f.categoriaNome },
    empreendimento: { id: f.empreendimentoId, nome: f.empreendimentoNome },
    ativo: f.ativo,
  })

  const recargas = await db
    .select({
      id: recargasCartao.id,
      cartaoId: recargasCartao.cartaoId,
      data: recargasCartao.data,
      valorCentavos: recargasCartao.valorCentavos,
      observacao: recargasCartao.observacao,
    })
    .from(recargasCartao)
    .where(
      and(
        inArray(
          recargasCartao.cartaoId,
          lista.map((c) => c.id),
        ),
        isNull(recargasCartao.removidaEm),
      ),
    )
    .orderBy(desc(recargasCartao.data), desc(recargasCartao.id))

  return lista.map((c) => ({
    ...c,
    gastosFixos: fixos.filter((f) => f.cartaoId === c.id).map(paraGastoFixo),
    recargas: recargas.filter((r) => r.cartaoId === c.id),
  }))
}

/*
  Cartão e orçamento são decisão de gestão: só o admin cria e altera. Gasto
  fixo muda no dia a dia (assinatura nova, cancelada): quem lança no setor
  do cartão pode mexer.
*/
@Injectable()
export class CartoesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async criarCartao(usuario: UsuarioSessao, dados: NovoCartao): Promise<Cartao> {
    this.exigirAdmin(usuario)
    const [setor] = await this.db
      .select({ id: setores.id })
      .from(setores)
      .where(eq(setores.id, dados.setorId))
    const problemas: ErroValidacao['issues'] = []
    if (!setor) problemas.push({ path: 'setorId', message: 'Setor não encontrado' })
    problemas.push(...(await this.conferirForma(dados.formaPagamentoId, true)))
    if (problemas.length) throw erroDeValidacao(problemas)

    try {
      // Cartão de recarga avulsa vive do saldo: não tem orçamento mensal.
      const valores = dados.recarga === 'avulsa' ? { ...dados, orcamentoMensalCentavos: 0 } : dados
      const [novo] = await this.db.insert(cartoes).values(valores).returning({ id: cartoes.id })
      return this.carregar(novo!.id)
    } catch (err) {
      if (ehViolacaoUnica(err)) throw new ConflictException(CARTAO_REPETIDO)
      throw err
    }
  }

  async editarCartao(usuario: UsuarioSessao, id: number, mudancas: EditarCartao): Promise<Cartao> {
    this.exigirAdmin(usuario)
    const [atual] = await this.db.select().from(cartoes).where(eq(cartoes.id, id))
    if (!atual) throw new NotFoundException('Cartão não encontrado')

    const problemas: ErroValidacao['issues'] = []
    if (mudancas.formaPagamentoId !== undefined) {
      problemas.push(
        ...(await this.conferirForma(
          mudancas.formaPagamentoId,
          mudancas.formaPagamentoId !== atual.formaPagamentoId,
        )),
      )
    }
    // Fechamento e vencimento valem juntos: confere o estado final, não só o que mudou.
    const fechamento =
      mudancas.diaFechamento !== undefined ? mudancas.diaFechamento : atual.diaFechamento
    const vencimento =
      mudancas.diaVencimento !== undefined ? mudancas.diaVencimento : atual.diaVencimento
    if ((fechamento === null) !== (vencimento === null)) {
      problemas.push({
        path: 'diaVencimento',
        message: 'Informe o fechamento e o vencimento da fatura juntos (ou nenhum dos dois)',
      })
    }
    if (problemas.length) throw erroDeValidacao(problemas)

    const campos = Object.fromEntries(
      Object.entries(mudancas).filter(([, valor]) => valor !== undefined),
    ) as Partial<typeof cartoes.$inferInsert>
    if ((mudancas.recarga ?? atual.recarga) === 'avulsa') campos.orcamentoMensalCentavos = 0
    try {
      if (Object.keys(campos).length) {
        await this.db.update(cartoes).set(campos).where(eq(cartoes.id, id))
      }
      return this.carregar(id)
    } catch (err) {
      if (ehViolacaoUnica(err)) throw new ConflictException(CARTAO_REPETIDO)
      throw err
    }
  }

  async criarGastoFixo(usuario: UsuarioSessao, dados: NovoGastoFixo): Promise<Cartao> {
    const cartao = await this.cartaoVisivel(usuario, dados.cartaoId)
    exigirEdicaoNoSetor(usuario, cartao.setorId)
    await this.conferirReferencias(cartao.setorId, dados)
    await this.db.insert(gastosFixos).values(dados)
    return this.carregar(cartao.id)
  }

  async editarGastoFixo(
    usuario: UsuarioSessao,
    id: number,
    mudancas: EditarGastoFixo,
  ): Promise<Cartao> {
    const [atual] = await this.db.select().from(gastosFixos).where(eq(gastosFixos.id, id))
    if (!atual) throw new NotFoundException('Gasto fixo não encontrado')
    const cartao = await this.cartaoVisivel(usuario, atual.cartaoId)
    exigirEdicaoNoSetor(usuario, cartao.setorId)
    await this.conferirReferencias(cartao.setorId, mudancas, atual)

    const campos = Object.fromEntries(
      Object.entries(mudancas).filter(([, valor]) => valor !== undefined),
    ) as Partial<typeof gastosFixos.$inferInsert>
    if (Object.keys(campos).length) {
      await this.db.update(gastosFixos).set(campos).where(eq(gastosFixos.id, id))
    }
    return this.carregar(cartao.id)
  }

  /** Recarga é do dia a dia: quem lança no setor do cartão registra. */
  async criarRecarga(usuario: UsuarioSessao, dados: NovaRecarga): Promise<Cartao> {
    const cartao = await this.cartaoVisivel(usuario, dados.cartaoId)
    exigirEdicaoNoSetor(usuario, cartao.setorId)
    const problemas: ErroValidacao['issues'] = []
    if (cartao.recarga !== 'avulsa') {
      problemas.push({
        path: 'cartaoId',
        message: 'Este cartão tem orçamento mensal; recarga é só para cartão de recarga avulsa',
      })
    } else if (!cartao.ativo) {
      problemas.push({ path: 'cartaoId', message: 'Cartão desativado' })
    }
    if (dados.data > hoje()) {
      problemas.push({ path: 'data', message: 'A recarga não pode ter data no futuro' })
    }
    if (problemas.length) throw erroDeValidacao(problemas)
    await this.db.insert(recargasCartao).values({ ...dados, criadoPor: usuario.id })
    return this.carregar(cartao.id)
  }

  /** Recarga registrada errada sai do saldo; a linha fica, com quem tirou e quando. */
  async removerRecarga(usuario: UsuarioSessao, id: number): Promise<Cartao> {
    const [recarga] = await this.db.select().from(recargasCartao).where(eq(recargasCartao.id, id))
    if (!recarga) throw new NotFoundException('Recarga não encontrada')
    const cartao = await this.cartaoVisivel(usuario, recarga.cartaoId)
    exigirEdicaoNoSetor(usuario, cartao.setorId)
    if (!recarga.removidaEm) {
      await this.db
        .update(recargasCartao)
        .set({ removidaEm: new Date(), removidaPor: usuario.id })
        .where(eq(recargasCartao.id, id))
    }
    return this.carregar(cartao.id)
  }

  /**
   * A situação de cada cartão num mês, pela data do gasto, e o saldo de hoje
   * dos de recarga avulsa. O cartão é compromisso e conta o mês inteiro: o
   * fixo lançado para o dia 15 já está comprometido no dia 1.
   */
  async situacao(usuario: UsuarioSessao, setorId?: number, mes?: string): Promise<SituacaoCartoes> {
    const dia = hoje()
    const referencia = mes ?? dia.slice(0, 7)
    const inicio = `${referencia}-01`
    const fim = fimDoMes(inicio)
    const somaSe = (condicao: SQL) =>
      sql<string>`coalesce(sum(${lancamentos.valorCentavos}) filter (where ${condicao}), 0)::bigint`

    // Gasto fixo "lançado no mês": tem lançamento ativo com data do gasto no mês.
    const lancadoNoMes = sql`select 1 from ${lancamentos} where ${lancamentos.gastoFixoId} = ${gastosFixos.id} and ${lancamentos.situacao} = 'ativo' and ${lancamentos.dataGasto} between ${inicio}::date and ${fim}::date`
    // Cartão que teve gasto no mês aparece mesmo que tenha sido desativado depois.
    const cartaoUsadoNoMes = sql`exists (select 1 from ${lancamentos} where ${lancamentos.cartaoId} = ${cartoes.id} and ${lancamentos.situacao} = 'ativo' and ${lancamentos.dataGasto} between ${inicio}::date and ${fim}::date)`

    const [lista, gastoPorCartao, fixosPorCartao, recargasPorCartao] = await Promise.all([
      this.db
        .select({
          id: cartoes.id,
          recarga: cartoes.recarga,
          orcamentoCentavos: cartoes.orcamentoMensalCentavos,
          // Num mês passado, cartão cadastrado depois dele não entra.
          noMes: sql<boolean>`(${cartoes.ativo} and ${diaDoCadastro(cartoes.criadoEm)} <= ${fim}::date) or ${cartaoUsadoNoMes}`,
        })
        .from(cartoes)
        .where(escopoDeSetor(usuario, cartoes.setorId, setorId)),
      // O lançado no mês e, para o saldo do avulso, o de antes do mês e o de até hoje.
      this.db
        .select({
          cartaoId: lancamentos.cartaoId,
          noMes: somaSe(sql`${lancamentos.dataGasto} between ${inicio}::date and ${fim}::date`),
          antes: somaSe(sql`${lancamentos.dataGasto} < ${inicio}::date`),
          ateHoje: somaSe(sql`${lancamentos.dataGasto} <= ${dia}::date`),
        })
        .from(lancamentos)
        .where(
          and(
            eq(lancamentos.situacao, 'ativo'),
            escopoDeSetor(usuario, lancamentos.setorId, setorId),
            isNotNull(lancamentos.cartaoId),
          ),
        )
        .groupBy(lancamentos.cartaoId),
      this.db
        .select({
          cartaoId: gastosFixos.cartaoId,
          centavos: sql<string>`sum(${gastosFixos.valorCentavos})::bigint`,
          pendentes: sql<number>`(count(*) filter (where not exists (${lancadoNoMes})))::int`,
          pendentesCentavos: sql<string>`coalesce(sum(${gastosFixos.valorCentavos}) filter (where not exists (${lancadoNoMes})), 0)::bigint`,
        })
        .from(gastosFixos)
        // Gasto fixo cadastrado depois do mês não estava "a lançar" nele.
        .where(and(eq(gastosFixos.ativo, true), lte(diaDoCadastro(gastosFixos.criadoEm), fim)))
        .groupBy(gastosFixos.cartaoId),
      // Recarga nunca tem data no futuro: o total é o que entrou até hoje.
      this.db
        .select({
          cartaoId: recargasCartao.cartaoId,
          antes: sql<string>`coalesce(sum(${recargasCartao.valorCentavos}) filter (where ${recargasCartao.data} < ${inicio}::date), 0)::bigint`,
          noMes: sql<string>`coalesce(sum(${recargasCartao.valorCentavos}) filter (where ${recargasCartao.data} between ${inicio}::date and ${fim}::date), 0)::bigint`,
          total: sql<string>`sum(${recargasCartao.valorCentavos})::bigint`,
        })
        .from(recargasCartao)
        .where(isNull(recargasCartao.removidaEm))
        .groupBy(recargasCartao.cartaoId),
    ])

    const gastoDe = (id: number) => gastoPorCartao.find((g) => g.cartaoId === id)
    const recargasDe = (id: number) => recargasPorCartao.find((r) => r.cartaoId === id)

    return {
      hoje: dia,
      mes: referencia,
      cartoes: lista
        .filter((c) => c.noMes)
        .map((c) => {
          const gasto = gastoDe(c.id)
          const recargas = recargasDe(c.id)
          const fixos = fixosPorCartao.find((f) => f.cartaoId === c.id)
          const avulsa = c.recarga === 'avulsa'
          const saldoAnterior = Number(recargas?.antes ?? 0) - Number(gasto?.antes ?? 0)
          const recarregado = Number(recargas?.noMes ?? 0)
          return {
            id: c.id,
            recarga: c.recarga,
            // No avulso, o "orçamento" do mês é o que havia de saldo mais o que entrou nele.
            orcamentoCentavos: avulsa
              ? Math.max(0, saldoAnterior + recarregado)
              : c.orcamentoCentavos,
            saldoAnteriorCentavos: avulsa ? saldoAnterior : 0,
            recarregadoCentavos: avulsa ? recarregado : 0,
            lancadoCentavos: Number(gasto?.noMes ?? 0),
            fixosCentavos: Number(fixos?.centavos ?? 0),
            fixosPendentesCentavos: Number(fixos?.pendentesCentavos ?? 0),
            fixosPendentes: Number(fixos?.pendentes ?? 0),
          }
        }),
      saldos: lista
        .filter((c) => c.recarga === 'avulsa')
        .map((c) => ({
          cartaoId: c.id,
          centavos: Number(recargasDe(c.id)?.total ?? 0) - Number(gastoDe(c.id)?.ateHoje ?? 0),
        })),
    }
  }

  private exigirAdmin(usuario: UsuarioSessao): void {
    if (usuario.papel !== 'admin') {
      throw new ForbiddenException('Só administradores cadastram cartões e orçamento')
    }
  }

  private async cartaoVisivel(usuario: UsuarioSessao, id: number) {
    const [cartao] = await this.db.select().from(cartoes).where(eq(cartoes.id, id))
    if (!cartao || !enxergaSetor(usuario, cartao.setorId)) {
      throw new NotFoundException('Cartão não encontrado')
    }
    return cartao
  }

  private async carregar(id: number): Promise<Cartao> {
    const [cartao] = await listarCartoes(this.db, eq(cartoes.id, id))
    if (!cartao) throw new NotFoundException('Cartão não encontrado')
    return cartao
  }

  /** A forma do cartão precisa ser uma forma marcada como cartão (e ativa, se for escolha nova). */
  private async conferirForma(
    formaId: number,
    novaEscolha: boolean,
  ): Promise<ErroValidacao['issues']> {
    const [forma] = await this.db
      .select({ ativo: formasPagamento.ativo, cartao: formasPagamento.cartao })
      .from(formasPagamento)
      .where(eq(formasPagamento.id, formaId))
    if (!forma) return [{ path: 'formaPagamentoId', message: 'Forma de pagamento não encontrada' }]
    if (!forma.cartao) {
      return [
        {
          path: 'formaPagamentoId',
          message: 'Esta forma de pagamento não está marcada como cartão',
        },
      ]
    }
    if (!forma.ativo && novaEscolha) {
      return [{ path: 'formaPagamentoId', message: 'Forma de pagamento desativada' }]
    }
    return []
  }

  /**
   * Fornecedor, categoria (do setor do cartão) e empreendimento precisam existir
   * e estar ativos quando são escolha nova.
   */
  private async conferirReferencias(
    setorId: number,
    dados: Partial<Pick<NovoGastoFixo, 'fornecedorId' | 'categoriaId' | 'empreendimentoId'>>,
    atual?: { fornecedorId: number; categoriaId: number; empreendimentoId: number },
  ): Promise<void> {
    const problemas: ErroValidacao['issues'] = []

    if (dados.fornecedorId !== undefined) {
      const [f] = await this.db
        .select({ ativo: fornecedores.ativo })
        .from(fornecedores)
        .where(eq(fornecedores.id, dados.fornecedorId))
      if (!f) problemas.push({ path: 'fornecedorId', message: 'Fornecedor não encontrado' })
      else if (!f.ativo && dados.fornecedorId !== atual?.fornecedorId) {
        problemas.push({ path: 'fornecedorId', message: 'Fornecedor desativado' })
      }
    }
    if (dados.categoriaId !== undefined) {
      const [c] = await this.db
        .select({ ativo: categorias.ativo, setorId: categorias.setorId })
        .from(categorias)
        .where(eq(categorias.id, dados.categoriaId))
      if (!c || c.setorId !== setorId) {
        problemas.push({ path: 'categoriaId', message: 'Categoria não encontrada neste setor' })
      } else if (!c.ativo && dados.categoriaId !== atual?.categoriaId) {
        problemas.push({ path: 'categoriaId', message: 'Categoria desativada' })
      }
    }
    if (dados.empreendimentoId !== undefined) {
      const [e] = await this.db
        .select({ ativo: empreendimentos.ativo })
        .from(empreendimentos)
        .where(eq(empreendimentos.id, dados.empreendimentoId))
      if (!e) problemas.push({ path: 'empreendimentoId', message: 'Empreendimento não encontrado' })
      else if (!e.ativo && dados.empreendimentoId !== atual?.empreendimentoId) {
        problemas.push({ path: 'empreendimentoId', message: 'Empreendimento desativado' })
      }
    }

    if (problemas.length) throw erroDeValidacao(problemas)
  }
}

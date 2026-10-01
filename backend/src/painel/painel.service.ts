import { Inject, Injectable } from '@nestjs/common'
import {
  and,
  asc,
  between,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { escopoDeSetor } from '../common/acesso.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import { FUSO, fimDoMes, hoje, somarDias } from '../contracts/datas.js'
import type { Painel } from '../contracts/painel.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import {
  cartoes,
  categorias,
  empreendimentos,
  fornecedores,
  gastosFixos,
  lancamentos,
  parcelas,
  recargasCartao,
} from '../db/schema.js'

/** O dia (em São Paulo) em que o registro foi cadastrado. */
const diaDoCadastro = (coluna: PgColumn): SQL => sql`(${coluna} at time zone ${FUSO})::date`

/**
 * O dashboard: para onde foi o gasto do mês, como está cada cartão frente ao
 * orçamento e o que vence nos próximos 30 dias. O mês é o pedido (ou o
 * corrente em São Paulo), e o que decide o mês de um gasto é a data do gasto.
 */
@Injectable()
export class PainelService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async montar(usuario: UsuarioSessao, setorId?: number, mes?: string): Promise<Painel> {
    const dia = hoje()
    const referencia = mes ?? dia.slice(0, 7)
    const inicio = `${referencia}-01`
    const fim = fimDoMes(inicio)
    const escopo = escopoDeSetor(usuario, lancamentos.setorId, setorId)
    const ativos = and(eq(lancamentos.situacao, 'ativo'), escopo)
    const doMes = and(ativos, between(lancamentos.dataGasto, inicio, fim))
    // Categoria e empreendimento repartem o "gasto do mês", que no mês corrente vai até
    // hoje: assim as fatias fecham com ele. O cartão é compromisso e conta o mês inteiro
    // (o fixo lançado para o dia 15 já está comprometido).
    const corteDoGasto = referencia === dia.slice(0, 7) ? dia : fim
    const gastoDoMes = and(ativos, between(lancamentos.dataGasto, inicio, corteDoGasto))
    const soma = sql<string>`sum(${lancamentos.valorCentavos})::bigint`

    // Gasto fixo "lançado no mês": tem lançamento ativo com data do gasto no mês.
    const lancadoNoMes = sql`select 1 from ${lancamentos} where ${lancamentos.gastoFixoId} = ${gastosFixos.id} and ${lancamentos.situacao} = 'ativo' and ${lancamentos.dataGasto} between ${inicio}::date and ${fim}::date`
    // Cartão que teve gasto no mês aparece mesmo que tenha sido desativado depois.
    const cartaoUsadoNoMes = sql`exists (select 1 from ${lancamentos} where ${lancamentos.cartaoId} = ${cartoes.id} and ${lancamentos.situacao} = 'ativo' and ${lancamentos.dataGasto} between ${inicio}::date and ${fim}::date)`

    const [
      porCategoria,
      porEmpreendimento,
      listaCartoes,
      lancadoPorCartao,
      fixosPorCartao,
      aPagar,
      gastoAntesPorCartao,
      recargasPorCartao,
    ] = await Promise.all([
      this.db
        .select({ id: categorias.id, nome: categorias.nome, centavos: soma })
        .from(lancamentos)
        // Gasto sem categoria vira uma fatia própria: o total das fatias fecha com o do mês.
        .leftJoin(categorias, eq(categorias.id, lancamentos.categoriaId))
        .where(gastoDoMes)
        .groupBy(categorias.id, categorias.nome)
        .orderBy(desc(soma)),
      this.db
        .select({ id: empreendimentos.id, nome: empreendimentos.nome, centavos: soma })
        .from(lancamentos)
        .leftJoin(empreendimentos, eq(empreendimentos.id, lancamentos.empreendimentoId))
        .where(gastoDoMes)
        .groupBy(empreendimentos.id, empreendimentos.nome)
        .orderBy(desc(soma)),
      this.db
        .select({
          id: cartoes.id,
          nome: cartoes.nome,
          final: cartoes.final,
          recarga: cartoes.recarga,
          orcamentoCentavos: cartoes.orcamentoMensalCentavos,
        })
        .from(cartoes)
        .where(
          and(
            escopoDeSetor(usuario, cartoes.setorId, setorId),
            // Num mês passado, cartão cadastrado depois dele não entra.
            or(
              and(eq(cartoes.ativo, true), lte(diaDoCadastro(cartoes.criadoEm), fim)),
              cartaoUsadoNoMes,
            ),
          ),
        )
        .orderBy(asc(cartoes.nome)),
      this.db
        .select({ cartaoId: lancamentos.cartaoId, centavos: soma })
        .from(lancamentos)
        .where(and(doMes, isNotNull(lancamentos.cartaoId)))
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
      this.db
        .select({
          lancamentoId: lancamentos.id,
          parcelaId: parcelas.id,
          numero: parcelas.numero,
          totalParcelas: sql<number>`(select count(*) from ${parcelas} p2 where p2.lancamento_id = ${lancamentos.id})::int`,
          descricao: lancamentos.descricao,
          fornecedor: fornecedores.nome,
          vencimento: parcelas.vencimento,
          valorCentavos: parcelas.valorCentavos,
        })
        .from(parcelas)
        .innerJoin(lancamentos, eq(lancamentos.id, parcelas.lancamentoId))
        .leftJoin(fornecedores, eq(fornecedores.id, lancamentos.fornecedorId))
        .where(and(isNull(parcelas.pagoEm), ativos, lte(parcelas.vencimento, somarDias(dia, 30))))
        .orderBy(asc(parcelas.vencimento), asc(parcelas.id))
        .limit(12),
      // Cartão de recarga avulsa vive do saldo: o que entrou e saiu antes do mês.
      this.db
        .select({ cartaoId: lancamentos.cartaoId, centavos: soma })
        .from(lancamentos)
        .innerJoin(cartoes, eq(cartoes.id, lancamentos.cartaoId))
        .where(and(ativos, eq(cartoes.recarga, 'avulsa'), lt(lancamentos.dataGasto, inicio)))
        .groupBy(lancamentos.cartaoId),
      this.db
        .select({
          cartaoId: recargasCartao.cartaoId,
          antes: sql<string>`coalesce(sum(${recargasCartao.valorCentavos}) filter (where ${recargasCartao.data} < ${inicio}::date), 0)::bigint`,
          noMes: sql<string>`coalesce(sum(${recargasCartao.valorCentavos}) filter (where ${recargasCartao.data} between ${inicio}::date and ${fim}::date), 0)::bigint`,
        })
        .from(recargasCartao)
        .where(isNull(recargasCartao.removidaEm))
        .groupBy(recargasCartao.cartaoId),
    ])

    const fatia =
      (semNome: string) => (l: { id: number | null; nome: string | null; centavos: string }) => ({
        id: l.id,
        nome: l.nome ?? semNome,
        centavos: Number(l.centavos),
      })

    return {
      hoje: dia,
      mes: referencia,
      porCategoria: porCategoria.map(fatia('Sem categoria')),
      porEmpreendimento: porEmpreendimento.map(fatia('Sem empreendimento')),
      cartoes: listaCartoes.map((c) => {
        const lancado = lancadoPorCartao.find((l) => l.cartaoId === c.id)
        const fixos = fixosPorCartao.find((f) => f.cartaoId === c.id)
        const recargas = recargasPorCartao.find((r) => r.cartaoId === c.id)
        const saldoAnterior =
          Number(recargas?.antes ?? 0) -
          Number(gastoAntesPorCartao.find((g) => g.cartaoId === c.id)?.centavos ?? 0)
        const recarregado = Number(recargas?.noMes ?? 0)
        const avulsa = c.recarga === 'avulsa'
        return {
          id: c.id,
          nome: c.nome,
          final: c.final,
          recarga: c.recarga,
          // No avulso, o "orçamento" do mês é o que havia de saldo mais o que entrou nele.
          orcamentoCentavos: avulsa
            ? Math.max(0, saldoAnterior + recarregado)
            : c.orcamentoCentavos,
          saldoAnteriorCentavos: avulsa ? saldoAnterior : 0,
          recarregadoCentavos: avulsa ? recarregado : 0,
          lancadoCentavos: Number(lancado?.centavos ?? 0),
          fixosCentavos: Number(fixos?.centavos ?? 0),
          fixosPendentesCentavos: Number(fixos?.pendentesCentavos ?? 0),
          fixosPendentes: Number(fixos?.pendentes ?? 0),
        }
      }),
      aPagar: aPagar.map((p) => ({ ...p, totalParcelas: Number(p.totalParcelas) })),
    }
  }
}

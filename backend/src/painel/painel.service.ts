import { Inject, Injectable } from '@nestjs/common'
import { and, asc, between, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import { escopoDeSetor } from '../common/acesso.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import { fimDoMes, hoje, somarDias } from '../contracts/datas.js'
import type { Painel } from '../contracts/painel.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import { categorias, empreendimentos, fornecedores, lancamentos, parcelas } from '../db/schema.js'

/**
 * O dashboard: para onde foi o gasto do mês e o que vence nos próximos 30
 * dias. O mês é o pedido (ou o corrente em São Paulo), e o que decide o mês de
 * um gasto é a data do gasto. Os cartões têm página própria (CartoesService).
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
    // Categoria e empreendimento repartem o "gasto do mês", que no mês corrente vai até
    // hoje: assim as fatias fecham com ele.
    const corteDoGasto = referencia === dia.slice(0, 7) ? dia : fim
    const gastoDoMes = and(ativos, between(lancamentos.dataGasto, inicio, corteDoGasto))
    const soma = sql<string>`sum(${lancamentos.valorCentavos})::bigint`

    const [porCategoria, porEmpreendimento, aPagar] = await Promise.all([
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
      aPagar: aPagar.map((p) => ({ ...p, totalParcelas: Number(p.totalParcelas) })),
    }
  }
}

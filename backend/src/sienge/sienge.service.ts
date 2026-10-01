import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, between, desc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm'
import { escopoDeSetor } from '../common/acesso.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import { fimDoMes, hoje, somarMesesAoMes } from '../contracts/datas.js'
import type { GastoSienge, SituacaoSienge } from '../contracts/sienge.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import {
  setores,
  siengeApropriacoes,
  siengeCentrosCusto,
  siengeMeses,
  siengeTitulos,
} from '../db/schema.js'
import { falhaAtual, precisaBuscar } from './prazos.js'
import { ErroSienge, SIENGE, type Conta, type SiengeCliente } from './sienge.cliente.js'

/** Título como `/bills` devolve (só o que a cópia usa). */
interface TituloApi {
  id: number
  issueDate?: string | null
  totalInvoiceAmount?: number | null
  status?: string | null
  creditorId?: number | null
  documentIdentificationId?: string | null
  documentNumber?: string | null
  changedDate?: string | null
}

/** Apropriação financeira como `/bills/{id}/budget-categories` devolve. */
interface ApropriacaoApi {
  costCenterId: number
  paymentCategoriesId: string | number
  percentage?: number | null
}

interface CentroCustoApi {
  id: number
  name: string
}

/** Uma busca pedida: o mês de um setor, quem ainda se interessa por ela e o andamento. */
interface Pendente {
  setorId: number
  mes: string
  /** Última vez que alguém consultou este mês (a tela pergunta a cada 4 s enquanto espera). */
  interesse: number
  rodando: boolean
  feitos: number
  total: number
}

/** A lista de centros de custo do Sienge é relida uma vez por dia. */
const PRAZO_CENTROS_MS = 24 * 60 * 60_000
/** Busca que ninguém consulta há este tempo sai da fila: a pessoa foi para outro mês. */
const ESQUECER_MS = 2 * 60_000
/** Meses mais antigos que isso não são buscados (nem há por que comparar). */
const MESES_PARA_TRAS = 60

/** Trecho digitado vira padrão literal do ILIKE: `%` e `_` não são curinga aqui. */
const escaparLike = (texto: string) => texto.replace(/[\\%_]/g, (c) => `\\${c}`)

const chave = (setorId: number, mes: string) => `${setorId}:${mes}`

/**
 * O gasto de cada setor lançado no Sienge, para o dashboard comparar com o do
 * SIGO (regra em `contracts/sienge.ts`).
 *
 * A consulta nunca espera o Sienge: lê a cópia local e, se a cópia do mês
 * venceu, pede uma busca em segundo plano. As buscas correm uma de cada vez,
 * dentro do teto de requisições do cliente, e a próxima é sempre a do mês
 * consultado mais recentemente: quem passa por vários meses no seletor não
 * espera os do meio.
 */
@Injectable()
export class SiengeService {
  private readonly log = new Logger('Sienge')
  private readonly pendentes = new Map<string, Pendente>()
  private trabalhando = false

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SIENGE) private readonly sienge: SiengeCliente | null,
  ) {}

  async gastoDoMes(usuario: UsuarioSessao, setorId?: number, mes?: string): Promise<GastoSienge> {
    const mesCorrente = hoje().slice(0, 7)
    const referencia = mes ?? mesCorrente
    const resposta = (situacao: SituacaoSienge, erro: string | null = null): GastoSienge => ({
      mes: referencia,
      situacao,
      centavos: null,
      titulos: 0,
      porCentroCusto: [],
      comparavel: false,
      atualizadoEm: null,
      atualizando: false,
      progresso: null,
      erro,
    })
    if (!this.sienge) return resposta('desligado')
    if (referencia > mesCorrente || referencia < somarMesesAoMes(mesCorrente, -MESES_PARA_TRAS)) {
      return resposta('desligado', 'Mês fora do período consultado no Sienge')
    }

    // Setores que a pessoa enxerga; os que têm centro de custo no Sienge entram na conta.
    const visiveis = await this.db
      .select({
        id: setores.id,
        ativo: setores.ativo,
        trecho: sql<string>`coalesce(trim(${setores.siengeCentroCusto}), '')`,
      })
      .from(setores)
      .where(escopoDeSetor(usuario, setores.id, setorId))
    const alvo = visiveis.filter((s) => s.ativo && s.trecho)
    if (!alvo.length) return resposta('desligado', 'Nenhum setor com centro de custo no Sienge')
    // O gasto do SIGO soma todos os setores visíveis: só dá para comparar se todos entram aqui.
    const comparavel = visiveis.every((s) => alvo.some((a) => a.id === s.id))

    const estados = await this.db
      .select()
      .from(siengeMeses)
      .where(
        and(
          inArray(
            siengeMeses.setorId,
            alvo.map((s) => s.id),
          ),
          eq(siengeMeses.mes, referencia),
        ),
      )
    const estadoDe = (id: number) => estados.find((e) => e.setorId === id)

    const agora = Date.now()
    for (const s of alvo) {
      const pendente = this.pendentes.get(chave(s.id, referencia))
      if (pendente) pendente.interesse = agora
      else if (precisaBuscar(estadoDe(s.id), referencia, mesCorrente, agora)) {
        this.agendar(s.id, referencia)
      }
    }

    const emAndamento = alvo
      .map((s) => this.pendentes.get(chave(s.id, referencia)))
      .filter((p): p is Pendente => !!p)
    const atualizando = emAndamento.length > 0
    const nuncaBuscado = alvo.some((s) => !estadoDe(s.id)?.buscadoEm)
    const falha = estados
      .filter(falhaAtual)
      .sort((a, b) => b.erroEm!.getTime() - a.erroEm!.getTime())[0]

    let situacao: SituacaoSienge
    if (nuncaBuscado) situacao = atualizando || !falha ? 'buscando' : 'erro'
    else situacao = falha && !atualizando ? 'erro' : 'pronto'

    const emCurso = emAndamento.find((p) => p.total > 0)
    const base: GastoSienge = {
      ...resposta(situacao),
      comparavel,
      atualizando,
      progresso: emCurso ? { feitos: emCurso.feitos, total: emCurso.total } : null,
      erro: falha?.erro ?? null,
    }
    if (nuncaBuscado) return base

    const buscas = estados.map((e) => e.buscadoEm!.getTime())
    // Mesmo corte do "Gasto no mês" do SIGO: no mês corrente, do dia 1 até hoje.
    const inicio = `${referencia}-01`
    const fim = referencia === mesCorrente ? hoje() : fimDoMes(inicio)
    const total = await this.somar(
      alvo.map((s) => s.trecho),
      inicio,
      fim,
    )
    return { ...base, ...total, atualizadoEm: new Date(Math.min(...buscas)).toISOString() }
  }

  /**
   * Para a conferência de pagamentos: os centros de custo do setor no Sienge
   * (o trecho do nome e a lista), ou `null` se o setor não tem centro de custo
   * lá ou o Sienge não está configurado.
   */
  async centrosDoSetor(
    setorId: number,
    conta: Conta,
  ): Promise<{ trecho: string; centros: Array<{ id: number; nome: string }> } | null> {
    if (!this.sienge) return null
    const [setor] = await this.db
      .select({ trecho: setores.siengeCentroCusto })
      .from(setores)
      .where(eq(setores.id, setorId))
    const trecho = setor?.trecho?.trim()
    if (!trecho) return null
    return { trecho, centros: await this.centrosDoTrecho(trecho, conta) }
  }

  /**
   * Para a conferência de pagamentos: refaz, um de cada vez, a cópia dos meses
   * pedidos que venceu. A busca entra na fila da tela como "rodando", para o
   * trabalhador não buscar o mesmo mês ao mesmo tempo (e a tela mostrar o
   * andamento); mês que o trabalhador já está buscando fica com ele. Nunca rejeita.
   */
  async copiaDosMeses(setorId: number, meses: string[], conta: Conta): Promise<void> {
    if (!this.sienge) return
    const mesCorrente = hoje().slice(0, 7)
    const validos = [...new Set(meses)]
      .filter((m) => m <= mesCorrente && m >= somarMesesAoMes(mesCorrente, -MESES_PARA_TRAS))
      .sort()
    for (const mes of validos) {
      const k = chave(setorId, mes)
      const naFila = this.pendentes.get(k)
      if (naFila?.rodando) continue
      const pendente: Pendente = naFila ?? {
        setorId,
        mes,
        interesse: Date.now(),
        rodando: false,
        feitos: 0,
        total: 0,
      }
      pendente.rodando = true
      this.pendentes.set(k, pendente)
      try {
        await this.buscarMes(pendente, conta)
      } finally {
        this.pendentes.delete(k)
      }
    }
  }

  /** Soma a cópia local: a parte de cada título apropriada a um centro de custo do escopo. */
  private async somar(trechos: string[], inicio: string, fim: string) {
    const doEscopo = and(
      between(siengeTitulos.emissao, inicio, fim),
      // "Em inclusão" ainda está sendo digitado no Sienge.
      sql`${siengeTitulos.situacao} is distinct from 'I'`,
      or(...trechos.map((t) => ilike(siengeCentrosCusto.nome, `%${escaparLike(t)}%`))),
    )
    const parte = sql<string>`sum(round(${siengeTitulos.valorCentavos} * ${siengeApropriacoes.percentual} / 100))::bigint`

    const [porCentro, [contagem]] = await Promise.all([
      this.db
        .select({ id: siengeCentrosCusto.id, nome: siengeCentrosCusto.nome, centavos: parte })
        .from(siengeApropriacoes)
        .innerJoin(siengeTitulos, eq(siengeTitulos.id, siengeApropriacoes.tituloId))
        .innerJoin(siengeCentrosCusto, eq(siengeCentrosCusto.id, siengeApropriacoes.centroCustoId))
        .where(doEscopo)
        .groupBy(siengeCentrosCusto.id, siengeCentrosCusto.nome)
        .orderBy(desc(parte)),
      this.db
        // Título rateado entre dois centros do setor conta uma vez só.
        .select({ titulos: sql<number>`count(distinct ${siengeTitulos.id})::int` })
        .from(siengeApropriacoes)
        .innerJoin(siengeTitulos, eq(siengeTitulos.id, siengeApropriacoes.tituloId))
        .innerJoin(siengeCentrosCusto, eq(siengeCentrosCusto.id, siengeApropriacoes.centroCustoId))
        .where(doEscopo),
    ])

    const porCentroCusto = porCentro.map((c) => ({
      id: c.id,
      nome: c.nome,
      centavos: Number(c.centavos),
    }))
    return {
      centavos: porCentroCusto.reduce((soma, c) => soma + c.centavos, 0),
      titulos: contagem?.titulos ?? 0,
      porCentroCusto,
    }
  }

  /** Pede a busca do mês (se ainda não foi pedida) e acorda o trabalhador. */
  private agendar(setorId: number, mes: string): void {
    const k = chave(setorId, mes)
    if (this.pendentes.has(k)) return
    this.pendentes.set(k, {
      setorId,
      mes,
      interesse: Date.now(),
      rodando: false,
      feitos: 0,
      total: 0,
    })
    void this.trabalhar()
  }

  /**
   * Uma busca de cada vez; a próxima é a do mês consultado mais
   * recentemente, e a que ninguém consulta há 2 minutos é descartada.
   * Nunca rejeita: falha de uma busca fica registrada no mês e o laço segue.
   */
  private async trabalhar(): Promise<void> {
    if (this.trabalhando) return
    this.trabalhando = true
    try {
      for (;;) {
        const agora = Date.now()
        for (const [k, p] of this.pendentes) {
          if (!p.rodando && agora - p.interesse > ESQUECER_MS) this.pendentes.delete(k)
        }
        const proxima = [...this.pendentes.entries()]
          .filter(([, p]) => !p.rodando)
          .sort((a, b) => b[1].interesse - a[1].interesse)[0]
        if (!proxima) break
        const [k, p] = proxima
        p.rodando = true
        try {
          await this.buscarMes(p)
        } catch (erro) {
          this.log.error(`${p.mes}: ${(erro as Error).message}`)
        } finally {
          this.pendentes.delete(k)
        }
      }
    } finally {
      this.trabalhando = false
    }
  }

  /**
   * Refaz a cópia de um mês de um setor:
   * 1. os centros de custo do setor, pelo trecho do nome;
   * 2. os títulos emitidos no mês em cada um (a API filtra um centro por vez);
   * 3. a apropriação dos títulos novos ou alterados (uma requisição por título,
   *    feita uma vez só: o `changedDate` diz quando refazer);
   * 4. grava tudo numa transação só, tirando da cópia o título do mês que não
   *    voltou (excluído no Sienge ou tirado dos centros do setor).
   * O Sienge inteiro é lido antes de gravar: busca que falha no meio não deixa
   * a cópia misturada. A falha fica registrada no mês, e a busca é tentada de novo depois.
   * Nunca rejeita. `externa` soma as requisições na conta de quem pediu (a conferência).
   */
  private async buscarMes(pendente: Pendente, externa?: Conta): Promise<void> {
    const conta: Conta = { requisicoes: 0 }
    try {
      await this.refazerMes(pendente, conta)
    } finally {
      if (externa) externa.requisicoes += conta.requisicoes
    }
  }

  private async refazerMes(pendente: Pendente, conta: Conta): Promise<void> {
    const { setorId, mes } = pendente
    const sienge = this.sienge!
    const inicio = `${mes}-01`
    const fim = fimDoMes(inicio)

    try {
      // Outra busca do mesmo mês pode ter terminado enquanto esta esperava na fila.
      const [estado] = await this.db
        .select()
        .from(siengeMeses)
        .where(and(eq(siengeMeses.setorId, setorId), eq(siengeMeses.mes, mes)))
      if (!precisaBuscar(estado, mes, hoje().slice(0, 7), Date.now())) return

      const [setor] = await this.db
        .select({ trecho: setores.siengeCentroCusto })
        .from(setores)
        .where(eq(setores.id, setorId))
      const trecho = setor?.trecho?.trim()
      if (!trecho) return
      const centros = await this.centrosDoTrecho(trecho, conta)

      const vistos = new Map<number, { titulo: TituloApi; centroCustoId: number }>()
      for (const c of centros) {
        const titulos = await sienge.listar<TituloApi>(
          '/bills',
          { startDate: inicio, endDate: fim, costCenterId: c.id },
          conta,
        )
        for (const t of titulos) {
          if (!vistos.has(t.id)) vistos.set(t.id, { titulo: t, centroCustoId: c.id })
        }
      }
      const doMes = [...vistos.values()].filter(({ titulo }) => titulo.issueDate)
      const ids = doMes.map(({ titulo }) => titulo.id)

      // Apropriação: só dos títulos novos ou alterados desde a última vez.
      const guardados = ids.length
        ? await this.db
            .select({
              id: siengeTitulos.id,
              apropriacaoDe: siengeTitulos.apropriacaoDe,
              apropriacaoEm: siengeTitulos.apropriacaoEm,
            })
            .from(siengeTitulos)
            .where(inArray(siengeTitulos.id, ids))
        : []
      const faltam = doMes.filter(({ titulo }) => {
        const g = guardados.find((x) => x.id === titulo.id)
        return !g || !g.apropriacaoEm || g.apropriacaoDe !== (titulo.changedDate ?? null)
      })
      pendente.total = faltam.length
      const apropriacoes = new Map<number, ApropriacaoApi[]>()
      for (const { titulo } of faltam) {
        apropriacoes.set(
          titulo.id,
          await sienge.listar<ApropriacaoApi>(`/bills/${titulo.id}/budget-categories`, {}, conta),
        )
        pendente.feitos++
      }

      const agora = new Date()
      await this.db.transaction(async (tx) => {
        if (doMes.length) {
          const novo = (coluna: string) => sql.raw(`excluded.${coluna}`)
          await tx
            .insert(siengeTitulos)
            .values(
              doMes.map(({ titulo: t }) => ({
                id: t.id,
                emissao: t.issueDate!.slice(0, 10),
                valorCentavos: Math.round((t.totalInvoiceAmount ?? 0) * 100),
                situacao: t.status ?? null,
                credorId: t.creditorId ?? null,
                documento:
                  [t.documentIdentificationId?.trim(), t.documentNumber]
                    .filter(Boolean)
                    .join(' ') || null,
                tipoDocumento: t.documentIdentificationId?.trim() || null,
                numeroDocumento: t.documentNumber?.trim() || null,
                alteradoEm: t.changedDate ?? null,
                atualizadoEm: agora,
              })),
            )
            .onConflictDoUpdate({
              target: siengeTitulos.id,
              set: {
                emissao: novo('emissao'),
                valorCentavos: novo('valor_centavos'),
                situacao: novo('situacao'),
                credorId: novo('credor_id'),
                documento: novo('documento'),
                tipoDocumento: novo('tipo_documento'),
                numeroDocumento: novo('numero_documento'),
                alteradoEm: novo('alterado_em'),
                atualizadoEm: novo('atualizado_em'),
              },
            })
        }

        for (const { titulo, centroCustoId } of faltam) {
          const linhas = this.agruparApropriacao(apropriacoes.get(titulo.id) ?? [], centroCustoId)
          await tx.delete(siengeApropriacoes).where(eq(siengeApropriacoes.tituloId, titulo.id))
          await tx.insert(siengeApropriacoes).values(
            linhas.map((a) => ({
              tituloId: titulo.id,
              centroCustoId: a.centroCustoId,
              planoFinanceiroId: a.planoFinanceiroId,
              percentual: a.percentual.toFixed(4),
            })),
          )
          await tx
            .update(siengeTitulos)
            .set({ apropriacaoDe: titulo.changedDate ?? null, apropriacaoEm: agora })
            .where(eq(siengeTitulos.id, titulo.id))
        }

        // Título do mês que estava num centro do setor e não voltou agora.
        if (centros.length) {
          const doSetor = sql`exists (select 1 from ${siengeApropriacoes} a where a.titulo_id = ${siengeTitulos.id} and a.centro_custo_id in ${centros.map((c) => c.id)})`
          await tx
            .delete(siengeTitulos)
            .where(
              and(
                between(siengeTitulos.emissao, inicio, fim),
                ids.length ? notInArray(siengeTitulos.id, ids) : undefined,
                doSetor,
              ),
            )
        }

        await tx
          .insert(siengeMeses)
          .values({ setorId, mes, buscadoEm: agora, erro: null, erroEm: null })
          .onConflictDoUpdate({
            target: [siengeMeses.setorId, siengeMeses.mes],
            set: { buscadoEm: agora, erro: null, erroEm: null },
          })
      })
      this.log.log(
        `${mes}: ${vistos.size} títulos em ${centros.length} centros de custo, ` +
          `${faltam.length} apropriações buscadas, ${conta.requisicoes} requisições`,
      )
    } catch (erro) {
      const mensagem =
        erro instanceof ErroSienge
          ? erro.status === 401 || erro.status === 403
            ? 'O Sienge recusou a credencial'
            : erro.message
          : 'Falha ao gravar a cópia do Sienge'
      this.log.error(`${mes}: ${(erro as Error).message}`)
      const agora = new Date()
      await this.db
        .insert(siengeMeses)
        .values({ setorId, mes, erro: mensagem, erroEm: agora })
        .onConflictDoUpdate({
          target: [siengeMeses.setorId, siengeMeses.mes],
          set: { erro: mensagem, erroEm: agora },
        })
        .catch((e: Error) => this.log.error(`sem registrar a falha: ${e.message}`))
    }
  }

  /**
   * Apropriação como vai para a cópia: a chave é centro + plano financeiro
   * (linha repetida soma o percentual). Título sem apropriação na API fica
   * inteiro no centro de custo em que foi encontrado: foi por ele que o filtro
   * do Sienge o devolveu.
   */
  private agruparApropriacao(lista: ApropriacaoApi[], centroCustoId: number) {
    const porChave = new Map<
      string,
      { centroCustoId: number; planoFinanceiroId: string; percentual: number }
    >()
    for (const a of lista) {
      const plano = String(a.paymentCategoriesId ?? '')
      const k = `${a.costCenterId}|${plano}`
      const atual = porChave.get(k)
      const percentual = a.percentage ?? 100
      if (atual) atual.percentual += percentual
      else porChave.set(k, { centroCustoId: a.costCenterId, planoFinanceiroId: plano, percentual })
    }
    if (!porChave.size) porChave.set('', { centroCustoId, planoFinanceiroId: '', percentual: 100 })
    return [...porChave.values()]
  }

  /**
   * Centros de custo cujo nome contém o trecho. A lista vem do Sienge uma vez
   * por dia; no resto do tempo, da cópia.
   */
  private async centrosDoTrecho(trecho: string, conta: Conta) {
    // A idade vem calculada do banco: o driver entrega timestamptz cru como texto.
    const [copia] = await this.db
      .select({
        idadeSeg: sql<
          number | null
        >`extract(epoch from now() - max(${siengeCentrosCusto.atualizadoEm}))::float8`,
      })
      .from(siengeCentrosCusto)
    const idade = copia?.idadeSeg
    if (idade === null || idade === undefined || idade * 1000 > PRAZO_CENTROS_MS) {
      const lista = await this.sienge!.listar<CentroCustoApi>('/cost-centers', {}, conta)
      if (lista.length) {
        await this.db
          .insert(siengeCentrosCusto)
          .values(lista.map((c) => ({ id: c.id, nome: c.name.trim(), atualizadoEm: new Date() })))
          .onConflictDoUpdate({
            target: siengeCentrosCusto.id,
            set: {
              nome: sql.raw('excluded.nome'),
              atualizadoEm: sql.raw('excluded.atualizado_em'),
            },
          })
      }
    }
    return this.db
      .select({ id: siengeCentrosCusto.id, nome: siengeCentrosCusto.nome })
      .from(siengeCentrosCusto)
      .where(ilike(siengeCentrosCusto.nome, `%${escaparLike(trecho)}%`))
  }
}

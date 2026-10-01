import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { and, asc, between, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { escopoDeSetor } from '../common/acesso.js'
import { env } from '../config/env.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import { hoje, somarDias, somarMesesAoMes } from '../contracts/datas.js'
import type {
  DetalheConferencia,
  OrigemConferencia,
  ProvaSienge,
  StatusConferencia,
} from '../contracts/sienge.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import {
  empreendimentos,
  eventos,
  formasPagamento,
  fornecedores,
  lancamentos,
  parcelas,
  siengeApropriacoes,
  siengeConferencias,
  siengeCredores,
  siengeCredoresNomes,
  siengeMovimentos,
  siengeTitulos,
  usuarios,
} from '../db/schema.js'
import {
  centroDoEmpreendimento,
  dataDoPagamento,
  decidir,
  horariosEmTorno,
  nomesParecidos,
  numeroDoCodigo,
  numeroDoSienge,
  palavras,
  parcelasPagas,
  provasDe,
  tituloElegivel,
  vinculoDas,
  type Candidato,
  type Casamento,
  type LancamentoParaCasar,
  type ParcelaSienge,
  type ParcelaSigo,
  type TituloCandidato,
} from './casamento.js'
import { ErroSienge, SIENGE, type Conta, type SiengeCliente } from './sienge.cliente.js'
import { SiengeService } from './sienge.service.js'
import { EMAIL_USUARIO_SIENGE } from './usuario-sistema.js'

/** Credor como `/creditors` devolve (só o id interessa). */
interface CredorApi {
  id: number
}

/** Credor como `/creditors/{id}` devolve (só os nomes interessam). */
interface CredorNomeApi {
  id: number
  name?: string | null
  tradeName?: string | null
}

/** O setor do lançamento no Sienge: o trecho do nome e os centros de custo. */
interface ContextoSetor {
  trecho: string
  centros: Array<{ id: number; nome: string }>
}

/** Movimento do extrato de contas (`/accounts-statements`). */
interface MovimentoApi {
  id: number
  value?: number | null
  date?: string | null
  type?: string | null
  billId?: number | null
  installmentNumber?: number | null
  statementOrigin?: string | null
}

/** Lançamento em aberto, como a conferência precisa. */
interface Aberto {
  id: number
  setorId: number
  valorCentavos: number
  dataGasto: string
  codigoIdentificacao: string | null
  siengeTituloId: number | null
  pausado: boolean
  /** CNPJ/CPF do fornecedor. */
  documento: string | null
  fornecedorNome: string | null
  empreendimentoNome: string | null
  parcelas: ParcelaSigo[]
}

/** Credores de um CNPJ (e o nome de cada um) mudam pouco: valem 30 dias. */
const PRAZO_CREDORES_MS = 30 * 24 * 60 * 60_000
/** Depois disso sem título no Sienge, o lançamento deixa de ser procurado (p99 do cadastro lá: 106 dias). */
const DIAS_PROCURANDO = 120
/** Na primeira leitura do extrato, quantos dias para trás. */
const DIAS_EXTRATO_INICIAL = 60
/** Meses anteriores ao corrente em que a conferência garante a cópia dos títulos do setor. */
const MESES_DA_COPIA = 4
/** Mais títulos que isso ainda em disputa: só o número da nota separa; sem ele, não casa. */
const LIMITE_CANDIDATOS = 6

const mensagemDe = (erro: unknown): string =>
  erro instanceof ErroSienge
    ? erro.status === 401 || erro.status === 403
      ? 'O Sienge recusou a credencial'
      : erro.message
    : (erro as Error).message

/**
 * Conferência de pagamentos com o Sienge (regras em `casamento.ts`).
 *
 * Roda nos horários de SIENGE_CONFERENCIA_HORARIOS (00h e 12h de São Paulo)
 * e quando um admin pede. Uma de cada vez. Se o servidor estava fora do ar
 * no horário (ou caiu no meio de uma rodada), roda logo depois de subir.
 *
 * Marcar pago errado é pior que não marcar: na dúvida, não casa; sem
 * dinheiro no extrato, não marca; e o que uma pessoa desfez fica desfeito.
 */
@Injectable()
export class ConferenciaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Conferência Sienge')
  private relogio?: NodeJS.Timeout
  private rodando = false

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SIENGE) private readonly sienge: SiengeCliente | null,
    private readonly quadro: SiengeService,
  ) {}

  get ligada(): boolean {
    return !!this.sienge && env.SIENGE_CONFERENCIA_HORARIOS.length > 0
  }

  onApplicationBootstrap() {
    if (this.ligada) this.agendarSemFalhar(true)
  }

  onApplicationShutdown() {
    if (this.relogio) clearTimeout(this.relogio)
  }

  /** Falha ao agendar (banco fora do ar na subida, por exemplo) vai para o log e tenta de novo; nunca derruba a API. */
  private agendarSemFalhar(naSubida = false) {
    this.agendar(naSubida).catch((erro: Error) => {
      this.log.error(
        `não deu para agendar a conferência: ${erro.message}; nova tentativa em 5 minutos`,
      )
      setTimeout(() => this.agendarSemFalhar(naSubida), 5 * 60_000).unref()
    })
  }

  private async agendar(naSubida = false): Promise<void> {
    const agora = new Date()
    const { anterior, proximo } = horariosEmTorno(agora, env.SIENGE_CONFERENCIA_HORARIOS)
    if (naSubida) {
      // Rodada que ficou "em andamento" é de um processo que morreu no meio: não vale.
      await this.db
        .update(siengeConferencias)
        .set({ situacao: 'erro', fim: agora, erro: 'Interrompida (o servidor reiniciou)' })
        .where(eq(siengeConferencias.situacao, 'andamento'))
      if (anterior) {
        const [feita] = await this.db
          .select({ id: siengeConferencias.id })
          .from(siengeConferencias)
          .where(
            and(gte(siengeConferencias.inicio, anterior), eq(siengeConferencias.situacao, 'ok')),
          )
          .limit(1)
        if (!feita) {
          this.log.log('a conferência do último horário não rodou; rodando em 1 minuto')
          setTimeout(() => void this.executar('agendada'), 60_000).unref()
        }
      }
    }
    if (!proximo) return
    this.relogio = setTimeout(() => {
      void this.executar('agendada').finally(() => this.agendarSemFalhar())
    }, proximo.getTime() - agora.getTime())
    this.relogio.unref()
  }

  /**
   * A situação para a tela. Quem não é admin vê só o que é dos setores dele:
   * as pendências citam lançamentos (e as falhas, fornecedores) de todos os setores.
   */
  async status(usuario: UsuarioSessao): Promise<StatusConferencia> {
    const [ultima] = await this.db
      .select()
      .from(siengeConferencias)
      .orderBy(desc(siengeConferencias.inicio))
      .limit(1)
    const { proximo } = horariosEmTorno(new Date(), env.SIENGE_CONFERENCIA_HORARIOS)
    let detalhe = ultima?.detalhe ?? null
    if (detalhe && usuario.papel !== 'admin') {
      const citados = [
        ...detalhe.ambiguos.map((a) => a.lancamentoId),
        ...detalhe.pagasSemMovimento.map((p) => p.lancamentoId),
      ]
      const visiveis = new Set(
        citados.length
          ? (
              await this.db
                .select({ id: lancamentos.id })
                .from(lancamentos)
                .where(
                  and(
                    inArray(lancamentos.id, citados),
                    escopoDeSetor(usuario, lancamentos.setorId),
                  ),
                )
            ).map((l) => l.id)
          : [],
      )
      detalhe = {
        ...detalhe,
        ambiguos: detalhe.ambiguos.filter((a) => visiveis.has(a.lancamentoId)),
        pagasSemMovimento: detalhe.pagasSemMovimento.filter((p) => visiveis.has(p.lancamentoId)),
        falhas: [],
      }
    }
    return {
      ligada: this.ligada,
      horarios: env.SIENGE_CONFERENCIA_HORARIOS,
      proxima: this.ligada && proximo ? proximo.toISOString() : null,
      andamento: this.rodando,
      ultima: ultima
        ? {
            origem: ultima.origem,
            inicio: ultima.inicio.toISOString(),
            fim: ultima.fim?.toISOString() ?? null,
            situacao: ultima.situacao,
            verificados: ultima.verificados,
            vinculados: ultima.vinculados,
            pagas: ultima.pagas,
            erro: ultima.erro,
            detalhe,
          }
        : null,
    }
  }

  /** Dispara uma conferência agora (sem esperar ela terminar). */
  iniciar(origem: OrigemConferencia): boolean {
    if (!this.sienge || this.rodando) return false
    void this.executar(origem)
    return true
  }

  async executar(origem: OrigemConferencia): Promise<void> {
    if (!this.sienge || this.rodando) return
    this.rodando = true
    const sienge = this.sienge
    const conta: Conta = { requisicoes: 0 }
    const detalhe: DetalheConferencia = {
      semDados: 0,
      ambiguos: [],
      datasAproximadas: 0,
      respeitadas: 0,
      pagasSemMovimento: [],
      falhas: [],
    }
    let verificados = 0
    let vinculados = 0
    let pagas = 0
    let extrato: { de: string; ate: string } | null = null

    let registroId: number | null = null
    try {
      const [registro] = await this.db
        .insert(siengeConferencias)
        .values({ origem })
        .returning({ id: siengeConferencias.id })
      registroId = registro!.id

      const sistema = await this.usuarioSistema()
      const abertos = await this.lancamentosAbertos()
      verificados = abertos.length

      // Parcelas do Sienge lidas nesta rodada, por título (o nível 2 do casamento e a conferência reaproveitam).
      const parcelasDoTitulo = new Map<number, ParcelaSienge[]>()
      const lerParcelas = async (tituloId: number) => {
        let lista = parcelasDoTitulo.get(tituloId)
        if (!lista) {
          lista = await sienge.listar<ParcelaSienge>(`/bills/${tituloId}/installments`, {}, conta)
          parcelasDoTitulo.set(tituloId, lista)
        }
        return lista
      }

      // 1. Casar com o título do Sienge quem ainda não tem (e não está pausado).
      const novos = await this.vincular(
        abertos.filter((l) => l.siengeTituloId === null),
        lerParcelas,
        detalhe,
        conta,
      )
      vinculados = novos.size
      for (const l of abertos) if (novos.has(l.id)) l.siengeTituloId = novos.get(l.id)!

      // 2. Conferir o pagamento de quem tem título.
      const comTitulo = abertos.filter((l) => l.siengeTituloId !== null)
      if (comTitulo.length) {
        extrato = await this.atualizarExtrato(conta)
        const cobertura = await this.inicioDoExtratoLido(extrato.de)
        const movimentos = await this.db
          .select({
            tituloId: siengeMovimentos.tituloId,
            parcela: siengeMovimentos.parcela,
            data: siengeMovimentos.data,
          })
          .from(siengeMovimentos)
          .where(
            inArray(
              siengeMovimentos.tituloId,
              comTitulo.map((l) => l.siengeTituloId!),
            ),
          )

        for (const l of comTitulo) {
          const tituloId = l.siengeTituloId!
          try {
            const doSienge = await lerParcelas(tituloId)
            if (!doSienge.length) {
              // Título excluído no Sienge: o vínculo sai e o lançamento volta a ser procurado.
              await this.db
                .update(lancamentos)
                .set({
                  siengeTituloId: null,
                  siengeVinculo: null,
                  siengeProvas: null,
                  siengeVinculadoEm: null,
                })
                .where(and(eq(lancamentos.id, l.id), eq(lancamentos.siengeTituloId, tituloId)))
              this.log.warn(
                `título ${tituloId} não existe mais no Sienge; lançamento #${l.id} desvinculado`,
              )
              continue
            }
            const pagasLa = parcelasPagas(l.parcelas, doSienge)
            if (l.pausado) {
              if (pagasLa.length) detalhe.respeitadas++
              continue
            }
            for (const { parcela, numeroSienge } of pagasLa) {
              const dia = hoje()
              const noExtrato = dataDoPagamento(movimentos, tituloId, numeroSienge)
              const vencimentoLa = doSienge
                .find((p) => p.installmentNumber === numeroSienge)
                ?.dueDate?.slice(0, 10)
              let pagoEm: string
              if (noExtrato) {
                pagoEm = noExtrato <= dia ? noExtrato : dia
              } else if (vencimentoLa && vencimentoLa < cobertura) {
                // Sem movimento, mas venceu antes do que já foi lido do extrato: pago antes
                // do período conhecido. O vencimento de lá é a melhor estimativa.
                pagoEm = vencimentoLa
              } else {
                // "Totalmente paga" sem dinheiro no período lido: substituição ou renegociação.
                detalhe.pagasSemMovimento.push({
                  lancamentoId: l.id,
                  tituloId,
                  parcela: numeroSienge,
                })
                continue
              }
              if (await this.marcarPaga(l.id, parcela, pagoEm, tituloId, !noExtrato, sistema)) {
                pagas++
                if (!noExtrato) detalhe.datasAproximadas++
              }
            }
          } catch (erro) {
            // Um título com problema não impede a conferência dos outros.
            if (!(erro instanceof ErroSienge)) throw erro
            detalhe.falhas.push(`título ${tituloId}: ${mensagemDe(erro)}`)
          }
        }
      }

      await this.db
        .update(siengeConferencias)
        .set({
          fim: new Date(),
          situacao: 'ok',
          verificados,
          vinculados,
          pagas,
          requisicoes: conta.requisicoes,
          extratoDe: extrato?.de ?? null,
          extratoAte: extrato?.ate ?? null,
          detalhe,
        })
        .where(eq(siengeConferencias.id, registroId))
      this.log.log(
        `${verificados} em aberto, ${vinculados} vinculados, ${pagas} parcelas pagas, ${conta.requisicoes} requisições`,
      )
    } catch (erro) {
      this.log.error(`conferência falhou: ${(erro as Error).message}`)
      if (registroId !== null) {
        await this.db
          .update(siengeConferencias)
          .set({
            fim: new Date(),
            situacao: 'erro',
            erro: mensagemDe(erro),
            verificados,
            vinculados,
            pagas,
            requisicoes: conta.requisicoes,
            extratoDe: extrato?.de ?? null,
            extratoAte: extrato?.ate ?? null,
            detalhe,
          })
          .where(eq(siengeConferencias.id, registroId))
          .catch((e: Error) => this.log.error(`sem registrar a falha: ${e.message}`))
      }
    } finally {
      this.rodando = false
    }
  }

  private async usuarioSistema(): Promise<number> {
    const [u] = await this.db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, EMAIL_USUARIO_SIENGE))
    if (!u) {
      throw new Error(`usuário ${EMAIL_USUARIO_SIENGE} não existe; rode o seed (npm run db:seed)`)
    }
    return u.id
  }

  /**
   * Ativos, com parcela em aberto, fora do cartão (compra no cartão é paga
   * pela fatura, que é outro título no Sienge).
   */
  private async lancamentosAbertos(): Promise<Aberto[]> {
    const linhas = await this.db
      .select({
        id: lancamentos.id,
        setorId: lancamentos.setorId,
        valorCentavos: lancamentos.valorCentavos,
        dataGasto: lancamentos.dataGasto,
        codigoIdentificacao: lancamentos.codigoIdentificacao,
        siengeTituloId: lancamentos.siengeTituloId,
        pausadoEm: lancamentos.siengePausadoEm,
        documento: fornecedores.documento,
        fornecedorNome: fornecedores.nome,
        empreendimentoNome: empreendimentos.nome,
      })
      .from(lancamentos)
      .leftJoin(fornecedores, eq(fornecedores.id, lancamentos.fornecedorId))
      .leftJoin(empreendimentos, eq(empreendimentos.id, lancamentos.empreendimentoId))
      .leftJoin(formasPagamento, eq(formasPagamento.id, lancamentos.formaPagamentoId))
      .where(
        and(
          eq(lancamentos.situacao, 'ativo'),
          isNull(lancamentos.cartaoId),
          sql`coalesce(${formasPagamento.cartao}, false) = false`,
          sql`exists (select 1 from ${parcelas} where ${parcelas.lancamentoId} = ${lancamentos.id} and ${parcelas.pagoEm} is null)`,
        ),
      )
      .orderBy(asc(lancamentos.id))
    if (!linhas.length) return []

    const todas = await this.db
      .select({
        id: parcelas.id,
        lancamentoId: parcelas.lancamentoId,
        numero: parcelas.numero,
        vencimento: parcelas.vencimento,
        pagoEm: parcelas.pagoEm,
      })
      .from(parcelas)
      .where(
        inArray(
          parcelas.lancamentoId,
          linhas.map((l) => l.id),
        ),
      )
      .orderBy(asc(parcelas.numero))
    return linhas.map(({ pausadoEm, ...l }) => ({
      ...l,
      pausado: pausadoEm !== null,
      parcelas: todas.filter((p) => p.lancamentoId === l.id),
    }))
  }

  /**
   * Casa os lançamentos sem título. Devolve lançamento → título dos que
   * casaram. Um título disputado por dois lançamentos não fica com nenhum.
   *
   * Os candidatos vêm de dois lugares: com o CNPJ/CPF do fornecedor, os
   * títulos do credor no Sienge; sem ele (ou sem credor com ele lá), os
   * títulos do setor na cópia do Sienge, comparando o nome do fornecedor e o
   * número da nota. A escolha é por provas (casamento.ts).
   */
  private async vincular(
    semTitulo: Aberto[],
    lerParcelas: (tituloId: number) => Promise<ParcelaSienge[]>,
    detalhe: DetalheConferencia,
    conta: Conta,
  ): Promise<Map<number, number>> {
    const limite = somarDias(hoje(), -DIAS_PROCURANDO)
    // Pausado não é vinculado de novo; lançamento com data no futuro distante ainda não tem título lá.
    const procurados = semTitulo.filter(
      (l) => !l.pausado && l.dataGasto >= limite && this.janela(l),
    )
    if (!procurados.length) return new Map()

    const jaUsados = new Set(
      (
        await this.db
          .select({ id: lancamentos.siengeTituloId })
          .from(lancamentos)
          .where(isNotNull(lancamentos.siengeTituloId))
      ).map((l) => l.id!),
    )
    const setores = await this.contextosDosSetores(procurados, detalhe, conta)

    const escolhas = new Map<number, { tituloId: number; provas: ProvaSienge[] }>()
    const registrar = (l: Aberto, r: Casamento) => {
      if (r.tipo === 'casado') escolhas.set(l.id, { tituloId: r.tituloId, provas: r.provas })
      else if (r.tipo === 'ambiguo') {
        detalhe.ambiguos.push({ lancamentoId: l.id, tituloIds: r.tituloIds })
      }
    }

    // 1. Com CNPJ/CPF: os títulos do credor no Sienge.
    const porDocumento = new Map<string, Aberto[]>()
    const semCredor: Aberto[] = []
    for (const l of procurados) {
      if (l.documento) porDocumento.set(l.documento, [...(porDocumento.get(l.documento) ?? []), l])
      else semCredor.push(l)
    }
    for (const [documento, lista] of porDocumento) {
      try {
        const credores = await this.credoresDo(documento, conta)
        // O CNPJ não é credor lá: o título está em nome de outro (a processadora do pagamento, por exemplo).
        if (!credores.length) {
          semCredor.push(...lista)
          continue
        }

        // Janela de emissão: do mais cedo (gasto ou 1º vencimento) − 45 dias ao mais tarde + 10, sem passar de hoje.
        const janelas = lista.map((l) => this.janela(l)!)
        const inicio = janelas.map((j) => j.inicio).sort()[0]!
        const fim = janelas
          .map((j) => j.fim)
          .sort()
          .at(-1)!
        const titulos: TituloCandidato[] = []
        for (const credorId of credores) {
          const doCredor = await this.sienge!.listar<TituloCandidato>(
            '/bills',
            { creditorId: credorId, startDate: inicio, endDate: fim },
            conta,
          )
          titulos.push(...doCredor.filter((t) => tituloElegivel(t) && !jaUsados.has(t.id)))
        }
        const centros = await this.centrosDosTitulos(titulos.map((t) => t.id))

        for (const l of lista) {
          const ctx = setores.get(l.setorId) ?? null
          const candidatos: Candidato[] = this.naJanela(l, titulos).map((t) => ({
            titulo: t,
            doFornecedor: true,
            nomeParecido: false,
            centros: this.centrosConhecidos(t, centros),
            parcelas: null,
          }))
          registrar(l, await this.escolher(l, candidatos, lerParcelas, ctx))
        }
      } catch (erro) {
        // Um fornecedor com problema no Sienge não impede os outros nem a conferência de pagamento.
        if (!(erro instanceof ErroSienge)) throw erro
        detalhe.falhas.push(`fornecedor ${documento}: ${mensagemDe(erro)}`)
      }
    }

    // 2. Sem CNPJ/CPF: os títulos do setor na cópia, pelo nome do fornecedor e pelo número da nota.
    for (const l of semCredor) {
      // Setor sem centro de custo no Sienge (ou que falhou, já em `falhas`): não há cópia onde procurar.
      const ctx = setores.get(l.setorId) ?? null
      if (!ctx) continue
      const temNumero = !!numeroDoCodigo(l.codigoIdentificacao)
      const temNome = palavras(l.fornecedorNome).some((p) => p.length >= 4)
      if (!temNumero && !temNome) {
        detalhe.semDados++
        continue
      }
      try {
        const candidatos = await this.candidatosDaCopia(l, ctx, jaUsados, conta)
        registrar(l, await this.escolher(l, candidatos, lerParcelas, ctx))
      } catch (erro) {
        if (!(erro instanceof ErroSienge)) throw erro
        detalhe.falhas.push(`lançamento #${l.id}: ${mensagemDe(erro)}`)
      }
    }

    // Título escolhido por mais de um lançamento: ambíguo do lado do SIGO, nenhum fica com ele.
    const disputa = new Map<number, number[]>()
    for (const [lancamentoId, { tituloId }] of escolhas) {
      disputa.set(tituloId, [...(disputa.get(tituloId) ?? []), lancamentoId])
    }
    const vinculados = new Map<number, number>()
    for (const [tituloId, ids] of disputa) {
      if (ids.length > 1) {
        for (const id of ids) detalhe.ambiguos.push({ lancamentoId: id, tituloIds: [tituloId] })
        continue
      }
      const lancamentoId = ids[0]!
      const provas = escolhas.get(lancamentoId)!.provas
      try {
        // Só se o lançamento continua ativo e sem título: ele pode ter sido cancelado no meio da rodada.
        const [gravado] = await this.db
          .update(lancamentos)
          .set({
            siengeTituloId: tituloId,
            siengeVinculo: vinculoDas(provas),
            siengeProvas: provas,
            siengeVinculadoEm: new Date(),
          })
          .where(
            and(
              eq(lancamentos.id, lancamentoId),
              eq(lancamentos.situacao, 'ativo'),
              isNull(lancamentos.siengeTituloId),
            ),
          )
          .returning({ id: lancamentos.id })
        if (gravado) vinculados.set(lancamentoId, tituloId)
      } catch (erro) {
        // Outro lançamento pegou o título nesse meio tempo (índice único): fica para conferir à mão.
        this.log.warn(
          `título ${tituloId} já vinculado; lançamento #${lancamentoId} não vinculado (${(erro as Error).message})`,
        )
        detalhe.ambiguos.push({ lancamentoId, tituloIds: [tituloId] })
      }
    }
    return vinculados
  }

  /**
   * Janela de emissão em que o título pode estar: do mais cedo (gasto ou
   * vencimento) − 45 dias ao mais tarde + 10, sem passar de hoje. `null`
   * quando ainda não pode haver título (tudo no futuro).
   */
  private janela(l: Aberto): { inicio: string; fim: string } | null {
    const datas = [l.dataGasto, ...l.parcelas.map((p) => p.vencimento)].sort()
    const inicio = somarDias(datas[0]!, -45)
    const fimDasDatas = somarDias(datas.at(-1)!, 10)
    const dia = hoje()
    const fim = fimDasDatas < dia ? fimDasDatas : dia
    return inicio <= fim ? { inicio, fim } : null
  }

  /** Títulos com emissão dentro da janela do lançamento. */
  private naJanela(l: Aberto, titulos: TituloCandidato[]): TituloCandidato[] {
    const { inicio, fim } = this.janela(l)!
    return titulos.filter((t) => {
      const emissao = t.issueDate?.slice(0, 10) ?? ''
      return emissao >= inicio && emissao <= fim
    })
  }

  /**
   * O setor de cada lançamento no Sienge: os centros de custo e a cópia dos
   * títulos dos meses em que os lançamentos são procurados (refeita aqui se
   * venceu). Setor sem centro de custo lá fica `null`.
   */
  private async contextosDosSetores(
    procurados: Aberto[],
    detalhe: DetalheConferencia,
    conta: Conta,
  ): Promise<Map<number, ContextoSetor | null>> {
    const contextos = new Map<number, ContextoSetor | null>()
    const maisAntigo = somarMesesAoMes(hoje().slice(0, 7), -MESES_DA_COPIA)
    for (const setorId of new Set(procurados.map((l) => l.setorId))) {
      try {
        const info = await this.quadro.centrosDoSetor(setorId, conta)
        if (!info?.centros.length) {
          contextos.set(setorId, null)
          continue
        }
        const meses = new Set<string>()
        for (const l of procurados) {
          if (l.setorId !== setorId) continue
          const { inicio, fim } = this.janela(l)!
          for (let m = inicio.slice(0, 7); m <= fim.slice(0, 7); m = somarMesesAoMes(m, 1)) {
            if (m >= maisAntigo) meses.add(m)
          }
        }
        await this.quadro.copiaDosMeses(setorId, [...meses], conta)
        contextos.set(setorId, info)
      } catch (erro) {
        if (!(erro instanceof ErroSienge)) throw erro
        detalhe.falhas.push(`centros de custo do setor ${setorId}: ${mensagemDe(erro)}`)
        contextos.set(setorId, null)
      }
    }
    return contextos
  }

  /** Centros de custo em que cada título da cópia está apropriado. */
  private async centrosDosTitulos(ids: number[]): Promise<Map<number, number[]>> {
    const centros = new Map<number, number[]>()
    if (!ids.length) return centros
    const linhas = await this.db
      .select({ tituloId: siengeApropriacoes.tituloId, centroId: siengeApropriacoes.centroCustoId })
      .from(siengeApropriacoes)
      .where(inArray(siengeApropriacoes.tituloId, ids))
    for (const { tituloId, centroId } of linhas) {
      centros.set(tituloId, [...(centros.get(tituloId) ?? []), centroId])
    }
    return centros
  }

  /**
   * Os centros de custo do título, se ele está na cópia; fora dela, não se
   * sabe (null). Não estar na cópia não quer dizer que não é do setor: a
   * cópia pode ser de antes de o título ser lançado no Sienge.
   */
  private centrosConhecidos(t: TituloCandidato, centros: Map<number, number[]>): number[] | null {
    return centros.get(t.id) ?? null
  }

  /**
   * Candidatos de um lançamento sem CNPJ/CPF: os títulos do setor na cópia,
   * emitidos na janela, que o valor não descarta (o valor igual, ou o mesmo
   * número de nota, com imposto retido). O nome do credor de cada um é
   * comparado com o do fornecedor.
   */
  private async candidatosDaCopia(
    l: Aberto,
    ctx: ContextoSetor,
    jaUsados: Set<number>,
    conta: Conta,
  ): Promise<Candidato[]> {
    const { inicio, fim } = this.janela(l)!
    const linhas = await this.db
      .select({
        id: siengeTitulos.id,
        emissao: siengeTitulos.emissao,
        valorCentavos: siengeTitulos.valorCentavos,
        situacao: siengeTitulos.situacao,
        credorId: siengeTitulos.credorId,
        // Linha da cópia anterior às colunas separadas e ainda não rebuscada: o tipo é a 1ª palavra.
        tipoDocumento: sql<
          string | null
        >`coalesce(${siengeTitulos.tipoDocumento}, nullif(split_part(${siengeTitulos.documento}, ' ', 1), ''))`,
        numeroDocumento: siengeTitulos.numeroDocumento,
      })
      .from(siengeTitulos)
      .where(
        and(
          between(siengeTitulos.emissao, inicio, fim),
          sql`exists (select 1 from ${siengeApropriacoes} a where a.titulo_id = ${siengeTitulos.id} and a.centro_custo_id in ${ctx.centros.map((c) => c.id)})`,
        ),
      )
    const numero = numeroDoCodigo(l.codigoIdentificacao)
    const possiveis = linhas.filter(
      (t) =>
        !jaUsados.has(t.id) &&
        tituloElegivel({
          id: t.id,
          status: t.situacao,
          documentIdentificationId: t.tipoDocumento,
        }) &&
        (t.valorCentavos === l.valorCentavos ||
          (!!numero && numeroDoSienge(t.numeroDocumento) === numero)),
    )
    if (!possiveis.length) return []

    const centros = await this.centrosDosTitulos(possiveis.map((t) => t.id))
    const nomes = l.fornecedorNome
      ? await this.nomesDosCredores(
          [...new Set(possiveis.map((t) => t.credorId).filter((id): id is number => id !== null))],
          conta,
        )
      : new Map<number, { nome: string | null; nomeFantasia: string | null }>()
    return possiveis.map((t) => {
      const credor = t.credorId !== null ? nomes.get(t.credorId) : undefined
      return {
        titulo: {
          id: t.id,
          creditorId: t.credorId,
          documentIdentificationId: t.tipoDocumento,
          documentNumber: t.numeroDocumento,
          issueDate: t.emissao,
          totalInvoiceAmount: t.valorCentavos / 100,
          status: t.situacao,
        },
        doFornecedor: false,
        nomeParecido: !!credor && nomesParecidos(l.fornecedorNome, credor),
        centros: centros.get(t.id) ?? [],
        parcelas: null,
      }
    })
  }

  /** Nome e fantasia de cada credor do Sienge (guardados por 30 dias). */
  private async nomesDosCredores(
    ids: number[],
    conta: Conta,
  ): Promise<Map<number, { nome: string | null; nomeFantasia: string | null }>> {
    const nomes = new Map<number, { nome: string | null; nomeFantasia: string | null }>()
    if (!ids.length) return nomes
    const guardados = await this.db
      .select()
      .from(siengeCredoresNomes)
      .where(inArray(siengeCredoresNomes.id, ids))
    for (const g of guardados) {
      if (Date.now() - g.consultadoEm.getTime() < PRAZO_CREDORES_MS) nomes.set(g.id, g)
    }
    for (const id of ids) {
      if (nomes.has(id)) continue
      const credor = await this.sienge!.get<CredorNomeApi>(`/creditors/${id}`, {}, [404], conta)
      const linha = {
        nome: credor?.name?.trim() || null,
        nomeFantasia: credor?.tradeName?.trim() || null,
        consultadoEm: new Date(),
      }
      await this.db
        .insert(siengeCredoresNomes)
        .values({ id, ...linha })
        .onConflictDoUpdate({ target: siengeCredoresNomes.id, set: linha })
      nomes.set(id, linha)
    }
    return nomes
  }

  /** O lançamento como o casamento vê. */
  private paraCasar(l: Aberto, ctx: ContextoSetor | null): LancamentoParaCasar {
    return {
      valorCentavos: l.valorCentavos,
      codigoIdentificacao: l.codigoIdentificacao,
      dataGasto: l.dataGasto,
      vencimentos: l.parcelas.map((p) => p.vencimento).sort(),
      centroDoEmpreendimento: ctx
        ? centroDoEmpreendimento(l.empreendimentoNome, ctx.centros, ctx.trecho)
        : null,
      centrosDoSetor: ctx?.centros.map((c) => c.id) ?? [],
    }
  }

  /**
   * Decide entre os candidatos. O vencimento só vem das parcelas de cada
   * título (uma requisição por título), lidas só dos que nada contradiz; com
   * muitos títulos iguais, só o número da nota separa.
   */
  private async escolher(
    l: Aberto,
    candidatos: Candidato[],
    lerParcelas: (tituloId: number) => Promise<ParcelaSienge[]>,
    ctx: ContextoSetor | null,
  ): Promise<Casamento> {
    const base = this.paraCasar(l, ctx)
    let vivos = candidatos.filter((c) => provasDe(base, c) !== null)
    if (vivos.length > LIMITE_CANDIDATOS) {
      // Muitos títulos de mesmo valor: fica quem tem o mesmo número de nota; sem nota, o
      // credor de nome parecido (na busca sem CNPJ). Senão, não há como separar.
      const comNumero = vivos.filter((c) => provasDe(base, c)!.includes('numero'))
      const comNome = vivos.filter((c) => c.nomeParecido)
      const restantes = comNumero.length ? comNumero : comNome
      if (!restantes.length || restantes.length > LIMITE_CANDIDATOS) {
        return { tipo: 'ambiguo', tituloIds: vivos.map((c) => c.titulo.id) }
      }
      vivos = restantes
    }
    for (const c of vivos) c.parcelas = await lerParcelas(c.titulo.id)
    return decidir(base, vivos)
  }

  /** Ids de credor do Sienge para um CNPJ/CPF (guardados por 30 dias). */
  private async credoresDo(documento: string, conta: Conta): Promise<number[]> {
    const [guardado] = await this.db
      .select()
      .from(siengeCredores)
      .where(eq(siengeCredores.documento, documento))
    if (guardado && Date.now() - guardado.consultadoEm.getTime() < PRAZO_CREDORES_MS) {
      return guardado.ids
    }

    const parametro = documento.length === 11 ? { cpf: documento } : { cnpj: documento }
    const ids = (await this.sienge!.listar<CredorApi>('/creditors', parametro, conta)).map(
      (c) => c.id,
    )
    await this.db
      .insert(siengeCredores)
      .values({ documento, ids, consultadoEm: new Date() })
      .onConflictDoUpdate({
        target: siengeCredores.documento,
        set: { ids, consultadoEm: new Date() },
      })
    return ids
  }

  /**
   * Lê o extrato de contas a partir do pagamento mais recente já guardado
   * (com 10 dias de folga, porque baixa pode ser lançada com data retroativa)
   * e guarda os pagamentos de contas a pagar. Sem nada guardado, lê os
   * últimos 60 dias; nunca mais que isso de uma vez. Devolve o período lido.
   */
  private async atualizarExtrato(conta: Conta): Promise<{ de: string; ate: string }> {
    const [guardado] = await this.db
      .select({ ultimo: sql<string | null>`max(${siengeMovimentos.data})::text` })
      .from(siengeMovimentos)
    const dia = hoje()
    const limite = somarDias(dia, -DIAS_EXTRATO_INICIAL)
    const desde = guardado?.ultimo ? somarDias(guardado.ultimo, -10) : limite
    const inicio = desde < limite ? limite : desde

    const lidos = await this.sienge!.listar<MovimentoApi>(
      '/accounts-statements',
      { startDate: inicio, endDate: dia },
      conta,
    )
    // Só pagamento de contas a pagar: o id de título a receber (CR) é outra numeração e colidiria.
    const pagamentos = lidos.filter(
      (m) =>
        m.statementOrigin === 'CP' &&
        m.type === 'Expense' &&
        m.billId &&
        m.installmentNumber &&
        m.date,
    )
    for (let i = 0; i < pagamentos.length; i += 500) {
      const lote = pagamentos.slice(i, i + 500).map((m) => ({
        id: m.id,
        tituloId: m.billId!,
        parcela: m.installmentNumber!,
        data: m.date!.slice(0, 10),
        valorCentavos: Math.round((m.value ?? 0) * 100),
      }))
      await this.db
        .insert(siengeMovimentos)
        .values(lote)
        .onConflictDoUpdate({
          target: siengeMovimentos.id,
          set: {
            tituloId: sql.raw('excluded.titulo_id'),
            parcela: sql.raw('excluded.parcela'),
            data: sql.raw('excluded.data'),
            valorCentavos: sql.raw('excluded.valor_centavos'),
          },
        })
    }
    return { de: inicio, ate: dia }
  }

  /**
   * Desde quando o extrato já foi lido: a leitura mais antiga que deu certo.
   * Pagamento sem movimento só é aceito se venceu antes disso.
   */
  private async inicioDoExtratoLido(desta: string): Promise<string> {
    const [r] = await this.db
      .select({ de: sql<string | null>`min(${siengeConferencias.extratoDe})::text` })
      .from(siengeConferencias)
      .where(eq(siengeConferencias.situacao, 'ok'))
    return r?.de && r.de < desta ? r.de : desta
  }

  /**
   * Marca a parcela como paga, com o evento no histórico. Dentro da transação
   * confere de novo o lançamento (travado): continua ativo, com este título e
   * sem pausa. Parcela que alguém pagou nesse meio tempo fica como está.
   */
  private async marcarPaga(
    lancamentoId: number,
    parcela: ParcelaSigo,
    pagoEm: string,
    tituloId: number,
    aproximada: boolean,
    sistema: number,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [atual] = await tx
        .select({
          situacao: lancamentos.situacao,
          tituloId: lancamentos.siengeTituloId,
          pausadoEm: lancamentos.siengePausadoEm,
        })
        .from(lancamentos)
        .where(eq(lancamentos.id, lancamentoId))
        .for('update')
      if (!atual || atual.situacao !== 'ativo' || atual.tituloId !== tituloId || atual.pausadoEm) {
        return false
      }
      const [marcada] = await tx
        .update(parcelas)
        .set({ pagoEm })
        .where(and(eq(parcelas.id, parcela.id), isNull(parcelas.pagoEm)))
        .returning({ id: parcelas.id })
      if (!marcada) return false
      await tx
        .update(lancamentos)
        .set({ atualizadoPor: sistema, atualizadoEm: new Date() })
        .where(eq(lancamentos.id, lancamentoId))
      await tx.insert(eventos).values({
        lancamentoId,
        tipo: 'pagamento_registrado',
        usuarioId: sistema,
        dados: {
          parcela: parcela.numero,
          pagoEm,
          origem: 'sienge',
          tituloSienge: tituloId,
          ...(aproximada ? { dataAproximada: true } : {}),
        },
      })
      return true
    })
  }
}

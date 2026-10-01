import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { and, asc, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import { enxergaSetor, exigirEdicaoNoSetor } from '../common/acesso.js'
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
import { hoje } from '../contracts/datas.js'
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
  recargasCartao,
  setores,
} from '../db/schema.js'

const CARTAO_REPETIDO = 'Já existe um cartão com esse nome neste setor'

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

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import { exigirEdicaoNoSetor, setoresVisiveis } from '../common/acesso.js'
import { ehViolacaoUnica } from '../common/erros-db.js'
import { erroDeValidacao } from '../common/validacao.js'
import type { UsuarioSessao } from '../contracts/auth.js'
import type {
  Cadastros,
  Campanha,
  Categoria,
  EditarFornecedor,
  EditarItem,
  Empreendimento,
  FormaPagamento,
  Fornecedor,
  Lista,
  NovoFornecedor,
  NovoItem,
} from '../contracts/cadastros.js'
import type { Database } from '../db/client.js'
import { DB } from '../db/database.module.js'
import {
  campanhas,
  cartoes,
  categorias,
  empreendimentos,
  formasPagamento,
  fornecedores,
  setores,
} from '../db/schema.js'
import { listarCartoes } from './cartoes.service.js'

type ItemDeLista = Categoria | FormaPagamento | Empreendimento | Campanha

function exigirAdmin(usuario: UsuarioSessao): void {
  if (usuario.papel !== 'admin') {
    throw new ForbiddenException('Só administradores alteram esta lista')
  }
}

const ITEM_REPETIDO = 'Já existe um item com esse nome nesta lista'

@Injectable()
export class CadastrosService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** As listas do formulário. Categorias e campanhas vêm só dos setores que a pessoa enxerga. */
  async listar(usuario: UsuarioSessao): Promise<Cadastros> {
    const visiveis = setoresVisiveis(usuario)
    const doSetor = (
      coluna: typeof categorias.setorId | typeof campanhas.setorId | typeof cartoes.setorId,
    ): SQL | undefined =>
      visiveis === null ? undefined : inArray(coluna, visiveis.length ? visiveis : [-1])

    const [
      listaSetores,
      listaCategorias,
      listaFormas,
      listaEmpreendimentos,
      listaCampanhas,
      listaCartoes,
    ] = await Promise.all([
      this.db
        .select({ id: setores.id, nome: setores.nome, slug: setores.slug, ativo: setores.ativo })
        .from(setores)
        .where(
          visiveis === null ? undefined : inArray(setores.id, visiveis.length ? visiveis : [-1]),
        )
        .orderBy(asc(setores.nome)),
      this.db
        .select({
          id: categorias.id,
          setorId: categorias.setorId,
          nome: categorias.nome,
          descricao: categorias.descricao,
          ativo: categorias.ativo,
          ordem: categorias.ordem,
        })
        .from(categorias)
        .where(doSetor(categorias.setorId))
        .orderBy(asc(categorias.ordem), asc(categorias.nome)),
      this.db
        .select({
          id: formasPagamento.id,
          nome: formasPagamento.nome,
          cartao: formasPagamento.cartao,
          ativo: formasPagamento.ativo,
          ordem: formasPagamento.ordem,
        })
        .from(formasPagamento)
        .orderBy(asc(formasPagamento.ordem), asc(formasPagamento.nome)),
      this.db
        .select({
          id: empreendimentos.id,
          nome: empreendimentos.nome,
          institucional: empreendimentos.institucional,
          ativo: empreendimentos.ativo,
          ordem: empreendimentos.ordem,
        })
        .from(empreendimentos)
        // "Institucional" primeiro: é a escolha de quem não sabe de qual empreendimento é o gasto.
        .orderBy(
          desc(empreendimentos.institucional),
          asc(empreendimentos.ordem),
          asc(empreendimentos.nome),
        ),
      this.db
        .select({
          id: campanhas.id,
          setorId: campanhas.setorId,
          nome: campanhas.nome,
          ativo: campanhas.ativo,
        })
        .from(campanhas)
        .where(doSetor(campanhas.setorId))
        .orderBy(asc(campanhas.nome)),
      listarCartoes(this.db, doSetor(cartoes.setorId)),
    ])

    return {
      setores: listaSetores,
      categorias: listaCategorias,
      formasPagamento: listaFormas,
      empreendimentos: listaEmpreendimentos,
      campanhas: listaCampanhas,
      cartoes: listaCartoes,
    }
  }

  /**
   * Categorias, formas de pagamento e empreendimentos mudam pouco e valem para
   * todos: só o admin mexe. Campanha nasce toda hora no dia a dia do setor, e
   * quem lança no setor pode criar.
   */
  async criarItem(usuario: UsuarioSessao, lista: Lista, item: NovoItem): Promise<ItemDeLista> {
    try {
      switch (lista) {
        case 'categorias': {
          exigirAdmin(usuario)
          const setorId = await this.setorDoItem(item.setorId)
          const [novo] = await this.db
            .insert(categorias)
            .values({ setorId, nome: item.nome, descricao: item.descricao, ordem: 999 })
            .returning()
          return this.semCriadoEm(novo!)
        }
        case 'campanhas': {
          const setorId = await this.setorDoItem(item.setorId)
          exigirEdicaoNoSetor(usuario, setorId)
          const [novo] = await this.db
            .insert(campanhas)
            .values({ setorId, nome: item.nome })
            .returning()
          return this.semCriadoEm(novo!)
        }
        case 'formas-pagamento': {
          exigirAdmin(usuario)
          const [novo] = await this.db
            .insert(formasPagamento)
            .values({ nome: item.nome, cartao: item.cartao ?? false, ordem: 999 })
            .returning()
          return this.semCriadoEm(novo!)
        }
        case 'empreendimentos': {
          exigirAdmin(usuario)
          const [novo] = await this.db
            .insert(empreendimentos)
            .values({ nome: item.nome, institucional: item.institucional ?? false, ordem: 999 })
            .returning()
          return this.semCriadoEm(novo!)
        }
      }
    } catch (err) {
      if (ehViolacaoUnica(err)) throw new ConflictException(ITEM_REPETIDO)
      throw err
    }
  }

  async editarItem(
    usuario: UsuarioSessao,
    lista: Lista,
    id: number,
    mudancas: EditarItem,
  ): Promise<ItemDeLista> {
    const comuns = {
      ...(mudancas.nome !== undefined && { nome: mudancas.nome }),
      ...(mudancas.ativo !== undefined && { ativo: mudancas.ativo }),
    }
    const ordem = mudancas.ordem !== undefined ? { ordem: mudancas.ordem } : {}

    try {
      switch (lista) {
        case 'categorias': {
          exigirAdmin(usuario)
          const campos = {
            ...comuns,
            ...ordem,
            ...(mudancas.descricao !== undefined && { descricao: mudancas.descricao }),
          }
          const [item] = Object.keys(campos).length
            ? await this.db.update(categorias).set(campos).where(eq(categorias.id, id)).returning()
            : await this.db.select().from(categorias).where(eq(categorias.id, id))
          return this.semCriadoEm(this.encontrado(item))
        }
        case 'campanhas': {
          const [atual] = await this.db
            .select({ setorId: campanhas.setorId })
            .from(campanhas)
            .where(eq(campanhas.id, id))
          exigirEdicaoNoSetor(usuario, this.encontrado(atual).setorId)
          const [item] = Object.keys(comuns).length
            ? await this.db.update(campanhas).set(comuns).where(eq(campanhas.id, id)).returning()
            : await this.db.select().from(campanhas).where(eq(campanhas.id, id))
          return this.semCriadoEm(this.encontrado(item))
        }
        case 'formas-pagamento': {
          exigirAdmin(usuario)
          const campos = {
            ...comuns,
            ...ordem,
            ...(mudancas.cartao !== undefined && { cartao: mudancas.cartao }),
          }
          const [item] = Object.keys(campos).length
            ? await this.db
                .update(formasPagamento)
                .set(campos)
                .where(eq(formasPagamento.id, id))
                .returning()
            : await this.db.select().from(formasPagamento).where(eq(formasPagamento.id, id))
          return this.semCriadoEm(this.encontrado(item))
        }
        case 'empreendimentos': {
          exigirAdmin(usuario)
          const campos = {
            ...comuns,
            ...ordem,
            ...(mudancas.institucional !== undefined && { institucional: mudancas.institucional }),
          }
          const [item] = Object.keys(campos).length
            ? await this.db
                .update(empreendimentos)
                .set(campos)
                .where(eq(empreendimentos.id, id))
                .returning()
            : await this.db.select().from(empreendimentos).where(eq(empreendimentos.id, id))
          return this.semCriadoEm(this.encontrado(item))
        }
      }
    } catch (err) {
      if (ehViolacaoUnica(err)) throw new ConflictException(ITEM_REPETIDO)
      throw err
    }
  }

  listarFornecedores(): Promise<Fornecedor[]> {
    return this.db
      .select({
        id: fornecedores.id,
        nome: fornecedores.nome,
        documento: fornecedores.documento,
        ativo: fornecedores.ativo,
      })
      .from(fornecedores)
      .orderBy(asc(fornecedores.nome))
  }

  /**
   * Com documento repetido devolve 409 com o fornecedor que já existe, para o
   * formulário oferecer "usar este" em vez de só recusar.
   */
  async criarFornecedor(usuario: UsuarioSessao, dados: NovoFornecedor): Promise<Fornecedor> {
    if (dados.documento) {
      const [existente] = await this.db
        .select({
          id: fornecedores.id,
          nome: fornecedores.nome,
          documento: fornecedores.documento,
          ativo: fornecedores.ativo,
        })
        .from(fornecedores)
        .where(eq(fornecedores.documento, dados.documento))
      if (existente) {
        throw new ConflictException({
          message: `Já existe um fornecedor com este documento: ${existente.nome}`,
          fornecedor: existente,
        })
      }
    }

    const [novo] = await this.db
      .insert(fornecedores)
      .values({ nome: dados.nome, documento: dados.documento, criadoPor: usuario.id })
      .returning({
        id: fornecedores.id,
        nome: fornecedores.nome,
        documento: fornecedores.documento,
        ativo: fornecedores.ativo,
      })
    return novo!
  }

  async editarFornecedor(id: number, mudancas: EditarFornecedor): Promise<Fornecedor> {
    const campos = {
      ...(mudancas.nome !== undefined && { nome: mudancas.nome }),
      ...(mudancas.documento !== undefined && { documento: mudancas.documento }),
      ...(mudancas.ativo !== undefined && { ativo: mudancas.ativo }),
    }
    const retorno = {
      id: fornecedores.id,
      nome: fornecedores.nome,
      documento: fornecedores.documento,
      ativo: fornecedores.ativo,
    }
    try {
      const [item] = Object.keys(campos).length
        ? await this.db
            .update(fornecedores)
            .set(campos)
            .where(eq(fornecedores.id, id))
            .returning(retorno)
        : await this.db.select(retorno).from(fornecedores).where(eq(fornecedores.id, id))
      return this.encontrado(item)
    } catch (err) {
      if (ehViolacaoUnica(err)) {
        throw new ConflictException('Já existe outro fornecedor com este documento')
      }
      throw err
    }
  }

  /** Confere que o setor informado existe; categorias e campanhas não vivem sem ele. */
  private async setorDoItem(setorId: number | undefined): Promise<number> {
    if (!setorId) throw erroDeValidacao([{ path: 'setorId', message: 'Escolha o setor' }])
    const [setor] = await this.db
      .select({ id: setores.id })
      .from(setores)
      .where(eq(setores.id, setorId))
    if (!setor) throw erroDeValidacao([{ path: 'setorId', message: 'Setor não encontrado' }])
    return setor.id
  }

  private encontrado<T>(item: T | undefined): T {
    if (!item) throw new NotFoundException('Item não encontrado')
    return item
  }

  private semCriadoEm<T extends { criadoEm: Date }>(item: T): Omit<T, 'criadoEm'> {
    const { criadoEm: _, ...resto } = item
    return resto
  }
}

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
// Só tipos: o drizzle-kit carrega este arquivo sozinho e não resolve importação de valor daqui.
import type { TipoAnexo } from '../contracts/anexos.js'
import type { Papel } from '../contracts/auth.js'
import type { RegistroLeitura } from '../contracts/leitura.js'
import type {
  DetalheConferencia,
  OrigemConferencia,
  SituacaoConferencia,
  ProvaSienge,
  VinculoSienge,
} from '../contracts/sienge.js'
import type { DadosEvento, SituacaoLancamento, TipoEvento } from '../contracts/lancamentos.js'

/*
  Convenções do banco:

  - Chave primária inteira gerada pelo banco. O número do lançamento é o que
    se fala com o Financeiro ("o lançamento 1042"), então ele precisa ser curto.
  - Dinheiro em centavos, `bigint`.
  - Data de calendário (gasto, vencimento, pagamento) é `date`, que chega ao
    TypeScript como texto "AAAA-MM-DD". Instante (quando algo foi gravado) é
    `timestamptz`.
  - Nada se apaga: cadastro é desativado e lançamento é cancelado. O histórico
    de cada lançamento fica em `eventos`, onde só se acrescenta linha.
  - Nada aqui depende do Postgres 17 ou 18: produção roda o 16 da VPS.
*/

const criadoEm = () => timestamp('criado_em', { withTimezone: true }).notNull().defaultNow()
const dia = (nome: string) => date(nome, { mode: 'string' })
const centavos = (nome: string) => bigint(nome, { mode: 'number' })

export const usuarios = pgTable(
  'usuarios',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    nome: text('nome').notNull(),
    /** Sempre em minúsculas: sem isso o índice único deixaria passar duplicata por maiúscula. */
    email: text('email').notNull().unique(),
    senhaHash: text('senha_hash').notNull(),
    papel: text('papel').$type<Papel>().notNull().default('leitor'),
    ativo: boolean('ativo').notNull().default(true),
    /**
     * Versão das sessões da pessoa. O cookie leva a versão em que foi emitido;
     * sair, trocar a senha ou ser desativado aumenta o número e derruba todas.
     */
    sessaoVersao: integer('sessao_versao').notNull().default(0),
    ultimoAcessoEm: timestamp('ultimo_acesso_em', { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }),
  },
  (t) => [check('usuarios_papel_check', sql`${t.papel} in ('admin', 'editor', 'leitor')`)],
)

/** Setor dono do gasto. O Marketing é o primeiro; os demais entram como linha nova, sem mudar código. */
export const setores = pgTable('setores', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  nome: text('nome').notNull().unique(),
  slug: text('slug').notNull().unique(),
  ativo: boolean('ativo').notNull().default(true),
  /**
   * Trecho do nome dos centros de custo do Sienge que são deste setor (no
   * Marketing, "MARKETING"). Vazio: o setor não é comparado com o Sienge.
   */
  siengeCentroCusto: text('sienge_centro_custo'),
  criadoEm: criadoEm(),
})

/** Quais setores cada pessoa enxerga. O admin enxerga todos e não precisa de linha aqui. */
export const usuarioSetores = pgTable(
  'usuario_setores',
  {
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    setorId: integer('setor_id')
      .notNull()
      .references(() => setores.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.setorId] })],
)

/** Categoria do gasto, por setor: as do Marketing não servem para Obras. */
export const categorias = pgTable(
  'categorias',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    setorId: integer('setor_id')
      .notNull()
      .references(() => setores.id),
    nome: text('nome').notNull(),
    /** Ajuda mostrada no formulário: o que entra nesta categoria. */
    descricao: text('descricao'),
    ativo: boolean('ativo').notNull().default(true),
    ordem: integer('ordem').notNull().default(0),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex('categorias_setor_nome_idx').on(t.setorId, sql`lower(${t.nome})`)],
)

export const formasPagamento = pgTable(
  'formas_pagamento',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    nome: text('nome').notNull(),
    /** Forma que é cartão: o lançamento pede qual cartão, e a fatura dele define o vencimento. */
    cartao: boolean('cartao').notNull().default(false),
    ativo: boolean('ativo').notNull().default(true),
    ordem: integer('ordem').notNull().default(0),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex('formas_pagamento_nome_idx').on(sql`lower(${t.nome})`)],
)

export const empreendimentos = pgTable(
  'empreendimentos',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    nome: text('nome').notNull(),
    /** O item "Institucional": gasto da marca, que não é de nenhum empreendimento. */
    institucional: boolean('institucional').notNull().default(false),
    ativo: boolean('ativo').notNull().default(true),
    ordem: integer('ordem').notNull().default(0),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex('empreendimentos_nome_idx').on(sql`lower(${t.nome})`)],
)

export const campanhas = pgTable(
  'campanhas',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    setorId: integer('setor_id')
      .notNull()
      .references(() => setores.id),
    nome: text('nome').notNull(),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex('campanhas_setor_nome_idx').on(t.setorId, sql`lower(${t.nome})`)],
)

/**
 * Fornecedor do gasto: quem prestou o serviço ou vendeu, não a processadora
 * do pagamento. O nome pode repetir (duas gráficas homônimas); o documento não.
 */
export const fornecedores = pgTable('fornecedores', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  nome: text('nome').notNull(),
  /** CPF ou CNPJ sem pontuação. Opcional, mas único quando existe. */
  documento: text('documento').unique(),
  ativo: boolean('ativo').notNull().default(true),
  criadoPor: integer('criado_por').references(() => usuarios.id),
  criadoEm: criadoEm(),
})

/**
 * Cartão do setor (o do Marketing, o pré-pago do plantão...), com o orçamento
 * do mês. Fechamento e vencimento da fatura, quando informados, definem o
 * vencimento de cada compra lançada nele.
 */
export const cartoes = pgTable(
  'cartoes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    setorId: integer('setor_id')
      .notNull()
      .references(() => setores.id),
    nome: text('nome').notNull(),
    /** Últimos 4 dígitos, para reconhecer o cartão na fatura. */
    final: text('final'),
    /** A forma de pagamento que este cartão é (crédito, pré-pago). */
    formaPagamentoId: integer('forma_pagamento_id')
      .notNull()
      .references(() => formasPagamento.id),
    orcamentoMensalCentavos: centavos('orcamento_mensal_centavos').notNull().default(0),
    diaFechamento: integer('dia_fechamento'),
    diaVencimento: integer('dia_vencimento'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: criadoEm(),
  },
  (t) => [
    uniqueIndex('cartoes_setor_nome_idx').on(t.setorId, sql`lower(${t.nome})`),
    check('cartoes_orcamento_check', sql`${t.orcamentoMensalCentavos} >= 0`),
    check(
      'cartoes_dias_check',
      sql`(${t.diaFechamento} is null or ${t.diaFechamento} between 1 and 31) and (${t.diaVencimento} is null or ${t.diaVencimento} between 1 and 31)`,
    ),
  ],
)

/**
 * Gasto que se repete todo mês no cartão (assinatura, ferramenta, hospedagem).
 * Conta como comprometido no orçamento do cartão e vira lançamento pelo botão
 * "lançar gastos fixos do mês", uma vez por mês.
 */
export const gastosFixos = pgTable(
  'gastos_fixos',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    cartaoId: integer('cartao_id')
      .notNull()
      .references(() => cartoes.id),
    descricao: text('descricao').notNull(),
    valorCentavos: centavos('valor_centavos').notNull(),
    /** Dia do mês em que a cobrança cai no cartão. */
    diaCobranca: integer('dia_cobranca').notNull().default(1),
    fornecedorId: integer('fornecedor_id')
      .notNull()
      .references(() => fornecedores.id),
    categoriaId: integer('categoria_id')
      .notNull()
      .references(() => categorias.id),
    empreendimentoId: integer('empreendimento_id')
      .notNull()
      .references(() => empreendimentos.id),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: criadoEm(),
  },
  (t) => [
    check('gastos_fixos_valor_positivo', sql`${t.valorCentavos} > 0`),
    check('gastos_fixos_dia_check', sql`${t.diaCobranca} between 1 and 31`),
    index('gastos_fixos_cartao_idx').on(t.cartaoId),
  ],
)

export const lancamentos = pgTable(
  'lancamentos',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    setorId: integer('setor_id')
      .notNull()
      .references(() => setores.id),
    descricao: text('descricao').notNull(),
    /** Valor total. A soma das parcelas fecha com ele (conferido na API). */
    valorCentavos: centavos('valor_centavos').notNull(),
    /** Quando a despesa aconteceu: é a data que decide o mês nos totais (sem data, vale o dia do registro). */
    dataGasto: dia('data_gasto').notNull(),
    // Classificação e pagamento são opcionais: só descrição e valor são obrigatórios.
    categoriaId: integer('categoria_id').references(() => categorias.id),
    formaPagamentoId: integer('forma_pagamento_id').references(() => formasPagamento.id),
    empreendimentoId: integer('empreendimento_id').references(() => empreendimentos.id),
    fornecedorId: integer('fornecedor_id').references(() => fornecedores.id),
    campanhaId: integer('campanha_id').references(() => campanhas.id),
    /** Qual cartão, quando a forma de pagamento é cartão. */
    cartaoId: integer('cartao_id').references(() => cartoes.id),
    /** Gasto fixo que originou este lançamento (lançado pelo botão do cartão). */
    gastoFixoId: integer('gasto_fixo_id').references(() => gastosFixos.id),
    /** Nº da nota, do boleto, do pedido ou da transação do cartão. */
    codigoIdentificacao: text('codigo_identificacao'),
    observacao: text('observacao'),
    situacao: text('situacao').$type<SituacaoLancamento>().notNull().default('ativo'),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoPor: integer('cancelado_por').references(() => usuarios.id),
    motivoCancelamento: text('motivo_cancelamento'),
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuarios.id),
    criadoEm: criadoEm(),
    atualizadoPor: integer('atualizado_por').references(() => usuarios.id),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }),
    /**
     * Título a pagar do Sienge que corresponde a este gasto, achado pela
     * conferência de pagamentos (sem FK: é id de outro sistema). Um título
     * serve a um lançamento só.
     */
    siengeTituloId: integer('sienge_titulo_id'),
    /** Como o título foi achado: pelo número do documento ou por valor e vencimento. */
    siengeVinculo: text('sienge_vinculo').$type<VinculoSienge>(),
    /** O que bateu entre o lançamento e o título (casamento.ts); null nos vínculos antigos. */
    siengeProvas: jsonb('sienge_provas').$type<ProvaSienge[]>(),
    siengeVinculadoEm: timestamp('sienge_vinculado_em', { withTimezone: true }),
    /**
     * Uma pessoa desfez um pagamento que a conferência tinha marcado: a partir
     * daí a conferência não marca mais nada neste lançamento (solto o vínculo,
     * a pausa sai junto).
     */
    siengePausadoEm: timestamp('sienge_pausado_em', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('lancamentos_sienge_titulo_idx')
      .on(t.siengeTituloId)
      .where(sql`${t.siengeTituloId} is not null`),
    check('lancamentos_valor_positivo', sql`${t.valorCentavos} > 0`),
    check('lancamentos_situacao_check', sql`${t.situacao} in ('ativo', 'cancelado')`),
    /* Cancelado sem data ou data sem cancelamento é estado impossível: o banco recusa. */
    check(
      'lancamentos_cancelamento_check',
      sql`(${t.situacao} = 'cancelado') = (${t.canceladoEm} is not null)`,
    ),
    index('lancamentos_setor_data_idx').on(t.setorId, t.dataGasto),
    index('lancamentos_categoria_idx').on(t.categoriaId),
    index('lancamentos_empreendimento_idx').on(t.empreendimentoId),
    index('lancamentos_fornecedor_idx').on(t.fornecedorId),
    index('lancamentos_cartao_data_idx').on(t.cartaoId, t.dataGasto),
    index('lancamentos_gasto_fixo_idx').on(t.gastoFixoId),
  ],
)

/** Toda despesa tem ao menos uma parcela: à vista é parcela única. */
export const parcelas = pgTable(
  'parcelas',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    lancamentoId: integer('lancamento_id')
      .notNull()
      .references(() => lancamentos.id),
    numero: integer('numero').notNull(),
    valorCentavos: centavos('valor_centavos').notNull(),
    vencimento: dia('vencimento').notNull(),
    /** Null enquanto não foi paga. */
    pagoEm: dia('pago_em'),
  },
  (t) => [
    uniqueIndex('parcelas_lancamento_numero_idx').on(t.lancamentoId, t.numero),
    check('parcelas_valor_positivo', sql`${t.valorCentavos} > 0`),
    /* "O que vence nos próximos dias" só olha parcela em aberto. */
    index('parcelas_em_aberto_idx')
      .on(t.vencimento)
      .where(sql`${t.pagoEm} is null`),
  ],
)

/**
 * Histórico de cada lançamento: quem fez o quê e quando. Só se acrescenta
 * linha; nada aqui é alterado ou apagado.
 */
export const eventos = pgTable(
  'eventos',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    lancamentoId: integer('lancamento_id')
      .notNull()
      .references(() => lancamentos.id),
    tipo: text('tipo').$type<TipoEvento>().notNull(),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    em: timestamp('em', { withTimezone: true }).notNull().defaultNow(),
    dados: jsonb('dados').$type<DadosEvento>(),
  },
  (t) => [index('eventos_lancamento_idx').on(t.lancamentoId, t.em)],
)

/**
 * Comprovante (PDF ou foto) de um lançamento. O arquivo fica na pasta
 * COMPROVANTES_DIR; aqui fica o registro. Sem lançamento, é um rascunho de
 * quem enviou (subiu no "Novo lançamento" e ainda não foi salvo). Comprovante
 * de lançamento não se apaga: sai da lista com `removidoEm`, e o arquivo fica.
 */
export const anexos = pgTable(
  'anexos',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    lancamentoId: integer('lancamento_id').references(() => lancamentos.id),
    nome: text('nome').notNull(),
    tipo: text('tipo').$type<TipoAnexo>().notNull(),
    tamanho: integer('tamanho').notNull(),
    /** Impressão digital do conteúdo: o mesmo arquivo em dois lançamentos gera aviso. */
    sha256: text('sha256').notNull(),
    /** Relativo à pasta dos comprovantes ("2026/09/<uuid>.pdf"). */
    caminho: text('caminho').notNull().unique(),
    enviadoPor: integer('enviado_por')
      .notNull()
      .references(() => usuarios.id),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
    removidoEm: timestamp('removido_em', { withTimezone: true }),
    removidoPor: integer('removido_por').references(() => usuarios.id),
    /** O que a IA leu do documento (para conferência), quando ele foi lido. */
    leitura: jsonb('leitura').$type<RegistroLeitura>(),
  },
  (t) => [
    index('anexos_lancamento_idx').on(t.lancamentoId),
    index('anexos_sha256_idx').on(t.sha256),
    check('anexos_tipo_check', sql`${t.tipo} in ('application/pdf', 'image/jpeg', 'image/png')`),
  ],
)

/*
  Cópia local do que o SIGO lê do Sienge: os títulos a pagar dos centros de
  custo de algum setor. Ao contrário do resto do banco, isto é cache e pode ser
  apagado; a próxima busca refaz. Os ids são os do Sienge.
*/

/** Centros de custo do Sienge, para achar os de cada setor pelo nome. */
export const siengeCentrosCusto = pgTable('sienge_centros_custo', {
  id: integer('id').primaryKey(),
  nome: text('nome').notNull(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
})

/** Título a pagar do Sienge. */
export const siengeTitulos = pgTable(
  'sienge_titulos',
  {
    id: integer('id').primaryKey(),
    emissao: dia('emissao').notNull(),
    valorCentavos: centavos('valor_centavos').notNull(),
    /** Consistência no Sienge: S completo, N incompleto, I em inclusão. */
    situacao: text('situacao'),
    credorId: integer('credor_id'),
    /** Tipo e número juntos, para leitura ("NFSE 00002684"). */
    documento: text('documento'),
    /** `documentIdentificationId` ("NFSE", "BOL"...). */
    tipoDocumento: text('tipo_documento'),
    /** `documentNumber` como veio ("00002684", ou texto livre). */
    numeroDocumento: text('numero_documento'),
    /** O `changedDate` como a API devolve: quando muda, a apropriação é buscada de novo. */
    alteradoEm: text('alterado_em'),
    /** O `alteradoEm` do título quando a apropriação foi buscada. */
    apropriacaoDe: text('apropriacao_de'),
    /** Quando a apropriação foi buscada; null = ainda não foi. */
    apropriacaoEm: timestamp('apropriacao_em', { withTimezone: true }),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sienge_titulos_emissao_idx').on(t.emissao)],
)

/** Apropriação do título por centro de custo e plano financeiro, em percentual do valor. */
export const siengeApropriacoes = pgTable(
  'sienge_apropriacoes',
  {
    tituloId: integer('titulo_id')
      .notNull()
      .references(() => siengeTitulos.id, { onDelete: 'cascade' }),
    centroCustoId: integer('centro_custo_id').notNull(),
    planoFinanceiroId: text('plano_financeiro_id').notNull(),
    percentual: numeric('percentual', { precision: 9, scale: 4 }).notNull(),
  },
  (t) => [
    // Nome curto: o gerado passaria dos 63 caracteres que o Postgres guarda.
    primaryKey({
      name: 'sienge_apropriacoes_pk',
      columns: [t.tituloId, t.centroCustoId, t.planoFinanceiroId],
    }),
    index('sienge_apropriacoes_centro_idx').on(t.centroCustoId),
  ],
)

/** Quando cada mês de cada setor foi buscado no Sienge: é o prazo da cópia. */
export const siengeMeses = pgTable(
  'sienge_meses',
  {
    setorId: integer('setor_id')
      .notNull()
      .references(() => setores.id),
    /** "AAAA-MM". */
    mes: text('mes').notNull(),
    buscadoEm: timestamp('buscado_em', { withTimezone: true }),
    erro: text('erro'),
    erroEm: timestamp('erro_em', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.setorId, t.mes] })],
)

/** Credores do Sienge por CNPJ/CPF (um documento pode ter mais de um cadastro lá). */
export const siengeCredores = pgTable('sienge_credores', {
  documento: text('documento').primaryKey(),
  ids: jsonb('ids').$type<number[]>().notNull(),
  consultadoEm: timestamp('consultado_em', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Nome de cada credor do Sienge (`/creditors/{id}`), para comparar com o nome
 * do fornecedor quando o lançamento não tem CNPJ/CPF.
 */
export const siengeCredoresNomes = pgTable('sienge_credores_nomes', {
  id: integer('id').primaryKey(),
  nome: text('nome'),
  nomeFantasia: text('nome_fantasia'),
  consultadoEm: timestamp('consultado_em', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Pagamentos do extrato de contas do Sienge (`/accounts-statements`, contas a
 * pagar). É daqui que sai a data em que cada parcela foi paga.
 */
export const siengeMovimentos = pgTable(
  'sienge_movimentos',
  {
    id: integer('id').primaryKey(),
    tituloId: integer('titulo_id').notNull(),
    parcela: integer('parcela').notNull(),
    data: dia('data').notNull(),
    valorCentavos: centavos('valor_centavos').notNull(),
  },
  (t) => [index('sienge_movimentos_titulo_idx').on(t.tituloId, t.parcela)],
)

/** Cada conferência de pagamentos com o Sienge: quando rodou e o que fez. */
export const siengeConferencias = pgTable(
  'sienge_conferencias',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    origem: text('origem').$type<OrigemConferencia>().notNull(),
    inicio: timestamp('inicio', { withTimezone: true }).notNull().defaultNow(),
    fim: timestamp('fim', { withTimezone: true }),
    situacao: text('situacao').$type<SituacaoConferencia>().notNull().default('andamento'),
    /** Lançamentos em aberto olhados. */
    verificados: integer('verificados').notNull().default(0),
    /** Lançamentos que ganharam título do Sienge nesta rodada. */
    vinculados: integer('vinculados').notNull().default(0),
    /** Parcelas marcadas como pagas. */
    pagas: integer('pagas').notNull().default(0),
    requisicoes: integer('requisicoes').notNull().default(0),
    /** Período do extrato de contas lido nesta rodada (quando foi lido). */
    extratoDe: dia('extrato_de'),
    extratoAte: dia('extrato_ate'),
    erro: text('erro'),
    detalhe: jsonb('detalhe').$type<DetalheConferencia>(),
  },
  (t) => [index('sienge_conferencias_inicio_idx').on(t.inicio)],
)

/**
 * Configurações alteradas pela tela, uma linha por assunto (`chave`). Hoje só
 * `leitura_ia`: a API, o modelo e a chave da leitura de comprovantes, com a
 * chave cifrada (config/cofre.ts).
 */
export const configuracoes = pgTable('configuracoes', {
  chave: text('chave').primaryKey(),
  valor: jsonb('valor').$type<Record<string, unknown>>().notNull(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoPor: integer('atualizado_por').references(() => usuarios.id),
})

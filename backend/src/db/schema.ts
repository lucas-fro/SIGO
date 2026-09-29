import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
// Só tipos: o drizzle-kit carrega este arquivo sozinho e não resolve importação de valor daqui.
import type { Papel } from '../contracts/auth.js'
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
  },
  (t) => [
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

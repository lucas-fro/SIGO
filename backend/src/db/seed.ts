import { count, eq } from 'drizzle-orm'
import { env } from '../config/env.js'
import { conectar } from './client.js'
import { categorias, empreendimentos, formasPagamento, setores } from './schema.js'

/*
  Listas iniciais. São um ponto de partida para o Marketing revisar, não a
  palavra final: dá para renomear, desativar e acrescentar na tela de cadastros.

  Cada lista só é preenchida quando está vazia. Assim o seed pode rodar a cada
  subida do container sem desfazer o que foi ajustado na tela — renomear
  "Cartão de crédito" não faz o item voltar no próximo deploy.
*/

const CATEGORIAS_MARKETING: Array<[nome: string, descricao: string]> = [
  [
    'Mídia digital',
    'Meta Ads, Google Ads, TikTok, portais imobiliários e outras plataformas on-line',
  ],
  ['Mídia off-line', 'Rádio, TV, outdoor, busdoor, jornal e revista'],
  ['Gráfica e impressos', 'Panfletos, folders, banners, placas e adesivos'],
  ['Stand de vendas', 'Montagem, manutenção, mobiliário, decoração e itens do plantão'],
  ['Eventos e ações', 'Eventos, ações de rua, feiras, coquetéis e patrocínios'],
  ['Brindes', 'Brindes e presentes para clientes e corretores'],
  ['Criação e produção', 'Agência, artes, fotos, vídeos, maquetes e tour virtual'],
  ['Ferramentas e assinaturas', 'Softwares, bancos de imagem e assinaturas'],
  ['Outros', 'O que não se encaixa nas demais. Se começar a repetir, vale criar uma categoria'],
]

const FORMAS_PAGAMENTO = [
  'Cartão de crédito',
  'Cartão pré-pago',
  'Boleto',
  'Pix',
  'Transferência bancária',
  'Dinheiro',
  'Reembolso a colaborador',
]

const { db, pool } = conectar(env.DATABASE_URL)

try {
  await db.transaction(async (tx) => {
    await tx.insert(setores).values({ nome: 'Marketing', slug: 'marketing' }).onConflictDoNothing()
    const [marketing] = await tx
      .select({ id: setores.id })
      .from(setores)
      .where(eq(setores.slug, 'marketing'))
    if (!marketing) throw new Error('setor Marketing não encontrado depois do insert')

    const [cat] = await tx
      .select({ total: count() })
      .from(categorias)
      .where(eq(categorias.setorId, marketing.id))
    if (!cat?.total) {
      await tx.insert(categorias).values(
        CATEGORIAS_MARKETING.map(([nome, descricao], i) => ({
          setorId: marketing.id,
          nome,
          descricao,
          ordem: i + 1,
        })),
      )
      console.log(`categorias do Marketing: ${CATEGORIAS_MARKETING.length} criadas`)
    }

    const [formas] = await tx.select({ total: count() }).from(formasPagamento)
    if (!formas?.total) {
      await tx
        .insert(formasPagamento)
        .values(FORMAS_PAGAMENTO.map((nome, i) => ({ nome, ordem: i + 1 })))
      console.log(`formas de pagamento: ${FORMAS_PAGAMENTO.length} criadas`)
    }

    const [emps] = await tx.select({ total: count() }).from(empreendimentos)
    if (!emps?.total) {
      await tx
        .insert(empreendimentos)
        .values({ nome: 'Institucional', institucional: true, ordem: 0 })
      console.log('empreendimento "Institucional" criado; os demais entram pela tela de cadastros')
    }
  })
  console.log('listas iniciais conferidas')
} finally {
  await pool.end()
}

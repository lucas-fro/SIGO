import { env } from '../config/env.js'
import { ROTULO_PAPEL } from '../contracts/auth.js'
import { conectar } from '../db/client.js'
import {
  definirAtivo,
  ehPapel,
  listarUsuarios,
  normalizarEmail,
  salvarUsuario,
  trocarSenha,
} from './usuarios.js'

/*
  Usuários pela linha de comando. A senha entra pela variável SENHA, nunca como
  argumento, para não ficar no histórico do shell.

  Em desenvolvimento:  npm run usuarios -- <comando>
  No container:        docker compose exec [-e SENHA=...] backend node dist/auth/cli.js <comando>
*/

const AJUDA = `
Comandos:
  seed-admin                       garante o administrador do .env (roda a cada subida do container)
  criar <email> --nome="Nome" [--papel=editor|leitor|admin] [--setores=marketing,obras]
                                   cria ou atualiza; SENHA é obrigatória para usuário novo
                                   e opcional para quem já existe (sem ela a senha fica como está)
  listar                           mostra todos os usuários
  senha <email>                    troca a senha (SENHA=...)
  ativar <email> | desativar <email>
`

function opcoes(args: string[]): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const arg of args) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (m) saida[m[1]!] = m[2]!
  }
  return saida
}

function senhaDoAmbiente(obrigatoria: boolean): string | undefined {
  const senha = process.env.SENHA
  if (!senha) {
    if (obrigatoria) throw new Error('informe a senha na variável SENHA')
    return undefined
  }
  if (senha.length < 6) throw new Error('a senha precisa ter pelo menos 6 caracteres')
  return senha
}

const [comando, ...resto] = process.argv.slice(2)
const alvo = resto.find((a) => !a.startsWith('--'))
const { db, pool } = conectar(env.DATABASE_URL)

try {
  switch (comando) {
    case 'seed-admin': {
      const { email, criado } = await salvarUsuario(db, {
        email: env.ADMIN_EMAIL,
        senha: env.ADMIN_PASSWORD,
        papel: 'admin',
        nome: env.ADMIN_NAME,
      })
      console.log(`admin ${criado ? 'criado' : 'confirmado'}: ${email}`)
      break
    }

    case 'criar': {
      if (!alvo) throw new Error('informe o e-mail')
      const op = opcoes(resto)
      const papel = op.papel ?? 'leitor'
      if (!ehPapel(papel)) throw new Error(`papel inválido: ${papel}`)
      if (!op.nome) throw new Error('informe --nome="Nome da pessoa"')
      const setores = op.setores
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (papel !== 'admin' && !setores?.length) {
        console.warn('aviso: sem --setores a pessoa entra mas não enxerga nenhum lançamento')
      }

      const existentes = await listarUsuarios(db)
      const jaExiste = existentes.some((u) => u.email === normalizarEmail(alvo))
      const { email, criado } = await salvarUsuario(db, {
        email: alvo,
        senha: senhaDoAmbiente(!jaExiste),
        papel,
        nome: op.nome,
        setores,
      })
      console.log(`${criado ? 'criado' : 'atualizado'}: ${email} (${ROTULO_PAPEL[papel]})`)
      break
    }

    case 'listar': {
      const usuarios = await listarUsuarios(db)
      console.table(
        usuarios.map((u) => ({
          email: u.email,
          nome: u.nome,
          papel: u.papel,
          setores: u.setores.join(', ') || (u.papel === 'admin' ? '(todos)' : '—'),
          ativo: u.ativo ? 'sim' : 'não',
          'último acesso': u.ultimoAcessoEm?.toLocaleString('pt-BR') ?? '—',
        })),
      )
      break
    }

    case 'senha': {
      if (!alvo) throw new Error('informe o e-mail')
      const ok = await trocarSenha(db, alvo, senhaDoAmbiente(true)!)
      console.log(ok ? `senha trocada: ${normalizarEmail(alvo)}` : 'usuário não encontrado')
      break
    }

    case 'ativar':
    case 'desativar': {
      if (!alvo) throw new Error('informe o e-mail')
      const ok = await definirAtivo(db, alvo, comando === 'ativar')
      console.log(
        ok
          ? `${comando === 'ativar' ? 'ativado' : 'desativado'}: ${normalizarEmail(alvo)}`
          : 'usuário não encontrado',
      )
      break
    }

    default:
      console.log(AJUDA)
      if (comando) process.exitCode = 1
  }
} catch (err) {
  console.error(`erro: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
} finally {
  await pool.end()
}

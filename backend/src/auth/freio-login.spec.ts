import {
  chaveDoIp,
  iniciarTentativa,
  tempoBloqueado,
  tentativaEncerrada,
  tentativaFalhou,
  zerarFreio,
  type Chave,
} from './freio-login.js'

beforeEach(() => zerarFreio())

/** O que o controller faz com um pedido: confere, ocupa lugar e, depois da senha, falha ou encerra. */
function tentar(chaves: Chave[], senhaCerta: boolean): 'bloqueado' | 'entrou' | 'recusado' {
  if (tempoBloqueado(...chaves) > 0) return 'bloqueado'
  iniciarTentativa(...chaves)
  if (senhaCerta) {
    tentativaEncerrada(...chaves)
    return 'entrou'
  }
  tentativaFalhou(...chaves)
  return 'recusado'
}

describe('freio de login', () => {
  it('rajada em paralelo contra uma conta: só 10 pedidos chegam a conferir a senha', () => {
    const chaves: Chave[] = ['ip:10.0.0.1', 'conta:alvo@smart.com']
    // Todos conferem e ocupam lugar antes de qualquer senha voltar.
    const conferidos = Array.from({ length: 200 }, () => {
      if (tempoBloqueado(...chaves) > 0) return false
      iniciarTentativa(...chaves)
      return true
    }).filter(Boolean).length
    expect(conferidos).toBe(10)
    for (let i = 0; i < conferidos; i++) tentativaFalhou(...chaves)
    expect(tempoBloqueado('conta:alvo@smart.com')).toBeGreaterThan(14 * 60_000)
  })

  it('rajada em paralelo contra muitas contas: o IP segura em 30', () => {
    const conferidos = Array.from({ length: 200 }, (_, i) => {
      const chaves: Chave[] = ['ip:10.0.0.9', `conta:pessoa${i}@smart.com`]
      if (tempoBloqueado(...chaves) > 0) return false
      iniciarTentativa(...chaves)
      return true
    }).filter(Boolean).length
    expect(conferidos).toBe(30)
  })

  it('a senha certa depois de 9 erros entra e não bloqueia; o próximo erro bloqueia a conta', () => {
    const chaves: Chave[] = ['ip:10.0.0.2', 'conta:maria@smart.com']
    for (let i = 0; i < 9; i++) expect(tentar(chaves, false)).toBe('recusado')
    expect(tentar(chaves, true)).toBe('entrou')
    expect(tempoBloqueado(...chaves)).toBe(0)
    // Acertar não zerou as falhas: o próximo erro é o 10º.
    expect(tentar(chaves, false)).toBe('recusado')
    expect(tentar(chaves, true)).toBe('bloqueado')
  })

  it('erros de várias pessoas do mesmo escritório não trancam o IP cedo', () => {
    // 3 erros de 8 pessoas diferentes (24 no total), saindo pelo mesmo IP público.
    for (let p = 0; p < 8; p++) {
      for (let i = 0; i < 3; i++) tentar(['ip:200.1.2.3', `conta:pessoa${p}@smart.com`], false)
    }
    expect(tentar(['ip:200.1.2.3', 'conta:outra@smart.com'], true)).toBe('entrou')
  })

  it('a conta tem limite próprio (trocar de IP não ajuda)', () => {
    const conta: Chave = 'conta:alguem@smart.com'
    for (let i = 0; i < 10; i++) tentar([`ip:10.0.1.${i}`, conta], false)
    expect(tentar(['ip:10.0.9.9', conta], true)).toBe('bloqueado')
  })

  it('IPv6 conta pela rede /64; IPv4 dentro de IPv6 vira IPv4', () => {
    expect(chaveDoIp('2804:14c:1a:2b:aaaa:bbbb:cccc:1')).toBe('2804:14c:1a:2b::/64')
    expect(chaveDoIp('2804:14c:1a:2b::99')).toBe('2804:14c:1a:2b::/64')
    expect(chaveDoIp('2804:14c::1')).toBe('2804:14c:0:0::/64')
    expect(chaveDoIp('::ffff:192.168.0.10')).toBe('192.168.0.10')
    expect(chaveDoIp('203.0.113.7')).toBe('203.0.113.7')
  })
})

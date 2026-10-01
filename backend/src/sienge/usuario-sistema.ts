/*
  Quem assina, no histórico do lançamento, o que a conferência com o Sienge
  faz sozinha. É um usuário de verdade na tabela (o histórico exige um),
  criado pelo seed desativado e com um hash de senha que nenhuma senha
  confere: não há como entrar com ele.
*/
export const EMAIL_USUARIO_SIENGE = 'sienge@sigo.interno'
export const NOME_USUARIO_SIENGE = 'Sienge (automático)'
/** Não é um hash válido do scrypt: a verificação de senha sempre recusa. */
export const SENHA_IMPOSSIVEL = '!'

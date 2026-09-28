import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

/*
  Os contratos (esquemas zod e tipos da API) moram no backend e são importados
  daqui como `#contracts`. É o mesmo arquivo que a API usa para validar: a regra
  do formulário e a da API não têm como divergir.
*/
const contratos = fileURLToPath(new URL('../backend/src/contracts', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-09-28',
  devtools: { enabled: false },

  // SPA: sistema interno atrás de login, com todo dado buscado no navegador.
  // Sem SSR não há hidratação para divergir, e a build vira arquivo estático
  // servido pelo Nginx — o mesmo desenho do Painel Sienge em produção.
  ssr: false,

  // 3040 para não disputar porta com o Painel Sienge (3000) na mesma máquina.
  devServer: { port: 3040 },

  // Inter servida pelo próprio app (sem depender do Google Fonts na rede interna).
  css: ['@fontsource-variable/inter', '~/assets/css/main.css'],

  alias: {
    '#contracts': `${contratos}/index.ts`,
  },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      // Os contratos importam `zod` de fora desta pasta; sem isto o Vite
      // procuraria em backend/node_modules e o bundle levaria duas cópias.
      dedupe: ['zod'],
    },
    server: {
      fs: { allow: [contratos] },
    },
  },

  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3340/api',
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      title: 'SIGO',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Sistema Integrado de Gestão Orçamentária' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      script: [
        {
          // Roda antes da primeira pintura: sem isso a tela clara aparece por
          // um quadro antes de o tema escuro ser aplicado.
          innerHTML: `(function(){try{var t=localStorage.getItem('sigo-theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}})()`,
          tagPosition: 'head',
        },
      ],
    },
  },
})

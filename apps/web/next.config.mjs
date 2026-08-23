// O endereço da API é gravado DENTRO do bundle no momento do build, porque
// NEXT_PUBLIC_* é substituído em tempo de compilação e não lido em execução.
//
// Isso cria a falha mais silenciosa que este deploy pode ter: build sem a
// variável definida gera um site que abre, carrega, parece perfeito — e tenta
// falar com localhost:4000 no navegador de quem acessou. Nada funciona, e nada
// no log diz o porquê.
//
// Então o build se recusa a acontecer sem ela. `next build` sempre roda com
// NODE_ENV=production, inclusive na máquina de quem desenvolve, então esta
// checagem vale para todo build — e é justamente isso que se quer: um build sem
// endereço de API não serve para lugar nenhum.
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;

if (!publicApiUrl) {
  throw new Error(
    'NEXT_PUBLIC_API_URL não está definida.\n' +
      'O endereço da API é gravado dentro do bundle na hora do build, então ' +
      'defini-la depois não adianta — o site já estaria apontando para o lugar errado.\n' +
      'Local: carregue o .env antes de buildar.\n' +
      'Heroku: heroku config:set NEXT_PUBLIC_API_URL=https://sua-api.herokuapp.com -a seu-app-web',
  );
}

// Apontar para localhost é o valor certo na máquina de quem desenvolve e o
// valor fatal num site publicado. Quem publica liga esta checagem uma vez, como
// Config Var, e nunca mais sobe um bundle apontando para a própria máquina.
if (
  process.env.DM_FLOW_REQUIRE_PUBLIC_API_URL === '1' &&
  /localhost|127\.0\.0\.1/.test(publicApiUrl)
) {
  throw new Error(
    `NEXT_PUBLIC_API_URL aponta para ${publicApiUrl}, que só existe na máquina de quem fez o build.\n` +
      'Um site publicado com este valor abre normalmente e não consegue falar com a API.',
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@dmflow/shared'],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

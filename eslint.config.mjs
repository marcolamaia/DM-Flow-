import js from '@eslint/js';
import globals from 'globals';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * A configuração que faltava.
 *
 * O script `pnpm lint` existia desde o primeiro dia e nunca rodou: sem
 * `eslint.config.*` o ESLint 9 aborta antes de olhar um arquivo sequer. Um
 * comando que sempre falha do mesmo jeito é indistinguível de um comando que
 * ninguém roda — e era exatamente esse o caso.
 *
 * As regras aqui são deliberadamente poucas. O TypeScript estrito já pega a
 * maior parte do que um linter pegaria, e o Prettier já decide formatação. O
 * que sobra para o ESLint é o que nenhum dos dois vê: `await` esquecido,
 * promessa solta, `any` entrando sem ninguém notar.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/coverage/**',
      'packages/db/generated/**',
      'packages/db/src/generated/**',
      '**/*.d.ts',
      'research/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Variável não usada é quase sempre resto de refatoração. O prefixo `_`
      // é a forma de dizer "sei que não uso, é a assinatura que exige".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // `any` não é proibido, mas não entra em silêncio: quem precisar dele
      // escreve o motivo num comentário de desativação.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // O site roda no navegador; os componentes de cliente veem `window`,
  // `document` e `localStorage` além do que o Node oferece.
  //
  // As regras de hooks e do Next entram aqui porque as duas falham de um jeito
  // que o TypeScript não vê: uma dependência esquecida num efeito não é erro de
  // tipo, é uma tela que para de atualizar sozinha.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      '@next/next': nextPlugin,
    },
    // Sem isto o plugin procura o app na raiz do monorepo e avisa, a cada
    // execução, que não achou — barulho que ensina a ignorar a saída do linter.
    settings: { next: { rootDir: 'apps/web' } },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      ...nextPlugin.configs.recommended.rules,

      // Estes dois vêm do React Compiler, e o React Compiler não está ligado
      // neste projeto.
      //
      // Eles não apontam erro: apontam padrões que são React correto mas que o
      // compilador não consegue otimizar. `setState` dentro de um efeito ao
      // montar — ler o relógio, ler o `localStorage`, reagir a uma prop que
      // mudou — funciona e está em dez telas já verificadas no navegador.
      // Ligá-los hoje significaria reescrever essas dez telas para agradar um
      // compilador que não roda aqui, e reescrita sem motivo é como se
      // introduz regressão em código que estava funcionando.
      //
      // Se um dia o React Compiler for ligado, estes voltam a ser erro e as
      // dez telas viram trabalho de verdade — não antes.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
    },
  },

  // Scripts e ferramentas: existem para falar com quem os roda.
  {
    files: [
      'scripts/**/*.{mjs,js,ts}',
      '**/scripts/**/*.{mjs,js,ts}',
      '**/prisma/**/*.ts',
      // Os seeds rodam na fase de release do deploy: o que eles escrevem no
      // console é o único relato de que gravaram o que deviam.
      '**/seed*.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  // Testes: `any` num mock não é dívida, é o mock.
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);

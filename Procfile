# Processos do app da API na Heroku.
#
# A DM FLOW sobe como DOIS apps na Heroku, não um: a API e o site são dois
# servidores HTTP, e cada app da Heroku expõe uma porta só. Este Procfile é o do
# app da API. O do site fica em apps/web/Procfile.
#
# release roda ANTES de qualquer dyno novo receber tráfego, e se falhar o deploy
# é cancelado — que é exatamente o que se quer de uma migration: subir código que
# espera uma coluna que não existe é pior do que não subir.
#
# São DUAS coisas, não uma: as migrations e os planos. Sem a linha do plano
# gratuito no banco, `/auth/register` não tem o que assinar e todo cadastro
# devolve 500 — numa instalação nova, o primeiro cliente bateria nisso. Ambas
# são idempotentes e rodam a cada deploy.
release: pnpm --filter @dmflow/db run release
web: node apps/api/dist/main.js
worker: node apps/api/dist/worker.js

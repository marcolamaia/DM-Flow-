# Processos do app da API na Heroku.
#
# A DM FLOW sobe como DOIS apps na Heroku, não um: a API e o site são dois
# servidores HTTP, e cada app da Heroku expõe uma porta só. Este Procfile é o do
# app da API. O do site fica em apps/web/Procfile.
#
# release roda ANTES de qualquer dyno novo receber tráfego, e se falhar o deploy
# é cancelado — que é exatamente o que se quer de uma migration: subir código que
# espera uma coluna que não existe é pior do que não subir.
release: pnpm --filter @dmflow/db exec prisma migrate deploy
web: node apps/api/dist/main.js
worker: node apps/api/dist/worker.js

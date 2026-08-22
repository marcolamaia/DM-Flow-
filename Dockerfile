# Uma imagem só, usada pelos três processos (api, worker, web) com comandos
# diferentes. É maior que três imagens otimizadas, e em troca há muito menos
# coisa que pode dar errado — o que importa mais para quem só quer testar.

FROM node:22-slim

# openssl é exigido pelo Prisma; o resto compila o argon2 quando não há prebuild
# pronto para a plataforma.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY . .

# Instalado numa única etapa em vez de copiar node_modules entre estágios: o pnpm
# usa symlinks para um store central, e copiá-los entre camadas quebra de formas
# difíceis de diagnosticar.
RUN pnpm install --frozen-lockfile

# O client do Prisma é gerado a partir do schema, então precisa vir antes dos
# builds que o importam.
RUN pnpm --filter @dmflow/db exec prisma generate \
 && pnpm --filter @dmflow/shared build \
 && pnpm --filter @dmflow/db build \
 && pnpm --filter @dmflow/api build

# O Next embute a URL da API no bundle em tempo de build. No navegador do usuário
# a API responde em localhost:4000, não no nome interno do serviço do compose.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @dmflow/web build

EXPOSE 3000 4000

FROM node:22-alpine AS build
WORKDIR /workspace
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm build

FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /workspace /app
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /workspace /app
CMD ["node", "apps/worker/dist/main.js"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80

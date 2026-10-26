FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS api-build
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci --no-audit --no-fund
COPY api/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=8080 TZ=Asia/Colombo
WORKDIR /app
COPY --from=api-build /app/api/package.json ./api/package.json
COPY --from=api-build /app/api/node_modules ./api/node_modules
COPY --from=api-build /app/api/dist ./api/dist
COPY --from=web-build /app/web/dist ./web/dist
WORKDIR /app/api
EXPOSE 8080
CMD ["node", "dist/main.js"]

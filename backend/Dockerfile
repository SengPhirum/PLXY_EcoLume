FROM node:24-alpine AS build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/tests ./tests
COPY backend/migrations ./migrations
COPY scripts /app/scripts
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist ./dist
COPY backend/src/views ./src/views
COPY backend/src/public ./src/public
COPY backend/migrations ./migrations
USER node
EXPOSE 8080
CMD ["node", "dist/backend/src/server.js"]

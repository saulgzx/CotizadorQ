# Servidor MCP remoto de CotizadorQ.
# Se usa npm install y no npm ci a proposito: este paquete no lleva
# package-lock.json versionado. Si mas adelante lo agregas, cambia a npm ci.
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Railway inyecta PORT; el server lo lee de process.env.PORT.
EXPOSE 8080

# No correr como root.
USER node

CMD ["node", "dist/index.js"]

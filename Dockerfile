FROM node:22-alpine AS base

WORKDIR /app

RUN apk add --no-cache tar zstd

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8787

CMD ["node", "dist/src/cli.js", "serve", "--port", "8787"]

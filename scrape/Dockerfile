FROM node:20-slim AS builder

RUN npm install -g pnpm
WORKDIR /app

# GO LIVE
COPY scrape/package.json scrape/pnpm-lock.yaml ./

# LOCAL
# COPY package.json pnpm-lock.yaml ./

RUN pnpm install

# GO LIVE
COPY scrape/src/ ./src/
COPY scrape/tsconfig.json .

# LOCAL
# COPY src/ ./src/
# COPY tsconfig.json .

RUN pnpm run build

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/

RUN mkdir -p data

CMD [ "node", "dist/main.js" ]
# syntax=docker/dockerfile:1
FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install

COPY . .

# By default, Bun does not load .env automatically in production. Use dotenv or pass envs.
# To use .env, you can add 'bun run start' or similar below, or override CMD as needed.
CMD ["bun", "run", "start"]

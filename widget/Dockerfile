# Образ сборки виджета: только сборка и проверки, рантайма у виджета нет —
# его файлы отдаёт статикой nginx.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

RUN chown -R node:node /app
USER node

CMD ["npm", "run", "build"]

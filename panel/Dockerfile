# Образ разработки: vite dev server с горячей перезагрузкой.
# Сборка статики для раздачи nginx — при подготовке к деплою (§15 docs/vision.md).
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

# Непривилегированный пользователь: образ node уже содержит пользователя node.
RUN chown -R node:node /app
USER node

EXPOSE 5173

CMD ["npm", "run", "dev"]

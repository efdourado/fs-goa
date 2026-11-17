FROM node:26.13.1-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --global npm@12.2.2 && npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0"]

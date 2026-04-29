FROM node:20-alpine
WORKDIR /app
COPY package.json .
COPY server-noticias.js .
COPY noticias.html .
COPY favicon.svg .
EXPOSE 4000
CMD ["node", "server-noticias.js"]

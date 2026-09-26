FROM node:22-alpine
WORKDIR /srv
COPY package.json ./
COPY server ./server
COPY app ./app
ENV PORT=8080 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
CMD ["node", "server/server.js"]

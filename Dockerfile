FROM node:22-alpine
RUN apk add --no-cache tzdata
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY app ./app
ENV PORT=8080 DATA_DIR=/data TZ=Asia/Tokyo
VOLUME /data
EXPOSE 8080
CMD ["node", "server/server.js"]

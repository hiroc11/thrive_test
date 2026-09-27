FROM node:22-slim
WORKDIR /app
COPY app ./app
COPY server ./server
ENV NODE_ENV=production PORT=8787 DB_FILE=/app/server/data/puku.db
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/server.js"]

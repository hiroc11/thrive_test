FROM node:22-slim
WORKDIR /app
COPY app ./app
COPY server ./server
ENV NODE_ENV=production PORT=8787 DB_FILE=/app/server/data/puku.db
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/server.js"]

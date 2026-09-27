FROM node:22-slim
WORKDIR /app
COPY app ./app
COPY server ./server
ENV NODE_ENV=production PORT=8787 DB_FILE=/app/server/data/puku.db
EXPOSE 8787
# root で起動し、entrypoint.sh の中で node ユーザーに切り替える（ボリュームの権限を直すため）
CMD ["sh", "/app/server/entrypoint.sh"]

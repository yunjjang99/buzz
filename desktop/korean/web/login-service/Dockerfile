FROM node:24-alpine
RUN mkdir -p /data && chown node:node /data
WORKDIR /app
COPY server.mjs /app/server.mjs
USER node
ENV BUZZ_LOGIN_DATA=/data
EXPOSE 3101
CMD ["node", "/app/server.mjs"]

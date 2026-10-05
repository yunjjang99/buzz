FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /data && chown node:node /data
COPY src ./src
USER node
ENV BUZZ_MAIL_DATA=/data BUZZ_MAIL_BIND=0.0.0.0
CMD ["node", "src/server.mjs"]

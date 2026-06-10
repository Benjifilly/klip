FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
EXPOSE 8787
USER node
CMD ["node", "src/index.js"]

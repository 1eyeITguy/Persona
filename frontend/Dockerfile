FROM node:20-alpine

WORKDIR /app

# Install deps before copying all source (layer caching)
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]

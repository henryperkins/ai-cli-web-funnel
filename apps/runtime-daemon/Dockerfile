FROM node:20-alpine

WORKDIR /app

COPY . .

RUN npm ci
RUN npm run build

EXPOSE 4100

CMD ["npm", "run", "start", "--workspace", "@forge/runtime-daemon"]

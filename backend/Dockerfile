FROM node:22-alpine AS builder

WORKDIR /app

# Install native dependencies needed for Sharp, 7zip, and building packages
RUN apk add --no-cache python3 make g++ p7zip ffmpeg

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY tsconfig.json ./
COPY src ./src

# Generate Prisma client and build typescript
RUN npx prisma generate
RUN npm run build

# Production image
FROM node:22-alpine AS runner

WORKDIR /app

# Install runtime utilities: 7zip and ffmpeg for media conversion & high compression
RUN apk add --no-cache p7zip ffmpeg

COPY package*.json ./
COPY prisma ./prisma/

# Install only production dependencies
RUN npm install --omit=dev
RUN npx prisma generate

# Copy built code from builder
COPY --from=builder /app/dist ./dist

# Create storage directory for uploaded & processed files
RUN mkdir -p /app/storage/uploads /app/storage/outputs && chmod -R 777 /app/storage

EXPOSE 3000

CMD ["node", "dist/index.js"]

FROM node:alpine AS frontend-builder
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ .
RUN npm run build

FROM golang:alpine AS builder

WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/server

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy the pre-built binary file from the previous stage
COPY --from=builder /app/server .
COPY --from=builder /app/config.yaml .
COPY --from=frontend-builder /web/dist ./web/dist

# Expose DNS port and API port
EXPOSE 53/udp
EXPOSE 8080/tcp

# Force Go garbage collector to aggressively return memory to OS
ENV GOMEMLIMIT=100MiB

CMD ["./server", "config.yaml"]

# Deploy on Pella → Express JS

## Upload
Upload the CONTENTS of this zip (package.json must be at project root, not inside a subfolder).

## Start command (quan trọng)
Trong Pella set:
  npm start
hoặc:
  node server.js

KHÔNG dùng: node /app   ← sẽ lỗi Cannot find module '/app'

## Build / Install
  npm install

## Sau khi chạy
Mở URL site → Obfuscate gọi POST /api/obfuscate
Health: GET /api/health

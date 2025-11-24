# ==========================================
# Dockerfile cho MidgenAI Bun Proxy
# Runtime: Bun v1.x
# ==========================================

# 1. Sử dụng image Bun chính thức (phiên bản ổn định)
FROM oven/bun:1 as base

# 2. Thiết lập thư mục làm việc
WORKDIR /app

# 4. Cài đặt dependencies (Production only)
# Nếu project chưa có deps nào ngoài Bun, lệnh này vẫn chạy an toàn
RUN bun install --production

# 5. Copy toàn bộ source code còn lại
COPY index.ts .

# 6. Thiết lập biến môi trường mặc định
ENV PORT=3000
ENV NODE_ENV=production

# 7. Mở port
EXPOSE 3000

# 8. Lệnh khởi chạy server
CMD ["bun", "run", "index.ts"]

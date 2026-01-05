docker run -it --rm \
  --ulimit core=0 \
  -w /app \
  -v .:/app \
  -p 5173:5173 \
  oven/bun dev -- --host
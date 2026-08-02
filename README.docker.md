# Docker usage

## Run locally

```bash
docker compose up --build
```

Then open:

```bash
curl http://localhost:8080/health
```

## Stop

```bash
docker compose down
```

## Environment

Copy .env.example to .env if you want to override defaults.

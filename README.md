# Let's Meet

Terminbuchung von That's it. Marketing. Buchungsseiten, einbettbares Widget und Backoffice im Stil von Calendly, im eigenen Branding, auf Cloudflare Workers mit D1.

```bash
pnpm install
cp .env.example .dev.vars   # Werte eintragen
pnpm db:migrate:local
pnpm dev
```

Danach `http://localhost:4321/app/setup` öffnen und das erste Admin Konto anlegen.

Alles Weitere, inklusive Deployment, Google Kalender und Resend, steht in der [CLAUDE.md](./CLAUDE.md).

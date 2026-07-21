# Mochi Manners

A simple landing page for Mochi Manners — dog training and home visits in Durham, NC.

Built with [Vite](https://vite.dev), React 19, and TypeScript.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Vercel auto-detects Vite — no extra configuration needed.
4. Deploy.

Alternatively, install the [Vercel CLI](https://vercel.com/docs/cli) and run:

```bash
npx vercel
```

## Gallery (Vercel Blob)

Photos and videos for `/gallery` are hosted on [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) — a good fit since you're already deploying on Vercel.

### One-time setup

1. In the Vercel dashboard, open your project → **Storage** → **Create Database/Store** → **Blob**.
2. Connect the Blob store to this project.
3. Copy the `BLOB_READ_WRITE_TOKEN` into a local `.env` file (see `.env.example`).

### Upload workflow

1. Drop photos (`.jpg`, `.png`, `.webp`, etc.) and videos (`.mp4`, `.webm`, `.mov`) into `gallery-upload/`.
2. Run:

```bash
npm run gallery:upload
```

This uploads everything to Blob and regenerates `src/data/gallery.ts` with the public URLs. Commit the updated manifest, then deploy — the site loads media directly from Blob.

Uploaded files in `gallery-upload/` are gitignored; only the manifest in `src/data/gallery.ts` is tracked.

### Before going live

- Confirm `info@mochimanners.com` is set up and receiving mail.
- Test social link previews (iMessage, Slack, etc.) after deploy — OG tags point to `https://www.mochimanners.com/og-image.png`.
- Visit `/gallery` after upload to confirm images and videos load correctly.

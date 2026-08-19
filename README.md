# Mochi Manners

A simple landing page for Mochi Manners — dog training and drop-in visits in Durham, NC.

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

## Gallery media

Photos for `/gallery` are optimized locally and hosted on [Vercel Blob](https://vercel.com/docs/storage/vercel-blob). Videos are embedded from YouTube so the site does not need to store, transcode, or deliver large video files.

### One-time setup

1. In the Vercel dashboard, open your project → **Storage** → **Create Database/Store** → **Blob**.
2. Connect the Blob store to this project.
3. Copy the `BLOB_READ_WRITE_TOKEN` into a local `.env` file (see `.env.example`).

### Upload workflow

1. Drop source photos (`.jpg`, `.jpeg`, `.png`, `.webp`, or `.avif`) into `gallery-upload/`.
2. Add descriptive alt text and captions for their filename-based IDs in `src/data/gallery-image-copy.json`.
3. Run:

```bash
npm run gallery:upload
```

This strips embedded metadata, creates responsive WebP variants, uploads them to Blob, and merges their public URLs into `src/data/gallery-images.generated.json`. Existing entries are preserved even when their original files are not on the current computer. Commit the generated manifest, then deploy.

Source files in `gallery-upload/` are gitignored. YouTube videos are stored as lightweight IDs and display text in the gallery content data; the photo upload command will not overwrite them.

### Manage the gallery locally

While the local development site is running, open
[`http://localhost:5173/gallery/organize`](http://localhost:5173/gallery/organize) or use the
**Organize gallery** link shown on the local gallery page. From there you can add JPG, PNG, WebP,
AVIF, HEIC, or HEIF photos; add YouTube videos by pasting their links; arrange photos and videos in
one shared order; edit captions, titles, and screen-reader descriptions; or remove gallery items.
New photos are optimized and sent to Vercel Blob;
a rebuild-ready source copy stays local in `gallery-upload/`. HEIC/HEIF uploads use the locally
installed `ffmpeg` and retain a normalized PNG source; if it is unavailable, export those photos as
JPEG or PNG first.

Removing a photo and saving moves its local source into the gitignored `gallery-removed/` archive,
so a later bulk upload cannot accidentally add it back. It does not immediately erase its optimized
Vercel files. After the updated gallery has been deployed, use the organizer's **Vercel storage
cleanup** section to check for and permanently delete unused variants. The deployment confirmation
is intentional: the currently live site may still reference a newly removed file until deployment
finishes.

The organizer writes directly to the gallery JSON files in this project. It has no database and
is available only from a loopback address while Vite's local development server is running. The
route and its write endpoint do not exist in the deployed Vercel site. Commit the changed gallery
JSON files and deploy when the new order and copy are ready to publish.

### Before going live

- Confirm `info@mochimanners.com` is set up and receiving mail.
- Test social link previews (iMessage, Slack, etc.) after deploy — OG tags point to `https://www.mochimanners.com/og-image.png`.
- Visit `/gallery` after upload to confirm images and videos load correctly.

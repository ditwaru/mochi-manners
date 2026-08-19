#!/usr/bin/env node
/**
 * Optimize photos from gallery-upload/, upload responsive WebP variants to
 * Vercel Blob, and update src/data/gallery-images.generated.json.
 *
 * Videos live in the gallery content data as YouTube IDs and are never
 * uploaded to Blob. Source photos remain local and are ignored by Git.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { list, put } from "@vercel/blob";
import sharp from "sharp";

const UPLOAD_DIR = "gallery-upload";
const OUTPUT_FILE = "src/data/gallery-images.generated.json";
const COPY_FILE = "src/data/gallery-image-copy.json";
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const TARGET_WIDTHS = [480, 960, 1600];
const CACHE_SECONDS = 31_536_000;

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("Missing BLOB_READ_WRITE_TOKEN. Add it to .env before uploading.");
  process.exit(1);
}

function slugFromFilename(filename) {
  return basename(filename, extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function listGalleryBlobs() {
  const blobsByPathname = new Map();
  let cursor;

  do {
    const result = await list({
      prefix: "gallery/",
      limit: 1_000,
      cursor,
      token,
    });

    for (const blob of result.blobs) {
      blobsByPathname.set(blob.pathname, blob);
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  return blobsByPathname;
}

async function readJsonFile(pathname, fallback) {
  try {
    return JSON.parse(await readFile(pathname, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function validateImageCopy(ids, imageCopy) {
  for (const id of ids) {
    const copy = imageCopy[id];
    if (
      !copy ||
      typeof copy.alt !== "string" ||
      copy.alt.trim().length < 10 ||
      typeof copy.caption !== "string" ||
      copy.caption.trim().length < 3
    ) {
      throw new Error(`Add descriptive alt text and a caption for "${id}" in ${COPY_FILE}.`);
    }
  }
}

const entries = (await readdir(UPLOAD_DIR)).filter((filename) => !filename.startsWith("."));
const files = entries
  .filter((filename) => IMAGE_EXTENSIONS.has(extname(filename).toLowerCase()))
  .sort();
const unsupportedFiles = entries.filter(
  (filename) => !IMAGE_EXTENSIONS.has(extname(filename).toLowerCase()),
);

if (unsupportedFiles.length > 0) {
  console.warn(
    `Skipped unsupported files (use YouTube for video): ${unsupportedFiles.join(", ")}`,
  );
}

if (files.length === 0) {
  console.error(`No supported photos found in ${UPLOAD_DIR}/`);
  process.exit(1);
}

const duplicateSlugs = files
  .map(slugFromFilename)
  .filter((slug, index, slugs) => slugs.indexOf(slug) !== index);

if (duplicateSlugs.length > 0) {
  throw new Error(`Photo filenames must have unique names: ${[...new Set(duplicateSlugs)].join(", ")}`);
}

const existingImages = await readJsonFile(OUTPUT_FILE, []);
const imageCopy = await readJsonFile(COPY_FILE, {});

if (!Array.isArray(existingImages)) {
  throw new Error(`${OUTPUT_FILE} must contain a JSON array.`);
}

validateImageCopy(
  [...existingImages.map((image) => image.id), ...files.map(slugFromFilename)],
  imageCopy,
);

const sources = await Promise.all(
  files.map(async (filename) => {
    const source = await readFile(join(UPLOAD_DIR, filename));
    const slug = slugFromFilename(filename);
    const metadata = await sharp(source).metadata();
    const sourceWidth = metadata.autoOrient?.width ?? metadata.width;

    if (!slug || !sourceWidth) {
      throw new Error(`Could not read image dimensions for ${filename}`);
    }

    return { filename, source, slug, sourceWidth };
  }),
);

const existingBlobs = await listGalleryBlobs();
const uploadedImages = [];

for (const { filename, source, slug, sourceWidth } of sources) {
  const widths = [...new Set(TARGET_WIDTHS.map((width) => Math.min(width, sourceWidth)))].sort(
    (left, right) => left - right,
  );
  const variants = [];

  for (const width of widths) {
    const { data, info } = await sharp(source)
      .autoOrient()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 5, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    const digest = createHash("sha256").update(data).digest("hex").slice(0, 24);
    const pathname = `gallery/${slug}/${info.width}-${digest}.webp`;
    const existingBlob = existingBlobs.get(pathname);
    let blob;

    if (existingBlob) {
      if (existingBlob.size !== data.byteLength) {
        throw new Error(`Existing Blob has an unexpected size: ${pathname}`);
      }
      blob = existingBlob;
      console.log(`Reused ${filename} at ${info.width}px -> ${blob.url}`);
    } else {
      blob = await put(pathname, data, {
        access: "public",
        token,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: CACHE_SECONDS,
        contentType: "image/webp",
      });
      existingBlobs.set(pathname, { ...blob, pathname, size: data.byteLength });
      console.log(`Uploaded ${filename} at ${info.width}px -> ${blob.url}`);
    }

    variants.push({ src: blob.url, width: info.width, height: info.height });
  }

  const largest = variants.at(-1);
  if (!largest) throw new Error(`No responsive variants were created for ${filename}`);

  uploadedImages.push({
    id: slug,
    type: "image",
    src: largest.src,
    variants: variants.map(({ src, width }) => ({ src, width })),
    width: largest.width,
    height: largest.height,
  });
}

const uploadsById = new Map(uploadedImages.map((image) => [image.id, image]));
const mergedImages = existingImages.map((image) => uploadsById.get(image.id) ?? image);
const existingIds = new Set(existingImages.map((image) => image.id));

for (const image of uploadedImages) {
  if (!existingIds.has(image.id)) mergedImages.push(image);
}

validateImageCopy(mergedImages.map((image) => image.id), imageCopy);

const output = `${JSON.stringify(mergedImages, null, 2)}\n`;

const temporaryOutputFile = `${OUTPUT_FILE}.tmp`;
await writeFile(temporaryOutputFile, output);
await rename(temporaryOutputFile, OUTPUT_FILE);
console.log(`\nWrote ${mergedImages.length} optimized photos to ${OUTPUT_FILE}`);

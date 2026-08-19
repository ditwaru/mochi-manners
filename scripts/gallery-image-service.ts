import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import {
  del,
  list,
  put,
  type ListBlobResultBlob,
} from "@vercel/blob";
import sharp from "sharp";

const TARGET_WIDTHS = [480, 960, 1600];
const CACHE_SECONDS = 31_536_000;
const MAX_INPUT_PIXELS = 100_000_000;
const MAX_DECODED_IMAGE_BYTES = 160 * 1024 * 1024;
const HEIC_EXTENSIONS = new Set([".heic", ".heif"]);
export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ...HEIC_EXTENSIONS,
]);

export type GalleryManifestImage = {
  id: string;
  type: "image";
  src: string;
  variants: Array<{ src: string; width: number }>;
  width: number;
  height: number;
};

export type OrphanBlobAudit = {
  count: number;
  totalBytes: number;
  pathnames: string[];
};

export class GalleryImageInputError extends Error {}

export function slugFromFilename(filename: string) {
  return basename(filename, extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function uniqueImageId(filename: string, occupiedIds: Set<string>) {
  const baseId = slugFromFilename(filename) || "gallery-photo";
  if (!occupiedIds.has(baseId)) return baseId;

  let suffix = 2;
  while (occupiedIds.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

async function runFfmpeg(inputPath: string, outputPath: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-fs",
        String(MAX_DECODED_IMAGE_BYTES),
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let errorOutput = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 30_000);

    child.stderr.on("data", (chunk: Buffer) => {
      if (errorOutput.length < 2_000) errorOutput += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new GalleryImageInputError(
              "HEIC uploads need ffmpeg installed on this computer. Export this photo as JPEG or PNG and try again.",
            )
          : error,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          timedOut ? "HEIC conversion timed out." : errorOutput || "HEIC conversion failed.",
        ),
      );
    });
  });
}

async function probeHeicDimensions(inputPath: string) {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_stream_groups",
        "-show_streams",
        inputPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let standardOutput = "";
    let errorOutput = "";
    let exceededLimit = false;
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);

    child.stdout.on("data", (chunk: Buffer) => {
      standardOutput += chunk.toString("utf8");
      if (standardOutput.length > 2_000_000) {
        exceededLimit = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorOutput.length < 2_000) errorOutput += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new GalleryImageInputError(
              "HEIC uploads need ffmpeg installed on this computer. Export this photo as JPEG or PNG and try again.",
            )
          : error,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0 && !exceededLimit) {
        resolve(standardOutput);
        return;
      }
      reject(new Error(errorOutput || "HEIC metadata could not be read."));
    });
  });

  const parsed = JSON.parse(output) as {
    stream_groups?: Array<{ components?: Array<{ width?: number; height?: number }> }>;
    streams?: Array<{ width?: number; height?: number }>;
  };
  const dimensions = [
    ...(parsed.stream_groups ?? []).flatMap(({ components }) => components ?? []),
    ...(parsed.streams ?? []),
  ].filter(
    (item): item is { width: number; height: number } =>
      Number.isInteger(item.width) &&
      Number.isInteger(item.height) &&
      (item.width ?? 0) > 0 &&
      (item.height ?? 0) > 0,
  );
  const largest = dimensions.sort(
    (left, right) => right.width * right.height - left.width * left.height,
  )[0];
  if (!largest) throw new Error("HEIC dimensions could not be read.");
  return largest;
}

async function decodeHeic(source: Buffer, extension: string) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "mochi-gallery-"));
  const inputPath = join(temporaryDirectory, `source${extension}`);
  const outputPath = join(temporaryDirectory, "decoded.png");

  try {
    await writeFile(inputPath, source);
    const dimensions = await probeHeicDimensions(inputPath);
    if (dimensions.width * dimensions.height > MAX_INPUT_PIXELS) {
      throw new GalleryImageInputError(
        "That HEIC photo is too large to process safely. Export a smaller JPEG or PNG and try again.",
      );
    }
    await runFfmpeg(inputPath, outputPath);
    if ((await stat(outputPath)).size >= MAX_DECODED_IMAGE_BYTES) {
      throw new GalleryImageInputError(
        "That HEIC photo is too large to process safely. Export a smaller JPEG or PNG and try again.",
      );
    }
    return await readFile(outputPath);
  } catch (error) {
    if (error instanceof GalleryImageInputError) throw error;
    throw new GalleryImageInputError(
      "That HEIC photo could not be read. Convert it to JPEG or PNG and try again.",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function prepareImageSource(source: Buffer, filename: string) {
  const extension = extname(filename).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new GalleryImageInputError(
      "Choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF photo.",
    );
  }

  if (HEIC_EXTENSIONS.has(extension)) {
    return {
      data: await decodeHeic(source, extension),
      retainedExtension: ".png",
    };
  }

  return { data: source, retainedExtension: extension };
}

function blobPathnameFromUrl(value: string) {
  return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
}

function activeImagePathnames(images: GalleryManifestImage[]) {
  const pathnames = new Set<string>();

  for (const image of images) {
    pathnames.add(blobPathnameFromUrl(image.src));
    for (const variant of image.variants) {
      pathnames.add(blobPathnameFromUrl(variant.src));
    }
  }

  return pathnames;
}

function assertBlobStoreMatches(
  activeImages: GalleryManifestImage[],
  blobs: Map<string, ListBlobResultBlob>,
) {
  const activeOrigins = new Set(
    activeImages.flatMap((image) => [
      new URL(image.src).origin,
      ...image.variants.map(({ src }) => new URL(src).origin),
    ]),
  );
  const listedOrigins = new Set(
    [...blobs.values()].map(({ url }) => new URL(url).origin),
  );

  if (activeOrigins.size > 1 || listedOrigins.size > 1) {
    throw new GalleryImageInputError(
      "Gallery storage points to more than one Vercel Blob store. Check the local token before cleaning up files.",
    );
  }

  const activeOrigin = activeOrigins.values().next().value as string | undefined;
  const listedOrigin = listedOrigins.values().next().value as string | undefined;
  if (activeOrigin && listedOrigin && activeOrigin !== listedOrigin) {
    throw new GalleryImageInputError(
      "This local Blob token belongs to a different store than the gallery. Update BLOB_READ_WRITE_TOKEN and restart before cleaning up files.",
    );
  }
}

export class GalleryBlobService {
  private blobsByPathname: Map<string, ListBlobResultBlob> | null = null;
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async listGalleryBlobs(refresh = false) {
    if (this.blobsByPathname && !refresh) return this.blobsByPathname;

    const blobsByPathname = new Map<string, ListBlobResultBlob>();
    let cursor: string | undefined;

    do {
      const result = await list({
        prefix: "gallery/",
        limit: 1_000,
        cursor,
        token: this.token,
      });

      for (const blob of result.blobs) blobsByPathname.set(blob.pathname, blob);
      if (result.hasMore && !result.cursor) {
        throw new Error("Vercel Blob did not return a pagination cursor.");
      }
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    this.blobsByPathname = blobsByPathname;
    return blobsByPathname;
  }

  async uploadImage(source: Buffer, filename: string, id: string) {
    const preparedSource = await prepareImageSource(source, filename);
    const decodedSource = preparedSource.data;
    let metadata;

    try {
      metadata = await sharp(decodedSource, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
      throw new GalleryImageInputError("That file does not appear to be a readable photo.");
    }

    const sourceWidth = metadata.autoOrient?.width ?? metadata.width;
    if (!sourceWidth) {
      throw new GalleryImageInputError("The photo dimensions could not be read.");
    }

    const widths = [...new Set(TARGET_WIDTHS.map((width) => Math.min(width, sourceWidth)))].sort(
      (left, right) => left - right,
    );
    const existingBlobs = await this.listGalleryBlobs();
    const variants: Array<{ src: string; width: number; height: number }> = [];

    for (const width of widths) {
      const { data, info } = await sharp(decodedSource, {
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .autoOrient()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82, effort: 5, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
      const digest = createHash("sha256").update(data).digest("hex").slice(0, 24);
      const pathname = `gallery/${id}/${info.width}-${digest}.webp`;
      const existingBlob = existingBlobs.get(pathname);
      let url: string;

      if (existingBlob) {
        if (existingBlob.size !== data.byteLength) {
          throw new Error(`Existing Blob has an unexpected size: ${pathname}`);
        }
        url = existingBlob.url;
      } else {
        const blob = await put(pathname, data, {
          access: "public",
          token: this.token,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: CACHE_SECONDS,
          contentType: "image/webp",
        });
        url = blob.url;
        existingBlobs.set(pathname, {
          ...blob,
          pathname,
          size: data.byteLength,
          uploadedAt: new Date(),
        });
      }

      variants.push({ src: url, width: info.width, height: info.height });
    }

    const largest = variants.at(-1);
    if (!largest) throw new Error("No responsive photo variants were created.");

    return {
      image: {
        id,
        type: "image" as const,
        src: largest.src,
        variants: variants.map(({ src, width }) => ({ src, width })),
        width: largest.width,
        height: largest.height,
      } satisfies GalleryManifestImage,
      retainedSource: decodedSource,
      retainedExtension: preparedSource.retainedExtension,
    };
  }

  async findOrphans(activeImages: GalleryManifestImage[], refresh = true) {
    const blobs = await this.listGalleryBlobs(refresh);
    assertBlobStoreMatches(activeImages, blobs);
    const activePathnames = activeImagePathnames(activeImages);
    const orphanBlobs = [...blobs.values()].filter(
      (blob) => !activePathnames.has(blob.pathname),
    );

    return {
      count: orphanBlobs.length,
      totalBytes: orphanBlobs.reduce((total, blob) => total + blob.size, 0),
      pathnames: orphanBlobs.map((blob) => blob.pathname).sort(),
    } satisfies OrphanBlobAudit;
  }

  async deleteOrphans(pathnames: string[], activeImages: GalleryManifestImage[]) {
    const blobs = await this.listGalleryBlobs(true);
    const audit = await this.findOrphans(activeImages, false);
    const orphanPathnames = new Set(audit.pathnames);

    if (pathnames.some((pathname) => !orphanPathnames.has(pathname))) {
      throw new GalleryImageInputError(
        "The unused-file list changed. Check storage again before deleting.",
      );
    }

    const totalBytes = pathnames.reduce(
      (total, pathname) => total + (blobs.get(pathname)?.size ?? 0),
      0,
    );

    const urls = pathnames.map((pathname) => blobs.get(pathname)!.url);
    if (urls.length > 0) await del(urls, { token: this.token });
    for (const pathname of pathnames) blobs.delete(pathname);

    return { count: pathnames.length, totalBytes, pathnames } satisfies OrphanBlobAudit;
  }
}

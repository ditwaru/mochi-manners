import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import {
  GalleryBlobService,
  GalleryImageInputError,
  SUPPORTED_IMAGE_EXTENSIONS,
  slugFromFilename,
  uniqueImageId,
  type GalleryManifestImage,
} from "./gallery-image-service.ts";

const ORGANIZER_PATH = "/__gallery-organizer";
const IMAGE_UPLOAD_PATH = `${ORGANIZER_PATH}/images`;
const PENDING_IMAGES_PATH = `${ORGANIZER_PATH}/pending`;
const ORPHANS_PATH = `${ORGANIZER_PATH}/orphans`;
const MANIFEST_FILE = "src/data/gallery-images.generated.json";
const COPY_FILE = "src/data/gallery-image-copy.json";
const CONTENT_FILE = "src/data/gallery-content.json";
const UPLOAD_DIRECTORY = "gallery-upload";
const REMOVED_DIRECTORY = "gallery-removed";
const STAGING_DIRECTORY = ".gallery-staging";
const TRANSACTION_FILE = ".gallery-organizer-transaction.json";
const MAX_JSON_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const GALLERY_ITEM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

type GalleryCopy = Record<string, { alt: string; caption: string }>;

type GalleryVideo = {
  id: string;
  type: "youtube";
  videoId: string;
  title: string;
  caption: string;
  orientation: "landscape" | "portrait";
};

type GalleryContent = {
  version: 1;
  order: string[];
  videos: GalleryVideo[];
};

type OrganizerImage = GalleryManifestImage & {
  alt: string;
  caption: string;
  pending: boolean;
};

type OrganizerItem = OrganizerImage | GalleryVideo;

type PendingImage = {
  image: GalleryManifestImage;
  sourcePath: string;
  sourceExtension: string;
};

type FileMove = {
  from: string;
  to: string;
};

type SaveTransaction = {
  phase: "prepared" | "moved" | "committed";
  oldManifest: GalleryManifestImage[];
  oldCopy: GalleryCopy;
  oldContent: GalleryContent;
  moves: FileMove[];
};

type GalleryOrganizerPluginOptions = {
  blobToken?: string;
};

class OrganizerHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1"
  );
}

function isLoopbackAddress(address: string | undefined) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function requestHostname(request: IncomingMessage) {
  const host = request.headers.host;
  if (!host) return null;

  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

function isLocalRequest(request: IncomingMessage) {
  const hostname = requestHostname(request);
  return (
    hostname !== null &&
    isLoopbackHostname(hostname) &&
    isLoopbackAddress(request.socket.remoteAddress)
  );
}

function isSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host && isLoopbackHostname(originUrl.hostname);
  } catch {
    return false;
  }
}

function contentType(request: IncomingMessage) {
  return request.headers["content-type"]?.split(";", 1)[0]?.toLowerCase();
}

function requireLocalMutation(request: IncomingMessage, expectedContentType?: string) {
  if (
    !isSameOrigin(request) ||
    request.headers["x-gallery-organizer"] !== "local" ||
    (expectedContentType && contentType(request) !== expectedContentType)
  ) {
    throw new OrganizerHttpError(
      403,
      "This update is only allowed from the local gallery organizer.",
    );
  }
}

function requireLocalStorageRead(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (
    request.headers["x-gallery-organizer"] !== "local" ||
    (origin !== undefined && !isSameOrigin(request))
  ) {
    throw new OrganizerHttpError(
      403,
      "This storage check is only allowed from the local gallery organizer.",
    );
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJson(pathname: string): Promise<unknown> {
  return JSON.parse(await readFile(pathname, "utf8"));
}

async function readRequestBuffer(request: IncomingMessage, maximumBytes: number) {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > maximumBytes) {
      throw new OrganizerHttpError(413, "That upload is too large. Choose a photo under 40 MB.");
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function readRequestJson(request: IncomingMessage) {
  const body = await readRequestBuffer(request, MAX_JSON_BYTES);

  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new OrganizerHttpError(400, "The organizer update must be valid JSON.");
  }
}

function validateManifest(value: unknown): GalleryManifestImage[] {
  if (!Array.isArray(value)) {
    throw new Error(`${MANIFEST_FILE} must contain an array.`);
  }

  const seenIds = new Set<string>();
  let blobOrigin: string | null = null;
  for (const image of value) {
    if (
      !isRecord(image) ||
      typeof image.id !== "string" ||
      !GALLERY_ITEM_ID_PATTERN.test(image.id) ||
      seenIds.has(image.id) ||
      image.type !== "image" ||
      typeof image.src !== "string" ||
      !Array.isArray(image.variants) ||
      image.variants.length === 0 ||
      !image.variants.every(
        (variant) =>
          isRecord(variant) &&
          typeof variant.src === "string" &&
          typeof variant.width === "number" &&
          Number.isInteger(variant.width) &&
          variant.width > 0,
      ) ||
      typeof image.width !== "number" ||
      !Number.isInteger(image.width) ||
      image.width <= 0 ||
      typeof image.height !== "number" ||
      !Number.isInteger(image.height) ||
      image.height <= 0
    ) {
      throw new Error(`Invalid or duplicate image entry in ${MANIFEST_FILE}.`);
    }

    const typedImage = image as GalleryManifestImage;
    const variantUrls = new Set(typedImage.variants.map(({ src }) => src));
    if (!variantUrls.has(typedImage.src)) {
      throw new Error(`The primary source for ${typedImage.id} is not one of its variants.`);
    }

    for (const source of variantUrls) {
      let url: URL;
      try {
        url = new URL(source);
      } catch {
        throw new Error(`Invalid Blob URL for ${typedImage.id}.`);
      }

      const expectedPrefix = `/gallery/${typedImage.id}/`;
      if (
        url.protocol !== "https:" ||
        !url.hostname.endsWith(".public.blob.vercel-storage.com") ||
        !url.pathname.startsWith(expectedPrefix) ||
        url.search !== "" ||
        url.hash !== ""
      ) {
        throw new Error(`Unexpected Blob URL for ${typedImage.id}.`);
      }
      if (blobOrigin && url.origin !== blobOrigin) {
        throw new Error("Gallery images must all use the same Vercel Blob store.");
      }
      blobOrigin ??= url.origin;
    }

    seenIds.add(image.id);
  }

  return value as GalleryManifestImage[];
}

function validateCopy(value: unknown): GalleryCopy {
  if (!isRecord(value)) {
    throw new Error(`${COPY_FILE} must contain an object.`);
  }

  return value as GalleryCopy;
}

function validateVideo(value: unknown): GalleryVideo {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "type",
      "videoId",
      "title",
      "caption",
      "orientation",
    ]) ||
    typeof value.id !== "string" ||
    !GALLERY_ITEM_ID_PATTERN.test(value.id) ||
    value.type !== "youtube" ||
    typeof value.videoId !== "string" ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(value.videoId) ||
    typeof value.title !== "string" ||
    value.title.trim().length < 3 ||
    value.title.trim().length > 120 ||
    typeof value.caption !== "string" ||
    value.caption.trim().length < 3 ||
    value.caption.trim().length > 500 ||
    (value.orientation !== "landscape" && value.orientation !== "portrait")
  ) {
    throw new Error("Invalid YouTube video in the gallery content.");
  }

  return {
    id: value.id,
    type: "youtube",
    videoId: value.videoId,
    title: value.title,
    caption: value.caption,
    orientation: value.orientation,
  };
}

function validateContent(
  value: unknown,
  manifest: GalleryManifestImage[],
): GalleryContent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["version", "order", "videos"]) ||
    value.version !== 1 ||
    !Array.isArray(value.order) ||
    !Array.isArray(value.videos)
  ) {
    throw new Error(`${CONTENT_FILE} must contain version 1 gallery content.`);
  }

  const imageIds = new Set(manifest.map(({ id }) => id));
  const videoIds = new Set<string>();
  const youtubeIds = new Set<string>();
  const videos = value.videos.map((entry) => validateVideo(entry));

  for (const video of videos) {
    if (imageIds.has(video.id) || videoIds.has(video.id)) {
      throw new Error(`Duplicate gallery item id: ${video.id}`);
    }
    if (youtubeIds.has(video.videoId)) {
      throw new Error(`Duplicate YouTube video id: ${video.videoId}`);
    }
    videoIds.add(video.id);
    youtubeIds.add(video.videoId);
  }

  const seenOrderIds = new Set<string>();
  for (const id of value.order) {
    if (
      typeof id !== "string" ||
      !GALLERY_ITEM_ID_PATTERN.test(id) ||
      seenOrderIds.has(id) ||
      (!imageIds.has(id) && !videoIds.has(id))
    ) {
      throw new Error(`Invalid, duplicate, or unknown gallery order id: ${String(id)}`);
    }
    seenOrderIds.add(id);
  }

  for (const videoId of videoIds) {
    if (!seenOrderIds.has(videoId)) {
      throw new Error(`Gallery video ${videoId} is missing from the gallery order.`);
    }
  }

  return {
    version: 1,
    order: [...value.order] as string[],
    videos,
  };
}

function organizerRevision(
  manifest: GalleryManifestImage[],
  imageCopy: GalleryCopy,
  content: GalleryContent,
) {
  return createHash("sha256")
    .update(JSON.stringify({ manifest, imageCopy, content }))
    .digest("hex");
}

function validateOrganizerItems(
  value: unknown,
  manifest: GalleryManifestImage[],
  pendingImages: Map<string, PendingImage>,
  imageCopy: GalleryCopy,
  content: GalleryContent,
) {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new OrganizerHttpError(400, "The organizer update must include an items list.");
  }

  if (value.revision !== organizerRevision(manifest, imageCopy, content)) {
    throw new OrganizerHttpError(
      409,
      "The gallery changed on disk. Refresh the organizer and try again.",
    );
  }

  const availableIds = new Set([
    ...manifest.map((image) => image.id),
    ...pendingImages.keys(),
  ]);
  const seenIds = new Set<string>();
  const seenYoutubeIds = new Set<string>();
  const result: Array<
    | { id: string; type: "image"; alt: string; caption: string }
    | GalleryVideo
  > = [];

  for (const entry of value.items) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !GALLERY_ITEM_ID_PATTERN.test(entry.id) ||
      seenIds.has(entry.id)
    ) {
      throw new OrganizerHttpError(
        400,
        "Every gallery item needs a unique, valid ID.",
      );
    }

    if (entry.type === "image") {
      if (!hasOnlyKeys(entry, ["id", "type", "alt", "caption"])) {
        throw new OrganizerHttpError(400, "The photo update contains unsupported fields.");
      }
      if (!availableIds.has(entry.id)) {
        throw new OrganizerHttpError(400, "The organizer contains an unknown photo.");
      }

      if (typeof entry.alt !== "string" || typeof entry.caption !== "string") {
        throw new OrganizerHttpError(400, "Every photo needs a caption and image description.");
      }

      const alt = entry.alt.trim();
      const caption = entry.caption.trim();
      if (alt.length < 10 || alt.length > 500) {
        throw new OrganizerHttpError(
          400,
          "Image descriptions must be between 10 and 500 characters.",
        );
      }
      if (caption.length < 3 || caption.length > 500) {
        throw new OrganizerHttpError(400, "Captions must be between 3 and 500 characters.");
      }

      seenIds.add(entry.id);
      result.push({ id: entry.id, type: "image", alt, caption });
      continue;
    }

    if (entry.type !== "youtube") {
      throw new OrganizerHttpError(400, "The organizer contains an unsupported item type.");
    }

    let video: GalleryVideo;
    try {
      video = validateVideo(entry);
    } catch {
      throw new OrganizerHttpError(
        400,
        "YouTube videos need a valid video ID, title, caption, and orientation.",
      );
    }
    if (availableIds.has(video.id)) {
      throw new OrganizerHttpError(400, "A video cannot use the same ID as a photo.");
    }
    if (seenYoutubeIds.has(video.videoId)) {
      throw new OrganizerHttpError(400, "That YouTube video is already in the gallery.");
    }

    seenIds.add(video.id);
    seenYoutubeIds.add(video.videoId);
    result.push({
      ...video,
      title: video.title.trim(),
      caption: video.caption.trim(),
    });
  }

  return result;
}

function validateCleanupRequest(value: unknown) {
  if (
    !isRecord(value) ||
    value.confirm !== true ||
    value.deploymentConfirmed !== true ||
    !Array.isArray(value.pathnames) ||
    value.pathnames.length > 5_000
  ) {
    throw new OrganizerHttpError(
      400,
      "Confirm that the gallery was deployed before deleting unused files.",
    );
  }

  const pathnames = value.pathnames;
  if (
    !pathnames.every(
      (pathname): pathname is string =>
        typeof pathname === "string" && pathname.startsWith("gallery/"),
    ) ||
    new Set(pathnames).size !== pathnames.length
  ) {
    throw new OrganizerHttpError(400, "The unused-file selection is invalid.");
  }

  return pathnames;
}

function validatePendingDeleteRequest(value: unknown) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.ids) ||
    value.ids.length > 1_000 ||
    !value.ids.every(
      (id): id is string =>
        typeof id === "string" && GALLERY_ITEM_ID_PATTERN.test(id),
    ) ||
    new Set(value.ids).size !== value.ids.length
  ) {
    throw new OrganizerHttpError(400, "The pending-photo selection is invalid.");
  }
  return value.ids;
}

async function writeJsonAtomically(pathname: string, value: unknown) {
  const temporaryPathname = `${pathname}.tmp-${process.pid}-${Date.now()}`;

  try {
    await writeFile(temporaryPathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPathname, pathname);
  } catch (error) {
    await unlink(temporaryPathname).catch(() => undefined);
    throw error;
  }
}

async function directoryFiles(pathname: string) {
  try {
    return await readdir(pathname, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function pathExists(pathname: string) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function uniqueArchivePath(directory: string, filename: string) {
  const initialPath = join(directory, filename);
  if (!(await pathExists(initialPath))) return initialPath;

  const extension = extname(filename);
  const stem = basename(filename, extension);
  let suffix = 2;
  while (await pathExists(join(directory, `${stem}-${suffix}${extension}`))) suffix += 1;
  return join(directory, `${stem}-${suffix}${extension}`);
}

async function executeMoves(moves: FileMove[]) {
  for (const move of moves) await rename(move.from, move.to);
}

function transactionPathIsSafe(projectRoot: string, pathname: unknown): pathname is string {
  return (
    typeof pathname === "string" &&
    resolve(pathname).startsWith(`${resolve(projectRoot)}${sep}`)
  );
}

function validateSaveTransaction(value: unknown, projectRoot: string): SaveTransaction {
  if (
    !isRecord(value) ||
    (value.phase !== "prepared" && value.phase !== "moved" && value.phase !== "committed") ||
    !Array.isArray(value.oldManifest) ||
    !isRecord(value.oldCopy) ||
    !isRecord(value.oldContent) ||
    !Array.isArray(value.moves) ||
    !value.moves.every(
      (move) =>
        isRecord(move) &&
        transactionPathIsSafe(projectRoot, move.from) &&
        transactionPathIsSafe(projectRoot, move.to),
    )
  ) {
    throw new Error("The gallery save-recovery file is invalid.");
  }

  const oldManifest = validateManifest(value.oldManifest);
  return {
    phase: value.phase,
    oldManifest,
    oldCopy: validateCopy(value.oldCopy),
    oldContent: validateContent(value.oldContent, oldManifest),
    moves: value.moves as FileMove[],
  };
}

async function recoverSaveTransaction(
  transactionPath: string,
  projectRoot: string,
  manifestPath: string,
  copyPath: string,
  contentPath: string,
) {
  let value: unknown;
  try {
    value = await readJson(transactionPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }

  const transaction = validateSaveTransaction(value, projectRoot);
  if (transaction.phase === "committed") {
    await unlink(transactionPath);
    return true;
  }

  for (const move of [...transaction.moves].reverse()) {
    const sourceExists = await pathExists(move.from);
    const destinationExists = await pathExists(move.to);
    if (sourceExists && destinationExists) {
      throw new Error("Gallery save recovery found two copies of a moved source file.");
    }
    if (!sourceExists && destinationExists) await rename(move.to, move.from);
  }
  await writeJsonAtomically(copyPath, transaction.oldCopy);
  await writeJsonAtomically(manifestPath, transaction.oldManifest);
  await writeJsonAtomically(contentPath, transaction.oldContent);
  await unlink(transactionPath);
  return true;
}

async function archiveStaleStaging(stagingDirectory: string, removedDirectory: string) {
  const archived: string[] = [];
  for (const file of await directoryFiles(stagingDirectory)) {
    if (!file.isFile()) continue;
    const cleanName = file.name.replace(/\.uploading$/, "");
    const destination = await uniqueArchivePath(
      removedDirectory,
      `unsaved-${cleanName}`,
    );
    await rename(join(stagingDirectory, file.name), destination);
    archived.push(basename(destination));
  }
  return archived;
}

function createExclusiveQueue() {
  let tail: Promise<void> = Promise.resolve();

  return function runExclusive<T>(task: () => Promise<T>) {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

function headerString(request: IncomingMessage, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function organizerItems(
  manifest: GalleryManifestImage[],
  imageCopy: GalleryCopy,
  content: GalleryContent,
  pendingImages: Map<string, PendingImage>,
) {
  const persistedById = new Map<string, OrganizerItem>(
    manifest.map((image) => [
      image.id,
      {
        ...image,
        alt: imageCopy[image.id]?.alt ?? "",
        caption: imageCopy[image.id]?.caption ?? "",
        pending: false,
      },
    ]),
  );
  for (const video of content.videos) persistedById.set(video.id, video);

  const items: OrganizerItem[] = [];
  const includedIds = new Set<string>();
  for (const id of content.order) {
    const item = persistedById.get(id);
    if (!item) continue;
    items.push(item);
    includedIds.add(id);
  }
  for (const image of manifest) {
    if (includedIds.has(image.id)) continue;
    items.push(persistedById.get(image.id)!);
    includedIds.add(image.id);
  }

  const pending: OrganizerImage[] = [...pendingImages.values()].map(({ image }) => ({
    ...image,
    alt: "",
    caption: "",
    pending: true,
  }));

  return [...items, ...pending];
}

export function galleryOrganizerPlugin(
  options: GalleryOrganizerPluginOptions = {},
): Plugin {
  const pendingImages = new Map<string, PendingImage>();
  const blobService = options.blobToken
    ? new GalleryBlobService(options.blobToken)
    : null;
  const runExclusive = createExclusiveQueue();

  return {
    name: "local-gallery-organizer",
    apply: "serve",
    async configureServer(server) {
      const projectRoot = server.config.root;
      const manifestPath = resolve(projectRoot, MANIFEST_FILE);
      const copyPath = resolve(projectRoot, COPY_FILE);
      const contentPath = resolve(projectRoot, CONTENT_FILE);
      const uploadDirectory = resolve(projectRoot, UPLOAD_DIRECTORY);
      const removedDirectory = resolve(projectRoot, REMOVED_DIRECTORY);
      const stagingDirectory = resolve(projectRoot, STAGING_DIRECTORY);
      const transactionPath = resolve(projectRoot, TRANSACTION_FILE);

      await mkdir(removedDirectory, { recursive: true });
      if (
        await recoverSaveTransaction(
          transactionPath,
          projectRoot,
          manifestPath,
          copyPath,
          contentPath,
        )
      ) {
        server.config.logger.warn("Recovered an interrupted local gallery save.");
      }
      const archivedStaging = await archiveStaleStaging(
        stagingDirectory,
        removedDirectory,
      );
      if (archivedStaging.length > 0) {
        server.config.logger.warn(
          `Archived ${archivedStaging.length} unsaved staged gallery ${archivedStaging.length === 1 ? "photo" : "photos"} in ${REMOVED_DIRECTORY}.`,
        );
      }

      const runOrganizerExclusive = <T>(task: () => Promise<T>) =>
        runExclusive(async () => {
          if (
            await recoverSaveTransaction(
              transactionPath,
              projectRoot,
              manifestPath,
              copyPath,
              contentPath,
            )
          ) {
            server.config.logger.warn("Recovered an interrupted local gallery save.");
          }
          return task();
        });

      const requireBlobService = () => {
        if (!blobService) {
          throw new OrganizerHttpError(
            503,
            "Gallery storage is not connected on this computer. Add BLOB_READ_WRITE_TOKEN to .env and restart the local site.",
          );
        }
        return blobService;
      };

      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const isPendingItem = pathname.startsWith(`${PENDING_IMAGES_PATH}/`);
        const isOrganizerRoute =
          pathname === ORGANIZER_PATH ||
          pathname === IMAGE_UPLOAD_PATH ||
          pathname === PENDING_IMAGES_PATH ||
          isPendingItem ||
          pathname === ORPHANS_PATH;

        if (!isOrganizerRoute) {
          next();
          return;
        }

        void (async () => {
          if (!isLocalRequest(request)) {
            sendJson(response, 404, { error: "Not found." });
            return;
          }

          if (pathname === ORGANIZER_PATH && request.method === "GET") {
            await runOrganizerExclusive(async () => {
              const manifest = validateManifest(await readJson(manifestPath));
              const imageCopy = validateCopy(await readJson(copyPath));
              const content = validateContent(await readJson(contentPath), manifest);
              sendJson(response, 200, {
                items: organizerItems(manifest, imageCopy, content, pendingImages),
                revision: organizerRevision(manifest, imageCopy, content),
                storageConfigured: blobService !== null,
              });
            });
            return;
          }

          if (pathname === ORGANIZER_PATH && request.method === "PUT") {
            requireLocalMutation(request, "application/json");
            const organizerUpdate = await readRequestJson(request);
            await runOrganizerExclusive(async () => {
              const manifest = validateManifest(await readJson(manifestPath));
              const imageCopy = validateCopy(await readJson(copyPath));
              const content = validateContent(await readJson(contentPath), manifest);
              const submittedItems = validateOrganizerItems(
                organizerUpdate,
                manifest,
                pendingImages,
                imageCopy,
                content,
              );
              const submittedPendingIds = new Set(
                submittedItems
                  .filter((item) => item.type === "image" && pendingImages.has(item.id))
                  .map(({ id }) => id),
              );
              if (
                submittedPendingIds.size !== pendingImages.size ||
                [...pendingImages.keys()].some((id) => !submittedPendingIds.has(id))
              ) {
                throw new OrganizerHttpError(
                  409,
                  "New photos changed in another organizer tab. Refresh before saving.",
                );
              }
              const submittedImages = submittedItems.filter(
                (item): item is Extract<(typeof submittedItems)[number], { type: "image" }> =>
                  item.type === "image",
              );
              const submittedVideos = submittedItems.filter(
                (item): item is GalleryVideo => item.type === "youtube",
              );
              const manifestById = new Map(manifest.map((image) => [image.id, image]));
              for (const [id, pending] of pendingImages) manifestById.set(id, pending.image);

              const reorderedManifest = submittedImages.map(
                ({ id }) => manifestById.get(id)!,
              );
              validateManifest(reorderedManifest);
              const retainedIds = new Set(submittedImages.map(({ id }) => id));
              const removedIds = new Set(
                manifest.map(({ id }) => id).filter((id) => !retainedIds.has(id)),
              );
              const updatedCopy: GalleryCopy = Object.fromEntries(
                submittedImages.map(({ id, alt, caption }) => [id, { alt, caption }]),
              );
              const updatedContent: GalleryContent = {
                version: 1,
                order: submittedItems.map(({ id }) => id),
                videos: submittedVideos,
              };
              validateContent(updatedContent, reorderedManifest);

              await mkdir(uploadDirectory, { recursive: true });
              await mkdir(removedDirectory, { recursive: true });
              const moves: FileMove[] = [];

              for (const file of await directoryFiles(uploadDirectory)) {
                if (!file.isFile() || file.name === ".gitkeep") continue;
                if (!removedIds.has(slugFromFilename(file.name))) continue;
                moves.push({
                  from: join(uploadDirectory, file.name),
                  to: await uniqueArchivePath(removedDirectory, file.name),
                });
              }

              for (const { id } of submittedImages) {
                const pending = pendingImages.get(id);
                if (!pending) continue;
                const destination = join(uploadDirectory, `${id}${pending.sourceExtension}`);
                if (await pathExists(destination)) {
                  throw new OrganizerHttpError(
                    409,
                    `A local source file already exists for ${id}. Refresh and try again.`,
                  );
                }
                moves.push({ from: pending.sourcePath, to: destination });
              }

              const transaction: SaveTransaction = {
                phase: "prepared",
                oldManifest: manifest,
                oldCopy: imageCopy,
                oldContent: content,
                moves,
              };
              await writeJsonAtomically(transactionPath, transaction);

              try {
                await executeMoves(moves);
                await writeJsonAtomically(transactionPath, {
                  ...transaction,
                  phase: "moved",
                });
                await writeJsonAtomically(copyPath, updatedCopy);
                await writeJsonAtomically(manifestPath, reorderedManifest);
                await writeJsonAtomically(contentPath, updatedContent);
                await writeJsonAtomically(transactionPath, {
                  ...transaction,
                  phase: "committed",
                });
              } catch (error) {
                try {
                  const recovered = await recoverSaveTransaction(
                    transactionPath,
                    projectRoot,
                    manifestPath,
                    copyPath,
                    contentPath,
                  );
                  if (!recovered) {
                    throw new Error("The gallery recovery marker disappeared during save.");
                  }
                } catch (recoveryError) {
                  throw new AggregateError(
                    [error, recoveryError],
                    "The gallery save failed and could not be fully rolled back. Restart the local site to run recovery.",
                  );
                }
                throw error;
              }
              try {
                await unlink(transactionPath);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                  server.config.logger.warn(
                    "The gallery save committed, but its recovery marker could not be cleared. It will be cleared before the next organizer action.",
                  );
                }
              }

              for (const [id, pending] of pendingImages) {
                if (retainedIds.has(id)) continue;
                try {
                  await unlink(pending.sourcePath);
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    server.config.logger.warn(
                      `Could not remove unused staged photo ${pending.sourcePath}. It will be archived after the next local restart.`,
                    );
                  }
                }
              }
              pendingImages.clear();

              sendJson(response, 200, {
                saved: true,
                revision: organizerRevision(
                  reorderedManifest,
                  updatedCopy,
                  updatedContent,
                ),
              });
            });
            return;
          }

          if (pathname === IMAGE_UPLOAD_PATH && request.method === "POST") {
            requireLocalMutation(request, "application/octet-stream");
            const service = requireBlobService();
            const encodedFilename = headerString(request, "x-gallery-filename");
            let filename = "";
            try {
              filename = encodedFilename ? decodeURIComponent(encodedFilename) : "";
            } catch {
              throw new OrganizerHttpError(400, "That photo filename is invalid.");
            }

            if (
              !filename ||
              filename.length > 240 ||
              basename(filename) !== filename ||
              !SUPPORTED_IMAGE_EXTENSIONS.has(extname(filename).toLowerCase())
            ) {
              throw new OrganizerHttpError(
                400,
                "Choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF photo.",
              );
            }

            const source = await readRequestBuffer(request, MAX_IMAGE_BYTES);
            if (source.length === 0) {
              throw new OrganizerHttpError(400, "That photo is empty.");
            }

            await runOrganizerExclusive(async () => {
              const manifest = validateManifest(await readJson(manifestPath));
              const imageCopy = validateCopy(await readJson(copyPath));
              const content = validateContent(await readJson(contentPath), manifest);
              const occupiedIds = new Set([
                ...manifest.map(({ id }) => id),
                ...pendingImages.keys(),
                ...Object.keys(imageCopy),
                ...content.order,
                ...content.videos.map(({ id }) => id),
              ]);
              for (const file of await directoryFiles(uploadDirectory)) {
                if (file.isFile() && file.name !== ".gitkeep") {
                  occupiedIds.add(slugFromFilename(file.name));
                }
              }
              for (const file of await directoryFiles(stagingDirectory)) {
                if (!file.isFile()) continue;
                occupiedIds.add(
                  slugFromFilename(file.name.replace(/\.uploading$/, "")),
                );
              }

              const id = uniqueImageId(filename, occupiedIds);
              const uploaded = await service.uploadImage(source, filename, id);
              await mkdir(stagingDirectory, { recursive: true });
              const temporarySourcePath = join(
                stagingDirectory,
                `${id}${uploaded.retainedExtension}.uploading`,
              );
              const sourcePath = join(
                stagingDirectory,
                `${id}${uploaded.retainedExtension}`,
              );

              await writeFile(temporarySourcePath, uploaded.retainedSource, { flag: "wx" });
              try {
                await rename(temporarySourcePath, sourcePath);
                pendingImages.set(id, {
                  image: uploaded.image,
                  sourcePath,
                  sourceExtension: uploaded.retainedExtension,
                });
                sendJson(response, 201, {
                  image: {
                    ...uploaded.image,
                    alt: "",
                    caption: "",
                    pending: true,
                  },
                });
              } catch (error) {
                await unlink(temporarySourcePath).catch(() => undefined);
                throw error;
              }
            });
            return;
          }

          if (isPendingItem && request.method === "DELETE") {
            requireLocalMutation(request);
            const encodedId = pathname.slice(`${PENDING_IMAGES_PATH}/`.length);
            let id = "";
            try {
              id = decodeURIComponent(encodedId);
            } catch {
              throw new OrganizerHttpError(400, "That pending photo ID is invalid.");
            }
            await runOrganizerExclusive(async () => {
              const pending = pendingImages.get(id);
              if (!pending) throw new OrganizerHttpError(404, "Pending photo not found.");
              try {
                await unlink(pending.sourcePath);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
              }
              pendingImages.delete(id);
              sendJson(response, 200, { removed: true });
            });
            return;
          }

          if (pathname === PENDING_IMAGES_PATH && request.method === "DELETE") {
            requireLocalMutation(request, "application/json");
            const requestedIds = validatePendingDeleteRequest(
              await readRequestJson(request),
            );
            await runOrganizerExclusive(async () => {
              if (
                requestedIds.length !== pendingImages.size ||
                requestedIds.some((id) => !pendingImages.has(id))
              ) {
                throw new OrganizerHttpError(
                  409,
                  "New photos changed in another organizer tab. Refresh before discarding.",
                );
              }
              for (const [id, pending] of pendingImages) {
                try {
                  await unlink(pending.sourcePath);
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                }
                pendingImages.delete(id);
              }
              sendJson(response, 200, { removed: true });
            });
            return;
          }

          if (pathname === ORPHANS_PATH && request.method === "GET") {
            requireLocalStorageRead(request);
            const service = requireBlobService();
            await runOrganizerExclusive(async () => {
              const manifest = validateManifest(await readJson(manifestPath));
              const activeImages = [
                ...manifest,
                ...[...pendingImages.values()].map(({ image }) => image),
              ];
              sendJson(response, 200, await service.findOrphans(activeImages));
            });
            return;
          }

          if (pathname === ORPHANS_PATH && request.method === "DELETE") {
            requireLocalMutation(request, "application/json");
            const service = requireBlobService();
            const pathnames = validateCleanupRequest(await readRequestJson(request));
            await runOrganizerExclusive(async () => {
              const manifest = validateManifest(await readJson(manifestPath));
              const activeImages = [
                ...manifest,
                ...[...pendingImages.values()].map(({ image }) => image),
              ];
              sendJson(
                response,
                200,
                await service.deleteOrphans(pathnames, activeImages),
              );
            });
            return;
          }

          response.setHeader("Allow", "GET, PUT, POST, DELETE");
          sendJson(response, 405, { error: "Method not allowed." });
        })().catch((error: unknown) => {
          const status =
            error instanceof OrganizerHttpError
              ? error.status
              : error instanceof GalleryImageInputError
                ? 400
                : 500;
          const message =
            error instanceof Error ? error.message : "The gallery organizer ran into a problem.";

          if (status === 500) server.config.logger.error(message);
          if (!response.headersSent && !response.writableEnded) {
            sendJson(response, status, {
              error: status === 500 ? "The gallery organizer ran into a problem." : message,
            });
          }
        });
      });
    },
  };
}

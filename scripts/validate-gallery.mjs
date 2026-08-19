#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const MANIFEST_FILE = "src/data/gallery-images.generated.json";
const COPY_FILE = "src/data/gallery-image-copy.json";
const CONTENT_FILE = "src/data/gallery-content.json";
const GALLERY_ITEM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CONTENT_KEYS = new Set(["version", "order", "videos"]);
const VIDEO_KEYS = new Set([
  "id",
  "type",
  "videoId",
  "title",
  "caption",
  "orientation",
]);

const [images, imageCopy, content] = await Promise.all(
  [MANIFEST_FILE, COPY_FILE, CONTENT_FILE].map(async (pathname) =>
    JSON.parse(await readFile(pathname, "utf8")),
  ),
);

if (!Array.isArray(images)) {
  throw new Error(`${MANIFEST_FILE} must contain a JSON array.`);
}
if (!imageCopy || typeof imageCopy !== "object" || Array.isArray(imageCopy)) {
  throw new Error(`${COPY_FILE} must contain a JSON object.`);
}
if (
  !content ||
  typeof content !== "object" ||
  Array.isArray(content) ||
  !Object.keys(content).every((key) => CONTENT_KEYS.has(key)) ||
  content.version !== 1 ||
  !Array.isArray(content.order) ||
  !Array.isArray(content.videos)
) {
  throw new Error(`${CONTENT_FILE} must contain version 1 gallery content.`);
}

const imageIds = new Set();

for (const image of images) {
  if (
    !image ||
    typeof image.id !== "string" ||
    !GALLERY_ITEM_ID_PATTERN.test(image.id) ||
    image.type !== "image" ||
    typeof image.src !== "string" ||
    !Array.isArray(image.variants) ||
    image.variants.length === 0 ||
    !image.variants.every(
      (variant) =>
        variant &&
        typeof variant.src === "string" &&
        Number.isInteger(variant.width) &&
        variant.width > 0,
    ) ||
    !Number.isInteger(image.width) ||
    image.width <= 0 ||
    !Number.isInteger(image.height) ||
    image.height <= 0
  ) {
    throw new Error(`Invalid image entry in ${MANIFEST_FILE}.`);
  }

  if (imageIds.has(image.id)) {
    throw new Error(`Duplicate gallery image id: ${image.id}`);
  }
  imageIds.add(image.id);

  const copy = imageCopy[image.id];
  if (
    !copy ||
    typeof copy.alt !== "string" ||
    copy.alt.trim().length < 10 ||
    copy.alt.trim().length > 500 ||
    typeof copy.caption !== "string" ||
    copy.caption.trim().length < 3 ||
    copy.caption.trim().length > 500
  ) {
    throw new Error(`Add descriptive alt text and a caption for "${image.id}" in ${COPY_FILE}.`);
  }
}

const videoIds = new Set();
const youtubeIds = new Set();

for (const video of content.videos) {
  if (
    !video ||
    typeof video !== "object" ||
    Array.isArray(video) ||
    !Object.keys(video).every((key) => VIDEO_KEYS.has(key)) ||
    typeof video.id !== "string" ||
    !GALLERY_ITEM_ID_PATTERN.test(video.id) ||
    video.type !== "youtube" ||
    typeof video.videoId !== "string" ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(video.videoId) ||
    typeof video.title !== "string" ||
    video.title.trim().length < 3 ||
    video.title.trim().length > 120 ||
    typeof video.caption !== "string" ||
    video.caption.trim().length < 3 ||
    video.caption.trim().length > 500 ||
    (video.orientation !== "landscape" && video.orientation !== "portrait")
  ) {
    throw new Error(`Invalid YouTube video in ${CONTENT_FILE}.`);
  }
  if (imageIds.has(video.id) || videoIds.has(video.id)) {
    throw new Error(`Duplicate gallery item id: ${video.id}`);
  }
  if (youtubeIds.has(video.videoId)) {
    throw new Error(`Duplicate YouTube video id: ${video.videoId}`);
  }
  videoIds.add(video.id);
  youtubeIds.add(video.videoId);
}

const orderedIds = new Set();
for (const id of content.order) {
  if (
    typeof id !== "string" ||
    !GALLERY_ITEM_ID_PATTERN.test(id) ||
    orderedIds.has(id) ||
    (!imageIds.has(id) && !videoIds.has(id))
  ) {
    throw new Error(`Invalid, duplicate, or unknown gallery order id: ${String(id)}`);
  }
  orderedIds.add(id);
}

for (const videoId of videoIds) {
  if (!orderedIds.has(videoId)) {
    throw new Error(`Gallery video ${videoId} is missing from the gallery order.`);
  }
}

console.log(
  `Validated ${images.length} gallery photos and ${videoIds.size} YouTube ${videoIds.size === 1 ? "video" : "videos"}.`,
);

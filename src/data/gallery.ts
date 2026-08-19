import generatedImageData from "./gallery-images.generated.json";
import imageCopyData from "./gallery-image-copy.json";
import galleryContentData from "./gallery-content.json";

export type GeneratedGalleryImage = {
  id: string;
  type: "image";
  src: string;
  variants: Array<{ src: string; width: number }>;
  width: number;
  height: number;
};

export type GalleryImage = GeneratedGalleryImage & {
  type: "image";
  alt: string;
  caption: string;
};

export type GalleryVideo = {
  id: string;
  type: "youtube";
  videoId: string;
  title: string;
  caption: string;
  poster?: string;
  embeddable: boolean;
  orientation: "landscape" | "portrait";
};

export type GalleryItem = GalleryImage | GalleryVideo;

type StoredGalleryVideo = Omit<GalleryVideo, "embeddable" | "poster">;

type GalleryContentData = {
  version: 1;
  order: string[];
  videos: StoredGalleryVideo[];
};

const galleryImages: GeneratedGalleryImage[] = generatedImageData.map((image) => ({
  id: image.id,
  type: "image" as const,
  src: image.src,
  variants: image.variants,
  width: image.width,
  height: image.height,
}));

const imageCopy: Record<string, { alt: string; caption: string }> = imageCopyData;
const galleryContent = galleryContentData as GalleryContentData;

const images: GalleryImage[] = galleryImages.map((image) => {
  const copy = imageCopy[image.id];

  return {
    ...image,
    alt: copy?.alt ?? "A Mochi Manners gallery photo",
    caption: copy?.caption ?? "A moment with Mochi Manners.",
  };
});

const videos: GalleryVideo[] = galleryContent.videos.map((video) => ({
  ...video,
  embeddable: true,
}));

const itemsById = new Map<string, GalleryItem>([
  ...images.map((image) => [image.id, image] as const),
  ...videos.map((video) => [video.id, video] as const),
]);
const includedIds = new Set<string>();
const orderedItems: GalleryItem[] = [];

for (const id of galleryContent.order) {
  const item = itemsById.get(id);
  if (!item || includedIds.has(id)) continue;
  orderedItems.push(item);
  includedIds.add(id);
}

// The bulk photo uploader intentionally does not edit gallery-content.json.
// Newly uploaded photos therefore remain visible at the end until the next
// organizer save persists their exact position.
for (const item of [...images, ...videos]) {
  if (includedIds.has(item.id)) continue;
  orderedItems.push(item);
  includedIds.add(item.id);
}

export const galleryItems: GalleryItem[] = orderedItems;

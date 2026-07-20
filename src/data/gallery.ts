export type GalleryImage = {
  id: string;
  type: "image";
  src: string;
  alt: string;
};

export type GalleryVideo = {
  id: string;
  type: "video";
  src: string;
  alt: string;
  poster?: string;
};

export type GalleryItem = GalleryImage | GalleryVideo;

/**
 * Add items here after uploading to Vercel Blob.
 * Run: npm run gallery:upload
 * Or paste URLs from the Vercel dashboard manually.
 */
export const galleryItems: GalleryItem[] = [];

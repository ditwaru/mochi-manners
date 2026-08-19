import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { galleryItems, type GalleryImage, type GalleryVideo } from "../data/gallery";
import { usePageMeta } from "../hooks/usePageMeta";

function imageSrcSet(image: GalleryImage) {
  return image.variants.map((variant) => `${variant.src} ${variant.width}w`).join(", ");
}

function GalleryPhoto({
  image,
  onOpen,
}: {
  image: GalleryImage;
  onOpen: (imageId: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <figure
      className={`gallery-card gallery-card-photo ${image.height > image.width ? "gallery-card-portrait" : ""}`}
    >
      <button
        type="button"
        className="gallery-photo-button"
        aria-label={`View larger image: ${image.alt}`}
        onClick={(event) => onOpen(image.id, event.currentTarget)}
      >
        <img
          src={image.src}
          srcSet={imageSrcSet(image)}
          sizes="(max-width: 768px) calc(100vw - 2rem), (max-width: 1100px) calc(50vw - 3rem), 32rem"
          alt={image.alt}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
        />
        <span className="gallery-expand" aria-hidden="true">
          View
        </span>
      </button>
      <figcaption>{image.caption}</figcaption>
    </figure>
  );
}

function GalleryYouTube({
  video,
  isPlaying,
  onPlay,
}: {
  video: GalleryVideo;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  const playerRef = useRef<HTMLIFrameElement>(null);
  const maxResolutionPoster = `https://i.ytimg.com/vi/${video.videoId}/maxresdefault.jpg`;
  const fallbackPoster = `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
  const [posterSrc, setPosterSrc] = useState<string | null>(
    video.poster ?? maxResolutionPoster,
  );

  useEffect(() => {
    setPosterSrc(video.poster ?? maxResolutionPoster);
  }, [maxResolutionPoster, video.poster]);

  useEffect(() => {
    if (!isPlaying || !video.embeddable) return;
    requestAnimationFrame(() => playerRef.current?.focus());
  }, [isPlaying, video.embeddable]);

  const poster = (
    <>
      {posterSrc ? (
        <img
          src={posterSrc}
          alt=""
          width={1280}
          height={720}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            setPosterSrc((currentPoster) =>
              currentPoster === fallbackPoster ? null : fallbackPoster,
            );
          }}
        />
      ) : (
        <span className="gallery-video-placeholder" aria-hidden="true">
          <span className="gallery-video-placeholder-copy">
            <small>Video preview</small>
            <strong>{video.embeddable ? "Play video" : "Watch on YouTube"}</strong>
          </span>
        </span>
      )}
      <span className="gallery-play" aria-hidden="true">
        <span>▶</span>
      </span>
    </>
  );

  return (
    <figure className="gallery-card gallery-card-video">
      <div
        className={`gallery-video-frame ${video.orientation === "portrait" ? "gallery-video-frame-portrait" : ""}`}
      >
        {isPlaying && video.embeddable ? (
          <iframe
            ref={playerRef}
            src={`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1&playsinline=1&rel=0`}
            title={video.title}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : video.embeddable ? (
          <button
            type="button"
            className="gallery-video-poster"
            onClick={onPlay}
            aria-label={`Play ${video.title}`}
          >
            {poster}
          </button>
        ) : (
          <a
            className="gallery-video-poster"
            href={`https://www.youtube.com/watch?v=${video.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Watch ${video.title} on YouTube (opens in a new tab)`}
          >
            {poster}
          </a>
        )}
      </div>
      <figcaption>
        <strong>{video.title}</strong>
        <span>{video.caption}</span>
        {!video.embeddable && (
          <a
            href={`https://www.youtube.com/watch?v=${video.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Watch on YouTube <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </figcaption>
    </figure>
  );
}

export default function Gallery() {
  const normalizedHostname = window.location.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const showOrganizerLink =
    import.meta.env.DEV &&
    ["localhost", "127.0.0.1", "::1"].includes(normalizedHostname);
  const images = useMemo(
    () => galleryItems.filter((item): item is GalleryImage => item.type === "image"),
    [],
  );
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const selectedIndex = images.findIndex((image) => image.id === selectedImageId);
  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null;
  const isLightboxOpen = selectedImage !== null;

  usePageMeta({
    title: "Gallery | Mochi Manners",
    description: "See training moments, everyday adventures, and happy dogs with Mochi Manners.",
    path: "/gallery",
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isLightboxOpen) return;

    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [isLightboxOpen]);

  useEffect(() => {
    if (!selectedImage) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dialogRef.current?.close();
        return;
      }
      if (event.key === "ArrowLeft") {
        if (images.length < 2) return;
        event.preventDefault();
        setSelectedImageId(images[(selectedIndex - 1 + images.length) % images.length].id);
      }
      if (event.key === "ArrowRight") {
        if (images.length < 2) return;
        event.preventDefault();
        setSelectedImageId(images[(selectedIndex + 1) % images.length].id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [images, selectedImage, selectedIndex]);

  const openImage = (imageId: string, trigger: HTMLButtonElement) => {
    openerRef.current = trigger;
    setSelectedImageId(imageId);
  };

  const closeImage = () => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
      return;
    }

    setSelectedImageId(null);
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  const handleDialogClose = () => {
    setSelectedImageId(null);
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  const showAdjacentImage = (direction: -1 | 1) => {
    const nextIndex = (selectedIndex + direction + images.length) % images.length;
    setSelectedImageId(images[nextIndex].id);
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) closeImage();
  };

  return (
    <main id="main-content" className="gallery-page">
      <header className="gallery-hero">
        <div className="container gallery-hero-inner">
          <p className="gallery-eyebrow">Mochi Manners in action</p>
          <h1>Good manners make more life possible.</h1>
          <p>
            Training moments, everyday adventures, and a few reminders that progress can be
            joyful.
          </p>
        </div>
      </header>

      <section className="gallery-section" aria-labelledby="gallery-grid-title">
        <div className="container">
          <div className="gallery-section-heading">
            <h2 id="gallery-grid-title">A look at life with Mochi Manners</h2>
            <p>Select a photo for a closer look or choose a video to watch.</p>
            {showOrganizerLink && (
              <a className="gallery-local-organizer-link" href="/gallery/organize">
                Organize gallery
              </a>
            )}
          </div>

          <div className="gallery-grid">
            {galleryItems.map((item) =>
              item.type === "image" ? (
                <GalleryPhoto key={item.id} image={item} onOpen={openImage} />
              ) : (
                <GalleryYouTube
                  key={item.id}
                  video={item}
                  isPlaying={playingVideoId === item.id}
                  onPlay={() => setPlayingVideoId(item.id)}
                />
              ),
            )}
          </div>
        </div>
      </section>

      <dialog
        ref={dialogRef}
        className="gallery-lightbox"
        aria-label="Expanded gallery photo"
        onClose={handleDialogClose}
        onClick={handleBackdropClick}
      >
        {selectedImage && (
          <div className="gallery-lightbox-content">
            <button type="button" className="gallery-lightbox-close" onClick={closeImage}>
              <span aria-hidden="true">×</span>
              <span className="sr-only">Close image viewer</span>
            </button>

            {images.length > 1 && (
              <button
                type="button"
                className="gallery-lightbox-nav gallery-lightbox-previous"
                aria-label="Previous photo"
                onClick={() => showAdjacentImage(-1)}
              >
                <span aria-hidden="true">‹</span>
              </button>
            )}

            <img
              src={selectedImage.src}
              srcSet={imageSrcSet(selectedImage)}
              sizes="min(90vw, 100rem)"
              alt={selectedImage.alt}
              width={selectedImage.width}
              height={selectedImage.height}
            />

            {images.length > 1 && (
              <button
                type="button"
                className="gallery-lightbox-nav gallery-lightbox-next"
                aria-label="Next photo"
                onClick={() => showAdjacentImage(1)}
              >
                <span aria-hidden="true">›</span>
              </button>
            )}

            <p>{selectedImage.caption}</p>
            <span className="gallery-lightbox-count" aria-live="polite" aria-atomic="true">
              <span className="sr-only">{selectedImage.caption} </span>
              Photo {selectedIndex + 1} of {images.length}
            </span>
          </div>
        )}
      </dialog>
    </main>
  );
}

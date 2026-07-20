import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { galleryItems, type GalleryItem } from "../data/gallery";

export default function Gallery() {
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);

  const closeLightbox = useCallback(() => setLightboxItem(null), []);

  useEffect(() => {
    if (!lightboxItem) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lightboxItem, closeLightbox]);

  return (
    <main className="gallery-page">
      <section className="section section-lavender gallery-hero">
        <div className="container">
          <div className="section-header">
            <h1>Gallery</h1>
            <p>
              Moments from walks, training sessions, and the dogs we love caring
              for.
            </p>
          </div>
        </div>
      </section>

      <section className="section section-cream">
        <div className="container">
          {galleryItems.length === 0 ? (
            <div className="gallery-empty">
              <p>Photos and videos coming soon.</p>
              <p className="gallery-empty-hint">
                Upload media to Vercel Blob and run{" "}
                <code>npm run gallery:upload</code> to populate the gallery.
              </p>
            </div>
          ) : (
            <div className="gallery-grid">
              {galleryItems.map((item) =>
                item.type === "image" ? (
                  <button
                    key={item.id}
                    type="button"
                    className="gallery-item gallery-item-image"
                    onClick={() => setLightboxItem(item)}
                  >
                    <img src={item.src} alt={item.alt} loading="lazy" />
                  </button>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    className="gallery-item gallery-item-video"
                    onClick={() => setLightboxItem(item)}
                  >
                    {item.poster ? (
                      <img src={item.poster} alt="" aria-hidden="true" />
                    ) : (
                      <video src={item.src} muted preload="metadata" />
                    )}
                    <span className="gallery-play" aria-hidden="true">
                      ▶
                    </span>
                    <span className="sr-only">{item.alt || "Play video"}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </section>

      {lightboxItem && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightboxItem.alt || "Gallery media"}
          onClick={closeLightbox}
        >
          <button
            type="button"
            className="lightbox-close"
            onClick={closeLightbox}
            aria-label="Close"
          >
            ×
          </button>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            {lightboxItem.type === "image" ? (
              <img src={lightboxItem.src} alt={lightboxItem.alt} />
            ) : (
              <video src={lightboxItem.src} controls autoPlay poster={lightboxItem.poster}>
                <track kind="captions" />
              </video>
            )}
          </div>
        </div>
      )}

      <section className="section section-mint gallery-cta">
        <div className="container gallery-cta-inner">
          <p>Interested in working together?</p>
          <Link to="/#contact" className="btn btn-primary">
            Get in touch
          </Link>
        </div>
      </section>
    </main>
  );
}

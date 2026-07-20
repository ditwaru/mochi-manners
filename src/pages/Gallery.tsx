import { Link } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";

export default function Gallery() {
  usePageMeta({
    title: "Gallery | Mochi Manners",
    description: "Photos and videos from Mochi Manners dog training, walks, and pet care.",
    path: "/gallery",
  });

  return (
    <main id="main-content" className="gallery-page">
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
          <p className="gallery-coming-soon">Coming soon</p>
        </div>
      </section>

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

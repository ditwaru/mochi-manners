import { usePageMeta } from "../hooks/usePageMeta";

export default function Gallery() {
  usePageMeta({
    title: "Gallery | Mochi Manners",
    description: "Gallery coming soon.",
    path: "/gallery",
  });

  return (
    <main id="main-content" className="gallery-page">
      <p className="gallery-coming-soon">Coming soon</p>
    </main>
  );
}

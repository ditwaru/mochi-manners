import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Book from "./pages/Book";
import Gallery from "./pages/Gallery";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";

const GalleryOrganizer = import.meta.env.DEV
  ? lazy(() => import("./pages/GalleryOrganizerMixed"))
  : null;

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1"
  );
}

export default function App() {
  const showLocalGalleryOrganizer =
    GalleryOrganizer !== null && isLoopbackHostname(window.location.hostname);

  return (
    <BrowserRouter>
      <Routes>
        {showLocalGalleryOrganizer && GalleryOrganizer && (
          <Route
            path="/gallery/organize"
            element={
              <Suspense fallback={<main id="main-content">Loading gallery organizer…</main>}>
                <GalleryOrganizer />
              </Suspense>
            }
          />
        )}
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/book" element={<Book />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

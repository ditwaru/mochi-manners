import { Link } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";

export default function NotFound() {
  usePageMeta({
    title: "Page Not Found | Mochi Manners",
    description: "The page you're looking for doesn't exist.",
    path: "/404",
  });

  return (
    <main id="main-content" className="not-found">
      <div className="container not-found-inner">
        <h1>Page not found</h1>
        <p>Sorry, we couldn&apos;t find that page.</p>
        <Link to="/" className="btn btn-primary">
          Back to home
        </Link>
      </div>
    </main>
  );
}

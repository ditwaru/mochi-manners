import { useEffect, type MouseEvent } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import logoWordmark from "../assets/logo-wordmark.png";
import { ActiveSectionProvider, useActiveSection } from "../context/ActiveSectionContext";
import { site } from "../site";

const homeSections = ["services", "about", "contact"] as const;

function LayoutInner() {
  const location = useLocation();
  const { activeSection, setActiveSection } = useActiveSection();
  const onHome = location.pathname === "/";

  useEffect(() => {
    if (!location.hash || !onHome) return;
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, [location.hash, onHome]);

  useEffect(() => {
    if (!onHome) setActiveSection(null);
  }, [onHome, setActiveSection]);

  const handleLogoClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onHome) return;
    e.preventDefault();
    if (location.hash) {
      window.history.replaceState(null, "", "/");
    }
    setActiveSection(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div id="top" className="page">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="header">
        <div className="container header-inner">
          <Link
            to="/"
            className="logo"
            aria-label="Mochi Manners home"
            onClick={handleLogoClick}
          >
            <img className="brand-wordmark" src={logoWordmark} alt="Mochi Manners" />
          </Link>
          <nav className="nav" aria-label="Main">
            {homeSections.map((id) => (
              <Link
                key={id}
                to={`/#${id}`}
                className={onHome && activeSection === id ? "active" : undefined}
                aria-current={onHome && activeSection === id ? "location" : undefined}
              >
                {id.charAt(0).toUpperCase() + id.slice(1)}
              </Link>
            ))}
            <Link
              to="/gallery"
              className={location.pathname === "/gallery" ? "active" : undefined}
              aria-current={location.pathname === "/gallery" ? "page" : undefined}
            >
              Gallery
            </Link>
          </nav>
        </div>
      </header>

      <Outlet />

      <footer className="footer">
        <div className="container footer-inner">
          <img className="footer-logo brand-wordmark" src={logoWordmark} alt="" />
          <span>© {new Date().getFullYear()} Mochi Manners</span>
          <nav className="footer-nav" aria-label="Footer">
            <Link to="/gallery">Gallery</Link>
            <a href={`mailto:${site.email}`}>{site.email}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export default function Layout() {
  return (
    <ActiveSectionProvider>
      <LayoutInner />
    </ActiveSectionProvider>
  );
}

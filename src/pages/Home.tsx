import { useEffect } from "react";
import logoGradient from "../assets/logo-gradient.png";
import mochiPhoto from "../assets/mochi.jpg";
import { useActiveSection } from "../context/ActiveSectionContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { site } from "../site";

const homeSections = ["services", "about", "contact"] as const;

const services = [
  {
    title: "Dog Training",
    description:
      "Positive-reinforcement training tailored to your dog's personality — from basic manners to behavior modification.",
  },
  {
    title: "Dog Walking",
    description:
      "Reliable daily walks with attention to leash manners, socialization, and plenty of sniff time along the way.",
  },
  {
    title: "Pet Sitting",
    description:
      "In-home care while you're away — feeding, playtime, and updates so you can travel with peace of mind.",
  },
];

const aboutPoints = [
  "Experienced handlers who love what they do",
  "Force-free, reward-based methods only",
  "Flexible scheduling for busy pet parents",
  "Regular photo and progress updates",
];

export default function Home() {
  const { setActiveSection } = useActiveSection();

  usePageMeta({
    title: site.defaultTitle,
    description: site.defaultDescription,
    path: "/",
  });

  useEffect(() => {
    const elements = homeSections
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.15, 0.4] },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [setActiveSection]);

  return (
    <main id="main-content">
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="hero-tag">Dog care you can trust</span>
            <h1>
              Happy dogs,
              <br />
              good <span className="gradient-text">manners.</span>
            </h1>
            <p className="hero-lead">
              Mochi Manners helps your pup become their best self through patient
              training, attentive walks, and loving in-home care.
            </p>
            <div className="hero-actions">
              <a href="#contact" className="btn btn-primary">
                Get in touch
              </a>
              <a href="#services" className="btn btn-secondary">
                Our services
              </a>
            </div>
          </div>
          <div className="hero-visual">
            <img
              className="hero-logo"
              src={logoGradient}
              alt="Mochi Manners logo"
              width={480}
              height={480}
              fetchPriority="high"
            />
          </div>
        </div>
      </section>

      <section id="services" className="section section-lavender">
        <div className="container">
          <div className="section-header">
            <h2>What we offer</h2>
            <p>
              Whether you need help with a new puppy or a reliable sitter for your
              next trip, we&apos;ve got you covered.
            </p>
          </div>
          <div className="services-grid">
            {services.map((service, i) => (
              <article key={service.title} className="service-card">
                <span className="service-number" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{service.title}</h3>
                <p>{service.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="section section-blush">
        <div className="container about-grid">
          <div>
            <h2>About Mochi Manners</h2>
            <p>
              We believe every dog deserves patience, consistency, and a little joy
              in every session. Based in Durham, we work with families throughout
              the RDU area — with an approach that&apos;s gentle and approachable,
              and structure underneath.
            </p>
            <ul className="about-points">
              {aboutPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
          <aside className="about-aside">
            <blockquote>
              &ldquo;A well-mannered dog isn&apos;t just trained — they&apos;re
              understood.&rdquo;
            </blockquote>
            <cite>— The Mochi Manners philosophy</cite>
          </aside>
        </div>
      </section>

      <section className="section section-cream mochi-section">
        <div className="container mochi-grid">
          <figure className="mochi-photo-wrap">
            <img
              className="mochi-photo"
              src={mochiPhoto}
              alt="Mochi, a white Samoyed, sitting and smiling at the camera"
              width={600}
              height={800}
            />
          </figure>
          <div className="mochi-content">
            <h2>Meet Mochi</h2>
            <p>
              Mochi Manners began with one very good girl. Mochi is a Samoyed with
              a smile that wins over everyone she meets — and a gentle reminder that
              the best training is patient, positive, and full of joy.
            </p>
            <p>
              She&apos;s why our name means something: care that&apos;s soft and
              approachable, with good manners built in over time. Everything we do
              is inspired by the standard she set.
            </p>
          </div>
        </div>
      </section>

      <section id="contact" className="section section-mint">
        <div className="container">
          <div className="contact-box">
            <h2>Ready to get started?</h2>
            <p>
              Tell us about your dog and what you&apos;re looking for. We&apos;ll get
              back to you within one business day.
            </p>
            <p className="contact-area">Serving {site.serviceArea}.</p>
            <a href={`mailto:${site.email}`} className="contact-email">
              {site.email}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

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
      "You live with your dog. We don't. We teach you what to do when we're not there — because that's most of the time.",
  },
  {
    title: "Home Visits",
    description:
      "When you can't be there — at work, out of town, or just stretched thin — we fill the gap with walks and in-home care, keeping your dog exercised, settled, and on track.",
  },
];

const aboutPoints = [
  "Sessions that leave you knowing what to do — not just what we practiced together",
  "An approach picked for your dog — not a one-size-fits-all method",
  "Updates when we're caring for your dog — so you're always in the loop",
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
            <h1>
              <span className="gradient-text">Manners</span> matter
            </h1>
            <p className="hero-lead">
              Mochi Manners helps your dog become part of your life — not just your house.
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
              Whether you&apos;re starting from scratch or just need some help along the way,
              we&apos;ve got you covered.
            </p>
          </div>
          <div className="services-grid">
            {services.map((service) => (
              <article key={service.title} className="service-card">
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
              Mochi Manners trains you, not your dog. When a guest walks in or you&apos;re heading
              out the door, we won&apos;t be there — you will. We use what your dog responds to, not
              one method or trend — so they can come with you, not just behave on session days.
            </p>
            <ul className="about-points">
              {aboutPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
          <aside className="about-aside">
            <blockquote>&ldquo;The scarf is merely a training tool.&rdquo;</blockquote>
            <cite>— Queen Clarisse, The Princess Diaries</cite>
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
              Mochi Manners began with one very good girl — a Samoyed we call our princess, and mean
              it. She has the smile and the white coat, but what actually matters is how she
              behaves: calm, composed, and easy to have around no matter where we are.
            </p>
            <p>
              We named the business after her because she proves the point. Princess manners
              aren&apos;t performative — they&apos;re practical. They&apos;re why she gets to travel
              with us, and they&apos;re what we help other dogs build toward.
            </p>
          </div>
        </div>
      </section>

      <section id="contact" className="section section-mint">
        <div className="container">
          <div className="contact-box">
            <h2>Ready to get started?</h2>
            <p>
              Tell us about your dog and what you&apos;re looking for — we&apos;ll be in
              touch soon.
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

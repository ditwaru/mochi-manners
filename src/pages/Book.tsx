import { usePageMeta } from "../hooks/usePageMeta";
import { useScrollToTop } from "../hooks/useScrollToTop";
import { site } from "../site";

const bookingOptions = [
  {
    title: "Dog Training",
    description:
      "One-on-one coaching for practical manners, clearer communication, and confidence.",
    action: "View training profile",
    href: site.roverTrainingUrl,
  },
  {
    title: "Drop-In Visits",
    description:
      "Care, exercise, and photo updates in your home while you are at work, away, or simply need a hand.",
    action: "View drop-in profile",
    href: site.roverHomeVisitsUrl,
  },
] as const;

const profileHighlights = [
  "Training for puppies and adult dogs",
  "Private training sessions typically held in your home",
  "Enhanced background check displayed on Rover",
] as const;

export default function Book() {
  useScrollToTop();

  usePageMeta({
    title: "Book | Mochi Manners",
    description:
      "View current availability and book dog training or drop-in visits with Mochi Manners through Rover.",
    path: "/book",
  });

  return (
    <main id="main-content" className="book-page">
      <div className="container book-layout">
        <section className="book-intro" aria-labelledby="book-title">
          <p className="book-eyebrow">Book through Rover</p>
          <h1 id="book-title">
            Ready to build <span className="book-title-accent">better manners?</span>
          </h1>
        </section>

        <section className="book-card" aria-labelledby="book-card-title">
          <div className="book-card-header">
            <p className="book-card-kicker">Mochi Manners on Rover</p>
            <h2 id="book-card-title">Book with Daniel I.</h2>
            <p>
              Choose a service to see current pricing, availability, and booking details on Rover.
            </p>
          </div>

          <div className="book-service-list">
            {bookingOptions.map((option) => (
              <a
                key={option.title}
                className="book-service-option"
                href={option.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${option.action} on Rover (opens in a new tab)`}
              >
                <span className="book-service-title">{option.title}</span>
                <span className="book-service-description">{option.description}</span>
                <span className="book-service-action">
                  {option.action} <span aria-hidden="true">↗</span>
                </span>
              </a>
            ))}
          </div>

          <div className="book-rover-note">
            <span aria-hidden="true">✓</span>
            <p>Booking, payment, scheduling, and messages are completed through Rover.</p>
          </div>

          <p className="book-question">
            Not sure which service fits? <a href={`mailto:${site.email}`}>Ask a question</a>.
          </p>
        </section>

        <div className="book-profile">
          <ul className="book-highlights">
            {profileHighlights.map((highlight) => (
              <li key={highlight}>
                <span className="book-highlight-check" aria-hidden="true">
                  ✓
                </span>
                <span>{highlight}</span>
              </li>
            ))}
          </ul>

          <p className="book-area">
            Based in Durham, NC. Rover will confirm availability for your address.
          </p>
        </div>
      </div>
    </main>
  );
}

import { useEffect } from "react";
import { site } from "../site";

type PageMeta = {
  title: string;
  description?: string;
  path?: string;
  noindex?: boolean;
  canonical?: string | false;
};

function setMeta(attr: "name" | "property", key: string, content: string) {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function removeMeta(attr: "name" | "property", key: string) {
  document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)?.remove();
}

function setCanonical(href: string) {
  let el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

function removeCanonical() {
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.remove();
}

export function usePageMeta({ title, description, path, noindex, canonical }: PageMeta) {
  useEffect(() => {
    const desc = description ?? site.defaultDescription;
    const url = noindex
      ? `${site.url}${window.location.pathname}`
      : path
        ? `${site.url}${path}`
        : site.url;

    document.title = title;
    setMeta("name", "description", desc);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", desc);
    setMeta("property", "og:url", url);
    setMeta("property", "og:image", site.ogImage);
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", desc);
    setMeta("name", "twitter:image", site.ogImage);

    if (noindex) {
      setMeta("name", "robots", "noindex, nofollow");
    } else {
      removeMeta("name", "robots");
    }

    if (canonical === false) {
      removeCanonical();
    } else {
      setCanonical(typeof canonical === "string" ? canonical : url);
    }
  }, [title, description, path, noindex, canonical]);
}

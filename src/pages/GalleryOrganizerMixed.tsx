import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import "./GalleryOrganizer.css";

type OrganizerImage = {
  id: string;
  type: "image";
  src: string;
  variants: Array<{ src: string; width: number }>;
  width: number;
  height: number;
  alt: string;
  caption: string;
  pending: boolean;
};

type OrganizerVideo = {
  id: string;
  type: "youtube";
  videoId: string;
  title: string;
  caption: string;
  orientation: "landscape" | "portrait";
};

type OrganizerItem = OrganizerImage | OrganizerVideo;

type OrganizerResponse = {
  items: OrganizerItem[];
  revision: string;
  storageConfigured: boolean;
};

type SaveResponse = { revision: string };

type OrphanAudit = {
  count: number;
  totalBytes: number;
  pathnames: string[];
};

type RemovedItem = {
  item: OrganizerItem;
  index: number;
  beforeId?: string;
  afterId?: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";
type CleanupState = "idle" | "checking" | "deleting" | "success" | "error";
type EditableField = "alt" | "caption" | "title";
type SaveFlash = { state: "pending" | "saved"; signature: string };
type VideoDraft = {
  url: string;
  title: string;
  caption: string;
  orientation: "landscape" | "portrait";
};

const ORGANIZER_ENDPOINT = "/__gallery-organizer";
const IMAGE_UPLOAD_ENDPOINT = `${ORGANIZER_ENDPOINT}/images`;
const PENDING_IMAGES_ENDPOINT = `${ORGANIZER_ENDPOINT}/pending`;
const ORPHANS_ENDPOINT = `${ORGANIZER_ENDPOINT}/orphans`;
const SAVED_FLASH_KEY = "mochi-gallery-organizer-saved";
const MAX_FILES_PER_SELECTION = 12;
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const EMPTY_VIDEO_DRAFT: VideoDraft = {
  url: "",
  title: "",
  caption: "",
  orientation: "landscape",
};

function itemSignature(items: OrganizerItem[]) {
  return JSON.stringify(
    items.map((item) =>
      item.type === "image"
        ? { id: item.id, type: item.type, alt: item.alt, caption: item.caption }
        : {
            id: item.id,
            type: item.type,
            videoId: item.videoId,
            title: item.title,
            caption: item.caption,
            orientation: item.orientation,
          },
    ),
  );
}

function imageSrcSet(image: OrganizerImage) {
  return image.variants.map((variant) => `${variant.src} ${variant.width}w`).join(", ");
}

function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function itemLabel(item: OrganizerItem) {
  return item.type === "image" ? item.caption || item.id : item.title || item.id;
}

function storeSaveFlash(flash: SaveFlash) {
  try {
    sessionStorage.setItem(SAVED_FLASH_KEY, JSON.stringify(flash));
  } catch {
    // Saving still works if browser storage is unavailable.
  }
}

function takeSaveFlash(): SaveFlash | null {
  try {
    const value = sessionStorage.getItem(SAVED_FLASH_KEY);
    sessionStorage.removeItem(SAVED_FLASH_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<SaveFlash>;
    if (
      (parsed.state === "pending" || parsed.state === "saved") &&
      typeof parsed.signature === "string"
    ) {
      return parsed as SaveFlash;
    }
  } catch {
    // Ignore stale or unavailable browser storage.
  }
  return null;
}

function clearSaveFlash() {
  try {
    sessionStorage.removeItem(SAVED_FLASH_KEY);
  } catch {
    // Nothing else needs to happen.
  }
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Fall through to the friendly default.
  }
  return "The gallery organizer could not complete that action.";
}

function restoreRemovedItem(currentItems: OrganizerItem[], removed: RemovedItem) {
  const nextItems = [...currentItems];
  const beforeIndex = removed.beforeId
    ? nextItems.findIndex(({ id }) => id === removed.beforeId)
    : -1;
  const afterIndex = removed.afterId
    ? nextItems.findIndex(({ id }) => id === removed.afterId)
    : -1;
  const insertAt =
    beforeIndex >= 0
      ? beforeIndex + 1
      : afterIndex >= 0
        ? afterIndex
        : Math.min(removed.index, nextItems.length);
  nextItems.splice(insertAt, 0, removed.item);
  return nextItems;
}

function parseYouTubeInput(input: string) {
  const value = input.trim();
  if (YOUTUBE_ID_PATTERN.test(value)) {
    return { videoId: value, isShort: false };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a valid YouTube video link.");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Paste a secure YouTube video link.");
  }

  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;
  let isShort = false;

  if (hostname === "youtu.be") {
    if (segments.length === 1) videoId = segments[0];
  } else if (
    hostname === "youtube.com" ||
    hostname === "www.youtube.com" ||
    hostname === "m.youtube.com"
  ) {
    if (url.pathname === "/watch" && url.searchParams.getAll("v").length === 1) {
      videoId = url.searchParams.get("v");
    } else if (
      segments.length === 2 &&
      ["shorts", "embed", "live"].includes(segments[0])
    ) {
      videoId = segments[1];
      isShort = segments[0] === "shorts";
    }
  } else if (
    hostname === "youtube-nocookie.com" ||
    hostname === "www.youtube-nocookie.com"
  ) {
    if (segments.length === 2 && segments[0] === "embed") videoId = segments[1];
  }

  if (!videoId || !YOUTUBE_ID_PATTERN.test(videoId)) {
    if (url.pathname.includes("playlist") || url.searchParams.has("list")) {
      throw new Error("That link is a playlist, not a video.");
    }
    throw new Error("Paste a YouTube video link, not a channel or profile link.");
  }

  return { videoId, isShort };
}

function uniqueVideoItemId(videoId: string, occupiedIds: Set<string>) {
  const normalized = videoId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const base = `youtube-${normalized || "video"}`;
  if (!occupiedIds.has(base)) return base;
  let suffix = 2;
  while (occupiedIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export default function GalleryOrganizer() {
  const [items, setItems] = useState<OrganizerItem[]>([]);
  const [savedItems, setSavedItems] = useState<OrganizerItem[]>([]);
  const [revision, setRevision] = useState("");
  const [storageConfigured, setStorageConfigured] = useState(false);
  const [removedItems, setRemovedItems] = useState<RemovedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<{
    id: string;
    field: EditableField;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [orphanAudit, setOrphanAudit] = useState<OrphanAudit | null>(null);
  const [cleanupState, setCleanupState] = useState<CleanupState>("idle");
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [deploymentConfirmed, setDeploymentConfirmed] = useState(false);
  const [videoDraft, setVideoDraft] = useState<VideoDraft>(EMPTY_VIDEO_DRAFT);
  const [videoFormError, setVideoFormError] = useState("");
  const [videoFormErrorField, setVideoFormErrorField] = useState<
    "url" | "title" | "caption" | null
  >(null);
  const [orientationTouched, setOrientationTouched] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addPicturesButtonRef = useRef<HTMLButtonElement>(null);
  const addVideoButtonRef = useRef<HTMLButtonElement>(null);
  const videoDialogRef = useRef<HTMLDialogElement>(null);
  const videoUrlInputRef = useRef<HTMLInputElement>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterDialogCloseRef = useRef<string | null>(null);

  const isDirty = useMemo(
    () => itemSignature(items) !== itemSignature(savedItems),
    [items, savedItems],
  );
  const isBusy =
    saveState === "saving" ||
    isUploading ||
    removingId !== null ||
    cleanupState === "checking" ||
    cleanupState === "deleting";
  const savedIds = useMemo(() => new Set(savedItems.map(({ id }) => id)), [savedItems]);
  const photoCount = items.filter((item) => item.type === "image").length;
  const videoCount = items.length - photoCount;
  const parsedDraftVideo = useMemo(() => {
    if (!videoDraft.url.trim()) return null;
    try {
      return parseYouTubeInput(videoDraft.url);
    } catch {
      return null;
    }
  }, [videoDraft.url]);

  useEffect(() => {
    document.title = "Gallery organizer | Mochi Manners";
    const controller = new AbortController();

    void fetch(ORGANIZER_ENDPOINT, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<OrganizerResponse>;
      })
      .then((data) => {
        setItems(data.items);
        setSavedItems(
          data.items.filter((item) => item.type === "youtube" || !item.pending),
        );
        setRevision(data.revision);
        setStorageConfigured(data.storageConfigured);
        setIsLoading(false);

        const saveFlash = takeSaveFlash();
        if (
          saveFlash?.state === "saved" &&
          saveFlash.signature === itemSignature(data.items)
        ) {
          setSaveState("saved");
          setSaveMessage("Changes saved to the project.");
        } else if (saveFlash?.state === "pending") {
          setSaveState("error");
          setSaveMessage("The previous save did not finish. Review your changes and save again.");
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "The organizer could not load.");
        setIsLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!isDirty && !isUploading) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isDirty, isUploading]);

  const clearActionMessages = () => {
    setSaveState((current) => (current === "saving" ? current : "idle"));
    setSaveMessage("");
    setOrphanAudit(null);
    setCleanupState((current) =>
      current === "checking" || current === "deleting" ? current : "idle",
    );
    setCleanupMessage("");
    setDeploymentConfirmed(false);
  };

  const focusItemField = (id: string, field?: EditableField) => {
    requestAnimationFrame(() => {
      const item = items.find((candidate) => candidate.id === id);
      const preferredField = field ?? (item?.type === "youtube" ? "title" : "caption");
      const element = document.getElementById(`${preferredField}-${id}`);
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
      if (preferredField === "alt") element.closest("details")?.setAttribute("open", "");
      element.focus();
      element.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
  };

  const updateImage = (
    id: string,
    changes: Partial<Pick<OrganizerImage, "alt" | "caption">>,
  ) => {
    if (isBusy) return;
    setItems((current) =>
      current.map((item) =>
        item.id === id && item.type === "image" ? { ...item, ...changes } : item,
      ),
    );
    clearActionMessages();
    if (invalidField?.id === id && invalidField.field in changes) setInvalidField(null);
  };

  const updateVideo = (
    id: string,
    changes: Partial<Pick<OrganizerVideo, "title" | "caption" | "orientation">>,
  ) => {
    if (isBusy) return;
    setItems((current) =>
      current.map((item) =>
        item.id === id && item.type === "youtube" ? { ...item, ...changes } : item,
      ),
    );
    clearActionMessages();
    if (invalidField?.id === id && invalidField.field in changes) setInvalidField(null);
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (isBusy || fromIndex === toIndex || toIndex < 0 || toIndex >= items.length) return;
    const movedItem = items[fromIndex];
    setItems((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    clearActionMessages();
    setAnnouncement(`Moved ${itemLabel(movedItem)} to position ${toIndex + 1} of ${items.length}.`);
  };

  const handleDragStart = (event: DragEvent<HTMLSpanElement>, itemId: string) => {
    if (isBusy) {
      event.preventDefault();
      return;
    }
    setDraggingId(itemId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", itemId);
  };

  const handleDrop = (event: DragEvent<HTMLLIElement>, targetId: string) => {
    event.preventDefault();
    if (isBusy) return;
    const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (!sourceId || sourceId === targetId) return;
    const fromIndex = items.findIndex((item) => item.id === sourceId);
    const toIndex = items.findIndex((item) => item.id === targetId);
    if (fromIndex >= 0 && toIndex >= 0) moveItem(fromIndex, toIndex);
  };

  const removeItem = async (item: OrganizerItem, index: number) => {
    if (isBusy) return;
    setRemovingId(item.id);
    const focusItem = items[index + 1] ?? items[index - 1];
    const isUnsavedVideo = item.type === "youtube" && !savedIds.has(item.id);

    try {
      if (item.type === "image" && item.pending) {
        const response = await fetch(
          `${PENDING_IMAGES_ENDPOINT}/${encodeURIComponent(item.id)}`,
          { method: "DELETE", headers: { "X-Gallery-Organizer": "local" } },
        );
        if (!response.ok) throw new Error(await responseError(response));
        setItems((current) => current.filter(({ id }) => id !== item.id));
        setAnnouncement(`Removed the new photo ${itemLabel(item)}.`);
        if (focusItem) focusItemField(focusItem.id);
        else requestAnimationFrame(() => addPicturesButtonRef.current?.focus());
      } else if (isUnsavedVideo) {
        setItems((current) => current.filter(({ id }) => id !== item.id));
        setAnnouncement(`Removed the new video ${itemLabel(item)}.`);
        if (focusItem) focusItemField(focusItem.id);
        else requestAnimationFrame(() => addVideoButtonRef.current?.focus());
      } else {
        const removed: RemovedItem = {
          item,
          index,
          beforeId: items[index - 1]?.id,
          afterId: items[index + 1]?.id,
        };
        setItems((current) => current.filter(({ id }) => id !== item.id));
        setRemovedItems((current) => [...current, removed]);
        setAnnouncement(`${itemLabel(item)} will be removed when you save.`);
        requestAnimationFrame(() => undoButtonRef.current?.focus());
      }
      clearActionMessages();
    } catch (error: unknown) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "That item could not be removed.");
    } finally {
      setRemovingId(null);
    }
  };

  const undoLastRemoval = () => {
    if (isBusy) return;
    const removed = removedItems.at(-1);
    if (!removed) return;
    setItems((current) => restoreRemovedItem(current, removed));
    setRemovedItems((current) => current.slice(0, -1));
    clearActionMessages();
    setAnnouncement(`Restored ${itemLabel(removed.item)}.`);
    focusItemField(
      removed.item.id,
      removed.item.type === "youtube" ? "title" : "caption",
    );
  };

  const restoreAllRemoved = () => {
    if (isBusy) return;
    const firstRestored = removedItems[0];
    setItems((current) =>
      [...removedItems].reverse().reduce(restoreRemovedItem, current),
    );
    setRemovedItems([]);
    clearActionMessages();
    setAnnouncement("Restored all removed gallery items.");
    if (firstRestored) {
      focusItemField(
        firstRestored.item.id,
        firstRestored.item.type === "youtube" ? "title" : "caption",
      );
    }
  };

  const discardChanges = async () => {
    if (!window.confirm("Discard all unsaved gallery changes?")) return;
    const pendingImageIds = items
      .filter((item): item is OrganizerImage => item.type === "image" && item.pending)
      .map(({ id }) => id);
    const hasPendingImages = pendingImageIds.length > 0;
    try {
      if (hasPendingImages) {
        const response = await fetch(PENDING_IMAGES_ENDPOINT, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "X-Gallery-Organizer": "local",
          },
          body: JSON.stringify({ ids: pendingImageIds }),
        });
        if (!response.ok) throw new Error(await responseError(response));
      }
      setItems(savedItems);
      setRemovedItems([]);
      setSaveState("idle");
      setSaveMessage("");
      setInvalidField(null);
      setUploadMessage("");
      setOrphanAudit(null);
      setCleanupState("idle");
      setCleanupMessage("");
      setDeploymentConfirmed(false);
      setAnnouncement("Unsaved gallery changes were discarded.");
    } catch (error: unknown) {
      setSaveState("error");
      setSaveMessage(
        error instanceof Error ? error.message : "Unsaved changes could not be discarded.",
      );
    }
  };

  const saveChanges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isDirty || isBusy) return;

    const normalizedItems = items.map((item) =>
      item.type === "image"
        ? { ...item, alt: item.alt.trim(), caption: item.caption.trim() }
        : { ...item, title: item.title.trim(), caption: item.caption.trim() },
    );

    const invalidItem = normalizedItems.find((item) =>
      item.type === "image"
        ? item.caption.length < 3 ||
          item.caption.length > 500 ||
          item.alt.length < 10 ||
          item.alt.length > 500
        : item.title.length < 3 ||
          item.title.length > 120 ||
          item.caption.length < 3 ||
          item.caption.length > 500,
    );

    if (invalidItem) {
      const field: EditableField =
        invalidItem.type === "image"
          ? invalidItem.caption.length < 3 || invalidItem.caption.length > 500
            ? "caption"
            : "alt"
          : invalidItem.title.length < 3 || invalidItem.title.length > 120
            ? "title"
            : "caption";
      setInvalidField({ id: invalidItem.id, field });
      setSaveState("error");
      setSaveMessage(
        field === "alt"
          ? "Image descriptions must be between 10 and 500 characters."
          : field === "title"
            ? "Video titles must be between 3 and 120 characters."
            : "Captions must be between 3 and 500 characters.",
      );
      focusItemField(invalidItem.id, field);
      return;
    }

    const payloadItems = normalizedItems.map((item) =>
      item.type === "image"
        ? { id: item.id, type: item.type, alt: item.alt, caption: item.caption }
        : {
            id: item.id,
            type: item.type,
            videoId: item.videoId,
            title: item.title,
            caption: item.caption,
            orientation: item.orientation,
          },
    );
    const submittedSignature = itemSignature(normalizedItems);
    setSaveState("saving");
    setSaveMessage("Saving changes…");
    storeSaveFlash({ state: "pending", signature: submittedSignature });

    try {
      const response = await fetch(ORGANIZER_ENDPOINT, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Gallery-Organizer": "local",
        },
        body: JSON.stringify({ revision, items: payloadItems }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = (await response.json()) as SaveResponse;
      const persistedItems = normalizedItems.map((item) =>
        item.type === "image" ? { ...item, pending: false } : item,
      );
      storeSaveFlash({ state: "saved", signature: submittedSignature });
      setRevision(data.revision);
      setItems(persistedItems);
      setSavedItems(persistedItems);
      setRemovedItems([]);
      setSaveState("saved");
      setSaveMessage("Changes saved to the project.");
      setInvalidField(null);
      setUploadMessage("");
      setOrphanAudit(null);
      setCleanupState("idle");
      setCleanupMessage("");
      setDeploymentConfirmed(false);
      setAnnouncement("Gallery order, photos, videos, and captions saved.");
    } catch (error: unknown) {
      clearSaveFlash();
      setSaveState("error");
      setSaveMessage(
        error instanceof Error ? error.message : "The gallery organizer could not save your changes.",
      );
    }
  };

  const addPictures = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0 || isBusy) return;
    if (files.length > MAX_FILES_PER_SELECTION) {
      setUploadMessage(`Choose no more than ${MAX_FILES_PER_SELECTION} photos at a time.`);
      return;
    }

    setIsUploading(true);
    setUploadMessage(`Adding ${files.length} ${files.length === 1 ? "photo" : "photos"}…`);
    clearActionMessages();
    let firstAddedId: string | null = null;
    let addedCount = 0;

    try {
      for (const [index, file] of files.entries()) {
        setUploadMessage(`Optimizing photo ${index + 1} of ${files.length}: ${file.name}`);
        const response = await fetch(IMAGE_UPLOAD_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Gallery-Organizer": "local",
            "X-Gallery-Filename": encodeURIComponent(file.name),
          },
          body: file,
        });
        if (!response.ok) throw new Error(`${file.name}: ${await responseError(response)}`);
        const data = (await response.json()) as { image: OrganizerImage };
        firstAddedId ??= data.image.id;
        addedCount += 1;
        setItems((current) => [...current, data.image]);
      }
      setUploadMessage(
        `${addedCount} ${addedCount === 1 ? "photo is" : "photos are"} ready. Add captions, then save changes.`,
      );
      setAnnouncement(
        `${addedCount} ${addedCount === 1 ? "photo" : "photos"} added to the end of the gallery.`,
      );
      if (firstAddedId) focusItemField(firstAddedId, "caption");
    } catch (error: unknown) {
      setUploadMessage(error instanceof Error ? error.message : "Those photos could not be added.");
      setSaveState("error");
      setSaveMessage("Any photos added successfully are still waiting for captions and a save.");
      if (firstAddedId) focusItemField(firstAddedId, "caption");
    } finally {
      setIsUploading(false);
    }
  };

  const openVideoDialog = () => {
    if (isBusy) return;
    setVideoDraft(EMPTY_VIDEO_DRAFT);
    setVideoFormError("");
    setVideoFormErrorField(null);
    setOrientationTouched(false);
    focusAfterDialogCloseRef.current = null;
    videoDialogRef.current?.showModal();
    requestAnimationFrame(() => videoUrlInputRef.current?.focus());
  };

  const closeVideoDialog = () => videoDialogRef.current?.close();

  const addVideo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) return;
    let parsed: ReturnType<typeof parseYouTubeInput>;
    try {
      parsed = parseYouTubeInput(videoDraft.url);
    } catch (error) {
      setVideoFormError(error instanceof Error ? error.message : "Paste a YouTube video link.");
      setVideoFormErrorField("url");
      videoUrlInputRef.current?.focus();
      return;
    }

    const title = videoDraft.title.trim();
    const caption = videoDraft.caption.trim();
    const knownVideos = [
      ...items.filter((item): item is OrganizerVideo => item.type === "youtube"),
      ...removedItems
        .map(({ item }) => item)
        .filter((item): item is OrganizerVideo => item.type === "youtube"),
    ];
    if (knownVideos.some((item) => item.videoId === parsed.videoId)) {
      setVideoFormError("That video is already in your gallery.");
      setVideoFormErrorField("url");
      videoUrlInputRef.current?.focus();
      return;
    }
    if (title.length < 3 || title.length > 120) {
      setVideoFormError("Video titles must be between 3 and 120 characters.");
      setVideoFormErrorField("title");
      document.getElementById("new-video-title")?.focus();
      return;
    }
    if (caption.length < 3 || caption.length > 500) {
      setVideoFormError("Captions must be between 3 and 500 characters.");
      setVideoFormErrorField("caption");
      document.getElementById("new-video-caption")?.focus();
      return;
    }

    const id = uniqueVideoItemId(
      parsed.videoId,
      new Set([
        ...items.map((item) => item.id),
        ...removedItems.map(({ item }) => item.id),
      ]),
    );
    const video: OrganizerVideo = {
      id,
      type: "youtube",
      videoId: parsed.videoId,
      title,
      caption,
      orientation: videoDraft.orientation,
    };
    setItems((current) => [...current, video]);
    clearActionMessages();
    setAnnouncement(`${title} added to the end of the gallery.`);
    focusAfterDialogCloseRef.current = id;
    closeVideoDialog();
  };

  const checkForUnusedFiles = async () => {
    if (isDirty || isBusy) return;
    setCleanupState("checking");
    setCleanupMessage("Checking Vercel storage…");
    setDeploymentConfirmed(false);
    try {
      const response = await fetch(ORPHANS_ENDPOINT, {
        cache: "no-store",
        headers: { "X-Gallery-Organizer": "local" },
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = (await response.json()) as OrphanAudit;
      setOrphanAudit(data);
      setCleanupState("success");
      setCleanupMessage(
        data.count === 0
          ? "No unused gallery files were found."
          : `Found ${data.count} unused optimized ${data.count === 1 ? "file" : "files"} (${formatBytes(data.totalBytes)}).`,
      );
    } catch (error: unknown) {
      setOrphanAudit(null);
      setCleanupState("error");
      setCleanupMessage(error instanceof Error ? error.message : "Vercel storage could not be checked.");
    }
  };

  const deleteUnusedFiles = async () => {
    if (!orphanAudit || orphanAudit.count === 0 || !deploymentConfirmed || isDirty || isBusy) return;
    if (
      !window.confirm(
        `Permanently delete ${orphanAudit.count} unused optimized ${orphanAudit.count === 1 ? "file" : "files"} (${formatBytes(orphanAudit.totalBytes)}) from Vercel? This cannot be undone.`,
      )
    ) return;

    setCleanupState("deleting");
    setCleanupMessage("Deleting unused files…");
    try {
      const response = await fetch(ORPHANS_ENDPOINT, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-Gallery-Organizer": "local",
        },
        body: JSON.stringify({
          confirm: true,
          deploymentConfirmed: true,
          pathnames: orphanAudit.pathnames,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const deleted = (await response.json()) as OrphanAudit;
      setOrphanAudit({ count: 0, totalBytes: 0, pathnames: [] });
      setDeploymentConfirmed(false);
      setCleanupState("success");
      const message = `Deleted ${deleted.count} unused ${deleted.count === 1 ? "file" : "files"} from Vercel storage.`;
      setCleanupMessage(message);
      setAnnouncement(message);
    } catch (error: unknown) {
      setCleanupState("error");
      setCleanupMessage(error instanceof Error ? error.message : "Unused files could not be deleted.");
    }
  };

  if (isLoading) {
    return (
      <main id="main-content" className="gallery-organizer-page gallery-organizer-centered">
        <p>Loading your gallery…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main id="main-content" className="gallery-organizer-page gallery-organizer-centered">
        <div className="gallery-organizer-error" role="alert">
          <h1>The organizer could not load</h1>
          <p>{loadError}</p>
          <a href="/gallery">Return to the gallery</a>
        </div>
      </main>
    );
  }

  const removedPhotoCount = removedItems.filter(({ item }) => item.type === "image").length;

  return (
    <main id="main-content" className="gallery-organizer-page">
      <header className="gallery-organizer-hero">
        <div className="gallery-organizer-shell">
          <p className="gallery-organizer-kicker">Local gallery tool</p>
          <h1>Arrange gallery items and polish captions.</h1>
          <p>
            Add pictures or YouTube videos, remove anything you no longer want, and drag every
            item into place. Nothing changes until you save.
          </p>
          <p className="gallery-organizer-deployment-note">
            Saving updates this project on your computer. Your live site changes after your next
            deployment.
          </p>
        </div>
      </header>

      <form className="gallery-organizer-shell gallery-organizer-form" noValidate onSubmit={saveChanges}>
        <div className="gallery-organizer-toolbar">
          <div>
            <strong>
              {items.length} {items.length === 1 ? "item" : "items"} · {photoCount} {photoCount === 1 ? "photo" : "photos"} · {videoCount} {videoCount === 1 ? "video" : "videos"}
            </strong>
            <span
              className={`gallery-organizer-status gallery-organizer-status-${saveState}`}
              role="status"
              aria-live="polite"
            >
              {saveState === "saving"
                ? saveMessage
                : isUploading
                  ? uploadMessage
                  : isDirty
                    ? "Unsaved changes"
                    : saveMessage || "Everything is up to date"}
            </span>
          </div>

          <div className="gallery-organizer-actions">
            <input
              ref={fileInputRef}
              className="gallery-organizer-file-input"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.avif,.heic,.heif,image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
              multiple
              onChange={addPictures}
            />
            <button
              ref={addPicturesButtonRef}
              type="button"
              className="gallery-organizer-button gallery-organizer-button-add"
              onClick={() => fileInputRef.current?.click()}
              disabled={!storageConfigured || isBusy}
            >
              <span aria-hidden="true">+</span> Add pictures
            </button>
            <button
              ref={addVideoButtonRef}
              type="button"
              className="gallery-organizer-button gallery-organizer-button-video"
              onClick={openVideoDialog}
              disabled={isBusy}
            >
              <span aria-hidden="true">+</span> Add YouTube video
            </button>
            <a href="/gallery" target="_blank" rel="noopener noreferrer">
              Preview saved gallery <span className="sr-only">(opens in a new tab)</span>
            </a>
            <button
              type="button"
              className="gallery-organizer-button gallery-organizer-button-secondary"
              onClick={() => void discardChanges()}
              disabled={!isDirty || isBusy}
            >
              Discard changes
            </button>
            <button
              type="submit"
              className="gallery-organizer-button gallery-organizer-button-primary"
              disabled={!isDirty || isBusy}
            >
              {saveState === "saving" ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        {!storageConfigured && (
          <p className="gallery-organizer-storage-warning" role="note">
            Adding pictures and checking Vercel storage are unavailable until
            BLOB_READ_WRITE_TOKEN is added to your local .env file and the local site is restarted.
            You can still add and arrange YouTube videos.
          </p>
        )}

        {uploadMessage && !isUploading && (
          <p className="gallery-organizer-upload-message" role="status">{uploadMessage}</p>
        )}
        {saveState === "error" && (
          <p className="gallery-organizer-save-error" role="alert">{saveMessage}</p>
        )}

        {removedItems.length > 0 && (
          <div className="gallery-organizer-removed-notice">
            <p>
              <strong>
                {removedItems.length} gallery {removedItems.length === 1 ? "item" : "items"} will be removed when you save.
              </strong>{" "}
              {removedPhotoCount > 0 &&
                "Removed photos stay in Vercel until you use Storage cleanup."}
            </p>
            <div>
              <button ref={undoButtonRef} type="button" onClick={undoLastRemoval} disabled={isBusy}>
                Undo last
              </button>
              <button type="button" onClick={restoreAllRemoved} disabled={isBusy}>
                Restore all
              </button>
            </div>
          </div>
        )}

        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        {items.length === 0 ? (
          <div className="gallery-organizer-empty">
            <h2>Your gallery draft is empty</h2>
            <p>Add pictures or a YouTube video, or discard your changes to restore removed items.</p>
          </div>
        ) : (
          <ol className="gallery-organizer-list" role="list">
            {items.map((item, index) => {
              const isNew = item.type === "image" ? item.pending : !savedIds.has(item.id);
              const label = itemLabel(item);
              return (
                <li
                  key={item.id}
                  className={`gallery-organizer-card${draggingId === item.id ? " is-dragging" : ""}${dropTargetId === item.id ? " is-drop-target" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (isBusy) return;
                    event.dataTransfer.dropEffect = "move";
                    if (draggingId && draggingId !== item.id) setDropTargetId(item.id);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDropTargetId(null);
                    }
                  }}
                  onDrop={(event) => handleDrop(event, item.id)}
                >
                  <div className="gallery-organizer-position" title={`Position ${index + 1}`}>
                    {index + 1}
                  </div>

                  {item.type === "image" ? (
                    <div className="gallery-organizer-thumbnail">
                      <img
                        src={item.src}
                        srcSet={imageSrcSet(item)}
                        sizes="10rem"
                        alt={item.alt}
                        width={item.width}
                        height={item.height}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  ) : (
                    <div className={`gallery-organizer-thumbnail gallery-organizer-video-thumbnail gallery-organizer-video-${item.orientation}`}>
                      <span className="gallery-organizer-media-badge">YouTube video</span>
                      <span className="gallery-organizer-video-play" aria-hidden="true">▶</span>
                      <small>{item.orientation === "portrait" ? "Vertical" : "Wide"}</small>
                    </div>
                  )}

                  <div className="gallery-organizer-fields">
                    {item.type === "image" ? (
                      <>
                        <label htmlFor={`caption-${item.id}`}>Caption</label>
                        <textarea
                          id={`caption-${item.id}`}
                          value={item.caption}
                          rows={2}
                          minLength={3}
                          maxLength={500}
                          required
                          disabled={isBusy}
                          placeholder={item.pending ? "Write a short public caption…" : undefined}
                          aria-invalid={invalidField?.id === item.id && invalidField.field === "caption" ? "true" : undefined}
                          onChange={(event) => updateImage(item.id, { caption: event.target.value })}
                        />
                        <div className="gallery-organizer-field-meta">
                          <span>{item.id}{isNew && <strong className="gallery-organizer-new-badge">New</strong>}</span>
                          <span>{item.caption.length}/500</span>
                        </div>
                        <details className="gallery-organizer-alt-details">
                          <summary>Image description for screen readers</summary>
                          <label className="sr-only" htmlFor={`alt-${item.id}`}>Image description for photo {index + 1}</label>
                          <textarea
                            id={`alt-${item.id}`}
                            value={item.alt}
                            rows={3}
                            minLength={10}
                            maxLength={500}
                            required
                            disabled={isBusy}
                            placeholder="Describe the people, dogs, setting, and action…"
                            aria-invalid={invalidField?.id === item.id && invalidField.field === "alt" ? "true" : undefined}
                            onChange={(event) => updateImage(item.id, { alt: event.target.value })}
                          />
                        </details>
                      </>
                    ) : (
                      <>
                        <label htmlFor={`title-${item.id}`}>Video title</label>
                        <input
                          id={`title-${item.id}`}
                          type="text"
                          value={item.title}
                          minLength={3}
                          maxLength={120}
                          required
                          disabled={isBusy}
                          aria-invalid={invalidField?.id === item.id && invalidField.field === "title" ? "true" : undefined}
                          onChange={(event) => updateVideo(item.id, { title: event.target.value })}
                        />
                        <label htmlFor={`caption-${item.id}`}>Caption</label>
                        <textarea
                          id={`caption-${item.id}`}
                          value={item.caption}
                          rows={2}
                          minLength={3}
                          maxLength={500}
                          required
                          disabled={isBusy}
                          aria-invalid={invalidField?.id === item.id && invalidField.field === "caption" ? "true" : undefined}
                          onChange={(event) => updateVideo(item.id, { caption: event.target.value })}
                        />
                        <fieldset className="gallery-organizer-orientation" disabled={isBusy}>
                          <legend>Video shape</legend>
                          <label>
                            <input
                              type="radio"
                              name={`orientation-${item.id}`}
                              value="landscape"
                              checked={item.orientation === "landscape"}
                              onChange={() => updateVideo(item.id, { orientation: "landscape" })}
                            />
                            <span>Wide</span>
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`orientation-${item.id}`}
                              value="portrait"
                              checked={item.orientation === "portrait"}
                              onChange={() => updateVideo(item.id, { orientation: "portrait" })}
                            />
                            <span>Vertical</span>
                          </label>
                        </fieldset>
                        <div className="gallery-organizer-field-meta">
                          <span>{item.id}{isNew && <strong className="gallery-organizer-new-badge">New</strong>}</span>
                          <a href={`https://www.youtube.com/watch?v=${item.videoId}`} target="_blank" rel="noopener noreferrer">
                            Open video <span className="sr-only">(opens in a new tab)</span>
                          </a>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="gallery-organizer-move-controls" role="group" aria-label={`${item.type === "image" ? "Photo" : "Video"} actions: ${label}`}>
                    <span
                      className="gallery-organizer-drag-handle"
                      draggable={!isBusy}
                      aria-hidden="true"
                      title="Drag to reorder"
                      onDragStart={(event) => handleDragStart(event, item.id)}
                      onDragEnd={() => { setDraggingId(null); setDropTargetId(null); }}
                    >
                      <span aria-hidden="true">⠿</span>
                    </span>
                    <button type="button" onClick={() => moveItem(index, index - 1)} disabled={index === 0 || isBusy} aria-label={`Move ${item.type === "image" ? "photo" : "video"} up: ${label}`}>
                      <span aria-hidden="true">↑</span><span>Up</span>
                    </button>
                    <button type="button" onClick={() => moveItem(index, index + 1)} disabled={index === items.length - 1 || isBusy} aria-label={`Move ${item.type === "image" ? "photo" : "video"} down: ${label}`}>
                      <span aria-hidden="true">↓</span><span>Down</span>
                    </button>
                    <button
                      type="button"
                      className="gallery-organizer-remove-button"
                      onClick={() => void removeItem(item, index)}
                      disabled={isBusy}
                      aria-label={`Remove ${label} from the gallery`}
                    >
                      <span aria-hidden="true">×</span>
                      <span>{removingId === item.id ? "Removing…" : `Remove ${item.type === "youtube" ? "video" : "photo"}`}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="gallery-organizer-bottom-actions">
          <button type="submit" className="gallery-organizer-button gallery-organizer-button-primary" disabled={!isDirty || isBusy}>
            {saveState === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>

        <section className="gallery-organizer-cleanup" aria-labelledby="storage-cleanup-title">
          <div>
            <p className="gallery-organizer-kicker">Optional housekeeping</p>
            <h2 id="storage-cleanup-title">Vercel storage cleanup</h2>
            <p>Removed or replaced photos can leave unused optimized files in Vercel. Checking is read-only and won’t change anything.</p>
          </div>
          {!storageConfigured ? (
            <p className="gallery-organizer-cleanup-note">Storage cleanup needs BLOB_READ_WRITE_TOKEN in your local .env file.</p>
          ) : (
            <>
              <button type="button" className="gallery-organizer-button gallery-organizer-button-secondary" onClick={() => void checkForUnusedFiles()} disabled={isDirty || isBusy}>
                {cleanupState === "checking" ? "Checking…" : "Check for unused files"}
              </button>
              {isDirty && <p className="gallery-organizer-cleanup-note">Save or discard your gallery changes before checking storage.</p>}
              {cleanupMessage && (
                <p className={cleanupState === "error" ? "gallery-organizer-cleanup-error" : "gallery-organizer-cleanup-result"} role={cleanupState === "error" ? "alert" : "status"}>
                  {cleanupMessage}
                </p>
              )}
              {orphanAudit && orphanAudit.count > 0 && (
                <div className="gallery-organizer-cleanup-confirm">
                  <p><strong>Deploy your saved gallery changes before deleting these files.</strong>{" "}The live site may still be using them until that deployment finishes.</p>
                  <label>
                    <input type="checkbox" checked={deploymentConfirmed} onChange={(event) => setDeploymentConfirmed(event.target.checked)} />
                    <span>I’ve deployed these changes and verified the live gallery looks correct.</span>
                  </label>
                  <button type="button" className="gallery-organizer-button gallery-organizer-button-danger" disabled={!deploymentConfirmed || isDirty || cleanupState === "deleting"} onClick={() => void deleteUnusedFiles()}>
                    {cleanupState === "deleting" ? "Deleting…" : "Delete unused files permanently"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </form>

      <dialog
        ref={videoDialogRef}
        className="gallery-organizer-video-dialog"
        aria-labelledby="add-video-title"
        onClose={() => {
          const itemId = focusAfterDialogCloseRef.current;
          focusAfterDialogCloseRef.current = null;
          if (itemId) focusItemField(itemId, "title");
          else requestAnimationFrame(() => addVideoButtonRef.current?.focus());
        }}
      >
        <form className="gallery-organizer-video-form" noValidate onSubmit={addVideo}>
          <div className="gallery-organizer-video-dialog-heading">
            <div>
              <p className="gallery-organizer-kicker">YouTube embed</p>
              <h2 id="add-video-title">Add a YouTube video</h2>
            </div>
            <button type="button" className="gallery-organizer-dialog-close" onClick={closeVideoDialog} aria-label="Close add video dialog">×</button>
          </div>

          {videoFormError && <p id="new-video-error" className="gallery-organizer-save-error" role="alert">{videoFormError}</p>}

          <label htmlFor="new-video-url">YouTube link</label>
          <input
            ref={videoUrlInputRef}
            id="new-video-url"
            type="url"
            value={videoDraft.url}
            required
            placeholder="https://www.youtube.com/watch?v=…"
            aria-invalid={videoFormErrorField === "url" ? "true" : undefined}
            aria-describedby={videoFormErrorField === "url" ? "new-video-error" : undefined}
            onChange={(event) => {
              const url = event.target.value;
              setVideoDraft((current) => {
                let orientation = current.orientation;
                if (!orientationTouched) {
                  try { orientation = parseYouTubeInput(url).isShort ? "portrait" : "landscape"; } catch { /* Keep the current choice while typing. */ }
                }
                return { ...current, url, orientation };
              });
              setVideoFormError("");
              setVideoFormErrorField(null);
            }}
          />
          <small>Paste a youtube.com, youtu.be, or YouTube Shorts link.</small>

          {parsedDraftVideo && (
            <div className={`gallery-organizer-video-preview gallery-organizer-video-${videoDraft.orientation}`}>
              <span className="gallery-organizer-video-play" aria-hidden="true">▶</span>
              <span>Video ready to embed</span>
              <a href={`https://www.youtube.com/watch?v=${parsedDraftVideo.videoId}`} target="_blank" rel="noopener noreferrer">Open on YouTube <span className="sr-only">(opens in a new tab)</span></a>
            </div>
          )}

          <label htmlFor="new-video-title">Video title</label>
          <input id="new-video-title" type="text" value={videoDraft.title} minLength={3} maxLength={120} required aria-invalid={videoFormErrorField === "title" ? "true" : undefined} aria-describedby={videoFormErrorField === "title" ? "new-video-error" : undefined} onChange={(event) => { setVideoDraft((current) => ({ ...current, title: event.target.value })); setVideoFormError(""); setVideoFormErrorField(null); }} />
          <small>Shown above the caption and used to label the player.</small>

          <label htmlFor="new-video-caption">Caption</label>
          <textarea id="new-video-caption" value={videoDraft.caption} rows={3} minLength={3} maxLength={500} required aria-invalid={videoFormErrorField === "caption" ? "true" : undefined} aria-describedby={videoFormErrorField === "caption" ? "new-video-error" : undefined} onChange={(event) => { setVideoDraft((current) => ({ ...current, caption: event.target.value })); setVideoFormError(""); setVideoFormErrorField(null); }} />

          <fieldset className="gallery-organizer-video-shape">
            <legend>Video shape</legend>
            <label>
              <input type="radio" name="new-video-orientation" value="landscape" checked={videoDraft.orientation === "landscape"} onChange={() => { setOrientationTouched(true); setVideoDraft((current) => ({ ...current, orientation: "landscape" })); }} />
              <span><strong>Wide</strong><small>Landscape video</small></span>
            </label>
            <label>
              <input type="radio" name="new-video-orientation" value="portrait" checked={videoDraft.orientation === "portrait"} onChange={() => { setOrientationTouched(true); setVideoDraft((current) => ({ ...current, orientation: "portrait" })); }} />
              <span><strong>Vertical</strong><small>Short or phone video</small></span>
            </label>
          </fieldset>

          <div className="gallery-organizer-video-dialog-actions">
            <button type="button" className="gallery-organizer-button gallery-organizer-button-secondary" onClick={closeVideoDialog}>Cancel</button>
            <button type="submit" className="gallery-organizer-button gallery-organizer-button-primary">Add video</button>
          </div>
        </form>
      </dialog>
    </main>
  );
}

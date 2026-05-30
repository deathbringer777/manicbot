// @vitest-environment happy-dom
/**
 * SalonGalleryUploader — drop-zone + photo grid for the public-profile gallery.
 *
 * Contract pinned:
 *   * Empty state: dropzone visible with title + hint.
 *   * With photos: grid renders all items; first photo carries the "Cover" badge.
 *   * URL escape hatch: hidden by default; toggle reveals input; Enter or "Add"
 *     button calls onChange with the new URL appended.
 *   * URL validation: http(s) prefix required; bad URL surfaces an error and
 *     does NOT mutate state.
 *   * Cap reached: dropzone hides; cap warning shows.
 *   * Remove: drops the clicked index.
 *   * Move left/right: swap with neighbor; disabled at boundaries.
 *   * File pick: mints upload token, uploads file, appends returned URL.
 *   * File pick: cap is honored — if 11 photos exist and 3 files are picked,
 *     only 1 is uploaded (slots = maxPhotos - photos.length).
 */
import { describe, it, expect, afterEach, vi, beforeEach, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { SalonGalleryUploader, GALLERY_MAX_PHOTOS } from "~/components/salon/SalonGalleryUploader";

const mintMutateAsync = vi.fn();
let uploadAssetFileMock: Mock<(uploadUrl: string, file: File) => Promise<{ ok: true; url: string; key: string }>>;
let resizeMock: Mock<(file: File) => Promise<File>>;
let validateMock: Mock<(file: File) => string | null>;

vi.mock("~/trpc/react", () => ({
  api: {
    salon: {
      mintUploadToken: {
        useMutation: () => ({
          mutateAsync: mintMutateAsync,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/lib/uploadAsset", () => ({
  resizeImageClientSide: (file: File) => resizeMock(file),
  uploadAssetFile: (url: string, file: File) => uploadAssetFileMock(url, file),
  validateUploadFile: (file: File) => validateMock(file),
  UPLOAD_ACCEPT_MIME: ["image/png", "image/jpeg", "image/webp"],
}));

function renderUploader(props: Partial<React.ComponentProps<typeof SalonGalleryUploader>> = {}) {
  const onChange = vi.fn();
  const result = render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <SalonGalleryUploader tenantId="t_demo" photos={[]} onChange={onChange} {...props} />
    </LangContext.Provider>,
  );
  return { onChange, ...result };
}

beforeEach(() => {
  uploadAssetFileMock = vi.fn();
  resizeMock = vi.fn((file: File) => Promise.resolve(file));
  validateMock = vi.fn(() => null);
});

afterEach(() => {
  cleanup();
  mintMutateAsync.mockClear();
});

describe("SalonGalleryUploader — empty state", () => {
  it("renders dropzone with empty-state title", () => {
    renderUploader();
    expect(screen.getByTestId("gallery-dropzone")).toBeTruthy();
    expect(screen.getByText(/Перетащите фото/)).toBeTruthy();
  });

  it("URL escape hatch is hidden by default", () => {
    renderUploader();
    expect(screen.queryByPlaceholderText("https://example.com/photo.jpg")).toBeNull();
  });
});

describe("SalonGalleryUploader — with photos", () => {
  it("renders one grid item per photo", () => {
    renderUploader({ photos: ["a.webp", "b.webp", "c.webp"] });
    expect(screen.getAllByTestId("gallery-photo").length).toBe(3);
  });

  it("first photo gets the Cover badge", () => {
    renderUploader({ photos: ["a.webp", "b.webp"] });
    expect(screen.getByText("Обложка")).toBeTruthy();
  });

  it("remove drops the clicked photo", () => {
    const { onChange } = renderUploader({ photos: ["a.webp", "b.webp", "c.webp"] });
    const removeButtons = screen.getAllByRole("button", { name: "Убрать" });
    fireEvent.click(removeButtons[1]!);
    expect(onChange).toHaveBeenCalledWith(["a.webp", "c.webp"]);
  });

  it("move right swaps with the next neighbor", () => {
    const { onChange } = renderUploader({ photos: ["a.webp", "b.webp", "c.webp"] });
    const rightButtons = screen.getAllByRole("button", { name: "Переместить вправо" });
    fireEvent.click(rightButtons[0]!);
    expect(onChange).toHaveBeenCalledWith(["b.webp", "a.webp", "c.webp"]);
  });

  it("move left swaps with the previous neighbor", () => {
    const { onChange } = renderUploader({ photos: ["a.webp", "b.webp", "c.webp"] });
    const leftButtons = screen.getAllByRole("button", { name: "Переместить влево" });
    fireEvent.click(leftButtons[2]!);
    expect(onChange).toHaveBeenCalledWith(["a.webp", "c.webp", "b.webp"]);
  });

  it("move left is disabled at i=0", () => {
    renderUploader({ photos: ["a.webp", "b.webp"] });
    const leftButtons = screen.getAllByRole("button", { name: "Переместить влево" });
    expect((leftButtons[0]! as HTMLButtonElement).disabled).toBe(true);
  });

  it("move right is disabled at the last index", () => {
    renderUploader({ photos: ["a.webp", "b.webp"] });
    const rightButtons = screen.getAllByRole("button", { name: "Переместить вправо" });
    expect((rightButtons[rightButtons.length - 1]! as HTMLButtonElement).disabled).toBe(true);
  });

  it("drag-and-drop reorders: dropping item 0 onto item 2 moves it after", () => {
    const { onChange } = renderUploader({ photos: ["a.webp", "b.webp", "c.webp"] });
    const tiles = screen.getAllByTestId("gallery-photo");
    // Minimal DataTransfer stub: the component sets/reads "text/plain" and
    // assigns effectAllowed/dropEffect.
    const dt = {
      store: {} as Record<string, string>,
      setData(k: string, v: string) { this.store[k] = v; },
      getData(k: string) { return this.store[k] ?? ""; },
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(tiles[0]!, { dataTransfer: dt });
    fireEvent.dragOver(tiles[2]!, { dataTransfer: dt });
    fireEvent.drop(tiles[2]!, { dataTransfer: dt });
    expect(onChange).toHaveBeenCalledWith(["b.webp", "c.webp", "a.webp"]);
  });
});

describe("SalonGalleryUploader — URL escape hatch", () => {
  it("toggle reveals the URL input", () => {
    renderUploader();
    fireEvent.click(screen.getByText("Добавить по ссылке"));
    expect(screen.getByPlaceholderText("https://example.com/photo.jpg")).toBeTruthy();
  });

  it("typing a valid URL and clicking Add appends to onChange", () => {
    const { onChange } = renderUploader({ photos: ["existing.webp"] });
    fireEvent.click(screen.getByText("Добавить по ссылке"));
    const input = screen.getByPlaceholderText("https://example.com/photo.jpg");
    fireEvent.change(input, { target: { value: "https://cdn.x/new.webp" } });
    fireEvent.click(screen.getByText("Добавить"));
    expect(onChange).toHaveBeenCalledWith(["existing.webp", "https://cdn.x/new.webp"]);
  });

  it("invalid URL surfaces an error and does NOT mutate state", () => {
    const { onChange } = renderUploader();
    fireEvent.click(screen.getByText("Добавить по ссылке"));
    const input = screen.getByPlaceholderText("https://example.com/photo.jpg");
    fireEvent.change(input, { target: { value: "ftp://nope" } });
    fireEvent.click(screen.getByText("Добавить"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/http:\/\/ или https:\/\//)).toBeTruthy();
  });

  it("Enter key submits the URL", () => {
    const { onChange } = renderUploader();
    fireEvent.click(screen.getByText("Добавить по ссылке"));
    const input = screen.getByPlaceholderText("https://example.com/photo.jpg");
    fireEvent.change(input, { target: { value: "https://cdn.x/y.webp" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["https://cdn.x/y.webp"]);
  });
});

describe("SalonGalleryUploader — cap", () => {
  it("hides the dropzone and shows the cap warning when at limit", () => {
    const fullSet = Array.from({ length: GALLERY_MAX_PHOTOS }, (_, i) => `https://x/${i}.webp`);
    renderUploader({ photos: fullSet });
    expect(screen.queryByTestId("gallery-dropzone")).toBeNull();
    expect(screen.getByText("Достигнут лимит фотографий")).toBeTruthy();
  });

  it("respects a custom maxPhotos override", () => {
    renderUploader({ photos: ["a", "b"], maxPhotos: 2 });
    expect(screen.queryByTestId("gallery-dropzone")).toBeNull();
  });
});

describe("SalonGalleryUploader — file upload", () => {
  it("file pick mints token, uploads, appends URL", async () => {
    mintMutateAsync.mockResolvedValue({ uploadUrl: "https://w/upload?t=tok&kind=photo" });
    uploadAssetFileMock.mockResolvedValue({ ok: true, url: "https://r2/abc.webp", key: "k/abc" });
    const { onChange } = renderUploader();
    const file = new File(["bytes"], "x.png", { type: "image/png" });
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(hiddenInput).toBeTruthy();
    fireEvent.change(hiddenInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(mintMutateAsync).toHaveBeenCalledWith({ tenantId: "t_demo", kind: "photo" });
    expect(uploadAssetFileMock).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]![0]).toEqual(["https://r2/abc.webp"]);
  });

  it("respects remaining slots when more files are picked than fit", async () => {
    // 11 of 12 used → only 1 of 3 picked files is uploaded
    const existing = Array.from({ length: GALLERY_MAX_PHOTOS - 1 }, (_, i) => `https://x/${i}.webp`);
    mintMutateAsync.mockResolvedValue({ uploadUrl: "https://w/upload?t=tok&kind=photo" });
    uploadAssetFileMock.mockResolvedValue({ ok: true, url: "https://r2/new.webp", key: "k/new" });
    const { onChange } = renderUploader({ photos: existing });
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
      new File(["c"], "c.png", { type: "image/png" }),
    ];
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(hiddenInput, { target: { files } });

    await waitFor(() => {
      expect(uploadAssetFileMock).toHaveBeenCalledTimes(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const finalArr = onChange.mock.calls[0]![0] as string[];
    expect(finalArr.length).toBe(GALLERY_MAX_PHOTOS);
  });

  it("upload failure surfaces an error and leaves state untouched", async () => {
    mintMutateAsync.mockResolvedValue({ uploadUrl: "https://w/upload?t=tok&kind=photo" });
    uploadAssetFileMock.mockRejectedValue(new Error("Upload failed (500)"));
    const { onChange } = renderUploader();
    const file = new File(["bytes"], "x.png", { type: "image/png" });
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(hiddenInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Upload failed/)).toBeTruthy();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("validation error skips upload entirely", async () => {
    validateMock.mockReturnValueOnce("Слишком большой файл");
    const { onChange } = renderUploader();
    const file = new File(["bytes"], "x.png", { type: "image/png" });
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(hiddenInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Слишком большой файл")).toBeTruthy();
    });
    expect(mintMutateAsync).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

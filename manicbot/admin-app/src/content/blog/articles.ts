/**
 * Public re-export façade for the blog content.
 *
 * Editorial content lives in `./articles/<slug>.ts` — one file per article so
 * a single article can be edited without scrolling through every translation.
 * This module just stitches them together and re-exports the types/labels
 * shared by the BlogClient and ArticleClient renderers.
 *
 * Import path stays `~/content/blog/articles` so existing consumers don't move.
 */

export type { BlogArticle, BlogCategory, BlogCoverImage } from "./types";
export {
  BLOG_CATEGORY_LABELS,
  BLOG_CATEGORY_ORDER,
  CATEGORY_KEYWORDS,
  pickRelated,
} from "./types";
export { ALL_BLOG_ARTICLES as BLOG_ARTICLES } from "./posts/index";

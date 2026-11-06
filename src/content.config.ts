import { defineCollection } from "astro:content";
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import markket from '../markket.config';

const SYNC_INTERVAL = 6000;

interface StrapiQueryOptions {
  contentType: string;
  sort?: string;
  filter?: string;
  populate?: string;
  paginate?: {
    limit?: number;
  };
}

// 1. Define a global passthrough schema to satisfy Astro's type engine
const baseStrapiSchema = z.object({}).passthrough();

/**
 * Native Strapi v5 Content Layer Loader for Astro
 */
function strapiLoader(query: StrapiQueryOptions) {
  return {
    name: `strapi-${query.contentType}`,

    async load({ store, logger, meta }: { store: any; logger: any; meta: any }) {
      const lastSynced = meta.get("lastSynced");
      if (lastSynced && Date.now() - Number(lastSynced) < SYNC_INTERVAL) {
        logger.info(`[Strapi] Skipping sync for ${query.contentType} (throttled)`);
        return;
      }

      try {
        const url = new URL(`/api/${query.contentType}s`, markket.api);

        if (query.sort) url.searchParams.append("sort", query.sort);
        if (query.populate) url.searchParams.append("populate", query.populate);

        if (query.paginate?.limit) {
          url.searchParams.append("pagination[limit]", String(query.paginate.limit));
        } else {
          url.searchParams.append("pagination[limit]", "100");
        }

        if (query.filter) {
          const params = new URLSearchParams(query.filter);
          for (const [key, value] of params.entries()) {
            url.searchParams.append(key, value);
          }
        }

        logger.info(`[Strapi] Fetching: ${url.toString()}`);

        const response = await fetch(url.toString(), {
          headers: {
            "Content-Type": "application/json",
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        const items = json.data;
        if (!items || !Array.isArray(items)) {
          logger.warn(`[Strapi] Missing data array for ${query.contentType}`);
          return;
        }

        store.clear();
        for (const item of items) {
          const dataPayload = item.attributes ? { id: item.id, ...item.attributes } : item;
          console.log(`${query.contentType}:${dataPayload.documentId}`);

          store.set({
            id: String(item.documentId),
            data: dataPayload,
          });
        }

        meta.set("lastSynced", String(Date.now()));
        logger.info(`[Strapi] Synced ${items.length} items for ${query.contentType}`);
      } catch (error) {
        logger.error(`[Strapi] Failed to load ${query.contentType}: ${error}`);
      }
    },
  };
}

const seoSchema = z
  .object({
    page_description: z.string().nullable(),
    canonical_url: z.string().nullable(),
    featured_image: z.string().nullable(),
    featured_image_alt: z.string().nullable(),
    author_twitter_handle: z.string().nullable(),
    open_graph_type: z.string().nullable(),
    no_index: z.boolean(),
  })
  .optional();

const blogCollection = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    post_hero: z.object({
      date: z.string().or(z.date()),
      heading: z.string(),
      tags: z.array(z.string()),
      author: z.string(),
      image: z.string(),
      image_alt: z.string(),
    }),
    thumb_image_path: z.string(),
    thumb_image_alt: z.string(),
    seo: seoSchema,
  }),
});

const pageSchema = z.object({
  title: z.string(),
  hero_block: z.any().optional(),
  content_blocks: z.array(z.any()).optional(),
  seo: seoSchema,
});

const paginatedCollectionSchema = z.object({
  title: z.string(),
  page_size: z.number().positive(),
  seo: seoSchema,
});

const pagesCollection = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,astro}', base: "./src/content/pages" }),
  schema: z.union([paginatedCollectionSchema, pageSchema]),
});




// DEFINE MARKKET COLLECTIONS; //
const stores = defineCollection({
  loader: strapiLoader({
    contentType: "store",
    filter: `filters[slug][$eq]=${markket.slug}`,
    populate: "seo.socialImage,logo,urls,favicon,seo",
    paginate: {
      limit: 100,
    }
  }),
  schema: baseStrapiSchema
});

const products = defineCollection({
  loader: strapiLoader({
    contentType: "product",
    filter: `filters[stores][slug][$eq]=${markket.slug}`,
    sort: "updatedAt:DESC",
    populate: "seo,seo.socialImage,thumbnail,slides,prices",
    paginate: {
      limit: 100,
    }
  }),
  schema: baseStrapiSchema
});


// eXPORT //
export const collections = {
  blog: blogCollection,
  pages: pagesCollection,
  stores,
  products,
};


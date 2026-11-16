/**
 * Single source of truth for the SHAPE of every tool's data.
 * Each Zod schema gives us three things from one definition:
 *   1. runtime validation (SDK checks inputs, and outputs against outputSchema)
 *   2. a JSON Schema the model reads
 *   3. a TypeScript type (z.infer) that data.ts, the tools and (Days 3-6) the views all import,
 *      so server and views can never disagree about a field name.
 */
import { z } from "zod";

// ------------------------------------------------------------------ shared
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO format YYYY-MM-DD");

export const CATEGORIES = ["Dairy", "Beverages", "Pantry", "Bakery", "Snacks", "Household"] as const;
export const CategorySchema = z.enum(CATEGORIES);

// ------------------------------------------------------------ top_promotions
export const TopPromotionsInput = z.object({
  from: isoDate.describe("Period start, e.g. 2025-04-01"),
  to: isoDate.describe("Period end, e.g. 2025-06-30"),
  limit: z.number().int().min(1).max(50).default(5).describe("How many promotions to return (1-50)"),
});

export const PromoResultSchema = z.object({
  promoId: z.string(),
  name: z.string(),
  type: z.string().describe("percent_off | bogo | bundle"),
  discountPct: z.number(),
  start: z.string(),
  end: z.string(),
  category: z.string(),
  region: z.string().describe("North | Centre | South | all"),
  uplift: z.number().describe("0.6 means +60% vs baseline"),
  incrementalUnits: z.number().describe("Extra units sold thanks to the promotion"),
});
export type PromoResult = z.infer<typeof PromoResultSchema>;

export const TopPromotionsOutput = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(PromoResultSchema),
});
export type TopPromotionsOutput = z.infer<typeof TopPromotionsOutput>;

// --------------------------------------------------------------- sales_trend
export const SalesTrendInput = z.object({
  productId: z.string().describe("Product ID such as P021. If unknown, call search_products first."),
  store: z
    .string()
    .optional()
    .describe("Optional store ID (S07) or city name (Sfax). Omit to sum all stores."),
});

export const TrendPointSchema = z.object({
  week: z.string().describe("Monday of the week, ISO date"),
  units: z.number(),
  price: z.number().describe("Average unit price that week"),
  promoId: z.string().nullable().describe("Promotion active that week, or null"),
});
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const SalesTrendOutput = z.object({
  productId: z.string(),
  productName: z.string(),
  store: z.string().describe("City name, or 'All stores'"),
  points: z.array(TrendPointSchema),
});
export type SalesTrendOutput = z.infer<typeof SalesTrendOutput>;

// ----------------------------------------------------------- search_products
export const SearchProductsInput = z.object({
  query: z.string().min(1).describe("Words to look for in product name or category, e.g. 'olive oil' or 'dairy'"),
  category: CategorySchema.optional().describe("Optional: restrict to one category"),
  limit: z.number().int().min(1).max(50).default(10),
});

export const ProductSchema = z.object({
  productId: z.string(),
  name: z.string(),
  category: z.string(),
  basePrice: z.number(),
});
export type Product = z.infer<typeof ProductSchema>;

export const SearchProductsOutput = z.object({
  products: z.array(ProductSchema),
});
export type SearchProductsOutput = z.infer<typeof SearchProductsOutput>;

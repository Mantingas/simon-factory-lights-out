import { z } from "zod";

const numeric = (fallback: number) =>
  z.coerce.number().int().positive().catch(fallback).default(fallback);

/** `z.coerce.boolean()` treats the string "false" as true, so parse explicitly. */
const boolean = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", "yes", "no"])
    .transform((value) => value === "true" || value === "1" || value === "yes")
    .catch(fallback)
    .default(String(fallback) as "true" | "false");

const envSchema = z.object({
  PORT: numeric(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).catch("info").default("info"),

  CACHE_TTL_MS: numeric(24 * 60 * 60 * 1000),
  CACHE_MAX_ENTRIES: numeric(5000),

  UPSTREAM_TIMEOUT_MS: numeric(10_000),
  UPSTREAM_RETRIES: z.coerce.number().int().min(0).max(5).catch(2).default(2),

  VIES_BASE_URL: z
    .string()
    .url()
    .default("https://ec.europa.eu/taxation_customs/vies/rest-api"),

  GUS_BASE_URL: z
    .string()
    .url()
    .default("https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc"),
  GUS_USER_KEY: z.string().min(1).default("abcde12345abcde12345"),

  // Polish VAT white list ("Biała Lista podatników VAT"). Free, no key needed.
  WL_BASE_URL: z.string().url().default("https://wl-api.mf.gov.pl"),
  WL_ENABLED: boolean(true),

  // Authentication and quotas.
  // `key:tier` pairs or a JSON array — see src/auth/api-keys.ts.
  API_KEYS: z.string().default(""),
  /** Only enable behind a proxy you control: it makes anonymous quota spoofable. */
  TRUST_PROXY: boolean(false),
  ANONYMOUS_DAILY_LIMIT: numeric(20),
  STARTER_MONTHLY_LIMIT: numeric(1000),
  PRO_MONTHLY_LIMIT: numeric(50_000),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return Object.freeze(parsed.data);
}

export const config: AppConfig = loadConfig();

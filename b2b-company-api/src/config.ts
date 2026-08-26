import { z } from "zod";

const numeric = (fallback: number) =>
  z.coerce.number().int().positive().catch(fallback).default(fallback);

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

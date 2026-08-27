import { useCallback, useMemo, useRef, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Checkbox,
  InlineStack,
  Select,
  Text,
  TextField,
  View,
  reactExtension,
  useApplyAttributeChange,
  useSettings,
  useShippingAddress,
  useTranslate,
} from "@shopify/ui-extensions-react/checkout";

import { DEFAULT_API_BASE_URL, lookupCompany, type CompanyResponse, type LookupOutcome } from "./api";
import {
  SUPPORTED_COUNTRIES,
  defaultCountry,
  looksSearchable,
  normalizeCompanyCode,
  type SupportedCountry,
} from "./normalize";

export default reactExtension("purchase.checkout.block.render", () => <B2BCompanyLookup />);

/**
 * Note attributes the merchant reads when raising the invoice.
 *
 * These carry the whole result, address included, because a checkout UI
 * extension *cannot write the billing address*: `billingAddress` is exposed
 * read-only and no `applyBillingAddressChange` exists in the API. See README —
 * the address is applied to the order from the app backend after checkout.
 */
const ATTRIBUTE_KEYS = {
  name: "Invoice_Company_Name",
  companyCode: "Invoice_Company_Code",
  vatCode: "Invoice_VAT_Code",
  address: "Invoice_Address",
} as const;

type Status = "idle" | "loading" | "found" | "notFound" | "invalid" | "rateLimited" | "unavailable";

function B2BCompanyLookup() {
  const translate = useTranslate();
  const settings = useSettings();
  const shippingAddress = useShippingAddress();
  const applyAttributeChange = useApplyAttributeChange();

  const [isCompany, setIsCompany] = useState(false);
  const [country, setCountry] = useState<SupportedCountry>(() =>
    defaultCountry(shippingAddress?.countryCode ?? undefined),
  );
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [company, setCompany] = useState<CompanyResponse | undefined>();
  const [saved, setSaved] = useState(true);

  // Lets a second search cancel the first, so a slow reply cannot overwrite a
  // newer one — the buyer would otherwise see results for a code they replaced.
  const inFlight = useRef<AbortController>();

  const apiBaseUrl = useMemo(() => {
    const configured = settings?.api_base_url;
    return typeof configured === "string" && configured.trim() ? configured : DEFAULT_API_BASE_URL;
  }, [settings]);

  const normalized = useMemo(() => normalizeCompanyCode(input), [input]);
  const canSearch = looksSearchable(normalized.code) && status !== "loading";

  const countryOptions = useMemo(
    () =>
      SUPPORTED_COUNTRIES.map((value) => ({
        value,
        label: translate(`country.${value}`),
      })),
    [translate],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setCompany(undefined);
    setSaved(true);
  }, []);

  const search = useCallback(async () => {
    if (!looksSearchable(normalized.code)) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setStatus("loading");
    setCompany(undefined);
    setSaved(true);

    const outcome: LookupOutcome = await lookupCompany(country, normalized.code, {
      baseUrl: apiBaseUrl,
      signal: controller.signal,
    });

    if (controller.signal.aborted) return;

    if (outcome.status !== "found") {
      setStatus(outcome.status);
      return;
    }

    const found = outcome.company;
    setCompany(found);
    setStatus("found");

    // Attributes are the only writable channel here, so they carry everything
    // the invoice needs — including the address, which the extension cannot
    // apply to the billing form itself.
    //
    // The shipping address is deliberately left alone: goods often go somewhere
    // other than the registered office, and silently redirecting a delivery
    // would be a far worse bug than an invoice field the merchant fills in.
    const results = await Promise.all([
      applyAttributeChange({ type: "updateAttribute", key: ATTRIBUTE_KEYS.name, value: found.name }),
      applyAttributeChange({
        type: "updateAttribute",
        key: ATTRIBUTE_KEYS.companyCode,
        value: found.company_code,
      }),
      applyAttributeChange({
        type: "updateAttribute",
        key: ATTRIBUTE_KEYS.vatCode,
        value: found.vat_code ?? "",
      }),
      applyAttributeChange({
        type: "updateAttribute",
        key: ATTRIBUTE_KEYS.address,
        value: found.address.full_address ?? "",
      }),
    ]);

    setSaved(results.every((result) => result.type === "success"));
  }, [
    apiBaseUrl,
    applyAttributeChange,
    country,
    normalized.code,
  ]);

  const clearCompanyPurchase = useCallback(
    async (checked: boolean) => {
      setIsCompany(checked);
      if (checked) return;

      reset();
      setInput("");
      // Leaving stale company details on an order the buyer changed their mind
      // about would put the wrong name on the invoice.
      await Promise.all(
        Object.values(ATTRIBUTE_KEYS).map((key) =>
          applyAttributeChange({ type: "updateAttribute", key, value: "" }),
        ),
      );
    },
    [applyAttributeChange, reset],
  );

  return (
    <BlockStack spacing="base">
      <Checkbox checked={isCompany} onChange={clearCompanyPurchase}>
        {translate("buyingAsCompany")}
      </Checkbox>

      {isCompany ? (
        <BlockStack spacing="base">
          <Select
            label={translate("country.label")}
            value={country}
            options={countryOptions}
            onChange={(value: string) => {
              setCountry(value as SupportedCountry);
              reset();
            }}
            disabled={status === "loading"}
          />

          <TextField
            label={translate("code.label")}
            value={input}
            onChange={(value: string) => {
              setInput(value);
              if (status !== "idle") reset();
            }}
            onInput={(value: string) => setInput(value)}
            disabled={status === "loading"}
            autocomplete={false}
          />

          <Text size="small" appearance="subdued">
            {normalized.code && normalized.code !== input.toUpperCase()
              ? translate("code.willSearch", { code: normalized.code })
              : translate("code.help")}
          </Text>

          <InlineStack spacing="base" blockAlignment="center">
            <Button
              kind="secondary"
              onPress={search}
              disabled={!canSearch}
              loading={status === "loading"}
              accessibilityLabel={translate("search")}
            >
              {translate("search")}
            </Button>
          </InlineStack>

          {status === "found" && company ? (
            <CompanyFound company={company} saved={saved} />
          ) : null}

          {status === "notFound" || status === "invalid" ? (
            <Banner status="warning" title={translate("notFound.title")}>
              {translate("notFound.body")}
            </Banner>
          ) : null}

          {status === "rateLimited" ? (
            <Banner status="warning" title={translate("rateLimited.title")}>
              {translate("rateLimited.body")}
            </Banner>
          ) : null}

          {status === "unavailable" ? (
            <Banner status="warning" title={translate("unavailable.title")}>
              {translate("unavailable.body")}
            </Banner>
          ) : null}
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}

function CompanyFound({ company, saved }: { company: CompanyResponse; saved: boolean }) {
  const translate = useTranslate();

  return (
    <BlockStack spacing="tight">
      <Banner status="success" title={translate("found.title")}>
        <BlockStack spacing="extraTight">
          <Text emphasis="bold">{company.name}</Text>

          <Text size="small">
            {translate("found.companyCode")}: {company.company_code}
          </Text>

          {company.vat_code ? (
            <Text size="small">
              {translate("found.vatCode")}: {company.vat_code}
              {company.is_vat_valid ? ` · ${translate("found.vatValid")}` : ""}
            </Text>
          ) : (
            <Text size="small" appearance="subdued">
              {translate("found.noVatCode")}
            </Text>
          )}

          {company.address.full_address ? (
            <Text size="small">{company.address.full_address}</Text>
          ) : null}

          <Text size="small" appearance="subdued">
            {translate("found.source", { source: company.source })}
          </Text>
        </BlockStack>
      </Banner>

      {/* A company struck off the register can no longer trade — worth saying
          before an invoice is raised, not after. */}
      {company.deregistered_at ? (
        <Banner status="critical" title={translate("deregistered.title")}>
          {translate("deregistered.body", { date: company.deregistered_at })}
        </Banner>
      ) : null}

      {!saved ? (
        <Banner status="warning" title={translate("notSaved.title")}>
          {translate("notSaved.body")}
        </Banner>
      ) : null}

      <View>
        <Text size="small" appearance="subdued">
          {translate("found.savedForInvoice")}
        </Text>
      </View>
    </BlockStack>
  );
}

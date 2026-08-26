import type { CompanyLookupInput } from "../../src/types.js";

export const NIP_ORLEN = "7740001454";
export const NIP_INVALID_CHECKSUM = "7740001455";
export const REGON9_ORLEN = "610188201";
export const REGON14 = "61018820100003";

export function lookupInput(overrides: Partial<CompanyLookupInput> = {}): CompanyLookupInput {
  return {
    country: "LT",
    code: "100001919817",
    rawCode: "100001919817",
    vatPrefixed: false,
    ...overrides,
  };
}

export const GUS_LOGIN_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body>
    <ZalogujResponse xmlns="http://CIS/BIR/2014/07">
      <ZalogujResult>session-abc-123</ZalogujResult>
    </ZalogujResponse>
  </s:Body>
</s:Envelope>`;

export const GUS_LOGIN_REJECTED = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body>
    <ZalogujResponse xmlns="http://CIS/BIR/2014/07">
      <ZalogujResult></ZalogujResult>
    </ZalogujResponse>
  </s:Body>
</s:Envelope>`;

function gusSearchEnvelope(inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body>
    <DaneSzukajPodmiotyResponse xmlns="http://CIS/BIR/PublDane/2021/11">
      <DaneSzukajPodmiotyResult>${inner}</DaneSzukajPodmiotyResult>
    </DaneSzukajPodmiotyResponse>
  </s:Body>
</s:Envelope>`;
}

/** GUS nests the payload as an escaped XML string inside the SOAP result. */
export const GUS_SEARCH_FOUND = gusSearchEnvelope(
  [
    "&lt;root&gt;&lt;dane&gt;",
    `&lt;Regon&gt;${REGON9_ORLEN}&lt;/Regon&gt;`,
    `&lt;Nip&gt;${NIP_ORLEN}&lt;/Nip&gt;`,
    "&lt;StatusNip/&gt;",
    "&lt;Nazwa&gt;ORLEN SPÓŁKA AKCYJNA&lt;/Nazwa&gt;",
    "&lt;Wojewodztwo&gt;MAZOWIECKIE&lt;/Wojewodztwo&gt;",
    "&lt;Powiat&gt;m. Płock&lt;/Powiat&gt;",
    "&lt;Gmina&gt;M. Płock&lt;/Gmina&gt;",
    "&lt;Miejscowosc&gt;Płock&lt;/Miejscowosc&gt;",
    "&lt;KodPocztowy&gt;09411&lt;/KodPocztowy&gt;",
    "&lt;Ulica&gt;ul. Chemików&lt;/Ulica&gt;",
    "&lt;NrNieruchomosci&gt;7&lt;/NrNieruchomosci&gt;",
    "&lt;NrLokalu/&gt;",
    "&lt;Typ&gt;P&lt;/Typ&gt;",
    "&lt;SilosID&gt;6&lt;/SilosID&gt;",
    "&lt;DataZakonczeniaDzialalnosci/&gt;",
    "&lt;MiejscowoscPoczty&gt;Płock&lt;/MiejscowoscPoczty&gt;",
    "&lt;/dane&gt;&lt;/root&gt;",
  ].join(""),
);

export const GUS_SEARCH_NOT_FOUND = gusSearchEnvelope(
  [
    "&lt;root&gt;&lt;dane&gt;",
    "&lt;ErrorCode&gt;4&lt;/ErrorCode&gt;",
    "&lt;ErrorMessagePl&gt;Nie znaleziono podmiotu dla podanych kryteriów wyszukiwania.&lt;/ErrorMessagePl&gt;",
    "&lt;/dane&gt;&lt;/root&gt;",
  ].join(""),
);

export const GUS_LOGOUT_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body>
    <WylogujResponse xmlns="http://CIS/BIR/2014/07"><WylogujResult>true</WylogujResult></WylogujResponse>
  </s:Body>
</s:Envelope>`;

export const VIES_VALID = {
  countryCode: "LT",
  vatNumber: "100001919817",
  requestDate: "2026-08-26+02:00",
  valid: true,
  name: "UAB PAVYZDYS",
  address: "GEDIMINO PR. 1\nLT-01103 VILNIUS",
  userError: "VALID",
};

export const VIES_INVALID = {
  countryCode: "LT",
  vatNumber: "000000000000",
  requestDate: "2026-08-26+02:00",
  valid: false,
  name: "---",
  address: "---",
  userError: "INVALID",
};
